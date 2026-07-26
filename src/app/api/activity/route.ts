import { NextResponse } from "next/server";
import { recentActivity } from "@/lib/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Recent background-activity lines (newest first) for the Assistant feed. */
export async function GET() {
  const items = await recentActivity(40);
  return NextResponse.json({ items }, { headers: { "Cache-Control": "no-store" } });
}
