import { prisma } from "../db";
import { getConfig } from "../config";
import { ProwlarrClient } from "../indexers/prowlarr";
import { grabEpisode, ownedEpisodeKeys } from "./downloads";
import { notifyUser } from "../telegram/client";
import { getTvDetails, getSeasonEpisodes, searchTitle } from "../metadata/tmdb";
import { enqueueSeasonGrab } from "../queue";
import { getWatchingSeries, jellyfinReady } from "../jellyfin/client";
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

export async function unfollowShow(id: string): Promise<void> {
  await prisma.followedShow.delete({ where: { id } }).catch(() => {});
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
