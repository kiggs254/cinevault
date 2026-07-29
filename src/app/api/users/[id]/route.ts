import { NextResponse } from "next/server";
import { approveUser, denyUser, suspendUser, activateUser } from "@/lib/service/users";
import { getSessionUser, isAdmin } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

/** Admin: act on a member. Body: { action: "approve"|"deny"|"suspend"|"activate" }. */
export async function PATCH(req: Request, { params }: Ctx) {
  const me = await getSessionUser();
  if (!isAdmin(me)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  switch (body.action) {
    case "approve": {
      const r = await approveUser(id);
      return r.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: r.error }, { status: 400 });
    }
    case "deny":
      await denyUser(id);
      return NextResponse.json({ ok: true });
    case "suspend":
      await suspendUser(id);
      return NextResponse.json({ ok: true });
    case "activate":
      await activateUser(id);
      return NextResponse.json({ ok: true });
    default:
      return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  }
}
