import { EventEmitter } from "node:events";
import { createRedis, getRedisPub } from "./redis";
import type { ProgressEvent, ActivityEntry } from "./types";

const CHANNEL = "moviehub:progress";

/** Everything the SSE stream carries: download progress + activity-feed lines. */
export type SseEvent = ProgressEvent | ({ type: "activity" } & ActivityEntry);

/**
 * The desktop/home edition runs web + worker in ONE process, so events travel over
 * an in-process bus — no Redis. The cloud edition keeps web and worker in separate
 * containers, so it fans out over Redis pub/sub. Toggled by CINEVAULT_DESKTOP.
 */
const inProcess = process.env.CINEVAULT_DESKTOP === "1";
const localBus = new EventEmitter();
localBus.setMaxListeners(0); // one listener per open SSE connection

/** Publish any SSE event (progress or activity) to subscribers. */
export async function publishEvent(event: SseEvent): Promise<void> {
  if (inProcess) {
    localBus.emit("event", event);
    return;
  }
  await getRedisPub().publish(CHANNEL, JSON.stringify(event));
}

/** Publish a realtime progress/status event (used by the worker + API). */
export async function publishProgress(event: ProgressEvent): Promise<void> {
  await publishEvent(event);
}

/**
 * Subscribe to the SSE event stream. Cloud: a dedicated ioredis connection (a
 * subscribed connection can't issue other commands). Desktop: an in-process
 * listener. Returns an async unsubscribe function.
 */
export function subscribeToProgress(
  onEvent: (e: SseEvent) => void,
): () => Promise<void> {
  if (inProcess) {
    const handler = (e: SseEvent) => onEvent(e);
    localBus.on("event", handler);
    return async () => {
      localBus.off("event", handler);
    };
  }
  const sub = createRedis();
  void sub.subscribe(CHANNEL);
  sub.on("message", (_channel, message) => {
    try {
      onEvent(JSON.parse(message) as SseEvent);
    } catch {
      /* ignore malformed messages */
    }
  });
  return async () => {
    try {
      await sub.unsubscribe(CHANNEL);
    } finally {
      sub.disconnect();
    }
  };
}
