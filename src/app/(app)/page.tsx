"use client";

import { useDownloads } from "@/components/use-downloads";
import { CommandSearch } from "@/components/command-search";
import { StatStrip } from "@/components/stat-strip";
import { DownloadsPanel } from "@/components/downloads-panel";

export default function CommandPage() {
  const dl = useDownloads();

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 md:px-10">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="label">Deck</p>
          <h1 className="text-5xl text-ink" style={{ fontFamily: "var(--font-display)" }}>
            Command
          </h1>
        </div>
        <span
          className="badge"
          style={{ color: dl.connected ? "var(--color-success)" : "var(--color-muted)" }}
        >
          <span
            className={`dot ${dl.connected ? "dot-live" : ""}`}
            style={{
              background: dl.connected ? "var(--color-success)" : "var(--color-faint)",
              color: "var(--color-success)",
            }}
          />
          {dl.connected ? "Live" : "Offline"}
        </span>
      </header>

      <CommandSearch onQueued={dl.refetch} />
      <StatStrip downloads={dl.downloads} />
      <DownloadsPanel
        downloads={dl.downloads}
        loaded={dl.loaded}
        onRetry={dl.retry}
        onRemove={dl.remove}
        onRefresh={dl.refetch}
      />
    </div>
  );
}
