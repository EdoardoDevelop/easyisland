// «Apri in una finestra»: the chat or an integration's card in a window of its
// own. The island keeps running them (state, events, permissions, engines):
// the window is a blank page the island opens (window.open → lib.rs
// popout_window) and draws its view into, so nothing runs twice.

import { watchIconClicks } from "../views/anim-icons";
import { State } from "../core/state";
import { Bridge } from "../core/bridge";
import type { ViewHost } from "../views/views";

interface Popped {
  win: Window;
  title: string;
  /** The window's name in Rust (`staccata-N`, popout_take), once known. */
  name: string;
  host: ViewHost;
  /** Puts the view back (the chat goes home into the island). */
  close(): void;
  /** The window is gone already (its ✕, told by Rust): the view comes home. */
  gone(): void;
}

const popped = new Map<string, Popped>();

/** Window size and place, per key, for the next time. */
const PLACE_KEY = "easyisland.popout.";

/**
 * A window still there. A window whose page can no longer be reached counts as
 * closed: before, a ✕ the page did not see left the chat in a dead window and
 * the island kept bringing that window forward (buttons that did nothing).
 */
function alive(p: Popped): boolean {
  try {
    return !p.win.closed && !!p.win.document;
  } catch {
    return false;
  }
}

export function isPopped(key: string): boolean {
  const p = popped.get(key);
  if (p && !alive(p)) p.gone();
  return popped.has(key);
}

/** Rust says the window `name` is gone (lib.rs popout_window, popout-closed). */
export function poppedGone(name: string) {
  for (const p of [...popped.values()]) if (p.name === name) p.gone();
}

/** The Rust name of the window of `key` ("" until known). */
export function poppedName(key: string): string {
  return popped.get(key)?.name ?? "";
}

/** The window of `key` to the front; false when there is none. */
export function focusPopped(key: string): boolean {
  if (!isPopped(key)) return false;
  const p = popped.get(key);
  if (!p) return false;
  p.win.focus();
  if (p.name) void Bridge.popoutFocus(p.name);
  return true;
}

/**
 * Opens `host` in a window of its own titled `title`, on the open island's
 * `background` (made opaque). `back` runs when the window is closed (by its ✕
 * or by EasyIsland), after the view has left it. `extra.at`: where it was
 * dropped (screen px), the window's top left corner goes just there;
 * `extra.decorate`: more of the window (the chat's Anteprima panel), its
 * function run at every redraw; `extra.named`: with the window's Rust name, once known.
 */
