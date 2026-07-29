import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/session";
import { createInvite, listInvites } from "@/lib/service/invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The current member's referral codes. */
export async function GET() {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const invites = await listInvites(user.id);
  return NextResponse.json({ invites }, { headers: { "Cache-Control": "no-store" } });
}

/** Generate a new referral code. Body: { label?, maxUses? }. */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => ({}))) as { label?: string; maxUses?: number };
  const invite = await createInvite(user.id, { label: body.label, maxUses: body.maxUses });
  return NextResponse.json({ invite });
}
