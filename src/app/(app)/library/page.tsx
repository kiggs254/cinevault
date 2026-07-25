"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Folder,
  FileVideo,
  ChevronRight,
  ExternalLink,
  RefreshCw,
  HardDrive,
} from "lucide-react";
import { jsonFetch } from "@/lib/client";
import { formatBytes } from "@/lib/util";

interface Entry {
  key: string;
  size: number;
  lastModified?: string;
  isFolder: boolean;
}
interface LibResp {
  prefix: string;
  bucket: string;
  publicUrl: string | null;
  entries: Entry[];
}

export default function LibraryPage() {
  const [prefix, setPrefix] = useState("");
  const [data, setData] = useState<LibResp | null>(null);
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (p: string) => {
    setLoading(true);
    setErr("");
    try {
      setData(await jsonFetch<LibResp>(`/api/library?prefix=${encodeURIComponent(p)}`));
    } catch (e) {
      setErr((e as Error).message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(prefix);
  }, [prefix, load]);

  async function openFile(key: string) {
    try {
      const { url } = await jsonFetch<{ url: string }>(
        `/api/library?presign=${encodeURIComponent(key)}`,
      );
      window.open(url, "_blank", "noopener");
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  const crumbs = prefix.split("/").filter(Boolean);
  const displayName = (e: Entry) => e.key.replace(prefix, "").replace(/\/$/, "");

  return (
    <div className="mx-auto max-w-5xl px-5 py-8 md:px-10">
      <header className="mb-6 flex items-end justify-between gap-4">
        <div>
          <p className="label">Storage</p>
          <h1 className="text-5xl text-ink" style={{ fontFamily: "var(--font-display)" }}>
            Library
          </h1>
        </div>
        <button className="btn btn-ghost" onClick={() => load(prefix)}>
          <RefreshCw size={15} /> Refresh
        </button>
      </header>

      <div className="panel mb-4 flex flex-wrap items-center gap-1 p-3 text-sm">
        <button
          className="flex items-center gap-1 text-muted hover:text-ink"
          onClick={() => setPrefix("")}
        >
          <HardDrive size={14} /> {data?.bucket ?? "bucket"}
        </button>
        {crumbs.map((c, i) => (
          <span key={i} className="flex items-center gap-1">
            <ChevronRight size={13} className="text-faint" />
            <button
              className="text-muted hover:text-ink"
              onClick={() => setPrefix(crumbs.slice(0, i + 1).join("/") + "/")}
            >
              {c}
            </button>
          </span>
        ))}
      </div>

      {err && <p className="mb-4 text-sm text-danger">{err}</p>}

      <div className="card divide-y divide-[color:var(--color-border)] overflow-hidden">
        {loading && <p className="p-4 text-sm text-faint">Loading…</p>}
        {!loading && data && data.entries.length === 0 && (
          <p className="p-6 text-center text-sm text-faint">
            Empty. Downloads land here once archived to S3.
          </p>
        )}
        {!loading &&
          data?.entries.map((e) => (
            <div key={e.key} className="flex items-center gap-3 p-3 transition-colors hover:bg-surface-2">
              {e.isFolder ? (
                <Folder size={18} className="flex-none text-accent" />
              ) : (
                <FileVideo size={18} className="flex-none text-muted" />
              )}
              <button
                className="min-w-0 flex-1 truncate text-left text-sm text-ink"
                onClick={() => (e.isFolder ? setPrefix(e.key) : openFile(e.key))}
                title={displayName(e)}
              >
                {displayName(e)}
              </button>
              {!e.isFolder && (
                <>
                  <span className="mono text-xs text-faint">{formatBytes(e.size)}</span>
                  <button
                    className="btn btn-ghost px-2 py-1"
                    onClick={() => openFile(e.key)}
                    title="Open / download"
                  >
                    <ExternalLink size={13} />
                  </button>
                </>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}
