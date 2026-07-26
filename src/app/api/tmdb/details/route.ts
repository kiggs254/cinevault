import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { getTvDetails, getMovieDetails } from "@/lib/metadata/tmdb";
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
    select: { season: true, episode: true, kind: true },
  });
  const ownedMovie = owned.some((o) => o.kind === "MOVIE");
  // A season counts as owned only when a whole-season pack exists (episode null)
  // OR every episode is present — so a partially-grabbed recent season stays
  // clickable for re-grab instead of showing as complete.
  const packSeasons = new Set<number>();
  const epsBySeason = new Map<number, Set<number>>();
  for (const o of owned) {
    if (o.season == null) continue;
    if (o.episode == null) {
      packSeasons.add(o.season);
      continue;
    }
    (epsBySeason.get(o.season) ?? epsBySeason.set(o.season, new Set()).get(o.season)!).add(o.episode);
  }

  if (type === "movie") {
    const d = await getMovieDetails(cfg.tmdb.apiKey, id);
    if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ details: { ...d, ownedMovie } });
  }

  const d = await getTvDetails(cfg.tmdb.apiKey, id);
  if (!d) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const today = new Date().toISOString().slice(0, 10);
  const seasons = d.seasons.map((s) => {
    const ownedEps = epsBySeason.get(s.seasonNumber)?.size ?? 0;
    const owned =
      packSeasons.has(s.seasonNumber) || (s.episodeCount > 0 && ownedEps >= s.episodeCount);
    return {
      ...s,
      released: !!s.airDate && s.airDate <= today && s.episodeCount > 0,
      owned,
      ownedEpisodes: ownedEps,
    };
  });
  return NextResponse.json({ details: { ...d, seasons } });
}
