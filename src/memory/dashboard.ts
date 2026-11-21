// «Panoramica»: the memory window's first screen (Edoardo, 17 Nov 2026: «vorrei
// un qualcosa di molto simile … dati della memoria riassunti cliccabili … voglio
// qualcosa di così ricco»). A dense dashboard over the real memory: the numbers
// on top, the latest events on the left, the nucleus in the middle (the notes
// and pages as particles, the groups as rings), the stages of the memory's work
// on the right with their buttons, the most linked pages as chips, the live
// log and three periods to compare at the bottom. Every piece is a way into the
// other views (main.ts DashHost). DOM, plus one canvas for the nucleus that
// moves only while the window is visible and in front, at 30 fps at most.

import { t, tn } from "../core/i18n";

import { h, clear, svg } from "../views/dom";
import { Bridge, IS_TAURI } from "../core/bridge";
import { GROUP_COLORS, KIND_COLOR, alpha, freshness, kindName, shortDate, type MemGraph, type MemNode, type Model, type NodeKind } from "./data";
import { animateIdle, type Colouring } from "./stage";
import { pal } from "./theme";
import "./dashboard.css";

export type Period = "all" | "30" | "90" | "365";

/** What the dashboard asks of the window (main.ts). */
export interface DashHost {
  /** A node: the graph with it picked. */
  open(id: string): void;
  /** Some nodes: the graph with them lit. */
  openSet(ids: string[]): void;
  /** A group: the bubbles with its lead picked. */
  openGroup(lead: string): void;
  openInbox(): void;
  read(): void;
  link(): void;
  check(): void;
  setPeriod(p: Period): void;
  toggleKind(kind: NodeKind): void;
  setSure(on: boolean): void;
  setColours(c: Colouring): void;
}

export interface DashState {
  /** With the filters. */
  model: Model;
  /** As read, for the periods to compare. */
  full: MemGraph;
  period: Period;
  hidden: NodeKind[];
  sure: boolean;
  colours: Colouring;
  /** The copy of another PC (or Claude Code's notes): read only, no jobs. */
  copy: boolean;
  /** «Tutte» or Claude Code: no «Collega». */
  noLink: boolean;
}

const DAY = 86_400_000;
const LINE = {
  read: "M6 3.5h8l4 4v13H6zM14 3.5v4h4M9 12h6M9 15.5h6",
  link: "M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1",
  check: "M12 3.5l7 2.8v5.2c0 4.2-3 7.5-7 9-4-1.5-7-4.8-7-9V6.3zM9 12l2 2 4-4",
  inbox: "M4 13.5h4.5l1.5 2.5h4l1.5-2.5H20M4 13.5 6.5 5h11l2.5 8.5V19H4z",
  page: "M7 3.5h7l4 4v13H7zM10 11h5M10 14.5h5M10 18h3",
  source: "M4 6.5h6l2 2h8v10H4zM4 10.5h16",
};
const days = (date: string) => {
  const d = Date.parse((date ?? "").slice(0, 10));
  return Number.isFinite(d) ? (Date.now() - d) / DAY : Infinity;
};
const isNote = (n: MemNode) => n.kind === "note" || n.kind === "old";
const isPage = (n: MemNode) => n.kind === "page" || n.kind === "missing";
/**
 * A line of the chat diary (brain.rs: «motore · domanda → risposta»): the
 * question is what the chat was about; the engine goes small at the end.
 */
function diaryLine(text: string): { title: string; engine: string } {
  const m = /^([^·\n]{1,40}?) · ([\s\S]*)$/.exec(text);
  const rest = m ? m[2] : text;
  const question = rest.split(" → ")[0].trim();
  return { title: question || rest, engine: m ? m[1].trim() : "" };
}

/** Short labels for the feed's tags. */
const TAG: Partial<Record<NodeKind, string>> = { note: t("nota"), page: t("pagina"), source: t("fonte"), day: t("chat") };
const LANE_KIND: Record<string, NodeKind> = { note: "note", page: "page", diary: "day", source: "source" };

export class Dashboard {
  readonly el = h("div", { class: "dash", "aria-label": t("Panoramica della memoria") });
  private state: DashState | null = null;
  private core: Nucleus;

  // The pieces, filled by update().
  private status = h("span", { class: "dash-status" });
  private numbers = h("div", { class: "dash-numbers" });
  private feed = h("div", { class: "dash-feed-list" });
  private live: HTMLElement[] = [];
  private coreNumber = h("div", { class: "dash-core-number" });
  private filtersBox = h("div", { class: "dash-float dash-filters" });
  private weekBox = h("div", { class: "dash-float dash-week" });
  private stages = h("div", { class: "dash-stages-list" });
  private tokens = h("div", { class: "dash-tokens-list" });
  private term = h("div", { class: "dash-term-lines", role: "log", "aria-live": "polite" });
  private periods = h("div", { class: "dash-periods" });
  private tip = h("div", { class: "dash-tip" });
  /** What the field at the top found (null: no search), and its words. */
  private found: Set<string> | null = null;
  private query = "";
  private searchNote = h("div", { class: "dash-search-note", hidden: "" });
  /** «Chiedi alla memoria»: the conversation, the field, the nodes of the last answer. */
  private askLines = h("div", { class: "dash-term-lines dash-ask-lines", role: "log", "aria-live": "polite" });
  private askField = h("input", { class: "dash-ask-field", type: "text", placeholder: t("chiedi qualcosa sulla memoria…"), "aria-label": t("Chiedi alla memoria"), spellcheck: "false" }) as HTMLInputElement;
  private asked: Set<string> | null = null;
  private history: { q: string; a: string }[] = [];
  private asking = false;

