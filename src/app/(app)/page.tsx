"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search as SearchIcon, Loader2, ChevronRight } from "lucide-react";
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
}: {
  q: string;
  searching: boolean;
  onChange: (v: string) => void;
}) {
  return (
    <div className="relative">
      <SearchIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
      <input
        className="input pl-9"
        placeholder="Search movies & shows to download…"
        value={q}
        onChange={(e) => onChange(e.target.value)}
      />
      {searching && (
        <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-faint" />
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
      {/* Hero slider with the search bar floated up over the top */}
      {showHero && (
        <div className="relative">
          <HeroSlider items={heroItems} onOpen={open} />
          <div className="absolute left-1/2 top-4 z-20 w-[92%] max-w-2xl -translate-x-1/2 md:top-6">
            <SearchBar q={q} searching={searching} onChange={search} />
          </div>
        </div>
      )}

      <div className="mx-auto max-w-6xl px-5 py-6 md:px-10">
        {/* Search bar at the top when there is no hero (no TMDB key, or while searching) */}
        {!showHero && (
          <div className="mb-8 max-w-2xl">
            <SearchBar q={q} searching={searching} onChange={search} />
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
                <div className="flex gap-3 overflow-x-auto pb-2">
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
