import { NextResponse, type NextRequest } from "next/server";
import { jwtVerify } from "jose";

// Public paths that never require a session.
const PUBLIC_PAGES = ["/login", "/register", "/welcome"];
const PUBLIC_API = ["/api/auth/login", "/api/auth/register", "/api/auth/status", "/api/health"];

const COOKIE = "moviehub_session";

async function isAuthed(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const s = process.env.AUTH_SECRET;
  if (!s) return false;
  try {
    await jwtVerify(token, new TextEncoder().encode(s));
    return true;
  } catch {
    return false;
  }
}

export async function proxy(req: NextRequest): Promise<NextResponse> {
  const { pathname } = req.nextUrl;

  if (PUBLIC_API.some((p) => pathname.startsWith(p))) return NextResponse.next();

  const authed = await isAuthed(req.cookies.get(COOKIE)?.value);

  if (pathname.startsWith("/api/")) {
    if (!authed) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (PUBLIC_PAGES.includes(pathname)) {
    return authed ? NextResponse.redirect(new URL("/", req.url)) : NextResponse.next();
  }

  if (!authed) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    // Protect everything except Next internals, static image assets, and the
    // public PWA files (manifest + service worker are fetched without cookies).
    "/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
