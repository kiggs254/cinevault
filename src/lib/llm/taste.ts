import { chatJSON } from "./providers";
import { TasteProfileSchema, type TasteProfile } from "../types";

export interface TasteSignals {
  watched: {
    name: string;
    type: string;
    genres: string[];
    people: string[];
    year?: number;
    playCount: number;
  }[];
  downloaded: { title: string; kind: string; year?: number | null }[];
  interests: string[];
}

/**
 * Distill a structured taste profile from behaviour. Watch history is weighted
 * most (the user actually finished those), downloads next, interests least.
 */
export async function buildTasteProfile(sig: TasteSignals): Promise<TasteProfile> {
  const system = `You are a media taste analyst. From a user's watch history (titles they played/finished on their media server), their download history, and any stated interests, infer a concise, evidence-based taste profile that will drive personalized movie & TV recommendations.

Weighting: watch history > downloads > stated interests. Do not invent preferences that the data does not support. Keep lists tight (top ~6 each) and specific. "avoid" should list genres/traits notably absent or that clash with the pattern.`;

  const user = JSON.stringify(
    {
      watched: sig.watched.slice(0, 80),
      downloaded: sig.downloaded.slice(0, 80),
      statedInterests: sig.interests,
    },
    null,
    2,
  );

  const profile = await chatJSON({
    task: "reason",
    system,
    user,
    schema: TasteProfileSchema,
    temperature: 0.3,
  });
  return { ...profile, updatedAt: new Date().toISOString() };
}
