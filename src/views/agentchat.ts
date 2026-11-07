// The "Agent Chat" card (src-tauri/src/agentchat.rs `publish`): whether
// EasyIsland is listening in the user's Agent Chat and as whom, which engines
// answer (the lead marked), «Ascolto» on or off, the conversation of the
// followed rooms with who is on each message («preso da», «nessuna risposta»,
// «in coda»), who is working now (/api/status, read for a few minutes after a
// message), «In esecuzione» with what this PC's engines are doing, step by step
// (`LiveTurn`, never from the server), and a field to write as the owner (owner
// token, `owner_send`).
// The pill wears the state: working while an engine answers, asleep with
// listening off (integrations.ts).
//
// The card is rebuilt at every update (views.ts keys it on the data): the
// field lives outside it (`composer`) and is moved into each new card, its
// text, cursor and focus kept.

import { h, brandOrDot, clipMark } from "./dom";
import { State } from "../core/state";
import { Bridge, onEvent } from "../core/bridge";
import { renderMarkdown } from "../core/markdown";
import { t } from "../core/i18n";
import { Sound } from "../core/sound";
import { timeAgo } from "./integrations";

export const AGENTCHAT = "integration_agentchat";
const COLOR = "#8B5CF6";

export interface ChatMsg {
  id: number;
  room: string;
  sender: string;
  text: string;
  verified: boolean;
  thread: number | null;
  kind: string;
  ts: number;
  /** Written by the owner (the page, or an app with the owner token). */
  human?: boolean;
  claimed_by?: string | null;
  /** Attachments: name, size, SHA-256 and who imported each (one agent only). */
  files?: { id: string; name: string; size: number; sha256: string; imported_by?: string | null }[];
}

/** The server's /api/status: who works on what, claims, who did not answer. */
export interface ChatActivity {
  active?: { by: string; message: number; state: "queued" | "thinking" | "tools" | "writing"; detail?: string; since: number }[];
  claims?: Record<string, string>;
  outcomes?: Record<string, Record<string, "silent" | "failed">>;
  online?: Record<string, boolean>;
  now?: number;
}

export interface AgentchatData {
  configured?: boolean;
  listening?: boolean;
  connected?: boolean;
  name?: string;
  owner?: string;
  error?: string | null;
  stopped?: boolean;
  busy?: number;
  turns?: number;
  perHour?: number;
  last?: string;
  url?: string | null;
  /** name: its name in the chat («lia», else «pc/engine»); today and tokens: turns and ≈ tokens today. */
  engines?: { name: string; handle?: string; engine: string; lead: boolean; today?: number; tokens?: number }[];
  /** «casa/claude» → «lia». */
  names?: Record<string, string>;
  messages?: ChatMsg[];
  activity?: ChatActivity | null;
  /** The owner token is there: the field writes as the owner. */
  canWrite?: boolean;
  ownerName?: string;
  rooms?: string[];
  /** The map of the chat (agentchat_map.rs), most recent first. */
  topics?: ChatTopic[];
}

/** A topic of the chat: a request of the owner and what followed it. */
export interface ChatTopic {
  id: number;
  room: string;
  title: string;
  state: "da fare" | "aperto" | "fatto" | "bloccato";
  who: string[];
  first: number;
  last: number;
  ids: number[];
  consult: boolean;
  last_line: string;
}

/** A turn of an engine of this PC (agentchat.rs LiveTurn). */
interface LiveTurn {
  id: number;
  who: string;
  engine: string;
  message: number;
  about: string;
  started: number;
  state: "working" | "done" | "failed" | "stopped";
  text: string;
}

/** «Chat», «Argomenti» or «In esecuzione»; a topic opened in «Chat» shows only its messages. */
let acView: "chat" | "topics" | "work" = "chat";
let acTopic: { topic: ChatTopic; msgs: ChatMsg[] } | null = null;

/** What views.ts adds to the card's key: the tab and the topic open redraw it. */
export function agentchatKey(): string {
  const live = [...liveTurns.values()].map((x) => `${x.id}${x.state}`).join();
  return `${acView}|${acTopic?.topic.id ?? ""}|${acTopic?.msgs.length ?? 0}|${livePicked}|${live}`;
}

