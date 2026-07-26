import { NextResponse } from "next/server";
import { enqueueScan } from "@/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  await enqueueScan();
  return NextResponse.json({ ok: true });
}
