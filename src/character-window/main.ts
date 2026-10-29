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
  const dpr = Math.min(2, window.devicePixelRatio || 1);
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

/**
 * The fixed bar: the band in the island's colour, the character in its area
 * (start, centre or end) in a square as tall as the band.
 */
function layBar() {
  const float = document.getElementById("float");
  if (!float) return;
  document.body.style.background = bar ? bar.background : "transparent";
  document.body.classList.toggle("bar", !!bar);
  if (!bar) {
    float.style.cssText = "";
    return;
  }
  const t = bar.thickness;
  const left = bar.slot === "start" ? "8px" : bar.slot === "end" ? `calc(100% - ${t + 8}px)` : `calc(50% - ${t / 2}px)`;
  float.style.cssText = `inset: auto; top: 0; left: ${left}; width: ${t}px; height: 100%;`;
  document.body.style.setProperty("--ink", bar.ink);
  layAreas(bar);
}

/**
 * The three areas: from the left edge, around the middle, from the right edge.
 * In the character's area the elements come right after it.
 */
function layAreas(b: BarLook) {
  const beside = b.thickness + 8 + 6;
  const areas = { start: document.getElementById("a-start"), center: document.getElementById("a-center"), end: document.getElementById("a-end") };
  if (areas.start) areas.start.style.cssText = `left: ${b.slot === "start" ? beside : 8}px;`;
  if (areas.end) areas.end.style.cssText = `right: ${b.slot === "end" ? beside : 8}px;`;
  if (areas.center) {
    areas.center.style.cssText = b.slot === "center"
      ? `left: calc(50% + ${b.thickness / 2 + 6}px);`
      : "left: 50%; transform: translateX(-50%);";
  }
  const key = JSON.stringify(b.items);
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
  const W = window.innerWidth;
  for (let guard = 0; guard < 60; guard++) {
    const boxes = [...areas.filter((a) => a.childElementCount), ...(float ? [float] : [])]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter((b) => b.r.width > 0)
      .sort((a, b) => a.r.left - b.r.left);
    let clash: HTMLElement[] = [];
    for (let i = 0; i < boxes.length - 1 && !clash.length; i++) {
      // A little air between areas; the character's own area starts 6 px after it.
      if (boxes[i].r.right + 4 > boxes[i + 1].r.left) clash = [boxes[i].el, boxes[i + 1].el];
    }
    if (!clash.length) {
      const off = boxes.filter((b) => b.r.left < 2 || b.r.right > W - 2).map((b) => b.el);
      clash = off;
    }
    // The character's area keeps its elements longest; elsewhere the wider area gives first.
    const own = bar ? `a-${bar.slot}` : "";
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

window.addEventListener("resize", () => {
  if (!bar) return;
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
  send({ kind: "bar", key: sub ? `${btn.dataset.key}:btn:${sub.dataset.btn}` : btn.dataset.key });
});

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
