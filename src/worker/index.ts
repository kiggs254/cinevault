import "dotenv/config";
import path from "node:path";
import { Readable } from "node:stream";
import { Worker, type Job } from "bullmq";
import { createRedis } from "../lib/redis";
import { DOWNLOAD_QUEUE, GRAB_QUEUE, enqueueDownload, schedulePeriodicJobs } from "../lib/queue";
import { scanWatches } from "../lib/service/watches";
import { scanFollowedShows, autoFollowFromJellyfin, advanceSeasons } from "../lib/service/follows";
import { refreshRecommendations } from "../lib/service/recommendations";
import { scanWantedMovies } from "../lib/service/wanted";
import { ensureBootstrapAdmin } from "../lib/service/users";
import { runRetention } from "../lib/service/retention";
import { startTelegramBot } from "../lib/telegram/bot";
import { notifyActivity } from "../lib/telegram/client";
import { prisma } from "../lib/db";
import { getConfig, type ResolvedConfig } from "../lib/config";
import { QbClient, parseInfoHash, isHeldByQbittorrent, type QbTorrentInfo } from "../lib/torrent/qbittorrent";
import { resolveExtraTrackers } from "../lib/torrent/trackers";
import { TorboxClient, type TorboxTorrent } from "../lib/torbox/client";
import {
  reSource,
  grabSeason,
  recoverStuckDownloads,
  runEpisodeGrab,
  retryFailed,
  recordDownloadFailure,
} from "../lib/service/downloads";
import { makeS3, uploadContent, uploadStream, classifyUploadName } from "../lib/storage/s3";
import { triggerLibraryScan } from "../lib/jellyfin/admin";
import { organize } from "../lib/llm/organizer";
import { enrich } from "../lib/metadata/tmdb";
import { publishProgress } from "../lib/events";
import { logActivity } from "../lib/activity";
import type { DownloadJobData, DownloadStatus, MediaKind } from "../lib/types";

/** " S02E05" / " Season 2" / "" from a download row's season/episode. */
function epTag(season: number | null, episode: number | null): string {
  if (season == null) return "";
  const s = `S${String(season).padStart(2, "0")}`;
  return episode != null ? ` ${s}E${String(episode).padStart(2, "0")}` : ` Season ${season}`;
}

const CATEGORY = "moviehub";
const POLL_MS = 2000;
const REGISTER_TIMEOUT_MS = 90_000;
const TORBOX_WAIT_MS = 20 * 60 * 1000; // max wait for TorBox to fetch an uncached torrent
const TORBOX_POLL_MS = 5000;
const STALL_MS = 10 * 60 * 1000; // grace for a connected-but-slow torrent
const DEAD_MS = 2 * 60 * 1000; // grace when qBittorrent reports no seeders at all
const MISSING_MS = 60 * 1000; // grace before treating a vanished torrent as a stall
// A download must pull data at least this fast (bytes/s) to count as "moving
// considerably". If it crawls below it — and isn't gaining real progress — for
// STALL_MS, proactively switch to a working source. Tune with MIN_DL_SPEED.
const MIN_DL_SPEED = Math.max(0, Math.floor(Number(process.env.MIN_DL_SPEED)) || 40 * 1024);
const PROGRESS_STEP = 3; // % gained within the window that still counts as movement
const RESOURCE_MAX_PROGRESS = 45; // don't swap a slow (but not dead) download past this %
const MAX_RESOURCE_ATTEMPTS = 5; // source swaps before giving up (retry-failed keeps going after)

// How many jobs the worker runs at once. Each active download holds a slot for
// its whole download + S3 upload, so this also bounds simultaneous uploads.
// Maintenance scans share this pool, hence the default sits above the usual
// target of 4 concurrent downloads. Tune with the DOWNLOAD_CONCURRENCY env var.
// NOTE: qBittorrent's own "Maximum active downloads" must be >= this value, or
// it will queue torrents past its limit even though the worker started them.
const DOWNLOAD_CONCURRENCY = Math.max(1, Math.floor(Number(process.env.DOWNLOAD_CONCURRENCY)) || 6);
// Search/grab work runs on its own pool so it never waits behind long transfers.
const GRAB_CONCURRENCY = Math.max(1, Math.floor(Number(process.env.GRAB_CONCURRENCY)) || 4);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const UP_STATES = new Set([
  "uploading",
  "stalledUP",
  "pausedUP",
  "queuedUP",
  "forcedUP",
  "checkingUP",
]);

function isComplete(info: QbTorrentInfo): boolean {
  return info.progress >= 0.999 || UP_STATES.has(info.state);
}
function isErrored(info: QbTorrentInfo): boolean {
  return info.state === "error" || info.state === "missingFiles";
}
function clampEta(eta: number): number | null {
  return eta == null || eta < 0 || eta >= 8_640_000 ? null : eta;
}

