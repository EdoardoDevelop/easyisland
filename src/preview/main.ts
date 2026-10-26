// The preview window (preview.rs): tabs of files and web pages next to the
// chat. This page draws the tabs, the bar and the files; a web page (or an
// HTML / PDF file) is a real browser that preview.rs lays over the content
// area this page reports (`previewLayout`). While one of this page's own
// panels covers that area, the browser is hidden (`covered`).

import "./preview.css";
import { Bridge, IS_TAURI, onDragDrop, onEvent } from "../core/bridge";
import { locale, syncLanguage, t } from "../core/i18n";
import { renderMarkdown } from "../core/markdown";
import { h, clear } from "../views/dom";
import { codeHtml, csvRows, diffLines, escapeHtml, hunks } from "./code";
import { DEMO, demoFile } from "./demo";
import type { ConsoleLine, DevServer, FileView, PreviewState, PreviewTab, PreviewView } from "./types";

type Mode = "preview" | "code" | "changes";

let state: PreviewState = IS_TAURI ? { tabs: [], active: 0, view: { preset: "fit", width: 0, height: 0, scheme: "" } } : DEMO;
/** The last read of each file tab, by path. */
const files = new Map<string, FileView>();
/** The view picked for each file tab (else the default for its kind). */
const modes = new Map<number, Mode>();
let consoleOpen = false;
let consoleLines: ConsoleLine[] = [];
let serversOpen = false;
let servers: DevServer[] = [];
let menuOpen = false;

const root = document.getElementById("preview-root")!;

// ── Bar ──────────────────────────────────────────────────────────────────────

const tabsBox = h("div", { class: "pv-tabs", role: "tablist" });
const plusBtn = h("button", { class: "pv-plus", text: "+", title: t("Nuova scheda (Ctrl+T)") }) as HTMLButtonElement;
const backBtn = iconBtn("←", t("Indietro (Alt+←)"));
const fwdBtn = iconBtn("→", t("Avanti (Alt+→)"));
const reloadBtn = iconBtn("↻", t("Ricarica (Ctrl+R)"));
const address = h("input", {
  class: "pv-address", type: "text", spellcheck: "false",
  placeholder: t("Indirizzo (localhost:5173, https://…) o percorso di un file"),
}) as HTMLInputElement;
const modesBox = h("div", { class: "pv-seg pv-modes" });
const deviceBox = h("div", { class: "pv-seg pv-devices" });
const schemeBox = h("div", { class: "pv-seg pv-schemes" });
const consoleBtn = h("button", { class: "pv-btn pv-console-btn", title: t("Console della pagina") }) as HTMLButtonElement;
const moreBtn = iconBtn("⋯", t("Altro"));
const bar = h("div", { class: "pv-bar" }, backBtn, fwdBtn, reloadBtn, address, modesBox, deviceBox, schemeBox, consoleBtn, moreBtn);

const stage = h("div", { class: "pv-stage" });
const content = h("div", { class: "pv-content" });
const overlay = h("div", { class: "pv-overlay" });
stage.append(content, overlay);
const consoleBox = h("div", { class: "pv-console" });
const menu = h("div", { class: "pv-menu" });

root.append(h("div", { class: "pv-head" }, tabsBox, plusBtn), bar, stage, consoleBox, menu);

function iconBtn(text: string, title: string): HTMLButtonElement {
  return h("button", { class: "pv-btn pv-icon", text, title }) as HTMLButtonElement;
}

const DEVICES: { id: PreviewView["preset"]; name: string; hint: string }[] = [
  { id: "fit", name: t("Adatta"), hint: t("Tutta la finestra") },
  { id: "desktop", name: "Desktop", hint: "1280 × 800" },
  { id: "tablet", name: "Tablet", hint: "768 × 1024" },
  { id: "mobile", name: t("Telefono"), hint: "375 × 812" },
];
const SCHEMES: { id: PreviewView["scheme"]; name: string; hint: string }[] = [
  { id: "", name: t("Auto"), hint: t("I colori scelti dalla pagina") },
  { id: "light", name: "☀", hint: t("Pagina in modalità chiara") },
  { id: "dark", name: "☾", hint: t("Pagina in modalità scura") },
];

// ── State ────────────────────────────────────────────────────────────────────

function active(): PreviewTab | undefined {
  return state.tabs.find((tb) => tb.id === state.active);
}

