// The Zammad Ticket workspace (src-tauri/src/zammad.rs): Panoramica-inspired
// header & flat hairline queue, 2-zone split >= 760px (ticket queue + active
// ticket detail) and single-column drill-down when narrow (< 760px), customer
// details (email, phone, tags), pending state/owner/priority edits saved
// together via Bridge.zammadSave, full messages with lazy-cached inline images
// ([[img:ID]] via Bridge.zammadImage, remote images never loaded), non-inline
// attachments downloaded via Bridge.zammadAttachmentSave, «Consiglio IA», RDM
// quick-lookup, and internal note / confirmed customer email composer.
//
// The view lives outside the card lifecycle (views.ts keys it on `zammadKey()`):
// it is redrawn here so typing and scroll positions stay intact.

import { h, brandOrDot, clear, clipMark, drainBar, svg } from "./dom";
import { ICONS } from "./icons";
import { State } from "../core/state";
import { Bridge, onEvent, type TicketAdvice, type ZammadArticle, type ZammadAttachment, type ZammadList, type ZammadOpt, type ZammadTicket } from "../core/bridge";
import { openClientCard } from "./clientcard";
import { t } from "../core/i18n";
import { Sound } from "../core/sound";
import { timeAgo, updatedAgo } from "./integrations";
import { rdmActive, rdmCopyText, rdmLookFor, rdmSkelRows, renderHighlight } from "./rdm";

export const ZAMMAD = "integration_zammad";
const COLOR = "#F59E0B";
/** Fold only very long messages so emails + inline screenshots read complete by default. */
const FOLD_CHARS = 1800;

const KIND_LABEL = (): Record<string, string> => ({
  new: t("nuovo"), open: t("aperto"), pending: t("in attesa"), closed: t("chiuso"), hidden: t("unito"),
});

const kindIcon = (kind: string): string => {
  switch (kind) {
    case "email": return ICONS.mail;
    case "note": return ICONS.pencil;
    case "phone": return ICONS.phone;
    case "web": return ICONS.rdmWeb;
    case "sms":
    case "chat": return ICONS.bubble;
    default: return ICONS.mail;
  }
};

interface DraftProps {
  state_id: number;
  owner_id: number;
  priority_id: number;
  /** Local datetime-local string when state is pending, else "". */
  pending: string;
}

interface ImgEntry {
  state: "loading" | "ok" | "err";
  src?: string;
  err?: string;
}

const zm = {
  el: null as HTMLElement | null,
  filterInput: null as HTMLInputElement | null,
  view: "",
  list: null as ZammadList | null,
  loading: false,
  error: "",
  filter: "",
  seenAt: -1,
  activeRowId: 0,
  open: null as ZammadTicket | null,
  openId: 0,
  openTitle: "",
  detailError: "",
  draftProps: null as DraftProps | null,
  status: "" as "" | "saving" | "saved" | "error",
  statusMsg: "",
  statusTimer: 0,
  unfolded: new Set<number>(),
  drafts: new Map<number, string>(),
  email: false,
  confirm: false,
  confirmUntil: 0,
  confirmTimer: 0,
  sending: false,
  openSettings: (() => {}) as () => void,
  prepare: ((_m: TicketAsk) => {}) as (m: TicketAsk) => void,
  advice: null as TicketAdvice | null,
  adviceFor: 0,
  adviceOpen: true,
  adviceHistory: false,
  adviceFull: false,
  adviceAsked: 0,
  /** Cached inline images keyed by "ticket:article:attId". */
  imgCache: new Map<string, ImgEntry>(),
  /** Attachment download status keyed by "ticket:article:attId". */
  attState: new Map<string, "saving" | "saved" | "err">(),
  lightbox: null as { src: string; name: string } | null,
  copiedField: "",
  copiedTimer: 0,
  keysWired: false,
};

const errText = (e: unknown) => String(e).replace(/^Error:\s*/, "");

/** What views.ts keys the card on: a ticket open stays put, the list follows the checks. */
export function zammadKey(): string {
  return zm.openId ? `t${zm.openId}` : `l${State.widgetStatus[ZAMMAD]?.at ?? 0}`;
}

/** What the card asks the chat for (island.ts prepareTicket). */
export type TicketAsk = { id: number; title: string; url: string; mode?: "advice" | "talk"; advice?: string };

export function zammadLookFor(customer: string, ticket?: { id: number; title: string }) {
  State.summary = false;
  State.setFocus(ZAMMAD);
  if (ticket) {
    zm.filter = "";
    if (zm.filterInput) zm.filterInput.value = "";
    void openTicket(ticket.id, ticket.title);
    if (!zm.list && !zm.loading) void loadList();
    return;
  }
  zm.openId = 0;
  zm.open = null;
  zm.draftProps = null;
  zm.filter = customer.trim();
  if (zm.filterInput) zm.filterInput.value = zm.filter;
  if (!zm.list && !zm.loading) void loadList();
  else draw();
  State.notify();
}

export function zammadCard(openSettings: () => void, prepare: (m: TicketAsk) => void): HTMLElement {
  zm.openSettings = openSettings;
  zm.prepare = prepare;
  if (!zm.el) {
    zm.el = h("div", {
      class: "int-card zm-card",
      tabindex: "-1",
      onpointerdown: () => void Bridge.focusWindow(true),
    });
    wireKeys(zm.el);
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

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function tomorrowNineLocal(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return toLocalInput(d);
}

function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function isoToLocalInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : toLocalInput(d);
}

function fullDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleString();
}

function shortName(from: string): string {
  const m = from.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  return (m ? m[1] : from).trim();
}

function prioLevel(name: string, id: number): number {
  const n = Number(name.trim().charAt(0));
  return Number.isFinite(n) && n > 0 ? n : id || 2;
}