export function popOut(
  key: string,
  title: string,
  host: ViewHost,
  background: string,
  back: () => void,
  extra: { at?: { x: number; y: number }; decorate?: (doc: Document, body: HTMLElement) => () => void; named?: (name: string) => void } = {},
): boolean {
  const at = extra.at;
  if (focusPopped(key)) return true;
  background = background.replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, "rgb($1,$2,$3)");
  const place = remembered(key);
  if (at) {
    place.x = Math.round(at.x - 80);
    place.y = Math.round(at.y - 16);
  }
  const features = `popup,width=${place.w},height=${place.h}` + (place.x !== null ? `,left=${place.x},top=${place.y}` : "");
  // A blank page: the only one WebView2 keeps scriptable from here (a page of
  // the app loaded in the new window was out of reach, the window stayed empty).
  const win = window.open("", `easyisland-${key}`, features);
  if (!win) {
    void Bridge.log(`finestra staccata ${key}: window.open rifiutata`).catch(() => {});
    return false;
  }

  let frame = 0;
  let done = false;
  let decorated: (() => void) | null = null;
  const draw = () => {
    frame = 0;
    if (done || win.closed) return;
    try {
      host.sync();
      decorated?.();
    } catch (e) {
      void Bridge.log(`finestra staccata ${key}: ${(e as Error)?.stack ?? e}`).catch(() => {});
    }
  };
  const schedule = () => {
    if (!frame && !done && !win.closed && host.el.ownerDocument === win.document) frame = win.requestAnimationFrame(draw);
  };

  // A page that goes away takes the click handlers of what is still in it
  // (Chromium clears them when a document shuts down). Its pagehide comes
  // first: the view is put safe in the island's page then, and laid again in
  // the page that follows if the window is still open (WebView2 may replace
  // the blank page once) — before, the chat came back with dead buttons.
  const safe = (): void => {
    if (done) return;
    keep(key, win);
    holder().append(host.el);
    // A redraw asked of the page that goes never comes: asked again of the next one.
    frame = 0;
    for (const ms of [0, 100, 400, 1200]) {
      window.setTimeout(() => {
        try {
          if (win.closed) finish("chiusa");
          else lay();
        } catch {
          finish("non raggiungibile");
        }
      }, ms);
    }
  };

  // The view in the window's page (again, after a swap); nothing when it is there.
  const lay = () => {
    if (done || win.closed) return;
    const doc = win.document;
    if (doc.getElementById("island")?.contains(host.el)) return;
    // Its page is not ready to take it yet: the next try will.
    if (!doc.body) return;
    dress(doc, title);
    const views = doc.createElement("div");
    views.id = "views";
    const body = doc.createElement("div");
    body.id = "body";
    const content = doc.createElement("div");
    content.id = "content";
    const island = doc.createElement("div");
    island.id = "island";
    island.className = "open railed popwin";
    island.style.background = background;
    doc.body.style.background = background;
    host.el.classList.add("on");
    views.append(host.el);
    body.append(views);
    content.append(body);
    island.append(content);
    doc.body.replaceChildren(island);
    frame = 0;
    decorated = extra.decorate?.(doc, body) ?? null;
    room(win, island);
    // A click outside a menu of the view closes it: the view listens on the island's page.
    doc.addEventListener("pointerdown", (e) => forward(e));
    // These listeners belong to this page: laid again with it.
    win.addEventListener("resize", () => {
      room(win, island);
      schedule();
    });
    win.addEventListener("pagehide", safe);
    schedule();
    window.setTimeout(() => host.focus?.(), 50);
  };
  lay();
  // Its Rust name, asked right after window.open made it: every call to Rust
  // goes by that name (a title can read empty, and a window with the
  // Anteprima docked in it was not found by it).
  let name = "";
  void Bridge.popoutTake().then((n) => {
    if (!n || done) return;
    name = n;
    const p = popped.get(key);
    if (p) p.name = n;
    void Bridge.popoutTitle(n, title);
    extra.named?.(n);
    void Bridge.log(`finestra staccata ${key}: aperta (${n})`).catch(() => {});
  });

  const unsubscribe = State.subscribe(schedule);
  const finish = (why: string) => {
    if (done) return;
    done = true;
    void Bridge.log(`finestra staccata ${key}: ${why}`).catch(() => {});
    window.clearInterval(watch);
    unsubscribe();
    popped.delete(key);
    host.el.remove();
    back();
    State.notify();
  };
  // Every second: closed (the safety net behind Rust's popout-closing), or a
  // page without the view (laid again), and the title WebView2 may lose.
  const watch = window.setInterval(() => {
    try {
      if (win.closed) {
        finish("chiusa");
        return;
      }
      lay();
      mirror(win.document, background);
      keep(key, win);
      if (win.document.title !== title) win.document.title = title;
    } catch {
      // Its page is out of reach: the window is gone.
      finish("non raggiungibile");
      return;
    }
  }, 1000);

  popped.set(key, {
    win,
    title,
    name,
    host,
    close: () => {
      keep(key, win);
      // The view home first (and the Anteprima with it), then the window goes:
      // a page cannot close a window it did not open, Rust closes it.
      finish("rimessa nell'isola");
      const n = popped.get(key)?.name || name;
      if (n) void Bridge.popoutClose(n);
    },
    gone: () => finish("chiusa dalla ✕"),
  });
  return true;
}

/** A hidden place in the island's page for a view between two pages of its window. */
let safeBox: HTMLElement | null = null;
function holder(): HTMLElement {
  if (!safeBox) {
    safeBox = document.createElement("div");
    safeBox.style.display = "none";
    document.body.append(safeBox);
  }
  return safeBox;
}

/** Rust is closing the window `name` (its ✕): the view comes home first, then it goes. */
export function closingPopped(name: string) {
  for (const p of [...popped.values()]) if (p.name === name) p.close();
}

