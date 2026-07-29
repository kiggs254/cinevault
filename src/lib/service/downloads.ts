import { prisma } from "../db";
import { getConfig, type ResolvedConfig } from "../config";
import { planQuery } from "../llm/search-planner";
import { ProwlarrClient, categoriesForKind } from "../indexers/prowlarr";
import { QbClient, parseInfoHash } from "../torrent/qbittorrent";
import {
  rankResults,
  pickAutoRelease,
  isSingleSeasonPack,
  isEpisodeMatch,
  releaseTitleMatches,
  parseRelease,
} from "../scoring/scorer";
import { getSeasonEpisodes, getTvDetails, getTitle, type TmdbEpisode } from "../metadata/tmdb";
import { makeS3, deleteObject } from "../storage/s3";
import { notify, notifyUser } from "../telegram/client";
import type { Download } from "@prisma/client";
import { enqueueDownload, enqueueEpisodeGrab } from "../queue";
import {
  failedSourcesFor,
  recordFailedSources,
  clearFailedSources,
  excludeFailed,
  normRelease,
} from "./failed-sources";
import { publishProgress } from "../events";
import { logActivity } from "../activity";
import { toDTO } from "../serialize";
import { cleanReleaseName } from "../util";
import type {
  DownloadDTO,
  MediaKind,
  PlannedQuery,
  RankDecision,
  ScoredResult,
  EpisodeGrabData,
} from "../types";

const GB = 1024 * 1024 * 1024;

/** Plan a natural-language query, search indexers, and score the results. */
export async function planAndSearch(
  nl: string,
): Promise<{ plan: PlannedQuery; ranked: ScoredResult[] }> {
  const cfg = await getConfig();
  const plan = await planQuery(nl, { defaultQuality: cfg.prefs.preferredQuality });

  const prowlarr = new ProwlarrClient(cfg.prowlarr);
  const results = await prowlarr.search(plan.searchTerms, {
    categories: categoriesForKind(plan.kind),
    limit: 60,
  });

  const ranked = rankResults(results, {
    preferredQuality: plan.quality,
    minSeeders: cfg.prefs.minSeeders,
    maxSizeGB: cfg.prefs.maxSizeGB,
    kind: plan.kind,
  });
  return { plan, ranked };
}

/**
 * Pick the release to auto-download: 720p, then the smallest well-seeded file.
 * Shared by the agent, the direct/season download buttons, and auto-grab.
 */
export async function chooseBest(
  _plan: PlannedQuery,
  ranked: ScoredResult[],
): Promise<{ chosen: ScoredResult | null; decision: RankDecision }> {
  if (ranked.length === 0) {
    return { chosen: null, decision: { chosenIndex: -1, reason: "No results found", flaggedIndexes: [] } };
  }
  const cfg = await getConfig();
  const chosen = pickAutoRelease(ranked, { minSeeders: cfg.prefs.minSeeders });
  if (!chosen) {
    return {
      chosen: null,
      decision: { chosenIndex: -1, reason: "No acceptable release (needs seeders, non-CAM)", flaggedIndexes: [] },
    };
  }
  return { chosen, decision: { chosenIndex: 0, reason: "720p, smallest well-seeded release", flaggedIndexes: [] } };
}

export interface CreateDownloadInput {
  releaseName: string;
  source: string; // magnet URI or .torrent URL
  infoHash?: string | null;
  indexer?: string | null;
  size?: number;
  seeders?: number | null;
  kind?: MediaKind;
  title?: string | null;
  year?: number | null;
  season?: number | null;
  episode?: number | null;
  tmdbId?: number | null;
  query?: string | null;
  posterUrl?: string | null;
  overview?: string | null;
  userId?: string | null; // owning member
}

// Cache TMDB poster/overview by title so per-episode grabs don't each re-fetch.
const metaCache = new Map<string, { posterUrl: string | null; overview: string | null; at: number }>();
async function cachedTitleMeta(
  apiKey: string,
  kind: MediaKind,
  tmdbId: number,
): Promise<{ posterUrl: string | null; overview: string | null }> {
  const type = kind === "TV" ? "tv" : "movie";
  const key = `${type}:${tmdbId}`;
  const hit = metaCache.get(key);
  if (hit && Date.now() - hit.at < 6 * 60 * 60 * 1000) {
    return { posterUrl: hit.posterUrl, overview: hit.overview };
  }
  let posterUrl: string | null = null;
  let overview: string | null = null;
  try {
    const t = await getTitle(apiKey, type, tmdbId);
    posterUrl = t?.posterUrl ?? null;
    overview = t?.overview ?? null;
  } catch {
    /* metadata is best-effort */
  }
  metaCache.set(key, { posterUrl, overview, at: Date.now() });
  return { posterUrl, overview };
}

