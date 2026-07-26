import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { browseCategory } from "@/lib/metadata/tmdb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One page of a browse category, for the "Show all" paginated page. */
export async function GET(req: Request) {
  const cfg = await getConfig();
  if (!cfg.tmdb.apiKey) return NextResponse.json({ error: "TMDB not configured" }, { status: 400 });
  const url = new URL(req.url);
  const key = url.searchParams.get("key") ?? "";
  const page = Number(url.searchParams.get("page")) || 1;

  const result = await browseCategory(cfg.tmdb.apiKey, key, page);
  if (!result) return NextResponse.json({ error: "Unknown category" }, { status: 404 });
  return NextResponse.json(result, { headers: { "Cache-Control": "private, max-age=600" } });
}