function throttle<T extends (...a: never[]) => void>(fn: T, ms: number): T {
  let last = 0;
  return ((...args: never[]) => {
    const now = Date.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    }
  }) as T;
}

async function setStatus(id: string, status: DownloadStatus, progress?: number) {
  await prisma.download
    .update({ where: { id }, data: { status, ...(progress != null ? { progress } : {}) } })
    .catch(() => {});
  await publishProgress({ type: "status", downloadId: id, status, progress });
}

const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** True when a qBittorrent torrent name plausibly IS this release (not a sibling). */
function torrentMatchesRelease(torrentName: string, releaseName: string): boolean {
  const a = normName(torrentName);
  const b = normName(releaseName);
  if (a.length < 12 || b.length < 12) return true; // too short to judge — don't block
  return a === b || a.includes(b) || b.includes(a);
}

/**
 * Wait for an added torrent to appear. Beyond hash/tag, this handles the case
 * where qBittorrent DEDUPED the add — keeping a pre-existing torrent under an old
 * tag, so ours never applied (common for .torrent sources, where we have no
 * info-hash to search by) — or simply hasn't tagged it yet: it matches the
 * release name or a newly-appeared torrent, then applies our download id as a tag
 * so later lookups (and stall re-sourcing) can find it.
 */
async function waitForTorrent(
  qb: QbClient,
  id: string,
  hash: string | undefined,
  releaseName: string,
  beforeHashes: Set<string>,
  timeoutMs: number,
): Promise<QbTorrentInfo | undefined> {
  const deadline = Date.now() + timeoutMs;
  const canName = normName(releaseName).length >= 12;
  const named = (t: QbTorrentInfo) => torrentMatchesRelease(t.name, releaseName);
  while (Date.now() < deadline) {
    // 1. Exact info-hash — ground truth, survives qBittorrent's dedup.
    let info = hash ? await qb.getByHash(hash) : undefined;
    if (!info) {
      const all = await qb.list(CATEGORY).catch(() => [] as QbTorrentInfo[]);
      const fresh = all.filter((t) => !beforeHashes.has(t.hash.toLowerCase()));
      const tagged = await qb.getByTag(id);
      info =
        // 2. A newly-appeared torrent whose name matches this release — unique
        //    even when several similar adds run concurrently.
        (canName ? fresh.find(named) : undefined) ??
        // 3. Our unique tag, but only if its name fits (a mis-tagged sibling
        //    from an earlier racy lookup must not win).
        (tagged && (!canName || named(tagged)) ? tagged : undefined) ??
        // 4. A lone new torrent, or any category torrent matching by name.
        (fresh.length === 1 ? fresh[0] : undefined) ??
        (canName ? all.find(named) : undefined);
      if (info) await qb.addTags([info.hash], id).catch(() => {});
    }
    if (info) return info;
    await sleep(2000);
  }
  return undefined;
}

/** Snapshot the current torrent hashes in our category (to detect a new add). */
async function categoryHashes(qb: QbClient): Promise<Set<string>> {
  const all = await qb.list(CATEGORY).catch(() => [] as QbTorrentInfo[]);
  return new Set(all.map((t) => t.hash.toLowerCase()));
}

/** A torrent went dead enough to switch source — recoverable, not a hard fail. */
class StalledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StalledError";
  }
}

