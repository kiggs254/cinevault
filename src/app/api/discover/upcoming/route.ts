import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { getUpcomingMovies } from "@/lib/metadata/tmdb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Paginated "coming soon" movies (not yet released). GET ?page=1 */
export async function GET(req: Request) {
  const cfg = await getConfig();
  const headers = { "Cache-Control": "no-store" };
  if (!cfg.tmdb.apiKey) {
    return NextResponse.json({ results: [], page: 1, totalPages: 1 }, { headers });
  }
  const page = Number(new URL(req.url).searchParams.get("page")) || 1;
  const data = await getUpcomingMovies(cfg.tmdb.apiKey, { page });
  return NextResponse.json(data, { headers });
}
