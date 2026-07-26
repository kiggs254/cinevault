import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** List chat sessions (newest first), without their (potentially large) items. */
export async function GET() {
  const sessions = await prisma.chatSession.findMany({
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
  const s = await prisma.chatSession.create({ data: { title: "New chat" } });
  return NextResponse.json({ id: s.id });
}
