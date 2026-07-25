import OpenAI from "openai";
import { z, type ZodType } from "zod";
import { getConfig, type ResolvedConfig } from "../config";

/** "reason" -> Moonshot (Kimi) preferred; "classify" -> MiMo preferred. */
export type LlmTask = "reason" | "classify";

export interface LlmProvider {
  name: string;
  client: OpenAI;
  model: string;
}

export function buildProviders(ai: ResolvedConfig["ai"]): {
  moonshot?: LlmProvider;
  mimo?: LlmProvider;
} {
  const moonshot: LlmProvider | undefined = ai.moonshot.apiKey
    ? {
        name: "moonshot",
        model: ai.moonshot.model,
        client: new OpenAI({ apiKey: ai.moonshot.apiKey, baseURL: ai.moonshot.baseUrl }),
      }
    : undefined;
  const mimo: LlmProvider | undefined = ai.mimo.apiKey
    ? {
        name: "mimo",
        model: ai.mimo.model,
        client: new OpenAI({ apiKey: ai.mimo.apiKey, baseURL: ai.mimo.baseUrl }),
      }
    : undefined;
  return { moonshot, mimo };
}

/** Resolve the best available provider for a task from current config. */
export async function providerFor(task: LlmTask): Promise<LlmProvider> {
  const cfg = await getConfig();
  const { moonshot, mimo } = buildProviders(cfg.ai);
  const chosen = task === "reason" ? (moonshot ?? mimo) : (mimo ?? moonshot);
  if (!chosen) {
    throw new Error(
      "No AI provider configured — add a Moonshot or MiMo API key in Settings.",
    );
  }
  return chosen;
}

function extractJSON(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start !== -1 && end !== -1 && end > start) return body.slice(start, end + 1);
  return body.trim();
}

/**
 * Create a completion, adapting to model constraints. Some models (e.g. Kimi
 * k3) reject a custom temperature and/or response_format — try the ideal params
 * first, then progressively relax (temperature=1, then drop JSON mode).
 */
async function createChat(
  provider: LlmProvider,
  messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[],
  temperature: number,
) {
  const base = { model: provider.model, messages };
  const attempts: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming[] = [
    { ...base, temperature, response_format: { type: "json_object" } },
    { ...base, temperature: 1, response_format: { type: "json_object" } },
    { ...base, temperature: 1 },
  ];
  let lastErr: unknown;
  for (const params of attempts) {
    try {
      return await provider.client.chat.completions.create(params);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

/** Like create(), but retries with temperature=1 for models that require it. */
export async function safeChatCreate(
  client: OpenAI,
  params: OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming,
) {
  try {
    return await client.chat.completions.create(params);
  } catch {
    return await client.chat.completions.create({ ...params, temperature: 1 });
  }
}

/** Chat completion constrained to a zod-validated JSON object, with one retry. */
export async function chatJSON<S extends ZodType>(opts: {
  task: LlmTask;
  system: string;
  user: string;
  schema: S;
  temperature?: number;
}): Promise<z.infer<S>> {
  const provider = await providerFor(opts.task);
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    {
      role: "system",
      content: `${opts.system}\n\nReturn ONLY a single valid JSON object — no markdown fences, no commentary.`,
    },
    { role: "user", content: opts.user },
  ];

  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const completion = await createChat(provider, messages, opts.temperature ?? 0.2);
    const text = completion.choices[0]?.message?.content ?? "";
    try {
      return opts.schema.parse(JSON.parse(extractJSON(text)));
    } catch (e) {
      lastErr = e;
      messages.push({ role: "assistant", content: text });
      messages.push({
        role: "user",
        content: `That was invalid (${(e as Error).message}). Return corrected JSON only.`,
      });
    }
  }
  throw new Error(
    `AI did not return valid JSON: ${(lastErr as Error)?.message ?? "unknown error"}`,
  );
}
