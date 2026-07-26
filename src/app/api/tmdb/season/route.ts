import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { getSeasonEpisodes } from "@/lib/metadata/tmdb";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A season's episodes enriched with aired/owned state and the matching download. */
export async function GET(req: Request) {
  const cfg = await getConfig();
  if (!cfg.tmdb.apiKey) return NextResponse.json({ error: "TMDB not configured" }, { status: 400 });
  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  const season = Number(url.searchParams.get("season"));
  if (!id || !Number.isInteger(season) || season < 0) {
    return NextResponse.json({ error: "id and season required" }, { status: 400 });
  }

  const eps = await getSeasonEpisodes(cfg.tmdb.apiKey, id, season);

  // Per-episode downloads (individual files → individually playable).
  const dls = await prisma.download.findMany({
    where: { tmdbId: id, season, episode: { not: null }, status: { notIn: ["FAILED", "CANCELLED"] } },
    select: { id: true, episode: true, s3Key: true, sizeBytes: true, status: true },
    orderBy: { createdAt: "desc" },
  });
  const byEp = new Map<number, (typeof dls)[number]>();
  for (const d of dls) if (d.episode != null && !byEp.has(d.episode)) byEp.set(d.episode, d);

  // A whole-season pack (episode = null) covers every aired episode even though
  // there's no per-episode row. Prefer a completed one for status.
  const packs = await prisma.download.findMany({
    where: { tmdbId: id, season, episode: null, status: { notIn: ["FAILED", "CANCELLED"] } },
    select: { id: true, status: true },
    orderBy: { createdAt: "desc" },
  });
  const pack = packs.find((p) => p.status === "COMPLETED") ?? packs[0] ?? null;

  const today = new Date().toISOString().slice(0, 10);
  const episodes = eps.map((e) => {
    const d = byEp.get(e.episodeNumber);
    const released = !!e.airDate && e.airDate <= today;
    // Owned if we have this exact episode, or a season pack covers the aired season.
    const owned = !!d || (!!pack && released);
    return {
      episodeNumber: e.episodeNumber,
      name: e.name ?? null,
      overview: e.overview ?? null,
      stillUrl: e.stillUrl ?? null,
      airDate: e.airDate ?? null,
      runtime: e.runtime ?? null,
      voteAverage: e.voteAverage ?? null,
      released,
      owned,
      // Per-episode file is individually openable; a pack marks the episode owned
      // (no per-episode key to stream — the pack plays from its own Library card).
      download: d
        ? { id: d.id, s3Key: d.s3Key, sizeBytes: Number(d.sizeBytes), status: d.status }
        : owned && pack
          ? { id: pack.id, s3Key: null, sizeBytes: 0, status: pack.status }
          : null,
    };
  });

  return NextResponse.json({ episodes }, { headers: { "Cache-Control": "no-store" } });
}
