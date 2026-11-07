// The memory window (Impostazioni → Chat → Memoria → «Mappa»): the memory of
// brain.rs drawn many ways — the graphs (flat, 3D, galaxy, living network,
// bubbles, rings), the maps, the river of subjects, where it comes from and
// the timeline — with the picked thing on the right, filters over them
// (kinds from the legend, period, only sure links, colours by kind or group),
// «Come sono collegati?» between two nodes, and «Leggi adesso» / «Collega con
// l'IA» / «Controlla» to hand the agent the sources, the links and the fixes.

import "./memory.css";
import { Bridge, IS_TAURI, onEvent } from "../core/bridge";
import { t } from "../core/i18n";
import { h, clear } from "../views/dom";
import { KIND_COLOR, Model, kindName, pathBetween, type MemGraph, type MemNode, type NodeKind } from "./data";
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

type Tab = "timeline" | "graph" | "graph3d" | "galaxy" | "neural" | "bubbles" | "sunburst" | "mind" | "concept" | "stream" | "sankey";

const TABS: { id: Tab; name: string; hint: string }[] = [
  { id: "graph", name: t("Grafo"), hint: t("Ogni pagina, nota, fonte e giorno di chat, uniti dai collegamenti (tratteggiati quelli solo stimati). Clic per vedere, rotellina per lo zoom, doppio clic su un nodo per mettere a fuoco lui e i vicini, sullo sfondo per vedere tutto.") },
  { id: "graph3d", name: t("Grafo 3D"), hint: t("Lo stesso grafo nello spazio. Trascina per girarlo, rotellina per lo zoom, clic per vedere, doppio clic per vedere tutto.") },
  { id: "galaxy", name: t("Galassia"), hint: t("Ogni gruppo è una galassia del suo colore: le pagine nel nucleo, le note lungo i bracci. Le note nuove brillano; cercando si accende la scia fra le stelle trovate.") },
  { id: "neural", name: t("Rete neurale"), hint: t("La memoria come neuroni: quando la chat, Agent Chat o un altro PC la leggono o la scrivono, gli impulsi corrono verso ciò che toccano. Clic su un neurone per mandarne uno.") },
  { id: "bubbles", name: t("Bolle"), hint: t("Una bolla per gruppo, grande quanto ciò che contiene, con dentro le sue pagine e note.") },
  { id: "sunburst", name: t("Raggiera"), hint: t("Al centro la memoria, intorno le pagine larghe quanto le loro note, fuori le note di ogni pagina.") },
  { id: "mind", name: t("Mappa mentale"), hint: t("Un argomento al centro e ciò che ne nasce. Clic su un ramo per portarlo al centro.") },
  { id: "concept", name: t("Mappa concettuale"), hint: t("Le pagine a livelli, con le frecce che dicono come sono legate («- relazione: [[Pagina]]»).") },
  { id: "stream", name: t("Fiume"), hint: t("Gli argomenti nel tempo: ogni gruppo è una striscia larga quanto se ne è scritto in quella settimana. Rotellina per lo zoom sul tempo.") },
  { id: "sankey", name: t("Da dove arriva"), hint: t("Da dove arriva la memoria (chat, Agent Chat, altro PC, ticket, mail, chiamate, file letti) e in quali pagine finisce.") },
  { id: "timeline", name: t("Timeline"), hint: t("La memoria nel tempo. Rotellina per lo zoom sul tempo, trascina per spostarti.") },
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
// The views in one menu (Edoardo, 4 Nov 2026: eleven tabs took a whole line).
const viewPick = h("select", { class: "mem-select mem-view-pick", title: t("Come disegnare la memoria") }) as HTMLSelectElement;
for (const tb of TABS) viewPick.append(h("option", { value: tb.id, text: tb.name }));
viewPick.addEventListener("change", () => show(viewPick.value as Tab));
// Which memory, shown only when another PC's is copied here.
const sourcesBox = h("div", { class: "mem-tabs mem-sources", style: "display:none" });
const search = h("input", { class: "mem-search", type: "search", placeholder: t("Cerca nella memoria…") }) as HTMLInputElement;
const inboxBtn = h("button", { text: t("Da leggere"), title: t("Apri la cartella dei file da far imparare") }) as HTMLButtonElement;
const readBtn = h("button", { text: t("Leggi adesso"), title: t("Un compito legge i file di da-leggere e scrive le pagine") }) as HTMLButtonElement;
const linkBtn = h("button", { text: t("Collega con l'IA"), title: t("Il motore per la memoria crea le pagine degli argomenti, le relazioni tra pagine e i riassunti con gli altri nomi (solo aggiunte)") }) as HTMLButtonElement;
const checkBtn = h("button", { text: t("Controlla"), title: t("Un compito controlla la memoria e ti propone come sistemarla") }) as HTMLButtonElement;
const reloadBtn = h("button", { text: "↻", title: t("Aggiorna") }) as HTMLButtonElement;
const bar = h("div", { class: "mem-bar" },
  h("div", { class: "mem-title" }, h("i"), h("span", { text: t("Memoria") })),
  sourcesBox, search, h("span", { class: "mem-spacer" }), inboxBtn, readBtn, linkBtn, checkBtn, reloadBtn);
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
const viewBar = h("div", { class: "mem-viewbar" }, h("span", { class: "mem-view-label", text: t("Vista") }), viewPick, colourPick, periodPick, sureLabel);

const stageBox = h("div", { class: "mem-stage" });
const tip = h("div", { class: "mem-tip" });
const empty = h("div", { class: "mem-empty" });
const hint = h("div", { class: "mem-hint" });
const legend = h("div", { class: "mem-legend" });
// The legend also filters: a click hides that kind from every view.
function renderLegend() {
  clear(legend);
  for (const kind of ["page", "missing", "note", "source", "day", "old"] as NodeKind[]) {
    const off = filters.hidden.includes(kind);
    const b = h("button", { class: off ? "off" : "", title: off ? t("Mostra di nuovo") : t("Nascondi questo tipo") },
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
    if (n) tip.append(h("div", { text: n.label }), h("small", { text: [kindName(n.kind), n.date].filter(Boolean).join(" · ") }));
    else tip.append(h("div", { text }), h("small", { text: sub ?? "" }));
    tip.style.display = "block";
    const box = stageBox.getBoundingClientRect();
    tip.style.left = `${Math.min((x ?? 0) + 14, box.width - 350)}px`;
    tip.style.top = `${Math.min((y ?? 0) + 14, box.height - 60)}px`;
  },
});
stageBox.append(legend, hint, empty, tip);

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

/** «Questo PC», one button per other PC and «Tutte», when there is another PC. */
function renderSources(names: string[]) {
  clear(sourcesBox);
  sourcesBox.style.display = names.length ? "flex" : "none";
  if (!names.length) return;
  const choices: [string, string, string][] = [
    ["", t("Questo PC"), t("La memoria di questo PC")],
    ...names.map((n): [string, string, string] => [n, n, t("La copia della memoria di {name}, che arriva da Agent Chat", { name: n })]),
    ["*", t("Tutte"), t("Questo PC e le memorie degli altri PC insieme")],
  ];
  for (const [id, name, title] of choices) {
    const b = h("button", { text: name, title }) as HTMLButtonElement;
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
  viewPick.value = next;
  hint.textContent = TABS.find((x) => x.id === next)!.hint;
  legend.style.display = next === "timeline" ? "none" : "flex";
  hint.classList.toggle("low", next === "timeline");
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
    const b = h("button", {}, h("i", { style: `background:${KIND_COLOR[n.kind]}` }), h("span", { text: n.label }), h("small", { text: kindName(n.kind) })) as HTMLButtonElement;
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
    h("span", { class: "mem-chip" }, h("i", { style: `background:${KIND_COLOR[n.kind]}` }), h("span", { text: [kindName(n.kind), n.date, originOf(n.id) && t("memoria di {name}", { name: originOf(n.id) })].filter(Boolean).join(" · ") })),
    h("h2", { text: n.label }),
  );
  if (n.text) panel.append(h("div", { class: "mem-text", text: n.text }));
  if (n.kind === "missing") panel.append(h("div", { class: "mem-note", text: t("Altre pagine la citano ma non è ancora stata scritta: «Controlla» propone di crearla.") }));
  const links = model.neighbours(n.id);
  if (links.length) {
    panel.append(h("h3", { text: t("Collegamenti ({n})", { n: links.length }) }));
    const list = h("div", { class: "mem-links" });
    for (const nb of links.slice(0, 80)) {
      const other = model.byId.get(nb.id);
      if (!other) continue;
      const b = h("button", {},
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
      const b = h("button", {}, h("i", { style: "background:#f4505e" }), h("span", { text: n.label }), h("small", { text: n.date })) as HTMLButtonElement;
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
  const remember = h("input", { class: "mem-search", style: "max-width:none", placeholder: t("Ricorda… (Invio per salvare)") }) as HTMLInputElement;
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
    if (source === "*") for (const n of g.nodes) if (n.origin) n.label = `${n.label} · ${n.origin}`;
    renderSources(g.sources ?? []);
    // Reading and checking work on this PC's memory only; the links of a copy can be judged here too.
    const copy = !!source && source !== "*";
    for (const b of [inboxBtn, readBtn, checkBtn]) b.style.display = copy ? "none" : "";
    linkBtn.style.display = source === "*" ? "none" : "";
    full = g;
    model = new Model(filtered(g));
    // ?select=… on the first load; a page chosen in the island's field (memory-select) any time.
    const asked = wanted ?? new URLSearchParams(location.search).get("select");
    if (asked && (wanted || !loadedAt) && model.byId.has(asked)) selected = asked;
    wanted = null;
    for (const v of Object.values(views)) v.setModel(model);
    if (selected && !model.byId.has(selected)) selected = null;
    applySearch();
    inboxBtn.textContent = t("Da leggere ({n})", { n: g.inbox.length });
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
    feedback.textContent = t("Compito avviato: lo segui nell'isola e in Agenti. Quando ha finito, «↻» mostra il risultato.");
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

show(tab);
void load();
