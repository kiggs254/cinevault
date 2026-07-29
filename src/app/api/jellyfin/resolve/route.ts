import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { getSessionUser } from "@/lib/session";
import { findItemIdByTmdb, getServerId } from "@/lib/jellyfin/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Resolve a "Play on Jellyfin" deep link for an owned title.
 * GET ?tmdbId=123&type=movie|tv → { url } (the public Jellyfin details page).
 */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const cfg = await getConfig();
  const publicUrl = cfg.jellyfin.publicUrl;
  if (!cfg.jellyfin.url || !cfg.jellyfin.apiKey || !publicUrl) {
    return NextResponse.json({ error: "Jellyfin not configured" }, { status: 503 });
  }

  const params = new URL(req.url).searchParams;
  const tmdbId = Number(params.get("tmdbId"));
  const type = params.get("type") === "tv" ? "tv" : "movie";
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    return NextResponse.json({ error: "bad tmdbId" }, { status: 400 });
  }

  const itemId = await findItemIdByTmdb(cfg.jellyfin, tmdbId, type);
  if (!itemId) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const serverId = await getServerId(cfg.jellyfin);
  const base = publicUrl.replace(/\/+$/, "");
  const url = `${base}/web/#/details?id=${itemId}${serverId ? `&serverId=${serverId}` : ""}`;
  return NextResponse.json({ itemId, serverId, url }, { headers: { "Cache-Control": "no-store" } });
}
