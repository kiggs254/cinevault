import { chatJSON } from "./providers";
import { OrganizeResultSchema, type MediaKind, type OrganizeResult } from "../types";
import { cleanReleaseName, sanitizePrefix } from "../util";

export interface OrganizeInput {
  releaseName: string;
  kind?: MediaKind;
  title?: string | null;
  year?: number | null;
  season?: number | null;
  episode?: number | null;
}

/** Deterministic fallback used when AI is unavailable or returns junk. */
export function deterministicOrganize(input: OrganizeInput): OrganizeResult {
  const kind: MediaKind = input.kind ?? "OTHER";
  const clean = (input.title && input.title.trim()) || cleanReleaseName(input.releaseName);
  let prefix: string;
  switch (kind) {
    case "MOVIE":
      prefix = `Movies/${clean}${input.year ? ` (${input.year})` : ""}`;
      break;
    case "TV":
      prefix =
        input.season != null
          ? `TV/${clean}/Season ${String(input.season).padStart(2, "0")}`
          : `TV/${clean}`;
      break;
    case "MUSIC":
      prefix = `Music/${clean}`;
      break;
    case "SOFTWARE":
      prefix = `Software/${clean}`;
      break;
    default:
      prefix = `Other/${clean}`;
  }
  return {
    kind,
    cleanTitle: clean,
    year: input.year ?? null,
    season: input.season ?? null,
    episode: input.episode ?? null,
    s3Prefix: sanitizePrefix(prefix),
  };
}

/**
 * Decide a clean title and S3 folder path for a finished download. AI-driven
 * with a deterministic fallback so uploads never block on the model.
 */
export async function organize(input: OrganizeInput): Promise<OrganizeResult> {
  const system = `You organize a finished torrent into a tidy library path.

Given a raw release name and optional hints, return:
- "kind": MOVIE, TV, MUSIC, SOFTWARE, or OTHER.
- "cleanTitle": the clean human title (no dots, quality, or group tags).
- "year"/"season"/"episode": integers or null.
- "s3Prefix": the destination folder, following EXACTLY these conventions:
   MOVIE -> "Movies/<Title> (<Year>)"
   TV -> "TV/<Title>/Season <NN>"  (zero-padded)
   MUSIC -> "Music/<Artist - Album>"
   SOFTWARE -> "Software/<Title>"
   OTHER -> "Other/<Title>"
Use forward slashes. Do not include a leading or trailing slash.`;

  const user = `Release name: ${input.releaseName}\nHints: ${JSON.stringify({
    kind: input.kind,
    title: input.title,
    year: input.year,
    season: input.season,
    episode: input.episode,
  })}`;

  try {
    const result = await chatJSON({
      task: "classify",
      system,
      user,
      schema: OrganizeResultSchema,
      temperature: 0.1,
    });
    const s3Prefix = sanitizePrefix(result.s3Prefix);
    if (!s3Prefix) return deterministicOrganize(input);
    return { ...result, s3Prefix };
  } catch {
    return deterministicOrganize(input);
  }
}
