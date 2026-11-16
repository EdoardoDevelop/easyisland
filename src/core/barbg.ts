// Shared helpers for the fixed bar background (docs/architettura.md -> «Barra fissa»).
// Parses `fixedBarBackground` tokens and builds matching CSS backgrounds and
// luminance-based text ink for the bar window, the islands style, and Settings previews.

export type BarBgSpec =
  | { kind: "island" }
  | { kind: "transparent" }
  | { kind: "solid"; color: string }
  | { kind: "gradient"; from: string; to: string }
  | { kind: "glow"; base: string; light: string }
  | { kind: "aurora"; base: string; a: string; b: string }
  | { kind: "glass"; base: string };

export type BarBgPreset = { label: string; value: string };

const HEX = /^#([0-9a-f]{6})$/i;
const hex = (v: string | undefined, fallback: string) => (v && HEX.test(v) ? v.toLowerCase() : fallback);

export const BAR_BG_PRESETS: Record<"gradient" | "glow" | "aurora" | "glass", BarBgPreset[]> = {
  gradient: [
    { label: "Notte blu", value: "gradient:#0b1120:#172554" },
    { label: "Viola profondo", value: "gradient:#0f101b:#2e1065" },
    { label: "Grafite", value: "gradient:#111318:#232834" },
    { label: "Tramonto", value: "gradient:#181018:#3b1824" },
    { label: "Perla chiara", value: "gradient:#f1f5f9:#dbeafe" },
  ],
  glow: [
    { label: "Ciano", value: "glow:#0c1017:#38bdf8" },
    { label: "Viola", value: "glow:#0e0f17:#a78bfa" },
    { label: "Smeraldo", value: "glow:#0b1210:#34d399" },
    { label: "Ambra", value: "glow:#12100c:#f59e0b" },
    { label: "Rosa", value: "glow:#140e14:#f472b6" },
  ],
  aurora: [
    { label: "Boreale", value: "aurora:#0a0e17:#4f46e5:#06b6d4" },
    { label: "Smeraldo", value: "aurora:#091112:#0ea5e9:#10b981" },
    { label: "Tramonto", value: "aurora:#120d16:#ec4899:#f59e0b" },
    { label: "Pastello chiaro", value: "aurora:#eef2f9:#818cf8:#38bdf8" },
  ],
  glass: [
    { label: "Vetro scuro", value: "glass:#10141d" },
    { label: "Vetro blu notte", value: "glass:#0f172a" },
    { label: "Vetro chiaro", value: "glass:#eef2f7" },
  ],
};

/** Parses a stored `fixedBarBackground` value; unknown strings fall back to `island`. */
export function parseBarBg(raw: string | undefined | null): BarBgSpec {
  const s = (raw ?? "").trim();
  if (!s) return { kind: "island" };
  if (s === "transparent") return { kind: "transparent" };
  if (HEX.test(s)) return { kind: "solid", color: s.toLowerCase() };
  const [kind, c1, c2, c3] = s.split(":");
  if (kind === "gradient") return { kind: "gradient", from: hex(c1, "#0b1120"), to: hex(c2, "#172554") };
  if (kind === "glow") return { kind: "glow", base: hex(c1, "#0c1017"), light: hex(c2, "#38bdf8") };
  if (kind === "aurora") return { kind: "aurora", base: hex(c1, "#0a0e17"), a: hex(c2, "#4f46e5"), b: hex(c3, "#06b6d4") };
  if (kind === "glass") return { kind: "glass", base: hex(c1, "#10141d") };
  return { kind: "island" };
}

/** Relative luminance (0-255 scale) of a `#rrggbb` hex colour. */
export function hexLuma(color: string): number {
  const m = HEX.exec(color);
  if (!m) return 0;
  const n = parseInt(m[1], 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
}

/** Chooses readable text ink (`#16181d` dark vs `#f5f6f8` light) for a parsed background. */
export function barBgInk(spec: BarBgSpec, fallbackInk: string): string {
  switch (spec.kind) {
    case "solid":
      return hexLuma(spec.color) > 150 ? "#16181d" : "#f5f6f8";
    case "gradient":
      return (hexLuma(spec.from) + hexLuma(spec.to)) / 2 > 150 ? "#16181d" : "#f5f6f8";
    case "glow":
    case "aurora":
    case "glass":
      return hexLuma(spec.base) > 150 ? "#16181d" : "#f5f6f8";
    default:
      return fallbackInk;
  }
}

const mix = (color: string, pct: number) => `color-mix(in srgb, ${color} ${pct}%, transparent)`;

/** Builds a CSS `background` value (also used for `body.islands .area` and swatches). */
export function barBgCss(
  spec: BarBgSpec,
  opts: { opacity?: number; slot?: "start" | "center" | "end"; fallbackBg?: string } = {},
): string {
  const op = Math.min(100, Math.max(10, opts.opacity ?? 100));
  const slotX = opts.slot === "start" ? "14%" : opts.slot === "end" ? "86%" : "50%";
  switch (spec.kind) {
    case "transparent":
      return "transparent";
    case "solid":
      return mix(spec.color, op);
    case "gradient":
      return `linear-gradient(90deg, ${mix(spec.from, op)} 0%, ${mix(spec.to, op)} 100%)`;
    case "glow":
      return `radial-gradient(ellipse 38% 155% at ${slotX} 50%, ${mix(spec.light, Math.round(op * 0.36))} 0%, transparent 72%), ${mix(spec.base, op)}`;
    case "aurora": {
      const strong = Math.round(op * 0.34);
      const soft = Math.round(op * 0.28);
      return `radial-gradient(ellipse 46% 165% at 18% 0%, ${mix(spec.a, strong)} 0%, transparent 70%), radial-gradient(ellipse 46% 165% at 82% 100%, ${mix(spec.b, soft)} 0%, transparent 70%), ${mix(spec.base, op)}`;
    }
    case "glass": {
      const light = hexLuma(spec.base) > 150;
      const top = light ? `rgba(255,255,255,${(0.55 * op) / 100})` : `rgba(255,255,255,${(0.14 * op) / 100})`;
      const mid = mix(spec.base, Math.max(12, Math.round(op * (light ? 0.86 : 0.82))));
      return `linear-gradient(180deg, ${top} 0%, ${mid} 45%, ${mix(spec.base, op)} 100%)`;
    }
    default:
      return opts.fallbackBg ? mix(opts.fallbackBg, op) : "transparent";
  }
}
