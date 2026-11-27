// The island built from a JSON, step 1 (docs/architettura.md → Isola da JSON):
// the buttons and the tabs the user added from the chat (isola.json,
// src-tauri/src/island_layout.rs). Buttons stand at the foot of the menu or in
// the header; a tab is a row of the menu that opens a grid of its buttons (the
// «board» view). What a button does comes from a fixed list (LayoutAction),
// never code. While a change waits on Consenti / Nega the island shows it
// (State.layout = the draft); Nega puts it back.
// Step 2: a tab also shows its blocks under its buttons: a grid or a list of
// a source's items (installed apps, open windows, quick actions, a folder),
// read when the tab opens; a value of the PC (barsys.rs, read only while the
// tab shows: bar.ts `barSysKinds`); a text. An item does what its source says
// (open the app, bring the window forward, run the action, open the file).
// Second round (23/11): more sources (recent files, the Vassoio, the clipboard's
// history, VS Code's projects, an integrazione personale's records, Notion), a
// chart of a value of the PC, and the open island's footer (`buildFoot`): three
// sides, left, center and right, each a row of buttons and values of the PC.

import { h } from "./dom";
import { State, type LayoutAction, type LayoutBlock, type LayoutButton, type LayoutFooterItem, type LayoutTab, type LayoutZone } from "../core/state";
import { Bridge, IS_TAURI, onEvent } from "../core/bridge";
import { t } from "../core/i18n";
import { chartHistory, sysValueText } from "../island/bar";
import { recordTitle } from "./custom";
import { renderActionIcon } from "./action-icons";
import { fillChat } from "./chat";
import { holds, levelColor, lookCheck } from "./island-look";
import type { ViewActions, ViewHost } from "./views";

/** A view of `view` actions: a section of the island, Impostazioni, the memory, a tab. */
function openView(to: string, actions: ViewActions) {
  if (to.startsWith("tab:")) {
    State.boardTab = to.slice(4);
    actions.setView("board");
    return;
  }
  // An integration's card, as from the menu: a built-in one by its id, one of the user's as custom:<id> (or its bare id).
  if (to.startsWith("integration:")) {
    const id = to.slice("integration:".length);
    const own = !id.startsWith("custom:") && State.customs.some((c) => c.id === id);
    State.summary = false;
    actions.setFocus(own ? `custom:${id}` : id);
    actions.setView("overview");
    return;
  }
  switch (to) {
    case "overview":
      State.summary = true;
      actions.setView("overview");
      break;
    case "agents": {
      const agent = State.latestSessionTask;
      if (agent) actions.setFocus(agent.id);
      actions.setView("overview");
      break;
    }
    case "chat":
      actions.setView("prompt");
      break;
    case "actions":
      actions.setView("actions");
      break;
    case "files":
      actions.openFiles();
      break;
    case "news":
      actions.setView("news");
      break;
    case "settings":
      actions.openSettingsWindow();
      break;
    case "memory":
      void Bridge.memoryWindowOpen();
      break;
  }
}

/** What a button does on a click. Shutdown, restart and sleep ask first (barsys.rs `power`). */
export function runLayoutAction(a: LayoutAction, actions: ViewActions) {
  actions.blip();
  const fail = (e: unknown) => actions.showNotice({ title: t("Il pulsante non ha funzionato"), text: String(e), level: "error", url: "" });
  switch (a.kind) {
    case "system":
      void Bridge.barSysDo(a.what === "taskmgr" ? "panel:taskmgr" : a.what);
      break;
    case "windows":
      void Bridge.pcPage(a.page);
      break;
    case "quick": {
      const q = (State.settings.actions ?? []).find((x) => x.id === a.id);
      if (q) actions.runAction(q);
      else fail(t("L'azione rapida non c'è più."));
      break;
    }
    case "app":
      void Bridge.actionOpenApp(a.target, a.args ?? "").catch(fail);
      break;
    case "url":
      actions.openUrl(a.url);
      break;
    case "view":
      openView(a.view, actions);
      break;
    case "chat":
      actions.openChat();
      window.setTimeout(() => fillChat(a.text), 80);
      break;
  }
}

/** A button's colour: the threshold that holds, else its own. */
function colorOf(b: LayoutButton): string {
  const lv = levelColor(b.levels);
  if (lv) return lv;
  return b.color && /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : "#8e939c";
}

/** Icon sizes by a button's `size`. */
const ICON_BY_SIZE: Record<string, number> = { s: 13, m: 16, l: 20, xl: 24 };

