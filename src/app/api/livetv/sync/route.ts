import { NextResponse } from "next/server";
import { getSessionUser, isAdmin } from "@/lib/session";
import { getConfig } from "@/lib/config";
import { getLiveTvKey, liveTvUrls, hasEpg } from "@/lib/livetv/service";
import { syncLiveTv } from "@/lib/jellyfin/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One-click: point Jellyfin's Live TV at our aggregated M3U + EPG (admin). */
export async function POST() {
  const user = await getSessionUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const cfg = await getConfig();
  if (!cfg.jellyfin.url || !cfg.jellyfin.apiKey) {
    return NextResponse.json({
      ok: false,
      message: "Set the Jellyfin URL + API key in Settings → Media first",
    });
  }
  const key = await getLiveTvKey();
  const urls = liveTvUrls(cfg.appUrl, key);
  const epg = await hasEpg();
  const result = await syncLiveTv(cfg.jellyfin, {
    m3uUrl: urls.m3u,
    epgUrl: epg ? urls.epg : undefined,
  });
  return NextResponse.json(result);
}
