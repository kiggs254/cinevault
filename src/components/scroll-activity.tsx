"use client";

import { useEffect } from "react";

/**
 * Marks the document as actively scrolling (data-scrolling on <html>) for a short
 * window after any scroll, so CSS can fade scrollbars in while scrolling and hide
 * them when idle. Capture phase catches scrolls from nested containers too.
 */
export function ScrollActivity() {
  useEffect(() => {
    const root = document.documentElement;
    let t: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      root.setAttribute("data-scrolling", "");
      if (t) clearTimeout(t);
      t = setTimeout(() => root.removeAttribute("data-scrolling"), 700);
    };
    const opts: AddEventListenerOptions = { capture: true, passive: true };
    window.addEventListener("scroll", onScroll, opts);
    return () => {
      window.removeEventListener("scroll", onScroll, opts);
      if (t) clearTimeout(t);
    };
  }, []);
  return null;
}