async function pollUntilComplete(
  qb: QbClient,
  id: string,
  hash: string,
): Promise<QbTorrentInfo> {
  let lastProgress = 0;
  let stalledSince = Date.now();
  let missingSince = 0;

  for (;;) {
    await sleep(POLL_MS);
    const info = (await qb.getByHash(hash)) ?? (await qb.getByTag(id));
    if (!info) {
      // The torrent vanished from qBittorrent (a swap race, a manual delete, or a
      // lost session). Brief gaps are fine; if it stays gone, re-source instead of
      // spinning here forever on stale progress (the app-vs-qBit desync).
      if (!missingSince) missingSince = Date.now();
      else if (Date.now() - missingSince > MISSING_MS) {
        throw new StalledError("torrent vanished from qBittorrent");
      }
      continue;
    }
    missingSince = 0;
    if (isErrored(info)) throw new StalledError(`qBittorrent reported "${info.state}"`);

    const pct = Math.min(100, info.progress * 100);
    await prisma.download
      .update({
        where: { id },
        data: {
          progress: pct,
          dlSpeed: info.dlspeed,
          upSpeed: info.upspeed,
          etaSeconds: clampEta(info.eta),
          seeders: info.num_seeds,
          downloadedBytes: BigInt(Math.max(0, Math.round(info.completed))),
          sizeBytes: BigInt(Math.max(0, Math.round(info.size))),
        },
      })
      .catch(() => {});
    await publishProgress({
      type: "progress",
      downloadId: id,
      status: "DOWNLOADING",
      progress: pct,
      dlSpeed: info.dlspeed,
      upSpeed: info.upspeed,
      etaSeconds: clampEta(info.eta),
      seeders: info.num_seeds,
    });

    if (isComplete(info)) return info;

    // "Moving considerably" = pulling data at a healthy rate OR gaining real progress
    // this window; also reset while qBit is holding the torrent (queue/hash-check).
    // Otherwise, once the grace window elapses, proactively switch to a working
    // source. A no-seeders/metaDL torrent is dead → switch fast (DEAD_MS) at any
    // progress; a merely-slow one waits STALL_MS and is only swapped while still
    // early (don't throw away a mostly-done download). Errored states re-source above.
    const movingWell =
      info.dlspeed >= MIN_DL_SPEED || pct >= lastProgress + PROGRESS_STEP || isHeldByQbittorrent(info);
    if (movingWell) {
      lastProgress = pct;
      stalledSince = Date.now();
    } else {
      const swarmSeeds = info.num_complete ?? info.num_seeds ?? 0;
      const dead = info.state === "metaDL" || swarmSeeds <= 0;
      const grace = dead ? DEAD_MS : STALL_MS;
      if (Date.now() - stalledSince > grace) {
        if (dead || pct < RESOURCE_MAX_PROGRESS) {
          throw new StalledError(
            info.state === "metaDL"
              ? "couldn't fetch torrent metadata (dead magnet)"
              : swarmSeeds <= 0
                ? `no seeders — qBittorrent state "${info.state}"`
                : `too slow — under ${Math.round(MIN_DL_SPEED / 1024)} KB/s for 10 min`,
          );
        }
        // Slow but already well underway — let it finish; just reset the window.
        lastProgress = pct;
        stalledSince = Date.now();
      }
    }
  }
}

type StallOutcome = QbTorrentInfo | "gave-up" | "superseded";

function readResourceMeta(metadata: unknown): { triedInfoHashes: string[]; resourceAttempts: number } {
  const m =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  const tried = Array.isArray(m.triedInfoHashes)
    ? m.triedInfoHashes.filter((x): x is string => typeof x === "string")
    : [];
  const attempts = typeof m.resourceAttempts === "number" ? m.resourceAttempts : 0;
  return { triedInfoHashes: tried, resourceAttempts: attempts };
}

/** Poll to completion; on a stall, switch to another source and keep polling. */
async function downloadWithReSource(
  qb: QbClient,
  id: string,
  start: QbTorrentInfo,
  cfg: Awaited<ReturnType<typeof getConfig>>,
): Promise<QbTorrentInfo> {
  let current = start;
  for (;;) {
    try {
      return await pollUntilComplete(qb, id, current.hash);
    } catch (e) {
      if (!(e instanceof StalledError)) throw e;
      const next = await handleStall(qb, id, current, cfg);
      if (next === "gave-up") {
        // Exhausted source swaps — say so plainly (usually means no seeders).
        throw new Error(
          `No working source — every release stalled (likely no seeders). Last: ${e.message}`,
        );
      }
      if (next === "superseded") {
        // Another worker (restart-recovery) already swapped — reload and continue.
        const dl = await prisma.download.findUnique({ where: { id }, select: { qbitHash: true } });
        const info =
          (dl?.qbitHash ? await qb.getByHash(dl.qbitHash) : undefined) ?? (await qb.getByTag(id));
        if (info) current = info;
        continue;
      }
      current = next;
    }
  }
}

/**
 * Handle a stalled torrent: find a fresh source, atomically claim the swap via a
 * compare-and-swap on qbitHash (so an overlapping worker can't double-add), then
 * replace the torrent. Tried hashes + attempt count persist in `metadata`.
 */
