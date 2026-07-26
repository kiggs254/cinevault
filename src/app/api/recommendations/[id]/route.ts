import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { followShow } from "@/lib/service/follows";
import { startFromQuery } from "@/lib/service/downloads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** action: "dismiss" | "add" | "download".
 *  - add: TV → follow (auto-downloads new episodes); Movie → queue best release now.
 *  - download: queue the best release now regardless of type. */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as { action?: string };
  const rec = await prisma.recommendation.findUnique({ where: { id } });
  if (!rec) return NextResponse.json({ error: "Not found" }, { status: 404 });

  if (b.action === "dismiss") {
    await prisma.recommendation.update({ where: { id }, data: { status: "dismissed" } });
    return NextResponse.json({ ok: true });
  }

  if (b.action === "add" && rec.mediaType === "tv") {
    const followed = await followShow(rec.tmdbId, { source: "reco", autoDownload: true });
    await prisma.recommendation.update({ where: { id }, data: { status: "added" } });
    return NextResponse.json({ ok: true, followed: !!followed, kind: "follow" });
  }

  // add(movie) or download(any): queue the best release now.
  const q = `${rec.title}${rec.year ? ` ${rec.year}` : ""}`;
  try {
    const { download } = await startFromQuery(q);
    await prisma.recommendation.update({ where: { id }, data: { status: "added" } });
    return NextResponse.json({ ok: !!download, kind: "download", title: download?.title });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 200 });
  }
}
