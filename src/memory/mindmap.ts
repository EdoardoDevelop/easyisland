// Mind Map: one subject in the middle and what grows from it, three rings out.
// Each first branch has its colour; picking another node moves it to the
// middle with the branches flowing to their new places.

import { KIND_COLOR, alpha, fit, type Model } from "./data";
import { animateIdle, Camera, starfield, type View } from "./stage";
import { Placer, type Rect } from "./labels";
import { font, pal } from "./theme";

interface Twig {
  id: string;
  label: string;
  depth: number;
  parent: string | null;
  /** The relation from the parent. */
  rel: string;
  strength: number;
  kids: number;
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
  private mode: "radial" | "bilateral" = "radial";
  /** Where each label (or dot) was drawn last, in screen pixels: for hits. */
  private rects = new Map<string, Rect>();

  setLayoutMode(mode: "radial" | "bilateral") {
    if (this.mode === mode) return;
    this.mode = mode;
    this.layout();
    this.framed = false;
  }

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
    const tree = new Map<string, { parent: string | null; rel: string; strength: number; depth: number; kids: string[] }>();
    tree.set(root.id, { parent: null, rel: "", strength: 3, depth: 0, kids: [] });
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
          tree.set(nb.id, { parent: id, rel: nb.label, strength: nb.strength, depth, kids: [] });
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
    const depthCounts = [0, 0, 0, 0];
    for (const node of tree.values()) depthCounts[node.depth] = (depthCounts[node.depth] ?? 0) + 1;
    const dynRing = [
      0,
      RING[1] * (depthCounts[1] > 10 ? 1 + (depthCounts[1] - 10) * 0.04 : 1),
      RING[2] * (depthCounts[2] > 18 ? 1 + (depthCounts[2] - 18) * 0.025 : 1),
      RING[3] * (depthCounts[3] > 22 ? 1 + (depthCounts[3] - 22) * 0.02 : 1),
    ];

