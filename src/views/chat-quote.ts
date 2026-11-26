// «Chiedi su questo» (26 Nov 2026, Edoardo): words selected in an answer get a
// small button over them; a click puts them in the field as a quote («> …»)
// and the question is about that piece only. Never sent by itself.

import { h } from "./dom";
import { t } from "../core/i18n";
import "./chat-quote.css";

/** The most of a selection quoted. */
const MAX = 4000;

/** `text` as a quote in front of what is written: «> line» for each line, a blank line after. */
export function quoted(text: string, rest: string): string {
  const q = text.trim().split(/\r?\n/).map((l) => `> ${l}`.trimEnd()).join("\n");
  return `${q}\n\n${rest.replace(/^\s+/, "")}`;
}

/**
 * The button over a selection in the answers of `log`, placed in `host` (the
 * chat's body, positioned). `onQuote` gets the selected text.
 */
export function quoteButton(log: HTMLElement, host: HTMLElement, onQuote: (text: string) => void): void {
  const doc = log.ownerDocument;
  const btn = h("button", { class: "chat-quote-btn", text: `❝ ${t("Chiedi su questo")}` }) as HTMLButtonElement;
  btn.title = t("Mette il pezzo selezionato nel campo, come citazione: la domanda riguarda solo quello");
  btn.style.display = "none";
  host.append(btn);
  let text = "";

  const hide = () => {
    btn.style.display = "none";
    text = "";
  };

  const place = () => {
    const sel = doc.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return hide();
    const anchor = sel.anchorNode instanceof Element ? sel.anchorNode : sel.anchorNode?.parentElement;
    const focus = sel.focusNode instanceof Element ? sel.focusNode : sel.focusNode?.parentElement;
    // Inside the answers only: not a question, a button, the field.
    if (!anchor || !focus || !log.contains(anchor) || !anchor.closest(".reply") || !focus.closest(".reply")) return hide();
    const got = sel.toString().trim();
    if (!got || got.length > MAX) return hide();
    text = got;
    const r = sel.getRangeAt(0).getBoundingClientRect();
    const box = host.getBoundingClientRect();
    btn.style.display = "";
    const w = btn.offsetWidth, hgt = btn.offsetHeight;
    let top = r.top - box.top - hgt - 6;
    if (top < 4) top = r.bottom - box.top + 6;
    const left = Math.min(box.width - w - 6, Math.max(6, r.left - box.left + r.width / 2 - w / 2));
    btn.style.top = `${top}px`;
    btn.style.left = `${left}px`;
  };

  log.addEventListener("mouseup", () => window.setTimeout(place, 0));
  log.addEventListener("keyup", (e) => { if (e.shiftKey || e.key === "Shift") place(); });
  log.addEventListener("scroll", hide, { passive: true });
  doc.addEventListener("selectionchange", () => { if (doc.getSelection()?.isCollapsed) hide(); });
  // The selection stays while the button is pressed.
  btn.addEventListener("mousedown", (e) => e.preventDefault());
  btn.addEventListener("click", () => {
    const got = text;
    hide();
    doc.getSelection()?.removeAllRanges();
    if (got) onQuote(got);
  });
}
