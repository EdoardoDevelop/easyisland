// Mappa ad albero (Treemap): memory groups and their top pages/notes sized by weight.

import { KIND_COLOR, alpha, fit, type MemNode, type Model } from "./data";
import { t } from "../core/i18n";
import { animateIdle, type Colouring, type View } from "./stage";
import { font, paintBackground, pal } from "./theme";
import { roundRect } from "./mindmap";

interface Tile {
  node: MemNode;
  colour: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface GroupBox {
  name: string;
  colour: string;
  x: number;
  y: number;
  w: number;
  h: number;
  tiles: Tile[];
}

export class TreemapView implements View {
  private model: Model | null = null;
  private selected: string | null = null;
  private filter: Set<string> | null = null;
  private hovered: string | null = null;
  private colouring: Colouring = "group";
  private groups: GroupBox[] = [];
  private lastKey = "";

  setModel(model: Model) {
    this.model = model;
    this.lastKey = "";
  }

  setSelected(id: string | null) {
    this.selected = id;
  }

  setFilter(ids: Set<string> | null) {
    this.filter = ids;
  }

  setColouring(c: Colouring) {
    this.colouring = c;
    this.lastKey = "";
  }

  setHover(id: string | null) {
    this.hovered = id;
  }

  private layout(w: number, h: number) {
    const key = `${w}x${h}:${this.colouring}`;
    if (key === this.lastKey || !this.model) return;
    this.lastKey = key;
    this.groups = [];
    const { groups, of } = this.model.groups();
    const buckets: { name: string; colour: string; nodes: MemNode[]; value: number }[] = groups.map((g) => {
      const nodes = g.members.map((id) => this.model!.byId.get(id)!).filter(Boolean).sort((a, b) => b.weight - a.weight).slice(0, 18);
      return { name: g.name, colour: g.color, nodes, value: nodes.reduce((s, n) => s + Math.max(1, n.weight + 1), 0) };
    }).filter((b) => b.nodes.length > 0);

    const loose = this.model.g.nodes.filter((n) => !of.has(n.id) && n.kind !== "day").sort((a, b) => b.weight - a.weight).slice(0, 14);
    if (loose.length) {
      buckets.push({ name: t("Altri argomenti"), colour: "#8a8f99", nodes: loose, value: loose.reduce((s, n) => s + Math.max(1, n.weight + 1), 0) });
    }
    if (!buckets.length) return;

    const pad = 16;
    const rects = sliceLayout(buckets.map((b) => b.value), pad, pad, w - pad * 2, h - pad * 2, 8);
    buckets.forEach((b, i) => {
      const r = rects[i];
      if (!r || r.w < 24 || r.h < 24) return;
      const head = 24;
      const inner = sliceLayout(
        b.nodes.map((n) => Math.max(1, n.weight + 1)),
        r.x + 6,
        r.y + head,
        Math.max(10, r.w - 12),
        Math.max(10, r.h - head - 6),
        4,
      );
      const tiles: Tile[] = b.nodes.map((node, j) => ({
        node,
        colour: this.colouring === "group" ? b.colour : KIND_COLOR[node.kind],
        ...inner[j],
      })).filter((tl) => tl.w > 4 && tl.h > 4);
      this.groups.push({ name: b.name, colour: b.colour, ...r, tiles });
    });
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, time = 0): boolean {
    paintBackground(ctx, w, h);
    const p = pal();
    const idle = animateIdle();
    this.layout(w, h);
    if (!this.groups.length) {
      ctx.fillStyle = p.dim;
      ctx.font = font(13);
      ctx.textAlign = "center";
      ctx.fillText(t("Ancora nessuna nota"), w / 2, h / 2);
      return false;
    }

    const shimmer = idle ? 0.5 + 0.5 * Math.sin(time * 0.0018) : 0.5;
    for (const g of this.groups) {
      roundRect(ctx, g.x, g.y, g.w, g.h, 8);
      ctx.fillStyle = alpha(g.colour, p.light ? 0.06 : 0.08);
      ctx.fill();
      ctx.strokeStyle = alpha(g.colour, 0.4);
      ctx.lineWidth = 1;
      ctx.stroke();

      if (g.w > 60) {
        ctx.fillStyle = p.ink;
        ctx.font = font(12, 600);
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        const countTxt = `${g.tiles.length}`;
        const cw = ctx.measureText(countTxt).width + 10;
        ctx.fillText(fit(ctx, g.name, g.w - cw - 20), g.x + 10, g.y + 13);
        ctx.fillStyle = alpha(g.colour, p.light ? 0.16 : 0.25);
        roundRect(ctx, g.x + g.w - cw - 6, g.y + 5, cw, 16, 8);
        ctx.fill();
        ctx.fillStyle = p.ink;
        ctx.font = font(10.5, 600);
        ctx.textAlign = "center";
        ctx.fillText(countTxt, g.x + g.w - cw / 2 - 6, g.y + 13.5);
      }

      for (const tl of g.tiles) {
        const isSel = tl.node.id === this.selected;
        const isHov = tl.node.id === this.hovered;
        const dim = this.filter && !this.filter.has(tl.node.id);
        ctx.globalAlpha = dim ? 0.2 : 1;
        roundRect(ctx, tl.x, tl.y, tl.w, tl.h, 5);
        ctx.fillStyle = alpha(tl.colour, isSel || isHov ? 0.34 : (p.light ? 0.16 : 0.22) + (isSel ? shimmer * 0.08 : 0));
        ctx.fill();
        ctx.strokeStyle = isSel || isHov ? p.ring : alpha(tl.colour, 0.5);
        ctx.lineWidth = isSel || isHov ? 1.8 : 0.8;
        ctx.stroke();
        if (tl.w > 46 && tl.h > 22) {
          ctx.fillStyle = p.ink;
          ctx.font = font(11.5, tl.node.kind === "page" ? 600 : 500);
          ctx.textAlign = "left";
          ctx.textBaseline = "top";
          ctx.fillText(fit(ctx, tl.node.label, tl.w - 12), tl.x + 6, tl.y + 5);
        }
      }
      ctx.globalAlpha = 1;
    }
    return idle;
  }

