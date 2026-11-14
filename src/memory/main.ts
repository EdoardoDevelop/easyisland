// The memory window (Impostazioni → Chat → Memoria → «Mappa»): the memory of
// brain.rs drawn many ways — the graphs (flat, 3D, galaxy, living network,
// bubbles, rings), the maps, the river of subjects, where it comes from and
// the timeline — with the picked thing on the right, filters over them
// (kinds from the legend, period, only sure links, colours by kind or group),
// «Come sono collegati?» between two nodes, and «Leggi adesso» / «Collega con
// l'IA» / «Controlla» to hand the agent the sources, the links and the fixes.

import "./memory.css";
import { Bridge, IS_TAURI, onEvent } from "../core/bridge";
import { syncLanguage, t } from "../core/i18n";
import { applyUiStyle } from "../core/uistyle";
import { applyMotion, watchWindow } from "../core/motion";
import { h, clear, svg } from "../views/dom";
import { ICONS } from "../views/icons";
import { KIND_COLOR, Model, kindName, pathBetween, shortDate, type MemGraph, type MemNode, type NodeKind } from "./data";
import { forgetPalette } from "./theme";
import { reserve } from "./labels";
import { Stage, type Colouring, type View } from "./stage";
import { GalaxyView } from "./galaxy";
import { NeuralView } from "./neural";
import { SunburstView } from "./sunburst";
import { StreamView } from "./stream";
import { SankeyView } from "./sankey";
import { BubblesView } from "./bubbles";
import { GraphView } from "./graph";
import { Graph3DView } from "./graph3d";
import { MindMapView } from "./mindmap";
import { ConceptView } from "./concept";
import { TimelineView } from "./timeline";
import { MatrixView } from "./matrix";
import { TreemapView } from "./treemap";
import { HealthView } from "./health";

type Tab = "timeline" | "graph" | "graph3d" | "galaxy" | "neural" | "bubbles" | "sunburst" | "mind" | "concept" | "stream" | "sankey" | "matrix" | "treemap" | "health";

const TABS: { id: Tab; name: string; group: string; hint: string }[] = [
  { id: "graph", name: t("Grafo"), group: "Grafi", hint: t("Ogni pagina, nota, fonte e giorno di chat, uniti dai collegamenti (tratteggiati quelli solo stimati). Clic per vedere, rotellina per lo zoom, doppio clic su un nodo per mettere a fuoco lui e i vicini, sullo sfondo per vedere tutto.") },
  { id: "graph3d", name: t("Grafo 3D"), group: "Grafi", hint: t("Lo stesso grafo nello spazio. Trascina per girarlo, rotellina per lo zoom, clic per vedere, doppio clic per vedere tutto.") },
  { id: "galaxy", name: t("Galassia"), group: "Grafi", hint: t("Ogni gruppo è una galassia del suo colore: le pagine nel nucleo, le note lungo i bracci. Le note nuove brillano; cercando si accende la scia fra le stelle trovate.") },
  { id: "neural", name: t("Rete neurale"), group: "Grafi", hint: t("La memoria come neuroni: quando la chat, Agent Chat o un altro PC la leggono o la scrivono, gli impulsi corrono verso ciò che toccano. Clic su un neurone per mandarne uno.") },
  { id: "mind", name: t("Mappa mentale"), group: "Mappe", hint: t("Un argomento al centro e ciò che ne nasce. Clic su un ramo per portarlo al centro.") },
  { id: "concept", name: t("Mappa concettuale"), group: "Mappe", hint: t("Le pagine a livelli, con le frecce che dicono come sono legate («- relazione: [[Pagina]]»).") },
  { id: "bubbles", name: t("Bolle"), group: "Struttura", hint: t("Una bolla per gruppo, grande quanto ciò che contiene, con dentro le sue pagine e note.") },
  { id: "sunburst", name: t("Raggiera"), group: "Struttura", hint: t("Al centro la memoria, intorno le pagine larghe quanto le loro note, fuori le note di ogni pagina.") },
  { id: "treemap", name: t("Mappa ad albero"), group: "Struttura", hint: t("I gruppi e le pagine principali in riquadri proporzionali al loro peso nella memoria.") },
  { id: "matrix", name: t("Matrice"), group: "Struttura", hint: t("Griglia delle connessioni tra le pagine principali: passa il mouse su una cella per leggere la relazione.") },
  { id: "timeline", name: t("Timeline"), group: "Tempo", hint: t("La memoria nel tempo. Rotellina per lo zoom sul tempo, trascina per spostarti.") },
  { id: "stream", name: t("Fiume"), group: "Tempo", hint: t("Gli argomenti nel tempo: ogni gruppo è una striscia larga quanto se ne è scritto in quella settimana. Rotellina per lo zoom sul tempo.") },
  { id: "sankey", name: t("Da dove arriva"), group: "Tempo", hint: t("Da dove arriva la memoria (chat, Agent Chat, altro PC, ticket, mail, chiamate, file letti) e in quali pagine finisce.") },
  { id: "health", name: t("Salute"), group: "Tempo", hint: t("Copertura delle pagine, note isolate da collegare e argomenti principali a colpo d'occhio.") },
];

const views: Record<Tab, View> = {
  timeline: new TimelineView(),
  graph: new GraphView(),
  graph3d: new Graph3DView(),
  galaxy: new GalaxyView(),
  neural: new NeuralView(),
  bubbles: new BubblesView(),
  sunburst: new SunburstView(),
  mind: new MindMapView(),
  concept: new ConceptView(),
  stream: new StreamView(),
  sankey: new SankeyView(),
  matrix: new MatrixView(),
  treemap: new TreemapView(),
  health: new HealthView(),
};
const TAB_IDS = new Set<string>(TABS.map((x) => x.id));