  constructor(private host: DashHost) {
    const head = h("div", { class: "dash-box dash-top" },
      h("div", { class: "dash-title" },
        h("span", { class: "dash-kicker", text: t("memoria") }),
        h("b", { text: t("Panoramica") }),
        this.status,
        this.searchNote),
      this.numbers);
    const feedBox = h("div", { class: "dash-box dash-feed" },
      h("div", { class: "dash-label" }, h("span", { text: t("ultimi arrivi") }), h("span", { class: "dash-live-dot", text: t("dal vivo") })),
      this.feed);
    const stage = h("div", { class: "dash-core-stage" });
    this.core = new Nucleus(stage, {
      pick: (id) => host.open(id),
      group: (lead) => host.openGroup(lead),
      tip: (text, sub, x, y) => this.showTip(text, sub, x, y),
      feedRows: () => this.feedRows(stage),
      hoverNode: (id) => this.lightRow(id),
    });
    // The lines follow the rows when the column scrolls.
    this.feed.addEventListener("scroll", () => this.core.wake(), { passive: true });
    // A row under the mouse lights its line and its particle.
    this.feed.addEventListener("pointerover", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>(".dash-feed-row");
      this.core.setHoverRow(row?.dataset.node || null);
    });
    this.feed.addEventListener("pointerleave", () => this.core.setHoverRow(null));
    const floats = h("div", { class: "dash-floats" }, this.filtersBox, this.weekBox);
    stage.append(this.tip, floats);
    const coreBox = h("div", { class: "dash-box dash-core" }, stage, this.coreNumber);
    const stagesBox = h("div", { class: "dash-box dash-stages" },
      h("div", { class: "dash-label" }, h("span", { text: t("tappe") }), h("span", { text: t("fonti → controllo") })),
      this.stages);
    const tokensBox = h("div", { class: "dash-box dash-tokens" },
      h("div", { class: "dash-label" }, h("span", { text: t("pagine più collegate") }), h("span", { text: t("clic per aprire") })),
      this.tokens);
    const termBox = h("div", { class: "dash-box dash-term" },
      h("div", { class: "dash-term-head" }, h("i"), h("i"), h("i"), h("span", { text: t("~ registro della memoria") })),
      this.term);
    const askBox = h("div", { class: "dash-box dash-term dash-ask" },
      h("div", { class: "dash-term-head" }, h("i"), h("i"), h("i"), h("span", { text: t("~ chiedi alla memoria") })),
      this.askLines,
      h("label", { class: "dash-ask-row" }, h("span", { class: "dash-prompt", text: "›" }), this.askField));
    this.askField.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        void this.ask(this.askField.value);
      } else if (e.key === "Escape" && this.asked) {
        e.stopPropagation();
        this.asked = null;
        this.applySearch();
      }
    });
    this.askLine("note", t("rispondo solo con quello che c'è nella memoria: chi è, dove sta, cosa dice una pagina…"));
    const termRow = h("div", { class: "dash-term-row" }, termBox, askBox);
    const cmpBox = h("div", { class: "dash-box dash-compare" }, this.periods);
    this.el.append(head, feedBox, coreBox, stagesBox, tokensBox, termRow, cmpBox);
    new ResizeObserver(() => {
      const w = coreBox.getBoundingClientRect().width;
      const narrow = w > 0 && w < 640;
      coreBox.classList.toggle("narrow", narrow);
      // Narrow: the small boxes go under the nucleus, out of its stage.
      if (narrow && floats.parentElement === stage) coreBox.insertBefore(floats, this.coreNumber);
      if (!narrow && floats.parentElement !== stage) stage.append(floats);
      // Low: «Questa settimana» gives its room to the filters (its numbers are also on top).
      coreBox.classList.toggle("short", !narrow && stage.getBoundingClientRect().height < 430);
    }).observe(coreBox);
  }

  /** On screen or not: the nucleus moves only while it is. */
  show(on: boolean) {
    this.el.hidden = !on;
    this.core.setShown(on);
  }

  update(s: DashState) {
    const first = !this.state;
    this.state = s;
    this.core.setData(s.model, s.colours, new Set(this.feedEvents(s).map((e) => this.nodeOf(s, e)).filter(Boolean)));
    this.renderTop(s);
    this.renderFeed(s);
    this.renderCore(s);
    this.renderStages(s);
    this.renderTokens(s);
    this.renderPeriods(s);
    this.applySearch();
    if (first) this.greet(s);
  }

  /**
   * The field at the top (main.ts applySearch): the nucleus lights what it
   * found and dims the rest, the feed and the chips keep only what matches,
   * the count under the title. Null: everything as before.
   */
  setSearch(ids: Set<string> | null, query: string) {
    this.found = ids;
    this.query = query.trim();
    this.applySearch();
  }

  private applySearch() {
    const ids = this.found;
    const words = this.query.toLowerCase().split(/\s+/).filter(Boolean);
    // No search: the nodes of the last answer stay lit.
    this.core.setMatch(ids ?? this.asked);
    const hit = (el: HTMLElement) => {
      if (!ids) return true;
      const id = el.dataset.node;
      if (id && ids.has(id)) return true;
      const text = (el.title || el.textContent || "").toLowerCase();
      return words.length > 0 && words.every((w) => text.includes(w));
    };
    for (const el of this.feed.querySelectorAll<HTMLElement>(".dash-feed-row")) el.hidden = !hit(el);
    for (const el of this.tokens.querySelectorAll<HTMLElement>(".dash-token")) el.hidden = !hit(el);
    this.el.classList.toggle("searching", !!ids);
    this.searchNote.hidden = !ids;
    if (ids) {
      this.searchNote.textContent = ids.size
        ? `${tn("«{q}»: {n} risultato", "«{q}»: {n} risultati", ids.size, { q: this.query })} · ${t("Invio apre il primo nel grafo")}`
        : t("«{q}»: niente nella memoria", { q: this.query });
      this.searchNote.classList.toggle("none", !ids.size);
    }
    this.core.wake();
  }

  /** A particle under the mouse: its row in the feed lights up (and comes into view when it is near). */
  private lightRow(id: string | null) {
    for (const el of this.feed.querySelectorAll<HTMLElement>(".dash-feed-row.lit")) el.classList.remove("lit");
    if (!id) return;
    for (const el of this.feed.querySelectorAll<HTMLElement>(".dash-feed-row")) if (el.dataset.node === id) el.classList.add("lit");
  }

  // ── Top ──────────────────────────────────────────────────────────────────

  private renderTop(s: DashState) {
    const g = s.model.g;
    const count = (k: NodeKind[]) => g.nodes.filter((n) => k.includes(n.kind)).length;
    const fresh = g.nodes.filter((n) => n.kind !== "day" && days(n.date) <= 7);
    const lonely = s.model.lonely();
    const todo = lonely.length + count(["missing"]) + g.check.length;
    this.status.textContent = s.copy ? t("copia di un altro PC · si legge soltanto")
      : g.inbox.length || todo ? [g.inbox.length && t("{n} da leggere", { n: g.inbox.length }), todo && t("{n} da sistemare", { n: todo })].filter(Boolean).join(" · ")
      : t("tutto in ordine");
    this.status.classList.toggle("ok", !g.inbox.length && !todo);
    clear(this.numbers);
    const big = (value: number, label: string, sub: string, title: string, run: () => void, tone = "") => {
      const b = h("button", { class: `dash-number ${tone}`, title }, h("b", { text: String(value) }), h("span", { text: label }), h("small", { text: sub })) as HTMLButtonElement;
      b.addEventListener("click", run);
      this.numbers.append(b);
    };
    const things = g.nodes.filter((n) => n.kind !== "day" && n.kind !== "missing");
    big(things.length, t("pagine · note · fonti"), tn("{n} collegamento", "{n} collegamenti", g.edges.length), t("Apri il grafo"), () => this.host.openSet([]));
    big(fresh.length, t("nuove in 7 giorni"), fresh.length ? t("ultima: {d}", { d: shortDate(fresh.map((n) => n.date).sort().pop() ?? "") }) : t("niente di nuovo"),
      t("Clic per vederle nel grafo"), () => this.host.openSet(fresh.map((n) => n.id)), "accent");
    big(g.inbox.length, t("da leggere"), g.inbox.length ? (g.inbox[0] ?? "") : t("cartella vuota"), t("Apri la cartella dei file da far imparare"), () => this.host.openInbox(), g.inbox.length ? "warn" : "");
    big(lonely.length, t("note sole"), lonely.length ? t("senza collegamenti") : t("tutte collegate"), t("Clic per vederle nel grafo"),
      () => this.host.openSet(lonely.map((n) => n.id)), lonely.length ? "bad" : "");
  }

  // ── Left: the latest events ───────────────────────────────────────────────

  private renderFeed(s: DashState) {
    clear(this.feed);
    this.feed.append(...this.live);
    const events = this.feedEvents(s);
    for (const e of events) {
      const kind = LANE_KIND[e.lane] ?? "note";
      const { title, engine } = e.lane === "diary" ? diaryLine(e.text) : { title: e.text, engine: "" };
      const node = this.nodeOf(s, e);
      const row = h("button", { class: "dash-feed-row", title: e.text, disabled: !node, "data-node": node },
        h("span", { class: "dash-feed-date", text: shortDate(e.date) }),
        h("span", { class: "dash-tag", style: `--tag:${KIND_COLOR[kind]}`, text: TAG[kind] ?? kindName(kind) }),
        h("span", { class: "dash-feed-text" }, h("span", { text: title }), engine ? h("small", { text: engine }) : ""));
      row.addEventListener("click", () => this.host.open(node));
      this.feed.append(row);
    }
    // A memory just begun: what will come here, under the few rows there are.
    if (events.length + this.live.length < 8) {
      this.feed.append(h("div", { class: "dash-empty", text: t("Qui arrivano le note scritte dalla chat, le pagine nuove e i file letti, i più recenti in alto.") }));
    }
    this.core.wake();
  }

  /** The newest events, as the feed shows them. */
  private feedEvents(s: DashState) {
    return [...s.model.g.events].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60);
  }

  /**
   * The node an event is about: its own, or for a line of the chat diary the
   * day of chat (brain.rs `d:<giorno>`, only the days that name a page), in
   * «Tutte» with the other PC's tag. "" when there is none in this view.
   */
  private nodeOf(s: DashState, e: { node: string; lane: string; date: string }): string {
    if (e.node) return s.model.byId.has(e.node) ? e.node : "";
    if (e.lane !== "diary") return "";
    const day = `d:${e.date.slice(0, 10)}`;
    return s.model.byId.has(day) ? day : "";
  }

  /** The feed's rows in sight, in the nucleus' coordinates, with their node: the lines start there. */
  private feedRows(stage: HTMLElement): { y: number; id: string }[] {
    const at = stage.getBoundingClientRect();
    const box = this.feed.getBoundingClientRect();
    const rows: { y: number; id: string }[] = [];
    for (const r of this.feed.querySelectorAll<HTMLElement>(".dash-feed-row")) {
      if (r.hidden) continue;
      const b = r.getBoundingClientRect();
      // Only the rows fully in sight of the column, and beside the nucleus.
      if (b.top < box.top - 1 || b.bottom > box.bottom + 1) continue;
      const y = b.top + b.height / 2 - at.top;
      if (y < 0 || y > at.height) continue;
      rows.push({ y, id: r.dataset.node ?? "" });
    }
    return rows;
  }

  /** The memory read or written elsewhere (memory-activity): on top of the feed, in the log, and a pulse in the nucleus. */
  activity(kind: "read" | "write", text: string, ids: string[]) {
    const label = kind === "write" ? t("scritta") : t("letta");
    const row = h("div", { class: "dash-feed-row live", title: text },
      h("span", { class: "dash-feed-date", text: t("adesso") }),
      h("span", { class: "dash-tag", style: `--tag:${kind === "write" ? KIND_COLOR.note : KIND_COLOR.page}`, text: label }),
      h("span", { class: "dash-feed-text", text }));
    this.live.unshift(row);
    this.live.length = Math.min(this.live.length, 6);
    this.feed.prepend(row);
    while (this.feed.children.length > 66) this.feed.lastElementChild?.remove();
    this.log(`${kind === "write" ? t("SCRIVE") : t("LEGGE")} · ${text.replace(/\s+/g, " ").slice(0, 140)}`);
    this.core.pulse(ids);
  }

  // ── Middle: the nucleus and what floats on it ─────────────────────────────

  private renderCore(s: DashState) {
    const g = s.model.g;
    const notes = g.nodes.filter(isNote);
    const lonely = s.model.lonely();
    const missing = g.nodes.filter((n) => n.kind === "missing");
    const todo = lonely.length + missing.length + g.check.length;
    const linked = notes.length - lonely.length;
    const share = notes.length ? linked / notes.length : 1;
    clear(this.coreNumber);
    const b = h("button", { class: `dash-core-big ${todo ? "" : "ok"}`, title: todo ? t("Le note sole nel grafo") : "" },
      h("b", { text: String(todo) }),
      h("span", { text: todo ? tn("da sistemare · su {n} cosa", "da sistemare · su {n} cose", g.nodes.length) : t("niente da sistemare") })) as HTMLButtonElement;
    b.addEventListener("click", () => this.host.openSet([...lonely, ...missing].map((n) => n.id)));
    const bar = h("div", { class: "dash-bar two" }, h("i", { style: `width:${(share * 100).toFixed(1)}%` }), h("em", { style: `width:${((1 - share) * 100).toFixed(1)}%` }));
    this.coreNumber.append(b, bar, h("div", { class: "dash-bar-legend" },
      h("span", { text: tn("{n} nota collegata", "{n} note collegate", linked) }),
      h("span", { class: lonely.length ? "bad" : "", text: tn("{n} sola", "{n} sole", lonely.length) }),
      h("span", { text: tn("{n} pagina da scrivere", "{n} pagine da scrivere", missing.length) }),
      h("span", { text: t("{n} da controllare", { n: g.check.length }) })));

    // Top right: the filters of every view, the legend as switches.
    clear(this.filtersBox);
    const head = h("div", { class: "dash-float-head" }, h("b", { text: t("Filtri") }), h("span", { text: t("valgono per tutte le viste") }));
    const kinds = h("div", { class: "dash-switches" });
    const present = new Set(s.full.nodes.map((n) => n.kind));
    for (const kind of ["page", "missing", "note", "old", "source", "day"] as NodeKind[]) {
      if (!present.has(kind) && !s.hidden.includes(kind)) continue;
      const on = !s.hidden.includes(kind);
      const sw = h("button", { class: "dash-switch", role: "switch", "aria-checked": String(on), title: on ? t("Nascondi questo tipo") : t("Mostra di nuovo") },
        h("i", { style: `background:${KIND_COLOR[kind]}` }), h("span", { text: kindName(kind) }), h("em")) as HTMLButtonElement;
      sw.addEventListener("click", () => this.host.toggleKind(kind));
      kinds.append(sw);
    }
    const sure = h("button", { class: "dash-check", role: "checkbox", "aria-checked": String(s.sure), title: t("Nascondi i collegamenti solo stimati dalle parole in comune") },
      h("em"), h("span", { text: t("Solo collegamenti sicuri") })) as HTMLButtonElement;
    sure.addEventListener("click", () => this.host.setSure(!s.sure));
    const colours = h("div", { class: "dash-seg", role: "radiogroup", "aria-label": t("Colori") });
    for (const [c, label] of [["group", t("per gruppo")], ["kind", t("per tipo")]] as const) {
      const x = h("button", { role: "radio", "aria-checked": String(s.colours === c), class: s.colours === c ? "on" : "", text: label }) as HTMLButtonElement;
      x.addEventListener("click", () => this.host.setColours(c));
      colours.append(x);
    }
    this.filtersBox.append(head, kinds, sure, h("div", { class: "dash-row" }, h("span", { text: t("Colori") }), colours));

    // Bottom right: this week, by kind.
    clear(this.weekBox);
    const week = g.nodes.filter((n) => days(n.date) <= 7);
    const month = g.nodes.filter((n) => days(n.date) <= 30);
    this.weekBox.append(h("div", { class: "dash-float-head" }, h("b", { text: t("Questa settimana") }), h("span", { text: t("{n} in 30 giorni", { n: month.length }) })));
    for (const kind of ["note", "page", "source", "day"] as NodeKind[]) {
      const n = week.filter((x) => x.kind === kind).length;
      const m = Math.max(1, month.filter((x) => x.kind === kind).length);
      this.weekBox.append(h("div", { class: "dash-mini" },
        h("span", { text: kindName(kind) }), h("b", { text: String(n) }),
        h("div", { class: "dash-bar" }, h("i", { style: `width:${Math.min(100, (n / m) * 100).toFixed(0)}%;background:${KIND_COLOR[kind]}` }))));
    }
    if (!week.length) this.weekBox.append(h("div", { class: "dash-empty small", text: t("Niente di nuovo negli ultimi 7 giorni.") }));
  }

  private showTip(text: string | null, sub?: string, x = 0, y = 0) {
    if (!text) {
      this.tip.style.display = "none";
      return;
    }
    clear(this.tip);
    this.tip.append(h("div", { text }), h("small", { text: sub ?? "" }));
    this.tip.style.display = "block";
    this.tip.style.left = `${x + 14}px`;
    this.tip.style.top = `${y + 14}px`;
  }

  // ── Right: the stages of the memory's work ────────────────────────────────

  private renderStages(s: DashState) {
    const g = s.model.g;
    const count = (k: NodeKind[]) => g.nodes.filter((n) => k.includes(n.kind)).length;
    const sources = count(["source"]);
    const pages = count(["page"]);
    const missing = count(["missing"]);
    const notes = g.nodes.filter(isNote);
    const lonely = s.model.lonely().length;
    const aiLinks = g.edges.filter((e) => e.strength === 3 || e.strength === undefined).length;
    const stage = (o: { icon: string; color: string; name: string; sub: string; value: string; bar: number; hot?: boolean; button?: [string, () => void, boolean?]; open?: () => void; empty?: string }) => {
      const box = h("div", { class: `dash-stage ${o.hot ? "hot" : ""}`, style: `--tone:${o.color}` });
      const ic = h("div", { class: "dash-stage-icon" }, svg(o.icon, 22, { stroke: 1.6 }));
      const words = h("div", { class: "dash-stage-words" },
        h("b", { text: o.name }), h("small", { text: o.sub }), h("span", { class: "dash-stage-value", text: o.value }),
        h("div", { class: "dash-bar" }, h("i", { style: `width:${Math.max(0, Math.min(1, o.bar)) * 100}%` })));
      if (o.empty) words.append(h("div", { class: "dash-empty small", text: o.empty }));
      if (o.button && !s.copy) {
        const [label, run, disabled] = o.button;
        const b = h("button", { class: "dash-btn", text: label, disabled: !!disabled }) as HTMLButtonElement;
        b.addEventListener("click", (e) => { e.stopPropagation(); run(); });
        words.append(b);
      }
      box.append(ic, words);
      if (o.open) {
        box.classList.add("opens");
        box.addEventListener("click", o.open);
      }
      this.stages.append(box);
    };
    clear(this.stages);
    const hot = g.inbox.length ? 1 : missing ? 2 : lonely ? 3 : g.check.length ? 4 : -1;
    stage({ icon: LINE.inbox, color: "#f5a524", name: t("Da leggere"), sub: t("file in da-leggere"), value: String(g.inbox.length), bar: g.inbox.length / Math.max(1, g.inbox.length + sources), hot: hot === 1,
      button: [t("Leggi adesso"), () => this.host.read(), !g.inbox.length], open: () => this.host.openInbox(),
      empty: g.inbox.length ? "" : t("Metti qui articoli, appunti o mail: l'agente ne fa pagine.") });
    stage({ icon: LINE.source, color: "#22c55e", name: t("Fonti lette"), sub: t("file già imparati"), value: String(sources), bar: sources / Math.max(1, sources + g.inbox.length),
      open: sources ? () => this.host.openSet(g.nodes.filter((n) => n.kind === "source").map((n) => n.id)) : undefined,
      empty: sources ? "" : t("Nessun file letto finora.") });
    stage({ icon: LINE.page, color: "#7c9cff", name: t("Pagine"), sub: missing ? tn("{n} citata ma da scrivere", "{n} citate ma da scrivere", missing) : t("tutte scritte"), value: `${pages} / ${pages + missing}`, bar: pages / Math.max(1, pages + missing), hot: hot === 2,
      open: missing ? () => this.host.openSet(g.nodes.filter((n) => n.kind === "missing").map((n) => n.id)) : undefined,
      empty: pages ? "" : t("Le pagine nascono dai file letti o quando chiedi alla chat di scriverne una.") });
    stage({ icon: LINE.link, color: "#c084fc", name: t("Collegate"), sub: tn("{n} legame scritto o dall'IA", "{n} legami scritti o dall'IA", aiLinks), value: `${notes.length - lonely} / ${notes.length}`, bar: notes.length ? (notes.length - lonely) / notes.length : 1, hot: hot === 3,
      button: s.noLink ? undefined : [t("Collega con l'IA"), () => this.host.link()],
      empty: notes.length ? "" : t("Ancora nessuna nota da collegare.") });
    stage({ icon: LINE.check, color: g.check.length ? "#fb7185" : "#2dd4bf", name: t("Controllo"), sub: g.check.length ? t("cose da sistemare") : t("niente da sistemare"), value: String(g.check.length), bar: g.check.length ? Math.min(1, g.check.length / 10) : 1, hot: hot === 4,
      button: [t("Controlla"), () => this.host.check()] });
  }

  // ── Right, below: the most linked pages ───────────────────────────────────

  private renderTokens(s: DashState) {
    clear(this.tokens);
    const pages = s.model.g.nodes.filter(isPage)
      .map((n) => ({ n, links: s.model.neighbours(n.id).length }))
      .sort((a, b) => b.links - a.links || a.n.label.localeCompare(b.n.label))
      .slice(0, 28);
    for (const { n, links } of pages) {
      const color = s.colours === "group" ? s.model.groupColor(n.id) ?? KIND_COLOR[n.kind] : KIND_COLOR[n.kind];
      // The tip is the name (cut when long); the number says the links.
      const b = h("button", { class: `dash-token ${n.kind === "missing" ? "missing" : ""}`, "data-node": n.id, style: `--tone:${color}`, title: n.kind === "missing" ? `${n.label} · ${t("Citata ma non ancora scritta")}` : n.label },
        h("span", { text: n.label }), h("small", { text: String(links), title: tn("{n} collegamento", "{n} collegamenti", links) })) as HTMLButtonElement;
      b.addEventListener("click", () => this.host.open(n.id));
      this.tokens.append(b);
    }
    if (pages.length < 6) this.tokens.append(h("div", { class: "dash-empty wide", text: t("Le pagine più collegate compaiono qui come gettoni: un clic le apre.") }));
  }

  // ── Bottom: three periods to compare ──────────────────────────────────────

  private renderPeriods(s: DashState) {
    clear(this.periods);
    const all = s.full.nodes.filter((n) => n.kind !== "day");
    const cards: [Period, string, number][] = [["30", t("ultimo mese"), 30], ["90", t("ultimi 3 mesi"), 90], ["all", t("sempre"), Infinity]];
    for (const [p, name, span] of cards) {
      const items = all.filter((n) => span === Infinity || days(n.date) <= span);
      const notes = items.filter(isNote).length;
      const pages = items.filter(isPage).length;
      const card = h("button", { class: `dash-period ${s.period === p ? "on" : ""}`, "aria-pressed": String(s.period === p), title: t("Mostra solo questo periodo in tutte le viste") });
      const dots = h("div", { class: "dash-dots" });
      // One dot per thing (a dot for several in a big memory), coloured by kind.
      const per = Math.max(1, Math.ceil(items.length / 180));
      const sorted = [...items].sort((a, b) => a.kind.localeCompare(b.kind));
      for (let i = 0; i < sorted.length; i += per) dots.append(h("i", { style: `background:${KIND_COLOR[sorted[i].kind]}` }));
      for (let i = Math.ceil(sorted.length / per); i < 90; i++) dots.append(h("i", { class: "off" }));
      card.append(
        h("div", { class: "dash-period-head" }, h("span", { text: `% ${name}` }), h("small", { text: s.period === p ? t("attivo") : "" })),
        dots,
        h("b", { text: String(items.length) }),
        h("span", { class: "dash-period-sub", text: `${tn("{n} nota", "{n} note", notes)} · ${tn("{n} pagina", "{n} pagine", pages)}` }),
        h("div", { class: "dash-slider" }, h("i", { style: `width:${all.length ? (items.length / all.length) * 100 : 0}%` })));
      card.addEventListener("click", () => this.host.setPeriod(p));
      this.periods.append(card);
    }
  }

  // ── Bottom: the live log ──────────────────────────────────────────────────

  private queue: string[] = [];
  private typing = 0;

  /** A line in the log, written a few letters at a time (at once with reduced motion or hidden). */
  log(text: string) {
    if (!text.trim()) return;
    this.queue.push(text);
    if (!this.typing) this.typeNext();
  }

  private typeNext() {
    const text = this.queue.shift();
    if (text === undefined) {
      this.typing = 0;
      return;
    }
    const line = h("div", { class: "dash-term-line" }, h("span", { class: "dash-prompt", text: "›" }), h("span"));
    const words = line.lastElementChild as HTMLElement;
    this.term.append(line);
    while (this.term.children.length > 40) this.term.firstElementChild?.remove();
    const instant = !animateIdle() || document.hidden || this.el.hidden || this.queue.length > 6;
    let at = instant ? text.length : 0;
    const step = () => {
      at = Math.min(text.length, at + 3);
      words.textContent = text.slice(0, at);
      this.term.scrollTop = this.term.scrollHeight;
      if (at < text.length && !document.hidden) this.typing = window.setTimeout(step, 16);
      else {
        words.textContent = text;
        this.typing = window.setTimeout(() => this.typeNext(), 60);
      }
    };
    step();
  }

  // ── Bottom: «Chiedi alla memoria» ───────────────────────────────────────

  private askLine(kind: "q" | "a" | "note", text: string, by?: string): HTMLElement {
    const line = h("div", { class: `dash-term-line dash-ask-${kind}` }, h("span", { class: "dash-prompt", text: kind === "q" ? "›" : kind === "a" ? "‹" : "·" }), h("span", { text }));
    if (by) line.append(h("small", { class: "dash-ask-by", text: by }));
    this.askLines.append(line);
    while (this.askLines.children.length > 60) this.askLines.firstElementChild?.remove();
    this.askLines.scrollTop = this.askLines.scrollHeight;
    return line;
  }

  /** A question about the memory: the answer, and its pages lit in the nucleus. */
  private async ask(raw: string) {
    const question = raw.trim();
    if (!question || this.asking) return;
    this.asking = true;
    this.askField.value = "";
    this.askField.disabled = true;
    this.askLine("q", question);
    const wait = this.askLine("note", t("cerco nella memoria…"));
    wait.classList.add("waiting");
    const reply = IS_TAURI ? await Bridge.memoryChat(question, this.history) : this.state ? (await import("./demo")).demoAsk(question, this.state.model.g) : null;
    wait.remove();
    this.asking = false;
    this.askField.disabled = false;
    this.askField.focus();
    if (!reply) {
      this.askLine("note", t("non riesco a rispondere adesso"));
      return;
    }
    this.history.push({ q: question, a: reply.text });
    if (this.history.length > 6) this.history.shift();
    this.askLine("a", reply.text, reply.by);
    const known = new Set(this.state?.model.g.nodes.map((n) => n.id) ?? []);
    const nodes = reply.nodes.filter((n) => known.has(n.id));
    if (nodes.length) {
      const chips = h("div", { class: "dash-ask-nodes" });
      for (const n of nodes.slice(0, 10)) {
        const color = (this.state?.colours === "group" ? this.state.model.groupColor(n.id) : null) ?? KIND_COLOR.page;
        const b = h("button", { class: "dash-token", style: `--tone:${color}`, title: n.title, "data-node": n.id }, h("span", { text: n.title })) as HTMLButtonElement;
        b.addEventListener("click", () => this.host.open(n.id));
        chips.append(b);
      }
      this.askLines.append(chips);
      this.askLines.scrollTop = this.askLines.scrollHeight;
    }
    this.asked = nodes.length ? new Set(nodes.map((n) => n.id)) : null;
    this.applySearch();
  }

  /** The first lines: what the memory is, in words. */
  private greet(s: DashState) {
    const g = s.model.g;
    const count = (k: NodeKind) => g.nodes.filter((n) => n.kind === k).length;
    this.log([t("memoria letta"), tn("{n} pagina", "{n} pagine", count("page")), tn("{n} nota", "{n} note", count("note")), tn("{n} fonte", "{n} fonti", count("source")), tn("{n} collegamento", "{n} collegamenti", g.edges.length)].join(" · "));
    const groups = s.model.groups().groups;
    if (groups.length) this.log(t("gruppi · {list}", { list: groups.slice(0, 5).map((x) => x.name).join(" · ") }));
    if (g.inbox.length) this.log(t("da leggere · {list}", { list: g.inbox.slice(0, 4).join(" · ") }));
    const lonely = s.model.lonely().length;
    if (lonely) this.log(tn("{n} nota sola · «Collega con l'IA» la lega alle pagine", "{n} note sole · «Collega con l'IA» le lega alle pagine", lonely));
    for (const c of g.check.slice(0, 2)) this.log(t("controllo · {c}", { c }));
    this.log(t("in ascolto · qui scrivo quando la chat legge o scrive la memoria"));
  }
}

