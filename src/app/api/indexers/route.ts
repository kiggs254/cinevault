import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { ProwlarrClient } from "@/lib/indexers/prowlarr";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** List Prowlarr indexers so the user can choose which are allowed for automation. */
export async function GET() {
  const cfg = await getConfig();
  if (!cfg.prowlarr.url || !cfg.prowlarr.apiKey) {
    return NextResponse.json({ indexers: [] });
  }
  try {
    const indexers = await new ProwlarrClient(cfg.prowlarr).listIndexers();
    return NextResponse.json({ indexers }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ indexers: [], error: (e as Error).message });
  }
}
