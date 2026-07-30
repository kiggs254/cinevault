import { Prisma } from "@prisma/client";
import { prisma } from "./db";
import { boolEnv, env } from "./env";
import { encrypt, safeDecrypt } from "./crypto";
import type { TasteProfile } from "./types";

/** Fully-resolved runtime configuration (DB overrides env defaults). */
export interface ResolvedConfig {
  ai: {
    moonshot: { apiKey?: string; baseUrl: string; model: string };
    mimo: { apiKey?: string; baseUrl: string; model: string };
    primary: "auto" | "moonshot" | "mimo";
  };
  qbit: { url?: string; user?: string; password?: string };
  prowlarr: { url?: string; apiKey?: string };
  s3: {
    endpoint?: string;
    region: string;
    bucket?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    publicUrl?: string;
    basePrefix: string;
  };
  tmdb: { apiKey?: string };
  prefs: {
    preferredQuality: string;
    minSeeders: number;
    maxSizeGB: number;
    deleteAfterUpload: boolean;
    downloadDir: string;
  };
  profile: {
    interests: string[];
    autoGrabEnabled: boolean;
    autoGrabThreshold: number;
    legalIndexerIds: number[];
  };
  jellyfin: { url?: string; publicUrl?: string; apiKey?: string; userId?: string };
  telegram: { botToken?: string; chatId?: string; allowedIds: string[] };
  torbox: { apiKey?: string };
  appUrl: string; // public base URL of this app (for deep-link CTAs)
  retention: { autoDeleteWatched: boolean; days: number };
  discovery: { autoFollowFromJellyfin: boolean };
  registration: { enabled: boolean; code?: string }; // public /register gate
  webPush: { publicKey?: string; privateKey?: string; subject: string }; // VAPID (self-generated)
  tasteProfile: TasteProfile | null;
}

/** Keys that must be encrypted at rest. */
const SECRET_KEYS = [
  "moonshotApiKey",
  "mimoApiKey",
  "qbitPassword",
  "prowlarrApiKey",
  "s3SecretAccessKey",
  "tmdbApiKey",
  "jellyfinApiKey",
  "telegramBotToken",
  "torboxApiKey",
  "vapidPrivateKey",
] as const;
type SecretKey = (typeof SECRET_KEYS)[number];

type Settings = Record<string, unknown>;
type Secrets = Partial<Record<SecretKey, string>>;

async function readRow() {
  const row = await prisma.appConfig.findUnique({ where: { id: "singleton" } });
  const settings = (row?.settings as Settings | null) ?? {};
  const secrets = (row?.secrets as Secrets | null) ?? {};
  return { settings, secrets };
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}
function num(v: unknown, fallback: number): number {
  return typeof v === "number" && !Number.isNaN(v) ? v : fallback;
}
/** Parse a comma/space/newline-separated list of Telegram chat IDs (dedup, numeric only). */
function parseIds(raw: string | undefined): string[] {
  if (!raw) return [];
  return Array.from(
    new Set(
      raw
        .split(/[\s,]+/)
        .map((s) => s.trim())
        .filter((s) => /^-?\d+$/.test(s)),
    ),
  );
}

