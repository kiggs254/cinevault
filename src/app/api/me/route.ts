import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The current signed-in member (identity + role + the Jellyfin server address). */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const cfg = await getConfig();
  return NextResponse.json(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      telegramLinked: !!user.telegramChatId,
      serverUrl: cfg.jellyfin.publicUrl ?? null,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