const STATE_LABEL: Record<ChatTopic["state"], string> = { "da fare": t("da fare"), aperto: t("aperto"), fatto: t("fatto"), bloccato: t("bloccato") };

/** A topic opened: its messages (older ones too, from the map), shown in «Chat». */
async function openTopic(tp: ChatTopic) {
  const msgs = (await Bridge.agentchatTopicMessages<ChatMsg>(tp.id)) ?? [];
  acTopic = { topic: tp, msgs };
  acView = "chat";
  State.notify();
}

function topicRow(tp: ChatTopic): HTMLElement {
  const state = tp.state.replace(" ", "-");
  return h("div", { class: "ac-topic", role: "button", title: tp.last_line, onclick: (e: Event) => { e.stopPropagation(); void openTopic(tp); } },
    h("span", { class: `ac-tstate ${state}`, text: STATE_LABEL[tp.state] ?? tp.state }),
    h("div", { class: "ac-tmain" },
      h("div", { class: "ac-ttitle", text: `${tp.consult ? `${t("consulta")} · ` : ""}${tp.title}` }),
      h("div", { class: "ac-tmeta", text: [tp.who.join(", "), tp.room, tp.ids.length === 1 ? t("1 messaggio") : t("{n} messaggi", { n: tp.ids.length }), timeAgo(tp.last * 1000)].filter(Boolean).join(" · ") })));
}

export function agentchatData(): AgentchatData {
  return (State.integrations[AGENTCHAT]?.data ?? {}) as AgentchatData;
}

/** The pill's state: answering, listening, off or broken. */
export function agentchatState(): "working" | "idle" | "sleeping" | "error" {
  const d = agentchatData();
  if (!d.configured || d.listening === false) return "sleeping";
  if (d.error) return "error";
  return (d.busy ?? 0) > 0 ? "working" : "idle";
}

/** The Panoramica's line. */
export function agentchatLine(): string {
  const d = agentchatData();
  if (!d.configured) return t("Da configurare: indirizzo e token");
  if (d.listening === false) return t("Ascolto spento");
  if (d.error) return d.error;
  if (!d.connected) return t("Mi collego…");
  if (d.stopped) return t("Fermato dalla chat");
  if ((d.busy ?? 0) > 0) return t("{n} motori stanno rispondendo…", { n: d.busy ?? 0 });
  return t("In ascolto come @{name}", { name: d.name ?? "" });
}

async function setListening(on: boolean, say: (m: string) => void) {
  Sound.play("blip");
  try {
    await Bridge.agentchatListen(on);
  } catch (e) {
    say(String(e).replace(/^Error:\s*/, ""));
  }
}

const nick = (d: AgentchatData, handle: string) => `@${d.names?.[handle] ?? handle}`;

const WORDS = (): Record<string, string> => ({
  queued: t("in coda"),
  thinking: t("sta ragionando…"),
  tools: t("usa strumenti"),
  writing: t("sta scrivendo…"),
});