/** Filters over every view, remembered on this PC. */
interface Filters {
  hidden: NodeKind[];
  period: "all" | "30" | "90" | "365";
  sure: boolean;
  colours: Colouring;
}
const FILTERS_KEY = "easyisland.memory.filters";
function rememberedFilters(): Filters {
  const base: Filters = { hidden: [], period: "all", sure: false, colours: "group" };
  try {
    return { ...base, ...JSON.parse(localStorage.getItem(FILTERS_KEY) ?? "{}") };
  } catch {
    return base;
  }
}
let filters = rememberedFilters();
function saveFilters() {
  try {
    localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
  } catch {
    /* no storage */
  }
}
/** The whole memory as read; `model` is it with the filters applied. */
let full: MemGraph | null = null;
/** «Come sono collegati?»: the first node, waiting for the second; then the path. */
let pathFrom: string | null = null;
let path: string[] | null = null;

let model: Model | null = null;
let tab: Tab = remembered();
let selected: string | null = null;
let query = "";
/** Which memory: "" this PC, a name the copy of that PC's (memshare.rs), "*" both. */
let source = rememberedSource();

const root = document.getElementById("memory-root")!;

/** Line icons of the window, on the 24×24 grid of src/views/icons.ts, stroke 1.6. */
const LINE = {
  chevronDown: "M6.5 9.5 12 15l5.5-5.5",
  refresh: "M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4h-4",
  read: "M6 3.5h8l4 4v13H6zM14 3.5v4h4M9 12h6M9 15.5h6",
  link: "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1",
  check: "M12 3.5l7 2.8v5.2c0 4.2-3 7.5-7 9-4-1.5-7-4.8-7-9V6.3zM9 12l2 2 4-4",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5.5M12 7.8h.01",
  inbox: "M4 13.5h4.5l1.5 2.5h4l1.5-2.5H20M4 13.5 6.5 5h11l2.5 8.5V19H4z",
};
const icon = (path: string, size = 16) => svg(path, size, { stroke: 1.6 });

// Categorized view switcher: 4 compact category dropdowns on one row so all 14 views
// stay organized and never clip off-screen.
const GROUPS: { id: string; label: string }[] = [
  { id: "Grafi", label: t("Grafi") },
  { id: "Mappe", label: t("Mappe") },
  { id: "Struttura", label: t("Struttura") },
  { id: "Tempo", label: t("Analisi") },
];
const viewPills = h("div", { class: "mem-cats", role: "menubar", "aria-label": t("Come disegnare la memoria") });
const catMenus = new Map<string, { wrap: HTMLElement; btn: HTMLButtonElement; label: HTMLElement; menu: HTMLElement }>();
const viewMenuItems = new Map<Tab, HTMLButtonElement>();

function closeCatMenus(except?: string) {
  for (const [gid, c] of catMenus) {
    if (gid === except) continue;
    c.menu.hidden = true;
    c.btn.setAttribute("aria-expanded", "false");
  }
}

for (const g of GROUPS) {
  const wrap = h("div", { class: "mem-cat-wrap" });
  const lbl = h("span", { text: g.label });
  const btn = h("button", { class: "mem-cat-btn", "aria-haspopup": "menu", "aria-expanded": "false" }, lbl, icon(LINE.chevronDown, 13)) as HTMLButtonElement;
  const catMenu = h("div", { class: "mem-menu mem-cat-menu", role: "menu", hidden: "" });
  for (const tb of TABS.filter((x) => x.group === g.id)) {
    const item = h("button", { role: "menuitem" }, h("span", { text: tb.name }), h("small", { text: tb.hint })) as HTMLButtonElement;
    item.addEventListener("click", () => {
      closeCatMenus();
      show(tb.id);
    });
    viewMenuItems.set(tb.id, item);
    catMenu.append(item);
  }
  btn.addEventListener("click", () => {
    const opening = catMenu.hidden;
    closeCatMenus(opening ? g.id : undefined);
    catMenu.hidden = !opening;
    btn.setAttribute("aria-expanded", String(opening));
  });
  wrap.append(btn, catMenu);
  catMenus.set(g.id, { wrap, btn, label: lbl, menu: catMenu });
  viewPills.append(wrap);
}

document.addEventListener("pointerdown", (e) => {
  if (!(e.target as HTMLElement).closest(".mem-cat-wrap")) closeCatMenus();
});
// Which memory, shown only when another PC's is copied here: a segmented control.
const sourcesBox = h("div", { class: "mem-sources", role: "group", "aria-label": t("Quale memoria"), style: "display:none" });
const search = h("input", { class: "mem-search", type: "search", placeholder: t("Cerca nella memoria…"), "aria-label": t("Cerca nella memoria…") }) as HTMLInputElement;
// «Da leggere» stays in sight with its count; the agent's jobs and the reload
// go in one menu (side by side «Da leggere» and «Leggi adesso» were confusing).
const inboxCount = h("span", { class: "mem-badge zero", text: "0" });
const inboxBtn = h("button", { class: "mem-btn", title: t("Apri la cartella dei file da far imparare") }, icon(LINE.inbox), h("span", { text: t("Da leggere") }), inboxCount) as HTMLButtonElement;
const menuItem = (path: string, name: string, about: string) =>
  h("button", { role: "menuitem" }, icon(path), h("span", { text: name }), h("small", { text: about })) as HTMLButtonElement;
