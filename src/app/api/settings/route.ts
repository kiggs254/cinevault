import { NextResponse } from "next/server";
import { getConfig, getMaskedConfig, saveConfig } from "@/lib/config";
import { QbClient } from "@/lib/torrent/qbittorrent";
import { ProwlarrClient } from "@/lib/indexers/prowlarr";
import { bucketReachable, makeS3 } from "@/lib/storage/s3";
import { providerFor } from "@/lib/llm/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_SETTINGS = new Set([
  "moonshotBaseUrl", "moonshotModel", "mimoBaseUrl", "mimoModel",
  "qbitUrl", "qbitUser",
  "prowlarrUrl",
  "s3Endpoint", "s3Region", "s3Bucket", "s3AccessKeyId", "s3PublicUrl",
  "preferredQuality", "minSeeders", "maxSizeGB", "deleteAfterUpload",
]);
const ALLOWED_SECRETS = new Set([
  "moonshotApiKey", "mimoApiKey", "qbitPassword", "prowlarrApiKey", "s3SecretAccessKey", "tmdbApiKey",
]);

export async function GET() {
  const config = await getMaskedConfig();
  return NextResponse.json(config, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (ALLOWED_SECRETS.has(k) || ALLOWED_SETTINGS.has(k)) patch[k] = v;
  }
  if ("minSeeders" in patch) patch.minSeeders = Number(patch.minSeeders) || 0;
  if ("maxSizeGB" in patch) patch.maxSizeGB = Number(patch.maxSizeGB) || 0;
  if ("deleteAfterUpload" in patch) patch.deleteAfterUpload = Boolean(patch.deleteAfterUpload);

  await saveConfig(patch);
  const config = await getMaskedConfig();
  return NextResponse.json(config);
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as { target?: string };
  const cfg = await getConfig();

  try {
    switch (body.target) {
      case "qbit": {
        const version = await new QbClient(cfg.qbit).version();
        return NextResponse.json({ ok: true, message: `qBittorrent ${version}` });
      }
      case "prowlarr": {
        const ok = await new ProwlarrClient(cfg.prowlarr).health();
        return NextResponse.json({ ok, message: ok ? "Prowlarr healthy" : "Prowlarr unhealthy" });
      }
      case "s3": {
        if (!cfg.s3.bucket) throw new Error("Bucket not set");
        const ok = await bucketReachable(makeS3(cfg.s3), cfg.s3.bucket);
        return NextResponse.json({
          ok,
          message: ok ? `Bucket "${cfg.s3.bucket}" reachable` : "Bucket unreachable",
        });
      }
      case "ai": {
        const p = await providerFor("reason");
        await p.client.chat.completions.create({
          model: p.model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 1,
        });
        return NextResponse.json({ ok: true, message: `${p.name} (${p.model}) reachable` });
      }
      default:
        return NextResponse.json({ error: "Unknown target" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 200 });
  }
}
