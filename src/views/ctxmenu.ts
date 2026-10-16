// The island's own right-click menu: WebView2's (Indietro, Ricarica, Ispeziona…)
// never shows. What it holds depends on what is under the mouse; see
// `contextItems` in island/island.ts. Drawn inside the island and kept
// inside it, closed by a click elsewhere, Esc, or the island closing.

import { h } from "./dom";

export interface MenuItem {
  label: string;
  run: () => void;
  /** A line above this entry. */
  sep?: boolean;
  danger?: boolean;
  disabled?: boolean;
}

let open: HTMLElement | null = null;
let unbind: (() => void) | null = null;

export function closeMenu() {
  open?.remove();
  open = null;
  unbind?.();
  unbind = null;
}

export function isMenuOpen(): boolean {
  return open !== null;
}

/** Shows `items` at (x, y) in `host` (page coordinates). */
export function showMenu(host: HTMLElement, x: number, y: number, title: string, items: MenuItem[]) {
  closeMenu();
  if (!items.length) return;
  const menu = h("div", { class: "ctx-menu", role: "menu" });
  if (title) menu.append(h("div", { class: "ctx-title", text: title }));
  for (const it of items) {
    if (it.sep) menu.append(h("div", { class: "ctx-sep" }));
    const b = h("button", {
      class: `ctx-item${it.danger ? " danger" : ""}`, role: "menuitem", text: it.label,
      ...(it.disabled ? { disabled: "true" } : {}),
    });
    // Not a press on the island: no drag, no opening, no closing.
    b.addEventListener("pointerdown", (e) => e.stopPropagation());
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      closeMenu();
      it.run();
    });
    menu.append(b);
  }
  menu.addEventListener("contextmenu", (e) => e.preventDefault());
  host.append(menu);
  // Inside the island, not just the window: around it the window lets clicks
  // through to the desktop. Flipped left or up at the edge, then clamped.
  const base = host.getBoundingClientRect();
  // A menu taller than the island scrolls inside it.
  menu.style.maxHeight = `${Math.max(120, base.height - 12)}px`;
  const r = menu.getBoundingClientRect();
  const fit = (at: number, size: number, start: number, end: number) => {
    const p = at + size > end - 6 ? at - size : at;
    return Math.min(Math.max(start + 6, p), Math.max(start + 6, end - size - 6));
  };
  menu.style.left = `${fit(x, r.width, base.left, base.right) - base.left}px`;
  menu.style.top = `${fit(y, r.height, base.top, base.bottom) - base.top}px`;
  open = menu;

  const away = (e: PointerEvent) => {
    if (!menu.contains(e.target as Node)) closeMenu();
  };
  const key = (e: KeyboardEvent) => {
    if (e.key === "Escape") closeMenu();
  };
  // Registered after this event is over, so the click that opened it does not close it.
  const timer = window.setTimeout(() => {
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("blur", closeMenu);
  }, 0);
  unbind = () => {
    window.clearTimeout(timer);
    document.removeEventListener("pointerdown", away, true);
    document.removeEventListener("keydown", key, true);
    window.removeEventListener("blur", closeMenu);
  };
}
