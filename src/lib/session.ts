import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { env } from "./env";
import { prisma } from "./db";
import { SESSION_COOKIE } from "./auth";
import type { User } from "@prisma/client";

export interface SessionInfo {
  userId: string;
  role: string;
}

/** Decode the session cookie (cheap — no DB). Returns null if missing/invalid. */
export async function getSession(): Promise<SessionInfo | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(env.AUTH_SECRET));
    const userId = typeof payload.sub === "string" ? payload.sub : null;
    if (!userId) return null;
    return { userId, role: typeof payload.role === "string" ? payload.role : "member" };
  } catch {
    return null;
  }
}

/**
 * The current authenticated **and active** user, or null. Re-checks status on
 * every call so a denied/suspended member loses access within their session.
 */
export async function getSessionUser(): Promise<User | null> {
  const s = await getSession();
  if (!s) return null;
  const user = await prisma.user.findUnique({ where: { id: s.userId } });
  if (!user || user.status !== "active") return null;
  return user;
}

export function isAdmin(user: User | null | undefined): boolean {
  return user?.role === "admin";
}
