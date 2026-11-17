// The search on its own (its shortcut) in a window of its own, never the
// island's: the island stays open on its view, or closed (Edoardo, 17 Nov
// 2026). As for the popped-out views (popout.ts) the window is a blank page
// this page draws a second search into (buildSearch with `only`): results,
// state and actions stay here. Made the first time, then shown and hidden
// (search_window.rs); hidden it draws nothing.

import { buildSearch, type SearchActions, type SearchHost } from "../views/search";
import { Bridge, IS_TAURI } from "../core/bridge";
import { dress, forward, mirror } from "./popout";

/** The bar alone (logical px): the window's height with no results. */
const BAR_H = 54;

const CSS = `
html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: transparent !important; }
#island.searchwin { position: fixed; inset: 0; width: auto !important; height: auto !important; transform: none !important; border-radius: 16px !important; overflow: hidden; display: flex; flex-direction: column; }
#island.searchwin #content { opacity: 1; pointer-events: auto; position: absolute; inset: 0; display: flex; flex-direction: column; }
`;

let search: SearchHost | null = null;
let win: Window | null = null;
let shown = false;
/** The window had the keyboard since it was shown: only then does losing it close the search. */
let focused = false;
let watch = 0;

function alive(): boolean {
  try {
    return !!win && !win.closed && !!win.document;
  } catch {
    return false;
  }
}

/** How tall the window wants to be now. */
function height(): number {
  return BAR_H + (search?.resultsHeight() ?? 0);
}

/** The search in the window's page (again, after WebView2 swapped the blank page). */
function lay() {
  if (!search || !alive() || !win) return;
  const doc = win.document;
  if (!doc.body || doc.getElementById("island")?.contains(search.el)) return;
  dress(doc, "EasyIsland");
  const style = doc.createElement("style");
  style.textContent = CSS;
  doc.head.append(style);
  const field = doc.createElement("div");
  field.className = "header-field";
  field.append(search.el);
  const header = doc.createElement("div");
  header.id = "header";
  header.append(field);
  const content = doc.createElement("div");
  content.id = "content";
  content.append(header);
  const island = doc.createElement("div");
  island.id = "island";
  island.className = "open search-only searchwin";
  island.append(content);
  doc.body.replaceChildren(island);
  search.el.style.display = "";
  doc.addEventListener("pointerdown", (e) => forward(e));
  // Another window took the keys (a click elsewhere): the search goes, as Esc does.
  win.addEventListener("blur", () => {
    window.setTimeout(() => {
      if (shown && focused && alive() && !win!.document.hasFocus()) hide();
    }, 150);
  });
  win.addEventListener("focus", () => {
    focused = true;
    search?.focusInputOnly();
  });
  win.addEventListener("pagehide", () => {
    // The page goes and takes the handlers of what is in it: the search waits here, laid again in the next one.
    if (search) holder().append(search.el);
    for (const ms of [0, 100, 400, 1200]) window.setTimeout(lay, ms);
  });
}

let safeBox: HTMLElement | null = null;
function holder(): HTMLElement {
  if (!safeBox) {
    safeBox = document.createElement("div");
    safeBox.style.display = "none";
    document.body.append(safeBox);
  }
  return safeBox;
}

/** The search's window goes (Esc, a click elsewhere, a result chosen). */
export function hide() {
  if (!shown) return;
  shown = false;
  window.clearInterval(watch);
  watch = 0;
  search?.close();
  void Bridge.searchWindowHide();
}

export function searchWindowShown(): boolean {
  return shown;
}

/**
 * Opens the search on its own in its window, or hides it if it is there
 * (the shortcut again). `base`: the island's search actions (open a view,
 * ask the chat…), each one closing the window first. False: no window
 * (window.open refused): the island does it as before (search-only mode).
 */
export async function toggleSearchWindow(base: SearchActions): Promise<boolean> {
  if (shown) {
    hide();
    return true;
  }
  // The browser preview (npm run dev) has no such window: the island's search-only mode.
  if (!IS_TAURI) return false;
  if (!search) {
    const leave = <A extends unknown[]>(f: (...a: A) => void) => (...a: A) => {
      hide();
      f(...a);
    };
    search = buildSearch({
      ...base,
      openTask: leave(base.openTask),
      runAction: leave(base.runAction),
      openProgram: leave(base.openProgram),
      ask: leave(base.ask),
      askDay: leave(base.askDay),
      showDone: leave(base.showDone),
      reopenChat: leave(base.reopenChat),
      memoryChat: leave(base.memoryChat),
      remember: leave(base.remember),
      only: true,
      onLayout: () => {
        if (shown) void Bridge.searchWindowFit(height());
      },
      onDone: () => hide(),
      onEscape: () => hide(),
      canAutoFocus: () => shown,
      takeFocus: () => void Bridge.searchWindowShow(height()),
    });
  }
  if (!alive()) {
    await Bridge.popoutKind("ricerca");
    win = window.open("", "easyisland-ricerca", `popup,width=640,height=${BAR_H}`);
    if (!win) {
      void Bridge.log("ricerca: window.open rifiutata, resta la ricerca nell'isola").catch(() => {});
      return false;
    }
    // Its name, so popout_take does not hand it to the next popped-out view.
    void Bridge.popoutTake();
    // Its blank page may not be ready yet.
    for (const ms of [50, 150, 400]) window.setTimeout(lay, ms);
  }
  lay();
  if (win) mirror(win.document, "");
  const ok = await Bridge.searchWindowShow(height()).catch(() => false);
  if (!ok) return false;
  shown = true;
  focused = false;
  search.focus();
  // Every second while shown: the page WebView2 may swap, the island's theme.
  window.clearInterval(watch);
  watch = window.setInterval(() => {
    if (!alive()) {
      hide();
      win = null;
      return;
    }
    lay();
    mirror(win!.document, "");
  }, 1000);
  return true;
}
