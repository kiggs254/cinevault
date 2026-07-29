import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * tmdbIds that have at least one COMPLETED download — used to badge Discover
 * cards as already in the library.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await prisma.download.findMany({
    where: { userId: user.id, status: "COMPLETED", tmdbId: { not: null } },
    select: { tmdbId: true },
    distinct: ["tmdbId"],
  });
  const tmdbIds = rows.map((r) => r.tmdbId).filter((id): id is number => id != null);
  return NextResponse.json({ tmdbIds }, { headers: { "Cache-Control": "no-store" } });
}
