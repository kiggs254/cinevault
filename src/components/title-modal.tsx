"use client";

import { useEffect, useState } from "react";
import { X, Download, Loader2, Plus, Check, Tv, Film, Star, Play, Bell } from "lucide-react";
import { jsonFetch } from "@/lib/client";
import { TrailerModal, type TrailerSeed } from "./trailer-modal";
import { EpisodeBrowser } from "./episode-browser";

interface CastMember {
  name: string;
  character?: string | null;
  profileUrl?: string | null;
}

/** "134" → "2h 14m", "45" → "45m". */
function formatRuntime(min?: number | null): string | undefined {
  if (!min || min <= 0) return undefined;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h${m ? ` ${m}m` : ""}` : `${m}m`;
}

/** "1234" → "1.2k", "2500000" → "2.5M". */
function formatCount(n?: number | null): string | undefined {
  if (!n || n <= 0) return undefined;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

/** "2026-07-26" → "Jul 26, 2026". */
function formatDate(d?: string | null): string | undefined {
  if (!d) return undefined;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return undefined;
  return dt.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

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
  subscribed?: boolean;
  voteAverage?: number | null;
  voteCount?: number | null;
  runtime?: number | null;
  genres?: string[] | null;
  tagline?: string | null;
  releaseDate?: string | null;
  numberOfSeasons?: number | null;
  numberOfEpisodes?: number | null;
  certification?: string | null;
  cast?: CastMember[] | null;
  followed?: boolean;
  followId?: string | null;
}

export function TitleModal({ seed, onClose }: { seed: TitleSeed; onClose: () => void }) {
  const [details, setDetails] = useState<Details | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [following, setFollowing] = useState(false);
  const [followId, setFollowId] = useState<string | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [trailer, setTrailer] = useState<TrailerSeed | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    jsonFetch<{ details: Details }>(`/api/tmdb/details?type=${seed.mediaType}&id=${seed.tmdbId}`)
      .then((d) => {
        if (!alive) return;
        setDetails(d.details);
        setFollowId(d.details.followId ?? null);
        setSubscribed(!!d.details.subscribed);
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

  async function downloadMovie() {
    setBusy(true);
    setMsg("");
    try {
      await jsonFetch("/api/download/tmdb", {
        method: "POST",
        body: JSON.stringify({ tmdbId: seed.tmdbId, mediaType: "movie", title: details?.title ?? seed.title, year: details?.year ?? seed.year }),
      });
      setMsg("Adding to your library — it'll be ready to watch shortly.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleSubscribe() {
    setBusy(true);
    setMsg("");
    try {
      if (subscribed) {
        await jsonFetch(`/api/wanted/${seed.tmdbId}`, { method: "DELETE" });
        setSubscribed(false);
        setMsg("Unsubscribed.");
      } else {
        await jsonFetch("/api/wanted", {
          method: "POST",
          body: JSON.stringify({ tmdbId: seed.tmdbId }),
        });
        setSubscribed(true);
        setMsg("Subscribed — we'll grab it automatically once a real release appears.");
      }
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function playOnJellyfin() {
    setMsg("");
    try {
      const d = await jsonFetch<{ url?: string }>(
        `/api/jellyfin/resolve?tmdbId=${seed.tmdbId}&type=${seed.mediaType}`,
      );
      if (d.url && typeof window !== "undefined") window.open(d.url, "_blank", "noopener");
      else setMsg("Not on Jellyfin yet — give the library a minute to scan.");
    } catch {
      setMsg("Not on Jellyfin yet — give the library a minute to scan.");
    }
  }

  async function downloadSeason(season: number) {
    setMsg("");
    await jsonFetch("/api/download/tmdb", {
      method: "POST",
      body: JSON.stringify({
        tmdbId: seed.tmdbId,
        mediaType: "tv",
        title: details?.title ?? seed.title,
        year: details?.year ?? seed.year,
        seasons: [season],
      }),
    });
    setMsg(`Adding Season ${season} to your library — episodes appear as they're ready.`);
  }

  async function downloadAllSeasons() {
    const seasons = (details?.seasons ?? [])
      .filter((s) => s.released && s.seasonNumber >= 1)
      .map((s) => s.seasonNumber);
    if (seasons.length === 0) {
      setMsg("No released seasons yet.");
      return;
    }
    setBusy(true);
    setMsg("");
    try {
      await jsonFetch("/api/download/tmdb", {
        method: "POST",
        body: JSON.stringify({
          tmdbId: seed.tmdbId,
          mediaType: "tv",
          title: details?.title ?? seed.title,
          year: details?.year ?? seed.year,
          seasons,
        }),
      });
      setMsg(
        `Adding ${seasons.length} season${seasons.length === 1 ? "" : "s"} to your library — episodes appear as they're ready.`,
      );
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function downloadEpisode(season: number, episode: number) {
    setMsg("");
    await jsonFetch("/api/download/tmdb", {
      method: "POST",
      body: JSON.stringify({
        tmdbId: seed.tmdbId,
        mediaType: "tv",
        title: details?.title ?? seed.title,
        year: details?.year ?? seed.year,
        season,
        episode,
      }),
    });
  }

  async function toggleFollow() {
    setFollowing(true);
    setMsg("");
    try {
      if (followId) {
        await jsonFetch(`/api/follows/${followId}`, { method: "DELETE" });
        setFollowId(null);
        setMsg("Unfollowed.");
      } else {
        const r = await jsonFetch<{ show: { id: string } }>("/api/follows", {
          method: "POST",
          body: JSON.stringify({ tmdbId: seed.tmdbId }),
        });
        setFollowId(r.show.id);
        setMsg("Following — new episodes auto-download the day after they air.");
      }
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setFollowing(false);
    }
  }

  const backdrop = details?.backdropUrl || seed.posterUrl;

  const isMovie = seed.mediaType === "movie";
  // A movie not yet out (status other than "Released", or a future release date)
  // can't be grabbed yet — offer a subscription instead of a download.
  const releaseTs = details?.releaseDate ? Date.parse(details.releaseDate) : NaN;
  const isUpcomingMovie =
    isMovie &&
    !details?.ownedMovie &&
    ((!!details?.status && details.status !== "Released") ||
      (Number.isFinite(releaseTs) && releaseTs > Date.now()));
  const rating =
    typeof details?.voteAverage === "number" && details.voteAverage > 0 ? details.voteAverage : null;
  const ratingCount = formatCount(details?.voteCount);
  const runtimeLabel = isMovie
    ? formatRuntime(details?.runtime)
    : details?.numberOfSeasons
      ? `${details.numberOfSeasons} season${details.numberOfSeasons === 1 ? "" : "s"}` +
        (details?.numberOfEpisodes ? ` · ${details.numberOfEpisodes} eps` : "")
      : undefined;
  const dateLabel = formatDate(details?.releaseDate);
  const showMetaStrip = !!(rating || details?.certification || runtimeLabel || dateLabel);
  const releasedSeasons = (details?.seasons ?? []).filter((s) => s.released && s.seasonNumber >= 1);
  const allSeasonsOwned = releasedSeasons.length > 0 && releasedSeasons.every((s) => s.owned);
  const anySeasonOwned = releasedSeasons.some((s) => s.owned);

  return (
    <div className="sheet fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={onClose}>
      <div
        className="sheet-card max-h-[90vh] w-full max-w-2xl overflow-hidden overflow-y-auto rounded-2xl border border-border bg-surface"
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
              {showMetaStrip && (
                <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
                  {rating && (
                    <span className="inline-flex items-center gap-1 font-semibold text-ink">
                      <Star size={13} className="fill-accent text-accent" />
                      {rating.toFixed(1)}
                      {ratingCount && <span className="font-normal text-faint">({ratingCount})</span>}
                    </span>
                  )}
                  {details?.certification && (
                    <span className="rounded border border-border px-1.5 py-0.5 font-medium text-muted">
                      {details.certification}
                    </span>
                  )}
                  {runtimeLabel && <span className="text-muted">{runtimeLabel}</span>}
                  {dateLabel && <span className="text-muted">{dateLabel}</span>}
                </div>
              )}

              {details?.genres && details.genres.length > 0 && (
                <div className="mb-4 flex flex-wrap gap-1.5">
                  {details.genres.map((g) => (
                    <span
                      key={g}
                      className="rounded-full border border-border bg-surface-2 px-2.5 py-0.5 text-[11px] text-muted"
                    >
                      {g}
                    </span>
                  ))}
                </div>
              )}

              {details?.tagline && (
                <p className="mb-3 text-sm italic text-faint">“{details.tagline}”</p>
              )}

              {details?.overview && <p className="mb-5 text-sm text-muted">{details.overview}</p>}

              {details?.cast && details.cast.length > 0 && (
                <div className="mb-5">
                  <p className="label mb-1.5">Cast</p>
                  <p className="text-sm text-muted">{details.cast.map((c) => c.name).join(", ")}</p>
                </div>
              )}

              <button
                className="btn btn-ghost mb-3 w-full"
                onClick={() =>
                  setTrailer({
                    tmdbId: seed.tmdbId,
                    mediaType: seed.mediaType,
                    title: details?.title ?? seed.title,
                  })
                }
              >
                <Play size={15} /> Watch trailer
              </button>

              {seed.mediaType === "movie" ? (
                details?.ownedMovie ? (
                  <button className="btn btn-accent w-full" onClick={playOnJellyfin}>
                    <Play size={15} /> Play on Jellyfin
                  </button>
                ) : isUpcomingMovie ? (
                  <button
                    className={`btn w-full ${subscribed ? "btn-ghost" : "btn-accent"}`}
                    onClick={toggleSubscribe}
                    disabled={busy}
                  >
                    {busy ? (
                      <Loader2 size={15} className="animate-spin" />
                    ) : subscribed ? (
                      <Check size={15} />
                    ) : (
                      <Bell size={15} />
                    )}
                    {subscribed ? "Subscribed — auto-download" : "Notify + auto-download when out"}
                  </button>
                ) : (
                  <button className="btn btn-accent w-full" onClick={downloadMovie} disabled={busy}>
                    {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                    Add to my library
                  </button>
                )
              ) : (
                <>
                  {anySeasonOwned && (
                    <button className="btn btn-accent mb-3 w-full" onClick={playOnJellyfin}>
                      <Play size={15} /> Play on Jellyfin
                    </button>
                  )}
                  {releasedSeasons.length > 0 && (
                    <button
                      className={`btn mb-3 w-full ${anySeasonOwned ? "btn-ghost" : "btn-accent"}`}
                      onClick={downloadAllSeasons}
                      disabled={busy || allSeasonsOwned}
                    >
                      {busy ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
                      {allSeasonsOwned
                        ? "All seasons in your library"
                        : releasedSeasons.length > 1
                          ? `Add all ${releasedSeasons.length} seasons`
                          : "Add season to my library"}
                    </button>
                  )}
                  <div className="mb-3 flex items-center justify-between">
                    <p className="label">Episodes</p>
                    <button
                      className={`btn px-2 py-1 text-xs ${followId ? "btn-accent" : "btn-ghost"}`}
                      onClick={toggleFollow}
                      disabled={following}
                    >
                      {following ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : followId ? (
                        <Check size={13} />
                      ) : (
                        <Plus size={13} />
                      )}
                      {followId ? "Following" : "Follow"}
                    </button>
                  </div>
                  <EpisodeBrowser
                    tmdbId={seed.tmdbId}
                    seasons={details?.seasons ?? []}
                    mode="browse"
                    onDownloadEpisode={downloadEpisode}
                    onDownloadSeason={downloadSeason}
                  />
                </>
              )}

              {msg && <p className="mt-3 text-center text-xs text-muted">{msg}</p>}
            </>
          )}
        </div>
      </div>
      {trailer && <TrailerModal seed={trailer} onClose={() => setTrailer(null)} />}
    </div>
  );
}
