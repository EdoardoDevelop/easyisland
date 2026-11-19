// Interactive Dock UI controller (docs/piano-dock.md): shared identically by
// the dedicated Dock window (src/dock/main.ts) and browser preview scenes
// (dev/scenes.ts). Zero idle timers or rAF loops when resting.

import { Bridge, type DockWin } from "../core/bridge";
import { t } from "../core/i18n";
import type { BarPiece, DockSnapshot } from "../core/link";
import type { DockPin } from "../core/state";
import { renderActionIcon } from "../views/action-icons";
import { clear, h } from "../views/dom";
import {
  DEFAULT_METRICS,
  buildDockLayout,
  iconAt,
  magnifyLayout,
  type DockLayout,
  type ItemKind,
  type MagnifiedLayout,
  type Metrics,
} from "./magnify";

/** Dwell delays and hysteresis matching docs/piano-dock.md. */
const PREVIEW_DWELL_MS = 420;
const PREVIEW_SWITCH_MS = 60;
const PREVIEW_LEAVE_MS = 180;
const SPRING_LOAD_MS = 600;
const AUTOHIDE_ENTER_MS = 250;
const AUTOHIDE_LEAVE_MS = 650;
const DRAG_THRESHOLD_PX = 8;

export interface DockHostOps {
  onAction: (what: string, opts?: { hwnd?: number; app?: string; files?: string[] }) => void;
  onWidgetClick: (pieceKey: string, button: "left" | "middle" | "right", x: number) => void;
  onPinReorder: (pinned: DockPin[]) => void;
  onPinToggle: (entry: { id: string; name: string; path?: string; aumid?: string }, pin: boolean) => void;
  onThumbsChange: (rects: { hwnd: number; x: number; y: number; w: number; h: number }[]) => void;
  onShapeChange?: (band: number, rects: [number, number, number, number][]) => void;
  onOpenIsland: () => void;
  onOpenSettings: () => void;
  onFilesDrop?: (appId: string, files: string[]) => void;
}

interface DockEntry {
  key: string;
  kind: "pin" | "open" | "recent" | "minimized" | "island";
  appId: string;
  name: string;
  icon: string;
  pinned: boolean;
  pin?: DockPin;
  windows: DockWin[];
  active: boolean;
  minimized: boolean;
  attention: boolean;
}

type RenderSlot =
  | { kind: "entry"; entry: DockEntry }
  | { kind: "separator"; id: string };

/** Key matching a window to a pinned app (AUMID first, then path, then app id). */
function appKeyOfWin(w: DockWin): string {
  return w.app.trim().toLowerCase();
}

function appKeyOfPin(p: DockPin): string {
  return (p.aumid || p.path || p.id).trim().toLowerCase();
}

function fallbackInitial(name: string): string {
  const ch = name.trim().charAt(0).toUpperCase();
  return ch || "•";
}

export class DockView {
  private readonly host: HTMLElement;
  private readonly ops: DockHostOps;

  private stage: HTMLElement;
  private revealStrip: HTMLElement;
  private shell: HTMLElement;
  private glass: HTMLElement;
  private track: HTMLElement;
  private widgetsEl: HTMLElement;
  private labelEl: HTMLElement | null = null;
  private previewEl: HTMLElement | null = null;
  private ctxEl: HTMLElement | null = null;

  private snap: DockSnapshot;
  private windows: DockWin[] = [];
  private icons = new Map<string, string>();
  private recentApps: DockPin[] = [];
  private covered = false;
  /** Stable window discovery order for multi-window preview cards (PreviewOrder). */
  private readonly discoveryOrder: number[] = [];

  private slots: RenderSlot[] = [];
  private slotEls: HTMLElement[] = [];
  private layout: DockLayout = buildDockLayout([]);
  private metrics: Metrics = { ...DEFAULT_METRICS };
  private currentMag: MagnifiedLayout = magnifyLayout(this.layout, 0, 0, { range: 132, maxScale: 1 });

  /** Hover & magnification blend (0..1); animated only during transitions. */
  private magTarget = 0;
  private magAmount = 0;
  private magCursorX = 0;
  private magRaf = 0;
  private magLastTs = 0;
  private hoveredIdx = -1;

  /** Auto-hide & pointer region state. */
  private revealed = false;
  private shellHot = false;
  private lastShapeKey = "";
  private revealTimer: number | null = null;
  private hideTimer: number | null = null;

  /** Hover preview state. */
  private previewTimer: number | null = null;
  private previewCloseTimer: number | null = null;
  private previewAppKey = "";

  /** Spring-loaded external file drag state. */
  private springTimer: number | null = null;
  private springKey = "";
  private dropHighlightIdx = -1;

  /** Horizontal pinned-icon reorder drag (protected against WS_EX_NOACTIVATE lost capture). */
  private dragPinIdx = -1;
  private dragStartX = 0;
  private dragActive = false;
  private cancelClickUntil = 0;

  constructor(host: HTMLElement, ops: DockHostOps, initialSnap: DockSnapshot) {
    this.host = host;
    this.ops = ops;
    this.snap = initialSnap;

    this.stage = h("div", { class: "dock-stage" });
    this.revealStrip = h("div", { class: "dock-reveal-strip" });
    this.shell = h("div", { class: "dock-shell" });
    this.glass = h("div", { class: "dock-glass" });
    this.track = h("div", { class: "dock-track" });
    this.widgetsEl = h("div", { class: "dock-widgets" });

    this.glass.append(h("div", { class: "dock-row-inner" }, this.track, this.widgetsEl));
    this.shell.append(this.glass);
    this.stage.append(this.revealStrip, this.shell);
    clear(this.host);
    this.host.append(this.stage);

    this.bindEvents();
    this.applyThemeTokens();
    this.rebuild();
  }

