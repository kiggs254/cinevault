"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Plus,
  Trash2,
  Copy,
  Check,
  X,
  Loader2,
  ChevronUp,
  ChevronDown,
  Radio,
  Zap,
  Pencil,
  Link2,
  ClipboardPaste,
  AlertTriangle,
  ExternalLink,
} from "lucide-react";
import { jsonFetch } from "@/lib/client";
import { useConfirm } from "@/components/confirm-dialog";

interface Playlist {
  id: string;
  name: string;
  sourceType: "url" | "text";
  url: string | null;
  content: string | null;
  epgUrl: string | null;
  enabled: boolean;
  order: number;
  channelCount: number;
  lastError: string | null;
  refreshedAt: string | null;
}

interface Status {
  m3uUrl: string;
  epgUrl: string;
  hasEpg: boolean;
  channels: number;
  jellyfinPublicUrl: string | null;
  jellyfin: { ready: boolean; reachable: boolean; tunerConfigured: boolean; guideConfigured: boolean };
}

type Draft = {
  id?: string;
  name: string;
  sourceType: "url" | "text";
  url: string;
  content: string;
  epgUrl: string;
};

const BLANK: Draft = { name: "", sourceType: "url", url: "", content: "", epgUrl: "" };

function hostOf(url: string | null): string {
  if (!url) return "—";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function Switch({ on, onClick }: { on: boolean; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} onClick={onClick} className="flex-none">
      <span
        className="relative inline-block h-6 w-11 rounded-full border border-border transition-colors"
        style={{ background: on ? "var(--color-accent)" : "var(--color-surface-2)" }}
      >
        <span
          className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform"
          style={{ transform: on ? "translateX(20px)" : "translateX(0)" }}
        />
      </span>
    </button>
  );
}

function Pill({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
        active ? "border-accent bg-accent/10 text-ink" : "border-border text-muted hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function StatusChip({ on, label }: { on: boolean; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs"
      style={{
        borderColor: on ? "var(--color-success)" : "var(--color-border)",
        color: on ? "var(--color-success)" : "var(--color-faint)",
      }}
    >
      {on ? <Check size={12} /> : <X size={12} />} {label} {on ? "connected" : "not connected"}
    </span>
  );
}