/** Persist a download and enqueue it for the worker. */
export async function createDownload(input: CreateDownloadInput): Promise<DownloadDTO> {
  if (!input.source) {
    throw new Error("Missing torrent source (magnet or .torrent URL)");
  }
  const title = (input.title && input.title.trim()) || cleanReleaseName(input.releaseName);

  // Keep exactly one row per TV episode. Repeated/concurrent grabs, follow-scans
  // and re-runs must not pile up duplicates — the previous guard only blocked a
  // second row when a live one existed, so a FAILED episode accumulated a new row
  // on every re-grab. Now: reuse the live row if any, else revive the newest
  // failed attempt in place, and drop the leftover failed duplicates.
  if (input.kind === "TV" && input.season != null && input.episode != null) {
    const rows = await prisma.download.findMany({
      where: {
        // Scope the "one row per episode" dedup to this member so each member
        // keeps their own library row (files are still shared — see the
        // completed-twin clone in the grab entry points).
        ...(input.userId ? { userId: input.userId } : {}),
        season: input.season,
        episode: input.episode,
        OR: [
          ...(input.tmdbId ? [{ tmdbId: input.tmdbId }] : []),
          { title: { equals: title, mode: "insensitive" as const } },
        ],
      },
      orderBy: { createdAt: "desc" },
    });
    if (rows.length) {
      const alive = rows.find((r) => r.status !== "FAILED" && r.status !== "CANCELLED");
      const keepId = alive?.id ?? rows[0].id;
      const stale = rows.filter((r) => r.id !== keepId).map((r) => r.id);
      if (stale.length) await prisma.download.deleteMany({ where: { id: { in: stale } } });

      if (alive) {
        if (stale.length) await publishProgress({ type: "deleted", downloadId: stale[0] });
        return toDTO(alive);
      }
      // Only failed attempts exist. Revive with this source UNLESS we've already
      // tried it and it failed — never re-download the same link. Guard on both
      // infohash and (normalized) release name, since infohash can be absent.
      const keptRow = rows.find((r) => r.id === keepId);
      const newHash = (
        input.infoHash ??
        (input.source.startsWith("magnet:") ? parseInfoHash(input.source) : undefined)
      )?.toLowerCase();
      const newName = normRelease(input.releaseName);
      // "Tried" = the episode's failed history PLUS whatever release is on the row
      // right now (it failed too), so even the very first re-grab can't re-pick it.
      const prevHashes = [
        ...triedHashesFromMeta(keptRow?.metadata),
        ...(keptRow?.infoHash ? [keptRow.infoHash.toLowerCase()] : []),
      ];
      const prevNames = [
        ...triedReleasesFromMeta(keptRow?.metadata),
        ...(keptRow?.releaseName ? [normRelease(keptRow.releaseName)] : []),
      ];
      if ((newHash && prevHashes.includes(newHash)) || prevNames.includes(newName)) {
        return toDTO(keptRow ?? rows[0]); // already tried this exact release — leave for a fresh retry
      }
      const revived = await prisma.download.update({
        where: { id: keepId },
        data: {
          status: "QUEUED",
          error: null,
          progress: 0,
          qbitHash: null,
          releaseName: input.releaseName,
          magnet: input.source,
          infoHash: newHash ?? null,
          indexer: input.indexer ?? null,
          seeders: input.seeders ?? null,
          sizeBytes: BigInt(Math.max(0, Math.round(input.size ?? 0))),
          metadata: {
            triedInfoHashes: [...new Set([...prevHashes, ...(newHash ? [newHash] : [])])],
            triedReleases: [...new Set([...prevNames, newName])],
            resourceAttempts: 0,
          },
        },
      });
      await enqueueDownload(revived.id);
      await publishProgress({ type: "created", downloadId: revived.id, status: "QUEUED" });
      return toDTO(revived);
    }
  }

  // Grab poster + overview up front (cached) so they appear while downloading,
  // not only after the upload completes.
  let posterUrl = input.posterUrl ?? null;
  let overview = input.overview ?? null;
  if (!posterUrl && input.tmdbId && (input.kind === "TV" || input.kind === "MOVIE")) {
    const cfg = await getConfig();
    if (cfg.tmdb.apiKey) {
      const m = await cachedTitleMeta(cfg.tmdb.apiKey, input.kind, input.tmdbId);
      posterUrl = m.posterUrl;
      overview = m.overview;
    }
  }

  const infoHash =
    input.infoHash ??
    (input.source.startsWith("magnet:") ? parseInfoHash(input.source) : undefined);

  const dl = await prisma.download.create({
    data: {
      title,
      releaseName: input.releaseName,
      kind: input.kind ?? "OTHER",
      year: input.year ?? null,
      season: input.season ?? null,
      episode: input.episode ?? null,
      tmdbId: input.tmdbId ?? null,
      userId: input.userId ?? null,
      posterUrl,
      overview,
      query: input.query ?? null,
      indexer: input.indexer ?? null,
      infoHash: infoHash ?? null,
      magnet: input.source,
      status: "QUEUED",
      sizeBytes: BigInt(Math.max(0, Math.round(input.size ?? 0))),
      seeders: input.seeders ?? null,
    },
  });
  await enqueueDownload(dl.id);
  await publishProgress({ type: "created", downloadId: dl.id, status: "QUEUED" });
  return toDTO(dl);
}

function resultToInput(
  plan: PlannedQuery,
  chosen: ScoredResult,
  nl?: string,
  userId?: string | null,
): CreateDownloadInput {
  return {
    releaseName: chosen.title,
    source: chosen.magnetUrl ?? chosen.downloadUrl ?? "",
    infoHash: chosen.infoHash,
    indexer: chosen.indexer,
    size: chosen.size,
    seeders: chosen.seeders,
    kind: plan.kind,
    title: plan.title,
    year: plan.year ?? null,
    season: plan.season ?? null,
    episode: plan.episode ?? null,
    query: nl ?? null,
    userId: userId ?? null,
  };
}

