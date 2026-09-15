import { getRedisPub } from "./redis";

export function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "local";
}

/** Desktop (single user, no Redis) uses an in-memory window. */
const inProcess = process.env.CINEVAULT_DESKTOP === "1";
const memBuckets = new Map<string, { count: number; resetAt: number }>();

/**
 * Fixed-window rate limiter. Cloud: backed by Redis. Desktop: in-memory. Returns
 * true if the request is allowed; fails open if the store is briefly unavailable.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  const k = `rl:${key}`;
  if (inProcess) {
    const now = Date.now();
    const b = memBuckets.get(k);
    if (!b || now >= b.resetAt) {
      memBuckets.set(k, { count: 1, resetAt: now + windowSec * 1000 });
      return true;
    }
    b.count += 1;
    return b.count <= limit;
  }
  try {
    const redis = getRedisPub();
    const n = await redis.incr(k);
    if (n === 1) await redis.expire(k, windowSec);
    return n <= limit;
  } catch {
    return true;
  }
}
