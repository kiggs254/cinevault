import "dotenv/config";
import path from "node:path";
import { Worker, type Job } from "bullmq";
import { createRedis } from "../lib/redis";
import { DOWNLOAD_QUEUE } from "../lib/queue";
import { prisma } from "../lib/db";
import { getConfig } from "../lib/config";
import { QbClient, type QbTorrentInfo } from "../lib/torrent/qbittorrent";
import { makeS3, uploadContent } from "../lib/storage/s3";
import { organize } from "../lib/llm/organizer";
import { enrich } from "../lib/metadata/tmdb";
import { publishProgress } from "../lib/events";
import type { DownloadJobData, DownloadStatus, MediaKind } from "../lib/types";

const CATEGORY = "moviehub";
const POLL_MS = 2000;
const REGISTER_TIMEOUT_MS = 90_000;
const STALL_MS = 30 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const UP_STATES = new Set([
  "uploading",
  "stalledUP",
  "pausedUP",
  "queuedUP",
  "forcedUP",
  "checkingUP",
]);

function isComplete(info: QbTorrentInfo): boolean {
  return info.progress >= 0.999 || UP_STATES.has(info.state);
}
function isErrored(info: QbTorrentInfo): boolean {
  return info.state === "error" || info.state === "missingFiles";
}
function clampEta(eta: number): number | null {
  return eta == null || eta < 0 || eta >= 8_640_000 ? null : eta;
}

function throttle<T extends (...a: never[]) => void>(fn: T, ms: number): T {
  let last = 0;
  return ((...args: never[]) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    }
  }) as T;
}

async function setStatus(id: string, status: DownloadStatus, progress?: number) {
  await prisma.download
    .update({ where: { id }, data: { status, ...(progress != null ? { progress } : {}) } })
    .catch(() => {});
  await publishProgress({ type: "status", downloadId: id, status, progress });
}

async function waitForTorrent(
  qb: QbClient,
  tag: string,
  timeoutMs: number,
): Promise<QbTorrentInfo | undefined> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await qb.getByTag(tag);
    if (info) return info;
    await sleep(2000);
  }
  return undefined;
}

async function pollUntilComplete(
  qb: QbClient,
  id: string,
  hash: string,
): Promise<QbTorrentInfo> {
  let lastProgress = -1;
  let stalledSince = Date.now();

  for (;;) {
    await sleep(POLL_MS);
    const info = (await qb.getByHash(hash)) ?? (await qb.getByTag(id));
    if (!info) continue;
    if (isErrored(info)) throw new Error(`qBittorrent reported "${info.state}"`);

    const pct = Math.min(100, info.progress * 100);
    await prisma.download
      .update({
        where: { id },
        data: {
          progress: pct,
          dlSpeed: info.dlspeed,
          upSpeed: info.upspeed,
          etaSeconds: clampEta(info.eta),
          seeders: info.num_seeds,
          downloadedBytes: BigInt(Math.max(0, Math.round(info.completed))),
          sizeBytes: BigInt(Math.max(0, Math.round(info.size))),
        },
      })
      .catch(() => {});
    await publishProgress({
      type: "progress",
      downloadId: id,
      status: "DOWNLOADING",
      progress: pct,
      dlSpeed: info.dlspeed,
      upSpeed: info.upspeed,
      etaSeconds: clampEta(info.eta),
      seeders: info.num_seeds,
    });

    if (isComplete(info)) return info;

    if (pct > lastProgress + 0.01) {
      lastProgress = pct;
      stalledSince = Date.now();
    } else if (info.num_seeds === 0 && Date.now() - stalledSince > STALL_MS) {
      throw new Error("Stalled: no seeders and no progress for 30 minutes");
    }
  }
}