/** Seconds counted on screen (the card is not rebuilt only to count): element → start, in the server's clock. */
const ticking = new Map<HTMLElement, number>();
let clockOffset = 0;
let tickTimer = 0;
function elapsed(since: number): string {
  const s = Math.max(0, Math.round(Date.now() / 1000 + clockOffset - since));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`;
}
function tick() {
  for (const [el, since] of ticking) {
    if (!el.isConnected) ticking.delete(el);
    else el.textContent = elapsed(since);
  }
  if (!ticking.size) {
    window.clearInterval(tickTimer);
    tickTimer = 0;
  }
}
function since(at: number): HTMLElement {
  const el = h("small", { class: "ac-since", text: elapsed(at) });
  ticking.set(el, at);
  if (!tickTimer) tickTimer = window.setInterval(tick, 1000);
  return el;
}

/** Finished turns kept, as in agentchat.rs. */
const LIVE_KEPT = 4;
const liveTurns = new Map<number, LiveTurn>();
let liveOn = false;
let livePicked = 0;
/** The log lives outside the card, like the field: a redraw keeps its selection and scroll. */
let liveLog: HTMLElement | null = null;
let logTurn = 0;
let logText = "";
let logTop = 0;
let logStick = true;

function working(): LiveTurn[] {
  return [...liveTurns.values()].filter((x) => x.state === "working");
}

function onLive(x: LiveTurn) {
  const old = liveTurns.get(x.id);
  liveTurns.set(x.id, x);
  const ended = [...liveTurns.values()].filter((y) => y.state !== "working").sort((a, b) => a.id - b.id);
  ended.slice(0, Math.max(0, ended.length - LIVE_KEPT)).forEach((y) => liveTurns.delete(y.id));
  if (old?.state !== x.state) State.notify();
  else if (acView === "work" && x.id === logTurn) drawLog(x);
}

function startLive() {
  if (liveOn) return;
  liveOn = true;
  void onEvent<LiveTurn>("agentchat-live", onLive);
  void Bridge.agentchatLive<LiveTurn>().then((list) => {
    if (!list?.length) return;
    for (const x of list) liveTurns.set(x.id, x);
    State.notify();
  });
}

function logBox(): HTMLElement {
  if (liveLog) return liveLog;
  const box = h("div", { class: "ac-log md" });
  box.addEventListener("scroll", () => {
    if (!box.isConnected) return;
    logTop = box.scrollTop;
    logStick = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
  });
  liveLog = box;
  return box;
}

function placeLog() {
  const box = logBox();
  requestAnimationFrame(() => { box.scrollTop = logStick ? box.scrollHeight : logTop; });
}

function drawLog(x: LiveTurn) {
  if (x.id === logTurn && x.text === logText && logBox().childElementCount) return;
  if (x.id !== logTurn) logStick = true;
  logTurn = x.id;
  logText = x.text;
  logBox().replaceChildren(...(x.text
    ? renderMarkdown(x.text, { openUrl: (url) => void Bridge.openUrl(url) })
    : [h("div", { class: "int-empty", text: x.state === "working" ? t("Sta ragionando: il primo passo arriva tra poco.") : t("Nessun passo da mostrare.") })]));
  placeLog();
}

function workView(): HTMLElement {
  const list = [...liveTurns.values()].sort((a, b) => b.id - a.id);
  if (!list.length) return h("div", { class: "int-empty", text: t("Nessun motore sta lavorando su questo PC. Quando ne parte uno, qui vedi cosa fa passo per passo.") });
  const open = liveTurns.get(livePicked) ?? list.find((x) => x.state === "working") ?? list[0];
  const words: Record<string, string> = { done: t("finito"), failed: t("non riuscito"), stopped: t("fermato") };
  const chips = list.map((x) => h("button", {
    class: `rec-chip ac-turn t-${x.state}${x.id === open.id ? " on" : ""}`,
    title: x.engine,
    onclick: (e: Event) => { e.stopPropagation(); livePicked = x.id; State.notify(); },
  }, h("i"), h("span", { text: x.who }), x.state === "working" ? since(x.started / 1000 + clockOffset) : h("small", { text: words[x.state] })));
  drawLog(open);
  placeLog();
  return h("div", { class: "ac-work" }, h("div", { class: "ac-turns" }, ...chips),
    h("div", { class: "ac-work-about", title: open.about, text: `${open.message ? `#${open.message} · ` : ""}${open.about}` }), logBox());
}

/** Under a message: who took it, who is waiting to answer it, who had nothing to say. */
function statusLine(m: ChatMsg, d: AgentchatData): HTMLElement | null {
  const a = d.activity ?? {};
  const id = String(m.id);
  const parts: HTMLElement[] = [];
  const took = a.claims?.[id] ?? m.claimed_by;
  if (took) parts.push(h("span", { class: "took", text: t("preso da {who}", { who: nick(d, took) }) }));
  for (const x of (a.active ?? []).filter((x) => x.message === m.id && x.state === "queued")) {
    parts.push(h("span", { text: t("in coda per {who}", { who: nick(d, x.by) }) }));
  }
  for (const [who, state] of Object.entries(a.outcomes?.[id] ?? {})) {
    parts.push(h("span", { class: state === "failed" ? "fail" : "none",
      text: state === "failed" ? t("{who}: non è riuscito a rispondere", { who: nick(d, who) }) : t("{who}: nessuna risposta", { who: nick(d, who) }) }));
  }
  return parts.length ? h("div", { class: "ac-status" }, ...parts) : null;
}

function messageRow(m: ChatMsg, d: AgentchatData): HTMLElement {
  const me = d.name ?? "";
  const mine = !!me && (m.sender === me || m.sender.startsWith(`${me}/`));
  const owner = !!m.human || (!!d.owner && m.sender === d.owner);
  const kind = m.kind === "consult" ? t("consulta") : m.kind === "synthesis" ? t("sintesi") : "";
  const text = m.text.length > 1200 ? `${m.text.slice(0, 1200)}…` : m.text;
  const reply = d.canWrite ? h("button", { class: "ac-reply", title: t("Rispondi a questo messaggio"), text: "↩",
    onclick: (e: Event) => { e.stopPropagation(); replyTo = m; drawComposer(d); focusField(); } }) : null;
  return h("div", { class: `ac-msg${mine ? " mine" : ""}${owner ? " owner" : ""}${m.thread ? " reply" : ""}` },
    h("div", { class: "ac-meta" },
      h("b", { text: d.names?.[m.sender] ?? m.sender, title: m.sender }),
      m.verified ? null : h("span", { class: "ac-unv", text: "?", title: t("Mittente non verificato") }),
      kind ? h("span", { class: "ac-kind", text: kind }) : null,
      m.thread ? h("span", { class: "ac-kind", text: `↳ #${m.thread}` }) : null,
      h("span", { class: "int-ago", text: `${m.room} · ${timeAgo(m.ts * 1000)}` }),
      reply),
    h("div", { class: "ac-text", text }),
    ...(m.files ?? []).map((f) => h("div", { class: "ac-file", title: `SHA-256 ${f.sha256}` }, clipMark(),
      `${f.name} · ${kb(f.size)} · ${f.imported_by ? t("importato da {who}", { who: f.imported_by }) : t("da importare")}`)),
    statusLine(m, d));
}

