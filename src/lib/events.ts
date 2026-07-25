import { createRedis, getRedisPub } from "./redis";
import type { ProgressEvent } from "./types";

const CHANNEL = "moviehub:progress";

/** Publish a realtime progress/status event (used by the worker + API). */
export async function publishProgress(event: ProgressEvent): Promise<void> {
  await getRedisPub().publish(CHANNEL, JSON.stringify(event));
}

/**
 * Subscribe to progress events. A subscribed ioredis connection cannot issue
 * other commands, so each subscriber gets its own dedicated connection.
 * Returns an async unsubscribe function.
 */
export function subscribeToProgress(
  onEvent: (e: ProgressEvent) => void,
): () => Promise<void> {
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
