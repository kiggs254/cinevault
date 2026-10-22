import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "node:crypto";
import { getConfig } from "@/lib/config";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { handleSeerrNotification, type SeerrWebhookPayload } from "@/lib/seerr/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 64 * 1024;

/** Constant-time compare of two secrets of any length (hash first to equalise). */
function sameSecret(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}

/**
 * Seerr's webhook notification agent. Seerr runs beside Jellyfin and calls this
 * when a request is approved — in practice, when a member presses ♥ on a title in
 * Jellyfin's JellyBridge "Discover" library. Authenticated by a shared secret
 * Seerr sends as the Authorization header; everything acted on is re-read from
 * Seerr's own API.
 */
export async function POST(req: Request) {
  if (!(await rateLimit(`seerr-hook:${clientIp(req)}`, 120, 60))) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429, headers: NO_STORE });
  }

  const cfg = await getConfig();
  const secret = cfg.seerr.webhookSecret;
  if (!secret) {
    return NextResponse.json({ error: "Not configured" }, { status: 503, headers: NO_STORE });
  }
  const auth = req.headers.get("authorization") ?? "";
  if (!sameSecret(auth, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const raw = await req.text().catch(() => "");
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Payload too large" }, { status: 413, headers: NO_STORE });
  }
  let payload: SeerrWebhookPayload;
  try {
    payload = JSON.parse(raw) as SeerrWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400, headers: NO_STORE });
  }

  const { status, message } = await handleSeerrNotification(payload);
  if (status >= 400) console.warn(`[seerr] webhook ${payload.notification_type} → ${status}: ${message}`);
  else console.log(`[seerr] webhook ${payload.notification_type} → ${message}`);
  return NextResponse.json({ ok: status < 400, message }, { status, headers: NO_STORE });
}
