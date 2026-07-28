"use client";

import { useEffect, useRef, useState } from "react";
import { Search as SearchIcon, Loader2 } from "lucide-react";
import { jsonFetch } from "@/lib/client";
import { TitleModal, type TitleSeed } from "@/components/title-modal";
import { BrowseRows, Poster, type TmdbItem } from "@/components/browse-rows";

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<TmdbItem[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [seed, setSeed] = useState<TitleSeed | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Land ready to type.
  useEffect(() => {
    inputRef.current?.focus();
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

  return (
    <div className="mx-auto max-w-6xl px-5 py-6 md:px-10">
      <div className="mb-8 max-w-2xl">
        <div className="relative">
          <SearchIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            ref={inputRef}
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

      {results ? (
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
      ) : (
        // Before typing: don't leave it empty — show the browse rows.
        <BrowseRows onOpen={open} />
      )}

      {seed && <TitleModal seed={seed} onClose={() => setSeed(null)} />}
    </div>
  );
}
