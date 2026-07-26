import { getConfig, saveConfig } from "../config";
import { tgApi, sendMessage, type TgUpdate } from "./client";
import { runAgent, type AgentEvent, type AgentMessage, type AgentOption } from "../llm/agent";
import { createDownload } from "../service/downloads";

const histories = new Map<number, AgentMessage[]>();
const pending = new Map<number, AgentOption[]>();
let running = false;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Start the long-poll loop once (safe to call repeatedly). */
export function startTelegramBot(): void {
  if (running) return;
  running = true;
  void loop();
}

async function loop(): Promise<void> {
  let offset = 0;
  for (;;) {
    let token: string | undefined;
    try {
      token = (await getConfig()).telegram.botToken;
    } catch {
      token = undefined;
    }
    if (!token) {
      await sleep(15_000);
      continue;
    }
    const updates = await tgApi<TgUpdate[]>(token, "getUpdates", { offset, timeout: 30 }, 40_000);
    if (!updates) {
      await sleep(3_000);
      continue;
    }
    for (const u of updates) {
      offset = Math.max(offset, u.update_id + 1);
      try {
        await handle(u);
      } catch (e) {
        console.error("[telegram] handle error:", (e as Error).message);
      }
    }
  }
}

/* eslint-disable @typescript-eslint/no-explicit-any */
async function downloadOption(token: string, chatId: number, opt: AgentOption): Promise<void> {
  const d = opt.download as any;
  try {
    const dl = await createDownload({
      releaseName: d.title,
      source: d.magnetUrl ?? d.downloadUrl ?? "",
      infoHash: d.infoHash,
      indexer: d.indexer,
      size: d.size,
      seeders: d.seeders,
      kind: d.plan?.kind,
      title: d.plan?.title,
      year: d.plan?.year,
      season: d.plan?.season,
      episode: d.plan?.episode,
      query: d.query,
    });
    await sendMessage(token, chatId, `⬇️ Downloading: ${dl.title}`);
  } catch (e) {
    await sendMessage(token, chatId, `Failed: ${(e as Error).message}`);
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

async function handle(u: TgUpdate): Promise<void> {
  const msg = u.message;
  if (!msg?.text) return;
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  const cfg = await getConfig();
  const token = cfg.telegram.botToken;
  if (!token) return;

  // First chat to talk claims the notification target.
  let allowed = cfg.telegram.chatId;
  if (!allowed) {
    await saveConfig({ telegramChatId: String(chatId) });
    allowed = String(chatId);
    await sendMessage(
      token,
      chatId,
      "✅ Linked! You'll get notifications here (new episodes, completed downloads, discoveries), and you can chat with the agent. Try: “download The Bear season 3”.",
    );
  }
  if (String(chatId) !== String(allowed)) return; // ignore other chats

  if (text === "/start" || text === "/help") {
    await sendMessage(
      token,
      chatId,
      "🎬 MovieHub agent. Ask me to find or download things (“download Dune Part Two 4k”), and I'll notify you about new episodes of shows you follow and completed downloads. When I list options, reply with a number to grab one.",
    );
    return;
  }

  // A bare number picks a previously-listed option.
  const num = Number(text);
  if (Number.isInteger(num) && num > 0 && pending.has(chatId)) {
    const opt = pending.get(chatId)![num - 1];
    if (opt) {
      await downloadOption(token, chatId, opt);
      pending.delete(chatId);
      return;
    }
  }

  await tgApi(token, "sendChatAction", { chat_id: chatId, action: "typing" }, 8_000);

  const hist = histories.get(chatId) ?? [];
  hist.push({ role: "user", content: text });

  const parts: string[] = [];
  let options: AgentOption[] | null = null;
  await runAgent(hist.slice(-12), (e: AgentEvent) => {
    if (e.type === "message") parts.push(e.content);
    else if (e.type === "action") parts.push(`✅ ${e.message}`);
    else if (e.type === "options") options = e.options;
    else if (e.type === "error") parts.push(`⚠️ ${e.message}`);
  });

  let reply = parts.join("\n\n").trim();
  if (options && (options as AgentOption[]).length) {
    const opts = (options as AgentOption[]).slice(0, 6);
    pending.set(chatId, opts);
    const list = opts
      .map((o, i) => `${i + 1}. ${o.label}${o.meta ? `\n   ${o.meta}` : ""}`)
      .join("\n");
    reply = `${reply ? `${reply}\n\n` : ""}${list}\n\nReply with a number to download.`;
  }
  if (!reply) reply = "Done.";

  hist.push({ role: "assistant", content: reply });
  histories.set(chatId, hist.slice(-12));
  await sendMessage(token, chatId, reply);
}
