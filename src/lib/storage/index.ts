import fs from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";
import type { ResolvedConfig } from "../config";
import {
  makeS3,
  uploadContent as s3UploadContent,
  uploadStream as s3UploadStream,
  deleteObject as s3DeleteObject,
  renameObject as s3RenameObject,
  headObjectSize as s3HeadObjectSize,
  listObjects as s3ListObjects,
  presignGet as s3PresignGet,
  bucketReachable as s3BucketReachable,
  collectFiles,
  classifyUploadName,
  type S3Entry,
} from "./s3";

export type { S3Entry } from "./s3";

export interface UploadResult {
  keys: string[];
  bytes: number;
  primaryKey: string;
}

/**
 * Backend-agnostic media store. Two implementations select at runtime from
 * `cfg.storage.backend`: S3-compatible object storage (the cloud/self-hosted
 * default) and a plain local directory (the Windows / home edition — no cloud).
 * Callers never touch an S3 client directly; they go through `getStorage(cfg)`.
 */
export interface StorageBackend {
  readonly kind: "s3" | "local";
  /** Copy a local file/dir tree into the store under `keyPrefix` (skips junk). */
  uploadContent(o: {
    contentPath: string;
    keyPrefix: string;
    onProgress?: (uploadedBytes: number, totalBytes: number) => void;
  }): Promise<UploadResult>;
  /** Stream a Readable straight to one key (e.g. a TorBox HTTP body). */
  uploadStream(o: {
    key: string;
    body: Readable;
    contentType?: string;
    onProgress?: (uploadedBytes: number) => void;
  }): Promise<void>;
  deleteObject(key: string): Promise<void>;
  renameObject(from: string, to: string): Promise<void>;
  headObjectSize(key: string): Promise<number | null>;
  listObjects(prefix?: string): Promise<S3Entry[]>;
  /** A URL the browser can fetch/stream this key from (presigned S3, or a local route). */
  getUrl(key: string, expiresIn?: number): Promise<string>;
  reachable(): Promise<boolean>;
}

/** Pick the storage backend for this deployment. */
export function getStorage(cfg: ResolvedConfig): StorageBackend {
  return cfg.storage.backend === "local"
    ? new LocalStorage(cfg.storage.mediaDir)
    : new S3Storage(cfg);
}

/** Cloud object storage — delegates to the existing S3 helpers. */
class S3Storage implements StorageBackend {
  readonly kind = "s3" as const;
  private readonly s3: ReturnType<typeof makeS3>;
  private readonly bucket: string;
  constructor(cfg: ResolvedConfig) {
    this.s3 = makeS3(cfg.s3);
    this.bucket = cfg.s3.bucket ?? "";
  }
  uploadContent(o: Parameters<StorageBackend["uploadContent"]>[0]) {
    return s3UploadContent({ s3: this.s3, bucket: this.bucket, ...o });
  }
  uploadStream(o: Parameters<StorageBackend["uploadStream"]>[0]) {
    return s3UploadStream({ s3: this.s3, bucket: this.bucket, ...o });
  }
  deleteObject(key: string) {
    return s3DeleteObject(this.s3, this.bucket, key);
  }
  renameObject(from: string, to: string) {
    return s3RenameObject(this.s3, this.bucket, from, to);
  }
  headObjectSize(key: string) {
    return s3HeadObjectSize(this.s3, this.bucket, key);
  }
  listObjects(prefix = "") {
    return s3ListObjects(this.s3, this.bucket, prefix);
  }
  getUrl(key: string, expiresIn = 3600) {
    return s3PresignGet(this.s3, this.bucket, key, expiresIn);
  }
  reachable() {
    return s3BucketReachable(this.s3, this.bucket);
  }
}

/** A folder on this machine. Keys are POSIX-style paths under `root`. */
class LocalStorage implements StorageBackend {
  readonly kind = "local" as const;
  constructor(private readonly root: string) {}

