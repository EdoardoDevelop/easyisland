// «Panoramica»: the memory window's first screen (Edoardo, 17 Nov 2026: «vorrei
// un qualcosa di molto simile … dati della memoria riassunti cliccabili … voglio
// qualcosa di così ricco»). A dense dashboard over the real memory: the numbers
// on top, the latest events on the left, the nucleus in the middle (the notes
// and pages as particles, the groups as rings), the stages of the memory's work
// on the right with their buttons, the most linked pages as chips, the live
// log and three periods to compare at the bottom. Every piece is a way into the
// other views (main.ts DashHost). DOM, plus one canvas for the nucleus that
// moves only while the window is visible and in front, at 30 fps at most.

import { t } from "../core/i18n";

import { h, clear, svg } from "../views/dom";
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

  constructor(private host: DashHost) {
    const head = h("div", { class: "dash-box dash-top" },
      h("div", { class: "dash-title" },
        h("span", { class: "dash-kicker", text: t("memoria") }),
        h("b", { text: t("Panoramica") }),
        this.status),
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
    });
    stage.append(this.tip);
    const coreBox = h("div", { class: "dash-box dash-core" }, stage, h("div", { class: "dash-floats" }, this.filtersBox, this.weekBox), this.coreNumber);
    const stagesBox = h("div", { class: "dash-box dash-stages" },
      h("div", { class: "dash-label" }, h("span", { text: t("tappe") }), h("span", { text: t("fonti → controllo") })),
      this.stages);
    const tokensBox = h("div", { class: "dash-box dash-tokens" },
      h("div", { class: "dash-label" }, h("span", { text: t("pagine più collegate") }), h("span", { text: t("clic per aprire") })),
      this.tokens);
    const termBox = h("div", { class: "dash-box dash-term" },
      h("div", { class: "dash-term-head" }, h("i"), h("i"), h("i"), h("span", { text: t("~ registro della memoria") })),
      this.term);
    const cmpBox = h("div", { class: "dash-box dash-compare" }, this.periods);
    this.el.append(head, feedBox, coreBox, stagesBox, tokensBox, termBox, cmpBox);
    new ResizeObserver(() => {
      const w = coreBox.getBoundingClientRect().width;
      coreBox.classList.toggle("narrow", w > 0 && w < 640);
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
    this.core.setData(s.model, s.colours);
    this.renderTop(s);
    this.renderFeed(s);
    this.renderCore(s);
    this.renderStages(s);
    this.renderTokens(s);
    this.renderPeriods(s);
    if (first) this.greet(s);
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
    big(things.length, t("pagine · note · fonti"), t("{n} collegamenti", { n: g.edges.length }), t("Apri il grafo"), () => this.host.openSet([]));
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
    const events = [...s.model.g.events].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 60);
    for (const e of events) {
      const kind = LANE_KIND[e.lane] ?? "note";
      const row = h("button", { class: "dash-feed-row", title: e.text, disabled: !e.node || !s.model.byId.has(e.node) },
        h("span", { class: "dash-feed-date", text: shortDate(e.date) }),
        h("span", { class: "dash-tag", style: `--tag:${KIND_COLOR[kind]}`, text: TAG[kind] ?? kindName(kind) }),
        h("span", { class: "dash-feed-text", text: e.text }));
      row.addEventListener("click", () => this.host.open(e.node));
      this.feed.append(row);
    }
    // A memory just begun: what will come here, under the few rows there are.
    if (events.length + this.live.length < 8) {
      this.feed.append(h("div", { class: "dash-empty", text: t("Qui arrivano le note scritte dalla chat, le pagine nuove e i file letti, i più recenti in alto.") }));
    }
    this.core.wake();
  }

  /** The top of the feed rows, in the nucleus' coordinates: its lines start there. */
  private feedRows(stage: HTMLElement): number[] {
    const at = stage.getBoundingClientRect();
    const box = this.feed.getBoundingClientRect();
    const ys: number[] = [];
    for (const r of this.feed.children) {
      const b = (r as HTMLElement).getBoundingClientRect();
      if (b.bottom < box.top || b.top > box.bottom) continue;
      ys.push(b.top + b.height / 2 - at.top);
      if (ys.length >= 16) break;
    }
    return ys;
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
      h("span", { text: todo ? t("da sistemare · su {n} cose", { n: g.nodes.length }) : t("niente da sistemare") })) as HTMLButtonElement;
    b.addEventListener("click", () => this.host.openSet([...lonely, ...missing].map((n) => n.id)));
    const bar = h("div", { class: "dash-bar two" }, h("i", { style: `width:${(share * 100).toFixed(1)}%` }), h("em", { style: `width:${((1 - share) * 100).toFixed(1)}%` }));
    this.coreNumber.append(b, bar, h("div", { class: "dash-bar-legend" },
      h("span", { text: t("{n} note collegate", { n: linked }) }),
      h("span", { class: lonely.length ? "bad" : "", text: t("{n} sole", { n: lonely.length }) }),
      h("span", { text: t("{n} pagine da scrivere", { n: missing.length }) }),
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
    stage({ icon: LINE.page, color: "#7c9cff", name: t("Pagine"), sub: missing ? t("{n} citate ma da scrivere", { n: missing }) : t("tutte scritte"), value: `${pages} / ${pages + missing}`, bar: pages / Math.max(1, pages + missing), hot: hot === 2,
      open: missing ? () => this.host.openSet(g.nodes.filter((n) => n.kind === "missing").map((n) => n.id)) : undefined,
      empty: pages ? "" : t("Le pagine nascono dai file letti o quando chiedi alla chat di scriverne una.") });
    stage({ icon: LINE.link, color: "#c084fc", name: t("Collegate"), sub: t("{n} legami scritti o dall'IA", { n: aiLinks }), value: `${notes.length - lonely} / ${notes.length}`, bar: notes.length ? (notes.length - lonely) / notes.length : 1, hot: hot === 3,
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
      const b = h("button", { class: `dash-token ${n.kind === "missing" ? "missing" : ""}`, style: `--tone:${color}`, title: n.kind === "missing" ? t("Citata ma non ancora scritta") : t("{n} collegamenti", { n: links }) },
        h("span", { text: n.label }), h("small", { text: String(links) }), h("em", { text: n.kind === "missing" ? "!" : "✓" })) as HTMLButtonElement;
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
      for (let i = Math.ceil(sorted.length / per); i < 60; i++) dots.append(h("i", { class: "off" }));
      card.append(
        h("div", { class: "dash-period-head" }, h("span", { text: `% ${name}` }), h("small", { text: s.period === p ? t("attivo") : "" })),
        dots,
        h("b", { text: String(items.length) }),
        h("span", { class: "dash-period-sub", text: t("{a} note · {b} pagine", { a: notes, b: pages }) }),
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

  /** The first lines: what the memory is, in words. */
  private greet(s: DashState) {
    const g = s.model.g;
    const count = (k: NodeKind) => g.nodes.filter((n) => n.kind === k).length;
    this.log(t("memoria letta · {p} pagine · {n} note · {s} fonti · {e} collegamenti", { p: count("page"), n: count("note"), s: count("source"), e: g.edges.length }));
    const groups = s.model.groups().groups;
    if (groups.length) this.log(t("gruppi · {list}", { list: groups.slice(0, 5).map((x) => x.name).join(" · ") }));
    if (g.inbox.length) this.log(t("da leggere · {list}", { list: g.inbox.slice(0, 4).join(" · ") }));
    const lonely = s.model.lonely().length;
    if (lonely) this.log(t("{n} note sole · «Collega con l'IA» le lega alle pagine", { n: lonely }));
    for (const c of g.check.slice(0, 2)) this.log(t("controllo · {c}", { c }));
    this.log(t("in ascolto · qui scrivo quando la chat legge o scrive la memoria"));
  }
}

// ── The nucleus ────────────────────────────────────────────────────────────

interface NucleusHost {
  pick(id: string): void;
  group(lead: string): void;
  tip(text: string | null, sub?: string, x?: number, y?: number): void;
  /** Where the feed's rows are, for the lines that come from them. */
  feedRows(): number[];
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
  private arcs: { a0: number; a1: number; lead: string; name: string; size: number; color: string }[] = [];
  private fresh = 0;
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
        this.host.tip(hit.name ?? "", t("gruppo · {n} cose · clic per vederlo", { n: hit.size ?? 0 }), p.x, p.y);
      } else this.host.tip(null);
      const id = hit?.id ?? null;
      if (id !== this.hover) this.hover = id;
      this.wake();
    });
    this.canvas.addEventListener("pointerleave", () => {
      this.hover = null;
      this.host.tip(null);
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

  setData(model: Model, colours: Colouring) {
    this.model = model;
    const nodes = model.g.nodes.filter((n) => n.kind !== "day");
    const keep = nodes.length > MAX_PARTICLES
      ? [...nodes].sort((a, b) => b.weight + freshness(b.date) * 3 - (a.weight + freshness(a.date) * 3)).slice(0, MAX_PARTICLES)
      : nodes;
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
    // At most 12 arcs (the colours repeat after that); they share the whole ring.
    const ringed = groups.slice(0, 12);
    const total = ringed.reduce((s, g) => s + g.members.length, 0) || 1;
    const gap = ringed.length > 1 ? 0.035 : 0;
    let a = -Math.PI / 2;
    this.arcs = ringed.map((g) => {
      const span = (g.members.length / total) * (Math.PI * 2 - gap * ringed.length);
      const lead = g.members.map((id) => model.byId.get(id)).filter((n): n is MemNode => !!n && isPage(n)).sort((x, y) => y.weight - x.weight)[0]?.id ?? g.members[0];
      const arc = { a0: a, a1: a + span, lead, name: g.name, size: g.members.length, color: g.color ?? GROUP_COLORS[0] };
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
    const dated = nodes.filter((n) => days(n.date) !== Infinity);
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

    // Lines from the feed's rows on the left into the sphere.
    ctx.lineWidth = 1;
    const rows = this.host.feedRows();
    rows.forEach((y, i) => {
      const ang = Math.PI + (i / Math.max(1, rows.length - 1) - 0.5) * 1.6;
      const ex = cx + Math.cos(ang) * R;
      const ey = cy + Math.sin(ang) * R;
      ctx.strokeStyle = ink(0.05 + (i < 3 ? 0.07 : 0));
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.bezierCurveTo(cx - R * 1.6, y, ex - R * 0.4, ey, ex, ey);
      ctx.stroke();
    });

    // Lines out to the «collegate» circle.
    if (wide) {
      for (let i = 0; i < 7; i++) {
        const ang = (i / 6 - 0.5) * 1.2;
        const sx = cx + Math.cos(ang) * R;
        const sy = cy + Math.sin(ang) * R;
        ctx.strokeStyle = alpha(KIND_COLOR.day, P.light ? 0.25 : 0.18);
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo((sx + okX) / 2, sy + (okY - sy) * 0.2, okX - 30, okY);
        ctx.stroke();
      }
    }

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
      ctx.strokeStyle = a.color;
      ctx.globalAlpha = this.hover === a.lead ? 1 : 0.85;
      ctx.beginPath();
      ctx.arc(cx, cy, R * 1.16, a.a0, a.a1);
      ctx.stroke();
    }
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

    // The particles, turning slowly, the far ones smaller and fainter.
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
    this.shown = [];
    if (!P.light) ctx.globalCompositeOperation = "lighter";
    for (const { p, sx, sy, z } of pts) {
      const near = (z + 1) / 2;
      const r = p.r * (0.6 + near * 0.7);
      const lit = p.lit > now;
      ctx.globalAlpha = lit ? 1 : 0.35 + near * 0.6;
      ctx.fillStyle = lit ? P.ink : p.color;
      ctx.beginPath();
      ctx.arc(sx, sy, lit ? r + 2 : r, 0, Math.PI * 2);
      ctx.fill();
      this.shown.push({ x: sx, y: sy, r: Math.max(4, r + 3), id: p.id });
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = 1;
    if (this.hover) {
      const s = this.shown.find((x) => x.id === this.hover);
      if (s) {
        ctx.strokeStyle = P.ring;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.r + 1, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // The chip on top: how many groups.
    const chip = this.arcs.length ? t("{n} gruppi", { n: this.arcs.length }) : t("nessun gruppo ancora");
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