export default function LiveTvPage() {
  const confirm = useConfirm();
  const [status, setStatus] = useState<Status | null>(null);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [test, setTest] = useState<{ ok?: boolean; msg?: string; busy?: boolean } | null>(null);
  const [sync, setSync] = useState<{ ok?: boolean; msg?: string; busy?: boolean } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [s, p] = await Promise.all([
        jsonFetch<Status>("/api/livetv/status"),
        jsonFetch<{ playlists: Playlist[] }>("/api/livetv/playlists"),
      ]);
      setStatus(s);
      setPlaylists(p.playlists);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const upd = (patch: Partial<Draft>) => {
    setDraft((d) => (d ? { ...d, ...patch } : d));
    setTest(null);
  };

  function copy(text: string, which: string) {
    navigator.clipboard?.writeText(text).then(() => {
      setCopied(which);
      setTimeout(() => setCopied((c) => (c === which ? null : c)), 1500);
    });
  }

  async function toggle(p: Playlist) {
    setPlaylists((list) => list.map((x) => (x.id === p.id ? { ...x, enabled: !x.enabled } : x)));
    try {
      await jsonFetch(`/api/livetv/playlists/${p.id}`, {
        method: "PATCH",
        body: JSON.stringify({ enabled: !p.enabled }),
      });
    } finally {
      load();
    }
  }

  async function move(p: Playlist, dir: "up" | "down") {
    await jsonFetch(`/api/livetv/playlists/${p.id}`, {
      method: "PATCH",
      body: JSON.stringify({ move: dir }),
    });
    load();
  }

  async function remove(p: Playlist) {
    const ok = await confirm({
      title: `Remove “${p.name}”?`,
      message: "Its channels disappear from Jellyfin on the next guide refresh.",
      confirmLabel: "Remove",
    });
    if (!ok) return;
    await jsonFetch(`/api/livetv/playlists/${p.id}`, { method: "DELETE" });
    load();
  }

  async function runTest() {
    if (!draft) return;
    setTest({ busy: true });
    try {
      const r = await jsonFetch<{ ok: boolean; channelCount: number; message: string }>(
        "/api/livetv/validate",
        {
          method: "POST",
          body: JSON.stringify({
            sourceType: draft.sourceType,
            url: draft.url,
            content: draft.content,
          }),
        },
      );
      setTest({ ok: r.ok, msg: r.message });
    } catch (e) {
      setTest({ ok: false, msg: (e as Error).message });
    }
  }

  async function saveDraft() {
    if (!draft) return;
    setBusy(true);
    setErr("");
    try {
      const payload = {
        name: draft.name,
        sourceType: draft.sourceType,
        url: draft.url,
        content: draft.content,
        epgUrl: draft.epgUrl,
      };
      if (draft.id) {
        await jsonFetch(`/api/livetv/playlists/${draft.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
      } else {
        await jsonFetch("/api/livetv/playlists", { method: "POST", body: JSON.stringify(payload) });
      }
      setDraft(null);
      setTest(null);
      load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function runSync() {
    setSync({ busy: true });
    try {
      const r = await jsonFetch<{ ok: boolean; message: string }>("/api/livetv/sync", {
        method: "POST",
      });
      setSync({ ok: r.ok, msg: r.message });
      load();
    } catch (e) {
      setSync({ ok: false, msg: (e as Error).message });
    }
  }

  const draftIncomplete =
    !draft?.name.trim() ||
    (draft?.sourceType === "url" ? !draft?.url.trim() : !draft?.content.trim());

  return (
    <div className="mx-auto max-w-4xl px-5 py-8 md:px-10">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="label">Live TV</p>
          <h1 className="text-5xl text-ink" style={{ fontFamily: "var(--font-display)" }}>
            Channels
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {err && <span className="text-sm text-danger">{err}</span>}
          <button
            className="btn btn-accent"
            onClick={() => {
              setDraft({ ...BLANK });
              setTest(null);
            }}
          >
            <Plus size={15} /> Add playlist
          </button>
        </div>
      </header>

      {loading ? (
        <p className="text-sm text-faint">Loading…</p>
      ) : (
        <div className="space-y-6">
          {status && (
            <div className="panel p-6">
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <h2 className="flex items-center gap-2 text-lg font-semibold text-ink">
                    <Radio size={18} /> Connect to Jellyfin
                  </h2>
                  <p className="mt-1 max-w-xl text-xs text-muted">
                    Every enabled playlist is merged into one feed. Jellyfin loads it as a Live TV
                    M3U tuner — {status.channels} channel{status.channels === 1 ? "" : "s"} enabled
                    right now.
                  </p>
                </div>
                {status.jellyfinPublicUrl && (
                  <a
                    className="btn btn-ghost flex-none"
                    href={`${status.jellyfinPublicUrl.replace(/\/+$/, "")}/web/index.html#/livetv.html`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={14} /> Open
                  </a>
                )}
              </div>

              <div className="space-y-3">
                <div>
                  <label className="label mb-1 block">M3U playlist URL</label>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      className="input mono text-xs"
                      value={status.m3uUrl}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <button
                      className="btn btn-ghost flex-none"
                      onClick={() => copy(status.m3uUrl, "m3u")}
                      aria-label="Copy M3U URL"
                    >
                      {copied === "m3u" ? (
                        <Check size={14} className="text-success" />
                      ) : (
                        <Copy size={14} />
                      )}
                    </button>
                  </div>
                </div>
                {status.hasEpg && (
                  <div>
                    <label className="label mb-1 block">XMLTV guide URL</label>
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        className="input mono text-xs"
                        value={status.epgUrl}
                        onFocus={(e) => e.currentTarget.select()}
                      />
                      <button
                        className="btn btn-ghost flex-none"
                        onClick={() => copy(status.epgUrl, "epg")}
                        aria-label="Copy guide URL"
                      >
                        {copied === "epg" ? (
                          <Check size={14} className="text-success" />
                        ) : (
                          <Copy size={14} />
                        )}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="mt-5 flex flex-wrap items-center gap-3">
                <button
                  className="btn btn-accent"
                  onClick={runSync}
                  disabled={!status.jellyfin.ready || sync?.busy}
                >
                  {sync?.busy ? (
                    <Loader2 size={15} className="animate-spin" />
                  ) : (
                    <Zap size={15} />
                  )}{" "}
                  Sync to Jellyfin
                </button>
                <StatusChip on={status.jellyfin.tunerConfigured} label="Tuner" />
                {status.hasEpg && <StatusChip on={status.jellyfin.guideConfigured} label="Guide" />}
                {sync && !sync.busy && (
                  <span className={`text-xs ${sync.ok ? "text-success" : "text-danger"}`}>
                    {sync.msg}
                  </span>
                )}
              </div>

              {!status.jellyfin.ready && (
                <p className="mt-3 flex items-center gap-1.5 text-xs text-muted">
                  <AlertTriangle size={13} className="flex-none" /> Add your Jellyfin URL + API key in{" "}
                  <a className="text-accent hover:underline" href="/settings">
                    Settings → Media
                  </a>{" "}
                  for one-click sync — or paste the URLs above into Jellyfin manually.
                </p>
              )}

              <details className="mt-4">
                <summary className="cursor-pointer text-xs text-muted hover:text-ink">
                  Set it up manually in Jellyfin
                </summary>
                <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-muted">
                  <li>
                    Dashboard → Live TV → Tuner Devices → <b>+</b> → <b>M3U Tuner</b>, paste the M3U
                    URL, Save.
                  </li>
                  {status.hasEpg && (
                    <li>
                      TV Guide Data Providers → <b>+</b> → <b>XMLTV</b>, paste the guide URL, Save.
                    </li>
                  )}
                  <li>
                    Dashboard → Scheduled Tasks → run <b>Refresh Guide</b>.
                  </li>
                </ol>
              </details>
            </div>
          )}

          {playlists.length === 0 ? (
            <div className="panel flex flex-col items-center gap-3 p-12 text-center">
              <Radio size={28} className="text-faint" />
              <p className="text-sm text-muted">
                No playlists yet. Add a legally-sourced M3U to bring live channels into Jellyfin.
              </p>
              <button
                className="btn btn-accent"
                onClick={() => {
                  setDraft({ ...BLANK });
                  setTest(null);
                }}
              >
                <Plus size={15} /> Add your first playlist
              </button>
            </div>
          ) : (
            <div className="panel divide-y divide-border">
              {playlists.map((p, i) => (
                <div key={p.id} className="flex items-center gap-3 p-4">
                  <Switch on={p.enabled} onClick={() => toggle(p)} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`truncate font-medium ${p.enabled ? "text-ink" : "text-faint"}`}>
                        {p.name}
                      </span>
                      {p.epgUrl && <span className="badge">EPG</span>}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted">
                      <span className="truncate">
                        {p.sourceType === "text" ? "Pasted playlist" : hostOf(p.url)}
                      </span>
                      <span>·</span>
                      <span>{p.channelCount} ch</span>
                      {p.lastError && (
                        <span className="truncate text-danger">· {p.lastError}</span>
                      )}
                    </div>
                  </div>
                  <div className="flex flex-none flex-col">
                    <button
                      className="p-0.5 text-muted hover:text-ink disabled:opacity-30"
                      onClick={() => move(p, "up")}
                      disabled={i === 0}
                      aria-label="Move up"
                    >
                      <ChevronUp size={16} />
                    </button>
                    <button
                      className="p-0.5 text-muted hover:text-ink disabled:opacity-30"
                      onClick={() => move(p, "down")}
                      disabled={i === playlists.length - 1}
                      aria-label="Move down"
                    >
                      <ChevronDown size={16} />
                    </button>
                  </div>
                  <button
                    className="flex-none rounded-lg p-2 text-muted hover:text-ink"
                    onClick={() => {
                      setDraft({
                        id: p.id,
                        name: p.name,
                        sourceType: p.sourceType,
                        url: p.url ?? "",
                        content: p.content ?? "",
                        epgUrl: p.epgUrl ?? "",
                      });
                      setTest(null);
                    }}
                    aria-label="Edit"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    className="flex-none rounded-lg p-2 text-muted hover:text-danger"
                    onClick={() => remove(p)}
                    aria-label="Delete"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {draft && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4"
          onClick={() => !busy && setDraft(null)}
        >
          <div
            className="w-full max-w-lg rounded-2xl border border-border bg-surface p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">
                {draft.id ? "Edit playlist" : "Add playlist"}
              </h2>
              <button
                className="rounded-lg p-1.5 text-muted hover:text-ink"
                onClick={() => setDraft(null)}
                aria-label="Close"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="label mb-1.5 block">Name</label>
                <input
                  className="input"
                  placeholder="e.g. My IPTV provider"
                  value={draft.name}
                  onChange={(e) => upd({ name: e.target.value })}
                />
              </div>

              <div>
                <label className="label mb-1.5 block">Source</label>
                <div className="flex gap-2">
                  <Pill active={draft.sourceType === "url"} onClick={() => upd({ sourceType: "url" })}>
                    <Link2 size={14} /> URL
                  </Pill>
                  <Pill
                    active={draft.sourceType === "text"}
                    onClick={() => upd({ sourceType: "text" })}
                  >
                    <ClipboardPaste size={14} /> Paste
                  </Pill>
                </div>
              </div>

              {draft.sourceType === "url" ? (
                <div>
                  <label className="label mb-1.5 block">Playlist URL (M3U / M3U8)</label>
                  <input
                    className="input mono text-xs"
                    placeholder="https://provider.example/get.php?...&type=m3u_plus"
                    value={draft.url}
                    onChange={(e) => upd({ url: e.target.value })}
                  />
                </div>
              ) : (
                <div>
                  <label className="label mb-1.5 block">Playlist content</label>
                  <textarea
                    className="input mono text-xs"
                    style={{ minHeight: "9rem" }}
                    placeholder={"#EXTM3U\n#EXTINF:-1 tvg-id=\"...\" group-title=\"News\",Channel\nhttp://..."}
                    value={draft.content}
                    onChange={(e) => upd({ content: e.target.value })}
                  />
                </div>
              )}

              <div>
                <label className="label mb-1.5 block">
                  EPG / XMLTV guide URL <span className="text-faint">(optional)</span>
                </label>
                <input
                  className="input mono text-xs"
                  placeholder="https://provider.example/xmltv.php?... (.xml or .xml.gz)"
                  value={draft.epgUrl}
                  onChange={(e) => upd({ epgUrl: e.target.value })}
                />
              </div>

              {test && !test.busy && (
                <p className={`text-xs ${test.ok ? "text-success" : "text-danger"}`}>
                  {test.ok ? (
                    <Check size={12} className="mr-1 inline" />
                  ) : (
                    <X size={12} className="mr-1 inline" />
                  )}
                  {test.msg}
                </p>
              )}
            </div>

            <div className="mt-6 flex items-center justify-between gap-2">
              <button
                className="btn btn-ghost"
                onClick={runTest}
                disabled={
                  test?.busy ||
                  (draft.sourceType === "url" ? !draft.url.trim() : !draft.content.trim())
                }
              >
                {test?.busy ? <Loader2 size={14} className="animate-spin" /> : <Radio size={14} />} Test
              </button>
              <div className="flex gap-2">
                <button className="btn btn-ghost" onClick={() => setDraft(null)} disabled={busy}>
                  Cancel
                </button>
                <button className="btn btn-accent" onClick={saveDraft} disabled={busy || draftIncomplete}>
                  {busy ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}{" "}
                  {draft.id ? "Save" : "Add"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
