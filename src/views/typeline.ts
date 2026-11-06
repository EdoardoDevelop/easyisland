// The line that types itself under a chat turn: what the agent is doing now.
//
// One small state machine on a timer: type, hold, erase. A real step stays
// until the next one replaces it; with nothing to show yet, waiting phrases
// take turns. The caret blinks on its own CSS clock. Timers, not frames, and
// they stop by themselves when the line cannot be seen (`visible`): the next
// `set()` picks up from there, so a retracted island costs nothing.

import { h } from "./dom";
import { t } from "../core/i18n";

const TYPE_MS = 65;
const ERASE_MS = 35;
const HOLD_MS = 1200;
/** A long line goes in chunks, so that it takes about this many ticks. */
const TICKS = 24;

const waiting = () => [t("Sto pensando…"), t("Raccolgo le idee…"), t("Cerco le parole giuste…")];

/**
 * A stream's last step or reasoning, taken off its text: it lives in the line
 * until the next one pushes it up among the others.
 */
export function splitStatus(text: string): { body: string; status: string } {
  const at = text.lastIndexOf("\n\n");
  const last = text.slice(at < 0 ? 0 : at + 2);
  if (!/^> (⚙|💭)/u.test(last)) return { body: text, status: "" };
  const status = last.replace(/^> /, "").replace(/`/g, "").replace(/^💭 _(.*)_$/su, "💭 $1").replace(/\s+/g, " ").trim();
  return { body: at < 0 ? "" : text.slice(0, at), status };
}

/**
 * A turn's steps in the blocks of a reply: small, and once the turn is over
 * (`done`) a run of them folds into one line. An error («✗») stays in the open.
 */
export function foldSteps(blocks: HTMLElement[], done: boolean): HTMLElement[] {
  const out: HTMLElement[] = [];
  let run: HTMLElement[] = [];
  const flush = () => {
    if (run.length > 1 && done) {
      out.push(h("details", { class: "md-steps" }, h("summary", { text: t("{n} passi", { n: run.length }) }), ...run));
    } else out.push(...run);
    run = [];
  };
  for (const b of blocks) {
    if (b.tagName === "BLOCKQUOTE" && /^(⚙|💭)/u.test(b.textContent ?? "")) {
      b.classList.add("md-step");
      run.push(b);
    } else {
      flush();
      out.push(b);
    }
  }
  flush();
  return out;
}

export class TypeLine {
  private text = h("span", { class: "type-text" });
  readonly el = h("div", { class: "type-line" }, this.text, h("span", { class: "type-caret" }));
  /** By code point: a step's emoji must not be cut in two. */
  private shown: string[] = [];
  /** The text wanted; null = the waiting phrases. */
  private target: string | null = null;
  private phrase = 0;
  private erasing = false;
  private timer = 0;
  private height = 0;

  constructor(private visible: () => boolean, private onGrow: () => void) {}

  private get wanted(): string[] {
    const list = waiting();
    return Array.from(this.target ?? list[this.phrase % list.length]);
  }

  /** `status`: the step to show, "" for the caret alone, null for the waiting phrases. */
  set(status: string | null) {
    if (status !== this.target) {
      // Reasoning sliding along (its tail, «…»): no prefix in common, retyping it would never end.
      const sliding = status?.startsWith("💭 …") && this.target?.startsWith("💭 …");
      this.target = status;
      this.erasing = false;
      if (sliding) this.draw(Array.from(status!));
      if (this.timer) {
        window.clearTimeout(this.timer);
        this.timer = 0;
      }
    }
    if (!this.timer) this.step();
  }

  /** The turn ended. */
  reset() {
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.target = null;
    this.erasing = false;
    this.phrase = 0;
    this.draw([]);
  }

  private draw(chars: string[]) {
    this.shown = chars;
    this.text.textContent = chars.join("");
    const height = this.el.offsetHeight;
    if (height !== this.height) {
      this.height = height;
      this.onGrow();
    }
  }

  private wait(ms: number) {
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      this.step();
    }, ms);
  }

  private step() {
    if (!this.el.isConnected || !this.visible()) return;
    const want = this.wanted;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      this.draw(want);
      return;
    }
    const n = this.shown.length;
    const fits = n <= want.length && this.shown.every((c, i) => c === want[i]);
    if (this.erasing || !fits) {
      const chunk = Math.max(1, Math.round(n / TICKS));
      this.draw(this.shown.slice(0, Math.max(0, n - chunk)));
      if (this.shown.length === 0 && this.erasing) {
        this.erasing = false;
        this.phrase++;
      }
      this.wait(ERASE_MS);
    } else if (n < want.length) {
      this.draw(want.slice(0, n + Math.max(1, Math.round(want.length / TICKS))));
      this.wait(TYPE_MS);
    } else if (this.target == null) {
      this.erasing = true;
      this.wait(HOLD_MS);
    }
    // A real step, all written: it stays until `set()` brings the next.
  }
}
