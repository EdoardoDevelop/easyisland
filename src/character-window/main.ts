// The character's own window (docs/due-webview.md): the resting character, the
// compact one and the one beside the open island, drawn from what the island's
// page sends over the link. Over the rest icon or the compact badge, Rust lets
// every click through to the island; beside the open island a click closes it.

import "../character/roster";
import { character, setCharacter } from "../character/character";
import { BotEngine, hexToRGB } from "../character/engine";
import { setFigure, setFigureWeather } from "../character/figure";
import { setJarvisAgents } from "../character/jarvis";
import { invoke } from "@tauri-apps/api/core";
import { linkChannel, MIRRORED_CALLS, type BarLook, type BarPiece, type CharacterMode, type CharacterToIsland, type IslandToCharacter } from "../core/link";

/** Only following a gaze: 30 fps, as in the island. */
const LOOK_FRAME_MS = 33;
/**
 * At rest the character is a still picture floating by CSS (personaggio.html):
 * after a change it moves for this long, then the loop stops even for the
 * characters that move on their own (flame, Jarvis) or a state that loops.
 */
const MOVE_MS = 2500;
/**
 * The characters that move on their own (Jarvis's particles, the flame) keep
 * moving at rest and beside the open island, at this rate: half the island's.
 */
const AMBIENT_FRAME_MS = 66;
/** Room above the compact body for hearts and sparks, as the island's canvas (BOT_OVERHANG). */
const OVERHANG = 40;
/**
 * The mouse on the character in the bar: the band swells this much past
 * itself (a share of its height) and the character grows to fill it.
 */
const GROW = 0.42;
/** As the band's swelling in personaggio.html, and a moment more. */
const SHRINK_MS = 400;

const canvas = document.getElementById("bot") as HTMLCanvasElement;
const engine = new BotEngine();
let running = false;
let last = performance.now();
let heard = false;
let moveUntil = 0;
let mode: CharacterMode = "off";
/** The rest icon's size; the body fills ~90 % of it, as in the island (drawRestIcon). */
let size = 24;
let paused = false;
/** The fixed bar, when the window is the band (appbar.rs). */
let bar: BarLook | null = null;
/** The last gaze from the island: following it is worth 30 fps, the rest 15. */
let gazeAt = 0;

/** The canvas: a square around the rest icon, or the whole window (the compact canvas). */
function box(): { w: number; h: number } {
  if (mode === "compact" || mode === "open") return { w: window.innerWidth, h: window.innerHeight };
  // In the bar: a canvas a little shorter than the band, so the body (and its
  // float, a few px up and down) stays inside it with a margin.
  const w = Math.round((mode === "bar" && bar ? bar.thickness * 0.9 : size * 1.3));
  return { w, h: w };
}

function frame(t: number) {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  // In the bar the character may grow under the mouse (by CSS): drawn sharp for that size.
  const dpr = Math.min(2, window.devicePixelRatio || 1) * (mode === "bar" ? 1 + GROW : 1);
  const { w, h } = box();
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }
  engine.particleOverhang = mode === "rest" || mode === "bar" ? 0 : OVERHANG;
  engine.update(dt);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    engine.draw(ctx, w, h);
  }
  // Their own motion, for ever but slowly; otherwise no frames once nothing
  // moves, or once the change has played out.
  // Compact it moves as the island's own did: as long as anything moves (its own
  // motion, a looping state, the gaze), with no time limit.
  const ambient = (mode === "rest" || mode === "open" || mode === "bar") && character().animated === true;
  if (ambient && t > moveUntil) window.setTimeout(() => requestAnimationFrame(frame), AMBIENT_FRAME_MS);
  else if (!engine.busy || (t > moveUntil && mode !== "compact")) running = false;
  // Only the gaze (30 fps while it moves) or the character's own motion (15).
  else if (!engine.busyBeyondLook) window.setTimeout(() => requestAnimationFrame(frame), t - gazeAt < 500 ? LOOK_FRAME_MS : AMBIENT_FRAME_MS);
  else requestAnimationFrame(frame);
}