/** One-shot: plan -> search -> choose best -> queue. Used by agent + auto mode. */
export async function startFromQuery(
  nl: string,
  userId?: string | null,
): Promise<{
  plan: PlannedQuery;
  ranked: ScoredResult[];
  decision: RankDecision;
  download?: DownloadDTO;
}> {
  const { plan, ranked } = await planAndSearch(nl);
  const { chosen, decision } = await chooseBest(plan, ranked);
  if (!chosen) return { plan, ranked, decision };
  const input = resultToInput(plan, chosen, nl, userId);
  if (!input.source) return { plan, ranked, decision };
  const download = await createDownload(input);
  return { plan, ranked, decision, download };
}

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Direct-download a movie by TMDB title (720p / smallest well-seeded). */
export async function grabMovie(opts: {
  tmdbId: number;
  title: string;
  year?: number | null;
  /** For subscriptions: only grab a real (non-cam, ≥720p) release — wait, don't grab a cam. */
  requireNonCam?: boolean;
  userId?: string | null;
}): Promise<DownloadDTO | null> {
  // Someone already has this movie? Give the requester a library entry pointing
  // at the same file instead of downloading it again.
  const twin = await cloneCompletedTwin(opts.userId, { tmdbId: opts.tmdbId, kind: "MOVIE" });
  if (twin) return twin;

  const cfg = await getConfig();
  const prowlarr = new ProwlarrClient(cfg.prowlarr);
  const q = `${opts.title}${opts.year ? ` ${opts.year}` : ""}`;
  void logActivity(`Searching sources for “${opts.title}”…`, { kind: "search", title: opts.title });
  const results = await prowlarr.search(q, { categories: categoriesForKind("MOVIE"), limit: 60 });
  const failed = await failedSourcesFor(opts.tmdbId, null, null);
  let pool = excludeFailed(results, failed);
  if (opts.requireNonCam) {
    pool = pool.filter((r) => {
      const p = parseRelease(r.title);
      return !p.isCam && !!p.resolution && p.resolution !== "480p";
    });
  }
  const chosen = pickAutoRelease(pool, {
    minSeeders: cfg.prefs.minSeeders,
    floorGB: 0.2,
  });
  if (!chosen) {
    void logActivity(`No good source found for “${opts.title}”.`, { kind: "warn", title: opts.title });
    return null;
  }
  void logActivity(`Queued “${opts.title}” — ${chosen.seeders ?? 0} seeders`, { kind: "queue", title: opts.title });
  return createDownload({
    releaseName: chosen.title,
    source: chosen.magnetUrl ?? chosen.downloadUrl ?? "",
    infoHash: chosen.infoHash,
    indexer: chosen.indexer,
    size: chosen.size,
    seeders: chosen.seeders,
    kind: "MOVIE",
    title: opts.title,
    year: opts.year ?? null,
    tmdbId: opts.tmdbId,
    userId: opts.userId ?? null,
    query: q,
  });
}

/** Grab one specific episode by TMDB id (720p, smallest well-seeded, validated). */
export async function grabSingleEpisode(opts: {
  tmdbId: number;
  title: string;
  season: number;
  episode: number;
  year?: number | null;
  userId?: string | null;
}): Promise<boolean> {
  if (opts.season < 1 || opts.episode < 1) return false;
  const cfg = await getConfig();
  if (!cfg.prowlarr.url || !cfg.prowlarr.apiKey) return false;
  const prowlarr = new ProwlarrClient(cfg.prowlarr);
  return grabEpisode({
    prowlarr,
    cfg,
    show: { title: opts.title, year: opts.year ?? null, tmdbId: opts.tmdbId },
    ep: { seasonNumber: opts.season, episodeNumber: opts.episode },
    notify: false,
    userId: opts.userId ?? null,
  });
}

const DAY = 24 * 60 * 60 * 1000;
const YEAR = 365 * DAY;

export interface SeasonGrabResult {
  season: number;
  mode: "pack" | "episodes";
  queued: number; // Download rows created
  failed: number; // episodes (or the pack) with no acceptable source
  total: number; // aired episodes considered (episodes) or 1 (pack)
  reason?: string;
}

const airedTs = (e: Pick<TmdbEpisode, "airDate">): number =>
  e.airDate ? new Date(`${e.airDate}T00:00:00Z`).getTime() : NaN;

/**
 * Personal libraries over one shared file store: if another member already has a
 * COMPLETED copy of this exact title (movie, or TV season/episode), give the
 * requester their own COMPLETED library row pointing at the same S3 object rather
 * than downloading it again. Returns the (existing or cloned) row, or null if
 * nothing to clone. Also returns the requester's own row if they already have one.
 */
async function cloneCompletedTwin(
  userId: string | null | undefined,
  sel: { tmdbId?: number | null; kind: MediaKind; season?: number | null; episode?: number | null },
): Promise<DownloadDTO | null> {
  if (!userId || !sel.tmdbId) return null;
  const season = sel.season ?? null;
  const episode = sel.episode ?? null;
  const mine = await prisma.download.findFirst({
    where: {
      userId,
      tmdbId: sel.tmdbId,
      season,
      episode,
      status: { notIn: ["FAILED", "CANCELLED"] },
    },
    orderBy: { createdAt: "desc" },
  });
  if (mine) return toDTO(mine);
  const twin = await prisma.download.findFirst({
    where: {
      status: "COMPLETED",
      tmdbId: sel.tmdbId,
      season,
      episode,
      s3Key: { not: null },
      NOT: { userId },
    },
    orderBy: { completedAt: "desc" },
  });
  if (!twin) return null;
  const clone = await cloneAsOwned(twin, userId);
  return toDTO(clone);
}

/** Clone a COMPLETED download into a member's library (same shared S3 object). */
async function cloneAsOwned(row: Download, userId: string): Promise<Download> {
  const clone = await prisma.download.create({
    data: {
      title: row.title,
      releaseName: row.releaseName,
      kind: row.kind,
      year: row.year,
      season: row.season,
      episode: row.episode,
      tmdbId: row.tmdbId,
      userId,
      posterUrl: row.posterUrl,
      overview: row.overview,
      magnet: row.magnet,
      status: "COMPLETED",
      progress: 100,
      sizeBytes: row.sizeBytes,
      downloadedBytes: row.sizeBytes,
      s3Bucket: row.s3Bucket,
      s3Key: row.s3Key,
      s3Prefix: row.s3Prefix,
      metadata: row.metadata ?? undefined,
      completedAt: new Date(),
    },
  });
  await publishProgress({ type: "created", downloadId: clone.id, status: "COMPLETED" });
  return clone;
}

/**
 * Adopt any COMPLETED copy of a season that's already in storage (another
 * member's rows) into this member's library — so re-adding a show that's already
 * downloaded is instant and never re-downloads. Clones the pack row and/or the
 * episode rows the requester doesn't already have.
 */
async function adoptSeasonFromStorage(
  userId: string | null | undefined,
  tmdbId: number,
  season: number,
): Promise<void> {
  if (!userId) return;
  const stored = await prisma.download.findMany({
    where: { status: "COMPLETED", tmdbId, season, s3Key: { not: null }, NOT: { userId } },
    orderBy: { completedAt: "desc" },
  });
  if (stored.length === 0) return;
  const mine = await prisma.download.findMany({
    where: { userId, tmdbId, season, status: { notIn: ["FAILED", "CANCELLED"] } },
    select: { episode: true },
  });
  const have = new Set<number | null>(mine.map((m) => m.episode));
  const seen = new Set<number | null>();
  for (const row of stored) {
    const key = row.episode; // null = whole-season pack
    if (seen.has(key)) continue; // newest copy of this episode/pack already handled
    seen.add(key);
    if (have.has(key)) continue; // requester already has it
    await cloneAsOwned(row, userId);
  }
}

