"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  X,
  Search as SearchIcon,
  Loader2,
  Sparkles,
  Tv,
  Film,
  Check,
  RefreshCw,
} from "lucide-react";
import { jsonFetch } from "@/lib/client";
import { useConfirm } from "@/components/confirm-dialog";
import { TitleModal, type TitleSeed } from "@/components/title-modal";

/* ------------------------------- types -------------------------------- */
interface Taste {
  summary?: string;
  favoriteGenres?: string[];
  keywords?: string[];
  updatedAt?: string;
}
interface Rec {
  id: string;
  tmdbId: number;
  mediaType: "movie" | "tv";
  title: string;
  year: number | null;
  posterUrl: string | null;
  overview: string | null;
  reason: string | null;
  score: number;
}
interface Follow {
  id: string;
  tmdbId: number;
  title: string;
  year: number | null;
  posterUrl: string | null;
  status: string | null;
  autoDownload: boolean;
  quality: string;
  source: string;
  lastCheckedAt: string | null;
}
interface TmdbHit {
  tmdbId: number;
  mediaType: string;
  title: string;
  year?: number;
  posterUrl?: string;
}

/* ------------------------------ component ----------------------------- */
export default function DiscoverPage() {
  const [recs, setRecs] = useState<Rec[]>([]);
  const [taste, setTaste] = useState<Taste | null>(null);
  const [hasTmdb, setHasTmdb] = useState(true);
  const [hasJellyfin, setHasJellyfin] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [msg, setMsg] = useState("");

  const [follows, setFollows] = useState<Follow[]>([]);
  const [followQ, setFollowQ] = useState("");
  const [followHits, setFollowHits] = useState<TmdbHit[]>([]);
  const [searching, setSearching] = useState(false);

  const confirm = useConfirm();
  const [seed, setSeed] = useState<TitleSeed | null>(null);
  const [tab, setTab] = useState<"foryou" | "following">("foryou");
  const [showTaste, setShowTaste] = useState(false);
  const [recType, setRecType] = useState<"all" | "movie" | "tv">("all");

  const openRec = (r: Rec) =>
    setSeed({ tmdbId: r.tmdbId, mediaType: r.mediaType, title: r.title, year: r.year, posterUrl: r.posterUrl });

  const shownRecs = recType === "all" ? recs : recs.filter((r) => r.mediaType === recType);

  const loadRecs = useCallback(
    () =>
      jsonFetch<{ recommendations: Rec[]; taste: Taste | null; hasTmdb: boolean; hasJellyfin: boolean }>(
        "/api/recommendations",
      )
        .then((d) => {
          const shuffled = [...d.recommendations];
          for (let i = shuffled.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
          }
          setRecs(shuffled);
          setTaste(d.taste);
          setHasTmdb(d.hasTmdb);
          setHasJellyfin(d.hasJellyfin);
        })
        .catch(() => {}),
    [],
  );
  const loadFollows = useCallback(
    () => jsonFetch<{ shows: Follow[] }>("/api/follows").then((d) => setFollows(d.shows)).catch(() => {}),
    [],
  );

  useEffect(() => {
    loadRecs();
    loadFollows();
  }, [loadRecs, loadFollows]);

  async function refreshRecs() {
    setRefreshing(true);
    setMsg("Rebuilding your recommendations — reading watch history, asking the AI…");
    try {
      await jsonFetch("/api/recommendations", { method: "POST" });
      // Poll for the worker to finish.
      let tries = 0;
      const before = recs.length;
      const poll = setInterval(async () => {
        tries++;
        await loadRecs();
        const d = await jsonFetch<{ recommendations: Rec[] }>("/api/recommendations");
        if (d.recommendations.length !== before || tries > 20) {
          clearInterval(poll);
          setRefreshing(false);
          setMsg(d.recommendations.length ? "" : "No recommendations yet — watch or download something first, then refresh.");
        }
      }, 3000);
    } catch (e) {
      setMsg((e as Error).message);
      setRefreshing(false);
    }
  }

  async function recAction(r: Rec, action: "add" | "download" | "dismiss") {
    setRecs((cur) => cur.filter((x) => x.id !== r.id));
    try {
      const res = await jsonFetch<{ kind?: string }>(`/api/recommendations/${r.id}`, {
        method: "POST",
        body: JSON.stringify({ action }),
      });
      if (action !== "dismiss") {
        setMsg(res.kind === "follow" ? `Following “${r.title}” — new episodes will auto-download.` : `Queued “${r.title}”.`);
        if (res.kind === "follow") loadFollows();
      }
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function doFollowSearch(q: string) {
    setFollowQ(q);
    if (!q.trim()) {
      setFollowHits([]);
      return;
    }
    setSearching(true);
    try {
      const d = await jsonFetch<{ results: TmdbHit[] }>(`/api/tmdb/search?type=tv&q=${encodeURIComponent(q)}`);
      setFollowHits(d.results);
    } catch {
      setFollowHits([]);
    } finally {
      setSearching(false);
    }
  }
  async function follow(tmdbId: number, title: string) {
    setFollowHits([]);
    setFollowQ("");
    try {
      await jsonFetch("/api/follows", { method: "POST", body: JSON.stringify({ tmdbId }) });
      setMsg(`Following “${title}”. I'll grab new episodes the day after they air.`);
      loadFollows();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  async function unfollow(id: string) {
    setFollows((f) => f.filter((x) => x.id !== id));
    await fetch(`/api/follows/${id}`, { method: "DELETE" }).catch(() => {});
  }
  async function toggleAuto(f: Follow) {
    setFollows((cur) => cur.map((x) => (x.id === f.id ? { ...x, autoDownload: !x.autoDownload } : x)));
    await jsonFetch(`/api/follows/${f.id}`, {
      method: "PATCH",
      body: JSON.stringify({ autoDownload: !f.autoDownload }),
    }).catch(() => {});
  }

  /* ------------------------------- render ------------------------------ */
  return (
    <div className="mx-auto max-w-6xl px-5 py-6 sm:py-8 md:px-10">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="label">For you</p>
          <h1 className="text-4xl text-ink sm:text-5xl" style={{ fontFamily: "var(--font-display)" }}>
            Discover
          </h1>
        </div>
        <button
          className="btn btn-ghost px-3 py-1.5 text-xs text-muted"
          onClick={refreshRecs}
          disabled={refreshing}
          title="Refresh picks"
        >
          {refreshing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </header>

      {msg && <p className="mb-4 text-sm text-muted">{msg}</p>}

      {!hasTmdb && (
        <p className="mb-6 rounded-lg border border-border bg-surface p-3 text-sm text-muted">
          Add a <span className="text-ink">TMDB API key</span> in Settings to turn on personalized recommendations.
        </p>
      )}

      {/* Tabs */}
      <div className="mb-6 flex gap-2">
        {(["foryou", "following"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full border px-4 py-1.5 text-sm font-medium transition-colors ${
              tab === t ? "border-accent bg-accent/10 text-ink" : "border-border text-muted hover:text-ink"
            }`}
          >
            {t === "foryou" ? "For You" : `Following${follows.length ? ` · ${follows.length}` : ""}`}
          </button>
        ))}
      </div>

      {/* Movies / TV separator */}
      {tab === "foryou" && recs.length > 0 && (
        <div className="mb-5 flex gap-2">
          {(
            [
              ["all", "All"],
              ["movie", "Movies"],
              ["tv", "TV"],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setRecType(v)}
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                recType === v ? "border-accent bg-accent/10 text-ink" : "border-border text-muted hover:text-ink"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {/* Your taste — collapsed by default */}
      {tab === "foryou" && taste?.summary && (
        <div className="mb-5">
          <button
            className="flex items-center gap-1.5 text-xs text-muted hover:text-ink"
            onClick={() => setShowTaste((v) => !v)}
          >
            <Sparkles size={13} className="text-accent" /> Your taste {showTaste ? "▲" : "▼"}
          </button>
          {showTaste && (
            <div className="panel mt-2 p-4">
              <p className="text-sm text-muted">{taste.summary}</p>
              {!hasJellyfin && (
                <p className="mt-2 text-xs text-faint">Connect Jellyfin in Settings for sharper picks.</p>
              )}
              {!!taste.favoriteGenres?.length && (
                <div className="mt-3 flex flex-wrap gap-2">
                  {taste.favoriteGenres.map((g) => (
                    <span key={g} className="badge">{g}</span>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Following */}
      {tab === "following" && (
      <section className="mb-8">
        <div className="mb-3 flex items-center gap-2">
          <Tv size={16} className="text-accent" />
          <h2 className="label">Following</h2>
          <span className="badge">{follows.length}</span>
        </div>

        <div className="relative mb-4 max-w-md">
          <SearchIcon size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            className="input pl-9"
            placeholder="Follow a show — search TMDB…"
            value={followQ}
            onChange={(e) => doFollowSearch(e.target.value)}
          />
          {(followHits.length > 0 || searching) && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border border-border bg-surface shadow-lg">
              {searching && <p className="p-3 text-xs text-faint">Searching…</p>}
              {followHits.map((h) => (
                <button
                  key={h.tmdbId}
                  onClick={() => follow(h.tmdbId, h.title)}
                  className="flex w-full items-center gap-3 border-b border-border px-3 py-2 text-left last:border-0 hover:bg-surface-2"
                >
                  {h.posterUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={h.posterUrl} alt="" className="h-10 w-7 flex-none rounded object-cover" loading="lazy" />
                  ) : (
                    <span className="h-10 w-7 flex-none rounded bg-surface-2" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">
                    {h.title} {h.year ? <span className="text-faint">({h.year})</span> : null}
                  </span>
                  <Plus size={14} className="flex-none text-accent" />
                </button>
              ))}
            </div>
          )}
        </div>

        {follows.length === 0 ? (
          <p className="text-sm text-faint">
            Not following anything yet. Search above, or shows you watch in Jellyfin get followed automatically.
          </p>
        ) : (
          <div className="no-scrollbar flex gap-4 overflow-x-auto pb-2">
            {follows.map((f) => (
              <div key={f.id} className="w-32 flex-none">
                <div className="relative aspect-[2/3] overflow-hidden rounded-lg border border-border bg-surface-2">
                  {f.posterUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={f.posterUrl} alt={f.title} className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <div className="flex h-full items-center justify-center text-faint"><Tv size={22} /></div>
                  )}
                  <button
                    onClick={async () => {
                      if (
                        await confirm({
                          title: "Unfollow show?",
                          message: `Stop auto-downloading new episodes of “${f.title}”.`,
                          confirmLabel: "Unfollow",
                        })
                      ) {
                        unfollow(f.id);
                      }
                    }}
                    title="Unfollow"
                    className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white hover:bg-danger"
                  >
                    <X size={12} />
                  </button>
                </div>
                <p className="mt-1.5 truncate text-xs text-ink" title={f.title}>{f.title}</p>
                <button
                  onClick={() => toggleAuto(f)}
                  className="mt-1 flex items-center gap-1 text-[11px]"
                  style={{ color: f.autoDownload ? "var(--color-success)" : "var(--color-faint)" }}
                  title="Toggle auto-download of new episodes"
                >
                  {f.autoDownload ? <Check size={11} /> : <X size={11} />} auto
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
      )}

      {/* Recommendations */}
      {tab === "foryou" && (
      <section className="mb-8">
        <div className="mb-3 flex items-center gap-2">
          <Sparkles size={16} className="text-accent" />
          <h2 className="label">{recType === "movie" ? "Movies for you" : recType === "tv" ? "Shows for you" : "For you"}</h2>
          <span className="badge">{shownRecs.length}</span>
        </div>

        {recs.length === 0 ? (
          <p className="text-sm text-faint">
            {refreshing ? "Building your picks…" : "No picks yet. Hit “Refresh picks”. The more you watch, the better they get."}
          </p>
        ) : shownRecs.length === 0 ? (
          <p className="text-sm text-faint">
            No {recType === "movie" ? "movie" : "TV"} picks right now — try “All”.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
            {shownRecs.map((r) => (
              <div
                key={r.id}
                className="group relative overflow-hidden rounded-xl border border-border bg-surface transition-colors hover:border-accent"
              >
                <button onClick={() => openRec(r)} className="block w-full text-left" title={`More info — ${r.title}`}>
                  <div className="relative aspect-[2/3] bg-surface-2">
                    {r.posterUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={r.posterUrl} alt={r.title} className="h-full w-full object-cover" loading="lazy" />
                    ) : (
                      <div className="flex h-full items-center justify-center text-faint">
                        {r.mediaType === "tv" ? <Tv size={26} /> : <Film size={26} />}
                      </div>
                    )}
                    <span className="absolute left-2 top-2 rounded-full bg-black/70 px-2 py-0.5 text-[11px] font-medium text-white">
                      {r.mediaType === "tv" ? "TV" : "Movie"}
                    </span>
                  </div>
                  <div className="p-3">
                    <p className="truncate text-sm font-medium text-ink" title={r.title}>
                      {r.title} {r.year ? <span className="text-faint">({r.year})</span> : null}
                    </p>
                    {r.reason && <p className="mt-1 line-clamp-2 text-xs text-muted">{r.reason}</p>}
                  </div>
                </button>
                <button
                  onClick={() => recAction(r, "dismiss")}
                  title="Not interested"
                  aria-label="Dismiss"
                  className="absolute right-2 top-2 z-10 rounded-full bg-black/60 p-1.5 text-white transition-opacity hover:bg-danger sm:opacity-0 sm:group-hover:opacity-100"
                >
                  <X size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
      )}

      {seed && <TitleModal seed={seed} onClose={() => setSeed(null)} />}
    </div>
  );
}
