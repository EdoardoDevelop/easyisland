// Concept Map: the pages as boxes in layers, top to bottom, joined by arrows
// that say how they are related ("- lavora con: [[Rossi]]" → «lavora con»).

import { KIND_COLOR, alpha, fit, type Model } from "./data";
import { t } from "../core/i18n";
import { Camera, starfield, type View } from "./stage";
import { roundRect } from "./mindmap";

interface Box {
  id: string;
  label: string;
  kind: "page" | "missing";
  layer: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Arrow {
  from: Box;
  to: Box;
  label: string;
}

const GAP_X = 36;
const GAP_Y = 120;
const BOX_H = 34;

export class ConceptView implements View {
  private cam = new Camera();
  private model: Model | null = null;
  private boxes = new Map<string, Box>();
  private arrows: Arrow[] = [];
  private selected: string | null = null;
  private filter: Set<string> | null = null;
  private framed = false;
  private size = { w: 0, h: 0 };
  private born = 0;
  private measure = document.createElement("canvas").getContext("2d")!;

  setModel(model: Model) {
    this.model = model;
    this.layout();
    this.framed = false;
  }

  setSelected(id: string | null) {
    this.selected = id;
    const b = id ? this.boxes.get(id) : null;
    if (b) this.cam.centre(b.x + b.w / 2, b.y + b.h / 2, this.size.w, this.size.h);
  }

  setFilter(ids: Set<string> | null) {
    this.filter = ids;
  }

  private layout() {
    const m = this.model!;
    this.measure.font = `600 13px system-ui, "Segoe UI", sans-serif`;
    const ids = m.g.nodes.filter((n) => n.kind === "page" || n.kind === "missing").map((n) => n.id);
    const set = new Set(ids);
    const out = new Map<string, string[]>();
    const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
    const arrows: [string, string, string][] = [];
    for (const e of m.g.edges) {
      if (!set.has(e.from) || !set.has(e.to)) continue;
      arrows.push([e.from, e.to, e.label]);
      (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e.to);
      indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
    }
    // Layers: longest path from the pages nobody points to (cycles cut).
    const layer = new Map<string, number>();
    const visiting = new Set<string>();
    const depth = (id: string): number => {
      if (layer.has(id)) return layer.get(id)!;
      if (visiting.has(id)) return 0;
      visiting.add(id);
      let best = 0;
      for (const [from, to] of arrows) if (to === id && from !== id) best = Math.max(best, depth(from) + 1);
      visiting.delete(id);
      layer.set(id, Math.min(best, 8));
      return layer.get(id)!;
    };
    ids.forEach(depth);
    const linked = new Set(arrows.flatMap(([a, b]) => [a, b]));
    const rows: string[][] = [];
    for (const id of ids) {
      if (!linked.has(id)) continue;
      const l = layer.get(id)!;
      (rows[l] ??= []).push(id);
    }
    // Order inside each layer by the place of the parents (a few passes).
    const pos = new Map<string, number>();
    rows.forEach((r) => r.forEach((id, i) => pos.set(id, i)));
    for (let pass = 0; pass < 4; pass++) {
      for (let l = 1; l < rows.length; l++) {
        const row = rows[l] ?? [];
        const bary = (id: string) => {
          const ps = arrows.filter(([, to]) => to === id).map(([from]) => pos.get(from) ?? 0);
          return ps.length ? ps.reduce((a, b) => a + b, 0) / ps.length : pos.get(id) ?? 0;
        };
        row.sort((a, b) => bary(a) - bary(b));
        row.forEach((id, i) => pos.set(id, i));
      }
    }
    const boxes = new Map<string, Box>();
    const make = (id: string, l: number): Box => {
      const n = m.byId.get(id)!;
      const label = n.label;
      const w = Math.min(220, Math.max(90, this.measure.measureText(label).width + 30));
      return { id, label, kind: n.kind as "page" | "missing", layer: l, x: 0, y: l * GAP_Y, w, h: BOX_H };
    };
    let widest = 0;
    // Array.from, not map: `rows` can have holes (a level with no page), and map
    // keeps them, so `row` came out undefined ("reading 'reduce'").
    const laid: Box[][] = Array.from(rows, (row, l) => (row ?? []).map((id) => make(id, l)));
    for (const row of laid) widest = Math.max(widest, row.reduce((s, b) => s + b.w + GAP_X, -GAP_X));
    for (const row of laid) {
      const total = row.reduce((s, b) => s + b.w + GAP_X, -GAP_X);
      let x = -total / 2;
      for (const b of row) {
        b.x = x;
        x += b.w + GAP_X;
        boxes.set(b.id, b);
      }
    }
    // Pages without links: a grid underneath.
    const lone = ids.filter((id) => !linked.has(id));
    if (lone.length) {
      const top = (laid.length ? laid.length : 0) * GAP_Y + (laid.length ? 40 : 0);
      const cols = Math.max(3, Math.floor(Math.max(widest, 700) / 200));
      lone.forEach((id, i) => {
        const b = make(id, -1);
        b.x = (i % cols) * 200 - (cols * 200) / 2;
        b.y = top + Math.floor(i / cols) * 60;
        boxes.set(id, b);
      });
    }
    this.boxes = boxes;
    this.arrows = arrows.map(([a, b, label]) => ({ from: boxes.get(a)!, to: boxes.get(b)!, label })).filter((a) => a.from && a.to);
    this.born = performance.now();
  }

