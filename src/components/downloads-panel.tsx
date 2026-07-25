"use client";

import {
  RotateCw,
  Trash2,
  Film,
  Download as DownIcon,
  UploadCloud,
  Users,
  Clock,
} from "lucide-react";
import { formatBytes, formatSpeed, formatEta } from "@/lib/util";
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

function Row({
  d,
  onRetry,
  onRemove,
}: {
  d: DownloadDTO;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const m = meta(d.status);
  const active = isActive(d.status);
  const uploading = d.status === "UPLOADING";

  return (
    <div className="card rise flex gap-4 p-4">
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
      </div>

      <div className="flex flex-none flex-col gap-1.5">
        {(d.status === "FAILED" || d.status === "CANCELLED") && (
          <button
            className="btn btn-ghost px-2.5 py-1.5"
            title="Retry"
            onClick={() => onRetry(d.id)}
          >
            <RotateCw size={14} />
          </button>
        )}
        <button
          className="btn btn-ghost px-2.5 py-1.5 text-muted hover:text-danger"
          title="Remove"
          onClick={() => onRemove(d.id)}
        >
          <Trash2 size={14} />
        </button>
      </div>
    </div>
  );
}

export function DownloadsPanel({
  downloads,
  loaded,
  onRetry,
  onRemove,
}: {
  downloads: DownloadDTO[];
  loaded: boolean;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
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
              <Row key={d.id} d={d} onRetry={onRetry} onRemove={onRemove} />
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
              <Row key={d.id} d={d} onRetry={onRetry} onRemove={onRemove} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
