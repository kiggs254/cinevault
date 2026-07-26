"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Home, Library, Download, Compass, Sparkles, Settings2, LogOut, Clapperboard, Search as SearchIcon } from "lucide-react";
import { jsonFetch } from "@/lib/client";
import { useDownloadsCtx } from "@/components/downloads-context";
import { ThemeToggle } from "@/components/theme-toggle";
import { SearchOverlay } from "@/components/search-overlay";

const NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/library", label: "Library", icon: Library },
  { href: "/downloads", label: "Downloads", icon: Download },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/chat", label: "Assistant", icon: Sparkles },
  { href: "/settings", label: "Settings", icon: Settings2 },
];

// Primary tabs for the mobile bottom bar (Settings + sign-out live in the top bar).
const BOTTOM = [
  { href: "/", label: "Home", icon: Home },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/downloads", label: "Downloads", icon: Download },
  { href: "/library", label: "Library", icon: Library },
  { href: "/chat", label: "Assistant", icon: Sparkles },
];

const ACTIVE_STATUSES = ["QUEUED", "SEARCHING", "DOWNLOADING", "UPLOADING"];

const isActive = (href: string, pathname: string) =>
  href === "/" ? pathname === "/" : pathname.startsWith(href);

function useLogout() {
  const router = useRouter();
  return async () => {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.replace("/login");
    router.refresh();
  };
}

function useActiveCount() {
  const { downloads } = useDownloadsCtx();
  return downloads.filter((d) => ACTIVE_STATUSES.includes(d.status)).length;
}

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

function Wordmark({ compact }: { compact?: boolean }) {
  const text = compact ? "text-2xl" : "text-3xl";
  return (
    <Link href="/" className="flex items-center gap-2 leading-none">
      <span
        className={`inline-flex flex-none items-center justify-center rounded-lg border border-border bg-surface-2 text-accent ${
          compact ? "h-7 w-7" : "h-8 w-8"
        }`}
      >
        <Clapperboard size={compact ? 16 : 18} />
      </span>
      <span className="flex items-baseline gap-1">
        <span className={`${text} text-ink`} style={{ fontFamily: "var(--font-display)" }}>
          CINE
        </span>
        <span className={`${text} text-accent`} style={{ fontFamily: "var(--font-display)" }}>
          VAULT
        </span>
      </span>
    </Link>
  );
}

/* ------------------------------- Desktop rail ------------------------------ */
export function Sidebar() {
  const pathname = usePathname();
  const systems = useSystems();
  const activeCount = useActiveCount();
  const logout = useLogout();

  return (
    <aside className="sticky top-0 hidden h-screen w-60 flex-none flex-col border-r border-border bg-surface/30 p-5 backdrop-blur-sm md:flex">
      <div className="mb-8 mt-1">
        <Wordmark />
        <p className="label mt-2">AI Media Deck</p>
      </div>

      <nav className="flex flex-col gap-1">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = isActive(href, pathname);
          return (
            <Link
              key={href}
              href={href}
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
              {href === "/downloads" && activeCount > 0 && (
                <span
                  className="badge ml-auto"
                  style={{ color: "var(--color-accent)", borderColor: "var(--color-accent)55" }}
                >
                  {activeCount}
                </span>
              )}
            </Link>
          );
        })}
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
        <div className="flex items-center gap-2">
          <button onClick={logout} className="btn btn-ghost flex-1 text-muted">
            <LogOut size={16} /> Sign out
          </button>
          <ThemeToggle size={16} className="btn btn-ghost flex-none px-3 text-muted" />
        </div>
      </div>
    </aside>
  );
}

/* ------------------------------ Mobile top bar ----------------------------- */
export function MobileTopBar() {
  const pathname = usePathname();
  const logout = useLogout();
  const [searchOpen, setSearchOpen] = useState(false);
  return (
    <>
      <header className="flex flex-none items-center justify-between gap-2 border-b border-border bg-bg/80 px-4 pb-2.5 pt-[calc(0.625rem+env(safe-area-inset-top))] backdrop-blur md:hidden">
        <Wordmark compact />
        <div className="flex flex-none items-center gap-0.5">
          <button onClick={() => setSearchOpen(true)} aria-label="Search" className="rounded-lg p-2 text-muted">
            <SearchIcon size={19} />
          </button>
          <ThemeToggle size={19} className="rounded-lg p-2 text-muted" />
          <Link
            href="/settings"
            aria-label="Settings"
            className={`rounded-lg p-2 ${isActive("/settings", pathname) ? "text-accent" : "text-muted"}`}
          >
            <Settings2 size={19} />
          </Link>
          <button onClick={logout} aria-label="Sign out" className="rounded-lg p-2 text-muted">
            <LogOut size={19} />
          </button>
        </div>
      </header>
      {searchOpen && <SearchOverlay onClose={() => setSearchOpen(false)} />}
    </>
  );
}

/* ---------------------------- Mobile bottom tabs --------------------------- */
export function MobileBottomNav() {
  const pathname = usePathname();
  const activeCount = useActiveCount();
  return (
    <nav className="z-40 flex flex-none items-stretch justify-around border-t border-border bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden">
      {BOTTOM.map(({ href, label, icon: Icon }) => {
        const active = isActive(href, pathname);
        return (
          <Link
            key={href}
            href={href}
            aria-label={label}
            className={`relative flex flex-1 flex-col items-center gap-1 py-2 text-[0.65rem] font-medium transition-colors ${
              active ? "text-accent" : "text-muted"
            }`}
          >
            {active && (
              <span className="absolute top-0 h-0.5 w-8 rounded-full bg-accent" />
            )}
            <span className="relative">
              <Icon size={22} strokeWidth={active ? 2.4 : 1.9} />
              {href === "/downloads" && activeCount > 0 && (
                <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-accent px-1 text-[0.6rem] font-bold text-[#1a1206]">
                  {activeCount}
                </span>
              )}
            </span>
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
