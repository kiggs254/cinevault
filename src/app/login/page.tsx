"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clapperboard, Lock, Loader2, ArrowRight } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password }),
    });
    if (res.ok) {
      router.replace("/");
      router.refresh();
    } else {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Login failed");
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-[100dvh] items-center justify-center overflow-hidden p-6">
      {/* Ambient projector glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/3 h-[38rem] w-[38rem] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-40 blur-[130px]"
        style={{ background: "radial-gradient(circle, var(--color-accent), transparent 65%)" }}
      />

      <form onSubmit={submit} className="panel rise relative w-full max-w-sm p-8">
        <div className="mb-7 flex flex-col items-center text-center">
          <span className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-surface-2 text-accent">
            <Clapperboard size={24} />
          </span>
          <h1
            className="text-5xl leading-none text-ink"
            style={{ fontFamily: "var(--font-display)", letterSpacing: "0.02em" }}
          >
            CINE<span className="text-accent">VAULT</span>
          </h1>
          <p className="mt-3 text-sm text-muted">Your AI-curated film &amp; TV vault.</p>
        </div>

        <label className="label mb-2 block" htmlFor="pw">
          Access key
        </label>
        <div className="relative">
          <Lock
            size={16}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"
          />
          <input
            id="pw"
            type="password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input mono pl-9"
            placeholder="••••••••••••"
          />
        </div>
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        <button type="submit" disabled={loading} className="btn btn-accent mt-6 w-full">
          {loading ? (
            <>
              <Loader2 size={15} className="animate-spin" /> Authenticating…
            </>
          ) : (
            <>
              Enter <ArrowRight size={15} />
            </>
          )}
        </button>
        <p className="mt-6 text-center text-xs text-faint">
          Single-admin access · set <span className="mono">AUTH_PASSWORD</span> in your environment
        </p>
      </form>
    </main>
  );
}
