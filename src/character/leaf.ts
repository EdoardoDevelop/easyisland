// Foglia, a glossy leaf, after Edoardo's picture (its curled tip left out)
// (178×182 px): the outline is measured (128 radii, like the Geco), everything
// inside is drawn smooth where the picture has it: light at the top fading to
// a deeper green low down, a darker lower left with a teal glint along its edge,
// a light band inside the right edge, two shines, the veins and the little
// foot. A soft character (see character.ts) with the shared black eyes.
// Positions are in picture pixels (centre 92, 98.5; half-size 62 × 75.5) and
// turned into body units by `at`. The theme and the states tint every green.

import { mix, rgba, type BodyLook, type Palette, type RGB, type SoftCharacter } from "./character";

const RADII = [
  0.937, 0.955, 0.975, 0.996, 1.016, 1.032, 1.048, 1.064, 1.079, 1.089, 1.095, 1.099, 1.102, 1.101, 1.096, 1.087,
  1.071, 1.051, 1.041, 1.042, 1.041, 1.026, 0.999, 0.976, 0.977, 1.002, 1.025, 1.03, 1.022, 1.013, 1.007, 1.003,
  1.002, 1.003, 1.006, 1.008, 1.006, 0.998, 0.99, 0.988, 0.992, 1.001, 1.01, 1.018, 1.03, 1.043, 1.055, 1.064,
  1.072, 1.078, 1.081, 1.078, 1.073, 1.073, 1.079, 1.079, 1.071, 1.06, 1.046, 1.027, 1.005, 0.981, 0.959, 0.938,
  0.917, 0.895, 0.876, 0.858, 0.843, 0.827, 0.81, 0.793, 0.777, 0.763, 0.75, 0.741, 0.734, 0.728, 0.722, 0.718,
  0.716, 0.715, 0.712, 0.71, 0.711, 0.715, 0.717, 0.718, 0.72, 0.725, 0.733, 0.743, 0.755, 0.771, 0.788, 0.804,
  0.819, 0.846, 0.888, 0.936, 0.979, 1.014, 1.04, 1.047, 1.016, 0.947, 0.864, 0.797, 0.754, 0.731, 0.718, 0.71,
  0.707, 0.707, 0.713, 0.721, 0.729, 0.738, 0.75, 0.763, 0.777, 0.793, 0.811, 0.83, 0.85, 0.87, 0.893, 0.917,
];

/** The measured outline, smoothed: the picture's pixels would leave it ragged. */
const SMOOTH = (() => {
  let r = RADII;
  for (let k = 0; k < 6; k++) r = r.map((v, i) => (r[(i - 1 + r.length) % r.length] + 2 * v + r[(i + 1) % r.length]) / 4);
  return r;
})();

/** The outline radius in direction `a` (Catmull-Rom through SMOOTH, wrapping round). */
function radius(a: number): number {
  const n = SMOOTH.length;
  const f = ((((a / (Math.PI * 2)) * n) % n) + n) % n;
  const i = Math.floor(f);
  const t = f - i;
  const p0 = SMOOTH[(i - 1 + n) % n], p1 = SMOOTH[i], p2 = SMOOTH[(i + 1) % n], p3 = SMOOTH[(i + 2) % n];
  return 0.5 * (2 * p1 + (p2 - p0) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t +
    (3 * p1 - p0 - 3 * p2 + p3) * t * t * t);
}

/** The picture's own green; the theme or a state moves every colour by as much as the body. */
const BODY: RGB = [0.486, 0.839, 0.153];

function leafPalette(base: RGB): Palette {
  return { light: mix(base, [0.85, 1, 0.4], 0.5), body: base, edge: mix(base, [0, 0.2, 0], 0.65) };
}

/** How far the body has turned into the file box (the engine passes gloss = 1 − morph × 0.6). */
function morphOf(look: BodyLook): number {
  return Math.min(1, Math.max(0, (1 - (look.gloss ?? 1)) / 0.6));
}

