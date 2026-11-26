// More drawings for the empty chat (26 Nov 2026, Edoardo: «aggiungi altri
// disegni a tuo piacere, fanne il più possibile»). Same rules as chat-empty.ts:
// faint, slow, colours from the chat's palette, a few hundred shapes at most
// per frame (20 frames a second, none when the chat is not on screen). Every
// random value comes from a fixed seed, so a drawing is the same at each frame.

export interface Palette {
  ink: string;
  dim: string;
  faint: string;
  accent: string;
  light: boolean;
}

type Ctx = CanvasRenderingContext2D;

/** A small fixed random sequence. */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const TAU = Math.PI * 2;

function dot(x: Ctx, px: number, py: number, r: number) {
  x.beginPath();
  x.arc(px, py, r, 0, TAU);
  x.fill();
}

/** Northern lights at the top, as curtains that fade downwards; slow, and gone before the middle. */
export function aurora(x: Ctx, w: number, h: number, t: number, p: Palette) {
  const curtains: [string, number, number, number, number][] = [
    // colour, top (share of h), depth (share of h), speed, phase
    [p.light ? "#0ea5e9" : "#22d3ee", 0.06, 0.24, 0.1, 0],
    [p.light ? "#7c3aed" : "#a78bfa", 0.12, 0.18, 0.08, 1.9],
    [p.light ? "#0d9488" : "#34d399", 0.03, 0.28, 0.12, 3.7],
  ];
  x.save();
  x.globalCompositeOperation = p.light ? "multiply" : "screen";
  for (const [color, base, deep, speed, phase] of curtains) {
    const y0 = h * base;
    const depth = h * deep;
    const g = x.createLinearGradient(0, y0 - h * 0.05, 0, y0 + depth);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(0.22, color);
    g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g;
    for (let layer = 0; layer < 3; layer++) {
      x.globalAlpha = (p.light ? 0.05 : 0.075) * (1 - layer * 0.22);
      const top = (px: number) => y0
        + Math.sin(px * 0.0042 + t * speed + phase) * h * 0.035
        + Math.sin(px * 0.011 - t * speed * 0.6 + phase * 1.7) * h * 0.012
        - layer * 5;
      x.beginPath();
      x.moveTo(-20, top(-20));
      for (let px = -20; px <= w + 20; px += 14) x.lineTo(px, top(px));
      // The lower edge: rays of different lengths, breathing slowly.
      for (let px = w + 20; px >= -20; px -= 14) {
        const ray = 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(px * 0.047 + t * speed * 2.2 + phase + layer)) * (0.55 + 0.45 * Math.sin(px * 0.013 - t * speed + phase));
        x.lineTo(px, top(px) + depth * ray);
      }
      x.closePath();
      x.fill();
    }
  }
  // Soft at both sides: no band cut by the edges.
  x.globalCompositeOperation = "destination-out";
  x.globalAlpha = 1;
  for (const [from, to] of [[0, w * 0.18], [w, w * 0.82]]) {
    const e = x.createLinearGradient(from, 0, to, 0);
    e.addColorStop(0, "rgba(0,0,0,1)");
    e.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = e;
    x.fillRect(Math.min(from, to), 0, Math.abs(to - from), h);
  }
  x.restore();
}

