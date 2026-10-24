// Timeline: the memory along time, in lanes (notes, pages, sources, the chat's
// diary), with how busy each day was as a glowing wave on top. The wheel zooms
// time around the pointer, dragging moves it.

import { KIND_COLOR, alpha, fit, type MemEvent, type Model } from "./data";
import { language, t } from "../core/i18n";
import type { View } from "./stage";

const DAY = 86_400_000;
const TOP = 46;
const WAVE = 70;

interface Dot {
  ev: MemEvent;
  time: number;
  lane: number;
}

const LANES: { key: MemEvent["lane"]; color: string; name: () => string }[] = [
  { key: "note", color: KIND_COLOR.note, name: () => t("Note") },
  { key: "page", color: KIND_COLOR.page, name: () => t("Pagine") },
  { key: "source", color: KIND_COLOR.source, name: () => t("Fonti") },
  { key: "diary", color: "#c084fc", name: () => t("Chat") },
];

export function parseDate(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(s);
  if (!m) return NaN;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] ?? 12), +(m[5] ?? 0)).getTime();
}

export class TimelineView implements View {
  private dots: Dot[] = [];
  private perDay = new Map<number, number>();
  /** Time at the left edge and milliseconds per pixel. */
  private t0 = 0;
  private msPx = DAY / 20;
  private goal: { t0: number; msPx: number } | null = null;
  private selected: string | null = null;
  private filter: Set<string> | null = null;
  private words: string[] = [];
  private size = { w: 0, h: 0 };
  private framed = false;
  private born = 0;

  setModel(model: Model) {
    this.dots = model.g.events
      .map((ev) => ({ ev, time: parseDate(ev.date), lane: LANES.findIndex((l) => l.key === ev.lane) }))
      .filter((d) => Number.isFinite(d.time) && d.lane >= 0);
    this.perDay.clear();
    for (const d of this.dots) {
      if (d.ev.lane !== "diary") continue;
      const day = Math.floor(startOfDay(d.time) / DAY);
      this.perDay.set(day, (this.perDay.get(day) ?? 0) + 1);
    }
    if (!this.framed) this.born = performance.now();
  }

  setSelected(id: string | null) {
    this.selected = id;
    const d = id ? this.dots.find((x) => x.ev.node === id) : null;
    if (d && this.size.w) this.goal = { t0: d.time - (this.size.w / 2) * this.msPx, msPx: this.msPx };
  }

  setFilter(ids: Set<string> | null, query = "") {
    this.filter = ids;
    this.words = query.toLowerCase().split(/\s+/).filter(Boolean);
  }

  private laneY(i: number, h: number) {
    const top = TOP + WAVE + 26;
    const each = Math.max(46, (h - top - 40) / LANES.length);
    return top + each * i + each / 2;
  }

  private x(time: number) {
    return (time - this.t0) / this.msPx;
  }

