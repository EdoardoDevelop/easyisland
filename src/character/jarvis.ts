// Jarvis (asked by Edoardo on 25 Oct 2026): an assistant's HUD instead of a
// creature — a glowing core inside rings that never stop turning. No eyes,
// hands or jelly: it speaks through rhythm and colour. It wears the theme's
// colour (or the focused integration's) and leans towards the state's.
//
// Its own functions, all drawn here from what the engine hands over:
//   - the state sets the rhythm: calm rotation at rest, fast rings and a
//     voice-like wave while working or thinking, a scanning beam while
//     searching, an amber pulse waiting for the user, a red glitch on an
//     error, a green ripple when done, a slow dim breath asleep;
//   - one satellite in orbit for every agent at work (setJarvisAgents);
//   - the rings assemble one after the other when it starts (boot);
//   - the outer ring carries the seconds, like a HUD clock;
//   - the rings tilt with the gaze (parallax towards the cursor).
// Always moving while the island is shown (`animated`); a hidden island
// draws nothing, so the CPU stays at rest.

import type { BotStateName } from "../core/layout";
import type { HudCharacter, RGB } from "./character";
import { character, mix, rgba } from "./character";

export const JARVIS: HudCharacter = {
  kind: "hud",
  id: "jarvis",
  name: "Jarvis",
  color: [0.28, 0.82, 1],
  aspect: 1,
  wearsIntegrationColor: true,
  animated: true,
};

/**
 * Jarvis Sfera (asked by Edoardo on 25 Oct 2026, from a picture): the same
 * assistant as a sphere of points whose surface ripples like sound — cool at
 * the top, warm at the bottom, brighter at the rim. Same rhythm per state and
 * parallax as the rings; no satellites or sparks (white dots over the points
 * meant nothing, Edoardo on 25 Oct 2026).
 */
export const JARVIS_SPHERE: HudCharacter = {
  kind: "hud",
  id: "jarvis-sfera",
  name: "Jarvis Sfera",
  color: [0.35, 0.6, 1],
  aspect: 1,
  wearsIntegrationColor: true,
  animated: true,
};

/**
 * Jarvis Plasma (asked by Edoardo on 25 Oct 2026, from a picture): a plasma
 * globe — no hard edge: a cage of thin wavy filaments around a dark violet
 * haze, a web of fine filaments inside that keeps changing, a hot knot with
 * fine rays in the middle, soft blue and magenta arcs along the rim and a few
 * oval glints. Same rhythm per state as the
 * others (more and faster lightning while working, a beat waiting, a red
 * flicker on an error). The haze is dark, so it reads on a light island too.
 */
export const JARVIS_PLASMA: HudCharacter = {
  kind: "hud",
  id: "jarvis-plasma",
  name: "Jarvis Plasma",
  color: [0.38, 0.36, 1],
  aspect: 1,
  wearsIntegrationColor: true,
  animated: true,
};

let agents = 0;
const bootAt = performance.now();

/** Agents at work right now: one satellite each (at most 8). */
export function setJarvisAgents(n: number) {
  agents = Math.max(0, Math.min(8, Math.floor(n)));
}

export interface HudLook {
  /** The theme's (or integration's) colour. */
  base: RGB;
  /** The state's colour and how much of it to take. */
  col: RGB;
  tint: number;
  state: BotStateName;
  /** −1…1, where the cursor is. */
  gazeX: number;
  gazeY: number;
  /** Small sizes (rest icon, mini): fewer details. */
  simple?: boolean;
}

/** How fast the rings turn and how the core breathes, per state. */
function rhythm(state: BotStateName): { spin: number; pulse: number; glow: number } {
  switch (state) {
    case "working": case "thinking": return { spin: 2.6, pulse: 3.2, glow: 1 };
    case "searching": return { spin: 1.8, pulse: 2, glow: 0.9 };
    case "approval": case "question": return { spin: 0.8, pulse: 4.2, glow: 1 };
    case "error": return { spin: 0.4, pulse: 7, glow: 0.85 };
    case "finished": return { spin: 1.2, pulse: 1.6, glow: 0.95 };
    case "ratelimit": return { spin: 0.5, pulse: 1.2, glow: 0.7 };
    case "sleeping": return { spin: 0.15, pulse: 0.5, glow: 0.45 };
    case "dizzy": return { spin: 5, pulse: 2, glow: 0.8 };
    default: return { spin: 0.7, pulse: 1.1, glow: 0.8 };
  }
}

