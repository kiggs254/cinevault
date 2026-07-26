"use client";

import { useEffect, useRef, useState } from "react";
import {
  Sparkles,
  Send,
  Loader2,
  Search,
  CheckCircle2,
  History,
  Plus,
  Trash2,
  MessageSquare,
} from "lucide-react";
import Link from "next/link";
import { readSSE, jsonFetch } from "@/lib/client";
import { Markdown } from "@/components/markdown";
import { OptionsList, type ChatOption } from "@/components/options-list";
import { useConfirm } from "@/components/confirm-dialog";
import { ActivityFeed } from "@/components/activity-feed";

type Item =
  | { kind: "msg"; role: "user" | "assistant"; content: string }
  | { kind: "options"; id: string; title: string; options: ChatOption[]; posterUrl?: string }
  | { kind: "action"; text: string };

interface SessionMeta {
  id: string;
  title: string;
  updatedAt: string;
}

let counter = 0;
const uid = () => `b${++counter}`;

const SUGGESTIONS = [
  "Hijack season 1",
  "Download Dune Part Two",
  "The Bear latest season",
];

function deriveTitle(items: Item[]): string {
  const firstUser = items.find((i) => i.kind === "msg" && i.role === "user");
  const t = firstUser && firstUser.kind === "msg" ? firstUser.content.trim() : "";
  return t ? t.slice(0, 60) : "New chat";
}

