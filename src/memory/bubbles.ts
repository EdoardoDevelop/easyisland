// Bolle: one bubble per group, as big as what it holds, with its pages and
// notes as smaller bubbles inside; what belongs to no group floats in a last
// grey bubble. Packed by a spiral search (each circle at the closest free
// place to the middle), drawn once: nothing moves unless you pan or zoom.

import { KIND_COLOR, alpha, type MemNode, type Model } from "./data";
import { animateIdle, Camera, type View } from "./stage";
import { Placer, label } from "./labels";
import { inkOf, paintBackground, pal } from "./theme";

interface Circle {
  x: number;
  y: number;
  r: number;
}

interface Bubble extends Circle {
  name: string;
  colour: string;
  inner: (Circle & { n: MemNode; colour: string })[];
}

export class BubblesView implements View {
  private cam = new Camera();
  private bubbles: Bubble[] = [];
  private selected: string | null = null;
  private filter: Set<string> | null = null;
  private framed = false;
  private size = { w: 0, h: 0 };

  setModel(model: Model) {
    const { groups, of } = model.groups();
    const sets: { name: string; colour: string; nodes: MemNode[] }[] = groups.map((g) => ({
      name: g.name, colour: g.color, nodes: g.members.map((id) => model.byId.get(id)!),
    }));
    const loose = model.g.nodes.filter((n) => !of.has(n.id) && n.kind !== "day");
    if (loose.length) sets.push({ name: "", colour: "#8a8f99", nodes: loose });
    // Inside each group: the nodes packed around their middle.
    const made: Bubble[] = sets.map((s) => {
      const items = s.nodes
        .map((n) => ({ n, r: (n.kind === "page" || n.kind === "missing" ? 9 : 4.5) + Math.min(10, Math.sqrt(n.weight) * 1.8) }))
        .sort((a, b) => b.r - a.r);
      const placed = pack(items.map((i) => i.r), 1.5);
      const inner = items.map((it, i) => ({ ...placed[i], n: it.n, colour: s.name ? s.colour : KIND_COLOR[it.n.kind] }));
      const r = Math.max(20, ...inner.map((c) => Math.hypot(c.x, c.y) + c.r)) + 10;
      return { x: 0, y: 0, r, name: s.name, colour: s.colour, inner };
    });
    // Then the groups themselves.
    made.sort((a, b) => b.r - a.r);
    const at = pack(made.map((b) => b.r), 14);
    made.forEach((b, i) => {
      b.x = at[i].x;
      b.y = at[i].y;
    });
    this.bubbles = made;
    this.framed = false;
  }

  private hovered: string | null = null;

  setHover(id: string | null) {
    this.hovered = id;
  }

  setSelected(id: string | null) {
    this.selected = id;
  }

