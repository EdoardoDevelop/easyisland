// The canvas the four views draw on: size and pixel ratio, pointer and wheel,
// and frames only while something moves (none when still or hidden).

import type { Model } from "./data";

export interface Host {
  /** A node was picked (null: the background). */
  select(id: string | null): void;
  /** The tooltip: text at a point of the stage, or hidden. */
  tip(text: string | null, sub?: string, x?: number, y?: number): void;
}

export interface View {
  /** New data (keeps what it can of the old layout). */
  setModel(model: Model): void;
  setSelected(id: string | null): void;
  /** Search: the nodes found (null: no search) and the words. */
  setFilter(ids: Set<string> | null, query?: string): void;
  /** Draws a frame; true while it still moves. */
  draw(ctx: CanvasRenderingContext2D, w: number, h: number, time: number): boolean;
  /** The node under a point of the canvas (CSS pixels). */
  hit(x: number, y: number): string | null;
  /** The tooltip for a point when no node is there (the timeline's events). */
  hover?(x: number, y: number): { text: string; sub: string } | null;
  pan(dx: number, dy: number): void;
  zoom(factor: number, x: number, y: number): void;
  /** Shows everything. */
  reset(): void;
}

export class Stage {
  readonly canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private view: View | null = null;
  private frame = 0;
  private w = 0;
  private h = 0;
  private dragging: { x: number; y: number; moved: boolean } | null = null;

