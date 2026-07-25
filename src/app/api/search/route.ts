import { NextResponse } from "next/server";
import { planAndSearch, chooseBest } from "@/lib/service/downloads";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!(await rateLimit(`search:${ip}`, 20, 60))) {
    return NextResponse.json({ error: "Rate limited" }, { status: 429 });
  }

  const body = (await req.json().catch(() => ({}))) as { query?: unknown };
  const query = typeof body.query === "string" ? body.query.trim() : "";
  if (!query) {
    return NextResponse.json({ error: "Query is required" }, { status: 400 });
  }

  try {
    const { plan, ranked } = await planAndSearch(query);
    const { chosen, decision } = await chooseBest(plan, ranked);
    const recommendedIndex = chosen ? ranked.findIndex((r) => r === chosen) : -1;

    const results = ranked.map((r, i) => ({
      index: i,
      title: r.title,
      indexer: r.indexer,
      seeders: r.seeders,
      leechers: r.leechers,
      size: r.size,
      score: r.score,
      reasons: r.reasons,
      parsed: r.parsed,
      magnetUrl: r.magnetUrl,
      downloadUrl: r.downloadUrl,
      infoHash: r.infoHash,
      recommended: i === recommendedIndex,
    }));

    return NextResponse.json(
      { plan, decision, recommendedIndex, results },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
