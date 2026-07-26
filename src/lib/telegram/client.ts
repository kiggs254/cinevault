import { getConfig } from "../config";

const API = "https://api.telegram.org";

export interface TgMessage {
  message_id: number;
  chat: { id: number; type?: string };
  text?: string;
  from?: { id: number; first_name?: string; username?: string };
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function tgApi<T = any>(
  token: string,
  method: string,
  body?: Record<string, unknown>,
  timeoutMs = 15_000,
): Promise<T | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body ?? {}),
      signal: ctrl.signal,
    });
    const data = await res.json();
    return data?.ok ? (data.result as T) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

export async function sendMessage(
  token: string,
  chatId: string | number,
  text: string,
): Promise<void> {
  await tgApi(token, "sendMessage", {
    chat_id: chatId,
    text: text.slice(0, 4000),
    disable_web_page_preview: true,
  });
}

/** Fire-and-forget push to the configured chat. Safe to call from anywhere. */
export async function notify(text: string): Promise<void> {
  try {
    const cfg = await getConfig();
    if (!cfg.telegram.botToken || !cfg.telegram.chatId) return;
    await sendMessage(cfg.telegram.botToken, cfg.telegram.chatId, text);
  } catch {
    /* best-effort */
  }
}