const readBtn = menuItem(LINE.read, t("Leggi adesso"), t("Un compito legge i file di da-leggere e scrive le pagine"));
const linkBtn = menuItem(LINE.link, t("Collega con l'IA"), t("Il motore per la memoria crea le pagine degli argomenti, le relazioni tra pagine e i riassunti con gli altri nomi (solo aggiunte)"));
const checkBtn = menuItem(LINE.check, t("Controlla"), t("Un compito controlla la memoria e ti propone come sistemarla"));
const reloadBtn = menuItem(LINE.refresh, t("Aggiorna"), t("Rilegge la memoria dai file"));
const menu = h("div", { class: "mem-menu", role: "menu", hidden: "" }, readBtn, linkBtn, checkBtn, h("hr"), reloadBtn);
const moreBtn = h("button", { class: "mem-btn mem-more", "aria-haspopup": "menu", "aria-expanded": "false" },
  h("span", { text: t("Manutenzione") }), icon(LINE.chevronDown, 14)) as HTMLButtonElement;
function openMenu(open: boolean) {
  menu.hidden = !open;
  moreBtn.setAttribute("aria-expanded", String(open));
  if (open) (menu.querySelector("button:not([disabled]):not([style*='none'])") as HTMLElement | null)?.focus();
}
moreBtn.addEventListener("click", () => openMenu(menu.hidden));
menu.addEventListener("click", (e) => {
  if ((e.target as HTMLElement).closest("button")) openMenu(false);
});
menu.addEventListener("keydown", (e) => {
  const items = [...menu.querySelectorAll<HTMLButtonElement>("button")].filter((b) => !b.disabled && b.style.display !== "none");
  const at = items.indexOf(document.activeElement as HTMLButtonElement);
  if (e.key === "Escape") {
    openMenu(false);
    moreBtn.focus();
  } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  }
});
document.addEventListener("pointerdown", (e) => {
  if (!menu.hidden && !(e.target as HTMLElement).closest(".mem-more-wrap")) openMenu(false);
});
const bar = h("div", { class: "mem-bar" },
  h("div", { class: "mem-title" }, svg(ICONS.memory, 18, { stroke: 1.6 }), h("span", { text: t("Memoria") })),
  sourcesBox, search, h("span", { class: "mem-spacer" }), inboxBtn, h("div", { class: "mem-more-wrap" }, moreBtn, menu));
// The views, and the filters over them.
const periodPick = h("select", { class: "mem-select", title: t("Solo ciò che ha una data in questo periodo (le pagine senza data restano)") }) as HTMLSelectElement;
for (const [v, label] of [["all", t("Sempre")], ["30", t("Ultimo mese")], ["90", t("Ultimi 3 mesi")], ["365", t("Ultimo anno")]] as const) periodPick.append(h("option", { value: v, text: label }));
periodPick.value = filters.period;
const colourPick = h("select", { class: "mem-select", title: t("I colori dei nodi: per tipo (pagina, nota, fonte…) o per gruppo (gli argomenti che vanno insieme)") }) as HTMLSelectElement;
for (const [v, label] of [["group", t("Colori per gruppo")], ["kind", t("Colori per tipo")]] as const) colourPick.append(h("option", { value: v, text: label }));
colourPick.value = filters.colours;
const sureBox = h("input", { type: "checkbox" }) as HTMLInputElement;
sureBox.checked = filters.sure;
const sureLabel = h("label", { class: "mem-check", title: t("Nascondi i collegamenti solo stimati dalle parole in comune: restano quelli scritti nelle pagine, le note che nominano la pagina e quelli controllati dall'IA") }, sureBox, h("span", { text: t("Solo collegamenti sicuri") }));
// How to use the view: shown over the stage until the first use, then behind ⓘ.
const infoBtn = h("button", { class: "mem-icon", title: t("Come si usa questa vista"), "aria-label": t("Come si usa questa vista"), "aria-pressed": "false" }, icon(LINE.info)) as HTMLButtonElement;
const viewBar = h("div", { class: "mem-viewbar" }, viewPills, colourPick, periodPick, sureLabel, infoBtn);

const stageBox = h("div", { class: "mem-stage" });
const tip = h("div", { class: "mem-tip" });
const empty = h("div", { class: "mem-empty" });
const hint = h("div", { class: "mem-hint", role: "note" });
const HINTED_KEY = "easyisland.memory.hinted";
let hinted = (() => {
  try {
    return localStorage.getItem(HINTED_KEY) === "1";
  } catch {
    return false;
  }
})();
function showHint(on: boolean) {
  hint.hidden = !on;
  infoBtn.setAttribute("aria-pressed", String(on));
  keepClear();
}
/** The legend and the hint over the stage: the views keep their labels out from under them. */
const zoomOutBtn = h("button", { text: "−", title: t("Riduci") }) as HTMLButtonElement;
const zoomInBtn = h("button", { text: "+", title: t("Ingrandisci") }) as HTMLButtonElement;
const zoomFitBtn = h("button", { text: t("Adatta"), title: t("Mostra tutto") }) as HTMLButtonElement;
const zoomDock = h("div", { class: "mem-zoom-dock" }, zoomOutBtn, zoomInBtn, zoomFitBtn);
zoomOutBtn.addEventListener("click", () => stage.zoomBy(0.8));
zoomInBtn.addEventListener("click", () => stage.zoomBy(1.25));
zoomFitBtn.addEventListener("click", () => stage.resetView());

