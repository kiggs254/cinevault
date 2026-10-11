/**
 * Matching helpers: how well a subtitle release lines up with the video file we
 * actually stored, and which file inside a season-pack archive is the episode we
 * want. Release affinity matters for more than tidiness — a subtitle cut for the
 * same release is the one that's actually in sync.
 */
import { subExtOf, type SubExt } from "./text";
import type { ZipEntry } from "./zip";

/** Tokens worth comparing between a video filename and a subtitle's release name. */
const NOISE_TOKENS = new Set([
  "the", "a", "an", "and", "of", "mkv", "mp4", "avi", "srt", "sub", "subs", "subtitle",
  "subtitles", "www", "com", "org", "net", "x", "s", "e", "season", "episode",
]);

export function releaseTokens(name: string): Set<string> {
  return new Set(
    name
      .toLowerCase()
      .replace(/\.[a-z0-9]{2,4}$/, "")
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length >= 2 && !NOISE_TOKENS.has(t)),
  );
}

/**
 * 0..1 overlap between the stored video's filename and a subtitle's release
 * name. Uses the subtitle side as the denominator so a short release string that
 * is fully contained in the filename still scores high.
 */
export function releaseAffinity(videoName: string, releaseName: string): number {
  if (!releaseName) return 0;
  const want = releaseTokens(videoName);
  const got = releaseTokens(releaseName);
  if (!want.size || !got.size) return 0;
  let hits = 0;
  for (const t of got) if (want.has(t)) hits++;
  return hits / got.size;
}

const SXXEYY = /s0*(\d{1,3})[\s._-]*e0*(\d{1,3})/i;
const NXN = /(?:^|[^\d])0*(\d{1,2})\s*x\s*0*(\d{1,3})(?:[^\d]|$)/i;
const EP_ONLY = /(?:^|[\s._\-[])e(?:p(?:isode)?)?[\s._-]*0*(\d{1,3})(?:[\s._\-\])]|$)/i;

/** Parse a (season, episode) pair out of a filename, when it carries one. */
export function parseEpisode(name: string): { season: number | null; episode: number } | null {
  let m = SXXEYY.exec(name);
  if (m) return { season: Number(m[1]), episode: Number(m[2]) };
  m = NXN.exec(name);
  if (m) return { season: Number(m[1]), episode: Number(m[2]) };
  m = EP_ONLY.exec(name);
  if (m) return { season: null, episode: Number(m[1]) };
  return null;
}

/** True when `name` identifies exactly this season+episode. */
export function matchesEpisode(name: string, season: number | null, episode: number): boolean {
  const p = parseEpisode(name);
  if (!p || p.episode !== episode) return false;
  // A filename with no season (e.g. "E04.srt" inside a season folder) is accepted;
  // one that names a different season is not.
  return p.season == null || season == null || p.season === season;
}

export interface PickedEntry {
  entry: ZipEntry;
  ext: SubExt;
}

/**
 * Choose the subtitle file to use out of an archive's entries. For an episode,
 * only a file that identifies that episode is acceptable (a season pack holds
 * them all — grabbing an arbitrary one would mis-sync every episode). For a
 * movie, the largest subtitle wins (the full feature over a "forced"/sign track).
 */
export function pickEntry(
  entries: ZipEntry[],
  want: { season: number | null; episode: number | null },
): PickedEntry | null {
  const subs = entries
    .map((entry) => {
      const base = entry.name.split("/").pop() ?? entry.name;
      const ext = subExtOf(base);
      return ext ? { entry, ext, base } : null;
    })
    .filter((x): x is { entry: ZipEntry; ext: SubExt; base: string } => x !== null)
    .filter((x) => !/(^|[/\\])__MACOSX([/\\]|$)/i.test(x.entry.name) && !x.base.startsWith("."));
  if (!subs.length) return null;

  const pool =
    want.episode != null
      ? subs.filter((x) => matchesEpisode(x.base, want.season, want.episode!))
      : subs;
  if (!pool.length) return null;

  // Prefer .srt (widest player support), then the biggest file.
  pool.sort(
    (a, b) =>
      Number(b.ext === ".srt") - Number(a.ext === ".srt") ||
      b.entry.data.length - a.entry.data.length,
  );
  return { entry: pool[0].entry, ext: pool[0].ext };
}
