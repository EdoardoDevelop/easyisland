// The app's motion, in three levels (Impostazioni → Aspetto → Tema, 10 Nov 2026,
// Edoardo: «animazioni effetto wow per ogni cambio di schermata o apertura o
// chiusura finestra, ogni click scateni una qualche animazione»):
//  1. every click: the control gives way and a light ripples from the pointer;
//  2. a new view grows out of the menu item that asked for it, its cards in cascade;
//  3. opening and closing the island and the windows: «Lancio», «Sipario» or «Particelle».
// `animations` is "ricche" (all of it), "sobrie" (short fades only) or "spente".
// Windows «Riduci animazioni» turns "ricche" into "sobrie". One-shot only: nothing
// here runs a frame once its animation is over (the shut island costs nothing).

import "./motion.css";

export type AnimLevel ="ricche" | "sobrie" | "spente";
export type OpenFx = "lancio" | "sipario" | "particelle";

const EASE_OUT = "cubic-bezier(0.16, 1, 0.3, 1)";
const EASE_IN = "cubic-bezier(0.7, 0, 0.84, 0)";
/** The character's colours, for its particles. */
const ORB = ["#7b5cff", "#4f7dff", "#c25cff", "#59c8ff"];

let level: AnimLevel = "ricche";
let fx: OpenFx = "lancio";
/** Until this time an opening is playing: a view change then does not animate on top of it. */
let openingUntil = 0;

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The levels from the settings, on `<html>` (`data-anim`, `data-openfx`) for the CSS and the popped-out windows. */
export function applyMotion(s: { animations?: string; openEffect?: string } | undefined, doc: Document = document): void {
  const asked = (["ricche", "sobrie", "spente"] as const).find((l) => l === s?.animations) ?? "ricche";
  level = asked === "ricche" && reduced() ? "sobrie" : asked;
  fx = (["lancio", "sipario", "particelle"] as const).find((f) => f === s?.openEffect) ?? "lancio";
  doc.documentElement.dataset.anim = level;
  doc.documentElement.dataset.openfx = fx;
}

export const motionLevel = (): AnimLevel => level;
export const openEffect = (): OpenFx => fx;

// ── Level 1: every click ────────────────────────────────────────────────────

const PRESSABLE = "button, [role=button], .rail-item, a[href], summary, .tab, [data-press]";

/** Presses and ripples in `doc` (the island, a window, a popped-out chat). */
export function watchPresses(doc: Document): void {
  doc.addEventListener("pointerdown", (e) => {
    if (level === "spente" || e.button !== 0) return;
    const el = (e.target as Element | null)?.closest?.<HTMLElement>(PRESSABLE);
    if (!el || (el as HTMLButtonElement).disabled || el.closest("[data-no-press]")) return;
    const r = el.getBoundingClientRect();
    if (r.width < 8 || r.height < 8) return;
    // `scale` adds to the element's own transform instead of replacing it.
    el.animate([{ scale: "1" }, { scale: r.width > 260 ? "0.99" : "0.965", offset: 0.35 }, { scale: "1" }], { duration: 200, easing: EASE_OUT });
    if (level === "ricche") ripple(doc, el, r, e.clientX, e.clientY);
  }, true);
}

