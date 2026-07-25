import { chatJSON } from "./providers";
import { PlannedQuerySchema, type PlannedQuery } from "../types";

/** Turn a natural-language request into a structured indexer search plan. */
export async function planQuery(
  input: string,
  hints?: { defaultQuality?: string },
): Promise<PlannedQuery> {
  const system = `You convert a user's natural-language media request into a structured torrent search plan.

Rules:
- "kind": one of MOVIE, TV, MUSIC, SOFTWARE, OTHER.
- "title": the canonical work title only — no year, no quality, no release tags.
- "year": release year if the user implies or states one, else null.
- "season"/"episode": integers for TV when specified, else null.
- "quality": one of 2160p, 1080p, 720p, 480p, any. If the user does not specify, use "${hints?.defaultQuality ?? "1080p"}".
- "searchTerms": the concise string to send to a torrent indexer. Usually "<title> <year>" and, for TV, include "S01" or "S01E02" style tokens. Do NOT include quality unless the user was specific.
- "keywords": extra distinguishing words (director, franchise) if helpful, else [].
- "confidence": 0..1 for how sure you are about the title resolution.
- "note": a short human explanation of what you understood.`;

  return chatJSON({
    task: "reason",
    system,
    user: input,
    schema: PlannedQuerySchema,
    temperature: 0.2,
  });
}
