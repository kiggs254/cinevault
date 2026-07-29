import { NextResponse } from "next/server";
import type { DownloadStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { getConfig } from "@/lib/config";
import { getMovieDetails, getTvDetails } from "@/lib/metadata/tmdb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Genres aren't stored per download, so resolve them from TMDB on demand and
// cache per title for the process lifetime (the library is a bounded set).
const genreCache = new Map<number, string[]>();
async function titleGenres(apiKey: string, tmdbId: number, kind: string): Promise<string[]> {
  const cached = genreCache.get(tmdbId);
  if (cached) return cached;
  try {
    const d = kind === "TV" ? await getTvDetails(apiKey, tmdbId) : await getMovieDetails(apiKey, tmdbId);
    const genres = (d?.genres ?? []).slice(0, 4);
    genreCache.set(tmdbId, genres);
    return genres;
  } catch {
    return [];
  }
}

interface Item {
  id: string;
  releaseName: string;
  season: number | null;
  episode: number | null;
  status: string;
  progress: number;
  sizeBytes: number;
  s3Key: string | null;
}
interface Group {
  key: string;
  title: string;
  posterUrl: string | null;
  year: number | null;
  kind: string;
  tmdbId: number | null;
  genres: string[];
  count: number; // ready-to-watch files
  downloading: boolean; // any part still being added
  sizeBytes: number;
  items: Item[];
}

const ACTIVE: DownloadStatus[] = ["QUEUED", "SEARCHING", "DOWNLOADING", "UPLOADING"];

/** Downloaded titles grouped for the poster library. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Ready-to-watch items (uploaded to S3) OR still being added — so the poster
  // can show an "adding" indicator while a title downloads.
  const rows = await prisma.download.findMany({
    where: {
      userId: user.id,
      OR: [{ s3Key: { not: null }, s3DeletedAt: null }, { status: { in: ACTIVE } }],
    },
    orderBy: { createdAt: "desc" },
  });

  const groups = new Map<string, Group>();
  for (const d of rows) {
    const key = d.tmdbId ? `t${d.tmdbId}` : d.title.toLowerCase();
    let g = groups.get(key);
    if (!g) {
      g = {
        key,
        title: d.title,
        posterUrl: d.posterUrl,
        year: d.year,
        kind: d.kind,
        tmdbId: d.tmdbId,
        genres: [],
        count: 0,
        downloading: false,
        sizeBytes: 0,
        items: [],
      };
      groups.set(key, g);
    }
    if (!g.posterUrl && d.posterUrl) g.posterUrl = d.posterUrl;
    const active = ACTIVE.includes(d.status);
    if (active) g.downloading = true;
    else g.count += 1; // count only ready files
    g.sizeBytes += Number(d.sizeBytes);
    g.items.push({
      id: d.id,
      releaseName: d.releaseName,
      season: d.season,
      episode: d.episode,
      status: d.status,
      progress: d.progress,
      sizeBytes: Number(d.sizeBytes),
      s3Key: d.s3Key,
    });
  }

  const titles = [...groups.values()];

  // Enrich with genres (cached) so the library can filter by them.
  const cfg = await getConfig();
  if (cfg.tmdb.apiKey) {
    const key = cfg.tmdb.apiKey;
    await Promise.all(
      titles.map(async (g) => {
        if (g.tmdbId) g.genres = await titleGenres(key, g.tmdbId, g.kind);
      }),
    );
  }

  return NextResponse.json({ titles }, { headers: { "Cache-Control": "no-store" } });
}
