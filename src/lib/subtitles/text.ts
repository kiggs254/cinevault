/**
 * Subtitle payload handling: sanity-check that downloaded bytes really are a
 * subtitle (providers happily hand back ad pages / HTML on a bad day), and
 * normalise the text to UTF-8 so Jellyfin never has to guess an encoding.
 */

/** Extensions Jellyfin reads as an external subtitle track. */
export const SUB_EXTS = [".srt", ".ass", ".ssa", ".vtt", ".sub"] as const;
export type SubExt = (typeof SUB_EXTS)[number];

const MIN_BYTES = 64;
const MAX_BYTES = 4 * 1024 * 1024;

/** The subtitle extension of a filename, or null if it isn't one. */
export function subExtOf(name: string): SubExt | null {
  const lower = name.toLowerCase();
  return SUB_EXTS.find((e) => lower.endsWith(e)) ?? null;
}

/**
 * Legacy single-byte encoding to try per language when the bytes aren't valid
 * UTF-8 — the usual case for older uploads from these sites.
 */
function legacyEncodingFor(lang: string): string {
  const l = lang.toLowerCase().split("-")[0];
  if (["ar", "fa", "ur", "ps"].includes(l)) return "windows-1256";
  if (["he", "yi"].includes(l)) return "windows-1255";
  if (["ru", "uk", "bg", "sr", "mk", "be"].includes(l)) return "windows-1251";
  if (["el"].includes(l)) return "windows-1253";
  if (["tr"].includes(l)) return "windows-1254";
  if (["th"].includes(l)) return "windows-874";
  if (["pl", "cs", "sk", "hu", "ro", "hr", "sl", "bs", "sq"].includes(l)) return "windows-1250";
  if (["zh"].includes(l)) return "gbk";
  if (["ja"].includes(l)) return "shift_jis";
  if (["ko"].includes(l)) return "euc-kr";
  return "windows-1252";
}

/** Decode subtitle bytes to text: UTF-8 when valid, else the language's legacy codepage. */
export function decodeSubtitle(bytes: Buffer, lang: string): string {
  let body = bytes;
  // Strip a UTF-8 / UTF-16 BOM before decoding.
  if (body.length >= 3 && body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf) {
    body = body.subarray(3);
  } else if (body.length >= 2 && body[0] === 0xff && body[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(body.subarray(2));
  } else if (body.length >= 2 && body[0] === 0xfe && body[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(body.subarray(2));
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    try {
      return new TextDecoder(legacyEncodingFor(lang)).decode(body);
    } catch {
      return new TextDecoder("windows-1252").decode(body);
    }
  }
}

/**
 * True when `text` really looks like a subtitle of `ext`. Guards against the
 * HTML error/ad pages and "become a VIP member" placeholders these providers
 * sometimes return with a 200.
 */
export function looksLikeSubtitle(text: string, ext: SubExt): boolean {
  const head = text.slice(0, 4096);
  if (/<\s*(?:!doctype|html|head|body)\b/i.test(head)) return false;
  switch (ext) {
    case ".vtt":
      return /^﻿?WEBVTT/.test(text.trimStart());
    case ".ass":
    case ".ssa":
      return /\[script info\]/i.test(head) || /^\s*dialogue\s*:/im.test(text);
    default:
      // .srt / .sub — a cue arrow (srt/vtt-style) or MicroDVD/MPL frame markers.
      return /-->/.test(text) || /^\s*\{\d+\}\{\d+\}/m.test(text) || /^\s*\[\d+\]\[\d+\]/m.test(text);
  }
}

/**
 * Validate + normalise a downloaded subtitle. Returns UTF-8 text ready to store,
 * or null when the payload isn't a usable subtitle.
 */
export function normalizeSubtitle(bytes: Buffer, ext: SubExt, lang: string): string | null {
  if (bytes.length < MIN_BYTES || bytes.length > MAX_BYTES) return null;
  const text = decodeSubtitle(bytes, lang).replace(/\u0000/g, "");
  if (!looksLikeSubtitle(text, ext)) return null;
  return text;
}