/** The veins: a midrib from the foot to the top and six branches, each a curve (from, bend, to) with its widths. */
const VEINS: [number[], number, number][] = [
  [[86.7, 168, 82.5, 120, 89, 64], 3.0, 1.2],
  [[81.7, 100, 77, 93, 73.3, 88.3], 1.8, 0.8],
  [[83.3, 98.3, 90, 92, 96.7, 88.3], 1.8, 0.8],
  [[81.7, 140, 70, 133, 58.3, 121.7], 2.4, 0.9],
  [[86.7, 138.3, 100, 126, 111.7, 111.7], 2.6, 0.9],
  [[83.3, 156, 74, 151, 66, 141], 2.0, 0.8],
  [[88.3, 156, 97, 153, 105, 147], 1.8, 0.8],
];

function drawLeafBody(x: CanvasRenderingContext2D, body: Path2D, hw: number, hh: number, look: BodyLook) {
  const at = (px: number, py: number): [number, number] => [((px - 92) / 62) * hw, ((py - 98.5) / 75.5) * hh];
  const unit = hh / 75.5; // one pixel of the picture
  const dx = look.palette.body.map((v, i) => v - BODY[i]);
  const col = (c: number[], a = 1) => rgba([
    Math.min(1, Math.max(0, c[0] / 255 + dx[0])),
    Math.min(1, Math.max(0, c[1] / 255 + dx[1])),
    Math.min(1, Math.max(0, c[2] / 255 + dx[2])),
  ], a);
  const morph = morphOf(look);
  const soft = (cx: number, cy: number, rx: number, ry: number, c: number[], a: number) => {
    const [px, py] = at(cx, cy);
    x.save();
    x.translate(px, py);
    x.scale(1, ry / rx);
    const g = x.createRadialGradient(0, 0, 0, 0, 0, rx * unit);
    g.addColorStop(0, col(c, a));
    g.addColorStop(1, col(c, 0));
    x.fillStyle = g;
    x.fillRect(-rx * unit, -rx * unit, rx * unit * 2, rx * unit * 2);
    x.restore();
  };

  // The foot, behind the leaf: only its bottom shows.
  if (morph < 0.98) {
    const [fx, fy] = at(76, 163);
    x.save();
    x.globalAlpha = 1 - morph;
    x.fillStyle = col([60, 160, 30]);
    x.strokeStyle = col([34, 116, 13]);
    x.lineWidth = Math.max(0.6, 2.4 * unit);
    x.beginPath();
    x.roundRect(fx, fy, 28 * unit, 11 * unit, 4 * unit);
    x.fill();
    x.stroke();
    x.restore();
  }

  // Light at the top, the picture's green in the middle, deeper towards the foot.
  const g = x.createLinearGradient(0, at(0, 25)[1], 0, at(0, 172)[1]);
  g.addColorStop(0, col([200, 244, 60]));
  g.addColorStop(0.3, col([184, 240, 58]));
  g.addColorStop(0.55, col([152, 230, 50]));
  g.addColorStop(0.8, col([104, 202, 38]));
  g.addColorStop(1, col([70, 176, 30]));
  x.fillStyle = g;
  x.fill(body);

  x.save();
  x.clip(body);
  // The darker lower left, the light band inside the right edge, the lighter lower right.
  soft(55, 150, 38, 28, [66, 172, 28], 1);
  soft(118, 140, 20, 26, [158, 232, 44], 0.8);
  soft(133, 122, 6, 26, [168, 236, 52], 0.7);
  // The rim: a band of deeper green just inside the outline.
  x.strokeStyle = col([70, 162, 26], 0.75);
  x.lineWidth = 10 * unit;
  x.stroke(body);
  // The teal glint along the lower left edge.
  x.save();
  x.beginPath();
  x.rect(...at(30, 128), 34 * unit, 42 * unit);
  x.clip();
  x.strokeStyle = col([104, 236, 168], 0.85);
  x.lineWidth = 6 * unit;
  x.stroke(body);
  x.restore();

  // The veins, darker and soft: a wide faint band under a narrower line.
  x.lineCap = "round";
  for (const [shade, widen] of [[col([100, 196, 36], 0.55), 2.3], [col([92, 186, 32], 0.95), 1.3]] as [string, number][]) {
  x.strokeStyle = shade;
  for (const [p, w0, w1] of VEINS) {
    const [ax, ay] = at(p[0], p[1]), [cx, cy] = at(p[2], p[3]), [bx, by] = at(p[4], p[5]);
    const n = 14;
    let px = ax, py = ay;
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const qx = (1 - t) * (1 - t) * ax + 2 * (1 - t) * t * cx + t * t * bx;
      const qy = (1 - t) * (1 - t) * ay + 2 * (1 - t) * t * cy + t * t * by;
      x.lineWidth = Math.max(0.6, (w0 + (w1 - w0) * t) * widen * unit);
      x.beginPath();
      x.moveTo(px, py);
      x.lineTo(qx, qy);
      x.stroke();
      px = qx;
      py = qy;
    }
  }
  }

  // Two shines: a slanted streak on the upper left, an oval on the upper right.
  const gloss = (look.gloss ?? 1);
  if (gloss > 0.01 && !look.simple) {
    x.globalAlpha = gloss;
    for (const [cx, cy, rx, ry, rot, c] of [
      [63, 82, 4.2, 9.5, 0.5, [240, 252, 201]],
      [114, 82, 7, 5.2, -0.6, [233, 249, 164]],
    ] as [number, number, number, number, number, number[]][]) {
      const [px, py] = at(cx, cy);
      x.fillStyle = rgba([c[0] / 255, c[1] / 255, c[2] / 255], 0.95);
      x.beginPath();
      x.ellipse(px, py, rx * unit, ry * unit, rot, 0, Math.PI * 2);
      x.fill();
    }
    soft(64, 82, 9, 12, [240, 252, 201], 0.35);
    soft(114, 83, 10, 11, [233, 249, 164], 0.3);
    x.globalAlpha = 1;
  }
  x.restore();

  // The dark outline.
  x.strokeStyle = col([34, 116, 13]);
  x.lineWidth = Math.max(0.7, 2.2 * unit);
  x.lineJoin = "round";
  x.stroke(body);

}

