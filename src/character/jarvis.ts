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
  if (character().id === JARVIS_SPHERE.id) drawSphere(x, cx, cy, R, look, nowMs);
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

const WARM: RGB = [1, 0.45, 0.22];
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
  const top = look.base;
  const bottom = mix(WARM, look.col, Math.min(1, look.tint * 1.1));
  // Through violet and pink, as in the picture.
  const mid = mix(mix(top, bottom, 0.5), [0.75, 0.3, 0.75], 0.5);
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
  // A faint dark core and halo, so the points read as a hollow globe.
  const halo = x.createRadialGradient(0, 0, R * 0.3, 0, 0, R * 1.25);
  halo.addColorStop(0, rgba(mix(top, bottom, 0.5), 0.1 * alpha));
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
    const a = alpha * (0.18 + 0.55 * rim * rim + 0.25 * front);
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
