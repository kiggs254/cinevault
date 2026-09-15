# Cinevault — Home Edition (Windows, single installer, no Docker)

Goal: a non-technical person installs **one `.exe`**, picks a folder, pastes a
couple of keys, and the app downloads media **to that local folder** — no Docker,
no cloud/S3, no separate services to install.

This is a branch (`windows-local-edition`) — it does **not** change the
cloud/self-hosted build on `main`. Both share one codebase; the differences are
selected at runtime by config.

## Target architecture

| Concern | Cloud edition (main) | Home edition (this branch) |
|---|---|---|
| Shell | Docker Compose (7 services) | **Electron** → one Windows installer |
| Database | Postgres | **embedded Postgres** (bundled binary, `%APPDATA%\Cinevault\pgdata`) |
| Job queue | Redis + BullMQ | **in-process queue** (persisted in SQLite) |
| Download | TorBox → S3, or qBittorrent → S3 | **TorBox → local folder** (no qBit/Prowlarr/FlareSolverr) |
| Search | Prowlarr | TorBox search, or a small built-in Torznab set |
| Storage | S3 (iDrive) | **local folder** (`MEDIA_DIR`) |
| Playback | Jellyfin (rclone mount) + presigned S3 | app's built-in player via `/api/media/*` (Jellyfin optional) |
| Setup | env + Coolify | first-run wizard: pick folder + paste TMDB + TorBox keys |

Runtime selector: `STORAGE_BACKEND=local` + `MEDIA_DIR=<folder>` (see `src/lib/env.ts`).

## Phases

- [x] **Phase 1 — Local-storage engine.** `StorageBackend` abstraction
  (`src/lib/storage/index.ts`) with S3 + Local backends chosen by
  `cfg.storage.backend`. Local backend writes/reads/deletes/lists a folder and
  streams TorBox bodies straight to disk. All call sites (worker, downloads,
  retention, follows, library API, settings) go through it. Local playback route
  `/api/media/[...key]` with HTTP range support. S3 path unchanged. ✅
- [x] **Phase 2 — DB without Docker (embedded Postgres).** Decided against SQLite
  (the schema is enum/`Json`/`@db.Text`-heavy → a risky port plus two schemas to keep
  in sync) and against PGlite (no maintained Prisma adapter). Instead the desktop
  shell spawns a real Postgres from a **bundled binary** (`embedded-postgres` +
  `@embedded-postgres/windows-x64`) — **zero schema/code changes, identical to
  cloud**. `src/lib/runtime/local-db.ts` initialises it, creates the DB on first run,
  and returns `DATABASE_URL`; data persists under `%APPDATA%\Cinevault\pgdata`. An
  ambient type (`src/types/embedded-postgres.d.ts`) lets it typecheck here without
  installing the platform binary — that's added in the Phase 5 build. Wired into the
  shell in Phase 5. ✅
- [~] **Phase 3 — Drop Redis (single-process runtime).**
  - [x] Realtime event bus: `src/lib/events.ts` now uses an in-process EventEmitter
    when `CINEVAULT_DESKTOP=1` (else Redis pub/sub) — SSE progress works with no Redis.
  - [ ] Job queue: replace BullMQ (`src/lib/queue.ts` + the two `Worker`s in
    `src/worker/index.ts`) with a pluggable queue — BullMQ backend for cloud, an
    in-process concurrency-limited backend for desktop (repeatables via timers;
    pending downloads re-derived on launch by the existing `recoverInterrupted`).
- [ ] **Phase 4 — TorBox-only download path.** Drop the qBittorrent/Prowlarr/
  FlareSolverr dependency for this edition: search (TorBox search or a bundled
  Torznab set) → TorBox → local folder. One API key.
- [ ] **Phase 5 — Electron shell + installer.** Wrap the Next.js server + worker
  in an Electron main process; tray/desktop icon; auto-open the UI; `electron-builder`
  Windows target (NSIS `.exe`). First-run wizard (folder picker + keys).
- [ ] **Phase 6 — Polish.** Auto-update, bundled FFmpeg if needed, a plain-English
  README with screenshots.

## Desktop-only build dependencies (added in Phase 5, kept out of the main install)
- `embedded-postgres` + `@embedded-postgres/windows-x64` — the bundled DB.
- `electron`, `electron-builder` — the shell + Windows installer.
- (Phase 3/4 may add an in-process queue lib and drop `bullmq`/`ioredis` for this build.)

These stay out of the cloud install so `main` isn't bloated; the Windows build adds
them. Runtime code that needs them uses dynamic `import()` + an ambient type shim so
the shared codebase still typechecks/builds without them.

## Notes
- Keep the S3 path working at every step (both editions share the code).
- Local layout mirrors the cloud one minus the bucket prefix: `MEDIA_DIR/Movies/…`,
  `MEDIA_DIR/TV/…` — so pointing Jellyfin/VLC at the folder "just works".
