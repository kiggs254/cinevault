import { getRedisPub } from "./redis";
import { publishEvent } from "./events";
import type { ActivityEntry } from "./types";

const LIST = "moviehub:activity";
const MAX = 60;

/** Desktop keeps recent activity in memory; cloud in a capped Redis list. */
const inProcess = process.env.CINEVAULT_DESKTOP === "1";
const memList: ActivityEntry[] = [];

let seq = 0;

/**
 * Record a human-readable "what the agent is doing" line. Published live on the
 * event stream (as {type:"activity"}) for the SSE feed, and kept in a capped recent
 * list so a client that opens the Assistant later sees recent steps. Best-effort —
 * never blocks or throws into a grab.
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
    await publishEvent({ type: "activity", ...entry });
    if (inProcess) {
      memList.unshift(entry);
      if (memList.length > MAX) memList.length = MAX;
    } else {
      const pub = getRedisPub();
      await pub.lpush(LIST, JSON.stringify(entry));
      await pub.ltrim(LIST, 0, MAX - 1);
    }
  } catch {
    /* best-effort */
  }
}

/** Most recent activity entries, newest first. */
export async function recentActivity(limit = 40): Promise<ActivityEntry[]> {
  if (inProcess) return memList.slice(0, limit);
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
