"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { jsonFetch } from "@/lib/client";

export interface TmdbItem {
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

export function Poster({ item, onClick }: { item: TmdbItem; onClick: () => void }) {
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

/** Self-fetching TMDB browse rows (Trending, New Releases, …). Shared by Home + Search. */
export function BrowseRows({ onOpen }: { onOpen: (i: TmdbItem) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [noTmdb, setNoTmdb] = useState(false);

  useEffect(() => {
    jsonFetch<{ rows: Row[]; error?: string }>("/api/browse")
      .then((d) => {
        setRows(d.rows);
        if (d.error) setNoTmdb(true);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <>
      {noTmdb && (
        <p className="mb-6 rounded-lg border border-border bg-surface p-3 text-sm text-muted">
          Add a <span className="text-ink">TMDB API key</span> in Settings to browse and download by title.
        </p>
      )}
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
              <Poster key={`${i.mediaType}-${i.tmdbId}`} item={i} onClick={() => onOpen(i)} />
            ))}
          </div>
        </section>
      ))}
    </>
  );
}
