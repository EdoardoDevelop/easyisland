// Matrice delle connessioni: top pages in a square grid so dense clusters
// and missing links jump out at a glance. Hover for relation details, click to pick.

import { KIND_COLOR, alpha, fit, type MemNode, type Model } from "./data";
import { t } from "../core/i18n";
import { animateIdle, type Colouring, type View } from "./stage";
import { font, paintBackground, pal } from "./theme";
import { roundRect } from "./mindmap";

const MAX_ITEMS = 22;

export class MatrixView implements View {
  private model: Model | null = null;
  private items: MemNode[] = [];
  private edges = new Map<string, { strength: number; label: string }>();
  private selected: string | null = null;
  private filter: Set<string> | null = null;
  private colouring: Colouring = "group";
  private hovered: string | null = null;
  private hoverCell: { r: number; c: number } | null = null;
  private size = { w: 0, h: 0 };
  private layoutBox = { x: 0, y: 0, cell: 24 };

  setModel(model: Model) {
    this.model = model;
    const pages = model.g.nodes
      .filter((n) => n.kind === "page" || n.kind === "missing")
      .sort((a, b) => b.weight - a.weight)
      .slice(0, MAX_ITEMS);
    const chosen = pages.length ? pages : [...model.g.nodes].sort((a, b) => b.weight - a.weight).slice(0, MAX_ITEMS);
    // Group blocks along the diagonal by sorting by group color first, then weight.
    const { of } = model.groups();
    this.items = [...chosen].sort((a, b) => {
      const ga = of.get(a.id) ?? 9999;
      const gb = of.get(b.id) ?? 9999;
      return ga !== gb ? ga - gb : b.weight - a.weight;
    });
    const set = new Set(this.items.map((n) => n.id));
    this.edges.clear();
    for (const e of model.g.edges) {
      if (!set.has(e.from) || !set.has(e.to)) continue;
      const s = e.strength ?? 3;
      for (const [a, b] of [[e.from, e.to], [e.to, e.from]]) {
        const k = `${a}\n${b}`;
        const prev = this.edges.get(k);
        if (!prev || s > prev.strength) this.edges.set(k, { strength: s, label: e.label });
      }
    }
  }

  setSelected(id: string | null) {
    this.selected = id;
  }

  setFilter(ids: Set<string> | null) {
    this.filter = ids;
  }

  setColouring(c: Colouring) {
    this.colouring = c;
  }

