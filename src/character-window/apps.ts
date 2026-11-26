// The fixed bar's «App» (22 Nov 2026, Edoardo: «come su Windows avere le
// applicazioni, aprirle e quelle aperte»): the pinned apps and the open ones,
// grouped by app as the Windows taskbar does, drawn in the element's place in
// the bar (`.bar-apps`, src/island/bar.ts). The windows come from Rust
// (taskwin.rs: `apps_windows`, then only changes in `apps-windows`), the icons
// in `apps-icons`, the pins with the bar's look (settings `appsPinned`).
//
// Clicks are handled here, on the press as the bar's other elements: open the
// app, bring it forward or minimize it (taskwin.rs `apps_do`); with several
// windows, or the mouse resting on it, the island shows their card with live
// previews (src/views/barcard.ts); the right button opens the app's menu
// (barapps.rs `apps_menu`). Nothing runs while nothing changes.

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import type { AppPin, CharacterToIsland } from "../core/link";

interface Win {
  hwnd: number;
  app: string;
  title: string;
  active: boolean;
  minimized: boolean;
  attention: boolean;
  lastUsed: number;
}

interface Group {
  id: string;
  name: string;
  pinned: boolean;
  windows: Win[];
}

const wins = new Map<number, Win>();
/** Icons by app id in lower case (applist.rs `apps-icons`). */
const icons = new Map<string, string>();
const asked = new Set<string>();
let pins: AppPin[] = [];
/** When each app not pinned first showed a window: their order in the bar. */
const seen = new Map<string, number>();
let started = false;
let redraw: () => void = () => {};
let send: (m: CharacterToIsland) => void = () => {};

const low = (s: string) => s.toLowerCase();

function askIcons(ids: string[]) {
  const fresh = ids.filter((id) => id && !icons.has(low(id)) && !asked.has(low(id)));
  if (!fresh.length) return;
  fresh.forEach((id) => asked.add(low(id)));
  void invoke("apps_icons", { ids: fresh }).catch(() => {});
}

function put(w: Win) {
  wins.set(w.hwnd, w);
  if (!seen.has(low(w.app))) seen.set(low(w.app), seen.size);
}

/** «App» is in the bar: the windows followed from now on (once). */
export function appsStart(onChange: () => void, sender: (m: CharacterToIsland) => void) {
  redraw = onChange;
  send = sender;
  if (started) return;
  started = true;
  // The Windows taskbar's pins, read and followed by Rust (barapps.rs).
  void invoke("apps_start").catch(() => {});
  void invoke<Win[]>("apps_windows").then((list) => {
    wins.clear();
    for (const w of list ?? []) put(w);
    askIcons([...new Set((list ?? []).map((w) => w.app))]);
    redraw();
  }).catch(() => {});
  const view = getCurrentWebview();
  void view.listen<{ add?: Win[]; change?: Win[]; remove?: number[] }>("apps-windows", (e) => {
    for (const h of e.payload.remove ?? []) wins.delete(h);
    for (const w of [...(e.payload.add ?? []), ...(e.payload.change ?? [])]) put(w);
    askIcons((e.payload.add ?? []).map((w) => w.app));
    redraw();
  });
  void view.listen<Record<string, string>>("apps-icons", (e) => {
    for (const [id, url] of Object.entries(e.payload ?? {})) if (url) icons.set(low(id), url);
    redraw();
  });
}

/** The pinned apps, from the bar's look; their icons asked once. */
export function setPins(list: AppPin[] | undefined) {
  pins = (list ?? []).filter((p) => p && typeof p.id === "string" && p.id);
  askIcons(pins.map((p) => p.id));
}

// «App»'s options (Personalizza la barra → App; 24 Nov 2026, ideas from the
// docks for Windows): the icons grow under the mouse, and windows minimize
// into their icon (taskwin.rs answers Windows with the icons' places).
let magnify = false;
let minimizeTo = true;
/** The bar's edge: the icons grow away from it. */
let edge: "top" | "bottom" = "top";

export function setAppsLook(look: { magnify?: boolean; minimizeTo?: boolean } | undefined, barEdge: "top" | "bottom") {
  magnify = !!look?.magnify;
  minimizeTo = look?.minimizeTo !== false;
  edge = barEdge;
  // A bar at the top: the icons hop downwards, into the screen (personaggio.html).
  document.body.classList.toggle("edge-top", barEdge === "top");
  if (!magnify) unmagnify();
  sendRectsSoon();
}

/** The icons' places sent last (taskwin.rs `apps_rects`): sent again only when they change. */
let rectsSent = "";
let rectsFrame = 0;

