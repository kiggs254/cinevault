import OpenAI from "openai";
import { providerFor, safeChatCreate } from "./providers";
import { planAndSearch } from "../service/downloads";
import {
  pickAutoRelease,
  releaseTitleMatches,
  isEpisodeMatch,
  releaseCoversSeason,
  isSeasonEpisode,
} from "../scoring/scorer";
import { getConfig } from "../config";
import { searchTitle } from "../metadata/tmdb";

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
  | { type: "options"; title: string; posterUrl?: string; options: AgentOption[] }
  | { type: "error"; message: string }
  | { type: "done" };

const tools: OpenAI.Chat.Completions.ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "search_media",
      description:
        "Search indexers for a movie or TV show and show the user a filtered, tappable list of the best releases. This NEVER downloads — the user taps a result to download it.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description:
              "The title, with a year for movies and a season/episode token for TV, e.g. 'Dune Part Two 2024', 'Hijack season 1', 'The Bear S03E05'.",
          },
        },
        required: ["query"],
      },
    },
  },
];

const SYSTEM = `You are the assistant for a self-hosted media downloader that archives finished downloads to the user's S3 storage. You help ONLY with movies and TV shows.

- For every request, call search_media with a clear query — include the year for movies, and a season ("S01" / "season 1") or episode ("S01E03") token for TV when the user gives one. The app shows the user a filtered, tappable list of the best releases; they tap one to download. NEVER auto-download.
- Once results are shown, reply with NOTHING further — the list IS the answer. Do not summarize it, name a pick, or add commentary.
- If nothing is found, reply with ONE short sentence suggesting different wording or checking indexers in Settings.
- Politely decline anything that isn't a movie or TV show. Only help with content the user has the legal right to obtain.`;

const GB = 1024 ** 3;

async function execTool(
  name: string,
  args: Record<string, unknown>,
  emit: (e: AgentEvent) => void,
): Promise<unknown> {
  const query = String(args.query ?? "");
  if (name !== "search_media") return { error: `Unknown tool ${name}` };

  emit({ type: "status", message: `Searching for “${query}”…` });
  try {
    const { plan, ranked } = await planAndSearch(query);

    // Keep only releases relevant to the resolved title + season/episode.
    const filtered = ranked.filter((r) => {
      if (!releaseTitleMatches(r.title, plan.title)) return false;
      if (plan.kind === "TV" && plan.season != null) {
        return plan.episode != null
          ? isEpisodeMatch(r.title, plan.season, plan.episode)
          : releaseCoversSeason(r.title, plan.season) || isSeasonEpisode(r.title, plan.season);
      }
      return true;
    });
    const pool = filtered.length ? filtered : ranked; // fall back if filter was too tight
    if (pool.length === 0) {
      emit({ type: "status", message: "No results." });
      return {
        resultCount: 0,
        note: "No results; suggest different wording or checking indexers in Settings.",
      };
    }

    // Float the recommended auto-pick (720p, smallest well-seeded) to the top.
    const auto = pickAutoRelease(pool);
    let top = pool.slice(0, 6);
    if (auto) {
      const idx = top.findIndex((r) => r.title === auto.title);
      if (idx > 0) top.unshift(top.splice(idx, 1)[0]);
      else if (idx === -1) top = [auto, ...pool.filter((r) => r.title !== auto.title)].slice(0, 6);
    }

    // Best-effort TMDB poster for the title (one per result block).
    let posterUrl: string | undefined;
    try {
      const cfg = await getConfig();
      if (cfg.tmdb.apiKey) {
        const hit = await searchTitle(
          cfg.tmdb.apiKey,
          plan.kind === "TV" ? "tv" : "movie",
          plan.title,
          plan.year ?? undefined,
        );
        posterUrl = hit?.posterUrl ?? undefined;
      }
    } catch {
      /* poster is optional */
    }

    emit({
      type: "options",
      title: `Results for ${plan.title}${plan.year ? ` (${plan.year})` : ""}`,
      posterUrl,
      options: top.map((r, i) => ({
        id: String(i),
        label: r.title,
        meta: [r.parsed.resolution, r.parsed.source, `${r.seeders} seeders`, `${(r.size / GB).toFixed(2)} GB`]
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
    return { resultCount: pool.length, shown: true };
  } catch (e) {
    return { error: (e as Error).message };
  }
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

  for (let step = 0; step < 5; step++) {
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

    messages.push({ role: "assistant", content: msg.content ?? "", tool_calls: msg.tool_calls });

    if (msg.tool_calls && msg.tool_calls.length > 0) {
      let shown = false;
      for (const tc of msg.tool_calls) {
        if (tc.type !== "function") continue;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {
          /* leave args empty */
        }
        const result = await execTool(tc.function.name, args, emit);
        messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
        if ((result as { shown?: boolean })?.shown) shown = true;
      }
      if (shown) break; // results are the answer — no follow-up message
      continue; // no results → let the model suggest an alternative
    }

    if (msg.content) emit({ type: "message", content: msg.content });
    break;
  }
  emit({ type: "done" });
}
