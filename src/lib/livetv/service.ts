import crypto from "node:crypto";
import type { Playlist } from "@prisma/client";
import { prisma } from "../db";
import { getConfig, saveConfig } from "../config";
import { fetchRemoteText, countChannels, mergeM3u, looksLikeM3u } from "./m3u";
import { mergeEpg } from "./epg";

/**
 * CRUD + aggregation for live-TV playlists. Playlists are admin-managed and
 * shared to the whole community (Jellyfin's Live TV tuner is server-wide). The
 * merged M3U/EPG is served from key-gated public endpoints that Jellyfin loads.
 */

export interface PlaylistInput {
  name: string;
  sourceType: "url" | "text";
  url?: string | null;
  content?: string | null;
  epgUrl?: string | null;
  enabled?: boolean;
}

const M3U_TTL = 60_000; // 1 min — smooths repeated tuner refreshes
const EPG_TTL = 10 * 60_000; // 10 min — guide data changes slowly
let m3uCache: { at: number; val: string } | null = null;
let epgCache: { at: number; val: string } | null = null;
function invalidateCache() {
  m3uCache = null;
  epgCache = null;
}

/** Get (or lazily create + persist) the bearer key guarding the public endpoints. */
export async function getLiveTvKey(): Promise<string> {
  const cfg = await getConfig();
  if (cfg.liveTv.key) return cfg.liveTv.key;
  const key = crypto.randomBytes(24).toString("base64url");
  await saveConfig({ liveTvKey: key });
  return key;
}

