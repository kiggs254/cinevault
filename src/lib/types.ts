import { z } from "zod";

export type MediaKind = "MOVIE" | "TV" | "MUSIC" | "SOFTWARE" | "OTHER";

/* ------------------------------------------------------------------ *
 * Taste profile (AI-distilled from Jellyfin watch + download history) *
 * ------------------------------------------------------------------ */

export const TasteProfileSchema = z.object({
  summary: z.string().describe("One-paragraph natural-language description of the user's taste"),
  favoriteGenres: z.array(z.string()).default([]),
  favoritePeople: z.array(z.string()).default([]).describe("Actors/directors/creators they gravitate to"),
  keywords: z.array(z.string()).default([]).describe("Themes/tones: e.g. slow-burn, heist, dystopian"),
  eras: z.array(z.string()).default([]).describe("Preferred eras, e.g. '2010s', 'modern'"),
  languages: z.array(z.string()).default([]),
  avoid: z.array(z.string()).default([]).describe("Genres/traits they seem to avoid"),
});
export type TasteProfile = z.infer<typeof TasteProfileSchema> & { updatedAt?: string };

export type DownloadStatus =
  | "QUEUED"
  | "SEARCHING"
  | "DOWNLOADING"
  | "UPLOADING"
  | "COMPLETED"
  | "FAILED"
  | "PAUSED"
  | "CANCELLED";

/* ------------------------------------------------------------------ *
 * AI structured outputs (validated with zod after the model responds) *
 * ------------------------------------------------------------------ */

export const PlannedQuerySchema = z.object({
  kind: z.enum(["MOVIE", "TV", "MUSIC", "SOFTWARE", "OTHER"]),
  title: z.string().describe("Canonical title of the work, no year or quality"),
  year: z.number().int().nullable().optional(),
  season: z.number().int().nullable().optional(),
  episode: z.number().int().nullable().optional(),
  quality: z
    .enum(["2160p", "1080p", "720p", "480p", "any"])
    .default("any")
    .describe("Preferred video resolution"),
  searchTerms: z
    .string()
    .describe("The exact string to send to the torrent indexer search"),
  keywords: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
  note: z.string().default(""),
});
export type PlannedQuery = z.infer<typeof PlannedQuerySchema>;

export const RecommendRankSchema = z.object({
  picks: z
    .array(
      z.object({
        index: z.number().int().describe("Index into the provided candidate list"),
        reason: z.string().describe("Short, personal: why THIS user would like it"),
        score: z.number().int().min(0).max(100),
      }),
    )
    .default([]),
});
export type RecommendRank = z.infer<typeof RecommendRankSchema>;

export const RankDecisionSchema = z.object({
  chosenIndex: z.number().int().describe("Index of the best result, or -1 if none are acceptable"),
  reason: z.string(),
  flaggedIndexes: z
    .array(z.object({ index: z.number().int(), reason: z.string() }))
    .default([])
    .describe("Results that look like fakes, CAMs, or malware"),
});
export type RankDecision = z.infer<typeof RankDecisionSchema>;

export const OrganizeResultSchema = z.object({
  kind: z.enum(["MOVIE", "TV", "MUSIC", "SOFTWARE", "OTHER"]),
  cleanTitle: z.string(),
  year: z.number().int().nullable().optional(),
  season: z.number().int().nullable().optional(),
  episode: z.number().int().nullable().optional(),
  s3Prefix: z.string().describe("Folder path in the bucket, e.g. Movies/Title (2024)"),
});
export type OrganizeResult = z.infer<typeof OrganizeResultSchema>;

/* ------------------------------------------------------------------ *
 * Indexer + scoring                                                   *
 * ------------------------------------------------------------------ */

export interface TorrentResult {
  title: string;
  indexer: string;
  size: number; // bytes
  seeders: number;
  leechers: number;
  downloadUrl?: string; // .torrent url
  magnetUrl?: string;
  infoHash?: string;
  publishDate?: string;
  categories: number[];
  link?: string; // details page
}

export interface ParsedRelease {
  resolution?: "2160p" | "1080p" | "720p" | "480p";
  source?: string; // BluRay, WEB-DL, WEBRip, HDTV, CAM, ...
  codec?: string; // x265, x264, AV1, ...
  audio?: string; // DDP5.1, Atmos, AAC, ...
  hdr?: boolean;
  group?: string;
  isCam: boolean;
  isRepack: boolean;
  seasonPack: boolean;
}

export interface ScoredResult extends TorrentResult {
  score: number;
  reasons: string[];
  parsed: ParsedRelease;
}

/* ------------------------------------------------------------------ *
 * Jobs + realtime events                                              *
 * ------------------------------------------------------------------ */

export interface SeasonGrabData {
  tmdbId: number;
  title: string;
  year: number | null;
  season: number;
  indexerIds?: number[];
  notify?: boolean;
}

export interface EpisodeGrabData {
  tmdbId: number;
  title: string;
  year: number | null;
  season: number;
  episode: number;
  name?: string | null;
  indexerIds?: number[];
  notify?: boolean;
}
export interface DownloadJobData {
  downloadId: string;
  seasonGrab?: SeasonGrabData;
  episodeGrab?: EpisodeGrabData;
}

export interface ProgressEvent {
  type: "progress" | "status" | "created" | "deleted";
  downloadId: string;
  status?: DownloadStatus;
  progress?: number;
  dlSpeed?: number;
  upSpeed?: number;
  etaSeconds?: number | null;
  seeders?: number | null;
  message?: string;
}

export interface ActivityEntry {
  id: string;
  at: string; // ISO timestamp
  message: string;
  kind?: string; // search | queue | download | upload | done | warn | switch | info
  title?: string;
}

/* ------------------------------------------------------------------ *
 * Serialized download (BigInt -> number) for API responses            *
 * ------------------------------------------------------------------ */

export interface DownloadDTO {
  id: string;
  title: string;
  releaseName: string;
  kind: MediaKind;
  year: number | null;
  season: number | null;
  episode: number | null;
  status: DownloadStatus;
  progress: number;
  sizeBytes: number;
  downloadedBytes: number;
  dlSpeed: number;
  upSpeed: number;
  seeders: number | null;
  etaSeconds: number | null;
  indexer: string | null;
  s3Bucket: string | null;
  s3Key: string | null;
  posterUrl: string | null;
  overview: string | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
}
