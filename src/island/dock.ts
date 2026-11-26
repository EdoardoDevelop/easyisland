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

export type DockPanelId = "chat" | "cronologia" | "anteprima" | "terminale" | "documenti";

export interface DockHooks {
  /** "isola" or "finestra": arrangements are kept apart (the sizes differ). */
  place: string;
  /** Panels may show now (the island: open on the chat). */
  enabled(): boolean;
  sideOpen(): boolean;
  previewOpen(): boolean;
  termOpen(): boolean;
  /** «Documenti» (chat-docs.ts): the conversation's files. */
  docsOpen(): boolean;
  /** The tab's ✕ on the conversations, the Anteprima, the terminal. */
  closeSide(): void;
  closePreview(): void;
  closeTerm(): void;
  closeDocs(): void;
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
/** The room between panels (the theme's `gap`). */
const GAP = 6;
const ORDER: DockPanelId[] = ["chat", "cronologia", "anteprima", "terminale", "documenti"];

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
  /** The panels could show at the last sync (the island open on the chat): only then do they move. */
  private wasEnabled = false;
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
    this.box("documenti").dataset.docsHome = "";

    const boxes = this.boxes;
    this.api = createDockview(this.el, {
      createComponent: (o) => renderer(boxes.get(o.name as DockPanelId) ?? doc.createElement("div")),
      createTabComponent: (o) => tab(doc, o.name as DockPanelId),
      // Right click on a tab: bigger, undo or redo a move, the usual arrangement, close.
      getTabContextMenuItems: (p) => this.menu(p.panel.id as DockPanelId),
      // Ours on dockview's dark one (src/style.css .dockview-theme-easy), with room between the panels.
      theme: { ...themeDark, name: "easy", className: "dockview-theme-easy", gap: GAP, dndTabIndicator: "line" },
      // The panels are parts of the chat, not documents: no floating groups or
      // browser popups (a window of its own is EasyIsland's job).
      disableFloatingGroups: true,
      singleTabMode: "default",
      // The content inside its group, laid out with it. «always» draws it in a
      // layer of its own placed a frame later: the chat blank for a frame when
      // the panels appeared, a panel's content left behind as it moved (25/11/2026).
      defaultRenderer: "onlyWhenVisible",
      dndStrategy: "pointer",
      scrollbars: "native",
      // When the island or the window changes size, the chat takes the difference
      // and the other panels keep theirs (`prioritize`), as in VS Code. Shared out
      // in proportion, the conversations lost pixels each time the island widened
      // and narrowed again for them (25/11: «si riducono ogni volta»).
      proportionalLayout: false,
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
      this.prioritize();
      this.placeSoon();
      this.save();
    });
    this.api.onDidActivePanelChange(() => this.placeSoon());
    this.api.onDidRemovePanel((p) => {
      if (this.quiet) return;
      // The tab's ✕: the thing itself closes (the next sync would bring it back otherwise).
      // Told on its own element: with «onlyWhenVisible» dockview has already taken
      // it out of the page, where island.ts looked for it (25/11/2026: ✕ did nothing).
      const held = this.boxes.get(p.id as DockPanelId)?.firstElementChild;
      if (held && p.id !== "anteprima" && p.id !== "chat") {
        held.dispatchEvent(new CustomEvent("dock-close"));
        return;
      }
      if (p.id === "cronologia") hooks.closeSide();
      if (p.id === "anteprima") hooks.closePreview();
      if (p.id === "terminale") hooks.closeTerm();
      if (p.id === "documenti") hooks.closeDocs();
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
    // Moving the chat's views into or out of a panel resets every scroll inside
    // them to the top (26 Nov 2026, Edoardo: «la chat scorre tutta in alto»):
    // each is put back, at the bottom if it was there.
    const kept = [...this.doc.querySelectorAll<HTMLElement>(".chat-log, .chat-side, .chat-docs")]
      .filter((e) => e.scrollTop > 0)
      .map((e) => ({ e, top: e.scrollTop, end: e.scrollHeight - e.scrollTop - e.clientHeight < 4 }));
    try {
      this.syncNow();
    } finally {
      if (kept.length) {
        const put = () => kept.forEach(({ e, top, end }) => {
          const want = end ? e.scrollHeight : top;
          if (Math.abs(e.scrollTop - want) > 1) e.scrollTop = want;
        });
        put();
        // Dockview and the panels settle over the next frames: again then.
        (this.doc.defaultView ?? window).requestAnimationFrame(put);
        window.setTimeout(put, 120);
        window.setTimeout(put, 320);
      }
    }
  }

  private syncNow() {
    const want = this.wanted();
    const before = this.active ? this.api.panels.map((p) => p.id as DockPanelId).sort() : ["chat" as DockPanelId];
    const gone = before.filter((id) => !want.includes(id));
    const added = want.filter((id) => !before.includes(id));
    // Panels that go or come back with the island closing or opening (or the
    // chat leaving the screen) do it at once: their own movement was seen over
    // the island shutting (26 Nov 2026, Edoardo: «si intravedono le loro animazioni di chiusura»).
    const steady = this.hooks.enabled() && this.wasEnabled;
    this.wasEnabled = this.hooks.enabled();
    // One panel closed with its ✕ or button: a picture of it, fading where it is once the rest is laid out.
    const leaving = steady && this.active && gone.length === 1 && !added.length ? this.ghost(gone[0]) : null;
    // What the closed panels held: the chat takes it back once they are gone (chat.ts «dock-left»).
    const left = gone.map((id) => this.boxes.get(id)?.firstElementChild).filter((e): e is Element => !!e);
    const giveBack = () => left.forEach((e) => e.dispatchEvent(new CustomEvent("dock-left")));
    const on = want.length > 1;
    if (on !== this.active) {
      if (on) this.show();
      else this.hide();
    }
    if (!on) {
      this.home();
      giveBack();
      leaving?.();
      return;
    }
    if (!this.views.isConnected || this.views.parentElement !== this.boxes.get("chat")) this.box("chat").append(this.views);
    const have = this.api.panels.map((p) => p.id as DockPanelId).sort();
    if (want.join() !== have.join()) {
      this.build(want);
      if (added.length === 1 && steady) this.arrive(added[0]);
    }
    giveBack();
    leaving?.();
    // The conversations and the terminal into their panels (chat.ts lays them
    // there too, once the panel is in the page).
    this.adopt(".chat-side", "cronologia", want);
    this.adopt(".chat-term", "terminale", want);
    this.adopt(".chat-docs", "documenti", want);
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
    if (this.hooks.docsOpen()) w.push("documenti");
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
          this.api.fromJSON(fitTo(saved, this.el.clientWidth, this.el.clientHeight));
          done = this.api.panels.map((p) => p.id).sort().join() === want.join();
          if (done) this.restoreSizes(saved);
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
        // On the right as the Anteprima and the terminal: a tab beside them when one is there.
        if (want.includes("documenti")) {
          const beside = want.includes("terminale") ? "terminale" : want.includes("anteprima") ? "anteprima" : "";
          this.add("documenti", beside ? { referencePanel: beside, direction: "within" } : { referencePanel: "chat", direction: "right" }, beside ? undefined : 270);
        }
      }
      // The chat stays the one in front where it shares a group.
      this.api.getPanel("chat")?.api.setActive();
      this.prioritize();
      this.hooks.log(`pannelli (${this.hooks.place}): ${want.join(", ")}${done ? " come li avevi messi" : ""}`);
    } finally {
      this.quiet = false;
    }
    this.resend();
  }

  // ── Opening and closing that move (Edoardo, 25 Nov 2026: «apertura fluida
  // invece di scattosa… se dico fluido deve essere tutto fluido») ────────────
  // The arrangement changes once, at the click; then only the panel moves, by
  // transform and opacity (the compositor, nothing laid out again). Opening:
  // its group slides in from its outer edge. Closing: a picture of it (a clone)
  // slides out over the chat already laid out without it. Tried before, and
  // dropped: resizing the group a frame at a time (dockview applies a size a
  // frame late: empty frames, contents pushed, text a word a line at 30 px),
  // and the island widening for the conversations (Windows resized the window:
  // the island black and at the old size for some frames).

  /** Whether the user asked the system for less motion. */
  private still(): boolean {
    return (this.doc.defaultView ?? window).matchMedia("(prefers-reduced-motion: reduce)").matches;
  }

  /**
   * The chat's group first in line for space that comes or goes (the island
   * resizing, a panel moving): «high» priority in dockview's splitview, read at
   * every layout. dockview sets it only when it creates a group, so it is set on
   * the group's own field (dockview-core 8.9.1, version fixed in package.json).
   */
  private prioritize() {
    const chat = this.api.getPanel("chat")?.group;
    for (const g of this.api.groups) {
      const want = g === chat ? "high" : undefined;
      const field = g as unknown as { _priority?: string };
      if (field._priority !== want) field._priority = want;
    }
  }

  /** How `id`'s group leaves or enters: toward the nearer edge of the dock, by its own size and the gap. */
  private exitOf(el: HTMLElement): string {
    const r = el.getBoundingClientRect();
    const d = this.el.getBoundingClientRect();
    const gaps = [
      [r.left - d.left, `translateX(${-Math.round(r.right - d.left + GAP)}px)`],
      [d.right - r.right, `translateX(${Math.round(d.right - r.left + GAP)}px)`],
      [r.top - d.top, `translateY(${-Math.round(r.bottom - d.top + GAP)}px)`],
      [d.bottom - r.bottom, `translateY(${Math.round(d.bottom - r.top + GAP)}px)`],
    ] as const;
    return [...gaps].sort((x, y) => x[0] - y[0])[0][1];
  }

  /** A panel just added: its group slides in from the nearer edge; a tab among others fades in. */
  private arrive(id: DockPanelId) {
    const p = this.api.getPanel(id);
    const box = this.boxes.get(id);
    if (this.still() || !p || !box) return;
    if (p.group.panels.length > 1) {
      box.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 200, easing: "ease-out" });
      return;
    }
    // The group with its content; the dock clips it meanwhile, so the panel
    // never passes over the island's menu.
    const el = p.group.element;
    this.el.classList.add("dock-sliding");
    const end = () => this.el.classList.remove("dock-sliding");
    el.animate([{ transform: this.exitOf(el), opacity: 0.4 }, { transform: "none", opacity: 1 }],
      { duration: 320, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }).finished.then(end, end);
  }

  /**
   * A panel about to go: a clone of its group where it is now, in a frame over
   * the dock that clips it. The returned function, called once the rest is laid
   * out, slides it to the nearer edge and removes it. Null: nothing to show.
   */
  private ghost(id: DockPanelId): (() => void) | null {
    const p = this.api.getPanel(id);
    if (this.still() || !p || p.group.panels.length > 1) return null;
    const el = p.group.element;
    const r = el.getBoundingClientRect();
    const d = this.el.getBoundingClientRect();
    if (r.width < 40 || r.height < 40) return null;
    const frame = this.doc.createElement("div");
    // The dock's classes: its theme's colours, borders and sizes on the picture too.
    frame.className = `${this.el.className} dock-ghost-frame`;
    Object.assign(frame.style, { position: "fixed", display: "block", left: `${d.left}px`, top: `${d.top}px`, width: `${d.width}px`, height: `${d.height}px` });
    const parts: HTMLElement[] = [];
    for (const src of [el]) {
      if (!src) continue;
      const at = src.getBoundingClientRect();
      if (!at.width || !at.height) continue;
      const clone = src.cloneNode(true) as HTMLElement;
      clone.classList.add("dock-ghost");
      Object.assign(clone.style, { position: "absolute", inset: "auto", left: `${at.left - d.left}px`, top: `${at.top - d.top}px`, width: `${at.width}px`, height: `${at.height}px` });
      frame.append(clone);
      parts.push(clone);
    }
    return () => {
      this.doc.body.append(frame);
      // Where it is, fading out and a little smaller (26 Nov 2026, Edoardo: sliding
      // to the edge, half faded, looked like «sfumare verso il basso»).
      const opts: KeyframeAnimationOptions = { duration: 150, easing: "cubic-bezier(0.4, 0, 1, 1)", fill: "forwards" };
      const done = parts.map((c) => c.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "scale(0.985)" }], opts).finished);
      Promise.all(done).then(() => frame.remove(), () => frame.remove());
    };
  }

  private add(id: DockPanelId, position?: { referencePanel: string; direction: "left" | "right" | "below" | "within" }, width?: number) {
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
      const data = JSON.parse(json) as Saved;
      this.api.fromJSON(fitTo(data, this.el.clientWidth, this.el.clientHeight));
      this.restoreSizes(data);
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

  /** Each panel's group but the chat's, at its size now, by the panels in it («documenti», «anteprima+terminale»). */
  private groupSizes(): Record<string, [number, number]> {
    const chat = this.api.getPanel("chat")?.group;
    const out: Record<string, [number, number]> = {};
    for (const g of this.api.groups) if (g !== chat) out[g.panels.map((p) => p.id).sort().join("+")] = [g.api.width, g.api.height];
    return out;
  }

  /**
   * The panels back at the sizes they had when saved, to the pixel. Each save
   * and restore of dockview moved a divider by a few pixels, one way or the
   * other (conversations 233 → 230 → 227, Documenti 267 → 273 → 279, 25/11/2026):
   * now the chat takes the difference. setSize gives what it likes for what is
   * asked (a few px off): asked again with the difference.
   */
  private restoreSizes(saved: Saved) {
    this.prioritize();
    const sizes = saved.sizes ?? {};
    const chat = this.api.getPanel("chat")?.group;
    for (const g of this.api.groups) {
      const want = g === chat ? undefined : sizes[g.panels.map((p) => p.id).sort().join("+")];
      if (!want) continue;
      (["width", "height"] as const).forEach((dim, i) => {
        let ask = want[i];
        for (let n = 0; n < 3; n++) {
          const got = dim === "width" ? g.api.width : g.api.height;
          if (got === want[i]) return;
          if (n) ask += want[i] - got;
          try {
            g.api.setSize({ [dim]: ask });
          } catch {
            return;
          }
        }
      });
    }
  }

  private save() {
    window.clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => {
      if (!this.active) return;
      try {
        const ids = this.api.panels.map((p) => p.id).sort();
        if (ids.join() !== this.wanted().join()) return;
        const json = JSON.stringify({ ...this.api.toJSON(), sizes: this.groupSizes() });
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
  documenti: () => t("Documenti"),
};

const ICON: Record<DockPanelId, string> = {
  chat: ICONS.bubble,
  cronologia: ICONS.history,
  anteprima: ICONS.preview,
  terminale: ICONS.lineTerminal,
  documenti: ICONS.doc,
};

type GridNode = { type: string; data: unknown; size: number };

/**
 * A saved arrangement made to the dock's size now, the difference given to the
 * chat (or the last panel of a row without it). dockview would share it out as
 * it pleases while it restores, before the chat's priority is set.
 */
function fitTo(saved: SerializedDockview, w: number, h: number): SerializedDockview {
  const grid = saved.grid as unknown as { root: GridNode; width: number; height: number; orientation: string };
  const copy = JSON.parse(JSON.stringify(saved)) as SerializedDockview & { sizes?: unknown };
  delete copy.sizes;
  if (!grid?.root || !w || !h || (grid.width === w && grid.height === h)) return copy;
  const g = copy.grid as unknown as typeof grid;
  const dW = w - g.width;
  const dH = h - g.height;
  const holdsChat = (n: GridNode): boolean =>
    n.type === "leaf" ? ((n.data as { views?: string[] }).views ?? []).includes("chat") : ((n.data as GridNode[]) ?? []).some(holdsChat);
  // A branch's children lie along its orientation: one of them takes `along`, all of them `across` inside.
  const fit = (n: GridNode, along: number, across: number) => {
    if (n.type !== "branch") return;
    const kids = (n.data as GridNode[]) ?? [];
    if (!kids.length) return;
    const chat = kids.findIndex(holdsChat);
    const pick = chat < 0 ? kids.length - 1 : chat;
    kids.forEach((k, j) => {
      const mine = j === pick ? along : 0;
      if (mine) k.size = Math.max(1, k.size + mine);
      fit(k, across, mine);
    });
  };
  const horizontal = g.orientation === "HORIZONTAL";
  fit(g.root, horizontal ? dW : dH, horizontal ? dH : dW);
  g.root.size = Math.max(1, g.root.size + (horizontal ? dH : dW));
  g.width = w;
  g.height = h;
  return copy;
}

/** A saved arrangement: dockview's, with the panels' sizes to the pixel (groupSizes). */
type Saved = SerializedDockview & { sizes?: Record<string, [number, number]> };

function load(key: string): Saved | null {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "null") as Saved | null;
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
      // The chat's tab holds the tabs of its conversations (chat.ts placeTabs; Edoardo,
      // 24 Nov 2026): held and dragged, the bar still moves the panel.
      if (id === "chat") {
        element.dataset.chatTabsHome = "";
        // The icon is the handle: its own tooltip, the tabs have theirs.
        element.title = "";
        icon.title = t("Tieni premuto e trascina per spostare la chat · doppio clic: ingrandisci o riduci");
        // Made again (a move, a panel more): the tabs come at once, not at the next redraw.
        const row = doc.querySelector<HTMLElement>(".chat-tabs");
        if (row) {
          element.append(row);
          row.classList.add("in-dock");
        }
        return;
      }
      const x = doc.createElement("button");
      x.className = "dock-tab-x";
      x.append(svg(ICONS.xmark, 10));
      x.title = id === "terminale" ? t("Chiudi il terminale") : id === "anteprima" ? t("Chiudi l'Anteprima") : id === "documenti" ? t("Chiudi i documenti") : t("Nascondi le conversazioni");
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
