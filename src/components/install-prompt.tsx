"use client";

import { useEffect, useState } from "react";
import { Download, X, Share } from "lucide-react";

/** The non-standard Chrome/Android install event. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "cv_install_dismissed_at";
const SNOOZE_MS = 14 * 24 * 60 * 60 * 1000; // re-offer after 14 days

function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}
function isIOS(): boolean {
  const ua = window.navigator.userAgent;
  return (
    /iphone|ipad|ipod/i.test(ua) ||
    // iPadOS 13+ masquerades as macOS
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}
function isIOSSafari(): boolean {
  const ua = window.navigator.userAgent;
  return isIOS() && /safari/i.test(ua) && !/crios|fxios|edgios|chrome|android/i.test(ua);
}
function recentlyDismissed(): boolean {
  try {
    const ts = Number(localStorage.getItem(DISMISS_KEY) || 0);
    return ts > 0 && Date.now() - ts < SNOOZE_MS;
  } catch {
    return false;
  }
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (isStandalone() || recentlyDismissed()) return;

    // The capture script in the root layout may have stashed an early event.
    const stashed = (window as unknown as { __cvBip?: BeforeInstallPromptEvent }).__cvBip;
    if (stashed) {
      setDeferred(stashed);
      setShow(true);
    }

    const onBip = () => {
      const e = (window as unknown as { __cvBip?: BeforeInstallPromptEvent }).__cvBip;
      if (e) {
        setDeferred(e);
        setShow(true);
      }
    };
    const onInstalled = () => {
      setShow(false);
      setDeferred(null);
      try {
        localStorage.setItem(DISMISS_KEY, String(Date.now()));
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("cv-bip", onBip);
    window.addEventListener("appinstalled", onInstalled);

    // iOS Safari never fires beforeinstallprompt — offer manual instructions.
    if (isIOSSafari()) {
      setIos(true);
      setShow(true);
    }

    return () => {
      window.removeEventListener("cv-bip", onBip);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!show) return null;

  function dismiss() {
    setShow(false);
    try {
      localStorage.setItem(DISMISS_KEY, String(Date.now()));
    } catch {
      /* ignore */
    }
  }

  async function install() {
    if (!deferred) return;
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } catch {
      /* user closed it */
    }
    setDeferred(null);
    setShow(false);
  }

  return (
    <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom)+4.75rem)] z-50 md:inset-x-auto md:bottom-4 md:right-4 md:max-w-sm">
      <div className="flex items-start gap-3 rounded-xl border border-border bg-surface-2/95 p-3.5 shadow-lg backdrop-blur">
        <span className="mt-0.5 flex-none text-accent">
          <Download size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">Install Cinevault</p>
          {ios ? (
            <p className="mt-1 text-xs text-muted">
              Tap the Share button <Share size={12} className="-mt-0.5 inline" /> in Safari, then{" "}
              <b className="text-ink">Add to Home Screen</b> — you&apos;ll get a full-screen app and
              notifications.
            </p>
          ) : (
            <p className="mt-1 text-xs text-muted">
              Add it to your home screen for a full-screen app and instant notifications.
            </p>
          )}
          {!ios && (
            <button onClick={install} className="btn btn-primary mt-2.5 py-1.5 text-xs">
              <Download size={14} /> Install app
            </button>
          )}
        </div>
        <button
          onClick={dismiss}
          aria-label="Dismiss"
          className="flex-none rounded-lg p-1 text-faint hover:text-ink"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
