import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
  CopyObjectCommand,
  GetObjectCommand,
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
  const junk = /(\.torrent|\.parts|\.aria2|thumbs\.db|\.ds_store)$/i;
  const files = (await collectFiles(opts.contentPath)).filter(
    (f) => !junk.test(f.rel),
  );
  const total = files.reduce((a, f) => a + f.size, 0);
  const prefix = opts.keyPrefix.replace(/^\/+|\/+$/g, "");

  let doneBytes = 0;
  const keys: string[] = [];
  let primaryKey = "";
  let primarySize = -1;

  for (const f of files) {
    // Coerce a bogus extension (e.g. a video shipped as .exe) on the filename only.
    const seg = f.rel.split("/");
    seg[seg.length - 1] = mediaSafeName(seg[seg.length - 1]);
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
      opts.onProgress?.(doneBytes, total);
    });
    await upload.done();
    keys.push(key);
    if (f.size > primarySize) {
      primarySize = f.size;
      primaryKey = key;
    }
  }
  return { keys, bytes: total, primaryKey };
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

/** Media/subtitle extensions Jellyfin will actually index. */
const MEDIA_EXT = /\.(mkv|mp4|m4v|avi|mov|ts|m2ts|webm|mpg|mpeg|wmv|flv|3gp|ogv|srt|ass|ssa|sub|idx|vtt)$/i;

/**
 * Ensure a filename carries an extension Jellyfin recognises. Scene releases
 * sometimes ship the video with a bogus/executable extension (e.g. ".exe") that
 * Jellyfin silently ignores; coerce those to ".mkv" (ffprobe still identifies the
 * real container on play). Recognised media/subtitle files are left untouched.
 */
export function mediaSafeName(name: string): string {
  const trimmed = name.trim();
  if (MEDIA_EXT.test(trimmed)) return trimmed;
  return trimmed.replace(/\s*\.[^.\s/\\]{1,5}$/i, "").trimEnd() + ".mkv";
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
