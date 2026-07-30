import { getConfig } from "@/lib/config";
import { buildMergedM3u, keyMatches } from "@/lib/livetv/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The aggregated M3U that Jellyfin's Live TV M3U tuner loads. Public but gated
 * by the `?key=` bearer (mismatch → 404, so the endpoint stays unadvertised).
 */
export async function GET(req: Request) {
  const key = new URL(req.url).searchParams.get("key");
  const cfg = await getConfig();
  if (!keyMatches(key, cfg.liveTv.key)) {
    return new Response("Not found", { status: 404 });
  }
  const body = await buildMergedM3u();
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "application/x-mpegurl; charset=utf-8",
      "Content-Disposition": 'inline; filename="cinevault.m3u"',
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-store",
    },
  });
}
