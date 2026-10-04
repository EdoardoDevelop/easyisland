// Overview task ticker — port of TickerView (V2) from IslandViewContent.swift.
//
// Three rows: completed (A), current → completed (B), incoming (C). Every row
// position is recomputed from a single clock in `tick()`, driven by the island's
// frame loop — no CSS transitions and no timers. Chaining CSS transitions with a
// reset timer let two rows land on the same line when steps arrived in bursts,
// and any step that arrived mid-animation was dropped outright. Steps are now
// queued instead, so a burst scrolls past rather than vanishing.
//
// Rows follow step *numbers* (AgentTask.stepSeq), not positions in `steps`: the
// list keeps only the last 20, and a step can be rewritten after it is shown
// (a file edit gains its "+12 −3" when PostToolUse arrives).

import { h, svg } from "./dom";
import { ICONS } from "./icons";
import { cubicBezier, clamp, lerp } from "../core/anim";
import type { AgentTask } from "../core/state";

const ROW_H = 22;
/** One step transition, milliseconds. */
const DURATION = 380;
/** Beyond this many queued steps we stop trying to show them all. */
const MAX_QUEUE = 4;
const COMPLETED_SCALE = 11.5 / 13; // 0.885 — the completed font size
const EASE = cubicBezier(0.4, 0, 0.2, 1);
/** A file edit's balance at the end of a step (hooks.ts → diffCounts). */
const COUNTS = /^(.*?)\s+\+(\d+) −(\d+)$/;

interface Row {
  el: HTMLElement;
  chevron: SVGElement;
  check: SVGElement;
  shimmer: HTMLElement;
  dim: HTMLElement;
  text: string;
  /** The step number shown, or null for the "…" placeholder. */
  seq: number | null;
}

function makeRow(onPick: (text: string) => void): Row {
  const chevron = svg(ICONS.chevronRight, 11, { stroke: 2.4 });
  const check = svg(ICONS.check, 10, { stroke: 2.2 });
  check.style.color = "#454850"; // the completed tick is dimmer than the chevron
  check.style.position = "absolute";
  chevron.style.position = "absolute";
  const shimmer = h("span", { class: "tick-text shimmer" });
  const dim = h("span", {
    class: "tick-text",
    style: "position:absolute;left:0;right:0;color:#6b7079",
  });
  const el = h(
    "div",
    { class: "ticker-row" },
    h("span", { class: "tick-icon", style: "position:relative" }, chevron, check),
    h("span", { style: "position:relative;flex:1 1 auto;min-width:0" }, shimmer, dim),
  );
  const row: Row = { el, chevron, check, shimmer, dim, text: "", seq: null };
  el.addEventListener("click", () => {
    if (COUNTS.test(row.text)) onPick(row.text);
  });
  return row;
}

/** "Modifica · a.ts +12 −3": the name, then the counts in green and red. */
function fill(el: HTMLElement, text: string) {
  const m = COUNTS.exec(text);
  if (!m) {
    el.textContent = text;
    return;
  }
  el.replaceChildren(
    document.createTextNode(`${m[1]} `),
    h("span", { class: "diff-add", text: `+${m[2]}` }),
    document.createTextNode(" "),
    h("span", { class: "diff-del", text: `−${m[3]}` }),
  );
}

function setText(row: Row, text: string) {
  if (row.text === text) return;
  row.text = text;
  fill(row.shimmer, text);
  fill(row.dim, text);
  const diff = COUNTS.test(text);
  row.el.classList.toggle("has-diff", diff);
  row.el.title = diff ? "Mostra le modifiche" : "";
}

/**
 * Places a row. `phase` 0 = current (shimmering, full size), 1 = completed
 * (dim, shifted up-left and scaled down) — same crossfades as the Swift view.
 */
function place(row: Row, y: number, phase: number, opacity: number) {
  const scale = 1 - phase * (1 - COMPLETED_SCALE);
  row.el.style.transform = `translate(${-phase * 10}px, ${y}px) scale(${scale})`;
  row.el.style.opacity = String(opacity);
  row.chevron.style.opacity = String(clamp(1 - phase * 2, 0, 1));
  row.check.style.opacity = String(clamp(phase * 2 - 1, 0, 1));
  row.shimmer.style.opacity = String(clamp(1 - phase * 1.6, 0, 1));
  row.dim.style.opacity = String(clamp(phase * 2 - 0.4, 0, 1));
}