/** After the bar is laid out: where each app's icon is, for windows minimizing into it. */
export function sendRectsSoon() {
  if (rectsFrame) return;
  rectsFrame = requestAnimationFrame(() => {
    rectsFrame = 0;
    const rects = !started || !minimizeTo ? [] : [...document.querySelectorAll<HTMLElement>(".app-ico")]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      // Moved into «…» or hidden: no place on the screen.
      .filter(({ el, r }) => r.width > 0 && r.height > 0 && el.offsetParent !== null)
      .map(({ el, r }) => ({ app: el.dataset.app ?? "", x: r.left, y: r.top, w: r.width, h: r.height }))
      .filter((x) => x.app);
    const key = JSON.stringify(rects.map((r) => [r.app, Math.round(r.x), Math.round(r.y), Math.round(r.w), Math.round(r.h)]));
    if (key === rectsSent) return;
    rectsSent = key;
    void invoke("apps_rects", { rects }).catch(() => {});
  });
}
window.addEventListener("resize", sendRectsSoon);

/** How much the icon under the mouse grows; its neighbours less, within `REACH` icons. */
const MAGNIFY = 1.45;
const REACH = 2.2;
let magnified: HTMLElement | null = null;
/** Where the mouse is over the apps (window px), null when not over them. */
let magX: number | null = null;

function unmagnify() {
  magX = null;
  if (!magnified) return;
  for (const img of magnified.querySelectorAll<HTMLElement>(".app-ico > img, .app-ico > .app-letter")) img.style.transform = "";
  magnified = null;
}

/** Each icon grows by its distance from the mouse. */
function magnifyAt(host: HTMLElement, x: number) {
  magnified = host;
  host.style.setProperty("--mag-origin", edge === "bottom" ? "center bottom" : "center top");
  for (const el of host.querySelectorAll<HTMLElement>(".app-ico")) {
    const r = el.getBoundingClientRect();
    const d = Math.abs(x - (r.left + r.width / 2)) / Math.max(1, r.width * REACH);
    const s = d >= 1 ? 1 : 1 + (MAGNIFY - 1) * Math.cos((d * Math.PI) / 2);
    const img = el.querySelector<HTMLElement>(":scope > img, :scope > .app-letter");
    if (img) img.style.transform = s > 1.005 ? `scale(${s.toFixed(3)})` : "";
  }
}

/** The icons near the mouse grow, as a wave: only while it moves over them. */
document.addEventListener("pointermove", (e) => {
  if (!magnify) return;
  const host = (e.target as HTMLElement | null)?.closest?.(".bar-apps") as HTMLElement | null;
  if (!host || press?.dragging) {
    unmagnify();
    return;
  }
  magX = e.clientX;
  magnifyAt(host, e.clientX);
});
document.addEventListener("mouseleave", unmagnify);

/** Pinned first in their order, then the open ones in the order they came. */
function groups(): Group[] {
  const all = [...wins.values()];
  const out: Group[] = pins.map((p) => ({ id: p.id, name: p.name, pinned: true, windows: all.filter((w) => low(w.app) === low(p.id)) }));
  const taken = new Set(pins.map((p) => low(p.id)));
  const rest = new Map<string, Win[]>();
  for (const w of all) {
    if (taken.has(low(w.app))) continue;
    const list = rest.get(low(w.app)) ?? [];
    list.push(w);
    rest.set(low(w.app), list);
  }
  const loose = [...rest.entries()]
    .sort((a, b) => (seen.get(a[0]) ?? 0) - (seen.get(b[0]) ?? 0))
    .map(([, list]) => ({ id: list[0].app, name: appName(list[0].app), pinned: false, windows: list }));
  for (const g of [...out, ...loose]) g.windows.sort((a, b) => b.lastUsed - a.lastUsed);
  return [...out, ...loose];
}

/** A name for an app that is not pinned: its program's file name, else its window's title. */
function appName(id: string): string {
  const file = id.split(/[\\/]/).pop() ?? id;
  // EasyIsland's own windows (Impostazioni, Memoria, chats popped out: taskwin.rs OWN).
  if (/^easyisland\.exe$/i.test(file)) return "EasyIsland";
  return file.replace(/\.(exe|lnk)$/i, "") || id;
}

function groupOf(id: string): Group | undefined {
  return groups().find((g) => low(g.id) === low(id));
}

