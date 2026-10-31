// The EasyIsland logo, alive (asked by Edoardo on 31 Oct 2026): the same
// bubble as mark.ts (rainbow stroke, dark inside, two white eyes, tail at the
// bottom left), drawn with vectors so it can move. mark.ts stays the source of
// the icons; the numbers here are its own, in the same 91 px picture.
//
// What moves:
// - the eyes blink every few seconds and now and then glance aside;
// - the bubble breathes a little;
// - "flow": the colours run slowly round the stroke;
// - states: working (colours faster, eyes reading), attention (a hop, eyes
//   wide), done (happy eyes);
// - the greeting: the stroke draws itself round, the tail pops out, the eyes
//   open and blink.
// Pure drawing on a 2D context: who calls it decides the frame rate.

export type LogoState = "idle" | "working" | "attention" | "done";

export interface LogoLook {
  /** Seconds since the logo started living (drives blinks, glances, breath). */
  t: number;
  state?: LogoState;
  /** The colours run round the stroke. */
  flow?: boolean;
  /** Eyes blink and glance. */
  eyes?: boolean;
  /** The bubble breathes. */
  breathe?: boolean;
  /** 0…1 of the greeting's draw-in; 1 (or missing) = the whole logo. */
  build?: number;
}

const BX = 49, BY = 40;
const HW = 34, HH = 27.5, RAD = 22;
/** The picture spans 76 units round (49, 45), as markAt's u, v. */
const SPAN = 76, MX = 49, MY = 45;

const STOPS: [number, [number, number, number]][] = [
  [0, [142, 10, 168]], [30, [224, 0, 200]], [60, [228, 0, 90]], [90, [232, 16, 26]],
  [120, [255, 48, 16]], [150, [255, 138, 29]], [185, [254, 208, 18]], [215, [150, 220, 40]],
  [240, [0, 229, 166]], [270, [26, 122, 208]], [300, [42, 40, 176]], [330, [74, 53, 216]], [360, [142, 10, 168]],
];

function hue(deg: number): string {
  const a = ((deg % 360) + 360) % 360;
  for (let i = 1; i < STOPS.length; i++) {
    const [a1, c1] = STOPS[i];
    const [a0, c0] = STOPS[i - 1];
    if (a <= a1) {
      const k = (a - a0) / (a1 - a0);
      return `rgb(${Math.round(c0[0] + (c1[0] - c0[0]) * k)},${Math.round(c0[1] + (c1[1] - c0[1]) * k)},${Math.round(c0[2] + (c1[2] - c0[2]) * k)})`;
    }
  }
  return "rgb(142,10,168)";
}

/** Points along the middle of the stroke, counter-clockwise from the gap's end round to its start. */
const ring = new Map<number, { x: number; y: number; a: number }[]>();
function strokePoints(band: number): { x: number; y: number; a: number }[] {
  const hit = ring.get(band);
  if (hit) return hit;
  const hw = HW - band / 2, hh = HH - band / 2, r = RAD - band / 2;
  // The rounded box's middle line, sampled evenly by length.
  const pts: { x: number; y: number }[] = [];
  const N = 360;
  for (let i = 0; i < N; i++) {
    // Walk by angle from the centre and push each ray to the box's edge.
    const ang = (i / N) * Math.PI * 2;
    const dx = Math.cos(ang), dy = -Math.sin(ang);
    // Binary search the distance where the rounded box's distance is 0.
    let lo = 0, hi = 60;
    for (let k = 0; k < 24; k++) {
      const m = (lo + hi) / 2;
      const qx = Math.abs(dx * m) - hw + r, qy = Math.abs(dy * m) - hh + r;
      const d = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
      if (d < 0) lo = m; else hi = m;
    }
    pts.push({ x: BX + dx * lo, y: BY + dy * lo });
  }
  // Counter-clockwise (as the hue is measured), starting just after the gap (236°) and ending at it (206°).
  const out: { x: number; y: number; a: number }[] = [];
  for (let i = 0; i <= N; i++) {
    const deg = 236 + (i / N) * (360 - 30);
    const p = pts[Math.round(((deg % 360) / 360) * N) % N];
    out.push({ x: p.x, y: p.y, a: deg % 360 });
  }
  ring.set(band, out);
  return out;
}

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const ease = (k: number) => 1 - Math.pow(1 - clamp(k), 3);
const back = (k: number) => {
  const c = 1.7;
  const x = clamp(k) - 1;
  return 1 + (c + 1) * x * x * x + c * x * x;
};

