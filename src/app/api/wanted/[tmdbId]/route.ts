import { NextResponse } from "next/server";
import { unsubscribeMovie } from "@/lib/service/wanted";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ tmdbId: string }> };

/** Cancel the current member's movie subscription by TMDB id. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { tmdbId } = await params;
  const id = Number(tmdbId);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  await unsubscribeMovie(id, user.id);
  return NextResponse.json({ ok: true });
}
