// The notices in a window of their own (src-tauri/src/notices_window.rs;
// Edoardo, 17 Nov 2026: «qualsiasi notifica deve essere meno invasiva … separate
// dall'isola»). A blank page drawn from here, as the popped-out views
// (island/popout.ts): the island keeps the one brain, the window only shows.
// It never takes the focus nor moves or opens the island: a click on a toast
// opens the island on that thing (the user asked), its buttons do their action.
// Permissions and questions stay in the island (never approved without its card).

import { Bridge, IS_TAURI } from "../core/bridge";
import { t } from "../core/i18n";
import { State } from "../core/state";
import { dress } from "../island/popout";

export type ToastLevel = "info" | "ok" | "warn" | "error";

export interface Toast {
  /** Same key: the newer replaces the older (a burst of downloads, the same agent again). */
  key?: string;
  icon: string;
  title: string;
  text?: string;
  level: ToastLevel;
  /** Buttons of the toast; each closes it after doing its thing. */
  actions?: { label: string; run: () => void }[];
  /** A click on the toast: the island on that thing. */
  open?: () => void;
}

interface Shown extends Toast {
  id: number;
  /** ms left before it goes (0: until closed); paused while the mouse is on it. */
  left: number;
  started: number;
  timer: number;
}

/** How long each stays: ok/info 8 s, warnings 15 s, errors until closed. */
const TTL: Record<ToastLevel, number> = { info: 8000, ok: 8000, warn: 15000, error: 0 };
/** At most this many on screen; the rest wait as «+N». */
const MAX = 3;

let next = 1;
const toasts: Shown[] = [];
let win: Window | null = null;
let opening = false;
let hovered = false;
/** Draws waiting for the new window's page (100 ms apart). */
let bodyTries = 0;

/** In their own window (Impostazioni → Notifiche → «Avvisi»), unless «Nell'isola». */
export function windowed(): boolean {
  // In the browser's preview the scenes of the cards (moment, daily, recap) keep them in the island.
  return (State.settings.noticesPlace ?? (IS_TAURI ? "isola" : "dentro")) !== "dentro";
}

/** A new toast; the same key replaces the one on screen. */
export function push(toast: Toast) {
  if (toast.key) {
    const old = toasts.findIndex((x) => x.key === toast.key);
    if (old >= 0) drop(toasts[old].id, false);
  }
  const s: Shown = { ...toast, id: next++, left: TTL[toast.level], started: Date.now(), timer: 0 };
  toasts.unshift(s);
  if (!hovered) arm(s);
  void draw();
}

function arm(s: Shown) {
  if (!s.left) return;
  s.started = Date.now();
  window.clearTimeout(s.timer);
  s.timer = window.setTimeout(() => drop(s.id), s.left);
}

/** The mouse on the toasts: the time stops; off them, it goes on. */
function hover(on: boolean) {
  hovered = on;
  for (const s of toasts.slice(0, MAX)) {
    if (!s.left) continue;
    if (on) {
      window.clearTimeout(s.timer);
      s.left = Math.max(1500, s.left - (Date.now() - s.started));
    } else arm(s);
  }
}

function drop(id: number, redraw = true) {
  const i = toasts.findIndex((x) => x.id === id);
  if (i < 0) return;
  window.clearTimeout(toasts[i].timer);
  toasts.splice(i, 1);
  if (toasts.length === 0) hovered = false;
  if (redraw) void draw();
}

/** Every toast away (the island opened on them, or the setting changed). */
export function clearAll() {
  for (const s of toasts) window.clearTimeout(s.timer);
  toasts.length = 0;
  hovered = false;
  void draw();
}

/** The window, made the first time (and again if it was closed). */
async function ensure(): Promise<Window | null> {
  if (win && !win.closed) return win;
  if (opening) return null;
  opening = true;
  try {
    // popout_window (lib.rs) makes this one a notices' window (notices_window.rs).
    await Bridge.popoutKind("avvisi");
    const w = window.open("", "easyisland-notices", "popup,width=340,height=120");
    if (!w) {
      void Bridge.log("avvisi: window.open rifiutata, restano nell'isola").catch(() => {});
      return null;
    }
    win = w;
    // WebView2 may swap the blank page once: laid again in the next one.
    w.addEventListener("pagehide", () => {
      for (const ms of [0, 100, 400, 1200]) window.setTimeout(() => void draw(), ms);
    });
    return w;
  } finally {
    opening = false;
  }
}

