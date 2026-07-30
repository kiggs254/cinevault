import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { savePushSubscription, deletePushSubscription } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Register this browser's push subscription for the current member. */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as {
    subscription?: { endpoint: string; keys: { p256dh: string; auth: string } };
  };
  if (!body.subscription?.endpoint) {
    return NextResponse.json({ error: "subscription required" }, { status: 400 });
  }
  await savePushSubscription(user.id, body.subscription, req.headers.get("user-agent") ?? undefined);
  return NextResponse.json({ ok: true });
}

/** Remove this browser's subscription (member disabled notifications). */
export async function DELETE(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { endpoint?: string };
  if (body.endpoint) await deletePushSubscription(user.id, body.endpoint);
  return NextResponse.json({ ok: true });
}