/** The apps drawn into their place in the bar. */
export function fillApps(host: HTMLElement) {
  // An icon being dragged stays where the mouse put it: drawn again once it is let go.
  if (press?.dragging) {
    redrawLater = true;
    return;
  }
  host.replaceChildren();
  for (const g of groups()) {
    const el = document.createElement("span");
    const n = g.windows.length;
    // A window came: the app is open, no more hopping.
    if (n) launching.delete(low(g.id));
    el.className = [
      "app-ico",
      launching.has(low(g.id)) ? "launching" : "",
      n ? "open" : "",
      n > 1 ? "many" : "",
      g.windows.some((w) => w.active) ? "active" : "",
      g.windows.some((w) => w.attention) ? "attention" : "",
    ].filter(Boolean).join(" ");
    el.dataset.app = g.id;
    const url = icons.get(low(g.id));
    if (url) {
      const img = document.createElement("img");
      img.src = url;
      img.alt = "";
      img.draggable = false;
      el.append(img);
    } else {
      const letter = document.createElement("span");
      letter.className = "app-letter";
      letter.textContent = (g.name || "?").slice(0, 1).toUpperCase();
      el.append(letter);
    }
    host.append(el);
  }
  magnified = null;
  sendRectsSoon();
}

/**
 * The bar was laid out again (main.ts layAreas; the values change every few
 * seconds) with the mouse over the apps: still grown where it is, measured now
 * that the new icons are in place, and without the transition this once, or
 * they would shrink and grow back.
 */
export function appsLaidOut() {
  if (!magnify || magX === null) return;
  const host = document.querySelector<HTMLElement>(".bar-apps");
  if (!host) return;
  host.classList.add("mag-still");
  magnifyAt(host, magX);
  requestAnimationFrame(() => host.classList.remove("mag-still"));
}

function centre(el: HTMLElement): number {
  const r = el.getBoundingClientRect();
  return Math.round(r.left + r.width / 2);
}

/**
 * Left click on an app: one window → front or minimized, none → opened,
 * several → their card. As on the Windows taskbar: Maiusc+click opens a new
 * window, Ctrl+Maiusc+click runs it as administrator (Windows asks).
 */
function leftClick(id: string, el: HTMLElement, ctrl: boolean, shift = false) {
  if (shift) {
    void invoke("apps_do", { what: ctrl ? "launch-admin" : "launch-new", app: id }).catch(() => {});
    return;
  }
  const g = groupOf(id);
  // Ctrl+click: the app's next window, as on the Windows taskbar (23 Nov 2026).
  if (ctrl && g && g.windows.length > 1) cycle(id, 1);
  else if (g && g.windows.length > 1) send({ kind: "bar", key: `apps:list:${id}`, x: centre(el) });
  else {
    // Opening an app with no window: its icon hops until one comes (or LAUNCH_MS).
    if (!g?.windows.length) launchingNow(id);
    void invoke("apps_do", { what: "click", app: id }).catch(() => {});
  }
}

/**
 * Apps being opened (Edoardo, 24 Nov 2026: «bisogna che ci sia una
 * indicazione visiva quando ci si clicca»): their icon hops until a window of
 * theirs shows, at most LAUNCH_MS; the animation runs only then.
 */
const launching = new Map<string, number>();
const LAUNCH_MS = 6000;

function launchingNow(id: string) {
  launching.set(low(id), Date.now() + LAUNCH_MS);
  for (const el of document.querySelectorAll<HTMLElement>(".app-ico")) if (low(el.dataset.app ?? "") === low(id)) el.classList.add("launching");
  window.setTimeout(() => {
    const until = launching.get(low(id));
    if (until && until <= Date.now()) {
      launching.delete(low(id));
      for (const el of document.querySelectorAll<HTMLElement>(".app-ico.launching")) if (low(el.dataset.app ?? "") === low(id)) el.classList.remove("launching");
    }
  }, LAUNCH_MS + 50);
}

// Apps put in order by dragging them along the bar (Edoardo, 23 Nov 2026).
// The left button acts on its release, as on the Windows taskbar, so a press
// that moves is a drag; a press whose release never comes (another app in
// front can keep it, the log of 31 Oct 2026) acts after HOLD_MS all the same.
interface Press { id: string; el: HTMLElement; x: number; ctrl: boolean; shift: boolean; dragging: boolean; done: boolean; timer: number }
let press: Press | null = null;
/** The bar drawn again while dragging: deferred to the drop. */
let redrawLater = false;
const HOLD_MS = 600;
const DRAG_PX = 6;

function act(p: Press) {
  window.clearTimeout(p.timer);
  if (p.done || p.dragging) return;
  p.done = true;
  leftClick(p.id, p.el, p.ctrl, p.shift);
}

