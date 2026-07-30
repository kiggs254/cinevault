import net from "node:net";
import { lookup } from "node:dns/promises";
import { gunzipSync } from "node:zlib";

/**
 * Fetch + parse + merge helpers for live-TV M3U playlists. Sources are remote
 * URLs (fetched, SSRF-guarded) or pasted text. Many sources merge into a single
 * `#EXTM3U` body that Jellyfin's Live TV loads.
 */

const FETCH_TIMEOUT = 20_000;
const MAX_BYTES = 96 * 1024 * 1024; // per-source guard (EPG files can be large)
const MAX_REDIRECTS = 5;

/** True for loopback / private / link-local / CGNAT / metadata addresses. */
function isPrivateAddr(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local incl. 169.254.169.254 metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
    return false;
  }
  const lower = ip.toLowerCase();
  if (lower === "::1" || lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // ULA
  if (lower.startsWith("fe80")) return true; // link-local
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateAddr(mapped[1]);
  return false;
}

/** Reject SSRF targets: only public http(s) hosts are allowed. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new Error("Invalid URL");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http(s) URLs are allowed");
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(u.hostname, { all: true });
  } catch {
    throw new Error(`Cannot resolve host: ${u.hostname}`);
  }
  for (const { address } of addrs) {
    if (isPrivateAddr(address)) throw new Error(`Refusing to fetch a private address (${address})`);
  }
  return u;
}

/**
 * Fetch a remote text resource with a timeout, size cap, gzip handling, and
 * per-hop SSRF revalidation (redirects are followed manually, each re-checked).
 */
export async function fetchRemoteText(raw: string): Promise<string> {
  let current = raw;
  for (let hop = 0; hop < MAX_REDIRECTS; hop++) {
    const u = await assertPublicUrl(current);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
    try {
      const res = await fetch(u, {
        signal: ctrl.signal,
        redirect: "manual",
        headers: { "User-Agent": "Cinevault-LiveTV/1.0", Accept: "*/*" },
      });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) throw new Error(`Redirect ${res.status} without a Location header`);
        current = new URL(loc, u).toString();
        continue;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.byteLength > MAX_BYTES) throw new Error("Source is too large");
      if ((buf[0] === 0x1f && buf[1] === 0x8b) || u.pathname.toLowerCase().endsWith(".gz")) {
        try {
          return gunzipSync(buf).toString("utf8");
        } catch {
          /* not actually gzip — fall through to raw text */
        }
      }
      return buf.toString("utf8");
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("Too many redirects");
}

/** Count channels (`#EXTINF` entries) in an M3U body. */
export function countChannels(text: string): number {
  return (text.match(/^#EXTINF/gim) || []).length;
}

/** Basic sanity check that a body looks like an M3U playlist. */
export function looksLikeM3u(text: string): boolean {
  return /#EXTM3U/i.test(text) || /#EXTINF/i.test(text);
}

/** Prefix a channel's group-title with the source name so providers stay grouped. */
function namespaceGroup(extinf: string, name: string): string {
  const safe = name.replace(/"/g, "'").trim();
  if (!safe) return extinf;
  if (/group-title="/i.test(extinf)) {
    return extinf.replace(/group-title="([^"]*)"/i, (_m, g) => `group-title="${safe} • ${g}"`);
  }
  const comma = extinf.indexOf(",");
  if (comma === -1) return extinf;
  return `${extinf.slice(0, comma)} group-title="${safe}"${extinf.slice(comma)}`;
}

/**
 * Merge many M3U bodies into one aggregated playlist. `tvg-id` and every other
 * attribute are preserved (so EPG matching still works); when `groupBySource`
 * is on, each source's channels are namespaced under its playlist name.
 */
export function mergeM3u(
  sources: { name: string; text: string }[],
  opts: { groupBySource: boolean },
): string {
  const out: string[] = ["#EXTM3U"];
  for (const src of sources) {
    for (const line of src.text.split(/\r?\n/)) {
      if (/^#EXTM3U/i.test(line)) continue; // drop each source's own header
      if (line.trim() === "") continue; // drop stray blank lines
      if (/^#EXTINF/i.test(line) && opts.groupBySource) {
        out.push(namespaceGroup(line, src.name));
      } else {
        out.push(line);
      }
    }
  }
  return out.join("\n") + "\n";
}
