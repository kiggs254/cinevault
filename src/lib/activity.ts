import { getRedisPub } from "./redis";
import type { ActivityEntry } from "./types";

const CHANNEL = "moviehub:progress";
const LIST = "moviehub:activity";
const MAX = 60;

let seq = 0;

/**
 * Record a human-readable "what the agent is doing" line. Published live on the
 * progress channel (as {type:"activity"}) for the SSE stream, and pushed onto a
 * capped Redis list so a client that opens the Assistant later sees recent steps.
 * Best-effort — never blocks or throws into a grab.
 */
export async function logActivity(
  message: string,
  meta?: { kind?: string; title?: string },
): Promise<void> {
  const entry: ActivityEntry = {
    id: `${Date.now().toString(36)}-${(seq++).toString(36)}`,
    at: new Date().toISOString(),
    message,
    kind: meta?.kind,
    title: meta?.title,
  };
  try {
    const pub = getRedisPub();
    await pub.publish(CHANNEL, JSON.stringify({ type: "activity", ...entry }));
    await pub.lpush(LIST, JSON.stringify(entry));
    await pub.ltrim(LIST, 0, MAX - 1);
  } catch {
    /* best-effort */
  }
}

/** Most recent activity entries, newest first. */
export async function recentActivity(limit = 40): Promise<ActivityEntry[]> {
  try {
    const raw = await getRedisPub().lrange(LIST, 0, limit - 1);
    return raw
      .map((s) => {
        try {
          return JSON.parse(s) as ActivityEntry;
        } catch {
          return null;
        }
      })
      .filter((x): x is ActivityEntry => !!x);
  } catch {
    return [];
  }
}
