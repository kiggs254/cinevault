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

interface UrlButton {
  text: string;
  url: string;
}

/** Build a single-row inline keyboard, dropping localhost/relative URLs. */
function keyboard(buttons?: UrlButton[]): Record<string, unknown> | undefined {
  const valid = (buttons ?? []).filter(
    (b) => /^https?:\/\//i.test(b.url) && !/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(b.url),
  );
  return valid.length ? { inline_keyboard: [valid.map((b) => ({ text: b.text, url: b.url }))] } : undefined;
}

export async function sendMessage(
  token: string,
  chatId: string | number,
  text: string,
  buttons?: UrlButton[],
): Promise<void> {
  await tgApi(token, "sendMessage", {
    chat_id: chatId,
    text: text.slice(0, 4000),
    disable_web_page_preview: true,
    reply_markup: keyboard(buttons),
  });
}

/** Send a poster photo with a caption + optional CTA buttons; falls back to text. */
export async function sendPhoto(
  token: string,
  chatId: string | number,
  photo: string,
  caption: string,
  buttons?: UrlButton[],
): Promise<void> {
  const ok = await tgApi(token, "sendPhoto", {
    chat_id: chatId,
    photo,
    caption: caption.slice(0, 1000),
    reply_markup: keyboard(buttons),
  });
  if (!ok) await sendMessage(token, chatId, caption, buttons); // photo URL rejected → text
}

export interface NotifyButton {
  text: string;
  path: string; // relative to the app's public URL (e.g. "/downloads")
}

/**
 * Fire-and-forget push to the configured chat. Optionally attaches a poster and
 * CTA buttons (built from the app's public URL; skipped if that's localhost).
 */
export async function notify(
  text: string,
  opts?: { photo?: string | null; buttons?: NotifyButton[] },
): Promise<void> {
  try {
    const cfg = await getConfig();
    if (!cfg.telegram.botToken || !cfg.telegram.chatId) return;
    const base = (cfg.appUrl ?? "").replace(/\/$/, "");
    const buttons: UrlButton[] = (opts?.buttons ?? []).map((b) => ({ text: b.text, url: `${base}${b.path}` }));
    if (opts?.photo) {
      await sendPhoto(cfg.telegram.botToken, cfg.telegram.chatId, opts.photo, text, buttons);
    } else {
      await sendMessage(cfg.telegram.botToken, cfg.telegram.chatId, text, buttons);
    }
  } catch {
    /* best-effort */
  }
}
