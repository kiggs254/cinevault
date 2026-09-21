import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
  CopyObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import type { ResolvedConfig } from "../config";

export type S3Config = ResolvedConfig["s3"];

/** Build an S3 client for Contabo / any S3-compatible endpoint. */
export function makeS3(cfg: S3Config): S3Client {
  if (!cfg.endpoint || !cfg.accessKeyId || !cfg.secretAccessKey) {
    throw new Error("S3 storage is not fully configured (endpoint + credentials)");
  }
  return new S3Client({
    region: cfg.region || "default",
    endpoint: cfg.endpoint,
    forcePathStyle: true, // Contabo (Ceph) requires path-style addressing
    disableS3ExpressSessionAuth: true,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
}

const MIME: Record<string, string> = {
  ".mp4": "video/mp4",
  ".mkv": "video/x-matroska",
  ".avi": "video/x-msvideo",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".flac": "audio/flac",
  ".m4a": "audio/mp4",
  ".srt": "application/x-subrip",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".nfo": "text/plain",
};

function guessType(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream";
}

interface LocalFile {
  abs: string;
  rel: string;
  size: number;
}

async function collectFiles(target: string): Promise<LocalFile[]> {
  const stat = await fs.promises.stat(target);
  if (stat.isFile()) {
    return [{ abs: target, rel: path.basename(target), size: stat.size }];
  }
  const out: LocalFile[] = [];
  async function walk(dir: string, base: string): Promise<void> {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(dir, e.name);
      const rel = base ? `${base}/${e.name}` : e.name;
      if (e.isDirectory()) await walk(full, rel);
      else if (e.isFile()) {
        const s = await fs.promises.stat(full);
        out.push({ abs: full, rel, size: s.size });
      }
    }
  }
  await walk(target, "");
  return out;
}

/**
 * Upload a local file or directory tree to S3 under `keyPrefix`, using
 * multipart uploads. Reports cumulative byte progress. Skips junk files.
 */
export async function uploadContent(opts: {
  s3: S3Client;
  bucket: string;
  contentPath: string;
  keyPrefix: string;
  onProgress?: (uploadedBytes: number, totalBytes: number) => void;
}): Promise<{ keys: string[]; bytes: number; primaryKey: string }> {
  const files = await collectFiles(opts.contentPath);
  const prefix = opts.keyPrefix.replace(/^\/+|\/+$/g, "");

  // Only upload real media; drop promo/junk, coerce bogus video extensions, then
  // keep one best file per episode (skip extras) so a pack never yields duplicates.
  const candidates = files
    .map((f) => ({ item: f, name: classifyUploadName(f.rel.split("/").pop() ?? "", f.size), size: f.size, path: f.rel }))
    .filter((x): x is { item: (typeof files)[number]; name: string; size: number; path: string } => x.name !== null);
  const uploadable = selectOneFilePerEpisode(candidates).map(({ item, name }) => ({ f: item, name }));
  const uploadTotal = uploadable.reduce((a, x) => a + x.f.size, 0);

  let doneBytes = 0;
  const keys: string[] = [];
  let primaryKey = "";
  let primarySize = -1;

  for (const { f, name } of uploadable) {
    const seg = f.rel.split("/");
    seg[seg.length - 1] = name;
    const key = `${prefix}/${seg.join("/")}`;
    let fileLoaded = 0;
    const upload = new Upload({
      client: opts.s3,
      params: {
        Bucket: opts.bucket,
        Key: key,
        Body: fs.createReadStream(f.abs),
        ContentType: guessType(f.abs),
      },
      queueSize: 4,
      partSize: 16 * 1024 * 1024,
    });
    upload.on("httpUploadProgress", (p) => {
      const loaded = p.loaded ?? 0;
      doneBytes += loaded - fileLoaded;
      fileLoaded = loaded;
      opts.onProgress?.(doneBytes, uploadTotal);
    });
    await upload.done();
    keys.push(key);
    if (f.size > primarySize) {
      primarySize = f.size;
      primaryKey = key;
    }
  }
  return { keys, bytes: uploadTotal, primaryKey };
}

/**
 * Stream an arbitrary readable (e.g. a remote HTTP body from TorBox) straight to
 * one S3 key via multipart upload — the bytes never touch local disk, only a
 * bounded in-flight buffer (partSize × queueSize). Reports cumulative bytes.
 */
export async function uploadStream(opts: {
  s3: S3Client;
  bucket: string;
  key: string;
  body: Readable;
  contentType?: string;
  onProgress?: (uploadedBytes: number) => void;
}): Promise<void> {
  const upload = new Upload({
    client: opts.s3,
    params: {
      Bucket: opts.bucket,
      Key: opts.key,
      Body: opts.body,
      ContentType: opts.contentType ?? guessType(opts.key),
    },
    queueSize: 4,
    partSize: 16 * 1024 * 1024,
  });
  if (opts.onProgress) {
    upload.on("httpUploadProgress", (p) => opts.onProgress!(p.loaded ?? 0));
  }
  await upload.done();
}

export interface S3Entry {
  key: string;
  size: number;
  lastModified?: string;
  isFolder: boolean;
}

/** List one "folder" level under a prefix (delimiter-based). */
export async function listObjects(
  s3: S3Client,
  bucket: string,
  prefix = "",
): Promise<S3Entry[]> {
  const res = await s3.send(
    new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      Delimiter: "/",
    }),
  );
  const folders: S3Entry[] = (res.CommonPrefixes ?? []).map((p) => ({
    key: p.Prefix ?? "",
    size: 0,
    isFolder: true,
  }));
  const files: S3Entry[] = (res.Contents ?? [])
    .filter((o) => (o.Key ?? "") !== prefix)
    .map((o) => ({
      key: o.Key ?? "",
      size: o.Size ?? 0,
      lastModified: o.LastModified?.toISOString(),
      isFolder: false,
    }));
  return [...folders, ...files];
}

