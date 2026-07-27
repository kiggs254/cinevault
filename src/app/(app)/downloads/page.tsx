"use client";

import { useMemo, useState } from "react";
import { Download, ChevronDown, RotateCw, Trash2, Film, DownloadCloud } from "lucide-react";
import { useDownloadsCtx } from "@/components/downloads-context";
import { DownloadRow } from "@/components/downloads-panel";
import { useConfirm } from "@/components/confirm-dialog";
import type { DownloadDTO, DownloadStatus } from "@/lib/types";

const PAGE_SIZE = 10;
const ACTIVE: DownloadStatus[] = ["QUEUED", "SEARCHING", "DOWNLOADING", "UPLOADING"];
const isActiveStatus = (s: DownloadStatus) => ACTIVE.includes(s);
const pad = (n: number | null) => String(n ?? 0).padStart(2, "0");

function statusMeta(s: DownloadStatus): { label: string; color: string } {
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
      return { label: "Downloaded", color: "var(--color-success)" };
    case "FAILED":
      return { label: "Failed", color: "var(--color-danger)" };
    case "PAUSED":
      return { label: "Paused", color: "var(--color-muted)" };
    default:
      return { label: "Cancelled", color: "var(--color-muted)" };
  }
}

type Filter = "all" | "active" | "completed" | "failed";
const FILTERS: { key: Filter; label: string; match: (s: DownloadStatus) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "active", label: "Active", match: (s) => isActiveStatus(s) },
  { key: "completed", label: "Completed", match: (s) => s === "COMPLETED" },
  { key: "failed", label: "Failed", match: (s) => s === "FAILED" || s === "CANCELLED" },
];

type Unit =
  | { type: "single"; key: string; item: DownloadDTO }
  | { type: "group"; key: string; title: string; season: number; poster: string | null; items: DownloadDTO[] };

/** Normalize a title for grouping — drop a trailing "(YYYY)" and collapse space. */
const normTitle = (t: string) =>
  t.toLowerCase().replace(/\s*\(\d{4}\)\s*$/, "").replace(/\s+/g, " ").trim();

