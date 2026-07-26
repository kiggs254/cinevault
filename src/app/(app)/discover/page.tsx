"use client";

import { useEffect, useState } from "react";
import {
  Compass,
  RefreshCw,
  Plus,
  Trash2,
  Download,
  X,
  Rss,
  Search as SearchIcon,
  Loader2,
  Save,
} from "lucide-react";
import { jsonFetch } from "@/lib/client";
import { formatBytes } from "@/lib/util";

interface Profile {
  interests: string[];
  autoGrabEnabled: boolean;
  autoGrabThreshold: number;
  legalIndexerIds: number[];
}
interface Indexer { id: number; name: string; privacy?: string; enable?: boolean }
interface Watch {
  id: string;
  type: "SEARCH" | "RSS";
  label: string;
  query: string | null;
  feedUrl: string | null;
  kind: string;
  autoGrab: boolean;
  enabled: boolean;
  lastRunAt: string | null;
}
interface FeedItem {
  id: string;
  title: string;
  source: string | null;
  kind: string;
  size: number;
  seeders: number | null;
  matchScore: number;
  status: string;
}

const KINDS = ["TV", "MOVIE", "MUSIC", "SOFTWARE", "OTHER"];

export default function DiscoverPage() {
  const [profile, setProfile] = useState<Profile>({
    interests: [],
    autoGrabEnabled: false,
    autoGrabThreshold: 80,
    legalIndexerIds: [],
  });
  const [indexers, setIndexers] = useState<Indexer[]>([]);
  const [watches, setWatches] = useState<Watch[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [interestInput, setInterestInput] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [msg, setMsg] = useState("");

  const [wType, setWType] = useState<"SEARCH" | "RSS">("SEARCH");
  const [wQuery, setWQuery] = useState("");
  const [wFeed, setWFeed] = useState("");
  const [wLabel, setWLabel] = useState("");
  const [wKind, setWKind] = useState("TV");
  const [adding, setAdding] = useState(false);

  const loadProfile = () => jsonFetch<{ profile: Profile }>("/api/profile").then((d) => setProfile(d.profile)).catch(() => {});
  const loadIndexers = () => jsonFetch<{ indexers: Indexer[] }>("/api/indexers").then((d) => setIndexers(d.indexers)).catch(() => {});
  const loadWatches = () => jsonFetch<{ watches: Watch[] }>("/api/watches").then((d) => setWatches(d.watches)).catch(() => {});
  const loadFeed = () => jsonFetch<{ items: FeedItem[] }>("/api/feed").then((d) => setFeed(d.items)).catch(() => {});

  useEffect(() => {
    loadProfile();
    loadIndexers();
    loadWatches();
    loadFeed();
  }, []);

  function addInterest() {
    const v = interestInput.trim();
    if (!v || profile.interests.includes(v)) return;
    setProfile((p) => ({ ...p, interests: [...p.interests, v] }));
    setInterestInput("");
  }
  function removeInterest(v: string) {
    setProfile((p) => ({ ...p, interests: p.interests.filter((x) => x !== v) }));
  }
  function toggleIndexer(id: number) {
    setProfile((p) => ({
      ...p,
      legalIndexerIds: p.legalIndexerIds.includes(id)
        ? p.legalIndexerIds.filter((x) => x !== id)
        : [...p.legalIndexerIds, id],
    }));
  }

  async function saveProfile() {
    setSavingProfile(true);
    setMsg("");
    try {
      const d = await jsonFetch<{ profile: Profile }>("/api/profile", {
        method: "PUT",
        body: JSON.stringify(profile),
      });
      setProfile(d.profile);
      setMsg("Profile saved.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSavingProfile(false);
    }
  }

  async function addWatch() {
    setAdding(true);
    setMsg("");
    try {
      await jsonFetch("/api/watches", {
        method: "POST",
        body: JSON.stringify({
          type: wType,
          label: wLabel,
          query: wQuery,
          feedUrl: wFeed,
          kind: wKind,
          autoGrab: true,
        }),
      });
      setWQuery("");
      setWFeed("");
      setWLabel("");
      await loadWatches();
      setMsg("Watch added — it will be scanned shortly.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setAdding(false);
    }
  }

  async function patchWatch(id: string, patch: Partial<Watch>) {
    await jsonFetch(`/api/watches/${id}`, { method: "PUT", body: JSON.stringify(patch) }).catch(() => {});
    loadWatches();
  }
  async function deleteWatch(id: string) {
    await fetch(`/api/watches/${id}`, { method: "DELETE" }).catch(() => {});
    loadWatches();
  }

  async function scanNow() {
    setScanning(true);
    setMsg("");
    try {
      await jsonFetch("/api/watches/scan", { method: "POST" });
      setMsg("Scan queued — new items appear in the feed within a minute. Hit Refresh.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setTimeout(() => setScanning(false), 1500);
    }
  }

  async function feedAction(id: string, action: "download" | "dismiss") {
    setFeed((f) => f.filter((x) => x.id !== id));
    await fetch(`/api/feed/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    }).catch(() => {});
  }

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 md:px-10">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="label">Automation</p>
          <h1 className="text-5xl text-ink" style={{ fontFamily: "var(--font-display)" }}>
            Discover
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-ghost" onClick={loadFeed}>
            <RefreshCw size={15} /> Refresh
          </button>
          <button className="btn btn-accent" onClick={scanNow} disabled={scanning}>
            {scanning ? <Loader2 size={15} className="animate-spin" /> : <Compass size={15} />} Scan now
          </button>
        </div>
      </header>

      {msg && <p className="mb-4 text-sm text-muted">{msg}</p>}

      <p className="mb-6 rounded-lg border border-border bg-surface p-3 text-xs text-muted">
        Automation only searches the indexers you allow below and the feeds you add — keep it to
        <span className="text-ink"> lawful sources you&apos;re entitled to use</span> (Linux Tracker,
        Internet Archive, Creative-Commons, public-domain, academic).
      </p>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Taste profile */}
        <section className="panel p-5">
          <h2 className="mb-1 text-lg font-semibold text-ink">Taste profile</h2>
          <p className="mb-4 text-xs text-muted">
            Interests used to rank the feed and auto-grab high matches.
          </p>

          <label className="label mb-1.5 block">Interests</label>
          <div className="mb-2 flex flex-wrap gap-2">
            {profile.interests.map((it) => (
              <span key={it} className="badge">
                {it}
                <button onClick={() => removeInterest(it)} className="ml-1 hover:text-danger">
                  <X size={11} />
                </button>
              </span>
            ))}
            {profile.interests.length === 0 && <span className="text-xs text-faint">none yet</span>}
          </div>
          <div className="flex gap-2">
            <input
              className="input"
              placeholder="e.g. ubuntu, blender, nasa, documentary"
              value={interestInput}
              onChange={(e) => setInterestInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addInterest())}
            />
            <button className="btn btn-ghost flex-none" onClick={addInterest}>
              <Plus size={15} />
            </button>
          </div>

          <div className="mt-5 flex items-center justify-between">
            <label className="label">Auto-grab matches</label>
            <button
              type="button"
              onClick={() => setProfile((p) => ({ ...p, autoGrabEnabled: !p.autoGrabEnabled }))}
              className="flex items-center gap-2 text-sm text-ink"
            >
              <span
                className="relative h-6 w-11 rounded-full transition-colors"
                style={{ background: profile.autoGrabEnabled ? "var(--color-accent)" : "var(--color-surface-2)" }}
              >
                <span
                  className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform"
                  style={{ transform: profile.autoGrabEnabled ? "translateX(22px)" : "translateX(2px)" }}
                />
              </span>
              {profile.autoGrabEnabled ? "On" : "Off"}
            </button>
          </div>
          <div className="mt-3 flex items-center gap-3">
            <label className="label flex-none">Threshold</label>
            <input
              type="range"
              min={50}
              max={100}
              value={profile.autoGrabThreshold}
              onChange={(e) => setProfile((p) => ({ ...p, autoGrabThreshold: Number(e.target.value) }))}
              className="flex-1 accent-[color:var(--color-accent)]"
            />
            <span className="mono w-12 text-right text-sm text-ink">{profile.autoGrabThreshold}%</span>
          </div>

          <label className="label mb-2 mt-5 block">Allowed indexers (lawful sources)</label>
          <div className="max-h-40 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
            {indexers.length === 0 && (
              <p className="p-2 text-xs text-faint">
                No indexers found — add lawful ones in Prowlarr first.
              </p>
            )}
            {indexers.map((ix) => (
              <label key={ix.id} className="flex items-center gap-2 px-1 py-1 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={profile.legalIndexerIds.includes(ix.id)}
                  onChange={() => toggleIndexer(ix.id)}
                  className="accent-[color:var(--color-accent)]"
                />
                <span className="min-w-0 flex-1 truncate">{ix.name}</span>
                {ix.privacy && <span className="badge flex-none">{ix.privacy}</span>}
              </label>
            ))}
          </div>

          <button className="btn btn-accent mt-5 w-full" onClick={saveProfile} disabled={savingProfile}>
            {savingProfile ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save profile
          </button>
        </section>

        {/* Watchlist */}
        <section className="panel p-5">
          <h2 className="mb-1 text-lg font-semibold text-ink">Watchlist</h2>
          <p className="mb-4 text-xs text-muted">
            Track a search or an RSS/torrent feed; new items are auto-grabbed.
          </p>

          <div className="mb-3 flex gap-2">
            <button
              className={`btn flex-1 ${wType === "SEARCH" ? "btn-accent" : "btn-ghost"}`}
              onClick={() => setWType("SEARCH")}
            >
              <SearchIcon size={14} /> Search
            </button>
            <button
              className={`btn flex-1 ${wType === "RSS" ? "btn-accent" : "btn-ghost"}`}
              onClick={() => setWType("RSS")}
            >
              <Rss size={14} /> RSS feed
            </button>
          </div>

          {wType === "SEARCH" ? (
            <input
              className="input mb-2"
              placeholder="Query to track, e.g. “Debian 12 netinst”"
              value={wQuery}
              onChange={(e) => setWQuery(e.target.value)}
            />
          ) : (
            <input
              className="input mb-2"
              placeholder="Feed URL (torrent/magnet RSS, e.g. an Internet Archive feed)"
              value={wFeed}
              onChange={(e) => setWFeed(e.target.value)}
            />
          )}
          <div className="mb-2 flex gap-2">
            <input
              className="input"
              placeholder="Label (optional)"
              value={wLabel}
              onChange={(e) => setWLabel(e.target.value)}
            />
            <select className="input w-32" value={wKind} onChange={(e) => setWKind(e.target.value)}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-ghost mb-4 w-full" onClick={addWatch} disabled={adding}>
            {adding ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Add watch
          </button>

          <div className="space-y-2">
            {watches.length === 0 && <p className="text-sm text-faint">No watches yet.</p>}
            {watches.map((w) => (
              <div key={w.id} className="card flex items-center gap-3 p-3">
                {w.type === "RSS" ? (
                  <Rss size={15} className="flex-none text-accent" />
                ) : (
                  <SearchIcon size={15} className="flex-none text-accent" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink">{w.label}</p>
                  <p className="truncate text-xs text-faint">{w.query || w.feedUrl}</p>
                </div>
                <button
                  className="badge flex-none"
                  onClick={() => patchWatch(w.id, { autoGrab: !w.autoGrab })}
                  title="Toggle auto-grab"
                  style={w.autoGrab ? { color: "var(--color-success)", borderColor: "var(--color-success)55" } : undefined}
                >
                  auto {w.autoGrab ? "on" : "off"}
                </button>
                <button
                  className="badge flex-none"
                  onClick={() => patchWatch(w.id, { enabled: !w.enabled })}
                  title="Enable/disable"
                >
                  {w.enabled ? "enabled" : "paused"}
                </button>
                <button className="flex-none text-faint hover:text-danger" onClick={() => deleteWatch(w.id)}>
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* What's new feed */}
      <section className="mt-6">
        <div className="mb-3 flex items-center gap-2">
          <h2 className="label">What&apos;s new</h2>
          <span className="badge">{feed.length}</span>
        </div>
        {feed.length === 0 ? (
          <p className="text-sm text-faint">
            Nothing yet. Add interests + allowed indexers or a watch, then Scan now.
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {feed.map((f) => (
              <div key={f.id} className="card flex items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-ink" title={f.title}>
                    {f.title}
                  </p>
                  <p className="mono truncate text-xs text-faint">
                    {[f.source, formatBytes(f.size), f.seeders != null ? `${f.seeders} seeders` : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
                {f.matchScore > 0 && (
                  <span
                    className="badge flex-none"
                    style={
                      f.matchScore >= 80
                        ? { color: "var(--color-success)", borderColor: "var(--color-success)55" }
                        : undefined
                    }
                  >
                    {f.matchScore}%
                  </span>
                )}
                <button
                  className="btn btn-ghost flex-none px-2 py-1"
                  title="Download"
                  onClick={() => feedAction(f.id, "download")}
                >
                  <Download size={14} />
                </button>
                <button
                  className="flex-none text-faint hover:text-danger"
                  title="Dismiss"
                  onClick={() => feedAction(f.id, "dismiss")}
                >
                  <X size={15} />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
