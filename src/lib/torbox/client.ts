/**
 * Minimal TorBox debrid client. TorBox fetches a torrent on ITS servers and
 * serves the files over direct HTTP — instant when cached, and no seeders /
 * stalls / re-sourcing on our side either way. Docs: https://api.torbox.app (v1).
 * Auth: `Authorization: Bearer <api key>` (requestdl also takes it as `token`).
 */
export interface TorboxConfig {
  apiKey?: string;
}

export interface TorboxFile {
  id: number;
  name: string;
  size: number;
  short_name?: string;
}

export interface TorboxTorrent {
  id: number;
  hash?: string;
  name?: string;
  download_state?: string;
  download_finished: boolean;
  download_present: boolean;
  progress: number; // 0..1
  files: TorboxFile[];
}

const BASE = "https://api.torbox.app/v1/api";

export class TorboxClient {
  constructor(private cfg: TorboxConfig) {
    if (!cfg.apiKey) throw new Error("TorBox API key not configured");
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.cfg.apiKey}` };
  }

  /** Queue a magnet on TorBox. Returns the torrent id (+ hash), or null on failure. */
  async addMagnet(magnet: string): Promise<{ torrentId: number; hash?: string } | null> {
    const form = new FormData();
    form.set("magnet", magnet);
    form.set("seed", "3"); // 3 = don't seed — we only want the files
    const res = await fetch(`${BASE}/torrents/createtorrent`, {
      method: "POST",
      headers: this.headers(),
      body: form,
    });
    const j = (await res.json().catch(() => null)) as
      | { success?: boolean; data?: { torrent_id?: number; hash?: string } | null }
      | null;
    const tid = j?.data?.torrent_id;
    if (!j?.success || typeof tid !== "number") return null;
    return { torrentId: tid, hash: j.data?.hash };
  }

  /** Status + file list for one torrent (bypasses TorBox's ~10-min status cache). */
  async get(torrentId: number): Promise<TorboxTorrent | null> {
    const res = await fetch(`${BASE}/torrents/mylist?id=${torrentId}&bypass_cache=true`, {
      headers: this.headers(),
    });
    const j = (await res.json().catch(() => null)) as { success?: boolean; data?: unknown } | null;
    if (!j?.success || !j.data) return null;
    const raw = Array.isArray(j.data) ? j.data[0] : j.data;
    if (!raw || typeof raw !== "object") return null;
    const d = raw as Record<string, unknown>;
    const files = Array.isArray(d.files)
      ? (d.files as Record<string, unknown>[]).map((f) => ({
          id: Number(f.id),
          name: String(f.name ?? ""),
          size: Number(f.size ?? 0),
          short_name: typeof f.short_name === "string" ? f.short_name : undefined,
        }))
      : [];
    return {
      id: Number(d.id),
      hash: typeof d.hash === "string" ? d.hash : undefined,
      name: typeof d.name === "string" ? d.name : undefined,
      download_state: typeof d.download_state === "string" ? d.download_state : undefined,
      download_finished: d.download_finished === true,
      download_present: d.download_present === true,
      progress: typeof d.progress === "number" ? d.progress : 0,
      files,
    };
  }

  /** Direct HTTP download URL for one file (valid ~3h to start). */
  async requestDownloadLink(torrentId: number, fileId: number): Promise<string | null> {
    const url =
      `${BASE}/torrents/requestdl?token=${encodeURIComponent(this.cfg.apiKey ?? "")}` +
      `&torrent_id=${torrentId}&file_id=${fileId}`;
    const res = await fetch(url, { headers: this.headers() });
    const j = (await res.json().catch(() => null)) as { success?: boolean; data?: unknown } | null;
    return j?.success && typeof j.data === "string" ? j.data : null;
  }

  /** Remove a torrent from the TorBox account (free the slot once we have the files). */
  async remove(torrentId: number): Promise<void> {
    await fetch(`${BASE}/torrents/controltorrent`, {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify({ torrent_id: torrentId, operation: "delete" }),
    }).catch(() => {});
  }
}
