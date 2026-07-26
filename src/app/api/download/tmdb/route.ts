import { NextResponse } from "next/server";
import { grabMovie, grabSeason, type SeasonGrabResult } from "@/lib/service/downloads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Body {
  tmdbId?: number;
  mediaType?: string;
  title?: string;
  year?: number | null;
  seasons?: number[];
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

    const seasons = Array.isArray(b.seasons) ? b.seasons.filter((n) => Number.isInteger(n) && n > 0) : [];
    if (seasons.length === 0) {
      return NextResponse.json({ error: "Select at least one season" }, { status: 400 });
    }
    // Bulk manual grab: search all indexers, no per-episode Telegram push.
    const results: SeasonGrabResult[] = [];
    const queued: string[] = [];
    const failed: number[] = [];
    let totalQueued = 0;
    for (const s of seasons) {
      const r = await grabSeason({ tmdbId, title, season: s, year: b.year ?? null, notify: false });
      results.push(r);
      totalQueued += r.queued;
      if (r.queued > 0) {
        queued.push(
          r.mode === "pack"
            ? `Season ${s} (pack)`
            : `Season ${s} (${r.queued} ep${r.queued === 1 ? "" : "s"})`,
        );
      } else {
        failed.push(s);
      }
    }
    return NextResponse.json({ queued, failed, totalQueued, seasons: results });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
