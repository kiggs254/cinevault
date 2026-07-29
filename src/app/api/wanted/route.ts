import { NextResponse } from "next/server";
import { listWanted, subscribeMovie, wantedTmdbIds } from "@/lib/service/wanted";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A member's movie subscriptions + the set of subscribed tmdbIds (for badging). */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const [wanted, tmdbIds] = await Promise.all([listWanted(user.id), wantedTmdbIds(user.id)]);
  return NextResponse.json({ wanted, tmdbIds }, { headers: { "Cache-Control": "no-store" } });
}

/** Subscribe to an upcoming movie. Body: { tmdbId }. */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { tmdbId?: number };
  const tmdbId = Number(body.tmdbId);
  if (!Number.isInteger(tmdbId) || tmdbId <= 0) {
    return NextResponse.json({ error: "tmdbId required" }, { status: 400 });
  }
  const wanted = await subscribeMovie(tmdbId, user.id);
  if (!wanted) return NextResponse.json({ error: "Could not subscribe" }, { status: 502 });
  return NextResponse.json({ wanted });
}
