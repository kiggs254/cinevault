import { getRedisPub } from "./redis";

export function clientIp(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "local";
}

/**
 * Fixed-window rate limiter backed by Redis. Returns true if the request is
 * allowed. Fails open if Redis is briefly unavailable.
 */
export async function rateLimit(
  key: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  try {
    const redis = getRedisPub();
    const k = `rl:${key}`;
    const n = await redis.incr(k);
    if (n === 1) await redis.expire(k, windowSec);
    return n <= limit;
  } catch {
    return true;
  }
}
