"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
  autoFocus,
}: {
  q: string;
  searching: boolean;
  onChange: (v: string) => void;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // Focus reliably whenever the field becomes active (mount or autoFocus→true),
  // without stealing focus mid-typing (deps only on the flag, not the value).
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  return (
    <div className="relative">
      <SearchIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
      <input
        ref={ref}
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

function HomeContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const wantSearch = searchParams.get("search") !== null;

  const [rows, setRows] = useState<Row[]>([]);
  const [heroItems, setHeroItems] = useState<HeroItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [noTmdb, setNoTmdb] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<TmdbItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [seed, setSeed] = useState<TitleSeed | null>(null);
  const [heroSearchOpen, setHeroSearchOpen] = useState(false);

  // The sidebar's "Search" item links to /?search=1. Keep the in-page search
  // view in sync with that param (desktop opens it this way; mobile via the
  // hero icon, which flips the state directly without touching the URL).
  useEffect(() => {
    setHeroSearchOpen(wantSearch);
  }, [wantSearch]);

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
    setHeroSearchOpen(false);
    if (wantSearch) router.replace("/");
  }

  const open = (i: TmdbItem) =>
    setSeed({
      tmdbId: i.tmdbId,
      mediaType: i.mediaType === "movie" ? "movie" : "tv",
      title: i.title,
      year: i.year ?? null,
      posterUrl: i.posterUrl ?? null,
    });

  const hasHero = heroItems.length > 0;
  // Dedicated search layout — entered from the hero's search icon, or shown by
  // default when there's no hero (no TMDB key / empty browse). Its input stays
  // mounted the whole time (results render below it), so typing never switches
  // views or loses focus.
  const searchView = heroSearchOpen || !hasHero;

  return (
    <div className="min-h-full">
      {/* Hero slider with a search icon in the top-right that opens the search view */}
      {!searchView && (
        <div className="relative">
          <HeroSlider items={heroItems} onOpen={open} />
          {/* Search affordance on the hero is mobile-only; desktop uses the sidebar's Search item. */}
          <div className="absolute right-4 top-4 z-20 flex justify-end md:hidden">
            <button
              aria-label="Search"
              onClick={() => setHeroSearchOpen(true)}
              className="flex h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-black/30 text-white/85 backdrop-blur-md transition hover:bg-black/50"
            >
              <SearchIcon size={19} />
            </button>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-6xl px-5 py-6 md:px-10">
        {/* One persistent search input. It never unmounts while the search view is
            open, so focus and cursor survive as results stream in below it. */}
        {searchView && (
          <div className="mb-8 flex items-center gap-3">
            {hasHero && (
              <button
                className="btn btn-ghost flex-none px-3 py-2"
                onClick={clearSearch}
                title="Back to home"
              >
                <ArrowLeft size={16} /> Back
              </button>
            )}
            <div className="max-w-2xl flex-1">
              <SearchBar q={q} searching={searching} onChange={search} autoFocus={heroSearchOpen} />
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

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <HomeContent />
    </Suspense>
  );
}
