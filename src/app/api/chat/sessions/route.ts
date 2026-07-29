import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** List chat sessions (newest first), without their (potentially large) items. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sessions = await prisma.chatSession.findMany({
    where: { userId: user.id },
    orderBy: { updatedAt: "desc" },
    select: { id: true, title: true, updatedAt: true },
    take: 100,
  });
  return NextResponse.json(
    { sessions: sessions.map((s) => ({ ...s, updatedAt: s.updatedAt.toISOString() })) },
    { headers: { "Cache-Control": "no-store" } },
  );
}

/** Create a new (empty) chat session. */
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const s = await prisma.chatSession.create({ data: { title: "New chat", userId: user.id } });
  return NextResponse.json({ id: s.id });
}
