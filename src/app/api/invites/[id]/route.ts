import { NextResponse } from "next/server";
import { getSessionUser, isAdmin } from "@/lib/session";
import { deleteInvite } from "@/lib/service/invites";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Revoke a referral code (creator or admin). */
export async function DELETE(_req: Request, { params }: Ctx) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  await deleteInvite(id, user.id, isAdmin(user));
  return NextResponse.json({ ok: true });
}
