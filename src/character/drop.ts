// Goccia, a little water spirit: a glossy drop, point up, round base. A soft
// character (see character.ts): this file is only its outline, its shading and
// its eye; pose, wobble, face and file morph come from the shared drawers.
// Body-local coordinates: (0, 0) is the centre, `hw` the half-width at its
// widest, `hh` the half-height, y down, the base on y = hh.

import {
  glintEye, mix, rgba, type BodyLook, type Palette, type RGB, type SoftCharacter,
} from "./character";

/** Body #4DB8FF; with it the palette gives light ≈ #9FE8FF and edge ≈ #1F6FB7. */
export const DROP_BLUE: RGB = [0.302, 0.722, 1.0];

function dropPalette(base: RGB): Palette {
  return {
    light: mix(base, [0.86, 1, 1], 0.55),
    body: base,
    edge: mix(base, [0, 0.2, 0.45], 0.6),
  };
}

/**
 * The outline is one smooth teardrop curve, no seams: with t running from the
 * point (t = 0) round the base (t = π) and back,
 *   x ∝ sin t · (sin²(t/2) + r²)^(m/2),   y = −cos t.
 * `m` > 1 makes the sides curve in a little towards the point, like a real
 * drop, and puts the widest part below the middle; `r` rounds the very tip.
 */
const TIP_M = 1.08;
const TIP_R = 0.2;

function teardrop(t: number): { x: number; y: number } {
  const s = Math.sin(t / 2);
  return { x: Math.sin(t) * Math.pow(s * s + TIP_R * TIP_R, TIP_M / 2), y: -Math.cos(t) };
}

/** The widest |x| of the raw curve, so that `hw` is the true half-width. */
const TEAR_W = (() => {
  let w = 0;
  for (let i = 0; i <= 400; i++) w = Math.max(w, Math.abs(teardrop((i / 400) * Math.PI * 2).x));
  return w;
})();

/** The outline point in direction (ca, sa): the angle, turned so that the point is up. */
function dropPoint(ca: number, sa: number, hw: number, hh: number): { x: number; y: number } {
  const t = Math.atan2(sa, ca) + Math.PI / 2;
  const p = teardrop(t);
  return { x: (p.x / TEAR_W) * hw, y: p.y * hh };
}

/** The outline from t0 to t1 (radians, see `teardrop`), pulled in towards the centre by `k`. */
function innerArc(hw: number, hh: number, t0: number, t1: number, k: number, cy = 0): Path2D {
  const p = new Path2D();
  const n = 24;
  for (let i = 0; i <= n; i++) {
    const q = teardrop(t0 + ((t1 - t0) * i) / n);
    const px = (q.x / TEAR_W) * hw * k;
    const py = cy + (q.y * hh - cy) * k;
    if (i === 0) p.moveTo(px, py);
    else p.lineTo(px, py);
  }
  return p;
}

