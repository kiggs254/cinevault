import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const s = await prisma.chatSession.findUnique({ where: { id } });
  if (!s) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(
    { session: { id: s.id, title: s.title, items: s.items ?? [] } },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { items?: unknown; title?: string };
  const data: Prisma.ChatSessionUpdateInput = {};
  if (body.items !== undefined) data.items = body.items as Prisma.InputJsonValue;
  if (typeof body.title === "string" && body.title.trim()) {
    data.title = body.title.trim().slice(0, 80);
  }
  try {
    const s = await prisma.chatSession.update({ where: { id }, data });
    return NextResponse.json({ ok: true, updatedAt: s.updatedAt.toISOString() });
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await prisma.chatSession.delete({ where: { id } }).catch(() => {});
  return NextResponse.json({ ok: true });
}