/** Episodes already in the library for a show (by TMDB id or title), season+episode set. */
export async function ownedEpisodeKeys(
  tmdbId: number,
  title: string,
  userId?: string | null,
): Promise<Set<string>> {
  const rows = await prisma.download.findMany({
    where: {
      ...(userId ? { userId } : {}),
      OR: [{ tmdbId }, { title: { contains: title, mode: "insensitive" } }],
      season: { not: null },
      episode: { not: null },
      status: { notIn: ["FAILED", "CANCELLED"] },
    },
    select: { season: true, episode: true },
  });
  return new Set(rows.map((r) => `${r.season}x${r.episode}`));
}

/**
 * Search for and queue a single episode (720p, smallest well-seeded). Shared by
 * the manual season grab and the follow scanner so both behave identically.
 * `indexerIds` undefined = all indexers; `notify` false = no per-episode push.
 */
export async function grabEpisode(o: {
  prowlarr: ProwlarrClient;
  cfg: ResolvedConfig;
  show: { title: string; year?: number | null; tmdbId: number };
  ep: Pick<TmdbEpisode, "seasonNumber" | "episodeNumber" | "name">;
  indexerIds?: number[];
  notify?: boolean;
  userId?: string | null;
}): Promise<boolean> {
  const { prowlarr, cfg, show, ep } = o;
  // Another member already has this episode? Clone it into the requester's
  // library instead of re-downloading.
  const twin = await cloneCompletedTwin(o.userId, {
    tmdbId: show.tmdbId,
    kind: "TV",
    season: ep.seasonNumber,
    episode: ep.episodeNumber,
  });
  if (twin) return true;
  const q = `${show.title} S${pad2(ep.seasonNumber)}E${pad2(ep.episodeNumber)}`;
  const label = `${show.title} S${pad2(ep.seasonNumber)}E${pad2(ep.episodeNumber)}`;
  void logActivity(`Searching sources — ${label}`, { kind: "search", title: show.title });
  // Wide limit: indexers fuzzy-return a flood of the show's other episodes, so the
  // specific one we want can be buried — a small cap silently skips it.
  const results = await prowlarr.search(q, {
    categories: categoriesForKind("TV"),
    limit: 100,
    indexerIds: o.indexerIds,
  });
  // Indexers fuzzy-match: a search for "Lucky S01E01" can return the latest
  // S09E05, or a different show ("Lucky Hank S01E01"). Require BOTH the exact
  // episode AND the show title to match.
  const matched = results.filter(
    (r) =>
      isEpisodeMatch(r.title, ep.seasonNumber, ep.episodeNumber) &&
      releaseTitleMatches(r.title, show.title),
  );
  const failed = await failedSourcesFor(show.tmdbId, ep.seasonNumber, ep.episodeNumber);
  const usable = excludeFailed(matched, failed);
  const best = pickAutoRelease(usable, { minSeeders: cfg.prefs.minSeeders, floorGB: 0.05 });
  if (!best) {
    // Funnel so "No source yet" is diagnosable: which stage dropped everything.
    console.log(
      `[grab] no-source ${label}: prowlarr=${results.length} matched=${matched.length} ` +
        `usable=${usable.length} minSeeders=${cfg.prefs.minSeeders}` +
        (results.length && !matched.length
          ? ` | samples: ${results.slice(0, 3).map((r) => r.title).join("  ·  ")}`
          : ""),
    );
    void logActivity(`No source yet — ${label}`, { kind: "warn", title: show.title });
    return false;
  }
  await createDownload({
    releaseName: best.title,
    source: best.magnetUrl ?? best.downloadUrl ?? "",
    infoHash: best.infoHash,
    indexer: best.indexer,
    size: best.size,
    seeders: best.seeders,
    kind: "TV",
    title: show.title,
    year: show.year ?? null,
    season: ep.seasonNumber,
    episode: ep.episodeNumber,
    tmdbId: show.tmdbId,
    userId: o.userId ?? null,
    query: q,
  });
  void logActivity(`Queued ${label}`, { kind: "queue", title: show.title });
  if (o.notify !== false) {
    let photo: string | undefined;
    try {
      if (cfg.tmdb.apiKey) {
        photo = (await cachedTitleMeta(cfg.tmdb.apiKey, "TV", show.tmdbId)).posterUrl ?? undefined;
      }
    } catch {
      /* poster optional */
    }
    const text = `📥 Adding to your library\n${show.title} — S${pad2(ep.seasonNumber)}E${pad2(ep.episodeNumber)}${ep.name ? ` · ${ep.name}` : ""}`;
    const buttons = [{ text: "📚 Open your library", path: "/library" }];
    if (o.userId) await notifyUser(o.userId, text, { photo, buttons });
    else await notify(text, { photo, buttons });
  }
  return true;
}

/** Find a validated pack for EXACTLY this season (720p, smallest well-seeded). */
async function findSeasonPack(
  prowlarr: ProwlarrClient,
  cfg: ResolvedConfig,
  title: string,
  season: number,
): Promise<ScoredResult | null> {
  const cats = categoriesForKind("TV");
  for (const q of [`${title} Season ${season}`, `${title} S${pad2(season)}`]) {
    const results = await prowlarr.search(q, { categories: cats, limit: 60 });
    const packs = results.filter(
      (r) => isSingleSeasonPack(r.title, season) && releaseTitleMatches(r.title, title),
    );
    const chosen = pickAutoRelease(packs, { minSeeders: cfg.prefs.minSeeders, floorGB: 0.3 });
    if (chosen) return chosen;
  }
  return null;
}

