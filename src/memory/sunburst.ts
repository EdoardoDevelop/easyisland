// Raggiera: concentric rings. In the middle the memory; around it the pages,
// each as wide as the notes it gathers; outside, the notes of each page. It
// shows at a glance which subjects weigh most. A click on a slice picks it;
// the colours are the groups' (data.ts).

import { KIND_COLOR, alpha, fit, type MemNode, type Model } from "./data";
import { t } from "../core/i18n";
import { animateIdle, type View } from "./stage";
import { font, paintBackground, pal } from "./theme";

interface Slice {
  id: string;
  label: string;
  a0: number;
  a1: number;
  r0: number;
  r1: number;
  colour: string;
}

/** Pages shown one by one; the others are one slice «Altre». */
const MAX_PAGES = 28;

export class SunburstView implements View {
  private slices: Slice[] = [];
  private model: Model | null = null;
  private selected: string | null = null;
  private filter: Set<string> | null = null;
  private k = 1;
  private tx = 0;
  private ty = 0;
  private notes = 0;
  private pages = 0;

  setModel(model: Model) {
    this.model = model;
    this.layout();
  }

  private layout() {
    const m = this.model;
    this.slices = [];
    if (!m) return;
    const pages = m.g.nodes.filter((n) => n.kind === "page" || n.kind === "missing");
    const notesOf = (p: MemNode) => m.neighbours(p.id).map((nb) => m.byId.get(nb.id)).filter((n): n is MemNode => !!n && (n.kind === "note" || n.kind === "old"));
    const ranked = pages.map((p) => ({ p, notes: notesOf(p) })).sort((a, b) => b.notes.length - a.notes.length || b.p.weight - a.p.weight);
    const shown = ranked.slice(0, MAX_PAGES);
    const rest = ranked.slice(MAX_PAGES);
    this.pages = pages.length;
    this.notes = m.g.nodes.filter((n) => n.kind === "note").length;
    const total = shown.reduce((s, x) => s + 1 + x.notes.length, 0) + (rest.length ? rest.length : 0);
    let a = -Math.PI / 2;
    const span = (n: number) => (n / Math.max(1, total)) * Math.PI * 2;
    for (const { p, notes } of shown) {
      const width = span(1 + notes.length);
      const colour = m.groupColor(p.id) ?? KIND_COLOR[p.kind];
      this.slices.push({ id: p.id, label: p.label, a0: a, a1: a + width, r0: 0.3, r1: 0.62, colour });
      // Its notes outside, side by side.
      const each = notes.length ? (width - span(1) * 0.2) / notes.length : 0;
      notes.forEach((n, i) => {
        const b = a + span(1) * 0.1 + i * each;
        this.slices.push({ id: n.id, label: n.label, a0: b, a1: b + each, r0: 0.64, r1: 0.92, colour: m.groupColor(n.id) ?? colour });
      });
      a += width;
    }
    if (rest.length) this.slices.push({ id: "", label: t("{n} pagine in più", { n: rest.length }), a0: a, a1: a + span(rest.length), r0: 0.3, r1: 0.62, colour: "#8a8f99" });
  }

  setSelected(id: string | null) {
    this.selected = id;
  }

  setFilter(ids: Set<string> | null) {
    this.filter = ids;
  }

  private geometry(w: number, h: number) {
    const R = (Math.min(w, h) / 2 - 30) * this.k;
    return { cx: w / 2 + this.tx, cy: h / 2 + this.ty, R };
  }

  private size = { w: 0, h: 0 };
  private hoveredSlice: Slice | null = null;
  private lastSpin = 0;