/** A button's look from isola.json: background, shape, size (classes in style.css, `.own-…`). */
function dress(el: HTMLElement, b: LayoutButton) {
  if (b.color || b.levels?.length) el.style.setProperty("--c", colorOf(b));
  if (b.bg) el.style.setProperty("--own-bg", b.bg);
  el.classList.toggle("own-has-bg", !!b.bg);
  if (b.shape) el.classList.add(`own-shape-${b.shape}`);
  if (b.size) el.classList.add(`own-size-${b.size}`);
}

/**
 * A small button (foot of the menu, header, footer): the icon, the label as its
 * tooltip; or the label, or both (`show`).
 */
export function layoutIconButton(b: LayoutButton, actions: ViewActions, size = 16): HTMLElement {
  const iconSize = b.size ? ICON_BY_SIZE[b.size] ?? size : size;
  const show = b.show ?? "icon";
  const icon = b.icon ? renderActionIcon(b.icon, iconSize) : h("span", { class: "own-letter", text: b.label.trim().slice(0, 1).toUpperCase() });
  const el = h("button", { class: `own-btn${show !== "icon" ? " own-labelled" : ""}`, "data-own": b.id, title: b.label, "aria-label": b.label,
    onclick: () => runLayoutAction(b.action, actions) },
  ...(show === "label" ? [] : [icon]),
  ...(show === "icon" ? [] : [h("span", { class: "own-label", text: b.label })]));
  dress(el, b);
  return el;
}

/** A tab's button: a tile like the quick actions'. `size` the tab's, unless the button says its own. */
function tile(b: LayoutButton, actions: ViewActions, tabSize?: LayoutButton["size"]): HTMLElement {
  const size = b.size ?? tabSize;
  const el = h("button", { class: "qa", "data-own": b.id, title: b.label, onclick: () => runLayoutAction(b.action, actions) },
    h("span", { class: "qa-icon" }, renderActionIcon(b.icon || "i:bolt", size ? ICON_BY_SIZE[size] ?? 18 : 18)),
    h("span", { class: "qa-name", text: b.label }));
  el.style.setProperty("--qa", colorOf(b));
  dress(el, { ...b, size });
  return el;
}

/** The buttons of one zone, in the saved order: those whose `when` holds now. */
export function zoneButtons(zone: LayoutZone): LayoutButton[] {
  return State.layout.buttons.filter((b) => b.zone === zone && holds(b.when));
}

/** The tabs of the menu whose `when` holds now. */
export function layoutTabs(): LayoutTab[] {
  return State.layout.tabs.filter((x) => holds(x.when));
}

/** The usual order of the menu's sections, the header's buttons, the Panoramica's parts (island_layout.rs). */
const MENU_USUAL = ["overview", "agents", "chat", "actions", "files", "news"];
const HEADER_USUAL = ["usage", "own", "pin", "memory", "settings", "sound"];
const OVERVIEW_USUAL = ["now", "tiles", "quick", "news"];

/**
 * Step 3: the order the menu's rows (`tab:<id>` for the user's tabs), the
 * header's buttons or the Panoramica's parts (`block:<id>` for its own blocks)
 * stand in: those the JSON names first, then the rest as usual.
 */
export function partsOrder(which: "menu" | "header" | "overview"): string[] {
  const parts = State.layout[which];
  const usual = which === "menu" ? [...MENU_USUAL, ...State.layout.tabs.map((x) => `tab:${x.id}`)]
    : which === "overview" ? [...OVERVIEW_USUAL, ...(State.layout.overview?.blocks ?? []).map((b) => `block:${b.id}`)]
    : HEADER_USUAL;
  const named = (parts?.order ?? []).filter((x) => usual.includes(x));
  return [...named, ...usual.filter((x) => !named.includes(x))];
}

/** A part hidden from the chat (`tile:<id>` for a tile of the Panoramica); never Panoramica or Impostazioni. */
export function partHidden(which: "menu" | "header" | "overview", id: string): boolean {
  return id !== "overview" && id !== "settings" && !!State.layout[which]?.hidden?.includes(id);
}

/** The Panoramica's tiles: those the JSON names first, in its order, then the rest as the menu has them. */
export function overviewTiles<T extends { id: string }>(tasks: T[]): T[] {
  const first = State.layout.overview?.tiles ?? [];
  const named = first.map((id) => tasks.find((x) => x.id === id)).filter((x): x is T => !!x);
  return [...named, ...tasks.filter((x) => !first.includes(x.id))].filter((x) => !partHidden("overview", `tile:${x.id}`));
}

