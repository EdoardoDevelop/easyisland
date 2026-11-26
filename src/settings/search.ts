// The search of the settings (Edoardo, 19 Nov 2026: «la ricerca nelle
// impostazioni»): a field at the top of the menu (Ctrl+F) over every control
// of every page and tab. The index is read from the controls themselves —
// each page drawn off screen, its rows collected — so it never falls behind
// the pages; it is kept in localStorage for the island's field too
// (src/core/settings-index.ts).

import { h, clear } from "../views/dom";
import { t, tn } from "../core/i18n";
import { entryPath, loadSettingsIndex, saveSettingsIndex, searchSettings, type SettingsEntry } from "../core/settings-index";

/** What the search needs from the settings page (main.ts). */
export interface SearchDeps {
  /** Every page: id, its name in the menu, and its sections drawn now. */
  pages(): { id: string; label: string; sections: () => HTMLElement[] }[];
  /** The tabs of Aspetto (drawn one at a time, unlike the other pages' tabs), also those the Launcher hides. */
  lookTabs(): [string, string][];
  /** A tab of Aspetto only for the island on the screen (hidden with the Launcher). */
  islandOnlyTab(tab: string): boolean;
  /** The Launcher is in use: what is only for the island is not offered. */
  launcher(): boolean;
  /** Runs `fn` with that tab of Aspetto as the one drawn; puts the old one back. */
  withLookTab<T>(tab: string, fn: () => T): T;
  /** Shows that page on that tab (render()), with that integration open when `item` is one. */
  show(page: string, tab: string, item: string): void;
  /** The window's root, where the drawn page is. */
  root: HTMLElement;
  version(): string;
  language(): string;
  /** The index was built now (its pages drawn off screen): the window draws its page again. */
  rebuilt(): void;
}

let deps: SearchDeps | null = null;
let entries: SettingsEntry[] = [];
let query = "";
let picked = 0;

const field = h("input", {
  class: "settings-search",
  type: "search",
  placeholder: t("Cerca nelle impostazioni…"),
  "aria-label": t("Cerca nelle impostazioni"),
  spellcheck: "false",
}) as HTMLInputElement;
const results = h("div", { class: "settings-results", role: "listbox", "aria-label": t("Impostazioni trovate") });

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** A title's own words, without its chips («Posizione», not «Posizione» and the chip's text). */
function ownText(el: Element | null | undefined): string {
  if (!el) return "";
  const copy = el.cloneNode(true) as Element;
  copy.querySelectorAll(".chip, .badge, .subtab-badge, button").forEach((x) => x.remove());
  return clean(copy.textContent);
}

/**
 * The controls drawn in `scope`: every row with a label, with its tab,
 * section, description and choices. `page` and `pageLabel` name where they are.
 */
