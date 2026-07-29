import { z } from "zod";

/**
 * Boot-time environment. Required values (DATABASE_URL, REDIS_URL, secrets) must
 * be present at runtime. Provider/storage values are optional here because they
 * can also be set at runtime via the Settings UI (stored, encrypted, in the DB).
 *
 * Validation is lazy (see the Proxy below) so `next build` — which imports route
 * modules without a full runtime env — does not crash.
 */
const schema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  // Public trackers appended to new torrents (newline/comma separated). Omit for
  // the built-in list; set to "none" to disable.
  EXTRA_TRACKERS: z.string().optional(),

  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  REDIS_URL: z.string().min(1, "REDIS_URL is required"),

  // Auth + secret handling
  AUTH_PASSWORD: z.string().min(1, "AUTH_PASSWORD is required (admin login password)"),
  ADMIN_USERNAME: z.string().optional(), // bootstrap admin username (default "admin")
  AUTH_SECRET: z.string().min(16, "AUTH_SECRET must be at least 16 characters"),
  ENCRYPTION_KEY: z
    .string()
    .min(16, "ENCRYPTION_KEY is required (recommend 32 random bytes, hex or base64)"),

  // Local staging directory shared with the qBittorrent container via a volume.
  DOWNLOAD_DIR: z.string().default("/data/downloads"),
  DELETE_AFTER_UPLOAD: z.string().optional(),

  // AI providers (OpenAI-compatible) — optional at boot, overridable in Settings.
  MOONSHOT_API_KEY: z.string().optional(),
  MOONSHOT_BASE_URL: z.string().optional(),
  MOONSHOT_MODEL: z.string().optional(),
  MIMO_API_KEY: z.string().optional(),
  MIMO_BASE_URL: z.string().optional(),
  MIMO_MODEL: z.string().optional(),

  // Torrent engine
  QBITTORRENT_URL: z.string().optional(),
  QBITTORRENT_USER: z.string().optional(),
  QBITTORRENT_PASSWORD: z.string().optional(),

  // Indexer aggregator
  PROWLARR_URL: z.string().optional(),
  PROWLARR_API_KEY: z.string().optional(),

  // S3-compatible object storage (Contabo by default)
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  S3_PUBLIC_URL: z.string().optional(),
  S3_BASE_PREFIX: z.string().optional(),

  // Optional metadata enrichment
  TMDB_API_KEY: z.string().optional(),

  // Jellyfin (media server) — read watch history for taste + retention
  JELLYFIN_URL: z.string().optional(), // internal, e.g. http://jellyfin:8096
  JELLYFIN_PUBLIC_URL: z.string().optional(), // browser-facing, e.g. https://jellyfin.kiggs.co.ke
  JELLYFIN_API_KEY: z.string().optional(),
  JELLYFIN_USER_ID: z.string().optional(),

  // Telegram bot — two-way agent chat + push notifications
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  TELEGRAM_ALLOWED_IDS: z.string().optional(),
  TORBOX_API_KEY: z.string().optional(),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

function load(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

/** Lazily-validated env. Access a property to trigger validation at runtime. */
export const env = new Proxy({} as Env, {
  get(_target, prop: string) {
    if (!cached) cached = load();
    return cached[prop as keyof Env];
  },
});

export function boolEnv(value: string | undefined, fallback = false): boolean {
  if (value === undefined) return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}
