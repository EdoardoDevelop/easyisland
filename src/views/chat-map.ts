// The map of a long conversation (26 Nov 2026, Edoardo): a thin strip on the
// right of the messages with a mark for each question, diagram, table, change
// to a file and warning, where they are in the conversation; the part on
// screen as a band. Hovering a mark shows what it is, a click goes there.
// Drawn again at most every 400 ms (the reply streaming in), never while the
// chat is not on screen; reads positions only, never touches the messages.

import { h } from "./dom";
import { t } from "../core/i18n";
import { motionLevel } from "../core/motion";
import "./chat-map.css";

type Kind = "q" | "diagram" | "table" | "diff" | "warn";

interface Item {
  kind: Kind;
  el: HTMLElement;
  label: string;
}

const EVERY_MS = 400;

const clip = (s: string, n: number) => {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1)}…` : one;
};

export interface ChatMap {
  el: HTMLElement;
  /** The conversation changed: marks again (throttled). */
  refresh(): void;
}

export function chatMap(log: HTMLElement): ChatMap {
  const band = h("div", { class: "chat-map-band" });
  const marks = h("div", { class: "chat-map-marks" });
  const tip = h("div", { class: "chat-map-tip" });
  const el = h("div", { class: "chat-map", "aria-hidden": "true" }, band, marks, tip);
  el.hidden = true;
  let timer = 0;
  let last = 0;
  let frame = 0;

  const items = (): Item[] => {
    const out: Item[] = [];
    for (const node of log.querySelectorAll<HTMLElement>(".chat-row.user, .md-diagram, .md-table-wrap, .md-diff, .md-callout-warn, .md-callout-danger")) {
      if (node.classList.contains("chat-row")) out.push({ kind: "q", el: node, label: clip(node.textContent ?? "", 90) });
      else if (node.classList.contains("md-diagram")) out.push({ kind: "diagram", el: node, label: t("Diagramma") });
      else if (node.classList.contains("md-table-wrap")) {
        const head = [...node.querySelectorAll("th")].map((x) => x.textContent?.trim()).filter(Boolean).slice(0, 4).join(", ");
        out.push({ kind: "table", el: node, label: head ? `${t("Tabella")} · ${clip(head, 60)}` : t("Tabella") });
      } else if (node.classList.contains("md-diff")) {
        const file = node.querySelector(".md-diff-file")?.textContent ?? "";
        const stat = node.querySelector(".md-diff-stat")?.textContent ?? "";
        out.push({ kind: "diff", el: node, label: `${t("Modifica")} · ${file} ${stat}`.trim() });
      } else out.push({ kind: "warn", el: node, label: clip(node.textContent ?? "", 90) });
    }
    return out;
  };

  const drawBand = () => {
    const H = log.clientHeight, S = log.scrollHeight;
    if (!S) return;
    band.style.top = `${(log.scrollTop / S) * H}px`;
    band.style.height = `${Math.max(14, (H / S) * H)}px`;
  };

  const draw = () => {
    frame = 0;
    last = Date.now();
    const H = log.clientHeight, S = log.scrollHeight;
    const list = H && S > H * 1.6 ? items() : [];
    const show = list.filter((i) => i.kind === "q").length >= 2;
    el.hidden = !show;
    if (!show) return;
    el.style.top = `${log.offsetTop}px`;
    el.style.height = `${H}px`;
    const base = log.getBoundingClientRect().top - log.scrollTop;
    marks.replaceChildren(...list.map((it) => {
      const y = Math.min(H - 3, Math.max(0, ((it.el.getBoundingClientRect().top - base) / S) * H));
      const m = h("button", { class: `chat-map-mark ${it.kind}`, tabindex: "-1" });
      m.style.top = `${y}px`;
      m.addEventListener("pointerenter", () => {
        tip.textContent = it.label;
        tip.style.maxWidth = `${Math.max(120, Math.min(260, log.clientWidth - 40))}px`;
        tip.style.top = `${Math.min(H - 28, Math.max(0, y - 10))}px`;
        tip.classList.add("on");
      });
      m.addEventListener("pointerleave", () => tip.classList.remove("on"));
      m.addEventListener("click", () => {
        const top = it.el.getBoundingClientRect().top - log.getBoundingClientRect().top + log.scrollTop - 12;
        log.scrollTo({ top, behavior: motionLevel() === "ricche" ? "smooth" : "auto" });
      });
      return m;
    }));
    drawBand();
  };

  const refresh = () => {
    if (frame || timer) return;
    const wait = Math.max(0, EVERY_MS - (Date.now() - last));
    const view = log.ownerDocument.defaultView ?? window;
    timer = view.setTimeout(() => {
      timer = 0;
      if (!log.isConnected || !log.clientHeight) return;
      frame = view.requestAnimationFrame(draw);
    }, wait);
  };

  log.addEventListener("scroll", () => { if (!el.hidden) drawBand(); }, { passive: true });
  log.addEventListener("md-grew", refresh);
  const RO = (log.ownerDocument.defaultView as (Window & { ResizeObserver?: typeof ResizeObserver }) | null)?.ResizeObserver ?? ResizeObserver;
  new RO(refresh).observe(log);
  return { el, refresh };
}
