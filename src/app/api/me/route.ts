import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The current signed-in member (identity + role for the app shell). */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  return NextResponse.json(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      telegramLinked: !!user.telegramChatId,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
