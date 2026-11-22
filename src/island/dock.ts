// Panels in the chat's own window (Edoardo, 22 Nov 2026: «pannelli trascinabili,
// affiancare, dividere»): the chat, the Anteprima and the «Terminale» are tabs
// of dockview (dockview-core, chosen over writing our own: widely used, no
// dependencies, docs/decisioni.md). Each can be dragged beside, under or into
// another; the dividers move; the arrangement is remembered per set of open
// panels (the Anteprima alone with the chat, the three together…).
//
// The Anteprima's page is a native webview laid over its panel (preview.rs
// preview_pane): this file only tells Rust where the panel is, and hides the
// page while a tab is dragged (dockview's drop zones would be under it).

import { createDockview, themeDark, type DockviewApi, type IContentRenderer, type ITabRenderer, type SerializedDockview } from "dockview-core";
import "../vendor/dockview.css";
import { t } from "../core/i18n";

export type DockPanelId = "chat" | "anteprima" | "terminale";

export interface DockHooks {
  /** The chat's views (#views): moved into the chat's panel. */
  chat: HTMLElement;
  previewOpen(): boolean;
  termOpen(): boolean;
  /** The tab's ✕ on the Anteprima / the terminal. */
  closePreview(): void;
  closeTerm(): void;
  /** Where the Anteprima's page goes, in this window's page pixels (0 = hidden). */
  placePreview(r: Rect): void;
  /** Width of the Anteprima the first time (Impostazioni previewWidth). */
  previewWidth(): number;
}

interface Rect { x: number; y: number; w: number; h: number }

const SAVED = "easyisland.chatDock.";
const NONE: Rect = { x: 0, y: 0, w: 0, h: 0 };

export class ChatDock {
  readonly el: HTMLElement;
  private api: DockviewApi;
  /** One element per panel, kept across rebuilds (fromJSON makes new renderers). */
  private boxes = new Map<DockPanelId, HTMLElement>();
  private dragging = false;
  private sent: Rect = { x: -1, y: -1, w: -1, h: -1 };
  private saveTimer = 0;
  /** Panels being added or removed by us: their ✕ hooks are not the user's. */
  private quiet = false;
  private watch: ResizeObserver;

