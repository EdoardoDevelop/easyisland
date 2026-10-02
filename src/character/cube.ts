// The cube character — an alternative to the slime, chosen in Settings → Tema.
//
// A cube in the colours of the logo it is drawn from, with the logo's black
// stripes on the top and left faces and the slime's eyes on the right face. At rest
// it is exactly the logo's orange; any other state takes the faces over with
// the state's colour, as the slime does. It is a real cube in orthographic
// projection: looking at the cursor turns and tips it, and since every face is
// an exact affine image of a square, the stripes and the eyes stay painted on.
// Every drawer (the engine, the launch greeting, the file drop) asks
// `character()` and draws its own eyes through `onRightFace`.

export type Character = "slime" | "cube";
type RGB = readonly [number, number, number];
type P = readonly [number, number];
type V3 = readonly [number, number, number];

let current: Character = "slime";

export function setCharacter(c: Character | string | undefined) {
  current = c === "cube" ? "cube" : "slime";
}

export function character(): Character {
  return current;
}

/** The logo's faces: top, left, right (0…1). */
const LOGO = {
  top: [0.969, 0.682, 0.169] as RGB, // #F7AE2B
  left: [0.949, 0.631, 0.078] as RGB, // #F2A114
  right: [0.902, 0.584, 0.047] as RGB, // #E6950C
};
const INK = "rgb(20,18,16)";
const EDGE = "rgba(110,55,0,0.38)";

/** The logo's view: the front edge towards us, seen from the isometric height. */
const YAW0 = -Math.PI / 4;
const PITCH0 = Math.asin(Math.tan(Math.PI / 6)); // 35.26°
/**
 * Where the eyes' face points in the logo's view, in screen terms (x right,
 * y up, z towards the viewer): to the lower right, which is why the logo looks
 * the way it does.
 */
const REST: V3 = [
  Math.cos(YAW0),
  Math.sin(YAW0) * Math.sin(PITCH0),
  -Math.sin(YAW0) * Math.cos(PITCH0),
];
/**
 * How strongly the eyes' face swings towards the cursor. At rest it already
 * points down and right, so those two get a gentler push: the room to move is
 * then about the same in every direction.
 */
const FOLLOW_LEFT = 1.1;
const FOLLOW_RIGHT = 0.55;
const FOLLOW_UP = 1.1;
const FOLLOW_DOWN = 0.45;
/** The eyes' face never turns further from the viewer than this (z of its normal). */
const MIN_Z = 0.34;

const mix = (a: RGB, b: RGB, t: number): RGB => [
  a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t,
];
const css = (c: RGB) => `rgb(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)})`;
const clamp = (v: number, m: number) => Math.max(-m, Math.min(m, v));

export interface CubeLook {
  /** State colour and how much of it covers the faces (0 = the logo). */
  col?: RGB;
  tint?: number;
  /** Flat body colour (integration pills, a custom theme colour) instead of the logo. */
  base?: RGB | null;
  /** 0…1: the slot that opens in the top face while a file is swallowed. */
  slot?: number;
  /** Where the cube looks, about −1…1 each (the cursor, as the slime's lookX/lookY). */
  turn?: number;
  tip?: number;
}

/**
 * Turns the cube so that its eyes' face points at the cursor: the rest
 * direction, swung towards where the cursor is (`turn` right, `tip` down, both
 * −1…1), then solved back into a yaw and a pitch. One rule for every direction,
 * so the face really follows the cursor — looking up shows the bottom face,
 * looking left the back one.
 */
