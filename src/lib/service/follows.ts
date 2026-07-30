import { prisma } from "../db";
import { getConfig } from "../config";
import { ProwlarrClient } from "../indexers/prowlarr";
import { grabEpisode, ownedEpisodeKeys, removeDownload } from "./downloads";
import { notifyUser } from "../telegram/client";
import { getTvDetails, getSeasonEpisodes, searchTitle } from "../metadata/tmdb";
import { enqueueSeasonGrab } from "../queue";
import { getWatchingSeries, getWatchedEpisodes, jellyfinReady } from "../jellyfin/client";
import type { FollowedShow } from "@prisma/client";

const DAY = 24 * 60 * 60 * 1000;

/** Follow a show by TMDB id (enriched from TMDB). Idempotent. */
export async function followShow(
  tmdbId: number,
  opts: { source?: string; autoDownload?: boolean; quality?: string; userId?: string | null } = {},
): Promise<FollowedShow | null> {
  const cfg = await getConfig();
  if (!cfg.tmdb.apiKey) return null;
  const existing = await prisma.followedShow.findFirst({
    where: { tmdbId, ...(opts.userId ? { userId: opts.userId } : {}) },
  });
  if (existing) return existing;
  const d = await getTvDetails(cfg.tmdb.apiKey, tmdbId);
  if (!d) return null;
  const created = await prisma.followedShow.create({
    data: {
      tmdbId,
      userId: opts.userId ?? null,
      title: d.title,
      year: d.year ?? null,
      posterUrl: d.posterUrl ?? null,
      overview: d.overview ?? null,
      status: d.status ?? null,
      autoDownload: opts.autoDownload ?? true,
      quality: opts.quality ?? "any",
      source: opts.source ?? "manual",
    },
  });
  // On follow, download the LATEST released season now; the scanner then keeps it
  // topped up and moves forward when a new season airs.
  const today = new Date().toISOString().slice(0, 10);
  const released = d.seasons
    .filter((s) => s.seasonNumber >= 1 && !!s.airDate && s.airDate <= today && s.episodeCount > 0)
    .map((s) => s.seasonNumber);
  if (released.length && (opts.autoDownload ?? true)) {
    await enqueueSeasonGrab({
      tmdbId,
      title: d.title,
      year: d.year ?? null,
      season: Math.max(...released),
      notify: false,
      userId: opts.userId ?? null,
    }).catch(() => {});
  }
  return created;
}

/**
 * Begin a member on a show at `startSeason`: download just that one season and
 * mark the follow to auto-advance — the season-progress scan then pulls later
 * seasons as they near the end of the current one. Idempotent per (userId, tmdbId).
 */
export async function startShow(opts: {
  tmdbId: number;
  title: string;
  year?: number | null;
  startSeason: number;
  userId: string;
}): Promise<void> {
  const season = Math.max(1, Math.trunc(opts.startSeason));
  await prisma.followedShow.upsert({
    where: { userId_tmdbId: { userId: opts.userId, tmdbId: opts.tmdbId } },
    update: { autoAdvance: true, startSeason: season, autoDownload: true },
    create: {
      tmdbId: opts.tmdbId,
      userId: opts.userId,
      title: opts.title,
      year: opts.year ?? null,
      autoAdvance: true,
      startSeason: season,
      source: "progressive",
    },
  });
  await enqueueSeasonGrab({
    tmdbId: opts.tmdbId,
    title: opts.title,
    year: opts.year ?? null,
    season,
    notify: false,
    userId: opts.userId,
  }).catch(() => {});
}

export async function unfollowShow(id: string): Promise<void> {
  await prisma.followedShow.delete({ where: { id } }).catch(() => {});
}

/**
 * Watch-driven season progression + finished-season cleanup, per member:
 *  - when they've watched the 2nd-to-last episode of their current season, pull
 *    the next one so it's ready before the finale ends;
 *  - once a season is fully watched AND its successor is owned, drop the finished
 *    one (reference-counted — the S3 file only leaves if no other member holds it).
 * Reads binary per-episode "played" from each member's own Jellyfin.
 */
