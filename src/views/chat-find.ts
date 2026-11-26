// Ctrl+F in the conversation (26 Nov 2026, Edoardo): a field over the
// messages, every match marked, the current one brighter; Enter / Maiusc+Invio
// or the arrows move, Esc closes. Marked with the CSS Custom Highlight API:
// the messages' DOM is never touched, so the chat's cached blocks stay as they are.

import { t } from "../core/i18n";
import { h, svg } from "./dom";
import { ICONS } from "./icons";

const ALL = "chat-find";
const NOW = "chat-find-now";
const MAX = 2000;

/** Lower case, no accents: «perché» finds «perche». */
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

export interface ChatFind {
  el: HTMLElement;
  open(): void;
  close(): void;
  readonly shown: boolean;
}

export function chatFind(log: HTMLElement): ChatFind {
  const field = h("input", { class: "chat-find-input", placeholder: t("Cerca nella conversazione") }) as HTMLInputElement;
  const count = h("span", { class: "chat-find-count" });
  const prev = h("button", { class: "chat-find-btn", title: t("Precedente (Maiusc+Invio)"), text: "↑" }) as HTMLButtonElement;
  const next = h("button", { class: "chat-find-btn", title: t("Successivo (Invio)"), text: "↓" }) as HTMLButtonElement;
  const shut = h("button", { class: "chat-find-btn", title: t("Chiudi (Esc)"), text: "✕" }) as HTMLButtonElement;
  const el = h("div", { class: "chat-find" }, svg(ICONS.search, 12), field, count, prev, next, shut);
  el.style.display = "none";
  let ranges: Range[] = [];
  let at = 0;
  let shown = false;
  let timer = 0;

  const registry = () => (log.ownerDocument.defaultView as (Window & typeof globalThis) | null)?.CSS?.highlights;
  const mark = () => {
    const reg = registry();
    const view = log.ownerDocument.defaultView as (Window & typeof globalThis) | null;
    if (!reg || !view?.Highlight) return;
    reg.set(ALL, new view.Highlight(...ranges));
    const now = ranges[at];
    if (now) reg.set(NOW, new view.Highlight(now));
    else reg.delete(NOW);
  };

  const show = (scroll: boolean) => {
    count.textContent = field.value.trim() ? (ranges.length ? `${at + 1}/${ranges.length}` : t("nessuno")) : "";
    count.classList.toggle("none", !!field.value.trim() && !ranges.length);
    mark();
    const now = ranges[at];
    if (!scroll || !now) return;
    // Its row first (content-visibility lays far rows only on demand), then the line itself.
    now.startContainer.parentElement?.scrollIntoView({ block: "center" });
    const r = now.getBoundingClientRect();
    const box = log.getBoundingClientRect();
    if (r.height && (r.top < box.top + 24 || r.bottom > box.bottom - 24)) log.scrollTop += r.top - box.top - box.height / 2;
  };

  /** Every match of the field in the messages (not in the buttons under them). */
  const search = (keepAt: boolean) => {
    const want = fold(field.value.trim());
    const before = ranges[at];
    ranges = [];
    if (want) {
      const walk = log.ownerDocument.createTreeWalker(log, NodeFilter.SHOW_TEXT, {
        acceptNode: (n) => (n.parentElement?.closest(".msg-actions, .md-pre-head, .md-fields, button, .chat-find") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
      });
      for (let n = walk.nextNode() as Text | null; n && ranges.length < MAX; n = walk.nextNode() as Text | null) {
        const text = n.data;
        // Folding keeps the length only for letters with one accent: else compare as is.
        const hay = fold(text);
        const same = hay.length === text.length;
        const src = same ? hay : text.toLowerCase();
        const needle = same ? want : field.value.trim().toLowerCase();
        for (let i = src.indexOf(needle); i >= 0 && ranges.length < MAX; i = src.indexOf(needle, i + needle.length)) {
          const r = log.ownerDocument.createRange();
          r.setStart(n, i);
          r.setEnd(n, i + needle.length);
          ranges.push(r);
        }
      }
    }
    if (keepAt && before) {
      const i = ranges.findIndex((r) => r.startContainer === before.startContainer && r.startOffset === before.startOffset);
      at = i >= 0 ? i : Math.min(at, Math.max(0, ranges.length - 1));
    } else {
      // From the bottom up, as the newest messages are what one looks back from.
      at = Math.max(0, ranges.length - 1);
    }
    show(!keepAt);
  };

  const step = (by: number) => {
    if (!ranges.length) return;
    at = (at + by + ranges.length) % ranges.length;
    show(true);
  };

  // The conversation changes under it (an answer streaming in, another tab): marked again.
  const watch = new MutationObserver(() => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => search(true), 250);
  });

  field.addEventListener("input", () => search(false));
  field.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") {
      e.preventDefault();
      step(e.shiftKey ? -1 : 1);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    }
  });
  prev.addEventListener("click", () => step(-1));
  next.addEventListener("click", () => step(1));
  shut.addEventListener("click", () => close());

  function open() {
    if (!shown) {
      shown = true;
      el.style.display = "";
      watch.observe(log, { childList: true, subtree: true, characterData: true });
    }
    // The words selected in the chat are what to look for.
    const picked = log.ownerDocument.getSelection()?.toString().trim() ?? "";
    if (picked && picked.length <= 80 && !picked.includes("\n")) field.value = picked;
    field.focus();
    field.select();
    search(false);
  }

  function close() {
    if (!shown) return;
    shown = false;
    el.style.display = "none";
    watch.disconnect();
    window.clearTimeout(timer);
    ranges = [];
    registry()?.delete(ALL);
    registry()?.delete(NOW);
    log.ownerDocument.querySelector<HTMLTextAreaElement>(".chat-input")?.focus();
  }

  return { el, open, close, get shown() { return shown; } };
}