/** Over the field: who is working now, and «nessun agente attivo» when a message of the owner went unanswered. */
function activityBar(d: AgentchatData, list: ChatMsg[]): HTMLElement | null {
  const a = d.activity ?? {};
  if (a.now) clockOffset = a.now - Date.now() / 1000;
  const items: HTMLElement[] = (a.active ?? []).map((x) => h("span", { class: `ac-busy ${x.state}`, title: `#${x.message}` },
    h("i"), h("b", { text: nick(d, x.by) }), h("span", { text: WORDS()[x.state] ?? x.state }),
    x.detail ? h("small", { text: x.detail }) : null, since(x.since)));
  const last = [...list].reverse().find((m) => m.human || (!!d.owner && m.sender === d.owner));
  if (last && d.activity) {
    const age = Date.now() / 1000 + clockOffset - last.ts;
    const answered = list.some((m) => m.id > last.id && !m.human && m.sender !== d.owner);
    const id = String(last.id);
    const someone = !!a.claims?.[id] || (a.active ?? []).some((x) => x.message === last.id) || !!a.outcomes?.[id];
    const anyOn = Object.values(a.online ?? {}).some(Boolean);
    if (age > 8 && age < 600 && !answered && !someone && !anyOn) {
      items.push(h("span", { class: "ac-alone", text: t("nessun agente attivo: nessuno ha preso il messaggio") }));
    }
  }
  return items.length ? h("div", { class: "ac-activity" }, ...items) : null;
}

