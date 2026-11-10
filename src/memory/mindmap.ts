// Mind Map: one subject in the middle and what grows from it, three rings out.
// Each first branch has its colour; picking another node moves it to the
// middle with the branches flowing to their new places.

import { KIND_COLOR, alpha, fit, type Model } from "./data";
import { Camera, starfield, type View } from "./stage";
import { Placer, label, type Rect } from "./labels";
import { font, pal } from "./theme";

interface Twig {
  id: string;
  label: string;
  depth: number;
  parent: string | null;
  /** The relation from the parent. */
  rel: string;
  hue: string;
  x: number;
  y: number;
  /** Where it is drawn now (moves towards x, y). */
  cx: number;
  cy: number;
  w: number;
}

const BRANCH_COLORS = ["#7c9cff", "#f5a524", "#22c55e", "#f472b6", "#38bdf8", "#c084fc", "#fb7185", "#a3e635", "#fbbf24", "#2dd4bf"];
const RING = [0, 230, 420, 590];
const MAX_DEPTH = 3;
const MAX_CHILDREN = 14;

export class MindMapView implements View {
  private cam = new Camera();
  private model: Model | null = null;
  private centre: string | null = null;
  private twigs = new Map<string, Twig>();
  private selected: string | null = null;
  private filter: Set<string> | null = null;
  private framed = false;
  private size = { w: 0, h: 0 };
  private born = 0;
  private hovered: string | null = null;
  /** Where each label (or dot) was drawn last, in screen pixels: for hits. */
  private rects = new Map<string, Rect>();

  setModel(model: Model) {
    this.model = model;
    if (!this.centre || !model.byId.has(this.centre)) {
      // Another memory (a PC chosen in the bar): framed again around the new centre.
      this.centre = model.centre();
      this.framed = false;
    }
    this.layout();
  }

  setSelected(id: string | null) {
    this.selected = id;
    if (id && id !== this.centre && this.model?.byId.has(id)) {
      this.centre = id;
      this.layout();
      this.cam.centre(0, 0, this.size.w, this.size.h);
    }
  }

  setFilter(ids: Set<string> | null) {
    this.filter = ids;
  }

  /** The tree around the centre (breadth first) on rings, each subtree in its own sector. */
  private layout() {
    const m = this.model;
    if (!m || !this.centre) {
      this.twigs.clear();
      return;
    }
    const old = this.twigs;
    const root = m.byId.get(this.centre)!;
    const tree = new Map<string, { parent: string | null; rel: string; depth: number; kids: string[] }>();
    tree.set(root.id, { parent: null, rel: "", depth: 0, kids: [] });
    let level = [root.id];
    for (let depth = 1; depth <= MAX_DEPTH && level.length; depth++) {
      const next: string[] = [];
      for (const id of level) {
        // Pages first, then the rest; the most linked first.
        const nbs = m.neighbours(id)
          .filter((nb) => !tree.has(nb.id))
          .sort((a, b) => rank(m, b.id) - rank(m, a.id))
          .slice(0, depth === 1 ? MAX_CHILDREN + 4 : MAX_CHILDREN);
        for (const nb of nbs) {
          if (tree.has(nb.id)) continue;
          tree.set(nb.id, { parent: id, rel: nb.label, depth, kids: [] });
          tree.get(id)!.kids.push(nb.id);
          next.push(nb.id);
        }
      }
      level = next;
    }
    // Leaves under each node, for the size of its sector.
    const leaves = new Map<string, number>();
    const count = (id: string): number => {
      const kids = tree.get(id)!.kids;
      const n = kids.length ? kids.reduce((s, k) => s + count(k), 0) : 1;
      leaves.set(id, n);
      return n;
    };
    count(root.id);
    const twigs = new Map<string, Twig>();
    const place = (id: string, a0: number, a1: number, hue: string) => {
      const node = tree.get(id)!;
      const n = m.byId.get(id)!;
      const a = (a0 + a1) / 2;
      const r = RING[node.depth];
      const x = node.depth ? Math.cos(a) * r : 0;
      const y = node.depth ? Math.sin(a) * r : 0;
      const prev = old.get(id);
      const parentTwig = node.parent ? twigs.get(node.parent) : null;
      twigs.set(id, {
        id, label: n.label, depth: node.depth, parent: node.parent, rel: node.rel, hue,
        x, y,
        cx: prev?.cx ?? parentTwig?.cx ?? 0,
        cy: prev?.cy ?? parentTwig?.cy ?? 0,
        w: 0,
      });
      let start = a0;
      const total = leaves.get(id) ?? 1;
      node.kids.forEach((k, i) => {
        const span = ((a1 - a0) * (leaves.get(k) ?? 1)) / total;
        place(k, start, start + span, node.depth === 0 ? BRANCH_COLORS[i % BRANCH_COLORS.length] : hue);
        start += span;
      });
    };
    place(root.id, -Math.PI / 2, Math.PI * 1.5, KIND_COLOR[root.kind]);
    this.twigs = twigs;
    this.born = performance.now();
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): boolean {
    this.size = { w, h };
    if (!this.framed && this.twigs.size) {
      this.cam.frame(this.bounds(), w, h, true, 40);
      this.framed = true;
    }
    let moving = this.cam.step();
    starfield(ctx, w, h, this.cam);
    const p = pal();
    ctx.save();
    this.cam.apply(ctx);
    const k = this.cam.k;
    // Move towards the places.
    for (const t of this.twigs.values()) {
      const dx = t.x - t.cx;
      const dy = t.y - t.cy;
      if (Math.abs(dx) + Math.abs(dy) > 0.3) {
        t.cx += dx * 0.12;
        t.cy += dy * 0.12;
        moving = true;
      } else {
        t.cx = t.x;
        t.cy = t.y;
      }
    }
    // The branches grow in, ring after ring.
    const age = (time - this.born) / 1000;
    const grown = (depth: number) => Math.max(0, Math.min(1, age * 2.2 - (depth - 1) * 0.45));
    if (grown(MAX_DEPTH) < 1) moving = true;
    const dim = (id: string) => (this.filter && !this.filter.has(id) ? 0.25 : 1);

    // Faint rings.
    ctx.strokeStyle = p.line;
    ctx.lineWidth = 1 / k;
    for (const r of RING.slice(1)) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.stroke();
    }

