// Slime, the character: a glossy jelly dome with a flat base. A soft
// character (see character.ts): this file is only its outline, its shading and
// its eye; pose, wobble, face and file morph come from the shared drawers.
// Body-local coordinates: (0, 0) is the centre, `hw` the half-width at the
// base, `hh` the half-height, y down, and the flat base sits on y = hh.

import {
  glintEye, mix, rgba, type BodyLook, type Palette, type RGB, type SoftCharacter,
} from "./character";

/** The slime's own green, used whenever the theme does not set a colour. */
export const SLIME_GREEN: RGB = [0.37, 0.78, 0.22]; // #5EC738

function slimePalette(base: RGB): Palette {
  return {
    light: mix(base, [1, 1, 0.78], 0.42),
    body: base,
    edge: mix(base, [0, 0.07, 0], 0.68),
  };
}

/**
 * The outline point in direction (ca, sa) = (cos a, sin a): a rounded dome on
 * top, a flat base with soft corners, sides that flare out into a little skirt.
 */
function slimePoint(ca: number, sa: number, hw: number, hh: number): { x: number; y: number } {
  const e = sa < 0 ? 0.92 : 0.36; // superellipse exponent: round dome, flat base
  const px = Math.sign(ca) * Math.pow(Math.abs(ca), e);
  const py = Math.sign(sa) * Math.pow(Math.abs(sa), e);
  const k = (py + 1) / 2; // 0 top … 1 base
  const skirt = Math.exp(-(((k - 0.86) / 0.12) ** 2));
  const flare = 0.8 + 0.2 * k * k + 0.07 * skirt;
  return { x: px * hw * flare, y: py * hh };
}

/** Fills, shades and outlines `body` (the outline, or a morph of it). */
function drawSlimeBody(x: CanvasRenderingContext2D, body: Path2D, hw: number, hh: number, look: BodyLook) {

  const pal = look.palette;
  const outline = Math.max(1, hh * 0.075);

  if (look.simple) {
    x.fillStyle = rgba(mix(pal.body, pal.light, 0.15));
    x.fill(body);
    x.save();
    x.clip(body);
    x.fillStyle = "rgba(255,255,255,0.55)";
    x.beginPath();
    x.ellipse(-hw * 0.32, -hh * 0.55, hw * 0.2, hh * 0.12, -0.3, 0, Math.PI * 2);
    x.fill();
    x.restore();
    x.strokeStyle = rgba(pal.edge);
    x.lineWidth = Math.max(0.8, hh * 0.09);
    x.stroke(body);
    return;
  }

  const g = x.createLinearGradient(0, -hh, 0, hh);
  g.addColorStop(0, rgba(pal.light));
  g.addColorStop(0.5, rgba(pal.body));
  g.addColorStop(1, rgba(pal.body));
  x.fillStyle = g;
  x.fill(body);

  x.save();
  x.clip(body);

  // Light caught along the rim.
  x.strokeStyle = rgba(pal.light, 0.45);
  x.lineWidth = outline * 2.4;
  x.stroke(body);

  const gloss = look.gloss ?? 1;
  if (gloss > 0.01) {
    x.globalAlpha = gloss;
    // The big shine on the top left, and a smaller one beside it.
    const hl = x.createRadialGradient(-hw * 0.34, -hh * 0.66, 0, -hw * 0.34, -hh * 0.66, hw * 0.3);
    hl.addColorStop(0, "rgba(255,255,255,0.85)");
    hl.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = hl;
    x.beginPath();
    x.ellipse(-hw * 0.34, -hh * 0.66, hw * 0.26, hh * 0.14, -0.38, 0, Math.PI * 2);
    x.fill();
    x.fillStyle = "rgba(255,255,255,0.7)";
    x.beginPath();
    x.ellipse(-hw * 0.6, -hh * 0.36, hw * 0.05, hh * 0.05, 0, 0, Math.PI * 2);
    x.fill();

    // Drips running down the sides.
    x.fillStyle = rgba(pal.light, 0.7);
    for (const [dx, dy, l] of [[-0.58, -0.12, 0.22], [-0.48, 0.12, 0.14], [0.6, -0.04, 0.2], [0.5, 0.18, 0.12]] as const) {
      drip(x, dx * hw, dy * hh, hw * 0.035, hh * l);
    }
    // Bubbles and glints near the base.
    x.fillStyle = rgba(pal.light, 0.75);
    for (const [bx, by, r] of [[0.62, 0.5, 0.03], [0.7, 0.58, 0.02], [-0.66, 0.62, 0.025]] as const) {
      x.beginPath();
      x.arc(bx * hw, by * hh, r * hw, 0, Math.PI * 2);
      x.fill();
    }
    for (const [bx, by, w] of [[-0.5, 0.8, 0.12], [0.36, 0.82, 0.1]] as const) {
      x.beginPath();
      x.ellipse(bx * hw, by * hh, w * hw, hh * 0.04, 0, 0, Math.PI * 2);
      x.fill();
    }
    x.globalAlpha = 1;
  }
  x.restore();

  x.strokeStyle = rgba(pal.edge);
  x.lineWidth = outline;
  x.lineJoin = "round";
  x.stroke(body);
}

function drip(x: CanvasRenderingContext2D, cx: number, top: number, r: number, len: number) {
  // A teardrop: thin at the top, round at the bottom.
  x.beginPath();
  x.moveTo(cx, top);
  x.quadraticCurveTo(cx + r * 1.1, top + len * 0.55, cx + r, top + len - r);
  x.arc(cx, top + len - r, r, 0, Math.PI);
  x.quadraticCurveTo(cx - r * 1.1, top + len * 0.55, cx, top);
  x.closePath();
  x.fill();
}

/** A round black eye with its white glint. */
function drawSlimeEye(x: CanvasRenderingContext2D, r: number, open: number, ink: string) {
  glintEye(x, r, r, open, ink);
}

export const SLIME: SoftCharacter = {
  kind: "soft",
  id: "slime",
  name: "Slime",
  color: SLIME_GREEN,
  aspect: 1.55,
  wearsIntegrationColor: true,
  size: { hw: 1.22, hh: 0.8 },
  face: { eyeSpread: 0.3, eyeDrop: 0.08, eyeRadius: 0.2, blushX: 0.55, blushY: 0.2 },
  wobbles: true,
  point: slimePoint,
  palette: slimePalette,
  drawBody: drawSlimeBody,
  drawEye: drawSlimeEye,
};
