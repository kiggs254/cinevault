import { NextResponse } from "next/server";
import { listWanted, subscribeMovie, wantedTmdbIds } from "@/lib/service/wanted";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** All movie subscriptions + the set of subscribed tmdbIds (for badging). */
export async function GET() {
  const [wanted, tmdbIds] = await Promise.all([listWanted(), wantedTmdbIds()]);
  return NextResponse.json({ wanted, tmdbIds }, { headers: { "Cache-Control": "no-store" } });
}

/** Subscribe to an upcoming movie. Body: { tmdbId }. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { tmdbId?: number };
  const tmdbId = Number(body.tmdbId);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    return NextResponse.json({ error: "tmdbId required" }, { status: 400 });
  }
  const wanted = await subscribeMovie(tmdbId);
  if (!wanted) return NextResponse.json({ error: "Could not subscribe" }, { status: 502 });
  return NextResponse.json({ wanted });
}
