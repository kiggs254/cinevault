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

/**
 * Surface Cinevault inside Jellyfin without a plugin: put a "Request titles"
 * line on the Jellyfin login screen (branding LoginDisclaimer) — it renders on
 * every client (web + native mobile/TV). Pass an empty url to clear it. The
 * disclaimer supports markdown, so we use a markdown link with the raw URL as a
 * fallback for clients that render it plain. Best-effort.
 */
export async function setJellyfinRequestLink(cfg: JellyfinConfig, url: string): Promise<boolean> {
  const cur = await jfetch(cfg, "GET", "/System/Configuration/branding");
  const branding =
    cur.ok && cur.data && typeof cur.data === "object" ? (cur.data as Record<string, unknown>) : {};
  const disclaimer = url
    ? `🎬 Can’t find something to watch? **[Request it on Cinevault](${url})** — or open ${url}`
    : "";
  const res = await jfetch(cfg, "POST", "/System/Configuration/branding", {
    ...branding,
    LoginDisclaimer: disclaimer,
  });
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

/* ------------------------------------------------------------------ *
 * Live TV: point Jellyfin at the app's aggregated M3U + XMLTV feed.
 * ------------------------------------------------------------------ */

export type LiveTvSyncResult = {
  ok: boolean;
  tuner: "added" | "updated" | "exists" | "error";
  guide: "added" | "updated" | "exists" | "skipped" | "error";
  message: string;
};

/** Pathname of a URL (ignoring the key query) — used to dedupe our own endpoints. */
function pathOf(url: unknown): string {
  if (typeof url !== "string") return "";
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

/** Trigger the "Refresh Guide" scheduled task so new channels/EPG show up now. */
async function refreshGuide(cfg: JellyfinConfig): Promise<void> {
  const tasks = await jfetch(cfg, "GET", "/ScheduledTasks?isHidden=false");
  if (!tasks.ok || !Array.isArray(tasks.data)) return;
  const t = tasks.data.find(
    (x: any) => x?.Key === "RefreshGuide" || /refresh guide/i.test(String(x?.Name ?? "")),
  );
  if (t?.Id) await jfetch(cfg, "POST", `/ScheduledTasks/Running/${t.Id}`);
}

/**
 * Ensure Jellyfin has an M3U tuner + (optional) XMLTV guide pointing at our
 * aggregated endpoints. Idempotent: matches our endpoints by path so a rotated
 * key heals in place instead of piling up duplicates.
 */
export async function syncLiveTv(
  cfg: JellyfinConfig,
  urls: { m3uUrl: string; epgUrl?: string },
): Promise<LiveTvSyncResult> {
  if (!cfg.url || !cfg.apiKey) {
    return { ok: false, tuner: "error", guide: "skipped", message: "Jellyfin URL + API key required" };
  }

  const opts = await jfetch(cfg, "GET", "/System/Configuration/livetv");
  const tunerHosts: any[] = Array.isArray(opts.data?.TunerHosts) ? opts.data.TunerHosts : [];
  const providers: any[] = Array.isArray(opts.data?.ListingProviders) ? opts.data.ListingProviders : [];

  // ---- M3U tuner ----
  let tuner: LiveTvSyncResult["tuner"] = "error";
  const m3uPath = pathOf(urls.m3uUrl);
  const mine = tunerHosts.find((t) => t?.Type === "m3u" && pathOf(t?.Url) === m3uPath);
  if (mine && mine.Url === urls.m3uUrl) {
    tuner = "exists";
  } else {
    if (mine?.Id) await jfetch(cfg, "DELETE", `/LiveTv/TunerHosts?id=${encodeURIComponent(mine.Id)}`);
    const r = await jfetch(cfg, "POST", "/LiveTv/TunerHosts", {
      Type: "m3u",
      Url: urls.m3uUrl,
      FriendlyName: "Cinevault Live TV",
      AllowHWTranscoding: true,
      EnableStreamLooping: false,
      ImportFavoritesOnly: false,
      TunerCount: 0,
    });
    tuner = r.ok ? (mine ? "updated" : "added") : "error";
  }

  // ---- XMLTV guide (optional) ----
  let guide: LiveTvSyncResult["guide"] = "skipped";
  if (urls.epgUrl) {
    const epgPath = pathOf(urls.epgUrl);
    const mineP = providers.find((p) => p?.Type === "xmltv" && pathOf(p?.Path) === epgPath);
    if (mineP && mineP.Path === urls.epgUrl) {
      guide = "exists";
    } else {
      const r = await jfetch(cfg, "POST", "/LiveTv/ListingProviders?validateListings=false", {
        ...(mineP?.Id ? { Id: mineP.Id } : {}),
        Type: "xmltv",
        Path: urls.epgUrl,
        EnableAllTuners: true,
      });
      guide = r.ok ? (mineP ? "updated" : "added") : "error";
    }
  }

  await refreshGuide(cfg).catch(() => {});

  const ok = tuner !== "error" && guide !== "error";
  const parts = [
    tuner === "error" ? "tuner failed" : `tuner ${tuner}`,
    guide === "skipped" ? null : guide === "error" ? "guide failed" : `guide ${guide}`,
  ].filter(Boolean);
  return { ok, tuner, guide, message: parts.join(", ") };
}

/** Read the current Live TV wiring so the UI can show what's connected. */
export async function getLiveTvStatus(
  cfg: JellyfinConfig,
  urls: { m3uUrl: string; epgUrl?: string },
): Promise<{ reachable: boolean; tunerConfigured: boolean; guideConfigured: boolean }> {
  if (!cfg.url || !cfg.apiKey) return { reachable: false, tunerConfigured: false, guideConfigured: false };
  const opts = await jfetch(cfg, "GET", "/System/Configuration/livetv");
  if (!opts.ok) return { reachable: false, tunerConfigured: false, guideConfigured: false };
  const tunerHosts: any[] = Array.isArray(opts.data?.TunerHosts) ? opts.data.TunerHosts : [];
  const providers: any[] = Array.isArray(opts.data?.ListingProviders) ? opts.data.ListingProviders : [];
  const m3uPath = pathOf(urls.m3uUrl);
  const epgPath = pathOf(urls.epgUrl);
  return {
    reachable: true,
    tunerConfigured: tunerHosts.some((t) => t?.Type === "m3u" && pathOf(t?.Url) === m3uPath),
    guideConfigured: !!epgPath && providers.some((p) => p?.Type === "xmltv" && pathOf(p?.Path) === epgPath),
  };
}
