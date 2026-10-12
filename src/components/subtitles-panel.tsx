"use client";

import { useEffect, useState } from "react";
import { Captions, Check, Loader2 } from "lucide-react";
import { jsonFetch } from "@/lib/client";

/** The per-file shape this panel needs from a library title. */
export interface SubtitleItem {
  id: string;
  season: number | null;
  episode: number | null;
  s3Key: string | null;
  subs: string | null;
  subsChecked: boolean;
}

interface Settings {
  enabled: boolean;
  autoNew: boolean;
  autoSweep: boolean;
  languages: string[];
  providers: string[];
}

/**
 * Server-side subtitle settings change rarely, so fetch them once per page load
 * rather than every time a title is opened.
 */
let cached: Settings | null = null;
let inflight: Promise<Settings> | null = null;
function loadSettings(): Promise<Settings> {
  if (cached) return Promise.resolve(cached);
  inflight ??= jsonFetch<Settings>("/api/subtitles")
    .then((s) => {
      cached = s;
      return s;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

const ready = (items: SubtitleItem[]) => items.filter((i) => i.s3Key);
const covered = (items: SubtitleItem[]) => ready(items).filter((i) => i.subs);

/** Files grouped by season, for per-season requests. */
function bySeason(items: SubtitleItem[]): { season: number; items: SubtitleItem[] }[] {
  const m = new Map<number, SubtitleItem[]>();
  for (const i of ready(items)) {
    const s = i.season ?? 0;
    m.set(s, [...(m.get(s) ?? []), i]);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([season, items]) => ({ season, items }));
}

/**
 * Ask for subtitles for a whole title, one season, or a single file — and show
 * what's already there. This is the path that matters when automatic fetching is
 * switched off: providers have small daily quotas, so spending them on something
 * about to be watched beats spending them on a library-wide sweep.
 */
export function SubtitlesPanel({
  kind,
  tmdbId,
  items,
  onRequested,
}: {
  kind: string;
  tmdbId: number | null;
  items: SubtitleItem[];
  onRequested?: () => void;
}) {
  const [cfg, setCfg] = useState<Settings | null>(cached);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [ok, setOk] = useState(true);

  useEffect(() => {
    loadSettings()
      .then(setCfg)
      .catch(() => {});
  }, []);

  const files = ready(items);
  if (!cfg?.enabled || files.length === 0) return null;

  const have = covered(items).length;
  const langs = cfg.languages.map((l) => l.toUpperCase()).join(", ");
  const seasons = kind === "TV" ? bySeason(items) : [];

  async function request(body: Record<string, unknown>, tag: string) {
    setBusy(tag);
    setMsg("");
    try {
      const r = await jsonFetch<{ ok: boolean; message: string }>("/api/subtitles", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setOk(r.ok);
      setMsg(r.message);
      if (r.ok) onRequested?.();
    } catch (e) {
      setOk(false);
      setMsg((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const allCovered = have === files.length;

  return (
    <div className="border-t border-border p-4">
      <p className="label mb-2 flex items-center gap-1.5">
        <Captions size={12} /> Subtitles ({langs})
      </p>

      <p className="mb-3 text-xs text-muted">
        {allCovered ? (
          <span className="flex items-center gap-1.5 text-success">
            <Check size={13} /> All {files.length} file{files.length === 1 ? "" : "s"} have subtitles
          </span>
        ) : have > 0 ? (
          `${have} of ${files.length} files have subtitles`
        ) : (
          "No subtitles stored yet"
        )}
      </p>

      {!allCovered && (
        <button
          className="btn btn-ghost w-full"
          disabled={busy !== null}
          onClick={() =>
            request(tmdbId ? { tmdbId } : { downloadId: files[0].id }, "all")
          }
        >
          {busy === "all" ? <Loader2 size={14} className="animate-spin" /> : <Captions size={14} />}
          {kind === "TV" ? "Get subtitles for this show" : "Get subtitles"}
        </button>
      )}

      {/* A season at a time, so one season's worth of quota is all it costs. */}
      {!allCovered && tmdbId != null && seasons.length > 1 && (
        <div className="mt-2 space-y-1.5">
          {seasons.map(({ season, items: si }) => {
            const done = si.filter((i) => i.subs).length;
            const tag = `s${season}`;
            return (
              <div
                key={season}
                className="flex items-center justify-between gap-3 rounded-lg border border-border bg-surface-2 px-3 py-2"
              >
                <span className="text-xs text-muted">
                  {season === 0 ? "Specials / extras" : `Season ${season}`} — {done}/{si.length}
                </span>
                {done === si.length ? (
                  <Check size={13} className="flex-none text-success" />
                ) : (
                  <button
                    className="inline-flex flex-none items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-accent hover:bg-surface disabled:opacity-50"
                    disabled={busy !== null}
                    onClick={() => request({ tmdbId, season }, tag)}
                  >
                    {busy === tag ? <Loader2 size={12} className="animate-spin" /> : null} Get
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}

      {msg && (
        <p
          className="mt-2 text-[11px]"
          style={{ color: ok ? "var(--color-success)" : "var(--color-danger)" }}
        >
          {msg}
        </p>
      )}
      <p className="mt-2 text-[11px] text-faint">
        {cfg.providers.length === 0
          ? "No subtitle provider is configured, so only subtitles included in a release can be used."
          : cfg.autoNew
            ? "New downloads get subtitles automatically; use this for anything still missing."
            : "Automatic fetching is off — subtitles arrive only when you ask here."}
      </p>
    </div>
  );
}
