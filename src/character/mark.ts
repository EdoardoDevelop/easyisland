// The app's logo (chosen by Edoardo on 26 Oct 2026, from a picture): a speech
// bubble drawn with a thick rainbow stroke, dark inside, two white eyes (the
// left one nearer, so bigger) and a tail at the bottom left. Pure maths, no DOM:
// scripts/gen-icons.mjs rasterises it into the icons (Node runs this file as
// is) and figure.ts into the island's logo, so the two can never drift apart.
//
// Coordinates are those of the 91 px picture it was measured on.

export type RGBA = [number, number, number, number];

const BX = 49, BY = 40; // bubble centre
const HW = 34, HH = 27.5, RAD = 22; // half sizes, corner radius

/** Hue round the bubble, by angle (degrees, counter-clockwise from the right). */
const STOPS: [number, [number, number, number]][] = [
  [0, [142, 10, 168]], [30, [224, 0, 200]], [60, [228, 0, 90]], [90, [232, 16, 26]],
  [120, [255, 48, 16]], [150, [255, 138, 29]], [185, [254, 208, 18]], [215, [150, 220, 40]],
  [240, [0, 229, 166]], [270, [26, 122, 208]], [300, [42, 40, 176]], [330, [74, 53, 216]], [360, [142, 10, 168]],
];

function hue(deg: number): [number, number, number] {
  for (let i = 1; i < STOPS.length; i++) {
    const [a1, c1] = STOPS[i];
    const [a0, c0] = STOPS[i - 1];
    if (deg <= a1) {
      const k = (deg - a0) / (a1 - a0);
      return [c0[0] + (c1[0] - c0[0]) * k, c0[1] + (c1[1] - c0[1]) * k, c0[2] + (c1[2] - c0[2]) * k];
    }
  }
  return STOPS[0][1];
}

function roundedBox(x: number, y: number): number {
  const qx = Math.abs(x - BX) - HW + RAD;
  const qy = Math.abs(y - BY) - HH + RAD;
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - RAD;
}

const inEllipse = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) =>
  ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

/**
 * The colour at (u, v) in −1…1 of an icon `px` wide, or null where it is
 * transparent. Small icons get a thicker stroke and bigger eyes.
 */
export function markAt(u: number, v: number, px: number): RGBA | null {
  const small = px <= 32;
  const x = 49 + u * 38;
  const y = 45 + v * 38;
  const band = small ? 12 : 9.5;
  const d = roundedBox(x, y);
  const deg = (Math.atan2(-(y - BY), x - BX) * 180) / Math.PI;
  const angle = deg < 0 ? deg + 360 : deg;
  // The tail: straight on the left, curved on the right, from the bottom edge down to a point.
  const tailTop = BY + HH - band;
  const t = (y - tailTop) / (78 - tailTop);
  const inTail = t >= 0 && t <= 1 && x >= 30 && x <= 30 + (small ? 15 : 13) * Math.pow(1 - t, 1.25);
  // The stroke opens at the bottom left, where the tail leaves it.
  const gap = angle > 206 && angle < 236 && x < 30;
  if ((d <= 0 && d > -band && !gap) || inTail) {
    const [r, g, b] = hue(inTail ? 240 : angle);
    return [r, g, b, 255];
  }
  if (d <= -band) {
    const k = small ? 1.25 : 1;
    if (inEllipse(x, y, 42, 41, 8 * k, 7.5 * k) || inEllipse(x, y, 63, 41, 5 * k, 4.6 * k)) return [255, 255, 255, 255];
    return [6, 6, 10, 255];
  }
  return null;
}