function stateKindOf(d: ZammadTicket, stateId: number): string {
  return d.states.find((o) => o.id === stateId)?.kind ?? "";
}

function initialDraft(d: ZammadTicket): DraftProps {
  return {
    state_id: d.state_id,
    owner_id: d.owner_id,
    priority_id: d.priority_id,
    pending: stateKindOf(d, d.state_id) === "pending" ? isoToLocalInput(d.pending) : "",
  };
}

function ensureDraft(d: ZammadTicket): DraftProps {
  if (!zm.draftProps) zm.draftProps = initialDraft(d);
  return zm.draftProps;
}

function diffDraft(d: ZammadTicket, draft: DraftProps) {
  const draftKind = stateKindOf(d, draft.state_id);
  const stateChanged = draft.state_id !== d.state_id;
  const ownerChanged = draft.owner_id !== d.owner_id;
  const prioChanged = draft.priority_id !== d.priority_id;
  const initPend = stateKindOf(d, d.state_id) === "pending" ? isoToLocalInput(d.pending) : "";
  const pendingChanged = draftKind === "pending" && draft.pending !== initPend;
  const dirty = stateChanged || ownerChanged || prioChanged || pendingChanged;
  return { draftKind, stateChanged, ownerChanged, prioChanged, pendingChanged, dirty };
}

function flashCopy(fieldKey: string, value: string, label: string) {
  zm.copiedField = fieldKey;
  window.clearTimeout(zm.copiedTimer);
  zm.copiedTimer = window.setTimeout(() => { zm.copiedField = ""; draw(); }, 2000);
  void rdmCopyText(value, t("{l} copiato", { l: label }), (msg) => showSavedStatus(msg));
  draw();
}

function showSavedStatus(msg: string, isError = false) {
  window.clearTimeout(zm.statusTimer);
  zm.status = isError ? "error" : "saved";
  zm.statusMsg = msg;
  drawStatus();
  if (!isError) {
    zm.statusTimer = window.setTimeout(() => { zm.status = ""; zm.statusMsg = ""; drawStatus(); }, 2200);
  }
}

// ── Keyboard navigation ──────────────────────────────────────────────────────

function wireKeys(card: HTMLElement) {
  if (zm.keysWired) return;
  zm.keysWired = true;
  card.addEventListener("keydown", (e) => {
    const target = e.target as HTMLElement | null;
    const inInput = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;

    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      e.stopPropagation();
      zm.filterInput?.focus();
      zm.filterInput?.select();
      return;
    }
    if (e.key === "/" && !inInput) {
      e.preventDefault();
      e.stopPropagation();
      zm.filterInput?.focus();
      return;
    }
    if (e.key === "Escape") {
      if (zm.lightbox) {
        e.preventDefault();
        e.stopPropagation();
        zm.lightbox = null;
        draw();
        return;
      }
      if (zm.filterInput && document.activeElement === zm.filterInput && zm.filter) {
        e.preventDefault();
        e.stopPropagation();
        zm.filter = "";
        zm.filterInput.value = "";
        draw();
        return;
      }
      if (zm.openId) {
        e.preventDefault();
        e.stopPropagation();
        back();
        return;
      }
      return;
    }
    if (inInput) return;

    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const items = filteredTickets();
      if (!items.length) return;
      e.preventDefault();
      e.stopPropagation();
      const idx = items.findIndex((x) => x.id === (zm.activeRowId || zm.openId));
      const next = e.key === "ArrowDown"
        ? (idx < 0 ? 0 : Math.min(idx + 1, items.length - 1))
        : (idx <= 0 ? 0 : idx - 1);
      zm.activeRowId = items[next].id;
      draw();
      card.querySelector<HTMLElement>(`.zm-row[data-id="${zm.activeRowId}"]`)?.scrollIntoView({ block: "nearest" });
    } else if (e.key === "Enter" && zm.activeRowId) {
      const hit = filteredTickets().find((x) => x.id === zm.activeRowId);
      if (hit) {
        e.preventDefault();
        e.stopPropagation();
        void openTicket(hit.id, `#${hit.number} ${hit.title}`);
      }
    }
  });
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

async function loadAdvice(id: number) {
  const a = await Bridge.ticketAdviceGet(id).catch(() => null);
  if (zm.openId !== id) return;
  zm.advice = a;
  zm.adviceFor = id;
  if (a?.current && zm.adviceAsked === id) zm.adviceAsked = 0;
  draw();
}

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
  zm.activeRowId = id;
  zm.openTitle = title;
  zm.open = null;
  zm.draftProps = null;
  zm.detailError = "";
  zm.unfolded.clear();
  zm.confirm = false;
  zm.status = "";
  zm.statusMsg = "";
  zm.lightbox = null;
  draw();
  State.notify();
  try {
    const d = await Bridge.zammadTicket(id);
    if (zm.openId !== id) return;
    zm.open = d;
    zm.draftProps = initialDraft(d);
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
  zm.draftProps = null;
  zm.lightbox = null;
  zm.status = "";
  zm.statusMsg = "";
  zm.seenAt = State.widgetStatus[ZAMMAD]?.at ?? 0;
  void loadList();
  State.notify();
}

