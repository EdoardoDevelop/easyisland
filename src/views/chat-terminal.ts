// The chat's «Terminale» drawn by xterm.js (9 Nov 2026, asked by Edoardo:
// «non è un vero terminale»). terminal.rs runs the shell in Windows' pseudo
// console; its raw output (colours, cursor, full-screen programs) is drawn
// here and every key goes back raw. One per conversation; its page can change
// (the chat into its own window and back): then it is made again there and
// what it printed is drawn again (`raw`).

import { Terminal, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

/** What it printed, kept to draw it again in another page (characters). */
const KEEP = 300_000;

function theme(doc: Document): ITheme {
  const light = doc.documentElement.dataset.scheme === "light";
  const cs = getComputedStyle(doc.documentElement);
  const accent = cs.getPropertyValue("--win-accent").trim() || "#4cc2ff";
  return light
    ? { background: "#f6f7f9", foreground: "#24272d", cursor: "#24272d", cursorAccent: "#f6f7f9", selectionBackground: "rgba(0, 0, 0, 0.18)" }
    : { background: "#0c0c0e", foreground: "#d6d8dc", cursor: accent, cursorAccent: "#0c0c0e", selectionBackground: "rgba(255, 255, 255, 0.22)" };
}

export class ChatTerm {
  /** terminal.rs' id, 0 while it starts. */
  id = 0;
  /** The shell ended: what it printed stays, keys go nowhere. */
  closed = false;
  private host: HTMLDivElement | null = null;
  private term: Terminal | null = null;
  private fitter: FitAddon | null = null;
  private watch: ResizeObserver | null = null;
  private raw = "";
  private told = { cols: 0, rows: 0 };

  constructor(
    private readonly send: (data: string) => void,
    private readonly resized: (cols: number, rows: number) => void,
  ) {}

  /** Shown in `box`; made again when `box` is in another page than before. */
  mount(box: HTMLElement): void {
    const doc = box.ownerDocument;
    if (this.term && this.host && this.host.ownerDocument === doc) {
      if (this.host.parentElement !== box) box.replaceChildren(this.host);
      this.refit();
      return;
    }
    this.unmount();
    const host = doc.createElement("div");
    host.className = "chat-xterm";
    box.replaceChildren(host);
    const term = new Terminal({
      fontFamily: '"Cascadia Mono", "Cascadia Code", Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.15,
      cursorBlink: true,
      scrollback: 5000,
      allowProposedApi: false,
      theme: theme(doc),
    });
    const fitter = new FitAddon();
    term.loadAddon(fitter);
    term.open(host);
    term.onData((d) => {
      if (!this.closed) this.send(d);
    });
    // Ctrl+C copies when something is selected (else it stops the command, as in Windows Terminal); Ctrl+V pastes.
    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown" || !e.ctrlKey || e.altKey) return true;
      const k = e.key.toLowerCase();
      if (k === "c" && term.hasSelection()) {
        void navigator.clipboard.writeText(term.getSelection()).catch(() => undefined);
        term.clearSelection();
        return false;
      }
      if (k === "v") {
        e.preventDefault();
        void navigator.clipboard.readText().then((s) => { if (s) term.paste(s); }).catch(() => undefined);
        return false;
      }
      return true;
    });
    // Its keys are its own: Esc, Ctrl+N… never reach the island's shortcuts.
    for (const type of ["keydown", "keyup", "keypress"]) host.addEventListener(type, (e) => e.stopPropagation());
    if (this.raw) term.write(this.raw);
    const RO = (doc.defaultView as (Window & { ResizeObserver?: typeof ResizeObserver }) | null)?.ResizeObserver ?? ResizeObserver;
    this.watch = new RO(() => this.refit());
    this.watch.observe(host);
    this.host = host;
    this.term = term;
    this.fitter = fitter;
    this.refit();
  }

  /** Its size in characters now (80×24 before it has room). */
  size(): { cols: number; rows: number } {
    return { cols: this.term?.cols || 80, rows: this.term?.rows || 24 };
  }

  /** Fits the panel; the console is told the new size. */
  refit(): void {
    const term = this.term;
    if (!term || !this.host || this.host.clientWidth < 20 || this.host.clientHeight < 20) return;
    try {
      this.fitter?.fit();
    } catch {
      return;
    }
    if (this.id && (term.cols !== this.told.cols || term.rows !== this.told.rows)) {
      this.told = { cols: term.cols, rows: term.rows };
      this.resized(term.cols, term.rows);
    }
  }

  /** The shell's output. */
  output(data: string): void {
    this.raw += data;
    if (this.raw.length > KEEP * 1.3) this.raw = this.raw.slice(-KEEP);
    this.term?.write(data);
  }

  /** The colours again (light/dark changed). */
  repaint(): void {
    if (this.term && this.host) this.term.options.theme = theme(this.host.ownerDocument);
  }

  focus(): void {
    this.term?.focus();
  }

  unmount(): void {
    this.watch?.disconnect();
    this.watch = null;
    try {
      this.term?.dispose();
    } catch {
      // Its page is gone already.
    }
    this.term = null;
    this.fitter = null;
    this.host?.remove();
    this.host = null;
  }
}
