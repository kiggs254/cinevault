import { NextResponse } from "next/server";
import { grabMovie, grabSingleEpisode } from "@/lib/service/downloads";
import { startShow } from "@/lib/service/follows";
import { enqueueSeasonGrab } from "@/lib/queue";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  tmdbId?: number;
  mediaType?: string;
  title?: string;
  year?: number | null;
  seasons?: number[];
  season?: number;
  episode?: number;
  startSeason?: number; // TV: begin here and auto-advance later seasons by watch progress
}

/** Direct download from a TMDB title: a movie, or one/more full seasons (packs). */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const b = (await req.json().catch(() => ({}))) as Body;
  const tmdbId = Number(b.tmdbId);
  const title = (b.title ?? "").trim();
  if (!tmdbId || !title) {
    return NextResponse.json({ error: "tmdbId and title are required" }, { status: 400 });
  }

  try {
    if (b.mediaType === "movie") {
      const dl = await grabMovie({ tmdbId, title, year: b.year ?? null, userId: user.id, announce: true });
      return dl
        ? NextResponse.json({ queued: [dl.title] })
        : NextResponse.json({ error: "No suitable release found" }, { status: 404 });
    }

    // Single episode.
    if (b.season != null && b.episode != null) {
      const ok = await grabSingleEpisode({
        tmdbId,
        title,
        season: b.season,
        episode: b.episode,
        year: b.year ?? null,
        userId: user.id,
      });
      return NextResponse.json(
        ok
          ? { queued: [`S${b.season}E${b.episode}`], totalQueued: 1 }
          : { queued: [], failed: [b.episode], totalQueued: 0 },
      );
    }

    // Preferred TV path: start the member at one season and auto-advance from there.
    if (typeof b.startSeason === "number" && b.startSeason >= 1) {
      const startSeason = Math.trunc(b.startSeason);
      await startShow({ tmdbId, title, year: b.year ?? null, startSeason, userId: user.id });
      return NextResponse.json({ started: true, startSeason, queued: [`Season ${startSeason}`] });
    }

    const seasons = Array.isArray(b.seasons) ? b.seasons.filter((n) => Number.isInteger(n) && n > 0) : [];
    if (seasons.length === 0) {
      return NextResponse.json({ error: "Select at least one season" }, { status: 400 });
    }
    // Hand each season to a background job that walks it pack-or-episode-by-episode
    // (search all indexers, no per-episode Telegram push). Returns immediately.
    for (const s of seasons) {
      await enqueueSeasonGrab({ tmdbId, title, year: b.year ?? null, season: s, notify: false, userId: user.id });
    }
    return NextResponse.json({
      scheduled: seasons.length,
      seasons,
      queued: seasons.map((s) => `Season ${s}`),
      failed: [],
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
