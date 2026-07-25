import IORedis, { type Redis } from "ioredis";
import { env } from "./env";

/**
 * BullMQ requires `maxRetriesPerRequest: null` on its connection. Connections
 * are created lazily so importing this module during `next build` never touches
 * REDIS_URL before it exists at runtime.
 */
export function createRedis(): Redis {
  return new IORedis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}

const globalForRedis = globalThis as unknown as { redisPub?: Redis };

let _pub: Redis | null = globalForRedis.redisPub ?? null;

/** Shared publisher connection (safe to reuse for non-subscribe commands). */
export function getRedisPub(): Redis {
  if (!_pub) {
    _pub = createRedis();
    if (process.env.NODE_ENV !== "production") globalForRedis.redisPub = _pub;
  }
  return _pub;
}
