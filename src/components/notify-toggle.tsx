"use client";

import { useCallback, useEffect, useState } from "react";
import { Bell, BellOff, BellRing, Loader2 } from "lucide-react";

/** Decode a base64url VAPID key into the Uint8Array the Push API expects. */
function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const arr = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

type State = "loading" | "unsupported" | "off" | "on" | "busy" | "denied";

function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

/** Shared enable/disable logic for the web-push subscription. */
function useNotify() {
  const [state, setState] = useState<State>("loading");

  const refresh = useCallback(async () => {
    if (!pushSupported()) return setState("unsupported");
    if (Notification.permission === "denied") return setState("denied");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      setState(sub ? "on" : "off");
    } catch {
      setState("off");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const enable = useCallback(async () => {
    setState("busy");
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") return setState(perm === "denied" ? "denied" : "off");
      const reg = await navigator.serviceWorker.register("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      });
      await navigator.serviceWorker.ready;
      const { publicKey } = await fetch("/api/push/key").then((r) => r.json());
      if (!publicKey) throw new Error("no key");
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey),
        });
      }
      const r = await fetch("/api/push/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: sub.toJSON() }),
      });
      if (!r.ok) throw new Error("save failed");
      setState("on");
    } catch {
      setState("off");
    }
  }, []);

  const disable = useCallback(async () => {
    setState("busy");
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg ? await reg.pushManager.getSubscription() : null;
      if (sub) {
        await fetch("/api/push/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: sub.endpoint }),
        }).catch(() => {});
        await sub.unsubscribe().catch(() => {});
      }
    } finally {
      setState("off");
    }
  }, []);

  const toggle = useCallback(() => {
    if (state === "on") disable();
    else if (state === "off") enable();
  }, [state, enable, disable]);

  return { state, toggle };
}

/* ------------------------------- Sidebar row ------------------------------- */
/** Compact full-width button for the desktop sidebar footer. */
export function NotifyToggleSidebar() {
  const { state, toggle } = useNotify();
  if (state === "unsupported") return null;

  if (state === "denied") {
    return (
      <p className="px-1 text-xs text-faint" title="Re-enable notifications in your browser settings">
        Notifications blocked
      </p>
    );
  }

  const on = state === "on";
  const busy = state === "busy" || state === "loading";
  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`btn btn-ghost w-full justify-start text-xs ${on ? "text-accent" : "text-muted"}`}
      title={on ? "Turn off push notifications on this device" : "Get alerts when your titles are ready"}
    >
      {busy ? (
        <Loader2 size={14} className="animate-spin" />
      ) : on ? (
        <BellRing size={14} />
      ) : (
        <Bell size={14} />
      )}
      {on ? "Notifications on" : "Enable notifications"}
    </button>
  );
}

/* ----------------------------- Mobile top icon ----------------------------- */
/** Bell icon button for the mobile top bar; hidden entirely when off is impossible. */
export function NotifyToggleIcon() {
  const { state, toggle } = useNotify();
  if (state === "unsupported" || state === "denied") return null;
  const on = state === "on";
  const busy = state === "busy" || state === "loading";
  return (
    <button
      onClick={toggle}
      disabled={busy}
      aria-label={on ? "Notifications on" : "Enable notifications"}
      className={`rounded-lg p-2 ${on ? "text-accent" : "text-muted"}`}
    >
      {busy ? (
        <Loader2 size={19} className="animate-spin" />
      ) : on ? (
        <BellRing size={19} />
      ) : (
        <Bell size={19} />
      )}
    </button>
  );
}

/* ------------------------------- Full card CTA ----------------------------- */
/** Prominent enable button + copy for the Guide / setup page. */
export function NotifyToggleFull() {
  const { state, toggle } = useNotify();
  const on = state === "on";
  const busy = state === "busy" || state === "loading";

  return (
    <div className="rounded-xl border border-border bg-surface-2 p-4">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex-none text-accent">
          {on ? <BellRing size={20} /> : <Bell size={20} />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold text-ink">Push notifications</p>
          <p className="mt-1 text-sm text-muted">
            Get a notification the moment a title you added is ready to watch — no Telegram needed.
            Works on this device once you allow notifications.
          </p>

          {state === "unsupported" ? (
            <p className="mt-3 text-xs text-faint">
              This browser doesn’t support push. On iPhone/iPad, add Cinevault to your Home Screen
              first, then open it and enable notifications.
            </p>
          ) : state === "denied" ? (
            <p className="mt-3 text-xs text-faint">
              Notifications are blocked. Turn them back on for this site in your browser settings,
              then reload.
            </p>
          ) : (
            <button
              onClick={toggle}
              disabled={busy}
              className={`btn mt-3 ${on ? "btn-ghost text-muted" : "btn-primary"}`}
            >
              {busy ? (
                <Loader2 size={16} className="animate-spin" />
              ) : on ? (
                <BellOff size={16} />
              ) : (
                <Bell size={16} />
              )}
              {on ? "Turn off on this device" : "Enable notifications"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
