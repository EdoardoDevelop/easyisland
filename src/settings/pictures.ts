// The little pictures beside the settings of Impostazioni → Aspetto (asked by
// Edoardo on 29 Oct 2026: «piccole immagini o gif per fare vedere di cosa
// tratta o cambia quella voce»). Each one is a screen in miniature with the
// island, the character, the taskbar or the fixed bar, drawn for the value
// chosen now and redrawn on every change. They are drawn in code like the
// characters (no image or GIF files, CLAUDE.md), so they follow light/dark and
// the user's colours. Some loop a short CSS animation (settings.css → .pic);
// animations and the live character run only while they are in view.
//
// The SVG is built as a string: every value put in it is a number, one of a
// fixed set of words, or a colour checked against #rrggbb.

import { barThickness, type Settings } from "../core/state";
import { characters } from "../character/character";
import { BotEngine, hexToRGB } from "../character/engine";
import { setCharacter } from "../character/character";
import { setFigure, setFigureLogo, setFigureWeather } from "../character/figure";
import { islandHex, uiStyle } from "../core/uistyle";

export type PicKind =
  | "look" | "compactBg" | "greeting" | "follow" | "bubble" | "menuChar"
  | "screen" | "anchor" | "overTaskbar" | "glue" | "fullscreen"
  | "bar" | "barSlot" | "barBg"
  | "rest" | "hover" | "always" | "strip" | "appBar" | "alerts"
  | "place" | "openDelay" | "autoClose" | "closeBtn" | "size" | "search" | "app";

const HEX = /^#[0-9a-f]{6}$/i;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const n1 = (v: number) => Math.round(v * 10) / 10;

function luma(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
}

interface Paint {
  island: string;
  alpha: number;
  ink: string;
  body: string;
  windows: boolean;
  /** Jarvis: a sphere of dots rather than a body with eyes. */
  dots: boolean;
  /** Jarvis's own colours from the middle out (purple, magenta, orange), unless the user chose one. */
  rings: [string, string, string] | null;
}

function paint(s: Settings): Paint {
  const th = s.theme;
  const island = islandHex(th.islandColor, th.style);
  const c = characters().find((x) => x.id === th.character) ?? characters()[0];
  const own = c ? `#${c.color.map((v) => Math.round(v * 255).toString(16).padStart(2, "0")).join("")}` : "#4ade80";
  return {
    island,
    alpha: clamp(th.islandOpacity ?? 1, 0.5, 1),
    ink: luma(island) > 150 ? "#16181d" : "#f5f6f8",
    body: HEX.test(th.slimeColor ?? "") ? th.slimeColor : own,
    windows: uiStyle(th.style) === "windows",
    dots: (c?.id ?? "").startsWith("jarvis"),
    rings: HEX.test(th.slimeColor ?? "") ? null : ["#7C3AED", "#C026D3", "#F97316"],
  };
}

// ── Pieces ─────────────────────────────────────────────────────────────────────