/** Collapse each show's episodes of one season into a single card; leave the rest as rows. */
function buildUnits(downloads: DownloadDTO[]): Unit[] {
  const groups = new Map<string, DownloadDTO[]>();
  const order: string[] = [];
  for (const d of downloads) {
    const isEp = d.kind === "TV" && d.season != null && d.episode != null;
    const key = isEp ? `g:${normTitle(d.title)}:s${d.season}` : `x:${d.id}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      order.push(key);
    }
    groups.get(key)!.push(d);
  }
  const units: Unit[] = [];
  for (const key of order) {
    const items = groups.get(key)!;
    if (key.startsWith("g:") && items.length >= 2) {
      const first = items[0];
      units.push({
        type: "group",
        key,
        title: first.title,
        season: first.season ?? 0,
        poster: items.find((i) => i.posterUrl)?.posterUrl ?? null,
        items,
      });
    } else {
      for (const it of items) units.push({ type: "single", key: it.id, item: it });
    }
  }
  return units;
}

function EpisodeRow({
  d,
  onRetry,
  onRemove,
}: {
  d: DownloadDTO;
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const m = statusMeta(d.status);
  const active = isActiveStatus(d.status);
  const failed = d.status === "FAILED" || d.status === "CANCELLED";
  const confirm = useConfirm();
  return (
    <div className="flex items-start gap-3">
      <span className="mono mt-0.5 w-14 flex-none text-xs text-muted">
        S{pad(d.season)}E{pad(d.episode)}
      </span>
      <div className="min-w-0 flex-1">
        {active ? (
          <div className="mt-1.5 track">
            <div className="track-fill active" style={{ width: `${Math.max(2, d.progress)}%` }} />
          </div>
        ) : (
          <>
            <span className="block truncate text-xs text-faint" title={d.releaseName}>
              {d.releaseName}
            </span>
            {failed && d.error && (
              <span className="mt-0.5 block truncate text-[11px] text-danger" title={d.error}>
                {d.error}
              </span>
            )}
          </>
        )}
      </div>
      {d.status === "COMPLETED" ? (
        <span className="mt-0.5 flex-none text-success" title="Downloaded">
          <DownloadCloud size={15} />
        </span>
      ) : (
        <span
          className="badge mt-0.5 flex-none"
          style={{ color: m.color, borderColor: `${m.color}55` }}
          title={failed ? d.error ?? undefined : undefined}
        >
          {m.label}
        </span>
      )}
      {(d.status === "FAILED" || d.status === "CANCELLED") && (
        <button className="btn btn-ghost flex-none px-2 py-1" title="Retry" onClick={() => onRetry(d.id)}>
          <RotateCw size={13} />
        </button>
      )}
      <button
        className="btn btn-ghost flex-none px-2 py-1 text-muted hover:text-danger"
        title="Remove"
        onClick={async () => {
          if (
            await confirm({
              title: "Remove episode?",
              message: `S${pad(d.season)}E${pad(d.episode)} will be removed and its file deleted from storage.`,
              confirmLabel: "Remove",
            })
          ) {
            onRemove(d.id);
          }
        }}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

function GroupCard({
  title,
  season,
  poster,
  items,
  onRetry,
  onRemove,
}: {
  title: string;
  season: number;
  poster: string | null;
  items: DownloadDTO[];
  onRetry: (id: string) => void;
  onRemove: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const eps = useMemo(
    () => [...items].sort((a, b) => (a.episode ?? 0) - (b.episode ?? 0)),
    [items],
  );
  const done = eps.filter((e) => e.status === "COMPLETED").length;
  const active = eps.filter((e) => isActiveStatus(e.status)).length;
  const failed = eps.filter((e) => e.status === "FAILED" || e.status === "CANCELLED").length;

  return (
    <div className="card p-4">
      <button className="flex w-full items-center gap-4 text-left" onClick={() => setOpen((v) => !v)}>
        <div className="relative h-20 w-14 flex-none overflow-hidden rounded-md bg-surface-2">
          {poster ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={poster} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-faint">
              <Film size={20} />
            </span>
          )}
          <span className="absolute right-1 top-1 rounded-full bg-black/70 px-1.5 py-0.5 text-[10px] text-white">
            {eps.length}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-ink" title={title}>
            {title}
          </p>
          <p className="text-xs text-faint">
            Season {season} · {eps.length} episode{eps.length === 1 ? "" : "s"}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
            {done > 0 && (
              <span className="inline-flex items-center gap-1 text-success">
                <DownloadCloud size={12} /> {done}
              </span>
            )}
            {active > 0 && <span className="text-accent">{active} downloading</span>}
            {failed > 0 && <span className="text-danger">{failed} failed</span>}
          </div>
        </div>
        <ChevronDown
          size={16}
          className={`flex-none text-muted transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div className="mt-3 space-y-2 border-t border-border pt-3">
          {failed > 0 && (
            <button
              className="btn btn-ghost mb-1 w-full text-xs"
              onClick={() =>
                eps
                  .filter((e) => e.status === "FAILED" || e.status === "CANCELLED")
                  .forEach((e) => onRetry(e.id))
              }
            >
              <RotateCw size={13} /> Retry {failed} failed
            </button>
          )}
          {eps.map((e) => (
            <EpisodeRow key={e.id} d={e} onRetry={onRetry} onRemove={onRemove} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function DownloadsPage() {
  const { downloads, loaded, retry, remove, refetch } = useDownloadsCtx();
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(1);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: downloads.length, active: 0, completed: 0, failed: 0 };
    for (const d of downloads) {
      if (isActiveStatus(d.status)) c.active++;
      else if (d.status === "COMPLETED") c.completed++;
      else if (d.status === "FAILED" || d.status === "CANCELLED") c.failed++;
    }
    return c;
  }, [downloads]);

  const match = FILTERS.find((f) => f.key === filter)!.match;
  const units = useMemo(
    () => buildUnits(downloads.filter((d) => match(d.status))),
    [downloads, match],
  );

  const totalPages = Math.max(1, Math.ceil(units.length / PAGE_SIZE));
  const curPage = Math.min(page, totalPages);
  const pageUnits = units.slice((curPage - 1) * PAGE_SIZE, curPage * PAGE_SIZE);

  return (
    <div className="mx-auto max-w-4xl px-5 py-6 sm:py-8 md:px-10">
      <div className="mb-6 flex items-center gap-2">
        <Download size={22} className="text-accent" />
        <h1 className="text-3xl text-ink sm:text-4xl" style={{ fontFamily: "var(--font-display)" }}>
          Downloads
        </h1>
      </div>

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
              className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                on ? "border-accent bg-accent/10 text-ink" : "border-border text-muted hover:text-ink"
              }`}
            >
              {f.label}
              <span className="ml-1.5 text-faint">{counts[f.key]}</span>
            </button>
          );
        })}
      </div>

      {!loaded ? (
        <p className="text-sm text-faint">Loading…</p>
      ) : pageUnits.length === 0 ? (
        <p className="rounded-xl border border-border bg-surface p-6 text-center text-sm text-faint">
          {filter === "all" ? "No downloads yet. Search on Home to start one." : "Nothing here."}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {pageUnits.map((u) =>
            u.type === "group" ? (
              <GroupCard
                key={u.key}
                title={u.title}
                season={u.season}
                poster={u.poster}
                items={u.items}
                onRetry={retry}
                onRemove={remove}
              />
            ) : (
              <DownloadRow key={u.key} d={u.item} onRetry={retry} onRemove={remove} onRefresh={refetch} />
            ),
          )}
        </div>
      )}

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
