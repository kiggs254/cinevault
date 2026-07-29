"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Clapperboard,
  Loader2,
  Clock,
  CheckCircle2,
  Smartphone,
  Tv,
  Globe,
  ArrowRight,
  Link2,
  Send,
  Check,
} from "lucide-react";

/** Official Jellyfin clients. Store links are stable; the rest go to the canonical
 * downloads page (always correct for Fire TV / Roku / LG / Samsung). Labels are kept
 * short so they never overflow. */
const APPS: { label: string; href: string; icon: typeof Smartphone }[] = [
  { label: "iPhone / iPad", href: "https://apps.apple.com/app/jellyfin-mobile/id1480192618", icon: Smartphone },
  { label: "Android", href: "https://play.google.com/store/apps/details?id=org.jellyfin.mobile", icon: Smartphone },
  { label: "Android TV / Fire TV", href: "https://play.google.com/store/apps/details?id=org.jellyfin.androidtv", icon: Tv },
  { label: "Roku, LG, Samsung & more", href: "https://jellyfin.org/downloads/clients/", icon: Tv },
];

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
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/4 h-[38rem] w-[38rem] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-30 blur-[130px]"
        style={{ background: "radial-gradient(circle, var(--color-accent), transparent 65%)" }}
      />

      <div className="panel rise relative w-full max-w-lg p-8">
        <div className="mb-6 flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface-2 text-accent">
            <Clapperboard size={20} />
          </span>
          <h1 className="text-3xl leading-none text-ink" style={{ fontFamily: "var(--font-display)", letterSpacing: "0.02em" }}>
            CINE<span className="text-accent">VAULT</span>
          </h1>
        </div>

        {status === "loading" && (
          <p className="flex items-center gap-2 text-sm text-faint">
            <Loader2 size={15} className="animate-spin" /> Checking your membership…
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
              <Clock size={18} className="text-accent" /> Membership pending
            </p>
            <p className="mb-5 text-sm text-muted">
              Thanks{s?.username ? `, ${s.username}` : ""}! A member referred you and the librarian has been
              notified. Your card will be issued once they approve you — this page updates automatically, so you
              can leave it open.
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
            <p className="mb-2 font-semibold text-ink">Membership declined</p>
            <p className="text-sm text-muted">Reach out to the member who referred you if you think this is a mistake.</p>
          </div>
        )}

        {status === "active" && (
          <div>
            <p className="mb-1 flex items-center gap-2 text-lg font-semibold text-ink">
              <CheckCircle2 size={20} style={{ color: "var(--color-success)" }} /> Welcome to the library
              {s?.username ? `, ${s.username}` : ""}!
            </p>
            <p className="mb-5 text-sm text-muted">
              Your library card is ready. Here&apos;s how to start watching the collection.
            </p>

            <ol className="space-y-5">
              <li>
                <p className="label mb-2">1 · Install Jellyfin (your player)</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {APPS.map((a) => (
                    <a
                      key={a.label}
                      href={a.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm text-muted transition-colors hover:border-accent hover:text-ink"
                    >
                      <a.icon size={15} className="flex-none" />
                      <span className="min-w-0 leading-snug">{a.label}</span>
                    </a>
                  ))}
                </div>
              </li>

              <li>
                <p className="label mb-2">2 · Add the library</p>
                <p className="mb-2 text-sm text-muted">In the Jellyfin app, tap “Add Server” and enter:</p>
                <div className="flex items-center gap-2 overflow-x-auto rounded-lg border border-border bg-surface-2 px-3 py-2">
                  <Globe size={15} className="flex-none text-faint" />
                  <code className="mono whitespace-nowrap text-sm text-ink">
                    {s?.serverUrl || "ask the librarian for the server address"}
                  </code>
                </div>
              </li>

              <li>
                <p className="label mb-2">3 · Sign in with your card</p>
                <p className="text-sm text-muted">
                  Use member name <span className="mono text-ink">{s?.username}</span> and the password you set
                  when applying.
                </p>
              </li>
            </ol>

            <Link href="/login" className="btn btn-accent mt-6 w-full">
              Enter the Cinevault portal <ArrowRight size={15} />
            </Link>
            <p className="mt-3 text-center text-xs text-faint">
              Browse &amp; request titles in the portal — then watch them on Jellyfin. You can connect Telegram
              and invite friends from inside the portal.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
