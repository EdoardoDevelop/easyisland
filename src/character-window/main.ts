// The character's own window (docs/due-webview.md): the resting character, the
// compact one and the one beside the open island, drawn from what the island's
// page sends over the link. Over the rest icon or the compact badge, Rust lets
// every click through to the island; beside the open island a click closes it.

import "../character/roster";
import { character, setCharacter } from "../character/character";
import { BotEngine, hexToRGB } from "../character/engine";
import { setFigure, setFigureWeather } from "../character/figure";
import { setJarvisAgents } from "../character/jarvis";
import { Bridge } from "../core/bridge";
import { linkChannel, MIRRORED_CALLS, type CharacterMode, type CharacterToIsland, type IslandToCharacter } from "../core/link";

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

/** The canvas: a square around the rest icon, or the whole window (the compact canvas). */
function box(): { w: number; h: number } {
  if (mode === "compact" || mode === "open") return { w: window.innerWidth, h: window.innerHeight };
  const w = Math.round(size * 1.3);
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
  engine.particleOverhang = mode === "rest" ? 0 : OVERHANG;
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
  const ambient = (mode === "rest" || mode === "open") && character().animated === true;
  if (ambient && t > moveUntil) window.setTimeout(() => requestAnimationFrame(frame), AMBIENT_FRAME_MS);
  else if (!engine.busy || (t > moveUntil && mode !== "compact")) running = false;
  else if (!engine.busyBeyondLook) window.setTimeout(() => requestAnimationFrame(frame), LOOK_FRAME_MS);
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
  // As the island's rest icon (dimmed when paused); the compact character at full
  // strength. Beside the open island it has no badge under it: the rest icon's shadow.
  canvas.style.opacity = mode === "rest" ? (paused ? "0.4" : "0.9") : "1";
  canvas.style.filter = mode === "compact" ? "" : "drop-shadow(0 1px 2px rgba(0, 0, 0, 0.45))";
  canvas.style.cursor = mode === "open" ? "pointer" : "";
  // Alive for ever by CSS, except compact (the island moves it); the halo in its colour.
  document.body.classList.toggle("alive", mode === "rest" || mode === "open");
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
    void Bridge.log("due webview: il personaggio riceve dall'isola").catch(() => {});
  }
  switch (m.kind) {
    case "look":
      applyLook(m);
      break;
    case "gaze":
      engine.lookX = m.x;
      engine.lookY = m.y;
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

// Beside the open island (the only time the window takes the mouse): a click closes it.
canvas.addEventListener("click", () => {
  if (mode !== "open") return;
  engine.squash();
  wake(600);
  send({ kind: "open" });
});

// Resized by Rust (rest icon ↔ compact badge): redraw at the new size.
window.addEventListener("resize", () => wake(400));

send({ kind: "hello" });
