import type { ResolvedConfig } from "../config";

export type JellyfinConfig = ResolvedConfig["jellyfin"];

export interface JellyfinWatchedTitle {
  jellyfinId: string;
  name: string;
  type: "Movie" | "Series";
  tmdbId?: number;
  year?: number;
  genres: string[];
  people: string[]; // a few cast/crew names
  lastPlayed?: string;
  playCount: number;
}

export interface WatchedEpisode {
  seriesTmdbId?: number;
  seriesName: string;
  season: number;
  episode: number;
  lastPlayed?: string;
}

export interface InProgressSeries {
  tmdbId?: number;
  name: string;
  year?: number;
  posterUrl?: string;
}

export function jellyfinReady(cfg: JellyfinConfig): boolean {
  return !!(cfg.url && cfg.apiKey);
}

async function jf<T>(
  cfg: JellyfinConfig,
  path: string,
  params: Record<string, string> = {},
): Promise<T | null> {
  if (!cfg.url || !cfg.apiKey) return null;
  const base = cfg.url.replace(/\/+$/, "");
  const usp = new URLSearchParams(params);
  const url = `${base}${path}${usp.toString() ? `?${usp}` : ""}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(url, {
      headers: { "X-Emby-Token": cfg.apiKey, Accept: "application/json" },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function providerTmdb(item: any): number | undefined {
  const raw = item?.ProviderIds?.Tmdb ?? item?.ProviderIds?.tmdb;
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : undefined;
}
function peopleNames(item: any): string[] {
  const p = item?.People;
  if (!Array.isArray(p)) return [];
  return p
    .filter((x) => x.Type === "Actor" || x.Type === "Director" || x.Type === "Writer")
    .slice(0, 6)
    .map((x) => x.Name as string)
    .filter(Boolean);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Resolve the user id to query watch state for (config, else first user). */
export async function resolveUserId(cfg: JellyfinConfig): Promise<string | null> {
  if (cfg.userId) return cfg.userId;
  const users = await jf<Array<{ Id: string }>>(cfg, "/Users");
  return users?.[0]?.Id ?? null;
}

/** Recently played movies + series with genres/people — the taste signal. */
export async function getPlayedTitles(
  cfg: JellyfinConfig,
  limit = 100,
): Promise<JellyfinWatchedTitle[]> {
  const userId = await resolveUserId(cfg);
  if (!userId) return [];
  const data = await jf<{ Items?: Record<string, unknown>[] }>(cfg, `/Users/${userId}/Items`, {
    Recursive: "true",
    IncludeItemTypes: "Movie,Series",
    Filters: "IsPlayed",
    Fields: "Genres,People,ProductionYear,UserData,ProviderIds",
    SortBy: "DatePlayed",
    SortOrder: "Descending",
    Limit: String(limit),
  });
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (data?.Items ?? []).map((it: any) => ({
    jellyfinId: it.Id,
    name: it.Name,
    type: it.Type === "Series" ? "Series" : "Movie",
    tmdbId: providerTmdb(it),
    year: it.ProductionYear || undefined,
    genres: Array.isArray(it.Genres) ? it.Genres : [],
    people: peopleNames(it),
    lastPlayed: it.UserData?.LastPlayedDate || undefined,
    playCount: it.UserData?.PlayCount ?? 0,
  }));
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/** Series the user is watching (any watched/in-progress episode) — auto-follow candidates. */
export async function getWatchingSeries(cfg: JellyfinConfig): Promise<InProgressSeries[]> {
  const watched = await getWatchedEpisodes(cfg);
  const map = new Map<string, InProgressSeries>();
  for (const e of watched) {
    const key = e.seriesTmdbId ? `t${e.seriesTmdbId}` : e.seriesName;
    if (key && !map.has(key)) map.set(key, { tmdbId: e.seriesTmdbId, name: e.seriesName });
  }
  return [...map.values()];
}

/** Watched episodes (with series TMDB id + S/E) — used by retention. */
export async function getWatchedEpisodes(cfg: JellyfinConfig): Promise<WatchedEpisode[]> {
  const userId = await resolveUserId(cfg);
  if (!userId) return [];
  // Build series id -> tmdb id map first.
  const seriesData = await jf<{ Items?: Record<string, unknown>[] }>(cfg, `/Users/${userId}/Items`, {
    Recursive: "true",
    IncludeItemTypes: "Series",
    Fields: "ProviderIds",
    Limit: "500",
  });
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const seriesTmdb = new Map<string, number>();
  for (const s of seriesData?.Items ?? []) {
    const tid = providerTmdb(s);
    if (tid) seriesTmdb.set((s as any).Id, tid);
  }
  const eps = await jf<{ Items?: Record<string, unknown>[] }>(cfg, `/Users/${userId}/Items`, {
    Recursive: "true",
    IncludeItemTypes: "Episode",
    Filters: "IsPlayed",
    Fields: "UserData,SeriesId,ParentIndexNumber,IndexNumber",
    Limit: "1000",
  });
  return (eps?.Items ?? [])
    .map((e: any) => ({
      seriesTmdbId: e.SeriesId ? seriesTmdb.get(e.SeriesId) : undefined,
      seriesName: e.SeriesName ?? "",
      season: e.ParentIndexNumber ?? 0,
      episode: e.IndexNumber ?? 0,
      lastPlayed: e.UserData?.LastPlayedDate || undefined,
    }))
    .filter((e: WatchedEpisode) => e.season > 0 && e.episode > 0);
  /* eslint-enable @typescript-eslint/no-explicit-any */
}
