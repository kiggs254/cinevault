"use client";

import { useRef, useState } from "react";
import { Sparkles, Send, Loader2, CheckCircle2, Search } from "lucide-react";
import { readSSE } from "@/lib/client";

interface Msg {
  role: "user" | "assistant";
  content: string;
}
interface Trace {
  kind: "status" | "action";
  text: string;
}

const SUGGESTIONS = [
  "Find The Matrix 1999 in 1080p",
  "Grab Interstellar in 4K",
  "Download all of a show's season 1 in 1080p",
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [trace, setTrace] = useState<Trace[]>([]);
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
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    setTrace([]);
    scrollDown();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      if (!res.ok || !res.body) throw new Error("Chat request failed");

      await readSSE(res, (ev) => {
        if (ev.type === "status") setTrace((t) => [...t, { kind: "status", text: String(ev.message) }]);
        else if (ev.type === "action")
          setTrace((t) => [...t, { kind: "action", text: String(ev.message) }]);
        else if (ev.type === "message") {
          setMessages((m) => [...m, { role: "assistant", content: String(ev.content) }]);
          scrollDown();
        } else if (ev.type === "error") {
          setMessages((m) => [...m, { role: "assistant", content: `⚠️ ${String(ev.message)}` }]);
        }
      });
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: `⚠️ ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
      setTrace([]);
      scrollDown();
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
        {messages.length === 0 && (
          <div className="panel rise p-6">
            <Sparkles className="mb-3 text-accent" size={22} />
            <p className="text-sm text-muted">
              Ask me to find or fetch anything. I can search indexers, compare releases, and queue
              downloads — including batches like “all of a show’s season”.
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

        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm ${
                m.role === "user" ? "bg-accent text-[#1a1206]" : "panel text-ink"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}

        {busy && (
          <div className="space-y-1.5">
            {trace.map((t, i) => (
              <div key={i} className="flex items-center gap-2 text-xs text-muted">
                {t.kind === "action" ? (
                  <CheckCircle2 size={13} className="text-success" />
                ) : (
                  <Search size={13} className="text-accent" />
                )}
                {t.text}
              </div>
            ))}
            {trace.length === 0 && (
              <div className="flex items-center gap-2 text-xs text-muted">
                <Loader2 size={13} className="animate-spin" /> Thinking…
              </div>
            )}
          </div>
        )}
      </div>

      <form onSubmit={send} className="panel mt-4 flex items-center gap-2 p-2">
        <input
          className="min-w-0 flex-1 bg-transparent px-2 py-2 text-sm text-ink outline-none placeholder:text-faint"
          placeholder="Ask for a movie, show, or “download …”"
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
