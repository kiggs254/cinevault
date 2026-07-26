"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2 } from "lucide-react";
import { jsonFetch } from "@/lib/client";
import { TitleModal, type TitleSeed } from "@/components/title-modal";

interface Item {
  tmdbId: number;
  mediaType: string;
  title: string;
  year?: number;
  posterUrl?: string;
}
interface Resp {
  title: string;
  items: Item[];
  page: number;
  totalPages: number;
}

export default function CategoryPage() {
  const params = useParams<{ category: string }>();
  const category = params.category;
  const [data, setData] = useState<Resp | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [seed, setSeed] = useState<TitleSeed | null>(null);

  useEffect(() => {
    setLoading(true);
    jsonFetch<Resp>(`/api/browse/category?key=${category}&page=${page}`)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }, [category, page]);

  const open = (i: Item) =>
    setSeed({
      tmdbId: i.tmdbId,
      mediaType: i.mediaType === "movie" ? "movie" : "tv",
      title: i.title,
      year: i.year ?? null,
      posterUrl: i.posterUrl ?? null,
    });

  const totalPages = data?.totalPages ?? 1;

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 md:px-10">
      <Link href="/" className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-ink">
        <ArrowLeft size={15} /> Home
      </Link>
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="label">Browse</p>
          <h1 className="text-4xl text-ink md:text-5xl" style={{ fontFamily: "var(--font-display)" }}>
            {data?.title ?? "…"}
          </h1>
        </div>
        {data && <span className="badge">Page {data.page} / {totalPages}</span>}
      </header>

      {loading && !data ? (
        <p className="flex items-center gap-2 text-sm text-faint"><Loader2 size={15} className="animate-spin" /> Loading…</p>
      ) : !data || data.items.length === 0 ? (
        <p className="text-sm text-faint">Nothing to show here.</p>
      ) : (
        <>
          <div className={`grid grid-cols-3 gap-4 transition-opacity sm:grid-cols-4 md:grid-cols-6 ${loading ? "opacity-50" : ""}`}>
            {data.items.map((i) => (
              <button key={`${i.mediaType}-${i.tmdbId}`} onClick={() => open(i)} className="group text-left" title={i.title}>
                <div className="aspect-[2/3] overflow-hidden rounded-lg border border-border bg-surface-2 transition-transform group-hover:scale-[1.04] group-hover:border-accent">
                  {i.posterUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={i.posterUrl} alt={i.title} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-faint">{i.title.slice(0, 1)}</div>
                  )}
                </div>
                <p className="mt-1.5 truncate text-xs text-muted group-hover:text-ink">{i.title}</p>
              </button>
            ))}
          </div>

          <div className="mt-8 flex items-center justify-center gap-3">
            <button
              className="btn btn-ghost"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronLeft size={15} /> Prev
            </button>
            <span className="mono text-sm text-muted">{page} / {totalPages}</span>
            <button
              className="btn btn-ghost"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next <ChevronRight size={15} />
            </button>
          </div>
        </>
      )}

      {seed && <TitleModal seed={seed} onClose={() => setSeed(null)} />}
    </div>
  );
}
