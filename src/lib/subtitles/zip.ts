/**
 * Minimal ZIP reader for subtitle archives (SubDL always serves .zip).
 *
 * Deliberately dependency-free: subtitle archives are a few KB of plain
 * stored/deflated entries, so parsing the central directory + inflateRaw covers
 * every real case. Anything exotic (encrypted, zip64, split) simply yields no
 * entries and the caller moves on to the next candidate.
 */
import { inflateRawSync } from "node:zlib";

export interface ZipEntry {
  name: string;
  data: Buffer;
}

const EOCD_SIG = 0x06054b50;
const CEN_SIG = 0x02014b50;
const LOC_SIG = 0x04034b50;

/** Hard caps so a hostile archive can't exhaust memory. */
const MAX_ENTRIES = 200;
const MAX_TOTAL_BYTES = 16 * 1024 * 1024;
const MAX_ENTRY_BYTES = 8 * 1024 * 1024;

/** Locate the End-Of-Central-Directory record (scans back over any comment). */
function findEocd(buf: Buffer): number {
  const min = Math.max(0, buf.length - (0xffff + 22));
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === EOCD_SIG) return i;
  }
  return -1;
}

/**
 * Extract every entry of a ZIP buffer. Returns [] for anything unparseable —
 * callers treat that as "this candidate didn't work out", never as fatal.
 */
export function unzip(buf: Buffer): ZipEntry[] {
  const eocd = findEocd(buf);
  if (eocd < 0) return [];
  const count = Math.min(buf.readUInt16LE(eocd + 10), MAX_ENTRIES);
  let p = buf.readUInt32LE(eocd + 16); // offset of the first central-directory entry
  const out: ZipEntry[] = [];
  let total = 0;

  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== CEN_SIG) break;
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const rawSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const flags = buf.readUInt16LE(p + 8);
    const localOff = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;

    if (flags & 0x1) continue; // encrypted
    if (name.endsWith("/")) continue; // directory entry
    if (rawSize > MAX_ENTRY_BYTES || total + rawSize > MAX_TOTAL_BYTES) continue;
    if (localOff + 30 > buf.length || buf.readUInt32LE(localOff) !== LOC_SIG) continue;

    // The local header repeats name/extra lengths; its sizes may be zeroed (data
    // descriptor), so the central directory's sizes above are the ones to trust.
    const lNameLen = buf.readUInt16LE(localOff + 26);
    const lExtraLen = buf.readUInt16LE(localOff + 28);
    const start = localOff + 30 + lNameLen + lExtraLen;
    const end = start + compSize;
    if (end > buf.length) continue;
    const body = buf.subarray(start, end);

    try {
      const data = method === 0 ? Buffer.from(body) : method === 8 ? inflateRawSync(body) : null;
      if (!data || data.length > MAX_ENTRY_BYTES) continue;
      total += data.length;
      out.push({ name, data });
    } catch {
      /* corrupt entry — skip it */
    }
  }
  return out;
}
