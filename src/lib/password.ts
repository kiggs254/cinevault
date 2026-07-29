import { scryptSync, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Password hashing with Node's built-in scrypt (no external dependency).
 * Stored form: "scrypt$<saltHex>$<hashHex>".
 */
const KEYLEN = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string | null | undefined): boolean {
  if (!stored) return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  let expected: Buffer;
  try {
    expected = Buffer.from(parts[2], "hex");
  } catch {
    return false;
  }
  const salt = Buffer.from(parts[1], "hex");
  const actual = scryptSync(password, salt, expected.length);
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
