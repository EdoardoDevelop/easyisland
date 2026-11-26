// Diagrams in the chat's answers (25 Nov 2026, Edoardo): a ```mermaid block,
// once closed, becomes a drawing. Mermaid is large: loaded at the first
// diagram only (dynamic import), never at start.
//
// The text comes from an engine: Mermaid runs in «strict», the settings an
// answer may carry (%%{init}%%, frontmatter) are dropped, and what it draws is
// shown as an <img> (a data: URL), so nothing in it can be markup, a script, a
// link or a request. A block that Mermaid cannot read stays code.
//
// The chat lays a streaming answer many times a second: drawings are kept by
// text and theme, so a node made again shows its picture at once.

import "./diagram.css";
import { t } from "./i18n";

interface Drawing { svg: string; url: string; w: number; h: number }
type Scheme = "dark" | "light";

const MAX_CODE = 20_000;
const KEPT = 60;
/** The chat's readable column (style.css .chat-log). */
const WIDE = 740;
const done = new Map<string, Drawing | Error>();
const making = new Map<string, Promise<Drawing>>();
let queue: Promise<unknown> = Promise.resolve();
let seq = 0;

const scheme = (): Scheme => (document.documentElement.dataset.scheme === "light" ? "light" : "dark");

const FONT = "'Segoe UI Variable Text', 'Segoe UI', sans-serif";
/** Slices, bars and lines: apart from one another on both grounds, white reads on them. */
const PALETTE = ["#3b7dbd", "#c27a12", "#2b8f6e", "#8463c9", "#b84a72", "#2f8ea3", "#6b7688", "#a4552f"];
/** A chart's colours: the slices of a pie, the bars and lines with their axes. */
function chartColours(ground: string, ink: string, dim: string): Record<string, unknown> {
  return {
    ...Object.fromEntries(PALETTE.map((c, i) => [`pie${i + 1}`, c])),
    pieTitleTextSize: "16px", pieTitleTextColor: ink, pieSectionTextColor: "#ffffff", pieSectionTextSize: "13px",
    pieLegendTextColor: dim, pieLegendTextSize: "13px", pieStrokeColor: ground, pieOuterStrokeColor: ground, pieOpacity: "1",
    xyChart: {
      backgroundColor: "transparent", titleColor: ink, plotColorPalette: PALETTE.join(","),
      xAxisLabelColor: dim, xAxisTitleColor: dim, xAxisTickColor: dim, xAxisLineColor: dim,
      yAxisLabelColor: dim, yAxisTitleColor: dim, yAxisTickColor: dim, yAxisLineColor: dim,
    },
  };
}
const VARS: Record<Scheme, Record<string, unknown>> = {
  dark: {
    darkMode: true, background: "#121418", fontFamily: FONT, fontSize: "14px",
    primaryColor: "#1d2a3a", primaryTextColor: "#e4e5e8", primaryBorderColor: "#4b7ba6",
    secondaryColor: "#2a2340", secondaryTextColor: "#e4e5e8", secondaryBorderColor: "#7a6bb5",
    tertiaryColor: "#171a20", tertiaryTextColor: "#c9cbd0", tertiaryBorderColor: "#3a3f49",
    lineColor: "#8f939b", textColor: "#c9cbd0", titleColor: "#e4e5e8",
    clusterBkg: "#171a20", clusterBorder: "#3a3f49", edgeLabelBackground: "#121418",
    noteBkgColor: "#33290f", noteTextColor: "#f2e6c4", noteBorderColor: "#a07a1e",
    sectionBkgColor: "#171a20", altSectionBkgColor: "#121418", sectionBkgColor2: "#171a20", gridColor: "#2c3038", todayLineColor: "#f5a524",
    taskBkgColor: "#1d2a3a", taskBorderColor: "#4b7ba6", taskTextColor: "#e4e5e8", taskTextOutsideColor: "#c9cbd0",
    ...chartColours("#121418", "#e4e5e8", "#c9cbd0"),
  },
  light: {
    darkMode: false, background: "#ffffff", fontFamily: FONT, fontSize: "14px",
    primaryColor: "#e6f1fb", primaryTextColor: "#1f2226", primaryBorderColor: "#5b93c4",
    secondaryColor: "#efeafb", secondaryTextColor: "#1f2226", secondaryBorderColor: "#8f7fc9",
    tertiaryColor: "#f5f6f8", tertiaryTextColor: "#464a52", tertiaryBorderColor: "#c9ced6",
    lineColor: "#5f646c", textColor: "#464a52", titleColor: "#1f2226",
    clusterBkg: "#f5f6f8", clusterBorder: "#c9ced6", edgeLabelBackground: "#ffffff",
    noteBkgColor: "#fdf3d7", noteTextColor: "#4a3a0c", noteBorderColor: "#d6ab45",
    sectionBkgColor: "#f1f3f6", altSectionBkgColor: "#ffffff", sectionBkgColor2: "#f1f3f6", gridColor: "#dfe3e8", todayLineColor: "#c97a0a",
    taskBkgColor: "#e6f1fb", taskBorderColor: "#5b93c4", taskTextColor: "#1f2226", taskTextOutsideColor: "#464a52",
    ...chartColours("#ffffff", "#1f2226", "#464a52"),
  },
};

