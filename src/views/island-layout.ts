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

import { h } from "./dom";
import { State, type LayoutAction, type LayoutBlock, type LayoutButton, type LayoutTab } from "../core/state";
import { Bridge, IS_TAURI, onEvent } from "../core/bridge";
import { t } from "../core/i18n";
import { sysValueText } from "../island/bar";
import { renderActionIcon } from "./action-icons";
import { fillChat } from "./chat";
import type { ViewActions, ViewHost } from "./views";

/** A view of `view` actions: a section of the island, Impostazioni, the memory, a tab. */
function openView(to: string, actions: ViewActions) {
  if (to.startsWith("tab:")) {
    State.boardTab = to.slice(4);
    actions.setView("board");
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
      else fail(t("L'azione rapida non c'è più nel profilo attivo."));
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

function colorOf(b: LayoutButton): string {
  return b.color && /^#[0-9a-f]{6}$/i.test(b.color) ? b.color : "#8e939c";
}

/** A small round button (foot of the menu, header): the icon, the label as its tooltip. */
export function layoutIconButton(b: LayoutButton, actions: ViewActions, size = 16): HTMLElement {
  const el = h("button", { class: "own-btn", "data-own": b.id, title: b.label, "aria-label": b.label,
    onclick: () => runLayoutAction(b.action, actions) },
  b.icon ? renderActionIcon(b.icon, size) : h("span", { class: "own-letter", text: b.label.trim().slice(0, 1).toUpperCase() }));
  if (b.color) el.style.setProperty("--c", colorOf(b));
  return el;
}

/** A tab's button: a tile like the quick actions'. */
function tile(b: LayoutButton, actions: ViewActions): HTMLElement {
  const el = h("button", { class: "qa", "data-own": b.id, title: b.label, onclick: () => runLayoutAction(b.action, actions) },
    h("span", { class: "qa-icon" }, renderActionIcon(b.icon || "i:bolt", 18)),
    h("span", { class: "qa-name", text: b.label }));
  el.style.setProperty("--qa", colorOf(b));
  return el;
}

/** The buttons of one zone, in the saved order. */
export function zoneButtons(zone: "menu-bottom" | "header"): LayoutButton[] {
  return State.layout.buttons.filter((b) => b.zone === zone);
}

/** The tabs of the menu. */
export function layoutTabs(): LayoutTab[] {
  return State.layout.tabs;
}

/** The usual order of the menu's sections and of the header's buttons (island_layout.rs). */
const MENU_USUAL = ["overview", "agents", "chat", "actions", "files", "news"];
const HEADER_USUAL = ["usage", "own", "pin", "memory", "settings", "sound"];

/**
 * Step 3: the order the menu's rows (`tab:<id>` for the user's tabs) or the
 * header's buttons stand in: those the JSON names first, then the rest as usual.
 */
export function partsOrder(which: "menu" | "header"): string[] {
  const parts = State.layout[which];
  const usual = which === "menu" ? [...MENU_USUAL, ...State.layout.tabs.map((x) => `tab:${x.id}`)] : HEADER_USUAL;
  const named = (parts?.order ?? []).filter((x) => usual.includes(x));
  return [...named, ...usual.filter((x) => !named.includes(x))];
}

/** A part of the menu or the header hidden from the chat (never Panoramica or Impostazioni). */
export function partHidden(which: "menu" | "header", id: string): boolean {
  return id !== "overview" && id !== "settings" && !!State.layout[which]?.hidden?.includes(id);
}

/** A key that changes when what `zone` shows changes (no redraw otherwise). */
export function zoneKey(zone: "menu-bottom" | "header"): string {
  return JSON.stringify(zoneButtons(zone));
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
type Part = { el: HTMLElement; refresh(read: boolean): void };

/** Installed apps, read once (Start's list: applist.rs `apps_catalog`, some seconds the first time). */
let apps: { id: string; name: string }[] | null = null;
let appsLoading: Promise<void> | null = null;
/** Their icons by id in lower case, as applist.rs sends them in `apps-icons`. */
const appIcons = new Map<string, string>();
const iconsAsked = new Set<string>();
/** Called when icons or values arrive while the tab is open. */
let onData: (() => void) | null = null;
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
    if (got) onData?.();
  });
  void onEvent("bar-sys", () => onData?.());
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
        run: () => void Bridge.pcFileOpen(f.path, false).catch((e: unknown) =>
          actions.showNotice({ title: t("Non si apre"), text: String(e), level: "error", url: "" })),
      }));
  }
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
    body.replaceChildren(...list.map((it) =>
      h("button", { class: grid ? "board-tile" : "board-row", title: it.sub ? `${it.name} — ${it.sub}` : it.name,
        onclick: () => { actions.blip(); it.run(); } },
      h("span", { class: "board-tile-icon" }, iconOf(it, grid ? 28 : 16)),
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
  return {
    el,
    refresh(read) {
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
function valueBlock(b: Extract<LayoutBlock, { kind: "value" }>): Part {
  const icon = h("span", { class: "board-value-icon" });
  const name = h("span", { class: "board-block-title", text: b.title ?? "" });
  const val = h("b", { class: "board-value-text" });
  const el = h("section", { class: "board-block board-value" }, icon, h("span", { class: "board-value-body" }, name, val));
  let iconKey = "";
  return {
    el,
    refresh() {
      const v = sysValueText(b.what, b.drive);
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
  onData = () => {
    if (open) for (const p of parts) p.refresh(false);
  };
  return {
    el: h("div", { class: "view" }, card),
    sync() {
      const nowOpen = State.view === "board" && State.mode === "expanded";
      const opened = nowOpen && !open;
      open = nowOpen;
      const tab = State.layout.tabs.find((x) => x.id === State.boardTab);
      const k = JSON.stringify(tab ?? null);
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
        grid.replaceChildren(...tab.buttons.map((b) => tile(b, actions)));
        const blocks = tab.blocks ?? [];
        if (!tab.buttons.length && !blocks.length) grid.append(h("div", { class: "sub", text: t("Ancora nessun pulsante: chiedili alla chat.") }));
        grid.hidden = !grid.childElementCount;
        parts = blocks.map((b): Part => {
          if (b.kind === "value") return valueBlock(b);
          if (b.kind === "text") return { el: h("section", { class: "board-block board-text", text: b.text }), refresh() {} };
          return itemsBlock(b, tab.id, actions);
        });
        blocksEl.replaceChildren(...parts.map((p) => p.el));
        if (open) for (const p of parts) p.refresh(true);
        return;
      }
      if (opened) for (const p of parts) p.refresh(true);
    },
    fitHeight: () => card.scrollHeight + 2,
  };
}