function keepClear() {
  requestAnimationFrame(() => {
    const at = stageBox.getBoundingClientRect();
    const rects = [legend, hint, zoomDock]
      .filter((el) => !el.hidden && el.style.display !== "none" && el.isConnected)
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0)
      .map((r) => ({ x0: r.left - at.left - 4, y0: r.top - at.top - 4, x1: r.right - at.left + 4, y1: r.bottom - at.top + 4 }));
    reserve(rects);
    stage.wake();
  });
}
showHint(!hinted);
infoBtn.addEventListener("click", () => showHint(hint.hidden));
// The first click, drag or wheel on the stage: the hint has done its job.
function used() {
  if (!hint.hidden) showHint(false);
  if (hinted) return;
  hinted = true;
  try {
    localStorage.setItem(HINTED_KEY, "1");
  } catch {
    /* no storage */
  }
}
stageBox.addEventListener("pointerdown", used);
stageBox.addEventListener("wheel", used, { passive: true });
const legend = h("div", { class: "mem-legend", role: "group", "aria-label": t("Tipi: clic per nascondere o mostrare") });
// The legend also filters: a click hides that kind from every view. Only the
// kinds the memory has (an empty «Nota archiviata» said nothing).
function renderLegend() {
  clear(legend);
  const present = new Set(full?.nodes.map((n) => n.kind) ?? []);
  for (const kind of ["page", "missing", "note", "source", "day", "old"] as NodeKind[]) {
    if (full && !present.has(kind) && !filters.hidden.includes(kind)) continue;
    const off = filters.hidden.includes(kind);
    const b = h("button", { class: off ? "off" : "", title: off ? t("Mostra di nuovo") : t("Nascondi questo tipo"), "aria-pressed": String(!off) },
      h("i", { style: `background:${KIND_COLOR[kind]}` }), h("span", { text: kindName(kind) }));
    b.addEventListener("click", () => {
      filters.hidden = off ? filters.hidden.filter((k) => k !== kind) : [...filters.hidden, kind];
      saveFilters();
      renderLegend();
      applyFilters();
    });
    legend.append(b);
  }
}
renderLegend();
const clearWatch = new ResizeObserver(() => keepClear());
clearWatch.observe(legend);
clearWatch.observe(stageBox);
const panel = h("aside", { class: "mem-panel" });
root.append(bar, viewBar, h("div", { class: "mem-main" }, stageBox, panel));

const stage = new Stage(stageBox, {
  select: (id) => select(id),
  tip: (text, sub, x, y) => {
    if (!text) {
      tip.style.display = "none";
      return;
    }
    // A node id: its label and kind.
    const n = model?.byId.get(text);
    clear(tip);
    if (n) tip.append(h("div", { text: n.label }), h("small", { text: [kindName(n.kind), shortDate(n.date)].filter(Boolean).join(" · ") }));
    else tip.append(h("div", { text }), h("small", { text: sub ?? "" }));
    tip.style.display = "block";
    const box = stageBox.getBoundingClientRect();
    tip.style.left = `${Math.min((x ?? 0) + 14, box.width - 350)}px`;
    tip.style.top = `${Math.min((y ?? 0) + 14, box.height - 60)}px`;
  },
});
stageBox.append(legend, zoomDock, hint, empty, tip);

function remembered(): Tab {
  // ?tab=… (screenshots, smoke) wins.
  const asked = new URLSearchParams(location.search).get("tab");
  if (asked && TAB_IDS.has(asked)) return asked as Tab;
  try {
    const v = localStorage.getItem("easyisland.memory.tab");
    if (v && TAB_IDS.has(v)) return v as Tab;
  } catch {
    /* no storage */
  }
  return "graph";
}

function rememberedSource(): string {
  const asked = new URLSearchParams(location.search).get("source");
  if (asked !== null) return asked;
  try {
    return localStorage.getItem("easyisland.memory.source") ?? "";
  } catch {
    return "";
  }
}

/** The origin of Claude Code's own notes (cc_memory.rs). */
const CLAUDE_CODE = "claude-code";

/** «Questo PC», one button per other PC (and Claude Code) and «Tutte», when there is one. */
function renderSources(names: string[]) {
  clear(sourcesBox);
  sourcesBox.style.display = names.length ? "flex" : "none";
  if (!names.length) return;
  const choices: [string, string, string][] = [
    ["", t("Questo PC"), t("La memoria di questo PC")],
    ...names.map((n): [string, string, string] => n === CLAUDE_CODE
      ? [n, "Claude Code", t("Le note che Claude Code salva da solo, di ogni account: si leggono soltanto")]
      : [n, n, t("La copia della memoria di {name}, che arriva da Agent Chat", { name: n })]),
    ["*", t("Tutte"), t("Questo PC e le memorie degli altri PC insieme")],
  ];
  for (const [id, name, title] of choices) {
    const b = h("button", { text: name, title, "aria-pressed": String(id === source) }) as HTMLButtonElement;
    b.classList.toggle("on", id === source);
    b.addEventListener("click", () => {
      if (id === source) return;
      source = id;
      try {
        localStorage.setItem("easyisland.memory.source", id);
      } catch {
        /* no storage */
      }
      selected = null;
      void load();
    });
    sourcesBox.append(b);
  }
}

/** The PC a node comes from, for the chip. */
function originOf(id: string): string {
  return model?.byId.get(id)?.origin ?? "";
}

