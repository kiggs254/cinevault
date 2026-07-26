# Cinevault — your AI-curated film & TV vault

A self-hosted, AI-driven media app: **ask for something in plain language and it
finds, grabs, organizes, and archives it to your own S3 storage** — then serves it
back as a Netflix-style library you can browse, follow, and stream (via Jellyfin).
Built to run on [Coolify](https://coolify.io) or any Docker host.

> **Legal note.** BitTorrent + S3 is legitimate infrastructure (Linux ISOs, the
> Internet Archive, Creative Commons, public-domain media, your own backups). This
> software is a general-purpose tool — you are responsible for only using it to
> obtain content you have the legal right to.

---

## Searching with AI

The heart of Cinevault is the **Assistant** — a chat that turns a sentence into a
finished download:

```
you:  download Dune Part Two in 4k
you:  The Bear latest season
you:  a cozy sci-fi show like Silo
```

1. **Understands the request.** The AI resolves the real title, year, media type
   and quality from natural language — typos, nicknames and "latest season" included.
2. **Searches your indexers.** It builds the right query and searches every indexer
   you've added to Prowlarr (Cloudflare-protected trackers work via FlareSolverr).
3. **Matches to TMDB.** Raw release names are matched back to real titles, so results
   come back with **posters, year and a one-line why** — not cryptic torrent strings.
4. **Ranks & filters.** A deterministic scorer (seeders, resolution, size, trusted
   groups) plus an AI tiebreak surface the best release and reject CAMs, fakes and
   mislabels. Wrong-show / wrong-episode matches are validated out.
5. **You tap to grab.** Pick a poster; it queues instantly. A live **"what I'm doing"**
   feed narrates the background work — *searching → queued → downloading → uploading
   → done* — and the same updates arrive over Telegram.

Prefer to browse? The **Home** search box and a global search icon do the same
title search anywhere in the app.

---

## What else it does

**Browse & discover**
- **Home** — a hero slider of top new releases, dynamic TMDB browse rows, and
  in-app trailers.
- **Discover / For You** — personalized picks built from your Jellyfin watch history
  and download library, with an AI taste profile. Separate **Movies / TV**, refreshes
  daily, and lets you **Follow** shows.

**Smart TV acquisition**
- **Whole seasons, done right.** Old, complete seasons grab a validated single-season
  **pack**; recent/ongoing seasons download **episode-by-episode** (`Show S01E01`, `E02`…)
  into one `TV/Show/Season NN` folder — paced as a background job.
- **Follows auto-download new episodes** the day after they air.
- Episodes are grouped per show in Downloads, and every episode (including those in a
  pack) is individually openable in the Library.

**Downloads & reliability**
- Live progress over SSE; tap any card to expand full details.
- **Auto re-source**: if a torrent stalls >10 min it silently switches to another source.
- **Deploy-safe**: a redeploy can't strand an upload — interrupted work self-recovers
  within minutes.

**Library & storage**
- A poster wall of everything on S3, filterable by **type, genre and title**.
- Files are auto-organized and enriched (`Movies/…`, `TV/Show/Season NN/…`) with TMDB
  posters, and streamable in-app or through **Jellyfin**.
- Optional **retention**: auto-delete watched media from S3 after N days to reclaim space.

**Experience**
- Mobile-first (bottom tab bar, safe-area aware) with a **light/dark theme switcher**
  and auto-hiding scrollbars. Confirmations on every destructive action.
- Optional **Telegram bot**: chat to search/download and get push notifications.

---

## Architecture

```
Browser ── Next.js (UI + API) ──┬── Moonshot (Kimi)  reasoning: NL plan, ranking
   ▲  SSE progress + activity    └── MiMo             classification: organize
   │
   ├── Prowlarr  (search across your indexers)   ── FlareSolverr (CF bypass)
   ├── TMDB      (titles, posters, episodes, recommendations)
   ├── Redis     (BullMQ job queue + progress/activity pub-sub)
   ├── Postgres  (downloads, follows, encrypted config)
   ├── Jellyfin  (watch history in → streaming out)  [optional, external]
   │
Worker ── qBittorrent (download) ── organize + enrich ── multipart upload ─▶ S3
```

Two processes from one image: **web** (`pnpm start`) and **worker** (`pnpm worker`).
AI providers are OpenAI-compatible and swappable per task.

| Layer      | Choice                                             |
|------------|----------------------------------------------------|
| Framework  | Next.js 15 (App Router), TypeScript, Tailwind v4   |
| Torrents   | qBittorrent (Web API) + Prowlarr (Torznab)         |
| Queue      | BullMQ + Redis                                      |
| Database   | PostgreSQL + Prisma                                 |
| AI         | Moonshot (Kimi) + Xiaomi MiMo via the `openai` SDK |
| Metadata   | TMDB                                                |
| Storage    | Any S3-compatible endpoint (Contabo by default)    |
| Streaming  | Jellyfin (optional)                                |

---

## Deploy on Coolify

1. **New Resource → Docker Compose**, pointed at this repository (it reads
   `docker-compose.yml` directly).
2. **Set environment variables** (Coolify's Environment tab). At minimum:
   ```
   AUTH_PASSWORD     = a strong password
   AUTH_SECRET       = <openssl rand -hex 32>
   ENCRYPTION_KEY    = <openssl rand -hex 32>
   POSTGRES_PASSWORD = <a strong password>
   ```
   Everything else (AI keys, S3, Prowlarr, TMDB, Telegram, Jellyfin) is entered later
   in the in-app **Settings** page. See [`.env.example`](.env.example) for the full list.
3. **Deploy.** Coolify builds the image and starts the stack (`web`, `worker`,
   `qbittorrent`, `prowlarr`, `flaresolverr`, `postgres`, `redis`).
4. Point your domain at the `web` service (port 3000). Keep the origin behind
   Cloudflare/WAF and only expose the web port publicly.

### First-run configuration

1. **qBittorrent** — grab the temporary admin password and set a permanent one:
   ```
   docker compose logs qbittorrent | grep -i "temporary password"
   ```
2. **Prowlarr** (`:9696`) — add your indexers, then copy *Settings → General → API Key*.
3. In Cinevault → **Settings** (grouped into AI / Downloads / Storage / Media /
   Notifications tabs), fill in and **Save**:
   - Moonshot and/or MiMo API keys
   - qBittorrent URL `http://qbittorrent:8080`, user, password
   - Prowlarr URL `http://prowlarr:9696` + API key
   - S3 endpoint, region `default`, bucket, access key, secret key
   - TMDB API key (posters, discovery, episode info)
   - (optional) Jellyfin URL + API key, Telegram bot token
4. Hit **Test** on each section, then open the **Assistant** and ask for something.

> Secrets entered in Settings are encrypted at rest (AES-256-GCM) with
> `ENCRYPTION_KEY`; the API never returns secret values back to the browser.

---

## Local development

```bash
pnpm install
cp .env.example .env          # AUTH_*, ENCRYPTION_KEY, DATABASE_URL, REDIS_URL
docker compose up -d postgres redis qbittorrent prowlarr flaresolverr
pnpm db:push                  # sync schema
pnpm dev                      # web on :3000
pnpm worker:dev               # worker (separate terminal)
```

**Verify** with `pnpm typecheck` and `pnpm build` (the Coolify deploy runs `next build`).

## Configuration precedence

Every setting resolves as **Settings UI (DB, encrypted) → environment variable →
built-in default** — configure entirely via Coolify env vars, entirely via the UI,
or a mix.

## Security

- Single-admin session (signed JWT cookie); every page and API route is behind auth
  middleware. Login and expensive endpoints are rate-limited.
- Strict security headers + CSP, `poweredByHeader: false`, no production source maps.
- Secrets encrypted at rest and masked in all API responses.
- Keep the origin behind a reverse proxy/WAF; don't expose qBittorrent or Prowlarr
  publicly unless you intend to.

## Project layout

```
src/
  app/              # routes: (app) pages (home, discover, downloads, library,
                    #         chat, settings), /login, /api/*
  components/       # UI (search, downloads, chat + activity feed, library, settings)
  lib/
    llm/            # providers (Moonshot/MiMo), planner, ranker, organizer, agent
    metadata/       # TMDB (titles, episodes, recommendations, trailers)
    torrent/        # qBittorrent client
    storage/        # S3 upload / list / presign
    scoring/        # deterministic release scorer + match validators
    service/        # pipeline: plan → search → rank → queue; follows; retention
    activity.ts     # background "what the agent is doing" log
  worker/           # BullMQ worker: download → organize → upload → cleanup
prisma/schema.prisma
docker-compose.yml  # full stack for Coolify
```