async function handleStall(
  qb: QbClient,
  id: string,
  current: QbTorrentInfo,
  cfg: Awaited<ReturnType<typeof getConfig>>,
): Promise<StallOutcome> {
  const dl = await prisma.download.findUnique({ where: { id } });
  if (!dl) return "gave-up";
  const meta = readResourceMeta(dl.metadata);
  if (meta.resourceAttempts >= MAX_RESOURCE_ATTEMPTS) return "gave-up";

  const currentHash = (dl.infoHash ?? current.hash).toLowerCase();
  const chosen = await reSource(
    {
      kind: dl.kind as MediaKind,
      query: dl.query,
      title: dl.title,
      year: dl.year,
      season: dl.season,
      episode: dl.episode,
      infoHash: dl.infoHash,
    },
    [...meta.triedInfoHashes, currentHash],
  );
  if (!chosen) return "gave-up";

  const isMagnet = !!chosen.magnetUrl;
  const newSource = chosen.magnetUrl ?? chosen.downloadUrl;
  if (!newSource) return "gave-up";
  const newHash =
    (chosen.infoHash ?? (chosen.magnetUrl ? parseInfoHash(chosen.magnetUrl) : undefined))?.toLowerCase() ??
    null;

  // CAS: only the worker still holding `current.hash` wins the swap.
  const claim = await prisma.download.updateMany({
    where: { id, qbitHash: current.hash },
    data: {
      magnet: newSource,
      infoHash: newHash,
      indexer: chosen.indexer ?? null,
      seeders: chosen.seeders ?? null,
      releaseName: chosen.title,
      progress: 0,
      dlSpeed: 0,
      metadata: {
        triedInfoHashes: [...meta.triedInfoHashes, currentHash, ...(newHash ? [newHash] : [])],
        resourceAttempts: meta.resourceAttempts + 1,
      },
    },
  });
  if (claim.count === 0) return "superseded";

  const beforeHashes = await categoryHashes(qb);
  await qb.delete([current.hash], true).catch(() => {});
  await qb.addTorrent({
    magnet: isMagnet ? newSource : undefined,
    torrentUrl: isMagnet ? undefined : newSource,
    savePath: cfg.prefs.downloadDir,
    category: CATEGORY,
    tag: id,
  });
  const info = await waitForTorrent(qb, id, newHash ?? undefined, chosen.title, beforeHashes, REGISTER_TIMEOUT_MS);
  if (!info) return "gave-up";
  await prisma.download.update({ where: { id }, data: { qbitHash: info.hash } });
  await publishProgress({
    type: "status",
    downloadId: id,
    status: "DOWNLOADING",
    message: `Stalled — switched source (${meta.resourceAttempts + 1}/${MAX_RESOURCE_ATTEMPTS})`,
  });
  return info;
}

/**
 * Fetch a release via TorBox (debrid) and stream its files DIRECTLY into S3 —
 * the bytes never touch the local disk, so a large or stuck download can't fill
 * the host (that took the whole box down once). Add the magnet, wait until TorBox
 * has the files on its cloud, then pipe each file's HTTP body into a multipart S3
 * upload at its final key. Returns the uploaded keys, or null to fall back to
 * qBittorrent (rate-limited, errored, or too slow).
 */
