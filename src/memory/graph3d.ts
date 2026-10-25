// Knowledge Graph in 3D: the same stars and links as the Grafo, laid out in
// space by a small 3D force simulation and drawn with a perspective camera.
// Drag turns the globe (it keeps turning a little when let go), the wheel
// zooms, double click shows everything. Frames only while something moves.

import { KIND_COLOR, alpha, fit, type MemNode, type Model } from "./data";
import { Camera, starfield, type View } from "./stage";

interface Body {
  n: MemNode;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  r: number;
  /** Projected this frame: screen point, scale, depth. */
  sx: number;
  sy: number;
  s: number;
  d: number;
}

const MAX_NODES = 700;
/** Distance of the eye from the centre, in world units, before the zoom. */
const EYE = 900;

export class Graph3DView implements View {
  private bodies: Body[] = [];
  private index = new Map<string, Body>();
  private links: [Body, Body][] = [];
  private model: Model | null = null;
  private selected: string | null = null;
  private filter: Set<string> | null = null;
  private heat = 1;
  private framed = false;
  private size = { w: 0, h: 0 };
  // The globe's turn (yaw around the vertical, pitch around the horizontal) and zoom.
  private yaw = 0.6;
  private pitch = -0.35;
  private spin = { yaw: 0.004, pitch: 0 };
  private zoomK = 1;
  private goal: { yaw: number; pitch: number } | null = null;
  // Only for the starfield's parallax.
  private cam = new Camera();

  setModel(model: Model) {
    this.model = model;
    const old = this.index;
    let nodes = model.g.nodes;
    if (nodes.length > MAX_NODES) nodes = nodes.filter((n) => n.kind !== "old" && n.kind !== "day").slice(0, MAX_NODES);
    this.bodies = nodes.map((n, i) => {
      const prev = old.get(n.id);
      // New ones start on a sphere (golden spiral), so the first frames already look like something.
      const k = nodes.length;
      const y = 1 - ((i + 0.5) / Math.max(1, k)) * 2;
      const rr = Math.sqrt(1 - y * y);
      const a = i * 2.399;
      const d = 30 * Math.cbrt(k + 1) * 3;
      return {
        n,
        x: prev?.x ?? Math.cos(a) * rr * d,
        y: prev?.y ?? y * d,
        z: prev?.z ?? Math.sin(a) * rr * d,
        vx: 0, vy: 0, vz: 0,
        r: radius(n),
        sx: 0, sy: 0, s: 1, d: 0,
      };
    });
    this.index = new Map(this.bodies.map((b) => [b.n.id, b]));
    this.links = [];
    for (const e of model.g.edges) {
      const a = this.index.get(e.from);
      const b = this.index.get(e.to);
      if (a && b) this.links.push([a, b]);
    }
    this.heat = old.size ? 0.5 : 1;
    if (!old.size) this.framed = false;
  }

  setSelected(id: string | null) {
    this.selected = id;
    const b = id ? this.index.get(id) : null;
    if (!b) return;
    // Turn the globe so the picked star faces the eye.
    const yaw = Math.atan2(-b.x, b.z);
    const flat = Math.hypot(b.x, b.z);
    const pitch = Math.max(-1.3, Math.min(1.3, Math.atan2(b.y, flat)));
    this.goal = { yaw: this.yaw + wrap(yaw - this.yaw), pitch };
    this.spin = { yaw: 0, pitch: 0 };
  }

  setFilter(ids: Set<string> | null) {
    this.filter = ids;
  }