/** Closes the window of `key`, if open; its view goes back. */
export function closePopped(key: string) {
  popped.get(key)?.close();
}

/** The island's look in the new page: styles, theme, language. */
function dress(doc: Document, title: string) {
  const root = document.documentElement;
  for (const a of Array.from(root.attributes)) doc.documentElement.setAttribute(a.name, a.value);
  doc.documentElement.classList.remove("browser-preview");
  doc.head.replaceChildren();
  const meta = doc.createElement("meta");
  meta.setAttribute("charset", "utf-8");
  doc.head.append(meta);
  for (const s of Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))) doc.head.append(s.cloneNode(true));
  watchIconClicks(doc);
  const own = doc.createElement("style");
  own.textContent = POPWIN_CSS;
  doc.head.append(own);
  // After the head is made: emptying it would take the title away again.
  doc.title = title;
}

/**
 * The island's theme followed while the window is open: light/dark, style,
 * --card-alpha (the attributes and the style of <html>) and the island's
 * colour. Before, only the look of the moment it opened was copied.
 */
function mirror(doc: Document, fallback: string) {
  const root = document.documentElement;
  const there = doc.documentElement;
  for (const a of Array.from(root.attributes)) {
    if (a.name === "class") continue;
    if (there.getAttribute(a.name) !== a.value) there.setAttribute(a.name, a.value);
  }
  const bg = (document.getElementById("island")?.style.background || fallback).replace(/rgba\(([^,]+),([^,]+),([^,]+),[^)]+\)/, "rgb($1,$2,$3)");
  const island = doc.getElementById("island");
  if (island && island.style.background !== bg) island.style.background = bg;
  if (doc.body && doc.body.style.background !== bg) doc.body.style.background = bg;
}

/** Room for the lists (--extra-h, --extra-w), as the island gives them when it grows. */
function room(win: Window, island: HTMLElement) {
  island.style.setProperty("--extra-h", `${Math.max(0, win.innerHeight - 420)}px`);
  island.style.setProperty("--extra-w", `${Math.max(0, win.innerWidth - 560)}px`);
}

/** A pointerdown in the window, told to the island's page with its real target. */
function forward(e: PointerEvent) {
  const copy = new PointerEvent("pointerdown", { bubbles: false });
  Object.defineProperty(copy, "target", { value: e.target });
  document.dispatchEvent(copy);
}

function remembered(key: string): { w: number; h: number; x: number | null; y: number | null } {
  const fallback = key === "chat" ? { w: 760, h: 720 } : { w: 520, h: 620 };
  try {
    const v = JSON.parse(localStorage.getItem(PLACE_KEY + key) ?? "null") as { w: number; h: number; x: number; y: number } | null;
    if (v && v.w >= 360 && v.h >= 300) return v;
  } catch {
    /* no storage */
  }
  return { ...fallback, x: null, y: null };
}

function keep(key: string, win: Window) {
  try {
    if (win.closed || !win.outerWidth) return;
    localStorage.setItem(PLACE_KEY + key, JSON.stringify({ w: win.innerWidth, h: win.innerHeight, x: win.screenX, y: win.screenY }));
  } catch {
    /* no storage */
  }
}

/** The window is the open island without its frame: the whole page, no rounding, no animation. */
const POPWIN_CSS = `
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #000; }
#island.popwin { position: fixed; inset: 0; width: auto !important; height: auto !important; border-radius: 0 !important; transform: none !important; }
#island.popwin #content { opacity: 1; pointer-events: auto; padding: 10px 12px 12px; }
#island.popwin #body { margin-top: 0; }
#island.popwin #views > .view { position: absolute; inset: 0; width: auto; opacity: 1; transform: none; pointer-events: auto; transition: none; }
#island.popwin .view.detached .left-body { justify-content: flex-start; overflow-y: auto; }
#island.popwin #content:has(.chat-card) { padding: 0; }
#island.popwin .chat-card { border: 0; border-radius: 0; }
html[data-chat-look="cards"] #island.popwin #content:has(.chat-card) { padding: 8px; }
`;
