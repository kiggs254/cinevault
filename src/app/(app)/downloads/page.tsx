"use client";

import { useMemo, useState } from "react";
import { Download } from "lucide-react";
import { useDownloadsCtx } from "@/components/downloads-context";
import { DownloadRow } from "@/components/downloads-panel";
import type { DownloadStatus } from "@/lib/types";

const PAGE_SIZE = 12;
const ACTIVE: DownloadStatus[] = ["QUEUED", "SEARCHING", "DOWNLOADING", "UPLOADING"];

type Filter = "all" | "active" | "completed" | "failed";
const FILTERS: { key: Filter; label: string; match: (s: DownloadStatus) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "active", label: "Active", match: (s) => ACTIVE.includes(s) },
  { key: "completed", label: "Completed", match: (s) => s === "COMPLETED" },
  { key: "failed", label: "Failed", match: (s) => s === "FAILED" || s === "CANCELLED" },
];

export default function DownloadsPage() {
  const { downloads, loaded, retry, remove, refetch } = useDownloadsCtx();
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: downloads.length, active: 0, completed: 0, failed: 0 };
    for (const d of downloads) {
      if (ACTIVE.includes(d.status)) c.active++;
      else if (d.status === "COMPLETED") c.completed++;
      else if (d.status === "FAILED" || d.status === "CANCELLED") c.failed++;
    }
    return c;
  }, [downloads]);

  const match = FILTERS.find((f) => f.key === filter)!.match;
  const filtered = useMemo(() => downloads.filter((d) => match(d.status)), [downloads, match]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const curPage = Math.min(page, totalPages);
  const pageItems = filtered.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);

  return (
    <div className="mx-auto max-w-4xl px-5 py-8 md:px-10">
      <div className="mb-6 flex items-center gap-2">
        <Download size={22} className="text-accent" />
        <h1 className="text-2xl font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>
          Downloads
        </h1>
      </div>

      {/* Status filters */}
      <div className="mb-6 flex flex-wrap gap-2">
        {FILTERS.map((f) => {
          const on = f.key === filter;
          return (
            <button
              key={f.key}
              onClick={() => {
                setFilter(f.key);
                setPage(1);
              }}
              className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
                on ? "border-accent bg-accent/10 text-ink" : "border-border text-muted hover:text-ink"
              }`}
            >
              {f.label}
              <span className="ml-1.5 text-faint">{counts[f.key]}</span>
            </button>
          );
        })}
      </div>

      {/* List */}
      {!loaded ? (
        <p className="text-sm text-faint">Loading…</p>
      ) : pageItems.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-faint">
          {filter === "all" ? "No downloads yet. Search on Home to start one." : "Nothing here."}
        </p>
      ) : (
        <div className="grid gap-3">
          {pageItems.map((d) => (
            <DownloadRow key={d.id} d={d} onRetry={retry} onRemove={remove} onRefresh={refetch} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            className="btn btn-ghost px-3 py-1.5 text-sm disabled:opacity-40"
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={curPage <= 1}
          >
            Prev
          </button>
          <span className="text-xs text-muted">
            Page {curPage} of {totalPages}
          </span>
          <button
            className="btn btn-ghost px-3 py-1.5 text-sm disabled:opacity-40"
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={curPage >= totalPages}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