/** The sheet's big black oval eyes, a little lighter low down, with a glint. */
function drawLeafEye(x: CanvasRenderingContext2D, r: number, open: number) {
  const ry = (r / Math.cos(FOGLIA.face.eyeDrop)) * Math.max(0.1, open);
  const rx = (r * 0.62) / Math.cos(FOGLIA.face.eyeSpread);
  const g = x.createLinearGradient(0, -ry, 0, ry);
  g.addColorStop(0, "rgb(8,8,12)");
  g.addColorStop(0.6, "rgb(14,14,20)");
  g.addColorStop(1, "rgb(52,54,64)");
  x.fillStyle = g;
  x.beginPath();
  x.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
  x.fill();
  if (open > 0.45) {
    x.fillStyle = "rgba(255,255,255,0.96)";
    x.beginPath();
    x.ellipse(0.08 * rx, -0.5 * ry, 0.42 * rx, 0.42 * rx * Math.min(1, open), 0, 0, Math.PI * 2);
    x.fill();
  }
}

export const FOGLIA: SoftCharacter = {
  kind: "soft",
  id: "leaf",
  name: "Foglia",
  color: BODY,
  aspect: 0.821,
  wearsIntegrationColor: true,
  size: { hw: 0.821, hh: 1.0 },
  face: { eyeSpread: 0.42, eyeDrop: 0.2, eyeRadius: 0.2, blushX: 0.55, blushY: 0.55 },
  wobbles: true,
  point: (ca, sa, hw, hh) => {
    const r = radius(Math.atan2(sa, ca));
    return { x: ca * r * hw, y: sa * r * hh };
  },
  palette: leafPalette,
  drawBody: drawLeafBody,
  drawEye: (x, r, open) => drawLeafEye(x, r, open),
};
