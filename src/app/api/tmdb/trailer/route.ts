import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { getVideoKey } from "@/lib/metadata/tmdb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** YouTube trailer key for a TMDB title, resolved lazily when the user clicks play. */
export async function GET(req: Request) {
  const cfg = await getConfig();
  if (!cfg.tmdb.apiKey) return NextResponse.json({ key: null });
  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  const type = url.searchParams.get("type") === "movie" ? "movie" : "tv";
  if (!id) return NextResponse.json({ key: null });
  const key = await getVideoKey(cfg.tmdb.apiKey, type, id);
  return NextResponse.json({ key }, { headers: { "Cache-Control": "private, max-age=86400" } });
}
