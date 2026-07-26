import { Queue } from "bullmq";
import { createRedis } from "./redis";
import type { DownloadJobData, SeasonGrabData } from "./types";

export const DOWNLOAD_QUEUE = "downloads";

let _queue: Queue<DownloadJobData> | null = null;

/** Lazily-constructed BullMQ queue for download jobs. */
export function downloadQueue(): Queue<DownloadJobData> {
  if (!_queue) {
    _queue = new Queue<DownloadJobData>(DOWNLOAD_QUEUE, {
      connection: createRedis(),
      defaultJobOptions: {
        attempts: 2,
        backoff: { type: "exponential", delay: 15_000 },
        removeOnComplete: { count: 200 },
        removeOnFail: { count: 200 },
      },
    });
  }
  return _queue;
}

/** Enqueue a background job that grabs a whole season (pack, or episode-by-episode). */
export async function enqueueSeasonGrab(data: SeasonGrabData): Promise<void> {
  await downloadQueue().add(
    "season-grab",
    { downloadId: "", seasonGrab: data },
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

/** Trigger any named maintenance job once, now. */
export async function enqueueJob(
  name: "watch-scan" | "follow-scan" | "reco-refresh" | "auto-follow" | "retention" | "recover-stuck",
): Promise<void> {
  await downloadQueue().add(
    name,
    { downloadId: "" },
    { removeOnComplete: true, removeOnFail: true },
  );
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const REPEATABLES: { name: string; every: number; jobId: string }[] = [
  { name: "recover-stuck", every: 5 * MIN, jobId: "recover-stuck-repeat" },
  { name: "watch-scan", every: 30 * MIN, jobId: "watch-scan-repeat" },
  { name: "follow-scan", every: 6 * HOUR, jobId: "follow-scan-repeat" },
  { name: "reco-refresh", every: 12 * HOUR, jobId: "reco-refresh-repeat" },
  { name: "auto-follow", every: 12 * HOUR, jobId: "auto-follow-repeat" },
  { name: "retention", every: 24 * HOUR, jobId: "retention-repeat" },
];

/** Register all recurring maintenance jobs (idempotent by repeat jobId). */
export async function schedulePeriodicJobs(): Promise<void> {
  const q = downloadQueue();
  for (const r of REPEATABLES) {
    await q.add(r.name, { downloadId: "" }, { repeat: { every: r.every }, jobId: r.jobId });
  }
}

/** Backwards-compatible alias — schedules all recurring jobs. */
export async function scheduleScans(): Promise<void> {
  await schedulePeriodicJobs();
}
