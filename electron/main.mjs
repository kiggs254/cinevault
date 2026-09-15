// Cinevault Home Edition — Electron main process.
// Boots the single-process runtime (embedded Postgres + Next + worker) and opens a
// window at it. First run asks for a media folder and generates local secrets.
// This file is plain ESM JS (kept out of the TS typecheck on purpose).
import { app, BrowserWindow, dialog, shell } from "electron";
import { fork } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// electron/ lives at the project root, so the app dir is one level up.
const APP_DIR = path.resolve(__dirname, "..");

const DATA_DIR = process.env.CINEVAULT_DATA_DIR || path.join(app.getPath("appData"), "Cinevault");
const CONFIG_PATH = path.join(DATA_DIR, "config.json");
const PORT = Number(process.env.PORT || 34580);

let child = null;
let win = null;

function loadConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}
function saveConfig(c) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2));
}
/** Generate + persist the local secrets the app requires (once). */
function ensureSecrets(c) {
  let changed = false;
  if (!c.AUTH_SECRET) {
    c.AUTH_SECRET = crypto.randomBytes(32).toString("hex");
    changed = true;
  }
  if (!c.ENCRYPTION_KEY) {
    c.ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
    changed = true;
  }
  if (!c.AUTH_PASSWORD) {
    c.AUTH_PASSWORD = crypto.randomBytes(5).toString("hex"); // shown to the user on first run
    changed = true;
  }
  if (changed) saveConfig(c);
  return c;
}

async function pickMediaDir() {
  const r = await dialog.showOpenDialog({
    title: "Choose where Cinevault saves movies & shows",
    buttonLabel: "Use this folder",
    properties: ["openDirectory", "createDirectory"],
  });
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0];
}

function startRuntime(cfg, onReady) {
  child = fork(path.join(APP_DIR, "src", "desktop", "runtime.ts"), [], {
    cwd: APP_DIR,
    execPath: process.execPath, // Electron binary, running as Node (below)
    execArgv: ["--import", "tsx"], // run the .ts runtime + worker via tsx
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      CINEVAULT_APP_DIR: APP_DIR,
      CINEVAULT_DATA_DIR: DATA_DIR,
      CINEVAULT_DESKTOP: "1",
      STORAGE_BACKEND: "local",
      MEDIA_DIR: cfg.mediaDir,
      AUTH_SECRET: cfg.AUTH_SECRET,
      ENCRYPTION_KEY: cfg.ENCRYPTION_KEY,
      AUTH_PASSWORD: cfg.AUTH_PASSWORD,
      PORT: String(PORT),
    },
  });
  child.on("message", (m) => {
    if (m && m.type === "ready") onReady(m.url);
  });
  child.on("exit", (code) => {
    console.log("[electron] runtime exited:", code);
    if (!app.isQuitting) {
      dialog.showErrorBox("Cinevault", "The Cinevault engine stopped. Check the logs and reopen.");
    }
  });
}

function createWindow(url) {
  win = new BrowserWindow({
    width: 1280,
    height: 820,
    title: "Cinevault",
    backgroundColor: "#0b0b0f",
    webPreferences: { contextIsolation: true },
  });
  win.loadURL(url);
  // Open external links in the real browser, not inside the app window.
  win.webContents.setWindowOpenHandler(({ url: u }) => {
    if (!u.startsWith(url)) {
      shell.openExternal(u);
      return { action: "deny" };
    }
    return { action: "allow" };
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      win.show();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    const cfg = ensureSecrets(loadConfig());
    if (!cfg.mediaDir) {
      const dir = await pickMediaDir();
      if (!dir) {
        app.quit();
        return;
      }
      cfg.mediaDir = dir;
      saveConfig(cfg);
    }
    startRuntime(cfg, (url) => createWindow(url));
  });

  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    app.isQuitting = true;
    if (child) {
      try {
        child.send({ type: "shutdown" });
      } catch {
        /* ignore */
      }
    }
  });
}
