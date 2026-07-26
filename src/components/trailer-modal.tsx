"use client";

import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import { jsonFetch } from "@/lib/client";

export interface TrailerSeed {
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
}

/** Plays a title's YouTube trailer in-app (resolved lazily from TMDB). */
export function TrailerModal({ seed, onClose }: { seed: TrailerSeed; onClose: () => void }) {
  const [videoKey, setVideoKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    jsonFetch<{ key: string | null }>(`/api/tmdb/trailer?type=${seed.mediaType}&id=${seed.tmdbId}`)
      .then((d) => alive && setVideoKey(d.key))
      .catch(() => alive && setVideoKey(null))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [seed.tmdbId, seed.mediaType]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 p-4"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div className="w-full max-w-4xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between gap-3">
          <p className="truncate text-sm font-medium text-ink">{seed.title} — Trailer</p>
          <button
            onClick={onClose}
            className="flex-none rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="relative aspect-video w-full overflow-hidden rounded-xl border border-border bg-black">
          {loading ? (
            <div className="flex h-full items-center justify-center text-faint">
              <Loader2 size={22} className="animate-spin" />
            </div>
          ) : videoKey ? (
            <iframe
              className="h-full w-full"
              src={`https://www.youtube-nocookie.com/embed/${videoKey}?autoplay=1&rel=0`}
              title={`${seed.title} trailer`}
              allow="autoplay; encrypted-media; fullscreen"
              allowFullScreen
            />
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-faint">
              No trailer available for this title.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
