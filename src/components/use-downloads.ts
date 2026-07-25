"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { jsonFetch } from "@/lib/client";
import type { DownloadDTO } from "@/lib/types";

interface ProgressMsg {
  type: string;
  downloadId: string;
  status?: DownloadDTO["status"];
  progress?: number;
  dlSpeed?: number;
  upSpeed?: number;
  etaSeconds?: number | null;
  seeders?: number | null;
  message?: string;
}

/** Fetches the download list and keeps it live via the SSE event stream. */
export function useDownloads() {
  const [downloads, setDownloads] = useState<DownloadDTO[]>([]);
  const [connected, setConnected] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  const refetch = useCallback(async () => {
    try {
      const data = await jsonFetch<{ downloads: DownloadDTO[] }>("/api/download");
      setDownloads(data.downloads);
    } catch {
      /* keep prior state */
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refetch();
    const es = new EventSource("/api/events");
    esRef.current = es;
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (ev) => {
      let e: ProgressMsg;
      try {
        e = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (e.type === "created" || e.type === "deleted") {
        void refetch();
        return;
      }
      if (e.type === "progress" || e.type === "status") {
        setDownloads((prev) =>
          prev.map((d) =>
            d.id === e.downloadId
              ? {
                  ...d,
                  status: e.status ?? d.status,
                  progress: e.progress ?? d.progress,
                  dlSpeed: e.dlSpeed ?? d.dlSpeed,
                  upSpeed: e.upSpeed ?? d.upSpeed,
                  etaSeconds: e.etaSeconds ?? d.etaSeconds,
                  seeders: e.seeders ?? d.seeders,
                  error: e.status === "FAILED" ? e.message ?? d.error : d.error,
                }
              : d,
          ),
        );
        if (e.status === "COMPLETED" || e.status === "FAILED") void refetch();
      }
    };
    return () => es.close();
  }, [refetch]);

  const remove = useCallback(async (id: string) => {
    setDownloads((prev) => prev.filter((d) => d.id !== id));
    await fetch(`/api/downloads/${id}`, { method: "DELETE" }).catch(() => {});
  }, []);

  const retry = useCallback(
    async (id: string) => {
      await fetch(`/api/downloads/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "retry" }),
      }).catch(() => {});
      void refetch();
    },
    [refetch],
  );

  return { downloads, connected, loaded, refetch, remove, retry };
}
