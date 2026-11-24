// The island built from a JSON, its look (docs/architettura.md → Isola da JSON →
// Aspetto e condizioni): the island's own colours, corners, font and sizes
// (`style`), and for each piece when it shows (`when`: hours, days, the
// program in front, a value of the PC) and the colour a value gives it
// (`levels`). Checked in island_layout.rs; here only read. Nothing runs while
// the island is retired but a check every 30 s, and only for a layout that
// has hours or days in it.

import { State, type LayoutLevel, type LayoutMeasure, type LayoutStyle, type LayoutWhen } from "../core/state";

/** A value of the PC as a number (island_layout.rs `NUMBERS`); null when not read yet. */
export function sysNumber(what: string, drive?: string): number | null {
  const s = State.barSys;
  const ok = (n: number | null | undefined) => (typeof n === "number" && Number.isFinite(n) ? n : null);
  switch (what) {
    case "cpu": return ok(s.cpu);
    case "ram": return ok(s.ram?.percent);
    case "gpu": return ok(s.gpu);
    case "battery": return ok(s.battery?.percent);
    case "net": return s.net ? (s.net.down + s.net.up) / 1e6 : null;
    case "recycle": return ok(s.recycle?.count);
    case "updates": return ok(s.updates?.count);
    case "disk": {
      const d = s.disks?.[(drive || "C").toUpperCase()];
      return d && d.total > 0 ? (1 - d.free / d.total) * 100 : null;
    }
    default: return null;
  }
}

/** A comparison that holds; a value not read yet holds nothing. */
function measured(m: LayoutMeasure): boolean {
  const n = sysNumber(m.what, m.drive);
  if (n === null) return false;
  if (typeof m.above === "number" && !(n > m.above)) return false;
  if (typeof m.below === "number" && !(n < m.below)) return false;
  return true;
}

const DAY_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

