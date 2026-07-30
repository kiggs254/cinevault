import { NextResponse } from "next/server";
import { getSessionUser, isAdmin } from "@/lib/session";
import { validateSource } from "@/lib/livetv/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Test a source (fetch + count channels) before saving (admin). */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as {
    sourceType?: string;
    url?: string;
    content?: string;
  };
  const result = await validateSource({
    sourceType: body.sourceType === "text" ? "text" : "url",
    url: body.url ?? null,
    content: body.content ?? null,
  });
  return NextResponse.json(result);
}
