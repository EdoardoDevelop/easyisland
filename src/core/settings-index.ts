// The index of the settings (Edoardo, 19 Nov 2026: «la ricerca nelle
// impostazioni»). The settings window builds it from its own controls
// (src/settings/search.ts) and leaves it in localStorage, which the island's
// page shares (same WebView2 profile): the field at the top of the settings
// and the island's one field search the same entries.

import { fuzzyFilter } from "./fuzzy";

/** One control of the settings: where it is and what it says. */
export interface SettingsEntry {
  /** page|tab|label#n|item: found again among the drawn controls (search.ts gotoEntry); item = the integration it is in. */
  key: string;
  page: string;
  pageLabel: string;
  tab: string;
  tabLabel: string;
  section: string;
  label: string;
  hint: string;
  /** The choices it offers (options of a select, buttons of a segmented control). */
  words: string;
  /** Only for the island on the screen: not offered with the Launcher (settings.css .island-only). */
  island?: boolean;
}

interface Stored {
  version: string;
  language: string;
  entries: SettingsEntry[];
}

// «.3»: `island` per row, no longer per whole tab (26 Nov 2026); an older index is built again.
const KEY = "easyisland.settings.index.3";

export function saveSettingsIndex(version: string, language: string, entries: SettingsEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ version, language, entries } satisfies Stored));
  } catch {
    // Storage full or unavailable: the search simply finds no settings.
  }
}

/** The index as last built, or null; `version`/`language` tell whether it is current. */
export function loadSettingsIndex(): Stored | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Stored;
    return Array.isArray(v?.entries) ? v : null;
  } catch {
    return null;
  }
}

/** Lower case, no accents: «Città» is found typing «citta». */
export const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const words = (s: string) => fold(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);

/**
 * How well an entry answers the words typed (0: not at all). Every word must
 * start a word of the entry; in its name counts most, then section/tab/page,
 * then the description and the choices. «posizione ricerca», «davanti al cliente».
 */
export function scoreEntry(e: SettingsEntry, query: string): number {
  const q = words(query).filter((w) => w.length > 1 || /\d/.test(w));
  if (!q.length) return 0;
  const name = words(e.label);
  const place = words(`${e.section} ${e.tabLabel} ${e.pageLabel}`);
  const rest = words(`${e.hint} ${e.words}`);
  // «scuro» finds «Scura», «posizioni» finds «Posizione»: long words lose their last letter.
  const has = (list: string[], w: string) => list.some((x) => x.startsWith(w) || (w.length >= 5 && x.startsWith(w.slice(0, -1))));
  let total = 0;
  let missing = 0;
  for (const w of q) {
    if (has(name, w)) total += 3;
    else if (has(place, w)) total += 2;
    else if (has(rest, w)) total += 1;
    else missing++;
  }
  // With two words or more, one may be missing («posizione ricerca» → «Ricerca da sola»), at a cost.
  if (missing > (q.length >= 2 ? 1 : 0)) return 0;
  if (missing) {
    // Only when the other words are in its name.
    if (!q.some((w) => has(name, w))) return 0;
    total -= 1;
  }
  // The whole name typed from its start: on top.
  if (fold(e.label).startsWith(fold(query.trim()))) total += 4;
  return total;
}

/** The best entries for the words typed, best first. */
/** `launcher`: the Launcher is in use, what is only for the island on the screen is left out. */
export function searchSettings(entries: SettingsEntry[], query: string, max = 30, launcher = false): { entry: SettingsEntry; score: number }[] {
  if (launcher) entries = entries.filter((e) => !e.island);
  const exact = entries
    .map((entry) => ({ entry, score: scoreEntry(entry, query) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.entry.label.length - b.entry.label.length)
    .slice(0, max);
  if (exact.length >= max) return exact;
  // Few found: the ones a typo would have missed («notifiche» typed «notifche»), after them (fuzzy.ts).
  const seen = new Set(exact.map((x) => x.entry));
  const more = fuzzyFilter(entries, (e) => `${e.label} ${e.section} ${e.tabLabel} ${e.pageLabel}`, query, max)
    .filter((e) => !seen.has(e))
    .map((entry) => ({ entry, score: 0.5 }));
  return [...exact, ...more].slice(0, max);
}

/** «Impostazioni → Aspetto → Posizione»: where an entry lives, for a result's second line. */
export function entryPath(e: SettingsEntry): string {
  return [e.pageLabel, e.tabLabel, e.section && e.section !== e.label ? e.section : ""].filter(Boolean).join(" › ");
}
