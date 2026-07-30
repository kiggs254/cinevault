import { Queue } from "bullmq";
import { createRedis } from "./redis";
import type { DownloadJobData, SeasonGrabData, EpisodeGrabData } from "./types";

export const DOWNLOAD_QUEUE = "downloads";
export const GRAB_QUEUE = "grabs";

let _downloads: Queue<DownloadJobData> | null = null;
let _grabs: Queue<DownloadJobData> | null = null;

const DEFAULT_JOB_OPTS = {
  attempts: 2,
  backoff: { type: "exponential" as const, delay: 15_000 },
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 200 },
};

/** Queue for the actual transfers (qBittorrent download → S3 upload). */
export function downloadQueue(): Queue<DownloadJobData> {
  if (!_downloads) {
    _downloads = new Queue<DownloadJobData>(DOWNLOAD_QUEUE, {
      connection: createRedis(),
      defaultJobOptions: DEFAULT_JOB_OPTS,
    });
  }
  return _downloads;
}

/**
 * Queue for planning/search work — season & episode grabs plus maintenance.
 * Kept separate from downloads so long transfers never starve new searches: the
 * agent stays ready to queue more even while things download in the background.
 */
export function grabQueue(): Queue<DownloadJobData> {
  if (!_grabs) {
    _grabs = new Queue<DownloadJobData>(GRAB_QUEUE, {
      connection: createRedis(),
      defaultJobOptions: DEFAULT_JOB_OPTS,
    });
  }
  return _grabs;
}

/** Enqueue a background job that grabs a whole season (fans out into episodes). */
export async function enqueueSeasonGrab(data: SeasonGrabData): Promise<void> {
  await grabQueue().add(
    "season-grab",
    { downloadId: "", seasonGrab: data },
    { removeOnComplete: true, removeOnFail: true },
  );
}

/** Enqueue a short job that finds + queues exactly one episode. */
export async function enqueueEpisodeGrab(data: EpisodeGrabData): Promise<void> {
  await grabQueue().add(
    "episode-grab",
    { downloadId: "", episodeGrab: data },
    { removeOnComplete: true, removeOnFail: true },
  );
}

export async function enqueueDownload(downloadId: string): Promise<void> {
  const q = downloadQueue();
  // Remove any prior (completed/failed) job with this id so retries actually re-run
  // — BullMQ ignores add() for an existing jobId otherwise.
  await q.remove(downloadId).catch(() => {});
  await q.add("download", { downloadId }, { jobId: downloadId });
}

/** Trigger a one-off watch/discovery scan now. */
export async function enqueueScan(): Promise<void> {
  await enqueueJob("watch-scan");
}

/** Trigger any named maintenance job once, now (runs on the grab worker). */
export async function enqueueJob(
  name:
    | "watch-scan"
    | "follow-scan"
    | "reco-refresh"
    | "auto-follow"
    | "retention"
    | "recover-stuck"
    | "retry-failed"
    | "wanted-scan",
): Promise<void> {
  await grabQueue().add(name, { downloadId: "" }, { removeOnComplete: true, removeOnFail: true });
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const REPEATABLES: { name: string; every: number; jobId: string }[] = [
  { name: "recover-stuck", every: 5 * MIN, jobId: "recover-stuck-repeat" },
  { name: "retry-failed", every: 15 * MIN, jobId: "retry-failed-repeat" },
  { name: "follow-scan", every: 6 * HOUR, jobId: "follow-scan-repeat" },
  { name: "season-progress", every: 3 * HOUR, jobId: "season-progress-repeat" },
  { name: "reco-refresh", every: 12 * HOUR, jobId: "reco-refresh-repeat" },
  { name: "auto-follow", every: 12 * HOUR, jobId: "auto-follow-repeat" },
  { name: "wanted-scan", every: 6 * HOUR, jobId: "wanted-scan-repeat" },
  { name: "retention", every: 24 * HOUR, jobId: "retention-repeat" },
];

/** Register all recurring maintenance jobs on the grab queue (idempotent). */
export async function schedulePeriodicJobs(): Promise<void> {
  const dq = downloadQueue();
  const gq = grabQueue();
  const wanted = new Set(REPEATABLES.map((r) => r.name));
  // Repeatables live on the grab queue now: drop any left on the download queue
  // (older builds registered them there), and any stale one on the grab queue.
  try {
    for (const j of await dq.getRepeatableJobs()) await dq.removeRepeatableByKey(j.key).catch(() => {});
  } catch {
    /* best-effort */
  }
  try {
    for (const j of await gq.getRepeatableJobs()) {
      if (!wanted.has(j.name)) await gq.removeRepeatableByKey(j.key).catch(() => {});
    }
  } catch {
    /* best-effort */
  }
  for (const r of REPEATABLES) {
    await gq.add(r.name, { downloadId: "" }, { repeat: { every: r.every }, jobId: r.jobId });
  }
}

/** Backwards-compatible alias — schedules all recurring jobs. */
export async function scheduleScans(): Promise<void> {
  await schedulePeriodicJobs();
}