const TAU = Math.PI * 2;
const ease = (v: number) => 1 - Math.pow(1 - Math.max(0, Math.min(1, v)), 3);

/** Draws the Jarvis in use (rings or sphere) centred on (cx, cy), `R` its outer radius. */
export function drawJarvis(x: CanvasRenderingContext2D, cx: number, cy: number, R: number, look: HudLook, nowMs = performance.now()) {
  const id = character().id;
  if (id === JARVIS_SPHERE.id) drawSphere(x, cx, cy, R, look, nowMs);
  else if (id === JARVIS_PLASMA.id) drawPlasma(x, cx, cy, R, look, nowMs);
  else drawRings(x, cx, cy, R, look, nowMs);
}

/** Points on a sphere, evenly spread (Fibonacci), by count. */
const spheres = new Map<number, Float32Array>();
function spherePoints(n: number): Float32Array {
  let p = spheres.get(n);
  if (p) return p;
  p = new Float32Array(n * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const a = i * golden;
    p[i * 3] = Math.cos(a) * r;
    p[i * 3 + 1] = y;
    p[i * 3 + 2] = Math.sin(a) * r;
  }
  spheres.set(n, p);
  return p;
}

const WARM: RGB = [1, 0.42, 0.12];
const MAGENTA: RGB = [1, 0.22, 0.85];
/** A fixed pseudo-random value per point (no Math.random: the same every frame). */
const HASH = Float32Array.from({ length: 997 }, (_, i) => {
  const v = Math.sin(i * 12.9898) * 43758.5453;
  return v - Math.floor(v);
});

function drawSphere(x: CanvasRenderingContext2D, cx: number, cy: number, R: number, look: HudLook, nowMs: number) {
  const t = nowMs / 1000;
  const r = rhythm(look.state);
  const boot = look.simple ? 1 : ease((nowMs - bootAt) / 1400);
  // Cool on top: the theme's colour; warm below, leaning to the state's colour.
  // Vivid on purpose (Edoardo, 25 Oct 2026): the colours pushed to full saturation.
  const top = vivid(look.base);
  const bottom = vivid(mix(WARM, look.col, Math.min(1, look.tint * 1.1)));
  // Through magenta, as in the picture.
  const mid = vivid(mix(mix(top, bottom, 0.5), MAGENTA, 0.65));
  let alpha = r.glow;
  if (look.state === "error") alpha *= 0.7 + 0.3 * Math.sign(Math.sin(t * 23) + Math.sin(t * 7.3));
  if (look.state === "sleeping") alpha *= 0.65 + 0.35 * Math.sin(t * 1.2);
  // How rough the surface is: calm at rest, a voice while working, a beat waiting.
  const busy = look.state === "working" || look.state === "thinking" || look.state === "searching";
  let rough = busy ? 0.09 : look.state === "sleeping" ? 0.025 : 0.05;
  if (look.state === "approval" || look.state === "question") rough += 0.08 * Math.pow(Math.max(0, Math.sin(t * r.pulse)), 4);
  const n = look.simple ? 140 : R > 50 ? 1400 : 700;
  const pts = spherePoints(n);
  const yaw = t * 0.25 * r.spin + look.gazeX * 0.5;
  const pitch = 0.35 + look.gazeY * 0.35;
  const cyaw = Math.cos(yaw), syaw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const dot = Math.max(0.7, R * (look.simple ? 0.05 : 0.022));

  x.save();
  x.translate(cx, cy);
  // A soft halo, so the points read as a glowing hollow globe.
  const halo = x.createRadialGradient(0, 0, R * 0.3, 0, 0, R * 1.25);
  halo.addColorStop(0, rgba(mid, 0.22 * alpha));
  halo.addColorStop(1, rgba(top, 0));
  x.fillStyle = halo;
  x.beginPath();
  x.arc(0, 0, R * 1.25, 0, Math.PI * 2);
  x.fill();

  const ripple = look.state === "finished" ? (t % 1.5) / 1.5 : -1;
  for (let i = 0; i < n; i++) {
    const px = pts[i * 3], py = pts[i * 3 + 1], pz = pts[i * 3 + 2];
    // The surface waves: a few travelling sines over the sphere, like sound.
    let k = 1 + rough * (Math.sin(px * 5 + t * 2.1) * Math.cos(py * 4 - t * 1.7) + 0.6 * Math.sin(pz * 7 + py * 3 + t * 3.1)
      + 0.45 * Math.sin(px * 13 - pz * 11 + t * 4.3));
    // Each point a little off the surface, more so at the rim: a frayed, dusty edge.
    const jit = HASH[i % HASH.length];
    k += (jit - 0.5) * (0.05 + rough * 0.6) + (jit > 0.93 ? (jit - 0.93) * 2.2 : 0);
    if (ripple >= 0) k += 0.12 * Math.max(0, 1 - Math.abs(py + 1 - ripple * 2) * 3);
    k *= boot;
    // Turn: around the vertical axis, then tip towards the viewer.
    const x1 = px * cyaw - pz * syaw;
    const z1 = px * syaw + pz * cyaw;
    const y2 = py * cp - z1 * sp;
    const z2 = py * sp + z1 * cp;
    const sx = x1 * k * R;
    const sy = y2 * k * R;
    // Brighter on the rim and in front; the back fades.
    const rim = Math.sqrt(Math.min(1, x1 * x1 + y2 * y2));
    const front = (z2 + 1) / 2;
    const a = alpha * (0.3 + 0.6 * rim * rim + 0.3 * front);
    // Colour by height on screen: cool at the top, warm at the bottom.
    const h = (y2 + 1) / 2;
    const col = h < 0.5 ? mix(top, mid, h * 2) : mix(mid, bottom, (h - 0.5) * 2);
    x.fillStyle = rgba(col, Math.min(1, a));
    const s = dot * (0.7 + 0.6 * front);
    x.fillRect(sx - s / 2, sy - s / 2, s, s);
  }
  x.restore();
}

