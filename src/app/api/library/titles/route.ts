import { NextResponse } from "next/server";
import type { DownloadStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser, isAdmin } from "@/lib/session";
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
  /** Subtitle languages stored for this file, e.g. "en" — null = none yet. */
  subs: string | null;
  /** Whether subtitles have ever been looked for (false = still queued). */
  subsChecked: boolean;
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
  subsReady: number; // ready files that have subtitles
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
      // Admin's library shows everything downloaded by anyone; members see their own.
      ...(isAdmin(user) ? {} : { userId: user.id }),
      OR: [{ s3Key: { not: null }, s3DeletedAt: null }, { status: { in: ACTIVE } }],
    },
    orderBy: { createdAt: "desc" },
  });

  const groups = new Map<string, Group>();
  // Per group, collapse rows to ONE entry per episode/pack/movie. Two members who
  // both own an episode share the same file — the admin view must not show it twice
  // (and shared files must not be size-counted twice).
  const epMaps = new Map<string, Map<string, { item: Item; ready: boolean; active: boolean }>>();
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
        subsReady: 0,
        items: [],
      };
      groups.set(key, g);
      epMaps.set(key, new Map());
    }
    if (!g.posterUrl && d.posterUrl) g.posterUrl = d.posterUrl;

    const epKey =
      d.season != null && d.episode != null
        ? `e${d.season}-${d.episode}`
        : d.season != null
          ? `p${d.season}`
          : d.s3Key ?? `m${d.id}`;
    const active = ACTIVE.includes(d.status);
    const ready = !active && !!d.s3Key;
    const item: Item = {
      id: d.id,
      releaseName: d.releaseName,
      season: d.season,
      episode: d.episode,
      status: d.status,
      progress: d.progress,
      sizeBytes: Number(d.sizeBytes),
      s3Key: d.s3Key,
      subs: d.subsLangs,
      subsChecked: d.subsCheckedAt != null,
    };
    const eps = epMaps.get(key)!;
    const cur = eps.get(epKey);
    if (!cur) {
      eps.set(epKey, { item, ready, active });
    } else {
      // Prefer a ready row; among ready, the larger file.
      // Two members' rows can point at the same file; keep whichever knows about
      // subtitles so a shared file isn't shown as having none.
      const subs = cur.item.subs ?? item.subs;
      const subsChecked = cur.item.subsChecked || item.subsChecked;
      if ((ready && !cur.ready) || (ready === cur.ready && item.sizeBytes > cur.item.sizeBytes)) {
        cur.item = item;
      }
      cur.item.subs = subs;
      cur.item.subsChecked = subsChecked;
      cur.ready = cur.ready || ready;
      cur.active = cur.active || active;
    }
  }

  for (const [key, g] of groups) {
    const aggs = [...epMaps.get(key)!.values()];
    g.items = aggs.map((a) => a.item);
    g.count = aggs.filter((a) => a.ready).length; // distinct ready episodes
    g.downloading = aggs.some((a) => !a.ready && a.active);
    g.sizeBytes = aggs.filter((a) => a.ready).reduce((s, a) => s + a.item.sizeBytes, 0);
    g.subsReady = aggs.filter((a) => a.ready && a.item.subs).length;
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