async function saving(p: Promise<ZammadTicket>, id: number, resetDraft = false): Promise<boolean> {
  window.clearTimeout(zm.statusTimer);
  zm.status = "saving";
  zm.statusMsg = "";
  draw();
  try {
    const d = await p;
    if (zm.openId === id) {
      zm.open = d;
      if (resetDraft || !zm.draftProps) zm.draftProps = initialDraft(d);
    }
    zm.status = "saved";
    zm.statusMsg = "";
    zm.statusTimer = window.setTimeout(() => { zm.status = ""; drawStatus(); }, 2000);
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

async function savePendingProps() {
  const d = zm.open;
  if (!d || !zm.draftProps || zm.status === "saving") return;
  const { draftKind, stateChanged, ownerChanged, prioChanged, pendingChanged, dirty } = diffDraft(d, zm.draftProps);
  if (!dirty) return;

  let pendingIso: string | null = null;
  if (draftKind === "pending") {
    const raw = zm.draftProps.pending || tomorrowNineLocal();
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      showSavedStatus(t("Data promemoria non valida."), true);
      return;
    }
    pendingIso = parsed.toISOString();
  }

  const ok = await saving(Bridge.zammadSave(d.id, {
    state_id: stateChanged ? zm.draftProps.state_id : null,
    owner_id: ownerChanged ? zm.draftProps.owner_id : null,
    priority_id: prioChanged ? zm.draftProps.priority_id : null,
    pending: stateChanged || pendingChanged ? pendingIso : null,
  }), d.id, true);
  if (ok) {
    Sound.play("blip");
    // Update cached list row immediately so the queue reflects the new state/owner/priority.
    if (zm.list && zm.open) {
      const updated = zm.open;
      const stOpt = updated.states.find((s) => s.id === updated.state_id);
      const owOpt = updated.owners.find((o) => o.id === updated.owner_id);
      const prOpt = updated.priorities.find((p) => p.id === updated.priority_id);
      for (const r of zm.list.tickets) {
        if (r.id === updated.id) {
          if (stOpt) { r.state = stOpt.name; r.kind = stOpt.kind ?? r.kind; }
          if (owOpt) { r.owner_id = updated.owner_id; r.owner = updated.owner_id > 1 ? owOpt.name : ""; }
          if (prOpt) { r.priority_id = updated.priority_id; r.priority = prOpt.name; }
          r.updated = updated.updated;
        }
      }
      draw();
    }
  }
}

async function send() {
  const d = zm.open;
  if (!d || zm.sending || !composer.field) return;
  const text = composer.field.value.trim();
  if (!text) return;
  if (zm.email && !zm.confirm) {
    zm.confirm = true;
    zm.confirmUntil = Date.now() + 6000;
    window.clearTimeout(zm.confirmTimer);
    zm.confirmTimer = window.setTimeout(() => { zm.confirm = false; zm.confirmUntil = 0; drawComposer(); }, 6000);
    drawComposer();
    return;
  }
  zm.sending = true;
  zm.confirm = false;
  zm.confirmUntil = 0;
  drawComposer();
  const ok = await saving(Bridge.zammadReply(d.id, text, zm.email), d.id, false);
  zm.sending = false;
  if (ok) {
    Sound.play("send");
    composer.field.value = "";
    zm.drafts.delete(d.id);
  }
  draw(true);
}

// ── Inline images & attachment downloads ─────────────────────────────────────

function requestInlineImage(ticketId: number, articleId: number, attId: number) {
  const key = `${ticketId}:${articleId}:${attId}`;
  const cur = zm.imgCache.get(key);
  if (cur && (cur.state === "loading" || cur.state === "ok")) return;
  zm.imgCache.set(key, { state: "loading" });
  void Bridge.zammadImage(ticketId, articleId, attId)
    .then((src) => {
      if (!src || !src.startsWith("data:")) {
        zm.imgCache.set(key, { state: "err", err: t("Non è un'immagine") });
      } else {
        zm.imgCache.set(key, { state: "ok", src });
      }
      if (zm.openId === ticketId) draw();
    })
    .catch((err) => {
      zm.imgCache.set(key, { state: "err", err: errText(err) });
      if (zm.openId === ticketId) draw();
    });
}

async function downloadAttachment(ticketId: number, articleId: number, att: ZammadAttachment) {
  const key = `${ticketId}:${articleId}:${att.id}`;
  if (zm.attState.get(key) === "saving") return;
  zm.attState.set(key, "saving");
  draw();
  try {
    await Bridge.zammadAttachmentSave(ticketId, articleId, att.id, att.name);
    zm.attState.set(key, "saved");
    Sound.play("blip");
    showSavedStatus(t("Salvato in Download: {n}", { n: att.name }));
  } catch (err) {
    zm.attState.set(key, "err");
    Sound.play("error");
    showSavedStatus(errText(err), true);
  }
  if (zm.openId === ticketId) draw();
}

// ── Drawing ──────────────────────────────────────────────────────────────────

let statusEl: HTMLElement | null = null;
function drawStatus() {
  if (!statusEl) return;
  statusEl.className = `zm-saved${zm.status === "error" ? " bad" : zm.status === "saving" ? " wait" : ""}`;
  statusEl.textContent = zm.status === "saving"
    ? t("Salvo…")
    : zm.status === "saved" ? (zm.statusMsg || t("Salvato ✓"))
    : zm.status === "error" ? zm.statusMsg
    : "";
}

function filteredTickets(): ZammadList["tickets"] {
  const q = zm.filter.trim().toLowerCase().replace(/^#/, "");
  const all = zm.list?.tickets ?? [];
  if (!q) return all;
  return all.filter((x) => `${x.number} ${x.title} ${x.who} ${x.owner} ${x.state}`.toLowerCase().includes(q));
}

function draw(toBottom = false) {
  const el = zm.el;
  if (!el) return;

  const doc = el.ownerDocument;
  const filterFocused = !!zm.filterInput && doc.activeElement === zm.filterInput;
  const selStart = filterFocused ? zm.filterInput!.selectionStart : null;
  const selEnd = filterFocused ? zm.filterInput!.selectionEnd : null;

  const listEl = el.querySelector<HTMLElement>(".zm-list");
  const listTop = listEl ? listEl.scrollTop : 0;
  const scrollEl = el.querySelector<HTMLElement>(".zm-detail-scroll");
  const keepKey = zm.openId ? `t${zm.openId}` : `l${zm.view}`;
  const detailTop = scrollEl && scrollEl.dataset.key === keepKey ? scrollEl.scrollTop : 0;

  clear(el);
  el.append(head());

  const ws = h("div", { class: zm.openId ? "zm-workspace has-detail" : "zm-workspace" },
    queuePane(),
    detailPane());
  el.append(ws);

  if (zm.lightbox) el.append(lightboxOverlay(zm.lightbox));

  const newList = el.querySelector<HTMLElement>(".zm-list");
  if (newList) newList.scrollTop = listTop;
  const newScroll = el.querySelector<HTMLElement>(".zm-detail-scroll");
  if (newScroll) {
    newScroll.dataset.key = keepKey;
    requestAnimationFrame(() => { newScroll.scrollTop = toBottom ? newScroll.scrollHeight : detailTop; });
  }
  if (filterFocused && zm.filterInput) {
    zm.filterInput.focus();
    zm.filterInput.setSelectionRange(selStart ?? 0, selEnd ?? 0);
  }
}

function linkBtn(text: string, onclick: () => void, title?: string): HTMLElement {
  return h("button", { class: "link-btn", text, title: title ?? "",
    onclick: (e: Event) => { e.stopPropagation(); onclick(); } });
}

function head(): HTMLElement {
  const st = State.widgetStatus[ZAMMAD];
  const overviews = zm.list?.overviews ?? [];
  const shortLabels = [t("tuoi"), t("liberi"), t("escalation")];

  const stats = h("div", { class: "rdm-stats zm-stats" });
  for (let i = 0; i < Math.min(overviews.length, 3); i++) {
    const o = overviews[i];
    const tone = i === 0 ? "accent" : i === 1 && o.count > 0 ? "warn" : "dim";
    stats.append(h("button", {
      class: `rdm-stat zm-stat-btn ${tone}${o.link === zm.view ? " on" : ""}`,
      title: o.name,
      onclick: (e: Event) => { e.stopPropagation(); if (o.link !== zm.view) { zm.filter = ""; void loadList(o.link); } },
    },
    h("b", { text: String(o.count) }),
    h("span", { text: shortLabels[i] ?? o.name })));
  }

  return h("div", { class: zm.openId ? "rdm-dash-top zm-dash-top has-open" : "rdm-dash-top zm-dash-top" },
    h("div", { class: "rdm-dash-title" },
      h("span", { class: "rdm-kicker", text: t("ZAMMAD · HELPDESK") }),
      h("div", { class: "rdm-title-row" },
        brandOrDot(ZAMMAD, COLOR, 7),
        h("b", { class: "rdm-card-title", text: "Zammad" }),
        st ? updatedAgo(st.at * 1000) : null),
      h("div", { class: "rdm-subline" },
        h("span", { class: st?.level === "error" ? "rdm-status bad" : "rdm-status ok", text: st?.summary || t("Ticket") }))),
    h("div", { class: "rdm-dash-right" },
      stats.childElementCount ? stats : null,
      h("div", { class: "rdm-dash-actions" },
        h("button", {
          class: zm.loading ? "rdm-icon-act spinning" : "rdm-icon-act",
          title: t("Aggiorna"),
          onclick: (e: Event) => {
            e.stopPropagation();
            void Bridge.widgetRefresh(ZAMMAD);
            if (zm.openId) void openTicket(zm.openId, zm.openTitle);
            else void loadList();
          },
        }, svg(ICONS.refresh, 14, { stroke: 1.8 })),
        h("button", {
          class: "rdm-icon-act",
          title: t("Apri Zammad"),
          onclick: (e: Event) => { e.stopPropagation(); void (zm.open ? Bridge.openUrl(zm.open.url) : Bridge.openZammad()); },
        }, svg(ICONS.arrowUpRight, 14, { stroke: 1.8 })),
        h("button", {
          class: "rdm-icon-act",
          title: t("Impostazioni…"),
          onclick: (e: Event) => { e.stopPropagation(); zm.openSettings(); },
        }, svg(ICONS.sliders, 14)))));
}

function stateBadge(kind: string, name: string): HTMLElement {
  return h("span", { class: `zm-state ${kind || "open"}`, text: name || KIND_LABEL()[kind] || "" });
}

// ── Left Queue Pane ──────────────────────────────────────────────────────────

function queuePane(): HTMLElement {
  const pane = h("div", { class: "zm-queue" });
  const list = zm.list;

  if (list) {
    pane.append(h("div", { class: "zm-tabs" }, ...list.overviews.map((o) =>
      h("button", {
        class: o.link === zm.view ? "zm-tab on" : "zm-tab",
        title: o.name,
        onclick: (e: Event) => { e.stopPropagation(); if (o.link !== zm.view) { zm.filter = ""; void loadList(o.link); } },
      }, h("span", { text: o.name }), h("b", { text: String(o.count) })))));
  }

  const filterInput = h("input", {
    class: "rdm-search-input zm-filter",
    type: "search",
    spellcheck: "false",
    value: zm.filter,
    placeholder: t("Filtra: numero, titolo, cliente, tecnico…"),
  }) as HTMLInputElement;
  zm.filterInput = filterInput;

  const clearBtn = h("button", {
    class: "rdm-search-clear",
    title: t("Pulisci (Esc)"),
    style: zm.filter.trim() ? "" : "display:none",
    onclick: (e: Event) => { e.stopPropagation(); zm.filter = ""; filterInput.value = ""; draw(); zm.filterInput?.focus(); },
  }, svg(ICONS.xmark, 12));

  const kbdHint = h("span", {
    class: "rdm-search-kbd",
    style: zm.filter.trim() ? "display:none" : "",
  }, h("kbd", { text: "/" }));

  const rowsBox = h("div", { class: "zm-list" });

  const renderRows = () => {
    const items = filteredTickets();
    clear(rowsBox);
    if (zm.loading && !list) {
      rowsBox.append(rdmSkelRows(5));
    } else if (!items.length && !zm.loading) {
      rowsBox.append(h("div", { class: "rdm-empty-state compact" },
        svg(ICONS.search, 20, { stroke: 1.5 }),
        h("b", { text: zm.filter.trim() ? t("Nessun ticket con «{q}» in questa vista.", { q: zm.filter.trim() }) : t("Nessun ticket in questa vista.") })));
    } else {
      for (const x of items) rowsBox.append(ticketRow(x, list?.me ?? 0));
    }
    clearBtn.style.display = zm.filter.trim() ? "" : "none";
    kbdHint.style.display = zm.filter.trim() ? "none" : "";
  };

  filterInput.addEventListener("input", () => {
    zm.filter = filterInput.value;
    renderRows();
  });
  filterInput.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (filterInput.value) {
        e.preventDefault();
        e.stopPropagation();
        filterInput.value = "";
        zm.filter = "";
        renderRows();
      }
      return;
    }
    e.stopPropagation();
  });

  if (list?.tickets.length || zm.filter) {
    pane.append(h("div", { class: "rdm-search-zone zm-search-zone" },
      h("span", { class: "rdm-search-ico" }, svg(ICONS.search, 14, { stroke: 1.9 })),
      filterInput,
      kbdHint,
      clearBtn));
  }

  if (zm.error) pane.append(h("div", { class: "notion-note bad", text: zm.error }));
  renderRows();
  pane.append(rowsBox);
  if (zm.loading && list) pane.append(h("div", { class: "zm-loading", text: t("Aggiorno…") }));
  return pane;
}