/** Resolve the effective config used by every integration. */
export async function getConfig(): Promise<ResolvedConfig> {
  const { settings, secrets } = await readRow();
  const dec = (k: SecretKey) => safeDecrypt(secrets[k]);

  return {
    ai: {
      moonshot: {
        apiKey: dec("moonshotApiKey") ?? env.MOONSHOT_API_KEY,
        baseUrl:
          str(settings.moonshotBaseUrl) ??
          env.MOONSHOT_BASE_URL ??
          "https://api.moonshot.ai/v1",
        model: str(settings.moonshotModel) ?? env.MOONSHOT_MODEL ?? "kimi-k2.5",
      },
      mimo: {
        apiKey: dec("mimoApiKey") ?? env.MIMO_API_KEY,
        baseUrl:
          str(settings.mimoBaseUrl) ??
          env.MIMO_BASE_URL ??
          "https://api.xiaomimimo.com/v1",
        model: str(settings.mimoModel) ?? env.MIMO_MODEL ?? "mimo-v2.5-pro",
      },
      primary: ["auto", "moonshot", "mimo"].includes(String(settings.aiPrimary))
        ? (settings.aiPrimary as "auto" | "moonshot" | "mimo")
        : "auto",
    },
    qbit: {
      url: str(settings.qbitUrl) ?? env.QBITTORRENT_URL,
      user: str(settings.qbitUser) ?? env.QBITTORRENT_USER,
      password: dec("qbitPassword") ?? env.QBITTORRENT_PASSWORD,
    },
    prowlarr: {
      url: str(settings.prowlarrUrl) ?? env.PROWLARR_URL,
      apiKey: dec("prowlarrApiKey") ?? env.PROWLARR_API_KEY,
    },
    s3: {
      endpoint: str(settings.s3Endpoint) ?? env.S3_ENDPOINT,
      region: str(settings.s3Region) ?? env.S3_REGION ?? "default",
      bucket: str(settings.s3Bucket) ?? env.S3_BUCKET,
      accessKeyId: str(settings.s3AccessKeyId) ?? env.S3_ACCESS_KEY_ID,
      secretAccessKey: dec("s3SecretAccessKey") ?? env.S3_SECRET_ACCESS_KEY,
      publicUrl: str(settings.s3PublicUrl) ?? env.S3_PUBLIC_URL,
      basePrefix: str(settings.s3BasePrefix) ?? env.S3_BASE_PREFIX ?? "moviehub",
    },
    tmdb: { apiKey: dec("tmdbApiKey") ?? env.TMDB_API_KEY },
    prefs: {
      preferredQuality: str(settings.preferredQuality) ?? "1080p",
      minSeeders: num(settings.minSeeders, 3),
      maxSizeGB: num(settings.maxSizeGB, 25),
      deleteAfterUpload:
        typeof settings.deleteAfterUpload === "boolean"
          ? settings.deleteAfterUpload
          : boolEnv(env.DELETE_AFTER_UPLOAD, true),
      downloadDir: env.DOWNLOAD_DIR,
    },
    profile: {
      interests: Array.isArray(settings.interests)
        ? (settings.interests as unknown[]).filter((x): x is string => typeof x === "string")
        : [],
      autoGrabEnabled: settings.autoGrabEnabled === true,
      autoGrabThreshold: num(settings.autoGrabThreshold, 80),
      legalIndexerIds: Array.isArray(settings.legalIndexerIds)
        ? (settings.legalIndexerIds as unknown[]).map(Number).filter((n) => !Number.isNaN(n))
        : [],
    },
    jellyfin: {
      url: str(settings.jellyfinUrl) ?? env.JELLYFIN_URL,
      publicUrl: str(settings.jellyfinPublicUrl) ?? env.JELLYFIN_PUBLIC_URL,
      apiKey: dec("jellyfinApiKey") ?? env.JELLYFIN_API_KEY,
      userId: str(settings.jellyfinUserId) ?? env.JELLYFIN_USER_ID,
    },
    telegram: {
      botToken: dec("telegramBotToken") ?? env.TELEGRAM_BOT_TOKEN,
      chatId: str(settings.telegramChatId) ?? env.TELEGRAM_CHAT_ID,
      allowedIds: parseIds(str(settings.telegramAllowedIds) ?? env.TELEGRAM_ALLOWED_IDS),
    },
    torbox: { apiKey: dec("torboxApiKey") ?? env.TORBOX_API_KEY },
    appUrl: str(settings.appUrl) ?? env.APP_URL,
    retention: {
      autoDeleteWatched: settings.autoDeleteWatched === true,
      days: num(settings.retentionDays, 30),
    },
    discovery: {
      autoFollowFromJellyfin: settings.autoFollowFromJellyfin !== false, // default on
    },
    registration: {
      enabled: settings.registrationEnabled !== false, // default on
      code: str(settings.registrationCode),
    },
    webPush: {
      publicKey: str(settings.vapidPublicKey) ?? env.VAPID_PUBLIC_KEY,
      privateKey: dec("vapidPrivateKey") ?? env.VAPID_PRIVATE_KEY,
      subject: str(settings.vapidSubject) ?? env.VAPID_SUBJECT ?? "mailto:notify@cinevault.app",
    },
    tasteProfile: (settings.tasteProfile as TasteProfile | undefined) ?? null,
  };
}

/**
 * What the Settings UI receives: non-secret settings verbatim, plus a
 * `secretsSet` map of booleans. Secret VALUES are never returned.
 */
export async function getMaskedConfig() {
  const { settings, secrets } = await readRow();
  const envSecretPresent: Record<SecretKey, boolean> = {
    moonshotApiKey: !!env.MOONSHOT_API_KEY,
    mimoApiKey: !!env.MIMO_API_KEY,
    qbitPassword: !!env.QBITTORRENT_PASSWORD,
    prowlarrApiKey: !!env.PROWLARR_API_KEY,
    s3SecretAccessKey: !!env.S3_SECRET_ACCESS_KEY,
    tmdbApiKey: !!env.TMDB_API_KEY,
    jellyfinApiKey: !!env.JELLYFIN_API_KEY,
    telegramBotToken: !!env.TELEGRAM_BOT_TOKEN,
    torboxApiKey: !!env.TORBOX_API_KEY,
    vapidPrivateKey: !!env.VAPID_PRIVATE_KEY,
  };
  const secretsSet = Object.fromEntries(
    SECRET_KEYS.map((k) => [k, !!secrets[k] || envSecretPresent[k]]),
  ) as Record<SecretKey, boolean>;

  return { settings, secretsSet };
}

/**
 * Persist a settings patch. Secret fields are encrypted; empty secret values
 * are ignored (so the UI can submit blanks without wiping stored secrets).
 */
export async function saveConfig(patch: Record<string, unknown>): Promise<void> {
  const { settings, secrets } = await readRow();

  const nextSecrets: Secrets = { ...secrets };
  const nextSettings: Settings = { ...settings };

  for (const [k, v] of Object.entries(patch)) {
    if ((SECRET_KEYS as readonly string[]).includes(k)) {
      if (typeof v === "string" && v.trim().length > 0) {
        nextSecrets[k as SecretKey] = encrypt(v.trim());
      }
      continue;
    }
    nextSettings[k] = v;
  }

  const settingsJson = nextSettings as unknown as Prisma.InputJsonValue;
  const secretsJson = nextSecrets as unknown as Prisma.InputJsonValue;
  await prisma.appConfig.upsert({
    where: { id: "singleton" },
    create: { id: "singleton", settings: settingsJson, secrets: secretsJson },
    update: { settings: settingsJson, secrets: secretsJson },
  });
}
