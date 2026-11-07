// Icons that move in their parts (anim-icons.css): at the mouse they play once,
// at a click their other gesture. Those of `svg()` go by their `data-icon`, the
// three here have parts of their own. Only CSS while it plays: nothing runs when
// no button is touched.

import "./anim-icons.css";
import { ICONS } from "./icons";

const NS = "http://www.w3.org/2000/svg";
/** The click's gesture lasts less than this (anim-icons.css). */
export const ICON_PLAY_MS = 420;

function part(tag: string, attrs: Record<string, string>): SVGElement {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  return el;
}

function icon(size: number, name: string, ...parts: SVGElement[]): SVGSVGElement {
  const el = part("svg", { viewBox: "0 0 24 24", width: String(size), height: String(size), "aria-hidden": "true", class: `ai ai-${name}` }) as SVGSVGElement;
  el.append(...parts);
  return el;
}

/** A line that can draw itself: its length is 1 whatever its shape. */
const line = (tag: string, cls: string, attrs: Record<string, string>) =>
  part(tag, { ...attrs, class: `ai-line ${cls}`, pathLength: "1", fill: "none", stroke: "currentColor", "stroke-linecap": "round", "stroke-linejoin": "round" });

/** The plane: leans forward with two trails behind; sent, it flies off and comes back. */
export function planeIcon(size = 14): SVGSVGElement {
  return icon(size, "plane",
    line("path", "ai-trail", { d: "M1 9h4", "stroke-width": "1.6" }),
    line("path", "ai-trail ai-trail2", { d: "M1 15h4", "stroke-width": "1.6" }),
    part("path", { d: ICONS.plane, fill: "currentColor", class: "ai-body" }));
}

/** The lens draws itself, then the handle; at a click it looks closer. */
export function lensIcon(size = 12): SVGSVGElement {
  const group = part("g", { class: "ai-body" });
  group.append(
    line("circle", "ai-lens", { cx: "10.5", cy: "10.5", r: "6.2", "stroke-width": "2.2" }),
    line("path", "ai-handle", { d: "M15.2 15.2 20.3 20.3", "stroke-width": "2.2" }));
  return icon(size, "find", group);
}

/** The clip draws itself along its wire; at a click it swings. */
export function clipIcon(size = 15): SVGSVGElement {
  return icon(size, "clip", line("path", "ai-wire ai-body", { d: ICONS.clip, "stroke-width": "1.8" }));
}

/** The gesture of the click, from the start at each one. */
export function playIcon(button: HTMLElement): void {
  button.classList.remove("ai-play");
  void button.offsetWidth;
  button.classList.add("ai-play");
  window.setTimeout(() => button.classList.remove("ai-play"), ICON_PLAY_MS);
}

/** Every button with a moving icon in `doc` (the send button plays when a message leaves, chat.ts). */
export function watchIconClicks(doc: Document): void {
  doc.addEventListener("click", (e) => {
    const button = (e.target as Element | null)?.closest?.("button");
    if (button && !button.disabled && !button.classList.contains("send-btn") && button.querySelector("svg[data-icon], svg.ai")) playIcon(button);
  }, true);
}

watchIconClicks(document);
