// Labels that never sit on each other: each view asks for its labels in order
// of importance (the picked node, its neighbours, the hubs, pages before notes)
// and a label that would overlap one already written is left out; it shows on
// hover (tooltip) or closer up. Screen space, CSS pixels.

import { fit } from "./data";
import { font, pal } from "./theme";

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** What the page lays over the stage (the legend, the hint): no label under it. */
let reserved: Rect[] = [];
export function reserve(rects: Rect[]) {
  reserved = rects;
}

/** The rectangles taken this frame, in a coarse grid so hundreds stay cheap. */
export class Placer {
  private cells = new Map<number, Rect[]>();
  private static CELL = 64;

  constructor() {
    for (const r of reserved) this.take(r);
  }

  private keys(r: Rect): number[] {
    const c = Placer.CELL;
    const out: number[] = [];
    for (let x = Math.floor(r.x0 / c); x <= Math.floor(r.x1 / c); x++) {
      for (let y = Math.floor(r.y0 / c); y <= Math.floor(r.y1 / c); y++) out.push(x * 100_003 + y);
    }
    return out;
  }

  free(r: Rect): boolean {
    for (const k of this.keys(r)) {
      for (const o of this.cells.get(k) ?? []) {
        if (r.x0 < o.x1 && r.x1 > o.x0 && r.y0 < o.y1 && r.y1 > o.y0) return false;
      }
    }
    return true;
  }

  take(r: Rect) {
    for (const k of this.keys(r)) {
      const list = this.cells.get(k);
      if (list) list.push(r);
      else this.cells.set(k, [r]);
    }
  }

  /** Takes the rectangle when free (or when forced); true when taken. */
  claim(r: Rect, force = false): boolean {
    if (!force && !this.free(r)) return false;
    this.take(r);
    return true;
  }
}

export interface LabelOpts {
  size?: number;
  weight?: number;
  color?: string;
  /** Widest it may be, px (cut with «…»). */
  max?: number;
  align?: CanvasTextAlign;
  baseline?: "top" | "middle" | "bottom";
  /** Written even when it overlaps (the picked node). */
  force?: boolean;
  alpha?: number;
}

/**
 * A label at (x, y) in screen pixels with a halo of the background behind it,
 * if it fits where nothing else is written. Returns false when left out.
 */
export function label(ctx: CanvasRenderingContext2D, placer: Placer, text: string, x: number, y: number, o: LabelOpts = {}): boolean {
  const p = pal();
  const size = o.size ?? 12;
  ctx.font = font(size, o.weight ?? 500);
  const shown = fit(ctx, text, o.max ?? 200);
  const w = ctx.measureText(shown).width;
  const align = o.align ?? "center";
  const base = o.baseline ?? "top";
  const x0 = align === "center" ? x - w / 2 : align === "right" || align === "end" ? x - w : x;
  const y0 = base === "top" ? y : base === "middle" ? y - size * 0.62 : y - size * 1.25;
  // A little air around each, so two labels never touch either.
  const r = { x0: x0 - 6, y0: y0 - 3, x1: x0 + w + 6, y1: y0 + size * 1.25 + 3 };
  if (!placer.claim(r, o.force)) return false;
  ctx.save();
  ctx.globalAlpha = o.alpha ?? 1;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  // The halo: the stage's colour around the letters, so lines under them do not cut them.
  ctx.lineJoin = "round";
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = p.halo;
  ctx.strokeText(shown, x0, y0 + size * 0.08);
  ctx.fillStyle = o.color ?? p.ink;
  ctx.fillText(shown, x0, y0 + size * 0.08);
  ctx.restore();
  return true;
}
