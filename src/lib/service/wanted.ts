import { prisma } from "../db";
import { getConfig } from "../config";
import { getMovieDetails } from "../metadata/tmdb";
import { grabMovie } from "./downloads";
import { notify, notifyUser } from "../telegram/client";
import type { WantedMovie } from "@prisma/client";

/**
 * Subscribe to an upcoming / not-yet-available movie for a member. Once a real
 * (non-cam, ≥720p) release shows up, the scheduled scan grabs it. Idempotent.
 */
export async function subscribeMovie(tmdbId: number, userId: string): Promise<WantedMovie | null> {
  const cfg = await getConfig();
  if (!cfg.tmdb.apiKey) return null;
  const existing = await prisma.wantedMovie.findFirst({ where: { tmdbId, userId } });
  if (existing) return existing;
  const d = await getMovieDetails(cfg.tmdb.apiKey, tmdbId);
  if (!d) return null;
  return prisma.wantedMovie.create({
    data: {
      tmdbId,
      userId,
      title: d.title,
      year: d.year ?? null,
      posterUrl: d.posterUrl ?? null,
      overview: d.overview ?? null,
      releaseDate: d.releaseDate ? new Date(d.releaseDate) : null,
    },
  });
}

/** Cancel a member's movie subscription (by TMDB id). */
export async function unsubscribeMovie(tmdbId: number, userId: string): Promise<void> {
  await prisma.wantedMovie.deleteMany({ where: { tmdbId, userId } });
}

/** A member's subscriptions — still-waiting first, soonest release first. */
export async function listWanted(userId: string): Promise<WantedMovie[]> {
  return prisma.wantedMovie.findMany({
    where: { userId },
    orderBy: [{ status: "asc" }, { releaseDate: "asc" }, { createdAt: "desc" }],
  });
}

/** tmdbIds a member is subscribed to — for badging Discover cards. */
export async function wantedTmdbIds(userId: string): Promise<number[]> {
  const rows = await prisma.wantedMovie.findMany({ where: { userId }, select: { tmdbId: true } });
  return rows.map((r) => r.tmdbId);
}

/**
 * Fulfill every member's waiting subscriptions: for each movie past its release
 * date, search for a real (non-cam, ≥720p) release and, if found, queue it for
 * that member and notify them. Never grabs a cam — it keeps waiting.
 */
export async function scanWantedMovies(): Promise<{ scanned: number; grabbed: number }> {
  const cfg = await getConfig();
  if (!cfg.tmdb.apiKey || !cfg.prowlarr.url) return { scanned: 0, grabbed: 0 };
  const waiting = await prisma.wantedMovie.findMany({ where: { status: "waiting" } });
  const now = Date.now();
  let scanned = 0;
  let grabbed = 0;
  for (const w of waiting) {
    // No point searching before the theatrical release — a real rip won't exist yet.
    if (w.releaseDate && w.releaseDate.getTime() > now) continue;
    scanned++;
    try {
      const dl = await grabMovie({
        tmdbId: w.tmdbId,
        title: w.title,
        year: w.year,
        requireNonCam: true,
        userId: w.userId,
      });
      if (dl) {
        await prisma.wantedMovie.update({
          where: { id: w.id },
          data: { status: "grabbed", lastCheckedAt: new Date() },
        });
        grabbed++;
        const text = `🎬 “${w.title}” is available — downloading now.`;
        const opts = { photo: w.posterUrl, buttons: [{ text: "View downloads", path: "/downloads" }] };
        if (w.userId) await notifyUser(w.userId, text, opts);
        else await notify(text, opts);
      } else {
        await prisma.wantedMovie.update({
          where: { id: w.id },
          data: { lastCheckedAt: new Date() },
        });
      }
    } catch (err) {
      console.error(`[wanted] scan failed for “${w.title}”:`, err);
    }
  }
  return { scanned, grabbed };
}