function ticketRow(x: ZammadList["tickets"][number], me: number): HTMLElement {
  const q = zm.filter.trim();
  const isOpen = zm.openId === x.id;
  const isActive = zm.activeRowId === x.id && !isOpen;
  const client = rdmActive() ? x.who : "";
  const owner = x.owner_id <= 1
    ? h("span", { class: "zm-free", text: t("non assegnato") })
    : h("span", { class: x.owner_id === me ? "zm-me" : "", text: x.owner_id === me ? t("tu") : x.owner });

  return h("div", {
    class: `zm-row prio-${prioLevel(x.priority, x.priority_id)}${isOpen ? " is-open" : ""}${isActive ? " is-active" : ""}`,
    role: "button",
    tabindex: "0",
    "data-id": String(x.id),
    title: t("Apri il ticket qui"),
    onclick: () => void openTicket(x.id, `#${x.number} ${x.title}`),
    onkeydown: (e: Event) => { if ((e as KeyboardEvent).key === "Enter") void openTicket(x.id, `#${x.number} ${x.title}`); },
  },
  h("div", { class: "zm-line" },
    stateBadge(x.kind, x.state),
    h("span", { class: "zm-num" }, ...(q ? renderHighlight(`#${x.number}`, q) : [`#${x.number}`])),
    h("span", { class: "int-ago", text: x.updated ? timeAgo(x.updated) : "", title: fullDate(x.updated) })),
  h("b", { class: "zm-title" }, ...(q ? renderHighlight(x.title, q) : [x.title])),
  h("div", { class: "zm-line sub" },
    h("span", { class: "zm-who" }, ...(q ? renderHighlight(x.who || "—", q) : [x.who || "—"])),
    h("span", { class: "zm-dot", text: "·" }),
    owner,
    x.articles ? h("span", { class: "zm-count" }, svg(ICONS.bubble, 11), h("span", { text: String(x.articles) })) : null,
    client ? h("button", {
      class: "link-btn rdm-link",
      text: "RDM",
      title: t("Connessioni di «{c}» in Remote Desktop Manager", { c: client }),
      onclick: (e: Event) => { e.stopPropagation(); rdmLookFor(client); },
    }) : null));
}

