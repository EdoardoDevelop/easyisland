// Knowledge Graph: every page, note, source and day as a star, pulled together
// by their links (a small force simulation that stops when it settles).
// Picking one lights up its neighbours and sends sparks along its links.
// Groups (data.ts findGroups) get a soft halo with their name, seen from afar;
// a star is as big as it is linked and as bright as it is recent; guessed
// links are fainter than written ones; a path between two nodes and the focus
// on one (double click) dim the rest; notes tied to nothing wear a red ring.

import { KIND_COLOR, alpha, around, freshness, type MemNode, type Model } from "./data";
import { animateIdle, Camera, coreBox, starfield, type Colouring, type View } from "./stage";
import { Placer, label } from "./labels";
import { inkOf, pal } from "./theme";

interface Body {
  n: MemNode;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  fresh: number;
  /** How many links it has (the loose ones are pulled in harder). */
  deg: number;
}

/** Above this many nodes the archived notes and the days are left out. */
const MAX_NODES = 700;

export class GraphView implements View {
  private cam = new Camera();
  private bodies: Body[] = [];
  private index = new Map<string, Body>();
  private links: [Body, Body, string, number][] = [];
  private model: Model | null = null;
  private selected: string | null = null;
  private filter: Set<string> | null = null;
  private path: Set<string> | null = null;
  private pathEdges = new Set<string>();
  private focused: Set<string> | null = null;
  private colouring: Colouring = "group";
  private hovered: string | null = null;
  private heat = 1;
  private framed = false;
  private size = { w: 0, h: 0 };

  setModel(model: Model) {
    this.model = model;
    const old = this.index;
    let nodes = model.g.nodes;
    if (nodes.length > MAX_NODES) nodes = nodes.filter((n) => n.kind !== "old" && n.kind !== "day").slice(0, MAX_NODES);
    this.bodies = nodes.map((n, i) => {
      const prev = old.get(n.id);
      // New ones start on a spiral, so the first frames already look like something.
      const a = i * 2.399;
      const d = 18 * Math.sqrt(i + 1);
      return { n, x: prev?.x ?? Math.cos(a) * d, y: prev?.y ?? Math.sin(a) * d, vx: 0, vy: 0, r: radius(n), fresh: freshness(n.date), deg: 0 };
    });
    this.index = new Map(this.bodies.map((b) => [b.n.id, b]));
    this.links = [];
    for (const e of model.g.edges) {
      const a = this.index.get(e.from);
      const b = this.index.get(e.to);
      if (a && b) {
        this.links.push([a, b, e.label, e.strength ?? 3]);
        a.deg++;
        b.deg++;
      }
    }
    this.focused = null;
    this.heat = old.size ? 0.5 : 1;
    if (!old.size) this.framed = false;
  }

  setSelected(id: string | null) {
    this.selected = id;
    const b = id ? this.index.get(id) : null;
    if (b) this.cam.centre(b.x, b.y, this.size.w, this.size.h);
  }

  setFilter(ids: Set<string> | null) {
    this.filter = ids;
  }

  setPath(ids: string[] | null) {
    this.path = ids ? new Set(ids) : null;
    this.pathEdges = new Set();
    if (ids) for (let i = 1; i < ids.length; i++) this.pathEdges.add(`${ids[i - 1]}>${ids[i]}`).add(`${ids[i]}>${ids[i - 1]}`);
    if (ids?.length) {
      const pts = ids.map((id) => this.index.get(id)).filter((b): b is Body => !!b);
      if (pts.length) this.cam.frame(boxOf(pts), this.size.w, this.size.h, false, 120);
    }
  }

  setHover(id: string | null) {
    this.hovered = id;
  }

  setColouring(c: Colouring) {
    this.colouring = c;
  }

  /** Double click on a node: it and its neighbours two steps away, the rest hidden. */
  focus(id: string): boolean {
    if (!this.model || !this.index.has(id)) return false;
    this.focused = around(this.model, id, 2);
    const pts = [...this.focused].map((x) => this.index.get(x)).filter((b): b is Body => !!b);
    this.cam.frame(boxOf(pts), this.size.w, this.size.h, false, 90);
    return true;
  }

