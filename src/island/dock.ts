// Panels around the chat (Edoardo, 22 Nov 2026: «pannelli trascinabili,
// affiancare, dividere», in the island and in the chat's own window): the
// chat, its conversations («Cronologia»), the Anteprima and the «Terminale»
// are tabs of dockview (dockview-core, chosen over writing our own: widely
// used, no dependencies, docs/decisioni.md). Each can be dragged beside, under
// or into another; the dividers move; the arrangement is remembered per place
// (island, window) and per set of open panels.
//
// With the chat alone there are no panels: the chat's views stay where they
// always were. The Anteprima's page is a native webview laid over its panel
// (preview.rs preview_pane): this file only says where the panel is, and
// hides the page while a tab is dragged (the drop zones would be under it).

import { createDockview, themeDark, type ContextMenuItem, type DockviewApi, type IContentRenderer, type ITabRenderer, type SerializedDockview } from "dockview-core";
import "../vendor/dockview.css";
import { t } from "../core/i18n";
import { svg } from "../views/dom";
import { ICONS } from "../views/icons";

export type DockPanelId = "chat" | "cronologia" | "anteprima" | "terminale";

export interface DockHooks {
  /** "isola" or "finestra": arrangements are kept apart (the sizes differ). */
  place: string;
  /** Panels may show now (the island: open on the chat). */
  enabled(): boolean;
  sideOpen(): boolean;
  previewOpen(): boolean;
  termOpen(): boolean;
  /** The tab's ✕ on the conversations, the Anteprima, the terminal. */
  closeSide(): void;
  closePreview(): void;
  closeTerm(): void;
  /** Where the Anteprima's page goes, in this page's pixels (0 = hidden). */
  placePreview(r: Rect): void;
  /** First widths (the island's own settings). */
  previewWidth(): number;
  sideWidth(): number;
  /** A line in EasyIsland's log (which panels, from where). */
  log(line: string): void;
}

export interface Rect { x: number; y: number; w: number; h: number }

const SAVED = "easyisland.chatDock.";
const HISTORY = 30;
const NONE: Rect = { x: 0, y: 0, w: 0, h: 0 };
const ORDER: DockPanelId[] = ["chat", "cronologia", "anteprima", "terminale"];

export class ChatDock {
  readonly el: HTMLElement;
  /** The panels are showing (more than the chat is open). */
  active = false;
  private api: DockviewApi;
  /** One element per panel, kept across rebuilds (fromJSON makes new renderers). */
  private boxes = new Map<DockPanelId, HTMLElement>();
  private dragging = false;
  private sent: Rect = { x: -1, y: -1, w: -1, h: -1 };
  private saveTimer = 0;
  private soon = 0;
  /** Panels being added or removed by us: their ✕ hooks are not the user's. */
  private quiet = false;
  /** dockview's menu on a tab is open: the Anteprima's page would cover it. */
  private menuOpen = false;
  /**
   * Arrangements the user made with this set of panels, the last one now (the
   * tab's menu undoes and redoes them). dockview's own history is in its paid
   * edition: these are its saved layouts (toJSON), at most HISTORY.
   */
  private past: string[] = [];
  private undone: string[] = [];
  private watch: ResizeObserver;