  setSnapshot(snap: DockSnapshot) {
    this.snap = snap;
    this.applyThemeTokens();
    this.rebuild();
  }

  setWindows(windows: DockWin[]) {
    this.windows = windows;
    for (const w of windows) {
      if (!this.discoveryOrder.includes(w.hwnd)) this.discoveryOrder.push(w.hwnd);
    }
    const liveHwnds = new Set(windows.map((w) => w.hwnd));
    for (let i = this.discoveryOrder.length - 1; i >= 0; i--) {
      if (!liveHwnds.has(this.discoveryOrder[i])) this.discoveryOrder.splice(i, 1);
    }
    this.rebuild();
    if (this.previewAppKey) this.refreshOpenPreview();
  }

  setIcons(icons: Record<string, string>) {
    let changed = false;
    for (const [k, url] of Object.entries(icons)) {
      if (this.icons.get(k) !== url) {
        this.icons.set(k, url);
        changed = true;
      }
    }
    if (changed) this.rebuild();
  }

  setCovered(covered: boolean) {
    this.covered = covered;
    this.updateHiddenAttr();
  }

  setRecents(recents: DockPin[]) {
    this.recentApps = recents.slice(0, 3);
    this.rebuild();
  }

  destroy() {
    this.stopMagAnim();
    this.clearPreviewTimers();
    this.clearSpringTimer();
    if (this.revealTimer) window.clearTimeout(this.revealTimer);
    if (this.hideTimer) window.clearTimeout(this.hideTimer);
    this.closeContextMenu();
    this.closePreview();
  }

