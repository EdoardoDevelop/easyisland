// The look of the island and the settings window:
// - "monolith": Obsidian Monolith (Linear / Raycast precision grade)
// - "titanium": Anodized Hardware (recessed panels, tactile keycaps, tabular telemetry)
// - "editorial": Deep Glass Spotlight (executive studio layout)
// - "windows": Windows 11 (the default)
// - "classic": the original black island
// The page carries it as <html data-ui="…">.

import { Bridge } from "./bridge";

export type UiStyle = "windows" | "classic" | "monolith" | "titanium" | "editorial";

const STUDIO_STYLES: ReadonlySet<UiStyle> = new Set<UiStyle>(["monolith", "titanium", "editorial"]);

export function uiStyle(style: string | undefined): UiStyle {
  if (style === "classic" || style === "monolith" || style === "titanium" || style === "editorial") {
    return style;
  }
  return "windows";
}

/** True while the page shows a modern line-icon look (Windows 11 or one of the Studio themes). */
export function windowsLook(): boolean {
  return document.documentElement.dataset.ui !== "classic";
}

/** True while one of the three Studio themes (Obsidian, Titanium, Spotlight) is active. */
export function studioLook(style?: string): boolean {
  const current = (style ? uiStyle(style) : (document.documentElement.dataset.ui as UiStyle | undefined)) ?? "windows";
  return STUDIO_STYLES.has(current);
}

const DARK_ISLAND: Record<UiStyle, string> = {
  windows: "#1c1c1c",
  classic: "#000000",
  monolith: "#0b0c0e",
  titanium: "#111215",
  editorial: "#0d0f14",
};

const LIGHT_ISLAND: Record<UiStyle, string> = {
  windows: "#f3f3f3",
  classic: "#fbfbfc",
  monolith: "#f7f7f8",
  titanium: "#ededf0",
  editorial: "#f4f6f9",
};

/**
 * The island's colour as "#rrggbb": the user's, or for the untouched black the
 * default surface of the chosen style in dark or light mode.
 */
export function islandHex(islandColor: string | undefined, style: string | undefined): string {
  const hex = islandColor && /^#[0-9a-f]{6}$/i.test(islandColor) ? islandColor : "#000000";
  if (hex !== "#000000") return hex;
  const ui = uiStyle(style);
  return scheme() === "light" ? LIGHT_ISLAND[ui] : DARK_ISLAND[ui];
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
