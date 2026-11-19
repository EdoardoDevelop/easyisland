// Interactive Dock UI controller (docs/piano-dock.md): shared identically by
// the dedicated Dock window (src/dock/main.ts) and browser preview scenes
// (dev/scenes.ts). Zero idle timers or rAF loops when resting.

import { Bridge, type DockWin, type TrayIconInfo } from "../core/bridge";
import { barBgCss, parseBarBg } from "../core/barbg";
import { t } from "../core/i18n";
import type { BarPiece, DockSnapshot } from "../core/link";
import type { DockPin } from "../core/state";
import { renderActionIcon } from "../views/action-icons";
import { clear, h } from "../views/dom";
import { appBadgeCount, formatBadgeCount, isBrowserHostApp } from "./badges";
import { planDockFit } from "./fit";
import {
  GROUP_PALETTE,
  dissolveGroup,
  extractChildFromGroup,
  filterGroupChildren,
  groupStyleOf,
} from "./groups";
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
import { effectiveSurfaceAlpha, isSurfaceOpaque } from "./surface";

/** Dwell delays and hysteresis matching docs/piano-dock.md. */
const PREVIEW_DWELL_MS = 420;
const PREVIEW_SWITCH_MS = 60;
const PREVIEW_LEAVE_MS = 180;
const SPRING_LOAD_MS = 600;
const AUTOHIDE_ENTER_MS = 250;
const AUTOHIDE_LEAVE_MS = 650;
const DRAG_THRESHOLD_PX = 8;
const ATTENTION_BOUNCE_WINDOW_MS = 5500;
const CHEVRON_UP_SVG =
  '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10l4-4 4 4"/></svg>';

export interface DockHostOps {
  onAction: (what: string, opts?: { hwnd?: number; app?: string; files?: string[] }) => void;
  onWidgetClick: (pieceKey: string, button: "left" | "middle" | "right", x: number) => void;
  onTrayClick?: (id: string, button: "left" | "right" | "middle" | "double", x: number, y: number) => void;
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
  kind: "pin" | "group" | "open" | "recent" | "minimized" | "island" | "overflow";
  appId: string;
  name: string;
  icon: string;
  pinned: boolean;
  pin?: DockPin;
  windows: DockWin[];
  active: boolean;
  minimized: boolean;
  attention: boolean;
  badge: number;
}

type RenderSlot =
  | { kind: "entry"; entry: DockEntry }
  | { kind: "separator"; id: string };

