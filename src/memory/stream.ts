// Fiume degli argomenti: coloured streams flowing through time, one per group
// (the biggest eight, the rest together), as wide as how much was written
// about it each week. It shows when a customer or a project became hot.
// From the timeline's events (notes and pages) whose node is in a group.

import { alpha, fit, type Model } from "./data";
import { t } from "../core/i18n";
import { animateIdle, type View } from "./stage";
import { font, paintBackground, pal } from "./theme";
import { Placer } from "./labels";

interface Stream {
  name: string;
  colour: string;
  /** The node to pick when it is clicked: the group's lead page. */
  lead: string | null;
  counts: number[];
}

const WEEK = 7 * 86_400_000;
const MAX_STREAMS = 8;

export class StreamView implements View {
  private streams: Stream[] = [];
  private weeks: number[] = [];
  private selected: string | null = null;
  private size = { w: 0, h: 0 };
  /** For hits: each stream's band, per week (top, bottom), in screen px. */
  private bands: { top: number[]; bottom: number[] }[] = [];
  private zoomK = 1;
  private shift = 0;

  setModel(model: Model) {
    const { groups, of } = model.groups();
    const dated = model.g.events.filter((e) => (e.lane === "note" || e.lane === "page") && e.node && Number.isFinite(Date.parse(e.date.slice(0, 10))));
    this.streams = [];
    this.weeks = [];
    if (!dated.length) return;
    const times = dated.map((e) => Date.parse(e.date.slice(0, 10)));
    const last = Math.max(...times);
    // Six months at most, a week per step.
    const first = Math.max(Math.min(...times), last - 26 * WEEK);
    const n = Math.max(2, Math.ceil((last - first) / WEEK) + 1);
    this.weeks = Array.from({ length: n }, (_, i) => first + i * WEEK);
    const by = new Map<number, number[]>();
    const other = new Array(n).fill(0);
    for (const e of dated) {
      const ti = Date.parse(e.date.slice(0, 10));
      if (ti < first) continue;
      const w = Math.min(n - 1, Math.floor((ti - first) / WEEK));
      const g = of.get(e.node);
      if (g == null) {
        other[w]++;
        continue;
      }
      const row = by.get(g) ?? new Array(n).fill(0);
      row[w]++;
      by.set(g, row);
    }
    const ranked = [...by.entries()].sort((a, b) => sum(b[1]) - sum(a[1]));
    for (const [g, counts] of ranked.slice(0, MAX_STREAMS)) {
      const group = groups[g];
      const pages = group.members.map((id) => model.byId.get(id)!).filter((x) => x.kind === "page");
      this.streams.push({ name: group.name, colour: group.color, lead: pages[0]?.id ?? group.members[0] ?? null, counts: smooth(counts) });
    }
    for (const [, counts] of ranked.slice(MAX_STREAMS)) counts.forEach((c, i) => (other[i] += c));
    if (sum(other)) this.streams.push({ name: t("Il resto"), colour: "#8a8f99", lead: null, counts: smooth(other) });
  }

  private hoverX: number | null = null;

  setSelected(id: string | null) {
    this.selected = id;
  }