  constructor(private doc: Document, host: HTMLElement, private hooks: DockHooks) {
    this.el = doc.createElement("div");
    // dockview's dark theme underneath ours (its sizes and drop zones), ours on top.
    this.el.className = "chat-dock dockview-theme-dark";
    host.append(this.el);

    const chat = this.box("chat");
    chat.append(hooks.chat);
    this.box("anteprima").classList.add("dock-preview");
    const term = this.box("terminale");
    term.classList.add("dock-term");
    // chat.ts placeTerminal lays the terminal here when the panel exists.
    term.dataset.termHome = "";

    const boxes = this.boxes;
    this.api = createDockview(this.el, {
      createComponent: (o) => renderer(boxes.get(o.name as DockPanelId) ?? doc.createElement("div")),
      createTabComponent: (o) => tab(doc, o.name as DockPanelId),
      // Ours on dockview's dark one (src/style.css .dockview-theme-easy), with room between the panels.
      theme: { ...themeDark, name: "easy", className: "dockview-theme-easy", gap: 6, dndTabIndicator: "line" },
      // The panels are whole things of the window, not documents: no floating
      // groups or browser popups (a window of its own is EasyIsland's job).
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
    // After the browser has laid the panels out (dockview tells before).
    this.api.onDidLayoutChange(() => {
      this.placeSoon();
      this.save();
    });
    this.api.onDidActivePanelChange(() => this.placeSoon());
    this.api.onDidRemovePanel((p) => {
      if (this.quiet) return;
      // The tab's ✕: the thing itself closes (the next sync would bring it back otherwise).
      if (p.id === "anteprima") hooks.closePreview();
      if (p.id === "terminale") hooks.closeTerm();
    });
    this.watch = new ResizeObserver((entries) => {
      if (entries.some((e) => e.target === this.el)) this.api.layout(this.el.clientWidth, this.el.clientHeight);
      this.placeSoon();
    });
    this.watch.observe(this.el);
    this.watch.observe(this.box("anteprima"));
    this.build();
  }

  /** At every redraw of the window: the panels as the chat has them, the page where its panel is. */
  sync() {
    const want = this.wanted();
    const have = this.api.panels.map((p) => p.id as DockPanelId).sort();
    if (want.join() !== have.join()) this.build();
    // The terminal into its panel (chat.ts placeTerminal lays it there too, once the panel is in the page).
    const term = this.doc.querySelector<HTMLElement>(".chat-term");
    const home = this.boxes.get("terminale");
    if (term && home && want.includes("terminale") && term.parentElement !== home) home.append(term);
    this.placeSoon();
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
    const w: DockPanelId[] = ["chat"];
    if (this.hooks.previewOpen()) w.push("anteprima");
    if (this.hooks.termOpen()) w.push("terminale");
    return w.sort();
  }

  /** The panels again: the arrangement saved for this set, or the usual one. */
  private build() {
    const want = this.wanted();
    this.quiet = true;
    try {
      const saved = load(want);
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
        this.api.addPanel({ id: "chat", component: "chat", tabComponent: "chat", title: t("Chat") });
        if (want.includes("anteprima")) {
          this.api.addPanel({
            id: "anteprima", component: "anteprima", tabComponent: "anteprima", title: t("Anteprima"),
            position: { referencePanel: "chat", direction: "right" },
            initialWidth: this.hooks.previewWidth(),
          });
        }
        if (want.includes("terminale")) {
          this.api.addPanel({
            id: "terminale", component: "terminale", tabComponent: "terminale", title: t("Terminale"),
            position: want.includes("anteprima")
              ? { referencePanel: "anteprima", direction: "below" }
              : { referencePanel: "chat", direction: "right" },
          });
        }
      }
      // The chat stays the one in front where it shares a group.
      this.api.getPanel("chat")?.api.setActive();
    } finally {
      this.quiet = false;
    }
    this.sent = { x: -1, y: -1, w: -1, h: -1 };
  }

  private soon = 0;
  private placeSoon() {
    if (this.soon) return;
    this.soon = (this.doc.defaultView ?? window).requestAnimationFrame(() => {
      this.soon = 0;
      this.place();
    });
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

  /** Tells Rust where the Anteprima's page goes: its panel when shown, nothing while dragging. */
  private place() {
    let next = NONE;
    const p = this.api.getPanel("anteprima");
    const b = this.boxes.get("anteprima");
    if (p && b && p.api.isVisible && !this.dragging && b.isConnected) {
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
      try {
        const ids = this.api.panels.map((p) => p.id).sort();
        if (ids.join() === this.wanted().join()) localStorage.setItem(SAVED + ids.join("+"), JSON.stringify(this.api.toJSON()));
      } catch {
        /* no storage */
      }
    }, 400);
  }
}

function load(ids: DockPanelId[]): SerializedDockview | null {
  try {
    return JSON.parse(localStorage.getItem(SAVED + ids.join("+")) ?? "null") as SerializedDockview | null;
  } catch {
    return null;
  }
}

/** A tab: its name and, but on the chat (always there), a ✕ that closes the thing. */
function tab(doc: Document, id: DockPanelId): ITabRenderer {
  const element = doc.createElement("div");
  element.className = "dock-tab";
  const name = doc.createElement("span");
  name.className = "dock-tab-name";
  element.append(name);
  return {
    element,
    init: (p) => {
      name.textContent = p.title ?? "";
      if (id === "chat") return;
      const x = doc.createElement("button");
      x.className = "dock-tab-x";
      x.textContent = "✕";
      x.title = id === "terminale" ? t("Chiudi il terminale") : t("Chiudi l'Anteprima");
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
