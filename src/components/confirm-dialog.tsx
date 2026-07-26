"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

type ConfirmFn = (opts: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

/** App-wide confirmation dialog. `const confirm = useConfirm(); if (await confirm({...})) …` */
export function ConfirmProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<{
    opts: ConfirmOptions;
    resolve: (ok: boolean) => void;
  } | null>(null);

  const confirm = useCallback<ConfirmFn>(
    (opts) => new Promise<boolean>((resolve) => setState({ opts, resolve })),
    [],
  );

  const close = useCallback(
    (ok: boolean) => {
      setState((s) => {
        s?.resolve(ok);
        return null;
      });
    },
    [],
  );

  useEffect(() => {
    if (!state) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(false);
      if (e.key === "Enter") close(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [state, close]);

  const danger = state ? state.opts.danger !== false : true;

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {state && (
        <div
          className="sheet fixed inset-0 z-[70] flex items-center justify-center bg-black/70 p-4"
          onClick={() => close(false)}
        >
          <div
            className="sheet-card w-full max-w-sm rounded-2xl border border-border bg-surface p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center gap-2">
              {danger && <AlertTriangle size={18} className="flex-none text-danger" />}
              <h2 className="text-base font-semibold text-ink">{state.opts.title}</h2>
            </div>
            {state.opts.message && <p className="mb-4 text-sm text-muted">{state.opts.message}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={() => close(false)}>
                {state.opts.cancelLabel ?? "Cancel"}
              </button>
              <button
                className="btn"
                style={{ background: "var(--color-danger)", color: "#fff" }}
                onClick={() => close(true)}
                autoFocus
              >
                {state.opts.confirmLabel ?? "Delete"}
              </button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmProvider");
  return ctx;
}