function wake(ms = MOVE_MS) {
  if (mode === "off") return;
  moveUntil = Math.max(moveUntil, performance.now() + ms);
  if (running) return;
  running = true;
  last = performance.now();
  requestAnimationFrame(frame);
}

function applyLook(m: Extract<IslandToCharacter, { kind: "look" }>) {
  const was = mode;
  mode = m.mode;
  setCharacter(m.character);
  setFigure(m.figure);
  setFigureWeather(m.weather.sky, m.weather.temp);
  setJarvisAgents(m.agents);
  engine.bodyColor = m.color ? hexToRGB(m.color) : null;
  engine.sky = m.sky;
  engine.setState(m.state, was !== mode);
  size = m.size;
  paused = m.paused;
  bar = m.mode === "bar" ? m.bar : null;
  layBar();
  // As the island's rest icon (dimmed when paused); the compact character at full
  // strength. Beside the open island it has no badge under it: the rest icon's shadow.
  // Coming to rest it fades in as the island finishes retracting (420 ms,
  // island.ts → updateWindowCollapsed), instead of appearing all at once.
  if (mode === "rest" && was !== "rest") {
    canvas.style.transition = "none";
    canvas.style.opacity = "0";
    void canvas.offsetWidth;
    canvas.style.transition = "opacity 0.3s ease 0.38s";
  } else if (mode !== "rest") {
    canvas.style.transition = "";
  }
  canvas.style.opacity = mode === "rest" ? (paused ? "0.4" : "0.9") : mode === "bar" && paused ? "0.5" : "1";
  canvas.style.filter = mode === "compact" || mode === "bar" ? "" : "drop-shadow(0 1px 2px rgba(0, 0, 0, 0.45))";
  canvas.style.cursor = mode === "open" || mode === "bar" ? "pointer" : "";
  // Alive for ever by CSS, except compact (the island moves it); the halo in its colour.
  document.body.classList.toggle("alive", mode === "rest" || mode === "open" || mode === "bar");
  const [r, g, b] = m.color ? hexToRGB(m.color) : character().color;
  document.body.style.setProperty("--halo", `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, 0.9)`);
  // Compact: the island's look; otherwise straight ahead.
  if (mode !== "compact") {
    engine.lookX = 0;
    engine.lookY = 0;
  }
  wake();
}

const send = linkChannel<IslandToCharacter, CharacterToIsland>((m) => {
  if (!heard) {
    heard = true;
    // Straight to the log command: this page needs nothing else of bridge.ts.
    void invoke("log_line", { message: "due webview: il personaggio riceve dall'isola" }).catch(() => {});
  }
  switch (m.kind) {
    case "look":
      applyLook(m);
      break;
    case "gaze":
      engine.lookX = m.x;
      engine.lookY = m.y;
      gazeAt = performance.now();
      wake(900);
      break;
    case "call": {
      if (!(MIRRORED_CALLS as readonly string[]).includes(m.name)) break;
      const fn = (engine as unknown as Record<string, (...a: unknown[]) => unknown>)[m.name];
      fn?.apply(engine, m.args);
      wake();
      break;
    }
    case "pong":
      break;
  }
});

/** «Aspetto della barra» with every choice clamped (src/core/state.ts FixedBarLook). */
function lookOf(b: BarLook) {
  const l = b.look ?? {};
  const num = (v: number | undefined, d: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, typeof v === "number" && Number.isFinite(v) ? v : d));
  return {
    islands: l.style === "islands",
    opacity: num(l.opacity, 100, 10, 100),
    margin: num(l.margin, 0, 0, 400),
    text: num(l.text, 100, 80, 150) / 100,
    gap: num(l.gap, 4, 0, 24),
    autoHide: !!l.autoHide,
    blur: !!l.blur && l.style !== "islands",
    grow: l.grow !== false,
  };
}

