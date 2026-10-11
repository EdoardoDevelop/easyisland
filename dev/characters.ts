// Every character but the cube, on its own, without the island: the README
// picture (scripts/screenshots.mjs "characters"). npm run dev, then
// /dev/characters.html. The characters idle for a moment, then hold still
// (before the first blink) and the title says "scene ready".

import { BotEngine } from "../src/character/engine";
import "../src/character/roster";
import { characters, setCharacter } from "../src/character/character";

const SIZE = 160;
const dpr = 2;
const grid = document.getElementById("island")!;

const live = characters()
  .filter((c) => c.id !== "cube")
  .map((c) => {
    const canvas = document.createElement("canvas");
    canvas.width = SIZE * dpr;
    canvas.height = SIZE * dpr;
    canvas.style.width = `${SIZE}px`;
    canvas.style.height = `${SIZE}px`;
    const fig = document.createElement("figure");
    const cap = document.createElement("figcaption");
    cap.textContent = c.name;
    fig.append(canvas, cap);
    grid.append(fig);
    // The engine draws whichever character is current: each one is made current for its own engine.
    setCharacter(c.id);
    const engine = new BotEngine();
    engine.setState("idle", true);
    return { id: c.id, engine, ctx: canvas.getContext("2d")! };
  });

const start = performance.now();
let last = start;
function frame(t: number) {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  for (const { id, engine, ctx } of live) {
    setCharacter(id);
    engine.update(dt);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, SIZE, SIZE);
    engine.draw(ctx, SIZE, SIZE);
  }
  if (t - start < 1000) requestAnimationFrame(frame);
  else document.title = "scene ready";
}
requestAnimationFrame(frame);
