import { NextResponse } from "next/server";
import { getConfig, getMaskedConfig, saveConfig } from "@/lib/config";
import { QbClient } from "@/lib/torrent/qbittorrent";
import { ProwlarrClient } from "@/lib/indexers/prowlarr";
import { bucketReachable, makeS3 } from "@/lib/storage/s3";
import { providerFor } from "@/lib/llm/providers";
import { tgApi, sendMessage } from "@/lib/telegram/client";
import { getSessionUser, isAdmin } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_SETTINGS = new Set([
  "aiPrimary",
  "moonshotBaseUrl", "moonshotModel", "mimoBaseUrl", "mimoModel",
  "qbitUrl", "qbitUser",
  "prowlarrUrl",
  "s3Endpoint", "s3Region", "s3Bucket", "s3AccessKeyId", "s3PublicUrl", "s3BasePrefix",
  "preferredQuality", "minSeeders", "maxSizeGB", "deleteAfterUpload",
  "jellyfinUrl", "jellyfinPublicUrl", "jellyfinUserId", "telegramChatId", "telegramAllowedIds",
  "autoDeleteWatched", "retentionDays", "autoDeleteIdle", "idleDays", "autoFollowFromJellyfin",
  "registrationEnabled", "registrationCode",
]);
const ALLOWED_SECRETS = new Set([
  "moonshotApiKey", "mimoApiKey", "qbitPassword", "prowlarrApiKey", "s3SecretAccessKey", "tmdbApiKey",
  "jellyfinApiKey", "telegramBotToken", "torboxApiKey",
]);

/** Settings are admin-only. */
async function guardAdmin(): Promise<NextResponse | null> {
  const user = await getSessionUser();
  if (!isAdmin(user)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  return null;
}

export async function GET() {
  const denied = await guardAdmin();
  if (denied) return denied;
  const config = await getMaskedConfig();
  return NextResponse.json(config, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(req: Request) {
  const denied = await guardAdmin();
  if (denied) return denied;
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (ALLOWED_SECRETS.has(k) || ALLOWED_SETTINGS.has(k)) patch[k] = v;
  }
  if ("minSeeders" in patch) patch.minSeeders = Number(patch.minSeeders) || 0;
  if ("maxSizeGB" in patch) patch.maxSizeGB = Number(patch.maxSizeGB) || 0;
  if ("deleteAfterUpload" in patch) patch.deleteAfterUpload = Boolean(patch.deleteAfterUpload);
  if ("autoDeleteWatched" in patch) patch.autoDeleteWatched = Boolean(patch.autoDeleteWatched);
  if ("autoFollowFromJellyfin" in patch) patch.autoFollowFromJellyfin = Boolean(patch.autoFollowFromJellyfin);
  if ("registrationEnabled" in patch) patch.registrationEnabled = Boolean(patch.registrationEnabled);
  if ("retentionDays" in patch) patch.retentionDays = Math.max(1, Number(patch.retentionDays) || 30);
  if ("autoDeleteIdle" in patch) patch.autoDeleteIdle = Boolean(patch.autoDeleteIdle);
  if ("idleDays" in patch) patch.idleDays = Math.max(1, Number(patch.idleDays) || 15);

  await saveConfig(patch);
  const config = await getMaskedConfig();
  return NextResponse.json(config);
}

export async function POST(req: Request) {
  const denied = await guardAdmin();
  if (denied) return denied;
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
      case "jellyfin": {
        if (!cfg.jellyfin.url || !cfg.jellyfin.apiKey) throw new Error("Jellyfin URL + API key required");
        const base = cfg.jellyfin.url.replace(/\/+$/, "");
        const res = await fetch(`${base}/System/Info?api_key=${cfg.jellyfin.apiKey}`);
        if (!res.ok) throw new Error(`Jellyfin returned ${res.status}`);
        const info = (await res.json()) as { Version?: string; ServerName?: string };
        return NextResponse.json({ ok: true, message: `${info.ServerName ?? "Jellyfin"} ${info.Version ?? ""}`.trim() });
      }
      case "telegram": {
        if (!cfg.telegram.botToken) throw new Error("Bot token required");
        const me = await tgApi<{ username?: string }>(cfg.telegram.botToken, "getMe");
        if (!me) throw new Error("Invalid bot token");
        if (cfg.telegram.chatId) {
          await sendMessage(cfg.telegram.botToken, cfg.telegram.chatId, "✅ Cinevault is connected to this chat.");
        }
        return NextResponse.json({
          ok: true,
          message: `Bot @${me.username}${cfg.telegram.chatId ? " — test message sent" : " — now message the bot to link your chat"}`,
        });
      }
      default:
        return NextResponse.json({ error: "Unknown target" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 200 });
  }
}
