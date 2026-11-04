// Impostazioni → Aspetto → Font: the titles' font and the text's font, each
// with family, size and weight (Theme.fonts). Applied as variables on <html>:
// --font (the text, used by every rule), --fs-up (its size), --font-title,
// --font-title-weight, --font-title-zoom and --font-text-weight, read by the
// rules in src/style.css and src/settings/settings.css (html[data-font-title]…).
// The popped windows copy <html>'s attributes and the <style> below (popout.ts).
//
// Four dot-matrix / retro fonts ship with the app (OFL, public/fonts/, licences
// beside them); any other family installed in Windows can be picked too.

export interface FontPick {
  /** "" = the system's. */
  family: string;
  /** Percent of the usual size, 80–150. */
  size: number;
  /** 100–900; 0 = as each place draws it. */
  weight: number;
}

export interface ThemeFonts {
  title: FontPick;
  text: FontPick;
}

export const DEFAULT_FONT: FontPick = { family: "", size: 100, weight: 0 };
export const DEFAULT_FONTS: ThemeFonts = { title: { ...DEFAULT_FONT }, text: { ...DEFAULT_FONT } };

/** The fonts inside the app: family → file in public/fonts/ (variable weight where the font has it). */
export const BUNDLED_FONTS: { family: string; file: string; weights: string; look: string }[] = [
  { family: "Doto", file: "Doto.woff2", weights: "100 900", look: "dots" },
  { family: "DotGothic16", file: "DotGothic16.woff2", weights: "400", look: "dots" },
  { family: "VT323", file: "VT323.woff2", weights: "400", look: "retro" },
  { family: "Space Mono", file: "SpaceMono-Regular.woff2", weights: "400", look: "mono" },
  { family: "Space Mono", file: "SpaceMono-Bold.woff2", weights: "700", look: "mono" },
];

/** What follows the chosen family: the system's fonts and the emoji. */
const FALLBACK = `system-ui, "Segoe UI Variable Text", "Segoe UI", "Segoe UI Emoji", sans-serif`;

export function fontStack(family: string): string {
  const clean = family.replace(/["\\;{}<>]/g, "").trim();
  return clean ? `"${clean}", ${FALLBACK}` : FALLBACK;
}

function pick(p: Partial<FontPick> | undefined): FontPick {
  const size = Number(p?.size);
  const weight = Number(p?.weight);
  return {
    family: typeof p?.family === "string" ? p.family : "",
    size: Number.isFinite(size) && size >= 50 && size <= 200 ? size : 100,
    weight: Number.isFinite(weight) && weight >= 100 && weight <= 900 ? Math.round(weight / 100) * 100 : 0,
  };
}

export function themeFonts(f: Partial<ThemeFonts> | undefined): ThemeFonts {
  return { title: pick(f?.title), text: pick(f?.text) };
}

/** The fixed bar's font (the character's window): the titles' one, else the text's; null = its own. */
export function barFont(raw: Partial<ThemeFonts> | undefined): { stack: string; weight: number } | null {
  const f = themeFonts(raw);
  const p = f.title.family ? f.title : f.text.family ? f.text : null;
  return p ? { stack: fontStack(p.family), weight: p.weight } : null;
}

/** The bundled fonts in another page (the character's window draws the fixed bar). */
export function addFaces(doc: Document = document): void {
  if (doc.getElementById("ei-fonts")) return;
  const style = doc.createElement("style");
  style.id = "ei-fonts";
  style.textContent = faces();
  doc.head.append(style);
}

/** The @font-face of the bundled fonts, with full addresses (a popped about:blank window has no base of its own). */
function faces(): string {
  return BUNDLED_FONTS.map((f) => {
    const url = new URL(`fonts/${f.file}`, location.href.replace(/[^/]*$/, "")).href;
    return `@font-face{font-family:"${f.family}";src:url("${url}") format("woff2");font-weight:${f.weights};font-display:swap}`;
  }).join("\n");
}

let lastKey = "";

/** Puts the two fonts on the page (every window that shows the interface calls it with the theme). */
export function applyFonts(raw: Partial<ThemeFonts> | undefined, doc: Document = document): void {
  const f = themeFonts(raw);
  const key = JSON.stringify(f);
  const root = doc.documentElement;
  if (doc === document && key === lastKey && doc.getElementById("ei-fonts")) return;
  if (doc === document) lastKey = key;
  if (!doc.getElementById("ei-fonts")) {
    const style = doc.createElement("style");
    style.id = "ei-fonts";
    style.textContent = faces();
    doc.head.append(style);
  }
  const set = (name: string, value: string | null) => {
    if (value == null) root.style.removeProperty(name);
    else root.style.setProperty(name, value);
  };
  // The text: every rule reads --font; --fs-up moves its sizes (about 12 px of base).
  set("--font", f.text.family ? fontStack(f.text.family) : null);
  set("--fs-up", f.text.size !== 100 ? `${Math.round(((f.text.size - 100) / 100) * 12 * 2) / 2}px` : null);
  set("--font-text-weight", f.text.weight ? String(f.text.weight) : null);
  // The titles: their own rules only when something is chosen.
  set("--font-title", f.title.family ? fontStack(f.title.family) : null);
  set("--font-title-weight", f.title.weight ? String(f.title.weight) : null);
  set("--font-title-zoom", f.title.size !== 100 ? String(f.title.size / 100) : null);
  const flag = (name: string, on: boolean) => {
    if (on) root.setAttribute(name, "");
    else root.removeAttribute(name);
  };
  flag("data-font-title", !!f.title.family);
  flag("data-font-title-weight", !!f.title.weight);
  flag("data-font-title-size", f.title.size !== 100);
  flag("data-font-text-weight", !!f.text.weight);
}