  /** `views` (#views) goes into the chat's panel; the dock takes its place in its parent. */
  constructor(private doc: Document, private views: HTMLElement, private hooks: DockHooks) {
    this.el = doc.createElement("div");
    // dockview's dark theme underneath ours (its sizes and drop zones), ours on top.
    this.el.className = "chat-dock dockview-theme-dark";
    this.el.style.display = "none";
    views.parentElement?.insertBefore(this.el, views);

    for (const id of ORDER) this.box(id);
    // chat.ts lays its conversations and its terminal here while the panels exist.
    this.box("cronologia").dataset.sideHome = "";
    this.box("terminale").dataset.termHome = "";

    const boxes = this.boxes;
    this.api = createDockview(this.el, {
      createComponent: (o) => renderer(boxes.get(o.name as DockPanelId) ?? doc.createElement("div")),
      createTabComponent: (o) => tab(doc, o.name as DockPanelId),
      // Right click on a tab: bigger, undo or redo a move, the usual arrangement, close.
      getTabContextMenuItems: (p) => this.menu(p.panel.id as DockPanelId),
      // Ours on dockview's dark one (src/style.css .dockview-theme-easy), with room between the panels.
      theme: { ...themeDark, name: "easy", className: "dockview-theme-easy", gap: 6, dndTabIndicator: "line" },
      // The panels are parts of the chat, not documents: no floating groups or
      // browser popups (a window of its own is EasyIsland's job).
      disableFloatingGroups: true,
      singleTabMode: "default",
      defaultRenderer: "always",
      dndStrategy: "pointer",
      scrollbars: "native",
    });
    this.api.onWillDragPanel(() => this.startDrag());
    this.api.onWillDragGroup(() => this.startDrag());
    this.api.onDidDrop(() => this.endDrag());
    for (const ev of ["pointerup", "pointercancel", "dragend", "drop"]) doc.addEventListener(ev, () => this.endDrag(), true);
    // A right click on the tabs is dockview's menu only, not the island's too.
    this.el.addEventListener("contextmenu", (e) => {
      if (!(e.target as HTMLElement).closest(".dv-tabs-and-actions-container, .dv-context-menu")) return;
      e.preventDefault();
      e.stopPropagation();
    });
    // The tab's menu goes with the next click or Esc: the page comes back.
    const menuGone = () => {
      if (!this.menuOpen) return;
      window.setTimeout(() => {
        this.menuOpen = false;
        this.placeSoon();
      }, 120);
    };
    doc.addEventListener("pointerdown", menuGone, true);
    doc.addEventListener("keydown", (e) => {
      if (e.key === "Escape") menuGone();
    }, true);
    // After the browser has laid the panels out (dockview tells before).
    this.api.onDidLayoutChange(() => {
      this.placeSoon();
      this.save();
    });
    this.api.onDidActivePanelChange(() => this.placeSoon());
    this.api.onDidRemovePanel((p) => {
      if (this.quiet) return;
      // The tab's ✕: the thing itself closes (the next sync would bring it back otherwise).
      if (p.id === "cronologia") hooks.closeSide();
      if (p.id === "anteprima") hooks.closePreview();
      if (p.id === "terminale") hooks.closeTerm();
    });
    this.watch = new ResizeObserver((entries) => {
      if (entries.some((e) => e.target === this.el) && this.active) this.api.layout(this.el.clientWidth, this.el.clientHeight);
      this.placeSoon();
    });
    this.watch.observe(this.el);
    this.watch.observe(this.box("anteprima"));
  }

  /** At every redraw: the panels as the chat has them, the page where its panel is. */
  sync() {
    const want = this.wanted();
    const on = want.length > 1;
    if (on !== this.active) {
      if (on) this.show();
      else this.hide();
    }
    if (!on) {
      this.home();
      return;
    }
    if (!this.views.isConnected || this.views.parentElement !== this.boxes.get("chat")) this.box("chat").append(this.views);
    const have = this.api.panels.map((p) => p.id as DockPanelId).sort();
    if (want.join() !== have.join()) this.build(want);
    // The conversations and the terminal into their panels (chat.ts lays them
    // there too, once the panel is in the page).
    this.adopt(".chat-side", "cronologia", want);
    this.adopt(".chat-term", "terminale", want);
    this.placeSoon();
  }

  /**
   * The chat is leaving this page (into its window, or back): the
   * conversations and the terminal go with its view, not left in a panel here.
   */
  release() {
    this.home();
  }

  /** The Anteprima moved or reopened (island.ts paneGen): its place told again even if the same. */
  resend() {
    this.sent = { x: -1, y: -1, w: -1, h: -1 };
  }

  /** Its page is going (the window closes or WebView2 swaps it): the chat has left already. */
  dispose() {
    this.watch.disconnect();
    window.clearTimeout(this.saveTimer);
    this.quiet = true;
    this.api.dispose();
    this.el.remove();
  }

  private show() {
    this.active = true;
    this.el.style.display = "";
    this.box("chat").append(this.views);
    this.api.layout(this.el.clientWidth, this.el.clientHeight);
    this.resend();
  }

  /** The chat alone again: its views back where they were, the conversations and terminal into the chat. */
  private hide() {
    this.active = false;
    this.home();
    this.el.parentElement?.insertBefore(this.views, this.el);
    this.el.style.display = "none";
    this.quiet = true;
    try {
      this.api.clear();
    } finally {
      this.quiet = false;
    }
  }

  /**
   * The conversations and the terminal back in the chat when no panel holds
   * them (the panels went, or the chat came back from its window: popout.ts
   * leaves them at the top of the view).
   */
  private home() {
    const layout = this.views.querySelector<HTMLElement>(".chat-layout");
    if (!layout) return;
    const side = this.doc.querySelector<HTMLElement>(".chat-side");
    const term = this.doc.querySelector<HTMLElement>(".chat-term");
    if (side && side.parentElement !== layout) layout.prepend(side);
    if (term && term.parentElement !== layout && !term.parentElement?.id) layout.append(term);
  }

