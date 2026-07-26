import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { getHeroTitles } from "@/lib/metadata/tmdb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Latest highly-rated movies + TV (with backdrops) for the landing hero slider. */
export async function GET() {
  const cfg = await getConfig();
  if (!cfg.tmdb.apiKey) return NextResponse.json({ items: [] });
  try {
    const items = await getHeroTitles(cfg.tmdb.apiKey);
    return NextResponse.json({ items }, { headers: { "Cache-Control": "private, max-age=1800" } });
  } catch {
    return NextResponse.json({ items: [] });
  }
}