/** Fireflies wandering, each glowing and fading on its own clock. */
export function fireflies(x: Ctx, w: number, h: number, t: number, p: Palette) {
  const rnd = seeded(41);
  const n = Math.round(Math.max(14, Math.min(30, (w * h) / 14000)));
  const color = p.light ? "202,138,4" : "250,204,21";
  for (let i = 0; i < n; i++) {
    const bx = rnd() * w, by = h * (0.15 + rnd() * 0.75);
    const ax = 30 + rnd() * 50, ay = 20 + rnd() * 30;
    const sx = 0.05 + rnd() * 0.08, sy = 0.06 + rnd() * 0.08, ph = rnd() * TAU, blink = 0.3 + rnd() * 0.5;
    const px = bx + Math.sin(t * sx + ph) * ax + Math.sin(t * sx * 2.3 + ph) * ax * 0.3;
    const py = by + Math.cos(t * sy + ph * 1.4) * ay;
    const glow = Math.max(0, Math.sin(t * blink + ph * 3));
    if (glow < 0.02) continue;
    const g = x.createRadialGradient(px, py, 0, px, py, 12);
    g.addColorStop(0, `rgba(${color},${0.42 * glow})`);
    g.addColorStop(1, `rgba(${color},0)`);
    x.fillStyle = g;
    x.globalAlpha = 1;
    dot(x, px, py, 12);
    x.fillStyle = `rgba(${color},${0.75 * glow})`;
    dot(x, px, py, 1.4);
  }
  x.globalAlpha = 1;
}

/** Snow falling slowly, swaying, the nearer flakes bigger and faster. */
export function snow(x: Ctx, w: number, h: number, t: number, p: Palette) {
  const rnd = seeded(5);
  const n = Math.round(Math.max(40, Math.min(110, (w * h) / 6000)));
  x.fillStyle = p.ink;
  for (let i = 0; i < n; i++) {
    const near = rnd();
    const x0 = rnd() * w, y0 = rnd() * h, ph = rnd() * TAU;
    const speed = 8 + near * 22;
    const py = (y0 + t * speed) % (h + 10) - 5;
    const px = x0 + Math.sin(t * (0.3 + near * 0.4) + ph) * (6 + near * 10);
    x.globalAlpha = 0.12 + near * 0.3;
    dot(x, px, py, 0.7 + near * 1.6);
  }
  x.globalAlpha = 1;
}

/** Light rain: thin slanted streaks, faint, a few small rings where they land. */
export function rain(x: Ctx, w: number, h: number, t: number, p: Palette) {
  const rnd = seeded(13);
  const n = Math.round(Math.max(30, Math.min(70, (w * h) / 9000)));
  x.strokeStyle = p.dim;
  x.lineWidth = 1;
  x.lineCap = "round";
  for (let i = 0; i < n; i++) {
    const near = rnd();
    const x0 = rnd() * (w + 60), y0 = rnd() * h;
    const speed = 120 + near * 140;
    const len = 8 + near * 12;
    const py = (y0 + t * speed) % (h + len) - len;
    const px = x0 - py * 0.12;
    x.globalAlpha = 0.08 + near * 0.16;
    x.beginPath();
    x.moveTo(px, py);
    x.lineTo(px - len * 0.12, py + len);
    x.stroke();
  }
  // Rings on the ground line.
  const ground = h * 0.9;
  for (let k = Math.floor(t / 0.45) - 3; k <= Math.floor(t / 0.45); k++) {
    const age = t - k * 0.45;
    if (age < 0 || age > 1.3) continue;
    const r2 = seeded(500 + k);
    const gx = r2() * w;
    x.globalAlpha = 0.22 * (1 - age / 1.3);
    x.beginPath();
    x.ellipse(gx, ground + r2() * h * 0.06, 3 + age * 16, (3 + age * 16) * 0.28, 0, 0, TAU);
    x.stroke();
  }
  x.globalAlpha = 1;
}

/** Bubbles rising and wobbling, fading near the top. */
export function bubbles(x: Ctx, w: number, h: number, t: number, p: Palette) {
  const rnd = seeded(29);
  const n = Math.round(Math.max(16, Math.min(34, (w * h) / 12000)));
  x.strokeStyle = p.accent;
  x.lineWidth = 1;
  for (let i = 0; i < n; i++) {
    const r = 2.5 + rnd() * 9;
    const x0 = rnd() * w, y0 = rnd() * h, ph = rnd() * TAU;
    const speed = 10 + (12 - r) * 2.2;
    const py = h + 12 - ((y0 + t * speed) % (h + 24));
    const px = x0 + Math.sin(t * 0.8 + ph + py * 0.02) * 6;
    const fade = Math.min(1, py / (h * 0.35));
    x.globalAlpha = (p.light ? 0.3 : 0.24) * fade;
    x.beginPath();
    x.arc(px, py, r, 0, TAU);
    x.stroke();
    // A glint.
    x.globalAlpha *= 0.9;
    x.beginPath();
    x.arc(px - r * 0.35, py - r * 0.35, r * 0.28, Math.PI * 1.1, Math.PI * 1.6);
    x.stroke();
  }
  x.globalAlpha = 1;
}

