import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * tmdbIds that have at least one COMPLETED download — used to badge Discover
 * cards as already in the library.
 */
export async function GET() {
  const rows = await prisma.download.findMany({
    where: { status: "COMPLETED", tmdbId: { not: null } },
    select: { tmdbId: true },
    distinct: ["tmdbId"],
  });
  const tmdbIds = rows.map((r) => r.tmdbId).filter((id): id is number => id != null);
  return NextResponse.json({ tmdbIds }, { headers: { "Cache-Control": "no-store" } });
}
