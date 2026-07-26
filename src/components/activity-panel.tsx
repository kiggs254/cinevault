"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronDown, Search, DownloadCloud, UploadCloud, Clock } from "lucide-react";
import { useDownloadsCtx } from "./downloads-context";
import type { DownloadDTO } from "@/lib/types";

const ACTIVE = new Set(["QUEUED", "SEARCHING", "DOWNLOADING", "UPLOADING"]);

const STATUS: Record<string, { label: string; color: string; Icon: typeof Search }> = {
  QUEUED: { label: "Queued", color: "var(--color-info)", Icon: Clock },
  SEARCHING: { label: "Searching", color: "var(--color-info)", Icon: Search },
  DOWNLOADING: { label: "Downloading", color: "var(--color-accent)", Icon: DownloadCloud },
  UPLOADING: { label: "Uploading", color: "var(--color-accent)", Icon: UploadCloud },
};

const pad = (n: number) => String(n).padStart(2, "0");
const normTitle = (t: string) => t.replace(/\s*\(\d{4}\)\s*$/, "").trim();
function epLabel(d: DownloadDTO): string {
  if (d.season != null && d.episode != null) return `S${pad(d.season)}E${pad(d.episode)}`;
  if (d.season != null) return `Season ${d.season}`;
  return d.releaseName;
}

interface Group {
  key: string;
  title: string;
  season: number | null;
  posterUrl: string | null;
  items: DownloadDTO[];
}

/**
 * Live view of what the agent is doing in the background — grouped by title/season,
 * fed by the shared SSE download stream. Interactive: expand a group to see each
 * episode's status. Renders nothing when idle.
 */
export function ActivityPanel() {
  const { downloads } = useDownloadsCtx();
  const [open, setOpen] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const active = useMemo(() => downloads.filter((d) => ACTIVE.has(d.status)), [downloads]);
  const groups = useMemo(() => {
    const m = new Map<string, Group>();
    for (const d of active) {
      const title = normTitle(d.title);
      const key = `${title.toLowerCase()}|${d.season ?? "m"}`;
      let g = m.get(key);
      if (!g) {
        g = { key, title, season: d.season, posterUrl: d.posterUrl, items: [] };
        m.set(key, g);
      }
      if (!g.posterUrl && d.posterUrl) g.posterUrl = d.posterUrl;
      g.items.push(d);
    }
    return [...m.values()];
  }, [active]);

  if (active.length === 0) return null;

  const toggle = (k: string) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(k)) n.delete(k);
      else n.add(k);
      return n;
    });

  return (
    <div className="panel mb-3 overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-2 px-4 py-3 text-left">
        <span className="relative flex h-2.5 w-2.5 flex-none items-center justify-center">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
        </span>
        <span className="text-sm font-semibold text-ink">
          Working on {active.length} download{active.length === 1 ? "" : "s"}
        </span>
        <Link
          href="/downloads"
          onClick={(e) => e.stopPropagation()}
          className="ml-auto text-xs text-muted hover:text-accent"
        >
          Downloads →
        </Link>
        <ChevronDown size={16} className={`flex-none text-faint transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="max-h-72 space-y-1 overflow-y-auto border-t border-border p-2">
          {groups.map((g) => {
            const counts = g.items.reduce<Record<string, number>>((acc, d) => {
              acc[d.status] = (acc[d.status] ?? 0) + 1;
              return acc;
            }, {});
            const summary = Object.entries(counts)
              .map(([s, n]) => `${n} ${STATUS[s]?.label.toLowerCase() ?? s.toLowerCase()}`)
              .join(" · ");
            const moving = g.items.filter((d) => d.status === "DOWNLOADING" || d.status === "UPLOADING");
            const avg = moving.length ? Math.round(moving.reduce((a, d) => a + d.progress, 0) / moving.length) : 0;
            const isOpen = expanded.has(g.key);
            return (
              <div key={g.key}>
                <button
                  onClick={() => toggle(g.key)}
                  className="flex w-full items-center gap-3 rounded-lg p-2 text-left hover:bg-surface-2"
                >
                  <div className="h-12 w-8 flex-none overflow-hidden rounded bg-surface-2">
                    {g.posterUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={g.posterUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">
                      {g.title}
                      {g.season != null ? ` · Season ${g.season}` : ""}
                    </p>
                    <p className="truncate text-[11px] text-muted">{summary}</p>
                    {moving.length > 0 && (
                      <div className="track mt-1">
                        <div className="track-fill active" style={{ width: `${avg}%` }} />
                      </div>
                    )}
                  </div>
                  <span className="flex-none text-[11px] text-faint">{g.items.length}</span>
                  <ChevronDown
                    size={14}
                    className={`flex-none text-faint transition-transform ${isOpen ? "rotate-180" : ""}`}
                  />
                </button>
                {isOpen && (
                  <div className="space-y-1 py-1 pl-11 pr-2">
                    {g.items
                      .slice()
                      .sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0))
                      .map((d) => {
                        const s = STATUS[d.status];
                        return (
                          <div key={d.id} className="flex items-center gap-2 text-[11px]">
                            <span className="mono w-16 flex-none text-faint">{epLabel(d)}</span>
                            {s && (
                              <s.Icon
                                size={11}
                                style={{ color: s.color }}
                                className={d.status === "SEARCHING" ? "animate-pulse" : ""}
                              />
                            )}
                            <span className="flex-1 truncate" style={{ color: s?.color }}>
                              {s?.label ?? d.status}
                            </span>
                            {(d.status === "DOWNLOADING" || d.status === "UPLOADING") && (
                              <span className="mono flex-none text-faint">{Math.round(d.progress)}%</span>
                            )}
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
