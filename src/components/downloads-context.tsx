"use client";

import { createContext, useContext } from "react";
import { useDownloads } from "./use-downloads";

type DownloadsState = ReturnType<typeof useDownloads>;

const DownloadsContext = createContext<DownloadsState | null>(null);

/** One live download stream (SSE) shared by the nav badge and the Downloads page. */
export function DownloadsProvider({ children }: { children: React.ReactNode }) {
  const value = useDownloads();
  return <DownloadsContext.Provider value={value}>{children}</DownloadsContext.Provider>;
}

export function useDownloadsCtx(): DownloadsState {
  const ctx = useContext(DownloadsContext);
  if (!ctx) throw new Error("useDownloadsCtx must be used within DownloadsProvider");
  return ctx;
}
