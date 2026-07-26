import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { enqueueScan } from "@/lib/queue";
import type { MediaKind } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = ["MOVIE", "TV", "MUSIC", "SOFTWARE", "OTHER"];

export async function GET() {
  const watches = await prisma.watch.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(
    {
      watches: watches.map((w) => ({
        ...w,
        createdAt: w.createdAt.toISOString(),
        updatedAt: w.updatedAt.toISOString(),
        lastRunAt: w.lastRunAt ? w.lastRunAt.toISOString() : null,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}

interface WatchBody {
  type?: string;
  label?: string;
  query?: string;
  feedUrl?: string;
  kind?: string;
  quality?: string;
  minSeeders?: number;
  autoGrab?: boolean;
}

export async function POST(req: Request) {
  const b = (await req.json().catch(() => ({}))) as WatchBody;
  const type = b.type === "RSS" ? "RSS" : "SEARCH";
  if (type === "SEARCH" && !b.query) {
    return NextResponse.json({ error: "A search query is required" }, { status: 400 });
  }
  if (type === "RSS" && !b.feedUrl) {
    return NextResponse.json({ error: "A feed URL is required" }, { status: 400 });
  }
  const kind: MediaKind = (KINDS.includes(String(b.kind)) ? b.kind : "OTHER") as MediaKind;
  const watch = await prisma.watch.create({
    data: {
      type,
      label: String(b.label || b.query || b.feedUrl || "Watch").slice(0, 80),
      query: type === "SEARCH" ? String(b.query) : null,
      feedUrl: type === "RSS" ? String(b.feedUrl) : null,
      kind,
      quality: typeof b.quality === "string" ? b.quality : "any",
      minSeeders: Number(b.minSeeders) || 1,
      autoGrab: b.autoGrab !== false,
    },
  });
  void enqueueScan();
  return NextResponse.json({ watch });
}
