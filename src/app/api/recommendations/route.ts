import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { getConfig } from "@/lib/config";
import { enqueueJob } from "@/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The redesigned Discover feed: personalized TMDB titles + the taste summary. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [recs, cfg] = await Promise.all([
    prisma.recommendation.findMany({
      where: { status: "new", userId: user.id },
      orderBy: [{ score: "desc" }, { createdAt: "desc" }],
      take: 60,
    }),
    getConfig(),
  ]);
  return NextResponse.json(
    {
      taste: cfg.tasteProfile,
      hasTmdb: !!cfg.tmdb.apiKey,
      hasJellyfin: !!(cfg.jellyfin.url && cfg.jellyfin.apiKey),
      recommendations: recs.map((r) => ({
        id: r.id,
        tmdbId: r.tmdbId,
        mediaType: r.mediaType,
        title: r.title,
        year: r.year,
        posterUrl: r.posterUrl,
        overview: r.overview,
        reason: r.reason,
        score: r.score,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Rebuild the feed (runs in the worker; poll GET afterwards). */
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  await enqueueJob("reco-refresh");
  return NextResponse.json({ queued: true });
}
