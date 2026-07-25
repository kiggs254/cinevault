import OpenAI from "openai";
import { providerFor, safeChatCreate } from "./providers";
import { planAndSearch, startFromQuery } from "../service/downloads";

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
];

const SYSTEM = `You are the assistant for a self-hosted, AI-driven media downloader that saves finished downloads to the user's S3 storage.

- For most "find / download X" requests, call search_media — the app then shows the user a selectable list of results they tap to download. Afterwards, briefly point them to the list and name the top pick. Do NOT paste the whole list yourself; it is already shown as tappable options.
- Use queue_download only when the user explicitly says to just grab the best automatically, or for batch requests ("all of Show season 2 in 1080p") — call it once per episode/target.
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
      const top = ranked.slice(0, 6);
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