/** A key that changes when what `zone` shows changes (no redraw otherwise). */
export function zoneKey(zone: LayoutZone): string {
  const list = zoneButtons(zone);
  return JSON.stringify(list) + list.map((b) => levelColor(b.levels) ?? "").join("|");
}

/** One thing a grid or a list shows, and what a click on it does. */
interface Item {
  key: string;
  name: string;
  sub?: string;
  /** An icon of the drawn set (`i:…`), an emoji, or a picture (`data:`). */
  icon: string;
  run: () => void;
}

type ItemsBlock = Extract<LayoutBlock, { kind: "grid" | "list" }>;
/** A block on screen: `refresh(true)` reads its source again, `live` follows the island's state (pieces). */
export type Part = { el: HTMLElement; refresh(read: boolean): void; live?(): void };
type PieceBlock = Extract<LayoutBlock, { kind: "piece" }>;
/** Existing pieces as blocks (an integration's card, the news, the quick actions): made in views.ts, where they live. */
let pieceMaker: ((b: PieceBlock, actions: ViewActions) => Part) | null = null;
export function setPieceMaker(make: (b: PieceBlock, actions: ViewActions) => Part) {
  pieceMaker = make;
}

/** Installed apps, read once (Start's list: applist.rs `apps_catalog`, some seconds the first time). */
let apps: { id: string; name: string }[] | null = null;
let appsLoading: Promise<void> | null = null;
/** Their icons by id in lower case, as applist.rs sends them in `apps-icons`. */
const appIcons = new Map<string, string>();
const iconsAsked = new Set<string>();
/** Called when icons or values arrive: the tab open and the Panoramica follow. */
const onData = new Set<() => void>();
let listening = false;

function listen() {
  if (listening) return;
  listening = true;
  void onEvent<Record<string, string>>("apps-icons", (p) => {
    let got = false;
    for (const [id, url] of Object.entries(p ?? {})) {
      if (url && !appIcons.has(id)) {
        appIcons.set(id, url);
        got = true;
      }
    }
    if (got) for (const f of onData) f();
  });
  void onEvent("bar-sys", () => {
    for (const f of onData) f();
    // A value that turns a condition or a threshold: the island redraws (island-look.ts),
    // after main.ts has stored the new reading.
    window.setTimeout(lookCheck, 0);
  });
}

function askIcons(ids: string[]) {
  const fresh = ids.filter((id) => !appIcons.has(id.toLowerCase()) && !iconsAsked.has(id.toLowerCase()));
  if (!fresh.length) return;
  fresh.forEach((id) => iconsAsked.add(id.toLowerCase()));
  void Bridge.appsIcons(fresh);
}

/** What each grid or list last read, by tab, block and source. */
const cache = new Map<string, Item[]>();

/** The browser preview (dev/scenes.ts): made-up items by source, nothing read. */
const samples = new Map<string, { name: string; sub?: string; icon?: string }[]>();
export function boardSample(source: string, items: { name: string; sub?: string; icon?: string }[]) {
  samples.set(source, items);
}

