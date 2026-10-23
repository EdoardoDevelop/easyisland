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

let accentRead = 0;

/** Puts the style on the page; with "windows" also Windows' accent colour, read at most once a minute. */
export function applyUiStyle(style: string | undefined): void {
  const ui = uiStyle(style);
  document.documentElement.dataset.ui = ui;
  if (ui !== "windows" || Date.now() - accentRead < 60_000) return;
  accentRead = Date.now();
  void Bridge.systemAccent().then((c) => {
    if (c && /^#[0-9a-f]{6}$/i.test(c)) document.documentElement.style.setProperty("--win-accent", c);
  });
}
