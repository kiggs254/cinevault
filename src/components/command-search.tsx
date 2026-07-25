"use client";

import { useState } from "react";
import { Search, Wand2, Sparkles, Loader2 } from "lucide-react";
import { jsonFetch } from "@/lib/client";
import { ResultCard, type SearchResult } from "./result-card";
import type { PlannedQuery, RankDecision } from "@/lib/types";

interface SearchResponse {
  plan: PlannedQuery;
  decision: RankDecision;
  recommendedIndex: number;
  results: SearchResult[];
}

export function CommandSearch({ onQueued }: { onQueued: () => void }) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [autoBusy, setAutoBusy] = useState(false);
  const [err, setErr] = useState("");
  const [data, setData] = useState<SearchResponse | null>(null);
  const [queued, setQueued] = useState<Set<number>>(new Set());
  const [busyIndex, setBusyIndex] = useState<number | null>(null);

  const flagged = new Map<number, string>();
  data?.decision.flaggedIndexes?.forEach((f) => flagged.set(f.index, f.reason));

  async function runSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!query.trim()) return;
    setLoading(true);
    setErr("");
    setData(null);
    setQueued(new Set());
    try {
      const res = await jsonFetch<SearchResponse>("/api/search", {
        method: "POST",
        body: JSON.stringify({ query }),
      });
      setData(res);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function download(r: SearchResult) {
    setBusyIndex(r.index);
    setErr("");
    try {
      await jsonFetch("/api/download", {
        method: "POST",
        body: JSON.stringify({
          title: r.title,
          magnetUrl: r.magnetUrl,
          downloadUrl: r.downloadUrl,
          infoHash: r.infoHash,
          indexer: r.indexer,
          size: r.size,
          seeders: r.seeders,
          query,
          plan: data
            ? {
                kind: data.plan.kind,
                title: data.plan.title,
                year: data.plan.year,
                season: data.plan.season,
                episode: data.plan.episode,
              }
            : undefined,
        }),
      });
      setQueued((prev) => new Set(prev).add(r.index));
      onQueued();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusyIndex(null);
    }
  }

  async function autoGrab() {
    if (!query.trim()) return;
    setAutoBusy(true);
    setErr("");
    try {
      await jsonFetch("/api/download", {
        method: "POST",
        body: JSON.stringify({ auto: true, query }),
      });
      onQueued();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setAutoBusy(false);
    }
  }

  return (
    <section className="mb-8">
      <form onSubmit={runSearch} className="panel p-2">
        <div className="flex items-center gap-2">
          <Search size={18} className="ml-2 flex-none text-muted" />
          <input
            className="min-w-0 flex-1 bg-transparent px-1 py-2 text-sm text-ink outline-none placeholder:text-faint"
            placeholder="Describe what you want — “Dune Part Two in 4K”, “The Office US season 3 1080p”…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <button
            type="button"
            onClick={autoGrab}
            disabled={autoBusy || !query.trim()}
            className="btn btn-ghost flex-none"
            title="Let the AI pick the single best release and queue it"
          >
            {autoBusy ? <Loader2 size={15} className="animate-spin" /> : <Wand2 size={15} />}
            <span className="hidden sm:inline">Auto-grab</span>
          </button>
          <button type="submit" disabled={loading || !query.trim()} className="btn btn-accent flex-none">
            {loading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            <span className="hidden sm:inline">Search</span>
          </button>
        </div>
      </form>

      {err && <p className="mt-3 text-sm text-danger">{err}</p>}

      {data && (
        <div className="mt-5 space-y-4">
          <div className="panel rise flex flex-wrap items-center gap-2 p-4">
            <span className="label">Understood</span>
            <span className="badge badge-accent">{data.plan.kind}</span>
            <span className="text-sm text-ink">
              {data.plan.title}
              {data.plan.year ? ` (${data.plan.year})` : ""}
            </span>
            {data.plan.season != null && (
              <span className="badge">
                S{String(data.plan.season).padStart(2, "0")}
                {data.plan.episode != null ? `E${String(data.plan.episode).padStart(2, "0")}` : ""}
              </span>
            )}
            <span className="badge">{data.plan.quality}</span>
            {data.plan.note && <span className="w-full text-xs text-faint">{data.plan.note}</span>}
          </div>

          {data.results.length === 0 ? (
            <p className="text-sm text-muted">
              No results found. Try different wording, or check your indexers in Settings.
            </p>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {data.results.slice(0, 24).map((r) => (
                <ResultCard
                  key={r.index}
                  result={r}
                  flaggedReason={flagged.get(r.index)}
                  queued={queued.has(r.index)}
                  busy={busyIndex === r.index}
                  onDownload={download}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
