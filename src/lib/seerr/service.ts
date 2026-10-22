/**
 * JellyBridge → Seerr → Cinevault.
 *
 * Members browse a "Discover" library inside Jellyfin (the JellyBridge plugin)
 * and press ♥ on anything they want. JellyBridge files that as a Seerr request in
 * the member's name; Seerr has no Radarr/Sonarr, so instead of handing it on it
 * fires a webhook at us, and we download it into that member's library exactly as
 * if they'd asked in Cinevault. Once the file lands in Jellyfin, Seerr's own
 * library scan marks it available and JellyBridge drops the placeholder.
 */
import { prisma } from "../db";
import { getConfig } from "../config";
import { getRedisPub } from "../redis";
import { getMovieDetails, getTvDetails } from "../metadata/tmdb";
import { enqueueTmdbRequest, enqueueSeasonGrab } from "../queue";
import { grabMovie } from "../service/downloads";
import { startShow } from "../service/follows";
import { subscribeMovie } from "../service/wanted";
import { logActivity } from "../activity";
import { notifyActivity } from "../telegram/client";
import { getSeerrRequest, importJellyfinUsers, normalizeJellyfinId, seerrReady } from "./client";
import { jellyfinReady } from "../jellyfin/client";
import { hidePlaceholderLibraryFromLatest } from "../jellyfin/admin";
import type { TmdbRequestData } from "../types";

/** The webhook JSON we configure Seerr to send (its {{template}} variables). */
export interface SeerrWebhookPayload {
  notification_type?: string;
  subject?: string;
  request_id?: string;
}

/** Seerr notifications that mean "this request should now be downloaded". */
const ACT_ON = new Set(["MEDIA_AUTO_APPROVED", "MEDIA_APPROVED"]);
/** How long a handled request id is remembered, so a resent webhook is a no-op. */
const DEDUPE_TTL_S = 30 * 24 * 60 * 60;

/** The Cinevault member behind a Jellyfin account (falls back to the admin). */
async function resolveRequester(jellyfinUserId: string | null): Promise<{ id: string; username: string } | null> {
  if (jellyfinUserId) {
    const users = await prisma.user.findMany({
      where: { jellyfinUserId: { not: null } },
      select: { id: true, username: true, status: true, jellyfinUserId: true },
    });
    const u = users.find((x) => normalizeJellyfinId(x.jellyfinUserId) === jellyfinUserId);
    if (u) return u.status === "active" ? { id: u.id, username: u.username } : null;
  }
  // Seerr's owner is the Jellyfin admin account, which may have no member row.
  const admin = await prisma.user.findFirst({
    where: { role: "admin", status: "active" },
    select: { id: true, username: true },
  });
  return admin;
}

/** "Dune (2021)" → { title: "Dune", year: 2021 } — only used if TMDB is unavailable. */
function parseSubject(subject: string | undefined): { title: string; year: number | null } {
  const m = /^(.*?)\s*\((\d{4})\)\s*$/.exec(subject ?? "");
  return m ? { title: m[1].trim(), year: Number(m[2]) } : { title: (subject ?? "").trim(), year: null };
}

/**
 * Handle one Seerr webhook. Returns the HTTP status/message to answer with.
 * The webhook body is only a trigger: what to download, and for whom, always
 * comes from Seerr's own API, so a forged body can't invent a request.
 */
