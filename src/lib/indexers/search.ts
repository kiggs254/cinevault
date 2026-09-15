import type { MediaKind, TorrentResult } from "../types";
import type { ResolvedConfig } from "../config";
import { ProwlarrClient } from "./prowlarr";
import { getImdbId } from "../metadata/tmdb";

/**
 * Options a caller can pass to a search. `categories/limit/indexerIds` are the
 * classic Prowlarr text-search knobs; `tmdbId/kind/season/episode/imdbId` let the
 * TorBox searcher (which searches by IMDB id) work from the same call sites.
 */
export interface SearchOpts {
  categories?: number[];
  limit?: number;
  indexerIds?: number[];
  tmdbId?: number | null;
  kind?: MediaKind;
  season?: number | null;
  episode?: number | null;
  imdbId?: string | null;
}

/** A torrent source. Prowlarr (cloud) and TorBox search (desktop) both implement it. */
export interface TorrentSearcher {
  search(query: string, opts?: SearchOpts): Promise<TorrentResult[]>;
}

const TORBOX_SEARCH_BASE = "https://search-api.torbox.app";

interface TorboxSearchTorrent {
  raw_title?: string;
  title?: string;
  magnet?: string;
  hash?: string;
  size?: number;
  last_known_seeders?: number;
  seeders?: number;
}

function infoHashFromMagnet(magnet?: string): string | undefined {
  if (!magnet) return undefined;
  const m = /btih:([0-9a-fA-F]{40}|[a-zA-Z2-7]{32})/.exec(magnet);
  return m ? m[1].toLowerCase() : undefined;
}

function toResult(t: TorboxSearchTorrent): TorrentResult | null {
  const magnetUrl = t.magnet ?? undefined;
  const infoHash = t.hash?.toLowerCase() ?? infoHashFromMagnet(magnetUrl);
  const title = t.raw_title ?? t.title;
  if (!title || (!magnetUrl && !infoHash)) return null;
  return {
    title,
    indexer: "TorBox",
    size: t.size ?? 0,
    seeders: t.last_known_seeders ?? t.seeders ?? 0,
    leechers: 0,
    magnetUrl,
    infoHash,
    categories: [],
  };
}

/**
 * TorBox's free search API (search-api.torbox.app) — searches by IMDB id, which we
 * resolve from the TMDB id we already have. Returns the same TorrentResult[] shape
 * as Prowlarr so the existing scorer/selection is unchanged. No qBittorrent, no
 * Prowlarr, one key.
 */
export class TorboxSearch implements TorrentSearcher {
  constructor(private readonly cfg: ResolvedConfig) {}

  async search(_query: string, opts: SearchOpts = {}): Promise<TorrentResult[]> {
    let imdb = opts.imdbId ?? null;
    if (!imdb && opts.tmdbId && this.cfg.tmdb.apiKey) {
      const type = opts.kind === "TV" ? "tv" : "movie";
      imdb = await getImdbId(this.cfg.tmdb.apiKey, type, opts.tmdbId).catch(() => null);
    }
    if (!imdb) return []; // TorBox search is IMDB-keyed; nothing to query without it

    const params = new URLSearchParams({ check_cache: "true" });
    if (opts.kind === "TV" && opts.season != null) {
      params.set("season", String(opts.season));
      if (opts.episode != null) params.set("episode", String(opts.episode));
    }
    const url = `${TORBOX_SEARCH_BASE}/torrents/${encodeURIComponent(`imdb:${imdb}`)}?${params.toString()}`;
    const headers: Record<string, string> = {};
    if (this.cfg.torbox.apiKey) headers.Authorization = `Bearer ${this.cfg.torbox.apiKey}`;

    const res = await fetch(url, { headers }).catch(() => null);
    if (!res || !res.ok) return [];
    const json = (await res.json().catch(() => null)) as { data?: { torrents?: TorboxSearchTorrent[] } } | null;
    const torrents = json?.data?.torrents ?? [];
    const out: TorrentResult[] = [];
    for (const t of torrents) {
      const r = toResult(t);
      if (r) out.push(r);
    }
    return out.slice(0, opts.limit ?? 60);
  }
}

const DESKTOP = process.env.CINEVAULT_DESKTOP === "1";

/** The active torrent searcher: TorBox (desktop) or Prowlarr (cloud). */
export function getSearch(cfg: ResolvedConfig): TorrentSearcher {
  return DESKTOP ? new TorboxSearch(cfg) : new ProwlarrClient(cfg.prowlarr);
}

/** Whether search is usable: TorBox key on desktop, Prowlarr configured on cloud. */
export function searchReady(cfg: ResolvedConfig): boolean {
  return DESKTOP ? !!cfg.torbox.apiKey : !!(cfg.prowlarr.url && cfg.prowlarr.apiKey);
}

/** True in the single-process desktop/home edition. */
export const IS_DESKTOP = DESKTOP;
