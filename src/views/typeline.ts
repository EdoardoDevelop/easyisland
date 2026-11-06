// The line that types itself under a chat turn: what the agent is doing now.
//
// One small state machine on a timer: it only writes, and the next text takes
// an emptied line (erased letter by letter, a step gone up to the list looked
// like a copy of it being deleted). What it starts it
// finishes: a step arriving meanwhile waits, and only the latest does (the
// others are in the list above anyway). A real step stays until the next one
// replaces it; with nothing to show yet, waiting phrases take turns. The caret
// blinks on its own CSS clock. Timers, not frames, and
// they stop by themselves when the line cannot be seen (`visible`): the next
// `set()` picks up from there, so a retracted island costs nothing.

import { h } from "./dom";
import { t } from "../core/i18n";

const TYPE_MS = 65;
const HOLD_MS = 1200;
/** The least a written step stays before the next one takes its place. */
const READ_MS = 500;
/** A long line goes in chunks, so that it takes about this many ticks. */
const TICKS = 24;

const waiting = () => [t("Sto pensando…"), t("Raccolgo le idee…"), t("Cerco le parole giuste…")];

/**
 * The reasoning's last whole sentence, undefined when there is none. The stream
 * brings its last characters, cut anywhere at both ends.
 */
function wholeSentence(line: string): string | undefined {
  const text = line.replace(/^💭\s*/u, "");
  const parts = text.replace(/^…\s*/, "").split(/(?<=[.!?…])\s+/);
  if (text.startsWith("…")) parts.shift();
  if (!/[.!?…]$/.test(parts[parts.length - 1] ?? "")) parts.pop();
  const sentence = parts[parts.length - 1];
  return sentence ? `💭 ${sentence}` : undefined;
}

/**
 * A stream's last step or reasoning, taken off its text: it lives in the line
 * until the next one pushes it up among the others. `status` undefined:
 * reasoning with no whole sentence in it, nothing new to say.
 */
export function splitStatus(text: string): { body: string; status?: string } {
  const at = text.lastIndexOf("\n\n");
  const last = text.slice(at < 0 ? 0 : at + 2);
  if (!/^> (⚙|💭)/u.test(last)) return { body: text, status: "" };
  const status = last.replace(/^> /, "").replace(/`/g, "").replace(/^💭 _(.*)_$/su, "💭 $1").replace(/\s+/g, " ").trim();
  return { body: at < 0 ? "" : text.slice(0, at), status: status.startsWith("💭") ? wholeSentence(status) : status };
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
  /** The text being written; null = the waiting phrases. */
  private target: string | null = null;
  /** What comes once `target` is written and read; undefined = nothing. Only the latest waits. */
  private next: string | null | undefined = undefined;
  private phrase = 0;
  /** `target` is written and had its time on screen. */
  private held = false;
  private timer = 0;
  private height = 0;

  constructor(private visible: () => boolean, private onGrow: () => void) {}

  private get wanted(): string[] {
    const list = waiting();
    return Array.from(this.target ?? list[this.phrase % list.length]);
  }

  /**
   * `status`: the step to show, "" for the caret alone, null for the waiting
   * phrases, undefined for no news. It never cuts the line short: it waits for
   * the one being written.
   */
  set(status: string | null | undefined) {
    const last = this.next !== undefined ? this.next : this.target;
    if (status !== undefined && status !== last) this.next = status === this.target ? undefined : status;
    // A waiting phrase, written, has no reason to stay in the way of a real step.
    if (this.target == null && this.held && this.next !== undefined) {
      window.clearTimeout(this.timer);
      this.timer = 0;
    }
    if (!this.timer) this.step();
  }

  /** The turn ended. */
  reset() {
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.target = null;
    this.next = undefined;
    this.held = false;
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

  /** The next text takes over. */
  private advance() {
    this.target = this.next!;
    this.next = undefined;
    this.held = false;
  }

  private step() {
    if (!this.el.isConnected || !this.visible()) return;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) {
      if (this.next !== undefined) this.advance();
      this.draw(this.wanted);
      return;
    }
    // An empty line has nothing to finish.
    if (this.next !== undefined && !this.shown.length) this.advance();
    const want = this.wanted;
    const n = this.shown.length;
    let same = 0;
    while (same < n && this.shown[same] === want[same]) same++;
    if (same < n) {
      this.draw(this.shown.slice(0, same));
      this.wait(TYPE_MS);
    } else if (n < want.length) {
      // Something is waiting: the same line, written faster.
      const chunk = Math.max(1, Math.round(want.length / TICKS)) * (this.next !== undefined ? 2 : 1);
      this.draw(want.slice(0, n + chunk));
      this.held = false;
      this.wait(TYPE_MS);
    } else if (!this.held && want.length) {
      this.held = true;
      // A step goes up to the list as the next one comes: nothing to wait for.
      const reasoning = this.target?.startsWith("💭");
      this.wait(this.target == null && this.next === undefined ? HOLD_MS : this.target == null || reasoning ? READ_MS : 0);
    } else if (this.next !== undefined) {
      this.advance();
      this.step();
    } else if (this.target == null) {
      this.phrase++;
      this.held = false;
      this.draw([]);
      this.wait(TYPE_MS);
    }
    // A real step, all written: it stays until `set()` brings the next.
  }
}
