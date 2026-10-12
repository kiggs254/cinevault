/**
 * Automatic subtitles for everything in the library.
 *
 * Subtitles are stored as Jellyfin sidecars in S3 — "<video>.<lang>.srt" right
 * next to "<video>.mkv" — so any player (and any future Jellyfin rebuild) picks
 * them up with no plugin, and they travel with the media object.
 *
 * Three ways work gets done:
 *  1. `fetchSubtitlesForDownload` runs for every finished download (queued by the
 *     worker, off the transfer pool so it never holds a download slot).
 *  2. `sweepSubtitles` walks the EXISTING library in batches on a schedule, so
 *     everything already in storage gets backfilled.
 *  3. Both first try to ADOPT subtitles the torrent already shipped (renaming
 *     "Subs/2_English.srt" to the name Jellyfin pairs) before spending any
 *     provider quota.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { getConfig, type ResolvedConfig } from "../config";
import { makeS3, listObjects, putObject, renameObject, isVideoKey } from "../storage/s3";
import { triggerLibraryScan } from "../jellyfin/admin";
import { enqueueSubtitleFetch } from "../queue";
import { logActivity } from "../activity";
import {
  buildProviders,
  type SubtitleProvider,
  type SubtitleQuery,
  type SubtitleResult,
} from "./providers";
import { looksLikeSubtitle, subExtOf } from "./text";
import {
  adoptableCandidates,
  baseName,
  findAdoptable,
  folderOf,
  hasSidecar,
  keysOf,
  metaRecord,
  sidecarKey,
  targetsOf,
  type Row,
} from "./sidecar";

/** Titles examined per sweep run — keeps provider usage (and runtime) bounded. */
const SWEEP_TITLES = 40;
/** Days to wait before re-checking a title that came up empty, by attempt count. */
const RETRY_DAYS = [1, 3, 7, 14, 30];
const DAY = 24 * 60 * 60 * 1000;

/** Cached one-level listings, so a season folder is listed once per sweep. */
class FolderIndex {
  private cache = new Map<string, Set<string>>();
  constructor(
    private s3: ReturnType<typeof makeS3>,
    private bucket: string,
  ) {}

  async get(folder: string): Promise<Set<string>> {
    const hit = this.cache.get(folder);
    if (hit) return hit;
    const entries = await listObjects(this.s3, this.bucket, folder).catch(() => []);
    const set = new Set(entries.filter((e) => !e.isFolder).map((e) => e.key));
    this.cache.set(folder, set);
    return set;
  }

  add(folder: string, key: string): void {
    this.cache.get(folder)?.add(key);
  }

  remove(folder: string, key: string): void {
    this.cache.get(folder)?.delete(key);
  }
}

/** Ask each provider in turn until one yields a usable subtitle. */
async function fetchFromProviders(
  providers: SubtitleProvider[],
  q: SubtitleQuery,
): Promise<SubtitleResult | null> {
  for (const p of providers) {
    if (p.blocked()) continue;
    try {
      const got = await p.find(q);
      if (got) return got;
    } catch (e) {
      console.error(`[subs] ${p.name} failed for ${q.videoName}:`, (e as Error).message);
    }
  }
  return null;
}

export interface SubtitleFetchResult {
  /** Sidecars newly written from a provider. */
  added: number;
  /** Sidecars recovered by renaming a file the torrent already shipped. */
  adopted: number;
  /** Languages now covered for EVERY video in this download. */
  covered: string[];
  /** True when every video has every requested language. */
  complete: boolean;
  /**
   * True when something was left untried because every provider was cooling off
   * (daily quota spent). The row's state is NOT advanced in that case: "missing"
   * would say nothing about whether a subtitle exists.
   */
  deferred: boolean;
}

const EMPTY: SubtitleFetchResult = {
  added: 0,
  adopted: 0,
  covered: [],
  complete: true,
  deferred: false,
};

/**
 * Ensure every video of one download has a sidecar for each configured language.
 * Idempotent and cheap to re-run: an existing sidecar is detected from a single
 * folder listing, so repeat calls cost one LIST and no provider quota.
 */
