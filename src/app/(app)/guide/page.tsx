"use client";

import { useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  MonitorPlay,
  ShieldCheck,
  Ticket,
  Smartphone,
  Tv,
  Globe,
  Search as SearchIcon,
  Sparkles,
  Trash2,
  Send,
  Loader2,
  Link2,
  Check,
  Plus,
  AlertTriangle,
} from "lucide-react";

/* ------------------------------- shared data ------------------------------ */
const APPS: { label: string; href: string; icon: typeof Smartphone }[] = [
  { label: "iPhone / iPad", href: "https://apps.apple.com/app/jellyfin-mobile/id1480192618", icon: Smartphone },
  { label: "Android", href: "https://play.google.com/store/apps/details?id=org.jellyfin.mobile", icon: Smartphone },
  { label: "Android TV / Fire TV", href: "https://play.google.com/store/apps/details?id=org.jellyfin.androidtv", icon: Tv },
  { label: "Roku, LG, Samsung & more", href: "https://jellyfin.org/downloads/clients/", icon: Tv },
];

const TABS = [
  { id: "how", label: "How it works", icon: BookOpen },
  { id: "setup", label: "Set up Jellyfin", icon: MonitorPlay },
  { id: "rules", label: "Guidelines", icon: ShieldCheck },
  { id: "invite", label: "Invite", icon: Ticket },
] as const;
type TabId = (typeof TABS)[number]["id"];

interface Me {
  username: string;
  serverUrl: string | null;
}

/* -------------------------------- invites --------------------------------- */
interface Invite {
  id: string;
  code: string;
  maxUses: number;
  uses: number;
}
const fmt = (code: string) => (code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code);

