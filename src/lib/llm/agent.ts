import OpenAI from "openai";
import { providerFor } from "./providers";
import { planAndSearch, startFromQuery } from "../service/downloads";

export interface AgentMessage {
  role: "user" | "assistant";
  content: string;
}

export type AgentEvent =
  | { type: "status"; message: string }
  | { type: "action"; message: string; downloadId?: string }
  | { type: "message"; content: string }
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

- When the user wants to see options, call search_media and summarize the best few (quality, seeders, size).
- When the user clearly wants something fetched, call queue_download.
- For batch requests ("all of Show season 2 in 1080p"), call queue_download once per episode/target.
- Be concise and friendly. Report what you queued.
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
      emit({ type: "status", message: `Found ${ranked.length} results.` });
      return {
        understood: plan,
        results: ranked.slice(0, 6).map((r, i) => ({
          rank: i + 1,
          title: r.title,
          seeders: r.seeders,
          sizeGB: Number((r.size / (1024 ** 3)).toFixed(2)),
          quality: r.parsed.resolution ?? "unknown",
          source: r.parsed.source ?? "unknown",
          score: r.score,
        })),
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
      completion = await provider.client.chat.completions.create({
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