async function readSource(b: ItemsBlock, actions: ViewActions): Promise<Item[]> {
  const src = b.source;
  if (!IS_TAURI) {
    return (samples.get(src.kind) ?? []).map((x, i) => ({ key: String(i), name: x.name, sub: x.sub, icon: x.icon ?? (src.kind === "windows" ? "i:window" : ""), run: () => {} }));
  }
  switch (src.kind) {
    case "apps": {
      if (!apps) {
        appsLoading ??= Bridge.appsCatalog().then((l) => { apps = l; }).catch(() => { apps = []; });
        await appsLoading;
      }
      return (apps ?? []).map((a) => ({
        key: a.id, name: a.name, icon: appIcons.get(a.id.toLowerCase()) ?? "",
        run: () => void Bridge.appsDo("launch", null, a.id),
      }));
    }
    case "windows":
      return (await Bridge.pcWindows()).map((w) => ({
        key: String(w.id), name: w.title || w.appName, sub: w.title ? w.appName : undefined, icon: "i:window",
        run: () => void Bridge.pcWindowFocus(w.id),
      }));
    case "quick":
      return (State.settings.actions ?? []).map((q) => ({
        key: q.id, name: q.name, icon: q.icon || "i:bolt", run: () => actions.runAction(q),
      }));
    case "folder":
      return (await Bridge.islandFolder(src.path)).map((f) => ({
        key: f.path, name: f.name, icon: f.dir ? "i:folder" : "i:file",
        run: () => openFile(f.path, actions),
      }));
    case "recent":
      return (await Bridge.islandRecent()).map((f) => ({
        key: f.path, name: f.name, sub: f.dir, icon: "i:file", run: () => openFile(f.path, actions),
      }));
    case "tray":
      return ((await Bridge.inboxList()) ?? []).map((f) => ({
        key: f.path, name: f.name, sub: sizeText(f.size), icon: "i:file",
        run: () => void Bridge.inboxOpen(f.name, false).catch((e: unknown) =>
          actions.showNotice({ title: t("Non si apre"), text: String(e), level: "error", url: "" })),
      }));
    case "clipboard":
    case "vscode":
      return liveItems(b);
    case "records": {
      const c = State.customs.find((x) => x.id === src.integration);
      if (!c) throw new Error(t("Nessuna integrazione personale con l'id «{id}».", { id: src.integration }));
      const list = (await Bridge.customRecords(c.id)) ?? [];
      // Newest first, as the card's list.
      return [...list].sort((a, b) => b.updated.localeCompare(a.updated)).map((r) => ({
        key: r.id, name: recordTitle(c, r), sub: shortDate(r.updated), icon: c.icon || "i:file",
        run: () => {
          State.summary = false;
          actions.setFocus(`custom:${c.id}`);
          actions.setView("overview");
        },
      }));
    }
    case "notion":
      return (await Bridge.notionSearch(src.query ?? "", Math.min(20, b.limit ?? 12))).map((n) => ({
        key: n.id, name: n.title || t("Senza titolo"), sub: shortDate(n.lastEditedAt), icon: n.emoji || "i:file",
        run: () => actions.openUrl(n.url),
      }));
  }
}

/** The sources read from the island's own state, again at every change: the clipboard's history, VS Code's projects. */
const LIVE_SOURCES = new Set(["clipboard", "vscode"]);

function liveItems(b: ItemsBlock): Item[] {
  const sample = !IS_TAURI ? samples.get(b.source.kind) : undefined;
  if (sample) return sample.map((x, i) => ({ key: String(i), name: x.name, sub: x.sub, icon: x.icon ?? "i:folder", run: () => {} }));
  if (b.source.kind === "vscode") {
    return (State.barSys.vscode ?? []).map((x) => ({
      key: x.path, name: x.name, sub: x.path, icon: "i:folder",
      run: () => void Bridge.barSysDo("vscode-open", undefined, x.path),
    }));
  }
  const clip = State.integrations.integration_clipboard;
  if (!State.tasks.some((x) => x.id === "integration_clipboard")) throw new Error(t("Attiva «Appunti» in Integrazioni per vederne la cronologia."));
  const items = ((clip?.data as { items?: Record<string, unknown>[] } | undefined)?.items ?? []);
  return items.map((it) => {
    const image = it.kind === "image";
    return {
      key: String(it.id), name: image ? `${it.width} × ${it.height}` : String(it.preview ?? "").replace(/\s+/g, " ").trim(),
      sub: it.pinned ? t("fissato") : undefined,
      icon: image && typeof it.thumb === "string" && it.thumb.startsWith("data:") ? it.thumb : "i:clipboard",
      run: () => void Bridge.clipboardUse(Number(it.id), "", false).catch(() => {}),
    };
  });
}

function openFile(path: string, actions: ViewActions) {
  void Bridge.pcFileOpen(path, false).catch((e: unknown) =>
    actions.showNotice({ title: t("Non si apre"), text: String(e), level: "error", url: "" }));
}

/** «12 kB», «3,4 MB». */
function sizeText(n: number): string {
  if (!Number.isFinite(n)) return "";
  if (n < 1e6) return `${Math.max(1, Math.round(n / 1e3))} kB`;
  return `${(n / 1e6).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`;
}

/** A date as a short day: «23 nov», today the time. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  return d.toDateString() === now.toDateString()
    ? d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function iconOf(it: Item, size: number): Node {
  if (it.icon.startsWith("data:")) {
    return h("img", { class: "board-img", src: it.icon, alt: "", width: String(size), height: String(size), draggable: "false" });
  }
  if (it.icon) return renderActionIcon(it.icon, size);
  return h("span", { class: "own-letter", text: it.name.trim().slice(0, 1).toUpperCase() });
}

/** Items left by the block's filter and the words typed in its field. */
function shown(items: Item[], b: ItemsBlock, typed: string): Item[] {
  const words = `${b.filter ?? ""} ${typed}`.toLowerCase().split(/\s+/).filter(Boolean);
  const ok = items.filter((it) => words.every((w) => `${it.name} ${it.sub ?? ""}`.toLowerCase().includes(w)));
  return ok.slice(0, b.limit ?? 500);
}

