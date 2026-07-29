"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Search,
  DownloadCloud,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  Shuffle,
  Sparkles,
  Info,
  ChevronDown,
  type LucideIcon,
} from "lucide-react";
import { useDownloadsCtx } from "./downloads-context";

const ACTIVE = new Set(["QUEUED", "SEARCHING", "DOWNLOADING", "UPLOADING"]);

function look(kind?: string): { Icon: LucideIcon; color: string } {
  switch (kind) {
    case "search":
      return { Icon: Search, color: "var(--color-info)" };
    case "queue":
    case "download":
      return { Icon: DownloadCloud, color: "var(--color-accent)" };
    case "upload":
      return { Icon: UploadCloud, color: "var(--color-accent)" };
    case "done":
      return { Icon: CheckCircle2, color: "var(--color-success)" };
    case "warn":
      return { Icon: AlertTriangle, color: "var(--color-danger)" };
    case "switch":
      return { Icon: Shuffle, color: "var(--color-info)" };
    default:
      return { Icon: Info, color: "var(--color-muted)" };
  }
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.round(m / 60)}h`;
}

/** Live narrative of what the agent is doing in the background (search → queue → download → upload → done). */
export function ActivityFeed() {
  const { activity, downloads } = useDownloadsCtx();
  const [open, setOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  // System activity (fetching, grabbing, uploading) is admin-only plumbing.
  useEffect(() => {
    let alive = true;
    fetch("/api/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setIsAdmin(d?.role === "admin"))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const activeCount = downloads.filter((d) => ACTIVE.has(d.status)).length;

  if (!isAdmin) return null;
  if (activity.length === 0 && activeCount === 0) return null;

  return (
    <div className="panel mb-3 overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex w-full items-center gap-2 px-4 py-3 text-left ${open ? "border-b border-border" : ""}`}
      >
        {activeCount > 0 ? (
          <span className="relative flex h-2.5 w-2.5 flex-none items-center justify-center">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
          </span>
        ) : (
          <Sparkles size={15} className="flex-none text-accent" />
        )}
        <span className="text-sm font-semibold text-ink">
          {activeCount > 0 ? `Working — ${activeCount} active` : "Recent activity"}
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

      {open &&
        (activity.length === 0 ? (
          <p className="px-4 py-3 text-xs text-faint">Working in the background…</p>
        ) : (
          <div className="max-h-64 space-y-2 overflow-y-auto px-4 py-3">
            {activity.map((a) => {
              const { Icon, color } = look(a.kind);
              return (
                <div key={a.id} className="flex items-start gap-2 text-xs">
                  <Icon size={13} className="mt-0.5 flex-none" style={{ color }} />
                  <span className="min-w-0 flex-1 text-muted">{a.message}</span>
                  <span className="flex-none text-[10px] text-faint">{timeAgo(a.at)}</span>
                </div>
              );
            })}
          </div>
        ))}
    </div>
  );
}
