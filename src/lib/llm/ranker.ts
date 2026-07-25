import { chatJSON } from "./providers";
import { RankDecisionSchema, type PlannedQuery, type RankDecision, type ScoredResult } from "../types";

const GB = 1024 * 1024 * 1024;

/**
 * AI tiebreak over the top deterministically-scored candidates. The scorer does
 * the bulk work; the model handles fuzzy judgement (fakes, mislabels, best fit).
 */
export async function aiRank(
  query: PlannedQuery,
  candidates: ScoredResult[],
): Promise<RankDecision> {
  const compact = candidates.map((c, i) => ({
    index: i,
    title: c.title,
    indexer: c.indexer,
    seeders: c.seeders,
    sizeGB: Number((c.size / GB).toFixed(2)),
    resolution: c.parsed.resolution ?? "unknown",
    source: c.parsed.source ?? "unknown",
    codec: c.parsed.codec ?? "unknown",
    isCam: c.parsed.isCam,
    heuristicScore: c.score,
  }));

  const system = `You select the single best torrent release for a user's request.

Prefer, in order: correct content match, healthy seeders, requested quality (${query.quality}), trustworthy source (BluRay/WEB-DL over CAM), and a sane file size.
Reject and flag: CAM/TS/telesync, obvious fakes (tiny video with an .exe, wildly wrong size), password-locked or scam releases, wrong title/year.
Return "chosenIndex" (the best index, or -1 if none are acceptable), a short "reason", and "flaggedIndexes" for any suspicious entries.`;

  const user = `Request:\n${JSON.stringify(
    { kind: query.kind, title: query.title, year: query.year, season: query.season, episode: query.episode, quality: query.quality },
    null,
    2,
  )}\n\nCandidates:\n${JSON.stringify(compact, null, 2)}`;

  return chatJSON({
    task: "reason",
    system,
    user,
    schema: RankDecisionSchema,
    temperature: 0.1,
  });
}