// ── Right Ticket Detail Pane ─────────────────────────────────────────────────

function selectProp(label: string, opts: ZammadOpt[], value: number, origValue: number, onchange: (v: number) => void, extra?: HTMLElement | null): HTMLElement {
  const dirty = value !== origValue;
  const s = h("select", { class: dirty ? "zm-select is-dirty" : "zm-select" }) as HTMLSelectElement;
  for (const o of opts) s.append(h("option", { value: String(o.id), text: o.name }));
  s.value = String(value);
  s.disabled = zm.status === "saving";
  s.addEventListener("change", () => onchange(Number(s.value)));
  s.addEventListener("keydown", (e) => e.stopPropagation());
  return h("label", { class: dirty ? "zm-prop is-dirty" : "zm-prop" },
    h("span", { text: label }),
    s,
    extra ?? null);
}

function customerChips(d: ZammadTicket): HTMLElement | null {
  const chips: HTMLElement[] = [];
  if (d.customer_email) {
    const copied = zm.copiedField === "email";
    chips.push(h("button", {
      class: copied ? "zm-info-chip is-copied" : "zm-info-chip",
      title: t("Copia email: {e}", { e: d.customer_email }),
      onclick: (ev: Event) => { ev.stopPropagation(); flashCopy("email", d.customer_email, t("Email")); },
    }, svg(copied ? ICONS.check : ICONS.mail, 11, { stroke: 1.8 }), h("span", { text: d.customer_email })));
  }
  if (d.customer_phone) {
    const copied = zm.copiedField === "phone";
    chips.push(h("button", {
      class: copied ? "zm-info-chip is-copied" : "zm-info-chip",
      title: t("Copia telefono: {p}", { p: d.customer_phone }),
      onclick: (ev: Event) => { ev.stopPropagation(); flashCopy("phone", d.customer_phone, t("Telefono")); },
    }, svg(copied ? ICONS.check : ICONS.phone, 11, { stroke: 1.8 }), h("span", { text: d.customer_phone })));
  }
  for (const tag of d.tags ?? []) {
    if (!tag.trim()) continue;
    chips.push(h("span", { class: "zm-tag-chip" }, svg(ICONS.tag, 10, { stroke: 1.8 }), h("span", { text: tag })));
  }
  return chips.length ? h("div", { class: "zm-meta-chips" }, ...chips) : null;
}

