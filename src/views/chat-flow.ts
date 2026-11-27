// A reply that flows in (26 Nov 2026, Edoardo: «risposta che entra fluida»):
//  - the words just arrived come in with a short fade, as in Claude Desktop;
//  - the conversation glides down to them instead of jumping.
// The fade uses the CSS Custom Highlight API: the reply's DOM is never touched
// (its blocks are cached, chat-live.ts), only ranges over its text are coloured,
// three steps lighter to full in ~240 ms. Timers, not frames, and they stop with
// nothing left to fade. Off with Impostazioni → Aspetto → Animazioni «spente»;
// «sobrie» keeps the fade but not the glide.

import { motionLevel } from "../core/motion";
import "./chat-flow.css";

/** The three steps of the fade, faintest first (chat-cards.css: `::highlight(chat-fresh-N)`). */
const STEPS = ["chat-fresh-1", "chat-fresh-2", "chat-fresh-3"];
const STEP_MS = 80;

type Win = Window & typeof globalThis;

/** The text nodes of `root` that are read (not the buttons of its blocks). */
function texts(root: HTMLElement): Text[] {
  const out: Text[] = [];
  const walk = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.parentElement?.closest("button, .md-pre-head, .md-fields, .md-step-ico") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT),
  });
  for (let n = walk.nextNode(); n; n = walk.nextNode()) out.push(n as Text);
  return out;
}

export class FreshText {
  /** How much text the reply had at its last drawing. */
  private seen = 0;
  /** The pieces still fading, by offset in the reply's text. */
  private spans: { from: number; to: number; at: number }[] = [];
  private timer = 0;
  private root: HTMLElement | null = null;

  /** The streaming reply `root` was drawn again: what is new in it starts fading. */
  drawn(root: HTMLElement) {
    this.root = root;
    const nodes = texts(root);
    const length = nodes.reduce((n, x) => n + x.data.length, 0);
    if (motionLevel() === "spente" || length < this.seen - 40) {
      // Animations off, or another reply in its place: nothing fades.
      this.seen = length;
      this.spans = [];
    } else if (length > this.seen) {
      this.spans.push({ from: this.seen, to: length, at: performance.now() });
      this.seen = length;
    } else this.seen = Math.min(this.seen, length);
    this.paint(nodes);
  }

  /** The turn ended (or another conversation came on screen). */
  reset() {
    this.seen = 0;
    this.spans = [];
    window.clearTimeout(this.timer);
    this.timer = 0;
    this.clear();
    this.root = null;
  }

  private registry() {
    return (this.root?.ownerDocument.defaultView as Win | null)?.CSS?.highlights;
  }

  private clear() {
    const reg = this.registry();
    for (const name of STEPS) reg?.delete(name);
  }

  private paint(nodes?: Text[]) {
    window.clearTimeout(this.timer);
    this.timer = 0;
    const root = this.root;
    const view = root?.ownerDocument.defaultView as Win | null;
    const reg = this.registry();
    if (!root?.isConnected || !reg || !view?.Highlight) {
      this.spans = [];
      return;
    }
    const now = performance.now();
    this.spans = this.spans.filter((s) => now - s.at < STEP_MS * STEPS.length);
    if (!this.spans.length) {
      this.clear();
      return;
    }
    const list = nodes ?? texts(root);
    const groups: Range[][] = STEPS.map(() => []);
    for (const s of this.spans) {
      const step = Math.min(STEPS.length - 1, Math.floor((now - s.at) / STEP_MS));
      let at = 0;
      for (const n of list) {
        const end = at + n.data.length;
        if (end > s.from && at < s.to) {
          const r = root.ownerDocument.createRange();
          r.setStart(n, Math.max(0, s.from - at));
          r.setEnd(n, Math.min(n.data.length, s.to - at));
          groups[step].push(r);
        }
        if (end >= s.to) break;
        at = end;
      }
    }
    STEPS.forEach((name, i) => (groups[i].length ? reg.set(name, new view.Highlight(...groups[i])) : reg.delete(name)));
    this.timer = window.setTimeout(() => this.paint(), STEP_MS);
  }
}

/**
 * The log glides down to its bottom instead of jumping (only while a reply
 * streams in and with animations «ricche»). `gliding` tells the log's scroll
 * listener that the move is its own, not the user's.
 */
export class Glide {
  private frame = 0;
  /** The window the frame was asked of, and when the glide last moved. */
  private frameWin: Window | null = null;
  private lastTick = 0;

  /**
   * Moving now. A frame asked of a window that went (the log moved to the
   * Launcher or the chat's window, WebView2 swapped the page) never comes:
   * without this the glide stayed «on» for ever, the log stopped following the
   * reply and the user's scrolling was taken for the glide's own (27 Nov 2026).
   */
  get gliding() {
    return this.frame !== 0 && performance.now() - this.lastTick < 250;
  }

  constructor(private log: HTMLElement) {
    // The user's wheel or finger stops it at once.
    const stop = () => this.stop();
    log.addEventListener("wheel", stop, { passive: true });
    log.addEventListener("pointerdown", stop);
  }

  /** To the bottom: gliding when `smooth`, else at once. */
  to(smooth: boolean) {
    if (!smooth || motionLevel() !== "ricche") {
      this.stop();
      this.log.scrollTop = this.log.scrollHeight;
      return;
    }
    const view = this.log.ownerDocument.defaultView ?? window;
    if (this.frameWin === view && this.gliding) return;
    this.stop();
    this.lastTick = performance.now();
    const tick = () => {
      this.lastTick = performance.now();
      const target = this.log.scrollHeight - this.log.clientHeight;
      const gap = target - this.log.scrollTop;
      if (gap <= 1 || !this.log.isConnected) {
        this.log.scrollTop = this.log.scrollHeight;
        this.stop();
        return;
      }
      // A quarter of the way each frame: fast when far, soft at the end.
      this.log.scrollTop += Math.max(1, Math.ceil(gap * 0.22));
      this.frame = view.requestAnimationFrame(tick);
    };
    this.frameWin = view;
    this.frame = view.requestAnimationFrame(tick);
  }

  stop() {
    if (this.frame) {
      try {
        this.frameWin?.cancelAnimationFrame(this.frame);
      } catch {
        /* its window is gone */
      }
    }
    this.frame = 0;
    this.frameWin = null;
  }
}
