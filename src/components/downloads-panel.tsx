"use client";

import { useState } from "react";
import {
  RotateCw,
  Trash2,
  Film,
  Download as DownIcon,
  UploadCloud,
  Users,
  Clock,
  Shuffle,
  Loader2,
} from "lucide-react";
import { formatBytes, formatSpeed, formatEta } from "@/lib/util";
import { jsonFetch } from "@/lib/client";
import { useConfirm } from "@/components/confirm-dialog";
import { OptionsList, type ChatOption } from "./options-list";
import type { SearchResult } from "./result-card";
import type { DownloadDTO, DownloadStatus } from "@/lib/types";

function meta(s: DownloadStatus): { label: string; color: string } {
  switch (s) {
    case "QUEUED":
      return { label: "Queued", color: "var(--color-info)" };
    case "SEARCHING":
      return { label: "Searching", color: "var(--color-info)" };
    case "DOWNLOADING":
      return { label: "Downloading", color: "var(--color-accent)" };
    case "UPLOADING":
      return { label: "Uploading", color: "var(--color-accent)" };
    case "COMPLETED":
      return { label: "Archived", color: "var(--color-success)" };
    case "FAILED":
      return { label: "Failed", color: "var(--color-danger)" };
    case "PAUSED":
      return { label: "Paused", color: "var(--color-muted)" };
    default:
      return { label: "Cancelled", color: "var(--color-muted)" };
  }
}

const isActive = (s: DownloadStatus) =>
  ["QUEUED", "SEARCHING", "DOWNLOADING", "UPLOADING"].includes(s);
// Where offering "replace with a different source" makes sense.
const canReplace = (s: DownloadStatus) => s !== "COMPLETED" && s !== "UPLOADING";

