// Fiamma, a little flame: a red outer flame, an orange one inside it, a
// yellow heart, a dark ember line at the base, a small orange droplet and a few
// sparks. A soft character (see character.ts) with the shared face. Everything
// was measured on the reference drawing (471×526 px, centre x = 233.5,
// y = 263, half-width 205.5, half-height 239): the numbers below are fractions
// of the half-width (x) and half-height (y). The drawing's own face is left out.
// Body-local coordinates: (0, 0) is the centre, `hw` the half-width, `hh` the
// half-height, y down, the base on y = hh.

import {
  glintEye, mix, rgba, type BodyLook, type Palette, type RGB, type SoftCharacter,
} from "./character";

/** The outer red #E6272E; with it the palette gives the yellow heart ≈ #FBCD04. */
export const FLAME_RED: RGB = [0.9, 0.153, 0.18];

/**
 * The outline: its distance from the centre every 2.8125°, clockwise on screen
 * from the right (index 32 = base, 96 = tip). Joined by a smooth periodic
 * curve it stays within 2 px of the 478 px tall drawing.
 */
const RADII = [
  0.962, 0.977, 0.981, 0.982, 0.985, 1.001, 1.04, 1.068, 1.088, 1.101, 1.112, 1.121, 1.127, 1.131, 1.137, 1.14,
  1.139, 1.135, 1.126, 1.12, 1.108, 1.098, 1.087, 1.074, 1.062, 1.054, 1.041, 1.031, 1.02, 1.016, 1.01, 1.006,
  1.005, 1.006, 1.005, 1.011, 1.016, 1.023, 1.032, 1.045, 1.056, 1.07, 1.079, 1.088, 1.1, 1.11, 1.121, 1.127,
  1.137, 1.141, 1.148, 1.145, 1.139, 1.132, 1.118, 1.106, 1.083, 1.047, 0.974, 0.965, 0.98, 0.992, 0.991, 0.987,
  0.976, 0.958, 0.917, 0.856, 0.802, 0.776, 0.776, 0.783, 0.788, 0.794, 0.798, 0.798, 0.799, 0.797, 0.797, 0.798,
  0.793, 0.785, 0.78, 0.772, 0.77, 0.766, 0.764, 0.764, 0.77, 0.774, 0.788, 0.812, 0.858, 0.927, 0.984, 0.998,
  0.992, 0.977, 0.959, 0.946, 0.931, 0.915, 0.901, 0.889, 0.879, 0.871, 0.859, 0.849, 0.841, 0.834, 0.825, 0.823,
  0.816, 0.812, 0.809, 0.808, 0.805, 0.803, 0.803, 0.8, 0.793, 0.794, 0.793, 0.806, 0.856, 0.898, 0.927, 0.948,
];

/** The inner layers, as x, y pairs going round each shape. */
const ORANGE = [
  0.097, -0.693, 0.13, -0.687, 0.146, -0.667, 0.148, -0.603, 0.139, -0.51, 0.151, -0.463, 0.171, -0.43, 0.212, -0.394,
  0.271, -0.361, 0.392, -0.31, 0.466, -0.261, 0.551, -0.17, 0.579, -0.115, 0.599, -0.032, 0.619, -0.003, 0.639, 0.013,
  0.655, 0.017, 0.716, 0.01, 0.752, 0.038, 0.766, 0.079, 0.762, 0.134, 0.766, 0.205, 0.816, 0.35, 0.82, 0.397,
  0.813, 0.429, 0.791, 0.473, 0.691, 0.579, 0.693, 0.603, 0.719, 0.622, 0.73, 0.638, 0.73, 0.663, 0.721, 0.681,
  0.69, 0.721, 0.657, 0.751, 0.556, 0.824, 0.488, 0.861, 0.433, 0.88, 0.358, 0.883, 0.066, 0.916, -0.075, 0.916,
  -0.431, 0.866, -0.484, 0.866, -0.523, 0.854, -0.636, 0.779, -0.739, 0.692, -0.791, 0.632, -0.819, 0.589, -0.831, 0.558,
  -0.835, 0.523, -0.821, 0.493, -0.769, 0.467, -0.752, 0.439, -0.781, 0.289, -0.783, 0.24, -0.781, 0.176, -0.759, 0.09,
  -0.721, 0.018, -0.69, -0.022, -0.571, -0.104, -0.54, -0.211, -0.483, -0.305, -0.413, -0.382, -0.276, -0.491, -0.011, -0.652,
  0.048, -0.681,
];
const YELLOW = [
  -0.059, -0.362, -0.034, -0.362, 0.016, -0.342, 0.114, -0.288, 0.218, -0.215, 0.335, -0.11, 0.406, -0.033, 0.468, 0.06,
  0.505, 0.149, 0.529, 0.305, 0.546, 0.315, 0.56, 0.315, 0.609, 0.303, 0.625, 0.314, 0.635, 0.339, 0.621, 0.461,
  0.579, 0.592, 0.547, 0.656, 0.49, 0.725, 0.436, 0.766, 0.331, 0.814, 0.222, 0.842, 0.08, 0.858, -0.046, 0.862,
  -0.202, 0.849, -0.335, 0.826, -0.45, 0.787, -0.529, 0.725, -0.57, 0.672, -0.603, 0.608, -0.63, 0.49, -0.625, 0.326,
  -0.607, 0.258, -0.577, 0.192, -0.529, 0.133, -0.466, 0.078, -0.246, -0.047, -0.186, -0.091, -0.137, -0.166, -0.108, -0.25,
  -0.097, -0.307, -0.08, -0.347,
];
/** The droplet of flame on the upper right. */
const DROPLET = [
  0.349, -0.607, 0.358, -0.607, 0.38, -0.592, 0.406, -0.561, 0.422, -0.528, 0.426, -0.51, 0.424, -0.483, 0.41, -0.461,
  0.391, -0.452, 0.369, -0.449, 0.347, -0.455, 0.333, -0.468, 0.322, -0.492, 0.319, -0.506, 0.322, -0.521, 0.335, -0.551,
  0.34, -0.597,
];
/** The dark ember line along the base. */
const EMBER = [
  -0.491, 0.868, -0.445, 0.866, -0.139, 0.912, -0.006, 0.919, 0.134, 0.912, 0.324, 0.887, 0.406, 0.883, 0.421, 0.887,
  0.422, 0.896, 0.39, 0.915, 0.277, 0.952, 0.178, 0.971, 0.046, 0.979, -0.1, 0.975, -0.255, 0.958, -0.335, 0.943,
  -0.47, 0.895, -0.492, 0.881,
];
/** Sparks: x, y and radius (× hh). */
const SPARKS = [
  0.049, -0.854, 0.0062, 0.414, -0.619, 0.0097, -0.407, -0.498, 0.0103, 0.845, -0.038, 0.0094,
  0.826, 0.054, 0.0100, -0.812, 0.288, 0.0088, -0.879, 0.377, 0.0094, 0.819, 0.563, 0.0078,
  0.025, -0.463, 0.0067, 0.002, -0.427, 0.0047, -0.234, -0.255, 0.0100, 0.046, 0.097, 0.0125,
  -0.079, 0.037, 0.0125, 0.123, -0.109, 0.0041,
];

