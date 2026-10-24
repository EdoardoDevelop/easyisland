// The memory as the window sees it (brain.rs `graph`): nodes, links, the timeline.

import { t } from "../core/i18n";

export type NodeKind = "page" | "missing" | "note" | "old" | "source" | "day";

export interface MemNode {
  id: string;
  kind: NodeKind;
  label: string;
  date: string;
  text: string;
  weight: number;
}

export interface MemEdge {
  from: string;
  to: string;
  label: string;
}

export interface MemEvent {
  date: string;
  lane: "note" | "page" | "diary" | "source";
  text: string;
  node: string;
}

export interface MemGraph {
  nodes: MemNode[];
  edges: MemEdge[];
  events: MemEvent[];
  check: string[];
  inbox: string[];
  folder: string;
}

export const KIND_COLOR: Record<NodeKind, string> = {
  page: "#7c9cff",
  missing: "#6b7079",
  note: "#f5a524",
  old: "#9a7b3c",
  source: "#22c55e",
  day: "#c084fc",
};

export function kindName(kind: NodeKind): string {
  switch (kind) {
    case "page": return t("Pagina");
    case "missing": return t("Pagina da scrivere");
    case "note": return t("Nota");
    case "old": return t("Nota archiviata");
    case "source": return t("Fonte");
    case "day": return t("Giorno di chat");
  }
}

/** Who is linked to whom, both ways, with the relation. */
export interface Neighbour {
  id: string;
  label: string;
  out: boolean;
}

export class Model {
  readonly byId = new Map<string, MemNode>();
  readonly around = new Map<string, Neighbour[]>();

  constructor(readonly g: MemGraph) {
    for (const n of g.nodes) this.byId.set(n.id, n);
    for (const e of g.edges) {
      if (!this.byId.has(e.from) || !this.byId.has(e.to)) continue;
      this.link(e.from, { id: e.to, label: e.label, out: true });
      this.link(e.to, { id: e.from, label: e.label, out: false });
    }
  }

  private link(id: string, n: Neighbour) {
    const list = this.around.get(id);
    if (list) list.push(n);
    else this.around.set(id, [n]);
  }

  neighbours(id: string): Neighbour[] {
    return this.around.get(id) ?? [];
  }

  /** The node to start from: the most linked page. */
  centre(): string | null {
    let best: MemNode | null = null;
    for (const n of this.g.nodes) {
      if (n.kind !== "page" && n.kind !== "missing") continue;
      if (!best || n.weight > best.weight) best = n;
    }
    return best?.id ?? this.g.nodes[0]?.id ?? null;
  }

  /** Nodes whose label or text has every word of `query`. */
  matches(query: string): Set<string> {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    const out = new Set<string>();
    if (!words.length) return out;
    for (const n of this.g.nodes) {
      const hay = `${n.label} ${n.text}`.toLowerCase();
      if (words.every((w) => hay.includes(w))) out.add(n.id);
    }
    return out;
  }
}

/** "#rrggbb" with an alpha. */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** A text cut to fit `max` pixels in the current font. */
export function fit(ctx: CanvasRenderingContext2D, text: string, max: number): string {
  if (ctx.measureText(text).width <= max) return text;
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (ctx.measureText(`${text.slice(0, mid)}…`).width <= max) lo = mid;
    else hi = mid - 1;
  }
  return `${text.slice(0, lo)}…`;
}
