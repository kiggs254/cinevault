"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Check, X, UserCog, ShieldAlert, Send, Trash2, Download as DownloadIcon } from "lucide-react";

interface LibItem {
  id: string;
  season: number | null;
  episode: number | null;
  status: string;
  sizeBytes: number;
}
interface LibTitle {
  key: string;
  title: string;
  year: number | null;
  kind: string;
  count: number;
  downloading: boolean;
  items: LibItem[];
}

/** Group a title's rows by season (0 = movie/specials) for per-season removal. */
function bySeason(items: LibItem[]): { season: number; ids: string[] }[] {
  const m = new Map<number, string[]>();
  for (const i of items) {
    const s = i.season ?? 0;
    const a = m.get(s) ?? [];
    a.push(i.id);
    m.set(s, a);
  }
  return [...m.entries()].sort((a, b) => a[0] - b[0]).map(([season, ids]) => ({ season, ids }));
}

/** Admin drawer: view + prune a specific member's library. */
function MemberLibraryDrawer({
  member,
  onClose,
  onChanged,
}: {
  member: { id: string; username: string };
  onClose: () => void;
  onChanged: () => void;
}) {
  const [titles, setTitles] = useState<LibTitle[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/users/${member.id}/downloads`, { cache: "no-store" });
    const d = await r.json().catch(() => ({ titles: [] }));
    setTitles(d.titles ?? []);
  }, [member.id]);
  useEffect(() => {
    load();
  }, [load]);

  async function remove(ids: string[]) {
    if (!ids.length || busy) return;
    setBusy(true);
    try {
      await Promise.all(ids.map((id) => fetch(`/api/downloads/${id}`, { method: "DELETE" }).catch(() => {})));
      await load();
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="sheet fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4" onClick={onClose}>
      <div
        className="sheet-card max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-border bg-surface"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border p-4">
          <p className="font-semibold text-ink">{member.username}&apos;s library</p>
          <button onClick={onClose} className="text-faint hover:text-ink" aria-label="Close">
            <X size={18} />
          </button>
        </div>
        <div className="p-4">
          {titles === null ? (
            <p className="flex items-center gap-2 text-sm text-faint">
              <Loader2 size={15} className="animate-spin" /> Loading…
            </p>
          ) : titles.length === 0 ? (
            <p className="text-sm text-faint">This member&apos;s library is empty.</p>
          ) : (
            <div className="space-y-2">
              {titles.map((t) => {
                const seasons = bySeason(t.items);
                return (
                  <div key={t.key} className="rounded-lg border border-border bg-surface-2 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-medium text-ink">
                        {t.title}
                        {t.year ? ` (${t.year})` : ""}
                        {t.downloading && <span className="ml-2 text-[11px] text-faint">adding…</span>}
                      </p>
                      <button
                        onClick={() => remove(t.items.map((i) => i.id))}
                        disabled={busy}
                        className="inline-flex flex-none items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-danger hover:bg-surface disabled:opacity-50"
                      >
                        <Trash2 size={13} /> Remove all
                      </button>
                    </div>
                    {t.kind === "TV" && seasons.length > 1 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {seasons.map(({ season, ids }) => (
                          <button
                            key={season}
                            onClick={() => remove(ids)}
                            disabled={busy}
                            className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted transition-colors hover:border-danger hover:text-danger disabled:opacity-50"
                          >
                            <Trash2 size={11} /> {season > 0 ? `S${season}` : "Specials"}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <p className="mt-3 text-[11px] text-faint">
            Removing frees shared storage only when no other member still has the same file.
          </p>
        </div>
      </div>
    </div>
  );
}

interface Member {
  id: string;
  username: string;
  role: string;
  status: string;
  telegramChatId: string | null;
  jellyfinUserId: string | null;
  createdAt: string;
  approvedAt: string | null;
  invitedBy: { username: string } | null;
  _count: { downloads: number; follows: number };
}

const STATUS_ORDER = ["pending", "active", "suspended", "denied"];
const STATUS_LABEL: Record<string, string> = {
  pending: "Pending approval",
  active: "Active members",
  suspended: "Suspended",
  denied: "Denied",
};

export default function UsersPage() {
  const [users, setUsers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [viewing, setViewing] = useState<{ id: string; username: string } | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/users", { cache: "no-store" });
    if (res.status === 403) {
      setForbidden(true);
      setLoading(false);
      return;
    }
    const d = await res.json().catch(() => ({ users: [] }));
    setUsers(d.users ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function act(id: string, action: "approve" | "deny" | "suspend" | "activate") {
    setBusyId(id);
    setMsg("");
    try {
      const res = await fetch(`/api/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) setMsg(d.error ?? "Action failed");
      await load();
    } finally {
      setBusyId(null);
    }
  }

  if (forbidden) {
    return (
      <div className="mx-auto max-w-md py-20 text-center">
        <ShieldAlert size={28} className="mx-auto mb-3 text-faint" />
        <p className="text-sm text-muted">You don&apos;t have access to this page.</p>
      </div>
    );
  }

  const grouped = STATUS_ORDER.map((s) => ({ status: s, list: users.filter((u) => u.status === s) })).filter(
    (g) => g.list.length > 0,
  );

  return (
    <div className="mx-auto max-w-3xl px-5 py-6 sm:py-8 md:px-10">
      <div className="mb-6 flex items-center gap-2">
        <UserCog size={22} className="text-accent" />
        <h1 className="text-2xl font-bold text-ink" style={{ fontFamily: "var(--font-display)" }}>
          Members
        </h1>
      </div>

      {msg && <p className="mb-4 text-sm text-danger">{msg}</p>}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-faint">
          <Loader2 size={15} className="animate-spin" /> Loading members…
        </p>
      ) : users.length === 0 ? (
        <p className="text-sm text-faint">No members yet. Share your registration link to invite people.</p>
      ) : (
        <div className="space-y-8">
          {grouped.map((g) => (
            <section key={g.status}>
              <p className="label mb-3">
                {STATUS_LABEL[g.status]} · {g.list.length}
              </p>
              <div className="space-y-2">
                {g.list.map((u) => (
                  <div
                    key={u.id}
                    className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-border bg-surface-2 px-4 py-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 font-medium text-ink">
                        {u.username}
                        {u.role === "admin" && <span className="badge badge-accent">admin</span>}
                        {u.telegramChatId && <Send size={12} className="text-faint" aria-label="Telegram linked" />}
                      </p>
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-faint">
                        <span className="inline-flex items-center gap-1">
                          <DownloadIcon size={11} /> {u._count.downloads}
                        </span>
                        <span>{u._count.follows} following</span>
                        {u.invitedBy && <span>invited by {u.invitedBy.username}</span>}
                        <span>joined {new Date(u.createdAt).toLocaleDateString()}</span>
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      {u._count.downloads > 0 && (
                        <button
                          className="btn btn-ghost px-3 py-1.5 text-xs"
                          onClick={() => setViewing({ id: u.id, username: u.username })}
                        >
                          <DownloadIcon size={13} /> Library
                        </button>
                      )}
                      {u.status === "pending" && (
                        <>
                          <button
                            className="btn btn-accent px-3 py-1.5 text-xs"
                            onClick={() => act(u.id, "approve")}
                            disabled={busyId === u.id}
                          >
                            {busyId === u.id ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                            Approve
                          </button>
                          <button
                            className="btn btn-ghost px-3 py-1.5 text-xs"
                            onClick={() => act(u.id, "deny")}
                            disabled={busyId === u.id}
                          >
                            <X size={13} /> Deny
                          </button>
                        </>
                      )}
                      {u.status === "active" && u.role !== "admin" && (
                        <button
                          className="btn btn-ghost px-3 py-1.5 text-xs"
                          onClick={() => act(u.id, "suspend")}
                          disabled={busyId === u.id}
                        >
                          {busyId === u.id ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
                          Suspend
                        </button>
                      )}
                      {u.status === "suspended" && (
                        <button
                          className="btn btn-ghost px-3 py-1.5 text-xs"
                          onClick={() => act(u.id, "activate")}
                          disabled={busyId === u.id}
                        >
                          <Check size={13} /> Reactivate
                        </button>
                      )}
                      {u.status === "denied" && (
                        <button
                          className="btn btn-ghost px-3 py-1.5 text-xs"
                          onClick={() => act(u.id, "approve")}
                          disabled={busyId === u.id}
                        >
                          <Check size={13} /> Approve
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {viewing && (
        <MemberLibraryDrawer member={viewing} onClose={() => setViewing(null)} onChanged={load} />
      )}
    </div>
  );
}