function detailPane(): HTMLElement {
  const pane = h("div", { class: "zm-detail-pane" });
  if (!zm.openId) {
    pane.append(h("div", { class: "rdm-detail-empty" },
      svg(ICONS.mail, 26, { stroke: 1.4 }),
      h("b", { text: t("Seleziona un ticket") }),
      h("span", { text: t("Frecce ↑ ↓ per scorrere i ticket, Invio per aprire i messaggi completi e rispondere.") })));
    return pane;
  }

  const d = zm.open;
  const rdmCustomer = d ? (d.org || d.customer) : "";
  const stOpt = d?.states.find((s) => s.id === d.state_id);

  pane.append(h("div", { class: "zm-bar" },
    h("button", {
      class: "rdm-back-btn zm-back-btn",
      title: t("Torna all'elenco"),
      onclick: (e: Event) => { e.stopPropagation(); back(); },
    }, svg(ICONS.chevronLeft, 12, { stroke: 2 }), h("span", { text: t("Ticket") })),
    d ? h("span", { class: "zm-num", text: `#${d.number}` }) : null,
    d && stOpt ? stateBadge(stOpt.kind ?? "", stOpt.name) : null,
    h("span", { class: "zm-grow" }),
    d && rdmCustomer ? h("button", {
      class: "link-btn zm-rdm-btn",
      text: t("Scheda cliente"),
      title: t("Apri la scheda cliente nella Memoria"),
      onclick: (e: Event) => {
        e.stopPropagation();
        openClientCard(rdmCustomer, {
          contactName: d.customer,
          email: d.customer_email,
          phone: d.customer_phone,
          source: "zammad",
        });
      },
    }) : null,
    d && rdmActive() && rdmCustomer ? h("button", {
      class: "link-btn zm-rdm-btn",
      text: "RDM",
      title: t("Connessioni di «{c}» in Remote Desktop Manager", { c: rdmCustomer }),
      onclick: (e: Event) => { e.stopPropagation(); rdmLookFor(rdmCustomer); },
    }) : null,
    d ? adviceButton(d) : null,
    d ? h("button", {
      class: "rdm-icon-act sm",
      title: t("Apri in Zammad"),
      onclick: (e: Event) => { e.stopPropagation(); void Bridge.openUrl(d.url); },
    }, svg(ICONS.arrowUpRight, 13, { stroke: 1.8 })) : null));

  if (!d) {
    if (zm.detailError) {
      pane.append(h("div", { class: "notion-note bad", text: zm.detailError }));
    } else {
      pane.append(h("div", { class: "zm-hero-block" },
        h("div", { class: "zm-ticket-title", text: zm.openTitle })),
      rdmSkelRows(4));
    }
    return pane;
  }

  const scroll = h("div", { class: "zm-detail-scroll" });
  const who = [d.org, d.customer].filter((x, i, a) => x && a.indexOf(x) === i).join(" · ");
  const clientName = (d.org || d.customer).trim();
  const openClient = () => openClientCard(clientName, {
    contactName: d.customer,
    email: d.customer_email,
    phone: d.customer_phone,
    source: "zammad",
  });
  scroll.append(h("div", { class: "zm-hero-block" },
    h("div", { class: "zm-ticket-title", text: d.title }),
    h("div", { class: "zm-ticket-sub" },
      clientName
        ? h("button", { class: "zm-client-link", title: t("Apri scheda cliente di «{c}»", { c: clientName }), onclick: (e: Event) => { e.stopPropagation(); openClient(); } },
          svg(ICONS.people, 11), h("b", { text: who || "—" }))
        : h("b", { text: who || "—" }),
      d.group ? h("span", { text: `· ${d.group}` }) : null,
      h("span", { text: `· ${t("aperto {ago}", { ago: timeAgo(d.created) })}`, title: fullDate(d.created) })),
    customerChips(d)));

  // Pending edits on Stato / Proprietario / Priorità with explicit Salva / Annulla.
  const draft = ensureDraft(d);
  const { draftKind, dirty } = diffDraft(d, draft);

  const pendingExtra = (() => {
    if (draftKind === "pending") {
      const val = draft.pending || tomorrowNineLocal();
      if (!draft.pending) draft.pending = val;
      const when = h("input", { class: "zm-date", type: "datetime-local", value: val }) as HTMLInputElement;
      when.disabled = zm.status === "saving";
      when.addEventListener("input", () => { draft.pending = when.value; });
      when.addEventListener("change", () => { draft.pending = when.value; draw(); });
      when.addEventListener("keydown", (e) => e.stopPropagation());
      return when;
    }
    return d.pending && stateKindOf(d, d.state_id) === "pending"
      ? h("small", { class: "zm-pending", text: t("promemoria {when}", { when: fullDate(d.pending) }) })
      : null;
  })();

  const canMine = d.me > 1 && draft.owner_id !== d.me;
  const propsCard = h("div", { class: dirty ? "zm-props-card is-dirty" : "zm-props-card" },
    h("div", { class: "zm-props" },
      selectProp(t("Stato"), d.states, draft.state_id, d.state_id, (v) => {
        draft.state_id = v;
        if (stateKindOf(d, v) === "pending" && !draft.pending) draft.pending = tomorrowNineLocal();
        draw();
      }, pendingExtra),
      selectProp(t("Proprietario"), d.owners, draft.owner_id, d.owner_id, (v) => {
        draft.owner_id = v;
        draw();
      }, canMine ? h("button", {
        class: "link-btn",
        text: t("Assegna a me"),
        onclick: (e: Event) => { e.preventDefault(); e.stopPropagation(); draft.owner_id = d.me; draw(); },
      }) : null),
      d.priorities.length ? selectProp(t("Priorità"), d.priorities, draft.priority_id, d.priority_id, (v) => {
        draft.priority_id = v;
        draw();
      }) : null));

  if (dirty) {
    propsCard.append(h("div", { class: "zm-save-bar" },
      h("span", { class: "zm-dirty-note", text: t("Modifiche non salvate") }),
      h("button", {
        class: "teams-btn plain zm-mini",
        text: t("Annulla"),
        disabled: zm.status === "saving",
        onclick: (e: Event) => { e.stopPropagation(); zm.draftProps = initialDraft(d); draw(); },
      }),
      h("button", {
        class: "teams-btn light zm-mini",
        text: zm.status === "saving" ? t("Salvo…") : t("Salva"),
        disabled: zm.status === "saving",
        onclick: (e: Event) => { e.stopPropagation(); void savePendingProps(); },
      })));
  }
  scroll.append(propsCard);

  statusEl = h("div", { class: "zm-saved" });
  drawStatus();
  scroll.append(statusEl);

  const advice = adviceBox(d);
  if (advice) scroll.append(advice);

  const thread = h("div", { class: "zm-thread" });
  if (!d.articles.length) thread.append(h("div", { class: "rdm-empty-state compact" }, h("b", { text: t("Nessun messaggio.") })));
  for (const a of d.articles) thread.append(message(a, d));
  scroll.append(thread);

  pane.append(scroll);
  placeComposer(pane, d);
  return pane;
}

