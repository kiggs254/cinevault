"use client";

import { useCallback, useEffect, useRef } from "react";

/**
 * Keep an open screen live without depending on a realtime stream staying up.
 * Refetches:
 *   - the moment the tab becomes visible again (mobile PWA foreground),
 *   - on window focus and when the network comes back online,
 *   - and, while `active`, on a light interval as a safety net for when an SSE
 *     stream silently stalls or was suspended while backgrounded.
 *
 * The interval only fires while the document is visible, so a backgrounded PWA
 * does no work. `refetch` may be an inline closure — it's read through a ref, so
 * the listeners attach once and always call the latest version.
 */
export function useLiveRefresh(
  refetch: () => void,
  { active = true, intervalMs = 5000 }: { active?: boolean; intervalMs?: number } = {},
): void {
  const ref = useRef(refetch);
  ref.current = refetch;

  const run = useCallback(() => {
    if (typeof document === "undefined" || document.visibilityState === "visible") {
      ref.current();
    }
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") ref.current();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", run);
    window.addEventListener("online", run);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", run);
      window.removeEventListener("online", run);
    };
  }, [run]);

  useEffect(() => {
    if (!active) return;
    const t = setInterval(run, intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, run]);
}