async function streamTorboxToS3(
  id: string,
  dl: { magnet: string; title: string; season: number | null; episode: number | null },
  cfg: ResolvedConfig,
  dest: {
    s3: ReturnType<typeof makeS3>;
    bucket: string;
    keyPrefix: string;
    onProgress: (uploaded: number, total: number) => void;
  },
): Promise<{ keys: string[]; bytes: number; primaryKey: string } | null> {
  const tb = new TorboxClient(cfg.torbox);
  let added: { torrentId: number; hash?: string } | null;
  if (dl.magnet.startsWith("magnet:")) {
    added = await tb.addMagnet(dl.magnet);
  } else {
    // Indexer .torrent URLs commonly 302-redirect to EITHER a .torrent file OR a
    // magnet link. Resolve the redirect manually: hand a magnet to addMagnet,
    // otherwise fetch the .torrent bytes. (Following the redirect blindly lands on
    // a magnet: URL, which fetch() rejects — that was the "network" failure.)
    const first = await fetch(dl.magnet, { redirect: "manual" }).catch(() => null);
    if (!first) {
      console.log(`[torbox] .torrent fetch failed for ${dl.title}: network`);
      return null;
    }
    const loc = first.headers.get("location");
    if (loc && loc.startsWith("magnet:")) {
      added = await tb.addMagnet(loc);
    } else {
      const tor = loc ? await fetch(loc).catch(() => null) : first;
      if (!tor || !tor.ok) {
        console.log(`[torbox] .torrent fetch failed for ${dl.title}: ${tor?.status ?? "network"}`);
        return null;
      }
      added = await tb.addTorrentFile(await tor.arrayBuffer());
    }
  }
  if (!added) {
    console.log(`[torbox] add rejected for ${dl.title} — using qBittorrent (bad key / rate-limited?)`);
    return null;
  }
  console.log(`[torbox] queued ${dl.title} (torrent ${added.torrentId})`);
  void logActivity(`TorBox: fetching ${dl.title}${epTag(dl.season, dl.episode)}…`, {
    kind: "download",
    title: dl.title,
  });

  // Phase 1 — wait until TorBox has the files (its cloud does the torrenting).
  let info: TorboxTorrent | null = null;
  const deadline = Date.now() + TORBOX_WAIT_MS;
  while (Date.now() < deadline) {
    info = await tb.get(added.torrentId);
    if (info && (info.download_finished || info.download_present) && info.files.length) break;
    if (info?.download_state && /error|fail|dead|stall/i.test(info.download_state)) {
      info = null;
      break;
    }
    await publishProgress({
      type: "progress",
      downloadId: id,
      status: "DOWNLOADING",
      progress: Math.min(99, Math.round((info?.progress ?? 0) * 100)),
    });
    await sleep(TORBOX_POLL_MS);
  }
  if (!info || !(info.download_finished || info.download_present) || !info.files.length) {
    await tb.remove(added.torrentId);
    return null; // fall back to qBittorrent
  }

  // Phase 2 — stream each file's HTTP body straight into S3 (no local disk).
  await setStatus(id, "UPLOADING", 0);
  void logActivity(`Uploading ${dl.title}${epTag(dl.season, dl.episode)} to S3…`, {
    kind: "upload",
    title: dl.title,
  });
  const prefix = dest.keyPrefix.replace(/^\/+|\/+$/g, "");
  // Keep only real media (drop promo/junk; coerce a bogus video extension); a
  // large file behind a ".exe" is the video, a tiny ".jpg/.txt" is a torrent ad.
  const accepted: { f: (typeof info.files)[number]; name: string }[] = [];
  for (const f of info.files) {
    const n = classifyUploadName(
      (f.short_name || path.basename(f.name) || `file-${f.id}`).replace(/[/\\]/g, "_"),
      f.size || 0,
    );
    if (n) accepted.push({ f, name: n });
  }
  if (accepted.length === 0) {
    await tb.remove(added.torrentId);
    return null; // nothing but junk — fall back to qBittorrent
  }
  const total = accepted.reduce((a, x) => a + (x.f.size || 0), 0);
  let doneBytes = 0;
  const keys: string[] = [];
  let primaryKey = "";
  let primarySize = -1;
  for (const { f, name } of accepted) {
    const link = await tb.requestDownloadLink(added.torrentId, f.id);
    if (!link) continue;
    const key = `${prefix}/${name}`;
    const res = await fetch(link);
    if (!res.ok || !res.body) {
      console.error(`[torbox] file fetch failed for ${name}: ${res.status}`);
      continue;
    }
    const body = Readable.fromWeb(res.body as Parameters<typeof Readable.fromWeb>[0]);
    let fileLoaded = 0;
    try {
      await uploadStream({
        s3: dest.s3,
        bucket: dest.bucket,
        key,
        body,
        onProgress: (loaded) => {
          doneBytes += loaded - fileLoaded;
          fileLoaded = loaded;
          dest.onProgress(doneBytes, total);
        },
      });
      keys.push(key);
      if ((f.size || 0) > primarySize) {
        primarySize = f.size || 0;
        primaryKey = key;
      }
    } catch (e) {
      console.error(`[torbox] stream→S3 failed for ${name}:`, (e as Error).message);
    }
  }
  await tb.remove(added.torrentId); // files are in S3 now — free the TorBox slot
  if (!keys.length) return null;
  return { keys, bytes: total, primaryKey };
}

// Nudge Jellyfin to scan after a completion, at most once a minute (a burst of
// finished episodes coalesces into one scan; a scan already running is a no-op).
let lastJellyfinScan = 0;
async function pokeJellyfinScan(cfg: ResolvedConfig): Promise<void> {
  if (!cfg.jellyfin.url || !cfg.jellyfin.apiKey) return;
  const now = Date.now();
  if (now - lastJellyfinScan < 60_000) return;
  lastJellyfinScan = now;
  await triggerLibraryScan(cfg.jellyfin).catch(() => {});
}

