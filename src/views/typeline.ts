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

import { h, svg } from "./dom";
import { ICONS } from "./icons";
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
export function splitStatus(text: string): { body: string; status?: string | null } {
  const at = text.lastIndexOf("\n\n");
  const last = text.slice(at < 0 ? 0 : at + 2);
  // Reasoning whose text Claude Code does not send: the waiting phrases.
  if (last.trim() === "> 💭") return { body: at < 0 ? "" : text.slice(0, at), status: null };
  if (!/^> (⚙|💭)/u.test(last)) return { body: text, status: "" };
  const status = last.replace(/^> /, "").replace(/`/g, "").replace(/^💭 _(.*)_$/su, "💭 $1").replace(/\s+/g, " ").trim();
  return { body: at < 0 ? "" : text.slice(0, at), status: status.startsWith("💭") ? wholeSentence(status) : status };
}

/** Line icons of a step, by what it does (24 Nov 2026: steps as a timeline, Edoardo's «migliora i passi»). */
const STEP_ICONS: [RegExp, string][] = [
  [/^💭/u, "M12 5c4.4 0 8 2.7 8 6s-3.6 6-8 6c-.9 0-1.8-.1-2.6-.3L5.5 19l.9-3.4C4.9 14.5 4 12.9 4 11c0-3.3 3.6-6 8-6z"],
  [/anteprima|preview|pagina|page|sito|site|web|browser|naviga|clic|click/i, ICONS.preview],
  [/^(esegue|esegui|run|runs|lancia|comando|command|shell|terminal)/i, ICONS.lineTerminal],
  [/^(cerca|trova|search|searches|find|finds|grep|glob)/i, "M10.5 4.5a6 6 0 1 1 0 12 6 6 0 0 1 0-12zM15 15l4.5 4.5"],
  [/^(scrive|modifica|crea|salva|aggiorna|write|writes|edit|edits|create|creates|save|saves|update)/i, "M14.5 5.5l4 4L9 19H5v-4zM12.5 7.5l4 4"],
  [/^(legge|leggi|apre|guarda|elenca|read|reads|open|opens|list|lists|view)/i, "M7 3.5h7l4 4V20.5H6V3.5zM14 3.5V8h4M9 12h6M9 15.5h6"],
  [/memoria|memory|ricorda|remember/i, ICONS.memory],
  [/agente|agent|affida|motore|engine|delega/i, ICONS.people],
];
const STEP_DOT = "M12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6z";

/** The icon of a step's text («⚙ Legge · …», «💭 …»). */
function stepPath(text: string): string {
  return STEP_ICONS.find(([re]) => re.test(text.startsWith("💭") ? text : stepVerb(text)))?.[1] ?? STEP_DOT;
}

/** What the step does, before its « · ». */
function stepVerb(text: string): string {
  return text.replace(/^(⚙️?|💭)\s*/u, "").split(" · ")[0].trim();
}

/**
 * A step as one row of the timeline: its icon in place of «⚙», what it does,
 * then on what (after « · ») quieter and cut to one line, the whole in its title.
 */
function dressStep(step: HTMLElement) {
  const line = step.querySelector(".md-p") ?? step;
  const text = line.textContent ?? "";
  const path = stepPath(text);
  // Off with the emoji, in the first text node.
  const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
  const first = walker.nextNode();
  if (first?.nodeValue) first.nodeValue = first.nodeValue.replace(/^\s*(⚙️?|💭)\s*/u, "");
  // What comes after « · » goes in its own quieter span.
  for (let node = walker.currentNode; node; node = walker.nextNode()!) {
    const at = node.nodeValue?.indexOf(" · ") ?? -1;
    if (at < 0 || node.parentNode !== line) continue;
    const after = (node as Text).splitText(at);
    after.nodeValue = after.nodeValue!.slice(3);
    const what = h("span", { class: "md-step-what" });
    while (after.nextSibling) what.append(after.nextSibling);
    what.prepend(after);
    line.append(what);
    break;
  }
  line.classList.add("md-step-line");
  step.title = text.replace(/^(⚙️?|💭)\s*/u, "");
  const ico = h("span", { class: "md-step-ico" }, svg(path, 12, { stroke: 1.8 }));
  step.prepend(ico);
  if (text.startsWith("💭")) step.classList.add("md-step-thought");
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
      // The folded line says what was done: the first different actions, then «…».
      const verbs = [...new Set(run.map((s) => stepVerb(s.title)).filter((v) => v && !v.startsWith("💭")))];
      const gist = verbs.slice(0, 3).join(", ") + (verbs.length > 3 ? "…" : "");
      out.push(h("details", { class: "md-steps" },
        h("summary", {},
          h("span", { class: "md-steps-n", text: t("{n} passi", { n: run.length }) }),
          gist ? h("span", { class: "md-steps-gist", text: gist }) : null),
        h("div", { class: "md-steps-list" }, ...run)));
    } else out.push(...run);
    run = [];
  };
  const blocksOut = (b: HTMLElement) => {
    flush();
    out.push(b);
  };
  for (const b of blocks) {
    // A step's output (claude_cli.rs `result_block`): folded inside its step, as Claude Desktop opens a step.
    const lang = b.classList.contains("md-pre") ? b.querySelector(".md-lang")?.textContent ?? "" : "";
    if (lang === "esito" || lang === "errore") {
      const out = h("details", { class: `md-step-out${lang === "errore" ? " failed" : ""}` },
        h("summary", { text: lang === "errore" ? t("Errore") : t("Esito") }), b);
      const step = run[run.length - 1];
      if (step) step.append(out);
      else blocksOut(out);
      continue;
    }
    if (b.tagName === "BLOCKQUOTE" && /^(⚙|💭)/u.test(b.textContent ?? "")) {
      b.classList.add("md-step");
      dressStep(b);
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
  /** The kind of the step in progress, its icon in a turning ring (26 Nov 2026: «cosa sta facendo, con le icone»). */
  private ico = h("span", { class: "type-ico" });
  private icoFor: string | null | undefined = undefined;
  readonly el = h("div", { class: "type-line" }, this.ico, this.text, h("span", { class: "type-caret" }));
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
    // The step's emoji is its icon, in front.
    this.text.textContent = chars.join("").replace(/^(⚙️?|💭)\s*/u, "");
    const kind = this.target === "" ? "" : this.target;
    if (kind !== this.icoFor) {
      this.icoFor = kind;
      this.ico.replaceChildren(...(kind === "" ? [] : [svg(kind == null ? STEP_ICONS[0][1] : stepPath(kind), 11, { stroke: 1.8 })]));
      this.ico.hidden = kind === "";
      this.ico.classList.toggle("thought", kind == null || kind.startsWith("💭"));
    }
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