/** The outline radius in direction `a` (Catmull-Rom through RADII, wrapping round). */
function radius(a: number): number {
  const n = RADII.length;
  const f = ((((a / (Math.PI * 2)) * n) % n) + n) % n;
  const i = Math.floor(f);
  const t = f - i;
  const p0 = RADII[(i - 1 + n) % n], p1 = RADII[i], p2 = RADII[(i + 1) % n], p3 = RADII[(i + 2) % n];
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
    (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
}

function flamePoint(ca: number, sa: number, hw: number, hh: number): { x: number; y: number } {
  const r = radius(Math.atan2(sa, ca));
  return { x: ca * r * hw, y: sa * r * hh };
}

/** The outer flame is the body colour; the orange and yellow lean towards fire from it. */
function flamePalette(base: RGB): Palette {
  return {
    light: mix(base, [0.995, 0.86, 0], 0.92),
    body: base,
    edge: mix(base, [0.3, 0, 0], 0.6),
  };
}

/** A closed shape through the points, rounded with curves through their midpoints. */
function shape(pts: number[], hw: number, hh: number): Path2D {
  const p = new Path2D();
  const n = pts.length / 2;
  const at = (i: number): [number, number] => [pts[(i % n) * 2] * hw, pts[(i % n) * 2 + 1] * hh];
  const mid = (i: number): [number, number] => {
    const [ax, ay] = at(i), [bx, by] = at(i + 1);
    return [(ax + bx) / 2, (ay + by) / 2];
  };
  p.moveTo(...mid(0));
  for (let i = 1; i <= n; i++) {
    const [cx, cy] = at(i);
    p.quadraticCurveTo(cx, cy, ...mid(i));
  }
  p.closePath();
  return p;
}

function drawFlameBody(x: CanvasRenderingContext2D, body: Path2D, hw: number, hh: number, look: BodyLook) {
  const pal = look.palette;
  const orange = rgba(mix(pal.body, [0.95, 0.6, 0], 0.9));

  // Flat colours, like the drawing: red, then orange, then the yellow heart.
  x.fillStyle = rgba(pal.body);
  x.fill(body);
  x.save();
  x.clip(body);
  x.fillStyle = orange;
  x.fill(shape(ORANGE, hw, hh));
  x.fillStyle = rgba(pal.light);
  x.fill(shape(YELLOW, hw, hh));
  x.fillStyle = rgba(pal.edge);
  x.fill(shape(EMBER, hw, hh));

  if (!look.simple) {
    const droplet = shape(DROPLET, hw, hh);
    x.fillStyle = orange;
    x.fill(droplet);
    x.strokeStyle = rgba(mix(pal.body, pal.edge, 0.5), 0.8);
    x.lineWidth = Math.max(0.5, hh * 0.006);
    x.stroke(droplet);

    const gloss = look.gloss ?? 1;
    if (gloss > 0.01) {
      x.fillStyle = `rgba(255,214,200,${0.95 * gloss})`;
      for (let i = 0; i < SPARKS.length; i += 3) {
        x.beginPath();
        x.arc(SPARKS[i] * hw, SPARKS[i + 1] * hh, Math.max(0.6, SPARKS[i + 2] * hh), 0, Math.PI * 2);
        x.fill();
      }
    }
  }
  x.restore();
}

/** Small round eyes with a white glint. */
function drawFlameEye(x: CanvasRenderingContext2D, r: number, open: number, ink: string) {
  glintEye(x, r * 0.78, r * 0.95, open, ink);
}

export const FLAME: SoftCharacter = {
  kind: "soft",
  id: "flame",
  name: "Fiamma",
  color: FLAME_RED,
  aspect: 0.86,
  wearsIntegrationColor: true,
  size: { hw: 0.86, hh: 1.0 },
  // The face sits low on the yellow heart, centred on it.
  face: { eyeSpread: 0.337, eyeDrop: 0.567, eyeRadius: 0.16, blushX: 0.34, blushY: 0.665 },
  wobbles: true,
  point: flamePoint,
  palette: flamePalette,
  drawBody: drawFlameBody,
  drawEye: drawFlameEye,
};
