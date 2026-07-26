"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Download, Play, Check, Film, Clock } from "lucide-react";
import { jsonFetch } from "@/lib/client";

export interface SeasonInfo {
  seasonNumber: number;
  episodeCount?: number;
  released?: boolean;
}

interface EpisodeInfo {
  episodeNumber: number;
  name: string | null;
  overview: string | null;
  stillUrl: string | null;
  airDate: string | null;
  runtime: number | null;
  voteAverage: number | null;
  released: boolean;
  owned: boolean;
  download: { id: string; s3Key: string | null; sizeBytes: number; status: string } | null;
}

const pad = (n: number) => String(n).padStart(2, "0");
function fmtDate(d?: string | null): string {
  if (!d) return "TBA";
  const dt = new Date(d);
  return Number.isNaN(dt.getTime())
    ? "TBA"
    : dt.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Season pills + a rich episode list (thumbnail, title, air date, overview) with
 * per-episode state. `browse` mode offers downloads; `library` mode opens owned
 * files and surfaces missing / not-yet-aired episodes.
 */
export function EpisodeBrowser({
  tmdbId,
  seasons,
  initialSeason,
  mode,
  onDownloadEpisode,
  onDownloadSeason,
  onOpen,
}: {
  tmdbId: number;
  seasons?: SeasonInfo[];
  initialSeason?: number;
  mode: "browse" | "library";
  onDownloadEpisode?: (season: number, episode: number) => Promise<void> | void;
  onDownloadSeason?: (season: number) => Promise<void> | void;
  onOpen?: (s3Key: string) => void;
}) {
  const [seasonList, setSeasonList] = useState<SeasonInfo[]>(seasons ?? []);
  const valid = useMemo(
    () => seasonList.filter((s) => s.seasonNumber >= 1).sort((a, b) => a.seasonNumber - b.seasonNumber),
    [seasonList],
  );
  const [active, setActive] = useState<number>(initialSeason ?? 0);
  const [eps, setEps] = useState<EpisodeInfo[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [busyEp, setBusyEp] = useState<number | null>(null);
  const [seasonBusy, setSeasonBusy] = useState(false);

  // Fetch the season list if not supplied by the parent.
  useEffect(() => {
    if ((seasons?.length ?? 0) > 0) {
      setSeasonList(seasons!);
      return;
    }
    let alive = true;
    jsonFetch<{ details: { seasons?: SeasonInfo[] } }>(`/api/tmdb/details?type=tv&id=${tmdbId}`)
      .then((d) => alive && setSeasonList(d.details.seasons ?? []))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [tmdbId, seasons]);

  // Default the active season once the list is known.
  useEffect(() => {
    if (active >= 1 || valid.length === 0) return;
    setActive(initialSeason ?? valid[valid.length - 1].seasonNumber);
  }, [valid, active, initialSeason]);

  const loadEpisodes = useMemo(
    () => (season: number) =>
      jsonFetch<{ episodes: EpisodeInfo[] }>(`/api/tmdb/season?type=tv&id=${tmdbId}&season=${season}`),
    [tmdbId],
  );

  useEffect(() => {
    if (active < 1) return;
    let alive = true;
    setLoading(true);
    setEps(null);
    loadEpisodes(active)
      .then((d) => alive && setEps(d.episodes))
      .catch(() => alive && setEps([]))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [active, loadEpisodes]);

  async function refresh() {
    if (active < 1) return;
    loadEpisodes(active)
      .then((d) => setEps(d.episodes))
      .catch(() => {});
  }

  async function dlEpisode(e: EpisodeInfo) {
    if (!onDownloadEpisode) return;
    setBusyEp(e.episodeNumber);
    try {
      await onDownloadEpisode(active, e.episodeNumber);
      await refresh();
    } finally {
      setBusyEp(null);
    }
  }

  return (
    <div>
      {valid.length > 1 && (
        <div className="no-scrollbar mb-3 flex gap-1.5 overflow-x-auto pb-1">
          {valid.map((s) => (
            <button
              key={s.seasonNumber}
              onClick={() => setActive(s.seasonNumber)}
              className={`flex-none rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                active === s.seasonNumber
                  ? "border-accent bg-accent/10 text-ink"
                  : "border-border text-muted hover:text-ink"
              }`}
            >
              Season {s.seasonNumber}
            </button>
          ))}
        </div>
      )}

      {onDownloadSeason && active >= 1 && (
        <button
          className="btn btn-ghost mb-3 w-full text-sm"
          disabled={seasonBusy}
          onClick={async () => {
            setSeasonBusy(true);
            try {
              await onDownloadSeason(active);
              await refresh();
            } finally {
              setSeasonBusy(false);
            }
          }}
        >
          {seasonBusy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
          {mode === "library" ? "Grab missing episodes" : `Download all of Season ${active}`}
        </button>
      )}

      {loading ? (
        <p className="flex items-center gap-2 py-4 text-sm text-faint">
          <Loader2 size={14} className="animate-spin" /> Loading episodes…
        </p>
      ) : !eps || eps.length === 0 ? (
        <p className="py-4 text-sm text-faint">No episode info.</p>
      ) : (
        <div className="space-y-2">
          {eps.map((e) => {
            const completed = e.download?.status === "COMPLETED";
            const playable = mode === "library" && completed && !!e.download?.s3Key;
            return (
              <div
                key={e.episodeNumber}
                className={`flex gap-3 rounded-lg border border-border p-2 ${e.released ? "bg-surface-2/40" : "opacity-70"}`}
              >
                <div className="relative aspect-video w-24 flex-none overflow-hidden rounded bg-surface-2 sm:w-28">
                  {e.stillUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={e.stillUrl}
                      alt=""
                      className={`h-full w-full object-cover ${e.released ? "" : "opacity-50"}`}
                      loading="lazy"
                    />
                  ) : (
                    <span className="flex h-full items-center justify-center text-faint">
                      <Film size={16} />
                    </span>
                  )}
                  <span className="absolute left-1 top-1 rounded bg-black/70 px-1 text-[10px] font-medium text-white">
                    E{pad(e.episodeNumber)}
                  </span>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">
                    {e.name || `Episode ${e.episodeNumber}`}
                  </p>
                  <p className="flex items-center gap-1 text-[11px] text-faint">
                    {!e.released && <Clock size={10} />}
                    {fmtDate(e.airDate)}
                    {e.runtime ? ` · ${e.runtime}m` : ""}
                  </p>
                  {e.overview && <p className="mt-1 line-clamp-2 text-xs text-muted">{e.overview}</p>}
                </div>

                <div className="flex flex-none items-center">
                  {!e.released ? (
                    <span className="text-[11px] text-faint">Not aired</span>
                  ) : playable ? (
                    <button
                      className="btn btn-ghost px-2.5 py-1.5 text-xs"
                      onClick={() => e.download?.s3Key && onOpen?.(e.download.s3Key)}
                    >
                      <Play size={13} /> Open
                    </button>
                  ) : e.owned ? (
                    <span className="flex items-center gap-1 text-[11px] text-success">
                      <Check size={13} /> {completed ? "Downloaded" : "Downloading"}
                    </span>
                  ) : onDownloadEpisode ? (
                    <button
                      className="btn btn-ghost px-2.5 py-1.5 text-xs"
                      disabled={busyEp === e.episodeNumber}
                      onClick={() => dlEpisode(e)}
                    >
                      {busyEp === e.episodeNumber ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Download size={13} />
                      )}
                      {mode === "library" ? "Get" : ""}
                    </button>
                  ) : (
                    <span className="text-[11px] text-danger/80">Missing</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
