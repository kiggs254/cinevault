/**
 * The sidecar naming rules — pure, side-effect-free, and the contract Jellyfin
 * actually pairs on: a subtitle for "<folder>/Movie.mkv" must be
 * "<folder>/Movie.<lang>.srt". Kept apart from the service so the rules can be
 * reasoned about (and exercised) without S3 or the database in the way.
 */
import type { Prisma } from "@prisma/client";
import { isVideoKey, isSubtitleKey } from "../storage/s3";
import { matchesEpisode, parseEpisode } from "./match";
import { subExtOf, SUB_EXTS } from "./text";
import { ALL_LANG_TOKENS, langTokens } from "./langs";

/** Image-based VobSub (.sub/.idx) is meaningless without its pair — never adopted. */
const ADOPTABLE_EXTS: readonly string[] = SUB_EXTS.filter((e) => e !== ".sub");

export type Kind = "MOVIE" | "TV";

export interface Target {
  videoKey: string;
  folder: string;
  videoName: string;
  season: number | null;
  episode: number | null;
}

export interface Row {
  id: string;
  kind: string;
  title: string;
  year: number | null;
  season: number | null;
  episode: number | null;
  tmdbId: number | null;
  s3Key: string | null;
  s3Bucket: string | null;
  metadata: Prisma.JsonValue | null;
  subsAttempts: number;
}

export function metaRecord(metadata: unknown): Record<string, unknown> {
  return metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
}

export function keysOf(row: Row): string[] {
  const meta = metaRecord(row.metadata);
  const stored = Array.isArray(meta.s3Keys)
    ? (meta.s3Keys as unknown[]).filter((k): k is string => typeof k === "string")
    : [];
  const all = stored.length ? stored : row.s3Key ? [row.s3Key] : [];
  return Array.from(new Set(all));
}

export const baseName = (key: string) => key.slice(key.lastIndexOf("/") + 1);
export const folderOf = (key: string) => key.slice(0, key.lastIndexOf("/") + 1);
/** "TV/Show/Season 01/S01E02.mkv" → "TV/Show/Season 01/S01E02" */
export const stemOf = (key: string) => key.replace(/\.[^./]+$/, "");

/**
 * Every video this row owns, with the season/episode it represents. A season pack
 * is one row holding many episodes, so each file is resolved individually — the
 * whole point, since each episode needs its own subtitle.
 */
export function targetsOf(row: Row): Target[] {
  const kind: Kind = row.kind === "TV" ? "TV" : "MOVIE";
  const videos = keysOf(row).filter((k) => isVideoKey(baseName(k)));
  return videos.map((videoKey) => {
    const name = baseName(videoKey);
    const parsed = kind === "TV" ? parseEpisode(name) : null;
    return {
      videoKey,
      folder: folderOf(videoKey),
      videoName: name,
      season: kind === "TV" ? (parsed?.season ?? row.season) : null,
      episode: kind === "TV" ? (parsed?.episode ?? row.episode) : null,
    };
  });
}

/** The sidecar key Jellyfin will pair with this video for `lang`. */
export function sidecarKey(videoKey: string, lang: string, ext: string): string {
  return `${stemOf(videoKey)}.${lang}${ext}`;
}

/**
 * The language segment of a sidecar key, if it is one: in "Movie.eng.forced.srt"
 * beside "Movie.mkv", that's "eng". Returns null when the key isn't a sidecar of
 * `videoKey`, or carries no segment we recognise as a language.
 */
export function sidecarLangSegment(key: string, videoKey: string): string | null {
  const k = key.toLowerCase();
  const ext = subExtOf(k);
  if (!ext) return null;
  const stem = `${stemOf(videoKey).toLowerCase()}.`;
  if (!k.startsWith(stem)) return null;
  const first = k.slice(stem.length, k.length - ext.length).split(".")[0];
  return ALL_LANG_TOKENS.has(first) ? first : null;
}

/**
 * Is a sidecar for `lang` already next to this video? Matched by segment, not by
 * prefix, so "Movie.eng.srt" counts as English (Jellyfin reads either spelling)
 * while "Movie.enx.srt" or another language's sidecar does not.
 */
export function hasSidecar(existing: Set<string>, videoKey: string, lang: string): boolean {
  const tokens = new Set(langTokens(lang));
  for (const key of existing) {
    const seg = sidecarLangSegment(key, videoKey);
    if (seg && tokens.has(seg)) return true;
  }
  return false;
}

/** Does this key's own name (or its folder) explicitly say it is `lang`? */
export function labelsLanguage(key: string, lang: string): boolean {
  const parts = key.toLowerCase().split("/");
  // Only the filename and its immediate folder — the title path above would make
  // short codes ("en", "it") match by accident.
  const hay = parts.slice(-2).join("/");
  return langTokens(lang).some((t) =>
    t.length <= 3 ? new RegExp(`(^|[^a-z])${t}([^a-z]|$)`).test(hay) : hay.includes(t),
  );
}

/**
 * Subtitle files this download shipped that aren't already a language-labelled
 * sidecar — candidates for adoption. Scans the download's own key list (a
 * release often buries them in "Subs/", a different folder from the video) as
 * well as whatever the video's folder holds.
 */
export function adoptableCandidates(keys: Iterable<string>, videoKeys: string[]): string[] {
  const out: string[] = [];
  for (const k of keys) {
    const name = baseName(k);
    if (!isSubtitleKey(name)) continue;
    const ext = subExtOf(name.toLowerCase());
    if (!ext || !ADOPTABLE_EXTS.includes(ext)) continue;
    // Already named the way Jellyfin pairs → nothing to do, and never re-label it.
    if (videoKeys.some((v) => sidecarLangSegment(k, v) !== null)) continue;
    out.push(k);
  }
  return out;
}

/**
 * Pick a shipped subtitle to claim for this video + language, from `pool`.
 * Deliberately strict: the file must say which language it is (".eng.srt",
 * "Subs/2_English.srt"), and for an episode it must name that episode. An
 * unlabelled leftover is left alone — Jellyfin still offers it as an untagged
 * track, and guessing its language could suppress fetching the real one.
 */
export function findAdoptable(pool: Iterable<string>, target: Target, lang: string): string | null {
  const mine: string[] = [];
  for (const k of pool) {
    if (!labelsLanguage(k, lang)) continue;
    const name = baseName(k);
    if (target.episode != null) {
      if (!matchesEpisode(name, target.season, target.episode)) continue;
    } else if (parseEpisode(name) !== null) {
      continue; // an episode-tagged leftover in a movie folder isn't ours
    }
    mine.push(k);
  }
  if (!mine.length) return null;
  // Prefer one already sitting beside this video, then .srt, then any.
  const stem = `${stemOf(target.videoKey)}.`;
  mine.sort(
    (a, b) =>
      Number(b.startsWith(stem)) - Number(a.startsWith(stem)) ||
      Number(b.toLowerCase().endsWith(".srt")) - Number(a.toLowerCase().endsWith(".srt")),
  );
  return mine[0];
}