// ── «Consiglio IA» (ticket_advice.rs) ────────────────────────────────────────

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
    h("button", {
      class: "link-btn zm-advice-title",
      text: `${zm.adviceOpen ? "▾" : "▸"} ${t("💡 Consiglio IA")}`,
      onclick: (e: Event) => { e.stopPropagation(); zm.adviceOpen = !zm.adviceOpen; draw(); },
    }),
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
    box.append(h("div", { class: zm.adviceFull ? "zm-advice-text" : "zm-advice-text folded", text: cur.text }));
    if (!zm.adviceFull && (cur.text.split("\n").length > 8 || cur.text.length > 700)) {
      box.append(h("button", { class: "link-btn zm-advice-more", text: t("Mostra tutto"),
        onclick: (e: Event) => { e.stopPropagation(); zm.adviceFull = true; draw(); } }));
    }
  }
  if (zm.adviceHistory) {
    const list = h("div", { class: "zm-advice-history" });
    for (const v of a.history) {
      list.append(h("details", { class: "zm-advice-old" },
        h("summary", { text: [v.at, WHY[v.why] ?? "", t("{n} messaggi", { n: v.articles })].filter(Boolean).join(" · ") }),
        h("div", { class: "zm-advice-text", text: v.text })));
    }
    box.append(list);
  }
  return box;
}

// ── Message rendering (inline images, CC, non-inline attachments) ────────────

function sliceSafely(text: string, maxChars: number): { shown: string; cut: boolean } {
  if (text.length <= maxChars) return { shown: text, cut: false };
  // Never cut inside a `[[img:ID]]` placeholder line.
  let pos = maxChars;
  const nl = text.lastIndexOf("\n", pos);
  if (nl > maxChars - 180) pos = nl;
  return { shown: text.slice(0, pos).trimEnd(), cut: true };
}

function renderInlineImageSlot(d: ZammadTicket, a: ZammadArticle, attId: number): HTMLElement {
  const key = `${d.id}:${a.id}:${attId}`;
  const att = (a.attachments ?? []).find((x) => x.id === attId);
  const name = att?.name || `#${attId}`;
  const cached = zm.imgCache.get(key);
  if (!cached) requestInlineImage(d.id, a.id, attId);

  const state = cached?.state ?? "loading";
  if (state === "ok" && cached?.src) {
    return h("figure", { class: "zm-inline-fig" },
      h("img", {
        class: "zm-inline-img",
        src: cached.src,
        alt: name,
        title: t("Clicca per ingrandire: {n}", { n: name }),
        onclick: (ev: Event) => {
          ev.stopPropagation();
          zm.lightbox = { src: cached.src!, name };
          draw();
        },
      }),
      att ? h("figcaption", { class: "zm-inline-cap", text: name }) : null);
  }
  if (state === "err") {
    return h("div", { class: "zm-img-fallback" },
      svg(ICONS.bang, 12),
      h("span", { text: `${name} · ${cached?.err || t("Non è un'immagine")}` }));
  }
  return h("div", { class: "zm-img-skel" },
    h("div", { class: "rdm-skel zm-img-skel-box" }),
    h("span", { text: t("Carico immagine {n}…", { n: name }) }));
}

function renderArticleBody(d: ZammadTicket, a: ZammadArticle, text: string): HTMLElement {
  const wrap = h("div", { class: "zm-text-rich" });
  if (!text.trim()) {
    wrap.append(h("div", { class: "zm-text muted", text: t("(nessun testo)") }));
    return wrap;
  }

  const lines = text.split("\n");
  let textBuf: string[] = [];
  const flushText = () => {
    const joined = textBuf.join("\n").replace(/^\n+|\n+$/g, "");
    if (joined) wrap.append(h("div", { class: "zm-text", text: joined }));
    textBuf = [];
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    const imgMatch = trimmed.match(/^\[\[img:(\d+)\]\]$/);
    if (imgMatch) {
      flushText();
      wrap.append(renderInlineImageSlot(d, a, Number(imgMatch[1])));
      continue;
    }
    if (trimmed === "[immagine]") {
      flushText();
      wrap.append(h("div", {
        class: "zm-remote-img-note",
        title: t("Immagine remota bloccata per proteggere la privacy"),
      }, svg(ICONS.shield, 12, { stroke: 1.7 }), h("span", { text: t("[immagine]") })));
      continue;
    }
    textBuf.push(rawLine);
  }
  flushText();
  return wrap;
}