function drawRings(x: CanvasRenderingContext2D, cx: number, cy: number, R: number, look: HudLook, nowMs: number) {
  const t = nowMs / 1000;
  const r = rhythm(look.state);
  const c = mix(look.base, look.col, Math.min(1, look.tint * 1.1));
  const light = mix(c, [1, 1, 1], 0.55);
  const boot = look.simple ? 1 : ease((nowMs - bootAt) / 1600);
  // Some states shake the light itself.
  let alpha = r.glow;
  if (look.state === "error") alpha *= 0.75 + 0.25 * Math.sign(Math.sin(t * 23) + Math.sin(t * 7.3));
  if (look.state === "sleeping") alpha *= 0.7 + 0.3 * Math.sin(t * 1.2);

  x.save();
  x.translate(cx, cy);

  // Halo behind everything.
  const halo = x.createRadialGradient(0, 0, R * 0.1, 0, 0, R * 1.35);
  halo.addColorStop(0, rgba(c, 0.28 * alpha));
  halo.addColorStop(0.55, rgba(c, 0.08 * alpha));
  halo.addColorStop(1, rgba(c, 0));
  x.fillStyle = halo;
  x.beginPath();
  x.arc(0, 0, R * 1.35, 0, TAU);
  x.fill();

  // Parallax: the rings lean towards the cursor as a disc seen at an angle.
  const lean = look.simple ? 0 : 0.18;
  const sx = 1 - Math.abs(look.gazeX) * lean;
  const sy = 1 - Math.abs(look.gazeY) * lean;

  const ring = (radius: number, width: number, a: number, from: number, len: number, rot: number) => {
    x.beginPath();
    x.arc(0, 0, radius, rot + from, rot + from + len);
    x.lineWidth = width;
    x.strokeStyle = rgba(c, a * alpha);
    x.stroke();
  };

  x.save();
  x.translate(look.gazeX * R * 0.06, look.gazeY * R * 0.06);
  x.scale(sx, sy);
  x.lineCap = "round";

  // Outer ring: ticks, with the seconds hand of a HUD clock.
  const outer = R * 0.98;
  if (!look.simple) {
    const ticks = 60;
    const shown = Math.floor(ticks * ease((nowMs - bootAt) / 900));
    for (let i = 0; i < shown; i++) {
      const a = (i / ticks) * TAU - Math.PI / 2;
      const long = i % 5 === 0;
      const r0 = outer - (long ? R * 0.09 : R * 0.05);
      x.beginPath();
      x.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      x.lineTo(Math.cos(a) * outer, Math.sin(a) * outer);
      x.lineWidth = long ? Math.max(1, R * 0.025) : Math.max(0.6, R * 0.012);
      x.strokeStyle = rgba(c, (long ? 0.55 : 0.28) * alpha);
      x.stroke();
    }
    const sec = new Date(nowMs + performance.timeOrigin).getSeconds() + (nowMs % 1000) / 1000;
    const sa = (sec / 60) * TAU - Math.PI / 2;
    x.beginPath();
    x.arc(Math.cos(sa) * outer, Math.sin(sa) * outer, Math.max(1.4, R * 0.04), 0, TAU);
    x.fillStyle = rgba(light, alpha);
    x.fill();
  } else {
    ring(outer, Math.max(1, R * 0.05), 0.45, 0, TAU, 0);
  }

  // Three arc rings turning at different speeds and directions.
  const arcs: [number, number, number, number, number][] = [
    // radius, width, speed, segments, length of each (fraction of its slot)
    [0.8, 0.07, 1, 3, 0.62],
    [0.64, 0.045, -1.6, 4, 0.4],
    [0.5, 0.09, 0.6, 2, 0.3],
  ];
  arcs.forEach(([rr, w, speed, n, len], i) => {
    const grow = look.simple ? 1 : ease((nowMs - bootAt - 250 - i * 220) / 700);
    if (grow <= 0) return;
    const rot = t * r.spin * speed + i * 1.3;
    for (let k = 0; k < n; k++) {
      ring(R * rr, Math.max(1, R * w), 0.85 - i * 0.12, (k / n) * TAU, (TAU / n) * len * grow, rot);
    }
  });

  // Working / thinking: a wave around the core, like a voice.
  if (!look.simple && (look.state === "working" || look.state === "thinking")) {
    const n = 64;
    x.beginPath();
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * TAU;
      const amp = R * 0.035 * (Math.sin(a * 6 + t * 9) + 0.6 * Math.sin(a * 11 - t * 13));
      const rr = R * 0.38 + amp;
      if (i === 0) x.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else x.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    x.closePath();
    x.lineWidth = Math.max(1, R * 0.022);
    x.strokeStyle = rgba(light, 0.75 * alpha);
    x.stroke();
  }

  // Searching: a beam sweeping round.
  if (look.state === "searching") {
    const a = t * 2.4;
    const g = x.createConicGradient(a, 0, 0);
    g.addColorStop(0, rgba(c, 0.45 * alpha));
    g.addColorStop(0.12, rgba(c, 0));
    g.addColorStop(1, rgba(c, 0));
    x.fillStyle = g;
    x.beginPath();
    x.arc(0, 0, R * 0.9, 0, TAU);
    x.fill();
  }

  // Done: a ripple going out every second and a half.
  if (look.state === "finished" && !look.simple) {
    const p = (t % 1.5) / 1.5;
    ring(R * (0.35 + p * 0.75), Math.max(1, R * 0.03), 0.6 * (1 - p), 0, TAU, 0);
  }
  x.restore();

  // Satellites: one per agent at work, on their own orbit.
  if (agents > 0 && !look.simple) {
    for (let i = 0; i < agents; i++) {
      const a = t * 0.9 + (i / agents) * TAU;
      const rr = R * 1.1;
      x.beginPath();
      x.arc(Math.cos(a) * rr * sx, Math.sin(a) * rr * sy, Math.max(2.4, R * 0.075), 0, TAU);
      // A soft glow drawn as a second disc: shadowBlur costs too much every frame.
      x.fillStyle = rgba(c, 0.3 * alpha);
      x.fill();
      x.beginPath();
      x.arc(Math.cos(a) * rr * sx, Math.sin(a) * rr * sy, Math.max(1, R * 0.03), 0, TAU);
      x.fillStyle = rgba(light, 0.95 * alpha);
      x.fill();
    }
  }

  // The core: a bright disc that breathes; waiting for the user it beats.
  const beat = look.state === "approval" || look.state === "question"
    ? 0.5 + 0.5 * Math.pow(Math.max(0, Math.sin(t * r.pulse)), 4)
    : 0.5 + 0.5 * Math.sin(t * r.pulse);
  const core = R * (0.2 + 0.05 * beat) * boot;
  if (core > 0.2) {
    const g = x.createRadialGradient(0, 0, 0, 0, 0, core * 1.9);
    g.addColorStop(0, rgba([1, 1, 1], 0.95 * alpha));
    g.addColorStop(0.35, rgba(light, 0.9 * alpha));
    g.addColorStop(0.6, rgba(c, 0.55 * alpha));
    g.addColorStop(1, rgba(c, 0));
    x.fillStyle = g;
    x.beginPath();
    x.arc(0, 0, core * 1.9, 0, TAU);
    x.fill();
    if (!look.simple) {
      // A triangle inside the core, slowly turning.
      x.save();
      x.rotate(-t * r.spin * 0.5);
      x.beginPath();
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * TAU - Math.PI / 2;
        const px = Math.cos(a) * core * 0.75;
        const py = Math.sin(a) * core * 0.75;
        if (k === 0) x.moveTo(px, py);
        else x.lineTo(px, py);
      }
      x.closePath();
      x.lineWidth = Math.max(1, R * 0.025);
      x.strokeStyle = rgba(c, 0.8 * alpha);
      x.stroke();
      x.restore();
    }
  }
  x.restore();
}

