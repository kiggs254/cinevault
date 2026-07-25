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
  await downloadQueue().add(
    "download",
    { downloadId },
    { jobId: downloadId }, // dedupe: one active job per download
  );
}
