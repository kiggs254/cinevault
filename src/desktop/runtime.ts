import "dotenv/config";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import next from "next";
import { startEmbeddedPostgres, desktopDataDir } from "../lib/runtime/local-db";

/**
 * Single-process desktop runtime. Runs EVERYTHING the home edition needs in ONE
 * Node process — so the in-process queue + event bus are shared between the web
 * server and the worker:
 *   1. start embedded Postgres → DATABASE_URL
 *   2. apply the Prisma schema (idempotent `db push`)
 *   3. start the Next.js server (production) on localhost
 *   4. import the worker (registers the in-process queue + scheduled jobs)
 *
 * Electron's main process forks this and, on the `ready` message, points a window
 * at the returned URL. The cloud edition never uses this file.
 */

const PORT = Number(process.env.PORT ?? 34580);
const APP_DIR = process.env.CINEVAULT_APP_DIR ?? process.cwd();

/** Apply the schema to the embedded DB using Prisma's own `db push` (idempotent). */
function applySchema(databaseUrl: string): void {
  const prismaBin = path.join(APP_DIR, "node_modules", "prisma", "build", "index.js");
  if (!fs.existsSync(prismaBin)) {
    console.error("[desktop] prisma CLI not found at", prismaBin, "- schema not applied");
    return;
  }
  const r = spawnSync(
    process.execPath,
    [prismaBin, "db", "push", "--skip-generate", "--accept-data-loss"],
    {
      cwd: APP_DIR,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
        // Electron sets ELECTRON_RUN_AS_NODE so process.execPath behaves as node.
        ELECTRON_RUN_AS_NODE: "1",
      },
      stdio: "inherit",
    },
  );
  if (r.status !== 0) console.error("[desktop] prisma db push exited with", r.status);
}

async function main(): Promise<void> {
  fs.mkdirSync(desktopDataDir(), { recursive: true });

  // 1) Embedded Postgres.
  const db = await startEmbeddedPostgres();
  process.env.DATABASE_URL = db.url;
  process.env.CINEVAULT_DESKTOP = "1";
  process.env.STORAGE_BACKEND = "local";
  // NODE_ENV=production is set by the Electron parent when it forks this runtime.
  process.env.APP_URL = process.env.APP_URL ?? `http://127.0.0.1:${PORT}`;
  // Unused on desktop (in-process queue/events) but env schema wants a value.
  process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

  // 2) Schema.
  applySchema(db.url);

  // 3) Next.js (production, programmatic — same process as the worker).
  const app = next({ dev: false, dir: APP_DIR });
  await app.prepare();
  const handler = app.getRequestHandler();
  const server = http.createServer((req, res) => handler(req, res));
  await new Promise<void>((resolve) => server.listen(PORT, "127.0.0.1", () => resolve()));
  const url = `http://127.0.0.1:${PORT}`;
  console.log(`[desktop] web ready on ${url}`);

  // 4) Worker (registers in-process queue workers + scheduled jobs on import).
  await import("../worker/index");

  if (process.send) process.send({ type: "ready", url });

  const shutdown = async () => {
    try {
      await db.stop();
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
  process.on("message", (m: unknown) => {
    if (m && typeof m === "object" && (m as { type?: string }).type === "shutdown") void shutdown();
  });
}

main().catch((e) => {
  console.error("[desktop] fatal:", e);
  process.exit(1);
});