/** A steady number from an id, for the moving nodes' pace. */
function hashOf(id: string): number {
  let x = 2166136261;
  for (let i = 0; i < id.length; i++) x = Math.imul(x ^ id.charCodeAt(i), 16777619);
  return x >>> 0;
}

// ── The nucleus ────────────────────────────────────────────────────────────

interface NucleusHost {
  pick(id: string): void;
  group(lead: string): void;
  tip(text: string | null, sub?: string, x?: number, y?: number): void;
  /** Where the feed's rows are, with their node, for the lines that come from them. */
  feedRows(): { y: number; id: string }[];
  /** The particle under the mouse (null: none): its row lights up. */
  hoverNode(id: string | null): void;
}

interface Particle {
  id: string;
  /** On the unit sphere (times a depth 0.35–1). */
  x: number;
  y: number;
  z: number;
  r: number;
  color: string;
  /** Lit by memory-activity until then. */
  lit: number;
}

/** Frames: 30 a second at most, and none 20 s after the last touch. */
const FRAME_MS = 33;
const IDLE_MS = 20_000;
/** Particles at most: a big memory keeps its heaviest and newest. */
const MAX_PARTICLES = 700;

class Nucleus {
  private canvas = document.createElement("canvas");
  private ctx = this.canvas.getContext("2d")!;
  private w = 0;
  private h = 0;
  private parts: Particle[] = [];
  private shown: { x: number; y: number; r: number; id: string }[] = [];
  private arcs: { a0: number; a1: number; lead: string; name: string; size: number; color: string; parts?: { size: number; color: string }[] }[] = [];
  private fresh = 0;
  /** How many groups the memory has (the arcs put the small ones together). */
  private groupCount = 0;
  /** Faint points that give the sphere its body, more when the memory is small. */
  private dust: { x: number; y: number; z: number; color: string }[] = [];
  private model: Model | null = null;
  private timer = 0;
  private active = performance.now();
  private on = false;
  private angle = 0.6;
  private last = 0;
  private geo = { cx: 0, cy: 0, R: 0, okX: 0, okY: 0, showOk: true };
  private hover: string | null = null;
  /** The feed's row under the mouse: its node. */
  private hoverRow: string | null = null;
  /** What the search found: the rest is dimmed. */
  private match: Set<string> | null = null;
  /** Where each particle was drawn last (screen px), for the lines. */
  private at = new Map<string, { x: number; y: number }>();

