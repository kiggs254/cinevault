"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Search as SearchIcon, Loader2, Info, ChevronDown, ChevronUp, ChevronRight } from "lucide-react";
import { jsonFetch } from "@/lib/client";
import { TitleModal, type TitleSeed } from "@/components/title-modal";
import { useDownloads } from "@/components/use-downloads";
import { DownloadsPanel } from "@/components/downloads-panel";

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

export default function HomePage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [noTmdb, setNoTmdb] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<TmdbItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [seed, setSeed] = useState<TitleSeed | null>(null);
  const [showDl, setShowDl] = useState(false);
  const dl = useDownloads();

  useEffect(() => {
    jsonFetch<{ rows: Row[]; error?: string }>("/api/browse")
      .then((d) => {
        setRows(d.rows);
        if (d.error) setNoTmdb(true);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
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

  const hero = rows[0]?.items?.find((i) => i.backdropUrl) ?? rows[0]?.items?.[0];
  const activeCount = dl.downloads.filter((d) => !["COMPLETED", "FAILED", "CANCELLED"].includes(d.status)).length;

  return (
    <div className="min-h-full">
      {/* Hero */}
      {hero && !results && (
        <div className="relative h-[46vh] min-h-[300px] w-full">
          {hero.backdropUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={hero.backdropUrl} alt="" className="h-full w-full object-cover" />
          )}
          <div className="absolute inset-0" style={{ background: "linear-gradient(to top, var(--color-bg), transparent 55%), linear-gradient(to right, var(--color-bg) 5%, transparent 45%)" }} />
          <div className="absolute bottom-8 left-5 max-w-lg md:left-10">
            <h1 className="text-4xl font-bold text-ink md:text-5xl" style={{ fontFamily: "var(--font-display)" }}>
              {hero.title}
            </h1>
            {hero.overview && <p className="mt-2 line-clamp-3 text-sm text-muted">{hero.overview}</p>}
            <button className="btn btn-accent mt-4" onClick={() => open(hero)}>
              <Info size={15} /> More info &amp; download
            </button>
          </div>
        </div>
      )}

      <div className="mx-auto max-w-6xl px-5 py-6 md:px-10">
        {/* Search */}
        <div className="relative mb-8 max-w-xl">
          <SearchIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            className="input pl-9"
            placeholder="Search movies & shows to download…"
            value={q}
            onChange={(e) => search(e.target.value)}
          />
          {searching && <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-faint" />}
        </div>

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

        {/* Active downloads (collapsible) */}
        {dl.downloads.length > 0 && (
          <section className="mt-4 border-t border-border pt-5">
            <button className="mb-3 flex items-center gap-2 text-sm text-muted hover:text-ink" onClick={() => setShowDl((v) => !v)}>
              {showDl ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              Downloads {activeCount > 0 && <span className="badge" style={{ color: "var(--color-accent)" }}>{activeCount} active</span>}
            </button>
            {showDl && (
              <DownloadsPanel downloads={dl.downloads} loaded={dl.loaded} onRetry={dl.retry} onRemove={dl.remove} onRefresh={dl.refetch} />
            )}
          </section>
        )}
      </div>

      {seed && <TitleModal seed={seed} onClose={() => setSeed(null)} />}
    </div>
  );
}
