// The look of the island and the settings window: "windows" (Windows 11, the
// default) or "classic" (the original black island). The page carries it as
// <html data-ui="…">; the Windows 11 rules live in src/style-windows.css and
// src/settings/settings-windows.css, every one scoped to html[data-ui="windows"].

import { Bridge } from "./bridge";

export type UiStyle = "windows" | "classic";

export function uiStyle(style: string | undefined): UiStyle {
  return style === "classic" ? "classic" : "windows";
}

/** True while the page shows the Windows 11 look (read by the icon helpers). */
export function windowsLook(): boolean {
  return document.documentElement.dataset.ui !== "classic";
}

const WINDOWS_ISLAND = "#1c1c1c";
const WINDOWS_ISLAND_LIGHT = "#f3f3f3";
const CLASSIC_ISLAND_LIGHT = "#fbfbfc";

/**
 * The island's colour as "#rrggbb": the user's, or for the untouched black the
 * grey of Windows' dark surfaces, or the light ones in light mode.
 */
export function islandHex(islandColor: string | undefined, style: string | undefined): string {
  const hex = islandColor && /^#[0-9a-f]{6}$/i.test(islandColor) ? islandColor : "#000000";
  if (hex !== "#000000") return hex;
  if (scheme() === "light") return uiStyle(style) === "windows" ? WINDOWS_ISLAND_LIGHT : CLASSIC_ISLAND_LIGHT;
  return uiStyle(style) === "windows" ? WINDOWS_ISLAND : hex;
}

let accentRead = 0;

export type Scheme = "dark" | "light";

const systemQuery = window.matchMedia("(prefers-color-scheme: light)");
/** Windows' app mode, from the registry (system_light); the media query until it answers. */
let systemLight = systemQuery.matches;
let schemeSetting = "dark";
let lastApplied = "";
/** Called again when the scheme changes (the island repaints its own background). */
let onScheme: (() => void) | null = null;

/** Light or dark right now: "auto" follows Windows' app mode (WebView2 reports it as prefers-color-scheme). */
export function scheme(): Scheme {
  if (schemeSetting === "light") return "light";
  if (schemeSetting === "auto") return systemLight ? "light" : "dark";
  return "dark";
}

function applyScheme() {
  const now = scheme();
  document.documentElement.dataset.scheme = now;
  if (now !== lastApplied) {
    lastApplied = now;
    void Bridge.setWindowLight(now === "light").catch(() => {});
  }
  onScheme?.();
}

/** Asks Windows again (auto only): when the page comes back in view, and on the media query's change. */
function recheck() {
  if (schemeSetting !== "auto") return;
  void Bridge.systemLight().then((light) => {
    if (typeof light !== "boolean" || light === systemLight) return;
    systemLight = light;
    applyScheme();
  }).catch(() => {});
}
systemQuery.addEventListener("change", () => {
  systemLight = systemQuery.matches;
  if (schemeSetting === "auto") applyScheme();
  recheck();
});
document.addEventListener("visibilitychange", () => { if (!document.hidden) recheck(); });
window.addEventListener("focus", recheck);

/**
 * Puts the style and the light/dark scheme on the page (<html data-ui data-scheme>;
 * the light rules are made at build time by scripts/light-css.mjs); with
 * "windows" also Windows' accent colour, read at most once a minute.
 */
export function applyUiStyle(style: string | undefined, schemeName?: string, changed?: () => void): void {
  const ui = uiStyle(style);
  document.documentElement.dataset.ui = ui;
  schemeSetting = schemeName === "light" || schemeName === "auto" ? schemeName : "dark";
  if (changed) onScheme = changed;
  applyScheme();
  recheck();
  if (ui !== "windows" || Date.now() - accentRead < 60_000) return;
  accentRead = Date.now();
  void Bridge.systemAccent().then((c) => {
    if (c && /^#[0-9a-f]{6}$/i.test(c)) document.documentElement.style.setProperty("--win-accent", c);
  });
}
