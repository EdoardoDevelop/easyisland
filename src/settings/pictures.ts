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

import type { Settings } from "../core/state";
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

/** The character: its body colour with two eyes. `eyes` can carry an animation class. */
function chr(p: Paint, cx: number, cy: number, r: number, cls = "", eyes = ""): string {
  const ex = r * 0.36;
  const ey = cy - r * 0.08;
  return `<g class="${cls}"><circle cx="${n1(cx)}" cy="${n1(cy)}" r="${n1(r)}" fill="${p.body}"/>` +
    `<g class="${eyes}"><ellipse cx="${n1(cx - ex)}" cy="${n1(ey)}" rx="${n1(r * 0.13)}" ry="${n1(r * 0.22)}" fill="#111"/>` +
    `<ellipse cx="${n1(cx + ex)}" cy="${n1(ey)}" rx="${n1(r * 0.13)}" ry="${n1(r * 0.22)}" fill="#111"/></g></g>`;
}

/** The closed island, close up (1.6×) with its centre at x, y. */
function bigCompact(p: Paint, s: Settings, x: number, y: number): string {
  return `<g transform="translate(${x} ${y}) scale(1.6) translate(-80 -9)">${compact(p, 80, 9, s)}</g>`;
}

/** The closed island: the character on its pill (or alone, without the background). */
function compact(p: Paint, cx: number, cy: number, s: Settings, cls = "", bg = true): string {
  const back = bg && (s.theme.compactBackground ?? true);
  return `<g class="${cls}">${back ? island(p, cx - 13, cy - 7, 26, 14, 7) : ""}${chr(p, cx, cy, 5)}</g>`;
}

function cursor(x: number, y: number, cls = ""): string {
  return `<g class="${cls}"><path class="p-cur" transform="translate(${n1(x)} ${n1(y)})" d="M0 0 L0 11 L3 8.2 L5.3 13 L7.4 12 L5.2 7.4 L9 7.4 Z"/></g>`;
}

/** Lines of text in the island's ink. */
function lines(p: Paint, x: number, y: number, widths: number[], gap = 5): string {
  return widths.map((w, i) =>
    `<rect x="${n1(x)}" y="${n1(y + i * gap)}" width="${n1(w)}" height="2.4" rx="1.2" fill="${p.ink}" fill-opacity="0.45"/>`).join("");
}

function button(x: number, y: number, w: number, fill: string, h = 6): string {
  return `<rect x="${n1(x)}" y="${n1(y)}" width="${n1(w)}" height="${h}" rx="${h / 2}" fill="${fill}"/>`;
}

