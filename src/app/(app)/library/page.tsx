"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, X, Play, FolderOpen, Tv, Film, HardDrive, Loader2, Search as SearchIcon } from "lucide-react";
import { overallProgress } from "@/lib/progress";
import { jsonFetch } from "@/lib/client";
import { formatBytes } from "@/lib/util";
import { EpisodeBrowser } from "@/components/episode-browser";

interface Item {
  id: string;
  releaseName: string;
  season: number | null;
  episode: number | null;
  status: string;
  progress: number;
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
  genres: string[];
  count: number;
  downloading: boolean;
  sizeBytes: number;
  items: Item[];
}

const ACTIVE_ST = ["QUEUED", "SEARCHING", "DOWNLOADING", "UPLOADING"];

function epLabel(i: Item): string {
  if (i.season != null && i.episode != null) return `S${String(i.season).padStart(2, "0")}E${String(i.episode).padStart(2, "0")}`;
  if (i.season != null) return `Season ${i.season}`;
  return i.releaseName;
}

/** A group's overall "adding" progress (0-100) — the furthest-along active file,
 * on a single forward-only scale across search/download/upload. */
function addingPct(t: TitleGroup): number {
  const act = t.items.filter((i) => ACTIVE_ST.includes(i.status));
  if (!act.length) return 0;
  return Math.round(Math.max(...act.map((i) => overallProgress(i.status, i.progress || 0))));
}

/** Human phase for the poster overlay ("Finding a source" / "Adding 45%" / "Finishing up 92%"). */
function addingLabel(t: TitleGroup): string {
  const act = t.items.filter((i) => ACTIVE_ST.includes(i.status));
  if (!act.length) return "Adding…";
  const lead = act.reduce((a, b) =>
    overallProgress(b.status, b.progress || 0) > overallProgress(a.status, a.progress || 0) ? b : a,
  );
  const pct = addingPct(t);
  if (lead.status === "QUEUED" || lead.status === "SEARCHING") return "Finding a source…";
  if (lead.status === "UPLOADING") return `Finishing up ${pct}%`;
  return `Adding ${pct}%`;
}

