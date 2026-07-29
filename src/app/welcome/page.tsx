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
} from "lucide-react";

/** Official Jellyfin client links. Store links are stable; the rest go to the
 * canonical downloads page (always correct for Fire TV / Roku / LG / Samsung). */
const APPS: { label: string; href: string; icon: typeof Smartphone }[] = [
  { label: "iPhone / iPad (App Store)", href: "https://apps.apple.com/app/jellyfin-mobile/id1480192618", icon: Smartphone },
  { label: "Android (Google Play)", href: "https://play.google.com/store/apps/details?id=org.jellyfin.mobile", icon: Smartphone },
  { label: "Android TV / Fire TV", href: "https://play.google.com/store/apps/details?id=org.jellyfin.androidtv", icon: Tv },
  { label: "All other devices (Roku, LG, Samsung…)", href: "https://jellyfin.org/downloads/clients/", icon: Tv },
];

export default function WelcomePage() {
  const [status, setStatus] = useState("loading");
  const [username, setUsername] = useState("");
  const [serverUrl, setServerUrl] = useState("");

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get("token") ?? "";
    if (!token) {
      setStatus("unknown");
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const res = await fetch(`/api/auth/status?token=${token}`);
        const d = await res.json().catch(() => ({}));
        if (!alive) return;
        setStatus(d.status ?? "unknown");
        setUsername(d.username ?? "");
        setServerUrl(d.serverUrl ?? "");
        if (d.status !== "active" && d.status !== "denied") timer = setTimeout(poll, 5000);
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
            <Loader2 size={15} className="animate-spin" /> Checking your status…
          </p>
        )}

        {status === "unknown" && (
          <p className="text-sm text-muted">
            We couldn&apos;t find your request.{" "}
            <Link href="/register" className="text-accent hover:underline">
              Register again
            </Link>
            .
          </p>
        )}

        {status === "pending" && (
          <div>
            <p className="mb-2 flex items-center gap-2 font-semibold text-ink">
              <Clock size={18} className="text-accent" /> Waiting for approval
            </p>
            <p className="text-sm text-muted">
              Thanks{username ? `, ${username}` : ""}! Your request is in. The owner has been notified and will
              approve you shortly — this page updates automatically. You can leave it open.
            </p>
          </div>
        )}

        {status === "denied" && (
          <div>
            <p className="mb-2 font-semibold text-ink">Request not approved</p>
            <p className="text-sm text-muted">Reach out to the person who invited you if you think this is a mistake.</p>
          </div>
        )}

        {status === "active" && (
          <div>
            <p className="mb-1 flex items-center gap-2 text-lg font-semibold text-ink">
              <CheckCircle2 size={20} style={{ color: "var(--color-success)" }} /> You&apos;re in
              {username ? `, ${username}` : ""}!
            </p>
            <p className="mb-5 text-sm text-muted">Your Cinevault + Jellyfin account is ready. Here&apos;s how to start watching.</p>

            <ol className="space-y-5">
              <li>
                <p className="label mb-2">1 · Install Jellyfin on your device</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {APPS.map((a) => (
                    <a
                      key={a.label}
                      href={a.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-ghost justify-start text-left text-sm"
                    >
                      <a.icon size={15} /> {a.label}
                    </a>
                  ))}
                </div>
              </li>

              <li>
                <p className="label mb-2">2 · Add the server</p>
                <p className="mb-2 text-sm text-muted">In the Jellyfin app, tap “Add Server” and enter:</p>
                <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
                  <Globe size={15} className="text-faint" />
                  <code className="mono text-sm text-ink">{serverUrl || "ask the owner for the server URL"}</code>
                </div>
              </li>

              <li>
                <p className="label mb-2">3 · Sign in</p>
                <p className="text-sm text-muted">
                  Use username <span className="mono text-ink">{username}</span> and the password you chose when
                  registering.
                </p>
              </li>
            </ol>

            <div className="mt-6 flex flex-col gap-2 border-t border-border pt-5 sm:flex-row">
              <Link href="/login" className="btn btn-accent flex-1">
                Open the Cinevault portal <ArrowRight size={15} />
              </Link>
            </div>
            <p className="mt-3 text-center text-xs text-faint">
              Browse &amp; request titles in the portal — then watch them on Jellyfin. You can connect Telegram from
              inside the portal.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
