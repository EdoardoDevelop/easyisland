// The picture of an empty chat (Impostazioni → Chat → «Chat vuota», asked by
// Edoardo on 8 Nov 2026): a new conversation without messages left a big
// empty card. A quiet drawing fills it, drawn here on a canvas behind the
// conversation: Ezzy (the logo, default), a dotted island globe turning, a
// sea of dots, a starry sky, an aurora, a drifting network, or nothing.
//
// Cost: at most 20 frames a second, and none while the chat is not on screen
// (hidden view, retracted island, page in the background) or has messages.
// With Windows' «reduce animations» one still frame. Colours come from the
// chat's own tokens (chat-cards.css), so it follows light and dark.

import { drawLogo } from "../character/logo-anim";

export type EmptyArt = "ezzy" | "isola" | "onde" | "stelle" | "aurora" | "rete" | "nessuna";

export const EMPTY_ARTS: EmptyArt[] = ["ezzy", "isola", "onde", "stelle", "aurora", "rete", "nessuna"];

export function emptyArt(v: string | undefined): EmptyArt {
  return (EMPTY_ARTS as string[]).includes(v ?? "") ? (v as EmptyArt) : "ezzy";
}

const FRAME_MS = 50;

/** A small fixed random sequence: the same sky and network at every redraw. */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

interface Palette {
  ink: string;
  dim: string;
  faint: string;
  accent: string;
  light: boolean;
}

/** The canvas behind the empty conversation, and its animation. */
export class ChatEmpty {
  readonly el: HTMLCanvasElement;
  private kind: EmptyArt | null = null;
  private raf = 0;
  private last = 0;
  private start = performance.now();
  private pal: Palette | null = null;
  private palKey = "";

  constructor() {
    this.el = document.createElement("canvas");
    this.el.className = "chat-empty";
    this.el.setAttribute("aria-hidden", "true");
    this.el.style.display = "none";
  }

  /** What to draw now (null: nothing, the chat has messages). Called at every sync of the chat. */
  show(kind: EmptyArt | null): void {
    const k = kind === "nessuna" ? null : kind;
    if (k !== this.kind) {
      this.kind = k;
      this.el.style.display = k ? "" : "none";
      this.start = performance.now();
    }
    if (k) this.wake();
  }

  private win(): Window {
    return this.el.ownerDocument.defaultView ?? window;
  }

  private visible(): boolean {
    return !!this.kind && this.el.isConnected && this.el.clientWidth > 0 && this.el.clientHeight > 0 && !this.el.ownerDocument.hidden;
  }

  /** Starts the frames if they are not running (a sync after the chat came back into view restarts them). */
  private wake(): void {
    if (this.raf) return;
    const w = this.win();
    const step = (now: number) => {
      this.raf = 0;
      if (!this.visible()) return;
      const calm = w.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (now - this.last >= FRAME_MS || !this.last) {
        this.last = now;
        this.draw(calm ? 4 : (now - this.start) / 1000);
      }
      if (!calm) this.raf = w.requestAnimationFrame(step);
    };
    this.raf = w.requestAnimationFrame(step);
  }

  private palette(): Palette {
    const doc = this.el.ownerDocument;
    const key = `${doc.documentElement.dataset.scheme}|${doc.documentElement.style.getPropertyValue("--win-accent")}`;
    if (this.pal && key === this.palKey) return this.pal;
    const cs = getComputedStyle(this.el);
    const v = (n: string, d: string) => cs.getPropertyValue(n).trim() || d;
    const light = doc.documentElement.dataset.scheme === "light";
    this.pal = {
      ink: v("--cc-reply", light ? "#464a52" : "#c9cbd0"),
      dim: v("--cc-dim", "#8f939b"),
      faint: v("--cc-faint", "#6f737a"),
      accent: v("--win-accent", "#4cc2ff"),
      light,
    };
    this.palKey = key;
    return this.pal;
  }

  private draw(t: number): void {
    const w = this.win();
    const dpr = w.devicePixelRatio || 1;
    const cw = this.el.clientWidth;
    const ch = this.el.clientHeight;
    const pw = Math.round(cw * dpr);
    const ph = Math.round(ch * dpr);
    if (this.el.width !== pw || this.el.height !== ph) {
      this.el.width = pw;
      this.el.height = ph;
    }
    const x = this.el.getContext("2d");
    if (!x) return;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    x.clearRect(0, 0, cw, ch);
    const p = this.palette();
    switch (this.kind) {
      case "ezzy": ezzy(x, cw, ch, t, p); break;
      case "isola": globe(x, cw, ch, t, p); break;
      case "onde": waves(x, cw, ch, t, p); break;
      case "stelle": stars(x, cw, ch, t, p); break;
      case "aurora": aurora(x, cw, ch, t, p); break;
      case "rete": network(x, cw, ch, t, p); break;
    }
  }
}

