import { chatJSON } from "./providers";
import { RecommendRankSchema, type RecommendRank, type TasteProfile } from "../types";
import type { TmdbTitle } from "../metadata/tmdb";

/**
 * Rank a pool of REAL TMDB candidates against the taste profile and attach a
 * short personal reason to each. The model may only choose from the provided
 * candidates (by index) — it never invents titles.
 */
export async function rankRecommendations(
  profile: TasteProfile | null,
  candidates: TmdbTitle[],
  limit = 30,
): Promise<RecommendRank> {
  if (candidates.length === 0) return { picks: [] };

  const compact = candidates.map((c, i) => ({
    index: i,
    title: c.title,
    year: c.year ?? null,
    type: c.mediaType,
    rating: c.voteAverage ?? null,
    overview: (c.overview ?? "").slice(0, 220),
  }));

  const system = `You are a personal media curator. Given a user's taste profile and a list of candidate titles, select and rank the ones this specific user is most likely to love.

Rules:
- Choose ONLY from the provided candidates, by their "index".
- Return up to ${limit} picks, best first.
- Each "reason" must be short (max ~15 words) and personal — reference the user's taste ("slow-burn crime like Dexter", "more prestige sci-fi"). No generic blurbs.
- "score" 0-100 = confidence this user will like it.
- Skip candidates that clash with the profile's "avoid".`;

  const user = `Taste profile:\n${JSON.stringify(profile ?? { summary: "No profile yet — infer from candidates broadly." }, null, 2)}\n\nCandidates:\n${JSON.stringify(compact, null, 2)}`;

  try {
    return await chatJSON({
      task: "reason",
      system,
      user,
      schema: RecommendRankSchema,
      temperature: 0.4,
    });
  } catch {
    // Fallback: rank by TMDB rating so Discover still populates without AI.
    const picks = candidates
      .map((c, index) => ({ index, reason: "", score: Math.round((c.voteAverage ?? 5) * 10) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    return { picks };
  }
}