/** The toasts in the window, and the window sized and placed (or hidden). */
/** The browser's preview (npm run dev): no window, the toasts in a corner of the page. */
function drawInPage() {
  let box = document.getElementById("notices");
  if (!box) {
    const style = document.createElement("style");
    style.textContent = NOTICES_CSS.replace(/html, body \{[^}]*\}/, "") + "#notices { position: fixed; top: 12px; right: 12px; width: 340px; z-index: 99; }";
    document.head.append(style);
    box = document.createElement("div");
    box.id = "notices";
    box.addEventListener("mouseenter", () => hover(true));
    box.addEventListener("mouseleave", () => hover(false));
    document.body.append(box);
  }
  box.replaceChildren(...toasts.slice(0, MAX).map((s) => card(document, s)));
  const more = toasts.length - MAX;
  if (more > 0) box.append(moreButton(document, more));
}

function moreButton(doc: Document, more: number): HTMLElement {
  const tail = doc.createElement("button");
  tail.type = "button";
  tail.className = "notice-more";
  tail.textContent = t("+{n} altri · chiudi tutti", { n: more });
  tail.addEventListener("click", () => clearAll());
  return tail;
}

/** No toast: the window emptied and hidden, always (also when this page lost
 * track of it, after a reload: hiding a hidden window costs nothing). */
function hideEmpty() {
  if (win && !win.closed) {
    try {
      win.document.getElementById("notices")?.replaceChildren();
    } catch {
      // Its page is out of reach: the next draw makes it again.
    }
  }
  void Bridge.noticesHide();
}

async function draw() {
  if (!IS_TAURI) {
    drawInPage();
    return;
  }
  if (!toasts.length) {
    hideEmpty();
    return;
  }
  const w = await ensure();
  if (!w) return;
  // The last toast may have gone while the window was being made: an empty
  // window shown here stayed in front, invisible, taking the clicks under it
  // (Edoardo, 19 Nov 2026: «mi si mette in trasparenza davanti»).
  if (!toasts.length) {
    hideEmpty();
    return;
  }
  let doc: Document;
  try {
    doc = w.document;
  } catch {
    return;
  }
  // Just made, its blank page has no body yet: drawn again in a moment
  // (17 Nov 2026: the first notice, «Prova» in Impostazioni, never showed).
  if (!doc.body) {
    if (bodyTries++ < 20) window.setTimeout(() => void draw(), 100);
    else void Bridge.log("avvisi: la pagina della finestra non è pronta").catch(() => {});
    return;
  }
  bodyTries = 0;
  let box = doc.getElementById("notices");
  if (!box) {
    dress(doc, t("Avvisi"));
    const own = doc.createElement("style");
    own.textContent = NOTICES_CSS;
    doc.head.append(own);
    box = doc.createElement("div");
    box.id = "notices";
    box.addEventListener("mouseenter", () => hover(true));
    box.addEventListener("mouseleave", () => hover(false));
    doc.body.replaceChildren(box);
  }
  box.replaceChildren(...toasts.slice(0, MAX).map((s) => card(doc, s)));
  const more = toasts.length - MAX;
  if (more > 0) box.append(moreButton(doc, more));
  const height = Math.ceil(box.getBoundingClientRect().height) + 4;
  void Bridge.noticesShow(height, State.settings.noticesPlace ?? "isola");
  watch();
}

/** While the window is shown, every 2 s: is something really drawn in it?
 * It stayed in front empty and transparent, taking the clicks, here and on
 * the laptop even after the other fixes (Edoardo, 19 Nov 2026): a toast drawn
 * in a page the window no longer shows (WebView2 swapping its blank page), or
 * one gone without the window being hidden. Not drawn: drawn once more, then
 * hidden. CPU: one check every 2 s only while a toast is on screen. */
let guard = 0;
let misses = 0;
function watch() {
  if (!guard) guard = window.setInterval(check, 2000);
}
function check() {
  if (!toasts.length) {
    window.clearInterval(guard);
    guard = 0;
    misses = 0;
    hideEmpty();
    return;
  }
  let drawn = false;
  try {
    const box = win && !win.closed ? win.document.getElementById("notices") : null;
    drawn = !!box && box.isConnected && box.childElementCount > 0 && box.getBoundingClientRect().height > 8;
  } catch {
    drawn = false;
  }
  if (drawn) {
    misses = 0;
    return;
  }
  misses++;
  void Bridge.log(`avvisi: finestra vuota con ${toasts.length} avvisi (tentativo ${misses})`).catch(() => {});
  if (misses === 1) {
    void draw();
    return;
  }
  // Not drawn twice: hidden; the next notice draws it again from scratch.
  window.clearInterval(guard);
  guard = 0;
  misses = 0;
  hideEmpty();
}

