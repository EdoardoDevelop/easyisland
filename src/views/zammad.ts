// The Zammad card (zammad.rs, «The card»): the agent's overviews as tabs with
// their counts, the tickets of one (state, customer, owner, last change), and
// a ticket opened in place: its messages, state, owner and priority as the
// selects Zammad has (saved at once), an internal note or a reply by email to
// the customer (a second click confirms the email), «Prepara» for the chat.
// Asked by Edoardo on 4 November 2026.
//
// The view lives outside the card (views.ts keys it on `zammadKey()`): it is
// redrawn here, so what is being typed keeps its caret; a draft is kept per
// ticket. The counts and «Nuovo ticket» stay with the check (widgets.rs).

import { h, brandOrDot, clear, clipMark, headActions } from "./dom";
import { State } from "../core/state";
import { Bridge, onEvent, type TicketAdvice, type ZammadList, type ZammadTicket, type ZammadArticle, type ZammadOpt } from "../core/bridge";
import { t } from "../core/i18n";
import { Sound } from "../core/sound";
import { timeAgo, updatedAgo } from "./integrations";
import { rdmActive, rdmLookFor } from "./rdm";

export const ZAMMAD = "integration_zammad";
const COLOR = "#F59E0B";
/** A message longer than this is folded, «Mostra tutto» opens it. */
const FOLD = 700;

const KIND_LABEL = (): Record<string, string> => ({
  new: t("nuovo"), open: t("aperto"), pending: t("in attesa"), closed: t("chiuso"), hidden: t("unito"),
});
const TYPE_ICON: Record<string, string> = { email: "✉", note: "📝", phone: "☎", web: "🌐", sms: "💬", chat: "💬" };

const zm = {
  el: null as HTMLElement | null,
  view: "",
  list: null as ZammadList | null,
  loading: false,
  error: "",
  filter: "",
  /** The widget check the list was read at: a newer one reads it again. */
  seenAt: -1,
  open: null as ZammadTicket | null,
  openId: 0,
  openTitle: "",
  detailError: "",
  status: "" as "" | "saving" | "saved" | "error",
  statusMsg: "",
  statusTimer: 0,
  unfolded: new Set<number>(),
  /** A pending state chosen: the reminder's date is asked before saving. */
  pendingState: 0,
  drafts: new Map<number, string>(),
  email: false,
  confirm: false,
  confirmTimer: 0,
  sending: false,
  openSettings: (() => {}) as () => void,
  prepare: ((_m: TicketAsk) => {}) as (m: TicketAsk) => void,
  /** «Consiglio IA» of the ticket open (ticket_advice.rs), its history unfolded or not. */
  advice: null as TicketAdvice | null,
  adviceFor: 0,
  adviceOpen: true,
  adviceHistory: false,
  adviceFull: false,
  adviceAsked: 0,
};

const errText = (e: unknown) => String(e).replace(/^Error:\s*/, "");

/** What views.ts keys the card on: a ticket open stays put, the list follows the checks. */
export function zammadKey(): string {
  return zm.openId ? `t${zm.openId}` : `l${State.widgetStatus[ZAMMAD]?.at ?? 0}`;
}

/** What the card asks the chat for (island.ts prepareTicket). */
export type TicketAsk = { id: number; title: string; url: string; mode?: "advice" | "talk"; advice?: string };

export function zammadCard(openSettings: () => void, prepare: (m: TicketAsk) => void): HTMLElement {
  zm.openSettings = openSettings;
  zm.prepare = prepare;
  if (!zm.el) {
    zm.el = h("div", { class: "int-card zm-card", onpointerdown: () => void Bridge.focusWindow(true) });
  }
  const at = State.widgetStatus[ZAMMAD]?.at ?? 0;
  if (!zm.openId && at !== zm.seenAt && !zm.loading) {
    zm.seenAt = at;
    void loadList();
  } else {
    draw();
  }
  return zm.el;
}

// ── Loading and saving ───────────────────────────────────────────────────────