export async function fetchSubtitlesForDownload(
  downloadId: string,
  ctx?: { cfg?: ResolvedConfig; providers?: SubtitleProvider[]; index?: FolderIndex },
): Promise<SubtitleFetchResult> {
  const cfg = ctx?.cfg ?? (await getConfig());
  if (!cfg.subtitles.enabled || !cfg.s3.endpoint || !cfg.s3.bucket) return EMPTY;

  const row = (await prisma.download.findUnique({
    where: { id: downloadId },
    select: {
      id: true, kind: true, title: true, year: true, season: true, episode: true,
      tmdbId: true, s3Key: true, s3Bucket: true, metadata: true, subsAttempts: true,
    },
  })) as Row | null;
  if (!row || !row.s3Key) return EMPTY;
  if (row.kind !== "MOVIE" && row.kind !== "TV") return EMPTY;

  const bucket = row.s3Bucket ?? cfg.s3.bucket;
  const client = makeS3(cfg.s3);
  const index = ctx?.index ?? new FolderIndex(client, bucket);
  const providers = ctx?.providers ?? buildProviders(cfg);
  const langs = cfg.subtitles.languages;
  const targets = targetsOf(row);

  if (!targets.length) {
    // Nothing indexable (music/other, or a row whose files are gone) — stop
    // reconsidering it every sweep.
    await markChecked(row, langs, true);
    return EMPTY;
  }

  const newKeys: string[] = [];
  const renamed: { from: string; to: string }[] = [];
  let added = 0;
  let adopted = 0;
  let deferred = false;
  // How many of this row's videos each language is satisfied for.
  const coverage = new Map<string, number>(langs.map((l) => [l, 0]));
  // Shipped-but-misnamed subtitles still up for grabs. Seeded from the download's
  // own files (a release often puts them under "Subs/", away from the video) and
  // topped up from each folder we list. A claimed file leaves the pool, so two
  // episodes can never fight over the same one.
  const pool = new Set(adoptableCandidates(keysOf(row), targets.map((t) => t.videoKey)));

  for (const target of targets) {
    const existing = await index.get(target.folder);
    const folderVideos = [...existing].filter((k) => isVideoKey(baseName(k)));
    for (const k of adoptableCandidates(existing, folderVideos)) pool.add(k);
    for (const lang of langs) {
      if (hasSidecar(existing, target.videoKey, lang)) {
        coverage.set(lang, (coverage.get(lang) ?? 0) + 1);
        continue;
      }

      // 1. Free win: a subtitle this release already shipped, just misnamed.
      const claim = findAdoptable(pool, target, lang);
      if (claim) {
        const ext = subExtOf(baseName(claim).toLowerCase()) ?? ".srt";
        const to = sidecarKey(target.videoKey, lang, ext);
        try {
          await renameObject(client, bucket, claim, to);
          pool.delete(claim);
          index.remove(folderOf(claim), claim);
          index.add(target.folder, to);
          existing.delete(claim);
          existing.add(to);
          renamed.push({ from: claim, to });
          adopted++;
          coverage.set(lang, (coverage.get(lang) ?? 0) + 1);
          continue;
        } catch (e) {
          console.error(`[subs] adopt failed for ${claim}:`, (e as Error).message);
        }
      }

      // 2. Fetch from the providers.
      if (!providers.length) continue;
      if (providers.every((p) => p.blocked())) {
        // Every provider is out of quota. Leave this one alone rather than
        // banking a miss we didn't earn.
        deferred = true;
        continue;
      }
      const got = await fetchFromProviders(providers, {
        kind: row.kind === "TV" ? "TV" : "MOVIE",
        title: row.title,
        year: row.year,
        tmdbId: row.tmdbId,
        season: target.season,
        episode: target.episode,
        videoName: target.videoName,
        lang,
        hearingImpaired: cfg.subtitles.hearingImpaired,
      });
      if (!got) continue;
      // Providers already validate what they download; check again at the write
      // point so a provider bug can never park an ad page in the library.
      if (!looksLikeSubtitle(got.text, got.ext)) {
        console.error(`[subs] ${got.provider} returned a non-subtitle for ${target.videoName}`);
        continue;
      }

      const key = sidecarKey(target.videoKey, lang, got.ext);
      try {
        await putObject({
          s3: client,
          bucket,
          key,
          body: Buffer.from(got.text, "utf8"),
          contentType: `${got.ext === ".vtt" ? "text/vtt" : "application/x-subrip"}; charset=utf-8`,
        });
        index.add(target.folder, key);
        existing.add(key);
        newKeys.push(key);
        added++;
        coverage.set(lang, (coverage.get(lang) ?? 0) + 1);
      } catch (e) {
        console.error(`[subs] upload failed for ${key}:`, (e as Error).message);
      }
    }
  }

  const covered = langs.filter((l) => (coverage.get(l) ?? 0) >= targets.length);
  const complete = covered.length === langs.length;
  // Whatever we stored is recorded either way; the "checked" bookkeeping only
  // advances when the gap we found was real and not a quota outage.
  await markChecked(row, covered, complete, { newKeys, renamed }, deferred && !complete);

  if (added || adopted) {
    const what = [
      added ? `${added} downloaded` : "",
      adopted ? `${adopted} matched from the release` : "",
    ]
      .filter(Boolean)
      .join(", ");
    console.log(`[subs] ${row.title}: ${what}`);
    void logActivity(`💬 Subtitles ready for ${row.title} (${what})`, {
      kind: "info",
      title: row.title,
    });
  }
  return { added, adopted, covered, complete, deferred };
}

