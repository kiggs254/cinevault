import { NextResponse } from "next/server";
import { getSessionUser, isAdmin } from "@/lib/session";
import {
  updatePlaylist,
  deletePlaylist,
  movePlaylist,
  type PlaylistInput,
} from "@/lib/livetv/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

async function guardAdmin(): Promise<NextResponse | null> {
  const user = await getSessionUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return null;
}

/** Update a playlist, toggle it, or reorder it (admin). */
export async function PATCH(req: Request, { params }: Ctx) {
  const denied = await guardAdmin();
  if (denied) return denied;
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as Partial<PlaylistInput> & {
    move?: "up" | "down";
  };
  if (body.move === "up" || body.move === "down") {
    await movePlaylist(id, body.move);
    return NextResponse.json({ ok: true });
  }
  try {
    const playlist = await updatePlaylist(id, {
      name: body.name,
      sourceType: body.sourceType,
      url: body.url,
      content: body.content,
      epgUrl: body.epgUrl,
      enabled: body.enabled,
    });
    return NextResponse.json({ playlist });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 400 });
  }
}

/** Remove a playlist (admin). */
export async function DELETE(_req: Request, { params }: Ctx) {
  const denied = await guardAdmin();
  if (denied) return denied;
  const { id } = await params;
  await deletePlaylist(id);
  return NextResponse.json({ ok: true });
}
