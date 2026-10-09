// Interface language: Italian (the text in the code) or English.
//
// Strings are looked up by their Italian text: `t("Consenti")`,
// `t("Carico {name}", { name })`. The English table is src/i18n/en.json, keyed
// by the Italian text; Rust embeds the same file (src-tauri/src/i18n.rs) for
// the tray menu, the cards it writes and the errors it returns. A string
// missing from the table shows in Italian; `npm run check:i18n` lists them.
//
// The language is fixed for the life of a page: strings are read when the
// views are built. It is known before any module runs (localStorage, shared by
// the island and the settings window); `syncLanguage` fixes it after boot
// when the settings say otherwise, and changing it restarts the app.

import EN from "../i18n/en.json";

export type Language = "it" | "en";
export type Vars = Record<string, string | number>;

const STORE_KEY = "easyisland.lang";
const TABLE = EN as Record<string, string>;

/** Windows' language when nothing was chosen: Italian only for Italian. */
export function systemLanguage(): Language {
  const tag = (typeof navigator !== "undefined" && navigator.language) || "it";
  return tag.toLowerCase().startsWith("it") ? "it" : "en";
}

/** `settings.language`: "" follows Windows. */
export function resolveLanguage(picked: string | undefined | null): Language {
  return picked === "it" || picked === "en" ? picked : systemLanguage();
}

function stored(): Language | null {
  try {
    const v = localStorage.getItem(STORE_KEY);
    return v === "it" || v === "en" ? v : null;
  } catch {
    return null;
  }
}

let current: Language = new URLSearchParams(typeof location !== "undefined" ? location.search : "").get("lang") === "en"
  ? "en"
  : stored() ?? systemLanguage();
if (typeof document !== "undefined") document.documentElement.lang = current;

export function language(): Language {
  return current;
}

/** For numbers and dates: "it-IT" or "en-GB". */
export function locale(): string {
  return current === "en" ? "en-GB" : "it-IT";
}

/**
 * After boot: the language the settings ask for. When it is not the one this
 * page was built in, it is remembered and the page loads again (once).
 */
export function syncLanguage(picked: string | undefined | null): void {
  const want = resolveLanguage(picked);
  try {
    localStorage.setItem(STORE_KEY, want);
  } catch {
    return; // No storage: the page stays as it is.
  }
  if (want !== current && !new URLSearchParams(location.search).has("lang")) location.reload();
}

function fill(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/** `it` in the current language, its `{placeholders}` filled from `vars`. */
export function t(it: string, vars?: Vars): string {
  return fill(current === "en" ? TABLE[it] ?? it : it, vars);
}

/** A count with its words: `tn("{n} file", "{n} file", n)`; `{n}` is filled in. */
export function tn(one: string, many: string, n: number, vars?: Vars): string {
  return t(n === 1 ? one : many, { ...vars, n });
}

/** Marks a literal as a key without translating it (tables built at load time). */
export function N_<T extends string>(it: T): T {
  return it;
}
