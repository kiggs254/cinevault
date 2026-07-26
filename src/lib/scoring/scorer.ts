import type { ParsedRelease, ScoredResult, TorrentResult } from "../types";

const GB = 1024 * 1024 * 1024;

/** Release groups with a reputation for accurate, non-fake encodes. */
const TRUSTED_GROUPS = new Set([
  "SPARKS", "GECKOS", "AMIABLE", "DRONES", "EVO", "FGT", "NTB", "NTG", "FLUX",
  "TEPES", "CMRG", "TOMMY", "PSA", "QXR", "RARBG", "YTS", "YIFY", "GALAXYRG",
  "SUCCESSFULCRAB", "ETHEL", "MEGUSTA", "ELiTE", "RAWR",
]);

const CAM_MARKERS = /\b(cam|camrip|hdcam|ts|telesync|hdts|tc|telecine|hq[-.\s]?cam|dvdscr|scr)\b/i;

/** Parse quality/source metadata out of a release name. */
export function parseRelease(title: string): ParsedRelease {
  const t = title.toLowerCase();

  let resolution: ParsedRelease["resolution"];
  if (/\b(2160p|4k|uhd)\b/.test(t)) resolution = "2160p";
  else if (/\b1080p\b/.test(t)) resolution = "1080p";
  else if (/\b720p\b/.test(t)) resolution = "720p";
  else if (/\b(480p|sd)\b/.test(t)) resolution = "480p";

  let source: string | undefined;
  if (/\bremux\b/.test(t)) source = "REMUX";
  else if (/\b(bluray|bdrip|brrip|bd25|bd50)\b/.test(t)) source = "BluRay";
  else if (/\bweb[-.\s]?dl\b/.test(t)) source = "WEB-DL";
  else if (/\bweb[-.\s]?rip\b/.test(t)) source = "WEBRip";
  else if (/\bwebrip\b/.test(t)) source = "WEBRip";
  else if (/\bhdtv\b/.test(t)) source = "HDTV";
  else if (/\bdvdrip\b/.test(t)) source = "DVDRip";
  else if (CAM_MARKERS.test(t)) source = "CAM";

  let codec: string | undefined;
  if (/\b(x265|h[.\s]?265|hevc)\b/.test(t)) codec = "x265";
  else if (/\b(x264|h[.\s]?264|avc)\b/.test(t)) codec = "x264";
  else if (/\bav1\b/.test(t)) codec = "AV1";

  let audio: string | undefined;
  if (/\batmos\b/.test(t)) audio = "Atmos";
  else if (/\b(ddp|dd\+|eac3)\b/.test(t)) audio = "DDP";
  else if (/\bdts(-hd)?\b/.test(t)) audio = "DTS";
  else if (/\b(ac3|dd5\.1)\b/.test(t)) audio = "AC3";
  else if (/\baac\b/.test(t)) audio = "AAC";

  const hdr = /\b(hdr10?\+?|dolby[-.\s]?vision|dovi|dv)\b/.test(t);
  const isCam = CAM_MARKERS.test(t);
  const isRepack = /\b(repack|proper)\b/.test(t);
  const seasonPack =
    /\bs\d{1,2}\b(?!\s*e\d)/i.test(title) ||
    /\b(complete|season)\b/i.test(title);

  const groupMatch = title.match(/-([A-Za-z0-9]+)$/);
  const group = groupMatch ? groupMatch[1].toUpperCase() : undefined;

  return { resolution, source, codec, audio, hdr, group, isCam, isRepack, seasonPack };
}

// --- Season / episode classification --------------------------------------
// Release names use dots/underscores/spaces as separators; `[\s._-]*` spans them.

/** True if the name denotes a single episode (S02E05, S02.E05, S2 E5, 2x05). */
export function isSingleEpisodeRelease(title: string): boolean {
  return /\bs\d{1,2}[\s._-]*e\d{1,3}/i.test(title) || /\b\d{1,2}x\d{1,3}\b/i.test(title);
}

const COMPLETE_SERIES = /\b(the[\s._-]*)?complete[\s._-]*(series|collection|box[\s._-]*set|seasons)\b/i;
const SEASON_RANGE =
  /\bs(?:eason)?s?[\s._-]*0*(\d{1,2})[\s._-]*(?:-|–|—|to)[\s._-]*s?(?:eason)?[\s._-]*0*(\d{1,2})\b/i;

/**
 * Inclusive test: does this release contain `season`? Covers single-season names,
 * ranges (S01-S03), and complete-series/collection packs. False for single
 * episodes and "Season N Episode M". Used to filter re-source candidates.
 */
export function releaseCoversSeason(title: string, season: number): boolean {
  if (season <= 0 || isSingleEpisodeRelease(title)) return false;

  // Complete series/collection with no specific season token → covers everything.
  if (COMPLETE_SERIES.test(title) && !/\bseason[\s._-]*0*\d/i.test(title)) return true;

  const range = title.match(SEASON_RANGE);
  if (range) {
    const lo = Math.min(Number(range[1]), Number(range[2]));
    const hi = Math.max(Number(range[1]), Number(range[2]));
    if (season >= lo && season <= hi) return true;
  }

  if (seasonWordMatches(title, season)) return true;
  return new RegExp(`\\bs0*${season}\\b(?![\\s._-]*e\\d)`, "i").test(title);
}

/**
 * Exclusive test: is this a pack for EXACTLY this one season (not a range,
 * complete-series, or single episode)? Used to select a season pack so a
 * multi-season pack can't be grabbed once per selected season.
 */