function compact(n: number): string {
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

function kb(n: number): string {
  return n < 1024 ? `${n} B` : n < 1_048_576 ? `${Math.round(n / 1024)} KB` : `${(n / 1_048_576).toFixed(1)} MB`;
}

// ── The field: writing as the owner ──────────────────────────────────────────

let replyTo: ChatMsg | null = null;
let files: { name: string; path: string }[] = [];
let room = "";
let sending = false;
let composer: HTMLElement | null = null;
let field: HTMLTextAreaElement | null = null;
let extras: HTMLElement | null = null;
let roomPick: HTMLSelectElement | null = null;
let sendBtn: HTMLButtonElement | null = null;
let errorLine: HTMLElement | null = null;

function focusField() {
  requestAnimationFrame(() => field?.focus());
}

/** «@li» typed just before the cursor: what to complete, or null. */
function typedAt(): string | null {
  if (!field) return null;
  const before = field.value.slice(0, field.selectionStart ?? field.value.length);
  const m = before.match(/(^|\s)@([\w.\-/]*)$/);
  return m ? m[2].toLowerCase() : null;
}

/** Who can be called: the names chosen in the chat, the engines, everyone. */
function callable(d: AgentchatData): { name: string; handle: string }[] {
  const out = new Map<string, string>();
  for (const [handle, alias] of Object.entries(d.names ?? {})) out.set(alias, handle);
  for (const e of d.engines ?? []) if (!out.has(e.name)) out.set(e.name, e.handle ?? e.name);
  out.set("tutti", t("tutti gli agenti"));
  return [...out].map(([name, handle]) => ({ name, handle }));
}

function insertName(name: string) {
  if (!field) return;
  const pos = field.selectionStart ?? field.value.length;
  const q = typedAt();
  const v = field.value;
  if (q !== null) {
    const start = pos - q.length - 1;
    field.value = `${v.slice(0, start)}@${name} ${v.slice(pos)}`;
    field.selectionStart = field.selectionEnd = start + name.length + 2;
  } else {
    const pre = v.slice(0, pos);
    const sp = pre && !/\s$/.test(pre) ? " " : "";
    field.value = `${pre}${sp}@${name} ${v.slice(pos)}`;
    field.selectionStart = field.selectionEnd = pos + sp.length + name.length + 2;
  }
  field.focus();
  drawComposer(agentchatData());
}

async function send() {
  const d = agentchatData();
  if (!field || sending) return;
  const text = field.value.trim();
  if (!text && !files.length) return;
  sending = true;
  drawComposer(d);
  try {
    await Bridge.agentchatOwnerSend(room, text, replyTo?.id ?? null, files.map((f) => f.path));
    Sound.play("send");
    field.value = "";
    files = [];
    replyTo = null;
    if (errorLine) errorLine.textContent = "";
  } catch (e) {
    Sound.play("error");
    if (errorLine) errorLine.textContent = String(e).replace(/^Error:\s*/, "");
  } finally {
    sending = false;
    drawComposer(agentchatData());
    focusField();
  }
}

function buildComposer(): HTMLElement {
  field = h("textarea", { class: "ac-field", rows: "1", spellcheck: "false" }) as HTMLTextAreaElement;
  extras = h("div", { class: "ac-extras" });
  roomPick = h("select", { class: "ac-room", title: t("Stanza") }) as HTMLSelectElement;
  roomPick.addEventListener("change", () => { room = roomPick!.value; });
  sendBtn = h("button", { class: "send-btn", title: t("Invia come te (Invio)"), text: "↑" }) as HTMLButtonElement;
  const clip = h("button", { class: "mic-btn", title: t("Allega file") }, clipMark(15)) as HTMLButtonElement;
  errorLine = h("div", { class: "ac-error" });
  const grow = () => {
    if (!field) return;
    field.style.height = "auto";
    field.style.height = `${Math.min(field.scrollHeight, 120)}px`;
  };
  field.addEventListener("input", () => { grow(); drawComposer(agentchatData()); });
  field.addEventListener("click", () => drawComposer(agentchatData()));
  field.addEventListener("keydown", (e) => {
    e.stopPropagation(); // Escape and the island's keys stay here
    const q = typedAt();
    if (e.key === "Tab" && q !== null) {
      const first = callable(agentchatData()).find((x) => x.name.startsWith(q) || x.handle.startsWith(q));
      if (first) {
        e.preventDefault();
        insertName(first.name);
      }
      return;
    }
    if (e.key === "Escape" && replyTo) {
      replyTo = null;
      drawComposer(agentchatData());
      return;
    }
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      void send();
    }
  });
  field.addEventListener("paste", (e) => e.stopPropagation());
  sendBtn.addEventListener("click", () => void send());
  clip.addEventListener("click", async () => {
    try {
      const picked = await Bridge.chatPick(false);
      files = [...files, ...picked.filter((p) => !p.folder).map((p) => ({ name: p.name, path: p.path }))].slice(0, 10);
      drawComposer(agentchatData());
      focusField();
    } catch (e) {
      if (errorLine) errorLine.textContent = String(e).replace(/^Error:\s*/, "");
    }
  });
  return h("div", { class: "ac-compose" }, extras, h("div", { class: "ac-bar" }, roomPick, field, clip, sendBtn), errorLine);
}

