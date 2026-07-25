import type { Download } from "@prisma/client";
import type { DownloadDTO, DownloadStatus, MediaKind } from "./types";

/** Convert a Prisma Download (with BigInt fields) to a JSON-safe DTO. */
export function toDTO(d: Download): DownloadDTO {
  return {
    id: d.id,
    title: d.title,
    releaseName: d.releaseName,
    kind: d.kind as MediaKind,
    year: d.year,
    season: d.season,
    episode: d.episode,
    status: d.status as DownloadStatus,
    progress: d.progress,
    sizeBytes: Number(d.sizeBytes),
    downloadedBytes: Number(d.downloadedBytes),
    dlSpeed: d.dlSpeed,
    upSpeed: d.upSpeed,
    seeders: d.seeders,
    etaSeconds: d.etaSeconds,
    indexer: d.indexer,
    s3Bucket: d.s3Bucket,
    s3Key: d.s3Key,
    posterUrl: d.posterUrl,
    overview: d.overview,
    error: d.error,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    completedAt: d.completedAt ? d.completedAt.toISOString() : null,
  };
}
