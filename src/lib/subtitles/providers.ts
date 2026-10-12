/**
 * Subtitle sources. Two independent providers, both free-tier:
 *
 *  - SubDL — generous daily quota, so it carries the bulk backfill. Serves .zip
 *    archives (sometimes a whole-season pack, hence the entry picking).
 *  - OpenSubtitles.com (REST v1) — the best catalogue and matching, but a small
 *    daily download quota (much larger when a username/password is configured),
 *    so it's the second opinion rather than the workhorse.
 *
 * Each provider self-limits (min interval between calls) and self-disables for a
 * cooldown when the API says the quota is spent, so a sweep can never hammer
 * them or get the key banned.
 */
import { normalizeSubtitle, subExtOf, type SubExt } from "./text";
import { pickEntry, releaseAffinity } from "./match";
import { langNames } from "./langs";
import { unzip } from "./zip";
import type { ResolvedConfig } from "../config";

/** OpenSubtitles requires "AppName vX.Y.Z" — an unregistered/garbled UA gets 4xx. */
const USER_AGENT = "MovieHub v0.1.0";

export interface SubtitleQuery {
  kind: "MOVIE" | "TV";
  title: string;
  year: number | null;
  /** Movie: the movie's TMDB id. TV: the SERIES TMDB id (what we store on rows). */
  tmdbId: number | null;
  season: number | null;
  episode: number | null;
  /** Basename of the stored video — drives release affinity (i.e. sync quality). */
  videoName: string;
  /** One language per query, lowercase ISO-639-1 (optionally regional: "pt-br"). */
  lang: string;
  hearingImpaired: boolean;
}

export interface SubtitleResult {
  provider: string;
  ext: SubExt;
  /** Normalised UTF-8 subtitle text, ready to store. */
  text: string;
  release: string;
}

export interface SubtitleProvider {
  readonly name: string;
  /** Find + download the best subtitle for one video in one language. */
  find(q: SubtitleQuery): Promise<SubtitleResult | null>;
  /** True while cooling off (quota spent, rate-limited, or a rejected key). */
  blocked(): boolean;
  /** Milliseconds until this provider is usable again (0 when it already is). */
  cooldownMs(): number;
  /** Search-only credential check for the Settings "Test" button (spends no download quota). */
  probe(): Promise<{ ok: boolean; message: string }>;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Cooldowns and pacing are per PROVIDER, not per object: a provider is rebuilt
 * for every sweep and every finished download, and a spent daily quota must stay
 * spent instead of being rediscovered (at the cost of a request) each time.
 */
const cooldownUntil = new Map<string, number>();
const lastCallAt = new Map<string, number>();

/** Shared per-provider pacing + cooldown bookkeeping. */
abstract class BaseProvider implements SubtitleProvider {
  abstract readonly name: string;
  protected abstract readonly minIntervalMs: number;

  blocked(): boolean {
    return this.cooldownMs() > 0;
  }

  cooldownMs(): number {
    return Math.max(0, (cooldownUntil.get(this.name) ?? 0) - Date.now());
  }

  protected block(ms: number, why: string): void {
    const until = Math.max(cooldownUntil.get(this.name) ?? 0, Date.now() + ms);
    cooldownUntil.set(this.name, until);
    console.log(`[subs] ${this.name} backing off ~${Math.round(ms / 60000)}m — ${why}`);
  }

  /** Space out calls so we stay well inside each provider's rate limit. */
  protected async pace(): Promise<void> {
    const wait = (lastCallAt.get(this.name) ?? 0) + this.minIntervalMs - Date.now();
    if (wait > 0) await sleep(wait);
    lastCallAt.set(this.name, Date.now());
  }