export function isSingleSeasonPack(title: string, season: number): boolean {
  if (season <= 0 || isSingleEpisodeRelease(title)) return false;
  if (/\bseasons\b/i.test(title)) return false; // plural → multi-season
  if (COMPLETE_SERIES.test(title)) return false;
  if (SEASON_RANGE.test(title)) return false;
  return seasonWordMatches(title, season);
}

/** "Season N" or bare "S0N" for exactly `season`, excluding "Season N Episode M". */
function seasonWordMatches(title: string, season: number): boolean {
  if (new RegExp(`\\bseason[\\s._-]*0*${season}[\\s._-]*e`, "i").test(title)) return false; // "Season 2 Episode 5"
  const word = new RegExp(`\\bseason[\\s._-]*0*${season}\\b`, "i");
  const bare = new RegExp(`\\bs0*${season}\\b(?![\\s._-]*e\\d)`, "i");
  return word.test(title) || bare.test(title);
}

export interface ScorePrefs {
  preferredQuality: string; // "2160p" | "1080p" | "720p" | "480p" | "any"
  minSeeders: number;
  maxSizeGB: number;
  kind: "MOVIE" | "TV" | "MUSIC" | "SOFTWARE" | "OTHER";
}

/** Score a single result. Higher is better. Includes human-readable reasons. */
export function scoreResult(r: TorrentResult, prefs: ScorePrefs): ScoredResult {
  const parsed = parseRelease(r.title);
  const reasons: string[] = [];
  let score = 0;

  // Seeders — the strongest health signal (diminishing returns).
  const seedScore = Math.min(40, Math.round(Math.log2(r.seeders + 1) * 8));
  score += seedScore;
  reasons.push(`${r.seeders} seeders (+${seedScore})`);
  if (r.seeders < prefs.minSeeders) {
    score -= 25;
    reasons.push(`below min seeders (-25)`);
  }

  // Quality match.
  if (prefs.preferredQuality !== "any" && parsed.resolution) {
    if (parsed.resolution === prefs.preferredQuality) {
      score += 25;
      reasons.push(`matches preferred ${prefs.preferredQuality} (+25)`);
    } else {
      score -= 8;
      reasons.push(`${parsed.resolution} != preferred (-8)`);
    }
  }

  // Source / codec bonuses.
  if (parsed.source === "BluRay" || parsed.source === "WEB-DL") {
    score += 10;
    reasons.push(`${parsed.source} source (+10)`);
  }
  if (parsed.codec === "x265" || parsed.codec === "AV1") {
    score += 5;
    reasons.push(`efficient ${parsed.codec} (+5)`);
  }

  // Hard penalties for junk.
  if (parsed.isCam) {
    score -= 60;
    reasons.push(`CAM/TS quality (-60)`);
  }
  if (parsed.isRepack) {
    score += 4;
    reasons.push(`repack/proper (+4)`);
  }

  // Size sanity.
  const sizeGB = r.size / GB;
  if (prefs.kind === "MOVIE" && parsed.resolution && parsed.resolution !== "480p" && sizeGB < 0.2) {
    score -= 40;
    reasons.push(`suspiciously tiny for HD (-40)`);
  }
  if (sizeGB > prefs.maxSizeGB) {
    const over = Math.min(30, Math.round((sizeGB - prefs.maxSizeGB) * 2));
    score -= over;
    reasons.push(`${sizeGB.toFixed(1)}GB over budget (-${over})`);
  }

  // Trusted release group.
  if (parsed.group && TRUSTED_GROUPS.has(parsed.group)) {
    score += 8;
    reasons.push(`trusted group ${parsed.group} (+8)`);
  }

  return { ...r, parsed, score, reasons };
}

/** Score + sort a batch, best first. */
export function rankResults(results: TorrentResult[], prefs: ScorePrefs): ScoredResult[] {
  return results.map((r) => scoreResult(r, prefs)).sort((a, b) => b.score - a.score);
}

/**
 * Auto-pick for unattended/agent downloads: prefer 720p, then the SMALLEST file
 * among the well-seeded tier. Rejects CAMs and absurdly tiny (fake) releases.
 * This is the "720p, smallest file with the most seeders" policy.
 */
export function pickAutoRelease(
  results: TorrentResult[],
  opts: { minSeeders?: number; floorGB?: number } = {},
): ScoredResult | null {
  const minSeeders = Math.max(1, opts.minSeeders ?? 1);
  const floor = (opts.floorGB ?? 0.05) * GB; // reject fake tiny files
  const parsed = results.map((r) => ({ r, p: parseRelease(r.title) }));
  const usable = parsed.filter(
    (x) =>
      !x.p.isCam &&
      x.r.size >= floor &&
      (x.r.seeders ?? 0) >= minSeeders &&
      (x.r.magnetUrl || x.r.downloadUrl),
  );
  if (usable.length === 0) return null;

  // Prefer 720p; fall back to any usable resolution if there are none.
  const at720 = usable.filter((x) => x.p.resolution === "720p");
  const pool = at720.length ? at720 : usable;

  // Keep the well-seeded tier (within 40% of the best), then take the smallest.
  const maxSeed = Math.max(...pool.map((x) => x.r.seeders ?? 0));
  const healthy = pool.filter((x) => (x.r.seeders ?? 0) >= Math.max(minSeeders, maxSeed * 0.4));
  healthy.sort((a, b) => a.r.size - b.r.size);
  const chosen = (healthy[0] ?? pool[0]).r;

  return scoreResult(chosen, {
    preferredQuality: "720p",
    minSeeders,
    maxSizeGB: Number.MAX_SAFE_INTEGER,
    kind: "OTHER",
  });
}