async function loadList(view?: string) {
  if (view !== undefined) zm.view = view;
  zm.loading = true;
  zm.error = "";
  draw();
  try {
    const list = await Bridge.zammadTickets(zm.view || null);
    zm.list = list;
    zm.view = list.view;
  } catch (e) {
    zm.error = errText(e);
  }
  zm.loading = false;
  draw();
  State.notify();
}

/** The ticket's advice: checked for news by Rust, which rewrites it if there are. */
async function loadAdvice(id: number) {
  const a = await Bridge.ticketAdviceGet(id).catch(() => null);
  if (zm.openId !== id) return;
  zm.advice = a;
  zm.adviceFor = id;
  if (a?.current && zm.adviceAsked === id) zm.adviceAsked = 0;
  draw();
}

// Rewritten or saved from the chat (ticket_advice.rs emits the ticket's id).
void onEvent<number>("ticket-advice", (id) => {
  if (id === zm.openId) void loadAdvice(id);
});

async function openTicket(id: number, title: string) {
  if (zm.adviceFor !== id) {
    zm.advice = null;
    zm.adviceHistory = false;
    zm.adviceFull = false;
  }
  zm.openId = id;
  zm.openTitle = title;
  zm.open = null;
  zm.detailError = "";
  zm.pendingState = 0;
  zm.unfolded.clear();
  zm.confirm = false;
  zm.status = "";
  draw();
  State.notify();
  try {
    const d = await Bridge.zammadTicket(id);
    if (zm.openId !== id) return;
    zm.open = d;
    void loadAdvice(id);
  } catch (e) {
    if (zm.openId !== id) return;
    zm.detailError = errText(e);
  }
  draw(true);
}

function back() {
  zm.openId = 0;
  zm.open = null;
  zm.pendingState = 0;
  // The list again, with what was changed meanwhile.
  zm.seenAt = State.widgetStatus[ZAMMAD]?.at ?? 0;
  void loadList();
  State.notify();
}

/** A change sent to Zammad: «Salvo…», then the ticket as Zammad has it now. */
async function saving(p: Promise<ZammadTicket>, id: number): Promise<boolean> {
  window.clearTimeout(zm.statusTimer);
  zm.status = "saving";
  drawStatus();
  try {
    const d = await p;
    if (zm.openId === id) zm.open = d;
    zm.status = "saved";
    zm.statusTimer = window.setTimeout(() => { zm.status = ""; drawStatus(); }, 1800);
    // The counts of the card and of the menu.
    void Bridge.widgetRefresh(ZAMMAD);
    return true;
  } catch (e) {
    zm.status = "error";
    zm.statusMsg = errText(e);
    Sound.play("error");
    return false;
  } finally {
    draw();
  }
}

function setField(field: "state_id" | "owner_id" | "priority_id", value: number, pending?: string) {
  const d = zm.open;
  if (!d) return;
  zm.pendingState = 0;
  void saving(Bridge.zammadSet(d.id, field, value, pending ?? null), d.id);
}

async function send() {
  const d = zm.open;
  if (!d || zm.sending || !composer.field) return;
  const text = composer.field.value.trim();
  if (!text) return;
  // A reply to the customer goes out by email: the first click asks, the second sends.
  if (zm.email && !zm.confirm) {
    zm.confirm = true;
    window.clearTimeout(zm.confirmTimer);
    zm.confirmTimer = window.setTimeout(() => { zm.confirm = false; drawComposer(); }, 6000);
    drawComposer();
    return;
  }
  zm.sending = true;
  zm.confirm = false;
  drawComposer();
  const ok = await saving(Bridge.zammadReply(d.id, text, zm.email), d.id);
  zm.sending = false;
  if (ok) {
    Sound.play("send");
    composer.field.value = "";
    zm.drafts.delete(d.id);
  }
  draw(true);
}

// ── Drawing ──────────────────────────────────────────────────────────────────

let statusEl: HTMLElement | null = null;
function drawStatus() {
  if (!statusEl) return;
  statusEl.className = `zm-saved${zm.status === "error" ? " bad" : ""}`;
  statusEl.textContent = zm.status === "saving" ? t("Salvo…") : zm.status === "saved" ? t("Salvato ✓") : zm.status === "error" ? zm.statusMsg : "";
}

