// A family of jelly blobs: the same round, glossy body shaded like the Goccia
// (light from the top left, a crescent shine, a thin outline) with something of their own:
// Magma (glowing cracks), Pietra (slate spikes and crystals), Roccia (a shell of
// plates) and Foglia (a crown of leaves). Soft characters (see character.ts)
// with the shared face, drawn here from scratch.
// Body-local coordinates: (0, 0) is the centre, `hw` the half-width at the
// widest, `hh` the half-height, y down, the base on y = hh. What sticks out of
// the body (spikes, leaves) is drawn outside the outline and fades into the
// file box.

import { glintEye, mix, rgba, type BodyLook, type Palette, type RGB, type SoftCharacter } from "./character";

/** The body: a round top a little narrower than the round, gently flattened bottom. */
function eggPoint(ca: number, sa: number, hw: number, hh: number): { x: number; y: number } {
  const e = sa < 0 ? 0.96 : 0.86;
  const px = Math.sign(ca) * Math.pow(Math.abs(ca), e);
  const py = Math.sign(sa) * Math.pow(Math.abs(sa), e);
  const k = (py + 1) / 2; // 0 top … 1 base
  const width = 0.95 + 0.05 * Math.sin(Math.min(1, k * 1.5) * Math.PI / 2);
  return { x: px * hw * width, y: py * hh };
}

/** The outline from a0 to a1 (radians), pulled in towards (0, cy) by `k`. */
function innerArc(hw: number, hh: number, a0: number, a1: number, k: number, cy = 0): Path2D {
  const p = new Path2D();
  const n = 24;
  for (let i = 0; i <= n; i++) {
    const a = a0 + ((a1 - a0) * i) / n;
    const q = eggPoint(Math.cos(a), Math.sin(a), hw, hh);
    const px = q.x * k, py = cy + (q.y - cy) * k;
    if (i === 0) p.moveTo(px, py);
    else p.lineTo(px, py);
  }
  return p;
}

function eggPalette(base: RGB): Palette {
  return {
    light: mix(base, [1, 1, 1], 0.45),
    body: base,
    edge: mix(base, [0, 0, 0], 0.45),
  };
}

/** How far the body has turned into the file box (the engine passes gloss = 1 − morph × 0.6). */
function morphOf(look: BodyLook): number {
  return Math.min(1, Math.max(0, (1 - (look.gloss ?? 1)) / 0.6));
}

