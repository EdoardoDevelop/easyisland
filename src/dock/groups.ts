// Curated app-group styling and filtering helpers for pinned Dock folders.

import type { DockPin } from "../core/state";

export const GROUP_PALETTE: ReadonlyArray<readonly [string, readonly [string, string, string]]> = [
  ["blue", ["#a6d1f5", "#0078d4", "#005a9e"]],
  ["indigo", ["#c6c0f5", "#6b69d6", "#4f4ba8"]],
  ["purple", ["#d9c6ef", "#8764b8", "#5c3f8a"]],
  ["pink", ["#f7b8dd", "#e3008c", "#9b0062"]],
  ["red", ["#f4b4b6", "#e74856", "#a4262c"]],
  ["orange", ["#fbc8a4", "#f7630c", "#b04b09"]],
  ["yellow", ["#ffe7a3", "#ffb900", "#b38200"]],
  ["green", ["#b5e8b0", "#13a10e", "#0b6a0b"]],
  ["teal", ["#a6e9ed", "#00b7c3", "#038387"]],
  ["sand", ["#eadbc8", "#c8a27c", "#8a6a4a"]],
  ["graphite", ["#d2d0ce", "#7a7574", "#484644"]],
];

export const GROUP_GLYPHS = ["folder", "layers", "grid", "briefcase", "code", "globe", "music"] as const;

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function normalizeText(value: string): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase();
}

/** Picks readable ink ("#111111" or "#ffffff") against a 6-digit hex fill. */
export function contrastInkOn(hex: string): string {
  if (!HEX_COLOR.test(hex)) return "#ffffff";
  const r = Number.parseInt(hex.slice(1, 3), 16);
  const g = Number.parseInt(hex.slice(3, 5), 16);
  const b = Number.parseInt(hex.slice(5, 7), 16);
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.56 ? "#181a1f" : "#ffffff";
}

/** Returns resolved optional tile color, foreground ink and glyph for a Dock group pin. */
export function groupStyleOf(pin: Pick<DockPin, "color" | "glyph">): {
  color: string;
  ink: string;
  glyph: string;
} {
  const color = pin.color && HEX_COLOR.test(pin.color) ? pin.color.toLowerCase() : "";
  const glyph = pin.glyph && (GROUP_GLYPHS as readonly string[]).includes(pin.glyph) ? pin.glyph : "";
  return { color, ink: color ? contrastInkOn(color) : "", glyph };
}

/** Filters pinned group children by name/path without diacritic sensitivity. */
export function filterGroupChildren(children: readonly DockPin[], query: string): DockPin[] {
  const q = normalizeText(query).trim();
  if (!q) return [...children];
  return children.filter((item) => normalizeText(`${item.name} ${item.aumid || ""} ${item.path || ""}`).includes(q));
}

/** Extracts one child out of a pinned group into top-level pins; auto-dissolves single-child groups. */
export function extractChildFromGroup(
  pinned: readonly DockPin[],
  groupId: string,
  childId: string,
): DockPin[] {
  const out: DockPin[] = [];
  for (const p of pinned) {
    if (p.id !== groupId || !p.children?.length) {
      out.push(p);
      continue;
    }
    const target = p.children.find((c) => c.id === childId);
    const rest = p.children.filter((c) => c.id !== childId);
    if (rest.length >= 2) {
      out.push({ ...p, children: rest });
    } else if (rest.length === 1) {
      out.push(rest[0]);
    }
    if (target) out.push(target);
  }
  return out;
}

/** Dissolves a pinned group back into standalone pinned apps at its position. */
export function dissolveGroup(pinned: readonly DockPin[], groupId: string): DockPin[] {
  const out: DockPin[] = [];
  for (const p of pinned) {
    if (p.id === groupId && p.children?.length) out.push(...p.children);
    else out.push(p);
  }
  return out;
}
