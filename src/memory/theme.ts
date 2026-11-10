// The canvas colours of the memory window, read from the page's CSS tokens
// (memory.css: Windows 11 or Classico, dark or light), so the drawings sit on
// the same surfaces as the bar and the panel. Read again when the scheme changes.

export interface Palette {
  light: boolean;
  /** The stage's background. */
  bg: string;
  /** Labels and numbers. */
  ink: string;
  /** Secondary text (dates, relations). */
  dim: string;
  /** Faint lines (rings, lanes, ticks). */
  line: string;
  /** Links between nodes, as "r,g,b" for an alpha of the caller's. */
  link: string;
  /** Behind a label: the background, almost opaque. */
  halo: string;
  /** A card drawn on the canvas (mind map pills, concept boxes, legends). */
  card: string;
  /** The selection ring. */
  ring: string;
  accent: string;
  font: string;
}

let cached: Palette | null = null;

export function pal(): Palette {
  if (cached) return cached;
  const css = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  const light = document.documentElement.dataset.scheme === "light";
  cached = {
    light,
    bg: v("--stage", light ? "#f3f3f3" : "#1c1c1c"),
    ink: v("--ink", light ? "#1b1b1b" : "#ffffff"),
    dim: v("--dim", light ? "#5c5c5c" : "#c5c5c5"),
    line: light ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.07)",
    link: light ? "70,80,100" : "170,180,200",
    halo: v("--stage", light ? "#f3f3f3" : "#1c1c1c"),
    card: v("--card", light ? "#ffffff" : "#2b2b2b"),
    ring: light ? "#1b1b1b" : "#ffffff",
    accent: v("--accent", "#4cc2ff"),
    font: v("--font", '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif'),
  };
  return cached;
}

/** The scheme or the look changed: read the tokens again at the next frame. */
export function forgetPalette() {
  cached = null;
}

/** A canvas font of the page's family. */
export function font(px: number, weight = 500, italic = false): string {
  return `${italic ? "italic " : ""}${weight} ${px}px ${pal().font}`;
}

/** Fills the stage with its background (no glow, no gradient). */
export function paintBackground(ctx: CanvasRenderingContext2D, w: number, h: number) {
  ctx.fillStyle = pal().bg;
  ctx.fillRect(0, 0, w, h);
}

/** A node's colour made readable as text on the stage (darker in light mode). */
export function inkOf(hex: string): string {
  if (!pal().light || !/^#[0-9a-f]{6}$/i.test(hex)) return hex;
  const n = parseInt(hex.slice(1), 16);
  const f = 0.55;
  const c = (x: number) => Math.round(x * f).toString(16).padStart(2, "0");
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}