async function processDownload(id: string): Promise<void> {
  const dl = await prisma.download.findUnique({ where: { id } });
  if (!dl) return;
  if (!dl.magnet) throw new Error("Download has no torrent source");

  const cfg = await getConfig();
  if (!cfg.qbit.url) throw new Error("qBittorrent is not configured (see Settings)");
  if (!cfg.s3.endpoint || !cfg.s3.bucket) {
    throw new Error("S3 storage is not fully configured (see Settings)");
  }

  const qb = new QbClient(cfg.qbit);
  await qb.ensureCategory(CATEGORY);
  await setStatus(id, "DOWNLOADING", dl.progress);

  // Add the torrent unless it is already present (idempotent retries).
  let info = await qb.getByTag(id);
  if (!info) {
    const isMagnet = dl.magnet.startsWith("magnet:");
    await qb.addTorrent({
      magnet: isMagnet ? dl.magnet : undefined,
      torrentUrl: isMagnet ? undefined : dl.magnet,
      savePath: cfg.prefs.downloadDir,
      category: CATEGORY,
      tag: id,
    });
    info = await waitForTorrent(qb, id, REGISTER_TIMEOUT_MS);
  }
  if (!info) throw new Error("Torrent failed to register in qBittorrent");

  await prisma.download.update({ where: { id }, data: { qbitHash: info.hash } });

  // Download.
  info = await pollUntilComplete(qb, id, info.hash);

  // Organize + enrich, then upload.
  await setStatus(id, "UPLOADING", 0);
  const organized = await organize({
    releaseName: dl.releaseName,
    kind: dl.kind as MediaKind,
    title: dl.title,
    year: dl.year,
    season: dl.season,
    episode: dl.episode,
  });
  const meta = await enrich(
    cfg.tmdb.apiKey,
    organized.kind,
    organized.cleanTitle,
    organized.year ?? dl.year,
  );

  const s3 = makeS3(cfg.s3);
  const contentPath = info.content_path || path.join(info.save_path, info.name);
  const emitUpload = throttle((uploaded: number, total: number) => {
    const pct = total > 0 ? (uploaded / total) * 100 : 0;
    void prisma.download.update({ where: { id }, data: { progress: pct } }).catch(() => {});
    void publishProgress({ type: "progress", downloadId: id, status: "UPLOADING", progress: pct });
  }, 1000);

  const { primaryKey, bytes } = await uploadContent({
    s3,
    bucket: cfg.s3.bucket,
    contentPath,
    keyPrefix: [cfg.s3.basePrefix, organized.s3Prefix].filter(Boolean).join("/"),
    onProgress: emitUpload,
  });

  await prisma.download.update({
    where: { id },
    data: {
      status: "COMPLETED",
      progress: 100,
      s3Bucket: cfg.s3.bucket,
      s3Key: primaryKey,
      s3Prefix: organized.s3Prefix,
      kind: organized.kind,
      title: organized.cleanTitle,
      year: organized.year ?? dl.year,
      season: organized.season ?? dl.season,
      episode: organized.episode ?? dl.episode,
      posterUrl: meta?.posterUrl ?? dl.posterUrl,
      overview: meta?.overview ?? dl.overview,
      sizeBytes: BigInt(Math.max(0, Math.round(bytes || Number(dl.sizeBytes)))),
      completedAt: new Date(),
    },
  });
  await publishProgress({ type: "status", downloadId: id, status: "COMPLETED", progress: 100 });

  if (cfg.prefs.deleteAfterUpload) {
    await qb.delete([info.hash], true).catch(() => {});
  }
}

const worker = new Worker<DownloadJobData>(
  DOWNLOAD_QUEUE,
  async (job: Job<DownloadJobData>) => {
    const { downloadId } = job.data;
    try {
      await processDownload(downloadId);
    } catch (e) {
      const message = (e as Error).message ?? "Unknown error";
      console.error(`[worker] download ${downloadId} failed:`, message);
      await prisma.download
        .update({ where: { id: downloadId }, data: { status: "FAILED", error: message } })
        .catch(() => {});
      await publishProgress({
        type: "status",
        downloadId,
        status: "FAILED",
        message,
      });
      // Swallow so BullMQ does not auto-retry config errors; user retries via UI.
    }
  },
  { connection: createRedis(), concurrency: 3 },
);

worker.on("ready", () => console.log("[worker] ready, waiting for jobs"));
worker.on("error", (err) => console.error("[worker] error:", err));

async function shutdown() {
  console.log("[worker] shutting down…");
  await worker.close();
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