  private fitAll(w: number, now: boolean) {
    const times = this.dots.map((d) => d.time);
    const today = Date.now();
    const min = times.length ? Math.min(...times) : today - 30 * DAY;
    const max = Math.max(today, times.length ? Math.max(...times) : today);
    const span = Math.max(3 * DAY, max - min);
    const msPx = (span * 1.1) / Math.max(200, w - 140);
    const goal = { t0: min - span * 0.05 - 120 * msPx, msPx };
    if (now) {
      this.t0 = goal.t0;
      this.msPx = goal.msPx;
    } else {
      this.goal = goal;
    }
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): boolean {
    this.size = { w, h };
    if (!this.framed) {
      this.fitAll(w, true);
      this.framed = true;
    }
    let moving = false;
    if (this.goal) {
      const g = this.goal;
      this.t0 += (g.t0 - this.t0) * 0.18;
      this.msPx += (g.msPx - this.msPx) * 0.18;
      if (Math.abs(g.t0 - this.t0) < this.msPx * 0.5 && Math.abs(g.msPx - this.msPx) / g.msPx < 0.002) {
        this.t0 = g.t0;
        this.msPx = g.msPx;
        this.goal = null;
      }
      moving = true;
    }
    const intro = Math.min(1, (time - this.born) / 900);
    if (intro < 1) moving = true;

    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#0b0d16");
    bg.addColorStop(1, "#06070a");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    this.drawTicks(ctx, w, h);

    // Lanes.
    LANES.forEach((lane, i) => {
      const y = this.laneY(i, h);
      ctx.strokeStyle = alpha(lane.color, 0.16);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(110, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    });

    // The wave of the chat: questions per day.
    this.drawWave(ctx, w, intro);

    // Today.
    const nowX = this.x(Date.now());
    if (nowX > 110 && nowX < w) {
      const g = ctx.createLinearGradient(0, TOP, 0, h);
      g.addColorStop(0, "rgba(124,156,255,0.0)");
      g.addColorStop(0.2, "rgba(124,156,255,0.7)");
      g.addColorStop(1, "rgba(124,156,255,0.1)");
      ctx.strokeStyle = g;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(nowX, TOP);
      ctx.lineTo(nowX, h - 10);
      ctx.stroke();
      ctx.fillStyle = "#c7d4ff";
      ctx.font = "600 11px system-ui, 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(t("oggi"), nowX, TOP - 6);
    }

    // The events.
    const placed: number[][] = LANES.map(() => [-Infinity, -Infinity]);
    for (const d of this.dots) {
      const x = this.x(d.time);
      if (x < 100 || x > w + 10) continue;
      const lane = LANES[d.lane];
      const y = this.laneY(d.lane, h);
      const lit = (!this.filter || (d.ev.node && this.filter.has(d.ev.node)) || this.words.every((w) => d.ev.text.toLowerCase().includes(w))) && (!this.selected || d.ev.node === this.selected);
      const sel = !!this.selected && d.ev.node === this.selected;
      const r = (d.ev.lane === "diary" ? 2.6 : 5) * (sel ? 1.6 : 1) * intro;
      ctx.globalAlpha = lit ? 1 : 0.18;
      const halo = ctx.createRadialGradient(x, y, 0, x, y, r * 4);
      halo.addColorStop(0, alpha(lane.color, 0.45));
      halo.addColorStop(1, alpha(lane.color, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, r * 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = sel ? "#ffffff" : lane.color;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
      if (sel) {
        ctx.strokeStyle = "#ffffff";
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(x, y, r + 4 + Math.sin(time / 250) * 1.5, 0, Math.PI * 2);
        ctx.stroke();
        moving = true;
      }
      // A label when there is room (not for the diary: too many).
      if (d.ev.lane !== "diary" && lit) {
        // Above or below the lane, where the last label ended before this one.
        const ends = placed[d.lane];
        const slot = ends.findIndex((end) => end < x);
        if (slot >= 0) {
          ctx.font = "500 11.5px system-ui, 'Segoe UI', sans-serif";
          const label = fit(ctx, d.ev.text, 140);
          ends[slot] = x + 8 + ctx.measureText(label).width + 10;
          ctx.fillStyle = "#dfe3ee";
          ctx.textAlign = "left";
          ctx.textBaseline = "middle";
          ctx.fillText(label, x + 8, y + (slot ? 16 : -16));
        }
      }
    }
    ctx.globalAlpha = 1;

    // Lane names over a solid strip on the left.
    ctx.fillStyle = "rgba(8,9,13,0.92)";
    ctx.fillRect(0, TOP + WAVE + 6, 104, h);
    LANES.forEach((lane, i) => {
      const y = this.laneY(i, h);
      ctx.fillStyle = lane.color;
      ctx.beginPath();
      ctx.arc(18, y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.font = "600 12px system-ui, 'Segoe UI', sans-serif";
      ctx.fillStyle = "#dfe3ee";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(lane.name(), 30, y);
    });
    return moving;
  }

  private drawWave(ctx: CanvasRenderingContext2D, w: number, intro: number) {
    if (!this.perDay.size) return;
    const base = TOP + WAVE;
    const max = Math.max(...this.perDay.values());
    const first = Math.floor(this.t0 / DAY) - 1;
    const last = Math.ceil((this.t0 + w * this.msPx) / DAY) + 1;
    if (last - first > 4000) return;
    const pts: [number, number][] = [];
    for (let d = first; d <= last; d++) {
      const n = this.perDay.get(d) ?? 0;
      const x = this.x(d * DAY + DAY / 2 + new Date().getTimezoneOffset() * 60_000);
      pts.push([x, base - (n / max) * (WAVE - 8) * intro]);
    }
    const g = ctx.createLinearGradient(0, TOP, 0, base);
    g.addColorStop(0, "rgba(192,132,252,0.55)");
    g.addColorStop(1, "rgba(192,132,252,0.02)");
    ctx.beginPath();
    ctx.moveTo(pts[0][0], base);
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i];
      if (i === 0) ctx.lineTo(x, y);
      else {
        const [px, py] = pts[i - 1];
        const cx = (px + x) / 2;
        ctx.bezierCurveTo(cx, py, cx, y, x, y);
      }
    }
    ctx.lineTo(pts[pts.length - 1][0], base);
    ctx.closePath();
    ctx.fillStyle = g;
    ctx.fill();
    ctx.strokeStyle = "rgba(216,180,254,0.85)";
    ctx.lineWidth = 1.4;
    ctx.shadowColor = "#c084fc";
    ctx.shadowBlur = 10;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) {
      const [x, y] = pts[i];
      if (i === 0) ctx.moveTo(x, y);
      else {
        const [px, py] = pts[i - 1];
        const cx = (px + x) / 2;
        ctx.bezierCurveTo(cx, py, cx, y, x, y);
      }
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
  }

  /** Lines and dates: hours, days, months or years by the zoom. */
  private drawTicks(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const loc = language() === "en" ? "en-GB" : "it-IT";
    const pxDay = DAY / this.msPx;
    let step: "hour" | "day" | "week" | "month" | "year";
    if (pxDay > 900) step = "hour";
    else if (pxDay > 26) step = "day";
    else if (pxDay > 5) step = "week";
    else if (pxDay > 0.35) step = "month";
    else step = "year";
    const start = new Date(this.t0);
    const end = this.t0 + w * this.msPx;
    let d: Date;
    switch (step) {
      case "hour": d = new Date(start.getFullYear(), start.getMonth(), start.getDate(), start.getHours()); break;
      case "day": d = new Date(start.getFullYear(), start.getMonth(), start.getDate()); break;
      case "week": d = new Date(start.getFullYear(), start.getMonth(), start.getDate() - ((start.getDay() + 6) % 7)); break;
      case "month": d = new Date(start.getFullYear(), start.getMonth(), 1); break;
      default: d = new Date(start.getFullYear(), 0, 1);
    }
    ctx.font = "500 11px system-ui, 'Segoe UI', sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    let guard = 0;
    while (d.getTime() <= end && guard++ < 600) {
      const x = this.x(d.getTime());
      if (x > 104) {
        ctx.strokeStyle = "rgba(255,255,255,0.05)";
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, TOP);
        ctx.lineTo(x, h);
        ctx.stroke();
        let label: string;
        switch (step) {
          case "hour": label = d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit" }); break;
          case "day": label = d.toLocaleDateString(loc, { weekday: "short", day: "numeric", month: "short" }); break;
          case "week": label = d.toLocaleDateString(loc, { day: "numeric", month: "short" }); break;
          case "month": label = d.toLocaleDateString(loc, { month: "long", year: "numeric" }); break;
          default: label = String(d.getFullYear());
        }
        ctx.fillStyle = "#8b91a0";
        ctx.fillText(label, x + 5, TOP - 6);
      }
      switch (step) {
        case "hour": d = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + (pxDay > 3000 ? 1 : 3)); break;
        case "day": d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + (pxDay > 80 ? 1 : 2)); break;
        case "week": d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 7); break;
        case "month": d = new Date(d.getFullYear(), d.getMonth() + (pxDay > 1.5 ? 1 : 3), 1); break;
        default: d = new Date(d.getFullYear() + 1, 0, 1);
      }
    }
  }

  private dotAt(x: number, y: number): Dot | null {
    let best: Dot | null = null;
    let bestD = 12;
    for (const d of this.dots) {
      const dx = this.x(d.time) - x;
      if (Math.abs(dx) > 12) continue;
      const dist = Math.hypot(dx, this.laneY(d.lane, this.size.h) - y);
      if (dist < bestD) {
        best = d;
        bestD = dist;
      }
    }
    return best;
  }

  hit(x: number, y: number): string | null {
    const d = this.dotAt(x, y);
    return d?.ev.node || null;
  }

  hover(x: number, y: number) {
    const d = this.dotAt(x, y);
    return d ? { text: d.ev.text, sub: d.ev.date } : null;
  }

  pan(dx: number) {
    this.goal = null;
    this.t0 -= dx * this.msPx;
  }

  zoom(f: number, x: number) {
    this.goal = null;
    const at = this.t0 + x * this.msPx;
    this.msPx = Math.min(DAY * 30, Math.max(60_000, this.msPx / f));
    this.t0 = at - x * this.msPx;
  }

  reset() {
    this.fitAll(this.size.w, false);
  }
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime() - d.getTimezoneOffset() * 60_000;
}