  setHover(id: string | null) {
    this.hovered = id;
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, time = 0): boolean {
    this.size = { w, h };
    paintBackground(ctx, w, h);
    const p = pal();
    const idle = animateIdle();
    const n = this.items.length;
    if (!n) {
      ctx.fillStyle = p.dim;
      ctx.font = font(13);
      ctx.textAlign = "center";
      ctx.fillText(t("Ancora nessuna pagina"), w / 2, h / 2);
      return false;
    }

    const labelW = Math.min(160, Math.max(95, w * 0.18));
    const pad = 28;
    const avail = Math.min(w - labelW - pad * 2, h - labelW - pad * 2);
    const cell = Math.max(12, Math.min(34, Math.floor(avail / n)));
    const gridW = cell * n;
    const x0 = Math.max(labelW + 12, Math.round((w - gridW + labelW) / 2));
    const y0 = Math.max(labelW + 12, Math.round((h - gridW + labelW) / 2));
    this.layoutBox = { x: x0, y: y0, cell };

    const pulse = idle ? 0.5 + 0.5 * Math.sin(time * 0.003) : 0.5;
    const colourOf = (node: MemNode) =>
      this.colouring === "group" ? (this.model?.groupColor(node.id) ?? KIND_COLOR[node.kind]) : KIND_COLOR[node.kind];

    // Row & column hover/selection highlight bands.
    for (let i = 0; i < n; i++) {
      const node = this.items[i];
      const active = node.id === this.selected || node.id === this.hovered || this.hoverCell?.r === i;
      if (active) {
        ctx.fillStyle = alpha(p.accent, p.light ? 0.08 : 0.1);
        ctx.fillRect(x0, y0 + i * cell, gridW, cell);
      }
      const activeCol = node.id === this.selected || node.id === this.hovered || this.hoverCell?.c === i;
      if (activeCol) {
        ctx.fillStyle = alpha(p.accent, p.light ? 0.08 : 0.1);
        ctx.fillRect(x0 + i * cell, y0, cell, gridW);
      }
    }

    // Cells.
    for (let r = 0; r < n; r++) {
      const a = this.items[r];
      const colA = colourOf(a);
      for (let c = 0; c < n; c++) {
        const b = this.items[c];
        const cx = x0 + c * cell + 1.5;
        const cy = y0 + r * cell + 1.5;
        const sz = cell - 3;
        const dim = this.filter && !this.filter.has(a.id) && !this.filter.has(b.id);
        if (r === c) {
          roundRect(ctx, cx, cy, sz, sz, 4);
          ctx.fillStyle = alpha(colA, dim ? 0.15 : 0.45 + pulse * 0.15);
          ctx.fill();
          continue;
        }
        const edge = this.edges.get(`${a.id}\n${b.id}`);
        if (!edge) {
          roundRect(ctx, cx, cy, sz, sz, 3);
          ctx.fillStyle = p.light ? "rgba(0,0,0,0.03)" : "rgba(255,255,255,0.025)";
          ctx.fill();
          continue;
        }
        const strengthAlpha = edge.strength >= 3 ? 0.85 : edge.strength === 2 ? 0.55 : 0.3;
        const isSel = a.id === this.selected || b.id === this.selected;
        roundRect(ctx, cx, cy, sz, sz, 4);
        ctx.fillStyle = alpha(colA, dim ? 0.15 : isSel ? 0.95 : strengthAlpha);
        ctx.fill();
        if (this.hoverCell?.r === r && this.hoverCell?.c === c) {
          ctx.strokeStyle = p.ring;
          ctx.lineWidth = 1.6;
          ctx.stroke();
        }
      }
    }

    // Row & column labels.
    const fSize = Math.max(10, Math.min(12, cell * 0.52));
    ctx.font = font(fSize, 500);
    for (let i = 0; i < n; i++) {
      const node = this.items[i];
      const isFocus = node.id === this.selected || node.id === this.hovered || this.hoverCell?.r === i || this.hoverCell?.c === i;
      const lbl = fit(ctx, node.label, labelW - 14);
      ctx.fillStyle = isFocus ? p.ink : p.dim;
      ctx.font = font(fSize, isFocus ? 600 : 500);
      // Left row label.
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(lbl, x0 - 8, y0 + i * cell + cell / 2);
      // Top rotated column label.
      ctx.save();
      ctx.translate(x0 + i * cell + cell / 2, y0 - 8);
      ctx.rotate(-Math.PI / 4);
      ctx.textAlign = "left";
      ctx.fillText(lbl, 0, 0);
      ctx.restore();
    }

    return idle;
  }

  private cellAt(x: number, y: number): { r: number; c: number } | null {
    const { x: x0, y: y0, cell } = this.layoutBox;
    const n = this.items.length;
    const c = Math.floor((x - x0) / cell);
    const r = Math.floor((y - y0) / cell);
    if (r >= 0 && r < n && c >= 0 && c < n) return { r, c };
    return null;
  }

  hit(x: number, y: number): string | null {
    const { x: x0, y: y0, cell } = this.layoutBox;
    const n = this.items.length;
    const cellHit = this.cellAt(x, y);
    if (cellHit) return this.items[cellHit.r].id;
    // Row label hit.
    if (x < x0 && y >= y0 && y <= y0 + n * cell) {
      const r = Math.floor((y - y0) / cell);
      return this.items[r]?.id ?? null;
    }
    return null;
  }

  hover(x: number, y: number) {
    const cell = this.cellAt(x, y);
    this.hoverCell = cell;
    if (!cell) return null;
    const a = this.items[cell.r];
    const b = this.items[cell.c];
    if (a.id === b.id) return { text: a.label, sub: t("{n} collegamenti", { n: a.weight }) };
    const edge = this.edges.get(`${a.id}\n${b.id}`);
    return {
      text: `${a.label} ↔ ${b.label}`,
      sub: edge ? (edge.label || t("Collegati")) : t("Nessun collegamento diretto"),
    };
  }

  pan() {}
  zoom() {}
  reset() {
    void this.size;
  }
}
