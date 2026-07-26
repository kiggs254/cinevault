import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { getTrending, getPopular, getTopRated } from "@/lib/metadata/tmdb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Netflix-style browse rows sourced from TMDB. */
export async function GET() {
  const cfg = await getConfig();
  const key = cfg.tmdb.apiKey;
  if (!key) return NextResponse.json({ rows: [], error: "TMDB API key not configured" });

  const [trending, popMovies, popTv, topMovies, topTv] = await Promise.all([
    getTrending(key, "all"),
    getPopular(key, "movie"),
    getPopular(key, "tv"),
    getTopRated(key, "movie"),
    getTopRated(key, "tv"),
  ]);

  const rows = [
    { title: "Trending this week", items: trending },
    { title: "Popular movies", items: popMovies },
    { title: "Popular TV shows", items: popTv },
    { title: "Top rated movies", items: topMovies },
    { title: "Top rated TV", items: topTv },
  ]
    .map((r) => ({ title: r.title, items: r.items.filter((i) => i.posterUrl).slice(0, 20) }))
    .filter((r) => r.items.length > 0);

  return NextResponse.json({ rows }, { headers: { "Cache-Control": "private, max-age=1800" } });
}
