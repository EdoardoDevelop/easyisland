// What sits in the island in place of the character (Impostazioni → Tema →
// «Nell'isola», asked by Edoardo on 24 Oct 2026 to make the app look more
// professional with a company logo): the character, the EasyIsland logo, the
// user's own PNG (logo.rs) or the weather. Anything but the character is a
// still picture: no animation, no states, no badges, no launch greeting — the
// engine draws it instead of the body and asks for no frames.

import { markAt } from "./mark";
import { drawSky, type Sky } from "./weather";

export type FigureKind = "character" | "easyisland" | "logo" | "weather";

let kind: FigureKind = "character";
let logo: HTMLImageElement | null = null;
let logoUrl = "";
let weather: { sky: Sky | null; temp: string } = { sky: null, temp: "" };
/** Called when something drawn changed (the logo finished loading). */
let onChange: (() => void) | null = null;

export function setFigure(k: string | undefined) {
  kind = k === "easyisland" || k === "logo" || k === "weather" ? k : "character";
}

export function figureKind(): FigureKind {
  return kind;
}

/** True when the island shows a still picture instead of the character. */
export function staticFigure(): boolean {
  return kind !== "character";
}

export function onFigureChange(fn: () => void) {
  onChange = fn;
}

/** The user's PNG as a data: URL, or "" for none (the EasyIsland logo stands in). */
export function setFigureLogo(url: string) {
  if (url === logoUrl) return;
  logoUrl = url;
  logo = null;
  if (!url) return;
  const img = new Image();
  img.onload = () => {
    if (logoUrl !== url) return;
    logo = img;
    onChange?.();
  };
  img.src = url;
}

/** The Meteo reading; `temp` like "18°". */
export function setFigureWeather(sky: Sky | null, temp: string) {
  if (weather.sky === sky && weather.temp === temp) return;
  weather = { sky, temp };
  if (kind === "weather") onChange?.();
}

/** A key that changes whenever the picture does (the rest icon redraws on it). */
export function figureKey(): string {
  return `${kind}|${logoUrl.length}|${logo ? 1 : 0}|${weather.sky}|${weather.temp}`;
}

/** Draws the picture centred in a W×H box whose middle is at `cy`. */
export function drawFigure(x: CanvasRenderingContext2D, W: number, H: number, cy = H / 2) {
  const side = Math.min(W, H);
  if (kind === "logo" && logo) {
    const box = side * 0.8;
    const s = Math.min(box / logo.naturalWidth, box / logo.naturalHeight);
    const w = logo.naturalWidth * s;
    const hh = logo.naturalHeight * s;
    x.imageSmoothingQuality = "high";
    x.drawImage(logo, W / 2 - w / 2, cy - hh / 2, w, hh);
    return;
  }
  if (kind === "weather") {
    drawWeather(x, W, side, cy);
    return;
  }
  drawMark(x, W / 2, cy, side * 0.8);
}

/** The app's icon (mark.ts, as in the icons): a still picture, rasterised once per size. */
const marks = new Map<number, HTMLCanvasElement>();
function mark(px: number): HTMLCanvasElement {
  const hit = marks.get(px);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = c.height = px;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const img = ctx.createImageData(px, px);
  const SS = 3;
  for (let y = 0; y < px; y++) {
    for (let x = 0; x < px; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let j = 0; j < SS; j++) {
        for (let i = 0; i < SS; i++) {
          const m = markAt(((x + (i + 0.5) / SS) / px) * 2 - 1, ((y + (j + 0.5) / SS) / px) * 2 - 1, px);
          if (!m) continue;
          r += m[0]; g += m[1]; b += m[2]; n++;
        }
      }
      if (!n) continue;
      const o = (y * px + x) * 4;
      img.data[o] = r / n; img.data[o + 1] = g / n; img.data[o + 2] = b / n;
      img.data[o + 3] = (n / (SS * SS)) * 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  marks.set(px, c);
  return c;
}

function drawMark(x: CanvasRenderingContext2D, cx: number, cy: number, size: number) {
  const scale = x.getTransform().a || 1;
  const px = Math.max(8, Math.round(size * scale));
  x.imageSmoothingQuality = "high";
  x.drawImage(mark(px), cx - size / 2, cy - size / 2, size, size);
}

function drawWeather(x: CanvasRenderingContext2D, W: number, side: number, cy: number) {
  const sky = weather.sky ?? "cloud";
  const temp = weather.temp || "—";
  // drawSky's small sign sits right of and above the point it is given: undo that
  // so the sky is centred over the temperature. Still picture: time stays at 0.
  const unit = side * 0.5;
  const skyY = cy - side * 0.2;
  x.save();
  if (!weather.sky) x.globalAlpha = 0.5;
  drawSky(x, sky, unit, W / 2 - unit * 0.32, skyY + unit * 0.36, 0, false);
  x.restore();
  x.save();
  x.font = `600 ${Math.round(side * 0.36)}px "Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif`;
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillStyle = "#ffffff";
  x.shadowColor = "rgba(0,0,0,0.45)";
  x.shadowBlur = side * 0.04;
  x.fillText(temp, W / 2, cy + side * 0.28);
  x.restore();
}
