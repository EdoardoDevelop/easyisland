// Every state and emote of the character side by side, plus the greeting.
// npm run dev, then /dev/character-preview.html (?character=cube, ?character=drop…).

import { BotEngine, hexToRGB } from "../src/character/engine";
import "../src/character/roster";
import { setCharacter } from "../src/character/character";
import { Greeting } from "../src/character/greeting";
import type { BotEmoteName, BotStateName } from "../src/core/layout";
import type { Sky } from "../src/character/weather";

const params = new URLSearchParams(location.search);
setCharacter(params.get("character") ?? undefined);

const STATES: BotStateName[] = [
  "idle", "working", "thinking", "searching", "approval", "question",
  "error", "finished", "ratelimit", "sleeping", "dizzy",
];
const EMOTES: BotEmoteName[] = ["love", "surprised", "proud", "wink", "yawn", "happy", "annoyed"];

const live: { engine: BotEngine; ctx: CanvasRenderingContext2D; size: number }[] = [];
const dpr = Math.min(2, window.devicePixelRatio || 1);

function add(row: string, label: string, size: number, setup: (e: BotEngine) => void, light = false) {
  const fig = document.createElement("figure");
  if (light) fig.className = "light";
  const canvas = document.createElement("canvas");
  canvas.width = size * dpr;
  canvas.height = size * dpr;
  canvas.style.width = `${size}px`;
  canvas.style.height = `${size}px`;
  const cap = document.createElement("figcaption");
  cap.textContent = label;
  fig.append(canvas, cap);
  document.getElementById(row)!.append(fig);
  const engine = new BotEngine();
  setup(engine);
  const ctx = canvas.getContext("2d")!;
  live.push({ engine, ctx, size });
  // Click: a slap. Drag: carry it around (the jelly wobbles).
  canvas.addEventListener("click", () => engine.slap());
  canvas.addEventListener("pointermove", (e) => { if (e.buttons) engine.jiggle(e.movementX, e.movementY); });
}

add("big", "idle", 380, (e) => e.setState("idle", true));
add("big", "working", 380, (e) => e.setState("working", true));
add("big", "idle (chiaro)", 380, (e) => e.setState("idle", true), true);
for (const s of STATES) add("states", s, 120, (e) => e.setState(s, true));
add("states", "idle (chiaro)", 120, (e) => e.setState("idle", true), true);
add("states", "tema #e86a6a", 120, (e) => { e.bodyColor = hexToRGB("#e86a6a"); e.setState("idle", true); });
for (const em of EMOTES) {
  add("emotes", em, 120, (e) => {
    e.setState("idle", true);
    const loop = () => { e.triggerEmote(em, 1.8); setTimeout(loop, 2600); };
    loop();
  });
}
const SKIES: Sky[] = ["sun", "moon", "sun-cloud", "moon-cloud", "cloud", "fog", "drizzle", "rain", "snow", "storm"];
for (const sky of SKIES) add("skies", sky, 120, (e) => { e.setState("idle", true); e.sky = sky; });
add("skies", "rain + working", 120, (e) => { e.setState("working", true); e.sky = "rain"; });
for (const [c, s] of [["#3E86E0", "working"], ["#EFAE5A", "approval"], ["#8C73F2", "finished"], ["#E86A6A", "error"]] as const) {
  add("minis", `mini ${s}`, 46, (e) => { e.isMini = true; e.bodyColor = hexToRGB(c); e.setState(s, true); });
}
add("minis", "saluto", 120, (e) => { e.setState("idle", true); const loop = () => { e.greet(); setTimeout(loop, 3000); }; loop(); });

(window as unknown as { live: typeof live }).live = live; // for poking from the console

const greet = new Greeting();
const gctx = (document.getElementById("greet") as HTMLCanvasElement).getContext("2d")!;
greet.start();
setInterval(() => greet.start(), 6000);

let last = performance.now();
function frame(t: number) {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  for (const { engine, ctx, size } of live) {
    engine.update(dt);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    engine.draw(ctx, size, size);
  }
  greet.draw(gctx);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