/** A grid or a list: its title, its field, its items once read. */
function itemsBlock(b: ItemsBlock, tabId: string, actions: ViewActions): Part {
  const body = h("div", { class: b.kind === "grid" ? "board-grid" : "board-list" });
  const note = h("div", { class: "sub board-note" });
  let typed = "";
  const key = `${tabId}/${b.id}/${JSON.stringify(b.source)}`;
  const draw = () => {
    const all = cache.get(key);
    if (!all) {
      note.textContent = t("Leggo…");
      body.replaceChildren();
      return;
    }
    const list = shown(all, b, typed);
    note.textContent = list.length ? "" : typed || b.filter ? t("Niente con queste parole.") : t("Qui non c'è niente.");
    if (b.source.kind === "apps") {
      for (const it of list) if (!it.icon) it.icon = appIcons.get(it.key.toLowerCase()) ?? "";
      askIcons(list.filter((it) => !it.icon).map((it) => it.key).slice(0, 200));
    }
    const grid = b.kind === "grid";
    // isola.json `size`: bigger or smaller icons.
    const k = b.size === "s" ? 0.75 : b.size === "l" ? 1.3 : b.size === "xl" ? 1.6 : 1;
    body.replaceChildren(...list.map((it) =>
      h("button", { class: grid ? "board-tile" : "board-row", title: it.sub ? `${it.name} — ${it.sub}` : it.name,
        onclick: () => { actions.blip(); it.run(); } },
      h("span", { class: "board-tile-icon" }, iconOf(it, Math.round((grid ? 28 : 16) * k))),
      h("span", { class: "board-tile-name", text: it.name }),
      ...(it.sub && !grid ? [h("span", { class: "board-row-sub", text: it.sub })] : []))));
  };
  const field = b.search
    ? h("input", { class: "board-search", type: "search", placeholder: t("Cerca…"),
      oninput: (e: Event) => { typed = (e.target as HTMLInputElement).value; draw(); } })
    : null;
  const el = h("section", { class: "board-block" },
    ...(b.title ? [h("div", { class: "board-block-title", text: b.title })] : []),
    ...(field ? [field] : []), note, body);
  // isola.json: the grid's columns, the list's height (it scrolls past it).
  if (b.kind === "grid" && b.columns) body.style.gridTemplateColumns = `repeat(${b.columns}, minmax(0, 1fr))`;
  if (b.kind === "list" && b.height) {
    body.style.maxHeight = `${b.height}px`;
    body.style.overflowY = "auto";
  }
  const live = LIVE_SOURCES.has(b.source.kind);
  /** A live source read again: drawn only when what it gives changed. */
  let liveSig = "";
  const readLive = () => {
    try {
      const items = liveItems(b);
      const sig = items.map((x) => `${x.key}:${x.name}:${x.sub ?? ""}`).join("|");
      if (sig === liveSig && cache.has(key)) return;
      liveSig = sig;
      cache.set(key, items);
      draw();
    } catch (e) {
      note.textContent = String(e).replace(/^Error:\s*/, "");
      body.replaceChildren();
    }
  };
  return {
    el,
    live: live ? readLive : undefined,
    refresh(read) {
      if (live) {
        readLive();
        return;
      }
      // The installed apps stay as read; windows, quick actions and folders change: read at every opening.
      if (read && !(b.source.kind === "apps" && cache.has(key))) {
        if (!cache.has(key)) draw();
        void readSource(b, actions)
          .then((items) => { cache.set(key, items); draw(); })
          .catch((e: unknown) => { note.textContent = String(e).replace(/^Error:\s*/, ""); });
      } else draw();
    },
  };
}

