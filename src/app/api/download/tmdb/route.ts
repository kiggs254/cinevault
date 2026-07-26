import { NextResponse } from "next/server";
import { grabMovie, grabSingleEpisode } from "@/lib/service/downloads";
import { enqueueSeasonGrab } from "@/lib/queue";

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
}

/** Direct download from a TMDB title: a movie, or one/more full seasons (packs). */
export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Body;
  const tmdbId = Number(b.tmdbId);
  const title = (b.title ?? "").trim();
  if (!tmdbId || !title) {
    return NextResponse.json({ error: "tmdbId and title are required" }, { status: 400 });
  }

  try {
    if (b.mediaType === "movie") {
      const dl = await grabMovie({ tmdbId, title, year: b.year ?? null });
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
      });
      return NextResponse.json(
        ok
          ? { queued: [`S${b.season}E${b.episode}`], totalQueued: 1 }
          : { queued: [], failed: [b.episode], totalQueued: 0 },
      );
    }

    const seasons = Array.isArray(b.seasons) ? b.seasons.filter((n) => Number.isInteger(n) && n > 0) : [];
    if (seasons.length === 0) {
      return NextResponse.json({ error: "Select at least one season" }, { status: 400 });
    }
    // Hand each season to a background job that walks it pack-or-episode-by-episode
    // (search all indexers, no per-episode Telegram push). Returns immediately.
    for (const s of seasons) {
      await enqueueSeasonGrab({ tmdbId, title, year: b.year ?? null, season: s, notify: false });
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
