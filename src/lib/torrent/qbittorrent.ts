/**
 * Minimal qBittorrent Web API (v2) client.
 * Auth via SID cookie; sets Referer/Origin to satisfy qBittorrent CSRF checks.
 */
export interface QbTorrentInfo {
  hash: string;
  name: string;
  size: number;
  progress: number; // 0..1
  dlspeed: number;
  upspeed: number;
  eta: number;
  num_seeds: number;
  num_leechs: number;
  state: string;
  save_path: string;
  content_path: string;
  completed: number;
  amount_left: number;
}

export interface QbConfig {
  url?: string;
  user?: string;
  password?: string;
}

export class QbClient {
  private base: string;
  private user: string;
  private pass: string;
  private sid?: string;

  constructor(cfg: QbConfig) {
    if (!cfg.url) throw new Error("qBittorrent URL is not configured");
    this.base = cfg.url.replace(/\/$/, "");
    this.user = cfg.user ?? "";
    this.pass = cfg.password ?? "";
  }

  private origin(): string {
    try {
      return new URL(this.base).origin;
    } catch {
      return this.base;
    }
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = {
      Referer: this.base,
      Origin: this.origin(),
      ...extra,
    };
    if (this.sid) h["Cookie"] = `SID=${this.sid}`;
    return h;
  }

  async login(): Promise<void> {
    const body = new URLSearchParams({ username: this.user, password: this.pass });
    const res = await fetch(`${this.base}/api/v2/auth/login`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/x-www-form-urlencoded" }),
      body,
    });
    const text = (await res.text()).trim();

    // Capture the session cookie if one was issued.
    const setCookies =
      typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    const raw = setCookies.join("; ") || res.headers.get("set-cookie") || "";
    const m = raw.match(/SID=([^;]+)/);
    if (m) this.sid = m[1];

    // qBittorrent returns 200 "Ok." (classic) or 204 No Content (newer builds) on
    // success; only a "Fails." body or a non-2xx status is a real auth failure.
    if (text === "Fails." || !res.ok) {
      throw new Error(
        `qBittorrent login failed: ${res.status} ${text || "(check username/password)"}`,
      );
    }
  }

  private async ensureAuth(): Promise<void> {
    if (!this.sid && this.user) await this.login();
  }

  async ensureCategory(category: string): Promise<void> {
    await this.ensureAuth();
    const body = new URLSearchParams({ category, savePath: "" });
    await fetch(`${this.base}/api/v2/torrents/createCategory`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/x-www-form-urlencoded" }),
      body,
    }).catch(() => {
      /* category may already exist */
    });
  }

  async addTorrent(opts: {
    magnet?: string;
    torrentUrl?: string;
    savePath: string;
    category?: string;
    tag?: string;
    paused?: boolean;
  }): Promise<void> {
    await this.ensureAuth();
    const source = opts.magnet ?? opts.torrentUrl;
    if (!source) throw new Error("addTorrent requires a magnet or torrent URL");

    const form = new FormData();
    form.set("urls", source);
    form.set("savepath", opts.savePath);
    form.set("autoTMM", "false");
    form.set("paused", opts.paused ? "true" : "false");
    if (opts.category) form.set("category", opts.category);
    if (opts.tag) form.set("tags", opts.tag);

    const res = await fetch(`${this.base}/api/v2/torrents/add`, {
      method: "POST",
      headers: this.headers(),
      body: form,
    });
    const text = (await res.text()).trim();
    if (!res.ok || (text && text !== "Ok.")) {
      throw new Error(`qBittorrent add failed: ${res.status} ${text}`);
    }
  }

  private async info(params: Record<string, string>): Promise<QbTorrentInfo[]> {
    await this.ensureAuth();
    const qs = new URLSearchParams(params).toString();
    const res = await fetch(`${this.base}/api/v2/torrents/info?${qs}`, {
      headers: this.headers(),
    });
    if (res.status === 403) {
      // Session expired — re-login once.
      this.sid = undefined;
      await this.login();
      const retry = await fetch(`${this.base}/api/v2/torrents/info?${qs}`, {
        headers: this.headers(),
      });
      if (!retry.ok) throw new Error(`qBittorrent info failed: ${retry.status}`);
      return (await retry.json()) as QbTorrentInfo[];
    }
    if (!res.ok) throw new Error(`qBittorrent info failed: ${res.status}`);
    return (await res.json()) as QbTorrentInfo[];
  }

  async getByTag(tag: string): Promise<QbTorrentInfo | undefined> {
    const list = await this.info({ tag });
    return list.sort((a, b) => b.size - a.size)[0];
  }

  async getByHash(hash: string): Promise<QbTorrentInfo | undefined> {
    const list = await this.info({ hashes: hash.toLowerCase() });
    return list[0];
  }

  async pause(hash: string): Promise<void> {
    await this.ensureAuth();
    const body = new URLSearchParams({ hashes: hash.toLowerCase() });
    await fetch(`${this.base}/api/v2/torrents/pause`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/x-www-form-urlencoded" }),
      body,
    });
  }

  async resume(hash: string): Promise<void> {
    await this.ensureAuth();
    const body = new URLSearchParams({ hashes: hash.toLowerCase() });
    await fetch(`${this.base}/api/v2/torrents/resume`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/x-www-form-urlencoded" }),
      body,
    });
  }

  async delete(hashes: string[], deleteFiles: boolean): Promise<void> {
    await this.ensureAuth();
    const body = new URLSearchParams({
      hashes: hashes.map((h) => h.toLowerCase()).join("|"),
      deleteFiles: String(deleteFiles),
    });
    await fetch(`${this.base}/api/v2/torrents/delete`, {
      method: "POST",
      headers: this.headers({ "Content-Type": "application/x-www-form-urlencoded" }),
      body,
    });
  }

  async version(): Promise<string> {
    await this.ensureAuth();
    const res = await fetch(`${this.base}/api/v2/app/version`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`qBittorrent unreachable: ${res.status}`);
    return (await res.text()).trim();
  }

  /** Diagnostic: report exactly what /auth/login returns (status, cookie, version). */
  async diagnose(): Promise<Record<string, unknown>> {
    const attempt = async (
      label: string,
      extra: Record<string, string>,
    ): Promise<Record<string, unknown>> => {
      const body = new URLSearchParams({ username: this.user, password: this.pass });
      const res = await fetch(`${this.base}/api/v2/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", ...extra },
        body,
      });
      const text = (await res.text()).trim();
      const sc =
        typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
      const raw = sc.join("; ") || res.headers.get("set-cookie") || "";
      const m = raw.match(/SID=([^;]+)/);
      let versionStatus = 0;
      let version = "";
      try {
        const vr = await fetch(`${this.base}/api/v2/app/version`, {
          headers: m ? { Cookie: `SID=${m[1]}` } : {},
        });
        versionStatus = vr.status;
        version = (await vr.text()).slice(0, 40);
      } catch (e) {
        version = (e as Error).message;
      }
      return {
        label,
        loginStatus: res.status,
        loginBody: text.slice(0, 30),
        gotCookie: !!m,
        versionStatus,
        version,
      };
    };
    return {
      base: this.base,
      user: this.user,
      passLen: this.pass.length,
      attempts: [
        await attempt("referer+origin", { Referer: this.base, Origin: this.origin() }),
        await attempt("no-headers", {}),
      ],
    };
  }
}

/** Extract the BitTorrent v1 info hash from a magnet URI, if present. */
export function parseInfoHash(magnet: string): string | undefined {
  const m = magnet.match(/xt=urn:btih:([a-zA-Z0-9]+)/i);
  return m ? m[1].toLowerCase() : undefined;
}
