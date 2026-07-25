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
