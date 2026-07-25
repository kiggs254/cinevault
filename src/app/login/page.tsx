"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

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
    <main className="flex min-h-screen items-center justify-center p-6">
      <form onSubmit={submit} className="panel rise w-full max-w-sm p-8">
        <div className="mb-1 flex items-center gap-2">
          <span className="dot bg-accent" />
          <span className="label">Projection Deck</span>
        </div>
        <h1
          className="mb-6 text-6xl leading-none text-ink"
          style={{ fontFamily: "var(--font-display)", letterSpacing: "0.02em" }}
        >
          MOVIE<span className="text-accent">HUB</span>
        </h1>

        <label className="label mb-2 block" htmlFor="pw">
          Access key
        </label>
        <input
          id="pw"
          type="password"
          autoFocus
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="input mono"
          placeholder="••••••••••••"
        />
        {error && <p className="mt-3 text-sm text-danger">{error}</p>}

        <button type="submit" disabled={loading} className="btn btn-accent mt-6 w-full">
          {loading ? "Authenticating…" : "Enter"}
        </button>
        <p className="mt-6 text-xs text-faint">
          Single-admin access. Set <span className="mono">AUTH_PASSWORD</span> in your environment.
        </p>
      </form>
    </main>
  );
}
