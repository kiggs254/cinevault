"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Check, X, UserCog, ShieldAlert, Send, Download as DownloadIcon } from "lucide-react";

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
    <div className="mx-auto max-w-3xl">
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
    </div>
  );
}