function show(next: Tab) {
  tab = next;
  try {
    localStorage.setItem("easyisland.memory.tab", next);
  } catch {
    /* no storage */
  }
  const activeTab = TABS.find((x) => x.id === next)!;
  for (const g of GROUPS) {
    const c = catMenus.get(g.id)!;
    const isHere = activeTab.group === g.id;
    c.btn.classList.toggle("on", isHere);
    c.label.textContent = isHere ? `${g.label} · ${activeTab.name}` : g.label;
  }
  for (const [id, item] of viewMenuItems) item.classList.toggle("on", id === next);
  hint.textContent = activeTab.hint;
  infoBtn.title = hint.textContent;
  legend.style.display = next === "timeline" || next === "stream" || next === "sankey" || next === "health" ? "none" : "flex";
  keepClear();
  const view = views[next];
  view.setSelected(selected);
  stage.show(view);
  showEmpty();
}

/** Why the memory could not be read, shown instead of «vuota» (which would not be true). */
let loadError = "";

function showEmpty() {
  clear(empty);
  if (!model && !loadError && !loadedAt) {
    // Still reading: a big memory takes a moment, and it is not empty.
    empty.style.display = "grid";
    empty.append(h("div", {}, h("b", { text: t("Leggo la memoria…") })));
    return;
  }
  if (loadError && !model) {
    empty.style.display = "grid";
    empty.append(h("div", {}, h("b", { text: t("Non riesco a leggere la memoria") }), h("div", { text: loadError })));
    return;
  }
  const g = model?.g;
  const nothing = !g || (!g.nodes.length && !g.events.length);
  const noPages = tab === "concept" && !(g?.nodes.some((n) => n.kind === "page"));
  if (!nothing && !noPages) {
    empty.style.display = "none";
    return;
  }
  empty.style.display = "grid";
  empty.append(h("div", {},
    h("b", { text: nothing ? t("La memoria è ancora vuota") : t("Ancora nessuna pagina") }),
    h("div", { text: nothing
      ? t("Si riempie usando la chat, con «/ricorda …», e con i file che metti in da-leggere.")
      : t("Le pagine nascono dai file di da-leggere («Leggi adesso») o quando chiedi alla chat di scrivere una pagina su un argomento.") })));
}

function select(id: string | null) {
  if (pathFrom && id && id !== pathFrom && model) {
    path = pathBetween(model, pathFrom, id);
    pathFrom = null;
    for (const v of Object.values(views)) v.setPath?.(path);
    feedback.textContent = path ? "" : t("Questi due non sono collegati, nemmeno passando da altri.");
  } else if (!id) {
    clearPath();
  }
  selected = id;
  for (const v of Object.values(views)) v.setSelected(id);
  stage.wake();
  renderPanel();
}

// ── The panel ────────────────────────────────────────────────────────────────

const feedback = h("div", { class: "mem-feedback" });

function clearPath() {
  pathFrom = null;
  path = null;
  for (const v of Object.values(views)) v.setPath?.(null);
}

/** «Come sono collegati?»: the path, step by step, under the node. */
function renderPath() {
  if (!path || !model) return;
  panel.append(h("h3", { text: t("Come sono collegati ({n} passi)", { n: path.length - 1 }) }));
  const list = h("div", { class: "mem-links" });
  for (const id of path) {
    const n = model.byId.get(id);
    if (!n) continue;
    const b = h("button", { class: "mem-link" }, h("i", { style: `background:${KIND_COLOR[n.kind]}` }), h("span", { text: n.label }), h("small", { text: kindName(n.kind) })) as HTMLButtonElement;
    b.addEventListener("click", () => {
      selected = n.id;
      for (const v of Object.values(views)) v.setSelected(n.id);
      stage.wake();
      renderPanel();
    });
    list.append(b);
  }
  const off = h("button", { text: t("Togli la strada") }) as HTMLButtonElement;
  off.addEventListener("click", () => { clearPath(); stage.wake(); renderPanel(); });
  panel.append(list, h("div", { class: "mem-row" }, off));
}

/** Between pages strength 2 is a link an engine worked out (brain.rs `Edge`). */
function inferred(a: MemNode, b: MemNode, strength: number): boolean {
  const page = (n: MemNode) => n.kind === "page" || n.kind === "missing";
  return strength === 2 && page(a) && page(b);
}

function renderPanel() {
  clear(panel);
  const n = selected ? model?.byId.get(selected) : null;
  if (!model || !n) {
    renderOverview();
    return;
  }
  panel.append(
    h("h2", { text: n.label }),
    h("span", { class: "mem-meta" }, h("i", { style: `background:${KIND_COLOR[n.kind]}` }), h("span", { text: [kindName(n.kind), shortDate(n.date), originOf(n.id) && (originOf(n.id) === CLAUDE_CODE ? t("memoria di Claude Code, si legge soltanto") : t("memoria di {name}", { name: originOf(n.id) }))].filter(Boolean).join(" · ") })),
  );
  if (n.text) panel.append(pageText(n.text, n));
  if (n.kind === "missing") panel.append(h("div", { class: "mem-note", text: t("Altre pagine la citano ma non è ancora stata scritta: «Controlla» propone di crearla.") }));
  const links = model.neighbours(n.id);
  if (links.length) {
    panel.append(h("h3", { text: t("Collegamenti ({n})", { n: links.length }) }));
    const list = h("div", { class: "mem-links" });
    for (const nb of links.slice(0, 80)) {
      const other = model.byId.get(nb.id);
      if (!other) continue;
      const b = h("button", { class: "mem-link" },
        h("i", { style: `background:${KIND_COLOR[other.kind]}` }),
        h("span", { text: other.label }),
        h("small", { text: [nb.label && (nb.out ? `${nb.label} →` : `← ${nb.label}`), inferred(n, other, nb.strength) && t("dedotto")].filter(Boolean).join(" · ") })) as HTMLButtonElement;
      b.addEventListener("click", () => select(other.id));
      list.append(b);
    }
    panel.append(list);
  }
  renderPath();
  const row = h("div", { class: "mem-row" });
  const way = h("button", { text: pathFrom === n.id ? t("Scegli l'altro nodo…") : t("Come è collegato a…"), title: t("Poi clicca un altro nodo: si illumina la strada più corta fra i due") }) as HTMLButtonElement;
  way.addEventListener("click", () => {
    clearPath();
    pathFrom = n.id;
    feedback.textContent = t("Clicca l'altro nodo nella mappa.");
    renderPanel();
  });
  row.append(way);
  if (n.kind !== "missing") {
    const open = h("button", { text: t("Apri il file") }) as HTMLButtonElement;
    open.addEventListener("click", () => void Bridge.memoryNodeOpen(n.id).catch(fail));
    row.append(open);
  }
  const back = h("button", { text: t("Panoramica") }) as HTMLButtonElement;
  back.addEventListener("click", () => select(null));
  row.append(back);
  panel.append(row, feedback);
}