/** The same hue at full saturation: the glow colours. */
function vivid(c: RGB): RGB {
  const max = Math.max(c[0], c[1], c[2]);
  const min = Math.min(c[0], c[1], c[2]);
  if (max - min < 0.05) return c;
  // Stretch the channels so the strongest is 1 and the weakest near 0.
  const k = (v: number) => Math.max(0, Math.min(1, ((v - min) / (max - min)) * 0.92 + 0.08));
  return [k(c[0]), k(c[1]), k(c[2])];
}

/** A smooth wiggle along a line, 0 at both ends: the filaments of the picture are wavy, not zigzag. */
function wiggle(u: number, seed: number, t: number): number {
  const a = HASH[seed % HASH.length], b = HASH[(seed + 7) % HASH.length], c = HASH[(seed + 13) % HASH.length];
  return (Math.sin(u * (9 + a * 8) + a * 6 + t * (0.6 + b)) + 0.55 * Math.sin(u * (21 + b * 14) + b * 6 - t * (0.9 + c))
    + 0.3 * Math.sin(u * (43 + c * 20) + c * 6 + t * 1.7)) * Math.sin(u * Math.PI);
}

/** A wavy filament from (x0,y0) to (x1,y1). */
function filament(x: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, seed: number, amp: number, t: number, steps: number) {
  const dx = x1 - x0, dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len, ny = dx / len;
  x.moveTo(x0, y0);
  for (let i = 1; i <= steps; i++) {
    const u = i / steps;
    const off = wiggle(u, seed, t) * amp * len;
    x.lineTo(x0 + dx * u + nx * off, y0 + dy * u + ny * off);
  }
}