/** Where the dragged icon goes among the others: moved in the DOM as it passes their centres. */
function dragTo(p: Press, x: number) {
  const host = p.el.parentElement;
  if (!host) return;
  const others = [...host.querySelectorAll<HTMLElement>(".app-ico")].filter((a) => a !== p.el);
  const next = others.find((a) => x < centre(a)) ?? null;
  if (next !== p.el.nextElementSibling) host.insertBefore(p.el, next);
}

/** The new order kept: pinned apps in the settings (barapps.rs `apps_move`), the others here. */
function drop(p: Press) {
  const host = p.el.parentElement;
  p.el.classList.remove("dragging");
  if (!host) return;
  const order = [...host.querySelectorAll<HTMLElement>(".app-ico")].map((a) => a.dataset.app ?? "");
  const pinnedIds = new Set(pins.map((x) => low(x.id)));
  if (pinnedIds.has(low(p.id))) {
    const newPins = order.filter((id) => pinnedIds.has(low(id)));
    const at = newPins.findIndex((id) => low(id) === low(p.id));
    const before = newPins[at + 1] ?? null;
    // At once here; the settings come back with the same order.
    pins = newPins.map((id) => pins.find((x) => low(x.id) === low(id))).filter((x): x is AppPin => !!x);
    void invoke("apps_move", { id: p.id, before }).catch(() => {});
  } else {
    order.filter((id) => !pinnedIds.has(low(id))).forEach((id, i) => seen.set(low(id), i));
  }
  redrawLater = false;
  redraw();
}

/** A press on an app (true: handled). Left: acts on release unless dragged. Middle: a new window. */
export function appsPress(e: PointerEvent | MouseEvent): boolean {
  const el = (e.target as HTMLElement | null)?.closest?.(".app-ico") as HTMLElement | null;
  const id = el?.dataset.app;
  if (!el || !id) return false;
  cancelHover();
  // Pressed: the icon sinks a little until it is let go (the feedback of a click).
  el.classList.add("pressed");
  if (e.button !== 0) window.setTimeout(() => el.classList.remove("pressed"), 160);
  if (e.button === 1) {
    void invoke("apps_do", { what: "launch-new", app: id }).catch(() => {});
  } else if (e.button === 0) {
    if (press) window.clearTimeout(press.timer);
    const p: Press = { id, el, x: e.clientX, ctrl: e.ctrlKey, shift: e.shiftKey, dragging: false, done: false, timer: 0 };
    p.timer = window.setTimeout(() => act(p), HOLD_MS);
    press = p;
    if ("pointerId" in e) {
      try { el.setPointerCapture(e.pointerId); } catch { /* the pointer is gone */ }
    }
  }
  return true;
}

document.addEventListener("pointermove", (e) => {
  const p = press;
  if (!p) return;
  if (!p.dragging) {
    if (Math.abs(e.clientX - p.x) < DRAG_PX || p.done) return;
    p.dragging = true;
    window.clearTimeout(p.timer);
    p.el.classList.add("dragging");
    if (hovered) send({ kind: "bar", key: "apps:leave" });
  }
  dragTo(p, e.clientX);
});

function release() {
  const p = press;
  if (!p) return;
  press = null;
  p.el.classList.remove("pressed");
  if (p.dragging) drop(p);
  else act(p);
  if (redrawLater) {
    redrawLater = false;
    redraw();
  }
}
document.addEventListener("pointerup", (e) => { if (e.button === 0) release(); });
document.addEventListener("lostpointercapture", release, true);
document.addEventListener("pointercancel", () => {
  const p = press;
  press = null;
  if (p) {
    p.el.classList.remove("pressed");
    window.clearTimeout(p.timer);
    if (p.dragging) drop(p);
  }
});

/**
 * The app's next (`dir` 1) or previous (-1) window in front. The order is the
 * one they came in (the map keeps it), so going round shows each once; the
 * window marked in front here at once, so quick wheel steps go on from it.
 */
function cycle(id: string, dir: 1 | -1) {
  const list = [...wins.values()].filter((w) => low(w.app) === low(id));
  if (!list.length) return;
  let at = list.findIndex((w) => w.active);
  if (at < 0) at = list.reduce((best, w, i) => (w.lastUsed > list[best].lastUsed ? i : best), 0);
  const next = list.length === 1 ? list[0] : list[(at + dir + list.length) % list.length];
  for (const w of list) w.active = w === next;
  void invoke("apps_do", { what: "activate", hwnd: next.hwnd }).catch(() => {});
}

