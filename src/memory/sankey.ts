// Da dove arriva: flows from where the memory is fed — the chat, Agent Chat,
// another PC, tickets, mail, calls, Telegram, the files read — to the pages
// they end up in. A note counts towards each page it is linked to; a file read
// towards the pages that cite it. The biggest twelve pages, the rest together.

import { KIND_COLOR, alpha, fit, provenance, provenanceName, type Model, type Provenance } from "./data";
import { t } from "../core/i18n";
import { animateIdle, type View } from "./stage";
import { font, paintBackground, pal } from "./theme";

const SOURCE_COLOUR: Record<Provenance, string> = {
  chat: "#7c9cff",
  agentchat: "#8b5cf6",
  pc: "#22d3ee",
  ticket: "#f59e0b",
  mail: "#38bdf8",
  call: "#22c55e",
  telegram: "#29a9eb",
  file: "#a3e635",
};

const MAX_PAGES = 12;

interface Side {
  id: string;
  label: string;
  colour: string;
  value: number;
  y0: number;
  y1: number;
}

interface Flow {
  from: Side;
  to: Side;
  value: number;
  /** Where it leaves and lands (screen px), set when drawn. */
  a0: number;
  a1: number;
  b0: number;
  b1: number;
}

export class SankeyView implements View {
  private sources: Side[] = [];
  private pages: Side[] = [];
  private flows: Flow[] = [];
  private selected: string | null = null;
  private hot: Flow | null = null;
  private x0 = 0;
  private x1 = 0;

