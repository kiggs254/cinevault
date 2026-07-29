import { NextResponse } from "next/server";
import { unsubscribeMovie } from "@/lib/service/wanted";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ tmdbId: string }> };

/** Cancel a movie subscription by TMDB id. */
export async function DELETE(_req: Request, { params }: Ctx) {
  const { tmdbId } = await params;
  const id = Number(tmdbId);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  await unsubscribeMovie(id);
  return NextResponse.json({ ok: true });
}