function orientation(turn: number, tip: number): { yaw: number; pitch: number } {
  let nx = REST[0] + turn * (turn < 0 ? FOLLOW_LEFT : FOLLOW_RIGHT);
  let ny = REST[1] - tip * (tip < 0 ? FOLLOW_UP : FOLLOW_DOWN);
  let nz = REST[2];
  const len = Math.hypot(nx, ny, nz);
  nx /= len; ny /= len; nz /= len;
  if (nz < MIN_Z) {
    // Keep the face turned towards the viewer: clamp its depth, keep its heading.
    const k = Math.sqrt((1 - MIN_Z * MIN_Z) / (nx * nx + ny * ny));
    nx *= k; ny *= k; nz = MIN_Z;
  }
  // The rotated face normal is (cos yaw, sin yaw·sin pitch, −sin yaw·cos pitch)
  // with sin yaw < 0 (the face towards us): invert that.
  const yaw = -Math.acos(Math.max(-0.995, Math.min(0.995, nx)));
  const pitch = Math.atan2(-ny, nz);
  return { yaw, pitch };
}

/**
 * The projection for a cube whose silhouette is `2s` tall in the logo's view
 * (the front edge then measures `s`), turned towards `turn` / `tip`.
 */
function camera(s: number, look: CubeLook) {
  const { yaw, pitch } = orientation(clamp(look.turn ?? 0, 1), clamp(look.tip ?? 0, 1));
  const h = (s / Math.cos(PITCH0)) / 2; // half the side
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
  const rot = (v: V3): V3 => {
    const x1 = v[0] * cy + v[2] * sy;
    const z1 = -v[0] * sy + v[2] * cy;
    return [x1, v[1] * cp - z1 * sp, v[1] * sp + z1 * cp];
  };
  const project = (v: V3): P => {
    const r = rot(v);
    return [r[0], -r[1]];
  };
  return { h, rot, project };
}

type FaceName = "top" | "left" | "right" | "back" | "far" | "bottom";

/** Each face as origin + two edges (u, v) in the logo's orientation, and its normal. */
function faces(h: number): { name: FaceName; o: V3; a: V3; b: V3; n: V3 }[] {
  const d = 2 * h;
  return [
    // top: u from the left corner to the back one, v towards the front edge
    { name: "top", o: [-h, h, h], a: [0, 0, -d], b: [d, 0, 0], n: [0, 1, 0] },
    // left (front-left, +Z): u along the top edge to the front, v down
    { name: "left", o: [-h, h, h], a: [d, 0, 0], b: [0, -d, 0], n: [0, 0, 1] },
    // right (front-right, +X): u from the front edge to the back, v down
    { name: "right", o: [h, h, h], a: [0, 0, -d], b: [0, -d, 0], n: [1, 0, 0] },
    { name: "back", o: [h, h, -h], a: [-d, 0, 0], b: [0, -d, 0], n: [0, 0, -1] },
    { name: "far", o: [-h, h, -h], a: [0, 0, d], b: [0, -d, 0], n: [-1, 0, 0] },
    { name: "bottom", o: [-h, -h, h], a: [d, 0, 0], b: [0, 0, -d], n: [0, -1, 0] },
  ];
}

const add = (p: V3, q: V3): V3 => [p[0] + q[0], p[1] + q[1], p[2] + q[2]];

function poly(x: CanvasRenderingContext2D, pts: readonly P[]) {
  x.beginPath();
  x.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) x.lineTo(pts[i][0], pts[i][1]);
  x.closePath();
}

/** The faces' colours (CSS) for a look: the logo, a flat base, or the state's colour. */
function faceColours(look: CubeLook) {
  // Mixing the logo's orange with a blue or a violet only makes mud: a state
  // takes the faces over with its own colour, lit the same way.
  const tint = Math.min(1, Math.max(0, look.tint ?? 0) * 1.25);
  const lit = (c: RGB) => ({ top: mix(c, [1, 1, 1], 0.16), left: c, right: mix(c, [0, 0, 0], 0.12) });
  const base = look.base ? lit(look.base) : LOGO;
  const state = look.col && tint > 0.01 ? lit(look.col) : null;
  const shade = (k: "top" | "left" | "right") => css(state ? mix(base[k], state[k], tint) : base[k]);
  return { top: shade("top"), left: shade("left"), right: shade("right") };
}

