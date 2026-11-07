// The memory around what the field at the top found: the node in the middle,
// its neighbours blooming around it, as in the Memory window and with its
// colours. Laid out by hand, so it never wobbles; a star that stays glides to
// its new place. Frames run only while something moves.

import { h } from "./dom";
import { t } from "../core/i18n";
import { KIND_COLOR, alpha, fit, kindName, type MemNode, type Model } from "../memory/data";

const RING = 7;
const OUTER = 5;
const MOVE_MS = 420;
const LINE_MS = 300;
const LEAVE_MS = 230;
const CAPTION_H = 34;
const STRIP_H = 178;
const MIN_H = 120;

interface Star {
  id: string;
  label: string;
  color: string;
  /** 0 the node looked at, 1 its neighbours, 2 one step further. */
  ring: number;
  fromX: number;
  fromY: number;
  fromA: number;
  toX: number;
  toY: number;
  toA: number;
  x: number;
  y: number;
  a: number;
  r: number;
  start: number;
  ms: number;
}

interface Line {
  from: string;
  to: string;
  start: number;
  ms: number;
  /** 0–1: how far it has drawn itself. */
  p: number;
  weak: boolean;
}

const easeOut = (x: number) => 1 - (1 - x) ** 3;
/** A little past the place, then back. */
const easeBack = (x: number) => 1 + 2.2 * (x - 1) ** 3 + 1.2 * (x - 1) ** 2;
const clamp = (x: number) => Math.min(1, Math.max(0, x));

function firstLine(text: string): string {
  return text.split("\n").find((l) => l.trim())?.trim() ?? "";
}

export class Constellation {
  readonly el: HTMLElement;
  /** A star was clicked. */
  onPick: (id: string) => void = () => {};
  /** «Apri nella Mappa». */
  onOpen: (id: string) => void = () => {};
  /** «Nuova chat». */
  onChat: (id: string) => void = () => {};

  private canvas = h("canvas", { class: "sky-canvas" }) as HTMLCanvasElement;
  private title = h("span", { class: "sky-title" });
  private gist = h("span", { class: "sky-gist" });
  private open = h("button", { class: "sky-open", text: t("Apri nella Mappa") }) as HTMLButtonElement;
  private chat = h("button", { class: "sky-open sky-chat", text: t("Nuova chat") }) as HTMLButtonElement;
  private stars = new Map<string, Star>();
  private lines = new Map<string, Line>();
  private centre = "";
  private pulse = 0;
  private hover = "";
  private frame = 0;
  private until = 0;
  private done: (() => void) | null = null;
  private dust: [number, number, number][] = [];
  private model: Model | null = null;
  private watch: ResizeObserver | null = null;
  private calm = matchMedia("(prefers-reduced-motion: reduce)").matches;

  constructor() {
    this.el = h("div", { class: "sky" }, this.canvas,
      h("div", { class: "sky-caption" }, h("span", { class: "sky-words" }, this.title, this.gist), this.open, this.chat));
    for (let i = 0; i < 46; i++) {
      // The same dust every time: it must not flicker.
      this.dust.push([(i * 0.6180339) % 1, (i * 0.3247179 + 0.13) % 1, 0.1 + ((i * 7) % 5) * 0.05]);
    }
    // The field keeps the keyboard.
    this.el.addEventListener("pointerdown", (e) => e.preventDefault());
    this.canvas.addEventListener("pointermove", (e) => {
      const near = this.starAt(e);
      if (near !== this.hover) {
        this.hover = near;
        this.canvas.style.cursor = near && near !== this.centre ? "pointer" : "";
        this.play(0);
      }
    });
    this.canvas.addEventListener("pointerleave", () => {
      this.hover = "";
      this.play(0);
    });
    this.canvas.addEventListener("click", (e) => {
      const near = this.starAt(e);
      if (near && near !== this.centre) this.onPick(near);
    });
    this.open.addEventListener("click", () => this.onOpen(this.centre));
    this.chat.addEventListener("click", () => this.onChat(this.centre));
  }

  get shown(): boolean {
    return this.el.classList.contains("on");
  }

