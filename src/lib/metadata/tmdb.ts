import type { MediaKind } from "../types";

const IMG_BASE = "https://image.tmdb.org/t/p/w500";
const API = "https://api.themoviedb.org/3";

export type TmdbMediaType = "movie" | "tv";

export interface TmdbCastMember {
  name: string;
  character?: string;
  profileUrl?: string;
}

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
  // Richer fields — only populated by the single-title detail endpoints below.
  voteCount?: number;
  genres?: string[]; // genre names (detail responses carry names, lists carry ids)
  runtime?: number; // movie minutes, or a TV episode's typical runtime
  tagline?: string;
  releaseDate?: string; // full YYYY-MM-DD (movie release / TV first air)
  numberOfSeasons?: number;
  numberOfEpisodes?: number;
  certification?: string; // US age rating, e.g. "PG-13" (movie) / "TV-MA" (tv)
  cast?: TmdbCastMember[];
}

export interface TmdbEpisode {
  seasonNumber: number;
  episodeNumber: number;
  name?: string;
  airDate?: string; // YYYY-MM-DD
  overview?: string;
  stillUrl?: string; // episode thumbnail
  runtime?: number; // minutes
  voteAverage?: number;
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
    voteCount: typeof hit.vote_count === "number" ? hit.vote_count : undefined,
    genres: Array.isArray(hit.genres)
      ? hit.genres.map((g: any) => g?.name).filter((n: unknown): n is string => typeof n === "string")
      : undefined,
    runtime:
      typeof hit.runtime === "number"
        ? hit.runtime
        : Array.isArray(hit.episode_run_time) && typeof hit.episode_run_time[0] === "number"
          ? hit.episode_run_time[0]
          : undefined,
    tagline: typeof hit.tagline === "string" && hit.tagline ? hit.tagline : undefined,
    releaseDate: hit.release_date || hit.first_air_date || undefined,
    numberOfSeasons: typeof hit.number_of_seasons === "number" ? hit.number_of_seasons : undefined,
    numberOfEpisodes: typeof hit.number_of_episodes === "number" ? hit.number_of_episodes : undefined,
  };
}

/** Top-billed cast from an appended `credits` response (best-effort). */
function parseCast(hit: any, limit = 8): TmdbCastMember[] {
  const cast = hit?.credits?.cast;
  if (!Array.isArray(cast)) return [];
  return cast
    .slice(0, limit)
    .map((c: any) => ({
      name: c?.name,
      character: c?.character || undefined,
      profileUrl: c?.profile_path ? `https://image.tmdb.org/t/p/w185${c.profile_path}` : undefined,
    }))
    .filter((c: TmdbCastMember) => !!c.name);
}

