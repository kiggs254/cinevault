import { NextResponse } from "next/server";
import { getSessionUser, isAdmin } from "@/lib/session";
import { getConfig } from "@/lib/config";
import { getLiveTvKey, liveTvUrls, hasEpg, listPlaylists } from "@/lib/livetv/service";
import { getLiveTvStatus } from "@/lib/jellyfin/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The connect URLs (with key) + current Jellyfin wiring, for the Live TV page (admin). */
export async function GET() {
  const user = await getSessionUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const cfg = await getConfig();
  const key = await getLiveTvKey();
  const urls = liveTvUrls(cfg.appUrl, key);
  const epg = await hasEpg();
  const playlists = await listPlaylists();
  const channels = playlists.filter((p) => p.enabled).reduce((n, p) => n + p.channelCount, 0);

  const jellyfinReady = !!(cfg.jellyfin.url && cfg.jellyfin.apiKey);
  let jellyfin = {
    ready: jellyfinReady,
    reachable: false,
    tunerConfigured: false,
    guideConfigured: false,
  };
  if (jellyfinReady) {
    const s = await getLiveTvStatus(cfg.jellyfin, {
      m3uUrl: urls.m3u,
      epgUrl: epg ? urls.epg : undefined,
    });
    jellyfin = { ...jellyfin, ...s };
  }

  return NextResponse.json(
    {
      m3uUrl: urls.m3u,
      epgUrl: urls.epg,
      hasEpg: epg,
      channels,
      jellyfinPublicUrl: cfg.jellyfin.publicUrl ?? null,
      jellyfin,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
