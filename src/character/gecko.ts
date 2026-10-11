// Geco, a little gecko head: two domes on top holding big amber eyes, a cream
// chin. A soft character (see character.ts). The outline and every feature were
// measured on the reference drawing (134×92 px, symmetric about x = 67.85,
// centre y = 49.63, half-width 66.29, half-height 45.05), so the numbers below
// are fractions of the half-width (x) and half-height (y), left eye; the right
// one is its mirror image.
// Body-local coordinates: (0, 0) is the centre, `hw` the half-width, `hh` the
// half-height, y down, the chin on y = hh.

import { mix, rgba, type BodyLook, type Palette, type RGB, type SoftCharacter } from "./character";

/** Body #96D930; with it the palette gives light ≈ #BFEB41 and edge ≈ #1D590A. */
export const GECKO_GREEN: RGB = [0.59, 0.85, 0.19];

/**
 * The outline: its distance from the centre every 3.75°, clockwise on screen
 * from the right (index 24 = chin, 62 and 82 = the domes, 72 = between them),
 * to the outer edge of the dark outline. Joined by a smooth periodic curve, it
 * stays within half a pixel of the drawing.
 */
const RADII = [
  0.97, 0.989, 1.007, 1.02, 1.033, 1.041, 1.049, 1.052, 1.055, 1.056, 1.054, 1.053,
  1.049, 1.044, 1.04, 1.034, 1.03, 1.03, 1.015, 1.009, 1.006, 1.003, 1.001, 0.998,
  1.0, 0.998, 1.001, 1.003, 1.006, 1.009, 1.015, 1.03, 1.03, 1.034, 1.04, 1.044,
  1.049, 1.053, 1.054, 1.056, 1.055, 1.052, 1.049, 1.041, 1.033, 1.02, 1.007, 0.989,
  0.97, 0.96, 0.973, 0.986, 1.0, 1.014, 1.029, 1.044, 1.06, 1.075, 1.092, 1.108,
  1.123, 1.135, 1.143, 1.143, 1.133, 1.115, 1.075, 1.007, 0.905, 0.874, 0.878, 0.882,
  0.887, 0.882, 0.878, 0.874, 0.905, 1.007, 1.075, 1.115, 1.133, 1.143, 1.143, 1.135,
  1.123, 1.108, 1.092, 1.075, 1.06, 1.044, 1.029, 1.014, 1.0, 0.986, 0.973, 0.96,
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

function geckoPoint(ca: number, sa: number, hw: number, hh: number): { x: number; y: number } {
  const r = radius(Math.atan2(sa, ca));
  return { x: ca * r * hw, y: sa * r * hh };
}

function geckoPalette(base: RGB): Palette {
  return {
    light: mix(base, [0.86, 0.97, 0.3], 0.6),
    body: base,
    edge: mix(base, [0.05, 0.28, 0.02], 0.88),
  };
}

// ── The face, measured on the drawing (left side) ─────────────────────────────

/** The amber eyeball, set in its dome; its top leans towards the middle. */
const EYE = { x: -0.6426, y: -0.2581, rx: 0.2791, ry: 0.4995, tilt: 0.08 };
/** The pupil at rest, touching the eyeball's inner side; the engine's eye sits here. */
const PUPIL = { x: -0.5861, y: -0.2692, rx: 0.2157, ry: 0.3774 };
/** The round glint on the pupil (offset from the pupil's centre) and its radius (× hh). */
const GLINT = { dx: 0.0453, dy: -0.222, r: 0.0932 };
/** How far the pupil follows the engine's gaze: the eyeball itself stays in its dome. */
const GAZE = 0.35;

const CREAM: RGB = [1.0, 0.96, 0.66];
const CREAM_EDGE: RGB = [0.86, 0.8, 0.41];
/** The eyeball, orange high up on its outer side, yellow at the bottom. */
const AMBER_STOPS: [number, string][] = [
  [0, "rgb(246,196,64)"],
  [0.4, "rgb(244,176,28)"],
  [0.72, "rgb(246,190,30)"],
  [1, "rgb(250,214,40)"],
];

/** The cream chin's upper edge, from the middle out to the left side. */
const BELLY_TOP: [number, number][] = [
  [0, 0.086], [-0.181, 0.1415], [-0.3017, 0.2303], [-0.4224, 0.3191],
  [-0.5582, 0.4078], [-0.6638, 0.4522], [-0.6924, 0.5188],
];
/** Below that, half an ellipse running down to the chin. */
const BELLY_LOW = { y: 0.5188, rx: 0.6924, ry: 0.4218 };

/** An arc of the eyeball's ellipse grown by `k`, from a0 to a1 on the left eye, mirrored for the right. */
function eyeArc(p: Path2D, s: number, hw: number, hh: number, k: number, a0: number, a1: number) {
  const [b0, b1] = s < 0 ? [a0, a1] : [Math.PI - a1, Math.PI - a0];
  p.ellipse(-s * EYE.x * hw, EYE.y * hh, EYE.rx * hw * k, EYE.ry * hh * k, -s * EYE.tilt, b0, b1);
}

function eyeballPath(s: number, hw: number, hh: number): Path2D {
  const p = new Path2D();
  eyeArc(p, s, hw, hh, 1, 0, Math.PI * 2);
  return p;
}

function bellyPath(hw: number, hh: number): Path2D {
  const p = new Path2D();
  const pts = BELLY_TOP;
  // The arch, right half (s = 1) then left (s = −1): quadratic curves through the midpoints.
  const side = (s: number, from: number, to: number) => {
    const step = from < to ? 1 : -1;
    for (let i = from; i !== to; i += step) {
      const [ax, ay] = pts[i], [bx, by] = pts[i + step];
      p.quadraticCurveTo(-s * ax * hw, ay * hh, -s * ((ax + bx) / 2) * hw, ((ay + by) / 2) * hh);
    }
    const [lx, ly] = pts[to];
    p.lineTo(-s * lx * hw, ly * hh);
  };
  p.moveTo(0, pts[0][1] * hh);
  side(1, 0, pts.length - 1);
  p.ellipse(0, BELLY_LOW.y * hh, BELLY_LOW.rx * hw, BELLY_LOW.ry * hh, 0, 0, Math.PI);
  side(-1, pts.length - 1, 0);
  p.closePath();
  return p;
}

/** The dark lid crease over the top and the inner side of the eyeball. */
function lidCrease(x: CanvasRenderingContext2D, s: number, hw: number, hh: number, pal: Palette, a: number) {
  const lid = new Path2D();
  eyeArc(lid, s, hw, hh, 1.04, -2.45, -0.16);
  x.strokeStyle = rgba(pal.edge, 0.65 * a);
  x.lineWidth = hh / 45.05 * 1.7;
  x.stroke(lid);
}

function softDot(x: CanvasRenderingContext2D, cx: number, cy: number, r: number, c: RGB, a: number) {
  const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
  g.addColorStop(0, rgba(c, a));
  g.addColorStop(1, rgba(c, 0));
  x.fillStyle = g;
  x.fillRect(cx - r, cy - r, r * 2, r * 2);
}

/**
 * The body transform at the last `drawBody`, with its size and look. `drawEye`
 * only gets its own small frame, scaled by the engine's head turn; it goes back
 * to this one to keep the pupil inside the eyeball and to know which eye it is.
 * `morph` is how far the body has turned into the box that swallows a file:
 * the engine and the file drop both pass gloss = 1 − morph × 0.6.
 */
let frame: {
  m: DOMMatrix; hw: number; hh: number; pal: Palette; simple: boolean; morph: number;
} | null = null;

function drawGeckoBody(x: CanvasRenderingContext2D, body: Path2D, hw: number, hh: number, look: BodyLook) {
  const pal = look.palette;
  const morph = Math.min(1, Math.max(0, (1 - (look.gloss ?? 1)) / 0.6));
  frame = { m: x.getTransform(), hw, hh, pal, simple: !!look.simple, morph };
  const px = hh / 45.05; // one pixel of the drawing
  const outline = Math.max(0.9, px * 2.8);

  if (look.simple) {
    x.fillStyle = rgba(mix(pal.body, pal.light, 0.35));
    x.fill(body);
    x.save();
    x.clip(body);
    x.fillStyle = rgba(CREAM);
    x.fill(bellyPath(hw, hh));
    x.restore();
    x.strokeStyle = rgba(pal.edge);
    x.lineWidth = Math.max(0.8, px * 3.6);
    x.lineJoin = "round";
    x.stroke(body);
    return;
  }

  // Lit from above: yellow-green on the forehead and domes, deeper green low down.
  const g = x.createLinearGradient(0, -hh, 0, hh);
  g.addColorStop(0, rgba(pal.light));
  g.addColorStop(0.45, rgba(mix(pal.light, pal.body, 0.55)));
  g.addColorStop(1, rgba(mix(pal.body, pal.edge, 0.3)));
  x.fillStyle = g;
  x.fill(body);

  x.save();
  x.clip(body);

  // The forehead bulges towards the light.
  softDot(x, 0, -0.3 * hh, hw * 0.55, pal.light, 0.6);
  // Shade inside the rim, all round.
  x.strokeStyle = rgba(pal.edge, 0.14);
  x.lineWidth = px * 12;
  x.stroke(body);
  // Warm yellow on top of the domes and a spot between them.
  for (const s of [-1, 1]) softDot(x, s * 0.4805 * hw, -0.9462 * hh, px * 6.5, [0.97, 0.82, 0.18], 0.75);
  softDot(x, 0, -0.7687 * hh, px * 3.6, [0.93, 0.75, 0.12], 0.9);

  // The cream chin, darker where it turns under.
  const belly = bellyPath(hw, hh);
  const bg = x.createRadialGradient(0, 0.42 * hh, 0, 0, 0.42 * hh, hw * 0.75);
  bg.addColorStop(0, rgba(CREAM));
  bg.addColorStop(0.7, rgba(mix(CREAM, CREAM_EDGE, 0.35)));
  bg.addColorStop(1, rgba(CREAM_EDGE));
  x.fillStyle = bg;
  x.fill(belly);

  for (const s of [-1, 1]) {
    // The dome around each eye: the amber eyeball comes with drawEye, so a
    // closed or drawn eye (sleeping, happy, dizzy) sits on green.
    x.lineCap = "round";
    lidCrease(x, s, hw, hh, pal, 1 - morph);
    x.strokeStyle = rgba(pal.edge, 0.5 * (1 - morph));
    x.lineWidth = px * 1.6;
    const fold = new Path2D();
    eyeArc(fold, s, hw, hh, 1.14, 2.2, 2.62);
    x.stroke(fold);
  }

  const gloss = look.gloss ?? 1;
  if (gloss > 0.01) {
    x.globalAlpha = gloss;
    x.fillStyle = "rgba(255,255,253,0.95)";
    // The big shine on the forehead.
    x.beginPath();
    x.ellipse(0, -0.5777 * hh, 0.0784 * hw, 0.0755 * hh, 0, 0, Math.PI * 2);
    x.fill();
    for (const s of [-1, 1]) {
      // A streak on each dome, leaning towards the middle.
      x.beginPath();
      x.ellipse(s * 0.39 * hw, -0.8308 * hh, 0.0528 * hw, 0.0289 * hh, -s * 0.3, 0, Math.PI * 2);
      x.fill();
      // Where the domes meet the forehead.
      softDot(x, s * 0.129 * hw, -0.5622 * hh, px * 2.2, [1, 1, 1], 0.55);
    }
    softDot(x, 0, -0.1915 * hh, px * 1.6, [1, 1, 1], 0.5);
    x.globalAlpha = 1;
  }

  // The dark outline, all of it inside the edge as in the drawing.
  // Dark on the sides and below, olive where the light catches the top.
  const og = x.createLinearGradient(0, -hh, 0, 0);
  og.addColorStop(0, rgba(mix(pal.edge, [0.72, 0.78, 0.04], 0.8)));
  og.addColorStop(0.35, rgba(mix(pal.edge, [0.5, 0.65, 0.08], 0.55)));
  og.addColorStop(1, rgba(mix(pal.edge, [0, 0, 0], 0.25)));
  x.strokeStyle = og;
  x.lineWidth = outline * 2.4;
  x.lineJoin = "round";
  x.stroke(body);

  // Nostrils.
  x.fillStyle = rgba(mix(pal.edge, [0, 0, 0], 0.4));
  for (const s of [-1, 1]) {
    x.beginPath();
    x.ellipse(s * 0.1245 * hw, -0.1049 * hh, px * 1.5, px * 1.15, s * 0.6, 0, Math.PI * 2);
    x.fill();
  }
  x.restore();
}

/**
 * The amber eyeball and its pupil, back in the body's frame: the engine's eye
 * position says which eye this is and where it looks; the pupil follows a part
 * of that, the eyeball stays put in its dome. A blink brings the lid down.
 */
function drawGeckoEye(x: CanvasRenderingContext2D, r: number, open: number, ink: string) {
  const f = frame;
  if (!f) {
    x.fillStyle = ink;
    x.beginPath();
    x.ellipse(0, 0, r * 0.8, r * Math.max(0.12, open), 0, 0, Math.PI * 2);
    x.fill();
    return;
  }
  const { hw, hh } = f;
  const at = f.m.inverse().multiply(x.getTransform());
  const s = at.e < 0 ? -1 : 1;
  // How big the engine wants this eye compared with the rest size (emotes, "wide", minis).
  const R = hw / GECKO.size.hw;
  const k = Math.min(1.25, r / (R * GECKO.face.eyeRadius));
  const restX = -s * PUPIL.x * hw, restY = PUPIL.y * hh;
  const dx = at.e - restX, dy = at.f - restY;
  const m = f.morph;
  const px = restX + dx * GAZE * (1 - m);
  const py = restY + dy * GAZE * (1 - m);
  const prx = PUPIL.rx * hw * k, pry = PUPIL.ry * hh * k;

  x.save();
  x.setTransform(f.m);
  if (m > 0) {
    // Into the box: the whole eye goes where the engine puts it, smaller.
    const ex = -s * EYE.x * hw, ey = EYE.y * hh, sc = 1 - 0.45 * m;
    x.translate(ex + dx * m, ey + dy * m);
    x.scale(sc, sc);
    x.translate(-ex, -ey);
  }
  const ball = eyeballPath(s, hw, hh);
  x.clip(ball);
  if (f.simple) {
    x.fillStyle = "rgb(245,184,30)";
  } else {
    const ex = -s * EYE.x * hw, erx = EYE.rx * hw, ey = EYE.y * hh, ery = EYE.ry * hh;
    const eg = x.createLinearGradient(ex + s * erx * 0.7, ey - ery * 0.9, ex - s * erx * 0.2, ey + ery);
    for (const [o, c] of AMBER_STOPS) eg.addColorStop(o, c);
    x.fillStyle = eg;
  }
  x.fill(ball);

  x.fillStyle = ink;
  x.beginPath();
  x.ellipse(px, py, prx, pry, 0, 0, Math.PI * 2);
  x.fill();
  // Dark green light in the bottom of the pupil.
  x.save();
  x.beginPath();
  x.ellipse(px, py, prx, pry, 0, 0, Math.PI * 2);
  x.clip();
  x.translate(px + s * prx * 0.13, py + pry * 0.7);
  x.scale(1, 0.62);
  const dg = x.createRadialGradient(0, 0, 0, 0, 0, prx * 0.92);
  dg.addColorStop(0, "rgba(40,82,36,0.95)");
  dg.addColorStop(0.6, "rgba(36,70,34,0.6)");
  dg.addColorStop(1, "rgba(36,70,34,0)");
  x.fillStyle = dg;
  x.fillRect(-prx, -prx, prx * 2, prx * 2);
  x.restore();

  if (open > 0.4) {
    // The round glint, and the light along the top of the eyeball.
    x.fillStyle = "rgba(252,252,252,0.97)";
    x.beginPath();
    x.arc(px - s * GLINT.dx * hw, py + GLINT.dy * hh, GLINT.r * hh * k, 0, Math.PI * 2);
    x.fill();
    x.lineCap = "round";
    const shine = new Path2D();
    eyeArc(shine, s, hw, hh, 0.88, -2.53, -1.0);
    x.strokeStyle = "rgba(250,246,220,0.45)";
    x.lineWidth = hh / 45.05 * 5.5;
    x.stroke(shine);
    x.strokeStyle = "rgba(255,255,250,0.75)";
    x.lineWidth = hh / 45.05 * 3;
    x.stroke(shine);
  }

  if (open < 0.98) {
    // The lid: green coming down from the top, with its dark edge.
    const ey = EYE.y * hh, ery = EYE.ry * hh * 1.05;
    const edge = ey - ery + (1 - Math.max(0, open)) * ery * 2.05;
    const lg = x.createLinearGradient(0, ey - ery, 0, ey + ery);
    lg.addColorStop(0, rgba(f.pal.light));
    lg.addColorStop(1, rgba(mix(f.pal.light, f.pal.body, 0.6)));
    x.fillStyle = lg;
    x.fillRect(-hw * 2, ey - ery * 1.2, hw * 4, edge - (ey - ery * 1.2));
    x.strokeStyle = rgba(f.pal.edge, 0.9);
    x.lineWidth = hh / 45.05 * 2.4;
    x.beginPath();
    x.moveTo(-hw * 2, edge);
    x.lineTo(hw * 2, edge);
    x.stroke();
  }
  // The inner half of the crease, which the eyeball just covered.
  if (!f.simple && m < 1) lidCrease(x, s, hw, hh, f.pal, 1 - m);
  x.restore();
}

export const GECKO: SoftCharacter = {
  kind: "soft",
  id: "gecko",
  name: "Geco",
  color: GECKO_GREEN,
  aspect: 1.472,
  wearsIntegrationColor: true,
  size: { hw: 1.177, hh: 0.8 },
  // The engine's eye at rest sits on the pupil: sin(0.665) × 0.95 = 0.586, sin(−0.287) × 0.95 = −0.269.
  face: { eyeSpread: 0.665, eyeDrop: -0.287, eyeRadius: 0.28, blushX: 0.72, blushY: 0.38 },
  wobbles: true,
  point: geckoPoint,
  palette: geckoPalette,
  drawBody: drawGeckoBody,
  drawEye: drawGeckoEye,
};