/**
 * Record the outcome on the row (and on any sibling row pointing at the same
 * object, so a shared file is never looked up twice). `subsAttempts` only grows
 * on a miss — it drives the retry backoff in the sweep.
 */
async function markChecked(
  row: Row,
  covered: string[],
  complete: boolean,
  changes?: { newKeys: string[]; renamed: { from: string; to: string }[] },
  deferred = false,
): Promise<void> {
  // A deferred row keeps its existing state, so a provider outage can never
  // look like "this title has no subtitles".
  const data: Prisma.DownloadUpdateInput = deferred
    ? {}
    : {
        subsCheckedAt: new Date(),
        subsLangs: covered.length ? covered.join(",") : null,
        subsAttempts: complete ? 0 : row.subsAttempts + 1,
      };

  if (changes && (changes.newKeys.length || changes.renamed.length)) {
    const meta = metaRecord(row.metadata);
    const renameMap = new Map(changes.renamed.map((r) => [r.from, r.to]));
    const keys = keysOf(row).map((k) => renameMap.get(k) ?? k);
    data.metadata = {
      ...meta,
      // Sidecars join the key list, so deleting the download removes them too.
      s3Keys: Array.from(new Set([...keys, ...changes.newKeys])),
    } as unknown as Prisma.InputJsonValue;
  }

  if (Object.keys(data).length) {
    await prisma.download.update({ where: { id: row.id }, data }).catch(() => {});
  }

  // Other members' rows share the exact same S3 object — mirror the verdict so
  // the sweep doesn't re-check the same files once per member.
  if (row.s3Key && !deferred) {
    await prisma.download
      .updateMany({
        where: { s3Key: row.s3Key, s3DeletedAt: null, id: { not: row.id } },
        data: {
          subsCheckedAt: new Date(),
          subsLangs: covered.length ? covered.join(",") : null,
          subsAttempts: complete ? 0 : row.subsAttempts + 1,
        },
      })
      .catch(() => {});
  }
}

/** Has this row waited long enough for another look after coming up empty? */
function dueForRetry(checkedAt: Date | null, attempts: number): boolean {
  if (!checkedAt) return true;
  const days = RETRY_DAYS[Math.min(attempts, RETRY_DAYS.length - 1)];
  return Date.now() - checkedAt.getTime() >= days * DAY;
}

/**
 * Backfill the existing library, oldest-unchecked first. Each pass takes a
 * bounded slice so a large library catches up without tripping a provider's
 * rate limit. The scheduled run honours the `autoSweep` setting; `manual: true`
 * is the admin pressing "Backfill now" and runs either way.
 */