function extOf(path: string): string {
  const m = /\.([A-Za-z0-9]+)$/.exec(path);
  return m ? m[1].toLowerCase() : "";
}

/** The views a file offers, the first being its default. */
function modesFor(tab: PreviewTab): Mode[] {
  if (tab.kind !== "file") return [];
  const ext = extOf(tab.target);
  const f = files.get(tab.target);
  const changes = f?.before != null ? (["changes"] as Mode[]) : [];
  if (ext === "pdf") return ["preview"];
  if (f?.kind === "image") return ["preview"];
  if (tab.browser || ["md", "markdown", "csv", "tsv"].includes(ext)) return ["preview", "code", ...changes];
  return ["code", ...changes];
}

function modeOf(tab: PreviewTab): Mode {
  const list = modesFor(tab);
  const picked = modes.get(tab.id);
  if (picked && list.includes(picked)) return picked;
  // A file the chat just changed opens on its changes.
  if (list.includes("changes")) return "changes";
  return list[0] ?? "preview";
}

/** Whether the browser layer shows for the active tab. */
function browserShown(): boolean {
  const tab = active();
  if (!tab || !tab.browser) return false;
  return tab.kind === "web" || modeOf(tab) === "preview";
}

// ── Drawing ──────────────────────────────────────────────────────────────────

function drawTabs(): void {
  clear(tabsBox);
  for (const tab of state.tabs) {
    const icon = tab.kind === "web" ? "◍" : fileIcon(tab.target);
    const close = h("span", { class: "pv-tab-x", text: "×", title: t("Chiudi (Ctrl+W)") });
    const el = h("div", {
      class: "pv-tab" + (tab.id === state.active ? " on" : "") + (tab.loading ? " loading" : ""),
      role: "tab", title: tab.target,
    },
    h("span", { class: "pv-tab-icon", text: icon }),
    h("span", { class: "pv-tab-name", text: tab.title || tab.target }),
    tab.errors > 0 ? h("span", { class: "pv-tab-err", text: String(tab.errors), title: t("Errori nella console") }) : null,
    close);
    el.addEventListener("mousedown", (e) => {
      if (e.button === 1) {
        e.preventDefault();
        void closeTab(tab.id);
      }
    });
    el.addEventListener("click", (e) => {
      if (e.target === close) void closeTab(tab.id);
      else void select(tab.id);
    });
    tabsBox.append(el);
  }
}

function fileIcon(path: string): string {
  const ext = extOf(path);
  if (["png", "jpg", "jpeg", "gif", "webp", "svg", "bmp", "ico", "avif"].includes(ext)) return "▣";
  if (["md", "markdown", "txt"].includes(ext)) return "¶";
  if (["csv", "tsv"].includes(ext)) return "▦";
  if (ext === "pdf") return "▤";
  if (["html", "htm"].includes(ext)) return "◇";
  return "‹›";
}

function segment(box: HTMLElement, items: { id: string; name: string; hint: string }[], current: string, pick: (id: string) => void): void {
  clear(box);
  for (const it of items) {
    const b = h("button", { class: it.id === current ? "on" : "", text: it.name, title: it.hint }) as HTMLButtonElement;
    b.addEventListener("click", () => pick(it.id));
    box.append(b);
  }
}

function drawBar(): void {
  const tab = active();
  const web = !!tab && tab.browser;
  if (document.activeElement !== address) address.value = tab?.target ?? "";
  backBtn.disabled = fwdBtn.disabled = !tab || tab.kind !== "web";
  reloadBtn.disabled = !tab;
  // File views.
  const list = tab ? modesFor(tab) : [];
  modesBox.style.display = list.length > 1 ? "" : "none";
  const names: Record<Mode, string> = { preview: t("Anteprima"), code: t("Codice"), changes: t("Modifiche") };
  if (tab && list.length > 1) {
    const f = files.get(tab.target);
    segment(modesBox, list.map((m) => ({ id: m, name: m === "changes" && f?.before != null ? `${names[m]} ${changeCount(f)}` : names[m], hint: "" })), modeOf(tab), (m) => {
      modes.set(tab.id, m as Mode);
      draw();
    });
  }
  // Device and colours: for what the browser shows.
  const showWeb = web && browserShown();
  deviceBox.style.display = schemeBox.style.display = showWeb ? "" : "none";
  segment(deviceBox, DEVICES, state.view.preset, (id) => void Bridge.previewView(id, state.view.scheme));
  segment(schemeBox, SCHEMES, state.view.scheme, (id) => void Bridge.previewView(state.view.preset, id, state.view.width, state.view.height));
  consoleBtn.style.display = tab?.browser ? "" : "none";
  const errors = tab?.errors ?? 0;
  consoleBtn.textContent = errors > 0 ? `${t("Console")} · ${errors}` : t("Console");
  consoleBtn.classList.toggle("bad", errors > 0);
  consoleBtn.classList.toggle("on", consoleOpen);
  moreBtn.disabled = !tab;
  document.title = tab ? `${tab.title || tab.target} — ${t("Anteprima")}` : `${t("Anteprima")} — EasyIsland`;
}

