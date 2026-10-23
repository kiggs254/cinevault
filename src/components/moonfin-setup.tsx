"use client";

import { useState } from "react";
import { Check, Copy, Globe, Lightbulb, Smartphone, Sparkles, Tv } from "lucide-react";
import { MOONFIN_APPS, MOONFIN_WHY } from "@/lib/community";
import { SetupStep } from "./setup-step";

const JELLYFIN_TV_APPS = "https://jellyfin.org/downloads/clients/";

/**
 * The member setup: Moonfin is THE app — it plays the shared library and has
 * requesting built in (through the server's Seerr). The official Jellyfin app
 * is only the fallback for Samsung/LG TVs, where Moonfin isn't in the store.
 * Shared by /welcome (right after approval) and the in-app Member guide.
 */
export function MoonfinSetup({ serverUrl, username }: { serverUrl: string | null; username?: string }) {
  const [copied, setCopied] = useState(false);

  async function copyServer() {
    if (!serverUrl) return;
    try {
      await navigator.clipboard.writeText(serverUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className="text-sm text-muted">
      <div className="mb-6 rounded-lg border border-border bg-surface-2 p-3">
        <p className="mb-2 flex items-center gap-2 font-medium text-ink">
          <Sparkles size={15} className="text-accent" /> Moonfin is your app for everything
        </p>
        <ul className="space-y-1.5">
          {MOONFIN_WHY.map((d) => (
            <li key={d} className="flex gap-2">
              <span className="mt-[7px] h-1 w-1 flex-none rounded-full bg-accent" />
              <span>{d}</span>
            </li>
          ))}
        </ul>
      </div>

      <ol>
        <SetupStep n={1} title="Install Moonfin">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {MOONFIN_APPS.map((a) => {
              const Icon = a.kind === "tv" ? Tv : Smartphone;
              return (
                <a
                  key={a.label}
                  href={a.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2.5 text-sm text-muted transition-colors hover:border-accent hover:text-ink"
                >
                  <Icon size={15} className="flex-none" />
                  <span className="min-w-0 leading-snug">{a.label}</span>
                </a>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-faint">
            Samsung or LG TV? Moonfin isn&apos;t in their app stores — install the{" "}
            <a href={JELLYFIN_TV_APPS} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
              Jellyfin app
            </a>{" "}
            on the TV instead (same server &amp; login). It plays everything; request from Moonfin on your phone.
          </p>
        </SetupStep>

        <SetupStep n={2} title="Add the server & sign in">
          <p className="mb-2">Open Moonfin, add this server, then sign in:</p>
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-3 py-2">
            <Globe size={15} className="flex-none text-faint" />
            <code className="mono min-w-0 flex-1 break-all text-sm text-ink">
              {serverUrl || "ask the admin for the server address"}
            </code>
            {serverUrl && (
              <button
                onClick={copyServer}
                className="flex-none rounded-md p-1.5 text-faint hover:text-accent"
                aria-label="Copy server address"
              >
                {copied ? <Check size={15} style={{ color: "var(--color-success)" }} /> : <Copy size={15} />}
              </button>
            )}
          </div>
          <p className="mt-2">
            Username {username ? <span className="mono text-ink">{username}</span> : "(your Cinevault username)"} and
            the password you chose when you signed up.
          </p>
        </SetupStep>

        <SetupStep n={3} title="Turn on requests">
          <p>
            In Moonfin go to <b className="text-ink">Settings → Integrations → Seerr</b>, tap{" "}
            <b className="text-ink">Sign in</b> and choose account type <b className="text-ink">Jellyfin</b>
            {" — "}it uses the same username &amp; password. You only do this once; it follows you to Moonfin on your
            other devices.
          </p>
        </SetupStep>

        <SetupStep n={4} last title="Find anything & tap Request">
          <p>
            Use the main <b className="text-ink">Search</b>{" "}(not a single library) to look up any movie or show. If
            it&apos;s not here yet, tap <b className="text-ink">Request</b>{" "}— it&apos;s downloaded into your Cinevault
            library and you get a notification when it&apos;s ready to watch.
          </p>
        </SetupStep>
      </ol>

      <div className="flex gap-3 rounded-lg border border-accent/40 bg-accent/10 p-3">
        <Lightbulb size={16} className="mt-0.5 flex-none text-accent" />
        <div>
          <p className="mb-1 font-medium text-ink">Watch on the TV, request from your phone</p>
          <p>
            Put Moonfin on your phone and on the TV (or the Jellyfin app, on Samsung/LG). It&apos;s the same account
            on both, so anything you request from the sofa on your phone shows up on the TV once it&apos;s ready.
            Requesting from your phone doesn&apos;t count as a second screen — only playing does.
          </p>
        </div>
      </div>
    </div>
  );
}