/**
 * Grab a whole season. If the season's last episode aired more than a year ago,
 * try a validated single-season pack; otherwise (recent, or no pack found)
 * download every aired episode individually into one `TV/<Show>/Season NN`
 * folder. Not-yet-aired episodes are left for the follow scanner to backfill.
 */
export async function grabSeason(opts: {
  tmdbId: number;
  title: string;
  season: number;
  year?: number | null;
  indexerIds?: number[];
  notify?: boolean;
  userId?: string | null;
}): Promise<SeasonGrabResult> {
  const base: SeasonGrabResult = {
    season: opts.season,
    mode: "episodes",
    queued: 0,
    failed: 0,
    total: 0,
  };
  if (opts.season <= 0) return { ...base, reason: "invalid season" };

  const cfg = await getConfig();
  if (!cfg.tmdb.apiKey) return { ...base, reason: "TMDB not configured" };
  const prowlarr = new ProwlarrClient(cfg.prowlarr);
  const now = Date.now();
  const availableCutoff = now - DAY; // available the day after airing

  const eps = await getSeasonEpisodes(cfg.tmdb.apiKey, opts.tmdbId, opts.season);
  let available = eps.filter(
    (e) => e.episodeNumber >= 1 && !Number.isNaN(airedTs(e)) && airedTs(e) <= availableCutoff,
  );

  // Fallback: TMDB has no per-episode air dates but the season itself is old.
  let seasonAired: number | undefined;
  if (available.length === 0) {
    const details = await getTvDetails(cfg.tmdb.apiKey, opts.tmdbId);
    const s = details?.seasons.find((x) => x.seasonNumber === opts.season);
    seasonAired = s?.airDate ? new Date(`${s.airDate}T00:00:00Z`).getTime() : undefined;
    const noEpDates = eps.length > 0 && eps.every((e) => !e.airDate);
    if (noEpDates && seasonAired && now - seasonAired > YEAR) {
      available = eps.filter((e) => e.episodeNumber >= 1);
    }
  }
  if (available.length === 0) return { ...base, reason: "no aired episodes" };

  // If this season is already in storage (downloaded by any member), adopt those
  // rows into this member's library — instant, no re-download.
  await adoptSeasonFromStorage(opts.userId, opts.tmdbId, opts.season);

  // Already have a whole-season pack? It covers every episode — don't re-search a
  // pack or grab episodes individually (guards "Grab missing" from re-downloading).
  const existingPack = await prisma.download.findFirst({
    where: {
      ...(opts.userId ? { userId: opts.userId } : {}),
      tmdbId: opts.tmdbId,
      season: opts.season,
      episode: null,
      status: { notIn: ["FAILED", "CANCELLED"] },
    },
    select: { id: true },
  });
  if (existingPack) {
    return { season: opts.season, mode: "pack", queued: 0, failed: 0, total: available.length, reason: "season pack already present" };
  }

  const lastAired = Math.max(
    ...available.map(airedTs).filter((t) => !Number.isNaN(t)),
    seasonAired ?? -Infinity,
  );
  const olderThanYear = Number.isFinite(lastAired) && now - lastAired > YEAR;

  // Old, complete season → prefer a validated single-season pack.
  if (olderThanYear) {
    const pack = await findSeasonPack(prowlarr, cfg, opts.title, opts.season);
    if (pack) {
      await createDownload({
        releaseName: pack.title,
        source: pack.magnetUrl ?? pack.downloadUrl ?? "",
        infoHash: pack.infoHash,
        indexer: pack.indexer,
        size: pack.size,
        seeders: pack.seeders,
        kind: "TV",
        title: opts.title,
        year: opts.year ?? null,
        season: opts.season,
        tmdbId: opts.tmdbId,
        userId: opts.userId ?? null,
        query: `${opts.title} Season ${opts.season}`,
      });
      return { season: opts.season, mode: "pack", queued: 1, failed: 0, total: 1 };
    }
  }

  // Recent/ongoing season → follow the show (backdated to the season start) so the
  // scanner backfills any episode we can't find right now and grabs new ones as
  // they air. Idempotent; an existing follow is left untouched.
  if (!olderThanYear) {
    const airedTimes = available.map(airedTs).filter((t) => Number.isFinite(t));
    const firstAired = airedTimes.length ? Math.min(...airedTimes) : (seasonAired ?? now);
    const existingFollow = await prisma.followedShow.findFirst({
      where: { ...(opts.userId ? { userId: opts.userId } : {}), tmdbId: opts.tmdbId },
      select: { id: true },
    });
    if (!existingFollow) {
      await prisma.followedShow
        .create({
          data: {
            tmdbId: opts.tmdbId,
            title: opts.title,
            year: opts.year ?? null,
            autoDownload: true,
            source: "season-grab",
            userId: opts.userId ?? null,
            createdAt: new Date(firstAired - 2 * DAY),
          },
        })
        .catch(() => {});
    }
  }

  // Episode-by-episode: enqueue a short grab job per aired, not-yet-owned episode.
  // Fanning out (instead of searching them all in this one long job) keeps the grab
  // worker cycling fast, so new requests are never stuck behind one season's walk.
  const owned = await ownedEpisodeKeys(opts.tmdbId, opts.title, opts.userId);
  let queued = 0;
  for (const ep of available) {
    if (owned.has(`${ep.seasonNumber}x${ep.episodeNumber}`)) continue;
    await enqueueEpisodeGrab({
      tmdbId: opts.tmdbId,
      title: opts.title,
      year: opts.year ?? null,
      season: ep.seasonNumber,
      episode: ep.episodeNumber,
      name: ep.name ?? null,
      indexerIds: opts.indexerIds,
      notify: opts.notify,
      userId: opts.userId ?? null,
    });
    queued++;
    owned.add(`${ep.seasonNumber}x${ep.episodeNumber}`);
  }
  return {
    season: opts.season,
    mode: "episodes",
    queued,
    failed: 0,
    total: available.length,
    reason: olderThanYear ? "pack not found → episodes" : undefined,
  };
}

