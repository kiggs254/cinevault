import OpenAI from "openai";
import { providerFor, safeChatCreate } from "./providers";
import { planAndSearch, startFromQuery } from "../service/downloads";
import { pickAutoRelease } from "../scoring/scorer";
import { getConfig } from "../config";
import { searchTitle, getTvDetails } from "../metadata/tmdb";
import { enqueueSeasonGrab } from "../queue";

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

export interface AgentOption {
  id: string;
  label: string;
  meta?: string;
  recommended?: boolean;
  download: Record<string, unknown>;
}

export type AgentEvent =
  | { type: "status"; message: string }
  | { type: "action"; message: string; downloadId?: string }
  | { type: "message"; content: string }
  | { type: "options"; title: string; options: AgentOption[] }
  | { type: "error"; message: string }
  | { type: "done" };

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_media",
      description:
        "Search torrent indexers for media and return ranked candidates plus the recommended pick. Use to show the user options before downloading.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Natural-language description, e.g. 'Dune Part Two 2024 4k'",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "queue_download",
      description:
        "Find the best release for a request and immediately queue it for download + upload to storage. Use when the user clearly wants something fetched. Call once per target (e.g. per episode).",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "What to download, e.g. 'The Matrix 1999 1080p'",
          },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "download_season",
      description:
        "Download TV the smart way — a whole season, or an entire show. Grabs a validated complete-season pack when one exists, otherwise every AIRED episode one-by-one (correctly matched by SxxExx) into a single folder. Use for requests like 'Rick and Morty season 1', 'download Silo season 2', or 'grab all of The Office'.",
      parameters: {
        type: "object",
        properties: {
          title: { type: "string", description: "The show title, e.g. 'Rick and Morty'" },
          season: {
            type: "integer",
            description: "Season number for one season. Omit to grab EVERY season of the show.",
          },
          year: { type: "integer", description: "The show's first-air year, if known." },
        },
        required: ["title"],
      },
    },
  },
];

const SYSTEM = `You are the assistant for a self-hosted, AI-driven media downloader that saves finished downloads to the user's S3 storage.

- TV **seasons** or a whole **show** ("Rick and Morty season 1", "download Silo season 2", "grab all of The Office"): call download_season. It grabs a validated complete-season pack when available, otherwise every aired episode one-by-one into a single folder. Pass a season number for one season, or omit it to grab the whole show. Do NOT use search_media for a whole season — it lists single releases and can mispick the wrong episode.
- Movies or a single specific release the user wants to pick from: call search_media — the app shows a selectable list they tap to download. Afterwards, briefly point them to the list and name the top pick. Do NOT paste the whole list yourself; it is already shown as tappable options.
- Use queue_download only when the user explicitly wants the single best item grabbed automatically (e.g. one movie).
- Reply in concise Markdown (short paragraphs, **bold** for titles, lists where helpful).
- Only help download content the user has the legal right to obtain.`;