export default function LibraryPage() {
  const [titles, setTitles] = useState<TitleGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [active, setActive] = useState<TitleGroup | null>(null);
  const [type, setType] = useState<"all" | "movie" | "tv">("all");
  const [genre, setGenre] = useState("");
  const [query, setQuery] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);

  // Only the admin sees raw filenames / sizes / open-raw; members watch via Jellyfin.
  useEffect(() => {
    fetch("/api/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setIsAdmin(d?.role === "admin"))
      .catch(() => {});
  }, []);

  const allGenres = useMemo(
    () => [...new Set(titles.flatMap((t) => t.genres ?? []))].sort((a, b) => a.localeCompare(b)),
    [titles],
  );
  const shown = useMemo(
    () =>
      titles.filter((t) => {
        if (type === "movie" && t.kind !== "MOVIE") return false;
        if (type === "tv" && t.kind !== "TV") return false;
        if (genre && !(t.genres ?? []).includes(genre)) return false;
        if (query.trim() && !t.title.toLowerCase().includes(query.trim().toLowerCase())) return false;
        return true;
      }),
    [titles, type, genre, query],
  );

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

  // While anything is still being added, refresh so progress advances and newly
  // ready titles appear without a manual reload.
  const anyDownloading = titles.some((t) => t.downloading);
  useEffect(() => {
    if (!anyDownloading) return;
    const t = setInterval(() => void load(), 8000);
    return () => clearInterval(t);
  }, [anyDownloading, load]);

  async function open(key: string) {
    try {
      const { url } = await jsonFetch<{ url: string }>(`/api/library?presign=${encodeURIComponent(key)}`);
      window.open(url, "_blank", "noopener");
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  async function openJellyfin(g: TitleGroup) {
    if (!g.tmdbId) return;
    try {
      const { url } = await jsonFetch<{ url: string }>(
        `/api/jellyfin/resolve?tmdbId=${g.tmdbId}&type=${g.kind === "TV" ? "tv" : "movie"}`,
      );
      window.open(url, "_blank", "noopener");
    } catch {
      setErr("Not on Jellyfin yet — give the library a minute to catch up.");
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
          Your library is empty. Add a film or show from Discover or Search and it&apos;ll appear here, ready to
          watch.
        </p>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-2">
            {(
              [
                ["all", "All"],
                ["movie", "Movies"],
                ["tv", "TV"],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setType(v)}
                className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                  type === v ? "border-accent bg-accent/10 text-ink" : "border-border text-muted hover:text-ink"
                }`}
              >
                {label}
              </button>
            ))}
            {allGenres.length > 0 && (
              <select
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                className="input w-auto py-1.5 text-xs"
                aria-label="Filter by genre"
              >
                <option value="">All genres</option>
                {allGenres.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            )}
            <div className="relative ml-auto">
              <SearchIcon size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" />
              <input
                className="input w-40 py-1.5 pl-8 text-xs"
                placeholder="Filter titles…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>

          {shown.length === 0 ? (
            <p className="rounded-lg border border-border bg-surface p-6 text-center text-sm text-faint">
              No titles match these filters.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-4 sm:grid-cols-4 md:grid-cols-6">
              {shown.map((t) => (
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
                    {t.count > 0 && (
                      <span className="absolute right-1 top-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] text-white">{t.count}</span>
                    )}
                    {t.downloading && (
                      <div className="absolute inset-x-0 bottom-0">
                        <div className="flex items-center justify-center gap-1 bg-black/80 px-1.5 py-1 text-[10px] font-medium text-accent">
                          <Loader2 size={10} className="animate-spin" /> {addingLabel(t)}
                        </div>
                        <div className="h-1 w-full bg-black/70">
                          <div
                            className="h-full bg-accent transition-all duration-500"
                            style={{ width: `${Math.max(4, addingPct(t))}%` }}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                  <p className="mt-1.5 truncate text-xs text-ink">{t.title}</p>
                  {(t.downloading || isAdmin) && (
                    <p className="mono truncate text-[11px] text-faint">
                      {t.downloading ? "Adding to your library…" : formatBytes(t.sizeBytes)}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </>
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
                  {active.kind === "TV" ? "TV series" : "Movie"}
                  {active.year ? ` · ${active.year}` : ""}
                  {isAdmin ? ` · ${active.count} file${active.count === 1 ? "" : "s"} · ${formatBytes(active.sizeBytes)}` : ""}
                </p>
              </div>
              <button onClick={() => setActive(null)} className="flex-none text-faint hover:text-ink">
                <X size={18} />
              </button>
            </div>
            {active.tmdbId && active.count > 0 && (
              <div className="border-b border-border p-4">
                <button className="btn btn-accent w-full" onClick={() => openJellyfin(active)}>
                  <Play size={15} /> Play on Jellyfin
                </button>
                <p className="mt-2 text-center text-[11px] text-faint">Opens in the Jellyfin app / web player.</p>
              </div>
            )}
            {active.kind === "TV" && active.tmdbId ? (
              <div className="p-4">
                <EpisodeBrowser
                  tmdbId={active.tmdbId}
                  mode="library"
                  initialSeason={active.items.reduce((m, i) => Math.max(m, i.season ?? 0), 0) || undefined}
                  onOpen={open}
                  allowOpen={isAdmin}
                  onDownloadEpisode={(season, episode) =>
                    jsonFetch("/api/download/tmdb", {
                      method: "POST",
                      body: JSON.stringify({
                        tmdbId: active.tmdbId,
                        mediaType: "tv",
                        title: active.title,
                        year: active.year,
                        season,
                        episode,
                      }),
                    }).then(() => {})
                  }
                  onDownloadSeason={(season) =>
                    jsonFetch("/api/download/tmdb", {
                      method: "POST",
                      body: JSON.stringify({
                        tmdbId: active.tmdbId,
                        mediaType: "tv",
                        title: active.title,
                        year: active.year,
                        seasons: [season],
                      }),
                    }).then(() => {})
                  }
                />
              </div>
            ) : isAdmin ? (
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
            ) : (
              <p className="p-5 text-center text-sm text-faint">
                It&apos;s in your library — press <span className="text-ink">Play on Jellyfin</span> above to watch.
              </p>
            )}
            {isAdmin && (
              <p className="flex items-center gap-1.5 border-t border-border p-3 text-[11px] text-faint">
                <HardDrive size={12} /> Admin: “Open” streams the raw file. Members watch on Jellyfin.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