/** A value of the PC, as the bar shows it. */
function valueBlock(b: { what: string; drive?: string; title?: string; color?: string; levels?: LayoutBlock["levels"] }): Part {
  const icon = h("span", { class: "board-value-icon" });
  const name = h("span", { class: "board-block-title", text: b.title ?? "" });
  const val = h("b", { class: "board-value-text" });
  const el = h("section", { class: "board-block board-value" }, icon, h("span", { class: "board-value-body" }, name, val));
  let iconKey = "";
  let tint = "";
  return {
    el,
    refresh() {
      const v = sysValueText(b.what, b.drive);
      // Its thresholds colour it while they hold (isola.json `levels`).
      const c = valueColor(b);
      if (c !== tint) {
        tint = c;
        if (c) el.style.setProperty("--own-accent", c);
        else el.style.removeProperty("--own-accent");
        el.classList.toggle("own-tinted", !!c);
      }
      val.textContent = v.text;
      el.title = v.tip;
      if (!b.title) name.textContent = v.tip.split(":")[0];
      if (v.icon !== iconKey) {
        iconKey = v.icon;
        icon.replaceChildren(v.icon.startsWith("data:") ? h("img", { src: v.icon, alt: "", width: "18", height: "18" }) : renderActionIcon(v.icon, 18));
      }
    },
  };
}

/** The last minutes of a value of the PC: a line over its area, the value now beside the title. */
function chartBlock(b: Extract<LayoutBlock, { kind: "chart" }>): Part {
  const NS = "http://www.w3.org/2000/svg";
  const W = 300;
  // isola.json: its height, the minutes it shows, a line, an area alone or bars.
  const H = Math.round(b.height ?? 64);
  const span = Math.max(1, Math.min(5, b.minutes ?? 5)) * 60_000;
  // No style chosen: a line over a light area, as before. «line» chosen: the line alone (24 Nov 2026:
  // it drew the light area too and looked like «area», while the chat told the user it had none).
  const mode = b.line ?? "default";
  const svgEl = document.createElementNS(NS, "svg");
  svgEl.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svgEl.setAttribute("preserveAspectRatio", "none");
  svgEl.setAttribute("class", "board-chart-svg");
  svgEl.style.height = `${H}px`;
  const area = document.createElementNS(NS, "path");
  area.setAttribute("class", mode === "bars" ? "board-chart-bars" : "board-chart-area");
  const line = document.createElementNS(NS, "polyline");
  line.setAttribute("class", "board-chart-line");
  if (mode === "default") svgEl.append(area, line);
  else if (mode === "line") svgEl.append(line);
  else svgEl.append(area);
  const name = h("span", { class: "board-block-title", text: b.title ?? "" });
  const val = h("b", { class: "board-value-text" });
  const wait = h("div", { class: "sub board-note", text: t("Raccolgo i valori…") });
  const el = h("section", { class: "board-block board-chart" }, h("div", { class: "board-chart-head" }, name, val), svgEl, wait);
  if (mode === "area") el.classList.add("chart-area-only");
  let tint = "";
  return {
    el,
    refresh() {
      const v = sysValueText(b.what);
      val.textContent = v.text;
      el.title = v.tip;
      if (!b.title) name.textContent = v.tip.split(":")[0];
      const c = valueColor(b);
      if (c !== tint) {
        tint = c;
        if (c) el.style.setProperty("--own-accent", c);
        else el.style.removeProperty("--own-accent");
        el.classList.toggle("own-tinted", !!c);
      }
      const now = Date.now();
      const pts = chartHistory(b.what).filter((p) => now - p.t <= span);
      wait.hidden = pts.length >= 2;
      if (pts.length < 2) {
        line.setAttribute("points", "");
        area.setAttribute("d", "");
        return;
      }
      // The window shown: the last minutes; percentages from 0 to 100, the network to its highest.
      const end = pts[pts.length - 1].t;
      const top = b.what === "net" ? Math.max(1, ...pts.map((p) => p.v)) : 100;
      const xy = pts.map((p) => [W - ((end - p.t) / span) * W, H - 2 - (Math.min(p.v, top) / top) * (H - 4)] as const);
      if (mode === "bars") {
        // One bar a reading, as wide as the time to the next one.
        const step = Math.max(1.5, (W / (span / 2000)) * 0.7);
        area.setAttribute("d", xy.map(([x, y]) => `M${(x - step).toFixed(1)},${H} V${y.toFixed(1)} h${step.toFixed(1)} V${H} Z`).join(" "));
        return;
      }
      const str = xy.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
      line.setAttribute("points", str);
      const first = xy[0];
      area.setAttribute("d", `M${first[0].toFixed(1)},${H} L${str.replace(/ /g, " L")} L${W},${H} Z`);
    },
  };
}

