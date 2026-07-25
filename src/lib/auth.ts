import crypto from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { env } from "./env";

export const SESSION_COOKIE = "moviehub_session";

function secret(): Uint8Array {
  return new TextEncoder().encode(env.AUTH_SECRET);
}

export async function createSession(): Promise<string> {
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("30d")
    .sign(secret());
}

export async function verifySession(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  try {
    await jwtVerify(token, secret());
    return true;
  } catch {
    return false;
  }
}

/** Constant-time password comparison against the configured admin password. */
export function checkPassword(input: string): boolean {
  const a = Buffer.from(input);
  const b = Buffer.from(env.AUTH_PASSWORD);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