async function processDownload(id: string): Promise<void> {
  const dl = await prisma.download.findUnique({ where: { id } });
  if (!dl) return;
  if (!dl.magnet) throw new Error("Download has no torrent source");

  const cfg = await getConfig();
  if (!cfg.s3.endpoint || !cfg.s3.bucket) {
    throw new Error("S3 storage is not fully configured (see Settings)");
  }

  await setStatus(id, "DOWNLOADING", dl.progress);
  void logActivity(`Downloading ${dl.title}${epTag(dl.season, dl.episode)}…`, {
    kind: "download",
    title: dl.title,
  });

  // qBittorrent client — the fallback provider, and used for sibling cleanup.
  const qb = cfg.qbit.url ? new QbClient(cfg.qbit) : null;

  // Resolve the target S3 layout up front (metadata-only) so the TorBox path can
  // stream files straight to their final keys with no local-disk hop.
  const organized = await organize({
    releaseName: dl.releaseName,
    kind: dl.kind as MediaKind,
    title: dl.title,
    year: dl.year,
    season: dl.season,
    episode: dl.episode,
  });
  const keyPrefix = [cfg.s3.basePrefix, organized.s3Prefix].filter(Boolean).join("/");
  const s3 = makeS3(cfg.s3);
  const emitUpload = throttle((uploadedBytes: number, total: number) => {
    const pct = total > 0 ? (uploadedBytes / total) * 100 : 0;
    void prisma.download.update({ where: { id }, data: { progress: pct } }).catch(() => {});
    void publishProgress({ type: "progress", downloadId: id, status: "UPLOADING", progress: pct });
  }, 1000);

  let uploaded: { keys: string[]; bytes: number; primaryKey: string } | null = null;
  let cleanup: () => Promise<void> = async () => {};

  // Provider: TorBox first — stream its HTTP files DIRECTLY into S3 (no local
  // disk, so a big or stuck download can never fill the host). Then qBittorrent.
  if (cfg.torbox.apiKey && /^(magnet:|https?:)/i.test(dl.magnet)) {
    uploaded = await streamTorboxToS3(
      id,
      { magnet: dl.magnet, title: dl.title, season: dl.season, episode: dl.episode },
      cfg,
      { s3, bucket: cfg.s3.bucket, keyPrefix, onProgress: emitUpload },
    ).catch((e) => {
      console.error("[torbox]", (e as Error).message);
      return null;
    });
  }

  // Fallback: qBittorrent → local staging dir → uploadContent → delete local.
  if (!uploaded) {
    if (!qb) throw new Error("qBittorrent is not configured (see Settings)");
    await qb.ensureCategory(CATEGORY);

    // Find the torrent by info-hash (survives qBittorrent's dedup, which keeps the
    // original tag) or by tag; add it only if genuinely absent.
    const expectedHash =
      dl.infoHash ?? (dl.magnet.startsWith("magnet:") ? parseInfoHash(dl.magnet) : undefined);
    // The info-hash is identity (trust it). A tag lookup is only trusted when the
    // torrent it returns really is this release — prevents binding to a sibling
    // under concurrent adds and self-heals a row cross-linked to the wrong hash.
    let info = expectedHash ? await qb.getByHash(expectedHash) : undefined;
    if (!info) {
      const tagged = await qb.getByTag(id);
      if (tagged && torrentMatchesRelease(tagged.name, dl.releaseName)) info = tagged;
    }
    if (!info) {
      const isMagnet = dl.magnet.startsWith("magnet:");
      const beforeHashes = await categoryHashes(qb);
      await qb.addTorrent({
        magnet: isMagnet ? dl.magnet : undefined,
        torrentUrl: isMagnet ? undefined : dl.magnet,
        savePath: cfg.prefs.downloadDir,
        category: CATEGORY,
        tag: id,
      });
      info = await waitForTorrent(qb, id, expectedHash, dl.releaseName, beforeHashes, REGISTER_TIMEOUT_MS);
    }
    if (!info) throw new Error("Torrent failed to register in qBittorrent");

    await prisma.download.update({ where: { id }, data: { qbitHash: info.hash } });

    // Download, auto-switching source if a torrent stalls for STALL_MS.
    info = await downloadWithReSource(qb, id, info, cfg);
    const contentPath = info.content_path || path.join(info.save_path, info.name);
    const hash = info.hash;
    cleanup = async () => {
      if (cfg.prefs.deleteAfterUpload) await qb.delete([hash], true).catch(() => {});
    };

    await setStatus(id, "UPLOADING", 0);
    void logActivity(`Uploading ${dl.title}${epTag(dl.season, dl.episode)} to S3…`, {
      kind: "upload",
      title: dl.title,
    });
    uploaded = await uploadContent({
      s3,
      bucket: cfg.s3.bucket,
      contentPath,
      keyPrefix,
      onProgress: emitUpload,
    });
  }

  if (!uploaded || !uploaded.keys.length) throw new Error("Download produced no files");
  const meta = await enrich(
    cfg.tmdb.apiKey,
    organized.kind,
    organized.cleanTitle,
    organized.year ?? dl.year,
  );
  const { primaryKey, bytes, keys } = uploaded;

  await prisma.download.update({
    where: { id },
    data: {
      status: "COMPLETED",
      progress: 100,
      s3Bucket: cfg.s3.bucket,
      s3Key: primaryKey,
      s3Prefix: organized.s3Prefix,
      metadata: { s3Keys: keys }, // exact objects to delete if this download is removed
      kind: organized.kind,
      title: organized.cleanTitle,
      year: organized.year ?? dl.year,
      season: organized.season ?? dl.season,
      episode: organized.episode ?? dl.episode,
      posterUrl: meta?.posterUrl ?? dl.posterUrl,
      overview: meta?.overview ?? dl.overview,
      tmdbId: meta?.tmdbId ?? dl.tmdbId,
      sizeBytes: BigInt(Math.max(0, Math.round(bytes || Number(dl.sizeBytes)))),
      completedAt: new Date(),
    },
  });
  await publishProgress({ type: "status", downloadId: id, status: "COMPLETED", progress: 100 });
  void pokeJellyfinScan(cfg); // index the new file in Jellyfin promptly
  const seLabel =
    organized.season != null
      ? ` S${String(organized.season).padStart(2, "0")}${organized.episode != null ? `E${String(organized.episode).padStart(2, "0")}` : ""}`
      : "";
  {
    const doneText = `🍿 Ready to watch\n${organized.cleanTitle}${seLabel}`;
    const doneOpts = {
      photo: meta?.posterUrl ?? dl.posterUrl ?? undefined,
      buttons: [{ text: "▶️ Open your library", path: "/library" }],
    };
    // Notify the member AND mirror to the admin's activity feed.
    await notifyActivity(dl.userId, doneText, doneOpts);
  }
  void logActivity(`✓ ${organized.cleanTitle}${seLabel} added to your library`, {
    kind: "done",
    title: organized.cleanTitle,
  });

  if (qb) await dedupeCompletedEpisode(qb, id);
  await cleanup();
}

