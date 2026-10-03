// The characters that can live in the island, and the contract they follow.
//
// Every drawer — the engine (src/character/engine.ts), the launch greeting
// (greeting.ts), the file drop (src/upload/canvas.ts) and the rest icon — asks
// `character()` and draws whatever comes back through the same calls. None of
// them knows a character by name.
//
// There are two families:
//
//   soft   a body with an outline (Slime, Goccia): one outline function, one
//          shading routine, one eye. Pose, jelly wobble, blush, the morph into a
//          box that swallows a file, the hands and every eye shape of the
//          engine come for free. A new character of this kind is one file
//          exporting a `SoftCharacter`, added to CHARACTERS below.
//   cube   the EasyTech cube (cube.ts), a real 3D object with its eyes painted
//          on a face: drawn by its own routines.
//
// Body-local coordinates, for every soft character: (0, 0) is the centre, `hw`
// the half-width at the base, `hh` the half-height, y down, the base on y = hh.

export type RGB = readonly [number, number, number]; // components 0…1

/** The three colours a soft body is drawn with. */
export interface Palette {
  /** The lit top. */
  light: RGB;
  body: RGB;
  /** The outline. */
  edge: RGB;
}

export interface BodyLook {
  palette: Palette;
  /** Small sizes: flat fill, outline and one highlight. */
  simple?: boolean;
  /** 0…1, the glossy highlights (they fade while the body becomes a box). */
  gloss?: number;
}

interface CharacterBase {
  id: string;
  /** Shown in Impostazioni → Aspetto. */
  name: string;
  /** Its own colour, when the theme sets none (the colour picker's default too). */
  color: RGB;
  /** Width / height of the body at rest (greeting layout). */
  aspect: number;
  /**
   * Takes the focused integration's colour in the island. A character with a
   * fixed identity (the cube's logo) keeps its own.
   */
  wearsIntegrationColor: boolean;
}

/** Where the face sits on a soft body. */
export interface Face {
  /** Eyes either side, as an angle on the body seen as a sphere (radians). */
  eyeSpread: number;
  /** Eye height: > 0 below the middle, as an angle (radians). */
  eyeDrop: number;
  /** Eye radius, fraction of the engine's R. */
  eyeRadius: number;
  /** Blush cheeks: across (fraction of hw) and down (fraction of hh). */
  blushX: number;
  blushY: number;
}

export interface SoftCharacter extends CharacterBase {
  kind: "soft";
  /** Half-width and half-height in the engine, in units of R (≈ 0.3 × canvas). */
  size: { hw: number; hh: number };
  face: Face;
  /** Does the body wobble like jelly after a jolt. */
  wobbles: boolean;
  /**
   * The outline point in direction (ca, sa) = (cos a, sin a). Walking a from 0
   * to 2π must trace the outline once, clockwise on screen: the box morph pairs
   * points by angle.
   */
  point(ca: number, sa: number, hw: number, hh: number): { x: number; y: number };
  palette(base: RGB): Palette;
  /** Fills, shades and outlines `body` (the outline, or a morph of it). */
  drawBody(x: CanvasRenderingContext2D, body: Path2D, hw: number, hh: number, look: BodyLook): void;
  /** One open eye of radius `r`, squashed by `open` (1 open … ~0 shut). */
  drawEye(x: CanvasRenderingContext2D, r: number, open: number, ink: string): void;
}

export interface CubeCharacter extends CharacterBase {
  kind: "cube";
}

export type Character = SoftCharacter | CubeCharacter;

// ── Registry ──────────────────────────────────────────────────────────────────

const registry: Character[] = [];
let current: Character | null = null;

/** Adds characters to the list offered in the settings. The first is the default. */
export function registerCharacters(...list: Character[]) {
  for (const c of list) if (!registry.some((r) => r.id === c.id)) registry.push(c);
}

export function characters(): readonly Character[] {
  return registry;
}

export function setCharacter(id: string | undefined) {
  current = registry.find((c) => c.id === id) ?? registry[0] ?? null;
}

/** The character in use. */
export function character(): Character {
  if (!current) setCharacter(undefined);
  if (!current) throw new Error("no character registered");
  return current;
}

// ── Shared helpers for soft bodies ────────────────────────────────────────────

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const mix = (a: RGB, b: RGB, t: number): RGB =>
  [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
export const rgba = (c: RGB, a = 1) =>
  `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;

/** The closed outline of a soft character. */
export function outlinePath(c: SoftCharacter, hw: number, hh: number, n = 96): Path2D {
  const p = new Path2D();
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const { x, y } = c.point(Math.cos(a), Math.sin(a), hw, hh);
    if (i === 0) p.moveTo(x, y);
    else p.lineTo(x, y);
  }
  p.closePath();
  return p;
}

/** Colour stops for the little hands (pseudopods), light → dark. */
export function handStops(pal: Palette): [string, string] {
  return [rgba(pal.light), rgba(pal.body)];
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

/**
 * One round black eye with its white glint, radii `rx`×`ry`, squashed by
 * `open` for blinks. The building block of the soft characters' eyes.
 */
export function glintEye(x: CanvasRenderingContext2D, rx: number, ry: number, open: number, ink: string) {
  const h = Math.max(ry * 0.12, ry * open);
  x.fillStyle = ink;
  x.beginPath();
  x.ellipse(0, 0, rx, h, 0, 0, Math.PI * 2);
  x.fill();
  if (open > 0.45 && rx > 1.6) {
    x.fillStyle = "rgba(255,255,255,0.9)";
    x.beginPath();
    x.arc(-rx * 0.3, -h * 0.4, Math.min(rx, ry) * 0.24, 0, Math.PI * 2);
    x.fill();
  }
}
