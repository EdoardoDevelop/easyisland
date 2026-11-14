// Concept Map: the pages as boxes in layers, top to bottom, joined by arrows
// that say how they are related ("- lavora con: [[Rossi]]" → «lavora con»).

import { KIND_COLOR, alpha, fit, type Model } from "./data";
import { t } from "../core/i18n";
import { Camera, starfield, type View } from "./stage";
import { roundRect } from "./mindmap";
import { Placer, label } from "./labels";
import { font, pal } from "./theme";

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
  /** Not written: a page with no written relation, tied to a page it names (dashed). */
  named?: boolean;
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
    this.measure.font = font(13, 600);
    const ids = m.g.nodes.filter((n) => n.kind === "page" || n.kind === "missing").map((n) => n.id);
    const set = new Set(ids);
    const out = new Map<string, string[]>();
    const indeg = new Map<string, number>(ids.map((id) => [id, 0]));
    const arrows: [string, string, string, boolean][] = [];
    const add = (e: { from: string; to: string; label: string }, named: boolean) => {
      arrows.push([e.from, e.to, e.label, named]);
      (out.get(e.from) ?? out.set(e.from, []).get(e.from)!).push(e.to);
      indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
    };
    for (const e of m.g.edges) {
      if (!set.has(e.from) || !set.has(e.to) || (e.strength ?? 3) < 3) continue; // only what is written
      add(e, false);
    }
    // A page with no written relation would float alone (14 Nov 2026): it hangs
    // from the pages it names or that name it (brain.rs pages_named_in, strength 2), dashed.
    const written = new Set(arrows.flatMap(([a, b]) => [a, b]));
    for (const e of m.g.edges) {
      if (!set.has(e.from) || !set.has(e.to) || e.strength !== 2) continue;
      if (written.has(e.from) && written.has(e.to)) continue;
      add(e, true);
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
    // A layer wider than the screen wraps on more lines (a hundred customers
    // on one line were specks): at most `maxW` wide, the layers' lines one
    // under the other.
    // About as wide as a screen is wide for that much: the boxes' area, at 16:10.
    const area = rows.flat().reduce((sum, id) => sum + (make(id, 0).w + GAP_X) * (BOX_H + 40), 0);
    const maxW = Math.max(900, Math.sqrt(area * 1.6));
    // Array.from, not map: `rows` can have holes (a level with no page), and map
    // keeps them, so `row` came out undefined ("reading 'reduce'").
    const laid: Box[][] = Array.from(rows, (row, l) => (row ?? []).map((id) => make(id, l)));
    let widest = 0;
    let y = 0;
    for (const row of laid) {
      const lines: Box[][] = [[]];
      let used = -GAP_X;
      for (const b of row) {
        if (used + GAP_X + b.w > maxW && lines[lines.length - 1].length) {
          lines.push([]);
          used = -GAP_X;
        }
        lines[lines.length - 1].push(b);
        used += GAP_X + b.w;
      }
      for (const line of lines) {
        const total = line.reduce((s, b) => s + b.w + GAP_X, -GAP_X);
        widest = Math.max(widest, total);
        let x = -total / 2;
        for (const b of line) {
          b.x = x;
          b.y = y;
          x += b.w + GAP_X;
          boxes.set(b.id, b);
        }
        y += BOX_H + 22;
      }
      y += GAP_Y - BOX_H - 22;
    }
    // Pages without links: a grid underneath.
    const lone = ids.filter((id) => !linked.has(id));
    if (lone.length) {
      const top = y + (laid.length ? 40 : 0);
      const cols = Math.max(3, Math.floor(Math.max(widest, 700) / 200));
      lone.forEach((id, i) => {
        const b = make(id, -1);
        b.x = (i % cols) * 200 - (cols * 200) / 2;
        b.y = top + Math.floor(i / cols) * 60;
        boxes.set(id, b);
      });
    }
    this.boxes = boxes;
    this.arrows = arrows.map(([a, b, label, named]) => ({ from: boxes.get(a)!, to: boxes.get(b)!, label, named })).filter((a) => a.from && a.to);
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
    const p = pal();
    ctx.save();
    this.cam.apply(ctx);
    const k = this.cam.k;
    const age = Math.min(1, (time - this.born) / 700);
    if (age < 1) moving = true;
    const sel = this.selected;
    const on = (id: string) => (!sel || id === sel || this.arrows.some((a) => (a.from.id === sel && a.to.id === id) || (a.to.id === sel && a.from.id === id))) && (!this.filter || this.filter.has(id));
    const rels: { text: string; x: number; y: number; lit: boolean; named: boolean }[] = [];

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
      const color = sel && lit ? p.ink : `rgba(${p.link},0.6)`;
      ctx.strokeStyle = color;
      ctx.lineWidth = (lit && sel ? 1.8 : 1.2) / Math.sqrt(k);
      if (a.named) ctx.setLineDash([5 / Math.sqrt(k), 4 / Math.sqrt(k)]);
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.bezierCurveTo(sx, c1y, c2x, c2y, ex, ey);
      ctx.stroke();
      ctx.setLineDash([]);
      // The head.
      const ang = Math.atan2(ey - c2y, ex - c2x);
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(ex, ey);
      ctx.lineTo(ex - Math.cos(ang - 0.4) * 9, ey - Math.sin(ang - 0.4) * 9);
      ctx.lineTo(ex - Math.cos(ang + 0.4) * 9, ey - Math.sin(ang + 0.4) * 9);
      ctx.closePath();
      ctx.fill();
      const mx = (sx + ex) / 2 + (back ? (ex > sx ? 40 : -40) : 0);
      const my = back ? (sy + ey) / 2 + 30 : (sy + ey) / 2;
      if (!a.named) rels.push({ text: a.label || t("collegata a"), x: mx, y: my, lit, named: !!a.label });
    }

    // Boxes: flat cards with the kind's colour on the edge.
    for (const b of this.boxes.values()) {
      const lit = on(b.id);
      const color = KIND_COLOR[b.kind];
      const rise = (1 - age) * 20;
      ctx.globalAlpha = (lit ? 1 : 0.2) * age;
      roundRect(ctx, b.x, b.y + rise, b.w, b.h, 6);
      ctx.fillStyle = p.card;
      ctx.fill();
      ctx.fillStyle = alpha(color, b.kind === "missing" ? 0.04 : p.light ? 0.12 : 0.18);
      ctx.fill();
      if (b.kind === "missing") ctx.setLineDash([4, 3]);
      ctx.strokeStyle = b.id === sel ? p.ring : alpha(color, 0.85);
      ctx.lineWidth = (b.id === sel ? 2 : 1) / Math.min(1, k);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // The names in screen pixels (never under 12 px): cut to the box, left out
    // when the box is too small to hold them (hover shows it).
    const placer = new Placer();
    const rise = (1 - age) * 20 * k;
    for (const b of this.boxes.values()) {
      const s = this.cam.toScreen(b.x, b.y);
      const bw = b.w * k;
      const bh = b.h * k;
      placer.take({ x0: s.x, y0: s.y + rise, x1: s.x + bw, y1: s.y + rise + bh });
      if (bh < 15 || bw < 36) continue;
      const size = Math.max(12, Math.min(14, 13 * k));
      ctx.globalAlpha = (on(b.id) ? 1 : 0.3) * age;
      ctx.font = font(size, 600);
      ctx.fillStyle = b.kind === "missing" ? p.dim : p.ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(fit(ctx, b.label, bw - 14), s.x + bw / 2, s.y + rise + bh / 2 + 0.5);
    }
    ctx.globalAlpha = age;
    // The relations, where they fit: the picked page's first.
    rels.sort((a, b) => Number(b.lit) - Number(a.lit) || Number(b.named) - Number(a.named));
    for (const r of rels) {
      if (sel && !r.lit) continue;
      const s = this.cam.toScreen(r.x, r.y);
      label(ctx, placer, r.text, s.x, s.y, { size: 12, weight: 500, color: r.named ? p.ink : p.dim, baseline: "middle", max: 160 });
    }
    ctx.globalAlpha = 1;
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
