import { randomBytes } from "node:crypto";
import { prisma } from "../db";
import type { Invite } from "@prisma/client";

// Unambiguous alphabet (no 0/O/1/I/L) → 8-char codes, shown as XXXX-XXXX.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

function genCode(): string {
  const bytes = randomBytes(8);
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[bytes[i] % ALPHABET.length];
  return s;
}

/** Canonical form of a typed code (strip spaces/dashes, uppercase). */
export function normCode(raw: string): string {
  return (raw || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

/** Pretty display form: ABCD-EFGH. */
export function formatCode(code: string): string {
  return code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code;
}

/** Create a fresh referral code owned by a member. */
export async function createInvite(
  userId: string,
  opts: { label?: string; maxUses?: number } = {},
): Promise<Invite> {
  for (let i = 0; i < 5; i++) {
    const code = genCode();
    const clash = await prisma.invite.findUnique({ where: { code }, select: { id: true } });
    if (clash) continue;
    return prisma.invite.create({
      data: {
        code,
        createdById: userId,
        label: opts.label?.trim().slice(0, 60) || null,
        maxUses: Math.max(1, Math.min(50, Math.floor(opts.maxUses ?? 1))),
      },
    });
  }
  throw new Error("Could not generate a unique invite code");
}

/** A member's own invite codes, newest first. */
export async function listInvites(userId: string): Promise<Invite[]> {
  return prisma.invite.findMany({ where: { createdById: userId }, orderBy: { createdAt: "desc" } });
}

/** Delete/disable a code (only its creator or an admin). */
export async function deleteInvite(id: string, userId: string, isAdmin: boolean): Promise<void> {
  await prisma.invite.deleteMany({ where: { id, ...(isAdmin ? {} : { createdById: userId }) } });
}

/** The invite matching a typed code if it's still usable, else null. */
export async function validInvite(code: string | undefined | null): Promise<Invite | null> {
  const c = normCode(code ?? "");
  if (!c) return null;
  const inv = await prisma.invite.findUnique({ where: { code: c } });
  if (!inv || inv.disabled || inv.uses >= inv.maxUses) return null;
  return inv;
}

/** Record one use of a code (best-effort). */
export async function consumeInvite(id: string): Promise<void> {
  await prisma.invite.update({ where: { id }, data: { uses: { increment: 1 } } }).catch(() => {});
}
