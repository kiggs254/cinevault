import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The "What's New" discovery feed. Defaults to items not yet acted on. */
export async function GET(req: Request) {
  const status = new URL(req.url).searchParams.get("status") ?? "new";
  const items = await prisma.feedItem.findMany({
    where: status === "all" ? {} : { status },
    orderBy: [{ matchScore: "desc" }, { createdAt: "desc" }],
    take: 60,
  });
  return NextResponse.json(
    {
      items: items.map((f) => ({
        id: f.id,
        title: f.title,
        source: f.source,
        kind: f.kind,
        size: Number(f.size),
        seeders: f.seeders,
        matchScore: f.matchScore,
        status: f.status,
        createdAt: f.createdAt.toISOString(),
        publishDate: f.publishDate ? f.publishDate.toISOString() : null,
      })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