/** Drops on still water: rings widening and fading, one every so often. */
export function ripples(x: Ctx, w: number, h: number, t: number, p: Palette) {
  const every = 1.7;
  const life = 5;
  x.strokeStyle = p.dim;
  x.lineWidth = 1;
  for (let k = Math.floor(t / every) - Math.ceil(life / every); k <= Math.floor(t / every); k++) {
    const age = t - k * every;
    if (age < 0 || age > life) continue;
    const r2 = seeded(900 + k);
    const cx = w * (0.12 + r2() * 0.76), cy = h * (0.2 + r2() * 0.65);
    for (let ring = 0; ring < 3; ring++) {
      const a = age - ring * 0.35;
      if (a <= 0) continue;
      const rad = a * 26;
      x.globalAlpha = 0.3 * (1 - age / life) * (1 - ring * 0.25);
      x.beginPath();
      x.ellipse(cx, cy, rad, rad * 0.42, 0, 0, TAU);
      x.stroke();
    }
  }
  x.globalAlpha = 1;
}

/** A small solar system: tilted orbits, planets going round at their own pace. */
export function orbits(x: Ctx, w: number, h: number, t: number, p: Palette) {
  const cx = w / 2, cy = h * 0.44;
  const R = Math.max(60, Math.min(w * 0.36, h * 0.38));
  const sun = x.createRadialGradient(cx, cy, 0, cx, cy, 22);
  sun.addColorStop(0, p.light ? "rgba(217,119,6,0.55)" : "rgba(253,186,116,0.55)");
  sun.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = sun;
  dot(x, cx, cy, 22);
  const planets: [number, number, number, string][] = [
    [0.32, 1.1, 2.2, p.accent], [0.55, 0.62, 3, p.ink], [0.78, 0.38, 2.4, p.light ? "#7c3aed" : "#c4b5fd"], [1, 0.22, 3.4, p.dim],
  ];
  x.lineWidth = 1;
  planets.forEach(([share, speed, size, color], i) => {
    const rx = R * share, ry = rx * 0.36;
    x.strokeStyle = p.faint;
    x.globalAlpha = 0.18;
    x.beginPath();
    x.ellipse(cx, cy, rx, ry, -0.18, 0, TAU);
    x.stroke();
    const a = t * speed * 0.35 + i * 1.7;
    const ex = Math.cos(a) * rx, ey = Math.sin(a) * ry;
    const px = cx + ex * Math.cos(-0.18) - ey * Math.sin(-0.18);
    const py = cy + ex * Math.sin(-0.18) + ey * Math.cos(-0.18);
    x.globalAlpha = Math.sin(a) < 0 ? 0.35 : 0.65;
    x.fillStyle = color;
    dot(x, px, py, size);
  });
  x.globalAlpha = 1;
}