  private bounds() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const b of this.boxes.values()) {
      x0 = Math.min(x0, b.x);
      y0 = Math.min(y0, b.y);
      x1 = Math.max(x1, b.x + b.w);
      y1 = Math.max(y1, b.y + b.h);
    }
    return Number.isFinite(x0) ? { x0, y0, x1, y1 } : { x0: -200, y0: -100, x1: 200, y1: 100 };
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): boolean {
    this.size = { w, h };
    if (!this.framed) {
      this.cam.frame(this.bounds(), w, h, true, 50);
      this.framed = true;
    }
    let moving = this.cam.step();
    starfield(ctx, w, h, this.cam);
    ctx.save();
    this.cam.apply(ctx);
    const k = this.cam.k;
    const age = Math.min(1, (time - this.born) / 700);
    if (age < 1) moving = true;
    const sel = this.selected;
    const on = (id: string) => (!sel || id === sel || this.arrows.some((a) => (a.from.id === sel && a.to.id === id) || (a.to.id === sel && a.from.id === id))) && (!this.filter || this.filter.has(id));

    // Arrows.
    for (const a of this.arrows) {
      const lit = !sel || a.from.id === sel || a.to.id === sel;
      const sx = a.from.x + a.from.w / 2;
      const sy = a.from.y + a.from.h;
      const ex = a.to.x + a.to.w / 2;
      let ey = a.to.y;
      // Same layer or upwards: from the side, round.
      const back = a.to.y <= a.from.y;
      if (back) ey = a.to.y + a.to.h / 2;
      const c1y = back ? sy + 50 : sy + (ey - sy) * 0.5;
      const c2y = back ? ey : sy + (ey - sy) * 0.5;
      const c2x = back ? ex + (ex > sx ? 80 : -80) : ex;
      ctx.globalAlpha = (lit ? 1 : 0.15) * age;
      const color = sel && lit ? "#cfd8ff" : "rgba(150,170,230,0.55)";
      ctx.strokeStyle = color;
      ctx.lineWidth = (lit && sel ? 1.8 : 1.2) / Math.sqrt(k);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.bezierCurveTo(sx, c1y, c2x, c2y, ex, ey);
      ctx.stroke();
      // The head.
      const ang = Math.atan2(ey - c2y, ex - c2x);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - Math.cos(ang - 0.4) * 9, ey - Math.sin(ang - 0.4) * 9);
      ctx.lineTo(ex - Math.cos(ang + 0.4) * 9, ey - Math.sin(ang + 0.4) * 9);
      ctx.closePath();
      ctx.fill();
      // The relation in the middle.
      const label = a.label || t("collegata a");
      ctx.font = `italic 11px system-ui, "Segoe UI", sans-serif`;
      const mx = (sx + ex) / 2 + (back ? (ex > sx ? 40 : -40) : 0);
      const my = back ? (sy + ey) / 2 + 30 : (sy + ey) / 2;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = "rgba(10,12,18,0.92)";
      roundRect(ctx, mx - tw / 2 - 6, my - 9, tw + 12, 18, 9);
      ctx.fill();
      ctx.strokeStyle = a.label ? "rgba(245,165,36,0.55)" : "rgba(150,170,230,0.3)";
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = a.label ? "#f8c46a" : "#9aa3bd";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, mx, my + 0.5);
    }

    // Boxes.
    for (const b of this.boxes.values()) {
      const lit = on(b.id);
      const color = KIND_COLOR[b.kind];
      const rise = (1 - age) * 20;
      ctx.globalAlpha = (lit ? 1 : 0.2) * age;
      const g = ctx.createLinearGradient(b.x, b.y, b.x, b.y + b.h);
      g.addColorStop(0, alpha(color, b.kind === "missing" ? 0.08 : 0.32));
      g.addColorStop(1, alpha(color, b.kind === "missing" ? 0.04 : 0.14));
      ctx.fillStyle = g;
      ctx.shadowColor = color;
      ctx.shadowBlur = b.id === sel ? 24 : 10;
      roundRect(ctx, b.x, b.y + rise, b.w, b.h, 9);
      ctx.fill();
      ctx.shadowBlur = 0;
      if (b.kind === "missing") ctx.setLineDash([4, 3]);
      ctx.strokeStyle = b.id === sel ? "#ffffff" : alpha(color, 0.85);
      ctx.lineWidth = b.id === sel ? 2 : 1.2;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `600 13px system-ui, "Segoe UI", sans-serif`;
      ctx.fillStyle = b.kind === "missing" ? "#aab0bb" : "#f5f6f8";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(fit(ctx, b.label, b.w - 16), b.x + b.w / 2, b.y + rise + b.h / 2 + 0.5);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    return moving;
  }

  hit(x: number, y: number): string | null {
    const p = this.cam.toWorld(x, y);
    for (const b of this.boxes.values()) {
      if (p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h) return b.id;
    }
    return null;
  }

  pan(dx: number, dy: number) {
    this.cam.pan(dx, dy);
  }

  zoom(f: number, x: number, y: number) {
    this.cam.zoom(f, x, y);
  }

  reset() {
    this.cam.frame(this.bounds(), this.size.w, this.size.h, false, 50);
  }

  /** Nothing to draw: no pages yet. */
  get empty(): boolean {
    return this.boxes.size === 0;
  }
}
