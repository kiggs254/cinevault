import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { searchTitles, getTrending } from "@/lib/metadata/tmdb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Lightweight TMDB search used by the "Follow a show" picker in Discover. */
export async function GET(req: Request) {
  const cfg = await getConfig();
  if (!cfg.tmdb.apiKey) return NextResponse.json({ results: [], error: "TMDB not configured" });
  const url = new URL(req.url);
  const q = (url.searchParams.get("q") ?? "").trim();
  const type = url.searchParams.get("type") === "movie" ? "movie" : "tv";

  // No query → trending TV as follow suggestions.
  if (!q) {
    const trending = (await getTrending(cfg.tmdb.apiKey, "tv")).slice(0, 12);
    return NextResponse.json({ results: trending });
  }
  const results = await searchTitles(cfg.tmdb.apiKey, type, q, 10);
  return NextResponse.json({ results });
}