function renderOverview() {
  const g = model?.g;
  const count = (kinds: NodeKind[]) => g?.nodes.filter((n) => kinds.includes(n.kind)).length ?? 0;
  const days = new Set(g?.events.filter((e) => e.lane === "diary").map((e) => e.date.slice(0, 10))).size;
  panel.append(
    h("h2", { text: t("La tua memoria") }),
    h("div", { class: "mem-stats" },
      stat(count(["page"]), t("pagine")),
      stat(count(["note"]), t("note attive")),
      stat(count(["source"]), t("fonti lette")),
      stat(days, t("giorni di chat"))),
  );
  // Another PC's copy: read only, kept fresh by Agent Chat.
  if (source && source !== "*") {
    panel.append(h("div", { class: "mem-note", text: t("Copia della memoria di {name}: si aggiorna da sola quando quel PC la cambia. Le note nuove vanno nella memoria di questo PC.", { name: source }) }), feedback);
    return;
  }
  panel.append(h("h3", { text: t("Da leggere") }));
  if (g?.inbox.length) {
    const ul = h("ul", { class: "mem-list" });
    for (const f of g.inbox.slice(0, 30)) ul.append(h("li", { text: f }));
    panel.append(ul, h("div", { class: "mem-note", text: t("«Leggi adesso» le fa leggere all'agente, che ne scrive le pagine collegate e sposta i file in fonti. Lo fa anche il riordino della sera.") }));
  } else {
    panel.append(h("div", { class: "mem-note", text: t("Nessun file. Metti nella cartella da-leggere articoli, appunti, trascrizioni o mail (.md, .txt, .html, .eml…): l'agente ne ricava pagine collegate, con la fonte.") }));
  }
  // Notes tied to nothing (red ring in the graph): to link.
  const alone = model?.lonely() ?? [];
  if (alone.length) {
    panel.append(h("h3", { text: t("Note senza collegamenti ({n})", { n: alone.length }) }));
    const list = h("div", { class: "mem-links" });
    for (const n of alone.slice(0, 12)) {
      const b = h("button", { class: "mem-link" }, h("i", { style: "background:#e84855" }), h("span", { text: n.label }), h("small", { text: shortDate(n.date) })) as HTMLButtonElement;
      b.addEventListener("click", () => select(n.id));
      list.append(b);
    }
    panel.append(list, h("div", { class: "mem-note", text: t("«Collega con l'IA» le guarda una per una e le lega alle pagine giuste, o crea la pagina dell'argomento.") }));
  }
  panel.append(h("h3", { text: t("Controllo") }));
  if (g?.check.length) {
    const ul = h("ul", { class: "mem-list" });
    for (const c of g.check.slice(0, 40)) ul.append(h("li", { text: c }));
    panel.append(ul, h("div", { class: "mem-note", text: t("«Controlla» chiede all'agente di cercare anche le contraddizioni e di proporti le correzioni: fa solo quelle che approvi, e non cancella niente.") }));
  } else {
    panel.append(h("div", { class: "mem-note", text: t("Niente da sistemare.") }));
  }
  // «Ricorda…»: a note straight into MEMORIA.md.
  const remember = h("input", { class: "mem-search", placeholder: t("Ricorda… (Invio per salvare)"), "aria-label": t("Nuova nota") }) as HTMLInputElement;
  remember.addEventListener("keydown", async (e) => {
    if (e.key !== "Enter" || !remember.value.trim()) return;
    try {
      feedback.textContent = await Bridge.memoryNoteAdd(remember.value);
      remember.value = "";
      void load();
    } catch (err) {
      fail(err);
    }
  });
  panel.append(h("h3", { text: t("Nuova nota") }), remember);
  if (g?.folder) {
    const open = h("button", { text: t("Apri la cartella della memoria") }) as HTMLButtonElement;
    open.addEventListener("click", () => void Bridge.memoryOpen(true).catch(fail));
    panel.append(h("div", { class: "mem-row" }, open));
  }
  panel.append(feedback);
}

/**
 * A page's text with its [[links]] as links: a click picks that page (a page
 * not written yet, or not in this view, stays plain but marked).
 */