/** A spiral galaxy of dots, the inner part turning faster. */
const GALAXY = (() => {
  const rnd = seeded(77);
  return Array.from({ length: 420 }, (_, i) => {
    const arm = i % 2;
    const d = Math.pow(rnd(), 0.7);
    return { d, a: arm * Math.PI + d * 5.2 + (rnd() - 0.5) * 0.9 * (1.2 - d), s: 0.5 + rnd() * 1.1, b: rnd() };
  });
})();
export function galaxy(x: Ctx, w: number, h: number, t: number, p: Palette) {
  const cx = w / 2, cy = h * 0.44;
  const R = Math.max(60, Math.min(w * 0.4, h * 0.42));
  const core = x.createRadialGradient(cx, cy, 0, cx, cy, R * 0.25);
  core.addColorStop(0, p.light ? "rgba(124,58,237,0.16)" : "rgba(196,181,253,0.2)");
  core.addColorStop(1, "rgba(0,0,0,0)");
  x.fillStyle = core;
  dot(x, cx, cy, R * 0.25);
  for (const s of GALAXY) {
    const a = s.a + t * 0.06 / (0.25 + s.d);
    const px = cx + Math.cos(a) * s.d * R;
    const py = cy + Math.sin(a) * s.d * R * 0.5;
    x.globalAlpha = (0.15 + 0.5 * (1 - s.d)) * (0.6 + 0.4 * s.b);
    x.fillStyle = s.b > 0.85 ? p.accent : p.ink;
    dot(x, px, py, s.s * (1.1 - s.d * 0.4));
  }
  x.globalAlpha = 1;
}

/** A radar: rings, a turning sweep, blips lighting up as it passes. */
export function radar(x: Ctx, w: number, h: number, t: number, p: Palette) {
  const cx = w / 2, cy = h * 0.45;
  const R = Math.max(60, Math.min(w * 0.32, h * 0.36));
  x.strokeStyle = p.faint;
  x.lineWidth = 1;
  for (let i = 1; i <= 4; i++) {
    x.globalAlpha = 0.16;
    x.beginPath();
    x.arc(cx, cy, (R * i) / 4, 0, TAU);
    x.stroke();
  }
  x.globalAlpha = 0.1;
  x.beginPath();
  x.moveTo(cx - R, cy); x.lineTo(cx + R, cy);
  x.moveTo(cx, cy - R); x.lineTo(cx, cy + R);
  x.stroke();
  const sweep = (t * 0.7) % TAU;
  const g = x.createConicGradient(sweep - 1.1, cx, cy);
  g.addColorStop(0, "rgba(0,0,0,0)");
  g.addColorStop(0.175, p.light ? "rgba(22,163,74,0.18)" : "rgba(74,222,128,0.16)");
  g.addColorStop(0.176, "rgba(0,0,0,0)");
  x.globalAlpha = 1;
  x.fillStyle = g;
  dot(x, cx, cy, R);
  const rnd = seeded(61);
  x.fillStyle = p.light ? "#16a34a" : "#4ade80";
  for (let i = 0; i < 9; i++) {
    const a = rnd() * TAU, d = 0.2 + rnd() * 0.75;
    const since = (sweep - a + TAU * 2) % TAU;
    const light = Math.max(0, 1 - since / 4);
    if (light <= 0) continue;
    x.globalAlpha = 0.6 * light;
    dot(x, cx + Math.cos(a) * d * R, cy + Math.sin(a) * d * R, 2);
  }
  x.globalAlpha = 1;
}

/** Columns of 0 and 1 falling slowly, the head of each a little brighter. */
export function code(x: Ctx, w: number, h: number, t: number, p: Palette) {
  const size = 13;
  const cols = Math.floor(w / (size * 1.6));
  const rnd = seeded(17);
  x.font = `${size}px "Cascadia Mono", Consolas, monospace`;
  x.textAlign = "center";
  for (let c = 0; c < cols; c++) {
    const speed = 18 + rnd() * 30, off = rnd() * h * 2, tail = 6 + Math.floor(rnd() * 10), on = rnd() < 0.55;
    if (!on) continue;
    const head = ((t * speed + off) % (h + tail * size)) - size;
    const cx = (c + 0.5) * (w / cols);
    for (let k = 0; k < tail; k++) {
      const py = head - k * size;
      if (py < -size || py > h + size) continue;
      const glyph = (Math.floor(t * 2 + c * 7 + k * 3) * 2654435761) % 7 < 3 ? "1" : "0";
      x.globalAlpha = k === 0 ? 0.42 : 0.24 * (1 - k / tail);
      x.fillStyle = k === 0 ? p.accent : p.faint;
      x.fillText(glyph, cx, py);
    }
  }
  x.globalAlpha = 1;
}

