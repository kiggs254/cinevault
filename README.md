# Cinevault — your AI-curated film & TV vault

A self-hosted, AI-driven media app for a small invite-only circle: **ask for
something in plain language and it finds, grabs, organizes, and archives it to your
own S3 storage** — then serves it back through Jellyfin. Members watch **and request**
from one app, [Moonfin](https://github.com/Moonfin-Client/Moonfin-Core), on their
phone, TV or computer. Built to run on [Coolify](https://coolify.io) or any Docker host.

> **Legal note.** BitTorrent + S3 is legitimate infrastructure (Linux ISOs, the
> Internet Archive, Creative Commons, public-domain media, your own backups). This
> software is a general-purpose tool — you are responsible for only using it to
> obtain content you have the legal right to.

---

## Screenshots

![Cinevault screenshot 1](https://i.ibb.co/RGJ4dV3y/Screenshot-2026-07-27-at-12-31-32-PM.png)

![Cinevault screenshot 2](https://i.ibb.co/rRtHXnBc/Screenshot-2026-07-27-at-12-31-42-PM.png)

![Cinevault screenshot 3](https://i.ibb.co/7xJMcC6M/Screenshot-2026-07-27-at-12-32-17-PM.png)

![Cinevault screenshot 4](https://i.ibb.co/gMKDZbfZ/Screenshot-2026-07-27-at-12-32-34-PM.png)

![Cinevault screenshot 5](https://i.ibb.co/vxC2sFm9/Screenshot-2026-07-27-at-12-32-52-PM.png)

![Cinevault screenshot 6](https://i.ibb.co/mFSB6Nby/Screenshot-2026-07-27-at-12-33-04-PM.png)

![Cinevault screenshot 7](https://i.ibb.co/YTc8zVjr/Screenshot-2026-07-27-at-12-33-14-PM.png)

![Cinevault screenshot 8](https://i.ibb.co/yF5B493C/Screenshot-2026-07-27-at-12-33-31-PM.png)

---

## Watch & request in Moonfin

Members don't need to open Cinevault day to day. They use **Moonfin**, a free
Jellyfin app with requesting built in:

- **Watch** everything in the shared library — same server, same login as Jellyfin.
- **Request anything.** Moonfin's search finds every movie and show, not just what's
  already here. Tap **Request** and Cinevault downloads it into that member's library;
  they get a notification when it's ready.
- **Request on your phone, watch on the TV.** Same account on both, so a title
  requested from the sofa appears on the TV once it lands. (Requesting isn't a second
  screen — only playing is.)

```
Moonfin ──Request──▶ Seerr (private) ──webhook──▶ Cinevault ──▶ TorBox / qBittorrent ──▶ S3
   ▲                                                                                    │
   └──────────────────────────── Jellyfin ◀── rclone mount ◀─────────────────────────────┘
```

Seerr runs with **no Radarr/Sonarr**: it records the request and fires a webhook,
and Cinevault does the searching, ranking and downloading exactly as if the member
had asked in the app. Moonfin talks to Seerr through its server plugin (Moonbase),
so Seerr is never exposed to the internet.

Store apps: [Android phone & Android/Google TV](https://play.google.com/store/apps/details?id=org.moonfin.androidtv) ·
[iPhone, iPad & Apple TV](https://apps.apple.com/app/moonfin/id6761283970) ·
[Fire TV](https://www.amazon.com/Moonfin/dp/B0H76BG3DW) ·
[Roku](https://channelstore.roku.com/details/92a83c9f4112b76a7bcee3dc076254ca:3251a91bf7af7339652d5409ccfdcb39/moonfin).
**Samsung and LG TVs** have no store build — use the official Jellyfin app on the
TV (it plays everything) and request from Moonfin on a phone.

See [Requests from Moonfin](#requests-from-moonfin-seerr) for setup.

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
- **Wanted** — subscribe to a movie that isn't out yet; it's grabbed automatically
  once a real (non-cam, 720p+) release appears.

**Smart TV acquisition**
- **Whole seasons, done right.** Old, complete seasons grab a validated single-season
  **pack**; recent/ongoing seasons download **episode-by-episode** (`Show S01E01`, `E02`…)
  into one `TV/Show/Season NN` folder — paced as a background job.
- **Follows auto-download new episodes** the day after they air.
- Episodes are grouped per show in Downloads, and every episode (including those in a
  pack) is individually openable in the Library.

**Downloads & reliability**
- **TorBox first.** With a TorBox key, releases are fetched by TorBox and streamed
  straight into S3 — instant when cached, nothing touches local disk. qBittorrent is
  the automatic fallback.
- Live progress over SSE; tap any card to expand full details.
- **Auto re-source**: if a torrent stalls >10 min it silently switches to another source.
- **Deploy-safe**: a redeploy can't strand an upload — interrupted work self-recovers
  within minutes.

**Subtitles**
- **On request or automatic.** Members can ask for subtitles for a whole movie or
  show, one season, or a single file from its Library page. Optionally, every finished
  download gets them automatically and a background sweep backfills the existing
  library — each switchable in Settings, so small provider quotas go to what people
  actually watch.
- Stored as Jellyfin **sidecars** beside the video in S3 (`Movie.2024.1080p.en.srt`),
  so they need no plugin, work in any player, and travel with the media object.
- Subtitles the release already shipped (even buried in `Subs/2_English.srt`) are
  matched per episode and renamed first — free, and better synced. Anything still
  missing is fetched from **SubDL**, falling back to **OpenSubtitles**, preferring a
  subtitle cut for the exact release so it actually lines up.
- **Quota-aware.** SubDL's free tier allows 50 downloads a day (enforced on the
  download, not the search). When a provider's quota is spent, the work is *deferred*
  and retried automatically once it resets — never recorded as "no subtitles exist".
- Multi-language (`en,sw`), retried with a widening backoff when nothing exists yet,
  and deleted along with their video.

**Library & storage**
- A poster wall of everything on S3, filterable by **type, genre and title**.
- Files are auto-organized and enriched (`Movies/…`, `TV/Show/Season NN/…`) with TMDB
  posters, and streamable in-app or through **Jellyfin**.
- **Retention**: titles nobody has watched within 60 days of being added are removed
  (configurable), with an optional storage budget that frees the least-recently-used
  first. Shared files are reference-counted, and everything can be re-requested.

**Members & onboarding**
- **Invite-only.** Members generate invite links; the admin approves each sign-up.
  Approval creates a Jellyfin account with the same login, adds them to Seerr, and
  sends a "you're in" message.
- **Moonfin-first setup.** The invite page explains how it works and the house rules;
  after approval, the welcome page walks through installing Moonfin, adding the server,
  turning on requests, and the phone-requests / TV-watches setup. The official Jellyfin
  app is covered as the fallback. A **Member guide** keeps it all in the app.
- Everyone has their own library, follows and notifications, and can stream what
  other members have added.

**Live TV**
- Admin-managed M3U playlists (with XMLTV guide data) merged into one key-protected
  feed that Jellyfin's Live TV loads.

**Experience**
- Mobile-first (bottom tab bar, safe-area aware) with a **light/dark theme switcher**
  and auto-hiding scrollbars. Confirmations on every destructive action.
- **Notifications** by Telegram bot (chat to search and download, too) or browser
  push — for requests, finished downloads and new episodes.

---

## Architecture

```
Moonfin / Jellyfin apps ──▶ Jellyfin ◀── rclone mount of S3
        │ request
        ▼
      Seerr ──webhook──▶ Next.js web (UI + API) ──┬── Moonshot (Kimi)  reasoning: plan, rank
Browser ◀── SSE progress ─┘                        ├── MiMo             classification: organize
                                                   ├── Prowlarr ── FlareSolverr (CF bypass)
                                                   ├── TMDB (titles, posters, episodes, recs)
                                                   ├── Redis (BullMQ + progress pub-sub)
                                                   └── Postgres (members, downloads, encrypted config)

Worker ── TorBox (streamed) ─┬─▶ organize + enrich ──▶ S3 ──▶ subtitle sidecars
       └─ qBittorrent ───────┘                                (SubDL / OpenSubtitles)
```

Two processes from one image: **web** (`pnpm start`) and **worker** (`pnpm worker`).
AI providers are OpenAI-compatible and swappable per task. Seerr and Jellyfin run as
their own containers next to the stack.

| Layer         | Choice                                                     |
|---------------|------------------------------------------------------------|
| Framework     | Next.js 16 (App Router), TypeScript, Tailwind v4           |
| Downloads     | TorBox (debrid, streamed to S3) → qBittorrent fallback     |
| Indexers      | Prowlarr (Torznab) + FlareSolverr                          |
| Queue         | BullMQ + Redis                                              |
| Database      | PostgreSQL + Prisma                                         |
| AI            | Moonshot (Kimi) + Xiaomi MiMo via the `openai` SDK         |
| Metadata      | TMDB                                                        |
| Storage       | Any S3-compatible endpoint                                  |
| Streaming     | Jellyfin, watched in Moonfin (or the official Jellyfin app) |
| Requests      | Seerr (no Radarr/Sonarr) → webhook → Cinevault             |
| Subtitles     | SubDL → OpenSubtitles fallback, stored as S3 sidecars      |
| Notifications | Telegram bot + Web Push                                     |

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
   - (optional) Jellyfin URL + public URL + API key, Telegram bot token, TorBox key
   - (optional) **Subtitles**: a free SubDL key (subdl.com → account), plus an
     OpenSubtitles API key — and username/password for a bigger daily quota
4. Hit **Test** on each section, then open the **Assistant** and ask for something.
5. For requests from Moonfin, follow the next section.

> Secrets entered in Settings are encrypted at rest (AES-256-GCM) with
> `ENCRYPTION_KEY`; the API never returns secret values back to the browser.

### Requests from Moonfin (Seerr)

1. **Run Seerr privately** next to Jellyfin, attached to the same Docker networks as
   Jellyfin and this stack, with its port bound to `127.0.0.1` only (reach the admin UI
   over an SSH tunnel). Pin the image version.
2. **Seerr's setup wizard:** sign in with your Jellyfin admin account (host `jellyfin`,
   port `8096`), enable only your **Movies** and **TV** libraries, and **skip
   Radarr/Sonarr** — that's what makes Seerr hand requests to Cinevault.
3. **Seerr → Settings → Notifications → Webhook:**
   - URL: `http://web:3000/api/integrations/seerr`
   - Authorization header: `Bearer <SEERR_WEBHOOK_SECRET>` (`openssl rand -hex 32`)
   - Types: **Request Approved** and **Request Automatically Approved**
   - JSON payload:
     ```json
     { "notification_type": "{{notification_type}}", "subject": "{{subject}}", "request_id": "{{request_id}}" }
     ```
4. **Seerr → Users:** give members **Request** + **Auto-approve** (also as the default
   for new users), or their requests will wait for your approval.
5. **Cinevault → Settings → Media → Requests from Moonfin (Seerr):** Seerr URL
   (`http://seerr:5055`), Seerr API key, and the same webhook secret → **Test**.
   **Sync members to Seerr** imports every active member; it also runs every 6 hours
   and for each newly approved member.
6. **Jellyfin:** add the Moonbase plugin repository
   (`https://raw.githubusercontent.com/Moonfin-Client/Plugin/refs/heads/master/manifest.json`),
   install **Moonbase**, set its Seerr URL to `http://seerr:5055` with Moonbase Sync on,
   and restart Jellyfin. If you run a reverse proxy, it must pass `/Moonfin/` paths through.
7. **Each member, once:** in Moonfin → **Settings → Integrations → Seerr**, sign in with
   account type **Jellyfin**. The welcome page and Member guide walk them through it.

The webhook is reachable through your public domain, but it is authenticated, and its
body is only a trigger: what to download and for whom is always re-read from Seerr's
API, so a forged call can't invent a request.

> **Tip:** Jellyfin's own *Open Subtitles* plugin can run alongside Cinevault's
> subtitles on its own quota. If your media mount is read-only, turn off *Save
> subtitles into media folders* so it stores them in Jellyfin's metadata instead.

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

- **Accounts:** invite-only sign-up with admin approval; admin and member roles.
  Authentication *and* authorization are enforced server-side in every route —
  members only see and act on their own library, and settings are admin-only.
- Login and expensive endpoints are rate-limited (subtitle requests: 20 per 10 minutes
  per member).
- **Seerr webhook:** shared-secret `Authorization` header compared in constant time,
  64 KB body cap, rate-limited, de-duplicated per request, and acted on only after
  re-reading the request from Seerr's API. Seerr itself is never published.
- Strict security headers + CSP, `poweredByHeader: false`, no production source maps.
- Secrets encrypted at rest and masked in all API responses.
- Keep the origin behind a reverse proxy/WAF; don't expose qBittorrent, Prowlarr or
  Seerr publicly.

## Project layout

```
src/
  app/              # routes: (app) pages (home, discover, downloads, library,
                    #         chat, guide, settings), /register, /welcome, /login, /api/*
  components/       # UI (search, downloads, chat + activity feed, library, settings,
                    #     Moonfin setup steps shared by /welcome and the Member guide)
  lib/
    llm/            # providers (Moonshot/MiMo), planner, ranker, organizer, agent
    metadata/       # TMDB (titles, episodes, recommendations, trailers)
    torrent/        # qBittorrent client
    storage/        # S3 upload / list / presign
    subtitles/      # subtitles: providers, sidecar naming, requests, library sweep
    seerr/          # Seerr client + webhook handling (requests from Moonfin)
    jellyfin/       # Jellyfin client: watch history, accounts, library admin
    torbox/         # TorBox (debrid) client — streams releases straight to S3
    livetv/         # M3U/EPG aggregation for Jellyfin Live TV
    telegram/       # bot + notifications
    scoring/        # deterministic release scorer + match validators
    service/        # pipeline: plan → search → rank → queue; follows; retention
    activity.ts     # background "what the agent is doing" log
  worker/           # BullMQ worker: download → organize → upload → cleanup
prisma/schema.prisma
docker-compose.yml  # full stack for Coolify
```
