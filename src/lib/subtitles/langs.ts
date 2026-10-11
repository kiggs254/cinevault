/**
 * The language table shared by the providers (SubDL reports languages by English
 * name) and by sidecar adoption (recognising "2_English.srt" / ".eng.srt" in a
 * torrent's own subtitle folder). Unknown codes degrade gracefully to the code
 * itself, so a language we don't list still works — it just can't be guessed
 * from a filename.
 */
export interface LangInfo {
  /** English name, as the subtitle sites print it. */
  name: string;
  /** ISO 639-2/B three-letter code, as release groups name files. */
  iso3: string;
  /** Extra spellings seen in the wild. */
  aliases?: string[];
}

export const LANGS: Record<string, LangInfo> = {
  en: { name: "english", iso3: "eng" },
  sw: { name: "swahili", iso3: "swa" },
  fr: { name: "french", iso3: "fre", aliases: ["francais", "français", "fra"] },
  es: { name: "spanish", iso3: "spa", aliases: ["espanol", "español", "castellano"] },
  de: { name: "german", iso3: "ger", aliases: ["deutsch", "deu"] },
  it: { name: "italian", iso3: "ita", aliases: ["italiano"] },
  pt: { name: "portuguese", iso3: "por", aliases: ["portugues", "português"] },
  "pt-br": {
    name: "brazillian portuguese",
    iso3: "pob",
    aliases: ["brazilian portuguese", "portuguese (br)", "pt-br", "ptbr"],
  },
  ar: { name: "arabic", iso3: "ara" },
  hi: { name: "hindi", iso3: "hin" },
  nl: { name: "dutch", iso3: "dut", aliases: ["nederlands", "nld"] },
  ru: { name: "russian", iso3: "rus" },
  tr: { name: "turkish", iso3: "tur" },
  zh: { name: "chinese", iso3: "chi", aliases: ["chinese bg code", "big 5 code", "zho", "mandarin"] },
  ja: { name: "japanese", iso3: "jpn" },
  ko: { name: "korean", iso3: "kor" },
  pl: { name: "polish", iso3: "pol" },
  sv: { name: "swedish", iso3: "swe" },
  no: { name: "norwegian", iso3: "nor" },
  da: { name: "danish", iso3: "dan" },
  fi: { name: "finnish", iso3: "fin" },
  el: { name: "greek", iso3: "ell", aliases: ["gre"] },
  he: { name: "hebrew", iso3: "heb" },
  th: { name: "thai", iso3: "tha" },
  id: { name: "indonesian", iso3: "ind" },
  vi: { name: "vietnamese", iso3: "vie" },
  ro: { name: "romanian", iso3: "rum", aliases: ["ron"] },
  hu: { name: "hungarian", iso3: "hun" },
  cs: { name: "czech", iso3: "cze", aliases: ["ces"] },
  uk: { name: "ukrainian", iso3: "ukr" },
  fa: { name: "persian", iso3: "per", aliases: ["farsi", "fas"] },
  ta: { name: "tamil", iso3: "tam" },
  te: { name: "telugu", iso3: "tel" },
  ml: { name: "malayalam", iso3: "mal" },
  bn: { name: "bengali", iso3: "ben" },
  ur: { name: "urdu", iso3: "urd" },
  af: { name: "afrikaans", iso3: "afr" },
  am: { name: "amharic", iso3: "amh" },
  zu: { name: "zulu", iso3: "zul" },
};

/** Every lowercase spelling of a language that might appear in a filename. */
export function langTokens(code: string): string[] {
  const c = code.toLowerCase();
  const info = LANGS[c] ?? LANGS[c.split("-")[0]];
  const out = new Set<string>([c]);
  if (info) {
    out.add(info.name);
    out.add(info.iso3);
    for (const a of info.aliases ?? []) out.add(a);
  }
  return [...out];
}

/** Full-name spellings only — what SubDL puts in a result's `lang` field. */
export function langNames(code: string): string[] | null {
  const c = code.toLowerCase();
  const info = LANGS[c] ?? LANGS[c.split("-")[0]];
  if (!info) return null;
  return [info.name, ...(info.aliases ?? [])].filter((n) => n.length > 3);
}

/**
 * Every language token we recognise inside a sidecar filename. Used to tell a
 * language-labelled sidecar ("Movie.fr.srt") from an unlabelled leftover — so
 * adoption never steals another language's subtitle.
 */
export const ALL_LANG_TOKENS: ReadonlySet<string> = new Set(
  Object.keys(LANGS).flatMap((code) => langTokens(code)),
);
