import { prisma } from "../db";
import { getConfig, type ResolvedConfig } from "../config";
import { ProwlarrClient, categoriesForKind } from "../indexers/prowlarr";
import { rankResults, type ScorePrefs } from "../scoring/scorer";
import { createDownload } from "./downloads";
import { fetchFeed } from "../rss";
import type { MediaKind } from "../types";
import type { Watch } from "@prisma/client";

/** Simple deterministic taste match (0..100) from interest keyword hits in a title. */
export function tasteScore(title: string, interests: string[]): number {
  if (interests.length === 0) return 0;
  const t = title.toLowerCase();
  const matched = interests.filter((term) => term && t.includes(term.toLowerCase()));
  if (matched.length === 0) return 0;
  return Math.min(100, 40 + matched.length * 30);
}

function safeDate(s?: string | null): Date | null {
  if (!s) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

interface IngestInput {
  watchId: string | null;
  autoGrab: boolean;
  kind: MediaKind;
  title: string;
  source: string; // magnet or .torrent URL
  infoHash?: string | null;
  indexerName?: string | null;
  size?: number;
  seeders?: number | null;
  publishDate?: string | null;
  query?: string | null;
}

async function ingestOne(i: IngestInput, cfg: ResolvedConfig): Promise<"grabbed" | "new" | "skip"> {
  const dedupeKey = (
    i.infoHash?.toLowerCase() || `${i.watchId ?? "disc"}:${i.title.toLowerCase()}`
  ).slice(0, 190);
  if (await prisma.feedItem.findUnique({ where: { dedupeKey }, select: { id: true } })) {
    return "skip";
  }

  const already = await prisma.download.findFirst({
    where: i.infoHash ? { infoHash: i.infoHash } : { releaseName: i.title },
    select: { id: true },
  });
  const score = tasteScore(i.title, cfg.profile.interests);
  const shouldGrab =
    !already &&
    (i.autoGrab || (cfg.profile.autoGrabEnabled && score >= cfg.profile.autoGrabThreshold));

  let status: "grabbed" | "new" = already ? "grabbed" : "new";
  if (shouldGrab) {
    try {
      await createDownload({
        releaseName: i.title,
        source: i.source,
        infoHash: i.infoHash ?? null,
        indexer: i.indexerName ?? null,
        size: i.size,
        seeders: i.seeders ?? null,
        kind: i.kind,
        query: i.query ?? null,
      });
      status = "grabbed";
    } catch {
      status = "new";
    }
  }

  await prisma.feedItem
    .create({
      data: {
        watchId: i.watchId,
        dedupeKey,
        title: i.title,
        source: i.indexerName ?? null,
        magnet: i.source,
        infoHash: i.infoHash ?? null,
        size: BigInt(Math.max(0, Math.round(i.size ?? 0))),
        seeders: i.seeders ?? null,
        kind: i.kind,
        matchScore: score,
        status,
        publishDate: safeDate(i.publishDate),
      },
    })
    .catch(() => {});

  return status === "grabbed" ? "grabbed" : "new";
}

async function scanSearchWatch(w: Watch, cfg: ResolvedConfig) {
  if (!w.query || cfg.profile.legalIndexerIds.length === 0) return { grabbed: 0, discovered: 0 };
  const prowlarr = new ProwlarrClient(cfg.prowlarr);
  const results = await prowlarr.search(w.query, {
    categories: categoriesForKind(w.kind as MediaKind),
    limit: 40,
    indexerIds: cfg.profile.legalIndexerIds,
  });
  const prefs: ScorePrefs = {
    preferredQuality: w.quality,
    minSeeders: w.minSeeders,
    maxSizeGB: cfg.prefs.maxSizeGB,
    kind: w.kind as ScorePrefs["kind"],
  };
  let grabbed = 0;
  let discovered = 0;
  for (const r of rankResults(results, prefs).slice(0, 15)) {
    const source = r.magnetUrl ?? r.downloadUrl;
    if (!source) continue;
    const res = await ingestOne(
      {
        watchId: w.id,
        autoGrab: w.autoGrab,
        kind: w.kind as MediaKind,
        title: r.title,
        source,
        infoHash: r.infoHash,
        indexerName: r.indexer,
        size: r.size,
        seeders: r.seeders,
        publishDate: r.publishDate,
        query: w.query,
      },
      cfg,
    );
    if (res === "grabbed") grabbed++;
    else if (res === "new") discovered++;
  }
  return { grabbed, discovered };
}

async function scanRssWatch(w: Watch, cfg: ResolvedConfig) {
  if (!w.feedUrl) return { grabbed: 0, discovered: 0 };
  const items = await fetchFeed(w.feedUrl, 40);
  let grabbed = 0;
  let discovered = 0;
  for (const it of items) {
    if (!it.source) continue; // only torrent/magnet items are downloadable via qBittorrent
    const res = await ingestOne(
      {
        watchId: w.id,
        autoGrab: w.autoGrab,
        kind: w.kind as MediaKind,
        title: it.title,
        source: it.source,
        infoHash: it.infoHash,
        indexerName: w.label,
        size: it.size,
        seeders: it.seeders,
        publishDate: it.pubDate,
        query: null,
      },
      cfg,
    );
    if (res === "grabbed") grabbed++;
    else if (res === "new") discovered++;
  }
  return { grabbed, discovered };
}

async function discoverFromInterests(cfg: ResolvedConfig) {
  if (cfg.profile.interests.length === 0 || cfg.profile.legalIndexerIds.length === 0) {
    return { grabbed: 0, discovered: 0 };
  }
  const prowlarr = new ProwlarrClient(cfg.prowlarr);
  let grabbed = 0;
  let discovered = 0;
  for (const term of cfg.profile.interests.slice(0, 6)) {
    try {
      const results = await prowlarr.search(term, {
        limit: 20,
        indexerIds: cfg.profile.legalIndexerIds,
      });
      const ranked = rankResults(results, {
        preferredQuality: "any",
        minSeeders: 1,
        maxSizeGB: cfg.prefs.maxSizeGB,
        kind: "OTHER",
      });
      for (const r of ranked.slice(0, 8)) {
        const source = r.magnetUrl ?? r.downloadUrl;
        if (!source) continue;
        const res = await ingestOne(
          {
            watchId: null,
            autoGrab: false,
            kind: "OTHER",
            title: r.title,
            source,
            infoHash: r.infoHash,
            indexerName: r.indexer,
            size: r.size,
            seeders: r.seeders,
            publishDate: r.publishDate,
            query: term,
          },
          cfg,
        );
        if (res === "grabbed") grabbed++;
        else if (res === "new") discovered++;
      }
    } catch {
      /* skip this term */
    }
  }
  return { grabbed, discovered };
}

/** Run all enabled watches + interest discovery once. Called by the scheduler. */
export async function scanWatches(): Promise<{ scanned: number; grabbed: number; discovered: number }> {
  const cfg = await getConfig();
  if (!cfg.prowlarr.url || !cfg.prowlarr.apiKey) {
    return { scanned: 0, grabbed: 0, discovered: 0 };
  }
  const watches = await prisma.watch.findMany({ where: { enabled: true } });
  let grabbed = 0;
  let discovered = 0;
  for (const w of watches) {
    try {
      const stats = w.type === "RSS" ? await scanRssWatch(w, cfg) : await scanSearchWatch(w, cfg);
      grabbed += stats.grabbed;
      discovered += stats.discovered;
      await prisma.watch.update({ where: { id: w.id }, data: { lastRunAt: new Date() } });
    } catch (e) {
      console.error("[watch] scan failed:", w.label, (e as Error).message);
    }
  }
  const disc = await discoverFromInterests(cfg);
  return {
    scanned: watches.length,
    grabbed: grabbed + disc.grabbed,
    discovered: discovered + disc.discovered,
  };
}