  /** Resolve a key to an absolute path, refusing anything that escapes `root`. */
  private abs(key: string): string {
    const clean = key.replace(/^\/+/, "");
    const full = path.resolve(this.root, clean);
    const base = path.resolve(this.root);
    if (full !== base && !full.startsWith(base + path.sep)) {
      throw new Error(`Refusing path outside media dir: ${key}`);
    }
    return full;
  }

  async uploadContent(o: Parameters<StorageBackend["uploadContent"]>[0]): Promise<UploadResult> {
    const files = await collectFiles(o.contentPath);
    const prefix = o.keyPrefix.replace(/^\/+|\/+$/g, "");
    // Keep only real media; drop junk and coerce bogus extensions (same rules as S3).
    const uploadable = files
      .map((f) => ({ f, name: classifyUploadName(f.rel.split("/").pop() ?? "", f.size) }))
      .filter((x): x is { f: (typeof files)[number]; name: string } => x.name !== null);
    const total = uploadable.reduce((a, x) => a + x.f.size, 0);

    let done = 0;
    const keys: string[] = [];
    let primaryKey = "";
    let primarySize = -1;
    for (const { f, name } of uploadable) {
      const seg = f.rel.split("/");
      seg[seg.length - 1] = name;
      const key = `${prefix}/${seg.join("/")}`;
      const dest = this.abs(key);
      await fs.promises.mkdir(path.dirname(dest), { recursive: true });
      await fs.promises.copyFile(f.abs, dest);
      done += f.size;
      o.onProgress?.(done, total);
      keys.push(key);
      if (f.size > primarySize) {
        primarySize = f.size;
        primaryKey = key;
      }
    }
    return { keys, bytes: total, primaryKey };
  }

  async uploadStream(o: Parameters<StorageBackend["uploadStream"]>[0]): Promise<void> {
    const dest = this.abs(o.key);
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    let loaded = 0;
    if (o.onProgress) {
      o.body.on("data", (chunk: Buffer) => {
        loaded += chunk.length;
        o.onProgress!(loaded);
      });
    }
    await pipeline(o.body, fs.createWriteStream(dest));
  }

  async deleteObject(key: string): Promise<void> {
    await fs.promises.rm(this.abs(key), { force: true });
  }

  async renameObject(from: string, to: string): Promise<void> {
    if (from === to) return;
    const dest = this.abs(to);
    await fs.promises.mkdir(path.dirname(dest), { recursive: true });
    await fs.promises.rename(this.abs(from), dest);
  }

  async headObjectSize(key: string): Promise<number | null> {
    try {
      return (await fs.promises.stat(this.abs(key))).size;
    } catch {
      return null;
    }
  }

  /** One folder level under `prefix` (mirrors the S3 delimiter listing shape). */
  async listObjects(prefix = ""): Promise<S3Entry[]> {
    const dir = this.abs(prefix);
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    const norm = prefix ? prefix.replace(/\/+$/, "") + "/" : "";
    const out: S3Entry[] = [];
    for (const e of entries) {
      if (e.isDirectory()) {
        out.push({ key: `${norm}${e.name}/`, size: 0, isFolder: true });
      } else if (e.isFile()) {
        let size = 0;
        let lastModified: string | undefined;
        try {
          const st = await fs.promises.stat(path.join(dir, e.name));
          size = st.size;
          lastModified = st.mtime.toISOString();
        } catch {
          /* ignore */
        }
        out.push({ key: `${norm}${e.name}`, size, lastModified, isFolder: false });
      }
    }
    return out;
  }

  async getUrl(key: string): Promise<string> {
    // Served by the app's local media route (range-enabled) — see /api/media/[...key].
    return `/api/media/${key.split("/").map(encodeURIComponent).join("/")}`;
  }

  async reachable(): Promise<boolean> {
    try {
      await fs.promises.mkdir(this.root, { recursive: true });
      await fs.promises.access(this.root, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
}