function draw(toBottom = false) {
  const el = zm.el;
  if (!el) return;
  // The same ticket drawn again keeps where its messages were scrolled.
  const kept = el.querySelector<HTMLElement>(".zm-thread, .zm-list");
  const keepKey = zm.openId ? `t${zm.openId}` : `l${zm.view}`;
  const top = kept && kept.dataset.key === keepKey ? kept.scrollTop : 0;
  clear(el);
  el.append(head());
  el.append(zm.openId ? detail() : listPart());
  const box = el.querySelector<HTMLElement>(".zm-thread, .zm-list");
  if (box) {
    box.dataset.key = keepKey;
    requestAnimationFrame(() => { box.scrollTop = toBottom ? box.scrollHeight : top; });
  }
}

function linkBtn(text: string, onclick: () => void, title?: string): HTMLElement {
  return h("button", { class: "link-btn", text, title: title ?? "",
    onclick: (e: Event) => { e.stopPropagation(); onclick(); } });
}

function head(): HTMLElement {
  const st = State.widgetStatus[ZAMMAD];
  return h("div", { class: "int-head zm-head" }, brandOrDot(ZAMMAD, COLOR, 7), h("b", { text: "Zammad" }),
    h("span", { class: "zm-sum", text: st?.summary ?? t("Ticket"), title: st?.summary ?? "" }),
    st ? updatedAgo(st.at * 1000) : null,
    headActions(
      linkBtn(t("Aggiorna"), () => {
        void Bridge.widgetRefresh(ZAMMAD);
        if (zm.openId) void openTicket(zm.openId, zm.openTitle);
        else void loadList();
      }),
      linkBtn(t("Apri Zammad"), () => void (zm.open ? Bridge.openUrl(zm.open.url) : Bridge.openZammad())),
      h("button", { class: "link-btn", text: t("Impostazioni…"),
        onclick: (e: Event) => { e.stopPropagation(); zm.openSettings(); } })));
}

function stateBadge(kind: string, name: string): HTMLElement {
  return h("span", { class: `zm-state ${kind || "open"}`, text: name || KIND_LABEL()[kind] || "" });
}

/** "Anna Bianchi <anna@…>" → "Anna Bianchi". */
function shortName(from: string): string {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  return (m ? m[1] : from).trim();
}

function fullDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

// ── The list ─────────────────────────────────────────────────────────────────

function listPart(): HTMLElement {
  const part = h("div", { class: "zm-body" });
  const list = zm.list;
  if (list) {
    part.append(h("div", { class: "zm-tabs" }, ...list.overviews.map((o) =>
      h("button", { class: o.link === zm.view ? "zm-tab on" : "zm-tab", title: o.name,
        onclick: (e: Event) => { e.stopPropagation(); if (o.link !== zm.view) { zm.filter = ""; void loadList(o.link); } } },
      h("span", { text: o.name }), h("b", { text: String(o.count) })))));
  }
  const filter = h("input", { class: "zm-filter", type: "search", spellcheck: "false", value: zm.filter,
    placeholder: t("Filtra: numero, titolo, cliente, tecnico…") }) as HTMLInputElement;
  const rowsBox = h("div", { class: "zm-list" });
  const fill = () => {
    const q = zm.filter.trim().toLowerCase().replace(/^#/, "");
    const all = list?.tickets ?? [];
    const shown = q ? all.filter((x) => `${x.number} ${x.title} ${x.who} ${x.owner} ${x.state}`.toLowerCase().includes(q)) : all;
    rowsBox.replaceChildren(...shown.map((x) => ticketRow(x, list?.me ?? 0)));
    if (!shown.length && !zm.loading) {
      rowsBox.append(h("div", { class: "int-empty", text: q ? t("Nessun ticket con «{q}» in questa vista.", { q: zm.filter.trim() }) : t("Nessun ticket in questa vista.") }));
    }
  };
  filter.addEventListener("input", () => { zm.filter = filter.value; fill(); });
  filter.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape" && filter.value) { e.preventDefault(); filter.value = ""; zm.filter = ""; fill(); }
  });
  if (list?.tickets.length || zm.filter) part.append(filter);
  if (zm.error) part.append(h("div", { class: "notion-note bad", text: zm.error }));
  else if (zm.loading && !list) part.append(h("div", { class: "int-empty", text: t("Leggo i ticket…") }));
  fill();
  part.append(rowsBox);
  if (zm.loading && list) part.append(h("div", { class: "zm-loading", text: t("Aggiorno…") }));
  return part;
}