/** Key matching a window to a pinned app (separates PWAs on shared browser hosts). */
function appKeyOfWin(w: DockWin): string {
  const base = w.app.trim().toLowerCase();
  if (isBrowserHostApp(base) && w.aumid) return w.aumid.trim().toLowerCase();
  return base;
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
  private trayIcons: TrayIconInfo[] = [];
  private covered = false;
  private fullscreen = false;
  private nativeMaterial = false;
  /** Stable window discovery order for multi-window preview cards (PreviewOrder). */
  private readonly discoveryOrder: number[] = [];

  private slots: RenderSlot[] = [];
  private overflowEntries: DockEntry[] = [];
  private slotEls: HTMLElement[] = [];
  private lastTrackSig = "";
  private lastWidgetsSig = "";
  private layout: DockLayout = buildDockLayout([]);
  private metrics: Metrics = { ...DEFAULT_METRICS };
  private currentMag: MagnifiedLayout = magnifyLayout(this.layout, 0, 0, { range: 132, maxScale: 1 });

  /** Bounded attention bounce tracking (5 cycles or until focused). */
  private readonly attentionState = new Map<string, { stopped: boolean; timer: number | null }>();

  /** Open flyouts inside the Dock WebView (all included in dock_shape). */
  private trayFlyoutEl: HTMLElement | null = null;
  private groupFlyoutEl: HTMLElement | null = null;
  private groupFlyoutId = "";
  private groupViewMode: "grid" | "list" = "grid";

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
    this.trayIcons = initialSnap.trayIcons ?? [];
    this.fullscreen = !!initialSnap.fullscreen;
    this.nativeMaterial = !!initialSnap.nativeMaterial;

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
    this.rebuild(true);
  }

  setSnapshot(snap: DockSnapshot) {
    this.snap = snap;
    if (snap.trayIcons) this.trayIcons = snap.trayIcons;
    if (typeof snap.fullscreen === "boolean") this.fullscreen = snap.fullscreen;
    if (typeof snap.nativeMaterial === "boolean") this.nativeMaterial = snap.nativeMaterial;
    this.applyThemeTokens();
    this.rebuild(false);
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
    this.rebuild(false);
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
    if (changed) this.rebuild(true);
  }

  setTrayIcons(icons: TrayIconInfo[]) {
    this.trayIcons = icons;
    this.renderWidgets(true);
    if (this.trayFlyoutEl) this.renderTrayFlyoutContents();
    this.paintGeometry();
    this.scheduleShapeReport();
  }

  setCovered(covered: boolean) {
    this.covered = covered;
    this.updateHiddenAttr();
  }

  setFullscreen(fullscreen: boolean) {
    if (this.fullscreen === fullscreen) return;
    this.fullscreen = fullscreen;
    if (fullscreen) {
      this.closePreview();
      this.closeContextMenu();
      this.closeTrayFlyout();
      this.closeGroupFlyout();
    }
    this.updateHiddenAttr();
  }

  setNativeMaterial(on: boolean) {
    if (this.nativeMaterial === on) return;
    this.nativeMaterial = on;
    this.stage.dataset.nativeMaterial = String(on);
  }

  setReducedTransparency(on: boolean) {
    this.snap = { ...this.snap, reduceTransparency: on };
    this.applyThemeTokens();
  }

  setRecents(recents: DockPin[]) {
    this.recentApps = recents.slice(0, 3);
    this.rebuild(true);
  }

  destroy() {
    this.stopMagAnim();
    this.clearPreviewTimers();
    this.clearSpringTimer();
    for (const st of this.attentionState.values()) {
      if (st.timer) window.clearTimeout(st.timer);
    }
    this.attentionState.clear();
    if (this.revealTimer) window.clearTimeout(this.revealTimer);
    if (this.hideTimer) window.clearTimeout(this.hideTimer);
    this.closeContextMenu();
    this.closePreview();
    this.closeTrayFlyout();
    this.closeGroupFlyout();
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
    const opaque = isSurfaceOpaque(this.snap.reduceTransparency);
    const alphaPct = Math.round(effectiveSurfaceAlpha(look, opaque) * 100);
    const ds = this.stage.dataset;
    ds.ui = this.snap.style;
    ds.scheme = this.snap.scheme;
    ds.dockStyle = look.style ?? "capsule";
    ds.dockBlur = String(!!look.blur);
    ds.dockShadow = String(look.shadow !== false);
    ds.opaque = String(opaque);
    ds.nativeMaterial = String(this.nativeMaterial);

    this.stage.style.setProperty("--dock-opacity", String(alphaPct));
    this.stage.style.setProperty("--dock-margin", `${Math.max(0, Math.min(24, look.margin ?? 8))}px`);
    const bgRaw = (this.snap.background ?? "").trim();
    if (!opaque && bgRaw) {
      if (bgRaw === "transparent" || /^(gradient|glow|aurora|glass):/i.test(bgRaw) || /^#[0-9a-f]{6}$/i.test(bgRaw)) {
        this.stage.style.setProperty("--dock-bg-custom", barBgCss(parseBarBg(bgRaw), { opacity: alphaPct }));
      } else {
        this.stage.style.setProperty("--dock-bg-custom", `color-mix(in srgb, ${bgRaw} ${alphaPct}%, transparent)`);
      }
      if (this.snap.ink) {
        this.stage.style.setProperty("--dock-ink", this.snap.ink);
        this.stage.style.setProperty("--dock-dim", `color-mix(in srgb, ${this.snap.ink} 68%, transparent)`);
        this.stage.style.setProperty("--dock-dot", `color-mix(in srgb, ${this.snap.ink} 70%, transparent)`);
      }
    } else {
      this.stage.style.removeProperty("--dock-bg-custom");
      this.stage.style.removeProperty("--dock-ink");
      this.stage.style.removeProperty("--dock-dim");
      this.stage.style.removeProperty("--dock-dot");
    }
    if (this.snap.accent) this.stage.style.setProperty("--dock-accent", this.snap.accent);
    if (this.snap.font?.stack) this.stage.style.setProperty("--font", this.snap.font.stack);
    this.updateHiddenAttr();
  }

  private isDockEmpty(): boolean {
    return this.slots.length === 0 && !(this.snap.items && this.snap.items.length > 0);
  }

  private updateHiddenAttr() {
    const mode = this.snap.look.autoHide ?? "off";
    const empty = this.isDockEmpty();
    const blocked = !!this.previewEl || !!this.ctxEl || !!this.groupFlyoutEl || !!this.trayFlyoutEl || this.dragActive || this.dropHighlightIdx >= 0;
    const shouldHide = this.fullscreen || empty || (!blocked && !this.revealed && (mode === "auto" || (mode === "smart" && this.covered)));
    this.stage.dataset.dockFullscreen = String(this.fullscreen);
    this.stage.dataset.dockEmpty = String(empty);
    this.stage.dataset.dockHidden = String(shouldHide);
    this.scheduleShapeReport();
  }

  /** Builds unified list: optional EasyIsland anchor + pinned/groups + open unpinned + recents + minimized. */
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
          badge: 0,
        },
      });
    }

    for (const pin of this.snap.pinned) {
      if (pin.children?.length) {
        const groupWins: DockWin[] = [];
        for (const child of pin.children) {
          const ck = appKeyOfPin(child);
          consumedApps.add(ck);
          groupWins.push(...(byApp.get(ck) ?? []));
        }
        out.push({
          kind: "entry",
          entry: {
            key: `group:${pin.id}`,
            kind: "group",
            appId: pin.id,
            name: pin.name,
            icon: "",
            pinned: true,
            pin,
            windows: groupWins,
            active: groupWins.some((w) => w.active),
            minimized: groupWins.length > 0 && groupWins.every((w) => w.minimized),
            attention: groupWins.some((w) => w.attention),
            badge: appBadgeCount(groupWins),
          },
        });
        continue;
      }

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
          badge: appBadgeCount(wins),
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
          badge: appBadgeCount(wins),
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
          badge: appBadgeCount([w]),
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
              badge: 0,
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
              badge: appBadgeCount([w]),
            },
          });
        }
      }
    }

    return out;
  }

  private syncAttentionState(entries: DockEntry[]) {
    const liveKeys = new Set<string>();
    for (const e of entries) {
      if (!e.attention || e.active) continue;
      liveKeys.add(e.key);
      if (!this.attentionState.has(e.key)) {
        const timer = window.setTimeout(() => {
          const st = this.attentionState.get(e.key);
          if (st) {
            st.stopped = true;
            st.timer = null;
          }
          const slotIdx = this.slots.findIndex((s) => s.kind === "entry" && s.entry.key === e.key);
          if (slotIdx >= 0) this.slotEls[slotIdx]?.classList.remove("attention-bounce");
        }, ATTENTION_BOUNCE_WINDOW_MS);
        this.attentionState.set(e.key, { stopped: false, timer });
      }
    }
    for (const [key, st] of this.attentionState) {
      if (!liveKeys.has(key)) {
        if (st.timer) window.clearTimeout(st.timer);
        this.attentionState.delete(key);
      }
    }
  }

  private renderGroupTileContent(pin: DockPin): HTMLElement {
    const style = groupStyleOf(pin);
    if (style.color || style.glyph) {
      const box = h("div", { class: "dock-group-tinted" });
      box.style.background = style.color || "var(--dock-accent)";
      box.style.color = style.ink || "#fff";
      box.append(renderActionIcon(`i:${style.glyph || "folder"}`, 20));
      return box;
    }
    const mosaic = h("div", { class: "dock-group-mosaic" });
    for (const child of (pin.children ?? []).slice(0, 4)) {
      const k = appKeyOfPin(child);
      const src = this.icons.get(k) ?? "";
      if (src && !src.startsWith("i:")) mosaic.append(h("img", { src, alt: "", draggable: "false" }));
      else mosaic.append(h("span", { text: fallbackInitial(child.name) }));
    }
    return mosaic;
  }

  private rebuild(force = false) {
    this.renderWidgets(force);

    const look = this.snap.look;
    const requestedIcon = Math.max(28, Math.min(64, look.iconSize ?? 44));
    const gap = Math.max(4, Math.min(20, look.gap ?? 10));
    const margin = look.style === "band" ? 0 : Math.max(0, Math.min(24, look.margin ?? 8));

    const rawSlots = this.buildEntries();
    const rawEntries = rawSlots.filter((s): s is { kind: "entry"; entry: DockEntry } => s.kind === "entry").map((s) => s.entry);
    const sepCount = rawSlots.length - rawEntries.length;

    const widgetsVisible = this.widgetsEl.style.display !== "none";
    this.widgetsEl.classList.remove("dock-widgets-compact");
    const widgetsFullW = widgetsVisible ? Math.max(40, this.widgetsEl.scrollWidth) : 0;
    const widgetsCompactW = widgetsVisible ? Math.min(widgetsFullW, Math.max(36, (this.snap.items?.length ?? 0) * 34 + 16)) : 0;

    const availW = Math.max(240, window.innerWidth - margin * 2 - 20);
    const fixedHead = (look.characterInDock ? 1 : 0) + this.snap.pinned.length;
    const fit = planDockFit({
      availableWidth: availW,
      baseIconSize: requestedIcon,
      gap,
      paddingX: 10,
      entryCount: rawEntries.length,
      separatorCount: sepCount,
      fixedHeadCount: Math.min(fixedHead, Math.max(0, rawEntries.length - 1)),
      widgetsFullWidth: widgetsFullW,
      widgetsCompactWidth: widgetsCompactW,
    });
    this.widgetsEl.classList.toggle("dock-widgets-compact", fit.compactWidgets);

    this.overflowEntries = [];
    let finalSlots = rawSlots;
    if (fit.overflowCount > 0) {
      let remaining = fit.overflowCount;
      const keptRev: RenderSlot[] = [];
      for (let i = rawSlots.length - 1; i >= 0; i--) {
        const s = rawSlots[i];
        if (s.kind === "entry" && remaining > 0) {
          this.overflowEntries.unshift(s.entry);
          remaining--;
        } else {
          keptRev.push(s);
        }
      }
      finalSlots = keptRev.reverse();
      while (finalSlots.length && finalSlots[finalSlots.length - 1].kind === "separator") {
        finalSlots.pop();
      }
      if (this.overflowEntries.length > 0) {
        finalSlots.push({ kind: "separator", id: "sep-overflow" });
        finalSlots.push({
          kind: "entry",
          entry: {
            key: "overflow",
            kind: "overflow",
            appId: "overflow",
            name: t("Altre app ({n})", { n: String(this.overflowEntries.length) }),
            icon: "",
            pinned: false,
            windows: [],
            active: this.overflowEntries.some((e) => e.active),
            minimized: false,
            attention: this.overflowEntries.some((e) => e.attention),
            badge: 0,
          },
        });
      }
    }

    this.metrics = { ...DEFAULT_METRICS, icon: fit.iconSize, gap };
    this.slots = finalSlots;
    this.stage.dataset.dockEmpty = String(this.isDockEmpty());

    const finalEntries = this.slots
      .filter((s): s is { kind: "entry"; entry: DockEntry } => s.kind === "entry")
      .map((s) => s.entry);
    this.syncAttentionState(finalEntries);

    const trackSig = JSON.stringify([
      this.metrics.icon,
      this.metrics.gap,
      look.indicators !== false,
      this.dropHighlightIdx,
      this.slots.map((s) =>
        s.kind === "separator"
          ? ["-", s.id]
          : [
              s.entry.key,
              s.entry.name,
              s.entry.icon ? 1 : 0,
              s.entry.pin?.color ?? "",
              s.entry.pin?.glyph ?? "",
              s.entry.pin?.children?.length ?? 0,
              s.entry.windows.length,
              s.entry.active ? 1 : 0,
              s.entry.minimized ? 1 : 0,
              s.entry.attention ? 1 : 0,
              s.entry.badge,
            ]),
    ]);

    if (!force && trackSig === this.lastTrackSig) {
      this.paintGeometry();
      return;
    }
    this.lastTrackSig = trackSig;

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
      const st = this.attentionState.get(entry.key);
      btn.classList.toggle("attention-bounce", entry.attention && !entry.active && !st?.stopped && !this.reducedMotion());
      btn.classList.toggle("drop-hover", idx === this.dropHighlightIdx);

      const tile = h("div", { class: "dock-tile" });
      if (entry.kind === "overflow") {
        tile.append(h("span", { class: "dock-overflow-chip", text: "•••" }));
      } else if (entry.kind === "group" && entry.pin) {
        tile.append(this.renderGroupTileContent(entry.pin));
      } else if (entry.icon.startsWith("i:")) {
        tile.append(h("div", { class: "dock-icon-svg" }, renderActionIcon(entry.icon, Math.round(this.metrics.icon * 0.62))));
      } else if (entry.icon) {
        tile.append(h("img", { class: "dock-icon-img", src: entry.icon, alt: "", draggable: "false" }));
      } else {
        tile.append(h("div", { class: "dock-fallback-glyph", text: fallbackInitial(entry.name) }));
      }

      if (entry.badge > 0 && entry.kind !== "group") {
        tile.append(h("span", { class: "dock-unread-badge", text: formatBadgeCount(entry.badge) }));
      } else if (entry.windows.length >= 2) {
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

    if (this.groupFlyoutEl && this.groupFlyoutId) {
      const grp = this.snap.pinned.find((p) => p.id === this.groupFlyoutId);
      if (!grp?.children?.length) this.closeGroupFlyout();
    }

    this.paintGeometry();
    this.scheduleShapeReport();
  }

  private renderWidgets(force = false) {
    const pieces: BarPiece[] = this.snap.items ?? [];
    const widgetsSig = JSON.stringify([
      pieces.map((p) => [p.key, p.title, p.html]),
      this.trayIcons.map((ti) => [ti.id, ti.tip, ti.promoted, ti.icon.length]),
      !!this.trayFlyoutEl,
    ]);
    if (!force && widgetsSig === this.lastWidgetsSig) return;
    this.lastWidgetsSig = widgetsSig;

    clear(this.widgetsEl);
    if (!pieces.length) {
      this.widgetsEl.style.display = "none";
      this.closeTrayFlyout();
      return;
    }
    this.widgetsEl.style.display = "inline-flex";
    this.widgetsEl.append(h("div", { class: "dock-widget-sep", "aria-hidden": "true" }));

    for (const p of pieces) {
      if (p.key === "sys:systray" || p.key.startsWith("sys:systray#")) {
        this.widgetsEl.append(this.buildSystrayWidget(p));
        continue;
      }
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

  private buildSystrayWidget(p: BarPiece): HTMLElement {
    const strip = h("div", { class: "dock-systray-strip" });
    const promoted = this.trayIcons.filter((x) => x.promoted).slice(0, 8);
    const hidden = this.trayIcons.filter((x) => !x.promoted);

    for (const ti of promoted) {
      const btn = this.makeTrayIconButton(ti);
      strip.append(btn);
    }

    const arrow = h("button", {
      type: "button",
      class: "dock-tray-arrow",
      title: hidden.length ? t("Icone nascoste ({n})", { n: String(hidden.length) }) : p.title,
      "aria-expanded": String(!!this.trayFlyoutEl),
    });
    arrow.innerHTML = CHEVRON_UP_SVG;
    arrow.addEventListener("click", (e) => {
      e.stopPropagation();
      const r = arrow.getBoundingClientRect();
      if (hidden.length && !e.shiftKey) {
        this.toggleTrayFlyout(arrow);
      } else {
        this.ops.onWidgetClick(p.key, "left", Math.round(r.left + r.width / 2));
      }
    });
    arrow.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.ops.onWidgetClick(p.key, "right", Math.round(e.clientX));
    });
    strip.append(arrow);
    return strip;
  }

  private makeTrayIconButton(ti: TrayIconInfo): HTMLButtonElement {
    const btn = h("button", {
      type: "button",
      class: "dock-tray-icon",
      title: ti.tip || ti.id,
      "aria-label": ti.tip || ti.id,
    });
    btn.append(h("img", { src: ti.icon, width: "16", height: "16", alt: "", draggable: "false" }));
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const r = btn.getBoundingClientRect();
      this.ops.onTrayClick?.(ti.id, "left", Math.round(e.screenX || r.left), Math.round(e.screenY || r.top));
    });
    btn.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      const r = btn.getBoundingClientRect();
      this.ops.onTrayClick?.(ti.id, "double", Math.round(e.screenX || r.left), Math.round(e.screenY || r.top));
    });
    btn.addEventListener("auxclick", (e) => {
      if (e.button !== 1) return;
      e.stopPropagation();
      const r = btn.getBoundingClientRect();
      this.ops.onTrayClick?.(ti.id, "middle", Math.round(e.screenX || r.left), Math.round(e.screenY || r.top));
    });
    btn.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const r = btn.getBoundingClientRect();
      this.ops.onTrayClick?.(ti.id, "right", Math.round(e.screenX || r.left), Math.round(e.screenY || r.top));
    });
    return btn;
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
      if (
        related &&
        (this.previewEl?.contains(related) ||
          this.ctxEl?.contains(related) ||
          this.groupFlyoutEl?.contains(related) ||
          this.trayFlyoutEl?.contains(related))
      ) {
        return;
      }
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

      if (e.button === 0 && !e.shiftKey && !e.ctrlKey && (entry.kind === "pin" || entry.kind === "group")) {
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
      let idx = -1;
      if (e.clientX === 0 && e.clientY === 0) {
        const btn = (e.target as HTMLElement | null)?.closest?.(".dock-slot") as HTMLElement | null;
        if (btn?.dataset.idx != null) idx = Number(btn.dataset.idx);
      } else {
        const rect = this.track.getBoundingClientRect();
        const x = e.clientX - rect.left + this.currentMag.left;
        idx = iconAt(this.currentMag, this.layout, x, this.metrics.gap);
      }
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
        this.rebuild(true);
      }
      this.closeContextMenu();
      this.closePreview();
      this.closeTrayFlyout();
      this.closeGroupFlyout();
      this.magTarget = 0;
      this.hoveredIdx = -1;
      this.startMagAnim();
    });
    window.addEventListener("blur", () => {
      if (this.dragPinIdx >= 0) {
        this.dragPinIdx = -1;
        this.dragActive = false;
        this.rebuild(true);
      }
      this.closeContextMenu();
      this.closePreview();
      this.closeTrayFlyout();
      this.closeGroupFlyout();
      this.hoveredIdx = -1;
      this.magTarget = 0;
      this.startMagAnim();
    });
    window.addEventListener("resize", () => this.rebuild(false));
    document.addEventListener("pointerdown", (e) => {
      const target = e.target as Node | null;
      if (this.ctxEl && target && !this.ctxEl.contains(target)) this.closeContextMenu();
      if (this.trayFlyoutEl && target && !this.trayFlyoutEl.contains(target) && !(target as HTMLElement).closest?.(".dock-tray-arrow")) {
        this.closeTrayFlyout();
      }
      if (this.groupFlyoutEl && target && !this.groupFlyoutEl.contains(target) && !(target as HTMLElement).closest?.(".dock-slot")) {
        this.closeGroupFlyout();
      }
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
    if (entry.kind === "overflow") {
      this.openOverflowMenu(idx);
      return;
    }
    if (entry.kind === "group" && entry.pin) {
      this.toggleGroupFlyout(entry.pin, idx);
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
    if (entry.kind === "group" && entry.pin?.children?.length) {
      const first = entry.pin.children[0];
      this.ops.onAction("launch", { app: first.aumid || first.path || first.id });
      return;
    }
    this.ops.onAction("launch", { app: entry.pin?.aumid || entry.pin?.path || entry.appId });
  }

  private openOverflowMenu(idx: number) {
    if (!this.overflowEntries.length) return;
    const r = this.currentMag.rects[idx];
    const cx = r ? this.track.offsetLeft + r.x - this.currentMag.left + r.width / 2 : 160;
    const rows: HTMLElement[] = [h("div", { class: "dock-ctx-head", text: t("Altre app") })];
    for (const entry of this.overflowEntries) {
      const b = h("button", { type: "button", class: "dock-ctx-item", text: entry.name });
      b.addEventListener("click", () => {
        this.closeContextMenu();
        this.activateEntry(entry, false, idx);
      });
      rows.push(b);
    }
    this.showContextMenu(cx, rows);
  }

  private toggleTrayFlyout(anchor: HTMLElement) {
    if (this.trayFlyoutEl) {
      this.closeTrayFlyout();
      return;
    }
    this.closeContextMenu();
    this.closeGroupFlyout();
    this.trayFlyoutEl = h("div", { class: "dock-tray-flyout" });
    this.shell.append(this.trayFlyoutEl);
    this.renderTrayFlyoutContents();

    const r = anchor.getBoundingClientRect();
    const shellRect = this.shell.getBoundingClientRect();
    const cx = r.left - shellRect.left + r.width / 2;
    const fw = this.trayFlyoutEl.offsetWidth || 136;
    const left = Math.max(8, Math.min(window.innerWidth - fw - 8, Math.round(cx - fw / 2)));
    this.trayFlyoutEl.style.left = `${left}px`;
    this.renderWidgets(true);
    this.updateHiddenAttr();
    this.scheduleShapeReport();
  }

  private renderTrayFlyoutContents() {
    if (!this.trayFlyoutEl) return;
    clear(this.trayFlyoutEl);
    const hidden = this.trayIcons.filter((x) => !x.promoted);
    for (const ti of hidden) {
      this.trayFlyoutEl.append(this.makeTrayIconButton(ti));
    }
  }

  private closeTrayFlyout() {
    if (!this.trayFlyoutEl) return;
    this.trayFlyoutEl.remove();
    this.trayFlyoutEl = null;
    this.renderWidgets(true);
    this.scheduleAutoHide();
    this.updateHiddenAttr();
  }

  private toggleGroupFlyout(pin: DockPin, idx: number) {
    if (this.groupFlyoutEl && this.groupFlyoutId === pin.id) {
      this.closeGroupFlyout();
      return;
    }
    this.closeContextMenu();
    this.closeTrayFlyout();
    this.closePreview();
    this.groupFlyoutId = pin.id;
    this.groupFlyoutEl = h("div", { class: "dock-group-flyout" });
    this.shell.append(this.groupFlyoutEl);
    this.renderGroupFlyout(pin);

    const r = this.currentMag.rects[idx];
    const cx = r ? this.track.offsetLeft + r.x - this.currentMag.left + r.width / 2 : 160;
    const fw = this.groupFlyoutEl.offsetWidth || 240;
    const left = Math.max(8, Math.min(window.innerWidth - fw - 8, Math.round(cx - fw / 2)));
    this.groupFlyoutEl.style.left = `${left}px`;
    this.updateHiddenAttr();
    this.scheduleShapeReport();
  }

  private renderGroupFlyout(pin: DockPin) {
    if (!this.groupFlyoutEl) return;
    clear(this.groupFlyoutEl);
    const children = pin.children ?? [];
    let query = "";

    const list = h("div", { class: "dock-group-list" });
    list.dataset.view = this.groupViewMode;

    const paintChildren = () => {
      clear(list);
      for (const child of filterGroupChildren(children, query)) {
        const ck = appKeyOfPin(child);
        const src = this.icons.get(ck) ?? "";
        const btn = h("button", { type: "button", class: "dock-group-child", title: child.name });
        if (src && !src.startsWith("i:")) btn.append(h("img", { src, alt: "", draggable: "false" }));
        else btn.append(h("span", { text: fallbackInitial(child.name) }));
        btn.append(h("span", { text: child.name }));
        btn.addEventListener("click", () => {
          this.closeGroupFlyout();
          this.ops.onAction("launch", { app: child.aumid || child.path || child.id });
        });
        btn.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          e.stopPropagation();
          this.closeGroupFlyout();
          this.ops.onPinReorder(extractChildFromGroup(this.snap.pinned, pin.id, child.id));
        });
        list.append(btn);
      }
    };

    const head = h("div", { class: "dock-group-head" });
    if (children.length >= 4) {
      const search = h("input", {
        type: "search",
        class: "dock-group-search",
        placeholder: t("Cerca nel gruppo…"),
        "aria-label": t("Cerca nel gruppo…"),
      }) as HTMLInputElement;
      search.addEventListener("input", () => {
        query = search.value;
        paintChildren();
      });
      head.append(search);
    } else {
      head.append(h("span", { class: "dock-ctx-head", text: pin.name }));
    }

    const densityBtn = h("button", {
      type: "button",
      class: "dock-group-density",
      text: this.groupViewMode === "grid" ? t("Elenco") : t("Griglia"),
    });
    densityBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.groupViewMode = this.groupViewMode === "grid" ? "list" : "grid";
      list.dataset.view = this.groupViewMode;
      densityBtn.textContent = this.groupViewMode === "grid" ? t("Elenco") : t("Griglia");
    });
    head.append(densityBtn);

    this.groupFlyoutEl.append(head, list);
    paintChildren();
  }

  private closeGroupFlyout() {
    if (!this.groupFlyoutEl) return;
    this.groupFlyoutEl.remove();
    this.groupFlyoutEl = null;
    this.groupFlyoutId = "";
    this.scheduleAutoHide();
    this.updateHiddenAttr();
  }

  private openEntryContextMenu(entry: DockEntry, idx: number) {
    this.closePreview();
    this.closeGroupFlyout();
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
    } else if (entry.kind === "overflow") {
      this.openOverflowMenu(idx);
      return;
    } else if (entry.kind === "group" && entry.pin) {
      const grp = entry.pin;
      const swatches = h("div", { class: "dock-ctx-swatches" });
      for (const [, shades] of GROUP_PALETTE.slice(0, 7)) {
        const hex = shades[1];
        const sw = h("button", {
          type: "button",
          class: `dock-ctx-swatch${grp.color?.toLowerCase() === hex ? " selected" : ""}`,
          title: hex,
        });
        sw.style.background = hex;
        sw.addEventListener("click", () => {
          this.closeContextMenu();
          const next = this.snap.pinned.map((p) => (p.id === grp.id ? { ...p, color: hex } : p));
          this.ops.onPinReorder(next);
        });
        swatches.append(sw);
      }
      rows.push(swatches);
      if (grp.color || grp.glyph) {
        item(t("Mostra mosaico icone"), () => {
          const next = this.snap.pinned.map((p) => (p.id === grp.id ? { ...p, color: undefined, glyph: undefined } : p));
          this.ops.onPinReorder(next);
        });
      }
      item(t("Separa gruppo"), () => {
        this.ops.onPinReorder(dissolveGroup(this.snap.pinned, grp.id));
      });
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
      if (entry.pinned && entry.pin) {
        const selfPin = entry.pin;
        const other = this.snap.pinned.find((p) => p.id !== selfPin.id && !p.children?.length);
        const existingGrp = this.snap.pinned.find((p) => p.children?.length);
        if (existingGrp) {
          item(t("Aggiungi al gruppo «{name}»", { name: existingGrp.name }), () => {
            const next = this.snap.pinned
              .filter((p) => p.id !== selfPin.id)
              .map((p) => (p.id === existingGrp.id ? { ...p, children: [...(p.children ?? []), selfPin] } : p));
            this.ops.onPinReorder(next);
          });
        } else if (other) {
          item(t("Raggruppa con {name}", { name: other.name }), () => {
            const groupPin: DockPin = {
              id: `grp-${Date.now().toString(36)}`,
              name: t("Gruppo"),
              children: [other, selfPin],
            };
            const next: DockPin[] = [];
            for (const p of this.snap.pinned) {
              if (p.id === selfPin.id) continue;
              if (p.id === other.id) next.push(groupPin);
              else next.push(p);
            }
            this.ops.onPinReorder(next);
          });
        }
      }
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
    if (this.fullscreen || this.isDockEmpty()) {
      const fsKey = "[0,[]]";
      if (this.lastShapeKey !== fsKey) {
        this.lastShapeKey = fsKey;
        this.ops.onShapeChange(0, []);
      }
      return;
    }

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
      const hot =
        this.shellHot ||
        !!this.previewEl ||
        !!this.ctxEl ||
        !!this.groupFlyoutEl ||
        !!this.trayFlyoutEl ||
        this.dragActive;
      const sidePad = hot ? Math.round(this.metrics.icon * 1.4) + shadowPad : shadowPad;
      const topPad = hot
        ? Math.round(this.metrics.icon * (this.maxScale() - 1)) + (look.labels !== false ? 42 : 12) + shadowPad
        : shadowPad;
      pushBox(g.left - sidePad, g.top - topPad, g.width + sidePad * 2, g.height + topPad + shadowPad);

      for (const extra of [this.previewEl, this.ctxEl, this.groupFlyoutEl, this.trayFlyoutEl]) {
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