// ── The drawings ──────────────────────────────────────────────────────────────

/** Ezzy floating in the middle, faint, breathing and blinking, a soft shadow under it. */
function ezzy(x: CanvasRenderingContext2D, w: number, h: number, t: number, p: Palette) {
  const size = Math.max(48, Math.min(92, h * 0.26, w * 0.22));
  const cx = w / 2;
  const cy = h * 0.42;
  const bob = Math.sin(t * 1.3) * size * 0.05;
  x.save();
  x.globalAlpha = 0.16;
  x.fillStyle = "#000";
  x.beginPath();
  const sh = 1 - (bob / (size * 0.05)) * 0.12;
  x.ellipse(cx, cy + size * 0.62, size * 0.36 * sh, size * 0.07 * sh, 0, 0, Math.PI * 2);
  x.fill();
  x.restore();
  x.save();
  x.globalAlpha = p.light ? 0.85 : 0.7;
  drawLogo(x, cx, cy + bob, size, { t, flow: true, eyes: true, breathe: true });
  x.restore();
}

/** A dotted globe with a few islands, turning slowly. */
const GLOBE_POINTS = (() => {
  const n = 520;
  const pts: { lat: number; lon: number }[] = [];
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    pts.push({ lat: Math.asin(y), lon: (i * g) % (Math.PI * 2) });
  }
  return pts;
})();
/** The islands: centre (lon, lat) and radius, in radians. */
const ISLANDS: [number, number, number][] = [
  [0.4, 0.35, 0.42], [0.9, 0.1, 0.22], [2.3, -0.25, 0.5], [2.9, 0.45, 0.2], [4.1, 0.05, 0.36], [4.6, -0.5, 0.18], [5.5, 0.6, 0.26],
];
function land(lat: number, lon: number): boolean {
  for (const [ilon, ilat, r] of ISLANDS) {
    // Great-circle distance.
    const d = Math.acos(Math.min(1, Math.sin(lat) * Math.sin(ilat) + Math.cos(lat) * Math.cos(ilat) * Math.cos(lon - ilon)));
    if (d < r) return true;
  }
  return false;
}
const GLOBE_LAND = GLOBE_POINTS.map((q) => land(q.lat, q.lon));

function globe(x: CanvasRenderingContext2D, w: number, h: number, t: number, p: Palette) {
  const r = Math.max(50, Math.min(w * 0.26, h * 0.34));
  const cx = w / 2;
  const cy = h * 0.44;
  const spin = t * 0.18;
  const tilt = 0.32;
  const ct = Math.cos(tilt), st = Math.sin(tilt);
  for (let i = 0; i < GLOBE_POINTS.length; i++) {
    const q = GLOBE_POINTS[i];
    const lon = q.lon + spin;
    let X = Math.cos(q.lat) * Math.sin(lon);
    let Y = Math.sin(q.lat);
    let Z = Math.cos(q.lat) * Math.cos(lon);
    // Tilted towards the viewer.
    const y2 = Y * ct - Z * st;
    const z2 = Y * st + Z * ct;
    Y = y2;
    Z = z2;
    if (Z < -0.05) continue;
    const isLand = GLOBE_LAND[i];
    const depth = 0.35 + 0.65 * Math.max(0, Z);
    x.globalAlpha = (isLand ? 0.8 : 0.32) * depth;
    x.fillStyle = isLand ? p.ink : p.faint;
    const s = (isLand ? 1.7 : 1.1) * (0.6 + 0.4 * depth);
    x.beginPath();
    x.arc(cx + X * r, cy - Y * r, s, 0, Math.PI * 2);
    x.fill();
  }
  // The rim, barely there.
  x.globalAlpha = 0.12;
  x.strokeStyle = p.faint;
  x.lineWidth = 1;
  x.beginPath();
  x.arc(cx, cy, r + 3, 0, Math.PI * 2);
  x.stroke();
  x.globalAlpha = 1;
}

/** A sea of dots in the lower part, rising and falling in slow waves. */
function waves(x: CanvasRenderingContext2D, w: number, h: number, t: number, p: Palette) {
  const gap = 18;
  const rows = Math.ceil((h * 0.55) / gap);
  const top = h - rows * gap;
  x.fillStyle = p.dim;
  for (let j = 0; j < rows; j++) {
    const k = (j + 1) / rows; // 0 far … 1 near
    for (let i = -1; i <= w / gap + 1; i++) {
      const px = i * gap + (j % 2) * (gap / 2);
      const wave = Math.sin(px * 0.018 + t * 0.9 + j * 0.55) + 0.5 * Math.sin(px * 0.041 - t * 0.6 + j * 0.3);
      const py = top + j * gap + wave * 4 * (0.4 + k);
      x.globalAlpha = 0.06 + 0.32 * k * (0.75 + 0.25 * wave);
      x.beginPath();
      x.arc(px, py, 0.7 + 0.9 * k, 0, Math.PI * 2);
      x.fill();
    }
  }
  x.globalAlpha = 1;
}

