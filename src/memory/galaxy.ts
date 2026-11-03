// Galassia: the notes are stars on a dark sky, each group a galaxy of its
// colour — its pages in the bright core, its notes along two spiral arms —
// and what belongs to no group the scattered stars between them. New notes
// twinkle for a moment; a search lights the trail between the stars found.
// Frames only while something moves: the twinkle lasts a few seconds.

import { KIND_COLOR, alpha, fit, freshness, type MemNode, type Model } from "./data";
import { Camera, type View } from "./stage";

interface Star {
  n: MemNode;
  x: number;
  y: number;
  r: number;
  colour: string;
  fresh: number;
  /** Its twinkle's phase. */
  phase: number;
}

interface Galaxy {
  name: string;
  colour: string;
  x: number;
  y: number;
  r: number;
}

/** How long the sky twinkles after it changes, ms. */
const TWINKLE_MS = 5000;

export class GalaxyView implements View {
  private cam = new Camera();
  private stars: Star[] = [];
  private index = new Map<string, Star>();
  private galaxies: Galaxy[] = [];
  private model: Model | null = null;
  private selected: string | null = null;
  private filter: Set<string> | null = null;
  private framed = false;
  private since = 0;
  private size = { w: 0, h: 0 };

  setModel(model: Model) {
    this.model = model;
    const { groups, of } = model.groups();
    this.stars = [];
    this.galaxies = [];
    let seed = 11;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    // The galaxies on a wide spiral, the biggest in the middle.
    groups.forEach((g, gi) => {
      const a = gi * 2.399;
      const d = gi === 0 ? 0 : 260 + 150 * Math.sqrt(gi);
      const gx = Math.cos(a) * d;
      const gy = Math.sin(a) * d * 0.72;
      const members = g.members.map((id) => model.byId.get(id)!).sort((x, y) => rank(y) - rank(x));
      const size = 70 + Math.sqrt(members.length) * 26;
      const tilt = rnd() * Math.PI;
      members.forEach((n, i) => {
        const core = n.kind === "page" || n.kind === "missing";
        // Pages near the core, notes along two arms that wind outwards.
        const t = core ? rnd() * 0.25 : 0.25 + (i / Math.max(1, members.length)) * 0.75;
        const arm = i % 2 ? Math.PI : 0;
        const angle = tilt + arm + t * 5.2 + (rnd() - 0.5) * 0.5;
        const dist = t * size + (rnd() - 0.5) * 14;
        this.add(n, gx + Math.cos(angle) * dist, gy + Math.sin(angle) * dist * 0.62, g.color, rnd());
      });
      this.galaxies.push({ name: g.name, colour: g.color, x: gx, y: gy, r: size });
    });
    // The stars of no group, scattered around.
    const loose = model.g.nodes.filter((n) => !of.has(n.id));
    const spread = 500 + Math.sqrt(model.g.nodes.length) * 40;
    for (const n of loose) {
      const a = rnd() * Math.PI * 2;
      const d = Math.sqrt(rnd()) * spread;
      this.add(n, Math.cos(a) * d, Math.sin(a) * d * 0.72, KIND_COLOR[n.kind], rnd());
    }
    this.index = new Map(this.stars.map((s) => [s.n.id, s]));
    this.framed = false;
    this.since = performance.now();
  }

  private add(n: MemNode, x: number, y: number, colour: string, phase: number) {
    const page = n.kind === "page" || n.kind === "missing";
    this.stars.push({ n, x, y, r: (page ? 2.6 : 1.4) + Math.min(4, Math.sqrt(n.weight) * 0.7), colour, fresh: freshness(n.date), phase: phase * Math.PI * 2 });
  }

  setSelected(id: string | null) {
    this.selected = id;
    this.since = performance.now();
    const s = id ? this.index.get(id) : null;
    if (s) this.cam.centre(s.x, s.y, this.size.w, this.size.h);
  }