  constructor(private parent: HTMLElement, private host: NucleusHost) {
    parent.append(this.canvas);
    new ResizeObserver(() => this.resize()).observe(parent);
    this.canvas.addEventListener("pointermove", (e) => {
      this.active = performance.now();
      const p = this.point(e);
      const hit = this.hit(p.x, p.y);
      this.canvas.classList.toggle("pointing", !!hit);
      if (hit?.id) {
        const n = this.model?.byId.get(hit.id);
        this.host.tip(n?.label ?? "", n ? [kindName(n.kind), shortDate(n.date)].filter(Boolean).join(" · ") : "", p.x, p.y);
      } else if (hit?.lead) {
        this.host.tip(hit.name ?? "", tn("gruppo · {n} cosa · clic per vederlo", "gruppo · {n} cose · clic per vederlo", hit.size ?? 0), p.x, p.y);
      } else this.host.tip(null);
      const id = hit?.id ?? null;
      if (id !== this.hover) {
        this.hover = id;
        this.host.hoverNode(id);
      }
      this.wake();
    });
    this.canvas.addEventListener("pointerleave", () => {
      this.hover = null;
      this.host.hoverNode(null);
      this.host.tip(null);
      this.wake();
    });
    this.canvas.addEventListener("click", (e) => {
      const p = this.point(e);
      const hit = this.hit(p.x, p.y);
      if (hit?.id) this.host.pick(hit.id);
      else if (hit?.lead) this.host.group(hit.lead);
    });
    document.addEventListener("visibilitychange", () => this.wake());
    window.addEventListener("focus", () => this.wake());
    window.addEventListener("pointermove", () => {
      if (!this.on) return;
      this.active = performance.now();
      if (!this.timer) this.wake();
    }, { passive: true });
  }