  private adopt(selector: string, id: DockPanelId, want: DockPanelId[]) {
    const el = this.doc.querySelector<HTMLElement>(selector);
    const home = this.boxes.get(id);
    if (el && home && want.includes(id) && el.parentElement !== home) home.append(el);
  }

  private box(id: DockPanelId): HTMLElement {
    let b = this.boxes.get(id);
    if (!b) {
      b = this.doc.createElement("div");
      b.className = `dock-box dock-${id}`;
      this.boxes.set(id, b);
    }
    return b;
  }

  private wanted(): DockPanelId[] {
    if (!this.hooks.enabled()) return ["chat"];
    const w: DockPanelId[] = ["chat"];
    if (this.hooks.sideOpen()) w.push("cronologia");
    if (this.hooks.previewOpen()) w.push("anteprima");
    if (this.hooks.termOpen()) w.push("terminale");
    return w.sort();
  }

  private key(ids: string[]): string {
    return `${SAVED}${this.hooks.place}.${[...ids].sort().join("+")}`;
  }

  /** The panels again: the arrangement saved for this set, or the usual one. */
  private build(want: DockPanelId[]) {
    this.past = [];
    this.undone = [];
    this.quiet = true;
    try {
      const saved = load(this.key(want));
      let done = false;
      if (saved) {
        try {
          this.api.fromJSON(saved);
          done = this.api.panels.map((p) => p.id).sort().join() === want.join();
        } catch {
          done = false;
        }
      }
      if (!done) {
        this.api.clear();
        this.add("chat");
        if (want.includes("cronologia")) this.add("cronologia", { referencePanel: "chat", direction: "left" }, this.hooks.sideWidth());
        if (want.includes("anteprima")) this.add("anteprima", { referencePanel: "chat", direction: "right" }, this.hooks.previewWidth());
        if (want.includes("terminale")) {
          this.add("terminale", want.includes("anteprima")
            ? { referencePanel: "anteprima", direction: "below" }
            : { referencePanel: "chat", direction: "right" });
        }
      }
      // The chat stays the one in front where it shares a group.
      this.api.getPanel("chat")?.api.setActive();
      this.hooks.log(`pannelli (${this.hooks.place}): ${want.join(", ")}${done ? " come li avevi messi" : ""}`);
    } finally {
      this.quiet = false;
    }
    this.resend();
  }

  private add(id: DockPanelId, position?: { referencePanel: string; direction: "left" | "right" | "below" }, width?: number) {
    this.api.addPanel({
      id, component: id, tabComponent: id, title: TITLES[id](),
      ...(position ? { position } : {}),
      ...(width ? { initialWidth: width } : {}),
    });
  }

  /** The tab's menu (dockview draws it; the page of the Anteprima hides meanwhile). */
  private menu(id: DockPanelId): ContextMenuItem[] {
    const p = this.api.getPanel(id);
    if (!p) return [];
    this.menuOpen = true;
    this.place();
    const big = p.api.isMaximized();
    const items: ContextMenuItem[] = [
      { label: big ? t("Riduci il pannello") : t("Ingrandisci il pannello"), action: () => (big ? p.api.exitMaximized() : p.api.maximize()) },
      "separator",
      { label: t("Annulla lo spostamento"), disabled: this.past.length < 2, action: () => this.undo() },
      { label: t("Ripeti lo spostamento"), disabled: !this.undone.length, action: () => this.redo() },
      { label: t("Disposizione di partenza"), action: () => this.reset() },
    ];
    if (id !== "chat") items.push("separator", { label: t("Chiudi"), action: () => p.api.close() });
    return items;
  }

  private undo() {
    const now = this.past.pop();
    const before = this.past[this.past.length - 1];
    if (!now || !before) {
      if (now) this.past.push(now);
      return;
    }
    this.undone.push(now);
    this.load(before);
  }

  private redo() {
    const next = this.undone.pop();
    if (!next) return;
    this.past.push(next);
    this.load(next);
  }

  /** A layout of the history back on screen (not a new step of it). */
  private load(json: string) {
    this.quiet = true;
    try {
      this.api.fromJSON(JSON.parse(json) as SerializedDockview);
    } catch {
      /* a layout that no longer fits: left as it is */
    } finally {
      this.quiet = false;
    }
    this.resend();
    this.placeSoon();
  }

