/**
 * Minimal Seerr (Jellyseerr) API client — only what the JellyBridge integration
 * needs. Seerr runs beside Jellyfin on the same Docker network; we call it with
 * its admin API key.
 */
import type { ResolvedConfig } from "../config";

/** A Seerr media request, as `GET /api/v1/request/:id` returns it (fields we use). */
export interface SeerrRequest {
  id: number;
  type: "movie" | "tv";
  is4k?: boolean;
  media?: { tmdbId?: number; mediaType?: "movie" | "tv" };
  seasons?: { seasonNumber: number }[];
  requestedBy?: { id: number; jellyfinUserId?: string | null; displayName?: string };
}

/** Seerr and Jellyfin both write GUIDs as 32 lowercase hex chars, no dashes. */
export function normalizeJellyfinId(v: string | null | undefined): string | null {
  if (!v) return null;
  const n = v.replace(/-/g, "").toLowerCase().trim();
  return /^[0-9a-f]{32}$/.test(n) ? n : null;
}

export function seerrReady(cfg: ResolvedConfig["seerr"]): boolean {
  return !!cfg.url && !!cfg.apiKey;
}

async function seerrFetch<T>(
  cfg: ResolvedConfig["seerr"],
  path: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  if (!cfg.url || !cfg.apiKey) throw new Error("Seerr is not configured");
  const base = cfg.url.replace(/\/+$/, "");
  const res = await fetch(`${base}/api/v1${path}`, {
    method: init?.method ?? "GET",
    headers: {
      "X-Api-Key": cfg.apiKey,
      Accept: "application/json",
      ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`Seerr ${path} → HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** The authoritative request record — never trust the webhook body alone. */
export function getSeerrRequest(cfg: ResolvedConfig["seerr"], id: number): Promise<SeerrRequest> {
  return seerrFetch<SeerrRequest>(cfg, `/request/${id}`);
}

/**
 * Create Seerr accounts for these Jellyfin users. JellyBridge files each ♥ as a
 * request BY that member, which only works if Seerr knows them. Seerr skips
 * anyone it already has.
 */
export async function importJellyfinUsers(
  cfg: ResolvedConfig["seerr"],
  jellyfinUserIds: string[],
): Promise<number> {
  const ids = jellyfinUserIds.map(normalizeJellyfinId).filter((x): x is string => !!x);
  if (!ids.length) return 0;
  const created = await seerrFetch<unknown[]>(cfg, "/user/import-from-jellyfin", {
    method: "POST",
    body: { jellyfinUserIds: ids },
  });
  return Array.isArray(created) ? created.length : 0;
}

/** Reachability + version, for the Settings "Test" button. */
export function seerrStatus(cfg: ResolvedConfig["seerr"]): Promise<{ version?: string }> {
  return seerrFetch<{ version?: string }>(cfg, "/status");
}
