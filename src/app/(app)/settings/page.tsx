"use client";

import { useEffect, useState } from "react";
import { Save, Plug, Loader2, Check, X } from "lucide-react";
import { jsonFetch } from "@/lib/client";

type Settings = Record<string, string | number | boolean>;
type SecretsSet = Record<string, boolean>;

type Field =
  | { k: string; label: string; type: "text" | "url" | "number"; placeholder?: string }
  | { k: string; label: string; type: "secret"; placeholder?: string }
  | { k: string; label: string; type: "select"; options: string[] }
  | { k: string; label: string; type: "toggle" };

interface Section {
  title: string;
  desc: string;
  test?: string;
  fields: Field[];
}

const SECTIONS: Section[] = [
  {
    title: "AI Providers",
    desc: "Moonshot (Kimi) handles reasoning; MiMo handles cheap classification. Both are OpenAI-compatible.",
    test: "ai",
    fields: [
      { k: "moonshotApiKey", label: "Moonshot API key", type: "secret" },
      { k: "moonshotBaseUrl", label: "Moonshot base URL", type: "url" },
      { k: "moonshotModel", label: "Moonshot model", type: "text", placeholder: "kimi-k2.5" },
      { k: "mimoApiKey", label: "MiMo API key", type: "secret" },
      { k: "mimoBaseUrl", label: "MiMo base URL", type: "url" },
      { k: "mimoModel", label: "MiMo model", type: "text", placeholder: "mimo-v2.5-pro" },
    ],
  },
  {
    title: "Torrent Engine",
    desc: "qBittorrent Web API. On the same Docker network use http://qbittorrent:8080.",
    test: "qbit",
    fields: [
      { k: "qbitUrl", label: "qBittorrent URL", type: "url", placeholder: "http://qbittorrent:8080" },
      { k: "qbitUser", label: "Username", type: "text", placeholder: "admin" },
      { k: "qbitPassword", label: "Password", type: "secret" },
    ],
  },
  {
    title: "Indexers",
    desc: "Prowlarr aggregates your torrent indexers. Use http://prowlarr:9696 on the Docker network.",
    test: "prowlarr",
    fields: [
      { k: "prowlarrUrl", label: "Prowlarr URL", type: "url", placeholder: "http://prowlarr:9696" },
      { k: "prowlarrApiKey", label: "Prowlarr API key", type: "secret" },
    ],
  },
  {
    title: "Storage (Contabo S3)",
    desc: "S3-compatible object storage. Path-style addressing is used automatically.",
    test: "s3",
    fields: [
      { k: "s3Endpoint", label: "Endpoint", type: "url", placeholder: "https://eu2.contabostorage.com" },
      { k: "s3Region", label: "Region", type: "text", placeholder: "default" },
      { k: "s3Bucket", label: "Bucket", type: "text", placeholder: "media" },
      { k: "s3AccessKeyId", label: "Access key ID", type: "text" },
      { k: "s3SecretAccessKey", label: "Secret access key", type: "secret" },
      { k: "s3PublicUrl", label: "Public base URL (optional)", type: "url" },
      { k: "s3BasePrefix", label: "Base folder (all downloads go here)", type: "text" },
      { k: "tmdbApiKey", label: "TMDB API key (optional, posters)", type: "secret" },
    ],
  },
  {
    title: "Preferences",
    desc: "Defaults the AI uses when ranking and selecting releases.",
    fields: [
      { k: "preferredQuality", label: "Preferred quality", type: "select", options: ["2160p", "1080p", "720p", "480p", "any"] },
      { k: "minSeeders", label: "Minimum seeders", type: "number" },
      { k: "maxSizeGB", label: "Max size (GB)", type: "number" },
      { k: "deleteAfterUpload", label: "Delete local + torrent after S3 upload", type: "toggle" },
    ],
  },
];

const DEFAULTS: Settings = {
  moonshotBaseUrl: "https://api.moonshot.ai/v1",
  moonshotModel: "kimi-k2.5",
  mimoBaseUrl: "https://api.xiaomimimo.com/v1",
  mimoModel: "mimo-v2.5-pro",
  s3Region: "default",
  s3BasePrefix: "moviehub",
  preferredQuality: "1080p",
  minSeeders: 3,
  maxSizeGB: 25,
  deleteAfterUpload: true,
};