export function DownloadRow({
  d,
  onRetry,
  onRemove,
  onRefresh,
}: {
  d: DownloadDTO;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onRefresh: () => void;
}) {
  const m = meta(d.status);
  const active = isActive(d.status);
  const uploading = d.status === "UPLOADING";

  const [alts, setAlts] = useState<SearchResult[] | null>(null);
  const [loadingAlts, setLoadingAlts] = useState(false);
  const [pickId, setPickId] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const confirm = useConfirm();

  async function findAlternatives() {
    if (alts) {
      setAlts(null);
      return;
    }
    setLoadingAlts(true);
    setErr("");
    try {
      const res = await jsonFetch<{ results: SearchResult[] }>("/api/search", {
        method: "POST",
        body: JSON.stringify({ query: d.title }),
      });
      const filtered = res.results
        .filter((r) => r.title !== d.releaseName && (r.magnetUrl || r.downloadUrl))
        .slice(0, 6);
      setAlts(filtered);
      if (filtered.length === 0) setErr("No alternative sources found.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoadingAlts(false);
    }
  }

  async function pickAlt(o: ChatOption) {
    const r = o.payload as SearchResult;
    setPickId(o.id);
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
          query: d.title,
          plan: {
            kind: d.kind,
            title: d.title,
            year: d.year,
            season: d.season,
            episode: d.episode,
          },
        }),
      });
      await onRemove(d.id); // remove the stuck one
      onRefresh();
    } catch (e) {
      setErr((e as Error).message);
      setPickId(null);
    }
  }

  const altOptions: ChatOption[] = (alts ?? []).map((r, i) => ({
    id: String(i),
    label: r.title,
    meta: [
      r.parsed.resolution,
      r.parsed.source,
      `${r.seeders} seeders`,
      `${(r.size / 1024 ** 3).toFixed(2)} GB`,
    ]
      .filter(Boolean)
      .join(" · "),
    recommended: i === 0,
    payload: r,
  }));

  return (
    <div className="card rise p-4">
      <div className="flex gap-4">
        <div className="relative h-20 w-14 flex-none overflow-hidden rounded-md bg-surface-2">
          {d.posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={d.posterUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-faint">
              <Film size={20} />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-ink" title={d.title}>
                {d.title}
                {d.year ? ` (${d.year})` : ""}
              </p>
              <p className="truncate text-xs text-faint" title={d.releaseName}>
                {d.releaseName}
              </p>
            </div>
            <span className="badge flex-none" style={{ color: m.color, borderColor: `${m.color}55` }}>
              {active && <span className="dot dot-live" style={{ background: m.color, color: m.color }} />}
              {m.label}
            </span>
          </div>

          {active && (
            <div className="mt-3">
              <div className="track">
                <div
                  className={`track-fill ${active ? "active" : ""}`}
                  style={{ width: `${Math.max(2, d.progress)}%` }}
                />
              </div>
              <div className="mono mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.7rem] text-muted">
                <span>{d.progress.toFixed(1)}%</span>
                {uploading ? (
                  <span className="flex items-center gap-1">
                    <UploadCloud size={12} /> to S3
                  </span>
                ) : (
                  <>
                    <span className="flex items-center gap-1">
                      <DownIcon size={12} /> {formatSpeed(d.dlSpeed)}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users size={12} /> {d.seeders ?? 0}
                    </span>
                    <span className="flex items-center gap-1">
                      <Clock size={12} /> {formatEta(d.etaSeconds)}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}

          {d.status === "COMPLETED" && (
            <p className="mono mt-2 truncate text-xs text-muted">
              {formatBytes(d.sizeBytes)}
              {d.s3Key ? ` · ${d.s3Key.split("/").slice(0, -1).join("/")}` : ""}
            </p>
          )}
          {d.status === "FAILED" && d.error && (
            <p className="mt-2 text-xs text-danger">{d.error}</p>
          )}
          {err && <p className="mt-2 text-xs text-danger">{err}</p>}
        </div>

        <div className="flex flex-none flex-col gap-1.5">
          {(d.status === "FAILED" || d.status === "CANCELLED") && (
            <button className="btn btn-ghost px-2.5 py-1.5" title="Retry same source" onClick={() => onRetry(d.id)}>
              <RotateCw size={14} />
            </button>
          )}
          {canReplace(d.status) && (
            <button
              className="btn btn-ghost px-2.5 py-1.5"
              title="Replace with a different source"
              onClick={findAlternatives}
            >
              {loadingAlts ? <Loader2 size={14} className="animate-spin" /> : <Shuffle size={14} />}
            </button>
          )}
          <button
            className="btn btn-ghost px-2.5 py-1.5 text-muted hover:text-danger"
            title="Remove"
            onClick={async () => {
              if (
                await confirm({
                  title: "Remove download?",
                  message: `“${d.title}” will be removed and its archived file deleted from storage.`,
                  confirmLabel: "Remove",
                })
              ) {
                onRemove(d.id);
              }
            }}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {alts && alts.length > 0 && (
        <div className="mt-3">
          <p className="label mb-2">Pick a different source (removes the current one)</p>
          <OptionsList options={altOptions} busyId={pickId} onSelect={pickAlt} />
        </div>
      )}
    </div>
  );
}

export function DownloadsPanel({
  downloads,
  loaded,
  onRetry,
  onRemove,
  onRefresh,
}: {
  downloads: DownloadDTO[];
  loaded: boolean;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
  onRefresh: () => void;
}) {
  const active = downloads.filter((d) => isActive(d.status));
  const rest = downloads.filter((d) => !isActive(d.status));

  return (
    <section className="space-y-8 pb-16">
      <div>
        <div className="mb-3 flex items-center gap-2">
          <h2 className="label">In progress</h2>
          <span className="badge">{active.length}</span>
        </div>
        {active.length === 0 ? (
          <p className="text-sm text-faint">
            {loaded ? "Nothing downloading. Search above to start." : "Loading…"}
          </p>
        ) : (
          <div className="grid gap-3">
            {active.map((d) => (
              <DownloadRow key={d.id} d={d} onRetry={onRetry} onRemove={onRemove} onRefresh={onRefresh} />
            ))}
          </div>
        )}
      </div>

      {rest.length > 0 && (
        <div>
          <div className="mb-3 flex items-center gap-2">
            <h2 className="label">History</h2>
            <span className="badge">{rest.length}</span>
          </div>
          <div className="grid gap-3">
            {rest.map((d) => (
              <DownloadRow key={d.id} d={d} onRetry={onRetry} onRemove={onRemove} onRefresh={onRefresh} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
