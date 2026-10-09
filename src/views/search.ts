// The search bar at the bottom of the open island: one field for the
// integrations (and agents' sessions), the quick actions and the programs of
// the Start menu (start_apps.rs). The results cover the view above the bar
// while there is something typed; Enter opens the selected one, Esc clears.

import { h, svg, clear, markIcon, dot } from "./dom";
import { ICONS } from "./icons";
import { renderActionIcon } from "./action-icons";
import { tabActions } from "./actions";
import { State, isSessionTask, type QuickAction } from "../core/state";
import { Bridge } from "../core/bridge";

export interface SearchActions {
  openTask(id: string): void;
  runAction(a: QuickAction): void;
  openProgram(path: string): void;
}

interface Hit {
  kind: "Integrazione" | "Agente" | "Azione" | "Programma";
  name: string;
  icon: () => Node;
  run: () => void;
  score: number;
}

/** Lower case, no accents: "Città" is found typing "citta". */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** 3 = starts with it, 2 = a word starts with it, 1 = contains it, 0 = no. */
function score(name: string, q: string): number {
  const n = fold(name);
  if (n.startsWith(q)) return 3;
  if (n.split(/[\s\-_.()·]+/).some((w) => w.startsWith(q))) return 2;
  return n.includes(q) ? 1 : 0;
}

/** How many of each kind at most, so programs do not drown the rest. */
const LIMIT: Record<Hit["kind"], number> = { Integrazione: 4, Agente: 3, Azione: 5, Programma: 8 };

/** The Start menu, read again after this long (a program installed meanwhile). */
const APPS_TTL_MS = 5 * 60_000;

export interface SearchHost {
  el: HTMLElement;
  /** Results shown: they cover the view, so the island must not close under them. */
  readonly open: boolean;
  sync(): void;
  /** Takes the keyboard: the island was opened by the user. */
  focus(): void;
}

export function buildSearch(actions: SearchActions): SearchHost {
  const input = h("input", { type: "text", class: "search-input", placeholder: "Cerca integrazioni, azioni e programmi",
    spellcheck: "false", autocomplete: "off" }) as HTMLInputElement;
  const results = h("div", { class: "search-results" });
  const bar = h("div", { class: "search-bar" }, svg(ICONS.search, 13), input);
  const el = h("div", { id: "search" }, results, bar);

  let apps: { name: string; path: string }[] = [];
  let appsAt = 0;
  let hits: Hit[] = [];
  let sel = 0;

  const loadApps = () => {
    if (performance.now() - appsAt < APPS_TTL_MS && appsAt > 0) return;
    appsAt = performance.now();
    void Bridge.startApps().then((list) => {
      apps = list;
      if (input.value.trim()) refresh();
    });
  };

  const collect = (q: string): Hit[] => {
    const out: Hit[] = [];
    for (const t of State.tasks) {
      const s = score(t.name, q);
      if (!s) continue;
      out.push({ kind: isSessionTask(t) ? "Agente" : "Integrazione", name: t.name, score: s,
        icon: () => markIcon(t.id, 14) ?? dot(t.color, 8), run: () => actions.openTask(t.id) });
    }
    for (const a of tabActions()) {
      const s = score(a.name, q);
      if (!s) continue;
      out.push({ kind: "Azione", name: a.name || "Senza nome", score: s,
        icon: () => renderActionIcon(a.icon, 14), run: () => actions.runAction(a) });
    }
    for (const p of apps) {
      const s = score(p.name, q);
      if (!s) continue;
      out.push({ kind: "Programma", name: p.name, score: s,
        icon: () => svg(ICONS.apps, 13), run: () => actions.openProgram(p.path) });
    }
    // Best match first; at equal match, the order of the kinds above.
    const kept: Hit[] = [];
    const used: Record<string, number> = {};
    for (const hit of out.sort((a, b) => b.score - a.score)) {
      used[hit.kind] = (used[hit.kind] ?? 0) + 1;
      if (used[hit.kind] <= LIMIT[hit.kind]) kept.push(hit);
    }
    return kept;
  };

  const draw = () => {
    clear(results);
    hits.forEach((hit, i) => {
      results.append(h("button", { class: i === sel ? "search-hit on" : "search-hit",
        onpointerenter: () => { sel = i; mark(); },
        onclick: () => choose(hit) },
      h("span", { class: "search-icon" }, hit.icon()),
      h("span", { class: "search-name", text: hit.name }),
      h("span", { class: "search-kind", text: hit.kind })));
    });
    if (!hits.length) results.append(h("div", { class: "search-none", text: "Nessun risultato" }));
  };

  const mark = () => {
    [...results.children].forEach((c, i) => c.classList.toggle("on", i === sel));
    (results.children[sel] as HTMLElement | undefined)?.scrollIntoView({ block: "nearest" });
  };

  const refresh = () => {
    const q = fold(input.value.trim());
    hits = q ? collect(q) : [];
    sel = 0;
    el.classList.toggle("open", !!q);
    if (q) draw();
    else clear(results);
  };

  const reset = () => {
    input.value = "";
    refresh();
  };

  const choose = (hit: Hit) => {
    reset();
    input.blur();
    hit.run();
  };

  // The island's window takes no keys until asked (as for the ⚡ search field).
  input.addEventListener("pointerdown", () => void Bridge.focusWindow(true));
  input.addEventListener("focus", () => { void Bridge.focusWindow(true); loadApps(); });
  input.addEventListener("input", refresh);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      if (input.value) reset();
      else input.blur();
    } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!hits.length) return;
      sel = (sel + (e.key === "ArrowDown" ? 1 : hits.length - 1)) % hits.length;
      mark();
    } else if (e.key === "Enter") {
      const hit = hits[sel];
      if (hit) choose(hit);
    }
  });

  return {
    el,
    get open() { return el.classList.contains("open"); },
    sync() {
      // The island closed: start again empty next time.
      if (State.mode !== "expanded" && input.value) reset();
    },
    focus() {
      void Bridge.focusWindow(true);
      input.focus();
    },
  };
}
