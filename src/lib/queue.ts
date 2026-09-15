import { getQueueBackend, type JobHandler } from "./queue-backend";
import type { SeasonGrabData, EpisodeGrabData } from "./types";

export const DOWNLOAD_QUEUE = "downloads";
export const GRAB_QUEUE = "grabs";

/** Enqueue a background job that grabs a whole season (fans out into episodes). */
export async function enqueueSeasonGrab(data: SeasonGrabData): Promise<void> {
  await getQueueBackend().add(GRAB_QUEUE, "season-grab", { downloadId: "", seasonGrab: data });
}

/** Enqueue a short job that finds + queues exactly one episode. */
export async function enqueueEpisodeGrab(data: EpisodeGrabData): Promise<void> {
  await getQueueBackend().add(GRAB_QUEUE, "episode-grab", { downloadId: "", episodeGrab: data });
}

/** Queue the actual transfer for a download row (dedup + retry by its id). */
export async function enqueueDownload(downloadId: string): Promise<void> {
  await getQueueBackend().add(DOWNLOAD_QUEUE, "download", { downloadId }, { jobId: downloadId });
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
    | "wanted-scan"
    | "season-backfill",
): Promise<void> {
  await getQueueBackend().add(GRAB_QUEUE, name, { downloadId: "" });
}

const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const REPEATABLES = [
  { name: "recover-stuck", every: 5 * MIN, jobId: "recover-stuck-repeat" },
  { name: "retry-failed", every: 15 * MIN, jobId: "retry-failed-repeat" },
  { name: "follow-scan", every: 6 * HOUR, jobId: "follow-scan-repeat" },
  { name: "season-progress", every: 3 * HOUR, jobId: "season-progress-repeat" },
  { name: "reco-refresh", every: 12 * HOUR, jobId: "reco-refresh-repeat" },
  { name: "auto-follow", every: 12 * HOUR, jobId: "auto-follow-repeat" },
  { name: "wanted-scan", every: 6 * HOUR, jobId: "wanted-scan-repeat" },
  { name: "season-backfill", every: 12 * HOUR, jobId: "season-backfill-repeat" },
  { name: "retention", every: 24 * HOUR, jobId: "retention-repeat" },
];

/** Register all recurring maintenance jobs on the grab queue (idempotent). */
export async function schedulePeriodicJobs(): Promise<void> {
  await getQueueBackend().scheduleRepeatables(GRAB_QUEUE, REPEATABLES);
}

/** Backwards-compatible alias — schedules all recurring jobs. */
export async function scheduleScans(): Promise<void> {
  await schedulePeriodicJobs();
}

/** Consumer side: run `handler` for jobs on `queue` at the given concurrency. */
export function registerWorker(queue: string, concurrency: number, handler: JobHandler): void {
  getQueueBackend().registerWorker(queue, concurrency, handler);
}

/** Graceful shutdown of workers/timers. */
export async function closeQueues(): Promise<void> {
  await getQueueBackend().close();
}