function ripple(doc: Document, el: HTMLElement, r: DOMRect, x: number, y: number) {
  // A layer of its own over the control, clipped to its shape: the control's
  // own layout and overflow stay as they are.
  const layer = doc.createElement("div");
  const radius = getComputedStyle(el).borderRadius;
  Object.assign(layer.style, {
    position: "fixed", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`,
    borderRadius: radius, overflow: "hidden", pointerEvents: "none", zIndex: "2147483000",
  });
  const size = Math.max(r.width, r.height) * 2.4;
  const dot = doc.createElement("span");
  Object.assign(dot.style, {
    position: "absolute", left: `${x - r.left - size / 2}px`, top: `${y - r.top - size / 2}px`, width: `${size}px`, height: `${size}px`,
    borderRadius: "50%",
    background: "radial-gradient(circle, color-mix(in srgb, var(--accent, #60cdff) 45%, transparent) 0, color-mix(in srgb, var(--accent, #60cdff) 18%, transparent) 38%, transparent 66%)",
  });
  layer.appendChild(dot);
  doc.body.appendChild(layer);
  dot.animate([{ transform: "scale(0)", opacity: 1 }, { transform: "scale(1)", opacity: 0 }], { duration: 560, easing: EASE_OUT }).onfinish = () => layer.remove();
}

// ── Level 2: a view change ──────────────────────────────────────────────────

const STAGGER = ".card, .tile, .ov-card, [data-stagger]";

/**
 * `view` has just become the one shown; `from` is the menu item that asked for
 * it, `before` where the menu's mark was (it glides to the new item).
 */
export function viewEnter(view: HTMLElement, from: HTMLElement | null, before: DOMRect | null): void {
  if (level === "spente" || performance.now() < openingUntil) return;
  if (from && before) glideMark(from, before);
  if (level === "sobrie") return; // the CSS crossfade of .view is enough
  const vr = view.getBoundingClientRect();
  const fr = from?.getBoundingClientRect();
  view.style.transformOrigin = fr ? `0px ${Math.round(fr.top + fr.height / 2 - vr.top)}px` : "50% 0px";
  view.animate(
    [{ opacity: 0, transform: "translateX(-16px) scale(0.975)", filter: "blur(6px)" }, { opacity: 1, transform: "none", filter: "blur(0px)" }],
    { duration: 340, easing: EASE_OUT },
  );
  let i = 0;
  for (const el of view.querySelectorAll<HTMLElement>(STAGGER)) {
    const r = el.getBoundingClientRect();
    if (r.height === 0 || r.top > vr.bottom) continue;
    el.animate([{ opacity: 0, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }], { duration: 320, delay: 60 + Math.min(i * 32, 190), easing: EASE_OUT, fill: "backwards" });
    if (++i >= 14) break;
  }
}

/** The menu's accent mark (the `::before` of `.rail-item.on`) slides from the old item to the new one. */
function glideMark(item: HTMLElement, before: DOMRect) {
  const mark = getComputedStyle(item, "::before");
  if (mark.content === "none" || mark.display === "none") return;
  const now = item.getBoundingClientRect();
  const h = parseFloat(mark.height) || 16;
  const ghost = document.createElement("div");
  Object.assign(ghost.style, {
    position: "fixed", left: `${now.left + (parseFloat(mark.left) || 0)}px`, top: `${now.top + now.height / 2 - h / 2}px`,
    width: mark.width, height: `${h}px`, borderRadius: mark.borderRadius, background: mark.backgroundColor,
    pointerEvents: "none", zIndex: "2147483000",
  });
  document.body.appendChild(ghost);
  item.classList.add("mark-gliding");
  const dy = before.top + before.height / 2 - (now.top + now.height / 2);
  const frames = level === "ricche"
    ? [{ transform: `translateY(${dy}px) scaleY(1)` }, { transform: `translateY(${dy / 2}px) scaleY(2.2)`, offset: 0.45 }, { transform: "none" }]
    : [{ transform: `translateY(${dy}px)` }, { transform: "none" }];
  ghost.animate(frames, { duration: 300, easing: EASE_OUT }).onfinish = () => { ghost.remove(); item.classList.remove("mark-gliding"); };
}

// ── Level 3: opening and closing ────────────────────────────────────────────

type Pt = { x: number; y: number };

/** `scope`'s parts come into focus one after the other. */
function partsIn(parts: Iterable<HTMLElement>, delay: number) {
  let i = 0;
  for (const el of parts) {
    el.animate([{ opacity: 0, filter: "blur(6px)", transform: "translateY(6px)" }, { opacity: 1, filter: "blur(0px)", transform: "none" }], { duration: 380, delay: delay + Math.min(i * 28, 160), easing: EASE_OUT, fill: "backwards" });
    i++;
  }
}

/**
 * A layer for the drawn pieces (ring, seam, particles) over `follow` (the
 * island, which grows and moves while they play) for `ms`, outside it so its
 * fade and clip do not touch them; over the whole page when `follow` is null.
 */
function overlay(follow: HTMLElement | null, ms: number): HTMLElement {
  const layer = document.createElement("div");
  layer.className = "fx-layer";
  const host = follow?.parentElement ?? document.body;
  Object.assign(layer.style, { position: follow ? "absolute" : "fixed", left: "0px", top: "0px", width: "0px", height: "0px", overflow: "visible", pointerEvents: "none", zIndex: "2147483000" });
  host.appendChild(layer);
  const end = performance.now() + ms;
  const place = () => {
    // Over the island, inside its edges: the light stays on the island, not on the desktop.
    if (follow) {
      layer.style.left = `${follow.offsetLeft}px`;
      layer.style.top = `${follow.offsetTop}px`;
      layer.style.width = `${follow.offsetWidth}px`;
      layer.style.height = `${follow.offsetHeight}px`;
      layer.style.overflow = "hidden";
      layer.style.borderRadius = getComputedStyle(follow).borderRadius;
    }
    if (performance.now() < end) requestAnimationFrame(place);
    else layer.remove();
  };
  place();
  return layer;
}

function ring(layer: HTMLElement, at: Pt, reach: number) {
  const el = document.createElement("div");
  el.className = "fx-ring";
  Object.assign(el.style, { position: "absolute", left: `${at.x}px`, top: `${at.y}px` });
  layer.appendChild(el);
  el.animate([{ transform: "scale(0.2)", opacity: 0.95 }, { transform: `scale(${Math.max(2, reach / 20)})`, opacity: 0 }], { duration: 720, easing: EASE_OUT, fill: "forwards" });
}

function seam(layer: HTMLElement, top: number, width: number) {
  const el = document.createElement("div");
  el.className = "fx-seam";
  Object.assign(el.style, { position: "absolute", left: "0px", top: `${top}px`, width: `${width}px` });
  layer.appendChild(el);
  return el;
}

/**
 * The character's particles in `layer`: from `from` to the edge (and a little
 * inside) of a box `size` at the layer's corner, or back from there (`inward`).
 * With `follow` the box is that element's size frame by frame (the island growing).
 */
function particles(layer: HTMLElement, from: Pt, size: { w: number; h: number }, inward: boolean, follow: HTMLElement | null): Promise<void> {
  const cv = document.createElement("canvas");
  cv.className = "fx-particles";
  const pad = 40;
  const cw = Math.max(size.w, from.x) + pad * 2, ch = Math.max(size.h, from.y) + pad * 2;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  cv.width = Math.ceil(cw * dpr);
  cv.height = Math.ceil(ch * dpr);
  Object.assign(cv.style, { position: "absolute", left: `${-pad}px`, top: `${-pad}px`, width: `${cw}px`, height: `${ch}px` });
  layer.appendChild(cv);
  const g = cv.getContext("2d");
  if (!g) { cv.remove(); return Promise.resolve(); }
  g.scale(dpr, dpr);
  g.translate(pad, pad);
  const per = 2 * (size.w + size.h);
  // Where each lands, as a share of the box: the box may still be growing.
  const pts = Array.from({ length: Math.min(340, Math.round(per / 4)) }, (_, i) => {
    let nx: number, ny: number;
    if (i % 10 < 7) {
      const d = Math.random() * 4;
      if (d < 1) { nx = d; ny = 0; } else if (d < 2) { nx = 1; ny = d - 1; } else if (d < 3) { nx = 3 - d; ny = 1; } else { nx = 0; ny = 4 - d; }
    } else { nx = Math.random(); ny = Math.random(); }
    return {
      nx, ny, sx: from.x + (Math.random() - 0.5) * 18, sy: from.y + (Math.random() - 0.5) * 18, bend: (Math.random() - 0.5) * 0.6,
      delay: Math.random() * (inward ? 110 : 170), dur: (inward ? 340 : 380) + Math.random() * 160,
      c: ORB[i % 4], size: 1.2 + Math.random() * 1.6,
    };
  });
  const t0 = performance.now(), fade = 220;
  return new Promise((done) => {
    const frame = (t: number) => {
      const w = follow ? follow.offsetWidth : size.w, h = follow ? follow.offsetHeight : size.h;
      g.clearRect(-pad, -pad, cw, ch);
      let alive = false;
      for (const p of pts) {
        const e = t - t0 - p.delay;
        if (e < 0) { alive = true; continue; }
        const k = Math.min(1, e / p.dur);
        if (inward && k >= 1) continue;
        const u = inward ? 1 - k * k * k : 1 - Math.pow(2, -10 * k);
        const a = inward ? 1 - k * 0.6 : k < 1 ? 1 : 1 - (e - p.dur) / fade;
        if (a <= 0) continue;
        alive = true;
        const tx = p.nx * w, ty = p.ny * h, len = Math.hypot(tx - p.sx, ty - p.sy) || 1, b = p.bend * len;
        const cx = (p.sx + tx) / 2 - ((ty - p.sy) / len) * b, cy = (p.sy + ty) / 2 + ((tx - p.sx) / len) * b;
        g.globalAlpha = a;
        g.fillStyle = p.c;
        g.fillRect((1 - u) * (1 - u) * p.sx + 2 * (1 - u) * u * cx + u * u * tx, (1 - u) * (1 - u) * p.sy + 2 * (1 - u) * u * cy + u * u * ty, p.size, p.size);
      }
      if (alive) requestAnimationFrame(frame);
      else { cv.remove(); done(); }
    };
    requestAnimationFrame(frame);
  });
}

const radiusFrom = (o: Pt, w: number, h: number) => Math.hypot(Math.max(o.x, w - o.x), Math.max(o.y, h - o.y)) + 24;

/**
 * The island opens: `island` grows (island.ts springs) to `w`×`h`; `bot` is the
 * character in the island's coordinates; `parts` come into focus after;
 * `fromBottom` when the island hangs from the bottom of the screen.
 * Returns false when this level leaves the opening as it was (the light wave).
 */
export function openIsland(island: HTMLElement, bot: Pt, w: number, h: number, parts: HTMLElement[], fromBottom: boolean): boolean {
  if (level !== "ricche") return false;
  openingUntil = performance.now() + 700;
  const layer = overlay(island, 900);
  if (fx === "lancio") {
    ring(layer, bot, Math.max(w, h) * 0.55);
    partsIn(parts, 150);
    const R = radiusFrom(bot, w, h);
    island.animate([{ clipPath: `circle(0px at ${bot.x}px ${bot.y}px)` }, { clipPath: `circle(${R}px at ${bot.x}px ${bot.y}px)` }], { duration: 620, easing: EASE_OUT });
  } else if (fx === "sipario") {
    const line = seam(layer, fromBottom ? h : 0, w);
    const shut = fromBottom ? "inset(100% 0 0 0)" : "inset(0 0 100% 0)";
    partsIn(parts, 200);
    line.animate([{ transform: "scaleX(0.2)", opacity: 0 }, { transform: "scaleX(1)", opacity: 1, offset: 0.3 }, { transform: `translateY(${fromBottom ? -h : h}px)`, opacity: 1, offset: 0.88 }, { transform: `translateY(${fromBottom ? -h : h}px)`, opacity: 0 }], { duration: 640, easing: EASE_OUT }).onfinish = () => line.remove();
    island.animate([{ clipPath: shut }, { clipPath: shut, offset: 0.28 }, { clipPath: "inset(0 0 0 0)" }], { duration: 620, easing: EASE_OUT });
  } else {
    void particles(layer, bot, { w, h }, false, island);
    partsIn(parts, 400);
    island.animate([{ opacity: 0, filter: "blur(8px)" }, { opacity: 0, filter: "blur(8px)", offset: 0.5 }, { opacity: 1, filter: "blur(0px)" }], { duration: 660, easing: EASE_OUT });
  }
  return true;
}

/** The island closes: `content` goes back into the character at `bot` (island coordinates). */
export function closeIsland(island: HTMLElement, content: HTMLElement, bot: Pt, fromBottom: boolean): void {
  if (level !== "ricche") return;
  openingUntil = 0;
  const w = island.offsetWidth, h = island.offsetHeight;
  const layer = overlay(island, 700);
  if (fx === "lancio") {
    const R = radiusFrom(bot, w, h);
    content.animate([{ clipPath: `circle(${R}px at ${bot.x}px ${bot.y}px)` }, { clipPath: `circle(0px at ${bot.x}px ${bot.y}px)` }], { duration: 300, easing: EASE_IN });
  } else if (fx === "sipario") {
    const line = seam(layer, fromBottom ? 0 : h, w);
    line.animate([{ transform: "none", opacity: 1 }, { transform: `translateY(${fromBottom ? h : -h}px)`, opacity: 1, offset: 0.8 }, { transform: `translateY(${fromBottom ? h : -h}px) scaleX(0.15)`, opacity: 0 }], { duration: 340, easing: EASE_IN }).onfinish = () => line.remove();
    content.animate([{ clipPath: "inset(0 0 0 0)" }, { clipPath: fromBottom ? "inset(100% 0 0 0)" : "inset(0 0 100% 0)" }], { duration: 280, easing: EASE_IN });
  } else {
    content.animate([{ filter: "blur(0px)" }, { filter: "blur(6px)" }], { duration: 200, easing: "ease-in" });
    void particles(layer, bot, { w, h }, true, null);
  }
}

// ── Level 3 for the windows (Impostazioni, Memoria, Flussi) ──────────────────

/** Where a window's own icon is: Windows draws it in the title bar, right above the page's top left. */
const WINDOW_ICON: Pt = { x: 22, y: 0 };
let shut = true;
let closing: Animation | null = null;

/** The page `root` plays the opening each time its window is shown after being closed, and the closing on `window-closing`. */
export function watchWindow(root: HTMLElement, listen: (name: string, run: () => void) => void): void {
  watchPresses(document);
  const show = () => {
    closing?.cancel();
    closing = null;
    if (document.visibilityState !== "visible" || !shut) return;
    shut = false;
    openWindow(root);
  };
  document.addEventListener("visibilitychange", show);
  listen("window-closing", () => { shut = true; closing = closeWindow(root); });
  show();
}

function openWindow(root: HTMLElement) {
  if (level === "spente") return;
  if (level === "sobrie") {
    root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
    return;
  }
  const w = window.innerWidth, h = window.innerHeight, o = WINDOW_ICON;
  const layer = overlay(null, 900);
  if (fx === "lancio") {
    ring(layer, o, Math.max(w, h) * 0.6);
    root.animate([{ clipPath: `circle(0px at ${o.x}px ${o.y}px)` }, { clipPath: `circle(${radiusFrom(o, w, h)}px at ${o.x}px ${o.y}px)` }], { duration: 560, easing: EASE_OUT });
  } else if (fx === "sipario") {
    const line = seam(layer, 0, w);
    line.animate([{ transform: "scaleX(0.2)", opacity: 0 }, { transform: "scaleX(1)", opacity: 1, offset: 0.3 }, { transform: `translateY(${h}px)`, opacity: 1, offset: 0.88 }, { transform: `translateY(${h}px)`, opacity: 0 }], { duration: 620, easing: EASE_OUT }).onfinish = () => line.remove();
    root.animate([{ clipPath: "inset(0 0 100% 0)" }, { clipPath: "inset(0 0 100% 0)", offset: 0.28 }, { clipPath: "inset(0 0 0 0)" }], { duration: 600, easing: EASE_OUT });
  } else {
    void particles(layer, o, { w, h }, false, null);
    root.animate([{ opacity: 0, filter: "blur(8px)" }, { opacity: 0, filter: "blur(8px)", offset: 0.5 }, { opacity: 1, filter: "blur(0px)" }], { duration: 640, easing: EASE_OUT });
  }
}

/** Within the 300 ms the app waits before hiding the window (lib.rs `hide_after_fx`). */
function closeWindow(root: HTMLElement): Animation | null {
  if (level === "spente") return null;
  const w = window.innerWidth, h = window.innerHeight, o = WINDOW_ICON, keep = { fill: "forwards" as const };
  if (level === "sobrie") return root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 140, easing: "ease-in", ...keep });
  if (fx === "lancio") return root.animate([{ clipPath: `circle(${radiusFrom(o, w, h)}px at ${o.x}px ${o.y}px)` }, { clipPath: `circle(0px at ${o.x}px ${o.y}px)` }], { duration: 260, easing: EASE_IN, ...keep });
  const layer = overlay(null, 600);
  if (fx === "sipario") {
    const line = seam(layer, h, w);
    line.animate([{ transform: "none", opacity: 1 }, { transform: `translateY(${-h}px)`, opacity: 0 }], { duration: 260, easing: EASE_IN }).onfinish = () => line.remove();
    return root.animate([{ clipPath: "inset(0 0 0 0)" }, { clipPath: "inset(0 0 100% 0)" }], { duration: 250, easing: EASE_IN, ...keep });
  }
  void particles(layer, o, { w, h }, true, null);
  return root.animate([{ opacity: 1, filter: "blur(0px)" }, { opacity: 0, filter: "blur(6px)" }], { duration: 200, easing: "ease-in", ...keep });
}