  private colourOf(n: MemNode): string {
    if (this.colouring === "group") return this.model?.groupColor(n.id) ?? KIND_COLOR[n.kind];
    return KIND_COLOR[n.kind];
  }

  private simulate() {
    const bodies = this.bodies;
    const n = bodies.length;
    const heat = this.heat;
    // Repulsion between every pair (fine up to a few hundred).
    for (let i = 0; i < n; i++) {
      const a = bodies[i];
      for (let j = i + 1; j < n; j++) {
        const b = bodies[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          d2 = 0.5;
        }
        if (d2 > 250000) continue;
        const f = (2400 * heat) / d2;
        a.vx += dx * f;
        a.vy += dy * f;
        b.vx -= dx * f;
        b.vy -= dy * f;
      }
    }
    // Springs along the links: written ones pull harder than guesses.
    for (const [a, b, , s] of this.links) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const rest = 90 + a.r + b.r;
      const f = ((d - rest) / d) * (s >= 2 ? 0.045 : 0.02) * heat;
      a.vx += dx * f;
      a.vy += dy * f;
      b.vx -= dx * f;
      b.vy -= dy * f;
    }
    // A gentle pull to the middle (harder on the loose ones, which the others
    // would push far out), and friction.
    let moving = 0;
    for (const b of bodies) {
      const pull = b.deg ? 0.002 : 0.012;
      b.vx -= b.x * pull * heat;
      b.vy -= b.y * pull * heat;
      b.vx *= 0.82;
      b.vy *= 0.82;
      b.x += b.vx;
      b.y += b.vy;
      moving += Math.abs(b.vx) + Math.abs(b.vy);
    }
    this.heat = Math.max(0, this.heat * 0.985 - 0.0008);
    return this.heat > 0.02 && moving / Math.max(1, n) > 0.02;
  }

  /** What to frame: most of the stars (a stray one far away is left at the edge). */
  private bounds() {
    return coreBox(this.bodies);
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): boolean {
    this.size = { w, h };
    let moving = false;
    // A settled layout before the first frame shown, then live.
    if (!this.framed) {
      for (let i = 0; i < 160 && this.simulate(); i++);
      this.cam.frame(this.bounds(), w, h, true);
      this.framed = true;
    }
    if (this.heat > 0.02) moving = this.simulate();
    moving = this.cam.step() || moving;
    starfield(ctx, w, h, this.cam, time);
    const p = pal();
    const idle = animateIdle();
    ctx.save();
    this.cam.apply(ctx);
    const k = this.cam.k;
    const sel = this.selected;
    const near = new Set<string>();
    if (sel && this.model) for (const nb of this.model.neighbours(sel)) near.add(nb.id);
    const path = this.path;
    const focus = this.focused;
    const visible = (id: string) => !focus || focus.has(id);
    const lit = (id: string) => {
      if (path) return path.has(id);
      return (!sel && !this.filter) || id === sel || near.has(id) || !!this.filter?.has(id);
    };
    const groupNames: { name: string; color: string; x: number; y: number }[] = [];

    // Groups: a soft cloud of their colour and, from afar, their name.
    if (this.colouring === "group" && this.model && !path) {
      const { groups } = this.model.groups();
      for (const g of groups) {
        const pts = g.members.map((id) => this.index.get(id)).filter((b): b is Body => !!b && visible(b.n.id));
        if (pts.length < 3) continue;
        const cx = pts.reduce((s, b) => s + b.x, 0) / pts.length;
        const cy = pts.reduce((s, b) => s + b.y, 0) / pts.length;
        const r = Math.max(60, Math.sqrt(pts.reduce((s, b) => s + (b.x - cx) ** 2 + (b.y - cy) ** 2, 0) / pts.length) * 1.6);
        const cloud = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
        cloud.addColorStop(0, alpha(g.color, (sel ? 0.03 : 0.07) * (p.light ? 1.3 : 1)));
        cloud.addColorStop(1, alpha(g.color, 0));
        ctx.fillStyle = cloud;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fill();
        if (k < 0.75 && groupNames.length < 8) groupNames.push({ name: g.name, color: g.color, x: cx, y: cy - r * 0.55 });
      }
    }

    // Links: guesses fainter and dashed, the path bright.
    for (const [a, b, , s] of this.links) {
      if (!visible(a.n.id) || !visible(b.n.id)) continue;
      const onPath = !!path && this.pathEdges.has(`${a.n.id}>${b.n.id}`);
      const on = path ? onPath : sel ? a.n.id === sel || b.n.id === sel : !this.filter || (this.filter.has(a.n.id) && this.filter.has(b.n.id));
      const weak = s < 2;
      ctx.strokeStyle = onPath ? p.ring
        : on && sel ? alpha(this.colourOf(a.n.id === sel ? b.n : a.n), 0.8)
        : `rgba(${p.link},${on ? (weak ? 0.16 : 0.3) : 0.05})`;
      ctx.lineWidth = (onPath ? 2.4 : on && sel ? 1.6 : weak ? 0.7 : 1) / k;
      if (weak && !onPath) ctx.setLineDash([4 / k, 4 / k]);
      const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.08;
      const my = (a.y + b.y) / 2 - (b.x - a.x) * 0.08;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(mx, my, b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
      // A spark travelling along the selected node's links, or along the path.
      if ((on && sel && !path) || onPath) {
        const t = ((time / 1400) + (a.x * 0.001)) % 1;
        const from = onPath ? a : a.n.id === sel ? a : b;
        const to = from === a ? b : a;
        const u = from === a ? t : 1 - t;
        const q = 1 - u;
        const sx = q * q * a.x + 2 * q * u * mx + u * u * b.x;
        const sy = q * q * a.y + 2 * q * u * my + u * u * b.y;
        ctx.fillStyle = onPath ? p.ring : this.colourOf(to.n);
        ctx.beginPath();
        ctx.arc(sx, sy, 2.4 / k, 0, Math.PI * 2);
        ctx.fill();
        moving = true;
      }
    }

    // Nodes: as big as they are linked, as strong as they are recent; flat
    // discs with a thin ring of the background so neighbours stay apart.
    for (const b of this.bodies) {
      if (!visible(b.n.id)) continue;
      const on = lit(b.n.id);
      const color = this.colourOf(b.n);
      const r = b.r * (b.n.id === sel ? 1 + Math.sin(time / 300) * 0.08 : 1);
      if (b.n.id === sel) moving = true;
      const strong = b.n.kind === "note" || b.n.kind === "page" ? 0.6 + b.fresh * 0.4 : 0.85;
      ctx.globalAlpha = on ? strong : 0.16;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      if (b.n.kind === "missing") {
        ctx.fillStyle = p.bg;
        ctx.fill();
        ctx.setLineDash([3 / k, 3 / k]);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.4 / k;
        ctx.stroke();
        ctx.setLineDash([]);
      } else {
        ctx.fillStyle = color;
        ctx.fill();
        ctx.strokeStyle = p.bg;
        ctx.lineWidth = 1.2 / k;
        ctx.stroke();
      }
      ctx.globalAlpha = on ? 1 : 0.3;
      // A note tied to nothing: to link.
      if ((b.n.kind === "note" || b.n.kind === "old") && this.model && !this.model.neighbours(b.n.id).length) {
        ctx.setLineDash([2 / k, 2 / k]);
        ctx.strokeStyle = "rgba(232,72,85,0.9)";
        ctx.lineWidth = 1.2 / k;
        ctx.beginPath();
        ctx.arc(b.x, b.y, r + 3 / k, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (b.n.id === sel || b.n.id === this.hovered || (path && (b.n.id === [...path][0] || b.n.id === [...path][path.size - 1]))) {
        ctx.strokeStyle = p.ring;
        ctx.lineWidth = (b.n.id === sel ? 2 : 1.4) / k;
        ctx.beginPath();
        ctx.arc(b.x, b.y, r + 4 / k, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    ctx.restore();

    // Labels, in screen pixels and in order of importance: the picked node and
    // the one under the pointer, the path, its neighbours, the search, the
    // groups' names from afar, then the hubs (pages before notes and days).
    // One that would overlap a label already written is left out.
    const placer = new Placer();
    const cands: { b: Body; score: number }[] = [];
    for (const b of this.bodies) {
      if (!visible(b.n.id)) continue;
      const s = this.cam.toScreen(b.x, b.y);
      if (s.x < -100 || s.y < -40 || s.x > w + 100 || s.y > h + 40) continue;
      const id = b.n.id;
      let score: number;
      if (id === sel || id === this.hovered) score = 1e9;
      else if (path?.has(id)) score = 1e8;
      else if (near.has(id)) score = 1e7 + b.deg;
      else if (this.filter?.has(id)) score = 1e6 + b.deg;
      else if (!lit(id)) continue;
      else score = kindRank(b.n) + b.deg * 20 + b.fresh * 10;
      cands.push({ b, score });
    }
    cands.sort((a, b) => b.score - a.score);
    // The big names of the groups go in right after the near ones and the search.
    let named = false;
    const nameGroups = () => {
      named = true;
      for (const g of groupNames) {
        const s = this.cam.toScreen(g.x, g.y);
        label(ctx, placer, g.name, s.x, s.y, { size: 14, weight: 600, color: inkOf(g.color), max: 240, baseline: "middle" });
      }
    };
    // Beyond what must be named, about one label per 14 000 px² of stage:
    // a wall of names reads as nothing. Zooming in shows the others.
    let budget = Math.round((w * h) / 14_000);
    for (const { b, score } of cands) {
      if (!named && score < 1e6) nameGroups();
      if (score < 1e6 && budget <= 0) break;
      const s = this.cam.toScreen(b.x, b.y);
      const forced = score >= 1e9;
      const put = label(ctx, placer, b.n.label, s.x, s.y + b.r * k + 4, {
        size: 12,
        weight: forced ? 600 : 500,
        color: score >= 1e6 || !sel ? p.ink : p.dim,
        max: forced ? 320 : 180,
        force: forced,
      });
      if (put && score < 1e6) budget--;
    }
    if (!named) nameGroups();
    return moving || idle;
  }

  hit(x: number, y: number): string | null {
    const p = this.cam.toWorld(x, y);
    let best: Body | null = null;
    let bestD = Infinity;
    for (const b of this.bodies) {
      if (this.focused && !this.focused.has(b.n.id)) continue;
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      const reach = Math.max(b.r + 3, 8 / this.cam.k);
      if (d < reach && d < bestD) {
        best = b;
        bestD = d;
      }
    }
    return best?.n.id ?? null;
  }

  pan(dx: number, dy: number) {
    this.cam.pan(dx, dy);
  }

  zoom(f: number, x: number, y: number) {
    this.cam.zoom(f, x, y);
  }

  reset() {
    this.focused = null;
    this.heat = Math.max(this.heat, 0.3);
    this.cam.frame(this.bounds(), this.size.w, this.size.h, false);
  }
}

function boxOf(bodies: { x: number; y: number; r: number }[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of bodies) {
    x0 = Math.min(x0, b.x - b.r);
    y0 = Math.min(y0, b.y - b.r);
    x1 = Math.max(x1, b.x + b.r);
    y1 = Math.max(y1, b.y + b.r);
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : { x0: -100, y0: -100, x1: 100, y1: 100 };
}

/** Pages before notes, sources and days: who gets a label first. */
function kindRank(n: MemNode): number {
  return n.kind === "page" ? 1000 : n.kind === "missing" ? 500 : n.kind === "source" ? 300 : n.kind === "note" ? 250 : n.kind === "day" ? 100 : 50;
}

function radius(n: MemNode): number {
  const base = n.kind === "page" ? 7 : n.kind === "missing" ? 5 : n.kind === "source" ? 5 : n.kind === "day" ? 4.5 : n.kind === "old" ? 3 : 4;
  return base + Math.min(14, Math.sqrt(n.weight) * 2.2);
}