  /** `id` in the middle, with what it is linked to. */
  show(model: Model, id: string) {
    const node = model.byId.get(id);
    if (!node) return;
    this.done = null;
    this.model = model;
    this.fit();
    if (!this.watch && this.el.parentElement) {
      // The island still opening, or resized: the strip follows.
      this.watch = new ResizeObserver(() => {
        if (!this.shown || !this.model) return;
        this.fit();
        const middle = this.model.byId.get(this.centre);
        if (middle) this.place(this.model, middle);
      });
      this.watch.observe(this.el.parentElement);
    }
    this.el.classList.add("on");
    this.title.textContent = node.label;
    const gist = node.kind === "page" ? firstLine(node.text) : kindName(node.kind);
    this.gist.textContent = gist === node.label ? "" : gist;
    if (id === this.centre) return;
    this.centre = id;
    this.place(model, node);
  }

  /** Everything back into the middle, then nothing. `now`: at once. */
  hide(now = false, after?: () => void) {
    this.done = null;
    const wasOn = this.shown;
    this.el.classList.remove("on");
    this.centre = "";
    if (now || !wasOn || this.calm) {
      this.stars.clear();
      this.lines.clear();
      cancelAnimationFrame(this.frame);
      this.frame = 0;
      after?.();
      return;
    }
    const { w, h: height } = this.size();
    const time = performance.now();
    for (const s of this.stars.values()) this.aim(s, w / 2, height / 2, 0, time, LEAVE_MS);
    this.lines.clear();
    this.done = () => {
      this.stars.clear();
      after?.();
    };
    this.play(LEAVE_MS);
  }

  /** Up to half the panel and a little: the results stay readable. */
  private fit() {
    const room = this.el.parentElement?.clientHeight ?? 0;
    this.el.style.setProperty("--sky-h", `${Math.round(Math.max(MIN_H, Math.min(STRIP_H, room * 0.55)))}px`);
  }

  private size() {
    return { w: this.canvas.clientWidth || 600, h: this.canvas.clientHeight || STRIP_H - CAPTION_H };
  }

  private aim(s: Star, x: number, y: number, a: number, start: number, ms: number) {
    s.fromX = s.x;
    s.fromY = s.y;
    s.fromA = s.a;
    s.toX = x;
    s.toY = y;
    s.toA = a;
    s.start = start;
    s.ms = ms;
  }

