// The island built from a JSON, step 1 (docs/architettura.md → Isola da JSON):
// the buttons and the tabs the user added from the chat (isola.json,
// src-tauri/src/island_layout.rs). Buttons stand at the foot of the menu or in
// the header; a tab is a row of the menu that opens a grid of its buttons (the
// «board» view). What a button does comes from a fixed list (LayoutAction),
// never code. While a change waits on Consenti / Nega the island shows it
// (State.layout = the draft); Nega puts it back.

import { h } from "./dom";
import { State, type LayoutAction, type LayoutButton, type LayoutTab } from "../core/state";
import { Bridge } from "../core/bridge";
import { t } from "../core/i18n";
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

/** A key that changes when what `zone` shows changes (no redraw otherwise). */
export function zoneKey(zone: "menu-bottom" | "header"): string {
  return JSON.stringify(zoneButtons(zone));
}

/** «board»: a tab of the user's, its name and its buttons. */
export function buildBoard(actions: ViewActions): ViewHost {
  const title = h("div", { class: "board-title" });
  const grid = h("div", { class: "qa-grid" });
  const card = h("div", { class: "card qa-card board-card" }, title, grid);
  let key = "";
  return {
    el: h("div", { class: "view" }, card),
    sync() {
      const tab = State.layout.tabs.find((x) => x.id === State.boardTab);
      const k = JSON.stringify(tab ?? null);
      if (k === key) return;
      key = k;
      if (!tab) {
        title.textContent = t("Questa scheda non c'è più.");
        grid.replaceChildren();
        return;
      }
      title.replaceChildren(
        ...(tab.icon ? [h("span", { class: "board-icon" }, renderActionIcon(tab.icon, 16))] : []),
        h("span", { text: tab.name }));
      grid.replaceChildren(...tab.buttons.map((b) => tile(b, actions)));
      if (!tab.buttons.length) grid.append(h("div", { class: "sub", text: t("Ancora nessun pulsante: chiedili alla chat.") }));
    },
    fitHeight: () => card.scrollHeight + 2,
  };
}
