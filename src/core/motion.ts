// The app's motion, in three levels (Impostazioni → Aspetto → Tema, 10 Nov 2026,
// Edoardo: «animazioni effetto wow per ogni cambio di schermata o apertura o
// chiusura finestra, ogni click scateni una qualche animazione»):
//  1. every click: the control gives way and a light ripples from the pointer;
//  2. a new view grows out of the menu item that asked for it, its cards in cascade;
//  3. opening the island and the windows: their contents come in piece by piece.
// `animations` is "ricche" (all of it), "sobrie" (short fades only) or "spente".
// Windows «Riduci animazioni» turns "ricche" into "sobrie". One-shot only: nothing
// here runs a frame once its animation is over (the shut island costs nothing).

import "./motion.css";

export type AnimLevel ="ricche" | "sobrie" | "spente";

// The app's two curves (also `--ease-out`, `--ease-in-out` in motion.css): strong
// ease-out for everything that enters or leaves, ease-in-out for what moves on
// screen. Never an ease-in: it starts slow just when the eye is on it.
const EASE_OUT = "cubic-bezier(0.23, 1, 0.32, 1)";
const EASE_IN_OUT = "cubic-bezier(0.77, 0, 0.175, 1)";

let level: AnimLevel = "ricche";
/** Until this time an opening is playing: a view change then does not animate on top of it. */
let openingUntil = 0;

const reduced = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** The level from the settings, on `<html>` (`data-anim`) for the CSS and the popped-out windows. */
export function applyMotion(s: { animations?: string } | undefined, doc: Document = document): void {
  const asked = (["ricche", "sobrie", "spente"] as const).find((l) => l === s?.animations) ?? "ricche";
  level = asked === "ricche" && reduced() ? "sobrie" : asked;
  doc.documentElement.dataset.anim = level;
}

export const motionLevel = (): AnimLevel => level;

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
  const dot = doc.createElement("span");
  Object.assign(dot.style, {
    position: "absolute", left: `${x - r.left - size / 2}px`, top: `${y - r.top - size / 2}px`, width: `${size}px`, height: `${size}px`,
    borderRadius: "50%",
    background: "radial-gradient(circle, color-mix(in srgb, var(--accent, #60cdff) 70%, transparent) 0, color-mix(in srgb, var(--accent, #60cdff) 32%, transparent) 38%, transparent 66%)",
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
  // The view slides in from the menu item that asked for it; its pieces follow one by one.
  const vr = view.getBoundingClientRect();
  const fr = from?.getBoundingClientRect();
  view.style.transformOrigin = fr ? `0px ${Math.round(fr.top + fr.height / 2 - vr.top)}px` : "50% 0px";
  view.animate(
    [{ opacity: 0, transform: "translateX(-40px) scale(0.93)" }, { opacity: 1, transform: "none" }],
    { duration: 500, easing: EASE_OUT },
  );
  partsIn([view], 40, 300);
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
  ghost.animate(frames, { duration: 300, easing: EASE_IN_OUT }).onfinish = () => { ghost.remove(); item.classList.remove("mark-gliding"); };
}

// ── Level 3: opening ────────────────────────────────────────────────────────

/** What moves as one piece: a control, a card, a row, a title. Anything else is opened up into its children. */
const ATOM = ".card, .tile, .ov-card, .row, .setting, [data-stagger], .rail-item, button, a, input, select, textarea, label, h1, h2, h3, h4, p, li, img, canvas, svg, video, iframe, [role=button], [role=tab]";
const SKIP = "script, style, template, #open-wave, [hidden]";
const MAX_PIECES = 160;
const BLURRED = 40;
/** The pieces still coming in: a closing stops them (they would go on arriving while the rest fades). */
let entering: Animation[] = [];
function stopEntering() {
  for (const a of entering) a.cancel();
  entering = [];
}

/**
 * Every piece of `parts` in view, down to its controls, cards and rows: each
 * comes in on its own instead of the whole block at once (Edoardo, 10/11). The
 * DOM is opened up level by level, so the siblings of a piece that moves move too.
 */
function piecesOf(parts: Iterable<HTMLElement>, view: { w: number; h: number }): HTMLElement[] {
  const out: HTMLElement[] = [];
  // Shown, not "has a size": while the island grows its search box and its views are
  // still 0 px wide (they and all they held stayed still).
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
    if (!kids.length) { out.push(el); return; }
    for (const k of kids) walk(k, depth + 1);
  };
  for (const part of parts) walk(part, 0);
  return out;
}