  /** Who goes where around `node`. */
  private place(model: Model, node: MemNode) {
    const { w, h: height } = this.size();
    const cx = w / 2;
    const cy = height / 2 - 4;
    const time = performance.now();
    const taken = new Set([node.id]);
    const wanted: { n: MemNode; ring: number; x: number; y: number; parent: string; weak: boolean; delay: number }[] = [
      { n: node, ring: 0, x: cx, y: cy, parent: "", weak: false, delay: 0 },
    ];
    const close = (id: string) => model.neighbours(id)
      .map((nb) => ({ nb, n: model.byId.get(nb.id) }))
      .filter((x): x is { nb: typeof x.nb; n: MemNode } => !!x.n && x.n.kind !== "day" && !taken.has(x.n.id))
      .sort((a, b) => Number(b.n.kind === "page") - Number(a.n.kind === "page") || b.nb.strength - a.nb.strength || b.n.weight - a.n.weight);
    const ring = close(node.id).filter((x, i, all) => all.findIndex((y) => y.n.id === x.n.id) === i).slice(0, RING);
    const rx = Math.min(w * 0.27, 210);
    const ry = height * 0.33;
    ring.forEach((x, i) => {
      taken.add(x.n.id);
      // Starting on the left: a wide strip fills its sides first.
      const angle = Math.PI + (i * Math.PI * 2) / Math.max(ring.length, 1) + 0.28;
      wanted.push({ n: x.n, ring: 1, x: cx + Math.cos(angle) * rx, y: cy + Math.sin(angle) * ry, parent: node.id, weak: x.nb.strength < 2, delay: 70 + i * 34 });
    });
    const rim = wanted.filter((x) => x.ring === 1);
    let added = 0;
    for (const p of rim) {
      if (added >= OUTER) break;
      const next = close(p.n.id)[0];
      if (!next) continue;
      taken.add(next.n.id);
      const dx = p.x - cx;
      const dy = p.y - cy;
      const side = Math.sign(dx) || 1;
      wanted.push({
        n: next.n, ring: 2,
        x: Math.min(w - 58, Math.max(58, cx + dx * 1.72 + side * 16)),
        y: Math.min(height - 22, Math.max(14, cy + dy * 1.28)),
        parent: p.n.id, weak: next.nb.strength < 2, delay: 300 + added * 40,
      });
      added++;
    }
    // Labels must not sit on each other: the outer star of a pair makes room.
    for (let pass = 0; pass < 8; pass++) {
      for (const p of wanted) {
        for (const q of wanted) {
          if (q.ring <= p.ring && !(q.ring === p.ring && q.n.id > p.n.id)) continue;
          if (Math.abs(p.x - q.x) >= 100 || Math.abs(p.y - q.y) >= 24) continue;
          const up = q.y < p.y || (q.y === p.y && q.x < cx);
          q.y = Math.min(height - 24, Math.max(10, q.y + (up ? -7 : 7)));
          q.x = Math.min(w - 58, Math.max(58, q.x + (q.x < cx ? -9 : 9)));
        }
      }
    }
    // Those that stay glide, the new ones come out of the star they hang from.
    const staying = new Set(wanted.map((x) => x.n.id));
    // A copy: the leaving ones change key, and a Map would show them again.
    for (const [id, s] of [...this.stars]) {
      if (staying.has(id) || id.startsWith("-")) continue;
      this.aim(s, cx, cy, 0, time, LEAVE_MS);
      s.id = `-${id}`;
      this.stars.delete(id);
      this.stars.set(s.id, s);
    }
    const colour = (n: MemNode) => model.groupColor(n.id) ?? KIND_COLOR[n.kind];
    const lines = new Map<string, Line>();
    for (const x of wanted) {
      const old = this.stars.get(x.n.id);
      const r = x.ring === 0 ? 7 : x.ring === 1 ? 3.6 + Math.min(x.n.weight, 12) * 0.16 : 2.8;
      if (old) {
        old.ring = x.ring;
        old.r = r;
        this.aim(old, x.x, x.y, 1, time, MOVE_MS);
      } else {
        const from = wanted.find((y) => y.n.id === x.parent);
        const sx = from?.x ?? cx;
        const sy = from?.y ?? cy;
        this.stars.set(x.n.id, {
          id: x.n.id, label: x.n.label, color: colour(x.n), ring: x.ring, r,
          fromX: sx, fromY: sy, fromA: 0, toX: x.x, toY: x.y, toA: 1, x: sx, y: sy, a: 0,
          start: time + x.delay, ms: MOVE_MS,
        });
      }
      if (x.parent) {
        const key = `${x.parent}>${x.n.id}`;
        const was = this.lines.get(key) ?? this.lines.get(`${x.n.id}>${x.parent}`);
        lines.set(key, was ? { ...was, from: x.parent, to: x.n.id, weak: x.weak } : { from: x.parent, to: x.n.id, start: time + x.delay, ms: LINE_MS, p: 0, weak: x.weak });
      }
    }
    this.lines = lines;
    this.pulse = time;
    this.play(MOVE_MS + 560);
  }

  /** Frames for `ms` more; 0: only one, for the mouse. */
  private play(ms: number) {
    this.until = Math.max(this.until, performance.now() + (this.calm ? 0 : ms));
    if (!this.frame) this.frame = requestAnimationFrame((now) => this.tick(now));
  }

  private tick(now: number) {
    this.frame = 0;
    this.step(now);
    this.draw(now);
    if (now < this.until) {
      this.frame = requestAnimationFrame((n) => this.tick(n));
    } else if (this.done) {
      const done = this.done;
      this.done = null;
      done();
    }
  }

