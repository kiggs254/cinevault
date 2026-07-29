import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { discoverTv } from "@/lib/metadata/tmdb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Paginated "browse by network" — GET ?network=213&genres=18,10765&rating=7&page=1 */
export async function GET(req: Request) {
  const cfg = await getConfig();
  const headers = { "Cache-Control": "no-store" };
  if (!cfg.tmdb.apiKey) {
    return NextResponse.json({ results: [], page: 1, totalPages: 1 }, { headers });
  }
  const url = new URL(req.url);
  const networkId = Number(url.searchParams.get("network")) || undefined;
  const genreIds = (url.searchParams.get("genres") || "")
    .split(",")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n > 0);
  const minRating = Number(url.searchParams.get("rating")) || undefined;
  const page = Number(url.searchParams.get("page")) || 1;

  const data = await discoverTv(cfg.tmdb.apiKey, { networkId, genreIds, minRating, page });
  return NextResponse.json(data, { headers });
}