export async function handleSeerrNotification(
  p: SeerrWebhookPayload,
): Promise<{ status: number; message: string }> {
  const type = (p.notification_type ?? "").trim();
  if (type === "TEST_NOTIFICATION") return { status: 200, message: "Cinevault received the test" };
  if (!ACT_ON.has(type)) return { status: 200, message: `ignored ${type || "unknown"} notification` };

  const requestId = Number(p.request_id);
  if (!Number.isInteger(requestId) || requestId <= 0) return { status: 400, message: "request_id missing" };

  const cfg = await getConfig();
  if (!seerrReady(cfg.seerr)) return { status: 503, message: "Seerr API is not configured in Cinevault" };

  let req;
  try {
    req = await getSeerrRequest(cfg.seerr, requestId);
  } catch (e) {
    return { status: 502, message: (e as Error).message };
  }
  const tmdbId = req.media?.tmdbId;
  const mediaType = req.type === "tv" ? "tv" : "movie";
  if (!tmdbId) return { status: 422, message: `request ${requestId} has no TMDB id` };

  const user = await resolveRequester(normalizeJellyfinId(req.requestedBy?.jellyfinUserId));
  if (!user) return { status: 200, message: "requester is not an active member — ignored" };

  // Seerr can resend, and a request can be approved after being auto-approved.
  const redis = getRedisPub();
  const key = `seerr:req:${requestId}`;
  const fresh = await redis.set(key, "1", "EX", DEDUPE_TTL_S, "NX").catch(() => "OK");
  if (fresh !== "OK") return { status: 200, message: `request ${requestId} already handled` };

  let title = "";
  let year: number | null = null;
  if (cfg.tmdb.apiKey) {
    const d =
      mediaType === "movie"
        ? await getMovieDetails(cfg.tmdb.apiKey, tmdbId).catch(() => null)
        : await getTvDetails(cfg.tmdb.apiKey, tmdbId).catch(() => null);
    if (d) {
      title = d.title;
      year = d.year ?? null;
    }
  }
  if (!title) ({ title, year } = parseSubject(p.subject));
  if (!title) {
    await redis.del(key).catch(() => {});
    return { status: 422, message: `couldn't resolve a title for TMDB ${tmdbId}` };
  }

  const seasons = (req.seasons ?? [])
    .map((s) => s.seasonNumber)
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b);

  try {
    await enqueueTmdbRequest({
      tmdbId,
      mediaType,
      title,
      year,
      seasons,
      userId: user.id,
      seerrRequestId: requestId,
    });
  } catch (e) {
    await redis.del(key).catch(() => {}); // let Seerr's retry try again
    return { status: 503, message: `couldn't queue: ${(e as Error).message}` };
  }
  void logActivity(`💜 ${user.username} requested “${title}” from Jellyfin`, { kind: "info", title });
  return { status: 202, message: `queued ${mediaType} “${title}” for ${user.username}` };
}

/**
 * Download a Jellyfin-originated request into the member's library — the same
 * paths a request made in Cinevault takes. A movie with no good copy yet becomes
 * a subscription, so it arrives on its own once a proper release appears.
 */
export async function fulfilTmdbRequest(r: TmdbRequestData): Promise<void> {
  if (r.mediaType === "movie") {
    const dl = await grabMovie({ tmdbId: r.tmdbId, title: r.title, year: r.year, userId: r.userId, announce: true });
    if (dl) return;
    await subscribeMovie(r.tmdbId, r.userId);
    await notifyActivity(
      r.userId,
      `🔎 No good copy of “${r.title}” yet — I'll grab it automatically as soon as one appears.`,
      { buttons: [{ text: "📚 Open your library", path: "/library" }] },
    );
    return;
  }
  // One season (JellyBridge's "first season only") → follow the show from there,
  // so later seasons arrive as the member watches. Several → grab each.
  if (r.seasons.length <= 1) {
    await startShow({ tmdbId: r.tmdbId, title: r.title, year: r.year, startSeason: r.seasons[0] ?? 1, userId: r.userId });
    return;
  }
  for (const season of r.seasons) {
    await enqueueSeasonGrab({ tmdbId: r.tmdbId, title: r.title, year: r.year, season, notify: false, userId: r.userId });
  }
}

/**
 * JellyBridge housekeeping, run every 6 hours: make sure every active member
 * exists in Seerr (JellyBridge can only file a ♥ for someone Seerr knows) and
 * that the placeholder library stays off everyone's "Recently added" row —
 * including members approved since the last run. Idempotent.
 */
export async function syncSeerrUsers(): Promise<{ imported: number; latestHiddenFor: number }> {
  const cfg = await getConfig();
  const latestHiddenFor = jellyfinReady(cfg.jellyfin)
    ? await hidePlaceholderLibraryFromLatest(cfg.jellyfin).catch(() => 0)
    : 0;
  if (!seerrReady(cfg.seerr)) return { imported: 0, latestHiddenFor };
  const users = await prisma.user.findMany({
    where: { status: "active", jellyfinUserId: { not: null } },
    select: { jellyfinUserId: true },
  });
  const imported = await importJellyfinUsers(
    cfg.seerr,
    users.map((u) => u.jellyfinUserId as string),
  );
  return { imported, latestHiddenFor };
}
