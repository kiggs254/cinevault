import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { getTvDetails, getTitle } from "@/lib/metadata/tmdb";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Detail payload for the title modal: overview, backdrop, and (TV) seasons. */
export async function GET(req: Request) {
  const cfg = await getConfig();
  if (!cfg.tmdb.apiKey) return NextResponse.json({ error: "TMDB not configured" }, { status: 400 });
  const url = new URL(req.url);
  const id = Number(url.searchParams.get("id"));
  const type = url.searchParams.get("type") === "movie" ? "movie" : "tv";
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  // Which seasons/movies are already downloaded (for the UI to show "owned").
  const owned = await prisma.download.findMany({
    where: { tmdbId: id, status: { notIn: ["FAILED", "CANCELLED"] } },
    select: { season: true, kind: true },
  });
  const ownedSeasons = new Set(owned.filter((o) => o.season != null).map((o) => o.season as number));
  const ownedMovie = owned.some((o) => o.kind === "MOVIE");

  if (type === "movie") {
    const d = await getTitle(cfg.tmdb.apiKey, "movie", id);
    if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ details: { ...d, ownedMovie } });
  }

  const d = await getTvDetails(cfg.tmdb.apiKey, id);
  if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const today = new Date().toISOString().slice(0, 10);
  const seasons = d.seasons.map((s) => ({
    ...s,
    released: !!s.airDate && s.airDate <= today && s.episodeCount > 0,
    owned: ownedSeasons.has(s.seasonNumber),
  }));
  return NextResponse.json({ details: { ...d, seasons } });
}