export async function advanceSeasons(): Promise<{ advanced: number; cleaned: number }> {
  const cfg = await getConfig();
  if (!jellyfinReady(cfg.jellyfin) || !cfg.tmdb.apiKey) return { advanced: 0, cleaned: 0 };
  const apiKey = cfg.tmdb.apiKey;
  const users = await prisma.user.findMany({
    where: { status: "active", jellyfinUserId: { not: null } },
    select: { id: true, jellyfinUserId: true },
  });
  let advanced = 0;
  let cleaned = 0;

  // TMDB season → released-episode-count, cached per show across users for one run.
  const epCountCache = new Map<number, Map<number, number>>();
  const seasonEpCounts = async (tmdbId: number): Promise<Map<number, number>> => {
    const hit = epCountCache.get(tmdbId);
    if (hit) return hit;
    const d = await getTvDetails(apiKey, tmdbId).catch(() => null);
    const today = new Date().toISOString().slice(0, 10);
    const m = new Map<number, number>();
    for (const s of d?.seasons ?? []) {
      if (s.seasonNumber >= 1 && s.episodeCount > 0 && !!s.airDate && s.airDate <= today) {
        m.set(s.seasonNumber, s.episodeCount);
      }
    }
    epCountCache.set(tmdbId, m);
    return m;
  };

  for (const u of users) {
    const jelly = { ...cfg.jellyfin, userId: u.jellyfinUserId ?? undefined };
    const follows = await prisma.followedShow.findMany({
      where: { userId: u.id, autoAdvance: true },
      select: { tmdbId: true, title: true, year: true },
    });
    if (follows.length === 0) continue;
    const watched = await getWatchedEpisodes(jelly).catch(() => []);

    for (const f of follows) {
      // Seasons this member currently owns (a pack row, or per-episode rows).
      const owned = await prisma.download.findMany({
        where: {
          userId: u.id,
          tmdbId: f.tmdbId,
          kind: "TV",
          s3Key: { not: null },
          s3DeletedAt: null,
          season: { not: null },
        },
        select: { season: true },
      });
      const ownedSeasons = new Set(owned.map((o) => o.season!).filter((s) => s >= 1));
      if (ownedSeasons.size === 0) continue;
      const currentSeason = Math.max(...ownedSeasons);
      const epCounts = await seasonEpCounts(f.tmdbId);
      const watchedInSeason = (season: number) =>
        new Set(
          watched.filter((w) => w.seriesTmdbId === f.tmdbId && w.season === season).map((w) => w.episode),
        ).size;

      // 1) Pre-fetch the next season once they finish the penultimate episode.
      const curCount = epCounts.get(currentSeason) ?? 0;
      const nextSeason = currentSeason + 1;
      const nextCount = epCounts.get(nextSeason) ?? 0;
      const nearingEnd = watchedInSeason(currentSeason) >= Math.max(1, curCount - 1);
      if (curCount > 0 && nextCount > 0 && !ownedSeasons.has(nextSeason) && nearingEnd) {
        await enqueueSeasonGrab({
          tmdbId: f.tmdbId,
          title: f.title,
          year: f.year ?? null,
          season: nextSeason,
          notify: false,
          userId: u.id,
        }).catch(() => {});
        await notifyUser(
          u.id,
          `📺 Getting Season ${nextSeason} of “${f.title}” ready — you're near the end of Season ${currentSeason}.`,
        ).catch(() => {});
        advanced++;
      }

      // 2) Drop a finished season once its successor is owned (reference-counted).
      for (const season of ownedSeasons) {
        const count = epCounts.get(season) ?? 0;
        if (count > 0 && ownedSeasons.has(season + 1) && watchedInSeason(season) >= count) {
          const rows = await prisma.download.findMany({
            where: { userId: u.id, tmdbId: f.tmdbId, kind: "TV", season, s3DeletedAt: null },
            select: { id: true },
          });
          for (const r of rows) await removeDownload(r.id).catch(() => {});
          if (rows.length) {
            cleaned++;
            await notifyUser(
              u.id,
              `🧹 Cleared Season ${season} of “${f.title}” — you finished it and Season ${season + 1} is ready. Re-add anytime.`,
            ).catch(() => {});
          }
        }
      }
    }
  }
  return { advanced, cleaned };
}

