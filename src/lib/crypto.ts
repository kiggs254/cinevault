import crypto from "node:crypto";
import { env } from "./env";

/** Derive a stable 32-byte key from ENCRYPTION_KEY of any length/encoding. */
function key(): Buffer {
  return crypto.createHash("sha256").update(env.ENCRYPTION_KEY).digest();
}

/** AES-256-GCM encrypt -> "iv:tag:ciphertext" (all base64). */
export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}:${tag.toString("base64")}:${enc.toString("base64")}`;
}

export function decrypt(payload: string): string {
  const [ivB64, tagB64, dataB64] = payload.split(":");
  if (!ivB64 || !tagB64 || !dataB64) throw new Error("Malformed ciphertext");
  const decipher = crypto.createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(ivB64, "base64"),
  );
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(dataB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

export function safeDecrypt(payload: string | undefined | null): string | undefined {
  if (!payload) return undefined;
  try {
    return decrypt(payload);
  } catch {
    return undefined;
  }
}
