// Salute della memoria: visual dashboard of coverage, orphan notes,
// missing pages and top hubs. Clicking any card selects that node.

import { KIND_COLOR, alpha, fit, kindName, type MemNode, type Model, type NodeKind } from "./data";
import { t } from "../core/i18n";
import { animateIdle, type View } from "./stage";
import { font, paintBackground, pal } from "./theme";
import { roundRect } from "./mindmap";

interface HitItem {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

export class HealthView implements View {
  private model: Model | null = null;
  private selected: string | null = null;
  private hovered: string | null = null;
  private hits: HitItem[] = [];
  private born = 0;

  setModel(model: Model) {
    this.model = model;
    this.born = performance.now();
  }

  setSelected(id: string | null) {
    this.selected = id;
  }

  setFilter() {}

  setHover(id: string | null) {
    this.hovered = id;
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, time = 0): boolean {
    paintBackground(ctx, w, h);
    const idle = animateIdle();
    const m = this.model;
    this.hits = [];
    if (!m) return false;

    const intro = Math.min(1, (time - this.born) / 650);
    const ease = 1 - Math.pow(1 - intro, 3);
    const pulse = idle ? 0.5 + 0.5 * Math.sin(time * 0.0022) : 0.5;

    const pages = m.g.nodes.filter((n) => n.kind === "page");
    const missing = m.g.nodes.filter((n) => n.kind === "missing");
    const notes = m.g.nodes.filter((n) => n.kind === "note");
    const lonely = m.lonely();
    const linkedNotes = Math.max(0, notes.length - lonely.length);

    const pad = w < 560 ? 12 : 24;
    const stacked = w < 540;
    const gaugeH = stacked ? 124 : 144;
    const colW = stacked ? Math.min(460, w - pad * 2) : Math.min(340, (w - pad * 3) / 2);
    const startX = stacked ? Math.max(pad, (w - colW) / 2) : Math.max(pad, (w - colW * 2 - pad) / 2);
    const totalW = stacked ? colW : colW * 2 + pad;
    const distH = 74;

    // Top 2 animated radial gauges.
    this.drawGauge(
      ctx,
      startX,
      pad,
      colW,
      gaugeH,
      t("Pagine scritte"),
      pages.length,
      pages.length + missing.length,
      KIND_COLOR.page,
      t("{n} da scrivere", { n: missing.length }),
      ease,
      pulse,
    );
    this.drawGauge(
      ctx,
      stacked ? startX : startX + colW + pad,
      stacked ? pad + gaugeH + 12 : pad,
      colW,
      gaugeH,
      t("Note collegate"),
      linkedNotes,
      notes.length,
      KIND_COLOR.note,
      t("{n} isolate", { n: lonely.length }),
      ease,
      pulse,
    );

    // Interactive action lists: Top Hubs & Da collegare / Da scrivere.
    const listY = stacked ? pad + (gaugeH + 12) * 2 : pad + gaugeH + 16;
    const listH = stacked ? Math.max(100, (h - listY - distH - pad * 2) / 2) : Math.max(120, h - listY - distH - pad - 16);
    const hubs = [...pages].sort((a, b) => b.weight - a.weight).slice(0, 8);
    const todo: MemNode[] = [...missing.slice(0, 4), ...lonely.slice(0, 4)].slice(0, 8);

    this.drawListCard(ctx, startX, listY, colW, listH, t("Argomenti principali"), hubs, KIND_COLOR.page, true);
    this.drawListCard(
      ctx,
      stacked ? startX : startX + colW + pad,
      stacked ? listY + listH + 12 : listY,
      colW,
      listH,
      t("Da completare o collegare"),
      todo,
      "#e84855",
      false,
    );

    // 3rd section: distribution breakdown by node kind.
    const distY = stacked ? listY + listH * 2 + 24 : listY + listH + 16;
    if (distY + distH <= h - 6) {
      const p = pal();
      roundRect(ctx, startX, distY, totalW, distH, 10);
      ctx.fillStyle = p.card;
      ctx.fill();
      ctx.strokeStyle = p.line;
      ctx.lineWidth = 1;
      ctx.stroke();

      ctx.fillStyle = p.ink;
      ctx.font = font(12.5, 600);
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(t("Composizione della memoria"), startX + 14, distY + 18);

      const counts = new Map<NodeKind, number>();
      for (const n of m.g.nodes) counts.set(n.kind, (counts.get(n.kind) ?? 0) + 1);
      const kinds = (["page", "note", "source", "day", "old", "missing"] as NodeKind[]).filter((k) => (counts.get(k) ?? 0) > 0);
      const sumNodes = Math.max(1, m.g.nodes.length);
      const barX = startX + 14;
      const barW = totalW - 28;
      let cx = barX;
      kinds.forEach((k) => {
        const bw = ((counts.get(k) ?? 0) / sumNodes) * barW;
        if (bw >= 2) {
          ctx.fillStyle = KIND_COLOR[k];
          ctx.fillRect(cx, distY + 32, Math.max(2, bw - 2), 10);
        }
        cx += bw;
      });
      let lx = barX;
      ctx.font = font(11.5);
      for (const k of kinds) {
        const txt = `${kindName(k)} ${counts.get(k)}`;
        const tw = ctx.measureText(txt).width + 20;
        if (lx + tw > startX + totalW - 10) break;
        ctx.fillStyle = KIND_COLOR[k];
        ctx.beginPath();
        ctx.arc(lx + 4, distY + 56, 3.5, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = p.dim;
        ctx.fillText(txt, lx + 12, distY + 56);
        lx += tw;
      }
    }

    return intro < 1 || idle;
  }

  private drawGauge(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    title: string,
    val: number,
    total: number,
    color: string,
    sub: string,
    ease: number,
    pulse: number,
  ) {
    const p = pal();
    roundRect(ctx, x, y, w, h, 10);
    ctx.fillStyle = p.card;
    ctx.fill();
    ctx.strokeStyle = p.line;
    ctx.lineWidth = 1;
    ctx.stroke();

    const pct = total > 0 ? val / total : 1;
    const cx = x + 68;
    const cy = y + h / 2;
    const r = 42;

    ctx.strokeStyle = alpha(color, 0.16);
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    ctx.strokeStyle = color;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * pct * ease);
    ctx.stroke();

    // Subtle ambient glow dot at arc tip.
    if (pct > 0.02) {
      const a = -Math.PI / 2 + Math.PI * 2 * pct * ease;
      ctx.fillStyle = alpha(color, 0.35 + pulse * 0.35);
      ctx.beginPath();
      ctx.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 7, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.fillStyle = p.ink;
    ctx.font = font(16, 700);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${Math.round(pct * 100)}%`, cx, cy);

    const tx = x + 130;
    ctx.textAlign = "left";
    ctx.font = font(14, 600);
    ctx.fillText(fit(ctx, title, w - 144), tx, cy - 18);
    ctx.fillStyle = p.dim;
    ctx.font = font(12.5);
    ctx.fillText(`${val} / ${total}`, tx, cy + 4);
    ctx.fillStyle = color;
    ctx.fillText(fit(ctx, sub, w - 144), tx, cy + 24);
  }

  private drawListCard(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    title: string,
    nodes: MemNode[],
    color: string,
    showBar: boolean,
  ) {
    const p = pal();
    roundRect(ctx, x, y, w, h, 10);
    ctx.fillStyle = p.card;
    ctx.fill();
    ctx.strokeStyle = p.line;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = p.ink;
    ctx.font = font(13, 600);
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(title, x + 14, y + 20);

    if (!nodes.length) {
      ctx.fillStyle = p.dim;
      ctx.font = font(12);
      ctx.fillText(t("Tutto in ordine."), x + 14, y + 52);
      return;
    }

    const maxW = Math.max(1, ...nodes.map((n) => n.weight));
    const rowH = Math.min(34, Math.floor((h - 44) / nodes.length));
    nodes.forEach((n, i) => {
      const ry = y + 38 + i * rowH;
      const isSel = n.id === this.selected || n.id === this.hovered;
      if (isSel) {
        roundRect(ctx, x + 8, ry, w - 16, rowH - 4, 6);
        ctx.fillStyle = alpha(p.accent, 0.14);
        ctx.fill();
      }
      ctx.fillStyle = KIND_COLOR[n.kind] || color;
      ctx.beginPath();
      ctx.arc(x + 20, ry + (rowH - 4) / 2, 3.5, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = p.ink;
      ctx.font = font(12, isSel ? 600 : 500);
      ctx.textAlign = "left";
      ctx.fillText(fit(ctx, n.label, w - 110), x + 32, ry + (rowH - 4) / 2);

      if (showBar) {
        const bw = Math.max(6, ((n.weight / maxW) * 56));
        roundRect(ctx, x + w - 72, ry + (rowH - 4) / 2 - 3, bw, 6, 3);
        ctx.fillStyle = alpha(color, 0.75);
        ctx.fill();
      } else {
        ctx.fillStyle = p.dim;
        ctx.font = font(11);
        ctx.textAlign = "right";
        ctx.fillText(n.kind === "missing" ? t("da scrivere") : t("isolata"), x + w - 14, ry + (rowH - 4) / 2);
      }

      this.hits.push({ id: n.id, x: x + 8, y: ry, w: w - 16, h: rowH - 4 });
    });
  }

  hit(x: number, y: number): string | null {
    for (const h of this.hits) {
      if (x >= h.x && x <= h.x + h.w && y >= h.y && y <= h.y + h.h) return h.id;
    }
    return null;
  }

  pan() {}
  zoom() {}
  reset() {}
}