/** A soft stroke: a wide faint pass under a thin bright one (shadowBlur costs too much every frame). */
function glowStroke(x: CanvasRenderingContext2D, col: RGB, a: number, w: number) {
  x.strokeStyle = rgba(col, a * 0.18);
  x.lineWidth = w * 5;
  x.stroke();
  x.strokeStyle = rgba(col, a * 0.35);
  x.lineWidth = w * 2.2;
  x.stroke();
  x.strokeStyle = rgba(mix(col, [1, 1, 1], 0.4), a);
  x.lineWidth = w;
  x.stroke();
}

function drawPlasma(x: CanvasRenderingContext2D, cx: number, cy: number, R: number, look: HudLook, nowMs: number) {
  const t = nowMs / 1000;
  const r = rhythm(look.state);
  const boot = look.simple ? 1 : ease((nowMs - bootAt) / 1400);
  // Blue and magenta, leaning to the state's colour.
  const blue = vivid(mix(look.base, look.col, Math.min(1, look.tint * 1.1)));
  const pink = vivid(mix(MAGENTA, look.col, Math.min(0.6, look.tint)));
  const violet = mix(blue, pink, 0.5);
  const white: RGB = [1, 1, 1];
  let alpha = Math.min(1, r.glow + 0.15);
  if (look.state === "error") alpha *= 0.65 + 0.35 * Math.sign(Math.sin(t * 23) + Math.sin(t * 7.3));
  if (look.state === "sleeping") alpha *= 0.6 + 0.3 * Math.sin(t * 1.2);
  const busy = look.state === "working" || look.state === "thinking" || look.state === "searching";
  const waiting = look.state === "approval" || look.state === "question";
  const beat = waiting ? Math.pow(Math.max(0, Math.sin(t * r.pulse)), 4) : 0.5 + 0.5 * Math.sin(t * r.pulse);
  // How fast the filaments move: calm at rest, nervous while working.
  const tt = t * (busy ? 2.2 : look.state === "sleeping" ? 0.3 : 0.8) * Math.max(0.4, r.spin);
  const G = R * 0.8 * boot;
  if (G < 0.5) return;
  const thin = Math.max(0.5, R * 0.008);

  x.save();
  x.translate(cx + look.gazeX * R * 0.04, cy + look.gazeY * R * 0.04);

  // The body: a dark violet-blue haze that fades out, no hard edge (dark, so it reads on a light island too).
  const body = x.createRadialGradient(0, -G * 0.2, G * 0.1, 0, 0, G * 1.2);
  body.addColorStop(0, rgba(mix(violet, [0.05, 0.04, 0.15], 0.75), 0.95));
  body.addColorStop(0.75, rgba(mix(blue, [0.03, 0.03, 0.12], 0.7), 0.9));
  body.addColorStop(1, rgba(blue, 0));
  x.fillStyle = body;
  x.beginPath();
  x.arc(0, 0, G * 1.2, 0, TAU);
  x.fill();

  x.globalCompositeOperation = "lighter";
  x.lineCap = "round";
  x.lineJoin = "round";

  // Soft glowing arcs just inside the edge: blue on the sides and below, magenta at the top and bottom.
  if (!look.simple) {
    const arcs: [number, number, RGB][] = [[2.2, 1.1, blue], [3.6, 0.9, pink], [5.2, 1.2, violet], [0.3, 0.8, blue], [4.4, 0.5, pink]];
    arcs.forEach(([from, len, col], k) => {
      const a0 = from + Math.sin(tt * 0.3 + k) * 0.25;
      x.beginPath();
      x.ellipse(0, 0, G * 0.93, G * 0.9, 0, a0, a0 + len);
      glowStroke(x, col, 0.55 * alpha, Math.max(1.2, R * 0.022));
    });
  }

  // The cage: thin wavy loops around the globe, some reaching a little outside.
  const loops = look.simple ? 4 : 13;
  const seg = look.simple ? 28 : 90;
  for (let k = 0; k < loops; k++) {
    const h0 = HASH[(k * 17) % HASH.length], h1 = HASH[(k * 23 + 5) % HASH.length];
    const base = G * (0.92 + h0 * 0.18);
    x.beginPath();
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * TAU;
      const rr = base + G * (0.035 * Math.sin(a * (5 + k % 4) + tt * (0.5 + h1) + k) + 0.025 * Math.sin(a * (13 + k % 5) - tt * 0.9 + h0 * 6)
        + 0.012 * Math.sin(a * 29 + tt * 1.6 + k));
      const px = Math.cos(a) * rr, py = Math.sin(a) * rr * 0.97;
      if (i === 0) x.moveTo(px, py);
      else x.lineTo(px, py);
    }
    x.strokeStyle = rgba(k % 3 === 0 ? pink : k % 3 === 1 ? violet : blue, (0.35 + h1 * 0.25) * alpha);
    x.lineWidth = thin;
    x.stroke();
  }

  // The web inside: wavy filaments between points of the globe, each living a few seconds, then replaced.
  const web = look.simple ? 6 : busy ? 34 : waiting ? 22 + Math.round(beat * 10) : look.state === "sleeping" ? 12 : 24;
  for (let i = 0; i < web; i++) {
    const life = t * (busy ? 0.6 : 0.2) * (0.5 + HASH[(i * 19) % HASH.length]) + i * 0.29;
    const gen = Math.floor(life);
    const fade = Math.sin((life - gen) * Math.PI);
    const seed = gen * 37 + i * 59;
    const a0 = HASH[seed % HASH.length] * TAU, a1 = a0 + 1 + HASH[(seed + 3) % HASH.length] * 3.5;
    const r0 = G * (0.55 + 0.4 * HASH[(seed + 1) % HASH.length]), r1 = G * (0.55 + 0.4 * HASH[(seed + 2) % HASH.length]);
    x.beginPath();
    filament(x, Math.cos(a0) * r0, Math.sin(a0) * r0, Math.cos(a1) * r1, Math.sin(a1) * r1, seed, 0.09, tt, look.simple ? 10 : 36);
    x.strokeStyle = rgba(mix(i % 4 === 0 ? violet : blue, white, 0.2), 0.75 * fade * alpha);
    x.lineWidth = thin;
    x.stroke();
  }

  // The knot: many fine filaments out of the centre, the longest ones reaching the web.
  const rays = look.simple ? 8 : busy ? 34 : 24;
  for (let i = 0; i < rays; i++) {
    const h0 = HASH[(i * 41) % HASH.length];
    const a = (i / rays) * TAU + h0 * 0.5 + Math.sin(tt * 0.4 + i) * 0.15;
    const len = G * (0.15 + 0.5 * Math.pow(HASH[(i * 7 + 3) % HASH.length], 1.6)) * (busy ? 1.15 : 1);
    x.beginPath();
    filament(x, 0, 0, Math.cos(a) * len, Math.sin(a) * len, i * 97, 0.14, tt * 1.4, look.simple ? 6 : 16);
    x.strokeStyle = rgba(mix(blue, white, 0.45), (0.85 - len / G) * alpha);
    x.lineWidth = thin;
    x.stroke();
  }
  const core = R * (0.07 + 0.04 * beat);
  const g = x.createRadialGradient(0, 0, 0, 0, 0, core * 3);
  g.addColorStop(0, rgba(white, alpha));
  g.addColorStop(0.25, rgba(mix(blue, white, 0.6), 0.7 * alpha));
  g.addColorStop(1, rgba(blue, 0));
  x.fillStyle = g;
  x.beginPath();
  x.arc(0, 0, core * 3, 0, TAU);
  x.fill();

  // Glints: soft oval lights floating in the globe, a white heart each.
  if (!look.simple) {
    for (let k = 0; k < 8; k++) {
      const a = HASH[k * 11 + 1] * TAU + tt * 0.08 * (k % 2 ? 1 : -1);
      const d = G * (0.35 + HASH[(k * 29) % HASH.length] * 0.55);
      const px = Math.cos(a) * d, py = Math.sin(a) * d;
      const col = k % 3 === 0 ? pink : blue;
      const s = R * (0.05 + HASH[(k * 3 + 2) % HASH.length] * 0.04);
      x.save();
      x.translate(px, py);
      x.rotate(a + Math.PI / 2);
      x.scale(1, 0.65);
      const m = x.createRadialGradient(0, 0, 0, 0, 0, s);
      m.addColorStop(0, rgba(white, 0.95 * alpha));
      m.addColorStop(0.3, rgba(col, 0.7 * alpha));
      m.addColorStop(1, rgba(col, 0));
      x.fillStyle = m;
      x.beginPath();
      x.arc(0, 0, s, 0, TAU);
      x.fill();
      x.restore();
    }
  }

  // Satellites: one per agent at work, outside the globe.
  if (agents > 0 && !look.simple) {
    for (let i = 0; i < agents; i++) {
      const a = t * 0.9 + (i / agents) * TAU;
      const m = x.createRadialGradient(Math.cos(a) * R * 1.12, Math.sin(a) * R * 1.12, 0, Math.cos(a) * R * 1.12, Math.sin(a) * R * 1.12, R * 0.06);
      m.addColorStop(0, rgba(white, alpha));
      m.addColorStop(1, rgba(blue, 0));
      x.fillStyle = m;
      x.beginPath();
      x.arc(Math.cos(a) * R * 1.12, Math.sin(a) * R * 1.12, R * 0.06, 0, TAU);
      x.fill();
    }
  }
  x.restore();
}