function minutes(s: string): number {
  const [h, m] = s.split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

/** The browser preview may set the time (dev/scenes.ts `&at=`). */
let fixedNow: Date | null = null;
export function lookNow(d: Date | null) {
  fixedNow = d;
}

/** Whether a piece shows now: all `when` says holds (nothing said: always). */
export function holds(w: LayoutWhen | undefined): boolean {
  if (!w) return true;
  const now = fixedNow ?? new Date();
  if (w.hours) {
    const [a, b] = w.hours.split("-").map(minutes);
    const n = now.getHours() * 60 + now.getMinutes();
    const inside = a === b ? true : a < b ? n >= a && n < b : n >= a || n < b;
    if (!inside) return false;
  }
  if (w.days?.length && !w.days.includes(DAY_KEYS[now.getDay()])) return false;
  const exe = (State.foreground?.exe ?? "").split(/[\\/]/).pop()?.toLowerCase() ?? "";
  if (w.app?.length && !w.app.includes(exe)) return false;
  if (w.not_app?.length && exe && w.not_app.includes(exe)) return false;
  if (w.value && !measured(w.value)) return false;
  return true;
}

/** The colour the first threshold that holds gives; null when none does. */
export function levelColor(levels: LayoutLevel[] | undefined): string | null {
  for (const l of levels ?? []) if (measured(l)) return l.color;
  return null;
}

/** The values of the PC the conditions and thresholds of the layout read (bar.ts `barSysKinds`). */
export function lookSysKinds(): string[] {
  const out = new Set<string>();
  const add = (x: { when?: LayoutWhen; levels?: LayoutLevel[] }) => {
    if (x.when?.value) out.add(x.when.value.what);
    for (const l of x.levels ?? []) out.add(l.what);
  };
  const L = State.layout;
  L.buttons.forEach(add);
  for (const tab of L.tabs) {
    add(tab);
    tab.buttons.forEach(add);
    (tab.blocks ?? []).forEach(add);
  }
  (L.overview?.blocks ?? []).forEach(add);
  for (const side of [L.footer?.left, L.footer?.center, L.footer?.right]) (side ?? []).forEach(add);
  return [...out];
}

/** Whether the layout has hours or days anywhere: only then the clock below runs. */
function timed(): boolean {
  const L = State.layout;
  const any = (x: { when?: LayoutWhen }) => !!(x.when?.hours || x.when?.days?.length);
  return L.buttons.some(any) || L.tabs.some((tab) => any(tab) || tab.buttons.some(any) || (tab.blocks ?? []).some(any))
    || (L.overview?.blocks ?? []).some(any)
    || [L.footer?.left, L.footer?.center, L.footer?.right].some((s) => (s ?? []).some(any));
}

/** What every `when` and `levels` gives now, all of them: when it changes the island redraws. */
export function lookSignature(): string {
  const L = State.layout;
  const out: string[] = [];
  const add = (x: { when?: LayoutWhen; levels?: LayoutLevel[] }) => {
    out.push(holds(x.when) ? "1" : "0");
    if (x.levels) out.push(levelColor(x.levels) ?? "-");
  };
  L.buttons.forEach(add);
  for (const tab of L.tabs) {
    add(tab);
    tab.buttons.forEach(add);
    (tab.blocks ?? []).forEach(add);
  }
  (L.overview?.blocks ?? []).forEach(add);
  for (const side of [L.footer?.left, L.footer?.center, L.footer?.right]) (side ?? []).forEach(add);
  return out.join("");
}

let lastSig = "";
/** New readings or a new minute: the island redraws only when a condition or a colour changed. */
export function lookCheck() {
  const sig = lookSignature();
  if (sig === lastSig) return;
  lastSig = sig;
  State.notify();
}

let clock: number | null = null;
/** Called at every sync: starts or stops the 30 s check of hours and days. */
export function lookClock() {
  const need = timed();
  if (need && clock === null) {
    lastSig = lookSignature();
    clock = window.setInterval(lookCheck, 30_000);
  } else if (!need && clock !== null) {
    window.clearInterval(clock);
    clock = null;
  }
}

/** The fonts of `style.font` (island_layout.rs `FONTS`). */
const FONT_STACKS: Record<string, string> = {
  system: 'system-ui, "Segoe UI Variable Text", "Segoe UI", "Segoe UI Emoji", sans-serif',
  segoe: '"Segoe UI Variable Display", "Segoe UI", "Segoe UI Emoji", sans-serif',
  rounded: '"Nunito", "Varela Round", "Arial Rounded MT Bold", "Segoe UI Variable Text", "Segoe UI", sans-serif',
  mono: '"Cascadia Mono", "Cascadia Code", Consolas, ui-monospace, monospace',
  serif: 'Georgia, "Cambria", "Times New Roman", serif',
  condensed: '"Bahnschrift SemiCondensed", "Bahnschrift", "Arial Narrow", "Segoe UI", sans-serif',
};

/** «#rrggbb» and an alpha as rgba(). */
export function rgba(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${Math.max(0, Math.min(1, a))})`;
}

/** The island's background from `style`: a colour, or two that meet as asked. Null: as Impostazioni say. */
export function styleBackground(st: LayoutStyle | undefined, alpha: number): { solid: string; image: string } | null {
  if (!st?.background) return null;
  const a = st.opacity ?? alpha;
  const solid = rgba(st.background, a);
  if (!st.background2) return { solid, image: "" };
  const second = rgba(st.background2, a);
  const image = st.gradient === "radial" ? `radial-gradient(circle at 30% 0%, ${solid}, ${second})`
    : `linear-gradient(${st.gradient === "down" ? "180deg" : st.gradient === "right" ? "90deg" : "135deg"}, ${solid}, ${second})`;
  return { solid, image };
}

/** The CSS variables and classes the island takes from `style` (on #island, so the bar and Impostazioni keep theirs). */
export function applyStyleVars(el: HTMLElement, st: LayoutStyle | undefined) {
  const set = (name: string, val: string | null | undefined) => {
    if (val) el.style.setProperty(name, val);
    else el.style.removeProperty(name);
  };
  set("--ink", st?.text);
  set("--dim", st?.dim);
  set("--dim-2", st?.dim);
  set("--win-accent", st?.accent);
  set("--own-accent", st?.accent);
  set("--card", st?.card);
  set("--card-alpha", typeof st?.card_opacity === "number" ? String(st.card_opacity) : null);
  set("--own-card-r", typeof st?.card_radius === "number" ? `${st.card_radius}px` : null);
  set("--font", st?.font ? FONT_STACKS[st.font] : null);
  set("--fs-up", typeof st?.text_size === "number" ? `${st.text_size}px` : null);
  set("--own-menu-bg", st?.menu_background ? rgba(st.menu_background, 0.55) : null);
  set("--own-header-bg", st?.header_background ? rgba(st.header_background, 0.55) : null);
  set("--own-foot-bg", st?.footer_background ? rgba(st.footer_background, 0.55) : null);
  const shadows: string[] = [];
  if (st?.border && (st.border_width ?? 1) > 0) shadows.push(`inset 0 0 0 ${st.border_width ?? 1}px ${st.border}`);
  if (st?.glow) shadows.push(`0 0 18px 1px ${rgba(st.glow, 0.55)}`);
  el.style.boxShadow = shadows.join(", ");
  el.classList.toggle("own-card-r", typeof st?.card_radius === "number");
  el.classList.toggle("own-menu-bg", !!st?.menu_background);
  el.classList.toggle("own-header-bg", !!st?.header_background);
  el.classList.toggle("own-foot-bg", !!st?.footer_background);
  if (st?.spacing && st.spacing !== "normal") el.dataset.spacing = st.spacing;
  else delete el.dataset.spacing;
}
