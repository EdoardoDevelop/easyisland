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
  host.replaceChildren();
  for (const g of groups()) {
    const el = document.createElement("span");
    const n = g.windows.length;
    el.className = [
      "app-ico",
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
}

function centre(el: HTMLElement): number {
  const r = el.getBoundingClientRect();
  return Math.round(r.left + r.width / 2);
}

/**
 * A press on an app (true: handled). Left: one window → front or minimized,
 * none → opened, several → their card in the island. Middle: a new window.
 */
export function appsPress(e: PointerEvent | MouseEvent): boolean {
  const el = (e.target as HTMLElement | null)?.closest?.(".app-ico") as HTMLElement | null;
  const id = el?.dataset.app;
  if (!el || !id) return false;
  cancelHover();
  const g = groupOf(id);
  if (e.button === 1) {
    void invoke("apps_do", { what: "launch-new", app: id }).catch(() => {});
  } else if (e.button === 0) {
    if (g && g.windows.length > 1) send({ kind: "bar", key: `apps:list:${id}`, x: centre(el) });
    else void invoke("apps_do", { what: "click", app: id }).catch(() => {});
  }
  return true;
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
