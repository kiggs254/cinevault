import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getTelegramLinkToken, getTelegramLinkTokenByStatusToken } from "@/lib/service/users";
import { getConfig } from "@/lib/config";
import { tgApi } from "@/lib/telegram/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Mint a Telegram deep link that binds the bot chat to a member.
 * - Signed-in member: uses their session.
 * - Pending registrant on /welcome (no session): pass ?statusToken=... so they
 *   can pre-link and get the approval ping.
 */
export async function POST(req: Request) {
  const cfg = await getConfig();
  if (!cfg.telegram.botToken) {
    return NextResponse.json({ error: "Telegram isn't set up yet." }, { status: 503 });
  }
  const me = await tgApi<{ username?: string }>(cfg.telegram.botToken, "getMe");
  if (!me?.username) {
    return NextResponse.json({ error: "Could not resolve the bot username." }, { status: 502 });
  }

  const statusToken = new URL(req.url).searchParams.get("statusToken");
  let token: string | null = null;
  if (statusToken) {
    token = await getTelegramLinkTokenByStatusToken(statusToken);
  } else {
    const user = await getSessionUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    token = await getTelegramLinkToken(user.id);
  }
  if (!token) return NextResponse.json({ error: "Couldn't create a link." }, { status: 400 });

  return NextResponse.json({ url: `https://t.me/${me.username}?start=${token}` });
}