  /** The usual arrangement for the panels open now; the one saved for them is forgotten. */
  private reset() {
    const want = this.wanted();
    try {
      localStorage.removeItem(this.key(want));
    } catch {
      /* no storage */
    }
    if (this.api.hasMaximizedGroup()) this.api.exitMaximizedGroup();
    this.build(want);
  }

  private startDrag() {
    if (this.dragging) return;
    this.dragging = true;
    this.el.classList.add("dock-dragging");
    this.place();
  }

  private endDrag() {
    if (!this.dragging) return;
    // After dockview has dropped (its own pointerup comes in the same turn).
    window.setTimeout(() => {
      this.dragging = false;
      this.el.classList.remove("dock-dragging");
      this.placeSoon();
    }, 0);
  }

  private placeSoon() {
    if (this.soon) return;
    this.soon = (this.doc.defaultView ?? window).requestAnimationFrame(() => {
      this.soon = 0;
      this.place();
    });
  }

  /** Tells where the Anteprima's page goes: its panel when shown, nothing while dragging. */
  private place() {
    if (!this.active) return;
    let next = NONE;
    const p = this.api.getPanel("anteprima");
    const b = this.boxes.get("anteprima");
    if (p && b && p.api.isVisible && !this.dragging && !this.menuOpen && b.isConnected) {
      const r = b.getBoundingClientRect();
      if (r.width > 40 && r.height > 40) next = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
    }
    const s = this.sent;
    if (s.x === next.x && s.y === next.y && s.w === next.w && s.h === next.h) return;
    this.sent = next;
    this.hooks.placePreview(next);
  }

  private save() {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      if (!this.active) return;
      try {
        const ids = this.api.panels.map((p) => p.id).sort();
        if (ids.join() !== this.wanted().join()) return;
        const json = JSON.stringify(this.api.toJSON());
        if (this.past[this.past.length - 1] !== json) {
          // A new move by the user: what was undone cannot be redone any more.
          if (this.past.length && this.undone[this.undone.length - 1] !== json) this.undone = [];
          this.past.push(json);
          if (this.past.length > HISTORY) this.past.shift();
        }
        localStorage.setItem(this.key(ids), json);
      } catch {
        /* no storage */
      }
    }, 400);
  }
}

const TITLES: Record<DockPanelId, () => string> = {
  chat: () => t("Chat"),
  cronologia: () => t("Conversazioni"),
  anteprima: () => t("Anteprima"),
  terminale: () => t("Terminale"),
};

const ICON: Record<DockPanelId, string> = {
  chat: ICONS.bubble,
  cronologia: ICONS.history,
  anteprima: ICONS.preview,
  terminale: ICONS.lineTerminal,
};

function load(key: string): SerializedDockview | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as SerializedDockview | null;
  } catch {
    return null;
  }
}

/** A tab: its icon and name and, but on the chat (always there), a ✕ that closes the thing. */
function tab(doc: Document, id: DockPanelId): ITabRenderer {
  const element = doc.createElement("div");
  element.className = `dock-tab dock-tab-${id}`;
  const icon = doc.createElement("span");
  icon.className = "dock-tab-icon";
  icon.append(id === "chat" ? svg(ICON[id], 13) : svg(ICON[id], 13, { stroke: 1.8 }));
  const name = doc.createElement("span");
  name.className = "dock-tab-name";
  element.append(icon, name);
  return {
    element,
    init: (p) => {
      name.textContent = p.title ?? "";
      // Double click: the panel takes the whole place, again to give it back.
      element.addEventListener("dblclick", (e) => {
        if ((e.target as HTMLElement).closest(".dock-tab-x")) return;
        if (p.api.isMaximized()) p.api.exitMaximized();
        else p.api.maximize();
      });
      element.title = t("Doppio clic: ingrandisci o riduci · clic destro: altre scelte");
      if (id === "chat") return;
      const x = doc.createElement("button");
      x.className = "dock-tab-x";
      x.append(svg(ICONS.xmark, 10));
      x.title = id === "terminale" ? t("Chiudi il terminale") : id === "anteprima" ? t("Chiudi l'Anteprima") : t("Nascondi le conversazioni");
      // Not a drag of the tab.
      x.addEventListener("pointerdown", (e) => e.stopPropagation());
      x.addEventListener("click", (e) => {
        e.stopPropagation();
        p.api.close();
      });
      element.append(x);
    },
  };
}

/** A panel's content: our element, never made again nor emptied by dockview. */
function renderer(element: HTMLElement): IContentRenderer {
  return { element, init: () => {} };
}