/**
 * Once an episode completes, remove any leftover FAILED/CANCELLED sibling rows for
 * the same episode (and their dead torrents). Fixes the case where a duplicate had
 * failed in the UI while another copy actually finished — leaving a stale "failed"
 * row that, if retried, just re-queued a download of something already downloaded.
 */
async function dedupeCompletedEpisode(qb: QbClient, completedId: string): Promise<void> {
  try {
    const done = await prisma.download.findUnique({ where: { id: completedId } });
    if (!done || done.season == null || done.episode == null) return;
    const sibs = await prisma.download.findMany({
      where: {
        id: { not: completedId },
        season: done.season,
        episode: done.episode,
        status: { in: ["FAILED", "CANCELLED"] },
        OR: [
          ...(done.tmdbId ? [{ tmdbId: done.tmdbId }] : []),
          { title: { equals: done.title, mode: "insensitive" as const } },
        ],
      },
      select: { id: true, qbitHash: true },
    });
    if (sibs.length === 0) return;
    for (const s of sibs) {
      if (s.qbitHash) await qb.delete([s.qbitHash], true).catch(() => {});
      await publishProgress({ type: "deleted", downloadId: s.id });
    }
    await prisma.download.deleteMany({ where: { id: { in: sibs.map((s) => s.id) } } });
  } catch {
    /* best-effort */
  }
}

const MAINTENANCE: Record<string, () => Promise<unknown>> = {
  "recover-stuck": recoverStuckDownloads,
  "retry-failed": retryFailed,
  "watch-scan": scanWatches,
  "follow-scan": scanFollowedShows,
  "season-progress": advanceSeasons,
  "reco-refresh": refreshRecommendations,
  "auto-follow": autoFollowFromJellyfin,
  "wanted-scan": scanWantedMovies,
  retention: runRetention,
};

// Transfer worker: only the actual downloads (qBittorrent → S3). Kept on its own
// pool so a burst of these long jobs can't starve searches/new grabs.
const worker = new Worker<DownloadJobData>(
  DOWNLOAD_QUEUE,
  async (job: Job<DownloadJobData>) => {
    const { downloadId } = job.data;
    try {
      await processDownload(downloadId);
    } catch (e) {
      const message = (e as Error).message ?? "Unknown error";
      console.error(`[worker] download ${downloadId} failed:`, message);
      await prisma.download
        .update({ where: { id: downloadId }, data: { status: "FAILED", error: message } })
        .catch(() => {});
      await publishProgress({ type: "status", downloadId, status: "FAILED", message });
      // Remember this source failed so no future grab re-picks it (survives deletion).
      await recordDownloadFailure(downloadId).catch(() => {});
      // Remove the dead torrent from qBittorrent so its state matches the app.
      try {
        const row = await prisma.download.findUnique({
          where: { id: downloadId },
          select: { qbitHash: true },
        });
        const cfg = await getConfig();
        if (row?.qbitHash && cfg.qbit.url) {
          await new QbClient(cfg.qbit).delete([row.qbitHash], true).catch(() => {});
        }
      } catch {
        /* best-effort */
      }
      // Swallow so BullMQ does not auto-retry config errors; user retries via UI.
    }
  },
  {
    connection: createRedis(),
    concurrency: DOWNLOAD_CONCURRENCY,
    // A killed worker's in-flight jobs stall and are re-run on restart; allow
    // several stalls so repeated redeploys mid-download don't fail the job.
    stalledInterval: 30_000,
    maxStalledCount: 5,
  },
);