function card(doc: Document, s: Shown): HTMLElement {
  const el = doc.createElement("div");
  el.className = `notice-toast ${s.level}`;
  el.setAttribute("role", s.level === "error" || s.level === "warn" ? "alert" : "status");
  const icon = doc.createElement("span");
  icon.className = "notice-icon";
  icon.textContent = s.icon;
  const words = doc.createElement("div");
  words.className = "notice-words";
  const title = doc.createElement("div");
  title.className = "notice-title";
  title.textContent = s.title;
  words.append(title);
  if (s.text) {
    const text = doc.createElement("div");
    text.className = "notice-text";
    text.textContent = s.text;
    words.append(text);
  }
  if (s.actions?.length) {
    const row = doc.createElement("div");
    row.className = "notice-actions";
    for (const a of s.actions) {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "notice-btn";
      b.textContent = a.label;
      b.addEventListener("click", (e) => {
        e.stopPropagation();
        drop(s.id);
        a.run();
      });
      row.append(b);
    }
    words.append(row);
  }
  const close = doc.createElement("button");
  close.type = "button";
  close.className = "notice-close";
  close.title = t("Chiudi");
  close.setAttribute("aria-label", t("Chiudi"));
  close.textContent = "✕";
  close.addEventListener("click", (e) => {
    e.stopPropagation();
    drop(s.id);
  });
  el.append(icon, words, close);
  if (s.open) {
    el.classList.add("opens");
    el.addEventListener("click", () => {
      drop(s.id);
      s.open?.();
    });
  }
  return el;
}

/** Only for the notices' page: transparent, the toasts in the island's colours. */
const NOTICES_CSS = `
html, body { margin: 0; padding: 0; background: transparent !important; overflow: hidden; }
#notices { display: flex; flex-direction: column; gap: 8px; padding: 2px 2px 2px 2px; font: 400 13px var(--font, "Segoe UI", sans-serif); }
.notice-toast { position: relative; display: flex; gap: 10px; align-items: flex-start; padding: 10px 30px 10px 12px; border-radius: 12px;
  background: color-mix(in srgb, var(--card, #18191d) 96%, transparent); color: var(--ink, #f1f5f9);
  box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.09), 0 8px 22px rgba(0, 0, 0, 0.35); border-left: 3px solid #38bdf8;
  animation: notice-in 0.18s ease-out; }
.notice-toast.ok { border-left-color: #22c55e; }
.notice-toast.warn { border-left-color: #f59e0b; }
.notice-toast.error { border-left-color: #ef4444; }
.notice-toast.opens { cursor: pointer; }
.notice-toast.opens:hover { background: color-mix(in srgb, var(--card, #18191d) 88%, #38bdf8 6%); }
.notice-icon { flex: none; width: 20px; text-align: center; font-size: 15px; line-height: 20px; }
.notice-words { flex: 1 1 auto; min-width: 0; }
.notice-title { font-weight: 600; line-height: 20px; overflow-wrap: anywhere; }
.notice-text { margin-top: 2px; color: var(--dim, #cbd5e1); font-size: 12px; line-height: 1.4; overflow-wrap: anywhere;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
.notice-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 7px; }
.notice-btn { height: 24px; padding: 0 10px; border: 1px solid rgba(255, 255, 255, 0.16); border-radius: 12px; background: transparent;
  color: var(--ink, #f1f5f9); font: 500 12px var(--font, "Segoe UI", sans-serif); cursor: pointer; }
.notice-btn:hover { background: rgba(255, 255, 255, 0.08); }
.notice-close { position: absolute; top: 6px; right: 6px; width: 20px; height: 20px; padding: 0; border: 0; border-radius: 6px;
  background: transparent; color: var(--dim-3, #94a3b8); font-size: 11px; cursor: pointer; }
.notice-close:hover { background: rgba(255, 255, 255, 0.1); color: var(--ink, #f1f5f9); }
.notice-more { align-self: flex-end; padding: 3px 10px; border: 0; border-radius: 10px; background: color-mix(in srgb, var(--card, #18191d) 92%, transparent);
  color: var(--dim, #cbd5e1); font: 500 11.5px var(--font, "Segoe UI", sans-serif); cursor: pointer; box-shadow: 0 0 0 1px rgba(255, 255, 255, 0.08); }
html[data-scheme="light"] .notice-toast { background: #ffffff; color: #0f172a; box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.1), 0 8px 22px rgba(15, 23, 42, 0.18); }
html[data-scheme="light"] .notice-text { color: #475569; }
html[data-scheme="light"] .notice-btn { border-color: rgba(15, 23, 42, 0.18); color: #0f172a; }
html[data-scheme="light"] .notice-more { background: #ffffff; color: #475569; }
@keyframes notice-in { from { opacity: 0; transform: translateY(-6px); } }
@media (prefers-reduced-motion: reduce) { .notice-toast { animation: none; } }
`;

// The island's page (re)starting: a window left shown by the page before,
// with nobody to hide it, goes now.
if (IS_TAURI) void Bridge.noticesHide();
