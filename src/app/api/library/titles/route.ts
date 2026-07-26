import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface Item {
  id: string;
  releaseName: string;
  season: number | null;
  episode: number | null;
  status: string;
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
  count: number;
  sizeBytes: number;
  items: Item[];
}

/** Downloaded titles grouped for the poster library. */
export async function GET() {
  const rows = await prisma.download.findMany({
    where: { s3Key: { not: null }, s3DeletedAt: null },
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
        count: 0,
        sizeBytes: 0,
        items: [],
      };
      groups.set(key, g);
    }
    if (!g.posterUrl && d.posterUrl) g.posterUrl = d.posterUrl;
    g.count += 1;
    g.sizeBytes += Number(d.sizeBytes);
    g.items.push({
      id: d.id,
      releaseName: d.releaseName,
      season: d.season,
      episode: d.episode,
      status: d.status,
      sizeBytes: Number(d.sizeBytes),
      s3Key: d.s3Key,
    });
  }

  return NextResponse.json(
    { titles: [...groups.values()] },
    { headers: { "Cache-Control": "no-store" } },
  );
}