/** Silk threads: a few waving lines, crossing gently in the lower half. */
export function threads(x: Ctx, w: number, h: number, t: number, p: Palette) {
  const colors = [p.accent, p.light ? "#7c3aed" : "#a78bfa", p.light ? "#0d9488" : "#2dd4bf", p.dim, p.faint];
  x.lineWidth = 1.2;
  for (let i = 0; i < 7; i++) {
    const base = h * (0.5 + i * 0.045);
    x.strokeStyle = colors[i % colors.length];
    x.globalAlpha = 0.2;
    x.beginPath();
    for (let px = -10; px <= w + 10; px += 10) {
      const py = base
        + Math.sin(px * 0.007 + t * 0.35 + i * 0.7) * h * 0.06
        + Math.sin(px * 0.017 - t * 0.22 + i * 1.3) * h * 0.02;
      if (px === -10) x.moveTo(px, py);
      else x.lineTo(px, py);
    }
    x.stroke();
  }
  x.globalAlpha = 1;
}

/** A grid in perspective coming towards the viewer under a low horizon. */
export function grid(x: Ctx, w: number, h: number, t: number, p: Palette) {
  const horizon = h * 0.52;
  const cx = w / 2;
  const sun = x.createLinearGradient(0, horizon - h * 0.22, 0, horizon);
  sun.addColorStop(0, p.light ? "rgba(219,39,119,0)" : "rgba(244,114,182,0)");
  sun.addColorStop(1, p.light ? "rgba(219,39,119,0.12)" : "rgba(244,114,182,0.14)");
  x.fillStyle = sun;
  x.beginPath();
  x.arc(cx, horizon, h * 0.16, Math.PI, 0);
  x.fill();
  x.strokeStyle = p.accent;
  x.lineWidth = 1;
  // Lines towards the vanishing point.
  for (let i = -12; i <= 12; i++) {
    x.globalAlpha = 0.14;
    x.beginPath();
    x.moveTo(cx + i * 6, horizon);
    x.lineTo(cx + i * w * 0.16, h);
    x.stroke();
  }
  // Cross lines moving down, closer as they near the horizon.
  const shift = (t * 0.25) % 1;
  for (let k = 0; k < 12; k++) {
    const z = (k + 1 - shift) / 12;
    const py = horizon + (h - horizon) * z * z;
    x.globalAlpha = 0.2 * z;
    x.beginPath();
    x.moveTo(0, py);
    x.lineTo(w, py);
    x.stroke();
  }
  x.globalAlpha = 0.25;
  x.beginPath();
  x.moveTo(0, horizon);
  x.lineTo(w, horizon);
  x.stroke();
  x.globalAlpha = 1;
}

/** Soft clouds drifting across, slowly. */
export function clouds(x: Ctx, w: number, h: number, t: number, p: Palette) {
  const rnd = seeded(83);
  x.fillStyle = p.light ? "#64748b" : "#cbd5e1";
  for (let i = 0; i < 7; i++) {
    const near = rnd();
    const y = h * (0.1 + rnd() * 0.6);
    const size = 30 + near * 50;
    const speed = 3 + near * 7;
    const span = w + size * 4;
    const cx = ((rnd() * span + t * speed) % span) - size * 2;
    const puffs = 4 + Math.floor(rnd() * 3);
    // One shape per cloud (the puffs joined, not stacked), flat at the bottom.
    x.globalAlpha = p.light ? 0.06 : 0.035 + near * 0.025;
    x.beginPath();
    for (let k = 0; k < puffs; k++) {
      const dx = (k - (puffs - 1) / 2) * size * 0.42;
      const r = size * (0.3 + 0.18 * Math.abs(Math.sin((k + 1) * 1.7 + i))) * (1 - Math.abs(k - (puffs - 1) / 2) / puffs);
      x.moveTo(cx + dx + r, y);
      x.arc(cx + dx, y, r, 0, Math.PI, true);
    }
    x.rect(cx - size * 0.42 * (puffs - 1) / 2, y - 0.5, size * 0.42 * (puffs - 1), size * 0.12);
    x.fill();
  }
  x.globalAlpha = 1;
}

