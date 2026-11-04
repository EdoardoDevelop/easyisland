// Bolle: one bubble per group, as big as what it holds, with its pages and
// notes as smaller bubbles inside; what belongs to no group floats in a last
// grey bubble. Packed by a spiral search (each circle at the closest free
// place to the middle), drawn once: nothing moves unless you pan or zoom.

import { KIND_COLOR, alpha, fit, type MemNode, type Model } from "./data";
import { Camera, type View } from "./stage";

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
    if (loose.length) sets.push({ name: "", colour: "#5b6070", nodes: loose });
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

  setSelected(id: string | null) {
    this.selected = id;
  }

  setFilter(ids: Set<string> | null) {
    this.filter = ids;
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
    this.size = { w, h };
    if (!this.framed && this.bubbles.length) {
      this.cam.frame(box(this.bubbles), w, h, true, 30);
      this.framed = true;
    }
    const moving = this.cam.step();
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    bg.addColorStop(0, "#0c0f1a");
    bg.addColorStop(1, "#05060a");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    this.cam.apply(ctx);
    const k = this.cam.k;
    const sel = this.selected;
    for (const b of this.bubbles) {
      // The group's bubble: glassy, lit from the top left.
      const g = ctx.createRadialGradient(b.x - b.r * 0.4, b.y - b.r * 0.5, b.r * 0.1, b.x, b.y, b.r);
      g.addColorStop(0, alpha(b.colour, 0.28));
      g.addColorStop(0.8, alpha(b.colour, 0.1));
      g.addColorStop(1, alpha(b.colour, 0.35));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = alpha(b.colour, 0.6);
      ctx.lineWidth = 1.2 / k;
      ctx.stroke();
      for (const c of b.inner) {
        const x = b.x + c.x;
        const y = b.y + c.y;
        const on = (!sel && !this.filter) || c.n.id === sel || !!this.filter?.has(c.n.id);
        const page = c.n.kind === "page" || c.n.kind === "missing";
        const fill = ctx.createRadialGradient(x - c.r * 0.35, y - c.r * 0.4, c.r * 0.1, x, y, c.r);
        fill.addColorStop(0, `rgba(255,255,255,${on ? 0.75 : 0.15})`);
        fill.addColorStop(0.4, alpha(c.colour, on ? (page ? 0.85 : 0.6) : 0.15));
        fill.addColorStop(1, alpha(c.colour, on ? 0.4 : 0.08));
        ctx.fillStyle = fill;
        ctx.beginPath();
        ctx.arc(x, y, c.r, 0, Math.PI * 2);
        ctx.fill();
        if (c.n.id === sel) {
          ctx.strokeStyle = "#ffffff";
          ctx.lineWidth = 2 / k;
          ctx.stroke();
        }
        if (page && c.r * k > 16) {
          ctx.fillStyle = "#0a0c12";
          ctx.font = `600 ${Math.min(12, c.r * 0.45)}px system-ui, "Segoe UI", sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.fillText(fit(ctx, c.n.label, c.r * 1.8), x, y);
        }
      }
      if (b.name) {
        ctx.fillStyle = alpha(b.colour, 0.95);
        ctx.font = `700 ${Math.max(11, Math.min(18, b.r / 7)) / Math.min(1, k)}px system-ui, "Segoe UI", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "bottom";
        ctx.fillText(fit(ctx, b.name, b.r * 1.8), b.x, b.y - b.r - 4 / k);
      }
    }
    ctx.restore();
    return moving;
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