function changeCount(f: FileView): string {
  const d = diffLines(f.before ?? "", f.text);
  const add = d.filter((l) => l.op === "+").length;
  const del = d.filter((l) => l.op === "-").length;
  return `+${add} −${del}`;
}

function drawContent(): void {
  clear(content);
  content.className = "pv-content";
  const tab = active();
  if (!tab) {
    drawEmpty();
    return;
  }
  if (tab.kind === "web" || (tab.browser && modeOf(tab) === "preview")) {
    // The browser covers this; it shows only while it loads or when hidden.
    content.classList.add("pv-under");
    content.append(h("div", { class: "pv-wait", text: tab.loading ? t("Caricamento…") : "" }));
    if (!IS_TAURI) content.append(demoBrowser(tab));
    return;
  }
  const f = files.get(tab.target);
  if (!f) {
    content.append(h("div", { class: "pv-wait", text: t("Caricamento…") }));
    void loadFile(tab.target);
    return;
  }
  switch (f.kind) {
    case "missing":
      content.append(note(t("Il file non c'è più."), f.path));
      return;
    case "binary":
      content.append(note(t("Non è un file di testo."), t("Aprilo con il suo programma da ⋯ → Apri fuori.")));
      return;
    case "big":
      content.append(note(t("File troppo grande per l'anteprima."), `${(f.size / 1048576).toFixed(1)} MB`));
      return;
    case "image": {
      const img = h("img", { class: "pv-image", src: f.dataUrl, alt: f.name }) as HTMLImageElement;
      img.addEventListener("click", () => img.classList.toggle("full"));
      content.classList.add("pv-checker");
      content.append(img);
      return;
    }
  }
  const mode = modeOf(tab);
  if (mode === "changes") content.append(changesView(f));
  else if (mode === "preview" && ["md", "markdown"].includes(f.ext)) content.append(markdownView(f));
  else if (mode === "preview" && ["csv", "tsv"].includes(f.ext)) content.append(csvView(f));
  else content.append(codeView(f));
}

function note(title: string, sub: string): HTMLElement {
  return h("div", { class: "pv-note" }, h("strong", { text: title }), h("span", { text: sub }));
}

function codeView(f: FileView): HTMLElement {
  const { numbers, lines, cut } = codeHtml(f.text, f.ext);
  const box = h("div", { class: "pv-code" },
    h("pre", { class: "pv-gutter", text: numbers }),
    h("pre", { class: "pv-lines", html: lines }));
  return cut ? h("div", {}, box, h("div", { class: "pv-cut", text: t("Mostrate le prime 20.000 righe.") })) : box;
}

function markdownView(f: FileView): HTMLElement {
  const box = h("article", { class: "pv-md md" });
  box.append(...renderMarkdown(f.text, {
    openUrl: (url: string) => void Bridge.previewOpen(url, true),
  }));
  return box;
}

function csvView(f: FileView): HTMLElement {
  const rows = csvRows(f.text);
  const table = h("table", { class: "pv-table" });
  rows.forEach((r, i) => {
    const tr = h("tr");
    tr.append(h(i === 0 ? "th" : "td", { class: "pv-rowno", text: i === 0 ? "" : String(i) }));
    for (const c of r) tr.append(h(i === 0 ? "th" : "td", { text: c }));
    table.append(tr);
  });
  return h("div", { class: "pv-table-box" }, table, rows.length >= 1000 ? h("div", { class: "pv-cut", text: t("Mostrate le prime 1000 righe.") }) : null);
}

