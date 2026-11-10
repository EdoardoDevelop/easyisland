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
    el.animate([{ scale: "1" }, { scale: r.width > 260 ? "0.98" : "0.93", offset: 0.3 }, { scale: "1.02", offset: 0.65 }, { scale: "1" }], { duration: 280, easing: EASE_OUT });
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
  const size = Math.max(r.width, r.height) * 2.8;
  // Neutral: the control's own text colour (light on dark, dark on light), not the accent.
  const ink = getComputedStyle(el).color;
  const dot = doc.createElement("span");
  Object.assign(dot.style, {
    position: "absolute", left: `${x - r.left - size / 2}px`, top: `${y - r.top - size / 2}px`, width: `${size}px`, height: `${size}px`,
    borderRadius: "50%",
    background: `radial-gradient(circle, color-mix(in srgb, ${ink} 34%, transparent) 0, color-mix(in srgb, ${ink} 14%, transparent) 40%, transparent 66%)`,
  });
  layer.appendChild(dot);
  doc.body.appendChild(layer);
  dot.animate([{ transform: "scale(0)", opacity: 1 }, { transform: "scale(1)", opacity: 0 }], { duration: 680, easing: EASE_OUT }).onfinish = () => layer.remove();
}

// ── Level 2: a view change ──────────────────────────────────────────────────

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
  // The view slides in from the menu; its pieces follow one by one from the item that asked for it.
  view.animate(
    [{ opacity: 0, transform: "translateX(-40px) scale(0.93)" }, { opacity: 1, transform: "none" }],
    { duration: 500, easing: EASE_OUT },
  );
  partsIn([view], 60, fr ? { x: fr.right, y: fr.top + fr.height / 2 } : { x: vr.left, y: vr.top }, null, 320);
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

/** The pieces an opening animates one by one: menu items, buttons, cards, rows. */
/** What moves as one piece: a control, a card, a row, a title. Anything else is opened up into its children. */
const ATOM = ".card, .tile, .ov-card, .row, .setting, [data-stagger], .rail-item, button, a, input, select, textarea, label, h1, h2, h3, h4, p, li, img, canvas, svg, video, iframe, [role=button], [role=tab]";
const SKIP = "script, style, template, .fx-layer, #open-wave, [hidden]";
/** Past this many, the rest come in without blur (cheaper). */
const BLURRED = 40;
const MAX_PIECES = 160;

/**
 * Every piece of `parts` in view, down to its controls, cards and rows: each
 * comes in on its own instead of the whole block at once (Edoardo, 10/11). The
 * DOM is opened up level by level, so the siblings of a piece that moves always
 * move too (with a fixed list of tags a card title moved and its neighbour did not).
 */
function piecesOf(parts: Iterable<HTMLElement>, view: { w: number; h: number }): HTMLElement[] {
  const out: HTMLElement[] = [];
  // Shown, not "has a size": while the island grows its search box and its views are
  // still 0 px wide (until 1.0.41 they and all they hold stayed still).
  const seen = (el: HTMLElement) => {
    if (!el.getClientRects().length) return false;
    const r = el.getBoundingClientRect();
    if (r.top >= view.h || r.left >= view.w || r.bottom < 0 || r.right < 0) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== "hidden" && cs.opacity !== "0";
  };
  const walk = (el: HTMLElement, depth: number) => {
    if (out.length >= MAX_PIECES || el.matches(SKIP) || !seen(el)) return;
    if (el.matches(ATOM) || depth > 9) { out.push(el); return; }
    const kids = [...el.children].filter((k): k is HTMLElement => k instanceof HTMLElement && !k.matches(SKIP) && seen(k));
    // A leaf (text, a dot, a bar) moves whole; so does a wrapper of a single thing that is not a piece yet.
    if (!kids.length) { out.push(el); return; }
    for (const k of kids) walk(k, depth + 1);
  };
  for (const part of parts) walk(part, 0);
  return out;
}

/**
 * `parts`' pieces come in one by one, in the order the wave from `origin`
 * (page coordinates) reaches them: the nearest first, each from its own side.
 */
