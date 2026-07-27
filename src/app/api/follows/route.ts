import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { followShow } from "@/lib/service/follows";
import { enqueueJob } from "@/lib/queue";
import { getConfig } from "@/lib/config";
import { getTitle } from "@/lib/metadata/tmdb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const shows = await prisma.followedShow.findMany({ orderBy: { createdAt: "desc" } });

  // Backfill posters for follows created without one (auto-follow / season-grab),
  // and persist them so the grid isn't full of placeholders.
  const key = (await getConfig()).tmdb.apiKey;
  if (key) {
    await Promise.all(
      shows.map(async (s) => {
        if (s.posterUrl || !s.tmdbId) return;
        const t = await getTitle(key, "tv", s.tmdbId).catch(() => null);
        if (t?.posterUrl) {
          s.posterUrl = t.posterUrl;
          await prisma.followedShow
            .update({ where: { id: s.id }, data: { posterUrl: t.posterUrl } })
            .catch(() => {});
        }
      }),
    );
  }

  return NextResponse.json(
    {
      shows: shows.map((s) => ({
        id: s.id,
        tmdbId: s.tmdbId,
        title: s.title,
        year: s.year,
        posterUrl: s.posterUrl,
        status: s.status,
        autoDownload: s.autoDownload,
        quality: s.quality,
        source: s.source,
        lastCheckedAt: s.lastCheckedAt ? s.lastCheckedAt.toISOString() : null,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as {
    tmdbId?: number;
    autoDownload?: boolean;
    quality?: string;
  };
  const tmdbId = Number(b.tmdbId);
  if (!tmdbId) return NextResponse.json({ error: "tmdbId is required" }, { status: 400 });
  const show = await followShow(tmdbId, {
    source: "manual",
    autoDownload: b.autoDownload !== false,
    quality: typeof b.quality === "string" ? b.quality : "any",
  });
  if (!show) return NextResponse.json({ error: "Could not resolve show on TMDB" }, { status: 400 });
  void enqueueJob("follow-scan"); // grab any already-aired episodes right away
  return NextResponse.json({ show });
}