/** Light and dark stop for the hands, so they match the cube instead of the slime's jelly. */
export function cubeHandStops(look: CubeLook = {}): [string, string] {
  const f = faceColours(look);
  return [f.top, f.right];
}

/** Draws faces and stripes, centred on the current origin. */
export function drawCube(x: CanvasRenderingContext2D, s: number, look: CubeLook = {}) {
  const cam = camera(s, look);
  const colours = faceColours(look);
  const shade = (k: "top" | "left" | "right") => colours[k];

  x.lineJoin = "round";
  x.lineWidth = Math.max(0.6, s * 0.02);
  for (const f of faces(cam.h)) {
    if (cam.rot(f.n)[2] <= 0.001) continue; // facing away
    const O = cam.project(f.o);
    const A = cam.project(f.a), B = cam.project(f.b), Z = cam.project([0, 0, 0]);
    const ax = A[0] - Z[0], ay = A[1] - Z[1], bx = B[0] - Z[0], by = B[1] - Z[1];
    const at = (u: number, v: number): P => [O[0] + ax * u + bx * v, O[1] + ay * u + by * v];
    poly(x, [at(0, 0), at(1, 0), at(1, 1), at(0, 1)]);
    const role = f.name === "top" ? "top" : f.name === "left" || f.name === "far" || f.name === "bottom" ? "left" : "right";
    x.fillStyle = shade(role);
    x.fill();
    x.strokeStyle = EDGE;
    x.stroke();

    const band = (u0: number, u1: number, v0: number, v1: number) => {
      poly(x, [at(u0, v0), at(u1, v0), at(u1, v1), at(u0, v1)]);
      x.fill();
    };
    x.fillStyle = INK;
    if (f.name === "top") {
      // The logo's stripes, then the slot that opens while a file is swallowed.
      band(0.38, 0.98, 0.26, 0.4);
      band(0.38, 0.98, 0.58, 0.72);
      const slot = look.slot ?? 0;
      if (slot > 0.02) {
        const hh = Math.min(0.42, slot * 0.4);
        x.fillStyle = "rgb(8,8,10)";
        band(0.12, 0.88, 0.5 - hh / 2, 0.5 + hh / 2);
      }
    } else if (f.name === "left") {
      band(0, 0.62, 0.26, 0.4);
      band(0, 0.62, 0.6, 0.74);
    } else if (f.name === "back") {
      // The faces the logo never shows carry the same stripes: still one cube.
      band(0.38, 1, 0.26, 0.4);
      band(0.38, 1, 0.6, 0.74);
    } else if (f.name === "bottom") {
      // Parallel to the top face's stripes (they run front to back, along Z).
      band(0.26, 0.4, 0.38, 0.98);
      band(0.58, 0.72, 0.38, 0.98);
    }
  }
}

/**
 * Runs `draw` with the canvas mapped onto the right face: origin at the face's
 * centre, x along the face (towards the back), y down, both in pixels for the
 * logo's view. The face is an `s`×`s` square in these units, `draw` is clipped
 * to it and is skipped while the face is turned away.
 */
export function onRightFace(
  x: CanvasRenderingContext2D, s: number, draw: (side: number) => void, look: CubeLook = {},
) {
  const cam = camera(s, look);
  const f = faces(cam.h)[2];
  if (cam.rot(f.n)[2] <= 0.02) return;
  const Z = cam.project([0, 0, 0]);
  const C = cam.project(add(add(f.o, [f.a[0] / 2, f.a[1] / 2, f.a[2] / 2]), [f.b[0] / 2, f.b[1] / 2, f.b[2] / 2]));
  const A = cam.project(f.a), B = cam.project(f.b);
  x.save();
  x.transform(
    (A[0] - Z[0]) / s, (A[1] - Z[1]) / s,
    (B[0] - Z[0]) / s, (B[1] - Z[1]) / s,
    C[0], C[1],
  );
  x.beginPath();
  x.rect(-s / 2, -s / 2, s, s);
  x.clip();
  draw(s);
  x.restore();
}
