// Continuous Dock icon layout and smooth cursor-based magnification.
//
// The dock behaves like an elastic band around the cursor: local stretch at
// distance d is `1 + a * f(d / R)` where f is inverted smoothstep. Because f is
// polynomial, total horizontal displacement has an exact closed form, so icons
// expand cleanly from their bottom baseline without jitter, jumps, or overlap.

export type ItemKind = "icon" | "separator";

export interface Metrics {
  icon: number;
  gap: number;
  padding: number;
  separatorWidth: number;
  separatorMargin: number;
}

export const DEFAULT_METRICS: Metrics = {
  icon: 44,
  gap: 10,
  padding: 9,
  separatorWidth: 1,
  separatorMargin: 7,
};

export function scaledMetrics(m: Metrics, scale: number): Metrics {
  return {
    icon: m.icon * scale,
    gap: m.gap * scale,
    padding: m.padding * scale,
    separatorWidth: Math.max(1, m.separatorWidth * scale),
    separatorMargin: m.separatorMargin * scale,
  };
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Slot {
  kind: ItemKind;
  rect: Rect;
}

export interface DockLayout {
  width: number;
  height: number;
  slots: Slot[];
}

export interface Magnifier {
  /** Horizontal distance from cursor where magnification reaches zero (px). */
  range: number;
  /** Peak scale factor directly under the cursor (1.0 = no magnification). */
  maxScale: number;
}

export interface MagnifiedLayout {
  /** Left capsule edge relative to the resting dock's left origin. */
  left: number;
  /** Right capsule edge relative to the resting dock's left origin. */
  right: number;
  rects: Rect[];
}

export function maxGrowth(m: Magnifier): number {
  return Math.max(0, (m.maxScale - 1) * m.range);
}

/** Inverted smoothstep: 1 under cursor (d = 0), 0 from |d| >= 1 onward. */
function falloff(d: number): number {
  const x = Math.min(1, Math.abs(d));
  return 1 - 3 * x * x + 2 * x * x * x;
}

/** Exact integral of falloff from 0 to u, odd and clamped at +/- 0.5. */
function falloffIntegral(u: number): number {
  const d = Math.min(1, Math.abs(u));
  const val = d - d * d * d + (d * d * d * d) / 2;
  return u < 0 ? -val : val;
}

/** Computes the resting horizontal slots for a sequence of icons and separators. */
export function buildDockLayout(items: readonly ItemKind[], m: Metrics = DEFAULT_METRICS): DockLayout {
  let x = m.padding;
  const slots: Slot[] = items.map((kind) => {
    const rect: Rect = kind === "icon"
      ? { x, y: m.padding, width: m.icon, height: m.icon }
      : {
        x: x + m.separatorMargin,
        y: m.padding + m.icon * 0.12,
        width: m.separatorWidth,
        height: m.icon * 0.76,
      };
    x += (kind === "icon" ? m.icon : m.separatorWidth + 2 * m.separatorMargin) + m.gap;
    return { kind, rect };
  });
  const contentEnd = slots.length === 0 ? x : x - m.gap;
  return {
    width: contentEnd + m.padding,
    height: m.icon + 2 * m.padding,
    slots,
  };
}

/**
 * Computes magnified rectangles for `layout` given cursor `x` (relative to resting
 * left edge) and blend `amount` (0 = resting, 1 = full effect). Both ends expand
 * symmetrically so the capsule stays centered around its resting center.
 */
export function magnifyLayout(
  layout: DockLayout,
  cursorX: number,
  amount: number,
  magnifier: Magnifier,
): MagnifiedLayout {
  const strength = Math.max(0, magnifier.maxScale - 1) * Math.max(0, Math.min(1, amount));
  if (strength <= 0) {
    return {
      left: 0,
      right: layout.width,
      rects: layout.slots.map((s) => s.rect),
    };
  }
  const range = Math.max(1e-5, magnifier.range);
  const shiftOf = (pos: number) => strength * range * falloffIntegral((pos - cursorX) / range);

  const shiftLeft = shiftOf(0);
  const shiftRight = shiftOf(layout.width);
  const centering = -(shiftLeft + shiftRight) / 2;

  const rects: Rect[] = layout.slots.map((slot) => {
    const rest = slot.rect;
    const restCenter = rest.x + rest.width / 2;
    const center = restCenter + shiftOf(restCenter) + centering;
    const scale = slot.kind === "icon"
      ? 1 + strength * falloff((restCenter - cursorX) / range)
      : 1;
    const width = rest.width * scale;
    const height = rest.height * scale;
    return {
      x: center - width / 2,
      y: rest.y + rest.height - height,
      width,
      height,
    };
  });

  return {
    left: shiftLeft + centering,
    right: layout.width + shiftRight + centering,
    rects,
  };
}

/** Returns the index of the icon under coordinate `x` (including half of each gap), or -1. */
export function iconAt(
  magnified: MagnifiedLayout,
  layout: DockLayout,
  x: number,
  gap: number,
): number {
  const halfGap = gap / 2;
  for (let i = 0; i < layout.slots.length; i++) {
    if (layout.slots[i].kind !== "icon") continue;
    const r = magnified.rects[i];
    if (x >= r.x - halfGap && x < r.x + r.width + halfGap) return i;
  }
  return -1;
}
