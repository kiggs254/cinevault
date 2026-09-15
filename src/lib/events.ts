import { EventEmitter } from "node:events";
import { createRedis, getRedisPub } from "./redis";
import type { ProgressEvent } from "./types";

const CHANNEL = "moviehub:progress";

/**
 * The desktop/home edition runs web + worker in ONE process, so progress events
 * travel over an in-process event bus — no Redis. The cloud edition keeps web and
 * worker in separate containers, so it fans out over Redis pub/sub. Toggled by
 * CINEVAULT_DESKTOP (set by the desktop shell).
 */
const inProcess = process.env.CINEVAULT_DESKTOP === "1";
const localBus = new EventEmitter();
localBus.setMaxListeners(0); // one listener per open SSE connection

/** Publish a realtime progress/status event (used by the worker + API). */
export async function publishProgress(event: ProgressEvent): Promise<void> {
  if (inProcess) {
    localBus.emit("progress", event);
    return;
  }
  await getRedisPub().publish(CHANNEL, JSON.stringify(event));
}

/**
 * Subscribe to progress events. Cloud: a dedicated ioredis connection (a subscribed
 * connection can't issue other commands). Desktop: an in-process listener.
 * Returns an async unsubscribe function.
 */
export function subscribeToProgress(
  onEvent: (e: ProgressEvent) => void,
): () => Promise<void> {
  if (inProcess) {
    const handler = (e: ProgressEvent) => onEvent(e);
    localBus.on("progress", handler);
    return async () => {
      localBus.off("progress", handler);
    };
  }
  const sub = createRedis();
  void sub.subscribe(CHANNEL);
  sub.on("message", (_channel, message) => {
    try {
      onEvent(JSON.parse(message) as ProgressEvent);
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
