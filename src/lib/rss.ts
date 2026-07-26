import { XMLParser } from "fast-xml-parser";

export interface RssItem {
  title: string;
  link?: string;
  guid?: string;
  /** A downloadable torrent source (magnet or .torrent URL), if present. */
  source?: string;
  infoHash?: string;
  size?: number;
  seeders?: number;
  pubDate?: string;
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@_" });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function arr(x: any): any[] {
  return Array.isArray(x) ? x : x ? [x] : [];
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function txt(v: any): string | undefined {
  if (v == null) return undefined;
  if (typeof v === "string") return v.trim();
  if (typeof v === "object" && "#text" in v) return String(v["#text"]).trim();
  return undefined;
}

/** Fetch and parse an RSS/Atom feed; returns items with a torrent source where available. */
export async function fetchFeed(url: string, limit = 40): Promise<RssItem[]> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "MovieHub/1.0",
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`Feed fetch failed: ${res.status}`);
  const xml = await res.text();
  const doc = parser.parse(xml);
  const raw = doc?.rss?.channel ? arr(doc.rss.channel.item) : doc?.feed ? arr(doc.feed.entry) : [];
  return raw.slice(0, limit).map(normalize).filter((i) => i.title);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalize(it: any): RssItem {
  const title = txt(it.title) ?? "";

  let link = txt(it.link);
  if (!link && it.link && typeof it.link === "object") link = it.link["@_href"];
  if (!link && Array.isArray(it.link)) {
    const alt = it.link.find((l: Record<string, string>) => l["@_rel"] !== "enclosure");
    link = alt?.["@_href"];
  }

  let enclosure: string | undefined = it.enclosure?.["@_url"];
  if (!enclosure && Array.isArray(it.link)) {
    const enc = it.link.find((l: Record<string, string>) => l["@_rel"] === "enclosure");
    enclosure = enc?.["@_href"];
  }
  const magnetTag = txt(it["torrent:magnetURI"]);

  const candidates = [magnetTag, link, enclosure].filter(Boolean) as string[];
  const source = candidates.find(
    (u) => u.startsWith("magnet:") || u.toLowerCase().endsWith(".torrent"),
  );

  const size = Number(it.enclosure?.["@_length"]) || undefined;
  const seeders = Number(txt(it["torrent:seeders"]) ?? it["nyaa:seeders"]) || undefined;

  return {
    title,
    link,
    guid: txt(it.guid) ?? txt(it.id) ?? link,
    source,
    infoHash: txt(it["torrent:infoHash"]) ?? undefined,
    size,
    seeders,
    pubDate: txt(it.pubDate) ?? txt(it.published) ?? txt(it.updated),
  };
}