// Grab worker: season/episode searches + maintenance. Short jobs on a separate
// pool, so the agent is always ready to queue more even while downloads run.
const grabWorker = new Worker<DownloadJobData>(
  GRAB_QUEUE,
  async (job: Job<DownloadJobData>) => {
    const maintenance = MAINTENANCE[job.name];
    if (maintenance) {
      try {
        const s = await maintenance();
        console.log(`[grab] ${job.name}: ${JSON.stringify(s)}`);
      } catch (e) {
        console.error(`[grab] ${job.name} error:`, (e as Error).message);
      }
      return;
    }
    // Season grab: plan the season and fan out one short episode-grab job each,
    // so this job returns fast and never holds a slot for the whole season.
    if (job.name === "season-grab" && job.data.seasonGrab) {
      const g = job.data.seasonGrab;
      void logActivity(`Grabbing Season ${g.season} of ${g.title}`, { kind: "info", title: g.title });
      try {
        const r = await grabSeason({
          tmdbId: g.tmdbId,
          title: g.title,
          season: g.season,
          year: g.year,
          indexerIds: g.indexerIds,
          notify: g.notify,
          userId: g.userId,
        });
        console.log(`[grab] season-grab ${g.title} S${g.season}: ${JSON.stringify(r)}`);
        if (r.queued > 0) {
          const what = r.mode === "pack" ? "the full season" : `${r.queued} episode${r.queued === 1 ? "" : "s"}`;
          const text = `📥 Adding ${g.title} — Season ${g.season} to your library (${what}).`;
          const opts = { buttons: [{ text: "📚 Open your library", path: "/library" }] };
          await notifyActivity(g.userId, text, opts);
        }
      } catch (e) {
        console.error(`[grab] season-grab ${g.title} S${g.season} failed:`, (e as Error).message);
      }
      return;
    }
    if (job.name === "episode-grab" && job.data.episodeGrab) {
      const ep = job.data.episodeGrab;
      try {
        await runEpisodeGrab(ep);
      } catch (e) {
        console.error(`[grab] episode-grab ${ep.title} S${ep.season}E${ep.episode} failed:`, (e as Error).message);
      }
      return;
    }
  },
  {
    connection: createRedis(),
    concurrency: GRAB_CONCURRENCY,
    stalledInterval: 30_000,
    maxStalledCount: 5,
  },
);

/**
 * On startup, re-queue any downloads the DB still thinks are in progress. A
 * deploy/restart kills the worker mid-download or mid-upload, leaving them
 * stranded; this resumes them (idempotent — the torrent is found by hash/tag).
 */
async function recoverInterrupted(): Promise<void> {
  try {
    const stuck = await prisma.download.findMany({
      where: { status: { in: ["QUEUED", "SEARCHING", "DOWNLOADING", "UPLOADING"] } },
      select: { id: true },
    });
    for (const d of stuck) await enqueueDownload(d.id);
    if (stuck.length) {
      console.log(`[worker] re-queued ${stuck.length} interrupted download(s) after restart`);
    }
  } catch (e) {
    console.error("[worker] recovery failed:", (e as Error).message);
  }
}

/**
 * Disable qBittorrent's own download queue so it downloads everything we add — the
 * worker (DOWNLOAD_CONCURRENCY) is the single limiter. Otherwise qBit parks extra
 * torrents as "queued" (0 speed), which the stall detector would mistake for dead
 * sources and fail — the cause of a big overnight batch all failing.
 */
async function configureQbittorrent(): Promise<void> {
  try {
    const cfg = await getConfig();
    if (!cfg.qbit.url) return;
    const qb = new QbClient(cfg.qbit);
    await qb.ensureCategory(CATEGORY);
    const trackers = resolveExtraTrackers();
    await qb.setPreferences({
      queueing_enabled: false,
      add_trackers_enabled: trackers.length > 0,
      add_trackers: trackers.join("\n"),
    });
    console.log(
      `[worker] qBittorrent: queueing off; ${trackers.length} public trackers appended to new torrents`,
    );
  } catch (e) {
    console.error("[worker] qBittorrent prefs setup failed:", (e as Error).message);
  }
}

worker.on("ready", () => {
  console.log(`[worker] ready — downloads×${DOWNLOAD_CONCURRENCY}, grabs×${GRAB_CONCURRENCY}`);
  // Seed the bootstrap admin + adopt any legacy ownerless rows before scans run.
  void ensureBootstrapAdmin()
    .then(() => console.log("[worker] bootstrap admin ensured"))
    .catch((e) => console.error("[worker] bootstrap admin failed:", (e as Error).message));
  void configureQbittorrent();
  void recoverInterrupted();
  void schedulePeriodicJobs()
    .then(() => console.log("[worker] periodic jobs scheduled (scan, follows, reco, retention)"))
    .catch(() => {});
  startTelegramBot();
  console.log("[worker] telegram bot poller started");
});
worker.on("error", (err) => console.error("[worker] error:", err));
grabWorker.on("error", (err) => console.error("[grab] error:", err));

async function shutdown() {
  console.log("[worker] shutting down…");
  await Promise.allSettled([worker.close(), grabWorker.close()]);
  await prisma.$disconnect();
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