async function execTool(
  name: string,
  args: Record<string, unknown>,
  emit: (e: AgentEvent) => void,
): Promise<unknown> {
  const query = String(args.query ?? "");
  if (name === "search_media") {
    emit({ type: "status", message: `Searching for “${query}”…` });
    try {
      const { plan, ranked } = await planAndSearch(query);
      // Surface the auto-pick (720p, smallest well-seeded) first as the recommended option.
      const auto = pickAutoRelease(ranked);
      let top = ranked.slice(0, 6);
      if (auto) {
        const idx = top.findIndex((r) => r.title === auto.title);
        if (idx > 0) top.unshift(top.splice(idx, 1)[0]);
        else if (idx === -1) top = [auto, ...ranked.filter((r) => r.title !== auto.title)].slice(0, 6);
      }
      emit({
        type: "options",
        title: `Results for ${plan.title}${plan.year ? ` (${plan.year})` : ""}`,
        options: top.map((r, i) => ({
          id: String(i),
          label: r.title,
          meta: [
            r.parsed.resolution,
            r.parsed.source,
            `${r.seeders} seeders`,
            `${(r.size / 1024 ** 3).toFixed(2)} GB`,
          ]
            .filter(Boolean)
            .join(" · "),
          recommended: i === 0,
          download: {
            title: r.title,
            magnetUrl: r.magnetUrl,
            downloadUrl: r.downloadUrl,
            infoHash: r.infoHash,
            indexer: r.indexer,
            size: r.size,
            seeders: r.seeders,
            query,
            plan: {
              kind: plan.kind,
              title: plan.title,
              year: plan.year,
              season: plan.season,
              episode: plan.episode,
            },
          },
        })),
      });
      emit({ type: "status", message: `Found ${ranked.length} results.` });
      return {
        understood: plan,
        resultCount: ranked.length,
        note:
          ranked.length > 0
            ? "A selectable list was shown to the user — they tap one to download. Point them to it and name the top pick; do NOT paste the full list."
            : "No results found; suggest different wording or check indexers in Settings.",
      };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }
  if (name === "queue_download") {
    emit({ type: "status", message: `Finding the best release for “${query}”…` });
    try {
      const { download, decision, plan } = await startFromQuery(query);
      if (!download) {
        emit({ type: "status", message: `No suitable release found for “${query}”.` });
        return { queued: false, reason: decision.reason };
      }
      emit({ type: "action", message: `Queued: ${download.title}`, downloadId: download.id });
      return { queued: true, title: download.title, id: download.id, reason: decision.reason, kind: plan.kind };
    } catch (e) {
      emit({ type: "status", message: `Failed: ${(e as Error).message}` });
      return { queued: false, error: (e as Error).message };
    }
  }
  if (name === "download_season") {
    const title = String(args.title ?? "").trim();
    if (!title) return { error: "A show title is required." };
    const seasonArg = args.season != null ? Number(args.season) : undefined;
    const year = args.year != null ? Number(args.year) : undefined;
    try {
      const cfg = await getConfig();
      if (!cfg.tmdb.apiKey) return { error: "TMDB is not configured (Settings)." };
      emit({ type: "status", message: `Resolving “${title}”…` });
      const hit = await searchTitle(cfg.tmdb.apiKey, "tv", title, year);
      if (!hit) return { error: `Couldn't find “${title}” on TMDB.` };
      let seasons: number[];
      if (seasonArg && Number.isInteger(seasonArg) && seasonArg >= 1) {
        seasons = [seasonArg];
      } else {
        const details = await getTvDetails(cfg.tmdb.apiKey, hit.tmdbId);
        seasons = (details?.seasons ?? []).map((s) => s.seasonNumber).filter((n) => n >= 1);
      }
      if (seasons.length === 0) return { error: "No seasons found for that show." };
      for (const s of seasons) {
        await enqueueSeasonGrab({
          tmdbId: hit.tmdbId,
          title: hit.title,
          year: hit.year ?? year ?? null,
          season: s,
          notify: false,
        });
      }
      const label = seasons.length === 1 ? `Season ${seasons[0]}` : `${seasons.length} seasons`;
      emit({ type: "action", message: `Grabbing ${hit.title} — ${label}` });
      return {
        queued: true,
        title: hit.title,
        seasons,
        note: "Queued a background season-grab (validated pack, else episode-by-episode into one folder). Tell the user it's grabbing and episodes will appear in Downloads — do NOT list individual releases.",
      };
    } catch (e) {
      return { error: (e as Error).message };
    }
  }
  return { error: `Unknown tool ${name}` };
}

/** Run one agent turn over the conversation, emitting realtime events. */
export async function runAgent(
  history: AgentMessage[],
  emit: (e: AgentEvent) => void,
): Promise<void> {
  let provider;
  try {
    provider = await providerFor("reason");
  } catch (e) {
    emit({ type: "error", message: (e as Error).message });
    emit({ type: "done" });
    return;
  }

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM },
    ...history.map(
      (m) =>
        ({ role: m.role, content: m.content }) as OpenAI.Chat.Completions.ChatCompletionMessageParam,
    ),
  ];

  for (let step = 0; step < 6; step++) {
    let completion;
    try {
      completion = await safeChatCreate(provider.client, {
        model: provider.model,
        messages,
        tools,
        tool_choice: "auto",
        temperature: 0.3,
      });
    } catch (e) {
      emit({ type: "error", message: `AI request failed: ${(e as Error).message}` });
      break;
    }

    const msg = completion.choices[0]?.message;
    if (!msg) {
      emit({ type: "error", message: "Empty AI response" });
      break;
    }

    messages.push({
      role: "assistant",
      content: msg.content ?? "",
      tool_calls: msg.tool_calls,
    });

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      for (const tc of msg.tool_calls) {
        if (tc.type !== "function") continue;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {
          /* leave args empty */
        }
        const result = await execTool(tc.function.name, args, emit);
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: JSON.stringify(result),
        });
      }
      continue; // let the model react to tool results
    }

    if (msg.content) emit({ type: "message", content: msg.content });
    break;
  }
  emit({ type: "done" });
}
