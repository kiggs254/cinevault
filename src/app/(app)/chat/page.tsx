"use client";

import { useRef, useState } from "react";
import { Sparkles, Send, Loader2, Search, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { readSSE, jsonFetch } from "@/lib/client";
import { Markdown } from "@/components/markdown";
import { OptionsList, type ChatOption } from "@/components/options-list";

type Item =
  | { kind: "msg"; role: "user" | "assistant"; content: string }
  | { kind: "options"; id: string; title: string; options: ChatOption[] }
  | { kind: "action"; text: string };

let counter = 0;
const uid = () => `b${++counter}`;

const SUGGESTIONS = [
  "Find Debian 12 netinst",
  "Show me Ubuntu 24.04 options",
  "Grab the latest Alpine standard ISO",
];

export default function ChatPage() {
  const [items, setItems] = useState<Item[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [trace, setTrace] = useState<string[]>([]);
  const [pickingKey, setPickingKey] = useState<string | null>(null);
  const [donePicks, setDonePicks] = useState<Set<string>>(new Set());
  const scroller = useRef<HTMLDivElement>(null);

  function scrollDown() {
    requestAnimationFrame(() =>
      scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" }),
    );
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
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
            setItems((p) => [...p, { kind: "options", id: uid(), title: String(ev.title), options }]);
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
    <div className="mx-auto flex h-[100dvh] max-w-3xl flex-col px-5 py-6 md:h-screen md:px-10">
      <header className="mb-4">
        <p className="label">Assistant</p>
        <h1 className="text-5xl text-ink" style={{ fontFamily: "var(--font-display)" }}>
          Chat
        </h1>
      </header>

      <div ref={scroller} className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {items.length === 0 && (
          <div className="panel rise p-6">
            <Sparkles className="mb-3 text-accent" size={22} />
            <p className="text-sm text-muted">
              Ask me to find media and I&apos;ll show you a **tappable list** of results — pick one to
              download it straight to your storage. I can also grab batches (&ldquo;all of a
              show&apos;s season&rdquo;).
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
                options={it.options}
                busyId={busyId}
                doneIds={doneIds}
                onSelect={(o) => pickOption(it.id, o)}
              />
            );
          }
          // action
          return (
            <div key={i} className="flex items-center gap-2 text-xs text-success">
              <CheckCircle2 size={14} /> {it.text} —{" "}
              <Link href="/" className="underline hover:text-ink">
                track on Command
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
