import { NextResponse } from "next/server";
import { createSession, SESSION_COOKIE } from "@/lib/auth";
import { clientIp, rateLimit } from "@/lib/ratelimit";
import { verifyUser, ensureBootstrapAdmin } from "@/lib/service/users";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ip = clientIp(req);
  if (!(await rateLimit(`login:${ip}`, 8, 60))) {
    return NextResponse.json(
      { error: "Too many attempts. Try again shortly." },
      { status: 429 },
    );
  }

  // Guarantee the bootstrap admin exists before the very first login.
  await ensureBootstrapAdmin().catch(() => {});

  const body = (await req.json().catch(() => ({}))) as { username?: unknown; password?: unknown };
  const username = typeof body.username === "string" ? body.username : "";
  const password = typeof body.password === "string" ? body.password : "";

  const user = username && password ? await verifyUser(username, password) : null;
  if (!user) {
    return NextResponse.json({ error: "Invalid username or password" }, { status: 401 });
  }

  const token = await createSession({ userId: user.id, role: user.role });
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  });
  return res;
}
