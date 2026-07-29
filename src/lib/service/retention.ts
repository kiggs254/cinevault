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

/** Delete watched media from S3 once it's been watched longer than the window. */
export async function runRetention(): Promise<{ deleted: number }> {
  const cfg = await getConfig();
  if (!cfg.retention.autoDeleteWatched) return { deleted: 0 };
  if (!cfg.s3.endpoint || !cfg.s3.bucket) return { deleted: 0 };

  // Keep watched state fresh before deciding what to delete.
  await syncWatchedState().catch(() => {});

  const cutoff = new Date(Date.now() - cfg.retention.days * DAY);
  const rows = await prisma.download.findMany({
    where: { watchedAt: { lte: cutoff }, s3Key: { not: null }, s3DeletedAt: null },
    select: { id: true, s3Key: true, title: true, season: true, episode: true },
  });
  if (rows.length === 0) return { deleted: 0 };

  const s3 = makeS3(cfg.s3);
  let deleted = 0;
  for (const r of rows) {
    try {
      // Shared files, personal libraries: only physically free the object when no
      // other member's (non-deleted) row still points at the same S3 key.
      if (r.s3Key) {
        const others = await prisma.download.count({
          where: { s3Key: r.s3Key, s3DeletedAt: null, id: { not: r.id } },
        });
        if (others === 0) await deleteObject(s3, cfg.s3.bucket, r.s3Key);
      }
      await prisma.download.update({ where: { id: r.id }, data: { s3DeletedAt: new Date() } });
      deleted++;
    } catch (e) {
      console.error("[retention] delete failed:", r.title, (e as Error).message);
    }
  }
  if (deleted) {
    await notify(`🧹 Freed storage: removed ${deleted} watched item(s) older than ${cfg.retention.days} days from S3.`);
  }
  return { deleted };
}
