import { getConfig } from "@/lib/config";
import { buildMergedEpg, keyMatches } from "@/lib/livetv/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The aggregated XMLTV guide that Jellyfin's Live TV loads. Public but gated by
 * the `?key=` bearer (mismatch → 404).
 */
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key");
  const cfg = await getConfig();
  if (!keyMatches(key, cfg.liveTv.key)) {
    return new Response("Not found", { status: 404 });
  }
  const body = await buildMergedEpg();
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Content-Disposition": 'inline; filename="cinevault-epg.xml"',
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
