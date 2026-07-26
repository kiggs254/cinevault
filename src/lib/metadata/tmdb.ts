import type { MediaKind } from "../types";

const IMG_BASE = "https://image.tmdb.org/t/p/w500";
const API = "https://api.themoviedb.org/3";

export type TmdbMediaType = "movie" | "tv";

export interface TmdbTitle {
  tmdbId: number;
  mediaType: TmdbMediaType;
  title: string;
  year?: number;
  overview?: string;
  posterUrl?: string;
  backdropUrl?: string;
  genreIds?: number[];
  voteAverage?: number;
  popularity?: number;
}

export interface TmdbEpisode {
  seasonNumber: number;
  episodeNumber: number;
  name?: string;
  airDate?: string; // YYYY-MM-DD
}

export interface TmdbSeason {
  seasonNumber: number;
  episodeCount: number;
  airDate?: string;
  name?: string;
}
export interface TmdbTvDetails extends TmdbTitle {
  status?: string; // "Returning Series" | "Ended" | "Canceled" | ...
  seasons: TmdbSeason[];
  genres: string[];
  networks: string[];
  backdropUrl?: string;
}

export interface TmdbMeta {
  title: string;
  year?: number;
  overview?: string;
  posterUrl?: string;
  tmdbId?: number;
}

/** v4 read tokens are JWTs ("eyJ…"); v3 keys are 32-char hex. Auth accordingly. */
function isV4Token(key: string): boolean {
  return key.startsWith("eyJ") && key.length > 40;
}

