"use client";

import { useEffect, useState } from "react";
import { Search as SearchIcon, Loader2, ArrowLeft } from "lucide-react";
import { jsonFetch } from "@/lib/client";
import { TitleModal, type TitleSeed } from "@/components/title-modal";

interface Hit {
  tmdbId: number;
  mediaType: string;
  title: string;
  year?: number;
  posterUrl?: string;
}

/** Full-screen title search (TV + movies → TitleModal). Opened from the header. */
export function SearchOverlay({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [seed, setSeed] = useState<TitleSeed | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function search(v: string) {
    setQ(v);
    if (!v.trim()) {
      setResults(null);
      return;
    }
    setSearching(true);
    try {
      const [tv, mv] = await Promise.all([
        jsonFetch<{ results: Hit[] }>(`/api/tmdb/search?type=tv&q=${encodeURIComponent(v)}`),
        jsonFetch<{ results: Hit[] }>(`/api/tmdb/search?type=movie&q=${encodeURIComponent(v)}`),
      ]);
      setResults([...tv.results, ...mv.results].filter((r) => r.posterUrl));
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }

  const open = (i: Hit) =>
    setSeed({
      tmdbId: i.tmdbId,
      mediaType: i.mediaType === "movie" ? "movie" : "tv",
      title: i.title,
      year: i.year ?? null,
      posterUrl: i.posterUrl ?? null,
    });

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-bg">
      <div className="flex flex-none items-center gap-2 border-b border-border px-4 pb-3 pt-[calc(0.625rem+env(safe-area-inset-top))]">
        <button aria-label="Close search" onClick={onClose} className="flex-none rounded-lg p-2 text-muted">
          <ArrowLeft size={20} />
        </button>
        <div className="relative flex-1">
          <SearchIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          {/* eslint-disable-next-line jsx-a11y/no-autofocus */}
          <input
            autoFocus
            className="input pl-9"
            placeholder="Search movies & shows to download…"
            value={q}
            onChange={(e) => search(e.target.value)}
          />
          {searching && (
            <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-faint" />
          )}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!results ? (
          <p className="text-sm text-faint">Type a movie or show name to find and download it.</p>
        ) : results.length === 0 ? (
          <p className="text-sm text-faint">No matches for “{q}”.</p>
        ) : (
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            {results.map((i) => (
              <button key={`${i.mediaType}-${i.tmdbId}`} onClick={() => open(i)} className="group text-left" title={i.title}>
                <div className="aspect-[2/3] overflow-hidden rounded-lg border border-border bg-surface-2 group-hover:border-accent">
                  {i.posterUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={i.posterUrl} alt={i.title} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-faint">{i.title.slice(0, 1)}</div>
                  )}
                </div>
                <p className="mt-1.5 truncate text-xs text-muted group-hover:text-ink">
                  {i.title} {i.year ? <span className="text-faint">({i.year})</span> : null}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      {seed && <TitleModal seed={seed} onClose={() => setSeed(null)} />}
    </div>
  );
}
