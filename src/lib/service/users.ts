import { randomBytes } from "node:crypto";
import { prisma } from "../db";
import { env } from "../env";
import { getConfig } from "../config";
import { hashPassword, verifyPassword } from "../password";
import { encrypt, safeDecrypt } from "../crypto";
import { jellyfinReady } from "../jellyfin/client";
import { createJellyfinUser, setUserDisabled, deleteJellyfinUser } from "../jellyfin/admin";
import { notifyUser, notifyOwnerNewRegistration } from "../telegram/client";
import type { User } from "@prisma/client";

/** Canonical username form (lowercased, trimmed) — shared by portal + Jellyfin. */
export function normUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

/** Verify portal login credentials. Returns the user only if active + correct. */
export async function verifyUser(username: string, password: string): Promise<User | null> {
  const user = await prisma.user.findUnique({ where: { username: normUsername(username) } });
  if (!user || user.status !== "active") return null;
  if (!verifyPassword(password, user.passwordHash)) return null;
  return user;
}

/**
 * Ensure a bootstrap admin exists and legacy ownerless rows belong to it.
 * Idempotent; safe to call on every worker boot and at the top of login.
 */
export async function ensureBootstrapAdmin(): Promise<void> {
  const existing = await prisma.user.findFirst({ where: { role: "admin" } });
  if (existing) return;
  const cfg = await getConfig();
  const username = normUsername(env.ADMIN_USERNAME || "admin");
  const admin = await prisma.user.upsert({
    where: { username },
    update: { role: "admin", status: "active" },
    create: {
      username,
      passwordHash: hashPassword(env.AUTH_PASSWORD),
      role: "admin",
      status: "active",
      jellyfinUserId: cfg.jellyfin.userId ?? null,
      approvedAt: new Date(),
    },
  });
  // One-time migration: adopt every legacy ownerless row so the admin sees all
  // pre-multi-user content.
  await Promise.all([
    prisma.download.updateMany({ where: { userId: null }, data: { userId: admin.id } }),
    prisma.followedShow.updateMany({ where: { userId: null }, data: { userId: admin.id } }),
    prisma.wantedMovie.updateMany({ where: { userId: null }, data: { userId: admin.id } }),
    prisma.recommendation.updateMany({ where: { userId: null }, data: { userId: admin.id } }),
    prisma.chatSession.updateMany({ where: { userId: null }, data: { userId: admin.id } }),
  ]);
}

/* ------------------------------ registration ------------------------------ */

export type RegisterResult = { ok: true; statusToken: string } | { ok: false; error: string };

/** Create a pending account and ping the owner for approval. Provisions nothing yet. */
export async function registerUser(input: {
  username: string;
  password: string;
  code?: string;
}): Promise<RegisterResult> {
  const cfg = await getConfig();
  if (!cfg.registration.enabled) return { ok: false, error: "Registration is currently closed." };
  if (cfg.registration.code && (input.code ?? "") !== cfg.registration.code) {
    return { ok: false, error: "Invalid invite code." };
  }
  const username = normUsername(input.username);
  if (!/^[a-z0-9_]{3,20}$/.test(username)) {
    return { ok: false, error: "Username must be 3–20 characters: lowercase letters, numbers, or underscore." };
  }
  if (typeof input.password !== "string" || input.password.length < 6) {
    return { ok: false, error: "Password must be at least 6 characters." };
  }
  const existing = await prisma.user.findUnique({ where: { username }, select: { id: true } });
  if (existing) return { ok: false, error: "That username is taken." };

  const user = await prisma.user.create({
    data: {
      username,
      passwordHash: hashPassword(input.password),
      pendingSecret: encrypt(input.password), // held (encrypted) until Jellyfin is provisioned on approval
      status: "pending",
      role: "member",
    },
  });
  await notifyOwnerNewRegistration({ id: user.id, username }).catch(() => {});
  return { ok: true, statusToken: user.statusToken };
}

/** Public status poll for /welcome — by opaque token (no username enumeration). */
export async function statusByToken(
  token: string,
): Promise<{ status: string; username: string } | null> {
  if (!token) return null;
  const user = await prisma.user.findUnique({
    where: { statusToken: token },
    select: { status: true, username: true },
  });
  return user ?? null;
}

