// Minimal DOM helpers — no framework, as specified.
import { BRAND_SVG } from "./brands";
import { ICONS, LINE_ICONS } from "./icons";
import { windowsLook } from "../core/uistyle";

type Attrs = Record<string, string | number | boolean | EventListener | undefined>;
type Child = Node | string | null | undefined | false;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Attrs = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = String(v);
    else if (k === "text") el.textContent = String(v);
    else if (k === "html") el.innerHTML = String(v);
    else if (k.startsWith("on") && typeof v === "function") {
      el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    } else if (k === "style") el.setAttribute("style", String(v));
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) {
    if (c == null || c === false) continue;
    el.append(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

/** Each icon's name, on its `<svg>` (`data-icon`): anim-icons.css moves them by name. */
const ICON_NAMES = new Map(Object.entries(ICONS).map(([name, path]) => [path as string, name]));
/** Filled icons that move in pieces, one `<path>` for each `M` of their outline. */
const IN_PIECES = new Set(["sliders", "speakerOn", "team", "copy"]);

/** The paper clip beside a file's name, or alone at the given size. */
export function clipMark(size = 12): SVGSVGElement {
  const icon = svg(ICONS.clip, size, { stroke: 1.8 });
  icon.classList.add("clip-mark");
  return icon;
}

export function svg(path: string, size = 14, opts: { fill?: string; stroke?: number } = {}): SVGSVGElement {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  el.setAttribute("viewBox", "0 0 24 24");
  el.setAttribute("width", String(size));
  el.setAttribute("height", String(size));
  el.setAttribute("aria-hidden", "true");
  const name = ICON_NAMES.get(path);
  if (name) el.setAttribute("data-icon", name);
  const pieces = opts.stroke || (name && IN_PIECES.has(name)) ? path.split(/(?=M)/) : [path];
  pieces.forEach((d, i) => {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("d", d);
    p.setAttribute("class", `ip${i}`);
    if (opts.stroke) {
      // Of length 1 whatever its shape: it can draw itself (anim-icons.css).
      p.setAttribute("pathLength", "1");
      p.classList.add("ai-line");
      p.setAttribute("fill", "none");
      p.setAttribute("stroke", "currentColor");
      p.setAttribute("stroke-width", String(opts.stroke));
      p.setAttribute("stroke-linecap", "round");
      p.setAttribute("stroke-linejoin", "round");
    } else {
      p.setAttribute("fill", opts.fill ?? "currentColor");
    }
    el.append(p);
  });
  return el;
}

export function clear(el: Element) {
  while (el.firstChild) el.removeChild(el.firstChild);
}

/** Card dot used in every "who" row. */
export function dot(color: string, size = 7): HTMLElement {
  return h("i", {
    class: "dot",
    style: `width:${size}px;height:${size}px;background:${color}`,
  });
}

/** The integration's brand logo (src/views/brands.ts) at `size` px, or null when it has none. */
export function brandIcon(id: string, size = 14): SVGSVGElement | null {
  const markup = BRAND_SVG[id];
  if (!markup) return null;
  // Static markup from the repo, parsed as SVG: no innerHTML.
  const el = new DOMParser().parseFromString(markup, "image/svg+xml").documentElement as unknown as SVGSVGElement;
  if (el.nodeName !== "svg") return null;
  // Wide marks (3CX, n8n, Stripe) get up to twice the width, same height.
  const [, , vw, vh] = (el.getAttribute("viewBox") ?? "0 0 1 1").split(/[\s,]+/).map(Number);
  const wide = vw > 0 && vh > 0 ? Math.min(2, Math.max(1, vw / vh)) : 1;
  el.setAttribute("width", String(Math.round(size * wide)));
  el.setAttribute("height", String(size));
  el.setAttribute("aria-hidden", "true");
  el.classList.add("brand");
  return document.importNode(el, true);
}

/** Suggested icon for each integration when its tab shows an icon (Impostazioni → Integrazioni). */
export const TAB_ICONS: Record<string, string> = {
  integration_stripe: "💳", integration_github: "🐙", integration_vercel: "▲", integration_n8n: "🔁",
  integration_resend: "✉️", integration_notion: "📝", integration_calcom: "📅", integration_outlook: "📧",
  integration_zammad: "🎫", integration_3cx: "📞", integration_system: "💻", integration_security: "🛡️", integration_network: "🌐",
  integration_weather: "⛅", integration_clipboard: "📋", integration_media: "⏯️", integration_claude_usage: "📊",
  integration_rdm: "🖥️", integration_teams: "👥", integration_recorder: "⏺️", integration_telegram: "✈️", integration_agentchat: "💬",
};

/** Integrations with no brand logo that show their tab icon in its place. */
const ICON_MARKS = new Set(["integration_weather", "integration_clipboard", "integration_media", "integration_claude_usage", "integration_rdm", "integration_teams", "integration_recorder"]);

/** True when `markIcon` has something for this integration. */
export function hasMark(id: string): boolean {
  return id in BRAND_SVG || ICON_MARKS.has(id) || (windowsLook() && id in LINE_ICONS);
}

/** The brand logo, or the tab icon for the integrations in ICON_MARKS; null otherwise. */
export function markIcon(id: string, size = 14): Element | null {
  const logo = brandIcon(id, size);
  if (logo) return logo;
  // Windows 11 look: a line glyph in the integration's colour instead of an emoji or a dot.
  const line = LINE_ICONS[id];
  if (line && windowsLook()) {
    const el = svg(line, size, { stroke: size > 30 ? 1.3 : 1.6 });
    el.classList.add("brand", "line-mark");
    return el;
  }
  if (!ICON_MARKS.has(id)) return null;
  return h("span", { class: "brand mark", text: TAB_ICONS[id], style: `font-size:${Math.round(size * 0.85)}px`, "aria-hidden": "true" });
}

/** The brand logo (or tab icon), or the coloured dot for integrations without one. */
export function brandOrDot(id: string, color: string, size = 8): Element {
  return markIcon(id, Math.round(size * 1.75)) ?? dot(color, size);
}