  draw(ctx: CanvasRenderingContext2D, w: number, h: number, time = 0): boolean {
    this.size = { w, h };
    paintBackground(ctx, w, h);
    const p = pal();
    const idle = animateIdle();
    const spin = idle ? Math.sin(time * 0.0005) * 0.04 : 0;
    this.lastSpin = spin;
    const { cx, cy, R } = this.geometry(w, h);
    const sel = this.selected;
    const near = new Set<string>();
    if (sel && this.model) for (const nb of this.model.neighbours(sel)) near.add(nb.id);
    for (const s of this.slices) {
      const span = s.a1 - s.a0;
      const gap = span > 0.03 ? Math.min(0.01, span * 0.12) : 0;
      const a0 = s.a0 + gap / 2 + spin;
      const a1 = s.a1 - gap / 2 + spin;
      if (a1 <= a0) continue;
      const isHover = s === this.hoveredSlice;
      const on = (!sel && !this.filter) || s.id === sel || near.has(s.id) || !!this.filter?.has(s.id);
      ctx.fillStyle = alpha(s.colour, on ? (isHover ? 0.96 : s.r0 < 0.5 ? 0.85 : 0.62) : 0.15);
      ctx.beginPath();
      ctx.arc(cx, cy, (s.r1 + (isHover ? 0.015 : 0)) * R, a0, a1);
      ctx.arc(cx, cy, s.r0 * R, a1, a0, true);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = s.id === sel || isHover ? p.ring : p.bg;
      ctx.lineWidth = s.id === sel || isHover ? 2 : 1.1;
      ctx.stroke();
      // The pages' names along their slice, when it is wide enough.
      if (s.r0 < 0.5 && (a1 - a0) * 0.46 * R > 28) {
        const mid = (a0 + a1) / 2;
        const r = 0.46 * R;
        ctx.save();
        ctx.translate(cx + Math.cos(mid) * r, cy + Math.sin(mid) * r);
        let rot = mid;
        if (Math.cos(mid) < 0) rot += Math.PI;
        ctx.rotate(rot);
        ctx.fillStyle = on ? sliceContrast(s.colour) : p.dim;
        ctx.font = font(Math.max(11.5, Math.min(13, R / 26)), 600);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(fit(ctx, s.label, 0.3 * R), 0, 0);
        ctx.restore();
      }
    }
    // The middle: hovered slice details or overall memory numbers.
    ctx.fillStyle = p.card;
    ctx.beginPath();
    ctx.arc(cx, cy, 0.28 * R, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = this.hoveredSlice ? this.hoveredSlice.colour : p.line;
    ctx.lineWidth = this.hoveredSlice ? 1.8 : 1;
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    if (this.hoveredSlice) {
      ctx.fillStyle = p.ink;
      ctx.font = font(Math.max(12, R / 22), 600);
      ctx.fillText(fit(ctx, this.hoveredSlice.label, 0.48 * R), cx, cy - R * 0.03);
      const pct = Math.max(1, Math.round(((this.hoveredSlice.a1 - this.hoveredSlice.a0) / (Math.PI * 2)) * 100));
      ctx.font = font(Math.max(11.5, R / 28));
      ctx.fillStyle = p.dim;
      ctx.fillText(`${pct}%`, cx, cy + R * 0.06);
    } else {
      ctx.fillStyle = p.ink;
      ctx.font = font(Math.max(16, R / 12), 600);
      ctx.fillText(String(this.notes), cx, cy - R * 0.04);
      ctx.font = font(Math.max(12, R / 30));
      ctx.fillStyle = p.dim;
      ctx.fillText(t("note · {n} pagine", { n: this.pages }), cx, cy + R * 0.07);
    }
    return idle;
  }

  private at(x: number, y: number): Slice | null {
    const { cx, cy, R } = this.geometry(this.size.w, this.size.h);
    const d = Math.hypot(x - cx, y - cy) / R;
    let a = Math.atan2(y - cy, x - cx) - this.lastSpin;
    while (a < -Math.PI / 2) a += Math.PI * 2;
    while (a > Math.PI * 1.5) a -= Math.PI * 2;
    return this.slices.find((s) => d >= s.r0 && d <= s.r1 && a >= s.a0 && a <= s.a1) ?? null;
  }

  hit(x: number, y: number): string | null {
    const s = this.at(x, y);
    return s?.id || null;
  }

  hover(x: number, y: number) {
    const s = this.at(x, y);
    this.hoveredSlice = s;
    return s && !s.id ? { text: s.label, sub: "" } : null;
  }

  pan(dx: number, dy: number) {
    this.tx += dx;
    this.ty += dy;
  }

  zoom(f: number) {
    this.k = Math.min(4, Math.max(0.4, this.k * f));
  }

  reset() {
    this.k = 1;
    this.tx = 0;
    this.ty = 0;
  }
}

/** Contrasto testo in base alla luminanza percettiva dello spicchio. */
function sliceContrast(hex: string): string {
  const m = hex.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i);
  if (!m) return "#0b0b0b";
  const lum = (0.299 * parseInt(m[1], 16) + 0.587 * parseInt(m[2], 16) + 0.114 * parseInt(m[3], 16)) / 255;
  return lum > 0.56 ? "#0e1015" : "#f8fafc";
}
