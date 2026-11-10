// Rete neurale viva: the memory as neurons, gathered in lobes by group, with
// their links as curved axons. When the memory is read or written — from the
// chat, from Agent Chat, from another PC (memory-activity, main.ts) — pulses
// of light leave the centre for the neurons touched and run on to their
// neighbours: the memory «thinking». At rest nothing moves and no frame is
// drawn; a click sends a pulse from the picked neuron too.

import { KIND_COLOR, alpha, type MemNode, type Model } from "./data";
import { Camera, starfield, type View } from "./stage";
import { Placer, label } from "./labels";
import { pal } from "./theme";

interface Neuron {
  n: MemNode;
  x: number;
  y: number;
  r: number;
  colour: string;
  /** Last time a pulse reached it (ms): it glows for a moment. */
  lit: number;
}

interface Pulse {
  from: Neuron | null;
  to: Neuron;
  start: number;
  dur: number;
  colour: string;
  /** Steps left to run on to the neighbours. */
  hops: number;
}

const GLOW_MS = 1600;
/** How long the picked neuron's neighbours take to light up after its pulses. */
const STAY_FADE_MS = 500;

export class NeuralView implements View {
  private cam = new Camera();
  private neurons: Neuron[] = [];
  private index = new Map<string, Neuron>();
  private axons: [Neuron, Neuron][] = [];
  private pulses: Pulse[] = [];
  private model: Model | null = null;
  private selected: string | null = null;
  private filter: Set<string> | null = null;
  private framed = false;
  private size = { w: 0, h: 0 };
  /** When the memory was last read or written: the centre glows. */
  private saidAt = 0;
  /** When the picked neuron's pulses ended: from then its neighbours stay lit. */
  private stayAt = 0;

  setModel(model: Model) {
    this.model = model;
    const { groups, of } = model.groups();
    this.neurons = [];
    let seed = 5;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // Lobes on a ring around the centre, the loose neurons in a halo outside.
    const lobes = Math.max(1, groups.length);
    groups.forEach((g, gi) => {
      const a = (gi / lobes) * Math.PI * 2 - Math.PI / 2;
      const d = lobes === 1 ? 0 : 230 + Math.sqrt(g.members.length) * 8;
      const cx = Math.cos(a) * d;
      const cy = Math.sin(a) * d * 0.8;
      const spread = 30 + Math.sqrt(g.members.length) * 22;
      g.members.forEach((id, i) => {
        const n = model.byId.get(id)!;
        const t = Math.sqrt((i + 0.5) / g.members.length);
        const ang = i * 2.399 + rnd() * 0.4;
        this.add(n, cx + Math.cos(ang) * t * spread, cy + Math.sin(ang) * t * spread, g.color);
      });
    });
    const loose = model.g.nodes.filter((n) => !of.has(n.id));
    loose.forEach((n, i) => {
      const a = (i / Math.max(1, loose.length)) * Math.PI * 2 + rnd() * 0.2;
      const d = 470 + rnd() * 110;
      this.add(n, Math.cos(a) * d, Math.sin(a) * d * 0.8, KIND_COLOR[n.kind]);
    });
    this.index = new Map(this.neurons.map((x) => [x.n.id, x]));
    this.axons = [];
    for (const e of model.g.edges) {
      const a = this.index.get(e.from);
      const b = this.index.get(e.to);
      if (a && b) this.axons.push([a, b]);
    }
    this.framed = false;
  }

  private add(n: MemNode, x: number, y: number, colour: string) {
    this.neurons.push({ n, x, y, r: (n.kind === "page" ? 4 : 2.4) + Math.min(5, Math.sqrt(n.weight)), colour, lit: 0 });
  }

  private hovered: string | null = null;

  setHover(id: string | null) {
    this.hovered = id;
  }

  setSelected(id: string | null) {
    this.selected = id;
    // Lit for good only once this click's pulses are over (draw).
    this.stayAt = 0;
    const x = id ? this.index.get(id) : null;
    if (x) this.fire(null, [x], 2);
  }

  setFilter(ids: Set<string> | null) {
    this.filter = ids;
  }

  /** The memory was read or written: pulses from the centre to what it touched. */
  activity(ids: string[], kind: "read" | "write") {
    const hit = ids.map((id) => this.index.get(id)).filter((x): x is Neuron => !!x).slice(0, 24);
    this.saidAt = performance.now();
    this.fire(null, hit, 2, kind === "write" ? "#f5a524" : "#7dd3fc");
  }

