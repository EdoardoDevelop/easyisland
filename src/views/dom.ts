// Minimal DOM helpers — no framework, as specified.
import { BRAND_SVG } from "./brands";

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

export function svg(path: string, size = 14, opts: { fill?: string; stroke?: number } = {}): SVGSVGElement {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  el.setAttribute("viewBox", "0 0 24 24");
  el.setAttribute("width", String(size));
  el.setAttribute("height", String(size));
  el.setAttribute("aria-hidden", "true");
  const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
  p.setAttribute("d", path);
  if (opts.stroke) {
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", "currentColor");
    p.setAttribute("stroke-width", String(opts.stroke));
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-linejoin", "round");
  } else {
    p.setAttribute("fill", opts.fill ?? "currentColor");
  }
  el.append(p);
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

/** The brand logo, or the coloured dot for integrations without one. */
export function brandOrDot(id: string, color: string, size = 8): Element {
  return brandIcon(id, Math.round(size * 1.75)) ?? dot(color, size);
}