  private point(e: MouseEvent) {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  setShown(on: boolean) {
    this.on = on;
    if (on) {
      // Laid out now: its size comes at the next frame.
      requestAnimationFrame(() => this.resize());
      this.wake();
    } else {
      window.clearTimeout(this.timer);
      this.timer = 0;
    }
  }

  setHoverRow(id: string | null) {
    if (id === this.hoverRow) return;
    this.hoverRow = id;
    this.wake();
  }

  setMatch(ids: Set<string> | null) {
    this.match = ids;
    this.wake();
  }

  /** `prefer`: the feed's nodes, always among the particles so their lines have an end. */
  setData(model: Model, colours: Colouring, prefer = new Set<string>()) {
    this.model = model;
    // Every node is a particle, the days of chat too (the feed's chat lines end on them).
    const nodes = model.g.nodes;
    const score = (n: MemNode) => (prefer.has(n.id) ? 1e6 : 0) + n.weight + freshness(n.date) * 3;
    const keep = nodes.length > MAX_PARTICLES ? [...nodes].sort((a, b) => score(b) - score(a)).slice(0, MAX_PARTICLES) : nodes;
    const { groups, of } = model.groups();
    // Each group around its own direction on the sphere, the others anywhere.
    const dirs = groups.map((_, i) => {
      const y = 1 - (2 * (i + 0.5)) / Math.max(1, groups.length);
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const a = i * 2.39996;
      return { x: Math.cos(a) * r, y: y * 0.85, z: Math.sin(a) * r };
    });
    const old = new Map(this.parts.map((p) => [p.id, p]));
    this.parts = keep.map((n) => {
      const was = old.get(n.id);
      let seed = hash(n.id);
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      const gi = of.get(n.id);
      let x: number, y: number, z: number;
      if (gi != null && dirs[gi]) {
        const d = dirs[gi];
        x = d.x + (rnd() - 0.5) * 0.9;
        y = d.y + (rnd() - 0.5) * 0.9;
        z = d.z + (rnd() - 0.5) * 0.9;
      } else {
        x = rnd() * 2 - 1;
        y = rnd() * 2 - 1;
        z = rnd() * 2 - 1;
      }
      const len = Math.hypot(x, y, z) || 1;
      // Pages near the middle, notes out to the surface.
      const depth = isPage(n) ? 0.25 + rnd() * 0.45 : 0.45 + Math.cbrt(rnd()) * 0.55;
      const color = colours === "group" ? model.groupColor(n.id) ?? KIND_COLOR[n.kind] : KIND_COLOR[n.kind];
      return {
        id: n.id, x: (x / len) * depth, y: (y / len) * depth, z: (z / len) * depth,
        r: isPage(n) ? 2.4 + Math.min(3, Math.sqrt(n.weight) * 0.5) : 1.6 + freshness(n.date) * 1.2,
        color, lit: was?.lit ?? 0,
      };
    });
    // The rings: one arc per group, as long as the group.
    // The arcs fill the whole ring: the 11 biggest groups, the rest together in «altri».
    this.groupCount = groups.length;
    const leadOf = (members: string[]) => members.map((id) => model.byId.get(id)).filter((n): n is MemNode => !!n && isPage(n)).sort((x, y) => y.weight - x.weight)[0]?.id ?? members[0];
    const big = groups.length > 12 ? groups.slice(0, 11) : groups;
    const rest = groups.slice(big.length);
    const ringed: { name: string; members: string[]; color: string; parts?: { size: number; color: string }[] }[] =
      big.map((g) => ({ name: g.name, members: g.members, color: g.color ?? GROUP_COLORS[0] }));
    if (rest.length) {
      ringed.push({
        name: tn("{n} altro gruppo", "altri {n} gruppi", rest.length), members: rest.flatMap((g) => g.members), color: "#8b93a3",
        parts: rest.map((g) => ({ size: g.members.length, color: g.color ?? GROUP_COLORS[0] })),
      });
    }
    const total = ringed.reduce((s, g) => s + g.members.length, 0) || 1;
    const gap = ringed.length > 1 ? 0.035 : 0;
    let a = -Math.PI / 2;
    this.arcs = ringed.map((g) => {
      const span = (g.members.length / total) * (Math.PI * 2 - gap * ringed.length);
      const arc = { a0: a, a1: a + span, lead: leadOf(g.members), name: g.name, size: g.members.length, color: g.color, parts: g.parts };
      a += span + gap;
      return arc;
    });
    // The dust: up to 900 points in all, so a small memory still makes a sphere.
    let seed = 99991;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const colors = this.arcs.length ? this.arcs.map((a) => a.color) : [KIND_COLOR.page, KIND_COLOR.day];
    this.dust = Array.from({ length: Math.max(250, 900 - this.parts.length) }, (_, i) => {
      const u = rnd() * 2 - 1;
      const a = rnd() * Math.PI * 2;
      const r = Math.cbrt(rnd()) * 0.98;
      const s = Math.sqrt(1 - u * u);
      return { x: Math.cos(a) * s * r, y: u * r, z: Math.sin(a) * s * r, color: colors[i % colors.length] };
    });
    const dated = nodes.filter((n) => n.kind !== "day" && days(n.date) !== Infinity);
    this.fresh = dated.length ? dated.filter((n) => days(n.date) <= 30).length / dated.length : 0;
    this.wake();
  }

  /** The memory read or written: those particles glow a while. */
  pulse(ids: string[]) {
    const until = performance.now() + 2600;
    const set = new Set(ids);
    for (const p of this.parts) if (set.has(p.id)) p.lit = until;
    this.wake();
  }

  private resize() {
    const r = this.parent.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    const dpr = window.devicePixelRatio || 1;
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.wake();
  }

  wake() {
    this.active = performance.now();
    if (!this.on || this.timer) return;
    this.timer = window.setTimeout(() => this.tick(), document.hidden ? 200 : 0);
  }

  private tick() {
    this.timer = 0;
    if (!this.on || this.w < 2) return;
    const now = performance.now();
    const moving = animateIdle();
    if (moving && this.last) this.angle += Math.min(0.1, (now - this.last) * 0.00011);
    this.last = now;
    this.draw(now);
    // On only while visible, in front and touched in the last IDLE_MS; still with reduced motion.
    const lit = this.parts.some((p) => p.lit > now);
    if ((moving || lit) && !document.hidden && document.hasFocus() && now - this.active < IDLE_MS) {
      this.timer = window.setTimeout(() => this.tick(), FRAME_MS);
    } else this.last = 0;
  }

  private draw(now: number) {
    const ctx = this.ctx;
    const P = pal();
    const { w, h } = this;
    ctx.clearRect(0, 0, w, h);
    // The small boxes over the nucleus take the right side when there is room (dashboard.css .dash-floats).
    const area = w >= 640 ? w - 250 : w;
    const wide = area >= 520;
    const R = Math.max(40, Math.min(h * 0.33, wide ? area * 0.26 : area * 0.36));
    const cx = wide ? Math.max(R * 1.35, area * 0.4) : area / 2;
    const cy = h * 0.53;
    const okX = Math.min(area - 46, cx + R * 1.85);
    const okY = cy - R * 0.15;
    this.geo = { cx, cy, R, okX, okY, showOk: wide };
    const ink = (a: number) => (P.light ? `rgba(20,24,32,${a})` : `rgba(255,255,255,${a})`);

    // Where every particle is now (turning slowly), before anything is drawn:
    // the lines end on the real points.
    const cos = Math.cos(this.angle);
    const sin = Math.sin(this.angle);
    const tilt = 0.32;
    const ct = Math.cos(tilt);
    const st = Math.sin(tilt);
    const pts = this.parts.map((p) => {
      const x = p.x * cos - p.z * sin;
      const z0 = p.x * sin + p.z * cos;
      const y = p.y * ct - z0 * st;
      const z = p.y * st + z0 * ct;
      return { p, sx: cx + x * R, sy: cy + y * R, z };
    }).sort((a, b) => a.z - b.z);
    this.at = new Map(pts.map((q) => [q.p.id, { x: q.sx, y: q.sy }]));
    const colorOf = new Map(this.parts.map((p) => [p.id, p.color]));

    // The glow behind the sphere, of the biggest group's colour.
    const glowColor = this.arcs[0]?.color ?? P.accent;
    if (/^#[0-9a-f]{6}$/i.test(glowColor)) {
      const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.05);
      grd.addColorStop(0, alpha(glowColor, P.light ? 0.16 : 0.28));
      grd.addColorStop(0.6, alpha(glowColor, P.light ? 0.05 : 0.08));
      grd.addColorStop(1, alpha(glowColor, 0));
      ctx.fillStyle = grd;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.05, 0, Math.PI * 2);
      ctx.fill();
    }