function changesView(f: FileView): HTMLElement {
  const all = diffLines(f.before ?? "", f.text);
  const shown = hunks(all);
  const box = h("div", { class: "pv-diff" });
  if (!shown.length) {
    box.append(note(t("Nessuna modifica."), ""));
    return box;
  }
  const rows: string[] = [];
  for (const l of shown) {
    if (!l) {
      rows.push(`<div class="pv-d gap"><span></span><span></span><span>⋯</span></div>`);
      continue;
    }
    const cls = l.op === "+" ? "add" : l.op === "-" ? "del" : "";
    rows.push(`<div class="pv-d ${cls}"><span>${l.old || ""}</span><span>${l.new || ""}</span><span>${l.op === " " ? " " : l.op} ${escapeHtml(l.text)}</span></div>`);
  }
  box.innerHTML = rows.join("");
  return box;
}

function drawEmpty(): void {
  content.classList.add("pv-empty");
  const list = h("div", { class: "pv-servers" });
  const box = h("div", { class: "pv-welcome" },
    h("div", { class: "pv-welcome-mark" }),
    h("h1", { text: t("Anteprima") }),
    h("p", { text: t("File e pagine web accanto alla chat. Scrivi un indirizzo o un percorso qui sopra, trascina qui un file, oppure clicca un link o un file in un messaggio della chat.") }),
    h("p", { class: "pv-hint", text: t("Con la Modalità terminale i file che la chat modifica si aprono qui da soli, con le modifiche evidenziate.") }),
    list);
  content.append(box);
  void Bridge.previewServers().then((found) => {
    servers = found ?? (IS_TAURI ? [] : [{ url: "http://localhost:5173/", port: 5173, process: "node.exe" }]);
    clear(list);
    if (!servers.length) return;
    list.append(h("div", { class: "pv-label", text: t("Server di sviluppo in ascolto") }));
    for (const s of servers) list.append(serverRow(s));
  });
}

function serverRow(s: DevServer): HTMLElement {
  const b = h("button", { class: "pv-server" },
    h("span", { class: "pv-dot" }),
    h("strong", { text: `localhost:${s.port}` }),
    h("span", { text: s.process })) as HTMLButtonElement;
  b.addEventListener("click", () => {
    closeOverlays();
    void open(s.url, true);
  });
  return b;
}

function drawOverlay(): void {
  clear(overlay);
  overlay.classList.toggle("on", serversOpen);
  if (!serversOpen) return;
  const list = h("div", { class: "pv-pop" },
    h("div", { class: "pv-label", text: t("Apri in una nuova scheda") }));
  const input = h("input", { class: "pv-address", type: "text", spellcheck: "false", placeholder: t("Indirizzo o percorso…") }) as HTMLInputElement;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && input.value.trim()) {
      closeOverlays();
      void open(input.value.trim(), true);
    } else if (e.key === "Escape") closeOverlays();
  });
  list.append(input);
  const found = h("div", {});
  list.append(found);
  overlay.append(list);
  window.setTimeout(() => input.focus(), 0);
  void Bridge.previewServers().then((s) => {
    servers = s ?? [];
    if (servers.length) found.append(h("div", { class: "pv-label", text: t("Server di sviluppo in ascolto") }));
    for (const sv of servers) found.append(serverRow(sv));
  });
}

function drawConsole(): void {
  consoleBox.classList.toggle("on", consoleOpen && !!active()?.browser);
  clear(consoleBox);
  if (!consoleOpen) return;
  const tab = active();
  const clearBtn = h("button", { class: "pv-btn", text: t("Svuota") }) as HTMLButtonElement;
  clearBtn.addEventListener("click", () => {
    if (tab) void Bridge.previewConsoleClear(tab.id);
    consoleLines = [];
    drawConsole();
  });
  const closeBtn = iconBtn("×", t("Chiudi la console"));
  closeBtn.addEventListener("click", () => {
    consoleOpen = false;
    draw();
  });
  const list = h("div", { class: "pv-console-list" });
  if (!consoleLines.length) list.append(h("div", { class: "pv-console-empty", text: t("Nessun messaggio.") }));
  for (const l of consoleLines) {
    list.append(h("div", { class: `pv-cl ${l.level}` }, h("span", { class: "pv-cl-at", text: l.at }), h("span", { text: l.text })));
  }
  consoleBox.append(h("div", { class: "pv-console-head" }, h("strong", { text: t("Console") }), h("span", { class: "pv-spacer" }), clearBtn, closeBtn), list);
  list.scrollTop = list.scrollHeight;
}

