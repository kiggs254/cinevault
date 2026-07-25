import type { MediaKind } from "../types";

const IMG_BASE = "https://image.tmdb.org/t/p/w500";

export interface TmdbMeta {
  title: string;
  year?: number;
  overview?: string;
  posterUrl?: string;
  tmdbId?: number;
}

/**
 * Optional metadata enrichment. Returns null when no API key is configured or
 * nothing matches — callers must treat enrichment as best-effort.
 */
export async function enrich(
  apiKey: string | undefined,
  kind: MediaKind,
  title: string,
  year?: number | null,
): Promise<TmdbMeta | null> {
  if (!apiKey) return null;
  const type = kind === "TV" ? "tv" : "movie";
  const params = new URLSearchParams({
    api_key: apiKey,
    query: title,
    include_adult: "false",
  });
  if (year) params.set(type === "tv" ? "first_air_date_year" : "year", String(year));

  try {
    const res = await fetch(
      `https://api.themoviedb.org/3/search/${type}?${params.toString()}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { results?: Array<Record<string, unknown>> };
    const hit = data.results?.[0];
    if (!hit) return null;

    const date = (hit.release_date ?? hit.first_air_date) as string | undefined;
    const poster = hit.poster_path as string | undefined;
    return {
      title: (hit.title ?? hit.name ?? title) as string,
      year: date ? Number(date.slice(0, 4)) : year ?? undefined,
      overview: (hit.overview as string) || undefined,
      posterUrl: poster ? `${IMG_BASE}${poster}` : undefined,
      tmdbId: hit.id as number | undefined,
    };
  } catch {
    return null;
  }
}