  setFilter() {}

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, time = 0): boolean {
    this.size = { w, h };
    paintBackground(ctx, w, h);
    const p = pal();
    const idle = animateIdle();
    this.bands = [];
    const n = this.weeks.length;
    if (!n || !this.streams.length) {
      ctx.fillStyle = p.dim;
      ctx.font = font(13);
      ctx.textAlign = "center";
      ctx.fillText(t("Ancora nessuna nota con la data"), w / 2, h / 2);
      return idle;
    }
    const left = 30;
    const right = w - 30;
    const top = 40;
    const bottom = h - 46;
    const totals = this.weeks.map((_, i) => this.streams.reduce((s, x) => s + x.counts[i], 0));
    const max = Math.max(1, ...totals);
    const scale = ((bottom - top) / max) * 0.92;
    const xOf = (i: number) => {
      const base = left + (i / Math.max(1, n - 1)) * (right - left);
      return (base - w / 2) * this.zoomK + w / 2 + this.shift;
    };
    const mid = (top + bottom) / 2;
    // Subtle vertical month gridlines behind the river.
    ctx.save();
    ctx.strokeStyle = p.line;
    ctx.lineWidth = 1;
    let lastGridMonth = -1;
    this.weeks.forEach((ts, i) => {
      const m = new Date(ts).getMonth();
      if (m === lastGridMonth) return;
      lastGridMonth = m;
      const gx = xOf(i);
      if (gx < left || gx > right) return;
      ctx.beginPath();
      ctx.moveTo(gx, top);
      ctx.lineTo(gx, bottom + 6);
      ctx.stroke();
    });
    ctx.restore();
    // Centred: the river flows in the middle, its banks move with the total.
    const base = totals.map((tot) => mid - (tot * scale) / 2);
    const acc = new Array(n).fill(0);
    const sel = this.selected;
    // The names never on each other: a stream whose name would cover another's goes without.
    const placer = new Placer();
    this.streams.forEach((s, si) => {
      const topY: number[] = [];
      const botY: number[] = [];
      for (let i = 0; i < n; i++) {
        const wave = idle ? Math.sin(time * 0.0022 - i * 0.5 + si * 0.9) * 3.2 : 0;
        topY.push(base[i] + acc[i] * scale + wave);
        acc[i] += s.counts[i];
        botY.push(base[i] + acc[i] * scale + wave);
      }
      this.bands.push({ top: topY, bottom: botY });
      const on = !sel || s.lead === sel;
      const g = ctx.createLinearGradient(left, 0, right, 0);
      g.addColorStop(0, alpha(s.colour, on ? 0.55 : 0.15));
      g.addColorStop(1, alpha(s.colour, on ? 0.9 : 0.2));
      ctx.fillStyle = g;
      ctx.beginPath();
      curve(ctx, this.weeks.map((_, i) => xOf(i)), topY, true);
      curve(ctx, this.weeks.map((_, i) => xOf(i)).reverse(), [...botY].reverse(), false);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = p.bg;
      ctx.lineWidth = 1;
      ctx.stroke();
      // Its name where it is widest.
      let wi = 0;
      for (let i = 1; i < n; i++) if (s.counts[i] > s.counts[wi]) wi = i;
      if ((botY[wi] - topY[wi]) > 22) {
        ctx.fillStyle = on ? "#0b0b0b" : p.dim;
        ctx.font = font(Math.max(12, Math.min(14, (botY[wi] - topY[wi]) * 0.5)), 600);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const name = fit(ctx, s.name, 200);
        const nx = Math.min(Math.max(xOf(wi), left + 80), right - 80);
        const ny = (topY[wi] + botY[wi]) / 2;
        const half = ctx.measureText(name).width / 2 + 6;
        if (placer.claim({ x0: nx - half, y0: ny - 10, x1: nx + half, y1: ny + 10 })) ctx.fillText(name, nx, ny);
      }
    });
    // The months under the river.
    ctx.fillStyle = p.dim;
    ctx.font = font(12);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    let lastMonth = -1;
    this.weeks.forEach((ts, i) => {
      const d = new Date(ts);
      if (d.getMonth() === lastMonth) return;
      lastMonth = d.getMonth();
      ctx.fillText(d.toLocaleDateString(undefined, { month: "short", year: "2-digit" }), xOf(i), bottom + 16);
    });
    // Interactive vertical hover crosshair highlighting the hovered week.
    if (this.hoverX !== null && this.hoverX >= left && this.hoverX <= right) {
      const basePos = ((this.hoverX - this.shift - w / 2) / this.zoomK + w / 2 - left) / (right - left);
      const wi = Math.round(basePos * (n - 1));
      if (wi >= 0 && wi < n) {
        const cx = xOf(wi);
        ctx.save();
        ctx.strokeStyle = p.dim;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(cx, top);
        ctx.lineTo(cx, bottom + 10);
        ctx.stroke();
        ctx.restore();
      }
    }
    return idle;
  }

  private at(x: number, y: number): { s: Stream; week: number } | null {
    const n = this.weeks.length;
    if (!n) return null;
    const w = this.size.w;
    const left = 30;
    const right = w - 30;
    const base = ((x - this.shift - w / 2) / this.zoomK + w / 2 - left) / (right - left);
    const i = Math.round(base * (n - 1));
    if (i < 0 || i >= n) return null;
    for (let k = 0; k < this.bands.length; k++) {
      const b = this.bands[k];
      if (y >= b.top[i] && y <= b.bottom[i]) return { s: this.streams[k], week: i };
    }
    return null;
  }

  hit(x: number, y: number): string | null {
    return this.at(x, y)?.s.lead ?? null;
  }

  hover(x: number, y: number) {
    this.hoverX = x;
    const a = this.at(x, y);
    if (!a) return null;
    const d = new Date(this.weeks[a.week]);
    return { text: a.s.name, sub: t("settimana del {d}: {n}", { d: d.toLocaleDateString(), n: Math.round(a.s.counts[a.week] * 10) / 10 }) };
  }

  pan(dx: number) {
    this.shift += dx;
  }

  zoom(f: number, x: number) {
    const k = Math.min(6, Math.max(1, this.zoomK * f));
    const w = this.size.w;
    this.shift = x - w / 2 - ((x - w / 2 - this.shift) * k) / this.zoomK;
    this.zoomK = k;
    if (k === 1) this.shift = 0;
  }

  reset() {
    this.zoomK = 1;
    this.shift = 0;
  }
}

function sum(a: number[]): number {
  return a.reduce((s, x) => s + x, 0);
}

/** A three-week average: the river flows instead of jumping. */
function smooth(a: number[]): number[] {
  return a.map((_, i) => ((a[i - 1] ?? a[i]) + a[i] * 2 + (a[i + 1] ?? a[i])) / 4);
}

/** A smooth line through the points (monotone enough for a river bank). */
function curve(ctx: CanvasRenderingContext2D, xs: number[], ys: number[], start: boolean) {
  if (start) ctx.moveTo(xs[0], ys[0]);
  else ctx.lineTo(xs[0], ys[0]);
  for (let i = 1; i < xs.length; i++) {
    const mx = (xs[i - 1] + xs[i]) / 2;
    ctx.bezierCurveTo(mx, ys[i - 1], mx, ys[i], xs[i], ys[i]);
  }
}
