import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { browseCategory, BROWSE_CATEGORIES } from "@/lib/metadata/tmdb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Netflix-style browse rows sourced from TMDB (page 1 of each category). */
export async function GET() {
  const cfg = await getConfig();
  const key = cfg.tmdb.apiKey;
  if (!key) return NextResponse.json({ rows: [], error: "TMDB API key not configured" });

  const keys = Object.keys(BROWSE_CATEGORIES);
  const results = await Promise.all(keys.map((k) => browseCategory(key, k, 1)));
  const rows = results
    .filter((r): r is NonNullable<typeof r> => !!r && r.items.length > 0)
    .map((r) => ({ key: r.key, title: r.title, items: r.items.slice(0, 20) }));

  return NextResponse.json({ rows }, { headers: { "Cache-Control": "private, max-age=1800" } });
}