function ticketRow(x: ZammadList["tickets"][number], me: number): HTMLElement {
  const client = rdmActive() ? x.who : "";
  const owner = x.owner_id <= 1 ? h("span", { class: "zm-free", text: t("non assegnato") })
    : h("span", { class: x.owner_id === me ? "zm-me" : "", text: x.owner_id === me ? t("tu") : x.owner });
  return h("div", { class: `zm-row prio-${prioLevel(x.priority, x.priority_id)}`, role: "button", tabindex: "0",
    title: t("Apri il ticket qui"),
    onclick: () => void openTicket(x.id, `#${x.number} ${x.title}`),
    onkeydown: (e: Event) => { if ((e as KeyboardEvent).key === "Enter") void openTicket(x.id, `#${x.number} ${x.title}`); } },
  h("div", { class: "zm-line" },
    stateBadge(x.kind, x.state),
    h("span", { class: "zm-num", text: `#${x.number}` }),
    h("b", { class: "zm-title", text: x.title }),
    h("span", { class: "int-ago", text: x.updated ? timeAgo(x.updated) : "", title: fullDate(x.updated) })),
  h("div", { class: "zm-line sub" },
    h("span", { class: "zm-who", text: x.who || "—" }),
    h("span", { class: "zm-dot", text: "·" }), owner,
    x.articles ? h("span", { class: "zm-count", text: `💬 ${x.articles}` }) : null,
    client ? h("button", { class: "link-btn rdm-link", text: "RDM", title: t("Connessioni di «{c}» in Remote Desktop Manager", { c: client }),
      onclick: (e: Event) => { e.stopPropagation(); rdmLookFor(client); } }) : null));
}

/** Zammad's priorities are "1 low", "2 normal", "3 high" (any language): the digit, else the id. */
function prioLevel(name: string, id: number): number {
  const n = Number(name.trim().charAt(0));
  return Number.isFinite(n) && n > 0 ? n : id || 2;
}

// ── A ticket ─────────────────────────────────────────────────────────────────

function select(label: string, opts: ZammadOpt[], value: number, onchange: (v: number) => void, extra?: HTMLElement | null): HTMLElement {
  const s = h("select", { class: "zm-select" }) as HTMLSelectElement;
  for (const o of opts) s.append(h("option", { value: String(o.id), text: o.name }));
  s.value = String(value);
  s.disabled = zm.status === "saving";
  s.addEventListener("change", () => onchange(Number(s.value)));
  s.addEventListener("keydown", (e) => e.stopPropagation());
  return h("label", { class: "zm-prop" }, h("span", { text: label }), s, extra ?? null);
}

