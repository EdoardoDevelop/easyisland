// The launch greeting without the island: only the character, its halo and the
// particles, on the bare desktop colour. npm run dev, then /dev/greeting-preview.html
// (?character=slime, ?character=cube).

import "../src/character/roster";
import { setCharacter } from "../src/character/character";
import { Greeting, GREETING_END } from "../src/character/greeting";

const params = new URLSearchParams(location.search);
const pick = document.getElementById("character") as HTMLSelectElement;
pick.value = params.get("character") ?? "drop";
setCharacter(pick.value);
pick.addEventListener("change", () => {
  params.set("character", pick.value);
  location.search = params.toString();
});

// The greeting is laid out in 640×150; the bare one gets room around it for the
// particle rings, which the card used to clip.
const W = 820;
const H = 360;
const OX = (W - 640) / 2;
const OY = (H - 150) / 2;
const canvas = document.getElementById("greet") as HTMLCanvasElement;
// Fits a narrow window; the drawing scales with it.
let fit = 1;
let dpr = 1;
const size = () => {
  fit = Math.min(1, (window.innerWidth - 32) / W);
  dpr = Math.min(2, window.devicePixelRatio || 1) * fit;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = `${W * fit}px`;
  canvas.style.height = `${H * fit}px`;
};
size();
window.addEventListener("resize", size);
const ctx = canvas.getContext("2d")!;

const greeting = new Greeting();
greeting.bare = true;
greeting.start();

const loop = document.getElementById("loop") as HTMLInputElement;
document.getElementById("again")!.addEventListener("click", () => greeting.start());

const frame = () => {
  // A short pause on the last pose, then again.
  if (loop.checked && greeting.elapsed > GREETING_END + 1.2) greeting.start();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.translate(OX, OY);
  greeting.draw(ctx);
  requestAnimationFrame(frame);
};
requestAnimationFrame(frame);
