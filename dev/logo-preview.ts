// Preview of the animated logo (src/character/logo-anim.ts): variants, states,
// the fixed bar and the launch greeting, to choose before it goes in the app.

import { drawLogo, drawLogoGreeting, LOGO_GREETING, type LogoLook, type LogoState } from "../src/character/logo-anim";
import { drawFigure, setFigure } from "../src/character/figure";

const DPR = window.devicePixelRatio || 1;
type Draw = (x: CanvasRenderingContext2D, w: number, h: number, t: number) => void;
const live: { c: HTMLCanvasElement; w: number; h: number; draw: Draw }[] = [];

function canvas(w: number, h: number, cls = "island"): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = Math.round(w * DPR);
  c.height = Math.round(h * DPR);
  c.style.width = `${w}px`;
  c.style.height = `${h}px`;
  if (cls) c.className = cls;
  return c;
}

function fig(parent: HTMLElement, w: number, h: number, caption: string, draw: Draw, cls = "island") {
  const f = document.createElement("figure");
  const c = canvas(w, h, cls);
  const cap = document.createElement("figcaption");
  cap.textContent = caption;
  f.append(c, cap);
  parent.append(f);
  live.push({ c, w, h, draw });
}

/** Today's still logo (figure.ts), `size` px wide, centred in the box. */
function still(x: CanvasRenderingContext2D, w: number, h: number, size: number) {
  setFigure("easyisland");
  const box = size / 0.8;
  x.save();
  x.translate((w - box) / 2, (h - box) / 2);
  drawFigure(x, box, box);
  x.restore();
}

const VARIANTS: { name: string; look: Omit<LogoLook, "t"> | null }[] = [
  { name: "A · fermo (oggi)", look: null },
  { name: "B · occhi e respiro", look: { flow: false, eyes: true, breathe: true } },
  { name: "C · occhi, respiro e colori", look: { flow: true, eyes: true, breathe: true } },
];

const variants = document.getElementById("variants")!;
for (const v of VARIANTS) {
  for (const size of [58, 120]) {
    const look = v.look;
    fig(variants, size + 40, size + 40, `${v.name} · ${size} px`, look
      ? (x, w, h, t) => drawLogo(x, w / 2, h / 2, size, { ...look, t })
      : (x, w, h) => still(x, w, h, size));
  }
}

const states = document.getElementById("states")!;
const STATES: [LogoState, string][] = [["idle", "a riposo"], ["working", "lavora"], ["attention", "serve una risposta"], ["done", "ha finito"]];
for (const [state, label] of STATES) {
  fig(states, 130, 130, label, (x, w, h, t) => drawLogo(x, w / 2, h / 2, 76, { t, state, flow: true }));
}

const bars = document.getElementById("bars")!;
for (const v of VARIANTS) {
  const row = document.createElement("div");
  row.className = "row";
  row.style.marginBottom = "10px";
  const bar = document.createElement("div");
  bar.className = "bar";
  bar.style.width = "560px";
  const c = canvas(26, 26, "");
  const grow = document.createElement("span");
  grow.className = "grow";
  const grow2 = document.createElement("span");
  grow2.className = "grow";
  const clock = document.createElement("span");
  clock.textContent = "Ven 31 ott · 18:42";
  const left = document.createElement("span");
  left.textContent = "Outlook — Posta in arrivo";
  bar.append(left, grow, c, grow2, clock);
  const cap = document.createElement("span");
  cap.style.color = "#999";
  cap.textContent = v.name;
  row.append(bar, cap);
  bars.append(row);
  const look = v.look;
  live.push({ c, w: 26, h: 26, draw: look
    ? (x, w, h, t) => drawLogo(x, w / 2, h / 2, 20, { ...look, t })
    : (x, w, h) => still(x, w, h, 20) });
}

const compare = document.getElementById("compare")!;
for (const size of [16, 24, 40, 80]) {
  fig(compare, size + 24, size + 24, `oggi · ${size} px`, (x, w, h) => still(x, w, h, size));
  fig(compare, size + 24, size + 24, `animato · ${size} px`, (x, w, h, t) => drawLogo(x, w / 2, h / 2, size, { t, flow: true }));
}

// The greeting, replayed on demand and again a few seconds after it ends.
let greetAt = performance.now();
const greet = document.getElementById("greet") as HTMLCanvasElement;
const greetBig = document.getElementById("greet-big") as HTMLCanvasElement;
for (const c of [greet, greetBig]) {
  const w = c.width, h = c.height;
  c.width = w * DPR; c.height = h * DPR; c.style.width = `${w}px`; c.style.height = `${h}px`;
}
const greetDraw = (c: HTMLCanvasElement, size: number, t: number) => {
  const x = c.getContext("2d")!;
  const w = c.width / DPR, h = c.height / DPR;
  x.setTransform(DPR, 0, 0, DPR, 0, 0);
  x.clearRect(0, 0, w, h);
  if (t <= LOGO_GREETING) drawLogoGreeting(x, w / 2, h / 2, size, t);
  else drawLogo(x, w / 2, h / 2, size, { t: t - LOGO_GREETING + 2, flow: true });
};
document.getElementById("replay")!.addEventListener("click", () => { greetAt = performance.now(); });
document.getElementById("theme")!.addEventListener("click", () => document.body.classList.toggle("light"));

const t0 = performance.now();
function frame(now: number) {
  const t = (now - t0) / 1000;
  for (const l of live) {
    const x = l.c.getContext("2d")!;
    x.setTransform(DPR, 0, 0, DPR, 0, 0);
    x.clearRect(0, 0, l.w, l.h);
    l.draw(x, l.w, l.h, t);
  }
  let g = (now - greetAt) / 1000;
  if (g > LOGO_GREETING + 4) { greetAt = now; g = 0; }
  greetDraw(greet, 110, g);
  greetDraw(greetBig, 190, g);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
document.title = "scene ready";