  setModel(model: Model) {
    const counts = new Map<string, number>();
    const pageIds = new Set(model.g.nodes.filter((n) => n.kind === "page" || n.kind === "missing").map((n) => n.id));
    for (const n of model.g.nodes) {
      if (n.kind !== "note" && n.kind !== "old" && n.kind !== "source") continue;
      const p = provenance(n);
      for (const nb of model.neighbours(n.id)) {
        if (!pageIds.has(nb.id)) continue;
        const key = `${p}\n${nb.id}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }
    const perPage = new Map<string, number>();
    for (const [k, v] of counts) {
      const page = k.split("\n")[1];
      perPage.set(page, (perPage.get(page) ?? 0) + v);
    }
    const top = [...perPage.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_PAGES).map(([id]) => id);
    const topSet = new Set(top);
    const srcMap = new Map<Provenance, Side>();
    const pageMap = new Map<string, Side>();
    const others: Side = { id: "", label: t("Altre pagine"), colour: "#8a8f99", value: 0, y0: 0, y1: 0 };
    this.flows = [];
    const flowMap = new Map<string, Flow>();
    for (const [k, v] of counts) {
      const [p, page] = k.split("\n") as [Provenance, string];
      const src = srcMap.get(p) ?? { id: p, label: provenanceName(p), colour: SOURCE_COLOUR[p], value: 0, y0: 0, y1: 0 };
      srcMap.set(p, src);
      src.value += v;
      let dst: Side;
      if (topSet.has(page)) {
        const n = model.byId.get(page)!;
        dst = pageMap.get(page) ?? { id: page, label: n.label, colour: model.groupColor(page) ?? KIND_COLOR[n.kind], value: 0, y0: 0, y1: 0 };
        pageMap.set(page, dst);
      } else {
        dst = others;
      }
      dst.value += v;
      const fk = `${p}\n${dst.id}`;
      const f = flowMap.get(fk) ?? { from: src, to: dst, value: 0, a0: 0, a1: 0, b0: 0, b1: 0 };
      f.value += v;
      flowMap.set(fk, f);
    }
    this.sources = [...srcMap.values()].sort((a, b) => b.value - a.value);
    this.pages = top.map((id) => pageMap.get(id)!).filter(Boolean);
    if (others.value) this.pages.push(others);
    this.flows = [...flowMap.values()];
  }

  setSelected(id: string | null) {
    this.selected = id;
  }

  setFilter() {}

  private lay(sides: Side[], top: number, bottom: number) {
    const total = sides.reduce((s, x) => s + x.value, 0);
    const gap = 10;
    const room = bottom - top - gap * Math.max(0, sides.length - 1);
    let y = top;
    for (const s of sides) {
      const hgt = Math.max(4, (s.value / Math.max(1, total)) * room);
      s.y0 = y;
      s.y1 = y + hgt;
      y += hgt + gap;
    }
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, time = 0): boolean {
    paintBackground(ctx, w, h);
    const p = pal();
    const idle = animateIdle();
    if (!this.flows.length) {
      ctx.fillStyle = p.dim;
      ctx.font = font(13);
      ctx.textAlign = "center";
      ctx.fillText(t("Ancora nessuna nota collegata a una pagina"), w / 2, h / 2);
      return idle;
    }
    const top = 36;
    const bottom = h - 36;
    this.x0 = Math.min(220, w * 0.24);
    this.x1 = w - Math.min(260, w * 0.3);
    this.lay(this.sources, top, bottom);
    this.lay(this.pages, top, bottom);
    // Where each flow leaves its source and lands on its page, stacked.
    const outAt = new Map<Side, number>(this.sources.map((s) => [s, s.y0]));
    const inAt = new Map<Side, number>(this.pages.map((s) => [s, s.y0]));
    const sorted = [...this.flows].sort((a, b) => this.pages.indexOf(a.to) - this.pages.indexOf(b.to));
    for (const f of sorted) {
      const hs = ((f.from.y1 - f.from.y0) * f.value) / f.from.value;
      const hp = ((f.to.y1 - f.to.y0) * f.value) / f.to.value;
      f.a0 = outAt.get(f.from)!;
      f.a1 = f.a0 + hs;
      outAt.set(f.from, f.a1);
      f.b0 = inAt.get(f.to)!;
      f.b1 = f.b0 + hp;
      inAt.set(f.to, f.b1);
    }
    const sel = this.selected;
    const mid = (this.x0 + this.x1) / 2;
    for (const f of this.flows) {
      const on = this.hot ? f === this.hot : !sel || f.to.id === sel;
      const g = ctx.createLinearGradient(this.x0, 0, this.x1, 0);
      g.addColorStop(0, alpha(f.from.colour, on ? 0.6 : 0.12));
      g.addColorStop(1, alpha(f.to.colour, on ? 0.6 : 0.12));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.moveTo(this.x0, f.a0);
      ctx.bezierCurveTo(mid, f.a0, mid, f.b0, this.x1, f.b0);
      ctx.lineTo(this.x1, f.b1);
      ctx.bezierCurveTo(mid, f.b1, mid, f.a1, this.x0, f.a1);
      ctx.closePath();
      ctx.fill();
      // Subtle flowing light particle along active ribbons.
      if (idle && on) {
        const u = ((time * 0.00028 + (f.a0 + f.b0) * 0.0017) % 1 + 1) % 1;
        const q = 1 - u;
        const ay = (f.a0 + f.a1) / 2;
        const by = (f.b0 + f.b1) / 2;
        const px = q * q * q * this.x0 + 3 * q * q * u * mid + 3 * q * u * u * mid + u * u * u * this.x1;
        const py = q * q * q * ay + 3 * q * q * u * ay + 3 * q * u * u * by + u * u * u * by;
        ctx.fillStyle = alpha("#ffffff", p.light ? 0.5 : 0.55);
        ctx.beginPath();
        ctx.arc(px, py, Math.min(3.5, Math.max(1.5, (f.a1 - f.a0) * 0.18)), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    // The two columns, with their names and numbers.
    ctx.font = font(12, 600);
    ctx.textBaseline = "middle";
    // A name only where the one above has ended (thin bands crowd them).
    let after = -Infinity;
    for (const s of this.sources) {
      ctx.fillStyle = s.colour;
      ctx.fillRect(this.x0 - 10, s.y0, 10, s.y1 - s.y0);
      ctx.fillStyle = p.ink;
      ctx.textAlign = "right";
      const y = (s.y0 + s.y1) / 2;
      if (y - 8 < after) continue;
      after = y + 8;
      ctx.fillText(`${s.label} · ${s.value}`, this.x0 - 16, y);
    }
    after = -Infinity;
    for (const s of this.pages) {
      ctx.fillStyle = s.colour;
      ctx.fillRect(this.x1, s.y0, 10, s.y1 - s.y0);
      ctx.fillStyle = s.id === sel ? p.accent : p.ink;
      ctx.textAlign = "left";
      const y = (s.y0 + s.y1) / 2;
      if (y - 8 < after && s.id !== sel) continue;
      after = y + 8;
      ctx.fillText(fit(ctx, `${s.label} · ${s.value}`, w - this.x1 - 26), this.x1 + 16, y);
    }
    return idle;
  }

  private flowAt(x: number, y: number): Flow | null {
    if (x < this.x0 || x > this.x1) return null;
    const u = (x - this.x0) / (this.x1 - this.x0);
    // The bezier with flat ends: ease in and out between the two heights.
    const s = u * u * (3 - 2 * u);
    return this.flows.find((f) => {
      const top = f.a0 + (f.b0 - f.a0) * s;
      const bot = f.a1 + (f.b1 - f.a1) * s;
      return y >= top && y <= bot;
    }) ?? null;
  }

  hit(x: number, y: number): string | null {
    const page = this.pages.find((p) => x >= this.x1 && y >= p.y0 && y <= p.y1);
    if (page?.id) return page.id;
    return this.flowAt(x, y)?.to.id || null;
  }

  hover(x: number, y: number) {
    const f = this.flowAt(x, y);
    this.hot = f;
    return f ? { text: `${f.from.label} → ${f.to.label}`, sub: t("{n} collegamenti", { n: f.value }) } : null;
  }

  pan() {}

  zoom() {}

  reset() {
    this.hot = null;
  }
}