/** Constant-time compare of a provided key against the configured one. */
export function keyMatches(provided: string | null, actual: string | undefined): boolean {
  if (!provided || !actual) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(actual);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

export async function listPlaylists(): Promise<Playlist[]> {
  return prisma.playlist.findMany({ orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
}

/** Load the raw M3U body for one source (fetch a URL, or return the pasted text). */
async function sourceText(p: {
  sourceType: string;
  url: string | null;
  content: string | null;
}): Promise<string> {
  if (p.sourceType === "text") return p.content ?? "";
  if (!p.url) throw new Error("No URL set");
  return fetchRemoteText(p.url);
}

/** Validate a source without saving: fetch/parse and count channels. */
export async function validateSource(
  input: Pick<PlaylistInput, "sourceType" | "url" | "content">,
): Promise<{ ok: boolean; channelCount: number; message: string }> {
  try {
    const text = await sourceText({
      sourceType: input.sourceType,
      url: input.url ?? null,
      content: input.content ?? null,
    });
    if (!looksLikeM3u(text)) {
      return { ok: false, channelCount: 0, message: "That does not look like an M3U playlist" };
    }
    const n = countChannels(text);
    if (n === 0) return { ok: false, channelCount: 0, message: "No channels (#EXTINF) found" };
    return { ok: true, channelCount: n, message: `${n} channel${n === 1 ? "" : "s"} found` };
  } catch (e) {
    return { ok: false, channelCount: 0, message: (e as Error).message };
  }
}

export async function createPlaylist(input: PlaylistInput): Promise<Playlist> {
  const agg = await prisma.playlist.aggregate({ _max: { order: true } });
  const order = (agg._max.order ?? -1) + 1;
  const v = await validateSource(input);
  invalidateCache();
  return prisma.playlist.create({
    data: {
      name: input.name.trim() || "Untitled",
      sourceType: input.sourceType,
      url: input.sourceType === "url" ? input.url?.trim() || null : null,
      content: input.sourceType === "text" ? input.content ?? null : null,
      epgUrl: input.epgUrl?.trim() || null,
      enabled: input.enabled ?? true,
      order,
      channelCount: v.channelCount,
      lastError: v.ok ? null : v.message,
      refreshedAt: v.ok ? new Date() : null,
    },
  });
}

export async function updatePlaylist(
  id: string,
  patch: Partial<PlaylistInput> & { order?: number },
): Promise<Playlist> {
  const existing = await prisma.playlist.findUnique({ where: { id } });
  if (!existing) throw new Error("Not found");

  const sourceType = patch.sourceType ?? (existing.sourceType as "url" | "text");
  const next = {
    name: patch.name?.trim() || existing.name,
    sourceType,
    url: sourceType === "url" ? (patch.url ?? existing.url)?.trim() || null : null,
    content: sourceType === "text" ? patch.content ?? existing.content : null,
    epgUrl: patch.epgUrl !== undefined ? patch.epgUrl?.trim() || null : existing.epgUrl,
    enabled: patch.enabled ?? existing.enabled,
    order: patch.order ?? existing.order,
  };

  let { channelCount, lastError, refreshedAt } = existing;
  const sourceChanged =
    next.url !== existing.url ||
    next.content !== existing.content ||
    next.sourceType !== existing.sourceType;
  if (sourceChanged) {
    const v = await validateSource(next);
    channelCount = v.channelCount;
    lastError = v.ok ? null : v.message;
    refreshedAt = v.ok ? new Date() : existing.refreshedAt;
  }
  invalidateCache();
  return prisma.playlist.update({
    where: { id },
    data: { ...next, channelCount, lastError, refreshedAt },
  });
}

export async function deletePlaylist(id: string): Promise<void> {
  invalidateCache();
  await prisma.playlist.delete({ where: { id } }).catch(() => {});
}

/** Reorder a playlist up/down by swapping the `order` with its neighbour. */
export async function movePlaylist(id: string, dir: "up" | "down"): Promise<void> {
  const all = await listPlaylists();
  const idx = all.findIndex((p) => p.id === id);
  if (idx === -1) return;
  const swapIdx = dir === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= all.length) return;
  const a = all[idx];
  const b = all[swapIdx];
  invalidateCache();
  await prisma.$transaction([
    prisma.playlist.update({ where: { id: a.id }, data: { order: b.order } }),
    prisma.playlist.update({ where: { id: b.id }, data: { order: a.order } }),
  ]);
}

/**
 * Build the aggregated M3U (cached briefly). Refreshes each source's health
 * (channelCount / lastError / refreshedAt) as a side effect.
 */
export async function buildMergedM3u(): Promise<string> {
  if (m3uCache && Date.now() - m3uCache.at < M3U_TTL) return m3uCache.val;
  const cfg = await getConfig();
  const playlists = await prisma.playlist.findMany({
    where: { enabled: true },
    orderBy: [{ order: "asc" }, { createdAt: "asc" }],
  });
  const sources: { name: string; text: string }[] = [];
  for (const p of playlists) {
    try {
      const text = await sourceText(p);
      sources.push({ name: p.name, text });
      await prisma.playlist
        .update({
          where: { id: p.id },
          data: { channelCount: countChannels(text), lastError: null, refreshedAt: new Date() },
        })
        .catch(() => {});
    } catch (e) {
      await prisma.playlist
        .update({ where: { id: p.id }, data: { lastError: (e as Error).message } })
        .catch(() => {});
    }
  }
  const merged = mergeM3u(sources, { groupBySource: cfg.liveTv.groupBySource });
  m3uCache = { at: Date.now(), val: merged };
  return merged;
}

/** Build the aggregated XMLTV EPG from every enabled source that has an epgUrl. */
export async function buildMergedEpg(): Promise<string> {
  if (epgCache && Date.now() - epgCache.at < EPG_TTL) return epgCache.val;
  const playlists = await prisma.playlist.findMany({
    where: { enabled: true, epgUrl: { not: null } },
    orderBy: [{ order: "asc" }],
  });
  const docs: string[] = [];
  for (const p of playlists) {
    if (!p.epgUrl) continue;
    try {
      docs.push(await fetchRemoteText(p.epgUrl));
    } catch {
      /* skip a broken EPG source rather than failing the whole guide */
    }
  }
  const merged = mergeEpg(docs);
  epgCache = { at: Date.now(), val: merged };
  return merged;
}

/** Public URLs (with key) that Jellyfin loads. */
export function liveTvUrls(appUrl: string, key: string): { m3u: string; epg: string } {
  const base = appUrl.replace(/\/+$/, "");
  const q = `?key=${encodeURIComponent(key)}`;
  return { m3u: `${base}/api/livetv/m3u${q}`, epg: `${base}/api/livetv/epg${q}` };
}

/** Whether any enabled playlist supplies EPG data (so we bother wiring the guide). */
export async function hasEpg(): Promise<boolean> {
  const n = await prisma.playlist.count({ where: { enabled: true, epgUrl: { not: null } } });
  return n > 0;
}