function drawDropBody(x: CanvasRenderingContext2D, body: Path2D, hw: number, hh: number, look: BodyLook) {
  const pal = look.palette;
  // A defined edge, but thin: a thick one made it look like a sticker.
  const outline = Math.max(0.8, hh * 0.042);

  if (look.simple) {
    x.fillStyle = rgba(mix(pal.body, pal.light, 0.18));
    x.fill(body);
    x.save();
    x.clip(body);
    // One shine along the upper left, nothing near the eyes.
    x.strokeStyle = "rgba(255,255,255,0.7)";
    x.lineWidth = Math.max(1, hw * 0.16);
    x.lineCap = "round";
    x.stroke(innerArc(hw, hh, Math.PI * 2 - 1.25, Math.PI * 2 - 0.55, 0.7, hh * 0.2));
    x.restore();
    x.strokeStyle = rgba(pal.edge, 0.9);
    x.lineWidth = Math.max(0.7, hh * 0.06);
    x.lineJoin = "round";
    x.stroke(body);
    return;
  }

  // Water lit from the top left: light there, the body's blue lower down.
  const g = x.createLinearGradient(-hw * 0.65, -hh, hw * 0.55, hh);
  g.addColorStop(0, rgba(pal.light));
  g.addColorStop(0.34, rgba(mix(pal.light, pal.body, 0.3)));
  g.addColorStop(0.68, rgba(pal.body));
  g.addColorStop(1, rgba(mix(pal.body, pal.edge, 0.28)));
  x.fillStyle = g;
  x.fill(body);

  x.save();
  x.clip(body);

  // A faint glow in the upper part: the water lets the light through.
  const top = x.createRadialGradient(-hw * 0.15, -hh * 0.55, 0, -hw * 0.15, -hh * 0.55, hw * 0.95);
  top.addColorStop(0, "rgba(255,255,255,0.2)");
  top.addColorStop(0.55, "rgba(255,255,255,0.05)");
  top.addColorStop(1, "rgba(255,255,255,0)");
  x.fillStyle = top;
  x.fillRect(-hw * 1.2, -hh * 1.2, hw * 2.4, hh * 2.4);

  // A soft shade low on the right, where the drop is thickest.
  const sh = x.createRadialGradient(hw * 0.38, hh * 0.55, 0, hw * 0.38, hh * 0.55, hw * 0.95);
  sh.addColorStop(0, rgba(pal.edge, 0.24));
  sh.addColorStop(0.55, rgba(pal.edge, 0.08));
  sh.addColorStop(1, rgba(pal.edge, 0));
  x.fillStyle = sh;
  x.fillRect(-hw * 1.2, -hh * 1.2, hw * 2.4, hh * 2.4);

  // A light rim, very faint, all round.
  x.strokeStyle = rgba(pal.light, 0.28);
  x.lineWidth = outline * 2.2;
  x.stroke(body);

  // Light coming back up from the ground: a thin bright line inside the base,
  // what makes the drop read as clear water.
  x.lineCap = "round";
  // Kept close to the edge and short, or it reads as a mouth.
  x.strokeStyle = rgba(pal.light, 0.5);
  x.lineWidth = Math.max(1, hh * 0.035);
  x.stroke(innerArc(hw, hh, Math.PI - 0.5, Math.PI + 0.28, 0.94, hh * 0.2));

  const gloss = look.gloss ?? 1;
  if (gloss > 0.01) {
    x.globalAlpha = gloss;
    // The big shine: a crescent following the upper left of the outline,
    // brightest in the middle and fading at both ends.
    const arc = innerArc(hw, hh, Math.PI * 2 - 1.5, Math.PI * 2 - 0.42, 0.78, hh * 0.25);
    const fade = x.createLinearGradient(-hw * 0.2, -hh * 0.75, -hw * 0.75, hh * 0.15);
    fade.addColorStop(0, "rgba(255,255,255,0.15)");
    fade.addColorStop(0.35, "rgba(255,255,255,0.9)");
    fade.addColorStop(0.75, "rgba(255,255,255,0.55)");
    fade.addColorStop(1, "rgba(255,255,255,0)");
    x.strokeStyle = fade;
    x.lineWidth = hw * 0.15;
    x.stroke(arc);
    // A small one beside the point, on the other side.
    const sx = hw * 0.2, sy = -hh * 0.5;
    const small = x.createRadialGradient(sx, sy, 0, sx, sy, hw * 0.12);
    small.addColorStop(0, "rgba(255,255,255,0.8)");
    small.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = small;
    x.beginPath();
    x.ellipse(sx, sy, hw * 0.06, hh * 0.1, 0.55, 0, Math.PI * 2);
    x.fill();
    x.globalAlpha = 1;
  }
  x.restore();

  x.strokeStyle = rgba(pal.edge, 0.85);
  x.lineWidth = outline;
  x.lineJoin = "round";
  x.stroke(body);
}

/** Tall oval eyes with a white glint. */
function drawDropEye(x: CanvasRenderingContext2D, r: number, open: number, ink: string) {
  glintEye(x, r * 0.74, r * 1.08, open, ink);
}

export const DROP: SoftCharacter = {
  kind: "soft",
  id: "drop",
  name: "Goccia",
  color: DROP_BLUE,
  aspect: 0.88,
  wearsIntegrationColor: true,
  size: { hw: 0.88, hh: 1.0 },
  face: { eyeSpread: 0.46, eyeDrop: 0.34, eyeRadius: 0.22, blushX: 0.62, blushY: 0.62 },
  wobbles: true,
  point: dropPoint,
  palette: dropPalette,
  drawBody: drawDropBody,
  drawEye: drawDropEye,
};