/**
 * The fixed bar: the band in the island's colour (or one island per area), the
 * character in its area (start, centre or end) in a square as tall as the band.
 */
function layBar() {
  const float = document.getElementById("float");
  const band = document.getElementById("band");
  if (!float || !band) return;
  document.body.style.background = "transparent";
  document.body.classList.toggle("bar", !!bar);
  if (!bar) {
    float.style.cssText = "";
    setGrown(false);
    document.body.classList.remove("islands", "see-through", "bottom");
    return;
  }
  const look = lookOf(bar);
  const t = bar.thickness;
  const m = look.margin;
  // The background: the band between the margins, or behind each area (islands).
  const see = bar.background === "transparent" || look.opacity < 50;
  const bg = bar.background === "transparent" ? "transparent" : `color-mix(in srgb, ${bar.background} ${look.opacity}%, transparent)`;
  document.body.style.setProperty("--bar-bg", bg);
  document.body.classList.toggle("see-through", see);
  document.body.classList.toggle("islands", look.islands);
  document.body.classList.toggle("bottom", bar.edge === "bottom");
  document.body.style.setProperty("--t", `${t}px`);
  const g = Math.round(t * GROW);
  document.body.style.setProperty("--g", `${g}px`);
  document.body.style.setProperty("--k", String(1 + g / t));
  band.style.display = look.islands ? "none" : "";
  band.style.height = `${t + g}px`;
  if (!look.grow) setGrown(false);
  paintBand();
  // With the blur, the window cut to the band (margins, rounded ends) at rest too.
  const shapeKey = JSON.stringify([window.innerWidth, t, m, bar.slot, bar.edge, look.blur]);
  if (shapeKey !== laidShape && !grown) {
    laidShape = shapeKey;
    void invoke("bar_grow", { px: 0, shape: bandShape(0) }).catch(() => {});
  }
  // Text and icons follow the bar's height (Impostazioni → Barra fissa → Altezza); the text also its own size.
  document.body.style.setProperty("--s", String(Math.min(1.6, Math.max(0.8, t / 40))));
  document.body.style.setProperty("--ts", String(look.text));
  document.body.style.setProperty("--gap", `${look.gap}px`);
  const left = bar.slot === "start" ? `${m + 8}px` : bar.slot === "end" ? `calc(100% - ${t + 8 + m}px)` : `calc(50% - ${t / 2}px)`;
  float.style.cssText = `inset: auto; ${bar.edge === "bottom" ? "bottom" : "top"}: 0; left: ${left}; width: ${t}px; height: ${t}px;`;
  document.body.style.setProperty("--ink", bar.ink);
  autoHide(look.autoHide);
  layAreas(bar);
}

/**
 * The band's outline, as if against the top edge (flipped by CSS at the
 * bottom): the bar between the margins, rounded at the ends when it floats,
 * and under the character a bump `p` (0–1) of the swelling deep, its sides
 * curving in so the band and the bump are one smooth shape.
 */
function bandPath(p: number): string {
  if (!bar) return "";
  const look = lookOf(bar);
  const t = bar.thickness;
  const m = look.margin;
  const W = window.innerWidth;
  const r = m > 0 ? Math.min(t / 2, 12) : 0;
  const cx = bar.slot === "start" ? m + 8 + t / 2 : bar.slot === "end" ? W - m - 8 - t / 2 : W / 2;
  const bw = t * 0.78;
  const s = t * 0.5;
  const y = t + Math.round(t * GROW) * p;
  const f = (n: number) => Math.round(n * 10) / 10;
  return [
    `M ${f(m)} 0 H ${f(W - m)} V ${f(t - r)} Q ${f(W - m)} ${f(t)} ${f(W - m - r)} ${f(t)}`,
    `H ${f(cx + bw + s)} C ${f(cx + bw)} ${f(t)} ${f(cx + bw)} ${f(y)} ${f(cx + bw * 0.35)} ${f(y)}`,
    `H ${f(cx - bw * 0.35)} C ${f(cx - bw)} ${f(y)} ${f(cx - bw)} ${f(t)} ${f(cx - bw - s)} ${f(t)}`,
    `H ${f(m + r)} Q ${f(m)} ${f(t)} ${f(m)} ${f(t - r)} Z`,
  ].join(" ");
}