    // The rings: the freshness (inner, accent), the groups (outer arcs), the ticks.
    ctx.strokeStyle = ink(0.12);
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.08, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = P.accent;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(cx, cy, R * 1.08, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * this.fresh);
    ctx.stroke();
    ctx.lineWidth = 3;
    for (const a of this.arcs) {
      ctx.globalAlpha = this.hover === a.lead ? 1 : 0.85;
      // «Altri gruppi»: thinner, each small group in its colour.
      const pieces = a.parts ?? [{ size: a.size, color: a.color }];
      const sum = pieces.reduce((s, p) => s + p.size, 0) || 1;
      ctx.lineWidth = a.parts ? 2 : 3;
      let at = a.a0;
      for (const p of pieces) {
        const end = at + ((a.a1 - a.a0) * p.size) / sum;
        ctx.strokeStyle = p.color;
        ctx.beginPath();
        ctx.arc(cx, cy, R * 1.16, at, end);
        ctx.stroke();
        at = end;
      }
    }
    ctx.lineWidth = 3;
    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
    ctx.strokeStyle = ink(0.22);
    for (let i = 0; i < 72; i++) {
      const ang = (i / 72) * Math.PI * 2 + this.angle * 0.25;
      const long = i % 6 === 0;
      const r0 = R * 1.21;
      const r1 = R * (long ? 1.27 : 1.24);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(ang) * r0, cy + Math.sin(ang) * r0);
      ctx.lineTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1);
      ctx.stroke();
    }

    // Dust: the sphere's body, faint, in the groups' colours (only drawn, never picked).
    const cos0 = Math.cos(this.angle * 0.6);
    const sin0 = Math.sin(this.angle * 0.6);
    for (const d of this.dust) {
      const x = d.x * cos0 - d.z * sin0;
      const z = d.x * sin0 + d.z * cos0;
      ctx.globalAlpha = (P.light ? 0.3 : 0.4) * (0.35 + (z + 1) * 0.32);
      ctx.fillStyle = d.color;
      ctx.fillRect(cx + x * R - 0.8, cy + d.y * R - 0.8, 1.6, 1.6);
    }
    ctx.globalAlpha = 1;

    // Lines from the feed's rows in sight to the particle of their node, in
    // its colour. A node that is not among the particles: a short dashed
    // line to the sphere's edge, never to a point at random.
    const rows = this.host.feedRows();
    const focus = this.hoverRow ?? this.hover;
    for (const row of rows) {
      if (!row.id) continue;
      const end = this.at.get(row.id);
      const color = colorOf.get(row.id) ?? KIND_COLOR.note;
      const lit = focus === row.id;
      const dim = this.match && !this.match.has(row.id);
      ctx.lineWidth = lit ? 1.6 : 1;
      ctx.strokeStyle = /^#[0-9a-f]{6}$/i.test(color) ? alpha(color, lit ? 0.95 : dim ? 0.06 : P.light ? 0.4 : 0.32) : ink(0.2);
      ctx.beginPath();
      ctx.moveTo(0, row.y);
      // The curve as cubic control points (a quadratic raised), for the moving nodes too.
      let c: [number, number, number, number, number, number];
      if (end) {
        ctx.setLineDash([]);
        c = [Math.min(end.x, cx - R) * 0.55, row.y, Math.min(end.x, cx - R * 0.6) - R * 0.2, end.y, end.x, end.y];
      } else {
        const ang = Math.atan2(row.y - cy, -R);
        ctx.setLineDash([3, 4]);
        const qx = (cx - R) * 0.5, ex = cx + Math.cos(ang) * R * 1.08, ey = cy + Math.sin(ang) * R * 1.08;
        c = [(2 * qx) / 3, row.y + (2 * (row.y - row.y)) / 3, ex + (2 * (qx - ex)) / 3, ey + (2 * (row.y - ey)) / 3, ex, ey];
      }
      ctx.bezierCurveTo(...c);
      ctx.stroke();
      // Nodes running along the filament toward the nucleus: each row its own
      // pace and start, so they never march together. Still with reduced motion.
      if (!dim && /^#[0-9a-f]{6}$/i.test(color)) {
        const seed = hashOf(row.id);
        const speed = 0.00007 + (seed % 7) * 0.000012;
        const count = lit ? 3 : 1 + (seed % 2);
        ctx.fillStyle = alpha(color, lit ? 1 : P.light ? 0.75 : 0.85);
        for (let k = 0; k < count; k++) {
          const u = animateIdle() ? (now * speed + (seed % 997) / 997 + k / count) % 1 : (seed % 997) / 997;
          const v = 1 - u;
          const x = v * v * v * 0 + 3 * v * v * u * c[0] + 3 * v * u * u * c[2] + u * u * u * c[4];
          const y = v * v * v * row.y + 3 * v * v * u * c[1] + 3 * v * u * u * c[3] + u * u * u * c[5];
          // Fading in from the left edge and out on arrival.
          const fade = Math.min(1, u * 8, (1 - u) * 6);
          ctx.globalAlpha = fade;
          ctx.beginPath();
          ctx.arc(x, y, lit ? 2.4 : 1.7, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = 1;
      }
    }
    ctx.setLineDash([]);
    ctx.lineWidth = 1;

    // Lines out to the «collegate» circle: from the real linked notes nearest to it.
    if (wide && this.model) {
      const m = this.model;
      const linked = pts.filter((q) => isNote(m.byId.get(q.p.id) ?? ({} as MemNode)) && m.neighbours(q.p.id).length > 0 && q.z > -0.2)
        .sort((a, b) => b.sx - a.sx).slice(0, 8);
      for (const q of linked) {
        const lit = focus === q.p.id;
        ctx.strokeStyle = alpha(KIND_COLOR.day, lit ? 0.9 : P.light ? 0.3 : 0.22);
        ctx.beginPath();
        ctx.moveTo(q.sx, q.sy);
        ctx.quadraticCurveTo((q.sx + okX) / 2, q.sy + (okY - q.sy) * 0.2, okX - 30, okY);
        ctx.stroke();
      }
    }

    // The particles, the far ones smaller and fainter; with a search the rest dims.
    this.shown = [];
    if (!P.light) ctx.globalCompositeOperation = "lighter";
    for (const { p, sx, sy, z } of pts) {
      const near = (z + 1) / 2;
      const found = this.match?.has(p.id) ?? false;
      const r = p.r * (0.6 + near * 0.7) * (found ? 1.5 : 1);
      const lit = p.lit > now;
      ctx.globalAlpha = lit || found ? 1 : this.match ? 0.08 : 0.35 + near * 0.6;
      ctx.fillStyle = lit ? P.ink : p.color;
      ctx.beginPath();
      ctx.arc(sx, sy, lit ? r + 2 : r, 0, Math.PI * 2);
      ctx.fill();
      this.shown.push({ x: sx, y: sy, r: Math.max(4, r + 3), id: p.id });
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    // Found by the search: a ring around each.
    if (this.match?.size) {
      ctx.strokeStyle = P.accent;
      ctx.lineWidth = 1.2;
      for (const s of this.shown) {
        if (!this.match.has(s.id)) continue;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r + 1.5, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    if (focus) {
      const s = this.shown.find((x) => x.id === focus);
      if (s) {
        ctx.strokeStyle = P.ring;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r + 1, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // The chip on top: how many groups.
    const chip = this.groupCount ? tn("{n} gruppo", "{n} gruppi", this.groupCount) : t("nessun gruppo ancora");
    ctx.font = `600 11px ${MONO}`;
    const cw = ctx.measureText(chip).width + 20;
    const chipY = cy - R * 1.27 - 12;
    ctx.fillStyle = P.light ? "#ffffff" : P.bg;
    ctx.strokeStyle = P.accent;
    ctx.lineWidth = 1;
    roundRect(ctx, cx - cw / 2, chipY - 10, cw, 20, 10);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = P.ink;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(chip, cx, chipY);

    // The «collegate» circle with its ✓.
    if (wide && this.model) {
      const notes = this.model.g.nodes.filter(isNote);
      const linked = notes.length - this.model.lonely().length;
      ctx.fillStyle = P.light ? "#ffffff" : P.bg;
      ctx.strokeStyle = alpha(KIND_COLOR.day, 0.9);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(okX, okY, 28, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.strokeStyle = alpha(KIND_COLOR.day, 0.35);
      ctx.beginPath();
      ctx.arc(okX, okY, 34, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = P.ink;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.moveTo(okX - 10, okY);
      ctx.lineTo(okX - 3, okY + 7);
      ctx.lineTo(okX + 11, okY - 8);
      ctx.stroke();
      ctx.fillStyle = P.dim;
      ctx.font = `500 11px ${MONO}`;
      ctx.fillText(t("note collegate"), okX, okY + 50);
      ctx.fillStyle = P.ink;
      ctx.font = `700 13px ${MONO}`;
      ctx.fillText(`${linked} / ${notes.length}`, okX, okY + 66);
    }
    ctx.textAlign = "start";
    ctx.textBaseline = "alphabetic";
  }

  private hit(x: number, y: number): { id?: string; lead?: string; name?: string; size?: number } | null {
    // The nearest particle within its reach, the front ones first.
    let best: { id: string; d: number } | null = null;
    for (let i = this.shown.length - 1; i >= 0; i--) {
      const s = this.shown[i];
      const d = Math.hypot(s.x - x, s.y - y);
      if (d <= s.r && (!best || d < best.d)) best = { id: s.id, d };
    }
    if (best) return { id: best.id };
    const { cx, cy, R } = this.geo;
    const d = Math.hypot(x - cx, y - cy);
    if (d >= R * 1.12 && d <= R * 1.28) {
      let a = Math.atan2(y - cy, x - cx);
      if (a < -Math.PI / 2) a += Math.PI * 2;
      const arc = this.arcs.find((r) => a >= r.a0 && a <= r.a1);
      if (arc) return { lead: arc.lead, name: arc.name, size: arc.size };
    }
    return null;
  }
}

const MONO = 'ui-monospace, "Cascadia Mono", Consolas, "Courier New", monospace';

function hash(s: string): number {
  let x = 2166136261;
  for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619);
  return (Math.abs(x) % 2147483646) + 1;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