let wheelAt = 0;
/** The wheel on an app with windows: they come in front one by one. True: handled. */
export function appsWheel(e: WheelEvent): boolean {
  const el = (e.target as HTMLElement | null)?.closest?.(".app-ico") as HTMLElement | null;
  const id = el?.dataset.app;
  if (!el || !id) return false;
  if (!e.deltaY || !groupOf(id)?.windows.length) return true;
  // One window per notch: a touchpad sends a stream of small steps.
  const now = performance.now();
  if (now - wheelAt < 180) return true;
  wheelAt = now;
  cancelHover();
  cycle(id, e.deltaY > 0 ? 1 : -1);
  return true;
}

// Files dragged onto an app (23 Nov 2026, as on the Windows taskbar): held
// there, its window comes in front, so they can be dropped into it; let go on
// the icon of a program, they open with it.
let dragApp = "";
let dragTimer = 0;
const DRAG_FRONT_MS = 700;

/** Opening files needs a program (`.exe`): store apps and the like only come in front. */
const opensFiles = (id: string) => /\.exe$/i.test(id);

/**
 * A drag over the bar at this point: the app under it (its id), or "" when
 * none. Its window comes in front after a moment, once per stop on it.
 */
export function appsDragOver(x: number, y: number): string {
  const el = document.elementFromPoint(x, y)?.closest?.(".app-ico") as HTMLElement | null;
  const id = el?.dataset.app ?? "";
  for (const a of document.querySelectorAll<HTMLElement>(".app-ico.drop-on")) if (a !== el) a.classList.remove("drop-on");
  if (id !== dragApp) {
    window.clearTimeout(dragTimer);
    dragTimer = 0;
    dragApp = id;
    if (id && groupOf(id)?.windows.length) {
      dragTimer = window.setTimeout(() => {
        dragTimer = 0;
        if (dragApp === id) void invoke("apps_do", { what: "drag-front", app: id }).catch(() => {});
      }, DRAG_FRONT_MS);
    }
  }
  if (id && opensFiles(id)) el?.classList.add("drop-on");
  return id;
}

/** The drag left the bar or ended. */
export function appsDragEnd() {
  window.clearTimeout(dragTimer);
  dragTimer = 0;
  dragApp = "";
  for (const a of document.querySelectorAll<HTMLElement>(".app-ico.drop-on")) a.classList.remove("drop-on");
}

/** Files let go on an app: opened with it. False: not a program, the bar's own drop. */
export function appsDropFiles(id: string, files: string[]): boolean {
  if (!id || !opensFiles(id) || !files.length) return false;
  void invoke("apps_do", { what: "open-files", app: id, files }).catch(() => {});
  return true;
}

/** Whether files let go on this app open with it (else they pin, as on the rest of the bar). */
export function appsTakesFiles(id: string): boolean {
  return !!id && opensFiles(id);
}

/** The right button on an app: its menu (barapps.rs). True: handled. */
export function appsMenu(e: MouseEvent): boolean {
  const el = (e.target as HTMLElement | null)?.closest?.(".app-ico") as HTMLElement | null;
  const id = el?.dataset.app;
  if (!el || !id) return false;
  cancelHover();
  const g = groupOf(id);
  void invoke("apps_menu", {
    id,
    name: g?.name ?? appName(id),
    windows: (g?.windows ?? []).map((w) => ({ hwnd: w.hwnd, title: w.title })),
  }).catch(() => {});
  return true;
}

// The mouse resting on an app with windows: their card with previews, as on
// the Windows taskbar; leaving it, the island closes the card unless the
// mouse went onto it.
let hoverTimer = 0;
let hovered = "";
const HOVER_MS = 550;

function cancelHover() {
  window.clearTimeout(hoverTimer);
  hoverTimer = 0;
}

document.addEventListener("mouseover", (e) => {
  const el = (e.target as HTMLElement | null)?.closest?.(".app-ico") as HTMLElement | null;
  const id = el?.dataset.app ?? "";
  if (id === hovered) return;
  if (hovered) send({ kind: "bar", key: "apps:leave" });
  hovered = id;
  cancelHover();
  if (!el || !id || !groupOf(id)?.windows.length) return;
  hoverTimer = window.setTimeout(() => {
    hoverTimer = 0;
    // The icon now, not the one under the mouse then: the bar is redrawn at
    // every change of the windows, and a detached icon is at x 0 (the card
    // went to the screen's left side the second time, Edoardo 22 Nov 2026).
    const now = [...document.querySelectorAll<HTMLElement>(".app-ico")].find((a) => a.dataset.app === id);
    if (hovered === id && now) send({ kind: "bar", key: `apps:show:${id}`, x: centre(now) });
  }, HOVER_MS);
});

document.addEventListener("mouseleave", () => {
  if (!hovered) return;
  hovered = "";
  cancelHover();
  send({ kind: "bar", key: "apps:leave" });
});
