import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/session";
import { unfollowShow } from "@/lib/service/follows";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: Ctx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const owned = await prisma.followedShow.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const b = (await req.json().catch(() => ({}))) as { autoDownload?: boolean; quality?: string };
  const data: Record<string, unknown> = {};
  if (typeof b.autoDownload === "boolean") data.autoDownload = b.autoDownload;
  if (typeof b.quality === "string") data.quality = b.quality;
  const show = await prisma.followedShow.update({ where: { id }, data }).catch(() => null);
  if (!show) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const owned = await prisma.followedShow.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await unfollowShow(id);
  return NextResponse.json({ ok: true });
}
