import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { getConfig } from "../config";
import { jellyfinReady, getWatchedEpisodes, getPlayedTitles } from "../jellyfin/client";
import { makeS3, deleteObject } from "../storage/s3";
import { notify } from "../telegram/client";

const DAY = 24 * 60 * 60 * 1000;

/**
 * Mark downloads as watched using Jellyfin play state. Only episode-level and
 * movie downloads are matched — season packs are intentionally left alone so
 * retention never deletes a pack with unwatched episodes still inside.
 */
export async function syncWatchedState(): Promise<{ marked: number }> {
  const cfg = await getConfig();
  if (!jellyfinReady(cfg.jellyfin)) return { marked: 0 };
  // Each member's Jellyfin play state marks THEIR own library rows watched.
  const users = await prisma.user.findMany({
    where: { status: "active", jellyfinUserId: { not: null } },
    select: { id: true, jellyfinUserId: true },
  });
  let marked = 0;

  for (const u of users) {
    const jelly = { ...cfg.jellyfin, userId: u.jellyfinUserId ?? undefined };
    const [eps, played] = await Promise.all([getWatchedEpisodes(jelly), getPlayedTitles(jelly, 200)]);

    for (const e of eps) {
      if (!e.seriesName && !e.seriesTmdbId) continue;
      const or: Prisma.DownloadWhereInput[] = [];
      if (e.seriesTmdbId) or.push({ tmdbId: e.seriesTmdbId });
      if (e.seriesName) or.push({ title: { contains: e.seriesName, mode: "insensitive" } });
      const when = e.lastPlayed ? new Date(e.lastPlayed) : new Date();
      const res = await prisma.download.updateMany({
        where: { userId: u.id, kind: "TV", season: e.season, episode: e.episode, watchedAt: null, OR: or },
        data: { watchedAt: when },
      });
      marked += res.count;
    }

    for (const m of played.filter((p) => p.type === "Movie")) {
      const or: Prisma.DownloadWhereInput[] = [];
      if (m.tmdbId) or.push({ tmdbId: m.tmdbId });
      if (m.name) or.push({ title: { contains: m.name, mode: "insensitive" } });
      if (!or.length) continue;
      const when = m.lastPlayed ? new Date(m.lastPlayed) : new Date();
      const res = await prisma.download.updateMany({
        where: { userId: u.id, kind: "MOVIE", watchedAt: null, OR: or },
        data: { watchedAt: when },
      });
      marked += res.count;
    }
  }

  return { marked };
}

/**
 * "Someone has watched part of this" signals, aggregated across all members'
 * Jellyfin — needed for the idle purge because season PACKS never get `watchedAt`
 * (that's episode-level only), so a pack being actively watched must not be
 * mistaken for idle. Returns sets of "tmdbId:season" and movie tmdbIds.
 */
async function watchedSignals(cfg: Awaited<ReturnType<typeof getConfig>>): Promise<{
  seasons: Set<string>;
  movies: Set<number>;
}> {
  const seasons = new Set<string>();
  const movies = new Set<number>();
  if (!jellyfinReady(cfg.jellyfin)) return { seasons, movies };
  const users = await prisma.user.findMany({
    where: { status: "active", jellyfinUserId: { not: null } },
    select: { jellyfinUserId: true },
  });
  for (const u of users) {
    const jelly = { ...cfg.jellyfin, userId: u.jellyfinUserId ?? undefined };
    const [eps, played] = await Promise.all([
      getWatchedEpisodes(jelly).catch(() => []),
      getPlayedTitles(jelly, 200).catch(() => []),
    ]);
    for (const e of eps) if (e.seriesTmdbId) seasons.add(`${e.seriesTmdbId}:${e.season}`);
    for (const m of played) if (m.type === "Movie" && m.tmdbId) movies.add(m.tmdbId);
  }
  return { seasons, movies };
}

/**
 * Storage lifecycle sweep (daily):
 *  - `autoDeleteWatched`: free WATCHED items older than `days`.
 *  - `autoDeleteIdle`: free items NObody has watched within `idleDays` of adding
 *    (movies/episodes via `watchedAt`; packs via live Jellyfin signals). Both are
 *    reference-counted — the S3 object only leaves when its last holder does.
 */
export async function runRetention(): Promise<{ deleted: number }> {
  const cfg = await getConfig();
  if (!cfg.s3.endpoint || !cfg.s3.bucket) return { deleted: 0 };
  if (!cfg.retention.autoDeleteWatched && !cfg.retention.autoDeleteIdle) return { deleted: 0 };

  // Keep watched state fresh before deciding what to delete.
  await syncWatchedState().catch(() => {});
  const bucket = cfg.s3.bucket;
  const s3 = makeS3(cfg.s3);
  let deleted = 0;

  /** Soft-delete a row: free the object only when it's the last live holder. */
  const softDelete = async (id: string, s3Key: string | null) => {
    if (s3Key) {
      const others = await prisma.download.count({
        where: { s3Key, s3DeletedAt: null, id: { not: id } },
      });
      if (others === 0) await deleteObject(s3, bucket, s3Key);
    }
    await prisma.download.update({ where: { id }, data: { s3DeletedAt: new Date() } });
    deleted++;
  };

  // 1) Watched content past the watched window.
  if (cfg.retention.autoDeleteWatched) {
    const cutoff = new Date(Date.now() - cfg.retention.days * DAY);
    const rows = await prisma.download.findMany({
      where: { watchedAt: { lte: cutoff }, s3Key: { not: null }, s3DeletedAt: null },
      select: { id: true, s3Key: true, title: true },
    });
    for (const r of rows) {
      try {
        await softDelete(r.id, r.s3Key);
      } catch (e) {
        console.error("[retention] watched delete failed:", r.title, (e as Error).message);
      }
    }
  }

  // 2) Idle content nobody has watched within the idle window.
  if (cfg.retention.autoDeleteIdle) {
    const idleCutoff = new Date(Date.now() - cfg.retention.idleDays * DAY);
    const signals = await watchedSignals(cfg);
    const candidates = await prisma.download.findMany({
      where: {
        status: "COMPLETED",
        s3Key: { not: null },
        s3DeletedAt: null,
        completedAt: { lte: idleCutoff },
      },
      select: { id: true, s3Key: true, title: true, kind: true, tmdbId: true, season: true },
    });
    for (const r of candidates) {
      try {
        if (!r.s3Key) continue;
        // Skip if any live row sharing this file is marked watched…
        const watchedRows = await prisma.download.count({
          where: { s3Key: r.s3Key, s3DeletedAt: null, watchedAt: { not: null } },
        });
        if (watchedRows > 0) continue;
        // …or if Jellyfin shows anyone watching this movie / season (covers packs).
        if (r.tmdbId) {
          if (r.kind === "MOVIE" && signals.movies.has(r.tmdbId)) continue;
          if (r.kind === "TV" && r.season != null && signals.seasons.has(`${r.tmdbId}:${r.season}`)) continue;
        }
        await softDelete(r.id, r.s3Key);
      } catch (e) {
        console.error("[retention] idle delete failed:", r.title, (e as Error).message);
      }
    }
  }

  if (deleted) {
    await notify(`🧹 Freed storage: removed ${deleted} item(s) from S3 (watched + unwatched-idle cleanup).`);
  }
  return { deleted };
}
