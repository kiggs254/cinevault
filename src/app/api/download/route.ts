import { NextResponse } from "next/server";
import {
  createDownload,
  listDownloads,
  startFromQuery,
  type CreateDownloadInput,
} from "@/lib/service/downloads";
import type { MediaKind } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const downloads = await listDownloads();
  return NextResponse.json({ downloads }, { headers: { "Cache-Control": "no-store" } });
}

interface DownloadBody {
  title?: string;
  magnetUrl?: string;
  downloadUrl?: string;
  infoHash?: string;
  indexer?: string;
  size?: number;
  seeders?: number;
  query?: string;
  auto?: boolean;
  plan?: {
    kind?: MediaKind;
    title?: string;
    year?: number | null;
    season?: number | null;
    episode?: number | null;
  };
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as DownloadBody;

  try {
    // Auto mode: pick the best release for a natural-language query.
    if (body.auto && body.query) {
      const { download, decision } = await startFromQuery(body.query.trim());
      if (!download) {
        return NextResponse.json(
          { error: `No suitable release found. ${decision.reason}` },
          { status: 404 },
        );
      }
      return NextResponse.json({ download });
    }

    // Manual mode: a specific chosen release from the search UI.
    const source = body.magnetUrl || body.downloadUrl;
    if (!source || !body.title) {
      return NextResponse.json(
        { error: "A release (title + magnet/torrent URL) or {auto, query} is required" },
        { status: 400 },
      );
    }

    const input: CreateDownloadInput = {
      releaseName: body.title,
      source,
      infoHash: body.infoHash ?? null,
      indexer: body.indexer ?? null,
      size: body.size,
      seeders: body.seeders ?? null,
      kind: body.plan?.kind,
      title: body.plan?.title,
      year: body.plan?.year ?? null,
      season: body.plan?.season ?? null,
      episode: body.plan?.episode ?? null,
      query: body.query ?? null,
    };
    const download = await createDownload(input);
    return NextResponse.json({ download });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