async function tmdbFetch<T>(
  apiKey: string,
  path: string,
  params: Record<string, string> = {},
): Promise<T | null> {
  const usp = new URLSearchParams(params);
  const headers: Record<string, string> = { Accept: "application/json" };
  if (isV4Token(apiKey)) headers.Authorization = `Bearer ${apiKey}`;
  else usp.set("api_key", apiKey);
  try {
    const res = await fetch(`${API}${path}?${usp.toString()}`, { headers });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function posterFrom(p?: string | null): string | undefined {
  return p ? `${IMG_BASE}${p}` : undefined;
}
function yearOf(date?: string | null): number | undefined {
  return date ? Number(date.slice(0, 4)) || undefined : undefined;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
function toTitle(hit: any, forcedType?: TmdbMediaType): TmdbTitle | null {
  if (!hit || (!hit.title && !hit.name)) return null;
  const mediaType: TmdbMediaType =
    forcedType ?? (hit.media_type === "tv" || hit.first_air_date ? "tv" : "movie");
  return {
    tmdbId: hit.id,
    mediaType,
    title: hit.title ?? hit.name,
    year: yearOf(hit.release_date ?? hit.first_air_date),
    overview: hit.overview || undefined,
    posterUrl: posterFrom(hit.poster_path),
    backdropUrl: hit.backdrop_path ? `https://image.tmdb.org/t/p/w1280${hit.backdrop_path}` : undefined,
    genreIds: Array.isArray(hit.genre_ids) ? hit.genre_ids : undefined,
    voteAverage: typeof hit.vote_average === "number" ? hit.vote_average : undefined,
    popularity: typeof hit.popularity === "number" ? hit.popularity : undefined,
  };
}

function toTitles(res: { results?: any[] } | null, forcedType?: TmdbMediaType): TmdbTitle[] {
  if (!res?.results) return [];
  return res.results.map((r) => toTitle(r, forcedType)).filter((t): t is TmdbTitle => !!t);
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/**
 * Optional metadata enrichment used by the download worker. Returns null when no
 * API key is configured or nothing matches — callers treat it as best-effort.
 */
export async function enrich(
  apiKey: string | undefined,
  kind: MediaKind,
  title: string,
  year?: number | null,
): Promise<TmdbMeta | null> {
  if (!apiKey) return null;
  const type: TmdbMediaType = kind === "TV" ? "tv" : "movie";
  const t = await searchTitle(apiKey, type, title, year ?? undefined);
  if (!t) return null;
  return { title: t.title, year: t.year, overview: t.overview, posterUrl: t.posterUrl, tmdbId: t.tmdbId };
}

/** First search hit for a title (movie or tv). */
export async function searchTitle(
  apiKey: string,
  type: TmdbMediaType,
  title: string,
  year?: number,
): Promise<TmdbTitle | null> {
  const params: Record<string, string> = { query: title, include_adult: "false" };
  if (year) params[type === "tv" ? "first_air_date_year" : "year"] = String(year);
  const data = await tmdbFetch<{ results?: unknown[] }>(apiKey, `/search/${type}`, params);
  return toTitles(data as { results?: unknown[] }, type)[0] ?? null;
}

/** Several search hits for a title (for pickers). */
export async function searchTitles(
  apiKey: string,
  type: TmdbMediaType,
  query: string,
  limit = 8,
): Promise<TmdbTitle[]> {
  const data = await tmdbFetch<{ results?: unknown[] }>(apiKey, `/search/${type}`, {
    query,
    include_adult: "false",
  });
  return toTitles(data as { results?: unknown[] }, type).slice(0, limit);
}

export async function getRecommendations(
  apiKey: string,
  type: TmdbMediaType,
  id: number,
): Promise<TmdbTitle[]> {
  return toTitles(await tmdbFetch(apiKey, `/${type}/${id}/recommendations`), type);
}

export async function getSimilar(
  apiKey: string,
  type: TmdbMediaType,
  id: number,
): Promise<TmdbTitle[]> {
  return toTitles(await tmdbFetch(apiKey, `/${type}/${id}/similar`), type);
}

/** Trending this week. type "all" mixes movies + shows. */
export async function getTrending(
  apiKey: string,
  type: TmdbMediaType | "all" = "all",
): Promise<TmdbTitle[]> {
  return toTitles(await tmdbFetch(apiKey, `/trending/${type}/week`));
}

/** Popular titles (for the Netflix-style browse rows). */
export async function getPopular(apiKey: string, type: TmdbMediaType): Promise<TmdbTitle[]> {
  return toTitles(await tmdbFetch(apiKey, `/${type}/popular`), type);
}

/** Top-rated titles. */
export async function getTopRated(apiKey: string, type: TmdbMediaType): Promise<TmdbTitle[]> {
  return toTitles(await tmdbFetch(apiKey, `/${type}/top_rated`), type);
}

export interface BrowsePage {
  key: string;
  title: string;
  items: TmdbTitle[];
  page: number;
  totalPages: number;
}

/** The Netflix-style browse rows, each backed by a paginated TMDB endpoint. */
export const BROWSE_CATEGORIES: Record<string, { title: string; path: string; type?: TmdbMediaType }> = {
  trending: { title: "Trending this week", path: "/trending/all/week" },
  "popular-movies": { title: "Popular movies", path: "/movie/popular", type: "movie" },
  "popular-tv": { title: "Popular TV shows", path: "/tv/popular", type: "tv" },
  "top-movies": { title: "Top rated movies", path: "/movie/top_rated", type: "movie" },
  "top-tv": { title: "Top rated TV", path: "/tv/top_rated", type: "tv" },
};

/** One page of a browse category (page 1 for rows, page N for "Show all"). */
export async function browseCategory(
  apiKey: string,
  key: string,
  page = 1,
): Promise<BrowsePage | null> {
  const cat = BROWSE_CATEGORIES[key];
  if (!cat) return null;
  const data = await tmdbFetch<{ results?: unknown[]; page?: number; total_pages?: number }>(
    apiKey,
    cat.path,
    { page: String(Math.max(1, Math.min(page, 500))) },
  );
  const items = toTitles(data as { results?: unknown[] }, cat.type).filter((i) => i.posterUrl);
  return {
    key,
    title: cat.title,
    items,
    page: data?.page ?? page,
    totalPages: Math.min(data?.total_pages ?? 1, 500),
  };
}

export async function discoverByGenres(
  apiKey: string,
  type: TmdbMediaType,
  genreIds: number[],
): Promise<TmdbTitle[]> {
  if (genreIds.length === 0) return [];
  return toTitles(
    await tmdbFetch(apiKey, `/discover/${type}`, {
      with_genres: genreIds.join(","),
      sort_by: "popularity.desc",
      "vote_count.gte": "50",
      include_adult: "false",
    }),
    type,
  );
}

export async function getGenres(
  apiKey: string,
  type: TmdbMediaType,
): Promise<{ id: number; name: string }[]> {
  const data = await tmdbFetch<{ genres?: { id: number; name: string }[] }>(
    apiKey,
    `/genre/${type}/list`,
  );
  return data?.genres ?? [];
}

/** Full details for a single title (poster/overview/year + genres). */
export async function getTitle(
  apiKey: string,
  type: TmdbMediaType,
  id: number,
): Promise<TmdbTitle | null> {
  const hit = await tmdbFetch<Record<string, unknown>>(apiKey, `/${type}/${id}`);
  return hit ? toTitle(hit, type) : null;
}

/** TV details incl. seasons, status, networks — used by the follow scanner. */
export async function getTvDetails(apiKey: string, id: number): Promise<TmdbTvDetails | null> {
  const d = await tmdbFetch<Record<string, unknown>>(apiKey, `/tv/${id}`);
  if (!d) return null;
  const base = toTitle(d, "tv");
  if (!base) return null;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const seasons: TmdbSeason[] = ((d.seasons as any[]) ?? [])
    .filter((s) => (s.season_number ?? 0) > 0)
    .map((s) => ({
      seasonNumber: s.season_number as number,
      episodeCount: (s.episode_count as number) ?? 0,
      airDate: (s.air_date as string) || undefined,
      name: (s.name as string) || undefined,
    }));
  const genres = ((d.genres as any[]) ?? []).map((g) => g.name as string);
  const networks = ((d.networks as any[]) ?? []).map((n) => n.name as string);
  const backdropUrl = d.backdrop_path ? `https://image.tmdb.org/t/p/w1280${d.backdrop_path}` : undefined;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return { ...base, status: d.status as string | undefined, seasons, genres, networks, backdropUrl };
}

/** Episodes (with air dates) for one season. */
export async function getSeasonEpisodes(
  apiKey: string,
  id: number,
  seasonNumber: number,
): Promise<TmdbEpisode[]> {
  const d = await tmdbFetch<{ episodes?: Record<string, unknown>[] }>(
    apiKey,
    `/tv/${id}/season/${seasonNumber}`,
  );
  if (!d?.episodes) return [];
  return d.episodes.map((e) => ({
    seasonNumber,
    episodeNumber: (e.episode_number as number) ?? 0,
    name: (e.name as string) || undefined,
    airDate: (e.air_date as string) || undefined,
  }));
}