/** The band drawn as it is now: swollen or not. */
function paintBand() {
  const path = document.querySelector<SVGPathElement>("#band path");
  if (path) path.style.d = `path("${bandPath(grown ? 1 : 0)}")`;
}

/**
 * With the blur on, the window's outline for Rust to cut it to (logical px in
 * the window, `swell` deep): the blur fills the whole window otherwise.
 */
function bandShape(p: number): number[][] | null {
  if (!bar) return null;
  const look = lookOf(bar);
  if (!look.blur) return null;
  const el = document.createElementNS("http://www.w3.org/2000/svg", "path");
  el.setAttribute("d", bandPath(p));
  const len = el.getTotalLength();
  const g = Math.round(bar.thickness * GROW) * p;
  const H = bar.thickness + g;
  const out: number[][] = [];
  const n = 160;
  for (let i = 0; i < n; i++) {
    const pt = el.getPointAtLength((len * i) / n);
    out.push([pt.x, bar.edge === "bottom" ? H - pt.y : pt.y]);
  }
  return out;
}

/**
 * The mouse on the character (Aspetto della barra → «Il personaggio cresce»):
 * the window first reaches past the band, then the band swells and the
 * character grows; leaving, both go back and the window shrinks after.
 */
let grown = false;
let laidShape = "";
let shrinkTimer: number | null = null;
function setGrown(on: boolean) {
  if (on && !(bar && mode === "bar" && lookOf(bar).grow && !lookOf(bar).autoHide)) on = false;
  if (on === grown) return;
  grown = on;
  if (shrinkTimer !== null) window.clearTimeout(shrinkTimer);
  shrinkTimer = null;
  const g = bar ? Math.round(bar.thickness * GROW) : 0;
  if (on) {
    void invoke("bar_grow", { px: g, shape: bandShape(1) }).catch(() => {});
    requestAnimationFrame(() => {
      document.body.classList.add("grown");
      paintBand();
    });
  } else {
    document.body.classList.remove("grown");
    paintBand();
    shrinkTimer = window.setTimeout(() => {
      shrinkTimer = null;
      void invoke("bar_grow", { px: 0, shape: bandShape(0) }).catch(() => {});
    }, SHRINK_MS);
  }
}
document.getElementById("float")?.addEventListener("mouseenter", () => setGrown(true));
document.getElementById("float")?.addEventListener("mouseleave", () => setGrown(false));

/**
 * «Nascondi da sola»: Rust keeps only a thin edge of the bar on screen; the
 * mouse on it brings the bar out, and it goes back a moment after the mouse leaves.
 */
let hiding = false;
let hideTimer: number | null = null;
function autoHide(on: boolean) {
  if (on === hiding) return;
  hiding = on;
  if (!on && hideTimer !== null) window.clearTimeout(hideTimer);
  hideTimer = null;
}
document.documentElement.addEventListener("mouseenter", () => {
  if (!hiding) return;
  if (hideTimer !== null) window.clearTimeout(hideTimer);
  hideTimer = null;
  void invoke("bar_reveal", { on: true }).catch(() => {});
});
document.documentElement.addEventListener("mouseleave", () => {
  if (!hiding) return;
  if (hideTimer !== null) window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => {
    hideTimer = null;
    void invoke("bar_reveal", { on: false }).catch(() => {});
  }, 800);
});

/**
 * The three areas: from the left edge, around the middle, from the right edge.
 * In the character's area the elements come right after it; with the islands
 * style that area's island holds the character too.
 */