/** Auto-follow series each member is actively watching in their own Jellyfin. */
export async function autoFollowFromJellyfin(): Promise<{ added: number }> {
  const cfg = await getConfig();
  if (!cfg.discovery.autoFollowFromJellyfin || !jellyfinReady(cfg.jellyfin) || !cfg.tmdb.apiKey) {
    return { added: 0 };
  }
  const users = await prisma.user.findMany({
    where: { status: "active", jellyfinUserId: { not: null } },
    select: { id: true, jellyfinUserId: true },
  });
  let added = 0;
  for (const u of users) {
    const jelly = { ...cfg.jellyfin, userId: u.jellyfinUserId ?? undefined };
    const watching = await getWatchingSeries(jelly);
    for (const s of watching) {
      let tmdbId = s.tmdbId;
      if (!tmdbId) tmdbId = (await searchTitle(cfg.tmdb.apiKey, "tv", s.name, s.year))?.tmdbId;
      if (!tmdbId) continue;
      const exists = await prisma.followedShow.findFirst({
        where: { tmdbId, userId: u.id },
        select: { id: true },
      });
      if (exists) continue;
      const created = await followShow(tmdbId, { source: "jellyfin", autoDownload: true, userId: u.id });
      if (created) {
        added++;
        await notifyUser(
          u.id,
          `📺 Now following “${created.title}” (you're watching it) — I'll grab new episodes automatically.`,
        );
      }
    }
  }
  return { added };
}

/**
 * Check followed shows for newly aired episodes (aired ≥1 day ago, after the
 * follow began) that aren't in the library yet, and auto-download them.
 */
export async function scanFollowedShows(): Promise<{ checked: number; grabbed: number }> {
  const cfg = await getConfig();
  if (!cfg.tmdb.apiKey || !cfg.prowlarr.url || !cfg.prowlarr.apiKey) return { checked: 0, grabbed: 0 };
  if (cfg.profile.legalIndexerIds.length === 0) return { checked: 0, grabbed: 0 };

  const shows = await prisma.followedShow.findMany({ where: { autoDownload: true } });
  const prowlarr = new ProwlarrClient(cfg.prowlarr);
  const now = Date.now();
  const availableCutoff = now - 1 * DAY; // available the day after airing
  let grabbed = 0;

  for (const show of shows) {
    try {
      const details = await getTvDetails(cfg.tmdb.apiKey, show.tmdbId);
      if (!details) continue;
      const windowStart = show.createdAt.getTime() - 2 * DAY;
      // Only track the latest RELEASED season — that's what "follow" downloads;
      // when a new season starts airing it automatically becomes the target.
      const today = new Date().toISOString().slice(0, 10);
      const releasedSeasons = details.seasons.filter(
        (s) => s.seasonNumber >= 1 && !!s.airDate && s.airDate <= today && s.episodeCount > 0,
      );
      const latestSeason = releasedSeasons.length
        ? Math.max(...releasedSeasons.map((s) => s.seasonNumber))
        : null;
      const seasons = latestSeason != null ? [latestSeason] : [];
      const owned = await ownedEpisodeKeys(show.tmdbId, show.title, show.userId);
      let grabbedThisShow = 0;

      for (const sn of seasons) {
        if (grabbedThisShow >= 12) break;
        const eps = await getSeasonEpisodes(cfg.tmdb.apiKey, show.tmdbId, sn);
        for (const ep of eps) {
          if (grabbedThisShow >= 12) break;
          if (!ep.airDate || ep.episodeNumber < 1) continue;
          const aired = new Date(`${ep.airDate}T00:00:00Z`).getTime();
          if (aired > availableCutoff) continue; // not yet available
          if (aired < windowStart) continue; // before we started following
          const key = `${ep.seasonNumber}x${ep.episodeNumber}`;
          if (owned.has(key)) continue;
          if (
            await grabEpisode({
              prowlarr,
              cfg,
              show,
              ep,
              indexerIds: cfg.profile.legalIndexerIds,
              notify: true,
              userId: show.userId,
            })
          ) {
            grabbed++;
            grabbedThisShow++;
            owned.add(key);
          }
        }
      }
      await prisma.followedShow.update({
        where: { id: show.id },
        data: { lastCheckedAt: new Date(), status: details.status ?? show.status },
      });
    } catch (e) {
      console.error("[follow] scan failed:", show.title, (e as Error).message);
    }
  }
  return { checked: shows.length, grabbed };
}