function pageText(text: string, of: MemNode): HTMLElement {
  const box = h("div", { class: "mem-text" });
  const byLabel = new Map<string, string>();
  for (const x of model?.g.nodes ?? []) {
    if (x.kind !== "page" && x.kind !== "missing") continue;
    // Same PC first: in «Tutte» the other PC's page has the PC in its label.
    const key = x.label.split(" · ")[0].toLowerCase();
    if ((x.origin ?? "") === (of.origin ?? "") || !byLabel.has(key)) byLabel.set(key, x.id);
  }
  const parts = text.split(/\[\[([^\]\n]+)\]\]/);
  parts.forEach((part, i) => {
    if (i % 2 === 0) {
      if (part) box.append(part);
      return;
    }
    const name = part.split("|").pop()!.trim();
    const id = byLabel.get(part.split("|")[0].trim().toLowerCase());
    if (!id) {
      box.append(h("span", { class: "mem-wiki missing", text: name, title: t("Pagina non ancora scritta") }));
      return;
    }
    const b = h("button", { class: "mem-wiki", text: name, title: t("Vai a {name}", { name }) }) as HTMLButtonElement;
    b.addEventListener("click", () => select(id));
    box.append(b);
  });
  return box;
}

function stat(n: number, label: string) {
  return h("div", {}, h("b", { text: String(n) }), h("small", { text: label }));
}

function fail(e: unknown) {
  feedback.textContent = String(e).replace(/^Error:\s*/, "");
}

// ── Data ─────────────────────────────────────────────────────────────────────

let loading = false;
let loadedAt = 0;
/** A page asked by the island (memory-select), selected at the next load. */
let wanted: string | null = null;

async function load() {
  if (loading) return;
  loading = true;
  try {
    let g: MemGraph | null = null;
    try {
      g = await Bridge.memoryGraph(source);
      loadError = "";
    } catch (e) {
      loadError = String(e).replace(/^Error:\s*/, "") || t("errore sconosciuto");
      console.warn("memory_graph", e);
      showEmpty();
      return;
    }
    if (!g && !IS_TAURI) g = (await import("./demo")).demoGraph(source);
    if (!g) return;
    // A PC no longer there: back to this one.
    if (source && source !== "*" && !g.sources?.includes(source)) {
      source = "";
      g = (await Bridge.memoryGraph(source)) ?? (IS_TAURI ? null : (await import("./demo")).demoGraph(source));
      if (!g) return;
    }
    // Both: the other PCs' things say whose they are.
    if (source === "*") for (const n of g.nodes) if (n.origin) n.label = `${n.label} · ${n.origin === CLAUDE_CODE ? "Claude Code" : n.origin}`;
    renderSources(g.sources ?? []);
    // Reading and checking work on this PC's memory only; the links of a copy can be judged here too.
    const copy = !!source && source !== "*";
    for (const b of [inboxBtn, readBtn, checkBtn]) b.style.display = copy ? "none" : "";
    // Days of chat by the app's short date, not the file's ISO name.
    for (const n of g.nodes) if (n.kind === "day") n.label = shortDate(n.label);
    // Claude Code's notes are only read: nothing to link or check there.
    linkBtn.style.display = source === "*" || source === CLAUDE_CODE ? "none" : "";
    full = g;
    renderLegend();
    model = new Model(filtered(g));
    // ?select=… on the first load; a page chosen in the island's field (memory-select) any time.
    const asked = wanted ?? new URLSearchParams(location.search).get("select");
    if (asked && (wanted || !loadedAt) && model.byId.has(asked)) selected = asked;
    wanted = null;
    for (const v of Object.values(views)) v.setModel(model);
    if (selected && !model.byId.has(selected)) selected = null;
    applySearch();
    inboxCount.textContent = String(g.inbox.length);
    inboxCount.classList.toggle("zero", !g.inbox.length);
    inboxBtn.setAttribute("aria-label", t("Da leggere ({n})", { n: g.inbox.length }));
    readBtn.disabled = !g.inbox.length;
    showEmpty();
    renderPanel();
    stage.wake();
    loadedAt = Date.now();
    if (selected) select(selected);
    document.documentElement.dataset.ready = "1";
  } catch (e) {
    // A drawing error must not pass for an empty memory.
    loadError = String(e).replace(/^Error:\s*/, "");
    model = null;
    showEmpty();
    feedback.textContent = loadError;
  } finally {
    loading = false;
  }
}

/** The graph with the filters: kinds hidden, period, only sure links. */
function filtered(g: MemGraph): MemGraph {
  const from = filters.period === "all" ? 0 : Date.now() - Number(filters.period) * 86_400_000;
  const keep = new Set(g.nodes.filter((n) => {
    if (filters.hidden.includes(n.kind)) return false;
    if (!from || !n.date) return true;
    const d = Date.parse(n.date.slice(0, 10));
    return !Number.isFinite(d) || d >= from;
  }).map((n) => n.id));
  return {
    ...g,
    nodes: g.nodes.filter((n) => keep.has(n.id)),
    edges: g.edges.filter((e) => keep.has(e.from) && keep.has(e.to) && (!filters.sure || (e.strength ?? 3) >= 2)),
    events: g.events.filter((e) => !e.node || keep.has(e.node) || !from || Date.parse(e.date.slice(0, 10)) >= from),
  };
}

function applyFilters() {
  if (!full) return;
  clearPath();
  model = new Model(filtered(full));
  for (const v of Object.values(views)) {
    v.setModel(model);
    v.setColouring?.(filters.colours);
  }
  if (selected && !model.byId.has(selected)) selected = null;
  applySearch();
  showEmpty();
  renderPanel();
  stage.wake();
}

