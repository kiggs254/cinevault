import { getConfig } from "../config";
import { prisma } from "../db";

const API = "https://api.telegram.org";

export interface TgPhotoSize {
  file_id: string;
  file_unique_id?: string;
  width?: number;
  height?: number;
  file_size?: number;
}
export interface TgMessage {
  message_id: number;
  chat: { id: number; type?: string };
  text?: string;
  photo?: TgPhotoSize[];
  caption?: string;
  from?: { id: number; first_name?: string; username?: string };
}
export interface TgCallbackQuery {
  id: string;
  data?: string;
  from?: { id: number };
  message?: TgMessage;
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
  callback_query?: TgCallbackQuery;
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

/** Resolve a Telegram file_id to a downloadable URL (valid ~1h). */
export async function getFileLink(token: string, fileId: string): Promise<string | null> {
  const f = await tgApi<{ file_path?: string }>(token, "getFile", { file_id: fileId });
  return f?.file_path ? `${API}/file/bot${token}/${f.file_path}` : null;
}

/** Acknowledge a tapped inline button (stops Telegram's spinner). */
export async function answerCallback(token: string, id: string, text?: string): Promise<void> {
  await tgApi(token, "answerCallbackQuery", { callback_query_id: id, text });
}

export type InlineButton = { text: string; url?: string; callback_data?: string };

/** Send a message (or photo + caption) with an inline keyboard of url/callback buttons. */
export async function sendWithKeyboard(
  token: string,
  chatId: string | number,
  opts: { text: string; photo?: string | null; keyboard?: InlineButton[][] },
): Promise<void> {
  const reply_markup = opts.keyboard?.length ? { inline_keyboard: opts.keyboard } : undefined;
  if (opts.photo) {
    const ok = await tgApi(token, "sendPhoto", {
      chat_id: chatId,
      photo: opts.photo,
      caption: opts.text.slice(0, 1000),
      reply_markup,
    });
    if (ok) return; // else fall through to a text message
  }
  await tgApi(token, "sendMessage", {
    chat_id: chatId,
    text: opts.text.slice(0, 4000),
    reply_markup,
    disable_web_page_preview: true,
  });
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

/**
 * Push to a specific member's linked Telegram chat (if they linked one and left
 * notifications on). Used for per-user events (their download completed, etc.).
 */
export async function notifyUser(
  userId: string,
  text: string,
  opts?: { photo?: string | null; buttons?: NotifyButton[] },
): Promise<void> {
  try {
    const cfg = await getConfig();
    if (!cfg.telegram.botToken) return;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { telegramChatId: true, notifyTelegram: true },
    });
    if (!user?.telegramChatId || !user.notifyTelegram) return;
    const base = (cfg.appUrl ?? "").replace(/\/$/, "");
    const buttons: UrlButton[] = (opts?.buttons ?? []).map((b) => ({ text: b.text, url: `${base}${b.path}` }));
    if (opts?.photo) {
      await sendPhoto(cfg.telegram.botToken, user.telegramChatId, opts.photo, text, buttons);
    } else {
      await sendMessage(cfg.telegram.botToken, user.telegramChatId, text, buttons);
    }
  } catch {
    /* best-effort */
  }
}

/** Ping the owner with Approve/Deny buttons for a pending registration. */
export async function notifyOwnerNewRegistration(user: {
  id: string;
  username: string;
  invitedBy?: string | null;
}): Promise<void> {
  try {
    const cfg = await getConfig();
    if (!cfg.telegram.botToken || !cfg.telegram.chatId) return;
    const base = (cfg.appUrl ?? "").replace(/\/$/, "");
    const rows: InlineButton[][] = [
      [
        { text: "✅ Approve", callback_data: `usr:approve:${user.id}` },
        { text: "⛔ Deny", callback_data: `usr:deny:${user.id}` },
      ],
    ];
    if (/^https?:\/\//i.test(base) && !/localhost|127\.0\.0\.1/i.test(base)) {
      rows.push([{ text: "👥 Manage members", url: `${base}/users` }]);
    }
    const referral = user.invitedBy ? `\nReferred by ${user.invitedBy}.` : "";
    await sendWithKeyboard(cfg.telegram.botToken, cfg.telegram.chatId, {
      text: `🆕 New membership request: “${user.username}” wants to join.${referral}\nApprove to issue their library card (auto-creates their Jellyfin account).`,
      keyboard: rows,
    });
  } catch {
    /* best-effort */
  }
}
