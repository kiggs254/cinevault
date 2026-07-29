import { NextResponse } from "next/server";
import { listUsers } from "@/lib/service/users";
import { getSessionUser, isAdmin } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Admin: all community members + their library counts. */
export async function GET() {
  const me = await getSessionUser();
  if (!isAdmin(me)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const users = await listUsers();
  return NextResponse.json({ users }, { headers: { "Cache-Control": "no-store" } });
}