/**
 * `parts`' pieces come in one after the other in reading order (top to bottom,
 * then left to right), each rising into focus. The only opening of the island
 * and of the windows: their frame does nothing (Edoardo, 10/11: «concentrati sulle
 * animazioni dei contenuti e non della finestra… scegliamo noi un effetto per tutto»;
 * the circle, the curtain and the particles of 1.0.41 are gone).
 */
function partsIn(parts: Iterable<HTMLElement>, delay: number, spread = 300) {
  // Hidden until the next frame, then measured once laid out (the island's menu is
  // hidden until the open layout applies: it would come in as one block).
  const list = [...parts];
  const hide = list.map((el) => el.animate([{ opacity: 0 }, { opacity: 0 }], { duration: 1000 }));
  requestAnimationFrame(() => { hide.forEach((a) => a.cancel()); piecesIn(list, Math.max(0, delay - 16), spread); });
}

function piecesIn(parts: HTMLElement[], delay: number, spread: number) {
  entering = entering.filter((a) => a.playState !== "finished");
  const view = { w: window.innerWidth, h: window.innerHeight };
  const pieces = piecesOf(parts, view);
  if (!pieces.length) return;
  const rects = pieces.map((el) => el.getBoundingClientRect());
  const top = Math.min(...rects.map((r) => r.top)), left = Math.min(...rects.map((r) => r.left));
  const tall = Math.max(1, Math.max(...rects.map((r) => r.top)) - top), wide = Math.max(1, Math.max(...rects.map((r) => r.left)) - left);
  // Mostly down the page, a little across it: a row comes in from its left.
  const waits = rects.map((r) => (((r.top - top) / tall) * 0.75 + ((r.left - left) / wide) * 0.25) * spread);
  // Blur is the costly part: only the first BLURRED to arrive get it (a settings page has up to 160 pieces).
  const blurUntil = [...waits].sort((x, y) => x - y)[Math.min(BLURRED, waits.length) - 1];
  pieces.forEach((el, i) => {
    const wait = waits[i];
    const blur = wait <= blurUntil ? "blur(10px)" : "blur(0px)";
    // The menu slides in from its side, everything else rises. `translate` and `scale`
    // add to the piece's own transform instead of replacing it.
    const side = el.closest("#rail, nav, .nav, .rail");
    const anim = el.animate(
      [
        { opacity: 0, filter: blur, translate: side ? "-28px 0px" : "0px 30px", scale: "0.9" },
        { opacity: 1, filter: "blur(0px)", translate: "0px 0px", scale: "1" },
      ],
      // Strong enough to be seen while the island is still growing (at 12 px nobody saw it).
      { duration: 620, delay: delay + wait, easing: EASE_OUT, fill: "backwards" },
    );
    entering.push(anim);
  });
}

/** The island has started growing (island.ts springs): its contents come in. False when this level leaves the opening as it was (the light wave). */
export function openIsland(parts: HTMLElement[]): boolean {
  if (level !== "ricche") return false;
  openingUntil = performance.now() + 900;
  partsIn(parts, 140);
  return true;
}

/** The island closes: its contents fade before it shrinks. */
export function closeIsland(content: HTMLElement): void {
  if (level !== "ricche") return;
  openingUntil = 0;
  stopEntering();
  content.animate([{ opacity: 1, filter: "blur(0px)" }, { opacity: 0, filter: "blur(3px)" }], { duration: 180, easing: EASE_OUT });
}

// ── Level 3 for the windows (Impostazioni, Memoria, Flussi) ──────────────────

const ownLabel = (): string => (window as unknown as { __TAURI_INTERNALS__?: { metadata?: { currentWindow?: { label?: string } } } }).__TAURI_INTERNALS__?.metadata?.currentWindow?.label ?? "";

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
    root.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 180, easing: EASE_OUT });
    return;
  }
  partsIn([root], 80);
}

/** Within the 300 ms the app waits before hiding the window (lib.rs `hide_after_fx`): the contents fade. */
function closeWindow(root: HTMLElement): Animation | null {
  if (level === "spente") return null;
  stopEntering();
  return root.animate([{ opacity: 1 }, { opacity: 0 }], { duration: level === "sobrie" ? 140 : 200, easing: EASE_OUT, fill: "forwards" });
}
