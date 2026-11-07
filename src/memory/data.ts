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
  /** The other PC whose memory it comes from (empty: this PC). */
  origin?: string;
}

export interface MemEdge {
  from: string;
  to: string;
  label: string;
  /** 3 written or judged by the AI, 2 the note names the page or (between pages) inferred, 1 a guess (brain.rs). */
  strength?: number;
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
  /** The other PCs whose memory is copied here (Agent Chat → «Memoria di un altro PC»). */
  sources?: string[];
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
  /** 1 guess, 2 named, 3 written or judged by the AI. */
  strength: number;
}

export class Model {
  readonly byId = new Map<string, MemNode>();
  readonly around = new Map<string, Neighbour[]>();

  constructor(readonly g: MemGraph) {
    for (const n of g.nodes) this.byId.set(n.id, n);
    for (const e of g.edges) {
      if (!this.byId.has(e.from) || !this.byId.has(e.to)) continue;
      const strength = e.strength ?? 3;
      this.link(e.from, { id: e.to, label: e.label, out: true, strength });
      this.link(e.to, { id: e.from, label: e.label, out: false, strength });
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

  private grouped: { groups: Group[]; of: Map<string, number> } | null = null;

  /** The groups of the memory (computed once per model). */
  groups(): { groups: Group[]; of: Map<string, number> } {
    if (!this.grouped) {
      this.grouped = findGroups(this, (a, b) => this.neighbours(a).find((n) => n.id === b)?.strength ?? 1);
    }
    return this.grouped;
  }

  /** The group's colour of a node, or null when it is in none. */
  groupColor(id: string): string | null {
    const { groups, of } = this.groups();
    const g = of.get(id);
    return g == null ? null : groups[g]?.color ?? null;
  }

  /** Notes tied to nothing: to link. */
  lonely(): MemNode[] {
    return this.g.nodes.filter((n) => (n.kind === "note" || n.kind === "old") && !this.neighbours(n.id).length);
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

// ── What the views share: groups, freshness, paths, provenance ───────────────

/** Colours of the groups (graph, galaxy, bubbles, stream): distinct on the dark sky. */
export const GROUP_COLORS = ["#7c9cff", "#f5a524", "#22c55e", "#f472b6", "#38bdf8", "#c084fc", "#fb7185", "#a3e635", "#fbbf24", "#2dd4bf", "#e879f9", "#94a3b8"];

/** A group of nodes tied more among them than with the rest (a customer and its notes). */
export interface Group {
  id: number;
  name: string;
  color: string;
  members: string[];
}

/** 0–1: how recent a date is (a note of today 1, of three months ago ~0.1); no date 0.35. */
export function freshness(date: string): number {
  const t = Date.parse(date.slice(0, 10));
  if (!Number.isFinite(t)) return 0.35;
  const days = Math.max(0, (Date.now() - t) / 86_400_000);
  return Math.max(0.08, Math.exp(-days / 45));
}

/** Where a note came from, read from its text («(Agent Chat)», «(da casa)»…). */
export type Provenance = "chat" | "agentchat" | "pc" | "ticket" | "mail" | "call" | "telegram" | "file";

export function provenanceName(p: Provenance): string {
  switch (p) {
    case "chat": return t("Chat");
    case "agentchat": return t("Agent Chat");
    case "pc": return t("Altro PC");
    case "ticket": return t("Ticket");
    case "mail": return t("Mail");
    case "call": return t("Chiamate");
    case "telegram": return t("Telegram");
    case "file": return t("File letti");
  }
}

export function provenance(n: MemNode): Provenance {
  if (n.kind === "source") return "file";
  const x = n.text.toLowerCase();
  if (x.includes("(agent chat)")) return "agentchat";
  if (/\(da [\w.-]+\)/.test(x)) return "pc";
  if (/\bticket\b|zammad/.test(x)) return "ticket";
  if (/\bmail\b|\be-?mail\b|outlook/.test(x)) return "mail";
  if (/chiamat|telefonat|3cx/.test(x)) return "call";
  if (x.includes("telegram")) return "telegram";
  return "chat";
}

/**
 * Groups by label propagation: each node takes the group most of its
 * neighbours have (stronger links count more), in a fixed order so the same
 * memory gives the same groups. Groups under 3 nodes stay without colour.
 */
export function findGroups(m: Model, strength: (a: string, b: string) => number): { groups: Group[]; of: Map<string, number> } {
  const ids = [...m.byId.keys()].sort();
  const label = new Map<string, string>(ids.map((id) => [id, id]));
  for (let round = 0; round < 24; round++) {
    let changed = 0;
    for (const id of ids) {
      const votes = new Map<string, number>();
      for (const nb of m.neighbours(id)) {
        const l = label.get(nb.id)!;
        votes.set(l, (votes.get(l) ?? 0) + strength(id, nb.id));
      }
      let best = label.get(id)!;
      let bestV = 0;
      for (const [l, v] of [...votes].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        if (v > bestV) {
          best = l;
          bestV = v;
        }
      }
      if (best !== label.get(id)) {
        label.set(id, best);
        changed++;
      }
    }
    if (!changed) break;
  }
  const byLabel = new Map<string, string[]>();
  for (const id of ids) {
    const l = label.get(id)!;
    const list = byLabel.get(l);
    if (list) list.push(id);
    else byLabel.set(l, [id]);
  }
  const big = [...byLabel.values()].filter((l) => l.length >= 3).sort((a, b) => b.length - a.length);
  const groups: Group[] = [];
  const of = new Map<string, number>();
  big.forEach((members, i) => {
    // Named after its most linked page, else its most linked node.
    const pages = members.map((id) => m.byId.get(id)!).filter((n) => n.kind === "page");
    const lead = (pages.length ? pages : members.map((id) => m.byId.get(id)!)).sort((a, b) => b.weight - a.weight)[0];
    groups.push({ id: i, name: lead?.label ?? t("Gruppo"), color: GROUP_COLORS[i % GROUP_COLORS.length], members });
    for (const id of members) of.set(id, i);
  });
  return { groups, of };
}

/** The shortest way from one node to another (its ids, both ends included), or null. */
export function pathBetween(m: Model, from: string, to: string): string[] | null {
  if (from === to) return [from];
  const back = new Map<string, string>([[from, ""]]);
  let ring = [from];
  while (ring.length) {
    const next: string[] = [];
    for (const id of ring) {
      for (const nb of m.neighbours(id)) {
        if (back.has(nb.id)) continue;
        back.set(nb.id, id);
        if (nb.id === to) {
          const path = [to];
          let at = id;
          while (at) {
            path.push(at);
            at = back.get(at) ?? "";
          }
          return path.reverse();
        }
        next.push(nb.id);
      }
    }
    ring = next;
  }
  return null;
}

/** A node and what is within `depth` steps of it. */
export function around(m: Model, id: string, depth: number): Set<string> {
  const seen = new Set([id]);
  let ring = [id];
  for (let d = 0; d < depth; d++) {
    const next: string[] = [];
    for (const x of ring) for (const nb of m.neighbours(x)) if (!seen.has(nb.id)) { seen.add(nb.id); next.push(nb.id); }
    ring = next;
  }
  return seen;
}