function layAreas(b: BarLook) {
  const look = lookOf(b);
  const m = look.margin;
  const beside = b.thickness + 8 + 6 + m;
  const areas = { start: document.getElementById("a-start"), center: document.getElementById("a-center"), end: document.getElementById("a-end") };
  for (const [slot, el] of Object.entries(areas)) el?.classList.toggle("own", look.islands && slot === b.slot);
  if (look.islands) {
    // The character's island starts just before it: padding keeps its elements after it.
    const pad = b.thickness + 12;
    if (areas.start) areas.start.style.cssText = b.slot === "start" ? `left: ${m + 2}px; padding-left: ${pad}px;` : `left: ${m + 8}px;`;
    if (areas.end) areas.end.style.cssText = b.slot === "end" ? `right: ${m + 2}px; padding-right: ${pad}px;` : `right: ${m + 8}px;`;
    if (areas.center) {
      areas.center.style.cssText = b.slot === "center"
        ? `left: calc(50% - ${b.thickness / 2 + 6}px); padding-left: ${pad}px;`
        : "left: 50%; transform: translateX(-50%);";
    }
  } else {
    if (areas.start) areas.start.style.cssText = `left: ${b.slot === "start" ? beside : m + 8}px;`;
    if (areas.end) areas.end.style.cssText = `right: ${b.slot === "end" ? beside : m + 8}px;`;
    if (areas.center) {
      areas.center.style.cssText = b.slot === "center"
        ? `left: calc(50% + ${b.thickness / 2 + 6}px);`
        : "left: 50%; transform: translateX(-50%);";
    }
  }
  const key = JSON.stringify([b.items, b.look]);
  if (key === laidItems) return;
  laidItems = key;
  shown = b.items;
  for (const el of Object.values(areas)) el?.replaceChildren();
  for (const p of b.items) {
    // Not a <button>: the strip holds buttons of its own.
    const btn = document.createElement("div");
    btn.setAttribute("role", "button");
    btn.className = `bar-btn${p.tone === "warn" || p.tone === "error" ? ` ${p.tone}` : ""}`;
    btn.dataset.key = p.key;
    btn.title = p.title;
    // Built by the island with the DOM (src/island/bar.ts): icons and escaped text only.
    btn.innerHTML = p.html;
    areas[p.area]?.append(btn);
  }
  fitAreas();
}

let laidItems = "";
/** The elements as last laid out, for the «…» menu's labels. */
let shown: BarPiece[] = [];

/**
 * What does not fit goes into «…» at the end of the bar: while two areas (or
 * an area and the character) overlap, or one runs off the window, the last
 * element of the wider one moves out, the strip last of all. The menu is
 * Windows' own (bar_overflow_menu): the band is too short for one of ours.
 */
