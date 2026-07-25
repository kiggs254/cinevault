import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import fs from "node:fs";
import path from "node:path";
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
    const key = `${prefix}/${f.rel}`;
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