/** The field's surroundings: the reply, the files, the names to call, the rooms. */
function drawComposer(d: AgentchatData) {
  if (!composer || !field || !extras || !roomPick || !sendBtn) return;
  const me = d.ownerName || d.owner || "";
  field.placeholder = me ? t("Scrivi come @{name}… (@ per chiamare un agente)", { name: me }) : t("Scrivi… (@ per chiamare un agente)");
  const rooms = (d.rooms ?? ["general"]).filter((r) => r && r !== "*");
  const list = rooms.length ? rooms : ["general"];
  if (!list.includes(room)) room = list[0];
  if (roomPick.options.length !== list.length || Array.from(roomPick.options).some((o, i) => o.value !== list[i])) {
    roomPick.replaceChildren(...list.map((r) => h("option", { value: r, text: `#${r}` })));
  }
  roomPick.value = room;
  roomPick.style.display = list.length > 1 ? "" : "none";
  sendBtn.disabled = sending || (!field.value.trim() && !files.length);
  const rows: HTMLElement[] = [];
  if (replyTo) {
    const r = replyTo;
    rows.push(h("div", { class: "ac-chip" },
      h("span", { text: t("Rispondi a {who}: {text}", { who: d.names?.[r.sender] ?? r.sender, text: r.text.slice(0, 80) }) }),
      h("button", { text: "✕", title: t("Non rispondere a questo"), onclick: () => { replyTo = null; drawComposer(agentchatData()); focusField(); } })));
  }
  for (const f of files) {
    rows.push(h("div", { class: "ac-chip" }, h("span", { title: f.path }, clipMark(), f.name),
      h("button", { text: "✕", title: t("Togli"), onclick: () => { files = files.filter((x) => x !== f); drawComposer(agentchatData()); focusField(); } })));
  }
  const q = typedAt();
  if (q !== null) {
    const names = callable(d).filter((x) => x.name.startsWith(q) || x.handle.startsWith(q)).slice(0, 8);
    if (names.length) {
      rows.push(h("div", { class: "ac-names" }, ...names.map((x) => h("button", { class: "ac-name", title: x.handle,
        onmousedown: (e: Event) => e.preventDefault(), onclick: () => insertName(x.name) }, h("b", { text: `@${x.name}` }), h("small", { text: x.handle })))));
    }
  }
  extras.replaceChildren(...rows);
}

/** The field, moved into the new card with its text, cursor and focus. */
function placeComposer(host: HTMLElement, d: AgentchatData) {
  if (!composer) composer = buildComposer();
  const focused = !!field && field.ownerDocument.activeElement === field;
  const sel = field ? [field.selectionStart, field.selectionEnd] as const : null;
  host.append(composer);
  drawComposer(d);
  // The new card goes on the page right after it is built (views.ts): focus then.
  if (focused) {
    queueMicrotask(() => {
      if (!field?.isConnected) return;
      field.focus();
      if (sel) field.setSelectionRange(sel[0] ?? 0, sel[1] ?? 0);
    });
  }
}