function collect(scope: HTMLElement, page: string, pageLabel: string, lookTab?: [string, string]): { entry: SettingsEntry; el: HTMLElement }[] {
  const out: { entry: SettingsEntry; el: HTMLElement }[] = [];
  const seen = new Map<string, number>();
  // The names of the tabs of createSubtabs: the buttons of a .subtabs, in the order of their panels.
  const tabLabel = new Map<string, string>();
  for (const bar of scope.querySelectorAll<HTMLElement>(".subtabs")) {
    const names = [...bar.querySelectorAll<HTMLElement>(".subtab")].map((b) => clean(b.querySelector("span")?.textContent ?? b.textContent));
    let el = bar.nextElementSibling;
    let i = 0;
    while (el && !el.classList.contains("subtabs")) {
      const tab = (el as HTMLElement).dataset?.tab;
      if (el.classList.contains("subtab-panel") && tab) tabLabel.set(tab, names[i++] ?? tab);
      el = el.nextElementSibling;
    }
  }
  const add = (el: HTMLElement, label: string, hint: string, words: string) => {
    if (!label || label.length > 90) return;
    const panel = el.closest<HTMLElement>(".subtab-panel");
    const tab = lookTab?.[0] ?? panel?.dataset.tab ?? "";
    const tLabel = lookTab?.[1] ?? (tab ? tabLabel.get(tab) ?? "" : "");
    // Inside an integration («Telegram → Token»): its name is the section, and it is opened to get there.
    const integration = el.closest<HTMLElement>(".int-row");
    const item = integration?.dataset.item ?? "";
    const sectionEl = el.closest("section");
    const head = sectionEl?.querySelector(":scope > h2, :scope > h3, :scope > header h2, :scope > .section-head h2");
    const section = integration && integration !== el ? ownText(integration.querySelector(".int-row-name")) : ownText(head);
    const base = `${page}|${tab}|${label}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    // Only for the island on the screen: its row, its section or its whole tab of Aspetto (main.ts island-only).
    const island = !!el.closest(".island-only") || (!!lookTab && !!deps?.islandOnlyTab(lookTab[0]));
    out.push({
      el,
      entry: { key: `${base}#${n}|${item}`, page, pageLabel, tab, tabLabel: tLabel, section, label, hint: hint.slice(0, 400), words: words.slice(0, 300), island },
    });
  };
  // Rows: «label + control + hint».
  for (const row of scope.querySelectorAll<HTMLElement>(".row")) {
    const label = ownText(row.querySelector(":scope > label"));
    if (!label) continue;
    const hint = [...row.querySelectorAll<HTMLElement>(":scope > .hint, :scope > .hint .hint, :scope > .hint > span")]
      .map((x) => clean(x.textContent)).filter((x, i, all) => x && all.indexOf(x) === i).join(" ");
    const words = [...row.querySelectorAll<HTMLElement>("option, .seg button, .choice button, [role=radio]")]
      .map((x) => clean(x.textContent)).filter(Boolean).join(" ");
    add(row, label, hint, words);
  }
  // Integrations: their row, by name (Telegram, Zammad, 3CX…).
  for (const row of scope.querySelectorAll<HTMLElement>(".int-row")) {
    add(row, ownText(row.querySelector(".int-row-name")), clean(row.querySelector(".int-hint, .int-summary")?.textContent), "");
  }
  // Section titles: a whole section (Davanti al cliente, Memoria…).
  for (const head of scope.querySelectorAll<HTMLElement>("section > h2, section > h3")) {
    const sectionEl = head.closest("section") as HTMLElement;
    const hint = clean(sectionEl.querySelector(":scope > .hint")?.textContent);
    add(sectionEl, ownText(head), hint, "");
  }
  return out;
}

/** Every page drawn off screen, one after the other, and their controls collected. */
function build(): SettingsEntry[] {
  if (!deps) return [];
  const all: SettingsEntry[] = [];
  const box = h("div", { style: "position:absolute;left:-10000px;top:0;width:900px;visibility:hidden", "aria-hidden": "true" });
  document.body.append(box);
  try {
    for (const p of deps.pages()) {
      const looks = p.id === "aspetto" ? deps.lookTabs() : [null];
      for (const look of looks) {
        clear(box);
        try {
          const sections = look ? deps.withLookTab(look[0], () => p.sections()) : p.sections();
          box.append(...sections);
          all.push(...collect(box, p.id, p.label, look ?? undefined).map((x) => x.entry));
        } catch (err) {
          console.warn("settings index", p.id, err);
        }
      }
    }
  } finally {
    box.remove();
  }
  return all;
}

/**
 * The index for this version and language: the stored one when it is current,
 * else built now and stored. `force`: built again anyway.
 */
export function ensureIndex(force = false): SettingsEntry[] {
  if (!deps) return entries;
  const stored = loadSettingsIndex();
  if (!force && stored && stored.version === deps.version() && stored.language === deps.language() && stored.entries.length) {
    entries = stored.entries;
    return entries;
  }
  entries = build();
  if (entries.length) saveSettingsIndex(deps.version(), deps.language(), entries);
  return entries;
}