  private step(now: number) {
    for (const [key, s] of this.stars) {
      const p = this.calm ? 1 : clamp((now - s.start) / s.ms);
      const leaving = s.toA === 0;
      const e = leaving ? easeOut(p) : easeBack(p);
      s.x = s.fromX + (s.toX - s.fromX) * e;
      s.y = s.fromY + (s.toY - s.fromY) * e;
      s.a = s.fromA + (s.toA - s.fromA) * clamp(p * 1.6);
      if (leaving && p >= 1 && key.startsWith("-")) this.stars.delete(key);
    }
    for (const l of this.lines.values()) l.p = this.calm ? 1 : Math.max(l.p, easeOut(clamp((now - l.start) / l.ms)));
  }

  private draw(now: number) {
    const { w, h: height } = this.size();
    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(w * dpr) || this.canvas.height !== Math.round(height * dpr)) {
      this.canvas.width = Math.round(w * dpr);
      this.canvas.height = Math.round(height * dpr);
    }
    const ctx = this.canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, height);
    const ink = getComputedStyle(this.el).color;
    const fade = Math.max(0, ...[...this.stars.values()].map((s) => s.a));
    for (const [x, y, a] of this.dust) {
      ctx.fillStyle = `rgba(200,210,240,${a * fade})`;
      ctx.fillRect(x * w, y * height, 1.2, 1.2);
    }
    for (const l of this.lines.values()) {
      const a = this.stars.get(l.from);
      const b = this.stars.get(l.to);
      if (!a || !b || l.p <= 0) continue;
      const hx = a.x + (b.x - a.x) * l.p;
      const hy = a.y + (b.y - a.y) * l.p;
      const lit = this.hover === l.to || this.hover === l.from;
      ctx.strokeStyle = alpha(b.color, (lit ? 0.85 : 0.42) * Math.min(a.a, b.a));
      ctx.lineWidth = lit ? 1.5 : 1;
      if (l.weak) ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(hx, hy);
      ctx.stroke();
      ctx.setLineDash([]);
      // The spark at the head of a line drawing itself.
      if (l.p < 1) {
        ctx.fillStyle = "rgba(255,255,255,0.95)";
        ctx.beginPath();
        ctx.arc(hx, hy, 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    const middle = this.stars.get(this.centre);
    if (middle && !this.calm) {
      const p = clamp((now - this.pulse) / 620);
      if (p < 1) {
        ctx.strokeStyle = alpha(middle.color, 0.55 * (1 - p));
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.arc(middle.x, middle.y, middle.r + 34 * easeOut(p), 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    for (const s of this.stars.values()) {
      if (s.a <= 0.01) continue;
      const lit = s.id === this.hover;
      const r = s.r * (lit ? 1.25 : 1);
      const halo = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, r * 3.2);
      halo.addColorStop(0, alpha(s.color, (s.ring === 0 ? 0.42 : 0.26) * s.a));
      halo.addColorStop(1, alpha(s.color, 0));
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r * 3.2, 0, Math.PI * 2);
      ctx.fill();
      const body = ctx.createRadialGradient(s.x - r * 0.3, s.y - r * 0.3, 0, s.x, s.y, r);
      body.addColorStop(0, `rgba(255,255,255,${s.a})`);
      body.addColorStop(0.4, alpha(s.color, s.a));
      body.addColorStop(1, alpha(s.color, 0.75 * s.a));
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fill();
      if (s.id.startsWith("-")) continue;
      ctx.font = s.ring === 0 ? "600 11.5px Segoe UI, sans-serif" : "500 10.5px Segoe UI, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.globalAlpha = s.a * (s.ring === 2 && !lit ? 0.62 : s.ring === 1 && !lit ? 0.84 : 1);
      ctx.fillStyle = ink;
      ctx.fillText(fit(ctx, s.label, s.ring === 0 ? 170 : 104), s.x, s.y + r + 3);
      ctx.globalAlpha = 1;
    }
  }

  private starAt(e: MouseEvent): string {
    const box = this.canvas.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    let best = "";
    let far = 17 * 17;
    for (const s of this.stars.values()) {
      const d = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d < far && !s.id.startsWith("-")) {
        far = d;
        best = s.id;
      }
    }
    return best;
  }
}