/** Constellations: stars, and their figures drawn and undrawn in turn. */
export function constellations(x: Ctx, w: number, h: number, t: number, p: Palette) {
  const rnd = seeded(97);
  const n = Math.round(Math.min(90, (w * h) / 6500));
  x.fillStyle = p.ink;
  for (let i = 0; i < n; i++) {
    const sx = rnd() * w, sy = rnd() * h * 0.9, size = 0.5 + rnd() * 1.1, ph = rnd() * TAU;
    x.globalAlpha = 0.12 + 0.22 * (0.5 + 0.5 * Math.sin(t * 0.8 + ph));
    dot(x, sx, sy, size);
  }
  const figures = 4;
  for (let f = 0; f < figures; f++) {
    const r2 = seeded(300 + f);
    const fx = w * (0.12 + ((f + r2() * 0.6) / figures) * 0.76), fy = h * (0.15 + r2() * 0.55);
    const pts: [number, number][] = [];
    let px = fx, py = fy;
    for (let k = 0; k < 5; k++) {
      pts.push([px, py]);
      px += (r2() - 0.3) * 60;
      py += (r2() - 0.5) * 50;
    }
    // Each figure draws itself in, stays, and goes, on a 14 s cycle of its own.
    const cyc = ((t + f * 3.5) % 14) / 14;
    const show = cyc < 0.2 ? cyc / 0.2 : cyc < 0.7 ? 1 : cyc < 0.85 ? 1 - (cyc - 0.7) / 0.15 : 0;
    if (show <= 0) continue;
    x.strokeStyle = p.accent;
    x.lineWidth = 1;
    x.globalAlpha = 0.28 * show;
    x.beginPath();
    x.moveTo(pts[0][0], pts[0][1]);
    for (let k = 1; k < pts.length; k++) x.lineTo(pts[k][0], pts[k][1]);
    x.stroke();
    x.fillStyle = p.ink;
    x.globalAlpha = 0.6 * show;
    for (const [qx, qy] of pts) dot(x, qx, qy, 1.8);
  }
  x.globalAlpha = 1;
}

/** A heartbeat line running across, its head a little brighter. */
export function pulse(x: Ctx, w: number, h: number, t: number, p: Palette) {
  const cy = h * 0.5;
  const period = 220;
  const head = (t * 90) % (w + 80);
  const beat = (u: number) => {
    const k = ((u % period) + period) % period / period;
    if (k < 0.38 || k > 0.62) return 0;
    const s = (k - 0.38) / 0.24;
    return s < 0.2 ? -s * 0.6 : s < 0.35 ? (s - 0.2) * 9 - 0.12 : s < 0.5 ? 1.23 - (s - 0.35) * 14 : s < 0.7 ? -0.87 + (s - 0.5) * 4.6 : 0.05 * Math.sin(s * 20);
  };
  x.lineWidth = 1.4;
  x.lineJoin = "round";
  x.strokeStyle = p.light ? "#e11d48" : "#fb7185";
  const tail = Math.min(w * 0.7, 420);
  for (let seg = 0; seg < tail; seg += 6) {
    const a = head - seg;
    if (a < 0) break;
    x.globalAlpha = 0.45 * (1 - seg / tail);
    x.beginPath();
    x.moveTo(a, cy - beat(a) * h * 0.12);
    x.lineTo(a - 6, cy - beat(a - 6) * h * 0.12);
    x.stroke();
  }
  x.fillStyle = x.strokeStyle;
  x.globalAlpha = 0.7;
  dot(x, head, cy - beat(head) * h * 0.12, 2.2);
  x.globalAlpha = 1;
}