  private simulate() {
    const bodies = this.bodies;
    const n = bodies.length;
    const heat = this.heat;
    for (let i = 0; i < n; i++) {
      const a = bodies[i];
      for (let j = i + 1; j < n; j++) {
        const b = bodies[j];
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let dz = a.z - b.z;
        let d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < 0.01) {
          dx = Math.random() - 0.5;
          dy = Math.random() - 0.5;
          dz = Math.random() - 0.5;
          d2 = 0.75;
        }
        if (d2 > 250000) continue;
        const f = (2400 * heat) / d2;
        a.vx += dx * f; a.vy += dy * f; a.vz += dz * f;
        b.vx -= dx * f; b.vy -= dy * f; b.vz -= dz * f;
      }
    }
    for (const [a, b] of this.links) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dz = b.z - a.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const rest = 80 + a.r + b.r;
      const f = ((d - rest) / d) * 0.04 * heat;
      a.vx += dx * f; a.vy += dy * f; a.vz += dz * f;
      b.vx -= dx * f; b.vy -= dy * f; b.vz -= dz * f;
    }
    let moving = 0;
    for (const b of bodies) {
      b.vx -= b.x * 0.003 * heat;
      b.vy -= b.y * 0.003 * heat;
      b.vz -= b.z * 0.003 * heat;
      b.vx *= 0.82; b.vy *= 0.82; b.vz *= 0.82;
      b.x += b.vx; b.y += b.vy; b.z += b.vz;
      moving += Math.abs(b.vx) + Math.abs(b.vy) + Math.abs(b.vz);
    }
    this.heat = Math.max(0, this.heat * 0.985 - 0.0008);
    return this.heat > 0.02 && moving / Math.max(1, n) > 0.02;
  }

  /** The farthest star from the centre: the zoom that shows them all. */
  private fitZoom() {
    let far = 50;
    for (const b of this.bodies) far = Math.max(far, Math.hypot(b.x, b.y, b.z) + b.r);
    const { w, h } = this.size;
    const half = Math.max(80, Math.min(w, h) / 2 - 50);
    // Seen from EYE/k away with focal EYE, a radius `far` takes about far·k pixels.
    return Math.max(0.15, Math.min(4, (half / far) * 1.15));
  }

  private project(w: number, h: number) {
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const eye = EYE / this.zoomK;
    for (const b of this.bodies) {
      // Yaw around Y, then pitch around X.
      const x1 = b.x * cy + b.z * sy;
      const z1 = -b.x * sy + b.z * cy;
      const y2 = b.y * cp - z1 * sp;
      const z2 = b.y * sp + z1 * cp;
      const depth = eye - z2;
      const s = depth > 10 ? EYE / depth : 0;
      b.sx = w / 2 + x1 * s;
      b.sy = h / 2 - y2 * s;
      b.s = s;
      b.d = depth;
    }
  }

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): boolean {
    this.size = { w, h };
    let moving = false;
    if (!this.framed) {
      for (let i = 0; i < 160 && this.simulate(); i++);
      this.zoomK = this.fitZoom();
      this.framed = true;
    }
    if (this.heat > 0.02) moving = this.simulate();
    // The turn: towards a goal (picked star), or the spin left after a drag.
    if (this.goal) {
      this.yaw += (this.goal.yaw - this.yaw) * 0.12;
      this.pitch += (this.goal.pitch - this.pitch) * 0.12;
      if (Math.abs(this.goal.yaw - this.yaw) + Math.abs(this.goal.pitch - this.pitch) < 0.002) this.goal = null;
      moving = true;
    } else if (Math.abs(this.spin.yaw) + Math.abs(this.spin.pitch) > 0.0004) {
      this.yaw += this.spin.yaw;
      this.pitch = clampPitch(this.pitch + this.spin.pitch);
      this.spin.yaw *= 0.94;
      this.spin.pitch *= 0.9;
      moving = true;
    }
    this.cam.tx = this.yaw * 300;
    this.cam.ty = this.pitch * 300;
    starfield(ctx, w, h, this.cam);
    this.project(w, h);

    const sel = this.selected;
    const near = new Set<string>();
    if (sel && this.model) for (const nb of this.model.neighbours(sel)) near.add(nb.id);
    const lit = (id: string) => (!sel && !this.filter) || id === sel || near.has(id) || !!this.filter?.has(id);
    // Depth cue: far things fade.
    const eye = EYE / this.zoomK;
    const fog = (d: number) => Math.max(0.25, Math.min(1, 1.35 - d / (eye * 1.6)));

    // Links, back to front with the stars would be costly: links first, faded by depth.
    for (const [a, b] of this.links) {
      if (!a.s || !b.s) continue;
      const on = sel ? a.n.id === sel || b.n.id === sel : !this.filter || (this.filter.has(a.n.id) && this.filter.has(b.n.id));
      const f = fog((a.d + b.d) / 2);
      ctx.strokeStyle = on && sel ? alpha(KIND_COLOR[a.n.id === sel ? b.n.kind : a.n.kind], 0.8 * f) : `rgba(150,170,230,${(on ? 0.26 : 0.05) * f})`;
      ctx.lineWidth = on && sel ? 1.6 : 0.8;
      ctx.beginPath();
      ctx.moveTo(a.sx, a.sy);
      ctx.lineTo(b.sx, b.sy);
      ctx.stroke();
      if (on && sel) {
        const p = ((time / 1400) + (a.x * 0.001)) % 1;
        const from = a.n.id === sel ? a : b;
        const to = from === a ? b : a;
        ctx.fillStyle = alpha(KIND_COLOR[to.n.kind], 0.95);
        ctx.shadowColor = KIND_COLOR[to.n.kind];
        ctx.shadowBlur = 10;
        ctx.beginPath();
        ctx.arc(from.sx + (to.sx - from.sx) * ((p % 1 + 1) % 1), from.sy + (to.sy - from.sy) * ((p % 1 + 1) % 1), 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
        moving = true;
      }
    }

    // Stars, the far ones first.
    const order = this.bodies.filter((b) => b.s > 0).sort((a, b) => b.d - a.d);
    for (const b of order) {
      const on = lit(b.n.id);
      const color = KIND_COLOR[b.n.kind];
      const pulse = b.n.id === sel ? 1 + Math.sin(time / 300) * 0.12 : 1;
      if (b.n.id === sel) moving = true;
      const r = Math.max(1.2, b.r * b.s * pulse);
      const f = fog(b.d);
      ctx.globalAlpha = (on ? 1 : 0.18) * f;
      const halo = ctx.createRadialGradient(b.sx, b.sy, r * 0.3, b.sx, b.sy, r * 3.2);
      halo.addColorStop(0, alpha(color, on ? 0.38 : 0.12));
      halo.addColorStop(1, alpha(color, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(b.sx, b.sy, r * 3.2, 0, Math.PI * 2);
      ctx.fill();
      const body = ctx.createRadialGradient(b.sx - r * 0.35, b.sy - r * 0.35, r * 0.1, b.sx, b.sy, r);
      body.addColorStop(0, "#ffffff");
      body.addColorStop(0.35, color);
      body.addColorStop(1, alpha(color, 0.7));
      ctx.fillStyle = b.n.kind === "missing" ? "rgba(0,0,0,0)" : body;
      ctx.beginPath();
      ctx.arc(b.sx, b.sy, r, 0, Math.PI * 2);
      ctx.fill();
      if (b.n.kind === "missing") {
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.4;
        ctx.stroke();
        ctx.setLineDash([]);
      }
      if (b.n.id === sel) {
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(b.sx, b.sy, r + 5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Labels: the near pages, the picked one and its neighbours, the search.
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.font = `500 12px system-ui, "Segoe UI", sans-serif`;
    for (const b of order) {
      const on = lit(b.n.id);
      const show = b.n.id === sel || near.has(b.n.id) || (this.filter?.has(b.n.id) ?? false) || (on && (b.n.kind === "page" || b.n.kind === "missing" || b.r * b.s > 9) && b.s > this.zoomK * 0.85);
      if (!show) continue;
      const r = b.r * b.s;
      const label = fit(ctx, b.n.label, 180);
      ctx.globalAlpha = (on ? 0.95 : 0.3) * fog(b.d);
      ctx.fillStyle = "rgba(6,7,10,0.65)";
      const tw = ctx.measureText(label).width;
      ctx.fillRect(b.sx - tw / 2 - 3, b.sy + r + 3, tw + 6, 16);
      ctx.fillStyle = b.n.id === sel ? "#ffffff" : "#dfe3ee";
      ctx.fillText(label, b.sx, b.sy + r + 5);
    }
    ctx.globalAlpha = 1;
    return moving;
  }

  hit(x: number, y: number): string | null {
    // The nearest to the eye among those under the pointer.
    let best: Body | null = null;
    for (const b of this.bodies) {
      if (!b.s) continue;
      const reach = Math.max(b.r * b.s + 3, 8);
      if (Math.hypot(b.sx - x, b.sy - y) < reach && (!best || b.d < best.d)) best = b;
    }
    return best?.n.id ?? null;
  }

  /** Dragging turns the globe; the last move keeps it spinning a little. */
  pan(dx: number, dy: number) {
    this.goal = null;
    const yaw = dx * 0.006;
    const pitch = dy * 0.006;
    this.yaw += yaw;
    this.pitch = clampPitch(this.pitch + pitch);
    this.spin = { yaw: yaw * 0.6, pitch: pitch * 0.3 };
  }

  zoom(f: number) {
    this.zoomK = Math.min(6, Math.max(0.15, this.zoomK * f));
  }

  reset() {
    this.heat = Math.max(this.heat, 0.3);
    this.zoomK = this.fitZoom();
    this.goal = { yaw: this.yaw, pitch: -0.35 };
  }
}

function radius(n: MemNode): number {
  const base = n.kind === "page" ? 7 : n.kind === "missing" ? 5 : n.kind === "source" ? 5 : n.kind === "day" ? 4.5 : n.kind === "old" ? 3 : 4;
  return base + Math.min(14, Math.sqrt(n.weight) * 2.2);
}

function clampPitch(p: number) {
  return Math.max(-1.4, Math.min(1.4, p));
}

/** An angle in (-π, π]. */
function wrap(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}