export function agentchatCard(openSettings: () => void): HTMLElement {
  startLive();
  const d = agentchatData();
  const note = h("div", { class: "notion-note bad", style: "display:none" });
  const say = (m: string) => { note.textContent = m; note.style.display = m ? "" : "none"; };
  const listening = d.listening !== false;
  const head = h("div", { class: "int-head" }, brandOrDot(AGENTCHAT, COLOR, 7), h("b", { text: "Agent Chat" }),
    h("span", { text: agentchatLine() }),
    h("button", { class: "link-btn", style: "color:#8e939c", text: t("Impostazioni…"), onclick: openSettings }));
  const body = h("div", { class: "ac-body" });
  if (!d.configured) {
    body.append(h("div", { class: "hint rec-hint", text: t("Collega EasyIsland alla tua Agent Chat: serve il server (si installa con Docker) e un token creato nella sua pagina «Agenti». Indirizzo e token in Impostazioni → Integrazioni → Agent Chat.") }));
    return h("div", { class: "int-card notion-card" }, head, body);
  }
  const actions = h("div", { class: "rec-actions" },
    h("button", {
      class: listening ? "rec-chip ac-listen on" : "rec-chip ac-listen",
      text: listening ? t("● In ascolto") : t("○ Ascolto spento"),
      title: listening ? t("Spegni l'ascolto: EasyIsland non legge né risponde in Agent Chat") : t("Riaccendi l'ascolto"),
      onclick: (e: Event) => { e.stopPropagation(); void setListening(!listening, say); },
    }),
    d.stopped ? h("button", { class: "teams-btn plain", text: t("Riprendi"),
      onclick: (e: Event) => { e.stopPropagation(); void Bridge.agentchatResume().then(() => Bridge.refreshIntegration(AGENTCHAT)); } }) : null,
    d.url ? h("button", { class: "teams-btn plain", text: t("Apri la chat"),
      onclick: (e: Event) => { e.stopPropagation(); void Bridge.openUrl(d.url!); } }) : null);
  body.append(actions);
  const engines = d.engines ?? [];
  if (engines.length) {
    body.append(h("div", { class: "ac-engines" }, ...engines.map((e) =>
      h("span", { class: e.lead ? "ac-engine lead" : "ac-engine",
        title: `${e.handle ?? e.name} · ${e.engine} · ${t("oggi {n} turni, ≈{k} token", { n: e.today ?? 0, k: compact(e.tokens ?? 0) })}`,
        text: `@${e.name}${e.lead ? " ★" : ""}${e.today ? ` · ${e.today}` : ""}` }))));
  }
  // «Chat» and «Argomenti» (the map of the whole chat, agentchat_map.rs).
  const topics = d.topics ?? [];
  const open = topics.filter((x) => x.state === "da fare" || x.state === "aperto" || x.state === "bloccato").length;
  const tab = (id: "chat" | "topics" | "work", label: string) => h("button", { class: acView === id ? "rec-chip on ac-tab" : "rec-chip ac-tab", text: label,
    onclick: (e: Event) => { e.stopPropagation(); acView = id; if (id === "topics") acTopic = null; State.notify(); } });
  body.append(h("div", { class: "ac-tabs" }, tab("chat", t("Chat")),
    tab("topics", topics.length ? t("Argomenti · {n} aperti", { n: open }) : t("Argomenti")),
    tab("work", working().length ? t("In esecuzione · {n}", { n: working().length }) : t("In esecuzione"))));
  const box = h("div", { class: "ac-list" });
  if (acView === "topics") {
    if (!topics.length) box.append(h("div", { class: "int-empty", text: t("Ancora nessun argomento: si formano dalle richieste in chat.") }));
    for (const tp of topics) box.append(topicRow(tp));
    body.append(box);
  } else if (acView === "work") {
    body.append(workView());
  } else {
    const list = acTopic ? acTopic.msgs : d.messages ?? [];
    if (acTopic) {
      body.append(h("div", { class: "ac-topic-bar" },
        h("button", { class: "link-btn", text: t("‹ Tutta la chat"), onclick: (e: Event) => { e.stopPropagation(); acTopic = null; State.notify(); } }),
        h("span", { class: `ac-tstate ${acTopic.topic.state.replace(" ", "-")}`, text: STATE_LABEL[acTopic.topic.state] }),
        h("b", { text: acTopic.topic.title })));
      // New messages of the topic: read again (only when it grew, or the card would redraw for ever).
      const tp = acTopic.topic;
      const known = acTopic.msgs.length;
      void Bridge.agentchatTopicMessages<ChatMsg>(tp.id).then((msgs) => {
        if (acTopic?.topic.id === tp.id && msgs && msgs.length !== known) { acTopic = { topic: tp, msgs }; State.notify(); }
      });
    }
    if (!list.length) box.append(h("div", { class: "int-empty", text: t("Nessun messaggio nelle stanze seguite.") }));
    for (const m of list) box.append(messageRow(m, d));
    body.append(box);
  }
  const list = d.messages ?? [];
  const bar = activityBar(d, list);
  if (bar) body.append(bar);
  if (d.canWrite) {
    placeComposer(body, d);
  } else {
    body.append(h("div", { class: "hint rec-hint ac-nowrite" },
      h("span", { text: t("Per scrivere da qui come te serve il «Token per scrivere come te»: crealo nella pagina della chat (menu → Scrivere da un'app) e incollalo in Impostazioni → Integrazioni → Agent Chat.") })));
  }
  if (d.last) body.append(h("div", { class: "hint rec-hint", text: d.last }));
  body.append(note);
  // The newest message in view.
  if (acView === "chat") requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
  return h("div", { class: "int-card notion-card ac-card" }, head, body);
}