/** A sky of still stars that twinkle, and now and then a shooting star. */
function stars(x: CanvasRenderingContext2D, w: number, h: number, t: number, p: Palette) {
  const rnd = seeded(7);
  const n = Math.round(Math.min(110, (w * h) / 5200));
  x.fillStyle = p.ink;
  for (let i = 0; i < n; i++) {
    const sx = rnd() * w;
    const sy = rnd() * h * 0.85;
    const size = 0.5 + rnd() * 1.3;
    const speed = 0.4 + rnd() * 1.2;
    const phase = rnd() * 6.3;
    x.globalAlpha = 0.12 + 0.4 * (0.5 + 0.5 * Math.sin(t * speed + phase)) * (size / 1.8);
    x.beginPath();
    x.arc(sx, sy, size, 0, Math.PI * 2);
    x.fill();
  }
  // A shooting star every 11 s, crossing in 1.2 s.
  const cycle = t % 11;
  if (cycle < 1.2) {
    const k = cycle / 1.2;
    const n0 = Math.floor(t / 11);
    const r2 = seeded(100 + n0);
    const sx = w * (0.15 + r2() * 0.5);
    const sy = h * (0.08 + r2() * 0.25);
    const len = Math.min(w, h) * 0.35;
    const hx = sx + len * k;
    const hy = sy + len * 0.45 * k;
    const g = x.createLinearGradient(hx - 60, hy - 27, hx, hy);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, p.ink);
    x.globalAlpha = 0.5 * Math.sin(k * Math.PI);
    x.strokeStyle = g;
    x.lineWidth = 1.2;
    x.beginPath();
    x.moveTo(hx - 60, hy - 27);
    x.lineTo(hx, hy);
    x.stroke();
  }
  x.globalAlpha = 1;
}

/** Soft bands of colour, waving slowly at the top. */
function aurora(x: CanvasRenderingContext2D, w: number, h: number, t: number, p: Palette) {
  const bands: [string, number, number, number][] = [
    [p.accent, 0.3, 0.7, 0],
    ["#8b5cf6", 0.38, 0.5, 2.1],
    ["#14b8a6", 0.46, 0.6, 4.2],
  ];
  x.save();
  x.globalCompositeOperation = p.light ? "multiply" : "screen";
  for (const [color, base, speed, phase] of bands) {
    // Many wide, very light strokes: a soft band without edges.
    for (let layer = 0; layer < 7; layer++) {
      x.globalAlpha = p.light ? 0.022 : 0.03;
      x.strokeStyle = color;
      x.lineWidth = 90 - layer * 12;
      x.lineCap = "round";
      x.beginPath();
      for (let px = -40; px <= w + 40; px += 16) {
        const py = h * base
          + Math.sin(px * 0.006 + t * speed * 0.5 + phase) * h * 0.06
          + Math.sin(px * 0.013 - t * speed * 0.3 + phase * 2) * h * 0.025;
        if (px === -40) x.moveTo(px, py);
        else x.lineTo(px, py);
      }
      x.stroke();
    }
  }
  x.restore();
}

/** Points drifting slowly, joined by thin lines when they come near. */
function network(x: CanvasRenderingContext2D, w: number, h: number, t: number, p: Palette) {
  const rnd = seeded(23);
  const n = Math.round(Math.max(14, Math.min(34, (w * h) / 11000)));
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const bx = rnd() * w, by = rnd() * h * 0.85;
    const ax = 18 + rnd() * 30, ay = 14 + rnd() * 24;
    const sx = 0.08 + rnd() * 0.12, sy = 0.07 + rnd() * 0.1;
    const ph = rnd() * 6.3;
    pts.push([bx + Math.sin(t * sx + ph) * ax, by + Math.cos(t * sy + ph * 1.3) * ay]);
  }
  const reach = Math.max(90, Math.min(150, w * 0.18));
  x.strokeStyle = p.faint;
  x.lineWidth = 1;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(pts[i][0] - pts[j][0], pts[i][1] - pts[j][1]);
      if (d > reach) continue;
      x.globalAlpha = 0.28 * (1 - d / reach);
      x.beginPath();
      x.moveTo(pts[i][0], pts[i][1]);
      x.lineTo(pts[j][0], pts[j][1]);
      x.stroke();
    }
  }
  x.fillStyle = p.dim;
  for (const [px, py] of pts) {
    x.globalAlpha = 0.45;
    x.beginPath();
    x.arc(px, py, 1.6, 0, Math.PI * 2);
    x.fill();
  }
  x.globalAlpha = 1;
}
