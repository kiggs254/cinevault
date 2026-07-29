import { NextResponse } from "next/server";
import { statusByToken } from "@/lib/service/users";
import { getConfig } from "@/lib/config";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public status poll for the /welcome page. GET ?token=<statusToken>. */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  const info = await statusByToken(token);
  const headers = { "Cache-Control": "no-store" };
  if (!info) return NextResponse.json({ status: "unknown" }, { status: 404, headers });
  const cfg = await getConfig();
  return NextResponse.json(
    { status: info.status, username: info.username, serverUrl: cfg.jellyfin.publicUrl ?? null },
    { headers },
  );
}