/** Presigned GET URL (for streaming/downloading from the Library UI). */
export async function presignGet(
  s3: S3Client,
  bucket: string,
  key: string,
  expiresIn = 3600,
): Promise<string> {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key }), {
    expiresIn,
  });
}

export async function deleteObject(
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<void> {
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

/** Object size in bytes (HEAD), or null if it doesn't exist / can't be read. */
export async function headObjectSize(
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<number | null> {
  try {
    const r = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return typeof r.ContentLength === "number" ? r.ContentLength : null;
  } catch {
    return null;
  }
}

/** Rename an object in place (server-side copy + delete). No-op if from === to. */
export async function renameObject(
  s3: S3Client,
  bucket: string,
  from: string,
  to: string,
): Promise<void> {
  if (from === to) return;
  await s3.send(
    new CopyObjectCommand({ Bucket: bucket, CopySource: `${bucket}/${encodeURI(from)}`, Key: to }),
  );
  await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: from }));
}

/** Video containers Jellyfin indexes as movies/episodes. */
const VIDEO_EXT = /\.(mkv|mp4|m4v|avi|mov|ts|m2ts|webm|mpg|mpeg|wmv|flv|3gp|ogv)$/i;
/** Subtitle sidecars Jellyfin picks up (kept regardless of size). */
const SUBTITLE_EXT = /\.(srt|ass|ssa|sub|idx|vtt)$/i;
/** Obvious junk bundled in torrents — never worth storing. */
const JUNK_EXT = /\.(txt|nfo|jpg|jpeg|png|gif|webp|bmp|url|html?|md|sfv|diz|srr|par2|rar|zip|7z|ini|db|torrent|parts|aria2)$/i;
/** Below this a "video" is really a promo/sample clip, not the feature. */
const MIN_VIDEO_BYTES = 20 * 1024 * 1024;

const isMedia = (name: string) => VIDEO_EXT.test(name) || SUBTITLE_EXT.test(name);

/** Coerce a bogus/executable/missing extension to ".mkv" (leaves media as-is). */
export function mediaSafeName(name: string): string {
  const trimmed = name.trim();
  if (isMedia(trimmed)) return trimmed;
  return trimmed.replace(/\s*\.[^.\s/\\]{1,5}$/i, "").trimEnd() + ".mkv";
}

/**
 * Decide how a torrent file should be stored, so Jellyfin only ever sees real
 * media. Returns the S3-safe filename, or `null` to skip the file entirely.
 *  - real media/subtitles → kept as-is;
 *  - a LARGE file with a bogus/executable/missing extension (scene releases hide
 *    the video behind ".exe" etc.) → coerced to ".mkv";
 *  - everything else (promo .txt/.jpg, tiny "sample" clips, archives) → skipped.
 */