/** Goes to a control: its page and tab, then it is scrolled into view and lit for a moment. */
export function gotoEntry(key: string) {
  if (!deps) return;
  const [page = "", tab = "", , item = ""] = key.split("|");
  clearSearch();
  deps.show(page, tab, item);
  const pageLabel = "";
  let tries = 0;
  const find = () => {
    const scope = deps!.root.querySelector<HTMLElement>(".page");
    if (!scope) return;
    const look: [string, string] | undefined = page === "aspetto" ? [tab, ""] : undefined;
    const drawn = collect(scope, page, pageLabel, look);
    const bare = (k: string) => k.replace(/#\d+\|/, "|");
    const hit = drawn.find((x) => x.entry.key === key)
      // The same name without its count (a list changed meanwhile).
      ?? drawn.find((x) => bare(x.entry.key) === bare(key));
    if (!hit) {
      // Parts drawn a moment later (keys, lists): look again a few times.
      if (++tries < 8) window.setTimeout(find, 120);
      return;
    }
    hit.el.closest<HTMLElement>("details:not([open])")?.setAttribute("open", "");
    hit.el.scrollIntoView({ block: "center" });
    hit.el.classList.add("goto");
    window.setTimeout(() => hit.el.classList.remove("goto"), 1800);
  };
  requestAnimationFrame(find);
}

/** The stored index is for this version and language. */
export function indexIsCurrent(): boolean {
  if (!deps) return false;
  const stored = loadSettingsIndex();
  return !!stored && stored.version === deps.version() && stored.language === deps.language() && stored.entries.length > 0;
}

/** Searching now: main.ts draws the results instead of the page. */
export function searching(): boolean {
  return query.trim().length > 0;
}

function clearSearch() {
  query = "";
  field.value = "";
  picked = 0;
}

/** The results in the page's place. */
export function resultsView(): HTMLElement {
  clear(results);
  const found = searchSettings(ensureIndex(), query, 40, !!deps?.launcher());
  picked = Math.min(picked, Math.max(0, found.length - 1));
  const head = h("header", { class: "page-head" },
    h("h1", { text: t("Cerca: «{q}»", { q: query.trim() }) }),
    h("div", { class: "hint", text: found.length
      ? tn("{n} impostazione trovata · Invio apre la prima, le frecce scelgono, Esc torna indietro", "{n} impostazioni trovate · Invio apre la prima, le frecce scelgono, Esc torna indietro", found.length)
      : t("Niente: prova con un'altra parola, anche più corta («posiz», «cliente», «tema»).") }));
  found.forEach(({ entry }, i) => {
    const b = h("button", { class: i === picked ? "settings-hit on" : "settings-hit", role: "option", "aria-selected": String(i === picked) },
      h("span", { class: "settings-hit-label", text: entry.label }),
      h("span", { class: "settings-hit-path", text: entryPath(entry) }),
      entry.hint ? h("span", { class: "settings-hit-hint", text: entry.hint }) : "") as HTMLButtonElement;
    b.addEventListener("click", () => gotoEntry(entry.key));
    results.append(b);
  });
  return h("div", { class: "page-inner settings-search-page" }, head, results);
}

/** The field at the top of the menu; the same element at every render (it keeps focus and text). */
export function searchField(onChange: () => void): HTMLElement {
  // In the language of now (the module is read before the app's language is known).
  field.placeholder = t("Cerca nelle impostazioni…");
  field.setAttribute("aria-label", t("Cerca nelle impostazioni"));
  results.setAttribute("aria-label", t("Impostazioni trovate"));
  // A full redraw (the page again) takes the field out and back: it keeps the keyboard.
  const keep = (run: () => void) => {
    const had = document.activeElement === field;
    run();
    if (had && document.activeElement !== field) field.focus();
  };
  field.oninput = () => {
    query = field.value;
    picked = 0;
    keep(onChange);
  };
  field.onkeydown = (e) => {
    const hits = [...results.querySelectorAll<HTMLButtonElement>(".settings-hit")];
    if (e.key === "Escape") {
      if (!field.value) return;
      e.preventDefault();
      clearSearch();
      keep(onChange);
    } else if (e.key === "Enter") {
      e.preventDefault();
      hits[picked]?.click();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!hits.length) return;
      e.preventDefault();
      picked = (picked + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length;
      hits.forEach((b, i) => {
        b.classList.toggle("on", i === picked);
        b.setAttribute("aria-selected", String(i === picked));
      });
      hits[picked]?.scrollIntoView({ block: "nearest" });
    }
  };
  // The index is ready before the first letter (built at most once per version and language):
  // built now, the page is drawn again so its controls are the ones on screen.
  field.onfocus = () => {
    if (indexIsCurrent() && entries.length) return;
    if (indexIsCurrent()) {
      ensureIndex();
      return;
    }
    ensureIndex();
    keep(() => deps?.rebuilt());
  };
  return h("div", { class: "settings-search-wrap" }, field);
}

/** Ctrl+F anywhere in the window: the field. */
export function watchCtrlF() {
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === "f") {
      e.preventDefault();
      field.focus();
      field.select();
    }
  });
}

export function setupSearch(d: SearchDeps) {
  deps = d;
}
