import { NextResponse } from "next/server";
import { getDownload, removeDownload, retryDownload } from "@/lib/service/downloads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const download = await getDownload(id);
  if (!download) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ download }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { action?: string };
  if (body.action === "retry") {
    const download = await retryDownload(id);
    if (!download) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ download });
  }
  return NextResponse.json({ error: "Unknown action" }, { status: 400 });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await removeDownload(id);
  return NextResponse.json({ ok: true });
}
