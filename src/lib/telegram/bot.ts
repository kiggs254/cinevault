import { getConfig, saveConfig } from "../config";
import {
  tgApi,
  sendMessage,
  sendWithKeyboard,
  answerCallback,
  getFileLink,
  type InlineButton,
  type TgUpdate,
  type TgCallbackQuery,
  type TgPhotoSize,
} from "./client";
import { runAgent, type AgentEvent, type AgentMessage, type AgentOption } from "../llm/agent";
import { identifyPoster } from "../llm/vision";
import { createDownload, grabMovie } from "../service/downloads";
import { enqueueSeasonGrab } from "../queue";
import {
  searchTitle,
  getMovieDetails,
  getTvDetails,
  getVideoKey,
  type TmdbTvDetails,
} from "../metadata/tmdb";

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
    const updates = await tgApi<TgUpdate[]>(
      token,
      "getUpdates",
      { offset, timeout: 30, allowed_updates: ["message", "callback_query"] },
      40_000,
    );
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

/* -------------------------------- dispatch -------------------------------- */

async function handle(u: TgUpdate): Promise<void> {
  const cfg = await getConfig();
  const token = cfg.telegram.botToken;
  if (!token) return;

  if (u.callback_query) {
    const chatId = u.callback_query.message?.chat.id;
    if (chatId == null) return;
    if (cfg.telegram.chatId && String(chatId) !== String(cfg.telegram.chatId)) return;
    await handleCallback(token, chatId, u.callback_query);
    return;
  }

  const msg = u.message;
  if (!msg) return;
  const chatId = msg.chat.id;

  // First chat to talk claims the notification target.
  if (!cfg.telegram.chatId) {
    await saveConfig({ telegramChatId: String(chatId) });
    await sendMessage(
      token,
      chatId,
      "✅ Linked! Send me a movie or TV poster and I'll identify it, score it against your taste, and offer a one-tap download. Or just type “download Dune Part Two 4k”.",
    );
  } else if (String(chatId) !== String(cfg.telegram.chatId)) {
    return; // ignore other chats
  }

  if (msg.photo?.length) {
    await handlePhoto(token, chatId, msg.photo);
    return;
  }
  if (msg.text) {
    await handleText(token, chatId, msg.text.trim());
  }
}

/* --------------------------------- photo ---------------------------------- */

function tasteScore(
  taste: { favoriteGenres?: string[] } | null | undefined,
  genres: string[],
  voteAverage?: number,
): number {
  const vote = typeof voteAverage === "number" && voteAverage > 0 ? voteAverage / 10 : 0.5;
  const fav = new Set((taste?.favoriteGenres ?? []).map((g) => g.toLowerCase()));
  let genreScore = 0.5;
  if (fav.size && genres.length) {
    const overlap = genres.filter((g) => fav.has(g.toLowerCase())).length;
    genreScore = Math.min(1, overlap / Math.min(genres.length, 3));
  }
  return Math.round((0.55 * vote + 0.45 * genreScore) * 100);
}