  private reducedMotion(): boolean {
    return this.snap.animations === "fermo"
      || (typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  }

  private maxScale(): number {
    if (this.reducedMotion()) return 1;
    const mode = this.snap.look.magnify ?? "subtle";
    if (mode === "off") return 1;
    return mode === "lively" ? 1.44 : 1.28;
  }

  private applyThemeTokens() {
    const look = this.snap.look;
    const ds = this.stage.dataset;
    ds.ui = this.snap.style;
    ds.scheme = this.snap.scheme;
    ds.dockStyle = look.style ?? "capsule";
    ds.dockBlur = String(!!look.blur);
    ds.dockShadow = String(look.shadow !== false);
    ds.opaque = String(!!this.snap.reduceTransparency);

    this.stage.style.setProperty("--dock-opacity", String(Math.max(15, Math.min(100, look.opacity ?? 88))));
    this.stage.style.setProperty("--dock-margin", `${Math.max(0, Math.min(24, look.margin ?? 8))}px`);
    if (this.snap.accent) this.stage.style.setProperty("--dock-accent", this.snap.accent);
    if (this.snap.font?.stack) this.stage.style.setProperty("--font", this.snap.font.stack);
    this.updateHiddenAttr();
  }

  private updateHiddenAttr() {
    const mode = this.snap.look.autoHide ?? "off";
    const blocked = !!this.previewEl || !!this.ctxEl || this.dragActive || this.dropHighlightIdx >= 0;
    const shouldHide = !blocked && !this.revealed && (mode === "auto" || (mode === "smart" && this.covered));
    this.stage.dataset.dockHidden = String(shouldHide);
    this.scheduleShapeReport();
  }

  /** Builds unified list: optional EasyIsland anchor + pinned + open unpinned + recents + minimized. */
  private buildEntries(): RenderSlot[] {
    const look = this.snap.look;
    const groupOn = look.groupWindows !== false;
    const byApp = new Map<string, DockWin[]>();
    for (const w of this.windows) {
      if (look.showMinimized && w.minimized) continue;
      const k = appKeyOfWin(w);
      const list = byApp.get(k);
      if (list) list.push(w);
      else byApp.set(k, [w]);
    }

    const out: RenderSlot[] = [];
    const consumedApps = new Set<string>();

    if (look.characterInDock) {
      out.push({
        kind: "entry",
        entry: {
          key: "easyisland",
          kind: "island",
          appId: "easyisland",
          name: "EasyIsland",
          icon: "i:robot",
          pinned: true,
          windows: [],
          active: false,
          minimized: false,
          attention: false,
        },
      });
    }

    for (const pin of this.snap.pinned) {
      const k = appKeyOfPin(pin);
      consumedApps.add(k);
      const wins = byApp.get(k) ?? [];
      out.push({
        kind: "entry",
        entry: {
          key: `pin:${pin.id}`,
          kind: "pin",
          appId: k,
          name: pin.name,
          icon: this.icons.get(k) ?? wins[0]?.icon ?? "",
          pinned: true,
          pin,
          windows: wins,
          active: wins.some((w) => w.active),
          minimized: wins.length > 0 && wins.every((w) => w.minimized),
          attention: wins.some((w) => w.attention),
        },
      });
    }

    const extraEntries: DockEntry[] = [];
    if (groupOn) {
      for (const [k, wins] of byApp) {
        if (consumedApps.has(k)) continue;
        consumedApps.add(k);
        extraEntries.push({
          key: `open:${k}`,
          kind: "open",
          appId: k,
          name: wins[0]?.title || wins[0]?.app || k,
          icon: this.icons.get(k) ?? wins[0]?.icon ?? "",
          pinned: false,
          windows: wins,
          active: wins.some((w) => w.active),
          minimized: wins.every((w) => w.minimized),
          attention: wins.some((w) => w.attention),
        });
      }
    } else {
      for (const w of this.windows) {
        if (look.showMinimized && w.minimized) continue;
        const k = appKeyOfWin(w);
        if (consumedApps.has(k)) continue;
        extraEntries.push({
          key: `win:${w.hwnd}`,
          kind: "open",
          appId: k,
          name: w.title || w.app,
          icon: this.icons.get(k) ?? w.icon ?? "",
          pinned: false,
          windows: [w],
          active: w.active,
          minimized: w.minimized,
          attention: w.attention,
        });
      }
    }

    if (out.length && extraEntries.length) out.push({ kind: "separator", id: "sep-open" });
    for (const e of extraEntries) out.push({ kind: "entry", entry: e });

    if (look.recents && this.recentApps.length) {
      const rec = this.recentApps.filter((r) => !consumedApps.has(appKeyOfPin(r)));
      if (rec.length) {
        out.push({ kind: "separator", id: "sep-recents" });
        for (const r of rec) {
          const k = appKeyOfPin(r);
          out.push({
            kind: "entry",
            entry: {
              key: `recent:${r.id}`,
              kind: "recent",
              appId: k,
              name: r.name,
              icon: this.icons.get(k) ?? "",
              pinned: false,
              pin: r,
              windows: [],
              active: false,
              minimized: false,
              attention: false,
            },
          });
        }
      }
    }

    if (look.showMinimized) {
      const mins = this.windows.filter((w) => w.minimized);
      if (mins.length) {
        out.push({ kind: "separator", id: "sep-min" });
        for (const w of mins) {
          out.push({
            kind: "entry",
            entry: {
              key: `min:${w.hwnd}`,
              kind: "minimized",
              appId: appKeyOfWin(w),
              name: w.title || w.app,
              icon: this.icons.get(appKeyOfWin(w)) ?? w.icon ?? "",
              pinned: false,
              windows: [w],
              active: false,
              minimized: true,
              attention: w.attention,
            },
          });
        }
      }
    }

    return out;
  }

  private rebuild() {
    const iconSize = Math.max(28, Math.min(64, this.snap.look.iconSize ?? 44));
    const gap = Math.max(4, Math.min(20, this.snap.look.gap ?? 10));
    this.metrics = { ...DEFAULT_METRICS, icon: iconSize, gap };

    this.slots = this.buildEntries();
    const kinds: ItemKind[] = this.slots.map((s) => (s.kind === "separator" ? "separator" : "icon"));
    this.layout = buildDockLayout(kinds, this.metrics);

    this.track.replaceChildren();
    this.slotEls = this.slots.map((s, idx) => {
      if (s.kind === "separator") {
        const sep = h("div", { class: "dock-slot dock-slot-sep", "aria-hidden": "true" });
        this.track.append(sep);
        return sep;
      }
      const entry = s.entry;
      const btn = h("button", {
        type: "button",
        class: "dock-slot",
        "aria-label": entry.name,
      });
      btn.dataset.idx = String(idx);
      btn.classList.toggle("active", entry.active);
      btn.classList.toggle("minimized", entry.minimized);
      btn.classList.toggle("attention", entry.attention);
      btn.classList.toggle("drop-hover", idx === this.dropHighlightIdx);

      const tile = h("div", { class: "dock-tile" });
      if (entry.icon.startsWith("i:")) {
        tile.append(h("div", { class: "dock-icon-svg" }, renderActionIcon(entry.icon, Math.round(iconSize * 0.62))));
      } else if (entry.icon) {
        tile.append(h("img", { class: "dock-icon-img", src: entry.icon, alt: "", draggable: "false" }));
      } else {
        tile.append(h("div", { class: "dock-fallback-glyph", text: fallbackInitial(entry.name) }));
      }

      if (entry.windows.length >= 2) {
        tile.append(h("span", { class: "dock-group-badge", text: String(entry.windows.length) }));
      }
      btn.append(tile);

      if (this.snap.look.indicators !== false && (entry.windows.length > 0 || entry.kind === "island")) {
        const dots = h("div", { class: "dock-dots" });
        const count = entry.kind === "island" ? 1 : Math.min(3, entry.windows.length);
        for (let d = 0; d < count; d++) {
          dots.append(h("span", { class: d === 0 ? "dock-dot main" : "dock-dot" }));
        }
        btn.append(dots);
      }

      this.track.append(btn);
      return btn;
    });

    this.renderWidgets();
    this.paintGeometry();
    this.scheduleShapeReport();
  }

  private renderWidgets() {
    clear(this.widgetsEl);
    const pieces: BarPiece[] = this.snap.items ?? [];
    if (!pieces.length) {
      this.widgetsEl.style.display = "none";
      return;
    }
    this.widgetsEl.style.display = "inline-flex";
    this.widgetsEl.append(h("div", { class: "dock-widget-sep", "aria-hidden": "true" }));
    for (const p of pieces) {
      const btn = h("button", { type: "button", class: "dock-widget-btn", title: p.title });
      btn.dataset.key = p.key;
      btn.innerHTML = p.html;
      btn.addEventListener("pointerdown", (e) => {
        if (e.button === 0) {
          const r = btn.getBoundingClientRect();
          this.ops.onWidgetClick(p.key, "left", Math.round(r.left + r.width / 2));
        }
      });
      btn.addEventListener("auxclick", (e) => {
        if (e.button === 1) this.ops.onWidgetClick(p.key, "middle", Math.round(e.clientX));
      });
      btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        e.stopPropagation();
        this.ops.onWidgetClick(p.key, "right", Math.round(e.clientX));
      });
      this.widgetsEl.append(btn);
    }
  }

  private paintGeometry() {
    const scale = 1 + (this.maxScale() - 1) * this.magAmount;
    const range = this.metrics.icon * 3;
    this.currentMag = magnifyLayout(this.layout, this.magCursorX, this.magAmount, {
      range,
      maxScale: scale > 1 ? this.maxScale() : 1,
    });

    this.track.style.width = `${Math.round(this.layout.width)}px`;
    this.track.style.height = `${Math.round(this.layout.height)}px`;
    this.glass.style.height = `${Math.round(this.layout.height)}px`;

    const widgetsW = this.widgetsEl.style.display === "none" ? 0 : this.widgetsEl.offsetWidth;
    const baseW = Math.round(this.currentMag.right - this.currentMag.left) + widgetsW;
    this.glass.style.width = `${baseW}px`;

    for (let i = 0; i < this.slotEls.length; i++) {
      const r = this.currentMag.rects[i];
      const el = this.slotEls[i];
      if (!r || !el) continue;
      el.style.left = `${(r.x - this.currentMag.left).toFixed(1)}px`;
      el.style.top = `${r.y.toFixed(1)}px`;
      el.style.width = `${r.width.toFixed(1)}px`;
      el.style.height = `${r.height.toFixed(1)}px`;
    }

    if (this.hoveredIdx >= 0 && this.snap.look.labels !== false && !this.previewEl && !this.ctxEl) {
      this.positionLabel(this.hoveredIdx);
    } else if (this.labelEl) {
      this.labelEl.remove();
      this.labelEl = null;
    }
  }

  private positionLabel(idx: number) {
    const slot = this.slots[idx];
    const r = this.currentMag.rects[idx];
    if (!slot || slot.kind !== "entry" || !r) return;
    if (!this.labelEl) {
      this.labelEl = h("div", { class: "dock-label" });
      this.shell.append(this.labelEl);
    }
    this.labelEl.textContent = slot.entry.name;
    const center = this.track.offsetLeft + r.x - this.currentMag.left + r.width / 2;
    this.labelEl.style.left = `${Math.round(center)}px`;
  }

  private bindEvents() {
    this.revealStrip.addEventListener("pointerenter", () => this.scheduleReveal());
    this.revealStrip.addEventListener("pointerleave", () => {
      if (this.revealTimer) {
        window.clearTimeout(this.revealTimer);
        this.revealTimer = null;
      }
    });

    this.shell.addEventListener("pointerenter", () => {
      if (this.hideTimer) {
        window.clearTimeout(this.hideTimer);
        this.hideTimer = null;
      }
      this.revealed = true;
      if (!this.shellHot) {
        this.shellHot = true;
        this.scheduleShapeReport();
      }
      this.updateHiddenAttr();
    });

    this.track.addEventListener("pointermove", (e) => {
      if (this.dragPinIdx >= 0) {
        this.handlePinDragMove(e.clientX);
        return;
      }
      const rect = this.track.getBoundingClientRect();
      this.magCursorX = e.clientX - rect.left + this.currentMag.left;
      this.magTarget = this.maxScale() > 1 ? 1 : 0;
      const idx = iconAt(this.currentMag, this.layout, this.magCursorX, this.metrics.gap);
      if (idx !== this.hoveredIdx) {
        this.hoveredIdx = idx;
        this.onHoveredSlotChange(idx);
      }
      if (this.magAmount > 0 || this.magTarget > 0) this.startMagAnim();
      else this.paintGeometry();
    });

    this.shell.addEventListener("pointerleave", (e) => {
      const related = e.relatedTarget as Node | null;
      if (related && (this.previewEl?.contains(related) || this.ctxEl?.contains(related))) return;
      this.hoveredIdx = -1;
      this.magTarget = 0;
      if (this.shellHot) {
        this.shellHot = false;
        this.scheduleShapeReport();
      }
      this.startMagAnim();
      this.scheduleClosePreview();
      this.scheduleAutoHide();
    });

    this.track.addEventListener("pointerdown", (e) => {
      // Re-resolve pointer coordinate cleanly on click (avoids coalesced mousemove drift).
      const rect = this.track.getBoundingClientRect();
      const x = e.clientX - rect.left + this.currentMag.left;
      const idx = iconAt(this.currentMag, this.layout, x, this.metrics.gap);
      const slot = this.slots[idx];
      if (!slot || slot.kind !== "entry") return;
      const entry = slot.entry;

      if (e.button === 0 && !e.shiftKey && !e.ctrlKey && entry.kind === "pin") {
        this.dragPinIdx = idx;
        this.dragStartX = e.clientX;
        this.dragActive = false;
      }
    });

    window.addEventListener("pointerup", (e) => {
      if (this.dragPinIdx >= 0) {
        const wasDrag = this.dragActive;
        const fromIdx = this.dragPinIdx;
        this.finishPinDrag(wasDrag ? e.clientX : null, fromIdx);
        if (wasDrag) return;
      }
    });

    this.track.addEventListener("click", (e) => {
      if (performance.now() < this.cancelClickUntil) return;
      const rect = this.track.getBoundingClientRect();
      const x = e.clientX - rect.left + this.currentMag.left;
      const idx = iconAt(this.currentMag, this.layout, x, this.metrics.gap);
      const slot = this.slots[idx];
      if (!slot || slot.kind !== "entry") return;
      this.activateEntry(slot.entry, e.shiftKey || e.ctrlKey, idx);
    });

    this.track.addEventListener("auxclick", (e) => {
      if (e.button !== 1) return;
      const rect = this.track.getBoundingClientRect();
      const x = e.clientX - rect.left + this.currentMag.left;
      const idx = iconAt(this.currentMag, this.layout, x, this.metrics.gap);
      const slot = this.slots[idx];
      if (slot?.kind === "entry") this.launchEntry(slot.entry);
    });

    this.glass.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      const rect = this.track.getBoundingClientRect();
      const x = e.clientX - rect.left + this.currentMag.left;
      const idx = iconAt(this.currentMag, this.layout, x, this.metrics.gap);
      const slot = this.slots[idx];
      if (slot?.kind === "entry") this.openEntryContextMenu(slot.entry, idx);
      else this.openDockContextMenu(e.clientX);
    });

    // External file drop & spring-loaded bring-to-front.
    this.track.addEventListener("dragenter", (e) => {
      e.preventDefault();
      this.revealed = true;
      this.updateHiddenAttr();
    });
    this.track.addEventListener("dragover", (e) => {
      e.preventDefault();
      const rect = this.track.getBoundingClientRect();
      const x = e.clientX - rect.left + this.currentMag.left;
      const idx = iconAt(this.currentMag, this.layout, x, this.metrics.gap);
      if (idx !== this.dropHighlightIdx) {
        this.dropHighlightIdx = idx;
        this.slotEls.forEach((el, i) => el.classList.toggle("drop-hover", i === idx));
        this.clearSpringTimer();
        const slot = this.slots[idx];
        if (slot?.kind === "entry" && slot.entry.windows.length > 0 && slot.entry.key !== this.springKey) {
          this.springKey = slot.entry.key;
          const targetWin = slot.entry.windows[0];
          this.springTimer = window.setTimeout(() => {
            this.ops.onAction(targetWin.minimized ? "restore" : "focus", { hwnd: targetWin.hwnd });
          }, SPRING_LOAD_MS);
        }
      }
    });
    this.track.addEventListener("dragleave", () => {
      this.dropHighlightIdx = -1;
      this.slotEls.forEach((el) => el.classList.remove("drop-hover"));
      this.clearSpringTimer();
      this.updateHiddenAttr();
    });
    this.track.addEventListener("drop", (e) => {
      e.preventDefault();
      const idx = this.dropHighlightIdx;
      this.dropHighlightIdx = -1;
      this.slotEls.forEach((el) => el.classList.remove("drop-hover"));
      this.clearSpringTimer();
      const files = [...(e.dataTransfer?.files ?? [])].map((f) => (f as File & { path?: string }).path || f.name).filter(Boolean);
      const slot = this.slots[idx];
      if (!slot || slot.kind !== "entry" || !files.length) return;
      if (slot.entry.kind === "island") this.ops.onFilesDrop?.("easyisland", files);
      else this.ops.onAction("drop-files", { app: slot.entry.appId, files });
    });

    window.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      if (this.dragPinIdx >= 0) {
        this.dragPinIdx = -1;
        this.dragActive = false;
        this.cancelClickUntil = performance.now() + 250;
        this.rebuild();
      }
      this.closeContextMenu();
      this.closePreview();
      this.magTarget = 0;
      this.hoveredIdx = -1;
      this.startMagAnim();
    });
    window.addEventListener("blur", () => {
      if (this.dragPinIdx >= 0) {
        this.dragPinIdx = -1;
        this.dragActive = false;
        this.rebuild();
      }
      this.closeContextMenu();
      this.closePreview();
      this.hoveredIdx = -1;
      this.magTarget = 0;
      this.startMagAnim();
    });
    document.addEventListener("pointerdown", (e) => {
      const target = e.target as Node | null;
      if (this.ctxEl && target && !this.ctxEl.contains(target)) this.closeContextMenu();
    });
  }

  private handlePinDragMove(clientX: number) {
    if (!this.dragActive && Math.abs(clientX - this.dragStartX) >= DRAG_THRESHOLD_PX) {
      this.dragActive = true;
      this.closePreview();
      this.closeContextMenu();
      if (this.labelEl) { this.labelEl.remove(); this.labelEl = null; }
      this.slotEls[this.dragPinIdx]?.classList.add("dragging");
      this.updateHiddenAttr();
    }
  }

  private finishPinDrag(dropClientX: number | null, fromSlotIdx: number) {
    this.dragPinIdx = -1;
    this.dragActive = false;
    this.slotEls.forEach((el) => el.classList.remove("dragging"));
    this.updateHiddenAttr();
    if (dropClientX == null) return;
    this.cancelClickUntil = performance.now() + 220;

    const fromSlot = this.slots[fromSlotIdx];
    if (!fromSlot || fromSlot.kind !== "entry" || !fromSlot.entry.pin) return;
    const rect = this.track.getBoundingClientRect();
    const x = dropClientX - rect.left + this.currentMag.left;
    const toIdx = iconAt(this.currentMag, this.layout, x, this.metrics.gap);
    const toSlot = this.slots[toIdx];
    if (!toSlot || toSlot.kind !== "entry" || !toSlot.entry.pin || fromSlotIdx === toIdx) return;

    const pins = [...this.snap.pinned];
    const a = pins.findIndex((p) => p.id === fromSlot.entry.pin!.id);
    const b = pins.findIndex((p) => p.id === toSlot.entry.pin!.id);
    if (a < 0 || b < 0 || a === b) return;
    const [moved] = pins.splice(a, 1);
    pins.splice(b, 0, moved);
    this.ops.onPinReorder(pins);
  }

  private startMagAnim() {
    if (this.reducedMotion() || this.maxScale() <= 1) {
      this.magAmount = this.magTarget;
      this.stopMagAnim();
      this.paintGeometry();
      return;
    }
    if (this.magRaf) return;
    this.magLastTs = performance.now();
    const step = (ts: number) => {
      this.magRaf = 0;
      const dt = Math.min(0.05, Math.max(0.004, (ts - this.magLastTs) / 1000));
      this.magLastTs = ts;
      const speed = 1000 / 150;
      const diff = this.magTarget - this.magAmount;
      if (Math.abs(diff) < 0.01) {
        this.magAmount = this.magTarget;
        this.paintGeometry();
        return;
      }
      this.magAmount += diff * Math.min(1, dt * speed);
      this.paintGeometry();
      this.magRaf = window.requestAnimationFrame(step);
    };
    this.magRaf = window.requestAnimationFrame(step);
  }

  private stopMagAnim() {
    if (this.magRaf) {
      window.cancelAnimationFrame(this.magRaf);
      this.magRaf = 0;
    }
  }

  private onHoveredSlotChange(idx: number) {
    this.clearPreviewTimers();
    const slot = this.slots[idx];
    if (!slot || slot.kind !== "entry" || !slot.entry.windows.length) {
      this.scheduleClosePreview();
      return;
    }
    const delay = this.previewEl ? PREVIEW_SWITCH_MS : PREVIEW_DWELL_MS;
    const targetEntry = slot.entry;
    this.previewTimer = window.setTimeout(() => {
      this.showPreviewFor(targetEntry, idx);
    }, delay);
  }

  private orderedWindows(wins: DockWin[]): DockWin[] {
    const pos = (hwnd: number) => {
      const i = this.discoveryOrder.indexOf(hwnd);
      return i >= 0 ? i : Number.MAX_SAFE_INTEGER;
    };
    return [...wins].sort((a, b) => pos(a.hwnd) - pos(b.hwnd));
  }

  private showPreviewFor(entry: DockEntry, idx: number) {
    if (this.ctxEl || !entry.windows.length) return;
    this.previewAppKey = entry.key;
    if (this.labelEl) { this.labelEl.remove(); this.labelEl = null; }
    if (!this.previewEl) {
      this.previewEl = h("div", { class: "dock-preview-box" });
      this.previewEl.addEventListener("pointerenter", () => this.clearPreviewTimers());
      this.previewEl.addEventListener("pointerleave", () => this.scheduleClosePreview());
      this.shell.append(this.previewEl);
    }
    this.renderPreviewCards(entry);

    const r = this.currentMag.rects[idx];
    if (r) {
      const cx = this.track.offsetLeft + r.x - this.currentMag.left + r.width / 2;
      const boxW = Math.min(window.innerWidth * 0.94, Math.max(216, entry.windows.length * 206));
      const clamped = Math.max(boxW / 2 + 12, Math.min(window.innerWidth - boxW / 2 - 12, cx));
      this.previewEl.style.left = `${Math.round(clamped)}px`;
    }
    this.updateHiddenAttr();
    window.requestAnimationFrame(() => {
      this.reportThumbRects();
      this.reportShapeNow();
    });
  }

  private refreshOpenPreview() {
    if (!this.previewEl || !this.previewAppKey) return;
    const match = this.slots.find((s): s is { kind: "entry"; entry: DockEntry } =>
      s.kind === "entry" && s.entry.key === this.previewAppKey);
    if (!match || !match.entry.windows.length) {
      this.closePreview();
      return;
    }
    this.renderPreviewCards(match.entry);
    window.requestAnimationFrame(() => this.reportThumbRects());
  }

  private renderPreviewCards(entry: DockEntry) {
    if (!this.previewEl) return;
    clear(this.previewEl);
    const list = this.orderedWindows(entry.windows);
    for (const w of list) {
      const card = h("div", { class: `dock-thumb-card${w.active && !w.minimized ? " active" : ""}` });
      const close = h("button", {
        type: "button",
        class: "dock-thumb-close",
        title: t("Chiudi finestra"),
        text: "✕",
      });
      close.addEventListener("click", (e) => {
        e.stopPropagation();
        this.ops.onAction("close", { hwnd: w.hwnd });
      });
      const iconSrc = this.icons.get(entry.appId) || w.icon || entry.icon;
      const headIcon = iconSrc && !iconSrc.startsWith("i:")
        ? h("img", { class: "dock-thumb-icon", src: iconSrc, alt: "" })
        : h("span", { class: "dock-thumb-icon" }, fallbackInitial(entry.name));

      const head = h("div", { class: "dock-thumb-head" },
        headIcon,
        h("span", { class: "dock-thumb-title", text: w.title || entry.name }),
        close,
      );

      const shot = h("div", { class: `dock-thumb-shot${w.minimized ? " minimized" : ""}` });
      shot.dataset.hwnd = String(w.hwnd);
      if (w.minimized) {
        if (iconSrc && !iconSrc.startsWith("i:")) shot.append(h("img", { class: "dock-thumb-minicon", src: iconSrc, alt: "" }));
        shot.append(h("span", { class: "dock-thumb-minbadge", text: t("Ridotta a icona") }));
      }
      card.append(head, shot);
      card.addEventListener("click", () => {
        this.ops.onAction(w.minimized ? "restore" : "focus", { hwnd: w.hwnd });
        this.closePreview();
      });
      this.previewEl.append(card);
    }
  }

  private reportThumbRects() {
    if (!this.previewEl) {
      this.ops.onThumbsChange([]);
      return;
    }
    const rects: { hwnd: number; x: number; y: number; w: number; h: number }[] = [];
    for (const el of this.previewEl.querySelectorAll<HTMLElement>(".dock-thumb-shot:not(.minimized)")) {
      const hwnd = Number(el.dataset.hwnd);
      if (!hwnd) continue;
      const r = el.getBoundingClientRect();
      if (r.width > 10 && r.height > 10) {
        rects.push({ hwnd, x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) });
      }
    }
    this.ops.onThumbsChange(rects);
  }

  private clearPreviewTimers() {
    if (this.previewTimer) { window.clearTimeout(this.previewTimer); this.previewTimer = null; }
    if (this.previewCloseTimer) { window.clearTimeout(this.previewCloseTimer); this.previewCloseTimer = null; }
  }

  private scheduleClosePreview() {
    this.clearPreviewTimers();
    this.previewCloseTimer = window.setTimeout(() => this.closePreview(), PREVIEW_LEAVE_MS);
  }

  private closePreview() {
    this.clearPreviewTimers();
    this.previewAppKey = "";
    if (this.previewEl) {
      this.previewEl.remove();
      this.previewEl = null;
      this.ops.onThumbsChange([]);
      this.updateHiddenAttr();
    }
  }

  private clearSpringTimer() {
    if (this.springTimer) {
      window.clearTimeout(this.springTimer);
      this.springTimer = null;
    }
    this.springKey = "";
  }

  private scheduleReveal() {
    if (this.snap.look.autoHide === "off") return;
    if (this.revealTimer) window.clearTimeout(this.revealTimer);
    this.revealTimer = window.setTimeout(() => {
      this.revealed = true;
      this.updateHiddenAttr();
    }, AUTOHIDE_ENTER_MS);
  }

  private scheduleAutoHide() {
    const mode = this.snap.look.autoHide ?? "off";
    if (mode === "off") return;
    if (this.hideTimer) window.clearTimeout(this.hideTimer);
    this.hideTimer = window.setTimeout(() => {
      this.revealed = false;
      this.updateHiddenAttr();
    }, AUTOHIDE_LEAVE_MS);
  }

  private activateEntry(entry: DockEntry, newInstance: boolean, idx: number) {
    if (entry.kind === "island") {
      this.ops.onOpenIsland();
      return;
    }
    if (newInstance || entry.windows.length === 0) {
      this.launchEntry(entry);
      return;
    }
    if (entry.windows.length === 1) {
      const w = entry.windows[0];
      // Trap avoidance: a minimized window still marked foreground must restore, never minimize.
      if (w.minimized) this.ops.onAction("restore", { hwnd: w.hwnd });
      else if (w.active) this.ops.onAction("minimize", { hwnd: w.hwnd });
      else this.ops.onAction("focus", { hwnd: w.hwnd });
      this.closePreview();
      return;
    }
    if (this.snap.look.multiClick === "cycle") {
      const mostRecent = [...entry.windows].sort((a, b) => b.lastUsed - a.lastUsed)[0];
      if (mostRecent) this.ops.onAction(mostRecent.minimized ? "restore" : "focus", { hwnd: mostRecent.hwnd });
      return;
    }
    this.showPreviewFor(entry, idx);
  }

  private launchEntry(entry: DockEntry) {
    this.ops.onAction("launch", { app: entry.pin?.aumid || entry.pin?.path || entry.appId });
  }

  private openEntryContextMenu(entry: DockEntry, idx: number) {
    this.closePreview();
    const r = this.currentMag.rects[idx];
    const cx = r ? this.track.offsetLeft + r.x - this.currentMag.left + r.width / 2 : 120;
    const rows: HTMLElement[] = [h("div", { class: "dock-ctx-head", text: entry.name })];
    const item = (label: string, run: () => void, danger = false) => {
      const b = h("button", { type: "button", class: `dock-ctx-item${danger ? " danger" : ""}`, text: label });
      b.addEventListener("click", () => {
        this.closeContextMenu();
        run();
      });
      rows.push(b);
    };
    if (entry.kind === "island") {
      item(t("Apri EasyIsland"), () => this.ops.onOpenIsland());
      item(t("Personalizza Dock…"), () => this.ops.onOpenSettings());
    } else {
      item(entry.windows.length ? t("Nuova finestra") : t("Apri"), () => this.launchEntry(entry));
      if (entry.windows.length) {
        rows.push(h("div", { class: "dock-ctx-sep" }));
        for (const w of this.orderedWindows(entry.windows).slice(0, 6)) {
          item(`${w.active && !w.minimized ? "✓ " : ""}${w.title || entry.name}`, () => {
            this.ops.onAction(w.minimized ? "restore" : "focus", { hwnd: w.hwnd });
          });
        }
      }
      rows.push(h("div", { class: "dock-ctx-sep" }));
      item(entry.pinned ? t("Rimuovi dalla Dock") : t("Fissa nella Dock"), () => {
        this.ops.onPinToggle({
          id: entry.pin?.id ?? entry.appId,
          name: entry.name,
          aumid: entry.pin?.aumid,
          path: entry.pin?.path,
        }, !entry.pinned);
      });
      if (entry.windows.length === 1) {
        item(t("Chiudi finestra"), () => this.ops.onAction("close", { hwnd: entry.windows[0].hwnd }), true);
      } else if (entry.windows.length > 1) {
        item(t("Chiudi tutte le finestre ({n})", { n: String(entry.windows.length) }), () => {
          for (const w of entry.windows) this.ops.onAction("close", { hwnd: w.hwnd });
        }, true);
      }
    }
    this.showContextMenu(cx, rows);
  }

  private openDockContextMenu(clientX: number) {
    const r = this.shell.getBoundingClientRect();
    const cx = clientX - r.left;
    const rows: HTMLElement[] = [];
    const add = (label: string, run: () => void) => {
      const b = h("button", { type: "button", class: "dock-ctx-item", text: label });
      b.addEventListener("click", () => {
        this.closeContextMenu();
        run();
      });
      rows.push(b);
    };
    add(t("Personalizza Dock…"), () => this.ops.onOpenSettings());
    if (this.snap.look.autoHide && this.snap.look.autoHide !== "off") {
      add(t("Mantieni Dock visibile"), () => {
        this.revealed = true;
        this.updateHiddenAttr();
      });
    }
    add(t("Gestione attività"), () => void Bridge.barSysDo("panel:taskmgr"));
    this.showContextMenu(cx, rows);
  }

  private showContextMenu(cx: number, rows: HTMLElement[]) {
    this.closeContextMenu();
    this.ctxEl = h("div", { class: "dock-ctx" }, ...rows);
    this.shell.append(this.ctxEl);
    const w = this.ctxEl.offsetWidth || 200;
    const left = Math.max(8, Math.min(window.innerWidth - w - 8, Math.round(cx - w / 2)));
    this.ctxEl.style.left = `${left}px`;
    this.updateHiddenAttr();
    this.scheduleShapeReport();
  }

  private scheduleShapeReport() {
    if (!this.ops.onShapeChange) return;
    window.requestAnimationFrame(() => this.reportShapeNow());
  }

  /** Sends window hit/clip rects (`dock_shape`) only on discrete state transitions, never on pointermove. */
  private reportShapeNow() {
    if (!this.ops.onShapeChange) return;
    const look = this.snap.look;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const auto = look.autoHide === "auto" || (look.autoHide === "smart" && this.covered);
    const margin = look.style === "band" ? 0 : Math.max(0, Math.min(24, look.margin ?? 8));
    const band = auto ? 0 : Math.round(this.layout.height + margin);
    const hidden = this.stage.dataset.dockHidden === "true";

    const rects: [number, number, number, number][] = [];
    const pushBox = (x: number, y: number, w: number, h: number) => {
      const rx = Math.max(0, Math.floor(x));
      const ry = Math.max(0, Math.floor(y));
      const rr = Math.min(W, Math.ceil(x + w));
      const rb = Math.min(H, Math.ceil(y + h));
      if (rr > rx && rb > ry) rects.push([rx, ry, rr - rx, rb - ry]);
    };

    if (hidden) {
      pushBox(0, H - 3, W, 3);
    } else {
      const g = this.glass.getBoundingClientRect();
      const shadowPad = look.shadow === false ? 2 : 16;
      const hot = this.shellHot || !!this.previewEl || !!this.ctxEl || this.dragActive;
      const sidePad = hot ? Math.round(this.metrics.icon * 1.4) + shadowPad : shadowPad;
      const topPad = hot
        ? Math.round(this.metrics.icon * (this.maxScale() - 1)) + (look.labels !== false ? 42 : 12) + shadowPad
        : shadowPad;
      pushBox(g.left - sidePad, g.top - topPad, g.width + sidePad * 2, g.height + topPad + shadowPad);

      for (const extra of [this.previewEl, this.ctxEl]) {
        if (!extra) continue;
        const r = extra.getBoundingClientRect();
        pushBox(r.left - shadowPad, r.top - shadowPad, r.width + shadowPad * 2, r.height + shadowPad * 2);
      }
    }

    const key = JSON.stringify([band, rects]);
    if (key === this.lastShapeKey) return;
    this.lastShapeKey = key;
    this.ops.onShapeChange(band, rects);
  }

  private closeContextMenu() {
    if (!this.ctxEl) return;
    this.ctxEl.remove();
    this.ctxEl = null;
    // Trap avoidance: closing a menu resets magnification and resumes auto-hide.
    this.hoveredIdx = -1;
    this.magTarget = 0;
    this.startMagAnim();
    this.scheduleAutoHide();
    this.updateHiddenAttr();
  }
}