  constructor(parent: HTMLElement, private host: Host) {
    parent.append(this.canvas);
    new ResizeObserver(() => this.resize()).observe(parent);
    this.canvas.addEventListener("pointerdown", (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      this.dragging = { x: e.clientX, y: e.clientY, moved: false };
    });
    this.canvas.addEventListener("pointermove", (e) => {
      const p = this.point(e);
      if (this.dragging) {
        const dx = e.clientX - this.dragging.x;
        const dy = e.clientY - this.dragging.y;
        if (this.dragging.moved || Math.abs(dx) + Math.abs(dy) > 3) {
          this.dragging.moved = true;
          this.canvas.classList.add("dragging");
          this.view?.pan(dx, dy);
          this.dragging.x = e.clientX;
          this.dragging.y = e.clientY;
          this.host.tip(null);
          this.wake();
        }
        return;
      }
      this.hoverAt(p.x, p.y);
    });
    this.canvas.addEventListener("pointerup", (e) => {
      const was = this.dragging;
      this.dragging = null;
      this.canvas.classList.remove("dragging");
      if (was && !was.moved) {
        const p = this.point(e);
        this.host.select(this.view?.hit(p.x, p.y) ?? null);
      }
    });
    this.canvas.addEventListener("pointerleave", () => this.host.tip(null));
    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      const p = this.point(e);
      this.view?.zoom(Math.exp(-e.deltaY * 0.0015), p.x, p.y);
      this.host.tip(null);
      this.wake();
    }, { passive: false });
    this.canvas.addEventListener("dblclick", () => {
      this.view?.reset();
      this.wake();
    });
    document.addEventListener("visibilitychange", () => this.wake());
  }

  private point(e: MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private hoverAt(x: number, y: number) {
    const id = this.view?.hit(x, y) ?? null;
    this.canvas.classList.toggle("pointing", !!id);
    if (id) {
      this.host.tip(id, undefined, x, y);
      return;
    }
    const ev = this.view?.hover?.(x, y);
    if (ev) this.host.tip(ev.text, ev.sub, x, y);
    else this.host.tip(null);
  }

  private resize() {
    const r = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.max(1, Math.round(r.width * dpr));
    this.canvas.height = Math.max(1, Math.round(r.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.wake();
  }

  get size() {
    return { w: this.w, h: this.h };
  }

  show(view: View) {
    this.view = view;
    this.host.tip(null);
    this.wake();
  }

  /** One more frame, and more while the view says it moves. */
  wake() {
    if (this.frame || document.hidden) return;
    this.frame = requestAnimationFrame((time) => this.tick(time));
  }

  private tick(time: number) {
    this.frame = 0;
    if (!this.view || this.w < 2) return;
    this.ctx.save();
    const more = this.view.draw(this.ctx, this.w, this.h, time);
    this.ctx.restore();
    if (more) this.wake();
  }
}

/** Pan and zoom of a 2D drawing: world → screen is (x * k + tx, y * k + ty). */
export class Camera {
  k = 1;
  tx = 0;
  ty = 0;
  /** Where it is going (smooth moves). */
  private goal: { k: number; tx: number; ty: number } | null = null;

  toScreen(x: number, y: number) {
    return { x: x * this.k + this.tx, y: y * this.k + this.ty };
  }

  toWorld(x: number, y: number) {
    return { x: (x - this.tx) / this.k, y: (y - this.ty) / this.k };
  }

  pan(dx: number, dy: number) {
    this.goal = null;
    this.tx += dx;
    this.ty += dy;
  }

  zoom(f: number, x: number, y: number) {
    this.goal = null;
    const k = Math.min(6, Math.max(0.08, this.k * f));
    const real = k / this.k;
    this.tx = x - (x - this.tx) * real;
    this.ty = y - (y - this.ty) * real;
    this.k = k;
  }

  /** Frames a box of the world in a w×h screen, smoothly or at once. */
  frame(box: { x0: number; y0: number; x1: number; y1: number }, w: number, h: number, now: boolean, pad = 60) {
    const bw = Math.max(1, box.x1 - box.x0);
    const bh = Math.max(1, box.y1 - box.y0);
    const k = Math.min(2.2, Math.max(0.08, Math.min((w - pad * 2) / bw, (h - pad * 2) / bh)));
    const goal = { k, tx: w / 2 - ((box.x0 + box.x1) / 2) * k, ty: h / 2 - ((box.y0 + box.y1) / 2) * k };
    if (now) {
      Object.assign(this, goal);
      this.goal = null;
    } else {
      this.goal = goal;
    }
  }

  /** Centres a world point smoothly. */
  centre(x: number, y: number, w: number, h: number) {
    this.goal = { k: this.k, tx: w / 2 - x * this.k, ty: h / 2 - y * this.k };
  }

  /** One step towards the goal; true while moving. */
  step(): boolean {
    if (!this.goal) return false;
    const g = this.goal;
    const s = 0.16;
    this.k += (g.k - this.k) * s;
    this.tx += (g.tx - this.tx) * s;
    this.ty += (g.ty - this.ty) * s;
    if (Math.abs(g.k - this.k) < 0.001 && Math.abs(g.tx - this.tx) < 0.5 && Math.abs(g.ty - this.ty) < 0.5) {
      Object.assign(this, g);
      this.goal = null;
    }
    return true;
  }

  apply(ctx: CanvasRenderingContext2D) {
    ctx.translate(this.tx, this.ty);
    ctx.scale(this.k, this.k);
  }
}

/** A faint field of stars behind the graphs, fixed per size. */
export function starfield(ctx: CanvasRenderingContext2D, w: number, h: number, cam: Camera) {
  const g = ctx.createRadialGradient(w * 0.5, h * 0.45, 0, w * 0.5, h * 0.45, Math.max(w, h) * 0.75);
  g.addColorStop(0, "#0e1120");
  g.addColorStop(1, "#06070a");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  // Parallax: the stars move a little with the camera.
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  ctx.fillStyle = "rgba(200,210,255,0.5)";
  for (let i = 0; i < 140; i++) {
    const x = (((rnd() * w * 1.4 + cam.tx * 0.08) % (w * 1.4)) + w * 1.4) % (w * 1.4) - w * 0.2;
    const y = (((rnd() * h * 1.4 + cam.ty * 0.08) % (h * 1.4)) + h * 1.4) % (h * 1.4) - h * 0.2;
    const r = rnd() * 1.1 + 0.2;
    ctx.globalAlpha = 0.15 + rnd() * 0.35;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
