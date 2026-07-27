import { getRedisPub } from "../redis";

const TTL_SECONDS = 30 * 24 * 60 * 60; // forget after 30 days (a dead source may recover)

/** Collapse a release name to a comparable key (case/punctuation-insensitive). */
export function normRelease(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function keyOf(
  tmdbId: number | null | undefined,
  season: number | null | undefined,
  episode: number | null | undefined,
): string | null {
  if (!tmdbId) return null;
  return `moviehub:failed:${tmdbId}:${season ?? "m"}:${episode ?? "m"}`;
}

export interface FailedSet {
  names: Set<string>;
  hashes: Set<string>;
}

/**
 * Remember release(s) that failed (or were removed while failing) for a title /
 * episode, so a later re-grab never picks the same dead source again — even after
 * the download row is deleted. Best-effort; keyed in Redis with a 30-day TTL.
 */
export async function recordFailedSources(
  tmdbId: number | null | undefined,
  season: number | null | undefined,
  episode: number | null | undefined,
  entries: { releaseName?: string | null; infoHash?: string | null }[],
): Promise<void> {
  const key = keyOf(tmdbId, season, episode);
  if (!key) return;
  const members: string[] = [];
  for (const e of entries) {
    if (e.releaseName) members.push(`r:${normRelease(e.releaseName)}`);
    if (e.infoHash) members.push(`h:${e.infoHash.toLowerCase()}`);
  }
  if (members.length === 0) return;
  try {
    const r = getRedisPub();
    await r.sadd(key, ...members);
    await r.expire(key, TTL_SECONDS);
  } catch {
    /* best-effort */
  }
}

/** Sources already known to have failed for this title/episode. */
export async function failedSourcesFor(
  tmdbId: number | null | undefined,
  season: number | null | undefined,
  episode: number | null | undefined,
): Promise<FailedSet> {
  const names = new Set<string>();
  const hashes = new Set<string>();
  const key = keyOf(tmdbId, season, episode);
  if (!key) return { names, hashes };
  try {
    for (const m of await getRedisPub().smembers(key)) {
      if (m.startsWith("r:")) names.add(m.slice(2));
      else if (m.startsWith("h:")) hashes.add(m.slice(2));
    }
  } catch {
    /* ignore */
  }
  return { names, hashes };
}

/** Forget a title/episode's failed-source history (for a full retry-everything reset). */
export async function clearFailedSources(
  tmdbId: number | null | undefined,
  season: number | null | undefined,
  episode: number | null | undefined,
): Promise<void> {
  const key = keyOf(tmdbId, season, episode);
  if (!key) return;
  try {
    await getRedisPub().del(key);
  } catch {
    /* best-effort */
  }
}

/** Drop any search results whose name/hash is a known-failed source. */
export function excludeFailed<T extends { title: string; infoHash?: string }>(
  results: T[],
  failed: FailedSet,
): T[] {
  return results.filter(
    (r) => !failed.names.has(normRelease(r.title)) && !failed.hashes.has((r.infoHash ?? "").toLowerCase()),
  );
}