export default function SettingsPage() {
  const [settings, setSettings] = useState<Settings>(DEFAULTS);
  const [secretsSet, setSecretsSet] = useState<SecretsSet>({});
  const [secretInputs, setSecretInputs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState("");
  const [tests, setTests] = useState<Record<string, { ok?: boolean; msg?: string; busy?: boolean }>>({});

  useEffect(() => {
    (async () => {
      try {
        const d = await jsonFetch<{ settings: Settings; secretsSet: SecretsSet }>("/api/settings");
        setSettings({ ...DEFAULTS, ...d.settings });
        setSecretsSet(d.secretsSet);
      } catch {
        /* keep defaults */
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const set = (k: string, v: string | number | boolean) => {
    setSettings((s) => ({ ...s, [k]: v }));
    setSaved(false);
  };
  const setSecret = (k: string, v: string) => {
    setSecretInputs((s) => ({ ...s, [k]: v }));
    setSaved(false);
  };

  async function save() {
    setSaving(true);
    setSaved(false);
    setErr("");
    const payload: Record<string, unknown> = { ...settings };
    for (const [k, v] of Object.entries(secretInputs)) if (v.trim()) payload[k] = v.trim();
    try {
      const d = await jsonFetch<{ settings: Settings; secretsSet: SecretsSet }>("/api/settings", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setSecretsSet(d.secretsSet);
      setSecretInputs({});
      setSaved(true);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function runTest(target: string) {
    setTests((t) => ({ ...t, [target]: { busy: true } }));
    try {
      const d = await jsonFetch<{ ok: boolean; message: string }>("/api/settings", {
        method: "POST",
        body: JSON.stringify({ target }),
      });
      setTests((t) => ({ ...t, [target]: { ok: d.ok, msg: d.message } }));
    } catch (e) {
      setTests((t) => ({ ...t, [target]: { ok: false, msg: (e as Error).message } }));
    }
  }

  function renderField(f: Field) {
    if (f.type === "secret") {
      const configured = secretsSet[f.k];
      return (
        <input
          type="password"
          className="input mono"
          autoComplete="new-password"
          placeholder={configured ? "•••••••••• configured" : "Not set"}
          value={secretInputs[f.k] ?? ""}
          onChange={(e) => setSecret(f.k, e.target.value)}
        />
      );
    }
    if (f.type === "select") {
      return (
        <select
          className="input"
          value={String(settings[f.k] ?? f.options[0])}
          onChange={(e) => set(f.k, e.target.value)}
        >
          {f.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </select>
      );
    }
    if (f.type === "toggle") {
      const on = !!settings[f.k];
      return (
        <button
          type="button"
          onClick={() => set(f.k, !on)}
          className="flex items-center gap-2 text-sm text-ink"
        >
          <span
            className="relative h-6 w-11 rounded-full transition-colors"
            style={{ background: on ? "var(--color-accent)" : "var(--color-surface-2)" }}
          >
            <span
              className="absolute top-0.5 h-5 w-5 rounded-full bg-white transition-transform"
              style={{ transform: on ? "translateX(22px)" : "translateX(2px)" }}
            />
          </span>
          {on ? "Enabled" : "Disabled"}
        </button>
      );
    }
    return (
      <input
        type={f.type === "number" ? "number" : "text"}
        className={`input ${f.type === "number" ? "mono" : ""}`}
        placeholder={f.placeholder}
        value={String(settings[f.k] ?? "")}
        onChange={(e) => set(f.k, f.type === "number" ? Number(e.target.value) : e.target.value)}
      />
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-5 py-8 md:px-10">
      <header className="mb-8 flex items-end justify-between gap-4">
        <div>
          <p className="label">Configuration</p>
          <h1 className="text-5xl text-ink" style={{ fontFamily: "var(--font-display)" }}>
            Settings
          </h1>
        </div>
        <div className="flex items-center gap-3">
          {saved && <span className="text-sm text-success">Saved</span>}
          {err && <span className="text-sm text-danger">{err}</span>}
          <button className="btn btn-accent" onClick={save} disabled={saving || loading}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Save
          </button>
        </div>
      </header>

      {loading ? (
        <p className="text-sm text-faint">Loading configuration…</p>
      ) : (
        <div className="space-y-6">
          {SECTIONS.map((section) => {
            const t = section.test ? tests[section.test] : undefined;
            return (
              <div key={section.title} className="panel p-6">
                <div className="mb-5 flex items-start justify-between gap-4">
                  <div>
                    <h2 className="text-lg font-semibold text-ink">{section.title}</h2>
                    <p className="mt-1 max-w-xl text-xs text-muted">{section.desc}</p>
                  </div>
                  {section.test && (
                    <div className="flex flex-none items-center gap-2">
                      {t && !t.busy && (
                        <span
                          className="flex items-center gap-1 text-xs"
                          style={{ color: t.ok ? "var(--color-success)" : "var(--color-danger)" }}
                        >
                          {t.ok ? <Check size={13} /> : <X size={13} />}
                          <span className="max-w-[12rem] truncate">{t.msg}</span>
                        </span>
                      )}
                      <button
                        className="btn btn-ghost"
                        onClick={() => runTest(section.test!)}
                        disabled={t?.busy}
                      >
                        {t?.busy ? <Loader2 size={14} className="animate-spin" /> : <Plug size={14} />}
                        Test
                      </button>
                    </div>
                  )}
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  {section.fields.map((f) => (
                    <div key={f.k} className={f.type === "toggle" ? "sm:col-span-2" : ""}>
                      <label className="label mb-1.5 block">{f.label}</label>
                      {renderField(f)}
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
          <p className="pb-10 text-xs text-faint">
            Tip: “Test” checks the currently <span className="text-muted">saved</span> configuration —
            save first, then test.
          </p>
        </div>
      )}
    </div>
  );
}
