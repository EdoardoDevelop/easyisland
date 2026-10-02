// The slime the slime: a glossy jelly dome sitting on its own puddle. One place
// draws the body so the island, the greeting and the drop animation all show
// the same character. Everything is in body-local coordinates: (0, 0) is the
// centre, `hw` the half-width at the base, `hh` the half-height, y down, and the
// flat base sits on y = hh.

export type RGB = readonly [number, number, number]; // components 0…1

/** The slime's own green, used whenever the theme does not set a colour. */
export const SLIME_GREEN: RGB = [0.37, 0.78, 0.22]; // #5EC738

/** Width / height of the body at rest. */
export const SLIME_ASPECT = 1.55;

const INK = "rgb(12,14,12)";

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const rgba = (c: RGB, a = 1) =>
  `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;

export interface SlimePalette {
  /** Lime at the top of the dome. */
  light: RGB;
  body: RGB;
  /** Outline and puddle. */
  edge: RGB;
}

export function slimePalette(base: RGB): SlimePalette {
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
export function slimePoint(ca: number, sa: number, hw: number, hh: number): { x: number; y: number } {
  const e = sa < 0 ? 0.92 : 0.36; // superellipse exponent: round dome, flat base
  const px = Math.sign(ca) * Math.pow(Math.abs(ca), e);
  const py = Math.sign(sa) * Math.pow(Math.abs(sa), e);
  const k = (py + 1) / 2; // 0 top … 1 base
  const skirt = Math.exp(-(((k - 0.86) / 0.12) ** 2));
  const flare = 0.8 + 0.2 * k * k + 0.07 * skirt;
  return { x: px * hw * flare, y: py * hh };
}

export function slimePath(hw: number, hh: number): Path2D {
  const p = new Path2D();
  const n = 96;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const { x, y } = slimePoint(Math.cos(a), Math.sin(a), hw, hh);
    if (i === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  p.closePath();
  return p;
}

export interface SlimeLook {
  palette: SlimePalette;
  /** Small sizes: flat fill, outline and one highlight — no puddle or drips. */
  simple?: boolean;
  /** 0…1, the puddle under the base (fades while the slime turns into a box). */
  puddle?: number;
  /** 0…1, the glossy highlights. */
  gloss?: number;
}

/** How the jelly is deformed right now: see `Jelly`. */
export interface JellyPose {
  /** Horizontal lean of the top, in body heights (the base stays put). */
  shear: number;
  /** Vertical stretch (+) or squash (−) about the base. */
  stretch: number;
}

/**
 * Applies the jelly deformation about the base (y = hh): the top leans by
 * `shear` and the body stretches by `stretch`, keeping its volume.
 * Everything drawn afterwards — body, eyes, highlights — wobbles together.
 */
export function applyJelly(x: CanvasRenderingContext2D, hh: number, j: JellyPose) {
  if (Math.abs(j.shear) < 1e-4 && Math.abs(j.stretch) < 1e-4) return;
  x.translate(0, hh);
  x.transform(1 - j.stretch * 0.5, 0, -j.shear, 1 + j.stretch, 0, 0);
  x.translate(0, -hh);
}

/**
 * Two damped springs that make the body wobble like jelly after a jolt: the
 * top lags behind when the body moves, overshoots and settles. Soft and
 * underdamped on purpose; it comes to rest in about a second.
 */
export class Jelly implements JellyPose {
  shear = 0;
  stretch = 0;
  private vShear = 0;
  private vStretch = 0;

  /** A change of velocity: `dx` sideways, `dy` down (body heights per second). */
  kick(dx: number, dy: number) {
    this.vShear -= dx;
    this.vStretch += dy;
  }

  update(dt: number) {
    if (dt <= 0) return;
    const step = (s: number, v: number, hz: number, zeta: number): [number, number] => {
      const w = 2 * Math.PI * hz;
      const n = Math.max(1, Math.ceil(dt / 0.008)); // small steps keep the spring stable
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        v += (-w * w * s - 2 * zeta * w * v) * h;
        s += v * h;
      }
      return [s, v];
    };
    [this.shear, this.vShear] = step(this.shear, this.vShear, 3.2, 0.14);
    [this.stretch, this.vStretch] = step(this.stretch, this.vStretch, 4.2, 0.16);
    this.shear = Math.max(-0.35, Math.min(0.35, this.shear));
    this.stretch = Math.max(-0.25, Math.min(0.25, this.stretch));
  }

  get busy(): boolean {
    return Math.abs(this.shear) > 0.002 || Math.abs(this.vShear) > 0.02 ||
      Math.abs(this.stretch) > 0.002 || Math.abs(this.vStretch) > 0.02;
  }

  reset() {
    this.shear = this.stretch = this.vShear = this.vStretch = 0;
  }
}

/** The puddle goes under the body: call before `drawSlimeBody`. */
export function drawSlimePuddle(x: CanvasRenderingContext2D, hw: number, hh: number, look: SlimeLook) {
  const a = look.puddle ?? 1;
  if (a <= 0.01 || look.simple) return;
  x.save();
  x.fillStyle = rgba(look.palette.edge, 0.95 * a);
  x.beginPath();
  x.ellipse(0, hh * 0.97, hw * 1.14, Math.max(1, hh * 0.13), 0, 0, Math.PI * 2);
  x.fill();
  x.restore();
}

/** Fills, shades and outlines `body` (usually `slimePath`, or a morph of it). */
export function drawSlimeBody(x: CanvasRenderingContext2D, body: Path2D, hw: number, hh: number, look: SlimeLook) {
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

/**
 * One round black eye with its white glint, radius `r`, squashed by `open`
 * (1 = open, ~0 = shut) for blinks.
 */
export function drawSlimeEye(x: CanvasRenderingContext2D, r: number, open = 1, ink = INK) {
  const ry = Math.max(r * 0.12, r * open);
  x.fillStyle = ink;
  x.beginPath();
  x.ellipse(0, 0, r, ry, 0, 0, Math.PI * 2);
  x.fill();
  if (open > 0.45 && r > 1.6) {
    x.fillStyle = "rgba(255,255,255,0.9)";
    x.beginPath();
    x.arc(-r * 0.3, -ry * 0.4, r * 0.24, 0, Math.PI * 2);
    x.fill();
  }
}

/** Colour stops for the little hands (pseudopods), light → dark. */
export function slimeHandStops(pal: SlimePalette): [string, string] {
  return [rgba(pal.light), rgba(pal.body)];
}

export { rgba as slimeRGBA, mix as slimeMix };