export function classifyUploadName(name: string, sizeBytes: number): string | null {
  const base = name.trim();
  if (isMedia(base)) return base;
  if (JUNK_EXT.test(base)) return null;
  if (sizeBytes >= MIN_VIDEO_BYTES) return mediaSafeName(base);
  return null;
}

/** Season-folder subtrees that are extras, not episodes — even if named SxxEyy. */
const EXTRAS_PATH =
  /(^|[/\\])(extras?|featurettes?|specials?|samples?|bonus|interviews?|deleted[ ._-]?scenes|behind[ ._-]?the[ ._-]?scenes|bloopers?|making[ ._-]?of)([/\\]|$)/i;
/** SxxEyy anywhere in a filename. */
const EPISODE_RE = /s(\d{1,2})e(\d{1,3})/i;
/** Foreign-language / dual-audio markers — de-prioritised so the English file wins. */
const FOREIGN_TAG = /\b(ita|spa|esp|fre|fra|vf|ger|deu|rus|multi|dual|vostfr|hindi|tam|tel|kor|jpn|jap|por|dan|swe|nor|nl|pl|cz|hun)\b/i;

/** Rank a candidate pack file: prefer non-foreign, higher-res; size breaks ties. */
export function packFileScore(name: string, size: number): number {
  const l = name.toLowerCase();
  let s = 0;
  if (FOREIGN_TAG.test(l)) s -= 1000;
  if (/2160p|\b4k\b/.test(l)) s += 40;
  else if (/1080p/.test(l)) s += 20;
  else if (/720p/.test(l)) s += 10;
  if (/x265|hevc/.test(l)) s += 2;
  return s * 1e13 + size; // score dominates; byte size is the tiebreak
}

/** Parsed "season x episode" key for a filename, or null if it isn't an episode. */
export function episodeKeyOf(name: string): string | null {
  const m = EPISODE_RE.exec(name);
  return m ? `${Number(m[1])}x${Number(m[2])}` : null;
}

/** True if a file's full path lives under an extras/featurettes/sample subtree. */
export function isExtrasPath(fullPath: string): boolean {
  return EXTRAS_PATH.test(fullPath);
}

/**
 * From a pack's candidate files, keep exactly ONE file per episode so Jellyfin
 * never shows duplicates: drop anything under an extras/featurettes/sample subtree,
 * then for each SxxEyy keep the best-scoring release (English / highest-res /
 * largest). Files with no episode number (a movie, a whole-season single file, or
 * subtitles) all pass through. `path` is the file's full path in the torrent (used
 * for the extras check); `name` is the storage-safe filename.
 */
export function selectOneFilePerEpisode<T>(
  files: { item: T; name: string; size: number; path: string }[],
): { item: T; name: string }[] {
  const best = new Map<string, { item: T; name: string; size: number }>();
  const passthrough: { item: T; name: string }[] = [];
  for (const f of files) {
    if (isExtrasPath(f.path)) continue;
    const key = episodeKeyOf(f.name);
    if (!key) {
      passthrough.push({ item: f.item, name: f.name });
      continue;
    }
    const cur = best.get(key);
    if (!cur || packFileScore(f.name, f.size) > packFileScore(cur.name, cur.size)) {
      best.set(key, { item: f.item, name: f.name, size: f.size });
    }
  }
  for (const f of best.values()) passthrough.push({ item: f.item, name: f.name });
  return passthrough;
}

/**
 * Verdict for an ALREADY-stored object (used by the repair sweep, which knows the
 * real byte size from a HEAD). Catches promo files that a previous bug coerced to
 * ".mkv" — they carry a video extension but are far too small to be a feature.
 */
export function classifyStoredFile(
  name: string,
  sizeBytes: number,
): "keep" | "delete" | { rename: string } {
  const base = name.trim();
  if (SUBTITLE_EXT.test(base)) return "keep";
  if (VIDEO_EXT.test(base)) return sizeBytes < MIN_VIDEO_BYTES ? "delete" : "keep";
  if (JUNK_EXT.test(base)) return "delete";
  return sizeBytes >= MIN_VIDEO_BYTES ? { rename: mediaSafeName(base) } : "delete";
}

export async function bucketReachable(
  s3: S3Client,
  bucket: string,
): Promise<boolean> {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  } catch {
    return false;
  }
}