    const rels: { text: string; x: number; y: number; hue: string }[] = [];
    for (const t of this.twigs.values()) {
      if (!t.parent) continue;
      const pt = this.twigs.get(t.parent)!;
      const g = grown(t.depth);
      if (g <= 0) continue;
      const ex = pt.cx + (t.cx - pt.cx) * g;
      const ey = pt.cy + (t.cy - pt.cy) * g;
      // An organic branch: a curve leaving the parent outwards.
      const pa = Math.atan2(pt.cy, pt.cx);
      const out = pt.depth === 0 ? 0 : 60;
      const c1x = pt.cx + Math.cos(pa) * out;
      const c1y = pt.cy + Math.sin(pa) * out;
      const c2x = (pt.cx + ex) / 2;
      const c2y = (pt.cy + ey) / 2;
      ctx.globalAlpha = dim(t.id);
      ctx.strokeStyle = alpha(t.hue, p.light ? 0.85 : 0.7);
      ctx.lineWidth = Math.max(1.2 / k, (6 - t.depth * 1.6));
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(pt.cx, pt.cy);
      ctx.bezierCurveTo(c1x, c1y, c2x, c2y, ex, ey);
      ctx.stroke();
      if (t.rel && g >= 1) rels.push({ text: t.rel, x: (pt.cx + t.cx) / 2, y: (pt.cy + t.cy) / 2, hue: t.hue });
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // The labels as pills, in screen pixels: never under 12 px, the centre and
    // the picked one always, then ring by ring the most linked; a pill that
    // would cover another is left as a dot (hover or zoom in to read it).
    const placer = new Placer();
    const order = [...this.twigs.values()]
      .filter((t) => (t.depth ? grown(t.depth) : 1) >= 1)
      .map((t) => ({ t, score: t.id === this.selected || t.id === this.hovered || t.depth === 0 ? 1e9 : (10 - t.depth) * 1e5 + rank(this.model!, t.id) }))
      .sort((a, b) => b.score - a.score);
    this.rects.clear();
    const dots: Twig[] = [];
    // Placed first, drawn after the dots: a pill always lies on top of the
    // branches and of the dots of those left out.
    const pills: (() => void)[] = [];
    for (const { t, score } of order) {
      const n = this.model!.byId.get(t.id)!;
      const s = this.cam.toScreen(t.cx, t.cy);
      if (s.x < -200 || s.y < -40 || s.x > w + 200 || s.y > h + 40) continue;
      const size = t.depth === 0 ? 15 : t.depth === 1 ? 13 : 12;
      ctx.font = font(size, t.depth <= 1 ? 600 : 500);
      const label = fit(ctx, t.label, t.depth === 0 ? 260 : 180);
      const tw = ctx.measureText(label).width;
      const padX = t.depth === 0 ? 14 : 10;
      const dotW = t.depth > 0 ? 10 : 0;
      const pw = tw + padX * 2 + dotW;
      const ph = size + (t.depth === 0 ? 14 : 10);
      const r = { x0: s.x - pw / 2, y0: s.y - ph / 2, x1: s.x + pw / 2, y1: s.y + ph / 2 };
      if (!placer.claim({ x0: r.x0 - 2, y0: r.y0 - 2, x1: r.x1 + 2, y1: r.y1 + 2 }, score >= 1e9)) {
        dots.push(t);
        continue;
      }
      this.rects.set(t.id, r);
      pills.push(() => {
        ctx.globalAlpha = dim(t.id);
        // Opaque: the branches end at its border instead of crossing the text.
        roundRect(ctx, r.x0, r.y0, pw, ph, 6);
        ctx.fillStyle = p.card;
        ctx.fill();
        ctx.fillStyle = t.depth === 0 ? alpha(KIND_COLOR[n.kind], p.light ? 0.18 : 0.28) : alpha(t.hue, p.light ? 0.1 : 0.12);
        ctx.fill();
        ctx.strokeStyle = t.id === this.selected ? p.ring : alpha(t.depth === 0 ? KIND_COLOR[n.kind] : t.hue, t.depth <= 1 ? 0.9 : 0.55);
        ctx.lineWidth = t.id === this.selected ? 2 : 1;
        ctx.stroke();
        // A dot of the node's kind.
        if (t.depth > 0) {
          ctx.fillStyle = KIND_COLOR[n.kind];
          ctx.beginPath();
          ctx.arc(r.x0 + padX + 2, s.y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = p.ink;
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(label, r.x0 + padX + dotW, s.y + 0.5);
      });
    }
    // Those left out: a dot where they are.
    for (const t of dots) {
      const n = this.model!.byId.get(t.id)!;
      const s = this.cam.toScreen(t.cx, t.cy);
      ctx.globalAlpha = dim(t.id);
      ctx.fillStyle = KIND_COLOR[n.kind];
      ctx.strokeStyle = p.bg;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 4, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      this.rects.set(t.id, { x0: s.x - 7, y0: s.y - 7, x1: s.x + 7, y1: s.y + 7 });
    }
    for (const draw of pills) draw();
    ctx.globalAlpha = 1;
    // The relations along the branches, where there is room left.
    for (const r of rels) {
      const s = this.cam.toScreen(r.x, r.y);
      label(ctx, placer, r.text, s.x, s.y - 4, { size: 11.5, weight: 500, color: p.dim, baseline: "bottom", max: 140 });
    }
    return moving;
  }

  private bounds() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of this.twigs.values()) {
      x0 = Math.min(x0, t.x - 90);
      x1 = Math.max(x1, t.x + 90);
      y0 = Math.min(y0, t.y - 20);
      y1 = Math.max(y1, t.y + 20);
    }
    return Number.isFinite(x0) ? { x0, y0, x1, y1 } : { x0: -200, y0: -200, x1: 200, y1: 200 };
  }

  hit(x: number, y: number): string | null {
    for (const [id, r] of this.rects) if (x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1) return id;
    return null;
  }

  setHover(id: string | null) {
    this.hovered = id;
  }

  pan(dx: number, dy: number) {
    this.cam.pan(dx, dy);
  }

  zoom(f: number, x: number, y: number) {
    this.cam.zoom(f, x, y);
  }

  reset() {
    this.cam.frame(this.bounds(), this.size.w, this.size.h, false, 40);
  }
}

/** Pages before notes and the rest; then by links. */
function rank(m: Model, id: string): number {
  const n = m.byId.get(id);
  if (!n) return 0;
  const kind = n.kind === "page" ? 1000 : n.kind === "missing" ? 600 : n.kind === "note" ? 400 : n.kind === "source" ? 300 : 100;
  return kind + n.weight;
}

export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, h / 2, w / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