/** A block's look from isola.json (style.css `.own-…`, `.bw-…`, `.bs-…`): width, size, colours, corners. */
function blockLook(el: HTMLElement, b: LayoutBlock) {
  if (b.width) el.classList.add(`bw-${b.width}`);
  if (b.size) el.classList.add(`bs-${b.size}`);
  if (b.align) el.classList.add(`ba-${b.align}`);
  if (b.color) el.style.setProperty("--own-accent", b.color);
  if (b.bg === "none") el.classList.add("own-bg-none");
  else if (b.bg) {
    el.classList.add("own-block-bg");
    el.style.setProperty("--own-bg", b.bg);
  }
  if (b.border) {
    el.classList.add("own-block-border");
    el.style.setProperty("--own-border", b.border);
  }
  if (b.title_color) el.style.setProperty("--own-title", b.title_color);
  if (typeof b.radius === "number") {
    el.classList.add("own-block-r");
    el.style.setProperty("--own-r", `${b.radius}px`);
  }
  if (b.kind === "text") {
    if (b.bold) el.style.fontWeight = "650";
    if (b.italic) el.style.fontStyle = "italic";
  }
}

/** One block of a tab (`owner` its id) or of the Panoramica ("overview"). */
export function blockPart(b: LayoutBlock, owner: string, actions: ViewActions): Part {
  listen();
  const part = blockPartOf(b, owner, actions);
  blockLook(part.el, b);
  return part;
}

function blockPartOf(b: LayoutBlock, owner: string, actions: ViewActions): Part {
  if (b.kind === "value") return valueBlock(b);
  if (b.kind === "chart") return chartBlock(b);
  if (b.kind === "text") return { el: h("section", { class: "board-block board-text", text: b.text }), refresh() {} };
  if (b.kind === "piece") {
    if (pieceMaker) return pieceMaker(b, actions);
    return { el: h("section", { class: "board-block" }), refresh() {} };
  }
  return itemsBlock(b, owner, actions);
}

/** The colour a value's thresholds give now, else its own; empty for the usual. */
function valueColor(b: { color?: string; levels?: LayoutBlock["levels"] }): string {
  return levelColor(b.levels) ?? b.color ?? "";
}

/** The Panoramica's own blocks, kept while they do not change: it is redrawn often, they are not. */
const overviewParts = new Map<string, { key: string; part: Part }>();
let overviewOpen = false;
onData.add(() => {
  if (overviewOpen) for (const x of overviewParts.values()) x.part.refresh(false);
});

/** The Panoramica's blocks by id, made or kept (overview.blocks in isola.json). */
export function overviewBlocks(actions: ViewActions): Map<string, HTMLElement> {
  // Those whose `when` holds now; the others are left out (and made again when they come back).
  const blocks = (State.layout.overview?.blocks ?? []).filter((b) => holds(b.when));
  const out = new Map<string, HTMLElement>();
  for (const b of blocks) {
    const key = JSON.stringify(b);
    let had = overviewParts.get(b.id);
    if (!had || had.key !== key) {
      had = { key, part: blockPart(b, "overview", actions) };
      overviewParts.set(b.id, had);
      if (overviewOpen) had.part.refresh(true);
    }
    out.set(b.id, had.part.el);
  }
  for (const id of [...overviewParts.keys()]) if (!out.has(id)) overviewParts.delete(id);
  return out;
}

/** Every sync of the Panoramica: its blocks read again when it opens, its pieces follow. */
export function syncOverviewBlocks(shown: boolean) {
  const opened = shown && !overviewOpen;
  overviewOpen = shown;
  for (const x of overviewParts.values()) {
    if (opened) x.part.refresh(true);
    else if (shown) x.part.live?.();
  }
}

