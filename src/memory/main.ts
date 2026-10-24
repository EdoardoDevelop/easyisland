// The memory window (Impostazioni → Chat → Memoria → «Mappa»): the memory of
// brain.rs drawn four ways — Timeline, Knowledge Graph, Mind Map, Concept
// Map — with the picked thing on the right, and «Leggi adesso» / «Controlla»
// to hand the agent the sources to learn and the fixes to propose.

import "./memory.css";
import { Bridge, IS_TAURI, onEvent } from "../core/bridge";
import { t } from "../core/i18n";
import { h, clear } from "../views/dom";
import { KIND_COLOR, Model, kindName, type MemGraph, type NodeKind } from "./data";
import { Stage, type View } from "./stage";
import { GraphView } from "./graph";
import { MindMapView } from "./mindmap";
import { ConceptView } from "./concept";
import { TimelineView } from "./timeline";

type Tab = "timeline" | "graph" | "mind" | "concept";

const TABS: { id: Tab; name: string; hint: string }[] = [
  { id: "graph", name: t("Grafo"), hint: t("Ogni pagina, nota, fonte e giorno di chat, uniti dai collegamenti. Clic per vedere, rotellina per lo zoom, doppio clic per vedere tutto.") },
  { id: "mind", name: t("Mappa mentale"), hint: t("Un argomento al centro e ciò che ne nasce. Clic su un ramo per portarlo al centro.") },
  { id: "concept", name: t("Mappa concettuale"), hint: t("Le pagine a livelli, con le frecce che dicono come sono legate («- relazione: [[Pagina]]»).") },
  { id: "timeline", name: t("Timeline"), hint: t("La memoria nel tempo. Rotellina per lo zoom sul tempo, trascina per spostarti.") },
];

const views: Record<Tab, View> = {
  timeline: new TimelineView(),
  graph: new GraphView(),
  mind: new MindMapView(),
  concept: new ConceptView(),
};

let model: Model | null = null;
let tab: Tab = remembered();
let selected: string | null = null;
let query = "";

const root = document.getElementById("memory-root")!;
const tabButtons = new Map<Tab, HTMLButtonElement>();
const tabsBox = h("div", { class: "mem-tabs" });
for (const tb of TABS) {
  const b = h("button", { text: tb.name }) as HTMLButtonElement;
  b.addEventListener("click", () => show(tb.id));
  tabButtons.set(tb.id, b);
  tabsBox.append(b);
}
const search = h("input", { class: "mem-search", type: "search", placeholder: t("Cerca nella memoria…") }) as HTMLInputElement;
const inboxBtn = h("button", { title: t("Apri la cartella dei file da far imparare") }) as HTMLButtonElement;
const readBtn = h("button", { text: t("Leggi adesso"), title: t("Un compito legge i file di da-leggere e scrive le pagine") }) as HTMLButtonElement;
const checkBtn = h("button", { text: t("Controlla"), title: t("Un compito controlla la memoria e ti propone come sistemarla") }) as HTMLButtonElement;
const reloadBtn = h("button", { text: "↻", title: t("Aggiorna") }) as HTMLButtonElement;
const bar = h("div", { class: "mem-bar" },
  h("div", { class: "mem-title" }, h("i"), h("span", { text: t("Memoria") })),
  tabsBox, search, h("span", { class: "mem-spacer" }), inboxBtn, readBtn, checkBtn, reloadBtn);

const stageBox = h("div", { class: "mem-stage" });
const tip = h("div", { class: "mem-tip" });
const empty = h("div", { class: "mem-empty" });
const hint = h("div", { class: "mem-hint" });
const legend = h("div", { class: "mem-legend" });
for (const kind of ["page", "missing", "note", "source", "day", "old"] as NodeKind[]) {
  legend.append(h("span", {}, h("i", { style: `background:${KIND_COLOR[kind]}` }), h("span", { text: kindName(kind) })));
}
const panel = h("aside", { class: "mem-panel" });
root.append(bar, h("div", { class: "mem-main" }, stageBox, panel));

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
  if (asked === "timeline" || asked === "graph" || asked === "mind" || asked === "concept") return asked;
  try {
    const v = localStorage.getItem("easyisland.memory.tab");
    if (v === "timeline" || v === "graph" || v === "mind" || v === "concept") return v;
  } catch {
    /* no storage */
  }
  return "graph";
}

function show(next: Tab) {
  tab = next;
  try {
    localStorage.setItem("easyisland.memory.tab", next);
  } catch {
    /* no storage */
  }
  for (const [id, b] of tabButtons) b.classList.toggle("on", id === next);
  hint.textContent = TABS.find((x) => x.id === next)!.hint;
  legend.style.display = next === "timeline" ? "none" : "flex";
  hint.classList.toggle("low", next === "timeline");
  const view = views[next];
  view.setSelected(selected);
  stage.show(view);
  showEmpty();
}

function showEmpty() {
  clear(empty);
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
  selected = id;
  for (const v of Object.values(views)) v.setSelected(id);
  stage.wake();
  renderPanel();
}

// ── The panel ────────────────────────────────────────────────────────────────

const feedback = h("div", { class: "mem-feedback" });

function renderPanel() {
  clear(panel);
  const n = selected ? model?.byId.get(selected) : null;
  if (!model || !n) {
    renderOverview();
    return;
  }
  panel.append(
    h("span", { class: "mem-chip" }, h("i", { style: `background:${KIND_COLOR[n.kind]}` }), h("span", { text: [kindName(n.kind), n.date].filter(Boolean).join(" · ") })),
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
        h("small", { text: nb.label ? (nb.out ? `${nb.label} →` : `← ${nb.label}`) : "" })) as HTMLButtonElement;
      b.addEventListener("click", () => select(other.id));
      list.append(b);
    }
    panel.append(list);
  }
  const row = h("div", { class: "mem-row" });
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
  panel.append(h("h3", { text: t("Da leggere") }));
  if (g?.inbox.length) {
    const ul = h("ul", { class: "mem-list" });
    for (const f of g.inbox.slice(0, 30)) ul.append(h("li", { text: f }));
    panel.append(ul, h("div", { class: "mem-note", text: t("«Leggi adesso» le fa leggere all'agente, che ne scrive le pagine collegate e sposta i file in fonti. Lo fa anche il riordino della sera.") }));
  } else {
    panel.append(h("div", { class: "mem-note", text: t("Nessun file. Metti nella cartella da-leggere articoli, appunti, trascrizioni o mail (.md, .txt, .html, .eml…): l'agente ne ricava pagine collegate, con la fonte.") }));
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

async function load() {
  if (loading) return;
  loading = true;
  try {
    let g: MemGraph | null = await Bridge.memoryGraph();
    if (!g && !IS_TAURI) g = (await import("./demo")).demoGraph();
    if (!g) return;
    model = new Model(g);
    const asked = new URLSearchParams(location.search).get("select");
    if (asked && !loadedAt && model.byId.has(asked)) selected = asked;
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
  } finally {
    loading = false;
  }
}

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

// Fresh data when the window is opened again or comes back to the front.
void onEvent("memory-refresh", () => void load());
window.addEventListener("focus", () => {
  if (Date.now() - loadedAt > 5000) void load();
});

show(tab);
void load();
