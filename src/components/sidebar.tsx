"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Clapperboard, Library, Sparkles, Settings2, LogOut } from "lucide-react";
import { jsonFetch } from "@/lib/client";

const NAV = [
  { href: "/", label: "Command", icon: Clapperboard },
  { href: "/library", label: "Library", icon: Library },
  { href: "/chat", label: "Assistant", icon: Sparkles },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

interface MaskedConfig {
  settings: Record<string, unknown>;
  secretsSet: Record<string, boolean>;
}

function useSystems() {
  const [cfg, setCfg] = useState<MaskedConfig | null>(null);
  useEffect(() => {
    jsonFetch<MaskedConfig>("/api/settings")
      .then(setCfg)
      .catch(() => setCfg(null));
  }, []);
  const s = cfg?.settings ?? {};
  const sec = cfg?.secretsSet ?? {};
  return [
    { label: "AI", ok: !!(sec.moonshotApiKey || sec.mimoApiKey) },
    { label: "Torrent", ok: !!s.qbitUrl },
    { label: "Indexer", ok: !!(s.prowlarrUrl && sec.prowlarrApiKey) },
    { label: "Storage", ok: !!(s.s3Endpoint && s.s3Bucket && sec.s3SecretAccessKey) },
  ];
}

function Wordmark() {
  return (
    <Link href="/" className="flex items-baseline gap-1 leading-none">
      <span className="text-3xl text-ink" style={{ fontFamily: "var(--font-display)" }}>
        MOVIE
      </span>
      <span className="text-3xl text-accent" style={{ fontFamily: "var(--font-display)" }}>
        HUB
      </span>
    </Link>
  );
}

function NavItems({ pathname, onNav }: { pathname: string; onNav?: () => void }) {
  return (
    <>
      {NAV.map(({ href, label, icon: Icon }) => {
        const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            onClick={onNav}
            className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
              active ? "text-accent" : "text-muted hover:text-ink"
            }`}
            style={active ? { background: "var(--color-accent-soft)" } : undefined}
          >
            {active && (
              <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
            )}
            <Icon size={18} strokeWidth={2} />
            {label}
          </Link>
        );
      })}
    </>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const systems = useSystems();
  const [mobileOpen, setMobileOpen] = useState(false);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
    router.refresh();
  }

  return (
    <>
      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-screen w-60 flex-none flex-col border-r border-border bg-surface/30 p-5 backdrop-blur-sm md:flex">
        <div className="mb-8 mt-1">
          <Wordmark />
          <p className="label mt-2">AI Media Deck</p>
        </div>

        <nav className="flex flex-col gap-1">
          <NavItems pathname={pathname} />
        </nav>

        <div className="mt-auto space-y-4">
          <div className="card p-3">
            <p className="label mb-2.5">Systems</p>
            <div className="grid grid-cols-2 gap-2">
              {systems.map((sys) => (
                <div key={sys.label} className="flex items-center gap-1.5">
                  <span
                    className="dot"
                    style={{ background: sys.ok ? "var(--color-success)" : "var(--color-faint)" }}
                  />
                  <span className="text-xs text-muted">{sys.label}</span>
                </div>
              ))}
            </div>
          </div>
          <button onClick={logout} className="btn btn-ghost w-full text-muted">
            <LogOut size={16} /> Sign out
          </button>
        </div>
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-bg/85 px-4 py-3 backdrop-blur md:hidden">
        <Wordmark />
        <button
          onClick={() => setMobileOpen((v) => !v)}
          className="btn btn-ghost px-3 py-2"
          aria-label="Menu"
        >
          {mobileOpen ? "Close" : "Menu"}
        </button>
        {mobileOpen && (
          <nav className="absolute left-0 right-0 top-full flex flex-col gap-1 border-b border-border bg-surface p-3">
            <NavItems pathname={pathname} onNav={() => setMobileOpen(false)} />
            <button onClick={logout} className="btn btn-ghost mt-2 w-full text-muted">
              <LogOut size={16} /> Sign out
            </button>
          </nav>
        )}
      </header>
    </>
  );
}
