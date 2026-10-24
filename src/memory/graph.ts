// Knowledge Graph: every page, note, source and day as a star, pulled together
// by their links (a small force simulation that stops when it settles).
// Picking one lights up its neighbours and sends sparks along its links.

import { KIND_COLOR, alpha, fit, type MemNode, type Model } from "./data";
import { Camera, starfield, type View } from "./stage";

interface Body {
  n: MemNode;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

/** Above this many nodes the archived notes and the days are left out. */
const MAX_NODES = 700;

export class GraphView implements View {
  private cam = new Camera();
  private bodies: Body[] = [];
  private index = new Map<string, Body>();
  private links: [Body, Body, string][] = [];
  private model: Model | null = null;
  private selected: string | null = null;
  private filter: Set<string> | null = null;
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
      return { n, x: prev?.x ?? Math.cos(a) * d, y: prev?.y ?? Math.sin(a) * d, vx: 0, vy: 0, r: radius(n) };
    });
    this.index = new Map(this.bodies.map((b) => [b.n.id, b]));
    this.links = [];
    for (const e of model.g.edges) {
      const a = this.index.get(e.from);
      const b = this.index.get(e.to);
      if (a && b) this.links.push([a, b, e.label]);
    }
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
    // Springs along the links.
    for (const [a, b] of this.links) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const rest = 90 + a.r + b.r;
      const f = ((d - rest) / d) * 0.04 * heat;
      a.vx += dx * f;
      a.vy += dy * f;
      b.vx -= dx * f;
      b.vy -= dy * f;
    }
    // A gentle pull to the middle, and friction.
    let moving = 0;
    for (const b of bodies) {
      b.vx -= b.x * 0.002 * heat;
      b.vy -= b.y * 0.002 * heat;
      b.vx *= 0.82;
      b.vy *= 0.82;
      b.x += b.vx;
      b.y += b.vy;
      moving += Math.abs(b.vx) + Math.abs(b.vy);
    }
    this.heat = Math.max(0, this.heat * 0.985 - 0.0008);
    return this.heat > 0.02 && moving / Math.max(1, n) > 0.02;
  }

  private bounds() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const b of this.bodies) {
      x0 = Math.min(x0, b.x - b.r);
      y0 = Math.min(y0, b.y - b.r);
      x1 = Math.max(x1, b.x + b.r);
      y1 = Math.max(y1, b.y + b.r);
    }
    return Number.isFinite(x0) ? { x0, y0, x1, y1 } : { x0: -100, y0: -100, x1: 100, y1: 100 };
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
    starfield(ctx, w, h, this.cam);
    ctx.save();
    this.cam.apply(ctx);
    const k = this.cam.k;
    const sel = this.selected;
    const near = new Set<string>();
    if (sel && this.model) for (const nb of this.model.neighbours(sel)) near.add(nb.id);
    const lit = (id: string) => (!sel && !this.filter) || id === sel || near.has(id) || !!this.filter?.has(id);

    // Links.
    for (const [a, b] of this.links) {
      const on = sel ? a.n.id === sel || b.n.id === sel : !this.filter || (this.filter.has(a.n.id) && this.filter.has(b.n.id));
      ctx.strokeStyle = on && sel ? alpha(KIND_COLOR[a.n.id === sel ? b.n.kind : a.n.kind], 0.75) : `rgba(150,170,230,${on ? 0.22 : 0.05})`;
      ctx.lineWidth = (on && sel ? 1.6 : 0.8) / Math.sqrt(k);
      const mx = (a.x + b.x) / 2 + (b.y - a.y) * 0.08;
      const my = (a.y + b.y) / 2 - (b.x - a.x) * 0.08;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(mx, my, b.x, b.y);
      ctx.stroke();
      // Sparks travelling along the selected node's links.
      if (on && sel) {
        const p = ((time / 1400) + (a.x * 0.001)) % 1;
        const from = a.n.id === sel ? a : b;
        const to = from === a ? b : a;
        const u = from === a ? p : 1 - p;
        const q = 1 - u;
        const sx = q * q * a.x + 2 * q * u * mx + u * u * b.x;
        const sy = q * q * a.y + 2 * q * u * my + u * u * b.y;
        ctx.fillStyle = alpha(KIND_COLOR[to.n.kind], 0.95);
        ctx.shadowColor = KIND_COLOR[to.n.kind];
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(sx, sy, 2.4 / Math.sqrt(k), 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        moving = true;
      }
    }

    // Stars.
    for (const b of this.bodies) {
      const on = lit(b.n.id);
      const color = KIND_COLOR[b.n.kind];
      const pulse = b.n.id === sel ? 1 + Math.sin(time / 300) * 0.12 : 1;
      if (b.n.id === sel) moving = true;
      const r = b.r * pulse;
      ctx.globalAlpha = on ? 1 : 0.18;
      // Halo.
      const halo = ctx.createRadialGradient(b.x, b.y, r * 0.3, b.x, b.y, r * 3.2);
      halo.addColorStop(0, alpha(color, on ? 0.38 : 0.12));
      halo.addColorStop(1, alpha(color, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r * 3.2, 0, Math.PI * 2);
      ctx.fill();
      // Body.
      const body = ctx.createRadialGradient(b.x - r * 0.35, b.y - r * 0.35, r * 0.1, b.x, b.y, r);
      body.addColorStop(0, "#ffffff");
      body.addColorStop(0.35, color);
      body.addColorStop(1, alpha(color, 0.7));
      ctx.fillStyle = b.n.kind === "missing" ? "rgba(0,0,0,0)" : body;
      ctx.beginPath();
      ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (b.n.kind === "missing") {
        ctx.setLineDash([3 / k, 3 / k]);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.4 / k;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (b.n.id === sel) {
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 2 / k;
        ctx.beginPath();
        ctx.arc(b.x, b.y, r + 5 / k, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Labels: big stars, the picked one and its neighbours, or when zoomed in.
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    const fontPx = 12 / k;
    ctx.font = `500 ${fontPx}px system-ui, "Segoe UI", sans-serif`;
    for (const b of this.bodies) {
      const on = lit(b.n.id);
      const show = b.n.id === sel || near.has(b.n.id) || (this.filter?.has(b.n.id) ?? false) || (on && (b.n.kind === "page" || b.n.kind === "missing" || b.r * k > 9 || k > 1.4));
      if (!show) continue;
      const label = fit(ctx, b.n.label, 180 / k);
      ctx.globalAlpha = on ? 0.95 : 0.3;
      ctx.fillStyle = "rgba(6,7,10,0.65)";
      const tw = ctx.measureText(label).width;
      ctx.fillRect(b.x - tw / 2 - 3 / k, b.y + b.r + 3 / k, tw + 6 / k, fontPx + 4 / k);
      ctx.fillStyle = b.n.id === sel ? "#ffffff" : "#dfe3ee";
      ctx.fillText(label, b.x, b.y + b.r + 5 / k);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
    return moving;
  }

  hit(x: number, y: number): string | null {
    const p = this.cam.toWorld(x, y);
    let best: Body | null = null;
    let bestD = Infinity;
    for (const b of this.bodies) {
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
    this.heat = Math.max(this.heat, 0.3);
    this.cam.frame(this.bounds(), this.size.w, this.size.h, false);
  }
}

function radius(n: MemNode): number {
  const base = n.kind === "page" ? 7 : n.kind === "missing" ? 5 : n.kind === "source" ? 5 : n.kind === "day" ? 4.5 : n.kind === "old" ? 3 : 4;
  return base + Math.min(14, Math.sqrt(n.weight) * 2.2);
}