/** Tomorrow at 9, as a datetime-local value. */
function tomorrowNine(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function detail(): HTMLElement {
  const part = h("div", { class: "zm-body" });
  const d = zm.open;
  part.append(h("div", { class: "zm-bar" },
    h("button", { class: "link-btn zm-back", text: t("‹ Ticket"), title: t("Torna all'elenco"),
      onclick: (e: Event) => { e.stopPropagation(); back(); } }),
    d ? h("span", { class: "zm-num", text: `#${d.number}` }) : null,
    h("span", { class: "zm-grow" }),
    d ? adviceButton(d) : null));
  if (!d) {
    part.append(zm.detailError
      ? h("div", { class: "notion-note bad", text: zm.detailError })
      : h("div", { class: "int-empty", text: t("Apro {t}…", { t: zm.openTitle }) }));
    return part;
  }
  const who = [d.org, d.customer].filter((x, i, a) => x && a.indexOf(x) === i).join(" · ");
  part.append(h("div", { class: "zm-ticket-title", text: d.title }),
    h("div", { class: "zm-ticket-sub" },
      h("span", { text: who || "—" }),
      d.group ? h("span", { text: `· ${d.group}` }) : null,
      h("span", { text: `· ${t("aperto {ago}", { ago: timeAgo(d.created) })}`, title: fullDate(d.created) })));

  // The selects, as in Zammad's sidebar.
  const kindOf = (id: number) => d.states.find((o) => o.id === id)?.kind ?? "";
  const stateValue = zm.pendingState || d.state_id;
  const pendingBox = (() => {
    if (!zm.pendingState) {
      return kindOf(d.state_id) === "pending" && d.pending
        ? h("small", { class: "zm-pending", text: t("promemoria {when}", { when: fullDate(d.pending) }) }) : null;
    }
    const when = h("input", { class: "zm-date", type: "datetime-local", value: tomorrowNine() }) as HTMLInputElement;
    when.addEventListener("keydown", (e) => e.stopPropagation());
    return h("span", { class: "zm-pending-set" }, when,
      h("button", { class: "teams-btn light zm-mini", text: t("Salva"),
        onclick: (e: Event) => {
          e.stopPropagation();
          const at = new Date(when.value);
          if (Number.isNaN(at.getTime())) return;
          setField("state_id", zm.pendingState, at.toISOString());
        } }),
      h("button", { class: "teams-btn plain zm-mini", text: t("Annulla"),
        onclick: (e: Event) => { e.stopPropagation(); zm.pendingState = 0; draw(); } }));
  })();
  const mine = d.me > 1 && d.owner_id !== d.me;
  part.append(h("div", { class: "zm-props" },
    select(t("Stato"), d.states, stateValue, (v) => {
      if (kindOf(v) === "pending") { zm.pendingState = v; draw(); } else setField("state_id", v);
    }, pendingBox),
    select(t("Proprietario"), d.owners, d.owner_id, (v) => setField("owner_id", v),
      mine ? h("button", { class: "link-btn", text: t("Assegna a me"),
        onclick: (e: Event) => { e.preventDefault(); e.stopPropagation(); setField("owner_id", d.me); } }) : null),
    d.priorities.length ? select(t("Priorità"), d.priorities, d.priority_id, (v) => setField("priority_id", v)) : null));
  statusEl = h("div", { class: "zm-saved" });
  drawStatus();
  part.append(statusEl);
  const advice = adviceBox(d);
  if (advice) part.append(advice);

  const thread = h("div", { class: "zm-thread" });
  if (!d.articles.length) thread.append(h("div", { class: "int-empty", text: t("Nessun messaggio.") }));
  for (const a of d.articles) thread.append(message(a, d));
  part.append(thread);
  placeComposer(part, d);
  return part;
}

// ── «Consiglio IA» (ticket_advice.rs) ────────────────────────────────────────

/** In the ticket's bar: the first advice from the chat, then a talk about it. */
function adviceButton(d: ZammadTicket): HTMLElement {
  const title = `#${d.number} ${d.title}`;
  const current = zm.advice?.id === d.id ? zm.advice.current : null;
  if (current) {
    return linkBtn(t("Parlane in chat"), () => zm.prepare({ id: d.id, title, url: d.url, mode: "talk", advice: current.text }),
      t("La chat con il ticket e il consiglio attuale, per chiedere di più"));
  }
  return linkBtn(t("💡 Consiglio IA"), () => {
    zm.adviceAsked = d.id;
    zm.prepare({ id: d.id, title, url: d.url, mode: "advice" });
  }, t("Si apre la chat con il ticket, la pagina del cliente e i ticket simili: la risposta resta qui come consiglio del ticket e si aggiorna quando arrivano messaggi nuovi"));
}

const WHY: Record<string, string> = { chat: t("dalla chat"), news: t("con le novità"), manual: t("aggiornato a mano") };

function adviceText(text: string, full: boolean): HTMLElement {
  const el = h("div", { class: full ? "zm-advice-text" : "zm-advice-text folded", text });
  return el;
}

/** The advice above the messages: the current one, «Aggiorna», the history. */
function adviceBox(d: ZammadTicket): HTMLElement | null {
  const a = zm.advice?.id === d.id ? zm.advice : null;
  if (!a?.current && !a?.updating) {
    return zm.adviceAsked === d.id
      ? h("div", { class: "zm-advice wait" }, h("span", { text: t("💡 La chat sta scrivendo il consiglio: resta qui quando ha risposto.") }))
      : null;
  }
  const box = h("div", { class: "zm-advice" });
  const cur = a.current;
  const sub = a.updating
    ? t("aggiorno con le novità…")
    : cur ? [cur.at, WHY[cur.why] ?? ""].filter(Boolean).join(" · ") : "";
  box.append(h("div", { class: "zm-advice-head" },
    h("button", { class: "link-btn zm-advice-title", text: `${zm.adviceOpen ? "▾" : "▸"} ${t("💡 Consiglio IA")}`,
      onclick: (e: Event) => { e.stopPropagation(); zm.adviceOpen = !zm.adviceOpen; draw(); } }),
    h("span", { class: "zm-advice-sub", text: sub }),
    h("span", { class: "zm-grow" }),
    a.updating ? null : linkBtn(t("Aggiorna"), () => {
      void Bridge.ticketAdviceRefresh(d.id).then(() => loadAdvice(d.id));
    }, t("Riscrive il consiglio adesso, con i messaggi di oggi (si aggiorna da solo quando arrivano messaggi nuovi)")),
    a.history.length ? linkBtn(zm.adviceHistory ? t("Nascondi lo storico") : t("Storico ({n})", { n: a.history.length }), () => {
      zm.adviceHistory = !zm.adviceHistory;
      draw();
    }) : null));
  if (a.error) box.append(h("div", { class: "notion-note bad", text: t("Aggiornamento non riuscito: {e}", { e: a.error }) }));
  if (zm.adviceOpen && cur) {
    box.append(adviceText(cur.text, zm.adviceFull));
    if (!zm.adviceFull && (cur.text.split("\n").length > 8 || cur.text.length > 700)) {
      box.append(h("button", { class: "link-btn zm-advice-more", text: t("Mostra tutto"),
        onclick: (e: Event) => { e.stopPropagation(); zm.adviceFull = true; draw(); } }));
    }
  }
  if (zm.adviceHistory) {
    const list = h("div", { class: "zm-advice-history" });
    for (const v of a.history) {
      const item = h("details", { class: "zm-advice-old" },
        h("summary", { text: [v.at, WHY[v.why] ?? "", t("{n} messaggi", { n: v.articles })].filter(Boolean).join(" · ") }),
        adviceText(v.text, true));
      list.append(item);
    }
    box.append(list);
  }
  return box;
}

function message(a: ZammadArticle, d: ZammadTicket): HTMLElement {
  const side = a.sender === "Customer" ? "customer" : a.sender === "System" ? "system" : "agent";
  const long = a.text.length > FOLD && !zm.unfolded.has(a.id);
  const text = long ? `${a.text.slice(0, FOLD).trimEnd()}…` : a.text;
  return h("div", { class: `zm-msg ${side}${a.internal ? " internal" : ""}` },
    h("div", { class: "zm-meta" },
      h("span", { class: "zm-type", text: TYPE_ICON[a.kind] ?? "•", title: a.kind }),
      h("b", { text: shortName(a.from) || (side === "customer" ? d.customer : t("Sistema")), title: a.from }),
      a.internal ? h("span", { class: "zm-note-tag", text: t("nota interna") }) : null,
      a.to && a.kind === "email" ? h("span", { class: "zm-to", text: `→ ${shortName(a.to)}`, title: a.to }) : null,
      h("span", { class: "int-ago", text: timeAgo(a.at), title: fullDate(a.at) })),
    h("div", { class: "zm-text", text: text || t("(nessun testo)") }),
    long ? h("button", { class: "link-btn zm-more", text: t("Mostra tutto"),
      onclick: (e: Event) => { e.stopPropagation(); zm.unfolded.add(a.id); draw(); } }) : null,
    ...a.files.map((f) => h("button", { class: "zm-file", title: t("Apri il ticket in Zammad per scaricarlo"),
      onclick: (e: Event) => { e.stopPropagation(); void Bridge.openUrl(d.url); } }, clipMark(), f)));
}

// ── Writing: a note, or a reply by email ─────────────────────────────────────

const composer = {
  box: null as HTMLElement | null,
  field: null as HTMLTextAreaElement | null,
  modes: null as HTMLElement | null,
  to: null as HTMLElement | null,
  sendBtn: null as HTMLButtonElement | null,
  forId: 0,
};

function buildComposer(): HTMLElement {
  const field = h("textarea", { class: "ac-field zm-field", rows: "2", spellcheck: "true" }) as HTMLTextAreaElement;
  const grow = () => {
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 160)}px`;
  };
  field.addEventListener("input", () => {
    grow();
    if (composer.forId) zm.drafts.set(composer.forId, field.value);
    if (zm.confirm) zm.confirm = false;
    drawComposer();
  });
  field.addEventListener("keydown", (e) => {
    e.stopPropagation(); // Escape and the island's keys stay here
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.isComposing) {
      e.preventDefault();
      void send();
    }
  });
  field.addEventListener("paste", (e) => e.stopPropagation());
  const sendBtn = h("button", { class: "teams-btn light zm-send" }) as HTMLButtonElement;
  sendBtn.addEventListener("click", (e) => { e.stopPropagation(); void send(); });
  composer.field = field;
  composer.sendBtn = sendBtn;
  composer.modes = h("div", { class: "zm-modes" });
  composer.to = h("span", { class: "zm-reply-to" });
  composer.box = h("div", { class: "zm-compose" },
    h("div", { class: "zm-compose-top" }, composer.modes, composer.to),
    field,
    h("div", { class: "zm-compose-bottom" }, h("small", { class: "zm-keys", text: t("Ctrl+Invio per inviare") }), sendBtn));
  return composer.box;
}

function drawComposer() {
  const { field, modes, to, sendBtn } = composer;
  const d = zm.open;
  if (!field || !modes || !to || !sendBtn || !d) return;
  const mode = (email: boolean, label: string, tip: string) => h("button", {
    class: zm.email === email ? "zm-mode on" : "zm-mode", text: label, title: tip,
    onclick: (e: Event) => { e.stopPropagation(); zm.email = email; zm.confirm = false; drawComposer(); field.focus(); },
  });
  modes.replaceChildren(
    mode(false, t("📝 Nota interna"), t("Visibile solo ai tecnici")),
    mode(true, t("✉ Rispondi al cliente"), t("Zammad la invia per email al cliente")));
  to.textContent = zm.email ? (d.reply_to ? t("a {to}", { to: d.reply_to }) : t("nessun indirizzo email")) : "";
  field.placeholder = zm.email ? t("Risposta al cliente…") : t("Nota per i tecnici…");
  field.classList.toggle("email", zm.email);
  sendBtn.disabled = zm.sending || !field.value.trim() || (zm.email && !d.reply_to);
  sendBtn.classList.toggle("red", zm.confirm);
  sendBtn.textContent = zm.sending ? t("Invio…")
    : zm.confirm ? t("Conferma: invia a {to}", { to: d.reply_to })
    : zm.email ? t("Invia al cliente") : t("Aggiungi nota");
}

/** The field, moved into the new drawing with its text, caret and focus; the draft follows the ticket. */
function placeComposer(host: HTMLElement, d: ZammadTicket) {
  if (!composer.box) buildComposer();
  const field = composer.field!;
  const focused = field.ownerDocument.activeElement === field;
  const sel = [field.selectionStart, field.selectionEnd] as const;
  if (composer.forId !== d.id) {
    composer.forId = d.id;
    field.value = zm.drafts.get(d.id) ?? "";
    zm.email = false;
    zm.confirm = false;
  }
  host.append(composer.box!);
  drawComposer();
  if (focused) {
    queueMicrotask(() => {
      if (!field.isConnected) return;
      field.focus();
      field.setSelectionRange(sel[0] ?? 0, sel[1] ?? 0);
    });
  }
}
