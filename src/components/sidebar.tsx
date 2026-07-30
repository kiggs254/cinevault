"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Home,
  Library,
  Download,
  Compass,
  Sparkles,
  Settings2,
  LogOut,
  Clapperboard,
  Search as SearchIcon,
  Users,
  Send,
  BookOpen,
  type LucideIcon,
} from "lucide-react";
import { jsonFetch } from "@/lib/client";
import { useDownloadsCtx } from "@/components/downloads-context";
import { ThemeToggle } from "@/components/theme-toggle";
import { SearchOverlay } from "@/components/search-overlay";

const BASE_NAV = [
  { href: "/", label: "Home", icon: Home },
  { href: "/search", label: "Search", icon: SearchIcon },
  { href: "/library", label: "Library", icon: Library },
  { href: "/discover", label: "Discover", icon: Compass },
  { href: "/chat", label: "Assistant", icon: Sparkles },
  { href: "/guide", label: "Guidelines", icon: BookOpen },
];

/** Admins additionally see the raw download queue, members list, and settings. */
function navFor(role?: string) {
  const items = [...BASE_NAV];
  if (role === "admin") {
    items.push({ href: "/downloads", label: "Downloads", icon: Download });
    items.push({ href: "/users", label: "Members", icon: Users });
    items.push({ href: "/settings", label: "Settings", icon: Settings2 });
  }
  return items;
}

/** Mobile bottom tabs — members swap the admin-only Downloads tab for Invite. */
function bottomFor(role?: string) {
  return [
    { href: "/", label: "Home", icon: Home },
    { href: "/discover", label: "Discover", icon: Compass },
    { href: "/library", label: "My Library", icon: Library },
    { href: "/chat", label: "Assistant", icon: Sparkles },
    role === "admin"
      ? { href: "/downloads", label: "Downloads", icon: Download }
      : { href: "/guide", label: "Guide", icon: BookOpen },
  ];
}

interface Me {
  username: string;
  role: string;
  telegramLinked: boolean;
}

function useMe(): Me | null {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    jsonFetch<Me>("/api/me")
      .then(setMe)
      .catch(() => setMe(null));
  }, []);
  return me;
}

async function connectTelegram(): Promise<void> {
  try {
    const d = await jsonFetch<{ url?: string }>("/api/telegram/link", { method: "POST" });
    if (d.url && typeof window !== "undefined") window.open(d.url, "_blank", "noopener");
  } catch {
    /* best-effort */
  }
}

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

/* --------------------------------- Nav list -------------------------------- */
function NavList({
  pathname,
  activeCount,
  items,
}: {
  pathname: string;
  activeCount: number;
  items: { href: string; label: string; icon: LucideIcon }[];
}) {
  return (
    <nav className="flex flex-col gap-1">
      {items.map(({ href, label, icon: Icon }) => {
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
            {href === "/chat" && activeCount > 0 && (
              <span
                className="relative ml-auto flex h-2 w-2 flex-none items-center justify-center"
                title={`${activeCount} working in the background`}
              >
                <span className="absolute inline-flex h-2 w-2 animate-ping rounded-full bg-accent opacity-75" />
                <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-accent" />
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

/* ------------------------------- Desktop rail ------------------------------ */
export function Sidebar() {
  const pathname = usePathname();
  const me = useMe();
  const isAdminUser = me?.role === "admin";
  const activeCount = useActiveCount();
  const logout = useLogout();

  return (
    <aside className="sticky top-0 hidden h-screen w-60 flex-none flex-col border-r border-border bg-surface/30 p-5 backdrop-blur-sm md:flex">
      <div className="mb-8 mt-1">
        <Wordmark />
        <p className="label mt-2">AI Media Deck</p>
      </div>

      <NavList pathname={pathname} activeCount={activeCount} items={navFor(me?.role)} />

      <div className="mt-auto space-y-4">
        {me && (
          <div className="flex items-center justify-between gap-2 px-1">
            <span className="min-w-0 truncate text-xs text-muted">
              @{me.username}
              {isAdminUser && <span className="badge badge-accent ml-1.5">admin</span>}
            </span>
            {!me.telegramLinked && (
              <button
                onClick={connectTelegram}
                className="inline-flex flex-none items-center gap-1 text-xs text-faint hover:text-accent"
                title="Get download alerts + grab titles from Telegram"
              >
                <Send size={12} /> Connect
              </button>
            )}
          </div>
        )}
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
  const me = useMe();
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
          {me && !me.telegramLinked && (
            <button onClick={connectTelegram} aria-label="Connect Telegram" className="rounded-lg p-2 text-muted">
              <Send size={19} />
            </button>
          )}
          {me?.role === "admin" && (
            <>
              <Link
                href="/guide"
                aria-label="Guidelines"
                className={`rounded-lg p-2 ${isActive("/guide", pathname) ? "text-accent" : "text-muted"}`}
              >
                <BookOpen size={19} />
              </Link>
              <Link
                href="/users"
                aria-label="Members"
                className={`rounded-lg p-2 ${isActive("/users", pathname) ? "text-accent" : "text-muted"}`}
              >
                <Users size={19} />
              </Link>
              <Link
                href="/settings"
                aria-label="Settings"
                className={`rounded-lg p-2 ${isActive("/settings", pathname) ? "text-accent" : "text-muted"}`}
              >
                <Settings2 size={19} />
              </Link>
            </>
          )}
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
  const me = useMe();
  const activeCount = useActiveCount();
  return (
    <nav className="z-40 flex flex-none items-stretch justify-around border-t border-border bg-surface/90 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg md:hidden">
      {bottomFor(me?.role).map(({ href, label, icon: Icon }) => {
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
              {href === "/chat" && activeCount > 0 && (
                <span className="absolute -right-1.5 -top-1 flex h-2.5 w-2.5">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-75" />
                  <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent" />
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
