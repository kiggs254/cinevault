import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { getGenres } from "@/lib/metadata/tmdb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** TV genres for the Discover → Networks genre filter. */
export async function GET() {
  const cfg = await getConfig();
  const genres = cfg.tmdb.apiKey ? await getGenres(cfg.tmdb.apiKey, "tv") : [];
  return NextResponse.json({ genres }, { headers: { "Cache-Control": "no-store" } });
}