function drawMenu(): void {
  clear(menu);
  menu.classList.toggle("on", menuOpen);
  const tab = active();
  if (!menuOpen || !tab) return;
  menu.style.top = `${moreBtn.getBoundingClientRect().bottom + 4}px`;
  const item = (label: string, act: () => void) => {
    const b = h("button", { text: label }) as HTMLButtonElement;
    b.addEventListener("click", () => {
      closeOverlays();
      act();
    });
    menu.append(b);
  };
  if (tab.kind === "web") {
    item(t("Apri nel browser"), () => void Bridge.previewExternal(tab.target, false));
    item(t("Copia indirizzo"), () => void navigator.clipboard.writeText(tab.target).catch(() => undefined));
  } else {
    item(t("Apri fuori"), () => void Bridge.previewExternal(tab.target, false).catch(showError));
    item(t("Mostra nella cartella"), () => void Bridge.previewExternal(tab.target, true).catch(showError));
    item(t("Copia percorso"), () => void navigator.clipboard.writeText(tab.target).catch(() => undefined));
  }
  if (tab.browser) item(t("Strumenti per sviluppatori"), () => void Bridge.previewDevtools(tab.id).catch(showError));
  item(t("Chiudi le altre schede"), () => {
    for (const other of state.tabs) if (other.id !== tab.id) void Bridge.previewClose(other.id);
  });
}

function draw(): void {
  drawTabs();
  drawBar();
  drawContent();
  drawOverlay();
  drawConsole();
  drawMenu();
  report();
}

// ── The browser layer's place ────────────────────────────────────────────────

let lastReport = "";
function report(): void {
  const r = stage.getBoundingClientRect();
  const covered = serversOpen || menuOpen || !browserShown();
  const key = `${r.left},${r.top},${r.width},${r.height},${covered}`;
  if (key === lastReport) return;
  lastReport = key;
  void Bridge.previewLayout(r.left, r.top, r.width, r.height, covered);
}
new ResizeObserver(() => report()).observe(stage);
window.addEventListener("resize", () => report());

// ── Actions ──────────────────────────────────────────────────────────────────

async function refresh(): Promise<void> {
  const s = await Bridge.previewState();
  if (s) state = s;
  const tab = active();
  if (tab?.browser && consoleOpen) consoleLines = (await Bridge.previewConsole(tab.id)) ?? [];
  draw();
}

async function loadFile(path: string): Promise<void> {
  const f = IS_TAURI ? await Bridge.previewFile(path) : demoFile(path);
  if (!f) return;
  files.set(path, f);
  const tab = active();
  if (tab?.target === path) draw();
}

async function open(target: string, newTab: boolean): Promise<void> {
  try {
    await Bridge.previewOpen(target, newTab);
  } catch (e) {
    showError(e);
  }
}

async function select(id: number): Promise<void> {
  closeOverlays(false);
  if (!IS_TAURI) {
    state.active = id;
    draw();
    return;
  }
  await Bridge.previewSelect(id);
}

async function closeTab(id: number): Promise<void> {
  if (!IS_TAURI) {
    state.tabs = state.tabs.filter((tb) => tb.id !== id);
    if (state.active === id) state.active = state.tabs[0]?.id ?? 0;
    draw();
    return;
  }
  await Bridge.previewClose(id);
}

function closeOverlays(redraw = true): void {
  serversOpen = false;
  menuOpen = false;
  if (redraw) {
    drawOverlay();
    drawMenu();
    report();
  }
}

let errorTimer = 0;
const toast = h("div", { class: "pv-toast" });
root.append(toast);
function showError(e: unknown): void {
  toast.textContent = String(e).replace(/^Error:\s*/, "");
  toast.classList.add("on");
  window.clearTimeout(errorTimer);
  errorTimer = window.setTimeout(() => toast.classList.remove("on"), 4000);
}