  abstract find(q: SubtitleQuery): Promise<SubtitleResult | null>;
  abstract probe(): Promise<{ ok: boolean; message: string }>;
}

/** Candidate ranking shared by both providers: best release match first. */
interface Candidate<T> {
  raw: T;
  score: number;
  release: string;
}

function byScore<T>(a: Candidate<T>, b: Candidate<T>): number {
  return b.score - a.score;
}

/** Inception — a title every provider has, used for the search-only key check. */
const PROBE_TMDB_ID = 27205;

function probeQuery(): SubtitleQuery {
  return {
    kind: "MOVIE",
    title: "Inception",
    year: 2010,
    tmdbId: PROBE_TMDB_ID,
    season: null,
    episode: null,
    videoName: "Inception.2010.1080p.BluRay.x264.mkv",
    lang: "en",
    hearingImpaired: false,
  };
}

/** How many candidates we'll actually download before giving up on a query. */
const MAX_TRIES = 3;

interface Fetched {
  /** 0 when the request never completed. */
  status: number;
  body: Buffer | null;
  /** Error body (truncated), so a refusal can be told apart from a dead link. */
  text: string | null;
}

/**
 * Fetch a subtitle file. Returns the status as well as the bytes: these sites
 * enforce their daily cap on the DOWNLOAD host, so "no bytes" has to be
 * distinguishable from "quota spent" — treating the latter as a miss is what
 * marked a whole library as having no subtitles available.
 */
async function getBytes(url: string, headers?: Record<string, string>): Promise<Fetched> {
  const res = await fetch(url, {
    headers: { "User-Agent": USER_AGENT, ...headers },
    signal: AbortSignal.timeout(30_000),
  }).catch(() => null);
  if (!res) return { status: 0, body: null, text: null };
  if (!res.ok) {
    const text = await res.text().catch(() => null);
    return { status: res.status, body: null, text: text?.slice(0, 400) ?? null };
  }
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > 8 * 1024 * 1024) return { status: res.status, body: null, text: null };
  return { status: res.status, body: Buffer.from(await res.arrayBuffer()), text: null };
}

/** Turn a downloaded archive-or-file body into a validated subtitle. */
function extractSubtitle(
  body: Buffer,
  sourceName: string,
  q: SubtitleQuery,
): { ext: SubExt; text: string } | null {
  const direct = subExtOf(sourceName);
  // A bare subtitle file (no archive) — keep its own extension.
  if (direct && !/^PK\x03\x04/.test(body.subarray(0, 4).toString("latin1"))) {
    const text = normalizeSubtitle(body, direct, q.lang);
    return text ? { ext: direct, text } : null;
  }
  const picked = pickEntry(unzip(body), { season: q.season, episode: q.episode });
  if (!picked) return null;
  const text = normalizeSubtitle(picked.entry.data, picked.ext, q.lang);
  return text ? { ext: picked.ext, text } : null;
}

// ───────────────────────────── SubDL ──────────────────────────────

interface SubdlItem {
  release_name?: string;
  name?: string;
  lang?: string;
  language?: string;
  author?: string;
  url?: string;
  download_link?: string;
  season?: number | null;
  episode?: number | null;
  full_season?: boolean;
  hi?: boolean;
}

interface SubdlResponse {
  status?: boolean;
  error?: string;
  subtitles?: SubdlItem[];
}

export class SubdlProvider extends BaseProvider {
  readonly name = "subdl";
  protected readonly minIntervalMs = 400;
  private readonly apiKey: string;

  constructor(apiKey: string) {
    super();
    this.apiKey = apiKey;
  }

  private langOk(item: SubdlItem, lang: string): boolean {
    const got = (item.lang ?? item.language ?? "").toLowerCase().trim();
    if (!got) return true; // nothing to check — we filtered server-side
    const names = langNames(lang);
    if (!names) return true; // unmapped language: trust the server-side filter
    return names.some((n) => got.includes(n) || n.includes(got));
  }

