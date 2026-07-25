"use client";

import { Download, Star, ShieldAlert, Users } from "lucide-react";
import { formatBytes } from "@/lib/util";
import type { ParsedRelease } from "@/lib/types";

export interface SearchResult {
  index: number;
  title: string;
  indexer: string;
  seeders: number;
  leechers: number;
  size: number;
  score: number;
  reasons: string[];
  parsed: ParsedRelease;
  magnetUrl?: string;
  downloadUrl?: string;
  infoHash?: string;
  recommended: boolean;
}

export function ResultCard({
  result,
  flaggedReason,
  queued,
  busy,
  onDownload,
}: {
  result: SearchResult;
  flaggedReason?: string;
  queued: boolean;
  busy: boolean;
  onDownload: (r: SearchResult) => void;
}) {
  const p = result.parsed;
  const healthy = result.seeders >= 5;
  const noSource = !result.magnetUrl && !result.downloadUrl;

  return (
    <div
      className={`card rise p-4 transition-transform hover:-translate-y-0.5 ${
        result.recommended ? "ring-1 ring-[color:var(--color-accent)]" : ""
      }`}
      style={result.recommended ? { boxShadow: "0 0 44px -20px var(--color-accent)" } : undefined}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {result.recommended && (
              <span className="badge badge-accent">
                <Star size={11} /> AI Pick
              </span>
            )}
            {p.resolution && <span className="badge">{p.resolution}</span>}
            {p.source && <span className="badge">{p.source}</span>}
            {p.codec && <span className="badge">{p.codec}</span>}
            {p.hdr && <span className="badge">HDR</span>}
            {p.group && <span className="badge">{p.group}</span>}
            {flaggedReason && (
              <span
                className="badge"
                style={{ color: "var(--color-danger)", borderColor: "rgba(226,106,95,.4)" }}
              >
                <ShieldAlert size={11} /> Flagged
              </span>
            )}
          </div>
          <p className="truncate text-sm text-ink" title={result.title}>
            {result.title}
          </p>
          <p className="mt-1 truncate text-xs text-faint">
            {result.indexer}
            {flaggedReason ? ` · ${flaggedReason}` : ""}
          </p>
        </div>

        <div className="flex flex-none flex-col items-end gap-1">
          <span
            className="mono flex items-center gap-1 text-sm"
            style={{ color: healthy ? "var(--color-success)" : "var(--color-muted)" }}
          >
            <Users size={13} /> {result.seeders}
          </span>
          <span className="mono text-xs text-muted">{formatBytes(result.size)}</span>
          <span className="mono text-[0.65rem] text-faint">score {result.score}</span>
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="truncate text-xs text-faint">{result.reasons.slice(0, 2).join(" · ")}</p>
        <button
          className={`btn ${result.recommended ? "btn-accent" : "btn-ghost"} flex-none px-3 py-1.5 text-xs`}
          disabled={busy || queued || noSource}
          onClick={() => onDownload(result)}
        >
          <Download size={14} /> {queued ? "Queued" : busy ? "…" : "Download"}
        </button>
      </div>
    </div>
  );
}
