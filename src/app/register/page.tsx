"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Clapperboard,
  User as UserIcon,
  Lock,
  Ticket,
  Loader2,
  ArrowRight,
  ArrowLeft,
  Search,
  MonitorPlay,
  Tv,
  Sparkles,
  ShieldCheck,
} from "lucide-react";
import { HOW_IT_WORKS, GUIDELINES } from "@/lib/community";

const HIW_ICONS = [Search, MonitorPlay, Tv, Sparkles];
const STEP_LABELS = ["How it works", "House rules", "Create account"];

function StepBar({ step }: { step: number }) {
  return (
    <div className="mb-6">
      <div className="flex items-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className={`h-1.5 flex-1 rounded-full transition-colors ${i <= step ? "bg-accent" : "bg-border"}`}
          />
        ))}
      </div>
      <p className="mt-2 text-xs text-faint">
        Step {step + 1} of 3 · <span className="text-muted">{STEP_LABELS[step]}</span>
      </p>
    </div>
  );
}

export default function RegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [agreed, setAgreed] = useState(false);
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // Prefill the invite code from the shared link (?code=…).
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("code");
    if (c) setCode(c);
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    const res = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password, code, acceptedGuidelines: agreed }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.statusToken) {
      router.replace(`/welcome?token=${data.statusToken}`);
    } else {
      setError(data.error ?? "Something went wrong");
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-[100dvh] justify-center overflow-y-auto p-4 sm:p-6">
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/3 h-[38rem] w-[38rem] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-40 blur-[130px]"
        style={{ background: "radial-gradient(circle, var(--color-accent), transparent 65%)" }}
      />

      <div className="rise relative my-auto w-full max-w-md">
        <div className="panel p-7 sm:p-8">
          <div className="mb-6 flex items-center gap-3">
            <span className="inline-flex h-10 w-10 flex-none items-center justify-center rounded-xl border border-border bg-surface-2 text-accent">
              <Clapperboard size={20} />
            </span>
            <h1
              className="text-3xl leading-none text-ink"
              style={{ fontFamily: "var(--font-display)", letterSpacing: "0.02em" }}
            >
              CINE<span className="text-accent">VAULT</span>
            </h1>
          </div>

          <StepBar step={step} />

          {/* Step 1 — orientation */}
          {step === 0 && (
            <div>
              <h2 className="text-lg font-semibold text-ink">How Cinevault works</h2>
              <p className="mt-1 text-sm text-muted">
                A private, invite-only film &amp; TV library shared by a small circle. The basics:
              </p>
              <ul className="mt-4 space-y-3">
                {HOW_IT_WORKS.map((it, i) => {
                  const Icon = HIW_ICONS[i] ?? Sparkles;
                  return (
                    <li key={it.title} className="flex gap-3">
                      <span className="mt-0.5 flex-none text-accent">
                        <Icon size={17} />
                      </span>
                      <span className="text-sm text-muted">
                        <b className="text-ink">{it.title}.</b> {it.body}
                      </span>
                    </li>
                  );
                })}
              </ul>
              <button onClick={() => setStep(1)} className="btn btn-accent mt-6 w-full">
                Continue <ArrowRight size={15} />
              </button>
              <p className="mt-3 text-center text-xs text-faint">
                Invite-only — you&apos;ll need the code a member shared with you.
              </p>
            </div>
          )}

          {/* Step 2 — guidelines + acceptance */}
          {step === 1 && (
            <div>
              <h2 className="text-lg font-semibold text-ink">The house rules</h2>
              <p className="mt-1 text-sm text-muted">
                Shared storage and one connection mean a few rules keep it fast and safe for everyone.
                These are strict — breaking them can cost your access.
              </p>
              <div className="mt-4 space-y-2">
                {GUIDELINES.map((r) => (
                  <div key={r.t} className="rounded-lg border border-border bg-surface-2 p-3">
                    <p className="flex items-start gap-2 text-sm font-medium text-ink">
                      <ShieldCheck size={15} className="mt-0.5 flex-none text-accent" /> {r.t}
                    </p>
                    <p className="mt-1 pl-6 text-xs text-muted">{r.d}</p>
                  </div>
                ))}
              </div>
              <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-lg border border-border bg-surface-2 p-3 transition-colors hover:border-accent">
                <input
                  type="checkbox"
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                  className="mt-0.5 h-4 w-4 flex-none"
                  style={{ accentColor: "var(--color-accent)" }}
                />
                <span className="text-sm text-ink">
                  I&apos;ve read and agree to these community guidelines.
                </span>
              </label>
              <div className="mt-6 flex gap-2">
                <button onClick={() => setStep(0)} className="btn btn-ghost flex-none text-muted">
                  <ArrowLeft size={15} /> Back
                </button>
                <button
                  onClick={() => setStep(2)}
                  disabled={!agreed}
                  className="btn btn-accent flex-1"
                >
                  Agree &amp; continue <ArrowRight size={15} />
                </button>
              </div>
            </div>
          )}

          {/* Step 3 — account */}
          {step === 2 && (
            <form onSubmit={submit}>
              <h2 className="text-lg font-semibold text-ink">Create your account</h2>
              <p className="mt-1 mb-4 text-sm text-muted">
                This username &amp; password sign you in here and on Jellyfin, where you&apos;ll watch.
              </p>

              <label className="label mb-2 block" htmlFor="code">
                Invite code
              </label>
              <div className="relative mb-4">
                <Ticket size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                <input
                  id="code"
                  type="text"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="input mono pl-9 tracking-wider"
                  placeholder="XXXX-XXXX"
                />
              </div>

              <label className="label mb-2 block" htmlFor="username">
                Choose a username
              </label>
              <div className="relative mb-4">
                <UserIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                <input
                  id="username"
                  type="text"
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="input pl-9"
                  placeholder="3–20 chars: a–z, 0–9, _"
                />
              </div>

              <label className="label mb-2 block" htmlFor="pw">
                Set a password
              </label>
              <div className="relative">
                <Lock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
                <input
                  id="pw"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="input pl-9"
                  placeholder="At least 6 characters"
                />
              </div>

              {error && <p className="mt-3 text-sm text-danger">{error}</p>}

              <div className="mt-6 flex gap-2">
                <button
                  type="button"
                  onClick={() => setStep(1)}
                  className="btn btn-ghost flex-none text-muted"
                >
                  <ArrowLeft size={15} /> Back
                </button>
                <button type="submit" disabled={loading} className="btn btn-accent flex-1">
                  {loading ? (
                    <>
                      <Loader2 size={15} className="animate-spin" /> Applying…
                    </>
                  ) : (
                    <>
                      Request access <ArrowRight size={15} />
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>

        <p className="mt-5 text-center text-xs text-faint">
          Already have an account?{" "}
          <Link href="/login" className="text-accent hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}