export async function sweepSubtitles(opts?: { manual?: boolean }): Promise<{
  titles: number;
  added: number;
  adopted: number;
  remaining: number;
  /** Titles left untried because every provider is out of quota. */
  deferred: number;
}> {
  const cfg = await getConfig();
  const idle = { titles: 0, added: 0, adopted: 0, remaining: 0, deferred: 0 };
  if (!cfg.subtitles.enabled || !cfg.s3.endpoint || !cfg.s3.bucket) return idle;
  // The scheduled sweep is skippable; a manual backfill is an explicit request.
  if (!cfg.subtitles.autoSweep && !opts?.manual) return idle;
  const langs = cfg.subtitles.languages;
  const wanted = new Set(langs);

  const rows = await prisma.download.findMany({
    where: {
      status: "COMPLETED",
      s3Key: { not: null },
      s3DeletedAt: null,
      kind: { in: ["MOVIE", "TV"] },
    },
    select: {
      id: true, kind: true, title: true, year: true, season: true, episode: true,
      tmdbId: true, s3Key: true, s3Bucket: true, metadata: true,
      subsAttempts: true, subsCheckedAt: true, subsLangs: true,
    },
    orderBy: [{ subsCheckedAt: { sort: "asc", nulls: "first" } }, { completedAt: "desc" }],
    take: 1000,
  });

  // A row is due when a configured language isn't covered yet AND its backoff
  // has elapsed. Adding a new language makes everything due again, by design.
  const due = rows.filter((r) => {
    const have = new Set((r.subsLangs ?? "").split(",").filter(Boolean));
    const missing = [...wanted].some((l) => !have.has(l));
    return missing && dueForRetry(r.subsCheckedAt, r.subsAttempts);
  });

  const providers = buildProviders(cfg);
  const bucket = cfg.s3.bucket;
  const index = new FolderIndex(makeS3(cfg.s3), bucket);
  const batch = due.slice(0, SWEEP_TITLES);

  let added = 0;
  let adopted = 0;
  let processed = 0;
  let deferred = 0;
  for (const r of batch) {
    // Every provider out of quota → stop. The titles left are untouched, not
    // marked as having no subtitles, so the next window retries them for real.
    if (providers.length && providers.every((p) => p.blocked())) {
      deferred = batch.length - processed;
      break;
    }
    processed++;
    try {
      const res = await fetchSubtitlesForDownload(r.id, { cfg, providers, index });
      added += res.added;
      adopted += res.adopted;
      if (res.deferred && !res.complete) {
        deferred += 1;
        processed -= 1;
      }
    } catch (e) {
      console.error(`[subs] sweep failed for ${r.title}:`, (e as Error).message);
      // Still record the attempt: the sweep's backlog must shrink every pass, or
      // the catch-up chain below would never finish.
      await prisma.download
        .update({
          where: { id: r.id },
          data: { subsCheckedAt: new Date(), subsAttempts: r.subsAttempts + 1 },
        })
        .catch(() => {});
    }
  }

  if (added || adopted) await triggerLibraryScan(cfg.jellyfin).catch(() => {});
  const remaining = Math.max(0, due.length - batch.length) + deferred;

  // Say out loud when a provider's daily cap is what stopped us — otherwise a
  // paused backfill is indistinguishable from a finished one.
  if (deferred) {
    const wait = Math.max(...providers.map((p) => p.cooldownMs()), 0);
    const hrs = wait > 0 ? ` Retrying in ~${Math.max(1, Math.round(wait / 3600_000))}h.` : "";
    const msg = `Subtitle provider daily limit reached — ${remaining} title(s) still queued.${hrs}`;
    console.log(`[subs] ${msg}`);
    void logActivity(`💬 ${msg}`, { kind: "info" });
  }
  // One line per batch in the activity feed, so a backfill is visibly running
  // even when a batch of titles turns up nothing (the per-title lines only
  // appear for titles that actually gained subtitles).
  if (processed && !deferred) {
    const got = added + adopted;
    void logActivity(
      `💬 Subtitles: checked ${processed} title(s), added ${got}` +
        (remaining ? ` — ${remaining} to go` : " — library is up to date"),
      { kind: "info" },
    );
  }
  return { titles: processed, added, adopted, remaining, deferred };
}

/** Library titles still missing at least one configured language. */
export async function pendingSubtitleCount(): Promise<{ pending: number; total: number }> {
  const cfg = await getConfig();
  const wanted = cfg.subtitles.languages;
  const rows = await prisma.download.findMany({
    where: {
      status: "COMPLETED",
      s3Key: { not: null },
      s3DeletedAt: null,
      kind: { in: ["MOVIE", "TV"] },
    },
    select: { subsLangs: true },
  });
  const pending = rows.filter((r) => {
    const have = new Set((r.subsLangs ?? "").split(",").filter(Boolean));
    return wanted.some((l) => !have.has(l));
  }).length;
  return { pending, total: rows.length };
}

/**
 * Validate the configured subtitle providers (search only — spends no download
 * quota) and report how much of the library is still waiting on a sweep.
 */
