import type OpenAI from "openai";
import { z } from "zod";
import { providerFor } from "./providers";

const Schema = z.object({
  title: z.string().min(1),
  year: z.number().int().nullable().optional(),
  mediaType: z.enum(["movie", "tv"]),
  confidence: z.number().min(0).max(1).optional(),
});
export type PosterIdentification = z.infer<typeof Schema>;

const SYSTEM =
  "You identify the single movie or TV show shown in a poster, cover art, or still frame. " +
  'Reply with ONLY a JSON object: {"title": string, "year": number|null, "mediaType": "movie"|"tv", "confidence": number between 0 and 1}. ' +
  'Use the exact, commonly-known English title. A series → mediaType "tv"; a film → "movie". Give your best guess with low confidence if unsure.';

/**
 * Identify a movie/TV title from a poster image (data URL). Uses the reasoning
 * provider's multimodal model (Kimi K2.5 is vision-capable). Returns null if the
 * model can't produce a usable identification.
 */
export async function identifyPoster(imageDataUrl: string): Promise<PosterIdentification | null> {
  const provider = await providerFor("reason");
  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: SYSTEM },
    {
      role: "user",
      content: [
        { type: "image_url", image_url: { url: imageDataUrl } },
        { type: "text", text: "Identify this title." },
      ],
    },
  ];
  for (const temperature of [0.2, 1]) {
    try {
      const completion = await provider.client.chat.completions.create({
        model: provider.model,
        messages,
        temperature,
      });
      const text = completion.choices[0]?.message?.content;
      const json = typeof text === "string" ? text.match(/\{[\s\S]*\}/)?.[0] : undefined;
      if (json) return Schema.parse(JSON.parse(json));
    } catch {
      /* try next temperature, then give up */
    }
  }
  return null;
}
