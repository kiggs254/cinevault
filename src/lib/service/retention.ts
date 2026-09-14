import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { getConfig } from "../config";
import { jellyfinReady, getWatchedEpisodes, getPlayedTitles } from "../jellyfin/client";
import { makeS3, deleteObject } from "../storage/s3";
import { notify } from "../telegram/client";

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

const GB = 1024 * 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;

/**
 * Storage lifecycle sweep (daily). Two independent reclaimers:
 *  1. Idle purge (`autoDeleteIdle`, default on, `idleDays` default 60): free titles
 *     NOBODY has watched within `idleDays` of being added — movies/episodes via
 *     `watchedAt`, packs via live Jellyfin signals. Reference-counted (the S3 object
 *     only leaves with its last holder).
 *  2. Budget backstop (`maxStorageGB`, 0 = off): if usage still reaches the cap,
 *     free the least-recently-used files (fully-watched first) down to 90% of the
 *     budget. Anything a member is actively watching (incl. packs) is protected.
 */
export async function runRetention(): Promise<{ deleted: number }> {
  const cfg = await getConfig();
  if (!cfg.s3.endpoint || !cfg.s3.bucket) return { deleted: 0 };
  const capGB = cfg.retention.maxStorageGB;
  const budgetOn = capGB > 0;
  if (!cfg.retention.autoDeleteIdle && !budgetOn) return { deleted: 0 };

  // Fresh watched state so both passes reflect what's actually been consumed.
  await syncWatchedState().catch(() => {});
  const bucket = cfg.s3.bucket;
  const s3 = makeS3(cfg.s3);
  const signals = await watchedSignals(cfg);
  let deleted = 0;
  let freed = 0;

  // ── Pass 1: idle purge — titles nobody has watched within `idleDays`. ──
  if (cfg.retention.autoDeleteIdle) {
    const idleCutoff = new Date(Date.now() - cfg.retention.idleDays * DAY);
    const candidates = await prisma.download.findMany({
      where: { status: "COMPLETED", s3Key: { not: null }, s3DeletedAt: null, completedAt: { lte: idleCutoff } },
      select: { id: true, s3Key: true, title: true, kind: true, tmdbId: true, season: true },
    });
    for (const r of candidates) {
      try {
        if (!r.s3Key) continue;
        // Keep if any live holder of this file is marked watched…
        const watchedRows = await prisma.download.count({
          where: { s3Key: r.s3Key, s3DeletedAt: null, watchedAt: { not: null } },
        });
        if (watchedRows > 0) continue;
        // …or if Jellyfin shows anyone watching this movie / season (covers packs).
        if (r.tmdbId) {
          if (r.kind === "MOVIE" && signals.movies.has(r.tmdbId)) continue;
          if (r.kind === "TV" && r.season != null && signals.seasons.has(`${r.tmdbId}:${r.season}`)) continue;
        }
        // Reference-counted: free the object only when this is the last holder.
        const others = await prisma.download.count({ where: { s3Key: r.s3Key, s3DeletedAt: null, id: { not: r.id } } });
        if (others === 0) await deleteObject(s3, bucket, r.s3Key).catch(() => {});
        await prisma.download.update({ where: { id: r.id }, data: { s3DeletedAt: new Date() } });
        deleted++;
      } catch (e) {
        console.error("[retention] idle delete failed:", r.title, (e as Error).message);
      }
    }
  }

  // ── Pass 2: budget backstop — free the LRU (watched first) if still over cap. ──
  if (budgetOn) {
    const cap = capGB * GB;
    const target = cap * 0.9; // free down to 90% so we don't evict on every tick
    const rows = await prisma.download.findMany({
      where: { status: "COMPLETED", s3Key: { not: null }, s3DeletedAt: null },
      select: { s3Key: true, sizeBytes: true, watchedAt: true, completedAt: true, createdAt: true, tmdbId: true, kind: true, season: true },
    });
    interface FileInfo {
      key: string; size: number; watched: boolean; lastTouch: number;
      tmdbId: number | null; kind: string; season: number | null;
    }
    const files = new Map<string, FileInfo>();
    for (const r of rows) {
      const key = r.s3Key as string;
      const touch = Math.max(r.completedAt?.getTime() ?? 0, r.watchedAt?.getTime() ?? 0, r.createdAt.getTime());
      const f = files.get(key);
      if (!f) {
        files.set(key, { key, size: Number(r.sizeBytes), watched: r.watchedAt != null, lastTouch: touch, tmdbId: r.tmdbId, kind: r.kind, season: r.season });
      } else {
        f.watched = f.watched || r.watchedAt != null;
        f.lastTouch = Math.max(f.lastTouch, touch);
      }
    }
    let usage = 0;
    for (const f of files.values()) usage += f.size;
    if (usage >= cap) {
      const isProtected = (f: FileInfo) =>
        f.tmdbId != null &&
        ((f.kind === "MOVIE" && signals.movies.has(f.tmdbId)) ||
          (f.kind === "TV" && f.season != null && signals.seasons.has(`${f.tmdbId}:${f.season}`)));
      const evictable = [...files.values()]
        .filter((f) => !isProtected(f))
        .sort((a, b) => Number(b.watched) - Number(a.watched) || a.lastTouch - b.lastTouch);
      for (const f of evictable) {
        if (usage <= target) break;
        try {
          const holders = await prisma.download.count({ where: { s3Key: f.key, s3DeletedAt: null } });
          await deleteObject(s3, bucket, f.key).catch(() => {});
          await prisma.download.updateMany({ where: { s3Key: f.key, s3DeletedAt: null }, data: { s3DeletedAt: new Date() } });
          usage -= f.size;
          freed += f.size;
          deleted += holders;
        } catch (e) {
          console.error("[retention] evict failed:", f.key, (e as Error).message);
        }
      }
    }
  }

  if (deleted > 0) {
    const gb = freed > 0 ? ` (~${(freed / GB).toFixed(1)} GB)` : "";
    await notify(`🧹 Storage cleanup: removed ${deleted} item(s)${gb} — long-unwatched titles + any over-budget least-recently-used. All re-downloadable on request.`);
  }
  return { deleted };
}