periodPick.addEventListener("change", () => { filters.period = periodPick.value as Filters["period"]; saveFilters(); applyFilters(); });
colourPick.addEventListener("change", () => {
  filters.colours = colourPick.value as Colouring;
  saveFilters();
  for (const v of Object.values(views)) v.setColouring?.(filters.colours);
  stage.wake();
});
sureBox.addEventListener("change", () => { filters.sure = sureBox.checked; saveFilters(); applyFilters(); });
for (const v of Object.values(views)) v.setColouring?.(filters.colours);

function applySearch() {
  const ids = query.trim() && model ? model.matches(query) : null;
  for (const v of Object.values(views)) v.setFilter(ids, query);
  stage.wake();
  return ids;
}

search.addEventListener("input", () => {
  query = search.value;
  applySearch();
});
search.addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const ids = applySearch();
  const first = ids && [...ids][0];
  if (first) select(first);
});
inboxBtn.addEventListener("click", () => void Bridge.memoryNodeOpen("inbox").catch(fail));
reloadBtn.addEventListener("click", () => void load());
const job = (kind: "inbox" | "check", btn: HTMLButtonElement) => async () => {
  feedback.textContent = "";
  btn.disabled = true;
  try {
    await Bridge.memoryJob(kind);
    feedback.textContent = t("Compito avviato: lo segui nell'isola e in Agenti. Quando ha finito, «Aggiorna» in Manutenzione mostra il risultato.");
    if (!selected) renderPanel();
  } catch (e) {
    fail(e);
  } finally {
    btn.disabled = kind === "inbox" && !model?.g.inbox.length;
  }
};
readBtn.addEventListener("click", job("inbox", readBtn));
linkBtn.addEventListener("click", async () => {
  linkBtn.disabled = true;
  feedback.textContent = t("Il motore sta collegando la memoria…");
  if (!selected) renderPanel();
  try {
    feedback.textContent = await Bridge.memoryLink(source && source !== "*" ? source : "");
    await load();
  } catch (e) {
    fail(e);
  } finally {
    linkBtn.disabled = false;
  }
});
checkBtn.addEventListener("click", job("check", checkBtn));

// Files dropped on the window go to da-leggere (read here, written by Rust:
// no paths cross over).
const drop = h("div", { class: "mem-drop", text: t("Rilascia per mettere in da-leggere") });
stageBox.append(drop);
let dragDepth = 0;
const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
window.addEventListener("dragenter", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth++;
  drop.classList.add("on");
});
window.addEventListener("dragover", (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
});
window.addEventListener("dragleave", () => {
  if (--dragDepth <= 0) {
    dragDepth = 0;
    drop.classList.remove("on");
  }
});
window.addEventListener("drop", async (e) => {
  e.preventDefault();
  dragDepth = 0;
  drop.classList.remove("on");
  const files = Array.from(e.dataTransfer?.files ?? []);
  const added: string[] = [];
  for (const f of files) {
    try {
      added.push(await Bridge.memoryInboxAdd(f.name, Array.from(new Uint8Array(await f.arrayBuffer()))));
    } catch (err) {
      fail(err);
    }
  }
  if (added.length) {
    feedback.textContent = t("In da-leggere: {list}. «Leggi adesso» per farli imparare.", { list: added.join(", ") });
    await load();
  }
});

// The memory read or written elsewhere (memory-activity, brain.rs): the living
// network lights what it touched. Words of four letters or more, any of them.
void onEvent<{ kind: "read" | "write"; text: string }>("memory-activity", (p) => {
  if (!model) return;
  const words = p.text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4).slice(0, 12);
  if (!words.length) return;
  const ids: string[] = [];
  for (const n of model.g.nodes) {
    const hay = `${n.label} ${n.text}`.toLowerCase();
    if (words.some((w) => hay.includes(w))) ids.push(n.id);
    if (ids.length >= 40) break;
  }
  for (const v of Object.values(views)) v.activity?.(ids, p.kind);
  stage.wake();
});

// Fresh data when the window is opened again or comes back to the front.
void onEvent("memory-refresh", () => void load());
// A page found from the island's field at the top: selected once loaded.
void onEvent<string>("memory-select", (id) => {
  wanted = id;
  // Found in the copy of another PC while the map shows this one, or the other way round.
  if (model && !model.byId.has(id) && source !== "*") source = "*";
  void load();
});
window.addEventListener("focus", () => {
  if (Date.now() - loadedAt > 5000) void load();
});

/**
 * The look of the island (Impostazioni → Aspetto: Windows 11 or Classico,
 * dark, light or automatic), and again when it changes. In the browser
 * preview from ?ui=classic and ?scheme=light|auto, as the island's page.
 */
async function applyLook() {
  const params = new URLSearchParams(location.search);
  const info = await Bridge.boot();
  if (info) syncLanguage(info.settings.language);
  const repaint = () => {
    forgetPalette();
    stage.wake();
  };
  const look = (style?: string, scheme?: string) => applyUiStyle(params.get("ui") ?? style, params.get("scheme") ?? scheme, repaint);
  look(info?.settings.theme.style, info?.settings.theme.scheme);
  document.body.removeAttribute("style");
  applyMotion(info?.settings);
  watchWindow(document.body, (name, run) => void onEvent(name, run));
  void onEvent<{ theme?: { style?: string; scheme?: string }; animations?: string }>("settings-changed", (s) => { look(s.theme?.style, s.theme?.scheme); applyMotion(s); });
}

void applyLook().finally(() => {
  show(tab);
  void load();
});
