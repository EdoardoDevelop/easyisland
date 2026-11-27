// Charts in the chat's answers (27 Nov 2026, Edoardo: «aggiungi Chart.js anche
// alla chat»): a ```chart block (or ```grafico) holds data only, JSON, never
// code: { type, title, labels, series: [{ name, values, type }], stacked,
// horizontal, unit }. Once closed it becomes a live Chart.js chart (values on
// hover, series hidden from the legend); Mermaid stays for schemes. Chart.js is
// loaded at the first chart. A block that cannot be read stays code.

import { t } from "./i18n";
import { PALETTE, btn, said } from "./diagram";

type Kind = "bar" | "line" | "area" | "pie" | "doughnut" | "radar" | "scatter" | "bubble";
const KINDS: Kind[] = ["bar", "line", "area", "pie", "doughnut", "radar", "scatter", "bubble"];
const MAX_LABELS = 500;
const MAX_SERIES = 12;
const MAX_TEXT = 60_000;

interface Series { name: string; values: unknown[]; type?: Kind }
interface Spec { type: Kind; title: string; labels: string[]; series: Series[]; stacked: boolean; horizontal: boolean; unit: string }

/** True for the language of a block drawn as a chart. */
export const isChart = (lang: string): boolean => /^(chart|grafico)$/i.test(lang);

/** The block's JSON as a chart, or null when it is not one (it then stays code). */
export function readChart(raw: string): Spec | null {
  if (raw.length > MAX_TEXT) return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const o = v as Record<string, unknown>;
  const kind = (x: unknown): Kind | undefined => (KINDS as string[]).includes(String(x)) ? (x as Kind) : undefined;
  const type = kind(o.type) ?? "bar";
  const labels = Array.isArray(o.labels) ? o.labels.slice(0, MAX_LABELS).map((x) => String(x)) : [];
  const raws = Array.isArray(o.series) ? o.series : Array.isArray(o.datasets) ? o.datasets : [];
  const series: Series[] = raws.slice(0, MAX_SERIES).flatMap((s): Series[] => {
    if (!s || typeof s !== "object") return [];
    const r = s as Record<string, unknown>;
    const values = Array.isArray(r.values) ? r.values : Array.isArray(r.data) ? r.data : null;
    if (!values) return [];
    return [{ name: String(r.name ?? r.label ?? ""), values: values.slice(0, MAX_LABELS), type: kind(r.type) }];
  });
  if (!series.length) return null;
  return {
    type, labels, series,
    title: typeof o.title === "string" ? o.title.slice(0, 200) : "",
    stacked: o.stacked === true,
    horizontal: o.horizontal === true,
    unit: typeof o.unit === "string" ? o.unit.slice(0, 12) : "",
  };
}