  private async search(q: SubtitleQuery): Promise<SubdlItem[]> {
    const p = new URLSearchParams({
      api_key: this.apiKey,
      languages: q.lang.toUpperCase(),
      subs_per_page: "30",
      type: q.kind === "TV" ? "tv" : "movie",
      client: "moviehub",
    });
    if (q.tmdbId) p.set("tmdb_id", String(q.tmdbId));
    else p.set("film_name", q.title);
    if (q.kind === "TV") {
      if (q.season != null) p.set("season_number", String(q.season));
      if (q.episode != null) p.set("episode_number", String(q.episode));
      p.set("full_season", "1"); // let season packs through as a fallback
    } else if (q.year) {
      p.set("year", String(q.year));
    }

    await this.pace();
    const res = await fetch(`https://api.subdl.com/api/v1/subtitles?${p}`, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    if (!res) return [];
    if (res.status === 429) {
      this.block(30 * 60_000, "rate limited (429)");
      return [];
    }
    if (res.status === 401 || res.status === 403) {
      this.block(12 * 3600_000, `API key rejected (${res.status})`);
      return [];
    }
    if (!res.ok) return [];
    const json = (await res.json().catch(() => null)) as SubdlResponse | null;
    if (!json) return [];
    if (json.error && /quota|limit/i.test(json.error)) {
      this.block(6 * 3600_000, json.error);
      return [];
    }
    return Array.isArray(json.subtitles) ? json.subtitles : [];
  }

  /**
   * Note a refused subtitle download. SubDL's free tier allows 50 downloads a
   * day and enforces it on dl.subdl.com with a 429 + `retryAfterSeconds`, while
   * search keeps working — so this is the only place the cap shows up. Returns
   * true when the provider has been put on cooldown.
   */
  private noteRefusal(res: Fetched): boolean {
    if (res.status !== 429 && res.status !== 403) return false;
    let seconds = 0;
    let why = `download refused (${res.status})`;
    try {
      const j = JSON.parse(res.text ?? "{}") as {
        error?: string;
        message?: string;
        retryAfterSeconds?: number;
      };
      if (typeof j.retryAfterSeconds === "number") seconds = j.retryAfterSeconds;
      why = j.message ?? j.error ?? why;
    } catch {
      /* not JSON — fall back to a plain cooldown */
    }
    const ms = Math.min(Math.max(seconds * 1000, 15 * 60_000), 25 * 3600_000);
    this.block(ms, why);
    return true;
  }

  async probe(): Promise<{ ok: boolean; message: string }> {
    const items = await this.search(probeQuery());
    if (this.blocked()) return { ok: false, message: "SubDL: key rejected or rate-limited" };
    return items.length
      ? { ok: true, message: `SubDL OK (${items.length} results)` }
      : { ok: false, message: "SubDL returned nothing — check the API key" };
  }

  async find(q: SubtitleQuery): Promise<SubtitleResult | null> {
    if (this.blocked()) return null;
    const items = await this.search(q);
    const candidates: Candidate<SubdlItem>[] = [];
    for (const it of items) {
      if (!it.url && !it.download_link) continue;
      if (!this.langOk(it, q.lang)) continue;
      const release = it.release_name || it.name || "";
      let score = releaseAffinity(q.videoName, release) * 3;
      if (q.episode != null) {
        // An item tagged with exactly this episode beats a whole-season pack.
        if (it.episode === q.episode && (it.season == null || it.season === q.season)) score += 2;
        else if (it.full_season) score += 0.4;
        else if (it.episode != null) continue; // tagged as a different episode
      }
      if (it.hi === true && !q.hearingImpaired) score -= 1;
      if (it.hi !== true && q.hearingImpaired) score -= 0.5;
      if (it.author) score += 0.1;
      candidates.push({ raw: it, score, release });
    }
    candidates.sort(byScore);

    for (const c of candidates.slice(0, MAX_TRIES)) {
      if (this.blocked()) break;
      const link =
        c.raw.download_link && /^https?:\/\//i.test(c.raw.download_link)
          ? c.raw.download_link
          : /^https?:\/\//i.test(c.raw.url ?? "")
            ? (c.raw.url as string)
            : `https://dl.subdl.com${c.raw.url}`;
      await this.pace();
      const dl = await getBytes(link);
      if (!dl.body) {
        // A refused download is about the ACCOUNT, not this subtitle — stop
        // asking, so the sweep sees the provider as unavailable and defers.
        if (this.noteRefusal(dl)) break;
        continue;
      }
      const got = extractSubtitle(dl.body, c.raw.url ?? c.raw.name ?? "sub.zip", q);
      if (got) return { provider: this.name, ext: got.ext, text: got.text, release: c.release };
    }
    return null;
  }
}

// ──────────────────────── OpenSubtitles.com ────────────────────────

interface OsFile {
  file_id?: number;
  file_name?: string;
}
interface OsAttributes {
  language?: string;
  download_count?: number;
  hearing_impaired?: boolean;
  from_trusted?: boolean;
  foreign_parts_only?: boolean;
  ai_translated?: boolean;
  machine_translated?: boolean;
  release?: string;
  files?: OsFile[];
}
interface OsSearchResponse {
  data?: { attributes?: OsAttributes }[];
}
interface OsDownloadResponse {
  link?: string;
  file_name?: string;
  remaining?: number;
  message?: string;
  reset_time_utc?: string;
}

interface OsSession {
  baseUrl: string;
  token: string | null;
  tokenAt: number;
}
const OS_DEFAULT_BASE = "https://api.opensubtitles.com/api/v1";
/** One session per configured account (keyed by username; "anonymous" otherwise). */
const osSessions = new Map<string, OsSession>();

export class OpenSubtitlesProvider extends BaseProvider {
  readonly name = "opensubtitles";
  protected readonly minIntervalMs = 300; // their documented ceiling is ~5 req/s
  private readonly apiKey: string;
  private readonly username?: string;
  private readonly password?: string;