function partsIn(parts: Iterable<HTMLElement>, delay: number, origin: Pt | null = null, frame: HTMLElement | null = null, spread = 420) {
  // Until they are hidden behind the opening's first frame, then measured once laid out
  // (the island's menu is hidden until the open layout applies: it would come in as one block).
  const list = [...parts];
  const hide = list.map((el) => el.animate([{ opacity: 0 }, { opacity: 0 }], { duration: 1000 }));
  requestAnimationFrame(() => { hide.forEach((a) => a.cancel()); piecesIn(list, Math.max(0, delay - 16), origin, frame, spread); });
}

function piecesIn(parts: HTMLElement[], delay: number, origin: Pt | null, frame: HTMLElement | null, spread: number) {
  const view = { w: window.innerWidth, h: window.innerHeight };
  const pieces = piecesOf(parts, view);
  // `origin` is in `frame`'s coordinates (the island's), the pieces too.
  const base = frame?.getBoundingClientRect() ?? { left: 0, top: 0 };
  const at = (el: HTMLElement) => { const r = el.getBoundingClientRect(); return { x: r.left - base.left + r.width / 2, y: r.top - base.top + r.height / 2 }; };
  const centres = pieces.map(at);
  const o = origin ?? { x: 0, y: 0 };
  const far = Math.max(1, ...centres.map((c) => Math.hypot(c.x - o.x, c.y - o.y)));
  const dist = centres.map((c) => Math.hypot(c.x - o.x, c.y - o.y));
  // The nearest get the blur, the far ones (many, small) only move: the cost stays bounded.
  const near = [...dist].sort((x, y) => x - y)[Math.min(BLURRED, dist.length) - 1] ?? 0;
  pieces.forEach((el, i) => {
    const c = centres[i];
    const dx = c.x - o.x, dy = c.y - o.y, d = dist[i] || 1;
    // Small pieces travel less than big ones: a 20 px icon pushed 26 px looks thrown.
    const r = el.getBoundingClientRect();
    const size = Math.min(1, Math.max(r.width, r.height) / 160);
    const wait = origin ? Math.pow(d / far, 0.85) * spread : Math.min(i * 30, spread);
    const back = (8 + 16 * size) * (origin ? 1 : 0.7);
    const blur = dist[i] <= near ? `blur(${(3 + 5 * size).toFixed(1)}px)` : "blur(0px)";
    // Pushed out by the wave: from a little nearer the origin, a little small, out of focus.
    // `translate` and `scale` add to the piece's own transform instead of replacing it.
    el.animate(
      [
        { opacity: 0, filter: blur, translate: `${(-dx / d) * back}px ${(-dy / d) * back}px`, scale: `${0.86 - 0.04 * size}` },
        { opacity: 1, filter: "blur(0px)", translate: "0px 0px", scale: `${1 + 0.03 * size}`, offset: 0.6 },
        { opacity: 1, filter: "blur(0px)", translate: "0px 0px", scale: "1" },
      ],
      { duration: 460 + 120 * size, delay: delay + wait, easing: EASE_OUT, fill: "backwards" },
    );
  });
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

/**
 * «Lancio»'s light: the edge of `layer` (the island's or the window's shape)
 * lights up and fades while it springs. Until 1.0.41 a ring spread from the
 * character: Edoardo, 10/11: «il cerchio che si vede è proprio fastidioso… farei
 * solo le ondulazioni nei bordi».
 */
function edgeLight(layer: HTMLElement) {
  const el = document.createElement("div");
  el.className = "fx-edge";
  layer.appendChild(el);
  el.animate([{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], { duration: 900, easing: "ease-out", fill: "forwards" });
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


/**
 * The island opens: `island` grows (island.ts springs) to `w`×`h`; `bot` is the
 * character in the island's coordinates; `parts` come into focus after;
 * `fromBottom` when the island hangs from the bottom of the screen.
 * Returns false when this level leaves the opening as it was (the light wave).
 */
export function openIsland(island: HTMLElement, bot: Pt, w: number, h: number, parts: HTMLElement[], fromBottom: boolean): boolean {
  if (level !== "ricche") return false;
  openingUntil = performance.now() + 1000;
  const layer = overlay(island, 1300);
  if (fx === "lancio") {
    // The edge springs (island.ts, elastic) and lights up; the pieces follow the wave from the character.
    edgeLight(layer);
    partsIn(parts, 60, bot, island);
  } else if (fx === "sipario") {
    const line = seam(layer, fromBottom ? h : 0, w);
    const shut = fromBottom ? "inset(100% 0 0 0)" : "inset(0 0 100% 0)";
    partsIn(parts, 200, { x: w / 2, y: fromBottom ? h : 0 }, island);
    line.animate([{ transform: "scaleX(0.2)", opacity: 0 }, { transform: "scaleX(1)", opacity: 1, offset: 0.3 }, { transform: `translateY(${fromBottom ? -h : h}px)`, opacity: 1, offset: 0.88 }, { transform: `translateY(${fromBottom ? -h : h}px)`, opacity: 0 }], { duration: 780, easing: EASE_OUT }).onfinish = () => line.remove();
    island.animate([{ clipPath: shut }, { clipPath: shut, offset: 0.25 }, { clipPath: "inset(0 0 0 0)" }], { duration: 760, easing: EASE_OUT });
  } else {
    void particles(layer, bot, { w, h }, false, island);
    partsIn(parts, 360, bot, island);
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
    // Back into the character, without a circle: the contents shrink towards it and fade.
    content.style.transformOrigin = `${bot.x}px ${bot.y}px`;
    content.animate([{ transform: "none", opacity: 1, filter: "blur(0px)" }, { transform: "scale(0.9)", opacity: 0, filter: "blur(4px)" }], { duration: 260, easing: EASE_IN }).onfinish = () => { content.style.transformOrigin = ""; };
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

const ownLabel = (): string => (window as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }).__TAURI_INTERNALS__?.metadata?.currentWindow?.label ?? "";

/** Where a window's own icon is: Windows draws it in the title bar, right above the page's top left. */
const WINDOW_ICON: Pt = { x: 22, y: 0 };
let shut = true;
let closing: Animation | null = null;

/** The page `root` plays the opening each time its window is shown after being closed, and the closing on `window-closing`. */
export function watchWindow(root: HTMLElement, listen: (name: string, run: (label: string) => void) => void): void {
  watchPresses(document);
  const show = () => {
    closing?.cancel();
    closing = null;
    if (document.visibilityState !== "visible" || !shut) return;
    shut = false;
    openWindow(root);
  };
  document.addEventListener("visibilitychange", show);
  // Every window hears the event (Tauri's `listen` takes any target): only the one closing plays it.
  // Until 1.0.41 a window left open went black when another one closed.
  listen("window-closing", (label) => {
    if (label !== ownLabel()) return;
    shut = true;
    closing = closeWindow(root);
  });
  show();
}

function openWindow(root: HTMLElement) {
  if (level === "spente") return;
  if (level === "sobrie") {
    root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: "ease-out" });
    return;
  }
  const w = window.innerWidth, h = window.innerHeight, o = WINDOW_ICON;
  const layer = overlay(null, 1300);
  // The page's pieces in view come in one by one as the wave reaches them.
  const parts = [root];
  partsIn(parts, 140, fx === "sipario" ? { x: w / 2, y: 0 } : o);
  if (fx === "lancio") {
    // A window's edges are Windows': its page springs out from the icon's corner instead, and its edge lights up.
    edgeLight(layer);
    root.style.transformOrigin = `${o.x}px ${o.y}px`;
    root.animate(
      [{ transform: "scale(0.94)", opacity: 0.4 }, { transform: "scale(1.018)", opacity: 1, offset: 0.42 }, { transform: "scale(0.996)", offset: 0.7 }, { transform: "none" }],
      { duration: 760, easing: EASE_OUT },
    );
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
  if (fx === "lancio") {
    root.style.transformOrigin = `${o.x}px ${o.y}px`;
    return root.animate([{ transform: "none", opacity: 1 }, { transform: "scale(0.95)", opacity: 0 }], { duration: 240, easing: EASE_IN, ...keep });
  }
  const layer = overlay(null, 600);
  if (fx === "sipario") {
    const line = seam(layer, h, w);
    line.animate([{ transform: "none", opacity: 1 }, { transform: `translateY(${-h}px)`, opacity: 0 }], { duration: 260, easing: EASE_IN }).onfinish = () => line.remove();
    return root.animate([{ clipPath: "inset(0 0 0 0)" }, { clipPath: "inset(0 0 100% 0)" }], { duration: 250, easing: EASE_IN, ...keep });
  }
  void particles(layer, o, { w, h }, true, null);
  return root.animate([{ opacity: 1, filter: "blur(0px)" }, { opacity: 0, filter: "blur(6px)" }], { duration: 200, easing: "ease-in", ...keep });
}