/** «board»: a tab of the user's, its name, its buttons and its blocks. */
export function buildBoard(actions: ViewActions): ViewHost {
  listen();
  const title = h("div", { class: "board-title" });
  const grid = h("div", { class: "qa-grid" });
  const blocksEl = h("div", { class: "board-blocks" });
  const card = h("div", { class: "card qa-card board-card" }, title, grid, blocksEl);
  let key = "";
  let open = false;
  let parts: Part[] = [];
  onData.add(() => {
    if (open) for (const p of parts) p.refresh(false);
  });
  return {
    el: h("div", { class: "view" }, card),
    sync() {
      const nowOpen = State.view === "board" && State.mode === "expanded";
      const opened = nowOpen && !open;
      open = nowOpen;
      const tab = State.layout.tabs.find((x) => x.id === State.boardTab);
      // What shows now: the buttons and blocks whose `when` holds, the buttons' colours by their thresholds.
      const shownButtons = (tab?.buttons ?? []).filter((b) => holds(b.when));
      const shownBlocks = (tab?.blocks ?? []).filter((b) => holds(b.when));
      const k = JSON.stringify(tab ?? null) + shownButtons.map((b) => `${b.id}:${levelColor(b.levels) ?? ""}`).join("|")
        + shownBlocks.map((b) => b.id).join("|");
      if (k !== key) {
        key = k;
        if (!tab) {
          title.textContent = t("Questa scheda non c'è più.");
          grid.replaceChildren();
          blocksEl.replaceChildren();
          parts = [];
          return;
        }
        title.replaceChildren(
          ...(tab.icon ? [h("span", { class: "board-icon" }, renderActionIcon(tab.icon, 16))] : []),
          h("span", { text: tab.name }));
        grid.replaceChildren(...shownButtons.map((b) => tile(b, actions, tab.size)));
        // isola.json: the tab's columns; its colour on the title's icon.
        grid.style.gridTemplateColumns = tab.columns ? `repeat(${tab.columns}, minmax(0, 1fr))` : "";
        grid.classList.toggle("own-cols", !!tab.columns);
        if (tab.color) title.style.setProperty("--c", tab.color);
        else title.style.removeProperty("--c");
        const blocks = shownBlocks;
        if (!tab.buttons.length && !(tab.blocks ?? []).length) grid.append(h("div", { class: "sub", text: t("Ancora nessun pulsante: chiedili alla chat.") }));
        grid.hidden = !grid.childElementCount;
        parts = blocks.map((b) => blockPart(b, tab.id, actions));
        blocksEl.replaceChildren(...parts.map((p) => p.el));
        if (open) for (const p of parts) p.refresh(true);
        return;
      }
      if (opened) for (const p of parts) p.refresh(true);
      else if (open) for (const p of parts) p.live?.();
    },
    fitHeight: () => card.scrollHeight + 2,
  };
}

/**
 * The open island's footer, under the menu and the views: three sides (left,
 * center, right), each a row of buttons and values of the PC in the order of
 * isola.json. The values are read by barsys.rs while the island is open
 * (bar.ts `barSysKinds`). `sync` says whether it has anything (island.ts
 * makes room for it).
 */
export function buildFoot(actions: ViewActions): { el: HTMLElement; sync(): boolean } {
  listen();
  const sides = { left: h("div", { class: "foot-side foot-left" }), center: h("div", { class: "foot-side foot-center" }), right: h("div", { class: "foot-side foot-right" }) };
  const el = h("div", { id: "island-foot" }, sides.left, sides.center, sides.right);
  let key = "";
  let parts: Part[] = [];
  let shown = false;
  onData.add(() => {
    if (shown) for (const p of parts) p.refresh(false);
  });
  const item = (it: LayoutFooterItem): HTMLElement => {
    if ("action" in it) return layoutIconButton(it, actions, 15);
    const p = valueBlock({ what: it.what, drive: it.drive, color: it.color, levels: it.levels });
    p.el.classList.add("foot-value");
    // A value with `click` (26 Nov 2026): the same actions as a button.
    const click = it.click;
    if (click) {
      p.el.classList.add("foot-click");
      p.el.setAttribute("role", "button");
      p.el.tabIndex = 0;
      p.el.addEventListener("click", () => runLayoutAction(click, actions));
      p.el.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          runLayoutAction(click, actions);
        }
      });
    }
    // A name before the value (isola.json `label`), a background of its own.
    if (it.label) p.el.prepend(h("span", { class: "foot-label", text: it.label }));
    if (it.bg) {
      p.el.classList.add("own-block-bg");
      p.el.style.setProperty("--own-bg", it.bg);
    }
    parts.push(p);
    return p.el;
  };
  return {
    el,
    sync() {
      const f = State.layout.footer ?? {};
      // Only what holds now (`when`); the buttons' colours by their thresholds (the values colour themselves).
      const now = (side: "left" | "center" | "right") => (f[side] ?? []).filter((it) => holds(it.when));
      const shownNow = { left: now("left"), center: now("center"), right: now("right") };
      const k = JSON.stringify(f) + JSON.stringify(shownNow) +
        [...shownNow.left, ...shownNow.center, ...shownNow.right].map((it) => ("action" in it ? levelColor(it.levels) ?? "" : "")).join("|");
      if (k !== key) {
        key = k;
        parts = [];
        for (const side of ["left", "center", "right"] as const) sides[side].replaceChildren(...shownNow[side].map((it) => item(it)));
      }
      const has = !!(shownNow.left.length || shownNow.center.length || shownNow.right.length);
      shown = has;
      if (has) for (const p of parts) p.refresh(false);
      return has;
    },
  };
}