/** Worker entry for an `episode-grab` job — resolve config, then search + queue one episode. */
export async function runEpisodeGrab(data: EpisodeGrabData): Promise<boolean> {
  if (data.season < 1 || data.episode < 1) return false;
  const cfg = await getConfig();
  if (!cfg.prowlarr.url || !cfg.prowlarr.apiKey) return false;
  const prowlarr = new ProwlarrClient(cfg.prowlarr);
  return grabEpisode({
    prowlarr,
    cfg,
    show: { title: data.title, year: data.year, tmdbId: data.tmdbId },
    ep: { seasonNumber: data.season, episodeNumber: data.episode, name: data.name ?? undefined },
    indexerIds: data.indexerIds,
    notify: data.notify,
    userId: data.userId ?? null,
  });
}

/** List downloads. Pass a userId to scope to one member; omit for all (admin). */
export async function listDownloads(opts?: { userId?: string | null }): Promise<DownloadDTO[]> {
  const rows = await prisma.download.findMany({
    where: opts?.userId ? { userId: opts.userId } : undefined,
    orderBy: { createdAt: "desc" },
  });
  return rows.map(toDTO);
}

export async function getDownload(id: string): Promise<DownloadDTO | null> {
  const row = await prisma.download.findUnique({ where: { id } });
  return row ? toDTO(row) : null;
}

export async function retryDownload(id: string): Promise<DownloadDTO | null> {
  const row = await prisma.download.findUnique({ where: { id } });
  if (!row) return null;
  const updated = await prisma.download.update({
    where: { id },
    data: { status: "QUEUED", error: null, progress: 0 },
  });
  await enqueueDownload(id);
  await publishProgress({ type: "status", downloadId: id, status: "QUEUED" });
  return toDTO(updated);
}

/** Delete this download's own archived object(s) from S3 (best-effort). */
async function deleteDownloadObjects(row: Download, cfg: ResolvedConfig): Promise<void> {
  const bucket = row.s3Bucket ?? cfg.s3.bucket;
  if (!bucket || !cfg.s3.endpoint || !cfg.s3.accessKeyId) return;
  // Shared files, personal libraries: if another member's (non-deleted) row points
  // at the same file, keep the object — just drop this member's row.
  if (row.s3Key) {
    const shared = await prisma.download.count({
      where: { id: { not: row.id }, s3DeletedAt: null, s3Key: row.s3Key },
    });
    if (shared > 0) return;
  }
  // Prefer the exact keys uploaded for this download (a pack has several); fall
  // back to the single primary key. Never delete by shared folder prefix — that
  // would take sibling episodes with it.
  const meta =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  const stored = Array.isArray(meta.s3Keys)
    ? meta.s3Keys.filter((k): k is string => typeof k === "string")
    : [];
  const targets = stored.length ? stored : row.s3Key ? [row.s3Key] : [];
  if (targets.length === 0) return;
  const s3 = makeS3(cfg.s3);
  for (const key of targets) {
    await deleteObject(s3, bucket, key).catch(() => {});
  }
}

export async function removeDownload(id: string): Promise<void> {
  const row = await prisma.download.findUnique({ where: { id } });
  if (!row) return;
  const cfg = await getConfig();
  // Removing a download that never finished → remember its source(s) as bad so a
  // fresh re-grab won't pick the same dead release again.
  if (row.status !== "COMPLETED") {
    await recordFailedSources(row.tmdbId, row.season, row.episode, failureEntries(row));
  }
  if (row.qbitHash) {
    try {
      const qb = new QbClient(cfg.qbit);
      await qb.delete([row.qbitHash], true);
    } catch {
      /* ignore qBittorrent errors during delete */
    }
  }
  await deleteDownloadObjects(row, cfg).catch(() => {});
  await prisma.download.delete({ where: { id } });
  await publishProgress({ type: "deleted", downloadId: id });
}

function metaRecord(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}
function triedHashesFromMeta(metadata: unknown): string[] {
  const v = metaRecord(metadata).triedInfoHashes;
  return Array.isArray(v) ? (v as unknown[]).filter((h): h is string => typeof h === "string") : [];
}
/** Release names already tried (and failed) for a download, normalized. */
function triedReleasesFromMeta(metadata: unknown): string[] {
  const v = metaRecord(metadata).triedReleases;
  return Array.isArray(v) ? (v as unknown[]).filter((h): h is string => typeof h === "string") : [];
}
/** Every source a download attempted (its current release + prior tried history). */
function failureEntries(row: Download): { releaseName?: string | null; infoHash?: string | null }[] {
  return [
    { releaseName: row.releaseName, infoHash: row.infoHash },
    ...triedReleasesFromMeta(row.metadata).map((n) => ({ releaseName: n })),
    ...triedHashesFromMeta(row.metadata).map((h) => ({ infoHash: h })),
  ];
}
/** Persist a failed download's source(s) so future grabs skip them (survives row deletion). */
export async function recordDownloadFailure(id: string): Promise<void> {
  const row = await prisma.download.findUnique({ where: { id } });
  if (!row) return;
  await recordFailedSources(row.tmdbId, row.season, row.episode, failureEntries(row));
}

/**
 * Manually swap a download to a fresh source right now (e.g. it's crawling). Marks
 * the current release bad, then queues the best untried alternative on the same row.
 */
