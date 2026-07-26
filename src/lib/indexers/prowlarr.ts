import type { MediaKind, TorrentResult } from "../types";

interface ProwlarrRelease {
  title: string;
  size: number;
  seeders?: number;
  leechers?: number;
  indexer: string;
  indexerId: number;
  downloadUrl?: string;
  magnetUrl?: string;
  infoHash?: string;
  publishDate?: string;
  categories?: Array<{ id: number; name: string }> | number[];
  protocol?: string;
  infoUrl?: string;
  guid?: string;
}

export interface ProwlarrConfig {
  url?: string;
  apiKey?: string;
}

/** Prowlarr aggregate-search client (Torznab under the hood). */
export class ProwlarrClient {
  private base: string;
  private apiKey: string;

  constructor(cfg: ProwlarrConfig) {
    if (!cfg.url) throw new Error("Prowlarr URL is not configured");
    if (!cfg.apiKey) throw new Error("Prowlarr API key is not configured");
    this.base = cfg.url.replace(/\/$/, "");
    this.apiKey = cfg.apiKey;
  }

  async search(
    query: string,
    opts: { categories?: number[]; limit?: number; indexerIds?: number[] } = {},
  ): Promise<TorrentResult[]> {
    const params = new URLSearchParams();
    params.set("query", query);
    params.set("type", "search");
    params.set("limit", String(opts.limit ?? 60));
    for (const c of opts.categories ?? []) params.append("categories", String(c));
    for (const id of opts.indexerIds ?? []) params.append("indexerIds", String(id));

    const res = await fetch(`${this.base}/api/v1/search?${params.toString()}`, {
      headers: { "X-Api-Key": this.apiKey, Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`Prowlarr search failed: ${res.status} ${await res.text()}`);
    }
    const data = (await res.json()) as ProwlarrRelease[];
    return data
      .filter((r) => (r.protocol ?? "torrent") === "torrent")
      .map(normalize);
  }

  async health(): Promise<boolean> {
    const res = await fetch(`${this.base}/api/v1/health`, {
      headers: { "X-Api-Key": this.apiKey },
    });
    return res.ok;
  }

  /** List configured indexers so the user can pick which ones automation may use. */
  async listIndexers(): Promise<
    { id: number; name: string; privacy?: string; enable?: boolean }[]
  > {
    const res = await fetch(`${this.base}/api/v1/indexer`, {
      headers: { "X-Api-Key": this.apiKey, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Prowlarr indexers failed: ${res.status}`);
    const data = (await res.json()) as Array<{
      id: number;
      name: string;
      privacy?: string;
      enable?: boolean;
    }>;
    return data.map((i) => ({ id: i.id, name: i.name, privacy: i.privacy, enable: i.enable }));
  }
}

function normalize(r: ProwlarrRelease): TorrentResult {
  const categories = Array.isArray(r.categories)
    ? r.categories.map((c) => (typeof c === "number" ? c : c.id))
    : [];
  return {
    title: r.title,
    indexer: r.indexer,
    size: r.size ?? 0,
    seeders: r.seeders ?? 0,
    leechers: r.leechers ?? 0,
    downloadUrl: r.downloadUrl,
    magnetUrl: r.magnetUrl,
    infoHash: r.infoHash,
    publishDate: r.publishDate,
    categories,
    link: r.infoUrl,
  };
}

/** Map our media kind to Torznab/Newznab top-level category ids. */
export function categoriesForKind(kind: MediaKind): number[] {
  switch (kind) {
    case "MOVIE":
      return [2000];
    case "TV":
      return [5000];
    case "MUSIC":
      return [3000];
    case "SOFTWARE":
      return [4000];
    default:
      return [];
  }
}