/** A smooth pseudo-random in 0…1 for slot n (same every run). */
function rnd(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

/** 0 open … 1 shut: blinks every 2.8–5 s, sometimes twice. */
function blink(t: number): number {
  let start = 1.2;
  for (let n = 0; n < 400; n++) {
    const gap = 2.8 + rnd(n) * 2.2;
    if (t < start) return 0;
    const into = t - start;
    const one = (k: number) => (k < 0 || k > 0.16 ? 0 : Math.sin((k / 0.16) * Math.PI));
    const v = Math.max(one(into), rnd(n + 50) > 0.7 ? one(into - 0.24) : 0);
    if (into < 0.5) return v;
    start += gap;
  }
  return 0;
}

/** Where the eyes look, in units: a glance aside now and then, back to the middle. */
function glance(t: number): { x: number; y: number } {
  const slot = Math.floor(t / 3.6);
  const into = t - slot * 3.6;
  if (rnd(slot + 900) < 0.45) return { x: 0, y: 0 };
  const dir = rnd(slot + 700) < 0.5 ? -1 : 1;
  const k = into < 0.3 ? ease(into / 0.3) : into < 1.6 ? 1 : into < 1.9 ? 1 - ease((into - 1.6) / 0.3) : 0;
  return { x: dir * 3 * k, y: (rnd(slot + 300) - 0.5) * 2 * k };
}

/**
 * Draws the logo `size` px wide centred on (cx, cy). `px` is the size in
 * device pixels (for the thicker small-icon stroke, as in the icons).
 */
export function drawLogo(x: CanvasRenderingContext2D, cx: number, cy: number, size: number, look: LogoLook) {
  const t = look.t;
  const state = look.state ?? "idle";
  const build = look.build ?? 1;
  const px = size * (x.getTransform().a || 1);
  const small = px <= 32;
  const band = small ? 12 : 9.5;

  // Greeting: stroke 0–0.45, inside 0.3–0.55, tail 0.5–0.68, eyes 0.62–0.85.
  const strokeK = ease(build / 0.45);
  const fillK = ease((build - 0.3) / 0.25);
  const tailK = back((build - 0.5) / 0.18);
  const eyesK = ease((build - 0.62) / 0.23);

  let scale = size / SPAN;
  let lift = 0;
  if (look.breathe !== false) scale *= 1 + 0.018 * Math.sin(t * 2.1);
  if (state === "attention") {
    const hop = (t * 1.6) % 1;
    lift = -Math.abs(Math.sin(hop * Math.PI)) * 7 * (hop < 0.5 ? 1 : 0);
  }

  x.save();
  x.translate(cx, cy);
  x.scale(scale, scale);
  x.translate(-MX, -MY + lift);

  // Inside: the dark bubble.
  if (fillK > 0) {
    x.save();
    x.globalAlpha = fillK;
    const k = 0.7 + 0.3 * fillK;
    x.translate(BX, BY);
    x.scale(k, k);
    x.translate(-BX, -BY);
    roundRect(x, BX - HW + band * 0.5, BY - HH + band * 0.5, (HW - band * 0.5) * 2, (HH - band * 0.5) * 2, RAD - band * 0.5);
    x.fillStyle = "#06060a";
    x.fill();
    x.restore();
  }

  // The rainbow stroke, segment by segment so the colours can run round it.
  const shift = look.flow === false ? 0 : t * (state === "working" ? 90 : 14);
  const pts = strokePoints(band);
  const last = Math.max(1, Math.round((pts.length - 1) * strokeK));
  x.lineWidth = band;
  x.lineCap = "butt";
  x.lineJoin = "round";
  for (let i = 1; i <= last; i++) {
    const a = pts[i - 1], b = pts[Math.min(i + 1, last)];
    x.beginPath();
    x.moveTo(a.x, a.y);
    x.lineTo(b.x, b.y);
    x.strokeStyle = hue(pts[i].a - shift);
    x.stroke();
  }
  // The pen's tip while the greeting draws it.
  if (strokeK > 0 && strokeK < 1) {
    const p = pts[last];
    x.beginPath();
    x.arc(p.x, p.y, band * 0.62, 0, Math.PI * 2);
    x.fillStyle = "#fff";
    x.globalAlpha = 0.85;
    x.fill();
    x.globalAlpha = 1;
  }

  // The tail, popping out from the bottom edge.
  if (tailK > 0) {
    const top = BY + HH - band;
    const wide = small ? 15 : 13;
    x.save();
    x.translate(30, top);
    x.scale(1, Math.max(0, tailK));
    x.translate(-30, -top);
    x.beginPath();
    x.moveTo(30, top);
    for (let i = 0; i <= 20; i++) {
      const k = i / 20;
      x.lineTo(30 + wide * Math.pow(1 - k, 1.25), top + (78 - top) * k);
    }
    x.lineTo(30, 78);
    x.closePath();
    x.fillStyle = hue(240 - shift);
    x.fill();
    x.restore();
  }

  // The eyes.
  if (eyesK > 0) {
    const big = small ? 1.25 : 1;
    const shut = look.eyes === false ? 0 : blink(t);
    // During the greeting: open from a line, then one blink at the end.
    const greetShut = build < 1 ? 1 - eyesK : 0;
    let open = 1 - Math.max(shut, greetShut) * 0.92;
    let g = look.eyes === false ? { x: 0, y: 0 } : glance(t);
    let wide = 1;
    if (state === "working") g = { x: 2.2, y: 2.4 + Math.sin(t * 3) * 0.6 };
    if (state === "attention") { wide = 1.18; g = { x: 0, y: -1 }; open = Math.max(open, 0.9); }
    x.fillStyle = "#fff";
    x.strokeStyle = "#fff";
    if (state === "done") {
      // Happy eyes: two little arches.
      x.lineWidth = 2.6 * big;
      x.lineCap = "round";
      for (const [ex, ey, rx] of [[42, 42, 7 * big], [63, 42, 4.6 * big]] as const) {
        x.beginPath();
        x.arc(ex, ey + rx * 0.35, rx * 0.85, Math.PI * 1.15, Math.PI * 1.85);
        x.stroke();
      }
    } else {
      for (const [ex, ey, rx, ry] of [[42, 41, 8 * big, 7.5 * big], [63, 41, 5 * big, 4.6 * big]] as const) {
        x.beginPath();
        x.ellipse(ex + g.x, ey + g.y, rx * wide, Math.max(0.6, ry * wide * open), 0, 0, Math.PI * 2);
        x.fill();
      }
    }
  }
  x.restore();
}

function roundRect(x: CanvasRenderingContext2D, l: number, t: number, w: number, h: number, r: number) {
  x.beginPath();
  x.moveTo(l + r, t);
  x.arcTo(l + w, t, l + w, t + h, r);
  x.arcTo(l + w, t + h, l, t + h, r);
  x.arcTo(l, t + h, l, t, r);
  x.arcTo(l, t, l + w, t, r);
  x.closePath();
}

/** The greeting's length, seconds: draw-in, then a blink and a little hop. */
export const LOGO_GREETING = 2.6;

/** The logo's greeting at time `t` (0…LOGO_GREETING): build, blink, hop. */
export function drawLogoGreeting(x: CanvasRenderingContext2D, cx: number, cy: number, size: number, t: number) {
  const build = clamp(t / 1.6);
  // After the build: a hop of joy (1.75–2.15 s).
  const hopK = clamp((t - 1.75) / 0.4);
  const hop = Math.sin(hopK * Math.PI) * size * 0.06;
  drawLogo(x, cx, cy - hop, size, { t: t < 1.6 ? 0 : t - 1.6 + 1.05, build, flow: true, eyes: true, breathe: false });
}
