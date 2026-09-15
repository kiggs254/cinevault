import { Queue, Worker, type Job } from "bullmq";
import { createRedis } from "./redis";
import type { DownloadJobData } from "./types";

export interface QueueJob {
  name: string;
  data: DownloadJobData;
}
export type JobHandler = (job: QueueJob) => Promise<void>;
export interface AddOptions {
  /** Dedup key: re-adding while a job with this id is pending/running is ignored. */
  jobId?: string;
}
export interface RepeatSpec {
  name: string;
  every: number;
  jobId: string;
}

/**
 * The job queue is pluggable so the single-process desktop edition needs no Redis.
 * Cloud (web + worker in separate containers) uses BullMQ over Redis; desktop
 * (CINEVAULT_DESKTOP=1, one process) uses an in-memory queue.
 */
export interface QueueBackend {
  add(queue: string, name: string, data: DownloadJobData, opts?: AddOptions): Promise<void>;
  remove(queue: string, jobId: string): Promise<void>;
  registerWorker(queue: string, concurrency: number, handler: JobHandler): void;
  scheduleRepeatables(queue: string, specs: RepeatSpec[]): Promise<void>;
  close(): Promise<void>;
}

const DEFAULT_JOB_OPTS = {
  attempts: 2,
  backoff: { type: "exponential" as const, delay: 15_000 },
  removeOnComplete: { count: 200 },
  removeOnFail: { count: 200 },
};

/** Cloud backend: BullMQ over Redis (unchanged behaviour). */
class BullMqBackend implements QueueBackend {
  private queues = new Map<string, Queue<DownloadJobData>>();
  private workers: Worker[] = [];

  private q(name: string): Queue<DownloadJobData> {
    let q = this.queues.get(name);
    if (!q) {
      q = new Queue<DownloadJobData>(name, { connection: createRedis(), defaultJobOptions: DEFAULT_JOB_OPTS });
      this.queues.set(name, q);
    }
    return q;
  }

  async add(queue: string, name: string, data: DownloadJobData, opts?: AddOptions): Promise<void> {
    const q = this.q(queue);
    if (opts?.jobId) {
      // Remove any prior (completed/failed) job with this id so a re-enqueue re-runs.
      await q.remove(opts.jobId).catch(() => {});
      await q.add(name, data, { jobId: opts.jobId });
    } else {
      await q.add(name, data, { removeOnComplete: true, removeOnFail: true });
    }
  }

  async remove(queue: string, jobId: string): Promise<void> {
    await this.q(queue).remove(jobId).catch(() => {});
  }

  registerWorker(queue: string, concurrency: number, handler: JobHandler): void {
    const w = new Worker<DownloadJobData>(
      queue,
      async (job: Job<DownloadJobData>) => {
        await handler({ name: job.name, data: job.data });
      },
      { connection: createRedis(), concurrency, stalledInterval: 30_000, maxStalledCount: 5 },
    );
    w.on("error", (err) => console.error(`[queue:${queue}] error:`, err));
    this.workers.push(w);
  }

  async scheduleRepeatables(queue: string, specs: RepeatSpec[]): Promise<void> {
    const q = this.q(queue);
    const wanted = new Set(specs.map((s) => s.name));
    try {
      for (const j of await q.getRepeatableJobs()) {
        if (!wanted.has(j.name)) await q.removeRepeatableByKey(j.key).catch(() => {});
      }
    } catch {
      /* best-effort */
    }
    for (const s of specs) {
      await q.add(s.name, { downloadId: "" }, { repeat: { every: s.every }, jobId: s.jobId });
    }
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.workers.map((w) => w.close()));
  }
}

/** Desktop backend: in-memory queues, per-queue concurrency, timer repeatables. */
class InProcessBackend implements QueueBackend {
  private queues = new Map<
    string,
    { pending: QueueJob[]; jobIds: (string | undefined)[]; active: number; concurrency: number; handler?: JobHandler }
  >();
  private timers = new Map<string, ReturnType<typeof setInterval>>();
  private activeJobIds = new Set<string>();

  private ensure(name: string) {
    let q = this.queues.get(name);
    if (!q) {
      q = { pending: [], jobIds: [], active: 0, concurrency: 1 };
      this.queues.set(name, q);
    }
    return q;
  }

  async add(queue: string, name: string, data: DownloadJobData, opts?: AddOptions): Promise<void> {
    if (opts?.jobId) {
      if (this.activeJobIds.has(opts.jobId)) return; // dedup, like a BullMQ jobId
      this.activeJobIds.add(opts.jobId);
    }
    const q = this.ensure(queue);
    q.pending.push({ name, data });
    q.jobIds.push(opts?.jobId);
    this.pump(queue);
  }

  async remove(queue: string, jobId: string): Promise<void> {
    const q = this.queues.get(queue);
    if (q) {
      for (let i = q.jobIds.length - 1; i >= 0; i--) {
        if (q.jobIds[i] === jobId) {
          q.jobIds.splice(i, 1);
          q.pending.splice(i, 1);
        }
      }
    }
    this.activeJobIds.delete(jobId);
  }

  registerWorker(queue: string, concurrency: number, handler: JobHandler): void {
    const q = this.ensure(queue);
    q.concurrency = concurrency;
    q.handler = handler;
    this.pump(queue);
  }

  async scheduleRepeatables(queue: string, specs: RepeatSpec[]): Promise<void> {
    for (const s of specs) {
      if (this.timers.has(s.jobId)) continue;
      const t = setInterval(() => void this.add(queue, s.name, { downloadId: "" }), s.every);
      if (typeof t.unref === "function") t.unref();
      this.timers.set(s.jobId, t);
    }
  }

  private pump(queue: string): void {
    const q = this.queues.get(queue);
    if (!q || !q.handler) return;
    while (q.active < q.concurrency && q.pending.length) {
      const job = q.pending.shift()!;
      const jobId = q.jobIds.shift();
      q.active++;
      void this.run(queue, job, jobId);
    }
  }

  private async run(queue: string, job: QueueJob, jobId?: string): Promise<void> {
    try {
      const q = this.queues.get(queue);
      await q?.handler?.(job);
    } catch (e) {
      console.error(`[queue:${queue}] job error:`, (e as Error).message);
    } finally {
      if (jobId) this.activeJobIds.delete(jobId);
      const q = this.queues.get(queue);
      if (q) q.active--;
      this.pump(queue);
    }
  }

  async close(): Promise<void> {
    for (const t of this.timers.values()) clearInterval(t);
    this.timers.clear();
  }
}

const DESKTOP = process.env.CINEVAULT_DESKTOP === "1";
let _backend: QueueBackend | null = null;

/** The active queue backend (in-process for desktop, BullMQ for cloud). */
export function getQueueBackend(): QueueBackend {
  if (!_backend) _backend = DESKTOP ? new InProcessBackend() : new BullMqBackend();
  return _backend;
}
