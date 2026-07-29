"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Ticket, Link2, Check, Plus, Trash2 } from "lucide-react";

interface Invite {
  id: string;
  code: string;
  label: string | null;
  maxUses: number;
  uses: number;
  disabled: boolean;
  createdAt: string;
}

const fmt = (code: string) => (code.length === 8 ? `${code.slice(0, 4)}-${code.slice(4)}` : code);

export default function InvitePage() {
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
    const url = `${window.location.origin}/register?code=${inv.code}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(inv.id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      /* clipboard blocked */
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="mb-2 flex items-center gap-2">
        <Ticket size={22} className="text-accent" />
        <h1 className="text-2xl font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>
          Invite a friend
        </h1>
      </div>
      <p className="mb-6 text-sm text-muted">
        Cinevault is invite-only. Generate a code, share the link, and once they apply the librarian approves
        them — you&apos;ll be on record as the member who referred them.
      </p>

      <button className="btn btn-accent mb-6" onClick={generate} disabled={busy}>
        {busy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
        Generate invite link
      </button>

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-faint">
          <Loader2 size={15} className="animate-spin" /> Loading…
        </p>
      ) : invites.length === 0 ? (
        <p className="text-sm text-faint">No invite codes yet — generate one above to invite someone.</p>
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
                <span className={`badge ${used ? "" : "badge-accent"}`}>
                  {used ? "used" : `${inv.uses}/${inv.maxUses} used`}
                </span>
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
