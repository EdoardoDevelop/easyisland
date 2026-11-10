// Galassia: the notes are stars on a dark sky, each group a galaxy of its
// colour — its pages in the bright core, its notes along two spiral arms —
// and what belongs to no group the scattered stars between them. New notes
// twinkle for a moment; a search lights the trail between the stars found.
// Frames only while something moves: the twinkle lasts a few seconds.

import { KIND_COLOR, alpha, freshness, type MemNode, type Model } from "./data";
import { Camera, starfield, type View } from "./stage";
import { Placer, label } from "./labels";
import { inkOf, pal } from "./theme";

interface Star {
  n: MemNode;
  x: number;
  y: number;
  r: number;
  colour: string;
  fresh: number;
  /** Its twinkle's phase. */
  phase: number;
  /** Below 1 where stars crowd: their light adds up, so each one shines less. */
  damp: number;
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
/** At most this many lines from the picked star: its strongest links. */
const MAX_LINES = 40;
/** At most this many names around the picked star. */
const MAX_NAMES = 18;

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
    crowding(this.stars);
    this.framed = false;
    this.since = performance.now();
  }

  private add(n: MemNode, x: number, y: number, colour: string, phase: number) {
    const page = n.kind === "page" || n.kind === "missing";
    this.stars.push({ n, x, y, r: (page ? 2.6 : 1.4) + Math.min(4, Math.sqrt(n.weight) * 0.7), colour, fresh: freshness(n.date), phase: phase * Math.PI * 2, damp: 1 });
  }

  private hovered: string | null = null;

  setHover(id: string | null) {
    this.hovered = id;
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
    // The sky: the window's surface (light adds up only on a dark one).
    starfield(ctx, w, h, this.cam);
    const p = pal();
    const add: GlobalCompositeOperation = p.light ? "source-over" : "lighter";
    const core = (a: number) => (p.light ? `rgba(40,40,40,${a * 0.5})` : `rgba(255,255,255,${a})`);
    ctx.save();
    this.cam.apply(ctx);
    const k = this.cam.k;
    ctx.globalCompositeOperation = add;
    // Each galaxy's glow: a wide soft disc and a bright core.
    for (const g of this.galaxies) {
      const disc = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.r * 1.5);
      disc.addColorStop(0, alpha(g.colour, 0.18));
      disc.addColorStop(0.25, alpha(g.colour, 0.07));
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
    // The picked star's strongest links, most linked first: a page like a
    // client's has hundreds, and drawing them all burns the sky white.
    const model = this.model;
    const lines = sel && model
      ? model.neighbours(sel)
          .filter((nb) => !this.filter || this.filter.has(nb.id))
          .sort((a, b) => b.strength - a.strength || (model.byId.get(b.id)?.weight ?? 0) - (model.byId.get(a.id)?.weight ?? 0))
          .slice(0, MAX_LINES)
      : [];
    for (const nb of lines) near.add(nb.id);
    // The constellation of the picked star: thin lines to its neighbours,
    // brighter the surer the link. Not added up, or they whiten where they cross.
    const a0 = sel ? this.index.get(sel) : null;
    if (a0) {
      ctx.globalCompositeOperation = "source-over";
      ctx.lineWidth = 0.8 / k;
      for (const nb of lines) {
        const b = this.index.get(nb.id);
        if (!b) continue;
        ctx.strokeStyle = `rgba(${p.link},${nb.strength >= 3 ? 0.5 : nb.strength === 2 ? 0.32 : 0.16})`;
        ctx.setLineDash(nb.strength >= 2 ? [] : [3 / k, 4 / k]);
        ctx.beginPath();
        ctx.moveTo(a0.x, a0.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.globalCompositeOperation = add;
    }
    // The trail of a search, star to star.
    if (this.filter?.size) {
      const found = this.stars.filter((s) => this.filter!.has(s.n.id)).sort((a, b) => a.x - b.x);
      ctx.strokeStyle = p.light ? "rgba(138,83,0,0.6)" : "rgba(255,240,200,0.55)";
      ctx.lineWidth = 1.2 / k;
      ctx.beginPath();
      found.forEach((s, i) => (i ? ctx.lineTo(s.x, s.y) : ctx.moveTo(s.x, s.y)));
      ctx.stroke();
    }
    // The stars.
    for (const s of this.stars) {
      const dim = (sel && s.n.id !== sel && !near.has(s.n.id)) || (this.filter && !this.filter.has(s.n.id));
      const tw = twinkling ? 0.75 + 0.25 * Math.sin(time / 180 + s.phase * 3) * (s.fresh > 0.6 ? 1.6 : 0.6) : 1;
      const picked = s.n.id === sel;
      const a = (dim ? 0.16 : 0.5 + s.fresh * 0.4) * tw * (picked ? 1 : s.damp);
      const r = s.r * (picked ? 1.6 : 1);
      const reach = r * (picked ? 4 : 3);
      const glow = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, reach);
      glow.addColorStop(0, core(a));
      glow.addColorStop(0.3, alpha(s.colour, a * 0.6));
      glow.addColorStop(1, alpha(s.colour, 0));
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(s.x, s.y, reach, 0, Math.PI * 2);
      ctx.fill();
      // A cross of light on the bright ones, where there is room for it.
      if (!dim && ((s.r > 3.5 && s.damp > 0.6) || picked)) {
        ctx.strokeStyle = core(a * 0.5);
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
    ctx.restore();
    // Names in screen pixels: the picked star first, then its surest
    // neighbours, the found ones, the galaxies from afar and the pages; one
    // that would overlap a name already written is left out (it shows on
    // hover and closer up).
    const placer = new Placer();
    const nearRank = new Map(lines.map((nb, i) => [nb.id, i]));
    const order = (s: Star) => (s.n.id === sel || s.n.id === this.hovered ? -2 : nearRank.get(s.n.id) ?? (this.filter?.has(s.n.id) ? 50 : 1000 - s.r * 10 - s.n.weight));
    const named = this.stars
      .filter((s) => s.n.id === sel || s.n.id === this.hovered || (nearRank.get(s.n.id) ?? MAX_NAMES) < MAX_NAMES || this.filter?.has(s.n.id) || (k > 1.1 && (s.n.kind === "page" || k > 2.2)))
      .sort((a, b) => order(a) - order(b));
    const star = (s: Star) => {
      const at = this.cam.toScreen(s.x, s.y);
      if (at.x < -100 || at.x > w + 100 || at.y < -30 || at.y > h + 30) return;
      const forced = s.n.id === sel || s.n.id === this.hovered;
      label(ctx, placer, s.n.label, at.x, at.y + s.r * k + 5, { size: 12, weight: forced ? 600 : 500, force: forced, max: forced ? 300 : 170 });
    };
    let i = 0;
    for (; i < named.length && order(named[i]) < 100; i++) star(named[i]);
    if (k < 1.3) {
      for (const g of this.galaxies) {
        const at = this.cam.toScreen(g.x, g.y + g.r * 0.75);
        label(ctx, placer, g.name, at.x, at.y, { size: 14, weight: 600, color: inkOf(g.colour), max: 240, baseline: "middle" });
      }
    }
    for (; i < named.length; i++) star(named[i]);
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

/** How crowded each star's corner of the sky is: with additive light ten
 * stars in a spot make a white blot, so each shines less the more it has
 * around (a grid, so thousands of notes stay cheap). */
function crowding(stars: Star[]) {
  const cell = 28;
  const grid = new Map<string, number>();
  const key = (cx: number, cy: number) => `${cx},${cy}`;
  for (const s of stars) {
    const kk = key(Math.floor(s.x / cell), Math.floor(s.y / cell));
    grid.set(kk, (grid.get(kk) ?? 0) + 1);
  }
  for (const s of stars) {
    const cx = Math.floor(s.x / cell);
    const cy = Math.floor(s.y / cell);
    let n = 0;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) n += grid.get(key(cx + dx, cy + dy)) ?? 0;
    s.damp = Math.min(1, 2.2 / Math.sqrt(n));
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
