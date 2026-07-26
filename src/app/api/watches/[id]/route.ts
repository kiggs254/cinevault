import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { MediaKind } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };
const KINDS = ["MOVIE", "TV", "MUSIC", "SOFTWARE", "OTHER"];

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const data: Prisma.WatchUpdateInput = {};
  if (typeof b.enabled === "boolean") data.enabled = b.enabled;
  if (typeof b.autoGrab === "boolean") data.autoGrab = b.autoGrab;
  if (typeof b.label === "string") data.label = b.label.slice(0, 80);
  if (typeof b.query === "string") data.query = b.query;
  if (typeof b.quality === "string") data.quality = b.quality;
  if (b.minSeeders !== undefined) data.minSeeders = Number(b.minSeeders) || 1;
  if (KINDS.includes(String(b.kind))) data.kind = b.kind as MediaKind;
  try {
    const watch = await prisma.watch.update({ where: { id }, data });
    return NextResponse.json({ watch });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await prisma.watch.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