/* -------------------------------- approval -------------------------------- */

export type ApproveResult = { ok: true } | { ok: false; error: string };

/** Approve a pending user: provision their Jellyfin account, then activate. Idempotent. */
export async function approveUser(id: string): Promise<ApproveResult> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return { ok: false, error: "User not found." };
  if (user.status === "active") return { ok: true };

  const cfg = await getConfig();
  if (!jellyfinReady(cfg.jellyfin)) return { ok: false, error: "Jellyfin is not configured." };

  let jellyfinUserId = user.jellyfinUserId;
  if (!jellyfinUserId) {
    const password = safeDecrypt(user.pendingSecret);
    if (!password) return { ok: false, error: "Stored password missing — ask them to re-register." };
    const created = await createJellyfinUser(cfg.jellyfin, user.username, password);
    if ("error" in created) {
      return {
        ok: false,
        error:
          created.error === "exists"
            ? "A Jellyfin user with that name already exists."
            : "Could not create the Jellyfin account.",
      };
    }
    jellyfinUserId = created.id;
  }

  await prisma.user.update({
    where: { id },
    data: { status: "active", jellyfinUserId, approvedAt: new Date(), pendingSecret: null },
  });
  await notifyUser(id, `✅ You're in! Your Cinevault + Jellyfin account “${user.username}” is ready.`, {
    buttons: [{ text: "Get set up", path: `/welcome?token=${user.statusToken}` }],
  }).catch(() => {});
  return { ok: true };
}

/** Deny a pending user (removes any half-created Jellyfin account). */
export async function denyUser(id: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.role === "admin") return;
  const cfg = await getConfig();
  if (user.jellyfinUserId) await deleteJellyfinUser(cfg.jellyfin, user.jellyfinUserId).catch(() => {});
  await prisma.user.update({
    where: { id },
    data: { status: "denied", pendingSecret: null, jellyfinUserId: null },
  });
}

/** Suspend an active member (disables their Jellyfin login too). Never an admin. */
export async function suspendUser(id: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.role === "admin") return;
  const cfg = await getConfig();
  if (user.jellyfinUserId) await setUserDisabled(cfg.jellyfin, user.jellyfinUserId, true).catch(() => {});
  await prisma.user.update({ where: { id }, data: { status: "suspended" } });
}

/** Re-activate a suspended member (re-enables Jellyfin). */
export async function activateUser(id: string): Promise<void> {
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user) return;
  const cfg = await getConfig();
  if (user.jellyfinUserId) await setUserDisabled(cfg.jellyfin, user.jellyfinUserId, false).catch(() => {});
  await prisma.user.update({ where: { id }, data: { status: "active" } });
}

/** All users + their library counts, for the admin Users page. */
export async function listUsers() {
  return prisma.user.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    select: {
      id: true,
      username: true,
      role: true,
      status: true,
      telegramChatId: true,
      jellyfinUserId: true,
      createdAt: true,
      approvedAt: true,
      _count: { select: { downloads: true, follows: true } },
    },
  });
}

/* ---------------------------- telegram linking ---------------------------- */

/** Mint a fresh one-time link token for the bot deep link. */
export async function getTelegramLinkToken(userId: string): Promise<string> {
  const token = `lnk_${randomBytes(12).toString("hex")}`;
  await prisma.user.update({ where: { id: userId }, data: { telegramLinkToken: token } });
  return token;
}

/** Bind a Telegram chat to the account holding this link token. */
export async function bindTelegramChat(linkToken: string, chatId: string): Promise<User | null> {
  const user = await prisma.user.findUnique({ where: { telegramLinkToken: linkToken } });
  if (!user || user.status !== "active") return null;
  const taken = await prisma.user.findUnique({
    where: { telegramChatId: chatId },
    select: { id: true },
  });
  if (taken && taken.id !== user.id) return null; // chat already bound elsewhere
  return prisma.user.update({
    where: { id: user.id },
    data: { telegramChatId: chatId, telegramLinkToken: null },
  });
}

/** The active member bound to a Telegram chat id, if any. */
export async function userByChatId(chatId: string): Promise<User | null> {
  return prisma.user.findFirst({ where: { telegramChatId: chatId, status: "active" } });
}
