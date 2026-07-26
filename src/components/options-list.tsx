"use client";

import { Download, Star, ChevronRight, Loader2, Check } from "lucide-react";

export interface ChatOption {
  id: string;
  label: string;
  meta?: string;
  recommended?: boolean;
  /** arbitrary payload the caller reads back in onSelect */
  payload?: unknown;
}

/** WhatsApp-style selectable list of options rendered inside the chat / rows. */
export function OptionsList({
  title,
  options,
  actionIcon = "download",
  busyId,
  doneIds,
  onSelect,
}: {
  title?: string;
  options: ChatOption[];
  actionIcon?: "download" | "chevron";
  busyId?: string | null;
  doneIds?: Set<string>;
  onSelect: (o: ChatOption) => void;
}) {
  return (
    <div className="panel overflow-hidden">
      {title && (
        <p className="label border-b border-border px-4 py-2.5">{title}</p>
      )}
      <div className="divide-y divide-[color:var(--color-border)]">
        {options.map((o) => {
          const done = doneIds?.has(o.id);
          const busy = busyId === o.id;
          return (
            <button
              key={o.id}
              disabled={busy || done}
              onClick={() => onSelect(o)}
              className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-2 disabled:cursor-default disabled:opacity-70"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm text-ink">{o.label}</span>
                  {o.recommended && (
                    <span className="badge badge-accent flex-none">
                      <Star size={10} /> Pick
                    </span>
                  )}
                </div>
                {o.meta && <div className="mt-0.5 truncate text-xs text-muted">{o.meta}</div>}
              </div>
              <span className="flex-none">
                {done ? (
                  <span className="flex items-center gap-1 text-xs text-success">
                    <Check size={13} /> queued
                  </span>
                ) : busy ? (
                  <Loader2 size={16} className="animate-spin text-muted" />
                ) : actionIcon === "download" ? (
                  <Download size={16} className="text-accent" />
                ) : (
                  <ChevronRight size={16} className="text-muted" />
                )}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
