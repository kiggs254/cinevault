/**
 * Map the download lifecycle (search → download → upload) onto a SINGLE 0-100
 * bar that only ever moves forward — so the UI never shows "reaches 100 then
 * restarts" as it flips from downloading to uploading.
 *
 *   queued      →  2
 *   searching   →  6
 *   downloading →  8–90   (the bulk of the work)
 *   uploading   → 90–99
 *   completed   → 100
 */
export function overallProgress(status: string, progress: number): number {
  const p = Math.max(0, Math.min(100, Number.isFinite(progress) ? progress : 0));
  switch (status) {
    case "QUEUED":
      return 2;
    case "SEARCHING":
      return 6;
    case "DOWNLOADING":
      return Math.min(90, 8 + p * 0.82);
    case "UPLOADING":
      return Math.min(99, 90 + p * 0.1);
    case "COMPLETED":
      return 100;
    case "FAILED":
    case "CANCELLED":
      return 0;
    default:
      return p;
  }
}

/** A friendly phase label for the current status. */
export function phaseLabel(status: string): string {
  switch (status) {
    case "QUEUED":
      return "Queued";
    case "SEARCHING":
      return "Finding a source";
    case "DOWNLOADING":
      return "Adding";
    case "UPLOADING":
      return "Finishing up";
    case "COMPLETED":
      return "Ready to watch";
    case "FAILED":
      return "Failed";
    case "CANCELLED":
      return "Cancelled";
    default:
      return status;
  }
}
