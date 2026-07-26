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
} from "../scoring/scorer";
import { getSeasonEpisodes, getTvDetails, getTitle, type TmdbEpisode } from "../metadata/tmdb";
import { makeS3, deleteObject } from "../storage/s3";
import { notify } from "../telegram/client";
import type { Download } from "@prisma/client";
import { enqueueDownload } from "../queue";
import { publishProgress } from "../events";
import { toDTO } from "../serialize";
import { cleanReleaseName } from "../util";
import type {
  DownloadDTO,
  MediaKind,
  PlannedQuery,
  RankDecision,
  ScoredResult,
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

  // Don't create a second row for a TV episode we already have — guards against
  // duplicate episodes from repeated/concurrent season grabs or double-taps.
  if (input.kind === "TV" && input.season != null && input.episode != null) {
    const dup = await prisma.download.findFirst({
      where: {
        season: input.season,
        episode: input.episode,
        status: { notIn: ["FAILED", "CANCELLED"] },
        OR: [
          ...(input.tmdbId ? [{ tmdbId: input.tmdbId }] : []),
          { title: { equals: title, mode: "insensitive" as const } },
        ],
      },
    });
    if (dup) return toDTO(dup);
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
  };
}

/** One-shot: plan -> search -> choose best -> queue. Used by agent + auto mode. */
export async function startFromQuery(nl: string): Promise<{
  plan: PlannedQuery;
  ranked: ScoredResult[];
  decision: RankDecision;
  download?: DownloadDTO;
}> {
  const { plan, ranked } = await planAndSearch(nl);
  const { chosen, decision } = await chooseBest(plan, ranked);
  if (!chosen) return { plan, ranked, decision };
  const input = resultToInput(plan, chosen, nl);
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
}): Promise<DownloadDTO | null> {
  const cfg = await getConfig();
  const prowlarr = new ProwlarrClient(cfg.prowlarr);
  const q = `${opts.title}${opts.year ? ` ${opts.year}` : ""}`;
  const results = await prowlarr.search(q, { categories: categoriesForKind("MOVIE"), limit: 60 });
  const chosen = pickAutoRelease(results, { minSeeders: cfg.prefs.minSeeders, floorGB: 0.2 });
  if (!chosen) return null;
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

/** Episodes already in the library for a show (by TMDB id or title), season+episode set. */
export async function ownedEpisodeKeys(tmdbId: number, title: string): Promise<Set<string>> {
  const rows = await prisma.download.findMany({
    where: {
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
}): Promise<boolean> {
  const { prowlarr, cfg, show, ep } = o;
  const q = `${show.title} S${pad2(ep.seasonNumber)}E${pad2(ep.episodeNumber)}`;
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
  const best = pickAutoRelease(matched, { minSeeders: cfg.prefs.minSeeders, floorGB: 0.05 });
  if (!best) return false;
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
    query: q,
  });
  if (o.notify !== false) {
    await notify(
      `⬇️ New episode: ${show.title} S${pad2(ep.seasonNumber)}E${pad2(ep.episodeNumber)}${ep.name ? ` — ${ep.name}` : ""} → downloading.`,
    );
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

  // Already have a whole-season pack? It covers every episode — don't re-search a
  // pack or grab episodes individually (guards "Grab missing" from re-downloading).
  const existingPack = await prisma.download.findFirst({
    where: {
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
    await prisma.followedShow
      .upsert({
        where: { tmdbId: opts.tmdbId },
        create: {
          tmdbId: opts.tmdbId,
          title: opts.title,
          year: opts.year ?? null,
          autoDownload: true,
          source: "season-grab",
          createdAt: new Date(firstAired - 2 * DAY),
        },
        update: {},
      })
      .catch(() => {});
  }

  // Episode-by-episode: every aired, not-yet-owned episode.
  const owned = await ownedEpisodeKeys(opts.tmdbId, opts.title);
  let queued = 0;
  let failed = 0;
  for (const ep of available) {
    if (owned.has(`${ep.seasonNumber}x${ep.episodeNumber}`)) continue;
    const ok = await grabEpisode({
      prowlarr,
      cfg,
      show: { title: opts.title, year: opts.year ?? null, tmdbId: opts.tmdbId },
      ep,
      indexerIds: opts.indexerIds,
      notify: opts.notify,
    });
    if (ok) {
      queued++;
      owned.add(`${ep.seasonNumber}x${ep.episodeNumber}`);
    } else {
      failed++;
    }
  }
  return {
    season: opts.season,
    mode: "episodes",
    queued,
    failed,
    total: available.length,
    reason: olderThanYear ? "pack not found → episodes" : undefined,
  };
}

export async function listDownloads(): Promise<DownloadDTO[]> {
  const rows = await prisma.download.findMany({ orderBy: { createdAt: "desc" } });
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
