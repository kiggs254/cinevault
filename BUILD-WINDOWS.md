# Building the Cinevault Home Edition installer (Windows)

This produces the double-click `.exe` your friend runs. Do these steps **on a
Windows PC** (I can't build/run a Windows app from the dev machine). It's a first
cut — expect a couple of iterations; paste me any errors and I'll fix them.

## 0. Prerequisites
- Windows 10/11 (64-bit)
- [Node.js 20 LTS+](https://nodejs.org) and pnpm (`npm i -g pnpm`)
- Git

## 1. Get the branch
```powershell
git clone https://github.com/kiggs254/cinevault.git
cd cinevault
git checkout windows-local-edition
pnpm install
```

## 2. Add the desktop-only dependencies
These are **not** in package.json on purpose (so the cloud build stays lean):
```powershell
pnpm add -D electron electron-builder
pnpm add embedded-postgres @embedded-postgres/windows-x64
```
`@embedded-postgres/windows-x64` downloads the bundled Postgres binary — that's expected.

## 3. Build the web app
```powershell
pnpm desktop:build
```
(= `prisma generate && next build`.)

## 4. Test it before packaging (recommended)
```powershell
pnpm desktop
```
This launches Electron, which:
1. asks for a **folder** to save movies/shows into (first run only),
2. starts an embedded Postgres under `%APPDATA%\Cinevault`,
3. applies the DB schema, starts the app + worker in one process,
4. opens the Cinevault window.

Then open **Settings → paste your TMDB API key + TorBox API key** (that's all the
config needed — search + downloads both go through TorBox to your chosen folder).
Your local admin password is generated and saved in `%APPDATA%\Cinevault\config.json`.

## 5. Package the installer
```powershell
pnpm desktop:dist
```
Output: `dist-desktop\Cinevault Setup <version>.exe` — that's the file your friend
double-clicks. It installs the app; on first launch it does step 4's folder prompt.

## What your friend needs
- Run the installer, pick a folder, and (once) paste a TMDB key (free) + a TorBox
  key. Nothing else — no Docker, no Postgres, no qBittorrent.

## Known rough edges (likely first-iteration fixes)
- **Prisma engine path** — if you see "query engine not found", the packaged
  `node_modules\.prisma` / `@prisma\engines` path needs adjusting (asar is already
  disabled to make this easier). Send me the exact error.
- **`tsx`/runtime not starting** — the runtime (`src/desktop/runtime.ts`) is run via
  `tsx`; if Electron's Node rejects `--import tsx`, we'll precompile it instead.
- **Embedded Postgres won't start** — usually a leftover data dir or a busy port
  (54329). Delete `%APPDATA%\Cinevault\pgdata` to reset, or change the port.
- **Windows Defender / SmartScreen** — an unsigned installer shows a warning; click
  "More info → Run anyway" (code-signing is a later step).

Paste any build or first-run errors and I'll iterate.
