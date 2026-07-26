"use client";

import { useCallback, useEffect, useState } from "react";
import { RefreshCw, X, Play, FolderOpen, Tv, Film, HardDrive } from "lucide-react";
import { jsonFetch } from "@/lib/client";
import { formatBytes } from "@/lib/util";

interface Item {
  id: string;
  releaseName: string;
  season: number | null;
  episode: number | null;
  status: string;
  sizeBytes: number;
  s3Key: string | null;
}
interface TitleGroup {
  key: string;
  title: string;
  posterUrl: string | null;
  year: number | null;
  kind: string;
  tmdbId: number | null;
  count: number;
  sizeBytes: number;
  items: Item[];
}

function epLabel(i: Item): string {
  if (i.season != null && i.episode != null) return `S${String(i.season).padStart(2, "0")}E${String(i.episode).padStart(2, "0")}`;
  if (i.season != null) return `Season ${i.season}`;
  return i.releaseName;
}

export default function LibraryPage() {
  const [titles, setTitles] = useState<TitleGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [active, setActive] = useState<TitleGroup | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr("");
    try {
      const d = await jsonFetch<{ titles: TitleGroup[] }>("/api/library/titles");
      setTitles(d.titles);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function open(key: string) {
    try {
      const { url } = await jsonFetch<{ url: string }>(`/api/library?presign=${encodeURIComponent(key)}`);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-5 py-6 sm:py-8 md:px-10">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="label">Storage</p>
          <h1 className="text-4xl text-ink sm:text-5xl" style={{ fontFamily: "var(--font-display)" }}>
            Library
          </h1>
        </div>
        <button className="btn btn-ghost" onClick={load}>
          <RefreshCw size={15} /> Refresh
        </button>
      </header>

      {err && <p className="mb-4 text-sm text-danger">{err}</p>}

      {loading ? (
        <p className="text-sm text-faint">Loading…</p>
      ) : titles.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-faint">
          Nothing archived yet. Downloads appear here once they finish uploading to S3.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-6">
          {titles.map((t) => (
            <button key={t.key} onClick={() => setActive(t)} className="group text-left" title={t.title}>
              <div className="relative aspect-[2/3] overflow-hidden rounded-lg border border-border bg-surface-2 transition-transform group-hover:scale-[1.04] group-hover:border-accent">
                {t.posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.posterUrl} alt={t.title} className="h-full w-full object-cover" loading="lazy" />
                ) : (
                  <div className="flex h-full items-center justify-center text-faint">
                    {t.kind === "TV" ? <Tv size={22} /> : <Film size={22} />}
                  </div>
                )}
                <span className="absolute right-1 top-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] text-white">{t.count}</span>
              </div>
              <p className="mt-1.5 truncate text-xs text-ink">{t.title}</p>
              <p className="mono truncate text-[11px] text-faint">{formatBytes(t.sizeBytes)}</p>
            </button>
          ))}
        </div>
      )}

      {/* Detail modal */}
      {active && (
        <div className="sheet fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={() => setActive(null)}>
          <div className="sheet-card max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-4 border-b border-border p-5">
              <div className="h-28 w-20 flex-none overflow-hidden rounded-lg bg-surface-2">
                {active.posterUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={active.posterUrl} alt="" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-lg font-semibold text-ink">{active.title}</h2>
                <p className="text-xs text-muted">
                  {active.kind} {active.year ? `· ${active.year}` : ""} · {active.count} file{active.count === 1 ? "" : "s"} · {formatBytes(active.sizeBytes)}
                </p>
              </div>
              <button onClick={() => setActive(null)} className="flex-none text-faint hover:text-ink">
                <X size={18} />
              </button>
            </div>
            <div className="divide-y divide-[color:var(--color-border)]">
              {active.items
                .slice()
                .sort((a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? 0) - (b.episode ?? 0))
                .map((i) => (
                  <div key={i.id} className="flex items-center gap-3 p-3">
                    <FolderOpen size={15} className="flex-none text-faint" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">{epLabel(i)}</p>
                      <p className="mono truncate text-[11px] text-faint">{formatBytes(i.sizeBytes)}</p>
                    </div>
                    {i.s3Key && (
                      <button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => open(i.s3Key!)} title="Open / stream">
                        <Play size={13} /> Open
                      </button>
                    )}
                  </div>
                ))}
            </div>
            <p className="flex items-center gap-1.5 border-t border-border p-3 text-[11px] text-faint">
              <HardDrive size={12} /> Tip: for smooth TV playback use the Jellyfin app — this opens the raw file.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
