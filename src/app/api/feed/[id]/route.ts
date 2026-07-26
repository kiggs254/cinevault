import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createDownload } from "@/lib/service/downloads";
import type { MediaKind } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as { action?: string };
  const item = await prisma.feedItem.findUnique({ where: { id } });
  if (!item) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (b.action === "dismiss") {
    await prisma.feedItem.update({ where: { id }, data: { status: "dismissed" } });
    return NextResponse.json({ ok: true });
  }
  if (b.action === "download") {
    if (!item.magnet) return NextResponse.json({ error: "No downloadable source" }, { status: 400 });
    await createDownload({
      releaseName: item.title,
      source: item.magnet,
      infoHash: item.infoHash,
      indexer: item.source,
      size: Number(item.size),
      seeders: item.seeders,
      kind: item.kind as MediaKind,
    });
    await prisma.feedItem.update({ where: { id }, data: { status: "grabbed" } });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}
