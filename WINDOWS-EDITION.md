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
| Database | Postgres | **SQLite** (file in `%APPDATA%\Cinevault`) |
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
- [ ] **Phase 2 — SQLite.** Prisma `provider = "sqlite"`; a `schema.sqlite.prisma`
  or provider switch; migrate JSON/enum usages that differ from Postgres; data dir
  under `%APPDATA%`. Removes the Postgres service.
- [ ] **Phase 3 — In-process queue.** Replace BullMQ/Redis with an in-process
  queue (concurrency-limited, persisted in SQLite, resumed on launch via the
  existing `recoverInterrupted`). Removes the Redis service.
- [ ] **Phase 4 — TorBox-only download path.** Drop the qBittorrent/Prowlarr/
  FlareSolverr dependency for this edition: search (TorBox search or a bundled
  Torznab set) → TorBox → local folder. One API key.
- [ ] **Phase 5 — Electron shell + installer.** Wrap the Next.js server + worker
  in an Electron main process; tray/desktop icon; auto-open the UI; `electron-builder`
  Windows target (NSIS `.exe`). First-run wizard (folder picker + keys).
- [ ] **Phase 6 — Polish.** Auto-update, bundled FFmpeg if needed, a plain-English
  README with screenshots.

## Notes
- Keep the S3 path working at every step (both editions share the code).
- Local layout mirrors the cloud one minus the bucket prefix: `MEDIA_DIR/Movies/…`,
  `MEDIA_DIR/TV/…` — so pointing Jellyfin/VLC at the folder "just works".
