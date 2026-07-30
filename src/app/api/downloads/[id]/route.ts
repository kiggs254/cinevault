import { NextResponse } from "next/server";
import { getDownload, removeDownload, retryDownload, resourceDownload } from "@/lib/service/downloads";
import { getSessionUser, isAdmin } from "@/lib/session";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const owned = await prisma.download.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const download = await getDownload(id);
  if (!download) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ download }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request, { params }: Ctx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const owned = await prisma.download.findFirst({
    where: { id, userId: user.id },
    select: { id: true },
  });
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action === "retry") {
    const download = await retryDownload(id);
    if (!download) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ download });
  }
  if (body.action === "resource") {
    const r = await resourceDownload(id);
    return NextResponse.json(r);
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  // Members may only remove their own library entry; the admin (owner) can remove
  // any entry to manage shared storage. removeDownload frees the S3 object only
  // when no other member's row still references it.
  const owned = await prisma.download.findFirst({
    where: isAdmin(user) ? { id } : { id, userId: user.id },
    select: { id: true },
  });
  if (!owned) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await removeDownload(id);
  return NextResponse.json({ ok: true });
}
