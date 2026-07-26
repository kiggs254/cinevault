"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search as SearchIcon, Loader2, ChevronRight, ArrowLeft } from "lucide-react";
import { jsonFetch } from "@/lib/client";
import { TitleModal, type TitleSeed } from "@/components/title-modal";
import { HeroSlider, type HeroItem } from "@/components/hero-slider";

interface TmdbItem {
  tmdbId: number;
  mediaType: string;
  title: string;
  year?: number;
  posterUrl?: string;
  backdropUrl?: string;
  overview?: string;
}
interface Row {
  key: string;
  title: string;
  items: TmdbItem[];
}

function Poster({ item, onClick }: { item: TmdbItem; onClick: () => void }) {
  return (
    <button onClick={onClick} className="group w-32 flex-none sm:w-36" title={item.title}>
      <div className="aspect-[2/3] overflow-hidden rounded-lg border border-border bg-surface-2 transition-transform group-hover:scale-[1.04] group-hover:border-accent">
        {item.posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.posterUrl} alt={item.title} className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full items-center justify-center text-faint">{item.title.slice(0, 1)}</div>
        )}
      </div>
      <p className="mt-1.5 truncate text-xs text-muted group-hover:text-ink">{item.title}</p>
    </button>
  );
}

function SearchBar({
  q,
  searching,
  onChange,
  translucent,
}: {
  q: string;
  searching: boolean;
  onChange: (v: string) => void;
  translucent?: boolean;
}) {
  return (
    <div className="relative">
      <SearchIcon
        size={16}
        className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 ${translucent ? "text-white/70" : "text-faint"}`}
      />
      <input
        className={
          translucent
            ? "w-full rounded-xl border border-white/20 bg-black/25 py-2.5 pl-9 pr-9 text-sm text-ink outline-none backdrop-blur-md transition placeholder:text-white/60 focus:border-accent focus:bg-black/40"
            : "input pl-9"
        }
        placeholder="Search movies & shows to download…"
        value={q}
        onChange={(e) => onChange(e.target.value)}
      />
      {searching && (
        <Loader2
          size={15}
          className={`absolute right-3 top-1/2 -translate-y-1/2 animate-spin ${translucent ? "text-white/70" : "text-faint"}`}
        />
      )}
    </div>
  );
}

export default function HomePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [heroItems, setHeroItems] = useState<HeroItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [noTmdb, setNoTmdb] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<TmdbItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [seed, setSeed] = useState<TitleSeed | null>(null);

  useEffect(() => {
    jsonFetch<{ rows: Row[]; error?: string }>("/api/browse")
      .then((d) => {
        setRows(d.rows);
        if (d.error) setNoTmdb(true);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
    jsonFetch<{ items: HeroItem[] }>("/api/hero")
      .then((d) => setHeroItems(d.items ?? []))
      .catch(() => {});
  }, []);

  async function search(v: string) {
    setQ(v);
    if (!v.trim()) {
      setResults(null);
      return;
    }
    setSearching(true);
    try {
      const [tv, mv] = await Promise.all([
        jsonFetch<{ results: TmdbItem[] }>(`/api/tmdb/search?type=tv&q=${encodeURIComponent(v)}`),
        jsonFetch<{ results: TmdbItem[] }>(`/api/tmdb/search?type=movie&q=${encodeURIComponent(v)}`),
      ]);
      setResults([...tv.results, ...mv.results].filter((r) => r.posterUrl));
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  function clearSearch() {
    setQ("");
    setResults(null);
  }

  const open = (i: TmdbItem) =>
    setSeed({
      tmdbId: i.tmdbId,
      mediaType: i.mediaType === "movie" ? "movie" : "tv",
      title: i.title,
      year: i.year ?? null,
      posterUrl: i.posterUrl ?? null,
    });

  const showHero = !results && heroItems.length > 0;

  return (
    <div className="min-h-full">
      {/* Hero slider with a translucent search tucked into the top-right corner */}
      {showHero && (
        <div className="relative">
          <HeroSlider items={heroItems} onOpen={open} />
          <div className="absolute right-4 top-4 z-20 w-72 max-w-[calc(100vw-2rem)] md:right-8 md:top-6">
            <SearchBar q={q} searching={searching} onChange={search} translucent />
          </div>
        </div>
      )}

      <div className="mx-auto max-w-6xl px-5 py-6 md:px-10">
        {/* Search bar at the top when there is no hero (no TMDB key, or while searching).
            Once a search is active, a Back button returns to the hero + browse rows. */}
        {!showHero && (
          <div className="mb-8 flex items-center gap-3">
            {results && (
              <button
                className="btn btn-ghost flex-none px-3 py-2"
                onClick={clearSearch}
                title="Back to home"
              >
                <ArrowLeft size={16} /> Back
              </button>
            )}
            <div className="max-w-2xl flex-1">
              <SearchBar q={q} searching={searching} onChange={search} />
            </div>
          </div>
        )}

        {noTmdb && (
          <p className="mb-6 rounded-lg border border-border bg-surface p-3 text-sm text-muted">
            Add a <span className="text-ink">TMDB API key</span> in Settings to browse and download by title.
          </p>
        )}

        {/* Search results */}
        {results && (
          <section className="mb-8">
            <h2 className="label mb-3">Results for “{q}”</h2>
            {results.length === 0 ? (
              <p className="text-sm text-faint">No matches.</p>
            ) : (
              <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6">
                {results.map((i) => (
                  <Poster key={`${i.mediaType}-${i.tmdbId}`} item={i} onClick={() => open(i)} />
                ))}
              </div>
            )}
          </section>
        )}

        {/* Browse rows */}
        {!results && (
          <>
            {loading && <p className="text-sm text-faint">Loading…</p>}
            {rows.map((row) => (
              <section key={row.key} className="mb-8">
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="label">{row.title}</h2>
                  <Link
                    href={`/browse/${row.key}`}
                    className="flex items-center gap-0.5 text-xs text-muted transition-colors hover:text-accent"
                  >
                    Show all <ChevronRight size={13} />
                  </Link>
                </div>
                <div className="no-scrollbar flex gap-3 overflow-x-auto pb-2">
                  {row.items.map((i) => (
                    <Poster key={`${i.mediaType}-${i.tmdbId}`} item={i} onClick={() => open(i)} />
                  ))}
                </div>
              </section>
            ))}
          </>
        )}
      </div>

      {seed && <TitleModal seed={seed} onClose={() => setSeed(null)} />}
    </div>
  );
}
