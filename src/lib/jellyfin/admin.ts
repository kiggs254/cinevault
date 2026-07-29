import type { JellyfinConfig } from "./client";
import { resolveUserId } from "./client";

/**
 * Admin (write) operations against Jellyfin, using the server-wide Dashboard API
 * key (`X-Emby-Token`). Kept separate from the read-only client.ts.
 */

const TIMEOUT = 20_000;

/* eslint-disable @typescript-eslint/no-explicit-any */
async function jfetch(
  cfg: JellyfinConfig,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: boolean; status: number; data: any }> {
  if (!cfg.url || !cfg.apiKey) return { ok: false, status: 0, data: null };
  const base = cfg.url.replace(/\/+$/, "");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        "X-Emby-Token": cfg.apiKey,
        Accept: "application/json",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    let data: any = null;
    const text = await res.text();
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }
    return { ok: res.ok, status: res.status, data };
  } catch {
    return { ok: false, status: 0, data: null };
  } finally {
    clearTimeout(timer);
  }
}

function providerTmdb(item: any): number | undefined {
  const raw = item?.ProviderIds?.Tmdb ?? item?.ProviderIds?.tmdb;
  const n = raw != null ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : undefined;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export type CreateUserResult = { id: string } | { error: "exists" | "failed" };

/**
 * Create a Jellyfin account (Name first, then set the password on the fresh
 * account — the most version-compatible path). Rolls back the account if the
 * password can't be set. Returns `{error:"exists"}` when the username is taken.
 */
export async function createJellyfinUser(
  cfg: JellyfinConfig,
  name: string,
  password: string,
): Promise<CreateUserResult> {
  const created = await jfetch(cfg, "POST", "/Users/New", { Name: name });
  if (!created.ok || !created.data?.Id) {
    return created.status === 400 || created.status === 409 ? { error: "exists" } : { error: "failed" };
  }
  const id = String(created.data.Id);
  // A brand-new user has an empty password, so CurrentPw:"" is correct.
  const pw = await jfetch(cfg, "POST", `/Users/${id}/Password`, { CurrentPw: "", NewPw: password });
  if (!pw.ok) {
    await jfetch(cfg, "DELETE", `/Users/${id}`); // roll back the half-created account
    return { error: "failed" };
  }
  return { id };
}

/** Enable/disable a Jellyfin account (fetch its policy, flip IsDisabled, save). */
export async function setUserDisabled(
  cfg: JellyfinConfig,
  userId: string,
  disabled: boolean,
): Promise<boolean> {
  const u = await jfetch(cfg, "GET", `/Users/${userId}`);
  if (!u.ok || !u.data?.Policy) return false;
  const policy = { ...u.data.Policy, IsDisabled: disabled };
  const res = await jfetch(cfg, "POST", `/Users/${userId}/Policy`, policy);
  return res.ok;
}

export async function deleteJellyfinUser(cfg: JellyfinConfig, userId: string): Promise<boolean> {
  const res = await jfetch(cfg, "DELETE", `/Users/${userId}`);
  return res.ok;
}

/** The Jellyfin server id (stable) — needed for `/web/#/details?serverId=`. */
let cachedServerId: string | null = null;
export async function getServerId(cfg: JellyfinConfig): Promise<string | null> {
  if (cachedServerId) return cachedServerId;
  const res = await jfetch(cfg, "GET", "/System/Info");
  if (res.ok && res.data?.Id) cachedServerId = String(res.data.Id);
  return cachedServerId;
}

// Small cache so repeated "Play" clicks don't re-scan the library.
const itemCache = new Map<string, string>();

/** Resolve a library item id by its TMDB id (Movie or Series). Null if not present. */
export async function findItemIdByTmdb(
  cfg: JellyfinConfig,
  tmdbId: number,
  type: "movie" | "tv",
): Promise<string | null> {
  const cacheKey = `${type}:${tmdbId}`;
  const cached = itemCache.get(cacheKey);
  if (cached) return cached;
  const userId = await resolveUserId(cfg);
  if (!userId) return null;
  const itemType = type === "tv" ? "Series" : "Movie";
  const res = await jfetch(
    cfg,
    "GET",
    `/Users/${userId}/Items?Recursive=true&IncludeItemTypes=${itemType}&Fields=ProviderIds&Limit=10000`,
  );
  const items = res.data?.Items;
  if (!Array.isArray(items)) return null;
  for (const it of items) {
    if (providerTmdb(it) === tmdbId) {
      itemCache.set(cacheKey, String(it.Id));
      return String(it.Id);
    }
  }
  return null;
}