const svg = (body: string) =>
  `<svg viewBox="0 0 160 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;

/** The desktop, with two app windows on it. */
function screen(apps = true): string {
  return `<rect class="p-scr" width="160" height="100" rx="7"/>` + (apps
    ? `<rect class="p-app" x="12" y="20" width="72" height="50" rx="3"/><rect class="p-app" x="66" y="34" width="80" height="46" rx="3"/>`
    : "");
}

/** The Windows taskbar along the bottom. */
function taskbar(): string {
  let icons = "";
  for (let i = 0; i < 4; i++) icons += `<rect class="p-tbi" x="${66 + i * 8}" y="94.5" width="5" height="3.5" rx="1"/>`;
  return `<path class="p-tb" d="M0 91 H160 V93 a7 7 0 0 1 -7 7 H7 a7 7 0 0 1 -7 -7 Z"/>${icons}`;
}

function island(p: Paint, x: number, y: number, w: number, h: number, r: number, extra = ""): string {
  return `<rect x="${n1(x)}" y="${n1(y)}" width="${n1(w)}" height="${n1(h)}" rx="${n1(r)}" fill="${p.island}" fill-opacity="${p.alpha}" ${extra}/>`;
}

/**
 * The character. Jarvis is a sphere of dots with a glow, as in the island; the
 * others a body in their colour with two eyes. `eyes` can carry an animation class.
 */
function chr(p: Paint, cx: number, cy: number, r: number, cls = "", eyes = ""): string {
  if (p.dots) {
    let dots = "";
    // A fixed scatter: rings of dots, denser towards the middle.
    for (const [ring, k, n] of [[0, 0.3, 5], [1, 0.58, 9], [2, 0.85, 13]] as const) {
      const fill = p.rings ? p.rings[ring] : p.body;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + k * 3;
        dots += `<circle cx="${n1(cx + Math.cos(a) * r * k)}" cy="${n1(cy + Math.sin(a) * r * k)}" r="${n1(Math.max(0.35, r * 0.07))}" fill="${fill}"/>`;
      }
    }
    return `<g class="${cls}"><circle cx="${n1(cx)}" cy="${n1(cy)}" r="${n1(r * 1.15)}" fill="${p.rings ? p.rings[0] : p.body}" fill-opacity="0.22"/>` +
      `<g class="${eyes}">${dots}</g></g>`;
  }
  const ex = r * 0.36;
  const ey = cy - r * 0.08;
  return `<g class="${cls}"><circle cx="${n1(cx)}" cy="${n1(cy)}" r="${n1(r)}" fill="${p.body}"/>` +
    `<g class="${eyes}"><ellipse cx="${n1(cx - ex)}" cy="${n1(ey)}" rx="${n1(r * 0.13)}" ry="${n1(r * 0.22)}" fill="#111"/>` +
    `<ellipse cx="${n1(cx + ex)}" cy="${n1(ey)}" rx="${n1(r * 0.13)}" ry="${n1(r * 0.22)}" fill="#111"/></g></g>`;
}

/**
 * The closed island's shape centred at cx, cy: at the top with «Aggancia ai
 * bordi» it hangs from the edge (square top corners, round bottom), as in the
 * app; elsewhere a pill.
 */
function notch(p: Paint, s: Settings, cx: number, cy: number, w: number, h: number): string {
  if (!(s.theme.compactBackground ?? true)) return "";
  const hang = s.glueEdges && cy - h / 2 < 6;
  return hang
    ? island(p, cx - w / 2, cy - h / 2 - 12, w, h + 12, h / 2)
    : island(p, cx - w / 2, cy - h / 2, w, h, h / 2);
}

/** The closed island at rest: the character on its notch (or alone, without the background). */
function compact(p: Paint, cx: number, cy: number, s: Settings, cls = ""): string {
  return `<g class="${cls}">${notch(p, s, cx, cy, 22, 14)}${chr(p, cx, cy, 5)}</g>`;
}

/**
 * The compact view at the top centre (the mouse over the character): the
 * character bigger, or the bar with the integrations as small characters.
 */
function compactView(p: Paint, s: Settings, cls = ""): string {
  if (s.hoverStyle === "bar") {
    const minis = ["#A78BFA", "#38BDF8", "#F472B6", "#F5A524"]
      .map((c, i) => chr({ ...p, body: c, rings: null }, 98 + (i % 2) * 9, 7 + Math.floor(i / 2) * 8, 3.4)).join("");
    return `<g class="${cls}">${notch(p, s, 80, 11, 76, 20)}${chr(p, 52, 11, 6.5)}${minis}</g>`;
  }
  const r = 4 + (clamp(s.hoverSize, 28, 64) - 28) * 0.18;
  return `<g class="${cls}">${notch(p, s, 80, r + 5, r * 3.2, r * 2 + 6)}${chr(p, 80, r + 5, r)}</g>`;
}

function cursor(x: number, y: number, cls = ""): string {
  return `<g class="${cls}"><path class="p-cur" transform="translate(${n1(x)} ${n1(y)})" d="M0 0 L0 11 L3 8.2 L5.3 13 L7.4 12 L5.2 7.4 L9 7.4 Z"/></g>`;
}

/** Lines of text in the island's ink. */
function lines(p: Paint, x: number, y: number, widths: number[], gap = 5, h = 2.4): string {
  return widths.map((w, i) =>
    `<rect x="${n1(x)}" y="${n1(y + i * gap)}" width="${n1(w)}" height="${h}" rx="${h / 2}" fill="${p.ink}" fill-opacity="0.45"/>`).join("");
}

function button(x: number, y: number, w: number, fill: string, h = 6): string {
  return `<rect x="${n1(x)}" y="${n1(y)}" width="${n1(w)}" height="${h}" rx="${h / 2}" fill="${fill}"/>`;
}

/** An accent frame around a part of a picture: the part the setting changes. */
function mark(x: number, y: number, w: number, h: number, r = 2): string {
  return `<rect class="p-mark a-pulse" x="${n1(x - 1.2)}" y="${n1(y - 1.2)}" width="${n1(w + 2.4)}" height="${n1(h + 2.4)}" rx="${n1(r + 1)}"/>`;
}

type PanelPart = "" | "bubble" | "search" | "close" | "menu";

/**
 * The open island as the app draws it: along the top the character's bubble
 * («Tutto tranquillo»), the search field and the buttons ending with ✕; on the
 * left the menu with the character on top; on the right the cards. `hi` frames
 * the part a setting is about.
 */
function panel(p: Paint, s: Settings, x: number, y: number, w: number, h: number, cls = "", hi: PanelPart = "", card = ""): string {
  const r = p.windows ? 5 : 9;
  const hh = Math.max(8, h * 0.14);
  let out = island(p, x, y, w, h, r);
  let marks = "";
  // Header.
  if (s.characterBubble !== false) {
    const bw = w * 0.34;
    out += `<rect x="${n1(x + 3)}" y="${n1(y + 2.5)}" width="${n1(bw)}" height="${n1(hh - 3)}" rx="1.8" fill="${p.ink}" fill-opacity="0.05" stroke="${p.ink}" stroke-opacity="0.18" stroke-width="0.4"/>` +
      lines(p, x + 5, y + 3.6 + (hh - 3) * 0.12, [bw * 0.45, bw * 0.6], (hh - 3) * 0.38, 1.3);
    if (hi === "bubble") marks += mark(x + 3, y + 2.5, bw, hh - 3);
  }
  if (s.searchBar !== false) {
    const sx = x + w * 0.4;
    const sw = w * 0.3;
    out += `<rect x="${n1(sx)}" y="${n1(y + 3)}" width="${n1(sw)}" height="${n1(hh - 4)}" rx="1.5" fill="none" stroke="${p.ink}" stroke-opacity="0.3" stroke-width="0.45"/>` +
      `<circle cx="${n1(sx + 3)}" cy="${n1(y + 1 + hh / 2)}" r="1" fill="none" stroke="${p.ink}" stroke-opacity="0.7" stroke-width="0.4"/>` +
      lines(p, sx + 5.5, y + hh / 2 + 0.3, [sw * 0.45], 0, 1.2);
    if (hi === "search") marks += mark(sx, y + 3, sw, hh - 4);
  }
  const icons = s.closeButton ? 4 : 3;
  for (let i = 0; i < icons; i++) {
    const ix = x + w - 5 - i * 6;
    const iy = y + 1 + hh / 2;
    out += i === 0 && s.closeButton
      ? `<path d="M${n1(ix - 1.2)} ${n1(iy - 1.2)} L${n1(ix + 1.2)} ${n1(iy + 1.2)} M${n1(ix + 1.2)} ${n1(iy - 1.2)} L${n1(ix - 1.2)} ${n1(iy + 1.2)}" stroke="${p.ink}" stroke-opacity="0.8" stroke-width="0.5" stroke-linecap="round"/>`
      : `<circle cx="${n1(ix)}" cy="${n1(iy)}" r="1" fill="${p.ink}" fill-opacity="0.6"/>`;
  }
  if (hi === "close" && s.closeButton) marks += mark(x + w - 8, y + 1 + hh / 2 - 3, 6, 6, 3);
  // Menu.
  const rw = w * 0.26;
  const top = y + hh + 1;
  const cr = rw * (({ large: 0.24, medium: 0.17, small: 0.11 } as const)[s.menuCharacter ?? "large"] ?? 0.24);
  out += chr(p, x + 3 + rw / 2, top + 2 + cr * 1.1, cr);
  if (hi === "menu") marks += mark(x + 3 + rw / 2 - cr * 1.3, top + 2 + cr * 1.1 - cr * 1.3, cr * 2.6, cr * 2.6, cr);
  const colors = ["#94A3B8", "#A78BFA", "#22D3EE", "#F5A524", "#22C55E"];
  const step = Math.max(4.2, h * 0.075);
  for (let i = 0; i < 5; i++) {
    const iy = top + 4 + cr * 2.4 + i * step;
    if (iy + 3 > y + h - 2) break;
    if (i === 0) {
      out += `<rect x="${n1(x + 3)}" y="${n1(iy - 1)}" width="${n1(rw)}" height="${n1(step - 0.6)}" rx="1.2" fill="${p.ink}" fill-opacity="0.08"/>` +
        `<rect x="${n1(x + 3)}" y="${n1(iy)}" width="0.8" height="${n1(step - 2.6)}" rx="0.4" class="p-accent"/>`;
    }
    out += p.windows
      ? `<rect x="${n1(x + 6)}" y="${n1(iy)}" width="2.4" height="2.4" rx="0.5" fill="none" stroke="${p.ink}" stroke-opacity="0.7" stroke-width="0.4"/>`
      : `<circle cx="${n1(x + 7.2)}" cy="${n1(iy + 1.2)}" r="1.3" fill="${colors[i]}"/>`;
    out += lines(p, x + 10.5, iy + 0.6, [rw * 0.45], 0, 1.2);
  }
  // Content: a title and the cards.
  const cx = x + rw + 6;
  const cw = w - rw - 9;
  const ch = h - hh - 4;
  out += `<rect x="${n1(cx)}" y="${n1(top)}" width="${n1(cw)}" height="${n1(ch)}" rx="${p.windows ? 2.5 : 5}" fill="${p.ink}" fill-opacity="0.03" stroke="${p.ink}" stroke-opacity="0.1" stroke-width="0.4"/>`;
  if (card) {
    out += card;
  } else {
    out += lines(p, cx + 4, top + ch * 0.22, [cw * 0.3], 0, 1.8);
    const gw = (cw - 10) / 3;
    const gh = Math.min(10, (ch * 0.6 - 4) / 2);
    for (let i = 0; i < 5; i++) {
      const gx = cx + 4 + (i % 3) * (gw + 1);
      const gy = top + ch * 0.32 + Math.floor(i / 3) * (gh + 1.5);
      out += `<rect x="${n1(gx)}" y="${n1(gy)}" width="${n1(gw)}" height="${n1(gh)}" rx="1.2" fill="${p.ink}" fill-opacity="0.05" stroke="${p.ink}" stroke-opacity="0.14" stroke-width="0.35"/>` +
        lines(p, gx + 1.5, gy + gh * 0.28, [gw * 0.45, gw * 0.65], gh * 0.3, 1);
    }
  }
  return `<g class="${cls}">${out}${marks}</g>`;
}

/** A permission in the open island's content: who asks, the command, Nega and Consenti. */
function approvalCard(p: Paint, x: number, y: number, w: number): string {
  return `<rect x="${n1(x)}" y="${n1(y)}" width="${n1(w)}" height="14" rx="2" fill="#F5A524" fill-opacity="0.14"/>` +
    `<rect x="${n1(x + 3)}" y="${n1(y + 3)}" width="${n1(w * 0.35)}" height="1.8" rx="0.9" fill="${p.ink}" fill-opacity="0.8"/>` +
    `<rect x="${n1(x + 3)}" y="${n1(y + 7)}" width="${n1(w * 0.28)}" height="1.6" rx="0.8" fill="#F5A524"/>` +
    button(x + w - 25, y + 4, 11, `${p.ink}`, 6).replace("/>", ` fill-opacity="0.15"/>`) +
    `<rect x="${n1(x + w - 13)}" y="${n1(y + 4)}" width="11" height="6" rx="3" class="p-accent"/>`;
}

/**
 * The strip in the compact island, as the app draws it: the character, who
 * asks (amber), the command, Nega and Consenti. `left`: the strip on the
 * character's left.
 */
function stripNotch(p: Paint, s: Settings, left: boolean): string {
  const w = 104;
  const x0 = 80 - w / 2;
  const charX = left ? x0 + w - 10 : x0 + 10;
  const tx = left ? x0 + 6 : x0 + 20;
  return notch(p, s, 80, 11, w, 20) + chr(p, charX, 11, 6) +
    `<rect x="${n1(tx)}" y="6.5" width="30" height="2.4" rx="1.2" fill="${p.ink}" fill-opacity="0.85"/>` +
    `<rect x="${n1(tx)}" y="12" width="24" height="2.2" rx="1.1" fill="#F5A524"/>` +
    `<rect x="${n1(tx + 36)}" y="7" width="15" height="8" rx="2" fill="${p.ink}" fill-opacity="0.14"/>` +
    `<rect x="${n1(tx + 53)}" y="7" width="17" height="8" rx="2" class="p-accent"/>`;
}

/** Where the character sits on the miniature screen (Posizione). */
function spot(s: Settings, v = s.anchorV, hz = s.anchorH): { x: number; y: number } {
  const x = hz === "left" ? 16 : hz === "right" ? 144 : 80;
  const y = v === "bottom" ? (s.overTaskbar ? 95.5 : 84) : 8;
  return { x, y };
}

/** The fixed bar's fill: the island's, none (a dashed outline) or the user's colour. */
function barFill(s: Settings, p: Paint): { attrs: string; ink: string } {
  const bg = s.fixedBarBackground ?? "";
  if (bg === "transparent") return { attrs: `fill="none" stroke="${p.ink}" stroke-opacity="0.35" stroke-dasharray="2 2" stroke-width="0.6"`, ink: "#ffffff" };
  if (HEX.test(bg)) return { attrs: `fill="${bg}"`, ink: luma(bg) > 150 ? "#16181d" : "#f5f6f8" };
  return { attrs: `fill="${p.island}" fill-opacity="${p.alpha}"`, ink: p.ink };
}

/** The elements of the fixed bar in their areas, as small pills; returns the markup. */
function barItems(s: Settings, y: number, h: number, ink: string, scale = 1): string {
  const items = s.fixedBarItems ?? [];
  const slot = s.fixedBarSlot ?? "center";
  const area = (a: string) => items.filter((x) => (x.area === "start" || x.area === "end" ? x.area : "center") === a);
  const w = (it: { show?: string }) => (it.show === "icon" ? 6 : it.show === "value" ? 14 : 20) * scale;
  let out = "";
  const pill = (x: number, it: { id: string; show?: string }) => {
    const ww = w(it);
    const strip = it.id === "strip";
    const color = strip ? "#F5A524" : it.id.startsWith("action:") ? "#A78BFA" : it.id.startsWith("sys:") ? "#34D399" : "#38BDF8";
    let m = "";
    if (it.show !== "value") m += `<circle cx="${n1(x + 3 * scale)}" cy="${n1(y + h / 2)}" r="${n1(2.2 * scale)}" fill="${color}"/>`;
    if (it.show !== "icon") m += `<rect x="${n1(x + (it.show === "value" ? 0 : 7 * scale))}" y="${n1(y + h / 2 - 1.2 * scale)}" width="${n1(ww - (it.show === "value" ? 0 : 7 * scale))}" height="${n1(2.4 * scale)}" rx="1" fill="${ink}" fill-opacity="0.6"/>`;
    return m;
  };
  const gap = 4 * scale;
  const charW = h * 0.9 + gap;
  for (const a of ["start", "center", "end"] as const) {
    const list = area(a);
    const total = list.reduce((t, it) => t + w(it) + gap, 0) + (slot === a ? charW : 0);
    let x = a === "start" ? 6 * scale : a === "end" ? 160 - 6 * scale - total : 80 - total / 2;
    if (slot === a && a !== "end") x += charW;
    for (const it of list) {
      out += pill(x, it);
      x += w(it) + gap;
    }
  }
  return out;
}

function barCharX(s: Settings, scale = 1, h = 10): number {
  const slot = s.fixedBarSlot ?? "center";
  const items = (s.fixedBarItems ?? []).filter((x) => (x.area === "start" || x.area === "end" ? x.area : "center") === slot);
  const gap = 4 * scale;
  const ww = items.reduce((t, it) => t + (it.show === "icon" ? 6 : it.show === "value" ? 14 : 20) * scale + gap, 0);
  const charW = h * 0.9 + gap;
  if (slot === "start") return 6 * scale + h * 0.45;
  if (slot === "end") return 160 - 6 * scale - ww - charW + h * 0.45;
  return 80 - (ww + charW) / 2 + h * 0.45;
}

// ── The pictures ───────────────────────────────────────────────────────────────

/** The SVG markup of one picture for the settings as they are now. */
export function picture(kind: PicKind, s: Settings): string {
  const p = paint(s);
  const top = (cls = "") => compact(p, 80, 9, s, cls);
  switch (kind) {
    case "look":
      // A coloured window under the open island shows how see-through it is.
      return svg(screen() + `<rect x="78" y="40" width="70" height="40" rx="3" fill="#3B82F6"/><rect x="88" y="50" width="30" height="20" rx="2" fill="#F472B6"/>` +
        panel(p, s, 20, 10, 120, 64) +
        (p.windows ? `<rect x="58" y="70" width="18" height="1.6" rx="0.8" class="p-accent"/>` : ""));
    case "compactBg":
      return svg(screen() + `<g transform="translate(80 12) scale(2.2) translate(-80 -9)">${top()}</g>`);
    case "greeting": {
      const at = spot(s);
      if (s.greeting === false) return svg(screen() + taskbar() + compact(p, at.x, at.y, s));
      const place = s.greetingPlace ?? "center";
      const style = place === "center" ? `style="--gx:${n1(80 - at.x)}px;--gy:${n1(50 - at.y)}px"` : "";
      return svg(screen() + taskbar() +
        `<g class="${place === "center" ? "a-greet" : "a-pop"}" ${style}>${chr(p, at.x, at.y, 5)}</g>` +
        `<g class="a-greet-bg">${island(p, at.x - 13, at.y - 7, 26, 14, 7)}${chr(p, at.x, at.y, 5)}</g>`);
    }
    case "follow": {
      const follow = s.followCursorCompact;
      return svg(screen() + notch(p, s, 80, 14, 50, 28) + chr(p, 80, 14, 10, "", follow ? "a-look" : "a-wander") +
        cursor(30, 66, "a-sweep"));
    }
    case "bubble":
      // The bubble is the box at the top left of the open island («Tutto tranquillo»).
      return svg(screen() + panel(p, s, 8, 8, 144, 84, "", "bubble"));
    case "menuChar":
      return svg(screen() + panel(p, s, 8, 8, 144, 84, "", "menu"));
    case "screen": {
      const cursorScreen = s.screen === "cursor";
      const second = s.screen.startsWith("monitor:");
      const onB = cursorScreen || second;
      const mon = (x: number, y: number, w: number, h: number, on: boolean, star: boolean) =>
        `<rect class="p-scr${on ? " p-on" : ""}" x="${x}" y="${y}" width="${w}" height="${h}" rx="4"/>` +
        `<rect class="p-stand" x="${x + w / 2 - 6}" y="${y + h + 2}" width="12" height="2" rx="1"/>` +
        (star ? `<path class="p-star" transform="translate(${x + 7} ${y + 7}) scale(0.5)" d="M0 -6 L1.8 -1.9 L6 -1.9 L2.6 0.8 L3.8 5 L0 2.5 L-3.8 5 L-2.6 0.8 L-6 -1.9 L-1.8 -1.9 Z"/>` : "") +
        (on ? compact(p, x + w / 2, y + 7, s) : "");
      return svg(mon(4, 20, 72, 50, !onB, true) + mon(84, 24, 72, 46, onB, false) + (cursorScreen ? cursor(118, 48) : ""));
    }
    case "anchor": {
      let spots = "";
      for (const v of ["top", "bottom"] as const) {
        for (const hz of ["left", "center", "right"] as const) {
          const at = spot(s, v, hz);
          if (v === s.anchorV && hz === s.anchorH) continue;
          spots += `<circle class="p-spot" data-v="${v}" data-h="${hz}" cx="${at.x}" cy="${at.y}" r="6"/>`;
        }
      }
      const at = spot(s);
      return svg(screen() + taskbar() + spots + compact(p, at.x, at.y, s));
    }
    case "overTaskbar": {
      const y = s.overTaskbar ? 95.5 : 84;
      return svg(screen() + taskbar() + `<g transform="translate(144 ${y}) scale(1.5) translate(-144 ${-y})">${compact(p, 144, y, s)}</g>`);
    }
    case "glue": {
      // The top-left corner, close up: glued, the background reaches the edge.
      const body = s.glueEdges
        ? island(p, 26, -10, 46, 36, 12) + chr(p, 49, 12, 8)
        : island(p, 30, 4, 38, 22, 11) + chr(p, 49, 15, 8);
      return svg(`<rect class="p-scr" width="160" height="100" rx="7"/><rect class="p-app" x="20" y="44" width="110" height="50" rx="3"/>` +
        `<line class="p-edge" x1="4" y1="0.8" x2="156" y2="0.8"/>` + body);
    }
    case "fullscreen":
      return svg(`<rect width="160" height="100" rx="7" fill="#0f172a"/><path d="M72 40 L72 60 L90 50 Z" fill="#ffffff" fill-opacity="0.8"/>` +
        `<rect x="14" y="88" width="132" height="2" rx="1" fill="#ffffff" fill-opacity="0.25"/><rect x="14" y="88" width="52" height="2" rx="1" fill="#F4505E"/>` +
        (s.quietFullscreen ? "" : top()));
    case "bar": {
      const edge = s.fixedBar;
      if (!edge) {
        const at = spot(s);
        return svg(screen() + taskbar() + compact(p, at.x, at.y, s));
      }
      const f = barFill(s, p);
      const y = edge === "top" ? 0 : 80;
      const app = edge === "top" ? `<rect class="p-app" x="6" y="12" width="148" height="77" rx="2"/>` : `<rect class="p-app" x="6" y="4" width="148" height="74" rx="2"/>`;
      const band = edge === "top"
        ? `<path d="M0 7 a7 7 0 0 1 7 -7 H153 a7 7 0 0 1 7 7 V10 H0 Z" ${f.attrs}/>`
        : `<rect x="0" y="${y}" width="160" height="10" ${f.attrs}/>`;
      return svg(`<rect class="p-scr" width="160" height="100" rx="7"/>` + app + taskbar() + band +
        barItems(s, y, 10, f.ink, 0.8) + chr(p, barCharX(s, 0.8, 10), y + 5, 3.8));
    }
    case "barSlot":
    case "barBg": {
      const f = barFill(s, p);
      const wall = kind === "barBg"
        ? `<rect width="160" height="100" rx="7" fill="#0EA5E9"/><path d="M0 60 Q40 30 80 55 T160 45 V93 a7 7 0 0 1 -7 7 H7 a7 7 0 0 1 -7 -7 Z" fill="#22C55E"/><circle cx="128" cy="70" r="16" fill="#FACC15"/>`
        : `<rect class="p-scr" width="160" height="100" rx="7"/>`;
      // The band against a 1920 px wide screen, its height as set.
      const bh = clamp(barThickness(s) * 0.45, 11, 44);
      const by = 49 - bh / 2;
      const k = bh / 18;
      return svg(wall + `<rect x="0" y="${n1(by)}" width="160" height="${n1(bh)}" ${f.attrs}/>` +
        barItems(s, by, bh, f.ink, k) + chr(p, barCharX(s, k, bh), 49, bh * 0.38));
    }
    case "rest": {
      const size = clamp(s.iconSize, 16, 48);
      const r = 3 + (size - 16) * 0.22;
      const style = s.iconStyle;
      const body = style === "none"
        ? `<rect class="a-pulse" x="64" y="0" width="32" height="2.4" rx="1.2" fill="${p.ink}" fill-opacity="0.5"/>`
        : style === "dot"
          ? notch(p, s, 80, r + 3, r * 2.6, r * 2 + 4) + `<circle cx="80" cy="${n1(r + 3)}" r="${n1(r * 0.6)}" fill="#22C55E"/>`
          : notch(p, s, 80, r + 4, r * 3, r * 2 + 6) + chr(p, 80, r + 4, r);
      return svg(screen() + taskbar() + body);
    }
    case "hover":
      return svg(screen() + `<g class="a-swap-a">${top()}</g>${compactView(p, s, "a-swap-b")}` + cursor(40, 70, "a-approach"));
    case "always":
      if (s.revealDuration <= 0) return svg(screen() + compactView(p, s));
      return svg(screen() + `${compactView(p, s, "a-hold-a")}<g class="a-hold-b">${top()}</g>`);
    case "strip": {
      const where = s.compactStrip ?? "right";
      if (where === "off") {
        return svg(screen() + panel(p, s, 8, 8, 144, 84, "", "", approvalCard(p, 52, 36, 92)));
      }
      return svg(screen() + `<g class="a-fade">${stripNotch(p, s, where === "left")}</g><g class="a-fade-out">${top()}</g>`);
    }
    case "appBar": {
      if (s.appBar === false) return svg(screen() + top());
      const look = s.appBarLook ?? "both";
      const n = Math.min(clamp(s.appBarMax || 6, 1, 12), 4);
      const bw = look === "icon" ? 8 : look === "text" ? 13 : 17;
      const nameW = s.appBarName !== false ? 16 : 0;
      const w = 22 + nameW + n * (bw + 2.5);
      const x0 = 80 - w / 2;
      let btns = "";
      const colors = ["#38BDF8", "#F472B6", "#FACC15", "#22C55E"];
      for (let i = 0; i < n; i++) {
        const bx = x0 + 18 + nameW + i * (bw + 2.5);
        btns += `<rect x="${n1(bx)}" y="7" width="${bw}" height="8" rx="2" fill="${p.ink}" fill-opacity="0.12"/>`;
        if (look !== "text") btns += `<rect x="${n1(bx + 2)}" y="9" width="4" height="4" rx="1" fill="${colors[i]}"/>`;
        if (look !== "icon") btns += `<rect x="${n1(bx + (look === "text" ? 2 : 7.5))}" y="10" width="${look === "text" ? 9 : 7.5}" height="1.8" rx="0.9" fill="${p.ink}" fill-opacity="0.55"/>`;
      }
      return svg(screen() + notch(p, s, 80, 11, w, 20) + chr(p, x0 + 10, 11, 6) +
        (nameW ? lines(p, x0 + 19, 10, [12], 0, 1.8) : "") + btns);
    }
    case "alerts":
      if (s.alertsOpen !== false) {
        return svg(screen() + `<g class="a-hold-a">${top()}</g>` +
          panel(p, s, 8, 8, 144, 84, "a-hold-b", "", approvalCard(p, 52, 36, 92)));
      }
      return svg(screen() + `<g transform="translate(80 12) scale(2) translate(-80 -9)">${top()}<circle class="a-pulse" cx="76" cy="5" r="1.8" fill="#F5A524"/></g>`);
    case "place": {
      const at = spot(s);
      const w = 70;
      const h = 44;
      const where = s.islandPlace ?? "character";
      let x = 45;
      let y = 4;
      if (where === "center") y = 26;
      else if (where === "bottom") y = 44;
      else if (where === "character") {
        x = clamp(at.x - w / 2 + (s.anchorH === "left" ? 28 : s.anchorH === "right" ? -28 : 0), 4, 156 - w);
        y = s.anchorV === "bottom" ? 34 : 16;
      }
      return svg(screen() + taskbar() + compact(p, at.x, at.y, s) + panel(p, s, x, y, w, h));
    }
    case "openDelay": {
      const d = s.openDelay;
      const label = d > 0 ? `${String(d).replace(".", ",")} s` : "";
      const ring = d > 0
        ? `<circle class="a-ring" cx="80" cy="16" r="11" fill="none" stroke="var(--accent, #4cc2ff)" stroke-width="1.6" pathLength="100" stroke-dasharray="100" stroke-dashoffset="100"/>`
        : `<circle class="a-click" cx="80" cy="16" r="6" fill="none" stroke="var(--accent, #4cc2ff)" stroke-width="1.2"/>`;
      return svg(screen() + `<g class="a-hold-c">${compact(p, 80, 16, s)}</g>` + ring +
        `<g class="a-open">${panel(p, s, 30, 4, 100, 60)}</g>` + cursor(84, 18, "a-come") +
        (label ? `<text class="p-label" x="152" y="92" text-anchor="end">${label}</text>` : ""));
    }
    case "autoClose": {
      if (s.stayOpenByUser) {
        return svg(screen() + panel(p, s, 30, 4, 100, 60) +
          `<g transform="translate(118 9)"><circle r="4" fill="var(--accent, #4cc2ff)"/><path d="M-1 -2 L1 -2 L1 0.5 L2 1.5 L-2 1.5 L-1 0.5 Z M-0.3 1.5 L0 3.5 L0.3 1.5 Z" fill="#111"/></g>` +
          cursor(60, 40, "a-leave"));
      }
      const sec = clamp(s.autoCloseInterval, 5, 120);
      return svg(screen() + `<g class="a-close">${panel(p, s, 30, 4, 100, 60)}<rect class="a-timer" x="30" y="66" width="100" height="1.6" rx="0.8" fill="var(--accent, #4cc2ff)"/></g>` +
        `<g class="a-closed">${top()}</g>` + cursor(60, 40, "a-leave") +
        `<text class="p-label" x="152" y="92" text-anchor="end">${sec} s</text>`);
    }
    case "closeBtn":
      return svg(screen() + panel(p, s, 8, 8, 144, 84, "", "close"));
    case "size": {
      // The open island against a 1920×1080 screen.
      const w = clamp(((s.islandWidth ?? 640) + 90) / 1920 * 160, 40, 152);
      const h = clamp(Math.max(s.islandHeight ?? 0, 360) / 1080 * 100, 26, 86);
      return svg(screen() + taskbar() + panel(p, s, 80 - w / 2, 3, w, h));
    }
    case "search":
      return svg(screen() + panel(p, s, 8, 8, 144, 84, "", "search"));
    case "app": {
      const on = s.islandApp ?? false;
      let icons = "";
      const colors = ["#38BDF8", "#F59E0B", "#22C55E"];
      for (let i = 0; i < 3; i++) icons += `<rect x="${48 + i * 18}" y="72" width="12" height="12" rx="3" fill="${colors[i]}"/>`;
      const own = on
        ? `<g class="a-fade">${island(p, 102, 72, 12, 12, 3)}${chr(p, 108, 78, 3.6)}<rect x="104" y="87" width="8" height="1.6" rx="0.8" class="p-accent"/></g>`
        : "";
      return svg(screen() + `<path class="p-tb" d="M0 66 H160 V93 a7 7 0 0 1 -7 7 H7 a7 7 0 0 1 -7 -7 Z"/>` + icons + own);
    }
  }
  return svg(screen());
}

// ── In the page ────────────────────────────────────────────────────────────────

const seen = new IntersectionObserver((entries) => {
  for (const e of entries) e.target.classList.toggle("run", e.isIntersecting);
});

/** A picture box; `refreshPictures` redraws it. */
export function pictureBox(kind: PicKind, s: Settings, onClick?: (target: Element) => void, big = false): HTMLElement {
  const el = document.createElement("div");
  el.className = big ? "pic big" : "pic";
  el.dataset.pic = kind;
  el.innerHTML = picture(kind, s);
  if (onClick) {
    el.classList.add("clickable");
    el.addEventListener("click", (e) => onClick(e.target as Element));
  }
  seen.observe(el);
  return el;
}

/** Redraws every picture in the page for the settings as they are now. */
export function refreshPictures(s: Settings) {
  for (const el of document.querySelectorAll<HTMLElement>(".pic[data-pic]")) {
    el.innerHTML = picture(el.dataset.pic as PicKind, s);
  }
  live?.sync(s);
}

// ── The character, alive ───────────────────────────────────────────────────────

interface Live {
  sync(s: Settings): void;
}
let live: Live | null = null;

/**
 * The character as the island draws it (the same engine), moving, or the logo
 * or the weather when the island shows one of those. It draws only while in
 * view, at 30 frames a second.
 */
export function liveCharacter(s: Settings, logoUrl: () => Promise<string | null>): HTMLElement {
  const size = 120;
  const box = document.createElement("div");
  box.className = "pic pic-live";
  const canvas = document.createElement("canvas");
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = canvas.height = Math.round(size * dpr);
  canvas.style.width = canvas.style.height = `${size}px`;
  box.append(canvas);
  const engine = new BotEngine();
  let visible = false;
  let raf = 0;
  let last = 0;
  const frame = (ts: number) => {
    raf = 0;
    if (!visible || !box.isConnected) return;
    raf = requestAnimationFrame(frame);
    if (ts - last < 33) return;
    const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0.016;
    last = ts;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    engine.update(dt);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, size, size);
    engine.draw(ctx, size, size);
  };
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
    if (visible && !raf) {
      last = 0;
      raf = requestAnimationFrame(frame);
    }
  }).observe(box);
  live = {
    sync(next: Settings) {
      const th = next.theme;
      setCharacter(th.character);
      setFigure(th.figure);
      if (th.figure === "logo") void logoUrl().then((u) => setFigureLogo(u ?? "")).catch(() => {});
      if (th.figure === "weather") setFigureWeather("sun-cloud", "18°");
      engine.bodyColor = HEX.test(th.slimeColor ?? "") ? hexToRGB(th.slimeColor) : null;
      box.style.background = `color-mix(in srgb, ${islandHex(th.islandColor, th.style)} ${Math.round(clamp(th.islandOpacity ?? 1, 0.5, 1) * 100)}%, transparent)`;
    },
  };
  live.sync(s);
  return box;
}
