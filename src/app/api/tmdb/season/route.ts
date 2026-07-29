import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { getSeasonEpisodes } from "@/lib/metadata/tmdb";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIDEO_RE = /\.(mkv|mp4|avi|mov|m4v|ts|webm|flv|wmv)$/i;

/** Parse an episode number for `season` out of an S3 object key's filename. */
function episodeFromKey(key: string, season: number): number | null {
  const name = key.slice(key.lastIndexOf("/") + 1);
  let m = name.match(/s0*(\d+)\s*[._-]?\s*e0*(\d+)/i);
  if (m) return Number(m[1]) === season ? Number(m[2]) : null;
  m = name.match(/\b0*(\d+)\s*x\s*0*(\d+)\b/i);
  if (m) return Number(m[1]) === season ? Number(m[2]) : null;
  m = name.match(/(?:^|[._\-\s])e(?:p(?:isode)?)?[._\-\s]*0*(\d+)(?:[._\-\s]|$)/i);
  if (m) return Number(m[1]);
  return null;
}

/** The uploaded object keys for a pack download (prefer the recorded list). */
function packObjectKeys(row: { s3Key: string | null; metadata: unknown }): string[] {
  const meta =
    row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
      ? (row.metadata as Record<string, unknown>)
      : {};
  const arr = Array.isArray(meta.s3Keys)
    ? meta.s3Keys.filter((k): k is string => typeof k === "string")
    : [];
  return arr.length ? arr : row.s3Key ? [row.s3Key] : [];
}

/** A season's episodes enriched with aired/owned state and the matching download. */
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
    where: { userId: user.id, tmdbId: id, season, episode: { not: null }, status: { notIn: ["FAILED", "CANCELLED"] } },
    select: { id: true, episode: true, s3Key: true, sizeBytes: true, status: true },
    orderBy: { createdAt: "desc" },
  });
  const byEp = new Map<number, (typeof dls)[number]>();
  for (const d of dls) if (d.episode != null && !byEp.has(d.episode)) byEp.set(d.episode, d);

  // A whole-season pack (episode = null) covers every aired episode even though
  // there's no per-episode row. Prefer a completed one for status.
  const packs = await prisma.download.findMany({
    where: { userId: user.id, tmdbId: id, season, episode: null, status: { notIn: ["FAILED", "CANCELLED"] } },
    select: { id: true, status: true, s3Key: true, metadata: true },
    orderBy: { createdAt: "desc" },
  });
  const pack = packs.find((p) => p.status === "COMPLETED") ?? packs[0] ?? null;

  // Map the pack's uploaded files to episode numbers so each episode opens its own
  // file. A single-file pack opens the same object for every episode.
  const packByEp = new Map<number, string>();
  let packSingleKey: string | null = null;
  if (pack) {
    const keys = packObjectKeys(pack);
    const videos = keys.filter((k) => VIDEO_RE.test(k));
    const usable = videos.length ? videos : keys;
    for (const k of usable) {
      const n = episodeFromKey(k, season);
      if (n != null && !packByEp.has(n)) packByEp.set(n, k);
    }
    packSingleKey = usable.length === 1 ? usable[0] : null;
  }

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
      // A per-episode file opens itself; a pack episode opens its matched file
      // (or the single pack object) so pack-downloaded seasons are playable too.
      download: d
        ? { id: d.id, s3Key: d.s3Key, sizeBytes: Number(d.sizeBytes), status: d.status }
        : owned && pack
          ? {
              id: pack.id,
              s3Key: packByEp.get(e.episodeNumber) ?? packSingleKey,
              sizeBytes: 0,
              status: pack.status,
            }
          : null,
    };
  });

  return NextResponse.json({ episodes }, { headers: { "Cache-Control": "no-store" } });
}
