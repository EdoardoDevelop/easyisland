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
        ctx.fillText(fit(ctx, g.name, g.w - 16), g.x + 10, g.y + 13);
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

/** Simple binary-split treemap layout so every group & tile fits cleanly. */
function sliceLayout(values: number[], x: number, y: number, w: number, h: number, gap: number): { x: number; y: number; w: number; h: number }[] {
  const out = new Array<{ x: number; y: number; w: number; h: number }>(values.length);
  const split = (indices: number[], rx: number, ry: number, rw: number, rh: number) => {
    if (!indices.length) return;
    if (indices.length === 1) {
      out[indices[0]] = { x: rx, y: ry, w: rw, h: rh };
      return;
    }
    const total = indices.reduce((s, i) => s + values[i], 0) || 1;
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < indices.length - 1; i++) {
      acc += values[indices[i]];
      cut = i + 1;
      if (acc >= total / 2) break;
    }
    const ratio = acc / total;
    const left = indices.slice(0, cut);
    const right = indices.slice(cut);
    if (rw >= rh) {
      const lw = Math.max(4, rw * ratio - gap / 2);
      split(left, rx, ry, lw, rh);
      split(right, rx + lw + gap, ry, Math.max(4, rw - lw - gap), rh);
    } else {
      const lh = Math.max(4, rh * ratio - gap / 2);
      split(left, rx, ry, rw, lh);
      split(right, rx, ry + lh + gap, rw, Math.max(4, rh - lh - gap));
    }
  };
  split(values.map((_, i) => i), x, y, w, h);
  return out;
}
