import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import {
  browseCategory,
  BROWSE_CATEGORIES,
  getLatestTopRated,
  getGenres,
  discoverByGenres,
  type TmdbTitle,
} from "@/lib/metadata/tmdb";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Row = { key: string; title: string; items: TmdbTitle[] };

function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Dynamic browse rows: fixed categories + fresh releases + random genres, shuffled. */
export async function GET() {
  const cfg = await getConfig();
  const key = cfg.tmdb.apiKey;
  if (!key) return NextResponse.json({ rows: [], error: "TMDB API key not configured" });

  const rows: Row[] = [];

  const catResults = await Promise.all(
    Object.keys(BROWSE_CATEGORIES).map((k) => browseCategory(key, k, 1)),
  );
  for (const r of catResults) {
    if (r && r.items.length > 0) rows.push({ key: r.key, title: r.title, items: r.items.slice(0, 20) });
  }

  // Fresh releases — a moving target, keeps the page from feeling static.
  try {
    const [nm, nt] = await Promise.all([getLatestTopRated(key, "movie"), getLatestTopRated(key, "tv")]);
    const fresh = shuffle([...nm, ...nt].filter((t) => t.posterUrl)).slice(0, 20);
    if (fresh.length) rows.push({ key: "new-releases", title: "New releases", items: fresh });
  } catch {
    /* optional */
  }

  // A couple of random-genre rows for serendipity.
  try {
    for (const type of ["movie", "tv"] as const) {
      const genres = await getGenres(key, type);
      const g = shuffle([...genres])[0];
      if (!g) continue;
      const items = (await discoverByGenres(key, type, [g.id])).filter((t) => t.posterUrl).slice(0, 20);
      if (items.length >= 6) {
        rows.push({
          key: `genre-${type}-${g.id}`,
          title: `${g.name} ${type === "tv" ? "shows" : "movies"}`,
          items,
        });
      }
    }
  } catch {
    /* optional */
  }

  // Trending stays on top; everything else is shuffled each build for variety.
  const trending = rows.filter((r) => r.key === "trending");
  const rest = shuffle(rows.filter((r) => r.key !== "trending"));

  return NextResponse.json(
    { rows: [...trending, ...rest] },
    { headers: { "Cache-Control": "private, max-age=900" } },
  );
}