/** A field of tiny lines turning with an invisible wind. */
export function wind(x: Ctx, w: number, h: number, t: number, p: Palette) {
  const gap = 26;
  x.strokeStyle = p.dim;
  x.lineWidth = 1;
  x.lineCap = "round";
  for (let gy = gap / 2; gy < h; gy += gap) {
    for (let gx = gap / 2; gx < w; gx += gap) {
      const a = Math.sin(gx * 0.009 + t * 0.25) + Math.cos(gy * 0.011 - t * 0.2) + Math.sin((gx + gy) * 0.004 + t * 0.12);
      const len = 5 + 3 * Math.sin(a * 2 + t * 0.5);
      x.globalAlpha = 0.1 + 0.12 * (0.5 + 0.5 * Math.sin(a * 1.5));
      x.beginPath();
      x.moveTo(gx - Math.cos(a) * len, gy - Math.sin(a) * len);
      x.lineTo(gx + Math.cos(a) * len, gy + Math.sin(a) * len);
      x.stroke();
    }
  }
  x.globalAlpha = 1;
}

/** Falling leaves, turning as they drift down. */
export function leaves(x: Ctx, w: number, h: number, t: number, p: Palette) {
  const rnd = seeded(53);
  const colors = p.light ? ["#c2410c", "#b45309", "#a16207", "#4d7c0f"] : ["#fb923c", "#fbbf24", "#facc15", "#a3e635"];
  const n = Math.round(Math.max(10, Math.min(22, (w * h) / 16000)));
  for (let i = 0; i < n; i++) {
    const x0 = rnd() * w, y0 = rnd() * h, ph = rnd() * TAU, size = 4 + rnd() * 5, color = colors[Math.floor(rnd() * colors.length)];
    const speed = 12 + rnd() * 14;
    const py = (y0 + t * speed) % (h + 20) - 10;
    const px = x0 + Math.sin(t * 0.6 + ph) * 22;
    x.save();
    x.translate(px, py);
    x.rotate(Math.sin(t * 0.9 + ph) * 1.2);
    x.scale(1, 0.45 + 0.55 * Math.abs(Math.cos(t * 1.1 + ph)));
    x.globalAlpha = 0.3;
    x.fillStyle = color;
    x.beginPath();
    x.moveTo(0, -size);
    x.quadraticCurveTo(size * 0.8, 0, 0, size);
    x.quadraticCurveTo(-size * 0.8, 0, 0, -size);
    x.fill();
    x.restore();
  }
  x.globalAlpha = 1;
}

/** Lanterns rising slowly into the night, warm and flickering. */
export function lanterns(x: Ctx, w: number, h: number, t: number, p: Palette) {
  const rnd = seeded(67);
  const n = 12;
  for (let i = 0; i < n; i++) {
    const x0 = rnd() * w, y0 = rnd() * h, ph = rnd() * TAU, near = rnd();
    const speed = 5 + near * 9;
    const py = h + 20 - ((y0 + t * speed) % (h + 40));
    const px = x0 + Math.sin(t * 0.25 + ph) * 14;
    const s = 3 + near * 4;
    const flick = 0.8 + 0.2 * Math.sin(t * 7 + ph * 5);
    const fade = Math.min(1, py / (h * 0.4));
    const g = x.createRadialGradient(px, py, 0, px, py, s * 4);
    g.addColorStop(0, p.light ? `rgba(234,88,12,${0.22 * flick * fade})` : `rgba(251,146,60,${0.3 * flick * fade})`);
    g.addColorStop(1, "rgba(0,0,0,0)");
    x.fillStyle = g;
    x.globalAlpha = 1;
    dot(x, px, py, s * 4);
    x.globalAlpha = 0.55 * fade * flick;
    x.fillStyle = p.light ? "#ea580c" : "#fdba74";
    x.beginPath();
    x.roundRect(px - s * 0.55, py - s * 0.75, s * 1.1, s * 1.5, s * 0.35);
    x.fill();
  }
  x.globalAlpha = 1;
}
