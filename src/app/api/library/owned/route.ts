import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * tmdbIds already in the shared library (any member has a COMPLETED download) —
 * used to badge Discover/search cards as available so nothing is re-downloaded.
 * Files are shared, so availability is global, not per-member.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const rows = await prisma.download.findMany({
    where: { status: "COMPLETED", tmdbId: { not: null } },
    select: { tmdbId: true },
    distinct: ["tmdbId"],
  });
  const tmdbIds = rows.map((r) => r.tmdbId).filter((id): id is number => id != null);
  return NextResponse.json({ tmdbIds }, { headers: { "Cache-Control": "no-store" } });
}