export class Ticker {
  readonly el: HTMLElement;
  private a: Row; // completed
  private b: Row; // current
  private c: Row; // incoming
  /** Step numbers waiting to scroll in. */
  private queue: number[] = [];
  private startMs: number | null = null;
  /** The newest step number taken in (shown or queued); -1 before the first sync. */
  private displaySeq = -1;
  private task: AgentTask | null = null;

  /** `onPick`: a step with a diff was clicked (its text). */
  constructor(onPick: (text: string) => void = () => {}) {
    this.a = makeRow(onPick);
    this.b = makeRow(onPick);
    this.c = makeRow(onPick);
    this.el = h("div", { class: "ticker" }, this.a.el, this.b.el, this.c.el);
    this.rest();
  }

  /** The state between transitions: completed on top, current below. */
  private rest() {
    place(this.a, 0, 1, 1);
    place(this.b, ROW_H, 0, 1);
    place(this.c, ROW_H * 2, 0, 0);
  }

  get animating(): boolean {
    return this.startMs != null || this.queue.length > 0;
  }

  /** Step `seq`'s text while it is among the last 20, else null. */
  private textOf(seq: number | null): string | null {
    const t = this.task;
    if (seq == null || seq < 0 || !t) return null;
    const total = t.stepSeq ?? t.steps.length;
    const i = seq - (total - t.steps.length);
    return i >= 0 && i < t.steps.length ? t.steps[i] : null;
  }

  private show(row: Row, seq: number | null) {
    row.seq = seq;
    setText(row, this.textOf(seq) ?? "…");
  }

  private seed(latest: number) {
    this.queue = [];
    this.startMs = null;
    this.displaySeq = latest;
    this.show(this.a, latest > 0 ? latest - 1 : null);
    this.show(this.b, latest >= 0 ? latest : null);
    this.rest();
  }

  sync(task: AgentTask | null) {
    this.task = task;
    const latest = task && task.steps.length > 0 ? (task.stepSeq ?? task.steps.length) - 1 : -1;

    // First render, or the session restarted (steps were cleared): re-seed
    // rather than scroll.
    if (this.displaySeq < 0 || latest < this.displaySeq) {
      this.seed(latest);
      return;
    }

    for (let s = this.displaySeq + 1; s <= latest; s++) this.queue.push(s);
    this.displaySeq = latest;
    if (this.queue.length > MAX_QUEUE) {
      this.queue = this.queue.slice(-MAX_QUEUE);
    }
    // A step already on screen may have been rewritten (a diff's counts).
    for (const row of [this.a, this.b, this.c]) {
      const t = this.textOf(row.seq);
      if (t != null) setText(row, t);
    }
  }

  /** Called every frame by the island while the overview is on screen. */
  tick(nowMs: number) {
    if (this.startMs == null) {
      if (this.queue.length === 0) return;
      this.show(this.c, this.queue[0]);
      place(this.c, ROW_H * 2, 0, 0);
      this.startMs = nowMs;
    }

    const p = clamp((nowMs - this.startMs) / DURATION, 0, 1);
    const e = EASE(p);

    // A leaves upwards and fades a little faster than it moves, as on macOS.
    place(this.a, lerp(0, -ROW_H, e), 1, clamp(1 - p * 1.35, 0, 1));
    place(this.b, lerp(ROW_H, 0, e), e, 1);
    place(this.c, lerp(ROW_H * 2, ROW_H, e), 0, e);

    if (p < 1) return;

    // Commit: the current row becomes the completed one, the incoming row the
    // current one. Texts move, elements stay put — no reordering, no overlap.
    this.a.seq = this.b.seq;
    setText(this.a, this.b.text);
    this.b.seq = this.c.seq;
    setText(this.b, this.c.text);
    this.queue.shift();
    this.startMs = null;
    this.rest();
  }
}