export async function checkSubtitleProviders(): Promise<{ ok: boolean; message: string }> {
  const cfg = await getConfig();
  const { pending, total } = await pendingSubtitleCount();
  const backlog = `${pending}/${total} title(s) still need ${cfg.subtitles.languages.join(", ")}`;
  if (!cfg.subtitles.enabled) {
    return { ok: false, message: `Auto-subtitles are switched off — ${backlog}` };
  }
  const providers = buildProviders(cfg);
  if (!providers.length) {
    return {
      ok: false,
      message: `No subtitle provider key set — only subtitles already inside a release can be matched. ${backlog}`,
    };
  }
  const results = await Promise.all(providers.map((p) => p.probe()));
  const ok = results.some((r) => r.ok);
  // A provider can be reachable but out of downloads for the day — the single
  // most common reason a backfill looks stuck.
  const waiting = providers
    .filter((p) => p.blocked())
    .map((p) => `${p.name} is at its daily limit (~${Math.max(1, Math.round(p.cooldownMs() / 3600_000))}h left)`);
  const parts = [results.map((r) => r.message).join(" · "), ...waiting, backlog];
  return { ok, message: parts.join(" — ") };
}

export interface SubtitleRequest {
  /** One download row (a movie, an episode, or a season pack). */
  downloadId?: string;
  /** A whole title by TMDB id — every season unless `season` narrows it. */
  tmdbId?: number;
  season?: number;
}

/**
 * Queue an on-demand subtitle fetch for what someone actually wants to watch.
 *
 * This is the path that matters when automatic fetching is off: providers have
 * small daily quotas, so spending them on a request beats spending them on a
 * library-wide sweep. Scoped to the caller's own library unless they're an admin.
 */
export async function requestSubtitles(
  req: SubtitleRequest,
  actor: { userId: string; isAdmin: boolean },
): Promise<{ ok: boolean; queued: number; message: string }> {
  const cfg = await getConfig();
  if (!cfg.subtitles.enabled) {
    return { ok: false, queued: 0, message: "Subtitles are switched off for this server." };
  }
  if (!cfg.s3.endpoint || !cfg.s3.bucket) {
    return { ok: false, queued: 0, message: "Storage isn't configured." };
  }

  const mine = actor.isAdmin ? {} : { userId: actor.userId };
  const scope: Prisma.DownloadWhereInput = req.downloadId
    ? { id: req.downloadId }
    : req.tmdbId != null
      ? { tmdbId: req.tmdbId, ...(req.season != null ? { season: req.season } : {}) }
      : {};
  if (!Object.keys(scope).length) {
    return { ok: false, queued: 0, message: "Nothing specified." };
  }

  const rows = await prisma.download.findMany({
    where: {
      ...scope,
      ...mine,
      status: "COMPLETED",
      s3Key: { not: null },
      s3DeletedAt: null,
      kind: { in: ["MOVIE", "TV"] },
    },
    select: { id: true, title: true, subsLangs: true },
  });
  if (!rows.length) {
    return { ok: false, queued: 0, message: "Not in your library (or not finished downloading yet)." };
  }

  // Skip anything already covered in every configured language — a request
  // shouldn't spend quota re-fetching what's there.
  const wanted = cfg.subtitles.languages;
  const todo = rows.filter((r) => {
    const have = new Set((r.subsLangs ?? "").split(",").filter(Boolean));
    return wanted.some((l) => !have.has(l));
  });
  if (!todo.length) {
    return {
      ok: true,
      queued: 0,
      message: `Already has ${wanted.join(", ")} subtitles.`,
    };
  }

  // Asking again clears the backoff: an explicit request should retry now, even
  // for a title that came up empty before.
  await prisma.download
    .updateMany({ where: { id: { in: todo.map((r) => r.id) } }, data: { subsAttempts: 0 } })
    .catch(() => {});
  for (const r of todo) await enqueueSubtitleFetch(r.id).catch(() => {});

  const what = todo.length === 1 ? `“${todo[0].title}”` : `${todo.length} items`;
  void logActivity(`💬 Subtitles requested for ${what}`, { kind: "info", title: todo[0].title });
  return {
    ok: true,
    queued: todo.length,
    message: `Looking for ${wanted.join(", ")} subtitles for ${what} — this runs in the background.`,
  };
}

/** What the UI needs to decide whether to offer a subtitle request. */
export async function subtitleSettings(): Promise<{
  enabled: boolean;
  autoNew: boolean;
  autoSweep: boolean;
  languages: string[];
  providers: string[];
}> {
  const cfg = await getConfig();
  return {
    enabled: cfg.subtitles.enabled,
    autoNew: cfg.subtitles.autoNew,
    autoSweep: cfg.subtitles.autoSweep,
    languages: cfg.subtitles.languages,
    providers: buildProviders(cfg).map((p) => p.name),
  };
}
