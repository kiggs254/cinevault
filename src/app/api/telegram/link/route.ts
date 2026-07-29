import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getTelegramLinkToken } from "@/lib/service/users";
import { getConfig } from "@/lib/config";
import { tgApi } from "@/lib/telegram/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Mint a Telegram deep link that binds the bot chat to the current member. */
export async function POST() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const cfg = await getConfig();
  if (!cfg.telegram.botToken) {
    return NextResponse.json({ error: "Telegram bot isn't configured yet." }, { status: 503 });
  }
  const me = await tgApi<{ username?: string }>(cfg.telegram.botToken, "getMe");
  if (!me?.username) {
    return NextResponse.json({ error: "Could not resolve the bot username." }, { status: 502 });
  }
  const token = await getTelegramLinkToken(user.id);
  return NextResponse.json({ url: `https://t.me/${me.username}?start=${token}` });
}
