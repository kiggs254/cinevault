import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { getVapidPublicKey } from "@/lib/push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The VAPID public key the browser uses to create a push subscription. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const publicKey = await getVapidPublicKey();
  return NextResponse.json({ publicKey }, { headers: { "Cache-Control": "no-store" } });
}
