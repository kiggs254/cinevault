"use client";

import { useEffect, useState } from "react";
import { X, Download, Loader2, Check, Plus, Tv, Film } from "lucide-react";
import { jsonFetch } from "@/lib/client";

export interface TitleSeed {
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  year?: number | null;
  posterUrl?: string | null;
}

interface Season {
  seasonNumber: number;
  episodeCount: number;
  name?: string;
  airDate?: string;
  released: boolean;
  owned: boolean;
}
interface Details {
  title: string;
  year?: number | null;
  overview?: string | null;
  posterUrl?: string | null;
  backdropUrl?: string | null;
  status?: string | null;
  seasons?: Season[];
  ownedMovie?: boolean;
}

export function TitleModal({ seed, onClose }: { seed: TitleSeed; onClose: () => void }) {
  const [details, setDetails] = useState<Details | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [following, setFollowing] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    jsonFetch<{ details: Details }>(`/api/tmdb/details?type=${seed.mediaType}&id=${seed.tmdbId}`)
      .then((d) => {
        if (!alive) return;
        setDetails(d.details);
        // Pre-select released, not-yet-owned seasons.
        if (d.details.seasons) {
          setSelected(new Set(d.details.seasons.filter((s) => s.released && !s.owned).map((s) => s.seasonNumber)));
        }
      })
      .catch(() => setMsg("Couldn't load details."))
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

  function toggleSeason(n: number) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }

  async function downloadMovie() {
    setBusy(true);
    setMsg("");
    try {
      await jsonFetch("/api/download/tmdb", {
        method: "POST",
        body: JSON.stringify({ tmdbId: seed.tmdbId, mediaType: "movie", title: details?.title ?? seed.title, year: details?.year ?? seed.year }),
      });
      setMsg("Queued — 720p, downloading to your library.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function downloadSeasons() {
    if (selected.size === 0) return;
    setBusy(true);
    setMsg("");
    try {
      const r = await jsonFetch<{ queued: string[]; failed: number[] }>("/api/download/tmdb", {
        method: "POST",
        body: JSON.stringify({ tmdbId: seed.tmdbId, mediaType: "tv", title: details?.title ?? seed.title, year: details?.year ?? seed.year, seasons: [...selected] }),
      });
      const parts = [];
      if (r.queued.length) parts.push(`Queued ${r.queued.join(", ")}`);
      if (r.failed.length) parts.push(`no release for Season ${r.failed.join(", ")}`);
      setMsg(parts.join(" · ") || "Nothing queued.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function follow() {
    setFollowing(true);
    try {
      await jsonFetch("/api/follows", { method: "POST", body: JSON.stringify({ tmdbId: seed.tmdbId }) });
      setMsg("Following — new episodes auto-download the day after they air.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setFollowing(false);
    }
  }

  const backdrop = details?.backdropUrl || seed.posterUrl;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-2xl overflow-hidden overflow-y-auto rounded-2xl border border-border bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Backdrop */}
        <div className="relative aspect-video w-full bg-surface-2">
          {backdrop && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={backdrop} alt="" className="h-full w-full object-cover" />
          )}
          <div className="absolute inset-0" style={{ background: "linear-gradient(to top, var(--color-surface), transparent 60%)" }} />
          <button onClick={onClose} className="absolute right-3 top-3 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80">
            <X size={18} />
          </button>
          <div className="absolute bottom-3 left-4 right-4">
            <h2 className="text-2xl font-bold text-white drop-shadow" style={{ fontFamily: "var(--font-display)" }}>
              {details?.title ?? seed.title}
            </h2>
            <p className="flex items-center gap-2 text-xs text-white/80">
              {seed.mediaType === "tv" ? <Tv size={12} /> : <Film size={12} />}
              {(details?.year ?? seed.year) || ""}
              {details?.status ? ` · ${details.status}` : ""}
            </p>
          </div>
        </div>

        <div className="p-5">
          {loading ? (
            <p className="flex items-center gap-2 text-sm text-faint"><Loader2 size={15} className="animate-spin" /> Loading…</p>
          ) : (
            <>
              {details?.overview && <p className="mb-5 text-sm text-muted">{details.overview}</p>}

              {seed.mediaType === "movie" ? (
                <button className="btn btn-accent w-full" onClick={downloadMovie} disabled={busy || details?.ownedMovie}>
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                  {details?.ownedMovie ? "In your library" : "Download (720p)"}
                </button>
              ) : (
                <>
                  <div className="mb-2 flex items-center justify-between">
                    <p className="label">Select seasons</p>
                    <button className="btn btn-ghost px-2 py-1 text-xs" onClick={follow} disabled={following}>
                      {following ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Follow
                    </button>
                  </div>
                  <div className="mb-4 grid max-h-56 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
                    {(details?.seasons ?? []).map((s) => {
                      const on = selected.has(s.seasonNumber);
                      const disabled = !s.released || s.owned;
                      return (
                        <button
                          key={s.seasonNumber}
                          onClick={() => !disabled && toggleSeason(s.seasonNumber)}
                          disabled={disabled}
                          className={`flex items-center justify-between rounded-lg border px-3 py-2 text-left text-sm transition-colors ${
                            on ? "border-accent bg-accent/10 text-ink" : "border-border text-muted"
                          } ${disabled ? "opacity-45" : "hover:border-accent"}`}
                        >
                          <span>
                            S{s.seasonNumber}
                            <span className="ml-1 text-xs text-faint">{s.episodeCount}ep</span>
                          </span>
                          {s.owned ? (
                            <Check size={14} className="text-success" />
                          ) : !s.released ? (
                            <span className="text-[10px] text-faint">soon</span>
                          ) : on ? (
                            <Check size={14} className="text-accent" />
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                  <button className="btn btn-accent w-full" onClick={downloadSeasons} disabled={busy || selected.size === 0}>
                    {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                    Download {selected.size || ""} season{selected.size === 1 ? "" : "s"} (720p)
                  </button>
                </>
              )}

              {msg && <p className="mt-3 text-center text-xs text-muted">{msg}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
