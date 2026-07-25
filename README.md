# MovieHub — AI Media Deck

A self-hosted, AI-driven media downloader with S3 archiving, built to run on
[Coolify](https://coolify.io) (or any Docker host). Describe what you want in
plain language — the AI plans the search, ranks releases across your indexers,
picks the best one (rejecting CAMs/fakes), downloads it via qBittorrent, then
organizes and uploads it to your S3-compatible storage.

> **Legal note.** BitTorrent + S3 is legitimate infrastructure (Linux ISOs, the
> Internet Archive, Creative Commons, public-domain media, your own backups).
> This software is a general-purpose tool — you are responsible for only using it
> to download content you have the legal right to obtain.

---

## What it does

- **Natural-language search** — "Dune Part Two in 4K" or "The Office US season 3
  1080p" → the AI resolves title/year/quality and builds the indexer query.
- **Smart release selection** — a deterministic scorer (seeders, quality, size,
  trusted groups) plus an AI tiebreak choose the best release and flag
  CAMs/fakes/mislabels.
- **Auto-organize & rename** — finished files are cleaned and sorted into
  `Movies/…`, `TV/Show/Season NN/…` prefixes in your bucket, with TMDB posters.
- **Chat / agent mode** — conversational; can queue batches ("all of season 2").
- **Live everything** — realtime download/upload progress over SSE.

## Architecture

```
Browser ── Next.js (UI + API) ──┬── Moonshot (Kimi)  reasoning: NL plan, ranking
   ▲  SSE progress              └── MiMo             classification: organize
   │
   ├── Prowlarr  (search across your indexers)
   ├── Redis     (BullMQ job queue + progress pub/sub)
   ├── Postgres  (downloads + encrypted config)
   │
Worker ── qBittorrent (download) ── organize + enrich ── multipart upload ─▶ S3
```

Two processes from one image: **web** (`pnpm start`) and **worker**
(`pnpm worker`). AI providers are OpenAI-compatible and swappable per task.

| Layer      | Choice                                             |
|------------|----------------------------------------------------|
| Framework  | Next.js 15 (App Router), TypeScript, Tailwind v4   |
| Torrents   | qBittorrent (Web API) + Prowlarr (Torznab)         |
| Queue      | BullMQ + Redis                                      |
| Database   | PostgreSQL + Prisma                                 |
| AI         | Moonshot (Kimi) + Xiaomi MiMo via the `openai` SDK |
| Storage    | Any S3-compatible endpoint (Contabo by default)    |

---

## Deploy on Coolify

1. **New Resource → Docker Compose**, and point it at this repository (it reads
   `docker-compose.yml` directly).
2. **Set environment variables** (Coolify's Environment tab). At minimum:
   ```
   AUTH_PASSWORD   = a strong password
   AUTH_SECRET     = <openssl rand -hex 32>
   ENCRYPTION_KEY  = <openssl rand -hex 32>
   POSTGRES_PASSWORD = <a strong password>
   ```
   Everything else (AI keys, S3, Prowlarr) can be entered later in the in-app
   **Settings** page. See [`.env.example`](.env.example) for the full list.
3. **Deploy.** Coolify builds the image and starts all six services
   (`web`, `worker`, `qbittorrent`, `prowlarr`, `postgres`, `redis`).
4. Point your domain at the `web` service (port 3000). Coolify handles TLS.
   Keep the origin behind Cloudflare/WAF and only expose the web port publicly.

### First-run configuration

1. **qBittorrent** — grab the temporary admin password:
   ```
   docker compose logs qbittorrent | grep -i "temporary password"
   ```
   Log into qBittorrent (`:8080`), set a permanent password.
2. **Prowlarr** (`:9696`) — add your indexers, then copy
   *Settings → General → API Key*.
3. In MovieHub → **Settings**, fill in and **Save**:
   - Moonshot and/or MiMo API keys
   - qBittorrent URL `http://qbittorrent:8080`, user, password
   - Prowlarr URL `http://prowlarr:9696` + API key
   - Contabo S3 endpoint, region `default`, bucket, access key, secret key
   - (optional) TMDB API key for posters
4. Hit **Test** on each section, then head to **Command** and search.

> Secrets you enter in Settings are encrypted at rest (AES-256-GCM) with
> `ENCRYPTION_KEY`. The API never returns secret values back to the browser.

---

## Local development

```bash
pnpm install
cp .env.example .env          # fill in AUTH_*, ENCRYPTION_KEY, DATABASE_URL, REDIS_URL
# bring up just the datastores + torrent stack:
docker compose up -d postgres redis qbittorrent prowlarr
pnpm db:push                  # sync schema
pnpm dev                      # web on :3000
pnpm worker:dev               # worker (separate terminal)
```

## Configuration precedence

Every setting resolves as **Settings UI (DB, encrypted) → environment variable →
built-in default**. So you can configure entirely via Coolify env vars, entirely
via the UI, or a mix.

## Security

- Single-admin session (signed JWT cookie); every page and API route is behind
  auth middleware. Login + expensive endpoints are rate-limited.
- Strict security headers + CSP, `poweredByHeader: false`, no prod source maps.
- Secrets encrypted at rest; masked in all API responses.
- The origin should sit behind a reverse proxy/WAF; don't expose qBittorrent or
  Prowlarr publicly unless you intend to.

## Project layout

```
src/
  app/              # routes: (app) pages, /login, /api/*
  components/       # UI (command deck, downloads, chat, library, settings)
  lib/
    llm/            # providers (Moonshot/MiMo), planner, ranker, organizer, agent
    indexers/       # Prowlarr client
    torrent/        # qBittorrent client
    storage/        # S3 (Contabo) upload/list/presign
    scoring/        # deterministic release scorer
    service/        # download pipeline (plan → search → rank → queue)
  worker/           # BullMQ worker: download → organize → upload → cleanup
prisma/schema.prisma
docker-compose.yml  # full stack for Coolify
```