function fitAreas() {
  const areas = ["a-start", "a-center", "a-end"].map((id) => document.getElementById(id)).filter((x): x is HTMLElement => !!x);
  const float = document.getElementById("float");
  document.querySelector(".bar-more")?.remove();
  const out: string[] = [];
  const more = document.createElement("div");
  more.className = "bar-btn bar-more";
  more.setAttribute("role", "button");
  more.textContent = "…";
  const look = bar ? lookOf(bar) : null;
  const islands = !!look?.islands;
  const own = bar ? `a-${bar.slot}` : "";
  const W = window.innerWidth;
  const m = look?.margin ?? 0;
  for (let guard = 0; guard < 60; guard++) {
    // With islands the character is inside its area's island: that area always counts, the character not apart.
    const boxes = [...areas.filter((a) => a.childElementCount || (islands && a.id === own)), ...(float && !islands ? [float] : [])]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((b) => b.r.width > 0)
      .sort((a, b) => a.r.left - b.r.left);
    let clash: HTMLElement[] = [];
    for (let i = 0; i < boxes.length - 1 && !clash.length; i++) {
      // A little air between areas; the character's own area starts 6 px after it.
      if (boxes[i].r.right + 4 > boxes[i + 1].r.left) clash = [boxes[i].el, boxes[i + 1].el];
    }
    if (!clash.length) {
      const off = boxes.filter((b) => b.r.left < m + 2 || b.r.right > W - m - 2).map((b) => b.el);
      clash = off;
    }
    // The character's area keeps its elements longest; elsewhere the wider area gives first.
    const removable = (el: HTMLElement) => el !== float && !!el.querySelector(".bar-btn:not(.bar-more):not([data-key='strip'])");
    const victim = clash
      .filter(removable)
      .sort((a, b) => Number(a.id === own) - Number(b.id === own) || b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0]
      ?? clash.filter((el) => el !== float && el.querySelector(".bar-btn:not(.bar-more)"))[0];
    if (!victim) break;
    const kids = [...victim.querySelectorAll<HTMLElement>(".bar-btn:not(.bar-more)")];
    const kid = [...kids].reverse().find((k) => k.dataset.key !== "strip") ?? kids[kids.length - 1];
    if (!kid?.dataset.key) break;
    out.unshift(kid.dataset.key);
    kid.remove();
    if (!more.isConnected) document.getElementById("a-end")?.append(more);
  }
  more.title = `+${out.length}`;
  more.dataset.keys = JSON.stringify(out);
}

// A new width (another screen, another resolution): laid out again. The window
// growing past the band under the character is not one.
let laidWidth = 0;
window.addEventListener("resize", () => {
  if (!bar || window.innerWidth === laidWidth) return;
  laidWidth = window.innerWidth;
  laidItems = "";
  layBar();
});

// An element of the bar: the island opens its card or runs the action; a
// button of the strip answers (strip:btn:<i>).
document.addEventListener("click", (e) => {
  const target = e.target as HTMLElement | null;
  const btn = target?.closest?.(".bar-btn") as HTMLElement | null;
  if (btn?.classList.contains("bar-more")) {
    const keys: string[] = JSON.parse(btn.dataset.keys ?? "[]");
    const entries = keys.map((k) => [k, shown.find((p) => p.key === k)?.title ?? k]);
    void invoke("bar_overflow_menu", { entries }).catch(() => {});
    return;
  }
  if (!btn?.dataset.key) return;
  const sub = target?.closest?.("[data-btn]") as HTMLElement | null;
  const r = btn.getBoundingClientRect();
  send({ kind: "bar", key: sub ? `${btn.dataset.key}:btn:${sub.dataset.btn}` : btn.dataset.key, x: Math.round(r.left + r.width / 2) });
});

/** The bar element under an event, without «…» and the strip's own buttons. */
function barKey(e: Event): string | null {
  const btn = (e.target as HTMLElement | null)?.closest?.(".bar-btn") as HTMLElement | null;
  return btn && !btn.classList.contains("bar-more") ? btn.dataset.key ?? null : null;
}

// The right and middle buttons and the wheel on an element: what the user chose
// for it in Impostazioni (src/island/bar.ts → barAct); the page's own menu never shows.
document.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  const key = barKey(e);
  if (key) send({ kind: "bar", key, button: "right" });
});
document.addEventListener("auxclick", (e) => {
  const key = e.button === 1 ? barKey(e) : null;
  if (key) send({ kind: "bar", key, button: "middle" });
});
document.addEventListener("wheel", (e) => {
  const key = barKey(e);
  if (key && e.deltaY) send({ kind: "bar", key, button: e.deltaY < 0 ? "up" : "down" });
}, { passive: true });

// Beside the open island or in the fixed bar (the times the window takes the mouse):
// a click closes the island, or opens it from the bar.
canvas.addEventListener("click", () => {
  if (mode !== "open" && mode !== "bar") return;
  engine.squash();
  wake(600);
  send({ kind: "open" });
});

// Resized by Rust (rest icon ↔ compact badge): redraw at the new size.
window.addEventListener("resize", () => wake(400));

send({ kind: "hello" });