  constructor(cfg: { apiKey: string; username?: string; password?: string }) {
    super();
    this.apiKey = cfg.apiKey;
    this.username = cfg.username;
    this.password = cfg.password;
  }

  /** Auth tokens last 24h — keep them across provider instances. */
  private get session(): OsSession {
    const key = this.username ?? "anonymous";
    let s = osSessions.get(key);
    if (!s) {
      s = { baseUrl: OS_DEFAULT_BASE, token: null, tokenAt: 0 };
      osSessions.set(key, s);
    }
    return s;
  }

  private get baseUrl(): string {
    return this.session.baseUrl;
  }

  private get token(): string | null {
    return this.session.token;
  }

  private headers(): Record<string, string> {
    return {
      Accept: "application/json",
      "Content-Type": "application/json",
      "Api-Key": this.apiKey,
      "User-Agent": USER_AGENT,
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
    };
  }

  /**
   * Log in when credentials are configured: an authenticated account's download
   * quota is far larger than the anonymous per-IP one. Tokens last 24h.
   */
  private async login(): Promise<void> {
    if (!this.username || !this.password) return;
    const session = this.session;
    if (session.token && Date.now() - session.tokenAt < 23 * 3600_000) return;
    await this.pace();
    const res = await fetch(`${this.baseUrl}/login`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ username: this.username, password: this.password }),
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    if (!res || !res.ok) {
      if (res && (res.status === 401 || res.status === 403)) {
        console.log(`[subs] opensubtitles login rejected (${res.status}) — continuing anonymously`);
      }
      return;
    }
    const json = (await res.json().catch(() => null)) as
      | { token?: string; base_url?: string }
      | null;
    if (!json?.token) return;
    session.token = json.token;
    session.tokenAt = Date.now();
    // VIP accounts are served from their own host; honour whatever login returns.
    if (json.base_url) {
      session.baseUrl = `https://${json.base_url.replace(/^https?:\/\//, "")}/api/v1`;
    }
  }