    if (this.mode === "radial") {
      const place = (id: string, a0: number, a1: number, hue: string) => {
        const node = tree.get(id)!;
        const n = m.byId.get(id)!;
        const a = (a0 + a1) / 2;
        const r = dynRing[node.depth] ?? RING[node.depth];
        const x = node.depth ? Math.cos(a) * r : 0;
        const y = node.depth ? Math.sin(a) * r : 0;
        const prev = old.get(id);
        const parentTwig = node.parent ? twigs.get(node.parent) : null;
        twigs.set(id, {
          id, label: n.label, depth: node.depth, parent: node.parent, rel: node.rel, strength: node.strength, kids: node.kids.length, hue,
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
    } else {
      // Bilateral SX/DX balanced horizontal tree.
      const prevRoot = old.get(root.id);
      twigs.set(root.id, {
        id: root.id, label: root.label, depth: 0, parent: null, rel: "", strength: 3, kids: tree.get(root.id)!.kids.length,
        hue: KIND_COLOR[root.kind], x: 0, y: 0, cx: prevRoot?.cx ?? 0, cy: prevRoot?.cy ?? 0, w: 0,
      });
      const rootKids = tree.get(root.id)!.kids;
      const leftKids: { id: string; hue: string; w: number }[] = [];
      const rightKids: { id: string; hue: string; w: number }[] = [];
      let lWeight = 0;
      let rWeight = 0;
      rootKids.forEach((kid, i) => {
        const w = leaves.get(kid) ?? 1;
        const hue = BRANCH_COLORS[i % BRANCH_COLORS.length];
        if (rWeight <= lWeight) {
          rightKids.push({ id: kid, hue, w });
          rWeight += w;
        } else {
          leftKids.push({ id: kid, hue, w });
          lWeight += w;
        }
      });
      const slotH = 44;
      const placeSide = (id: string, side: -1 | 1, y0: number, y1: number, hue: string) => {
        const node = tree.get(id)!;
        const n = m.byId.get(id)!;
        const x = side * (250 + (node.depth - 1) * 235);
        const y = (y0 + y1) / 2;
        const prev = old.get(id);
        const parentTwig = node.parent ? twigs.get(node.parent) : null;
        twigs.set(id, {
          id, label: n.label, depth: node.depth, parent: node.parent, rel: node.rel, strength: node.strength, kids: node.kids.length, hue,
          x, y, cx: prev?.cx ?? parentTwig?.cx ?? 0, cy: prev?.cy ?? parentTwig?.cy ?? 0, w: 0,
        });
        let curY = y0;
        const total = leaves.get(id) ?? 1;
        for (const k of node.kids) {
          const span = ((y1 - y0) * (leaves.get(k) ?? 1)) / total;
          placeSide(k, side, curY, curY + span, hue);
          curY += span;
        }
      };
      const layoutHalf = (list: { id: string; hue: string; w: number }[], totalW: number, side: -1 | 1) => {
        const hAll = Math.max(1, totalW) * slotH;
        let curY = -hAll / 2;
        for (const item of list) {
          const span = item.w * slotH;
          placeSide(item.id, side, curY, curY + span, item.hue);
          curY += span;
        }
      };
      layoutHalf(rightKids, rWeight, 1);
      layoutHalf(leftKids, lWeight, -1);
    }
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
    starfield(ctx, w, h, this.cam, time);
    const p = pal();
    const idle = animateIdle();
    const pulse = idle ? 0.5 + 0.5 * Math.sin(time * 0.0022) : 0.5;
    ctx.save();
    this.cam.apply(ctx);
    const k = this.cam.k;

    // Soft radial aura behind the central hub.
    const rootNode = this.centre ? this.model?.byId.get(this.centre) : null;
    if (rootNode) {
      const hubColor = KIND_COLOR[rootNode.kind];
      const auraR = 230 + pulse * 18;
      const g = ctx.createRadialGradient(0, 0, 10, 0, 0, auraR);
      g.addColorStop(0, alpha(hubColor, p.light ? 0.14 : 0.22));
      g.addColorStop(1, alpha(hubColor, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, auraR, 0, Math.PI * 2);
      ctx.fill();
    }
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

    // Faint guides (concentric rings in radial mode, column rails in bilateral mode).
    ctx.strokeStyle = p.line;
    ctx.lineWidth = 1 / k;
    if (this.mode === "radial") {
      for (const r of RING.slice(1)) {
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else {
      for (const d of [1, 2, 3]) {
        const rx = 250 + (d - 1) * 235;
        ctx.setLineDash([4 / k, 6 / k]);
        ctx.beginPath();
        ctx.moveTo(rx, -900); ctx.lineTo(rx, 900);
        ctx.moveTo(-rx, -900); ctx.lineTo(-rx, 900);
        ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    const rels: { text: string; x: number; y: number; hue: string }[] = [];
    let twigIdx = 0;
    for (const t of this.twigs.values()) {
      if (!t.parent) continue;
      twigIdx++;
      const pt = this.twigs.get(t.parent)!;
      const g = grown(t.depth);
      if (g <= 0) continue;
      const ex = pt.cx + (t.cx - pt.cx) * g;
      const ey = pt.cy + (t.cy - pt.cy) * g;
      // An organic branch: outward curve in radial mode, crisp horizontal S-curve in bilateral mode.
      let c1x: number, c1y: number, c2x: number, c2y: number;
      if (this.mode === "bilateral") {
        const spanX = Math.max(40, Math.abs(ex - pt.cx) * 0.45);
        const dir = ex >= pt.cx ? 1 : -1;
        c1x = pt.cx + dir * spanX;
        c1y = pt.cy;
        c2x = ex - dir * spanX;
        c2y = ey;
      } else {
        const pa = Math.atan2(pt.cy, pt.cx);
        const out = pt.depth === 0 ? 0 : 60;
        c1x = pt.cx + Math.cos(pa) * out;
        c1y = pt.cy + Math.sin(pa) * out;
        c2x = (pt.cx + ex) / 2;
        c2y = (pt.cy + ey) / 2;
      }
      ctx.globalAlpha = dim(t.id);
      const grad = ctx.createLinearGradient(pt.cx, pt.cy, ex, ey);
      grad.addColorStop(0, alpha(pt.hue, p.light ? 0.85 : 0.78));
      grad.addColorStop(1, alpha(t.hue, p.light ? 0.85 : 0.78));
      ctx.strokeStyle = grad;
      ctx.lineWidth = Math.max(1.2 / k, (6 - t.depth * 1.6));
      ctx.lineCap = "round";
      if (t.strength < 3) ctx.setLineDash([6 / k, 5 / k]);
      ctx.beginPath();
      ctx.moveTo(pt.cx, pt.cy);
      ctx.bezierCurveTo(c1x, c1y, c2x, c2y, ex, ey);
      ctx.stroke();
      ctx.setLineDash([]);
      // Traveling energy pulse along grown branches.
      if (idle && g >= 1) {
        const u = ((time * 0.00042 + twigIdx * 0.17) % 1 + 1) % 1;
        const q = 1 - u;
        const bx = q * q * q * pt.cx + 3 * q * q * u * c1x + 3 * q * u * u * c2x + u * u * u * ex;
        const by = q * q * q * pt.cy + 3 * q * q * u * c1y + 3 * q * u * u * c2y + u * u * u * ey;
        ctx.fillStyle = alpha(t.hue, 0.9);
        ctx.beginPath();
        ctx.arc(bx, by, 3 / k, 0, Math.PI * 2);
        ctx.fill();
      }
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
      const padX = t.depth === 0 ? 16 : 11;
      const dotW = t.depth > 0 ? 10 : 0;
      const badgeW = t.depth > 0 && t.kids > 0 ? 24 : 0;
      const pw = tw + padX * 2 + dotW + badgeW;
      const ph = size + (t.depth === 0 ? 16 : 11);
      const r = { x0: s.x - pw / 2, y0: s.y - ph / 2, x1: s.x + pw / 2, y1: s.y + ph / 2 };
      if (!placer.claim({ x0: r.x0 - 2, y0: r.y0 - 2, x1: r.x1 + 2, y1: r.y1 + 2 }, score >= 1e9)) {
        dots.push(t);
        continue;
      }
      this.rects.set(t.id, r);
      pills.push(() => {
        ctx.globalAlpha = dim(t.id);
        // Subtle card elevation shadow.
        ctx.save();
        ctx.shadowColor = p.light ? "rgba(0,0,0,0.08)" : "rgba(0,0,0,0.45)";
        ctx.shadowBlur = t.depth === 0 ? 16 : 8;
        ctx.shadowOffsetY = 2;
        roundRect(ctx, r.x0, r.y0, pw, ph, t.depth === 0 ? 9 : 7);
        ctx.fillStyle = p.card;
        ctx.fill();
        ctx.restore();

        roundRect(ctx, r.x0, r.y0, pw, ph, t.depth === 0 ? 9 : 7);
        ctx.fillStyle = t.depth === 0
          ? alpha(KIND_COLOR[n.kind], (p.light ? 0.16 : 0.24) + pulse * 0.06)
          : alpha(t.hue, t.id === this.hovered ? 0.22 : (p.light ? 0.08 : 0.11));
        ctx.fill();
        if (n.kind === "missing") ctx.setLineDash([4, 3]);
        ctx.strokeStyle = t.id === this.selected || t.id === this.hovered
          ? p.ring
          : alpha(t.depth === 0 ? KIND_COLOR[n.kind] : t.hue, t.depth <= 1 ? 0.9 : 0.55);
        ctx.lineWidth = t.id === this.selected || t.depth === 0 ? 1.8 : 1;
        ctx.stroke();
        ctx.setLineDash([]);

        // Left accent bar for pages, kind dot for others.
        if (t.depth > 0 && n.kind === "page") {
          ctx.fillStyle = KIND_COLOR.page;
          roundRect(ctx, r.x0 + 3, r.y0 + 5, 3, ph - 10, 1.5);
          ctx.fill();
        } else if (t.depth > 0) {
          ctx.fillStyle = KIND_COLOR[n.kind];
          ctx.beginPath();
          ctx.arc(r.x0 + padX + 2, s.y, 3, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.fillStyle = n.kind === "missing" ? p.dim : p.ink;
        ctx.font = font(size, t.depth <= 1 ? 600 : 500);
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        ctx.fillText(label, r.x0 + padX + dotW, s.y + 0.5);

        // +N children badge.
        if (badgeW) {
          const bx = r.x1 - 13;
          ctx.fillStyle = alpha(t.hue, 0.22);
          ctx.beginPath();
          ctx.arc(bx, s.y, 8.5, 0, Math.PI * 2);
          ctx.fill();
          ctx.fillStyle = t.hue;
          ctx.font = font(10, 600);
          ctx.textAlign = "center";
          ctx.fillText(`+${t.kids}`, bx, s.y + 0.5);
        }
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
    // The relations along the branches as neat pill chips, where there is room left.
    for (const r of rels) {
      const s = this.cam.toScreen(r.x, r.y);
      ctx.font = font(10.5, 500);
      const txt = fit(ctx, r.text, 120);
      const rw = ctx.measureText(txt).width + 12;
      const rh = 17;
      const rx = s.x - rw / 2;
      const ry = s.y - rh / 2;
      if (!placer.claim({ x0: rx - 2, y0: ry - 2, x1: rx + rw + 2, y1: ry + rh + 2 })) continue;
      roundRect(ctx, rx, ry, rw, rh, 8.5);
      ctx.fillStyle = p.bg;
      ctx.fill();
      ctx.strokeStyle = alpha(r.hue, 0.45);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.fillStyle = p.dim;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(txt, s.x, s.y + 0.5);
    }
    return moving || idle;
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
