"use client";

import { useEffect, useState } from "react";
import { Sun, Moon } from "lucide-react";

type Theme = "light" | "dark";

/**
 * Toggles between light and dark by flipping `data-theme` on <html> (which swaps
 * the CSS custom properties) and persisting the choice. The initial value is set
 * pre-hydration by the inline script in the root layout, so there's no flash.
 */
export function ThemeToggle({ size = 18, className = "" }: { size?: number; className?: string }) {
  const [theme, setTheme] = useState<Theme>("dark");

  useEffect(() => {
    const t = (document.documentElement.dataset.theme as Theme) || "dark";
    setTheme(t);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    document.documentElement.dataset.theme = next;
    try {
      localStorage.setItem("theme", next);
    } catch {
      /* private mode — session-only */
    }
  }

  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Light mode" : "Dark mode"}
      className={className}
    >
      {isDark ? <Sun size={size} /> : <Moon size={size} />}
    </button>
  );
}