/** A closed polygon from x, y pairs given in units of hw and hh. */
function poly(pts: number[], hw: number, hh: number, s = 1): Path2D {
  const p = new Path2D();
  for (let i = 0; i < pts.length; i += 2) {
    const x = s * pts[i] * hw, y = pts[i + 1] * hh;
    if (i === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  p.closePath();
  return p;
}

interface Blob {
  id: string;
  name: string;
  color: RGB;
  /** The light rim round the egg; by default a lighter body colour. */
  rim?: (pal: Palette) => RGB;
  size: { hw: number; hh: number };
  /** Drawn before the egg: what sticks out behind it. */
  behind?: (x: CanvasRenderingContext2D, hw: number, hh: number, look: BodyLook) => void;
  /** Drawn on the egg, clipped to it. */
  inside?: (x: CanvasRenderingContext2D, hw: number, hh: number, look: BodyLook) => void;
  /** Drawn last, over the egg's edge. */
  front?: (x: CanvasRenderingContext2D, hw: number, hh: number, look: BodyLook) => void;
}

function drawEgg(b: Blob, x: CanvasRenderingContext2D, body: Path2D, hw: number, hh: number, look: BodyLook) {
  const pal = look.palette;
  const morph = morphOf(look);
  x.lineJoin = "round";
  x.lineCap = "round";

  if (b.behind && morph < 0.98) {
    x.save();
    x.globalAlpha = 1 - morph;
    b.behind(x, hw, hh, look);
    x.restore();
  }

  const rim = b.rim ? b.rim(pal) : mix(pal.body, pal.light, 0.55);
  const outline = Math.max(0.8, hh * 0.042);

  if (look.simple) {
    x.fillStyle = rgba(mix(pal.body, pal.light, 0.18));
    x.fill(body);
    x.save();
    x.clip(body);
    if (b.inside) b.inside(x, hw, hh, look);
    x.restore();
    x.strokeStyle = rgba(pal.edge, 0.9);
    x.lineWidth = Math.max(0.7, hh * 0.06);
    x.stroke(body);
  } else {
    // Jelly lit from the top left, as the Goccia: light there, deeper low on the right.
    const g = x.createLinearGradient(-hw * 0.65, -hh, hw * 0.55, hh);
    g.addColorStop(0, rgba(pal.light));
    g.addColorStop(0.34, rgba(mix(pal.light, pal.body, 0.35)));
    g.addColorStop(0.68, rgba(pal.body));
    g.addColorStop(1, rgba(mix(pal.body, pal.edge, 0.3)));
    x.fillStyle = g;
    x.fill(body);

    x.save();
    x.clip(body);
    // A faint glow high up, a soft shade low on the right.
    const top = x.createRadialGradient(-hw * 0.15, -hh * 0.5, 0, -hw * 0.15, -hh * 0.5, hw * 0.95);
    top.addColorStop(0, "rgba(255,255,255,0.2)");
    top.addColorStop(0.55, "rgba(255,255,255,0.05)");
    top.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = top;
    x.fillRect(-hw * 1.2, -hh * 1.2, hw * 2.4, hh * 2.4);
    const sh = x.createRadialGradient(hw * 0.38, hh * 0.55, 0, hw * 0.38, hh * 0.55, hw * 0.95);
    sh.addColorStop(0, rgba(pal.edge, 0.26));
    sh.addColorStop(0.55, rgba(pal.edge, 0.08));
    sh.addColorStop(1, rgba(pal.edge, 0));
    x.fillStyle = sh;
    x.fillRect(-hw * 1.2, -hh * 1.2, hw * 2.4, hh * 2.4);

    if (b.inside) b.inside(x, hw, hh, look);

    // A light rim, faint, all round, and light coming back up inside the base.
    x.strokeStyle = rgba(rim, 0.45);
    x.lineWidth = outline * 2.6;
    x.stroke(body);
    x.strokeStyle = rgba(pal.light, 0.45);
    x.lineWidth = Math.max(1, hh * 0.035);
    x.stroke(innerArc(hw, hh, Math.PI * 0.32, Math.PI * 0.62, 0.93, hh * 0.2));

    const gloss = look.gloss ?? 1;
    if (gloss > 0.01) {
      x.globalAlpha = gloss;
      // The big shine following the upper left of the outline, and a small one on the right.
      const arc = innerArc(hw, hh, Math.PI * 1.08, Math.PI * 1.42, 0.8, hh * 0.15);
      const fade = x.createLinearGradient(-hw * 0.2, -hh * 0.8, -hw * 0.8, hh * 0.1);
      fade.addColorStop(0, "rgba(255,255,255,0.15)");
      fade.addColorStop(0.35, "rgba(255,255,255,0.9)");
      fade.addColorStop(0.75, "rgba(255,255,255,0.55)");
      fade.addColorStop(1, "rgba(255,255,255,0)");
      x.strokeStyle = fade;
      x.lineWidth = hw * 0.13;
      x.stroke(arc);
      const sx = hw * 0.42, sy = -hh * 0.55;
      const small = x.createRadialGradient(sx, sy, 0, sx, sy, hw * 0.12);
      small.addColorStop(0, "rgba(255,255,255,0.8)");
      small.addColorStop(1, "rgba(255,255,255,0)");
      x.fillStyle = small;
      x.beginPath();
      x.ellipse(sx, sy, hw * 0.06, hh * 0.08, 0.6, 0, Math.PI * 2);
      x.fill();
      x.globalAlpha = 1;
    }
    x.restore();

    x.strokeStyle = rgba(mix(pal.edge, rim, 0.25), 0.85);
    x.lineWidth = outline;
    x.stroke(body);
  }

  if (b.front && morph < 0.98) {
    x.save();
    x.globalAlpha = 1 - morph;
    b.front(x, hw, hh, look);
    x.restore();
  }
}

function makeBlob(b: Blob): SoftCharacter {
  return {
    kind: "soft",
    id: b.id,
    name: b.name,
    color: b.color,
    aspect: b.size.hw / b.size.hh,
    wearsIntegrationColor: true,
    size: b.size,
    face: { eyeSpread: 0.36, eyeDrop: 0.12, eyeRadius: 0.2, blushX: 0.55, blushY: 0.38 },
    wobbles: true,
    point: eggPoint,
    palette: eggPalette,
    drawBody: (x, body, hw, hh, look) => drawEgg(b, x, body, hw, hh, look),
    drawEye: (x, r, open, ink) => glintEye(x, r * 0.78, r * 1.0, open, ink),
  };
}

// ── Magma ─────────────────────────────────────────────────────────────────────

/** The cracks, as polylines (× hw, hh): one from the top down the left, its branch, two on the right. */
const CRACKS: number[][] = [
  [0.08, -1.05, -0.02, -0.72, 0.14, -0.6, -0.12, -0.3, -0.04, -0.12, -0.3, 0.15, -0.36, 0.45, -0.62, 0.62],
  [-0.12, -0.3, -0.42, -0.42, -0.58, -0.36],
  [0.14, -0.6, 0.42, -0.5, 0.5, -0.26, 0.74, -0.2],
  [-0.04, -0.12, 0.2, 0.02, 0.18, 0.2],
];

function strokeCracks(x: CanvasRenderingContext2D, hw: number, hh: number) {
  for (const c of CRACKS) {
    x.beginPath();
    for (let i = 0; i < c.length; i += 2) {
      if (i === 0) x.moveTo(c[i] * hw, c[i + 1] * hh);
      else x.lineTo(c[i] * hw, c[i + 1] * hh);
    }
    x.stroke();
  }
}

export const MAGMA = makeBlob({
  id: "magma",
  name: "Magma",
  color: [0.76, 0.09, 0.07],
  rim: (pal) => mix(pal.body, [1, 0.5, 0.08], 0.85),
  size: { hw: 0.92, hh: 0.94 },
  inside: (x, hw, hh, look) => {
    // A darker core, then glowing cracks: orange glow under a yellow line.
    const core = x.createRadialGradient(0, hh * 0.15, 0, 0, hh * 0.15, hh * 0.9);
    core.addColorStop(0, "rgba(90,0,0,0.35)");
    core.addColorStop(1, "rgba(90,0,0,0)");
    x.fillStyle = core;
    x.fillRect(-hw, -hh, hw * 2, hh * 2);
    if (!look.simple) {
      x.strokeStyle = "rgba(255,120,20,0.55)";
      x.lineWidth = Math.max(1.2, hh * 0.09);
      strokeCracks(x, hw, hh);
    }
    x.strokeStyle = "rgb(255,214,60)";
    x.lineWidth = Math.max(0.7, hh * 0.035);
    strokeCracks(x, hw, hh);
  },
});

// ── Pietra ────────────────────────────────────────────────────────────────────

const SLATE: RGB = [0.27, 0.31, 0.36];
const STONE: RGB = [0.56, 0.6, 0.64];

export const PIETRA = makeBlob({
  id: "stone",
  name: "Pietra",
  color: [0.08, 0.36, 0.66],
  size: { hw: 0.92, hh: 0.86 },
  behind: (x, hw, hh) => {
    // Slate spikes growing out behind the head.
    x.fillStyle = rgba(SLATE);
    x.strokeStyle = rgba(mix(SLATE, [0, 0, 0], 0.4));
    x.lineWidth = Math.max(0.6, hh * 0.025);
    for (const s of [-1, 1]) {
      for (const pts of [
        // A big block leaning out over each shoulder, a smaller one below it.
        [-0.2, -0.86, -0.42, -1.3, -0.64, -1.22, -0.92, -0.86, -0.66, -0.5],
        [-0.72, -0.5, -1.0, -0.72, -1.06, -0.42, -0.82, -0.2],
        [0.12, -0.9, 0.3, -1.22, 0.56, -1.1, 0.5, -0.8],
      ]) {
        const p = poly(pts, hw, hh, s);
        x.fill(p);
        x.stroke(p);
      }
    }
  },
  front: (x, hw, hh) => {
    // Grey crystals on top, cut flat, and pebbles at the base corners.
    const crystal = (pts: number[]) => {
      const p = poly(pts, hw, hh);
      const g = x.createLinearGradient(0, -1.3 * hh, 0, -0.7 * hh);
      g.addColorStop(0, rgba(mix(STONE, [1, 1, 1], 0.3)));
      g.addColorStop(1, rgba(mix(STONE, SLATE, 0.4)));
      x.fillStyle = g;
      x.fill(p);
      x.strokeStyle = rgba(mix(SLATE, [0, 0, 0], 0.3));
      x.lineWidth = Math.max(0.6, hh * 0.025);
      x.stroke(p);
    };
    crystal([-0.32, -0.8, -0.34, -1.18, -0.2, -1.32, -0.04, -1.2, -0.04, -0.86]);
    crystal([0.12, -0.86, 0.16, -1.1, 0.32, -1.18, 0.46, -1.04, 0.42, -0.78]);
    for (const s of [-1, 1]) {
      crystal([0.56 * s, 0.78, 0.74 * s, 0.68, 0.84 * s, 0.86, 0.66 * s, 1.02]);
    }
    crystal([0.78, 0.0, 0.98, -0.08, 0.95, 0.12, 0.8, 0.14]);
  },
});

// ── Roccia ────────────────────────────────────────────────────────────────────

const SHELL: RGB = [0.47, 0.22, 0.1];

export const ROCCIA = makeBlob({
  id: "rock",
  name: "Roccia",
  color: [0.8, 0.42, 0.08],
  rim: (pal) => mix(pal.body, [1, 0.62, 0.2], 0.6),
  size: { hw: 0.92, hh: 0.9 },
  inside: (x, hw, hh, look) => {
    if (look.simple) return;
    // Orange crescents on the cheeks and a lighter chin.
    const chin = x.createRadialGradient(0, hh * 0.85, 0, 0, hh * 0.85, hw * 0.55);
    chin.addColorStop(0, "rgba(255,200,80,0.35)");
    chin.addColorStop(1, "rgba(255,200,80,0)");
    x.fillStyle = chin;
    x.fillRect(-hw, 0, hw * 2, hh * 1.2);
    x.strokeStyle = "rgba(255,150,40,0.85)";
    x.lineWidth = Math.max(0.8, hh * 0.05);
    for (const s of [-1, 1]) {
      x.beginPath();
      x.arc(s * hw * 0.62, hh * 0.38, hh * 0.11, Math.PI * (s < 0 ? 0.55 : -0.45), Math.PI * (s < 0 ? 1.45 : 0.45));
      x.stroke();
    }
  },
  front: (x, hw, hh) => {
    // A shell of plates down the top of the head.
    const plates = [
      [-0.4, -0.9, -0.2, -1.04, 0.2, -1.04, 0.42, -0.9, 0.36, -0.7, 0.0, -0.66, -0.36, -0.7],
      [-0.4, -0.66, -0.36, -0.7, 0.0, -0.66, 0.0, -0.36, -0.36, -0.4, -0.44, -0.52],
      [0.0, -0.66, 0.36, -0.7, 0.44, -0.52, 0.36, -0.4, 0.0, -0.36],
      [-0.3, -0.38, 0.0, -0.36, 0.3, -0.38, 0.24, -0.1, 0.0, -0.04, -0.24, -0.1],
    ];
    for (let i = 0; i < plates.length; i++) {
      const p = poly(plates[i], hw, hh);
      x.fillStyle = rgba(mix(SHELL, [0.75, 0.45, 0.25], i === 0 ? 0.25 : 0.1));
      x.fill(p);
      x.strokeStyle = rgba(mix(SHELL, [0, 0, 0], 0.45));
      x.lineWidth = Math.max(0.6, hh * 0.03);
      x.stroke(p);
    }
  },
});

// ── Foglia ────────────────────────────────────────────────────────────────────

const LEAF: RGB = [0.72, 0.68, 0.28];

function leafPath(angle: number, len: number, wid: number, cx: number, cy: number): Path2D {
  const p = new Path2D();
  const ca = Math.cos(angle), sa = Math.sin(angle);
  const pt = (u: number, v: number): [number, number] => [cx + ca * u - sa * v, cy + sa * u + ca * v];
  p.moveTo(...pt(0, 0));
  p.quadraticCurveTo(...pt(len * 0.45, -wid), ...pt(len, 0));
  p.quadraticCurveTo(...pt(len * 0.45, wid), ...pt(0, 0));
  p.closePath();
  return p;
}

export const FOGLIA = makeBlob({
  id: "leaf",
  name: "Foglia",
  color: [0.16, 0.6, 0.54],
  rim: (pal) => mix(pal.body, [0.7, 1, 0.9], 0.6),
  size: { hw: 0.9, hh: 0.86 },
  behind: (x, hw, hh) => {
    // A crown of leaves spreading from the top.
    const cy = -hh * 0.9;
    x.strokeStyle = rgba(mix(LEAF, [0.2, 0.2, 0], 0.5));
    x.lineWidth = Math.max(0.6, hh * 0.025);
    const leaves: [number, number][] = [[-2.95, 0.95], [-0.19, 0.95], [-2.4, 0.8], [-0.74, 0.8], [-1.57, 0.5]];
    for (const [a, len] of leaves) {
      const p = leafPath(a, len * hw, 0.2 * hh, 0, cy);
      x.fillStyle = rgba(mix(LEAF, [1, 1, 0.6], a === -1.57 ? 0.15 : 0));
      x.fill(p);
      x.stroke(p);
    }
  },
  front: (x, hw, hh) => {
    // The little stem cap.
    x.fillStyle = "rgb(40,110,60)";
    x.beginPath();
    x.ellipse(0, -hh * 0.92, hw * 0.3, hh * 0.07, 0, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = "rgb(70,150,90)";
    x.beginPath();
    x.ellipse(0, -hh * 1.0, hw * 0.08, hh * 0.07, 0, 0, Math.PI * 2);
    x.fill();
  },
});