  private fire(from: Neuron | null, to: Neuron[], hops: number, colour?: string) {
    const now = performance.now();
    to.forEach((t, i) => this.pulses.push({ from, to: t, start: now + i * 60, dur: 600 + Math.random() * 300, colour: colour ?? t.colour, hops }));
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
    this.size = { w, h };
    if (!this.framed && this.neurons.length) {
      this.cam.frame(box(this.neurons), w, h, true, 50);
      this.framed = true;
    }
    let moving = this.cam.step();
    const now = performance.now();
    starfield(ctx, w, h, this.cam);
    const pl = pal();
    ctx.save();
    this.cam.apply(ctx);
    const k = this.cam.k;
    const sel = this.selected;
    // The picked neuron's neighbours: once its pulses are over (not before),
    // they and their axons light up and stay lit (asked by Edoardo on 4 Nov
    // 2026), fading in over STAY_FADE_MS; the rest dims.
    const near = new Set<string>();
    if (sel && this.model) for (const nb of this.model.neighbours(sel)) near.add(nb.id);
    const selColour = sel ? this.index.get(sel)?.colour ?? "#7dd3fc" : "";
    if (sel && !this.stayAt && !this.pulses.length) this.stayAt = now;
    const stay = sel && this.stayAt ? Math.min(1, (now - this.stayAt) / STAY_FADE_MS) : 0;
    if (sel && stay < 1) moving = true;
    // Axons: thin, curved, the ones of lit neurons brighter.
    for (const [a, b] of this.axons) {
      const glow = Math.max(0, 1 - (now - Math.max(a.lit, b.lit)) / GLOW_MS);
      const mine = stay > 0 && (a.n.id === sel || b.n.id === sel);
      const on = sel ? a.n.id === sel || b.n.id === sel : !this.filter || (this.filter.has(a.n.id) && this.filter.has(b.n.id));
      ctx.strokeStyle = mine
        ? alpha(selColour, Math.max(0.13, (0.55 + glow * 0.35) * stay))
        : glow > 0 ? alpha(a.colour, 0.15 + glow * 0.6) : `rgba(${pl.link},${on ? 0.16 : sel ? 0.03 : 0.05})`;
      ctx.lineWidth = ((mine ? 0.7 + 0.8 * stay : 0.7) + glow * 1.4) / Math.sqrt(k);
      const [mx, my] = bend(a, b);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.quadraticCurveTo(mx, my, b.x, b.y);
      ctx.stroke();
      if (glow > 0) moving = true;
    }
    // Pulses: a bright head with a tail, then they run on.
    ctx.globalCompositeOperation = pl.light ? "source-over" : "lighter";
    const done: Pulse[] = [];
    for (const p of this.pulses) {
      const u = (now - p.start) / p.dur;
      if (u < 0) {
        moving = true;
        continue;
      }
      if (u >= 1) {
        done.push(p);
        continue;
      }
      moving = true;
      const fx = p.from?.x ?? 0;
      const fy = p.from?.y ?? 0;
      const [mx, my] = p.from ? bend(p.from, p.to) : [(fx + p.to.x) / 2, (fy + p.to.y) / 2];
      for (let s = 0; s < 5; s++) {
        const v = Math.max(0, u - s * 0.04);
        const q = 1 - v;
        const x = q * q * fx + 2 * q * v * mx + v * v * p.to.x;
        const y = q * q * fy + 2 * q * v * my + v * v * p.to.y;
        ctx.fillStyle = alpha(p.colour, 0.9 - s * 0.17);
        ctx.beginPath();
        ctx.arc(x, y, (3.2 - s * 0.5) / Math.sqrt(k), 0, Math.PI * 2);
        ctx.fill();
      }
    }
    for (const p of done) {
      p.to.lit = now;
      if (p.hops > 0 && this.model) {
        const next = this.model.neighbours(p.to.n.id).map((nb) => this.index.get(nb.id)).filter((x): x is Neuron => !!x).slice(0, 5);
        this.fire(p.to, next, p.hops - 1, p.colour);
      }
    }
    this.pulses = this.pulses.filter((p) => !done.includes(p));
    // The centre, where a read or a write comes from.
    if (now - this.saidAt < GLOW_MS * 2) {
      const g = 1 - (now - this.saidAt) / (GLOW_MS * 2);
      const core = ctx.createRadialGradient(0, 0, 0, 0, 0, 40);
      core.addColorStop(0, pl.light ? `rgba(0,120,212,${0.4 * g})` : `rgba(255,255,255,${0.7 * g})`);
      core.addColorStop(1, "rgba(125,211,252,0)");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(0, 0, 40, 0, Math.PI * 2);
      ctx.fill();
      moving = true;
    }
    // Neurons.
    for (const x of this.neurons) {
      const glow = Math.max(0, 1 - (now - x.lit) / GLOW_MS);
      const picked = x.n.id === sel;
      const neighbour = stay > 0 && near.has(x.n.id);
      const dim = (sel && !picked && !neighbour) || (this.filter && !this.filter.has(x.n.id));
      // The picked one and its neighbours keep a glow of their own once the pulses are gone.
      const keep = (picked ? 0.5 : neighbour ? 0.25 : 0) * stay;
      const shine = Math.max(glow, keep);
      const r = x.r * (1 + shine * 0.8);
      const halo = ctx.createRadialGradient(x.x, x.y, 0, x.x, x.y, r * (3 + shine * 4));
      halo.addColorStop(0, alpha(x.colour, (dim ? 0.12 : 0.55) + shine * 0.4));
      halo.addColorStop(1, alpha(x.colour, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x.x, x.y, r * (3 + shine * 4), 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = glow > 0.2 || (picked && stay > 0.5) ? pl.ring : alpha(x.colour, dim ? 0.3 : 0.95);
      ctx.beginPath();
      ctx.arc(x.x, x.y, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.restore();
    // Labels of the picked, the lit, its neighbours and the pages up close, in
    // screen pixels; one that would cover another is left out.
    const placer = new Placer();
    const want = this.neurons
      .map((x) => {
        const glow = now - x.lit < GLOW_MS;
        const nearLit = stay > 0 && near.has(x.n.id);
        const score = x.n.id === sel || x.n.id === this.hovered ? 1e9 : glow ? 1e7 : nearLit ? 1e6 : this.filter?.has(x.n.id) ? 1e5
          : (k > 1.1 && x.n.kind === "page") || k > 2.2 ? x.n.weight : -1;
        return { x, score, nearLit };
      })
      .filter((c) => c.score >= 0)
      .sort((a, b) => b.score - a.score);
    for (const { x, score, nearLit } of want) {
      const at = this.cam.toScreen(x.x, x.y);
      if (at.x < -100 || at.x > w + 100 || at.y < -30 || at.y > h + 30) continue;
      label(ctx, placer, x.n.label, at.x, at.y + x.r * k + 5, { size: 12, weight: score >= 1e9 ? 600 : 500, force: score >= 1e9, alpha: nearLit && score < 1e7 ? Math.max(0.3, stay) : 1, max: 170 });
    }
    return moving;
  }

  hit(x: number, y: number): string | null {
    const p = this.cam.toWorld(x, y);
    let best: Neuron | null = null;
    let bestD = Infinity;
    for (const n of this.neurons) {
      const d = Math.hypot(n.x - p.x, n.y - p.y);
      if (d < Math.max(n.r * 2, 7 / this.cam.k) && d < bestD) {
        best = n;
        bestD = d;
      }
    }
    return best?.n.id ?? null;
  }

  hover(): { text: string; sub: string } | null {
    return null;
  }

  pan(dx: number, dy: number) {
    this.cam.pan(dx, dy);
  }

  zoom(f: number, x: number, y: number) {
    this.cam.zoom(f, x, y);
  }

  reset() {
    this.cam.frame(box(this.neurons), this.size.w, this.size.h, false, 50);
  }
}

/** The control point of an axon: curved a little, always the same way. */
function bend(a: { x: number; y: number }, b: { x: number; y: number }): [number, number] {
  return [(a.x + b.x) / 2 + (b.y - a.y) * 0.18, (a.y + b.y) / 2 - (b.x - a.x) * 0.18];
}

function box(list: { x: number; y: number }[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of list) {
    x0 = Math.min(x0, s.x);
    y0 = Math.min(y0, s.y);
    x1 = Math.max(x1, s.x);
    y1 = Math.max(y1, s.y);
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : { x0: -100, y0: -100, x1: 100, y1: 100 };
}