  hit(x: number, y: number): string | null {
    for (const g of this.groups) {
      if (x < g.x || x > g.x + g.w || y < g.y || y > g.y + g.h) continue;
      for (const tl of g.tiles) {
        if (x >= tl.x && x <= tl.x + tl.w && y >= tl.y && y <= tl.y + tl.h) return tl.node.id;
      }
    }
    return null;
  }

  pan() {}
  zoom() {}
  reset() {
    this.lastKey = "";
  }
}

/** Squarified treemap layout so every group and tile maintains clean proportions. */
function sliceLayout(values: number[], x: number, y: number, w: number, h: number, gap: number): { x: number; y: number; w: number; h: number }[] {
  const out = new Array<{ x: number; y: number; w: number; h: number }>(values.length);
  const sumAll = values.reduce((a, b) => a + b, 0) || 1;
  const totalArea = Math.max(1, w * h);
  const items = values.map((v, idx) => ({ idx, area: (Math.max(0.01, v) / sumAll) * totalArea })).sort((a, b) => b.area - a.area);

  const worst = (row: { area: number }[], side: number) => {
    if (!row.length) return Infinity;
    const s = row.reduce((a, b) => a + b.area, 0);
    const maxA = Math.max(...row.map((r) => r.area));
    const minA = Math.min(...row.map((r) => r.area));
    const s2 = s * s;
    const side2 = side * side;
    return Math.max((side2 * maxA) / s2, s2 / (side2 * minA));
  };

  let rx = x, ry = y, rw = w, rh = h;
  const layoutRow = (row: { idx: number; area: number }[], horiz: boolean) => {
    const rowSum = row.reduce((a, b) => a + b.area, 0);
    if (horiz) {
      const stripW = Math.min(rw, rowSum / Math.max(1, rh));
      let curY = ry;
      for (const it of row) {
        const ih = (it.area / Math.max(1e-6, rowSum)) * rh;
        out[it.idx] = { x: rx, y: curY, w: Math.max(2, stripW - gap * 0.5), h: Math.max(2, ih - gap * 0.5) };
        curY += ih;
      }
      rx += stripW;
      rw = Math.max(1, rw - stripW);
    } else {
      const stripH = Math.min(rh, rowSum / Math.max(1, rw));
      let curX = rx;
      for (const it of row) {
        const iw = (it.area / Math.max(1e-6, rowSum)) * rw;
        out[it.idx] = { x: curX, y: ry, w: Math.max(2, iw - gap * 0.5), h: Math.max(2, stripH - gap * 0.5) };
        curX += iw;
      }
      ry += stripH;
      rh = Math.max(1, rh - stripH);
    }
  };

  let row: { idx: number; area: number }[] = [];
  for (const it of items) {
    const shortSide = Math.min(rw, rh);
    const nextRow = [...row, it];
    if (!row.length || worst(nextRow, shortSide) <= worst(row, shortSide)) {
      row = nextRow;
    } else {
      layoutRow(row, rw >= rh);
      row = [it];
    }
  }
  if (row.length) layoutRow(row, rw >= rh);
  return out;
}