export default function ChatPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [showHistory, setShowHistory] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [trace, setTrace] = useState<string[]>([]);
  const [pickingKey, setPickingKey] = useState<string | null>(null);
  const [donePicks, setDonePicks] = useState<Set<string>>(new Set());
  const scroller = useRef<HTMLDivElement>(null);
  const skipSave = useRef(false);
  const confirm = useConfirm();

  function scrollDown() {
    requestAnimationFrame(() =>
      scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }),
    );
  }

  async function loadSessions(): Promise<SessionMeta[]> {
    try {
      const d = await jsonFetch<{ sessions: SessionMeta[] }>("/api/chat/sessions");
      setSessions(d.sessions);
      return d.sessions;
    } catch {
      return [];
    }
  }

  async function loadSession(id: string) {
    try {
      const d = await jsonFetch<{ session: { id: string; title: string; items: Item[] } }>(
        `/api/chat/sessions/${id}`,
      );
      skipSave.current = true; // don't immediately re-save what we just loaded
      setItems(Array.isArray(d.session.items) ? d.session.items : []);
      setSessionId(id);
      setDonePicks(new Set());
      setShowHistory(false);
      scrollDown();
    } catch {
      /* ignore */
    }
  }

  // Load the most recent session on mount.
  useEffect(() => {
    (async () => {
      const list = await loadSessions();
      if (list.length) await loadSession(list[0].id);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Debounced auto-save of the current session.
  useEffect(() => {
    if (!sessionId || items.length === 0) return;
    if (skipSave.current) {
      skipSave.current = false;
      return;
    }
    const t = setTimeout(() => {
      void fetch(`/api/chat/sessions/${sessionId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items, title: deriveTitle(items) }),
      })
        .then(() => loadSessions())
        .catch(() => {});
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, sessionId]);

  async function ensureSession(): Promise<string> {
    if (sessionId) return sessionId;
    const { id } = await jsonFetch<{ id: string }>("/api/chat/sessions", { method: "POST" });
    setSessionId(id);
    void loadSessions();
    return id;
  }

  async function newChat() {
    const { id } = await jsonFetch<{ id: string }>("/api/chat/sessions", { method: "POST" });
    skipSave.current = true;
    setItems([]);
    setDonePicks(new Set());
    setSessionId(id);
    setShowHistory(false);
    void loadSessions();
  }

  async function deleteSession(id: string) {
    await fetch(`/api/chat/sessions/${id}`, { method: "DELETE" }).catch(() => {});
    const list = await loadSessions();
    if (id === sessionId) {
      skipSave.current = true;
      setItems([]);
      setSessionId(list[0]?.id ?? null);
      if (list[0]) await loadSession(list[0].id);
    }
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    await ensureSession();
    const next: Item[] = [...items, { kind: "msg", role: "user", content: text }];
    setItems(next);
    setInput("");
    setBusy(true);
    setTrace([]);
    scrollDown();

    const msgs = next
      .filter((i): i is Extract<Item, { kind: "msg" }> => i.kind === "msg")
      .map((m) => ({ role: m.role, content: m.content }));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: msgs }),
      });
      if (!res.ok || !res.body) throw new Error("Chat request failed");

      await readSSE(res, (ev) => {
        if (ev.type === "status") {
          setTrace((t) => [...t, String(ev.message)]);
        } else if (ev.type === "action") {
          setItems((p) => [...p, { kind: "action", text: String(ev.message) }]);
          scrollDown();
        } else if (ev.type === "message") {
          setItems((p) => [...p, { kind: "msg", role: "assistant", content: String(ev.content) }]);
          scrollDown();
        } else if (ev.type === "options") {
          const raw = Array.isArray(ev.options) ? (ev.options as Record<string, unknown>[]) : [];
          const options: ChatOption[] = raw.map((o) => ({
            id: String(o.id),
            label: String(o.label),
            meta: o.meta ? String(o.meta) : undefined,
            recommended: !!o.recommended,
            payload: o.download,
          }));
          if (options.length) {
            setItems((p) => [
              ...p,
              {
                kind: "options",
                id: uid(),
                title: String(ev.title),
                options,
                posterUrl: ev.posterUrl ? String(ev.posterUrl) : undefined,
              },
            ]);
            scrollDown();
          }
        } else if (ev.type === "error") {
          setItems((p) => [...p, { kind: "msg", role: "assistant", content: `⚠️ ${String(ev.message)}` }]);
        }
      });
    } catch (err) {
      setItems((p) => [...p, { kind: "msg", role: "assistant", content: `⚠️ ${(err as Error).message}` }]);
    } finally {
      setBusy(false);
      setTrace([]);
      scrollDown();
    }
  }

  async function pickOption(blockId: string, o: ChatOption) {
    const key = `${blockId}:${o.id}`;
    setPickingKey(key);
    try {
      await jsonFetch("/api/download", { method: "POST", body: JSON.stringify(o.payload) });
      setDonePicks((prev) => new Set(prev).add(key));
      setItems((p) => [...p, { kind: "action", text: `Queued: ${o.label}` }]);
      scrollDown();
    } catch (err) {
      setItems((p) => [...p, { kind: "msg", role: "assistant", content: `⚠️ ${(err as Error).message}` }]);
    } finally {
      setPickingKey(null);
    }
  }

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col px-4 py-4 sm:px-5 sm:py-6 md:h-screen md:px-10">
      <header className="mb-4 flex items-end justify-between gap-3">
        <div>
          <p className="label">Assistant</p>
          <h1 className="text-3xl text-ink sm:text-5xl" style={{ fontFamily: "var(--font-display)" }}>
            Chat
          </h1>
        </div>
        <div className="flex items-center gap-2">
          <button className="btn btn-ghost" onClick={() => setShowHistory((v) => !v)}>
            <History size={15} /> <span className="hidden sm:inline">History</span>
          </button>
          <button className="btn btn-ghost" onClick={newChat}>
            <Plus size={15} /> <span className="hidden sm:inline">New</span>
          </button>
        </div>
      </header>

      {showHistory && (
        <div className="panel mb-3 max-h-60 overflow-y-auto">
          {sessions.length === 0 ? (
            <p className="p-4 text-sm text-faint">No past chats yet.</p>
          ) : (
            <div className="divide-y divide-[color:var(--color-border)]">
              {sessions.map((s) => (
                <div
                  key={s.id}
                  className={`flex items-center gap-2 px-3 py-2.5 ${
                    s.id === sessionId ? "bg-surface-2" : ""
                  }`}
                >
                  <MessageSquare size={14} className="flex-none text-muted" />
                  <button
                    className="min-w-0 flex-1 truncate text-left text-sm text-ink"
                    onClick={() => loadSession(s.id)}
                  >
                    {s.title}
                  </button>
                  <button
                    className="flex-none text-faint hover:text-danger"
                    title="Delete chat"
                    onClick={async () => {
                      if (await confirm({ title: "Delete chat?", message: `“${s.title}” will be permanently deleted.`, confirmLabel: "Delete" })) {
                        deleteSession(s.id);
                      }
                    }}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <ActivityFeed />

      <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {items.length === 0 && (
          <div className="panel rise p-6">
            <Sparkles className="mb-3 text-accent" size={22} />
            <p className="text-sm text-muted">
              Ask for a movie or show and I&apos;ll find the best releases — tap one to download.
              Chats are saved, so you can leave and come back.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  className="badge hover:border-[color:var(--color-accent)]"
                  onClick={() => setInput(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {items.map((it, i) => {
          if (it.kind === "msg") {
            return (
              <div key={i} className={`flex ${it.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[88%] rounded-2xl px-4 py-2.5 text-sm ${
                    it.role === "user"
                      ? "whitespace-pre-wrap bg-accent text-[#1a1206]"
                      : "panel text-ink"
                  }`}
                >
                  {it.role === "user" ? it.content : <Markdown>{it.content}</Markdown>}
                </div>
              </div>
            );
          }
          if (it.kind === "options") {
            const prefix = `${it.id}:`;
            const busyId = pickingKey?.startsWith(prefix) ? pickingKey.slice(prefix.length) : null;
            const doneIds = new Set(
              [...donePicks].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)),
            );
            return (
              <OptionsList
                key={it.id}
                title={it.title}
                posterUrl={it.posterUrl}
                options={it.options}
                busyId={busyId}
                doneIds={doneIds}
                onSelect={(o) => pickOption(it.id, o)}
              />
            );
          }
          return (
            <div key={i} className="flex items-center gap-2 text-xs text-success">
              <CheckCircle2 size={14} /> {it.text} —{" "}
              <Link href="/downloads" className="underline hover:text-ink">
                track in Downloads
              </Link>
            </div>
          );
        })}

        {busy && (
          <div className="space-y-1.5">
            {trace.map((t, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-muted">
                <Search size={13} className="text-accent" /> {t}
              </div>
            ))}
            <div className="flex items-center gap-2 text-xs text-muted">
              <Loader2 size={13} className="animate-spin" /> Thinking…
            </div>
          </div>
        )}
      </div>

      <form onSubmit={send} className="panel mt-4 flex items-center gap-2 p-2">
        <input
          className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm text-ink outline-none placeholder:text-faint"
          placeholder="Find a movie, show, distro… or “download …”"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={busy}
        />
        <button className="btn btn-accent flex-none" disabled={busy || !input.trim()}>
          {busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}
        </button>
      </form>
    </div>
  );
}
