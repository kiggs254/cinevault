import { NextResponse } from "next/server";
import { registerUser } from "@/lib/service/users";
import { clientIp, rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Public registration. Body: { username, password, code? }. Admin approval required. */
export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!(await rateLimit(`register:${ip}`, 5, 300))) {
    return NextResponse.json({ error: "Too many attempts. Try again shortly." }, { status: 429 });
  }
  const body = (await req.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
    code?: string;
    acceptedGuidelines?: boolean;
  };
  const result = await registerUser({
    username: String(body.username ?? ""),
    password: String(body.password ?? ""),
    code: body.code ? String(body.code) : undefined,
    acceptedGuidelines: body.acceptedGuidelines === true,
  });
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, statusToken: result.statusToken });
}
