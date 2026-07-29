import { NextResponse } from "next/server";
import { enqueueJob } from "@/lib/queue";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Manually trigger a subscription scan now (runs on the grab worker). */
export async function POST() {
  await enqueueJob("wanted-scan");
  return NextResponse.json({ ok: true });
}