/** A value: a number, or for scatter and bubble a point {x, y, r} / [x, y, r]. */
function point(v: unknown, kind: Kind): number | { x: number; y: number; r?: number } | null {
  if (kind === "scatter" || kind === "bubble") {
    const a = Array.isArray(v) ? { x: v[0], y: v[1], r: v[2] } : (v as Record<string, unknown> | null) ?? {};
    const x = Number(a.x), y = Number(a.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    const r = Number(a.r);
    return kind === "bubble" ? { x, y, r: Number.isFinite(r) ? r : 6 } : { x, y };
  }
  const n = typeof v === "number" ? v : Number(String(v).replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

const scheme = (): "light" | "dark" => (document.documentElement.dataset.scheme === "light" ? "light" : "dark");
const numberFmt = (n: number, unit: string) => `${n.toLocaleString("it-IT", { maximumFractionDigits: 2 })}${unit ? ` ${unit}` : ""}`;

/** Chart.js's configuration from the spec, in the island's colours. Nothing of the engine's but data. */
function config(s: Spec, look: "light" | "dark"): Record<string, unknown> {
  const ink = look === "light" ? "#1f2226" : "#e4e5e8";
  const dim = look === "light" ? "#5f646c" : "#9398a1";
  const grid = look === "light" ? "rgba(0,0,0,0.08)" : "rgba(255,255,255,0.08)";
  const round = s.type === "pie" || s.type === "doughnut";
  const base: Kind = s.type === "area" ? "line" : s.type;
  const datasets = s.series.map((x, i) => {
    const kind = x.type ?? s.type;
    const colour = PALETTE[i % PALETTE.length];
    const data = x.values.map((v) => point(v, kind));
    return {
      label: x.name,
      data,
      type: x.type ? (x.type === "area" ? "line" : x.type) : undefined,
      // A pie: a colour for each slice; else one for the series.
      backgroundColor: round ? data.map((_, j) => PALETTE[j % PALETTE.length]) : kind === "line" ? colour : kind === "area" || kind === "radar" ? `${colour}55` : colour,
      borderColor: round ? (look === "light" ? "#ffffff" : "#16181c") : colour,
      borderWidth: round ? 2 : kind === "bar" ? 0 : 2,
      fill: kind === "area" || kind === "radar",
      tension: 0.25,
      pointRadius: data.length > 40 ? 0 : 3,
      borderRadius: kind === "bar" ? 4 : 0,
      // A line among bars: in front, and not piled on them when they are stacked.
      order: kind === "line" || kind === "area" ? 0 : 1,
      stack: x.type && x.type !== s.type ? `own-${i}` : "main",
    };
  });
  const axis = { ticks: { color: dim }, grid: { color: grid }, border: { color: grid } };
  return {
    type: base,
    data: { labels: s.labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      indexAxis: s.horizontal ? "y" : "x",
      color: ink,
      font: { family: "'Segoe UI Variable Text', 'Segoe UI', sans-serif" },
      plugins: {
        title: { display: !!s.title, text: s.title, color: ink, font: { size: 14, weight: "600" } },
        // The series in the engine's order (`order` above only puts a line in front).
        legend: { display: round || s.series.length > 1, labels: { color: ink, boxWidth: 12, sort: (a: { datasetIndex?: number }, b: { datasetIndex?: number }) => (a.datasetIndex ?? 0) - (b.datasetIndex ?? 0) } },
        tooltip: { callbacks: { label: (c: { dataset: { label?: string }; parsed: unknown; label?: string }) => {
          const p = c.parsed as number | { x?: number; y?: number; r?: number };
          const n = typeof p === "number" ? p : s.horizontal ? p.x : p.y;
          const name = round ? c.label : c.dataset.label;
          return `${name ? `${name}: ` : ""}${numberFmt(Number(n ?? 0), s.unit)}`;
        } } },
      },
      scales: round ? {} : s.type === "radar"
        ? { r: { angleLines: { color: grid }, grid: { color: grid }, pointLabels: { color: dim }, ticks: { color: dim, backdropColor: "transparent" } } }
        : { x: { ...axis, stacked: s.stacked }, y: { ...axis, stacked: s.stacked, beginAtZero: true } },
    },
  };
}

/** The charts on show, drawn again when the island goes light or dark. */
const live = new Set<{ el: HTMLElement; redraw: () => void }>();
let watching = false;
function watchScheme() {
  if (watching) return;
  watching = true;
  let last = scheme();
  new MutationObserver(() => {
    if (scheme() === last) return;
    last = scheme();
    for (const c of live) {
      if (c.el.isConnected) c.redraw();
      else live.delete(c);
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-scheme"] });
}

/**
 * A closed ```chart block: the chart in a card like the diagrams' (Copia as a
 * PNG on white, Dati for the JSON), or `plain` when it cannot be read.
 */
export function chartBlock(raw: string, plain: HTMLElement): HTMLElement {
  const box = document.createElement("div");
  box.className = "md-diagram md-chart";
  const spec = readChart(raw);
  if (!spec) {
    box.append(plain);
    return box;
  }
  const card = document.createElement("div");
  card.className = "md-pre md-diagram-card";
  const head = document.createElement("div");
  head.className = "md-pre-head";
  const label = document.createElement("span");
  label.className = "md-lang";
  label.textContent = t("Grafico");
  const body = document.createElement("div");
  body.className = "md-chart-body";
  // A tall one for many bars side by side, a round one smaller.
  const many = spec.horizontal ? Math.max(spec.labels.length, ...spec.series.map((x) => x.values.length)) : 0;
  body.style.height = `${spec.type === "pie" || spec.type === "doughnut" ? 260 : spec.horizontal ? Math.min(900, 80 + many * 26) : 300}px`;
  const canvas = document.createElement("canvas");
  body.append(canvas);

  let chart: { destroy(): void; toBase64Image(type?: string, q?: number): string } | null = null;
  const draw = async () => {
    const { default: Chart } = await import("chart.js/auto");
    chart?.destroy();
    if (!canvas.isConnected && !box.isConnected) {
      // Not on the page yet: drawn when it is (Chart.js measures its box).
      requestAnimationFrame(() => void draw());
      return;
    }
    chart = new Chart(canvas, config(spec, scheme()) as never) as unknown as typeof chart;
  };

  const copyText = t("Copia");
  const copy = btn("md-copy", copyText, t("Copia il grafico come immagine, su fondo bianco"), () => {
    void (async () => {
      try {
        const { default: Chart } = await import("chart.js/auto");
        // Drawn again light, on white, twice the size: for Word, an email, a ticket.
        const off = document.createElement("canvas");
        off.width = Math.max(600, body.clientWidth) * 2;
        off.height = body.clientHeight * 2;
        const cfg = config(spec, "light") as { options: Record<string, unknown> };
        cfg.options = { ...cfg.options, responsive: false, devicePixelRatio: 1 };
        const plugin = { id: "white", beforeDraw: (c: { ctx: CanvasRenderingContext2D; width: number; height: number }) => {
          c.ctx.save();
          c.ctx.fillStyle = "#ffffff";
          c.ctx.fillRect(0, 0, c.width, c.height);
          c.ctx.restore();
        } };
        const holder = document.createElement("div");
        holder.style.cssText = "position:fixed;left:-20000px;top:0";
        holder.append(off);
        document.body.append(holder);
        const tmp = new Chart(off, { ...cfg, plugins: [plugin] } as never);
        const blob = await new Promise<Blob | null>((done) => off.toBlob(done, "image/png"));
        tmp.destroy();
        holder.remove();
        if (!blob) throw new Error("png");
        const view = (box.ownerDocument.defaultView ?? window) as Window & typeof globalThis;
        await view.navigator.clipboard.write([new view.ClipboardItem({ "image/png": blob })]);
        said(copy, t("Copiato ✓"), copyText);
      } catch {
        said(copy, t("Non riuscito"), copyText);
      }
    })();
  });
  let back: HTMLButtonElement | null = null;
  head.append(label, copy, btn("md-copy", t("Dati"), t("Mostra i dati del grafico"), () => {
    if (!back) {
      back = btn("md-copy", t("Grafico"), t("Mostra il grafico"), () => {
        box.replaceChildren(card);
        void draw();
      });
      plain.querySelector(".md-lang")?.after(back);
    }
    box.replaceChildren(plain);
  }));
  card.append(head, body);
  box.append(card);
  watchScheme();
  live.add({ el: box, redraw: () => void draw() });
  void draw().then(() => box.dispatchEvent(new CustomEvent("md-grew", { bubbles: true })), () => box.replaceChildren(plain));
  return box;
}