export async function resourceDownload(id: string): Promise<{ ok: boolean; message: string }> {
  const dl = await prisma.download.findUnique({ where: { id } });
  if (!dl) return { ok: false, message: "Not found" };
  if (dl.status === "COMPLETED") return { ok: false, message: "Already downloaded" };
  const cfg = await getConfig();
  if (!cfg.prowlarr.url || !cfg.prowlarr.apiKey) return { ok: false, message: "Prowlarr not configured" };

  // The current source is the problem — remember it as bad and exclude it + history.
  await recordFailedSources(dl.tmdbId, dl.season, dl.episode, failureEntries(dl));
  const failed = await failedSourcesFor(dl.tmdbId, dl.season, dl.episode);
  const triedH = new Set<string>([
    ...[...triedHashesFromMeta(dl.metadata), dl.infoHash].filter((h): h is string => !!h).map((h) => h.toLowerCase()),
    ...failed.hashes,
  ]);
  const triedN = new Set<string>([
    ...[...triedReleasesFromMeta(dl.metadata), dl.releaseName].filter((n): n is string => !!n).map(normRelease),
    ...failed.names,
  ]);

  const isEp = dl.kind === "TV" && dl.season != null && dl.episode != null;
  const q =
    dl.query ||
    (isEp
      ? `${dl.title} S${pad2(dl.season!)}E${pad2(dl.episode!)}`
      : `${dl.title}${dl.year ? ` ${dl.year}` : ""}`);
  const prowlarr = new ProwlarrClient(cfg.prowlarr);
  const results = await prowlarr.search(q, { categories: categoriesForKind(dl.kind as MediaKind), limit: 100 });
  const matched = isEp
    ? results.filter((r) => isEpisodeMatch(r.title, dl.season!, dl.episode!) && releaseTitleMatches(r.title, dl.title))
    : results;
  const fresh = matched.filter(
    (r) => !triedH.has((r.infoHash ?? "").toLowerCase()) && !triedN.has(normRelease(r.title)),
  );
  const floorGB = isEp ? 0.05 : dl.season != null ? 0.3 : 0.2;
  const best = pickAutoRelease(fresh, { minSeeders: cfg.prefs.minSeeders, floorGB });
  if (!best) return { ok: false, message: "No other source available right now" };

  if (dl.qbitHash && cfg.qbit.url) {
    await new QbClient(cfg.qbit).delete([dl.qbitHash], true).catch(() => {});
  }
  const source = best.magnetUrl ?? best.downloadUrl ?? "";
  const newHash = (
    best.infoHash ?? (source.startsWith("magnet:") ? parseInfoHash(source) : undefined)
  )?.toLowerCase();
  await prisma.download.update({
    where: { id },
    data: {
      status: "QUEUED",
      progress: 0,
      error: null,
      qbitHash: null,
      releaseName: best.title,
      magnet: source,
      infoHash: newHash ?? null,
      indexer: best.indexer ?? null,
      seeders: best.seeders ?? null,
      sizeBytes: BigInt(Math.max(0, Math.round(best.size ?? 0))),
      metadata: {
        triedInfoHashes: [...triedH, ...(newHash ? [newHash] : [])],
        triedReleases: [...triedN, normRelease(best.title)],
        resourceAttempts: 0,
      },
    },
  });
  await enqueueDownload(id);
  await publishProgress({ type: "status", downloadId: id, status: "QUEUED" });
  void logActivity(
    `Switched source — ${dl.title}${isEp ? ` S${pad2(dl.season!)}E${pad2(dl.episode!)}` : ""} → ${best.seeders ?? 0} seeders`,
    { kind: "switch", title: dl.title },
  );
  return { ok: true, message: `Switched to a fresh source (${best.seeders ?? 0} seeders)` };
}

const RETRY_STUCK_MS = 20 * 60 * 1000; // a download barely-started this long is stuck
const RETRY_RESET_MS = 3 * 60 * 60 * 1000; // after this, re-try even already-tried sources

/**
 * Re-search episodes that need a fresh source — both FAILED ones and downloads
 * that have sat at ~0% for 20 min (dead magnet / no metadata). Skips every release
 * already tried and lets the scorer prefer more seeders / higher quality (so a dead
 * 720p is replaced by a well-seeded 1080p when one exists). Reuses the row via
 * createDownload's dedup, so it never creates duplicates. Periodic job.
 */
