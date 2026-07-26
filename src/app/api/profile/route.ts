import { NextResponse } from "next/server";
import { getConfig, saveConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const cfg = await getConfig();
  return NextResponse.json({ profile: cfg.profile }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: Request) {
  const b = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  if (Array.isArray(b.interests)) {
    patch.interests = b.interests
      .filter((x): x is string => typeof x === "string")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 40);
  }
  if (typeof b.autoGrabEnabled === "boolean") patch.autoGrabEnabled = b.autoGrabEnabled;
  if (b.autoGrabThreshold !== undefined) {
    patch.autoGrabThreshold = Math.max(0, Math.min(100, Number(b.autoGrabThreshold) || 80));
  }
  if (Array.isArray(b.legalIndexerIds)) {
    patch.legalIndexerIds = b.legalIndexerIds.map(Number).filter((n) => !Number.isNaN(n));
  }
  await saveConfig(patch);
  const cfg = await getConfig();
  return NextResponse.json({ profile: cfg.profile });
}
