// The character's own window (docs/due-webview.md, step 0): the character drawn
// from what the island's page sends over the link. A click opens the island;
// a right click hides or shows the island's window (the trial of step 0).

import "../character/roster";
import { setCharacter } from "../character/character";
import { BotEngine, hexToRGB } from "../character/engine";
import { setFigure } from "../character/figure";
import { Bridge } from "../core/bridge";
import { linkChannel, type CharacterToIsland, type IslandToCharacter } from "../core/link";

const SIZE = 64;
/** Only following a gaze: 30 fps, as in the island. */
const LOOK_FRAME_MS = 33;
/**
 * At rest the character is a still picture, like today's rest icon: after a
 * change it moves for this long, then the loop stops even for the characters
 * that move on their own (flame, Jarvis) or a state that loops (breathing).
 */
const MOVE_MS = 2500;
/** Between two small gestures at rest (blink, glance, a moment of its own motion). */
const GESTURE_MIN_MS = 4000;
const GESTURE_MAX_MS = 8000;

const canvas = document.getElementById("bot") as HTMLCanvasElement;
const engine = new BotEngine();
let running = false;
let last = performance.now();
let heard = false;
let moveUntil = 0;

function frame(t: number) {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (canvas.width !== Math.round(SIZE * dpr)) {
    canvas.width = Math.round(SIZE * dpr);
    canvas.height = Math.round(SIZE * dpr);
  }
  engine.update(dt);
  const ctx = canvas.getContext("2d");
  if (ctx) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);
    engine.draw(ctx, SIZE, SIZE);
  }
  // No frames once nothing moves, or once the change has played out.
  if (!engine.busy || t > moveUntil) running = false;
  else if (!engine.busyBeyondLook) window.setTimeout(() => requestAnimationFrame(frame), LOOK_FRAME_MS);
  else requestAnimationFrame(frame);
}

function wake(ms = MOVE_MS) {
  moveUntil = Math.max(moveUntil, performance.now() + ms);
  if (running) return;
  running = true;
  last = performance.now();
  requestAnimationFrame(frame);
}

const send = linkChannel<IslandToCharacter, CharacterToIsland>((m) => {
  if (!heard) {
    heard = true;
    void Bridge.log("prova due webview: il personaggio riceve dall'isola").catch(() => {});
  }
  if (m.kind === "look") {
    setCharacter(m.character);
    setFigure(m.figure);
    engine.bodyColor = m.color ? hexToRGB(m.color) : null;
    engine.setState(m.state, true);
    wake();
  } else if (m.kind === "pong") {
    void Bridge.log(`prova due webview: risposta dell'isola in ${Math.round(performance.now() - m.sent)} ms`).catch(() => {});
  }
});

canvas.addEventListener("click", () => {
  engine.triggerEmote("happy");
  wake();
  send({ kind: "open" });
});
canvas.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  void Bridge.islandWindowToggle();
  // Does the island's page still answer once its window is hidden?
  window.setTimeout(() => send({ kind: "ping", sent: performance.now() }), 1500);
});

/**
 * Alive at almost no cost: still most of the time, and every few seconds one
 * gesture of under a second (docs/due-webview.md, step 0). One timer, no frames
 * in between.
 */
function gesture() {
  const pick = Math.random();
  if (pick < 0.45) {
    engine.blink();
    wake(400);
  } else if (pick < 0.8) {
    // A glance aside, then back at the next gesture or two.
    const away = engine.lookX === 0 && engine.lookY === 0;
    engine.lookX = away ? (Math.random() * 2 - 1) * 0.6 : 0;
    engine.lookY = away ? (Math.random() * 2 - 1) * 0.3 : 0;
    wake(900);
  } else {
    // The characters that move on their own (flame, Jarvis) show it for a moment.
    wake(1200);
  }
  window.setTimeout(gesture, GESTURE_MIN_MS + Math.random() * (GESTURE_MAX_MS - GESTURE_MIN_MS));
}

send({ kind: "hello" });
wake();
window.setTimeout(gesture, GESTURE_MIN_MS);