function InviteTab() {
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/invites", { cache: "no-store" });
    const d = await r.json().catch(() => ({ invites: [] }));
    setInvites(d.invites ?? []);
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  async function generate() {
    setBusy(true);
    await fetch("/api/invites", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    await load();
    setBusy(false);
  }
  async function revoke(id: string) {
    await fetch(`/api/invites/${id}`, { method: "DELETE" });
    await load();
  }
  async function copyLink(inv: Invite) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/register?code=${inv.code}`);
      setCopiedId(inv.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div>
      <p className="mb-4 text-sm text-muted">
        Invites are how people join — and how we keep this small and private. Generate a code, share the link,
        and the admin approves them. You&apos;re recorded as their referrer.{" "}
        <span className="text-ink">Never invite anyone without checking with the admin first.</span>
      </p>
      <button className="btn btn-accent mb-5" onClick={generate} disabled={busy}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
        Generate invite link
      </button>
      {loading ? (
        <p className="flex items-center gap-2 text-sm text-faint">
          <Loader2 size={15} className="animate-spin" /> Loading…
        </p>
      ) : invites.length === 0 ? (
        <p className="text-sm text-faint">No invite codes yet — generate one above.</p>
      ) : (
        <div className="space-y-2">
          {invites.map((inv) => {
            const used = inv.uses >= inv.maxUses;
            return (
              <div
                key={inv.id}
                className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-surface-2 px-4 py-3"
              >
                <code className="mono text-base tracking-wider text-ink">{fmt(inv.code)}</code>
                <span className={`badge ${used ? "" : "badge-accent"}`}>{used ? "used" : "unused"}</span>
                <div className="ml-auto flex items-center gap-2">
                  {!used && (
                    <button className="btn btn-ghost px-3 py-1.5 text-xs" onClick={() => copyLink(inv)}>
                      {copiedId === inv.id ? (
                        <Check size={13} style={{ color: "var(--color-success)" }} />
                      ) : (
                        <Link2 size={13} />
                      )}
                      {copiedId === inv.id ? "Copied" : "Copy link"}
                    </button>
                  )}
                  <button
                    className="rounded-lg p-2 text-faint hover:text-danger"
                    onClick={() => revoke(inv.id)}
                    aria-label="Revoke"
                    title="Revoke"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* --------------------------------- page ----------------------------------- */
export default function GuidePage() {
  const [tab, setTab] = useState<TabId>("how");
  const [me, setMe] = useState<Me | null>(null);

  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab") as TabId | null;
    if (t && TABS.some((x) => x.id === t)) setTab(t);
    fetch("/api/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => setMe({ username: d.username, serverUrl: d.serverUrl ?? null }))
      .catch(() => {});
  }, []);

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-5 flex items-center gap-2">
        <BookOpen size={22} className="text-accent" />
        <h1 className="text-2xl font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>
          Member guide
        </h1>
      </div>

      <div className="no-scrollbar -mx-1 mb-6 flex gap-2 overflow-x-auto px-1 pb-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex flex-none items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
              tab === t.id ? "border-accent bg-accent/10 text-ink" : "border-border text-muted hover:text-ink"
            }`}
          >
            <t.icon size={14} /> {t.label}
          </button>
        ))}
      </div>

      {tab === "how" && (
        <div className="space-y-4 text-sm text-muted">
          <p>
            Cinevault is a private, invite-only film &amp; TV library shared by a small community. Here&apos;s the
            gist:
          </p>
          <ul className="space-y-3">
            <li className="flex gap-3">
              <SearchIcon size={16} className="mt-0.5 flex-none text-accent" />
              <span>
                <b className="text-ink">Find it.</b> Use Search or Discover to find a movie or show, open it, and
                tap <b className="text-ink">Add to Library</b>.
              </span>
            </li>
            <li className="flex gap-3">
              <MonitorPlay size={16} className="mt-0.5 flex-none text-accent" />
              <span>
                <b className="text-ink">We fetch it.</b> If it&apos;s already in the shared library it&apos;s added
                instantly; otherwise it&apos;s downloaded and appears in your Library, ready to watch — usually
                within minutes.
              </span>
            </li>
            <li className="flex gap-3">
              <Tv size={16} className="mt-0.5 flex-none text-accent" />
              <span>
                <b className="text-ink">Watch on Jellyfin.</b> Install the Jellyfin app on any device and sign in
                with the same username &amp; password (see <b className="text-ink">Set up Jellyfin</b>).
              </span>
            </li>
            <li className="flex gap-3">
              <Sparkles size={16} className="mt-0.5 flex-none text-accent" />
              <span>
                <b className="text-ink">Your own library.</b> Everyone has their own list. You can also connect
                Telegram to request titles and get a ping when they&apos;re ready.
              </span>
            </li>
          </ul>
          <p>
            It runs on shared storage and a shared connection, so a few simple house rules keep it fast and safe
            for everyone — please read the <b className="text-ink">Guidelines</b> tab.
          </p>
        </div>
      )}

      {tab === "setup" && (
        <div className="space-y-5 text-sm text-muted">
          <div>
            <p className="label mb-2">1 · Install Jellyfin</p>
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
          </div>
          <div>
            <p className="label mb-2">2 · Add the server</p>
            <p className="mb-2">In the Jellyfin app, tap “Add Server” and enter:</p>
            <div className="flex items-center gap-2 overflow-x-auto rounded-lg border border-border bg-surface-2 px-3 py-2">
              <Globe size={15} className="flex-none text-faint" />
              <code className="mono whitespace-nowrap text-sm text-ink">
                {me?.serverUrl || "ask the admin for the server address"}
              </code>
            </div>
          </div>
          <div>
            <p className="label mb-2">3 · Sign in</p>
            <p>
              Use your Cinevault username{me?.username ? <span className="mono text-ink"> ({me.username})</span> : ""}{" "}
              and the same password. That&apos;s it — your library is waiting.
            </p>
          </div>
        </div>
      )}

      {tab === "rules" && (
        <div className="space-y-3">
          <div className="mb-2 flex items-center gap-2 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2 text-sm text-ink">
            <AlertTriangle size={16} className="flex-none text-accent" />
            These aren&apos;t suggestions — breaking them can get your access removed.
          </div>
          {[
            {
              t: "Don't share your account — 1 screen at a time.",
              d: "Your login is yours alone. Only one stream can play at a time; sharing your account or streaming on multiple screens will flag it and may get you removed.",
            },
            {
              t: "For shows, add only the season(s) you'll actually watch.",
              d: "Storage is shared. Don't bulk-add a whole series “just in case” — pick the season you're watching now; add the next one when you get there.",
            },
            {
              t: "Finished watching? Delete it from your library.",
              d: "Clear things out once you're done to free up space. You can always request the exact same title again later — nothing is lost.",
            },
            {
              t: "Keep it private — check with the admin first.",
              d: "Never tell anyone about Cinevault or hand out an invite without clearing it with the admin. This stays small and trusted on purpose.",
            },
          ].map((r) => (
            <div key={r.t} className="rounded-lg border border-border bg-surface-2 p-3">
              <p className="flex items-start gap-2 font-medium text-ink">
                <ShieldCheck size={16} className="mt-0.5 flex-none text-accent" /> {r.t}
              </p>
              <p className="mt-1 pl-6 text-sm text-muted">{r.d}</p>
            </div>
          ))}
        </div>
      )}

      {tab === "invite" && <InviteTab />}
    </div>
  );
}