/** Black or white, whichever reads better over `hex`. */
function inkOn(hex: string): string {
  const x = hex.length === 4 ? hex.replace(/^#(.)(.)(.)$/, "#$1$1$2$2$3$3") : hex;
  const n = parseInt(x.slice(1, 7), 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 140 ? "#1a1c20" : "#f4f5f7";
}

/** The engine's text without settings of its own; a colour given to a box gets a text colour that reads on it. */
export function cleanDiagram(code: string): string {
  return code
    .replace(/\r\n?/g, "\n")
    .replace(/^\s*---\n([\s\S]*?)\n---[ \t]*\n/, (_, head: string) => {
      const title = /^title:\s*(.+)$/m.exec(head)?.[1];
      return title ? `---\ntitle: ${title}\n---\n` : "";
    })
    .replace(/%%\{[\s\S]*?\}%%[ \t]*\n?/g, "")
    .replace(/^([ \t]*(?:style|classDef)[ \t].*)$/gm, (line) => {
      const fill = /fill:\s*(#[0-9a-f]{6}|#[0-9a-f]{3})\b/i.exec(line)?.[1];
      return fill && !/[,\s]color:/i.test(line) ? `${line.replace(/;?\s*$/, "")},color:${inkOn(fill)}` : line;
    })
    .trim();
}

/** The engines' usual slip in a flowchart: brackets in a label without quotes. */
export function quoteLabels(code: string): string {
  if (!/^\s*(?:---[\s\S]*?---\s*)?(?:graph|flowchart)\b/.test(code)) return code;
  const q = (s: string) => s.replace(/"/g, "#quot;").trim();
  // The shapes written with a second bracket ([(db)], [/x/], ([x]), {{x}}) stay as they are.
  return code
    .replace(/\[(?![(/\\["])([^[\]\n]*[(){}"][^[\]\n]*)\]/g, (_, s: string) => `["${q(s)}"]`)
    .replace(/\{(?![{"])([^{}\n]*[()[\]"][^{}\n]*)\}/g, (_, s: string) => `{"${q(s)}"}`)
    .replace(/\|(?!")([^|\n]*[(){}[\]"][^|\n]*)\|/g, (_, s: string) => `|"${q(s)}"|`);
}

/** A flowchart from left to right, from top to bottom instead; null for anything else. */
function upright(code: string): string | null {
  const tall = code.replace(/^((?:---[\s\S]*?---\s*)?\s*(?:graph|flowchart)[ \t]+)(?:LR|RL)\b/, "$1TD");
  return tall === code ? null : tall;
}

/** Mermaid's SVG as a picture of its own: its size written in, nothing that reaches outside. */
function picture(svg: string, look: Scheme): Drawing {
  let root = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement as Element;
  if (root.nodeName !== "svg" || root.querySelector("parsererror")) {
    // Not well-formed XML (a <br> in a label): read as a page reads it.
    const found = new DOMParser().parseFromString(svg, "text/html").querySelector("svg");
    if (!found) throw new Error("svg");
    root = found;
  }
  root.querySelectorAll("script").forEach((n) => n.remove());
  // The ends of the lines are white inside whatever the theme.
  root.querySelectorAll('marker [fill="white"]').forEach((n) => n.setAttribute("fill", String(VARS[look].background)));
  // A plan over a few days has two marks a day: the same date once.
  let date = "";
  root.querySelectorAll(".grid .tick text").forEach((n) => {
    if (n.textContent === date) n.textContent = "";
    else date = n.textContent ?? "";
  });
  const box = (root.getAttribute("viewBox") ?? "").split(/[\s,]+/).map(Number);
  const w = Math.ceil(box[2] || 0);
  const h = Math.ceil(box[3] || 0);
  if (!(w > 0 && h > 0)) throw new Error("svg");
  root.setAttribute("width", String(w));
  root.setAttribute("height", String(h));
  root.removeAttribute("style");
  const text = new XMLSerializer().serializeToString(root);
  return { svg: text, url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`, w, h };
}

async function draw(code: string, look: Scheme): Promise<Drawing> {
  const { default: mermaid } = await import("mermaid");
  // Off the page, but laid out: Mermaid measures the words.
  const stage = document.createElement("div");
  stage.className = "md-diagram-stage";
  document.body.append(stage);
  try {
    mermaid.initialize({
      startOnLoad: false, securityLevel: "strict", suppressErrorRendering: true, logLevel: "fatal",
      look: "classic", theme: "base", themeVariables: VARS[look], fontFamily: FONT, htmlLabels: false, maxTextSize: MAX_CODE,
      themeCSS: `.node rect, .cluster rect, rect.actor, rect.note { rx: 6px; ry: 6px; } .grid .tick line { stroke: ${VARS[look].gridColor}; opacity: 1; }`,
      flowchart: { nodeSpacing: 36, rankSpacing: 40, padding: 12 }, gantt: { useWidth: WIDE, fontSize: 12, sectionFontSize: 12, axisFormat: "%d/%m" },
      xyChart: { width: 640, height: 360, titleFontSize: 16 },
      secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "suppressErrorRendering", "maxEdges", "theme", "themeCSS", "themeVariables", "htmlLabels", "fontFamily"],
    });
    const once = async (text: string) => picture((await mermaid.render(`md-diagram-${++seq}`, text, stage)).svg, look);
    let text = code;
    let first: Drawing;
    try {
      first = await once(text);
    } catch (e) {
      text = quoteLabels(code);
      if (text === code) throw e;
      first = await once(text);
    }
    // Wider than the chat's column: the same steps downwards, if that is narrower.
    const tall = first.w > WIDE ? upright(text) : null;
    const second = tall ? await once(tall).catch(() => null) : null;
    return second && second.w < first.w ? second : first;
  } finally {
    stage.remove();
  }
}

/** The drawing of `code`, made once: one at a time, Mermaid's settings are one for all. */
function drawing(code: string, look: Scheme): Promise<Drawing> {
  const key = `${look}\n${code}`;
  const had = done.get(key);
  if (had) return had instanceof Error ? Promise.reject(had) : Promise.resolve(had);
  const busy = making.get(key);
  if (busy) return busy;
  const keep = (x: Drawing | Error) => {
    making.delete(key);
    done.set(key, x);
    if (done.size > KEPT) done.delete(done.keys().next().value as string);
  };
  const p = queue.then(() => draw(code, look));
  queue = p.catch(() => {});
  making.set(key, p);
  p.then(keep, (e) => keep(e instanceof Error ? e : new Error(String(e))));
  return p;
}

function btn(cls: string, text: string, title: string, go: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = cls;
  b.textContent = text;
  b.title = title;
  b.addEventListener("click", go);
  return b;
}

/** A moment's word on a button. */
function said(b: HTMLElement, text: string, back: string) {
  b.textContent = text;
  window.setTimeout(() => (b.textContent = back), 1600);
}

/** The drawing as a PNG on white, twice its size (for Word, an email, a ticket). */
async function png(code: string): Promise<Blob> {
  const d = await drawing(code, "light");
  const img = new Image();
  img.src = d.url;
  await img.decode();
  const k = Math.min(2, 8000 / Math.max(d.w, d.h));
  const pad = 16;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round((d.w + pad * 2) * k);
  canvas.height = Math.round((d.h + pad * 2) * k);
  const g = canvas.getContext("2d");
  if (!g) throw new Error("canvas");
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.drawImage(img, pad * k, pad * k, d.w * k, d.h * k);
  return new Promise((ok, no) => canvas.toBlob((b) => (b ? ok(b) : no(new Error("png"))), "image/png"));
}

/** Large, over the island or the window it is in: wheel to zoom, drag to move, Esc or a click outside closes. */
function enlarge(from: HTMLElement, d: Drawing) {
  const doc = from.ownerDocument;
  const win = doc.defaultView ?? window;
  const home = from.closest<HTMLElement>("#island-clip") ?? doc.body;
  const layer = doc.createElement("div");
  layer.className = "md-diagram-big";
  layer.tabIndex = -1;
  layer.dataset.noPress = "";
  const img = doc.createElement("img");
  img.src = d.url;
  img.alt = t("Diagramma");
  img.draggable = false;
  img.style.width = `${d.w}px`;
  img.style.height = `${d.h}px`;
  let k = 1;
  let x = 0;
  let y = 0;
  const put = () => {
    img.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
  };
  const fit = () => {
    const w = layer.clientWidth;
    const hh = layer.clientHeight;
    k = Math.min((w - 48) / d.w, (hh - 96) / d.h, 2);
    if (!(k > 0)) k = 1;
    x = (w - d.w * k) / 2;
    y = (hh - d.h * k) / 2 + 16;
    put();
  };
  const zoom = (f: number, px: number, py: number) => {
    const n = Math.min(6, Math.max(0.1, k * f));
    x = px - ((px - x) * n) / k;
    y = py - ((py - y) * n) / k;
    k = n;
    put();
  };
  const middle = (f: number) => zoom(f, layer.clientWidth / 2, layer.clientHeight / 2);
  const was = doc.activeElement as HTMLElement | null;
  const close = () => {
    win.removeEventListener("keydown", key, true);
    layer.remove();
    was?.focus?.();
  };
  const key = (e: KeyboardEvent) => {
    // The island went away under it.
    if (!layer.isConnected) {
      win.removeEventListener("keydown", key, true);
      return;
    }
    if (e.key === "Escape") close();
    else if (e.key === "+" || e.key === "=") middle(1.25);
    else if (e.key === "-") middle(0.8);
    else if (e.key === "0") fit();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };
  win.addEventListener("keydown", key, true);
  layer.addEventListener("wheel", (e) => {
    e.preventDefault();
    const r = layer.getBoundingClientRect();
    zoom(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  let grip: { x: number; y: number; moved: boolean; on: boolean } | null = null;
  layer.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || (e.target as Element).closest(".md-diagram-bar")) return;
    grip = { x: e.clientX, y: e.clientY, moved: false, on: e.target === img };
    layer.setPointerCapture(e.pointerId);
  });
  layer.addEventListener("pointermove", (e) => {
    if (!grip) return;
    const dx = e.clientX - grip.x;
    const dy = e.clientY - grip.y;
    if (!grip.moved && Math.abs(dx) + Math.abs(dy) <= 3) return;
    grip.moved = true;
    x += dx;
    y += dy;
    grip.x = e.clientX;
    grip.y = e.clientY;
    put();
  });
  layer.addEventListener("pointerup", () => {
    const g = grip;
    grip = null;
    if (g && !g.moved && !g.on) close();
  });
  layer.addEventListener("pointercancel", () => (grip = null));
  const bar = doc.createElement("div");
  bar.className = "md-diagram-bar";
  bar.append(
    btn("", "−", t("Più piccolo"), () => middle(0.8)),
    btn("", "+", t("Più grande"), () => middle(1.25)),
    btn("", t("Adatta"), t("Tutto il diagramma"), fit),
    btn("", "✕", t("Chiudi (Esc)"), close),
  );
  layer.append(img, bar);
  home.append(layer);
  fit();
  layer.focus();
}

/** The diagrams made, drawn again when the island goes light or dark. */
const shown = new Set<WeakRef<HTMLElement>>();
const repaint = new WeakMap<HTMLElement, () => void>();
let watching = false;
function watchScheme() {
  if (watching) return;
  watching = true;
  let last = scheme();
  new MutationObserver(() => {
    if (scheme() === last) return;
    last = scheme();
    for (const ref of shown) {
      const n = ref.deref();
      if (n) repaint.get(n)?.();
      else shown.delete(ref);
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-scheme"] });
}

/** True for the language of a block drawn as a diagram. */
export const isDiagram = (lang: string): boolean => /^(mermaid|mmd)$/i.test(lang);

/**
 * A closed ```mermaid block: `plain` (its code) until the drawing is ready,
 * and again with «Codice» or when it cannot be drawn. Says «md-grew» when its
 * height changes by itself (the chat stays at the bottom).
 */
export function diagramBlock(raw: string, plain: HTMLElement, save?: (text: string, lang: string) => void): HTMLElement {
  const code = cleanDiagram(raw);
  const box = document.createElement("div");
  box.className = "md-diagram";
  box.append(plain);
  if (!code || code.length > MAX_CODE) return box;

  let d: Drawing | null = null;
  const big = () => {
    if (d) enlarge(box, d);
  };
  const card = document.createElement("div");
  card.className = "md-pre md-diagram-card";
  const head = document.createElement("div");
  head.className = "md-pre-head";
  const label = document.createElement("span");
  label.className = "md-lang";
  label.textContent = t("Diagramma");
  const copyText = t("Copia");
  const copy = btn("md-copy", copyText, t("Copia il diagramma come immagine, su fondo bianco"), () => {
    const view = (box.ownerDocument.defaultView ?? window) as Window & typeof globalThis;
    view.navigator.clipboard.write([new view.ClipboardItem({ "image/png": png(code) })])
      .then(() => said(copy, t("Copiato ✓"), copyText), () => said(copy, t("Non riuscito"), copyText));
  });
  const img = document.createElement("img");
  img.className = "md-diagram-img";
  img.alt = t("Diagramma");
  img.title = t("Clic per ingrandire");
  img.draggable = false;
  img.addEventListener("click", big);
  const body = document.createElement("div");
  body.className = "md-diagram-body";
  body.append(img);
  head.append(label, btn("md-copy", "⤢", t("Ingrandisci"), big));
  if (save) {
    head.append(btn("md-copy", t("Salva"), t("Salva il diagramma in un file SVG"), () => {
      void drawing(code, "light").then((x) => save(x.svg, "svg"), () => {});
    }));
  }
  head.append(copy, btn("md-copy", t("Codice"), t("Mostra il codice del diagramma"), () => box.replaceChildren(plain)));
  card.append(head, body);

  // From the code back to the drawing.
  let back: HTMLButtonElement | null = null;
  const show = (x: Drawing) => {
    d = x;
    img.src = x.url;
    // A tall one smaller, a wide one to the chat's width, but never so small that
    // the words cannot be read: past that it scrolls sideways.
    img.style.width = `${Math.round(x.w * Math.max(0.7, Math.min(1, 560 / x.h)))}px`;
    img.style.minWidth = `${Math.round(x.w * 0.7)}px`;
    img.style.aspectRatio = `${x.w} / ${x.h}`;
    if (back) return;
    back = btn("md-copy", t("Diagramma"), t("Mostra il diagramma"), () => box.replaceChildren(card));
    plain.querySelector(".md-lang")?.after(back);
  };
  const paint = (first: boolean) => {
    const hit = done.get(`${scheme()}\n${code}`);
    if (hit && !(hit instanceof Error)) {
      show(hit);
      if (first) box.replaceChildren(card);
      return;
    }
    drawing(code, scheme()).then(
      (x) => {
        show(x);
        if (!first) return;
        box.replaceChildren(card);
        box.dispatchEvent(new CustomEvent("md-grew", { bubbles: true }));
      },
      () => {
        const lang = plain.querySelector(".md-lang");
        if (first && lang) lang.textContent = t("mermaid · il diagramma non si può disegnare");
      },
    );
  };
  watchScheme();
  shown.add(new WeakRef(box));
  repaint.set(box, () => paint(false));
  paint(true);
  return box;
}