async function handlePhoto(token: string, chatId: number, photo: TgPhotoSize[]): Promise<void> {
  const cfg = await getConfig();
  await tgApi(token, "sendChatAction", { chat_id: chatId, action: "typing" }, 8_000);

  const fileId = photo[photo.length - 1].file_id; // largest size
  const link = await getFileLink(token, fileId);
  if (!link) {
    await sendMessage(token, chatId, "Couldn't fetch that image — try sending it again.");
    return;
  }
  let dataUrl: string;
  try {
    const res = await fetch(link);
    const buf = Buffer.from(await res.arrayBuffer());
    const mime = res.headers.get("content-type") || "image/jpeg";
    dataUrl = `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    await sendMessage(token, chatId, "Couldn't read that image.");
    return;
  }

  const id = await identifyPoster(dataUrl);
  if (!id) {
    await sendMessage(token, chatId, "🤔 I couldn't recognise that poster. Try a clearer image, or just type the title.");
    return;
  }
  if (!cfg.tmdb.apiKey) {
    await sendMessage(token, chatId, `Looks like “${id.title}”. Add a TMDB key in Settings so I can fetch details and download it.`);
    return;
  }

  const hit = await searchTitle(cfg.tmdb.apiKey, id.mediaType, id.title, id.year ?? undefined);
  if (!hit) {
    await sendMessage(token, chatId, `I think that's “${id.title}”, but I couldn't find it on TMDB.`);
    return;
  }
  const details =
    id.mediaType === "movie"
      ? await getMovieDetails(cfg.tmdb.apiKey, hit.tmdbId)
      : await getTvDetails(cfg.tmdb.apiKey, hit.tmdbId);

  const title = details?.title ?? hit.title;
  const year = details?.year ?? hit.year;
  const genres = details?.genres ?? [];
  const vote = details?.voteAverage ?? hit.voteAverage;
  const score = tasteScore(cfg.tasteProfile, genres, vote);
  const trailer = await getVideoKey(cfg.tmdb.apiKey, id.mediaType, hit.tmdbId).catch(() => null);

  const lines = [
    `${title}${year ? ` (${year})` : ""}`,
    `${id.mediaType === "movie" ? "🎬 Movie" : "📺 TV series"}${genres.length ? ` · ${genres.slice(0, 3).join(", ")}` : ""}`,
    `${vote ? `⭐ ${vote.toFixed(1)}   ` : ""}🎯 ${score}% match for you`,
  ];
  if (details?.overview) lines.push("", details.overview);

  const row: InlineButton[] = [
    { text: "⬇️ Download", callback_data: `dl:${id.mediaType}:${hit.tmdbId}` },
  ];
  if (trailer) row.push({ text: "▶️ Trailer", url: `https://www.youtube.com/watch?v=${trailer}` });

  await sendWithKeyboard(token, chatId, {
    text: lines.join("\n"),
    photo: details?.posterUrl ?? hit.posterUrl ?? undefined,
    keyboard: [row],
  });
}

/* ------------------------------- callbacks -------------------------------- */

function releasedSeasons(d: TmdbTvDetails): number[] {
  const today = new Date().toISOString().slice(0, 10);
  return d.seasons
    .filter((s) => s.seasonNumber >= 1 && s.episodeCount > 0 && (!s.airDate || s.airDate <= today))
    .map((s) => s.seasonNumber);
}

async function handleCallback(token: string, chatId: number, cq: TgCallbackQuery): Promise<void> {
  await answerCallback(token, cq.id);
  const cfg = await getConfig();
  if (!cfg.tmdb.apiKey) {
    await sendMessage(token, chatId, "TMDB isn't configured — add a key in Settings.");
    return;
  }
  const data = cq.data ?? "";

  // Movie → grab straight away.
  if (data.startsWith("dl:movie:")) {
    const tmdbId = Number(data.split(":")[2]);
    const d = await getMovieDetails(cfg.tmdb.apiKey, tmdbId);
    if (!d) {
      await sendMessage(token, chatId, "Couldn't load that title.");
      return;
    }
    await sendMessage(token, chatId, `🔎 Finding the best release for ${d.title}…`);
    const dl = await grabMovie({ tmdbId, title: d.title, year: d.year ?? null });
    await sendMessage(
      token,
      chatId,
      dl
        ? `⬇️ Downloading ${d.title}${d.year ? ` (${d.year})` : ""}.`
        : `😕 No good source for ${d.title} right now — I'll keep an eye out.`,
    );
    return;
  }

  // TV → offer a season picker.
  if (data.startsWith("dl:tv:")) {
    const tmdbId = Number(data.split(":")[2]);
    const d = await getTvDetails(cfg.tmdb.apiKey, tmdbId);
    if (!d) {
      await sendMessage(token, chatId, "Couldn't load that show.");
      return;
    }
    const seasons = releasedSeasons(d);
    if (seasons.length === 0) {
      await sendMessage(token, chatId, "No released seasons yet for that show.");
      return;
    }
    const rows: InlineButton[][] = [];
    for (let i = 0; i < seasons.length; i += 4) {
      rows.push(
        seasons.slice(i, i + 4).map((n) => ({ text: `S${n}`, callback_data: `grab:${tmdbId}:${n}` })),
      );
    }
    if (seasons.length > 1) rows.push([{ text: "⬇️ All seasons", callback_data: `grab:${tmdbId}:all` }]);
    await sendWithKeyboard(token, chatId, {
      text: `${d.title} — which season should I grab?`,
      keyboard: rows,
    });
    return;
  }

  // Season pick → queue the grab(s).
  if (data.startsWith("grab:")) {
    const [, idStr, sel] = data.split(":");
    const tmdbId = Number(idStr);
    const d = await getTvDetails(cfg.tmdb.apiKey, tmdbId);
    if (!d) {
      await sendMessage(token, chatId, "Couldn't load that show.");
      return;
    }
    const targets = sel === "all" ? releasedSeasons(d) : [Number(sel)];
    for (const season of targets) {
      await enqueueSeasonGrab({ tmdbId, title: d.title, year: d.year ?? null, season, notify: false });
    }
    await sendMessage(
      token,
      chatId,
      targets.length > 1
        ? `📥 Queued ${targets.length} seasons of ${d.title} — grabbing in the background.`
        : `📥 Queued ${d.title} Season ${targets[0]} — grabbing in the background.`,
    );
    return;
  }
}

/* --------------------------------- text ----------------------------------- */

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

async function handleText(token: string, chatId: number, text: string): Promise<void> {
  if (text === "/start" || text === "/help") {
    await sendMessage(
      token,
      chatId,
      "🎬 Cinevault agent. Send me a movie/TV poster to identify + download, or ask me to find something (“download Dune Part Two 4k”). When I list options, reply with a number to grab one.",
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