backBtn.addEventListener("click", () => { const tb = active(); if (tb) void Bridge.previewNav(tb.id, "back").catch(showError); });
fwdBtn.addEventListener("click", () => { const tb = active(); if (tb) void Bridge.previewNav(tb.id, "forward").catch(showError); });
reloadBtn.addEventListener("click", () => reload());
function reload(): void {
  const tb = active();
  if (!tb) return;
  if (tb.kind === "file") {
    files.delete(tb.target);
    if (!tb.browser || modeOf(tb) !== "preview") {
      drawContent();
      return;
    }
  }
  void Bridge.previewNav(tb.id, "reload").catch(showError);
}
address.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const v = address.value.trim();
    if (!v) return;
    const tb = active();
    if (tb?.kind === "web") void Bridge.previewNav(tb.id, v).catch(showError);
    else void open(v, false);
    address.blur();
  } else if (e.key === "Escape") {
    address.value = active()?.target ?? "";
    address.blur();
  }
});
address.addEventListener("focus", () => address.select());
plusBtn.addEventListener("click", () => {
  menuOpen = false;
  serversOpen = !serversOpen;
  drawMenu();
  drawOverlay();
  report();
});
overlay.addEventListener("click", (e) => {
  if (e.target === overlay) closeOverlays();
});
consoleBtn.addEventListener("click", async () => {
  consoleOpen = !consoleOpen;
  const tb = active();
  if (consoleOpen && tb) consoleLines = (await Bridge.previewConsole(tb.id)) ?? [];
  draw();
});
moreBtn.addEventListener("click", () => {
  serversOpen = false;
  menuOpen = !menuOpen;
  drawOverlay();
  drawMenu();
  report();
});
document.addEventListener("click", (e) => {
  if (menuOpen && !menu.contains(e.target as Node) && e.target !== moreBtn) closeOverlays();
});

document.addEventListener("keydown", (e) => {
  const tb = active();
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === "l") {
    e.preventDefault();
    address.focus();
  } else if ((ctrl && e.key.toLowerCase() === "r") || e.key === "F5") {
    e.preventDefault();
    reload();
  } else if (ctrl && e.key.toLowerCase() === "w") {
    e.preventDefault();
    if (tb) void closeTab(tb.id);
  } else if (ctrl && e.key.toLowerCase() === "t") {
    e.preventDefault();
    plusBtn.click();
  } else if (ctrl && e.key === "Tab" && state.tabs.length > 1) {
    e.preventDefault();
    const i = state.tabs.findIndex((x) => x.id === state.active);
    const next = state.tabs[(i + (e.shiftKey ? -1 : 1) + state.tabs.length) % state.tabs.length];
    void select(next.id);
  } else if (e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight") && tb?.kind === "web") {
    e.preventDefault();
    void Bridge.previewNav(tb.id, e.key === "ArrowLeft" ? "back" : "forward");
  } else if (e.key === "Escape" && (serversOpen || menuOpen)) {
    closeOverlays();
  }
});

// ── Events from preview.rs ───────────────────────────────────────────────────

void onEvent<PreviewState>("preview-tabs", (s) => {
  const before = state.active;
  state = s;
  // Tabs that closed take their files with them.
  for (const path of [...files.keys()]) if (!s.tabs.some((tb) => tb.target === path)) files.delete(path);
  if (before !== s.active && consoleOpen) {
    const tb = active();
    if (tb) void Bridge.previewConsole(tb.id).then((l) => { consoleLines = l ?? []; drawConsole(); });
  }
  draw();
});
void onEvent<string>("preview-file", (path) => {
  if (!files.has(path)) return;
  void loadFile(path);
});
void onEvent<number>("preview-console", (id) => {
  if (!consoleOpen || id !== state.active) return;
  void Bridge.previewConsole(id).then((l) => { consoleLines = l ?? []; drawConsole(); });
});
// A file dropped on the window opens in a tab (drop.rs gives the real paths).
void onDragDrop((e) => {
  root.classList.toggle("dropping", e.type === "enter" || e.type === "over");
  if (e.type === "drop") for (const path of e.paths ?? []) void open(path, true);
}, () => true);

// ── Start ────────────────────────────────────────────────────────────────────

async function start(): Promise<void> {
  const info = await Bridge.boot();
  if (info) syncLanguage(info.settings.language);
  document.documentElement.lang = locale().slice(0, 2);
  await refresh();
}

void start();
// The demo's browser tab, in a plain browser (npm run dev).
function demoBrowser(tab: PreviewTab): HTMLElement {
  return h("div", { class: "pv-demo-web" },
    h("div", { class: "pv-demo-nav" }, h("strong", { text: "Studio Rossi" }), h("span", { text: t("Servizi") }), h("span", { text: t("Contatti") })),
    h("div", { class: "pv-demo-hero" }, h("h2", { text: t("Assistenza informatica per il tuo studio") }), h("p", { text: tab.target }), h("button", { text: t("Richiedi un preventivo") })));
}