export async function retryFailed(): Promise<{ retried: number }> {
  const cfg = await getConfig();
  if (!cfg.prowlarr.url || !cfg.prowlarr.apiKey || !cfg.tmdb.apiKey) return { retried: 0 };
  const stuckCutoff = new Date(Date.now() - RETRY_STUCK_MS);
  const candidates = await prisma.download.findMany({
    where: {
      kind: "TV",
      season: { not: null },
      episode: { not: null },
      OR: [
        { status: "FAILED" },
        // Downloading but stuck at ~0% with a stale heartbeat (poll loop gone / dead source).
        { status: "DOWNLOADING", progress: { lt: 1 }, updatedAt: { lt: stuckCutoff } },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: 20,
  });
  if (candidates.length === 0) return { retried: 0 };

  const prowlarr = new ProwlarrClient(cfg.prowlarr);
  const qb = cfg.qbit.url ? new QbClient(cfg.qbit) : null;
  const seen = new Set<string>();
  let retried = 0;

  for (const dl of candidates) {
    if (dl.season == null || dl.episode == null) continue;
    const epKey = `${dl.tmdbId ?? dl.title.toLowerCase()}|${dl.season}x${dl.episode}`;
    if (seen.has(epKey)) continue;
    // Skip if a live/completed copy already covers this episode.
    const covered = await prisma.download.findFirst({
      where: {
        id: { not: dl.id },
        season: dl.season,
        episode: dl.episode,
        status: { notIn: ["FAILED", "CANCELLED"] },
        OR: [
          ...(dl.tmdbId ? [{ tmdbId: dl.tmdbId }] : []),
          { title: { equals: dl.title, mode: "insensitive" as const } },
        ],
      },
    });
    if (covered) {
      seen.add(epKey);
      continue;
    }
    seen.add(epKey);

    const failedStore = await failedSourcesFor(dl.tmdbId, dl.season, dl.episode);
    const triedHashes = new Set([
      ...[...triedHashesFromMeta(dl.metadata), dl.infoHash]
        .filter((h): h is string => !!h)
        .map((h) => h.toLowerCase()),
      ...failedStore.hashes,
    ]);
    const triedNames = new Set([
      ...[...triedReleasesFromMeta(dl.metadata), dl.releaseName]
        .filter((n): n is string => !!n)
        .map(normRelease),
      ...failedStore.names,
    ]);
    const q = `${dl.title} S${pad2(dl.season)}E${pad2(dl.episode)}`;
    const results = await prowlarr.search(q, { categories: categoriesForKind("TV"), limit: 100 });
    const matched = results.filter(
      (r) => isEpisodeMatch(r.title, dl.season!, dl.episode!) && releaseTitleMatches(r.title, dl.title),
    );
    const fresh = matched.filter(
      (r) => !triedHashes.has((r.infoHash ?? "").toLowerCase()) && !triedNames.has(normRelease(r.title)),
    );

    // Prefer an untried release (best seeders/quality). If everything's been tried
    // and it's been failing a while, start the cycle over — a dead source may have
    // seeders now — by wiping this episode's tried history.
    let best = pickAutoRelease(fresh, { minSeeders: cfg.prefs.minSeeders, floorGB: 0.05 });
    let reset = false;
    if (!best && matched.length > 0 && Date.now() - dl.updatedAt.getTime() > RETRY_RESET_MS) {
      best = pickAutoRelease(matched, { minSeeders: cfg.prefs.minSeeders, floorGB: 0.05 });
      reset = true;
    }
    if (!best) continue;

    const wasStuck = dl.status === "DOWNLOADING";
    if (wasStuck && qb && dl.qbitHash) await qb.delete([dl.qbitHash], true).catch(() => {});
    if (reset) await clearFailedSources(dl.tmdbId, dl.season, dl.episode);
    if (wasStuck || reset) {
      await prisma.download
        .update({
          where: { id: dl.id },
          data: {
            status: "FAILED",
            error: wasStuck ? "No progress — searching a fresh source" : dl.error,
            ...(reset ? { metadata: {} } : {}),
          },
        })
        .catch(() => {});
    }
    void logActivity(
      `Re-searching ${dl.title} S${pad2(dl.season)}E${pad2(dl.episode)} — ${reset ? "retrying all sources" : "new source"} (${best.seeders ?? 0} seeders)`,
      { kind: "switch", title: dl.title },
    );
    await createDownload({
      releaseName: best.title,
      source: best.magnetUrl ?? best.downloadUrl ?? "",
      infoHash: best.infoHash,
      indexer: best.indexer,
      size: best.size,
      seeders: best.seeders,
      kind: "TV",
      title: dl.title,
      year: dl.year,
      season: dl.season,
      episode: dl.episode,
      tmdbId: dl.tmdbId ?? undefined,
      query: q,
    });
    retried++;
  }
  return { retried };
}

/**
 * Re-queue downloads that were mid-flight when the worker died (e.g. a redeploy),
 * detected by a stale updatedAt — the worker bumps updatedAt every couple seconds
 * while genuinely working, so anything not updated recently is stranded. Run
 * periodically so interrupted uploads/downloads self-heal without a manual
 * redeploy. Idempotent: the job id is the download id.
 */
export async function recoverStuckDownloads(
  staleMs = 5 * 60 * 1000,
): Promise<{ requeued: number }> {
  const cutoff = new Date(Date.now() - staleMs);
  const stuck = await prisma.download.findMany({
    where: {
      status: { in: ["SEARCHING", "DOWNLOADING", "UPLOADING"] },
      updatedAt: { lt: cutoff },
    },
    select: { id: true },
  });
  for (const d of stuck) await enqueueDownload(d.id);
  return { requeued: stuck.length };
}

/** Fake-file floor (GB) by download kind — episodes are small, packs large. */
function floorForDownload(dl: { kind: MediaKind; season: number | null; episode: number | null }): number {
  if (dl.kind === "TV") return dl.episode != null ? 0.05 : 0.3;
  if (dl.kind === "MOVIE") return 0.2;
  return 0.05;
}

/** Lowercased info-hash of a result, from its field or magnet URI. */
function resultHash(r: { infoHash?: string; magnetUrl?: string }): string | undefined {
  const h = r.infoHash ?? (r.magnetUrl ? parseInfoHash(r.magnetUrl) : undefined);
  return h?.toLowerCase();
}

/** Reconstruct an indexer query from a download when the stored one is missing. */
function rebuildQuery(dl: {
  kind: MediaKind;
  title: string;
  year: number | null;
  season: number | null;
  episode: number | null;
}): string {
  if (dl.kind === "TV" && dl.season != null) {
    return dl.episode != null
      ? `${dl.title} S${pad2(dl.season)}E${pad2(dl.episode)}`
      : `${dl.title} Season ${dl.season}`;
  }
  return `${dl.title}${dl.year ? ` ${dl.year}` : ""}`;
}

/**
 * Find a replacement release for a stalled download: re-run its search, drop any
 * source already tried (plus the current one), keep only valid candidates, and
 * pick the next-best (720p, smallest well-seeded). Null when nothing new fits.
 */
export async function reSource(
  dl: {
    kind: MediaKind;
    query: string | null;
    title: string;
    year: number | null;
    season: number | null;
    episode: number | null;
    infoHash: string | null;
  },
  triedInfoHashes: string[],
): Promise<ScoredResult | null> {
  const cfg = await getConfig();
  if (!cfg.prowlarr.url || !cfg.prowlarr.apiKey) return null;
  const prowlarr = new ProwlarrClient(cfg.prowlarr);

  const query = dl.query?.trim() || rebuildQuery(dl);
  if (!query) return null;
  const results = await prowlarr.search(query, { categories: categoriesForKind(dl.kind), limit: 60 });

  const exclude = new Set(triedInfoHashes.map((h) => h.toLowerCase()));
  if (dl.infoHash) exclude.add(dl.infoHash.toLowerCase());

  let pool = results.filter((r) => {
    const h = resultHash(r);
    return !h || !exclude.has(h);
  });
  // Keep only releases that match what this download actually is.
  if (dl.kind === "TV" && dl.season != null && dl.episode != null) {
    pool = pool.filter(
      (r) => isEpisodeMatch(r.title, dl.season!, dl.episode!) && releaseTitleMatches(r.title, dl.title),
    );
  } else if (dl.kind === "TV" && dl.season != null) {
    pool = pool.filter(
      (r) => isSingleSeasonPack(r.title, dl.season!) && releaseTitleMatches(r.title, dl.title),
    );
  }
  return pickAutoRelease(pool, { minSeeders: cfg.prefs.minSeeders, floorGB: floorForDownload(dl) });
}

export { GB };
