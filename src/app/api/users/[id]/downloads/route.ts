import { NextResponse } from "next/server";
import type { DownloadStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getSessionUser, isAdmin } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ACTIVE: DownloadStatus[] = ["QUEUED", "SEARCHING", "DOWNLOADING", "UPLOADING"];

type Ctx = { params: Promise<{ id: string }> };

interface Item {
  id: string;
  season: number | null;
  episode: number | null;
  status: string;
  sizeBytes: number;
}
interface Group {
  key: string;
  title: string;
  posterUrl: string | null;
  year: number | null;
  kind: string;
  count: number;
  downloading: boolean;
  sizeBytes: number;
  items: Item[];
}

/** Admin: one member's library (their own download rows), grouped by title. */
export async function GET(_req: Request, { params }: Ctx) {
  const me = await getSessionUser();
  if (!isAdmin(me)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const member = await prisma.user.findUnique({ where: { id }, select: { username: true } });
  if (!member) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const rows = await prisma.download.findMany({
    where: {
      userId: id,
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
        count: 0,
        downloading: false,
        sizeBytes: 0,
        items: [],
      };
      groups.set(key, g);
    }
    if (!g.posterUrl && d.posterUrl) g.posterUrl = d.posterUrl;
    if (ACTIVE.includes(d.status)) g.downloading = true;
    else g.count += 1;
    g.sizeBytes += Number(d.sizeBytes);
    g.items.push({
      id: d.id,
      season: d.season,
      episode: d.episode,
      status: d.status,
      sizeBytes: Number(d.sizeBytes),
    });
  }

  return NextResponse.json(
    { username: member.username, titles: [...groups.values()] },
    { headers: { "Cache-Control": "no-store" } },
  );
}