/** US certification from a movie's appended `release_dates`, or a TV `content_ratings`. */
function parseCertification(hit: any): string | undefined {
  const movie = hit?.release_dates?.results;
  if (Array.isArray(movie)) {
    const us = movie.find((r: any) => r?.iso_3166_1 === "US");
    const cert = us?.release_dates?.find((d: any) => d?.certification)?.certification;
    if (cert) return cert;
  }
  const tv = hit?.content_ratings?.results;
  if (Array.isArray(tv)) {
    const us = tv.find((r: any) => r?.iso_3166_1 === "US");
    if (us?.rating) return us.rating;
  }
  return undefined;
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

export interface DiscoverPage {
  results: TmdbTitle[];
  page: number;
  totalPages: number;
}

/** Paginated TV discovery by streaming network (+ optional genre & min-rating). */
export async function discoverTv(
  apiKey: string,
  opts: { networkId?: number; genreIds?: number[]; minRating?: number; page?: number; sortBy?: string },
): Promise<DiscoverPage> {
  const sortBy = opts.sortBy || "popularity.desc";
  // "Top rated" needs a high vote floor or one-vote obscurities win; "Newest"
  // wants a low floor (surface fresh shows) plus a today ceiling to hide
  // future-dated placeholder entries.
  const voteFloor =
    sortBy === "vote_average.desc" ? "150" : sortBy === "first_air_date.desc" ? "10" : "20";
  const params: Record<string, string> = {
    sort_by: sortBy,
    include_adult: "false",
    "vote_count.gte": voteFloor,
    page: String(Math.min(500, Math.max(1, Math.floor(opts.page ?? 1)))),
  };
  if (sortBy === "first_air_date.desc") {
    params["first_air_date.lte"] = new Date().toISOString().slice(0, 10);
  }
  if (opts.networkId) params.with_networks = String(opts.networkId);
  if (opts.genreIds?.length) params.with_genres = opts.genreIds.join(",");
  if (opts.minRating && opts.minRating > 0) params["vote_average.gte"] = String(opts.minRating);
  const data = await tmdbFetch<{ results?: unknown[]; page?: number; total_pages?: number }>(
    apiKey,
    `/discover/tv`,
    params,
  );
  return {
    results: toTitles(data, "tv"),
    page: data?.page ?? opts.page ?? 1,
    totalPages: Math.min(data?.total_pages ?? 1, 500), // TMDB caps discover at page 500
  };
}

/**
 * Paginated list of movies not yet released (primary release date ≥ today),
 * most-anticipated first. Powers the Discover “Coming Soon” tab and the
 * subscribe-to-upcoming feature.
 */
export async function getUpcomingMovies(
  apiKey: string,
  opts: { page?: number } = {},
): Promise<DiscoverPage> {
  const today = new Date().toISOString().slice(0, 10);
  const data = await tmdbFetch<{ results?: unknown[]; page?: number; total_pages?: number }>(
    apiKey,
    `/discover/movie`,
    {
      sort_by: "popularity.desc",
      include_adult: "false",
      "primary_release_date.gte": today,
      "with_release_type": "2|3", // theatrical / theatrical-limited (excludes already-streaming)
      page: String(Math.min(500, Math.max(1, Math.floor(opts.page ?? 1)))),
    },
  );
  return {
    results: toTitles(data, "movie").filter((t) => t.posterUrl),
    page: data?.page ?? opts.page ?? 1,
    totalPages: Math.min(data?.total_pages ?? 1, 500),
  };
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

/**
 * Full movie details for the title modal: base fields (rating, runtime, genres,
 * tagline) plus top-billed cast and the US age certification.
 */
export async function getMovieDetails(apiKey: string, id: number): Promise<TmdbTitle | null> {
  const hit = await tmdbFetch<Record<string, unknown>>(apiKey, `/movie/${id}`, {
    append_to_response: "credits,release_dates",
  });
  if (!hit) return null;
  const base = toTitle(hit, "movie");
  if (!base) return null;
  return { ...base, cast: parseCast(hit), certification: parseCertification(hit) };
}

/** TV details incl. seasons, status, networks — used by the follow scanner. */
export async function getTvDetails(apiKey: string, id: number): Promise<TmdbTvDetails | null> {
  const d = await tmdbFetch<Record<string, unknown>>(apiKey, `/tv/${id}`, {
    append_to_response: "credits,content_ratings",
  });
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
  return {
    ...base,
    status: d.status as string | undefined,
    seasons,
    genres,
    networks,
    backdropUrl,
    cast: parseCast(d),
    certification: parseCertification(d),
  };
}

/** Best YouTube trailer key for a title (prefers an official Trailer), or null. */
export async function getVideoKey(
  apiKey: string,
  type: TmdbMediaType,
  id: number,
): Promise<string | null> {
  const data = await tmdbFetch<{
    results?: Array<{ key?: string; site?: string; type?: string; official?: boolean }>;
  }>(apiKey, `/${type}/${id}/videos`);
  const vids = (data?.results ?? []).filter((v) => v.site === "YouTube" && v.key);
  if (vids.length === 0) return null;
  const rank = (v: { type?: string; official?: boolean }) =>
    (v.type === "Trailer" ? 0 : v.type === "Teaser" ? 1 : 2) - (v.official ? 0.5 : 0);
  vids.sort((a, b) => rank(a) - rank(b));
  return vids[0].key ?? null;
}

/** Recent, well-rated titles of one type that have a backdrop + synopsis. */
export async function getLatestTopRated(
  apiKey: string,
  type: TmdbMediaType,
): Promise<TmdbTitle[]> {
  const dateField = type === "tv" ? "first_air_date" : "primary_release_date";
  const since = new Date(Date.now() - 150 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const until = new Date().toISOString().slice(0, 10);
  const data = await tmdbFetch<{ results?: unknown[] }>(apiKey, `/discover/${type}`, {
    sort_by: "popularity.desc",
    "vote_average.gte": "6.5",
    "vote_count.gte": "80",
    [`${dateField}.gte`]: since,
    [`${dateField}.lte`]: until,
    include_adult: "false",
  });
  return toTitles(data, type).filter((t) => t.backdropUrl && t.overview);
}

/** Merged latest-highly-rated movies + TV for the hero slider (dedup, capped). */
export async function getHeroTitles(apiKey: string, limit = 7): Promise<TmdbTitle[]> {
  const [movies, tv] = await Promise.all([
    getLatestTopRated(apiKey, "movie"),
    getLatestTopRated(apiKey, "tv"),
  ]);
  const merged = [...movies, ...tv].sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0));
  const seen = new Set<string>();
  const out: TmdbTitle[] = [];
  for (const t of merged) {
    const k = `${t.mediaType}-${t.tmdbId}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
    if (out.length >= limit) break;
  }
  return out;
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
    overview: (e.overview as string) || undefined,
    stillUrl: e.still_path ? `https://image.tmdb.org/t/p/w300${e.still_path}` : undefined,
    runtime: typeof e.runtime === "number" ? e.runtime : undefined,
    voteAverage: typeof e.vote_average === "number" ? e.vote_average : undefined,
  }));
}