  setFilter(ids: Set<string> | null) {
    this.filter = ids;
    this.since = performance.now();
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): boolean {
    this.size = { w, h };
    if (!this.framed && this.stars.length) {
      this.cam.frame(box(this.stars), w, h, true, 40);
      this.framed = true;
    }
    let moving = this.cam.step();
    const now = performance.now();
    const twinkling = now - this.since < TWINKLE_MS;
    // The sky: deep blue to black, with a faint band of dust.
    const sky = ctx.createLinearGradient(0, 0, w, h);
    sky.addColorStop(0, "#050713");
    sky.addColorStop(0.5, "#0a0d1f");
    sky.addColorStop(1, "#030308");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    ctx.save();
    this.cam.apply(ctx);
    const k = this.cam.k;
    ctx.globalCompositeOperation = "lighter";
    // Each galaxy's glow: a wide soft disc and a bright core.
    for (const g of this.galaxies) {
      const disc = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.r * 1.5);
      disc.addColorStop(0, alpha(g.colour, 0.32));
      disc.addColorStop(0.25, alpha(g.colour, 0.12));
      disc.addColorStop(1, alpha(g.colour, 0));
      ctx.fillStyle = disc;
      ctx.save();
      ctx.translate(g.x, g.y);
      ctx.scale(1, 0.62);
      ctx.translate(-g.x, -g.y);
      ctx.beginPath();
      ctx.arc(g.x, g.y, g.r * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    const sel = this.selected;
    const near = new Set<string>();
    if (sel && this.model) for (const nb of this.model.neighbours(sel)) near.add(nb.id);
    // The constellation of the picked star: thin lines to its neighbours.
    if (sel) {
      const a = this.index.get(sel);
      if (a) {
        ctx.strokeStyle = "rgba(220,230,255,0.45)";
        ctx.lineWidth = 0.8 / k;
        for (const id of near) {
          const b = this.index.get(id);
          if (!b) continue;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }
    }
    // The trail of a search, star to star.
    if (this.filter?.size) {
      const found = this.stars.filter((s) => this.filter!.has(s.n.id)).sort((a, b) => a.x - b.x);
      ctx.strokeStyle = "rgba(255,240,200,0.55)";
      ctx.lineWidth = 1.2 / k;
      ctx.shadowColor = "#fff1c4";
      ctx.shadowBlur = 8;
      ctx.beginPath();
      found.forEach((s, i) => (i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y)));
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    // The stars.
    for (const s of this.stars) {
      const dim = (sel && s.n.id !== sel && !near.has(s.n.id)) || (this.filter && !this.filter.has(s.n.id));
      const tw = twinkling ? 0.75 + 0.25 * Math.sin(time / 180 + s.phase * 3) * (s.fresh > 0.6 ? 1.6 : 0.6) : 1;
      const a = (dim ? 0.18 : 0.55 + s.fresh * 0.45) * tw;
      const r = s.r * (s.n.id === sel ? 1.8 : 1);
      const glow = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 4);
      glow.addColorStop(0, `rgba(255,255,255,${a})`);
      glow.addColorStop(0.25, alpha(s.colour, a * 0.8));
      glow.addColorStop(1, alpha(s.colour, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r * 4, 0, Math.PI * 2);
      ctx.fill();
      // A cross of light on the bright ones.
      if (!dim && (s.r > 3 || s.n.id === sel)) {
        ctx.strokeStyle = `rgba(255,255,255,${a * 0.5})`;
        ctx.lineWidth = 0.6 / k;
        ctx.beginPath();
        ctx.moveTo(s.x - r * 3, s.y);
        ctx.lineTo(s.x + r * 3, s.y);
        ctx.moveTo(s.x, s.y - r * 3);
        ctx.lineTo(s.x, s.y + r * 3);
        ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = "source-over";
    // Names: the galaxies from afar, the stars closer.
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (k < 1.3) {
      ctx.font = `600 ${14 / k}px system-ui, "Segoe UI", sans-serif`;
      for (const g of this.galaxies) {
        ctx.fillStyle = alpha(g.colour, 0.9);
        ctx.fillText(fit(ctx, g.name, 240 / k), g.x, g.y + g.r * 0.75);
      }
    }
    ctx.font = `500 ${11 / k}px system-ui, "Segoe UI", sans-serif`;
    for (const s of this.stars) {
      const show = s.n.id === sel || near.has(s.n.id) || this.filter?.has(s.n.id) || (k > 1.6 && (s.n.kind === "page" || k > 2.6));
      if (!show) continue;
      ctx.fillStyle = s.n.id === sel ? "#ffffff" : "rgba(220,226,240,0.85)";
      ctx.fillText(fit(ctx, s.n.label, 160 / k), s.x, s.y + s.r + 9 / k);
    }
    ctx.restore();
    if (twinkling) moving = true;
    return moving;
  }

  hit(x: number, y: number): string | null {
    const p = this.cam.toWorld(x, y);
    let best: Star | null = null;
    let bestD = Infinity;
    for (const s of this.stars) {
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d < Math.max(s.r * 2.5, 7 / this.cam.k) && d < bestD) {
        best = s;
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
    this.cam.frame(box(this.stars), this.size.w, this.size.h, false, 40);
  }
}

/** Pages first in a galaxy, then the most linked. */
function rank(n: MemNode): number {
  return (n.kind === "page" ? 1000 : 0) + n.weight;
}

function box(stars: { x: number; y: number }[]) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of stars) {
    x0 = Math.min(x0, s.x);
    y0 = Math.min(y0, s.y);
    x1 = Math.max(x1, s.x);
    y1 = Math.max(y1, s.y);
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : { x0: -100, y0: -100, x1: 100, y1: 100 };
}