  private async search(q: SubtitleQuery, byId: boolean): Promise<OsAttributes[]> {
    const p = new URLSearchParams({
      languages: q.lang,
      order_by: "download_count",
      order_direction: "desc",
      machine_translated: "exclude",
      hearing_impaired: q.hearingImpaired ? "include" : "exclude",
      type: q.kind === "TV" ? "episode" : "movie",
    });
    if (byId) {
      if (!q.tmdbId) return [];
      if (q.kind === "TV") p.set("parent_tmdb_id", String(q.tmdbId));
      else p.set("tmdb_id", String(q.tmdbId));
    } else {
      p.set("query", q.title);
      if (q.kind === "MOVIE" && q.year) p.set("year", String(q.year));
    }
    if (q.kind === "TV") {
      if (q.season != null) p.set("season_number", String(q.season));
      if (q.episode != null) p.set("episode_number", String(q.episode));
    }
    // Their cache keys on the exact query string — sorted params improve hit rate.
    const sorted = [...p.entries()].sort(([a], [b]) => a.localeCompare(b));
    const qs = new URLSearchParams(sorted).toString();

    await this.pace();
    const res = await fetch(`${this.baseUrl}/subtitles?${qs}`, {
      headers: this.headers(),
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    if (!res) return [];
    if (res.status === 429) {
      this.block(10 * 60_000, "rate limited (429)");
      return [];
    }
    if (res.status === 401 || res.status === 403) {
      this.session.token = null;
      this.block(6 * 3600_000, `rejected (${res.status}) — check the API key`);
      return [];
    }
    if (!res.ok) return [];
    const json = (await res.json().catch(() => null)) as OsSearchResponse | null;
    return (json?.data ?? []).map((d) => d.attributes ?? {}).filter((a) => a.files?.length);
  }

  /** Resolve a file_id to a download link, honouring the quota the API reports. */
  private async link(fileId: number): Promise<{ url: string; name: string } | null> {
    await this.pace();
    const res = await fetch(`${this.baseUrl}/download`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({ file_id: fileId, sub_format: "srt" }),
      signal: AbortSignal.timeout(20_000),
    }).catch(() => null);
    if (!res) return null;
    const json = (await res.json().catch(() => null)) as OsDownloadResponse | null;
    if (res.status === 406 || res.status === 429) {
      const reset = json?.reset_time_utc ? Date.parse(json.reset_time_utc) - Date.now() : NaN;
      this.block(
        Number.isFinite(reset) && reset > 0 ? Math.min(reset + 60_000, 25 * 3600_000) : 6 * 3600_000,
        json?.message ?? `download quota (${res.status})`,
      );
      return null;
    }
    if (!res.ok || !json?.link) return null;
    // Quota just ran out — don't start another query this sweep.
    if (typeof json.remaining === "number" && json.remaining <= 0) {
      const reset = json.reset_time_utc ? Date.parse(json.reset_time_utc) - Date.now() : NaN;
      this.block(
        Number.isFinite(reset) && reset > 0 ? Math.min(reset + 60_000, 25 * 3600_000) : 6 * 3600_000,
        "daily download quota reached",
      );
    }
    return { url: json.link, name: json.file_name ?? "subtitle.srt" };
  }

  async probe(): Promise<{ ok: boolean; message: string }> {
    await this.login();
    const rows = await this.search(probeQuery(), true);
    if (this.blocked()) return { ok: false, message: "OpenSubtitles: key rejected or rate-limited" };
    if (!rows.length) return { ok: false, message: "OpenSubtitles returned nothing — check the API key" };
    let quota = "";
    if (this.token) {
      await this.pace();
      const res = await fetch(`${this.baseUrl}/infos/user`, {
        headers: this.headers(),
        signal: AbortSignal.timeout(15_000),
      }).catch(() => null);
      const json = res?.ok
        ? ((await res.json().catch(() => null)) as {
            data?: { remaining_downloads?: number; allowed_downloads?: number; vip?: boolean };
          } | null)
        : null;
      const d = json?.data;
      if (d) {
        quota = `, ${d.remaining_downloads ?? "?"}/${d.allowed_downloads ?? "?"} downloads left today${d.vip ? " (VIP)" : ""}`;
      }
    } else {
      quota = ", anonymous (add a username + password for a much larger daily quota)";
    }
    return { ok: true, message: `OpenSubtitles OK${quota}` };
  }

  async find(q: SubtitleQuery): Promise<SubtitleResult | null> {
    if (this.blocked()) return null;
    await this.login();
    let rows = await this.search(q, true);
    if (!rows.length && !this.blocked()) rows = await this.search(q, false);

    const base = q.lang.split("-")[0];
    const candidates: Candidate<OsAttributes>[] = [];
    for (const a of rows) {
      const got = (a.language ?? "").toLowerCase();
      if (got && !got.startsWith(base)) continue;
      const release = a.release ?? "";
      let score = releaseAffinity(q.videoName, release) * 4;
      score += Math.log10((a.download_count ?? 0) + 1) * 0.3;
      if (a.from_trusted) score += 0.5;
      if (a.ai_translated || a.machine_translated) score -= 1.5;
      if (a.foreign_parts_only) score -= 2; // only covers non-native dialogue
      if (a.hearing_impaired && !q.hearingImpaired) score -= 0.4;
      candidates.push({ raw: a, score, release });
    }
    candidates.sort(byScore);

    for (const c of candidates.slice(0, MAX_TRIES)) {
      if (this.blocked()) break;
      const fileId = c.raw.files?.[0]?.file_id;
      if (!fileId) continue;
      const dl = await this.link(fileId);
      if (!dl) continue;
      const file = await getBytes(dl.url);
      if (!file.body) continue;
      const got = extractSubtitle(file.body, dl.name, q);
      if (got) return { provider: this.name, ext: got.ext, text: got.text, release: c.release };
    }
    return null;
  }
}

/**
 * Build the provider chain for the current config, in the order they're tried.
 * SubDL leads because its quota can absorb a whole-library backfill;
 * OpenSubtitles follows for anything SubDL doesn't have.
 */
export function buildProviders(cfg: ResolvedConfig): SubtitleProvider[] {
  const out: SubtitleProvider[] = [];
  if (cfg.subtitles.subdlApiKey) out.push(new SubdlProvider(cfg.subtitles.subdlApiKey));
  if (cfg.subtitles.osApiKey) {
    out.push(
      new OpenSubtitlesProvider({
        apiKey: cfg.subtitles.osApiKey,
        username: cfg.subtitles.osUsername,
        password: cfg.subtitles.osPassword,
      }),
    );
  }
  return out;
}