/** The open island: menu on the left (character on top), a card and some text. */
function panel(p: Paint, s: Settings, x: number, y: number, w: number, h: number, cls = "", menuR = 0): string {
  const r = p.windows ? 5 : 10;
  const m = Math.min(18, w * 0.22);
  const cr = menuR || ({ large: 4.5, medium: 3.5, small: 2.6 } as const)[s.menuCharacter ?? "large"] || 4.5;
  let icons = "";
  const colors = ["#F472B6", "#F5A524", "#22D3EE", "#22C55E"];
  for (let i = 0; i < 4; i++) {
    const iy = y + 8 + cr * 2 + 4 + i * 7;
    if (iy + 4 > y + h - 3) break;
    icons += p.windows
      ? `<rect x="${n1(x + m / 2 - 2)}" y="${n1(iy)}" width="4" height="4" rx="1" fill="none" stroke="${p.ink}" stroke-opacity="0.7" stroke-width="0.8"/>`
      : `<circle cx="${n1(x + m / 2)}" cy="${n1(iy + 2)}" r="2.2" fill="${colors[i]}"/>`;
  }
  const cx = x + m + 4;
  const cw = w - m - 8;
  return `<g class="${cls}">${island(p, x, y, w, h, r)}${chr(p, x + m / 2, y + 4 + cr, cr)}${icons}` +
    `<rect x="${n1(cx)}" y="${n1(y + 6)}" width="${n1(cw)}" height="${n1(Math.min(16, h * 0.32))}" rx="3" fill="${p.ink}" fill-opacity="0.08"/>` +
    lines(p, cx + 3, y + 10, [cw * 0.5, cw * 0.35]) +
    (h > 34 ? lines(p, cx, y + 6 + Math.min(16, h * 0.32) + 6, [cw * 0.8, cw * 0.6, cw * 0.7].slice(0, Math.max(1, Math.floor((h - 30) / 6)))) : "") +
    `</g>`;
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
    const color = strip ? "#F5A524" : it.id.startsWith("action:") ? "#A78BFA" : "#38BDF8";
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
      return svg(screen() + `<g transform="translate(80 18) scale(2.2) translate(-80 -9)">${top()}</g>`);
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
      return svg(screen() + island(p, 50, 4, 60, 30, 15) + chr(p, 80, 19, 11, "", follow ? "a-look" : "a-wander") +
        cursor(30, 66, follow ? "a-sweep" : "a-sweep"));
    }
    case "bubble":
      return svg(screen() + bigCompact(p, s, 46, 22) +
        (s.characterBubble !== false
          ? `<g class="a-fade">${island(p, 74, 4, 70, 16, 8)}<path d="M80 18 L70 22 L84 19 Z" fill="${p.island}" fill-opacity="${p.alpha}"/>${lines(p, 81, 8.5, [52, 34], 4.5)}</g>`
          : ""));
    case "menuChar":
      return svg(screen() + panel(p, s, 14, 8, 132, 76, "", ({ large: 9, medium: 6.5, small: 4.5 } as const)[s.menuCharacter ?? "large"] ?? 9));
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
      return svg(wall + `<rect x="0" y="39" width="160" height="20" ${f.attrs}/>` +
        barItems(s, 39, 20, f.ink, 1.1) + chr(p, barCharX(s, 1.1, 20), 49, 7));
    }
    case "rest": {
      const size = clamp(s.iconSize, 16, 48);
      const r = 3 + (size - 16) * 0.22;
      const style = s.iconStyle;
      const body = style === "none"
        ? `<rect x="64" y="0" width="32" height="2.4" rx="1.2" fill="${p.body}"/>`
        : style === "dot"
          ? `<circle cx="80" cy="${n1(r + 5)}" r="${n1(r * 0.6)}" fill="#22C55E"/>`
          : ((s.theme.compactBackground ?? true) ? island(p, 80 - r * 1.6, 2, r * 3.2, r * 2 + 6, r + 3) : "") + chr(p, 80, r + 5, r);
      return svg(screen() + taskbar() + body);
    }
    case "hover": {
      const bar = s.hoverStyle === "bar";
      const big = clamp(s.hoverSize, 28, 64);
      const r = 4 + (big - 28) * 0.18;
      const grown = bar
        ? island(p, 46, 3, 68, 16, 8) + chr(p, 55, 11, 5) +
          `<circle cx="72" cy="11" r="3" fill="#38BDF8"/><circle cx="84" cy="11" r="3" fill="#F5A524"/><circle cx="96" cy="11" r="3" fill="#22C55E"/><circle cx="106" cy="11" r="3" fill="#F472B6"/>`
        : island(p, 80 - r * 1.7, 2, r * 3.4, r * 2 + 6, r + 3) + chr(p, 80, r + 5, r);
      return svg(screen() + `<g class="a-swap-a">${top()}</g><g class="a-swap-b">${grown}</g>` + cursor(40, 70, "a-approach"));
    }
    case "always": {
      const view = island(p, 46, 3, 68, 16, 8) + chr(p, 55, 11, 5) + lines(p, 64, 8.5, [40, 26]);
      if (s.revealDuration <= 0) return svg(screen() + view);
      return svg(screen() + `<g class="a-hold-a">${view}</g><g class="a-hold-b">${top()}</g>`);
    }
    case "strip": {
      const where = s.compactStrip ?? "right";
      if (where === "off") {
        return svg(screen() + panel(p, s, 30, 6, 100, 50) +
          `<rect x="52" y="40" width="72" height="12" rx="3" fill="#F5A524" fill-opacity="0.18"/>` + button(92, 43, 14, "#F4505E") + button(108, 43, 14, "#22C55E"));
      }
      const left = where === "left";
      const x = left ? 64 : 50;
      return svg(screen() + bigCompact(p, s, left ? 134 : 26, 14) +
        island(p, x, 6, 46, 16, 8) +
        `<rect x="${x + 5}" y="10" width="16" height="2.4" rx="1.2" fill="#F5A524"/>` + lines(p, x + 5, 15, [12]) +
        button(x + 24, 11, 9, "#F4505E") + button(x + 34, 11, 9, "#22C55E"));
    }
    case "appBar": {
      if (s.appBar === false) return svg(screen() + bigCompact(p, s, 26, 14));
      const look = s.appBarLook ?? "both";
      const max = clamp(s.appBarMax || 6, 1, 12);
      const n = Math.min(max, 4);
      const bw = look === "icon" ? 8 : look === "text" ? 13 : 17;
      const nameW = s.appBarName !== false ? 16 : 0;
      const w = 6 + nameW + n * (bw + 3);
      let btns = "";
      const colors = ["#38BDF8", "#F472B6", "#FACC15", "#22C55E"];
      for (let i = 0; i < n; i++) {
        const bx = 54 + nameW + i * (bw + 3);
        btns += `<rect x="${bx}" y="9.5" width="${bw}" height="9" rx="2.5" fill="${p.ink}" fill-opacity="0.12"/>`;
        if (look !== "text") btns += `<rect x="${bx + 2}" y="12" width="4" height="4" rx="1" fill="${colors[i]}"/>`;
        if (look !== "icon") btns += `<rect x="${bx + (look === "text" ? 2 : 7.5)}" y="13" width="${look === "text" ? 9 : 7.5}" height="2" rx="1" fill="${p.ink}" fill-opacity="0.55"/>`;
      }
      return svg(screen() + bigCompact(p, s, 26, 14) +
        island(p, 50, 6, w, 16, 8) + (nameW ? lines(p, 55, 12.8, [12]) : "") + btns);
    }
    case "alerts":
      if (s.alertsOpen !== false) {
        return svg(screen() + `<g class="a-hold-a">${top()}</g><g class="a-hold-b">${panel(p, s, 30, 4, 100, 52)}` +
          `<rect x="52" y="38" width="72" height="13" rx="3" fill="#F5A524" fill-opacity="0.2"/>` + button(92, 41.5, 14, "#F4505E") + button(108, 41.5, 14, "#22C55E") + `</g>`);
      }
      return svg(screen() + `<g transform="translate(80 18) scale(2) translate(-80 -9)">${top()}<circle class="a-pulse" cx="89" cy="4" r="2.4" fill="#F5A524"/></g>`);
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
      return svg(screen() + panel(p, s, 20, 8, 120, 70) +
        (s.closeButton ? `<circle cx="132" cy="15" r="4.2" fill="${p.ink}" fill-opacity="0.15" class="a-pulse"/><path d="M130.3 13.3 L133.7 16.7 M133.7 13.3 L130.3 16.7" stroke="${p.ink}" stroke-width="0.9" stroke-linecap="round"/>` : ""));
    case "size": {
      // The open island against a 1920×1080 screen.
      const w = clamp(((s.islandWidth ?? 640) + 90) / 1920 * 160, 40, 152);
      const h = clamp(Math.max(s.islandHeight ?? 0, 360) / 1080 * 100, 26, 86);
      return svg(screen() + taskbar() + panel(p, s, 80 - w / 2, 3, w, h));
    }
    case "search": {
      const on = s.searchBar !== false;
      const x = 20;
      const y = 8;
      const field = on
        ? `<rect x="${x + 26}" y="${y + 4}" width="70" height="8" rx="4" fill="${p.ink}" fill-opacity="0.12"/><circle cx="${x + 31}" cy="${y + 8}" r="2" fill="none" stroke="${p.ink}" stroke-opacity="0.7" stroke-width="0.7"/><rect x="${x + 36}" y="${y + 7.2}" width="22" height="1.6" rx="0.8" fill="${p.ink}" fill-opacity="0.4"/>`
        : "";
      return svg(screen() + panel(p, s, x, y + (on ? 10 : 0), 120, on ? 60 : 70) + (on ? island(p, x, y, 120, 16, p.windows ? 5 : 8) + field : ""));
    }
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