  setFilter(ids: Set<string> | null) {
    this.filter = ids;
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, time = 0): boolean {
    this.size = { w, h };
    if (!this.framed && this.bubbles.length) {
      this.cam.frame(box(this.bubbles), w, h, true, 30);
      this.framed = true;
    }
    const moving = this.cam.step();
    const idle = animateIdle();
    paintBackground(ctx, w, h);
    const p = pal();
    ctx.save();
    this.cam.apply(ctx);
    const k = this.cam.k;
    const sel = this.selected;
    const names: { text: string; x: number; y: number; score: number; color?: string; pillColor?: string; group: boolean }[] = [];
    this.bubbles.forEach((b, bi) => {
      const floatY = idle ? (Math.sin(time * 0.0014 + bi * 1.3) * 3.5) / k : 0;
      const by = b.y + floatY;
      // The group's bubble: a soft glassmorphic radial tint with a luminous rim.
      const ggrad = ctx.createRadialGradient(b.x - b.r * 0.25, by - b.r * 0.25, b.r * 0.1, b.x, by, b.r);
      ggrad.addColorStop(0, alpha(b.colour, p.light ? 0.15 : 0.19));
      ggrad.addColorStop(0.75, alpha(b.colour, p.light ? 0.07 : 0.09));
      ggrad.addColorStop(1, alpha(b.colour, p.light ? 0.04 : 0.05));
      ctx.fillStyle = ggrad;
      ctx.beginPath();
      ctx.arc(b.x, by, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = alpha(b.colour, 0.7);
      ctx.lineWidth = 1.3 / k;
      ctx.stroke();
      for (const c of b.inner) {
        const x = b.x + c.x;
        const y = by + c.y;
        const on = (!sel && !this.filter) || c.n.id === sel || !!this.filter?.has(c.n.id);
        const page = c.n.kind === "page" || c.n.kind === "missing";
        ctx.fillStyle = alpha(c.colour, on ? (page ? 0.92 : 0.62) : 0.15);
        ctx.beginPath();
        ctx.arc(x, y, c.r, 0, Math.PI * 2);
        ctx.fill();
        if (page && on && c.n.id !== sel && c.n.id !== this.hovered) {
          ctx.strokeStyle = p.light ? "rgba(0,0,0,0.2)" : "rgba(255,255,255,0.28)";
          ctx.lineWidth = 1 / k;
          ctx.stroke();
        }
        if (c.n.id === sel || c.n.id === this.hovered) {
          ctx.strokeStyle = p.ring;
          ctx.lineWidth = 2 / k;
          ctx.stroke();
        }
        const forced = c.n.id === sel || c.n.id === this.hovered;
        if (forced || (on && page && c.r * k > 14)) names.push({ text: c.n.label, x, y, score: forced ? 1e9 : c.r, pillColor: c.colour, group: false });
      }
      if (b.name) names.push({ text: b.name, x: b.x, y: by - b.r, score: 1e6 + b.r, color: inkOf(b.colour), pillColor: b.colour, group: true });
    });
    ctx.restore();
    // Names in screen pixels, the biggest first; never one on another.
    const placer = new Placer();
    names.sort((a, b) => b.score - a.score);
    for (const n of names) {
      const at = this.cam.toScreen(n.x, n.y);
      if (n.group) label(ctx, placer, n.text, at.x, at.y - 4, { size: 13, weight: 600, color: n.color, baseline: "bottom", max: 240, pill: true, pillColor: n.pillColor });
      else label(ctx, placer, n.text, at.x, at.y, { size: 12, weight: n.score >= 1e9 ? 600 : 500, baseline: "middle", force: n.score >= 1e9, max: 160, pill: n.score >= 1e9, pillColor: n.pillColor });
    }
    return moving || idle;
  }

  hit(x: number, y: number): string | null {
    const p = this.cam.toWorld(x, y);
    for (const b of this.bubbles) {
      if (Math.hypot(p.x - b.x, p.y - b.y) > b.r) continue;
      for (const c of b.inner) if (Math.hypot(p.x - b.x - c.x, p.y - b.y - c.y) <= c.r) return c.n.id;
    }
    return null;
  }

  hover(x: number, y: number) {
    const p = this.cam.toWorld(x, y);
    const b = this.bubbles.find((b) => Math.hypot(p.x - b.x, p.y - b.y) <= b.r);
    return b?.name ? { text: b.name, sub: `${b.inner.length}` } : null;
  }

  pan(dx: number, dy: number) {
    this.cam.pan(dx, dy);
  }

  zoom(f: number, x: number, y: number) {
    this.cam.zoom(f, x, y);
  }

  reset() {
    this.cam.frame(box(this.bubbles), this.size.w, this.size.h, false, 30);
  }
}

/**
 * Circles of radii `rs` (biggest first) packed around (0,0): each one at the
 * first free place along a spiral, `gap` apart.
 */
export function pack(rs: number[], gap: number): Circle[] {
  const out: Circle[] = [];
  for (const r of rs) {
    if (!out.length) {
      out.push({ x: 0, y: 0, r });
      continue;
    }
    let placed: Circle | null = null;
    for (let t = 0; t < 4000 && !placed; t++) {
      const a = t * 0.35;
      const d = 2 * Math.sqrt(t) * Math.max(2, r * 0.35);
      const c = { x: Math.cos(a) * d, y: Math.sin(a) * d, r };
      if (out.every((o) => Math.hypot(o.x - c.x, o.y - c.y) >= o.r + r + gap)) placed = c;
    }
    out.push(placed ?? { x: 0, y: (out.length + 1) * r * 2, r });
  }
  return out;
}

function box(list: Circle[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of list) {
    x0 = Math.min(x0, c.x - c.r);
    y0 = Math.min(y0, c.y - c.r);
    x1 = Math.max(x1, c.x + c.r);
    y1 = Math.max(y1, c.y + c.r);
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : { x0: -100, y0: -100, x1: 100, y1: 100 };
}
