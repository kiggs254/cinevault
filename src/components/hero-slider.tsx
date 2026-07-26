"use client";

import { useEffect, useState } from "react";
import { Info, Play, Tv, Film } from "lucide-react";
import { TrailerModal, type TrailerSeed } from "./trailer-modal";

export interface HeroItem {
  tmdbId: number;
  mediaType: string;
  title: string;
  year?: number;
  overview?: string;
  backdropUrl?: string;
  posterUrl?: string;
}

const ROTATE_MS = 8000;

/** Auto-rotating hero of the latest highly-rated releases. */
export function HeroSlider({ items, onOpen }: { items: HeroItem[]; onOpen: (i: HeroItem) => void }) {
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [trailer, setTrailer] = useState<TrailerSeed | null>(null);

  useEffect(() => {
    if (paused || items.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % items.length), ROTATE_MS);
    return () => clearInterval(t);
  }, [paused, items.length]);

  useEffect(() => {
    if (idx >= items.length) setIdx(0);
  }, [items.length, idx]);

  if (items.length === 0) return null;
  const cur = items[Math.min(idx, items.length - 1)];
  const mt: "movie" | "tv" = cur.mediaType === "movie" ? "movie" : "tv";

  return (
    <div
      className="relative h-[52vh] min-h-[340px] w-full overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      {items.map((it, i) => (
        <div
          key={`${it.mediaType}-${it.tmdbId}`}
          className="absolute inset-0 transition-opacity duration-700 ease-in-out"
          style={{ opacity: i === idx ? 1 : 0 }}
          aria-hidden={i !== idx}
        >
          {it.backdropUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={it.backdropUrl} alt="" className="h-full w-full object-cover" />
          )}
        </div>
      ))}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(to top, var(--color-bg), transparent 55%), linear-gradient(to right, var(--color-bg) 5%, transparent 50%)",
        }}
      />

      {/* Slide content */}
      <div className="absolute bottom-8 left-5 max-w-xl md:left-10">
        <p className="mb-1 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-accent">
          {mt === "tv" ? <Tv size={13} /> : <Film size={13} />} Latest &amp; highly rated
        </p>
        <h1
          className="text-4xl font-bold text-ink md:text-5xl"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {cur.title}
          {cur.year ? <span className="ml-2 text-2xl text-muted md:text-3xl">{cur.year}</span> : null}
        </h1>
        {cur.overview && <p className="mt-2 line-clamp-3 text-sm text-muted">{cur.overview}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn btn-accent" onClick={() => onOpen(cur)}>
            <Info size={15} /> More info &amp; download
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => setTrailer({ tmdbId: cur.tmdbId, mediaType: mt, title: cur.title })}
          >
            <Play size={15} /> Watch trailer
          </button>
        </div>
      </div>

      {/* Slide indicators */}
      {items.length > 1 && (
        <div className="absolute bottom-4 right-5 flex gap-1.5 md:right-10">
          {items.map((_, i) => (
            <button
              key={i}
              onClick={() => setIdx(i)}
              aria-label={`Go to slide ${i + 1}`}
              className="h-1.5 rounded-full transition-all"
              style={{
                width: i === idx ? 22 : 8,
                background: i === idx ? "var(--color-accent)" : "var(--color-faint)",
              }}
            />
          ))}
        </div>
      )}

      {trailer && <TrailerModal seed={trailer} onClose={() => setTrailer(null)} />}
    </div>
  );
}
