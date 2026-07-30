import { NextResponse } from "next/server";
import { getSessionUser, isAdmin } from "@/lib/session";
import { listPlaylists, createPlaylist, type PlaylistInput } from "@/lib/livetv/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function guardAdmin(): Promise<NextResponse | null> {
  const user = await getSessionUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return null;
}

/** List every playlist (admin). */
export async function GET() {
  const denied = await guardAdmin();
  if (denied) return denied;
  const playlists = await listPlaylists();
  return NextResponse.json({ playlists }, { headers: { "Cache-Control": "no-store" } });
}

/** Add a playlist (admin). */
export async function POST(req: Request) {
  const denied = await guardAdmin();
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as Partial<PlaylistInput>;
  if (!body.name?.trim()) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  const sourceType = body.sourceType === "text" ? "text" : "url";
  if (sourceType === "url" && !body.url?.trim()) {
    return NextResponse.json({ error: "Playlist URL is required" }, { status: 400 });
  }
  if (sourceType === "text" && !body.content?.trim()) {
    return NextResponse.json({ error: "Playlist content is required" }, { status: 400 });
  }
  const playlist = await createPlaylist({
    name: body.name,
    sourceType,
    url: body.url ?? null,
    content: body.content ?? null,
    epgUrl: body.epgUrl ?? null,
    enabled: body.enabled ?? true,
  });
  return NextResponse.json({ playlist });
}
