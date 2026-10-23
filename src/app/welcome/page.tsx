"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Clapperboard,
  Loader2,
  Clock,
  CheckCircle2,
  ArrowRight,
  Link2,
  Send,
  Check,
  Bell,
} from "lucide-react";
import { MoonfinSetup } from "@/components/moonfin-setup";

interface Status {
  status: string;
  username: string;
  telegramLinked: boolean;
  serverUrl: string | null;
  telegramConfigured: boolean;
}

export default function WelcomePage() {
  const [s, setS] = useState<Status | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    if (!token) {
      setLoading(false);
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const res = await fetch(`/api/auth/status?token=${token}`);
        const d = (await res.json().catch(() => null)) as Status | null;
        if (!alive) return;
        setS(d);
        setLoading(false);
        if (d && d.status !== "active" && d.status !== "denied") timer = setTimeout(poll, 5000);
      } catch {
        if (alive) timer = setTimeout(poll, 5000);
      }
    };
    poll();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, []);

  async function copyStatusLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  }

  async function connectTelegram() {
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    try {
      const res = await fetch(`/api/telegram/link?statusToken=${token}`, { method: "POST" });
      const d = await res.json().catch(() => ({}));
      if (d.url) window.open(d.url, "_blank", "noopener");
    } catch {
      /* best-effort */
    }
  }

  const status = s?.status ?? (loading ? "loading" : "unknown");

  return (
    <main className="relative flex min-h-[100dvh] justify-center overflow-y-auto p-4 sm:p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/4 h-[38rem] w-[38rem] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-30 blur-[130px]"
        style={{ background: "radial-gradient(circle, var(--color-accent), transparent 65%)" }}
      />

      <div className="panel rise relative my-auto w-full max-w-lg p-7 sm:p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface-2 text-accent">
            <Clapperboard size={20} />
          </span>
          <h1
            className="text-3xl leading-none text-ink"
            style={{ fontFamily: "var(--font-display)", letterSpacing: "0.02em" }}
          >
            CINE<span className="text-accent">VAULT</span>
          </h1>
        </div>

        {status === "loading" && (
          <p className="flex items-center gap-2 text-sm text-faint">
            <Loader2 size={15} className="animate-spin" /> Checking your status…
          </p>
        )}

        {status === "unknown" && (
          <p className="text-sm text-muted">
            We couldn&apos;t find your application.{" "}
            <Link href="/register" className="text-accent hover:underline">
              Apply again
            </Link>
            .
          </p>
        )}

        {status === "pending" && (
          <div>
            <p className="mb-2 flex items-center gap-2 font-semibold text-ink">
              <Clock size={18} className="text-accent" /> Waiting for approval
            </p>
            <p className="mb-5 text-sm text-muted">
              Thanks{s?.username ? `, ${s.username}` : ""}! A member referred you and the admin has been
              notified. You&apos;ll get access once they approve you — this page updates automatically, so you can
              leave it open.
            </p>

            <div className="space-y-2">
              <button onClick={copyStatusLink} className="btn btn-ghost w-full justify-start">
                {copied ? <Check size={15} style={{ color: "var(--color-success)" }} /> : <Link2 size={15} />}
                {copied ? "Link copied — save it to check back" : "Copy my status link (to check back later)"}
              </button>

              {s?.telegramConfigured &&
                (s.telegramLinked ? (
                  <p className="flex items-center gap-2 px-1 text-sm text-muted">
                    <Check size={15} style={{ color: "var(--color-success)" }} /> Telegram connected — we&apos;ll
                    message you the moment you&apos;re approved.
                  </p>
                ) : (
                  <button onClick={connectTelegram} className="btn btn-ghost w-full justify-start">
                    <Send size={15} /> Get notified on Telegram when approved
                  </button>
                ))}
            </div>
          </div>
        )}

        {status === "denied" && (
          <div>
            <p className="mb-2 font-semibold text-ink">Access declined</p>
            <p className="text-sm text-muted">Reach out to the member who referred you if you think this is a mistake.</p>
          </div>
        )}

        {status === "active" && (
          <div>
            <p className="mb-1 flex items-center gap-2 text-lg font-semibold text-ink">
              <CheckCircle2 size={20} style={{ color: "var(--color-success)" }} /> You&apos;re in
              {s?.username ? `, ${s.username}` : ""}!
            </p>
            <p className="mb-6 text-sm text-muted">
              Your account is ready. Four quick steps in the Moonfin app and you&apos;re watching — and requesting.
            </p>

            <MoonfinSetup serverUrl={s?.serverUrl ?? null} username={s?.username} />

            <Link href="/login" className="btn btn-accent mt-6 w-full">
              Enter the Cinevault portal <ArrowRight size={15} />
            </Link>
            <p className="mt-3 flex items-start gap-1.5 text-center text-xs text-faint">
              <Bell size={13} className="mt-0.5 flex-none" />
              <span>
                The Cinevault portal is where you manage your library, notifications and Telegram — but day to day,
                Moonfin is all you need.
              </span>
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
