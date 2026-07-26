import { Queue } from "bullmq";
import { createRedis } from "./redis";
import type { DownloadJobData } from "./types";

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

export async function enqueueDownload(downloadId: string): Promise<void> {
  const q = downloadQueue();
  // Remove any prior (completed/failed) job with this id so retries actually re-run
  // — BullMQ ignores add() for an existing jobId otherwise.
  await q.remove(downloadId).catch(() => {});
  await q.add("download", { downloadId }, { jobId: downloadId });
}

/** Trigger a one-off watch/discovery scan now. */
export async function enqueueScan(): Promise<void> {
  await downloadQueue().add(
    "watch-scan",
    { downloadId: "" },
    { removeOnComplete: true, removeOnFail: true },
  );
}

/** Register the recurring watch/discovery scan (idempotent by repeat jobId). */
export async function scheduleScans(): Promise<void> {
  await downloadQueue().add(
    "watch-scan",
    { downloadId: "" },
    { repeat: { every: 30 * 60 * 1000 }, jobId: "watch-scan-repeat" },
  );
}
