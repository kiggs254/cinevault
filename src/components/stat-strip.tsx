"use client";

import { Activity, CheckCircle2, HardDrive, AlertTriangle } from "lucide-react";
import { formatBytes } from "@/lib/util";
import type { DownloadDTO } from "@/lib/types";

const ACTIVE = new Set(["QUEUED", "SEARCHING", "DOWNLOADING", "UPLOADING"]);

export function StatStrip({ downloads }: { downloads: DownloadDTO[] }) {
  const active = downloads.filter((d) => ACTIVE.has(d.status)).length;
  const completed = downloads.filter((d) => d.status === "COMPLETED");
  const failed = downloads.filter((d) => d.status === "FAILED").length;
  const archived = completed.reduce((a, d) => a + d.sizeBytes, 0);

  const tiles = [
    { label: "Active", value: String(active), icon: Activity, color: "var(--color-accent)", mono: false },
    { label: "Downloaded", value: String(completed.length), icon: CheckCircle2, color: "var(--color-success)", mono: false },
    {
      label: "Failed",
      value: String(failed),
      icon: AlertTriangle,
      color: failed ? "var(--color-danger)" : "var(--color-muted)",
      mono: false,
    },
    { label: "On S3", value: formatBytes(archived), icon: HardDrive, color: "var(--color-info)", mono: true },
  ];

  return (
    <div className="mb-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="panel rise p-4">
          <div className="mb-2 flex items-center justify-between">
            <span className="label">{t.label}</span>
            <t.icon size={16} style={{ color: t.color }} />
          </div>
          <p
            className={t.mono ? "mono text-2xl text-ink" : "text-4xl text-ink"}
            style={t.mono ? undefined : { fontFamily: "var(--font-display)" }}
          >
            {t.value}
          </p>
        </div>
      ))}
    </div>
  );
}
