import path from "node:path";
import os from "node:os";
import fs from "node:fs";

export interface LocalDbHandle {
  /** DATABASE_URL to point Prisma at. */
  url: string;
  /** Graceful shutdown — call on app quit. */
  stop: () => Promise<void>;
}

/** Root dir for all desktop data (DB, media cache, etc.). */
export function desktopDataDir(): string {
  return (
    process.env.CINEVAULT_DATA_DIR ??
    path.join(process.env.APPDATA ?? path.join(os.homedir(), ".local", "share"), "Cinevault")
  );
}

/**
 * Start an embedded Postgres for the desktop/home edition — a real Postgres run
 * from a bundled binary, so there's no Docker and nothing for the user to install.
 * Data persists under `dataDir`; the DB is created on first run. Returns the
 * DATABASE_URL for Prisma plus a `stop()` for graceful shutdown.
 *
 * Only invoked by the desktop shell (Electron). The cloud edition never calls this
 * and connects to a managed Postgres via `DATABASE_URL` as before.
 */
export async function startEmbeddedPostgres(opts?: {
  dataDir?: string;
  port?: number;
  password?: string;
}): Promise<LocalDbHandle> {
  // Dynamic import: the package (and its platform binary) ship only in the desktop
  // build, so the cloud bundle never needs it.
  const { default: EmbeddedPostgres } = await import("embedded-postgres");

  const dataDir = opts?.dataDir ?? path.join(desktopDataDir(), "pgdata");
  const port = opts?.port ?? 54329;
  const user = "cinevault";
  const password = opts?.password ?? "cinevault-local";

  await fs.promises.mkdir(dataDir, { recursive: true });
  const fresh = !fs.existsSync(path.join(dataDir, "PG_VERSION"));

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user,
    password,
    port,
    persistent: true,
    onError: (e) => console.error("[embedded-pg]", e.message),
  });

  if (fresh) await pg.initialise();
  await pg.start();
  if (fresh) await pg.createDatabase("moviehub").catch(() => {});

  const url = `postgresql://${user}:${encodeURIComponent(password)}@127.0.0.1:${port}/moviehub`;
  return { url, stop: () => pg.stop() };
}