function message(a: ZammadArticle, d: ZammadTicket): HTMLElement {
  const side = a.sender === "Customer" ? "customer" : a.sender === "System" ? "system" : "agent";
  const unfolded = zm.unfolded.has(a.id);
  const sliced = unfolded ? { shown: a.text, cut: false } : sliceSafely(a.text, FOLD_CHARS);

  // Non-inline attachments only: inline:true ones are rendered inside the text via [[img:ID]].
  const nonInline: ZammadAttachment[] = (a.attachments ?? []).filter((x) => !x.inline);
  const legacyFiles = !a.attachments?.length ? a.files : [];

  const attRow = nonInline.length || legacyFiles.length
    ? h("div", { class: "zm-att-list" },
      ...nonInline.map((att) => {
        const st = zm.attState.get(`${d.id}:${a.id}:${att.id}`);
        const sizeLabel = formatBytes(att.size);
        return h("div", { class: "zm-att-card" },
          clipMark(12),
          h("div", { class: "zm-att-info" },
            h("span", { class: "zm-att-name", text: att.name, title: att.name }),
            sizeLabel ? h("small", { class: "zm-att-meta", text: sizeLabel }) : null),
          h("button", {
            class: st === "saved" ? "zm-att-dl saved" : "zm-att-dl",
            disabled: st === "saving",
            title: t("Scarica in Download e mostra in Esplora file"),
            onclick: (e: Event) => { e.stopPropagation(); void downloadAttachment(d.id, a.id, att); },
          },
          svg(st === "saved" ? ICONS.check : ICONS.download, 11, { stroke: 1.9 }),
          h("span", { text: st === "saving" ? "…" : st === "saved" ? t("Salvato ✓") : t("Scarica") })));
      }),
      ...legacyFiles.map((fname) => h("button", {
        class: "zm-file",
        title: t("Apri il ticket in Zammad per scaricarlo"),
        onclick: (e: Event) => { e.stopPropagation(); void Bridge.openUrl(d.url); },
      }, clipMark(), fname)))
    : null;

  return h("div", { class: `zm-msg ${side}${a.internal ? " internal" : ""}` },
    h("div", { class: "zm-meta" },
      h("span", { class: "zm-type-ico", title: a.kind }, svg(kindIcon(a.kind), 12, { stroke: 1.8 })),
      h("b", { text: shortName(a.from) || (side === "customer" ? d.customer : t("Sistema")), title: a.from }),
      a.internal ? h("span", { class: "zm-note-tag", text: t("nota interna") }) : null,
      a.to && a.kind === "email" ? h("span", { class: "zm-to", text: `→ ${shortName(a.to)}`, title: a.to }) : null,
      h("span", { class: "int-ago", text: timeAgo(a.at), title: fullDate(a.at) })),
    a.cc ? h("div", { class: "zm-cc", title: a.cc },
      h("span", { class: "zm-cc-k", text: "CC" }),
      h("span", { class: "zm-cc-v", text: a.cc })) : null,
    renderArticleBody(d, a, sliced.shown),
    sliced.cut ? h("button", {
      class: "link-btn zm-more",
      text: t("Mostra tutto"),
      onclick: (e: Event) => { e.stopPropagation(); zm.unfolded.add(a.id); draw(); },
    }) : null,
    attRow);
}

function lightboxOverlay(box: { src: string; name: string }): HTMLElement {
  return h("div", {
    class: "zm-lightbox",
    onclick: () => { zm.lightbox = null; draw(); },
  },
  h("div", { class: "zm-lightbox-bar", onclick: (e: Event) => e.stopPropagation() },
    h("span", { class: "zm-lightbox-name", text: box.name }),
    h("button", {
      class: "rdm-icon-act",
      title: t("Chiudi"),
      onclick: () => { zm.lightbox = null; draw(); },
    }, svg(ICONS.xmark, 13))),
  h("img", {
    class: "zm-lightbox-img",
    src: box.src,
    alt: box.name,
    onclick: (e: Event) => e.stopPropagation(),
  }));
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
    e.stopPropagation();
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
  const mode = (email: boolean, icon: string, label: string, tip: string) => h("button", {
    class: zm.email === email ? "zm-mode on" : "zm-mode",
    title: tip,
    onclick: (e: Event) => { e.stopPropagation(); zm.email = email; zm.confirm = false; zm.confirmUntil = 0; window.clearTimeout(zm.confirmTimer); drawComposer(); field.focus(); },
  }, svg(icon, 11, { stroke: 1.8 }), h("span", { text: label }));
  modes.replaceChildren(
    mode(false, ICONS.pencil, t("Nota interna"), t("Visibile solo ai tecnici")),
    mode(true, ICONS.mail, t("Rispondi al cliente"), t("Zammad la invia per email al cliente")));
  to.textContent = zm.email ? (d.reply_to ? t("a {to}", { to: d.reply_to }) : t("nessun indirizzo email")) : "";
  field.placeholder = zm.email ? t("Risposta al cliente…") : t("Nota per i tecnici…");
  field.classList.toggle("email", zm.email);
  sendBtn.disabled = zm.sending || !field.value.trim() || (zm.email && !d.reply_to);
  sendBtn.classList.toggle("red", zm.confirm);
  const label = zm.sending ? t("Invio…")
    : zm.confirm ? t("Conferma: invia a {to}", { to: d.reply_to })
    : zm.email ? t("Invia al cliente") : t("Aggiungi nota");
  const drain = zm.confirm && !zm.sending ? drainBar(zm.confirmUntil, 6000, { slim: true }) : null;
  if (drain) sendBtn.replaceChildren(h("span", { text: label }), drain);
  else sendBtn.textContent = label;
}

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
    zm.confirmUntil = 0;
    window.clearTimeout(zm.confirmTimer);
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
