import { prisma } from "../db";
import { getConfig } from "../config";
import { planQuery } from "../llm/search-planner";
import { aiRank } from "../llm/ranker";
import { ProwlarrClient, categoriesForKind } from "../indexers/prowlarr";
import { QbClient, parseInfoHash } from "../torrent/qbittorrent";
import { rankResults } from "../scoring/scorer";
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

/** Ask the AI to pick the best candidate; fall back to the top scored result. */
export async function chooseBest(
  plan: PlannedQuery,
  ranked: ScoredResult[],
): Promise<{ chosen: ScoredResult | null; decision: RankDecision }> {
  if (ranked.length === 0) {
    return {
      chosen: null,
      decision: { chosenIndex: -1, reason: "No results found", flaggedIndexes: [] },
    };
  }
  const top = ranked.slice(0, 8);
  let decision: RankDecision;
  try {
    decision = await aiRank(plan, top);
  } catch {
    decision = {
      chosenIndex: 0,
      reason: "Top-scored result (AI ranking unavailable)",
      flaggedIndexes: [],
    };
  }
  const idx = decision.chosenIndex;
  const chosen = idx >= 0 && idx < top.length ? top[idx] : ranked[0] ?? null;
  return { chosen, decision };
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
}

/** Persist a download and enqueue it for the worker. */
export async function createDownload(input: CreateDownloadInput): Promise<DownloadDTO> {
  if (!input.source) {
    throw new Error("Missing torrent source (magnet or .torrent URL)");
  }
  const title = (input.title && input.title.trim()) || cleanReleaseName(input.releaseName);
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

export async function removeDownload(id: string): Promise<void> {
  const row = await prisma.download.findUnique({ where: { id } });
  if (!row) return;
  if (row.qbitHash) {
    try {
      const cfg = await getConfig();
      const qb = new QbClient(cfg.qbit);
      await qb.delete([row.qbitHash], true);
    } catch {
      /* ignore qBittorrent errors during delete */
    }
  }
  await prisma.download.delete({ where: { id } });
  await publishProgress({ type: "deleted", downloadId: id });
}

export { GB };
