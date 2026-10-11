// The 3CX card (src-tauri/src/threecx): status, the calls in progress with
// answer / decline / hang up / transfer / divert, and below them one panel at
// a time: the dialer (phonebook search), the recent and missed calls, the team
// with its presence, the chats, the voicemail.
//
// The card is rebuilt whenever the PBX sends news; the dialer is one element
// kept across rebuilds, so typing (a number or a chat message) is never
// interrupted by an incoming update.

import { h, svg, clear, dot, brandOrDot } from "./dom";
import { ICONS } from "./icons";
import { State, type AgentTask } from "../core/state";
import {
  Bridge, type ThreecxCall, type ThreecxChat, type ThreecxColleague, type ThreecxContact, type ThreecxHistoryItem,
  type ThreecxMessage, type ThreecxVoicemail,
} from "../core/bridge";
import { locale, t } from "../core/i18n";

export const THREECX = "integration_3cx";

interface Snapshot {
  mode?: "user" | "api";
  connected?: boolean;
  number?: string;
  name?: string;
  profile?: string;
  profiles?: { id: string; name: string }[];
  devices?: { id: string; name: string }[];
  calls?: ThreecxCall[];
  missed?: number;
  team?: ThreecxColleague[];
  unread?: number;
  unreadByChat?: Record<string, number>;
  voicemail?: number;
  /** Logged in to the queues; null when the extension is in no queue. */
  queue?: boolean | null;
}

/** Presence colours and their order in the team list (free first). */
const PRESENCE: Record<ThreecxColleague["presence"], { color: string; order: number }> = {
  available: { color: "#22C55E", order: 0 },
  ringing: { color: "#F5A524", order: 1 },
  busy: { color: "#F4505E", order: 2 },
  away: { color: "#EAB308", order: 3 },
  dnd: { color: "#A855F7", order: 4 },
  offline: { color: "#5b5f67", order: 5 },
};

function presenceText(c: ThreecxColleague): string {
  if (c.presence === "ringing") return t("Sta squillando");
  if (c.presence === "busy") return t("Al telefono");
  if (c.presence === "offline") return t("Non collegato");
  return c.status;
}

const GREEN = "#22C55E";
const RED = "#F4505E";
const AMBER = "#F5A524";

function data(): Snapshot {
  return (State.integrations[THREECX]?.data ?? {}) as Snapshot;
}

function message(e: unknown): string {
  return String(e).replace(/^Error:\s*/, "");
}

/** What a phone can dial: digits, a leading +, * and #; separators are ignored. */
export function dialable(raw: string): string | null {
  const s = raw.replace(/[\s.\-/()]/g, "");
  return /^\+?[0-9*#]{1,32}$/.test(s) ? s : null;
}

function mmss(ms: number): string {
  const t = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(t / 60);
  return `${m}:${String(t % 60).padStart(2, "0")}`;
}

/** "14:05" today, "3 ott" before. */
function when(ms: number): string {
  if (!ms) return "";
  const d = new Date(ms);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString(locale(), { day: "numeric", month: "short" });
}

/** The card is on screen (not just built): new messages count as read. */
function onScreen(el: HTMLElement): boolean {
  return el.isConnected && State.mode === "expanded" && State.focusId === THREECX && !document.hidden;
}

/** The device chosen in the card ("" = let EasyIsland pick). */
function device(): string | null {
  return State.settings.integrationConfig?.threecxDevice || null;
}

// ── The dialer: one element for the life of the island ──────────────────────

type Panel = "search" | "recent" | "missed" | "team" | "chats" | "chat" | "voicemail";

/** A call waiting for a destination: the next colleague or number picked takes it. */
interface Pick {
  kind: "transfer" | "divert";
  callId: string;
}

interface OpenChat {
  id: number;
  name: string;
  number: string;
  messages: ThreecxMessage[];
}

class Dialer {
  el: HTMLElement;
  private input: HTMLInputElement;
  private dial: HTMLElement;
  private list: HTMLElement;
  private note: HTMLElement;
  private panel: Panel = "search";
  private timer = 0;
  private seq = 0;
  private focused = false;
  private results: ThreecxContact[] = [];
  private pick: Pick | null = null;
  private chats: ThreecxChat[] = [];
  private chat: OpenChat | null = null;
  /** The open chat's parts, kept so a new message is added without a rebuild. */
  private thread: HTMLElement | null = null;
  private typingNote: HTMLElement | null = null;
  private composer: HTMLTextAreaElement | null = null;
  private composerFocused = false;
  private typingSent = 0;
  private typingTimer = 0;

  constructor() {
    this.input = h("input", {
      type: "text", class: "tcx-input", placeholder: t("Cerca o componi"),
      title: t("Un nome, un'azienda o un numero; Invio chiama"),
      spellcheck: "false", autocomplete: "off",
    }) as HTMLInputElement;
    keyboard(this.input, (on) => { this.focused = on; });
    this.input.addEventListener("input", () => (this.panel === "team" ? this.renderTeam() : this.search()));
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.enter();
      } else if (e.key === "Escape" && (this.input.value || this.pick)) {
        e.stopPropagation();
        if (this.input.value) this.input.value = "";
        else this.pick = null;
        this.show(this.panel === "team" && !this.pick ? "team" : "search", true);
      }
    });
    const go = h("button", { class: "tcx-go", title: t("Chiama"), style: `--c:${GREEN}`, onclick: () => this.enter() }, svg(ICONS.phone, 13));
    this.list = h("div", { class: "tcx-list" });
    this.note = h("div", { class: "tcx-note" });
    this.dial = h("div", { class: "tcx-dial" }, this.input, go);
    this.el = h("div", { class: "tcx-dialer" }, this.dial, this.note, this.list);
  }

  /** Back in a freshly built card: give the keyboard back if it was here. */
  attached() {
    const target = this.composerFocused ? this.composer : this.focused ? this.input : null;
    if (target && document.activeElement !== target) {
      const pos = target.selectionStart;
      target.focus();
      if (pos != null) target.setSelectionRange(pos, pos);
    }
  }

  say(text: string, bad = true) {
    this.note.textContent = text;
    this.note.style.color = bad ? RED : "";
    const shown = text;
    window.setTimeout(() => { if (this.note.textContent === shown) this.note.textContent = ""; }, 4000);
  }

  /** Invio or the green button: call, or hand the waiting call to what was typed / the first match. */
  private enter() {
    const typed = dialable(this.input.value);
    if (this.panel === "team") {
      const first = this.team()[0];
      if (this.pick) {
        const to = typed ?? first?.number;
        if (to) void this.handOver(to);
        return;
      }
      const to = typed ?? first?.number;
      if (to) void this.call(to);
      return;
    }
    const to = typed ?? this.results[0]?.numbers[0];
    if (to) void this.call(to);
    else this.say(t("Scrivi un numero o cerca un nome"));
  }

  async call(number: string) {
    try {
      await Bridge.threecxCall(number, device());
      this.say(t("Chiamo {n}…", { n: number }), false);
    } catch (e) {
      this.say(message(e));
    }
  }

  /** The waiting call (transfer / divert) goes to `number`. */
  private async handOver(number: string) {
    const pick = this.pick;
    if (!pick) return;
    try {
      if (pick.kind === "transfer") await Bridge.threecxTransfer(pick.callId, number);
      else await Bridge.threecxDivert(pick.callId, number);
      this.pick = null;
      this.input.value = "";
      this.say(pick.kind === "transfer" ? t("Trasferita a {n}", { n: number }) : t("Deviata a {n}", { n: number }), false);
      this.show("search", true);
    } catch (e) {
      this.say(message(e));
    }
  }

  /** Transfer or divert `call`: the team opens to pick where it goes. */
  startPick(kind: Pick["kind"], call: ThreecxCall) {
    this.pick = { kind, callId: call.id };
    this.show("team", true);
    this.input.focus();
  }

  show(panel: Panel, force = false) {
    // The same link again closes the list.
    if (!force && panel !== "search" && panel === this.panel && panel !== "chat") panel = "search";
    if (panel !== "chat") this.leaveChat();
    if (panel !== "team") this.pick = null;
    this.panel = panel;
    this.dial.style.display = panel === "chat" ? "none" : "";
    this.input.placeholder = panel === "team" ? (this.pick ? t("Collega o numero a cui passarla") : t("Cerca un collega")) : t("Cerca o componi");
    this.input.title = this.pick ? t("Invio la passa al primo collega dell'elenco o al numero scritto") : t("Un nome, un'azienda o un numero; Invio chiama");
    if (panel === "search") {
      this.search();
      return;
    }
    if (panel === "team") {
      this.renderTeam();
      return;
    }
    if (panel === "chat") return; // drawn by openChat
    this.input.value = "";
    clear(this.list);
    this.list.append(this.head(), h("div", { class: "int-empty", text: t("Carico…") }));
    refit();
    const seq = ++this.seq;
    const fail = (e: unknown) => {
      if (seq !== this.seq) return;
      clear(this.list);
      this.list.append(this.head());
      this.say(message(e));
      refit();
    };
    if (panel === "chats") {
      Bridge.threecxChats().then((list) => { if (seq === this.seq) { this.chats = list; this.renderChats(); } }).catch(fail);
    } else if (panel === "voicemail") {
      Bridge.threecxVoicemails().then((list) => { if (seq === this.seq) this.renderVoicemail(list); }).catch(fail);
    } else {
      Bridge.threecxHistory(panel === "missed")
        .then((items) => {
          if (seq !== this.seq) return;
          this.renderHistory(items);
          refit();
          if (panel === "missed" && (data().missed ?? 0) > 0) void Bridge.threecxResetMissed();
        })
        .catch(fail);
    }
  }

  /** New data from the PBX: lists that show it are drawn again (the scroll stays). */
  update() {
    if (this.panel === "team") this.renderTeam();
    else if (this.panel === "chats") this.renderChats();
    if (this.pick && !(data().calls ?? []).some((c) => c.id === this.pick?.callId)) {
      // The call ended (or went) while picking.
      this.pick = null;
      if (this.panel === "team") this.show("team", true);
    }
  }

  private search() {
    this.panel = "search";
    window.clearTimeout(this.timer);
    const q = this.input.value.trim();
    const seq = ++this.seq;
    this.results = [];
    clear(this.list);
    const number = dialable(q);
    if (number) {
      this.list.append(this.row(t("Chiama {n}", { n: number }), "", [number], GREEN));
    }
    refit();
    if (q.length < 2 || (number && /^\+?\d+$/.test(number) && number.length > 6)) return;
    this.timer = window.setTimeout(() => {
      Bridge.threecxContacts(q)
        .then((list) => {
          if (seq !== this.seq) return;
          this.results = list;
          for (const c of list.slice(0, 8)) {
            this.list.append(this.row(c.name, c.colleague ? t("interno") : c.company, c.numbers, c.colleague ? "#38BDF8" : "#A78BFA"));
          }
          if (list.length === 0 && !number) this.list.append(h("div", { class: "int-empty", text: t("Nessun contatto") }));
          refit();
        })
        .catch((e) => { if (seq === this.seq) this.say(message(e)); });
    }, 250);
  }

  private row(name: string, sub: string, numbers: string[], color: string): HTMLElement {
    const nums = h("span", { class: "tcx-nums" });
    for (const n of numbers.slice(0, 3)) {
      nums.append(h("button", { class: "tcx-num", title: t("Chiama {n}", { n }), onclick: (e: Event) => { e.stopPropagation(); void this.call(n); } },
        svg(ICONS.phone, 9), h("span", { text: n })));
    }
    return h("div", { class: "int-row tcx-row", title: t("Chiama {n}", { n: numbers[0] }), onclick: () => void this.call(numbers[0]) },
      dot(color, 5),
      h("span", { class: "int-name", text: name }),
      sub ? h("span", { class: "int-ago", text: sub }) : null,
      nums);
  }

  /** Title of a list, with ✕ back to the search. */
  private head(title?: string): HTMLElement {
    const titles: Partial<Record<Panel, string>> = {
      missed: t("Chiamate perse"), recent: t("Chiamate recenti"), team: t("Team"), chats: t("Chat"), voicemail: t("Segreteria"),
    };
    return h("div", { class: "tcx-list-head" },
      h("span", { text: title ?? titles[this.panel] ?? "" }),
      h("button", { class: "tcx-list-close", title: t("Chiudi l'elenco"), onclick: () => { this.input.value = ""; this.show("search", true); } }, svg(ICONS.xmark, 9)));
  }

  private renderHistory(items: ThreecxHistoryItem[]) {
    clear(this.list);
    this.list.append(this.head());
    if (items.length === 0) {
      this.list.append(h("div", { class: "int-empty", text: this.panel === "missed" ? t("Nessuna chiamata persa") : t("Nessuna chiamata") }));
      return;
    }
    const colors = { missed: RED, received: GREEN, outgoing: "#38BDF8", other: "#8e939c" } as const;
    const kinds = { missed: t("persa"), received: t("ricevuta"), outgoing: t("fatta"), other: "" } as const;
    for (const it of items.slice(0, 15)) {
      const label = it.name || it.number || t("Sconosciuto");
      const r = this.row(label, [kinds[it.kind], when(it.at)].filter(Boolean).join(" · "), it.number ? [it.number] : [], colors[it.kind]);
      if (!it.number) r.onclick = null;
      this.list.append(r);
    }
  }

  // ── Team ──────────────────────────────────────────────────────────────────

  /** The colleagues matching what is typed: free ones first, then by name. */
  private team(): ThreecxColleague[] {
    const q = this.input.value.trim().toLowerCase();
    return (data().team ?? [])
      .filter((c) => !q || c.name.toLowerCase().includes(q) || c.number.startsWith(q))
      .sort((a, b) => PRESENCE[a.presence].order - PRESENCE[b.presence].order || a.name.localeCompare(b.name));
  }

  private renderTeam() {
    this.panel = "team";
    const scroll = this.list.scrollTop;
    clear(this.list);
    const pick = this.pick;
    this.list.append(this.head(pick ? (pick.kind === "transfer" ? t("Trasferisci a…") : t("Devia a…")) : t("Team")));
    if (pick?.kind === "divert") {
      this.list.append(h("div", { class: "int-row tcx-row", onclick: () => void this.divertToVoicemail(pick.callId) },
        dot("#8e939c", 5), svg(ICONS.voicemail, 11, { stroke: 2 }), h("span", { class: "int-name", text: t("In segreteria") })));
    }
    const list = this.team();
    const typed = dialable(this.input.value);
    if (pick && typed && !list.some((c) => c.number === typed)) {
      this.list.append(h("div", { class: "int-row tcx-row", onclick: () => void this.handOver(typed) },
        dot(GREEN, 5), h("span", { class: "int-name", text: typed })));
    }
    if (list.length === 0) {
      this.list.append(h("div", { class: "int-empty", text: (data().team ?? []).length ? t("Nessun collega") : t("Il centralino non ha mandato colleghi") }));
    }
    for (const c of list.slice(0, 60)) this.list.append(this.colleagueRow(c));
    this.list.scrollTop = scroll;
    refit();
  }

  private colleagueRow(c: ThreecxColleague): HTMLElement {
    const color = PRESENCE[c.presence].color;
    const btn = (icon: string, title: string, tint: string, run: () => void, stroke = 0) =>
      h("button", { class: "tcx-mini", title, style: `--c:${tint}`, onclick: (e: Event) => { e.stopPropagation(); run(); } },
        svg(icon, 10, stroke ? { stroke } : {}));
    const acts = h("span", { class: "tcx-acts" });
    if (this.pick) {
      acts.append(btn(ICONS.forward, this.pick.kind === "transfer" ? t("Trasferisci") : t("Devia"), GREEN, () => void this.handOver(c.number)));
    } else {
      if (c.ringingCall) {
        const id = c.ringingCall;
        acts.append(btn(ICONS.phone, t("Rispondi al suo posto"), AMBER, () => void this.pickup(id)));
      }
      acts.append(
        btn(ICONS.bubble, t("Scrivi"), "#0596D4", () => void this.chatWith(c)),
        btn(ICONS.phone, t("Chiama {n}", { n: c.number }), GREEN, () => void this.call(c.number)),
      );
    }
    return h("div", {
      class: "int-row tcx-row tcx-mate",
      title: `${c.name} · ${c.number}${c.mobile ? ` · ${c.mobile}` : ""}`,
      onclick: () => (this.pick ? void this.handOver(c.number) : void this.chatWith(c)),
    },
      dot(color, 7),
      h("span", { class: "int-name", text: c.name }),
      h("span", { class: "tcx-ext", text: c.number }),
      h("span", { class: "int-ago tcx-presence", style: c.presence === "available" ? "" : `color:${color}`, text: presenceText(c) }),
      acts);
  }

  private async pickup(id: string) {
    try {
      await Bridge.threecxPickup(id, device());
      this.say(t("Rispondo…"), false);
    } catch (e) {
      this.say(message(e));
    }
  }

  private async divertToVoicemail(callId: string) {
    try {
      await Bridge.threecxDivert(callId, "");
      this.pick = null;
      this.say(t("In segreteria"), false);
      this.show("search", true);
    } catch (e) {
      this.say(message(e));
    }
  }

  // ── Chat ──────────────────────────────────────────────────────────────────

  private renderChats() {
    this.panel = "chats";
    const scroll = this.list.scrollTop;
    clear(this.list);
    this.list.append(this.head());
    const unread = data().unreadByChat ?? {};
    if (this.chats.length === 0) this.list.append(h("div", { class: "int-empty", text: t("Nessuna chat") }));
    for (const c of this.chats) {
      const n = unread[String(c.id)] ?? 0;
      const preview = `${c.lastMine ? t("Tu: ") : ""}${c.last}`;
      this.list.append(h("div", { class: "int-row tcx-row tcx-chat-row", onclick: () => void this.openChat(c) },
        dot(c.external ? "#A78BFA" : c.group ? "#38BDF8" : "#0596D4", 6),
        h("span", { class: n ? "int-name tcx-unread-name" : "int-name", text: c.name || t("Conversazione") }),
        h("span", { class: "tcx-preview", text: preview }),
        h("span", { class: "int-ago", text: when(c.lastAt) }),
        n ? h("span", { class: "tcx-badge", text: String(n) }) : null));
    }
    this.list.scrollTop = scroll;
    refit();
  }

  /** The chat with a colleague of the team: the PBX gives back the conversation (new or the one there is). */
  private async chatWith(c: ThreecxColleague) {
    try {
      const chat = await Bridge.threecxChatWith([c.number]);
      await this.openChat({ ...chat, name: chat.name || c.name, number: chat.number || c.number });
    } catch (e) {
      this.say(message(e));
    }
  }

  /** Opens a conversation by id (from an announcement). */
  async openChatById(id: number) {
    const known = this.chats.find((c) => c.id === id);
    if (known) return this.openChat(known);
    try {
      this.chats = await Bridge.threecxChats();
    } catch { /* the conversation opens anyway, without a name */ }
    const c = this.chats.find((x) => x.id === id);
    return this.openChat(c ?? { id, name: t("Chat"), external: false, group: false, number: "", last: "", lastAt: 0, lastMine: false, unread: 0 });
  }

  isOpenChat(id: number): boolean {
    return this.panel === "chat" && this.chat?.id === id;
  }

  private async openChat(c: ThreecxChat) {
    this.chat = { id: c.id, name: c.name, number: c.number, messages: [] };
    this.show("chat", true);
    clear(this.list);
    const back = h("button", { class: "tcx-list-close tcx-back", title: t("Torna alle chat"), onclick: () => this.show("chats", true) }, svg(ICONS.chevronLeft, 10, { stroke: 2.4 }));
    const head = h("div", { class: "tcx-list-head tcx-chat-head" }, back, h("span", { class: "tcx-chat-name", text: c.name || t("Chat") }));
    if (c.number) {
      const n = c.number;
      head.append(h("button", { class: "tcx-mini", title: t("Chiama {n}", { n }), style: `--c:${GREEN}`, onclick: () => void this.call(n) }, svg(ICONS.phone, 10)));
    }
    this.thread = h("div", { class: "tcx-thread" }, h("div", { class: "int-empty", text: t("Carico…") }));
    this.typingNote = h("div", { class: "tcx-typing" });
    this.composer = h("textarea", { class: "tcx-compose", rows: "1", placeholder: t("Scrivi un messaggio"), spellcheck: "true" }) as HTMLTextAreaElement;
    const composer = this.composer;
    keyboard(composer, (on) => { this.composerFocused = on; });
    composer.addEventListener("input", () => {
      composer.style.height = "auto";
      composer.style.height = `${Math.min(80, composer.scrollHeight)}px`;
      this.sendTyping();
    });
    composer.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void this.sendMessage();
      } else if (e.key === "Escape") {
        e.stopPropagation();
        this.show("chats", true);
      }
    });
    const send = h("button", { class: "tcx-go", title: t("Invia (Invio)"), style: "--c:#0596D4", onclick: () => void this.sendMessage() }, svg(ICONS.send, 12));
    this.list.append(head, this.thread, this.typingNote, h("div", { class: "tcx-compose-row" }, composer, send));
    refit();
    composer.focus();
    const seq = ++this.seq;
    try {
      const list = await Bridge.threecxMessages(c.id);
      if (seq !== this.seq || this.chat?.id !== c.id) return;
      this.chat.messages = list;
      this.drawThread();
      this.markRead();
    } catch (e) {
      if (seq === this.seq) this.say(message(e));
    }
  }

  private leaveChat() {
    this.chat = null;
    this.thread = null;
    this.typingNote = null;
    this.composer = null;
    this.composerFocused = false;
  }

  private bubble(m: ThreecxMessage, prev: ThreecxMessage | undefined): HTMLElement {
    if (m.system) return h("div", { class: "tcx-sys", text: m.text || t("Avviso del centralino") });
    const showName = !m.mine && (!prev || prev.mine || prev.from !== m.from || m.at - prev.at > 600_000);
    return h("div", { class: m.mine ? "tcx-msg mine" : "tcx-msg" },
      showName ? h("span", { class: "tcx-from-name", text: m.from }) : null,
      m.text ? h("span", { class: "tcx-text", text: m.text }) : null,
      m.file ? h("span", { class: "tcx-file", text: `📎 ${m.file}` }) : null,
      h("span", { class: "tcx-time", text: when(m.at) }));
  }

  private drawThread() {
    if (!this.thread || !this.chat) return;
    clear(this.thread);
    const list = this.chat.messages;
    if (list.length === 0) this.thread.append(h("div", { class: "int-empty", text: t("Nessun messaggio: scrivi tu il primo") }));
    list.forEach((m, i) => this.thread?.append(this.bubble(m, list[i - 1])));
    this.thread.scrollTop = this.thread.scrollHeight;
    refit();
  }

  /** A message pushed by the PBX: shown if its conversation is open. True when it was. */
  onMessage(m: ThreecxMessage): boolean {
    if (this.panel === "chats") {
      // The list shows the last message: read it again.
      window.clearTimeout(this.timer);
      this.timer = window.setTimeout(() => {
        if (this.panel === "chats") Bridge.threecxChats().then((l) => { this.chats = l; if (this.panel === "chats") this.renderChats(); }).catch(() => {});
      }, 400);
    }
    if (!this.chat || m.conversation !== this.chat.id || !this.thread) return false;
    if (this.chat.messages.some((x) => x.id === m.id)) return true;
    const prev = this.chat.messages[this.chat.messages.length - 1];
    if (this.chat.messages.length === 0) clear(this.thread);
    this.chat.messages.push(m);
    const atBottom = this.thread.scrollHeight - this.thread.scrollTop - this.thread.clientHeight < 40;
    this.thread.append(this.bubble(m, prev));
    if (atBottom || m.mine) this.thread.scrollTop = this.thread.scrollHeight;
    if (!m.mine && this.typingNote) this.typingNote.textContent = "";
    if (onScreen(this.el)) this.markRead();
    return onScreen(this.el);
  }

  /** Someone writes in a conversation: a note under the open one. */
  onTyping(conversation: number, name: string) {
    if (!this.chat || conversation !== this.chat.id || !this.typingNote) return;
    const note = this.typingNote;
    note.textContent = name ? t("{name} sta scrivendo…", { name }) : t("Sta scrivendo…");
    window.clearTimeout(this.typingTimer);
    this.typingTimer = window.setTimeout(() => { note.textContent = ""; }, 4000);
  }

  /** The island came back to the open chat: what arrived meanwhile is now read. */
  markRead() {
    if (!this.chat || !onScreen(this.el)) return;
    const ids = this.chat.messages.filter((m) => m.isNew && !m.mine).map((m) => m.id);
    for (const m of this.chat.messages) m.isNew = false;
    if (ids.length || (data().unreadByChat ?? {})[String(this.chat.id)]) void Bridge.threecxRead(this.chat.id, ids);
  }

  private sendTyping() {
    if (!this.chat || Date.now() - this.typingSent < 3000) return;
    this.typingSent = Date.now();
    void Bridge.threecxTyping(this.chat.id);
  }

  private async sendMessage() {
    const box = this.composer;
    const chat = this.chat;
    if (!box || !chat) return;
    const text = box.value.trim();
    if (!text) return;
    box.disabled = true;
    try {
      await Bridge.threecxSend(chat.id, text);
      box.value = "";
      box.style.height = "auto";
      this.typingSent = 0;
    } catch (e) {
      this.say(message(e));
    } finally {
      box.disabled = false;
      if (this.chat === chat) box.focus();
    }
  }

  // ── Voicemail ─────────────────────────────────────────────────────────────

  private renderVoicemail(items: ThreecxVoicemail[]) {
    clear(this.list);
    this.list.append(this.head());
    if (items.length === 0) this.list.append(h("div", { class: "int-empty", text: t("Nessun messaggio in segreteria") }));
    for (const v of items) {
      const label = v.name || v.number || t("Sconosciuto");
      const btn = (icon: string, title: string, tint: string, run: () => void) =>
        h("button", { class: "tcx-mini", title, style: `--c:${tint}`, onclick: (e: Event) => { e.stopPropagation(); run(); } }, svg(icon, 10));
      const acts = h("span", { class: "tcx-acts" },
        btn(ICONS.play, t("Ascolta (squilla il tuo telefono)"), "#0596D4", () => {
          Bridge.threecxPlayVoicemail(v.id).then(() => { this.say(t("Il centralino ti sta chiamando per fartela ascoltare"), false); }).catch((e) => this.say(message(e)));
          row.classList.remove("tcx-new");
        }),
        v.number ? btn(ICONS.phone, t("Richiama {n}", { n: v.number }), GREEN, () => void this.call(v.number)) : null);
      const row = h("div", { class: v.isNew ? "tcx-vm tcx-new" : "tcx-vm" },
        h("div", { class: "int-row tcx-row" },
          dot(v.isNew ? AMBER : "#5b5f67", 6),
          h("span", { class: "int-name", text: label }),
          h("span", { class: "int-ago", text: [when(v.at), v.seconds ? mmss(v.seconds * 1000) : ""].filter(Boolean).join(" · ") }),
          acts),
        v.transcription ? h("div", { class: "tcx-transcript", text: v.transcription }) : null);
      if (v.isNew && v.transcription) {
        // Read on screen counts as heard.
        row.addEventListener("click", () => {
          if (!row.classList.contains("tcx-new")) return;
          row.classList.remove("tcx-new");
          void Bridge.threecxVoicemailHeard(v.id);
        });
      }
      this.list.append(row);
    }
    refit();
  }
}

/** The island never takes the keyboard by itself: ask for it while typing in `el`. */
function keyboard(el: HTMLInputElement | HTMLTextAreaElement, focused: (on: boolean) => void) {
  el.addEventListener("pointerdown", () => void Bridge.focusWindow(true));
  el.addEventListener("focus", () => { focused(true); void Bridge.focusWindow(true); });
  el.addEventListener("blur", () => focused(false));
}

let dialer: Dialer | null = null;

/** The card grew or shrank without new data: let the island fit it again. */
function refit() {
  window.requestAnimationFrame(() => State.notify());
}
let statusOpen = false;
let devicesOpen = false;

// ── The card ──────────────────────────────────────────────────────────────────

function callRow(c: ThreecxCall): HTMLElement {
  const ringing = c.state === "ringing";
  const color = ringing ? AMBER : c.state === "connected" ? GREEN : "#38BDF8";
  const label = c.name || c.number || t("Sconosciuto");
  const what = ringing ? (c.incoming ? t("Ti sta chiamando") : t("Squilla")) : c.state === "dialing" ? t("Sto chiamando") : c.state === "connected" ? t("In linea") : "";
  const time = h("span", { class: "int-ago" });
  const tick = () => { time.textContent = `${what}${c.state === "connected" ? ` · ${mmss(Date.now() - c.since)}` : ""}`; };
  tick();
  if (c.state === "connected") {
    const t = window.setInterval(() => { if (!time.isConnected) { window.clearInterval(t); return; } tick(); }, 1000);
  }
  const act = (icon: string, title: string, color: string, action: string) =>
    h("button", { class: "tcx-act", title, style: `--c:${color}`, onclick: (e: Event) => {
      e.stopPropagation();
      void Bridge.threecxAction(c.id, action).catch((err) => dialer?.say(message(err)));
    } }, svg(icon, 12));
  // Transfer / divert: the team opens and the colleague picked takes the call.
  const handOver = (kind: "transfer" | "divert", title: string) =>
    h("button", { class: "tcx-act", title, style: "--c:#0596D4", onclick: (e: Event) => {
      e.stopPropagation();
      dialer?.startPick(kind, c);
    } }, svg(ICONS.forward, 12));
  const login = data().mode === "user";
  const buttons = h("span", { class: "tcx-acts" });
  if (ringing && c.incoming) {
    if (c.canAnswer) buttons.append(act(ICONS.phone, t("Rispondi"), GREEN, "answer"));
    if (login) buttons.append(handOver("divert", t("Devia a un collega o in segreteria")));
    buttons.append(act(ICONS.hangup, t("Rifiuta"), RED, "decline"));
  } else {
    if (login && c.state === "connected") buttons.append(handOver("transfer", t("Trasferisci")));
    buttons.append(act(ICONS.hangup, t("Riaggancia"), RED, "hangup"));
  }
  return h("div", { class: ringing ? "tcx-call ringing" : "tcx-call", style: `--c:${color}` },
    dot(color, 7),
    h("div", { class: "tcx-who" },
      h("b", { text: label }),
      c.name && c.number ? h("span", { class: "tcx-sub", text: c.number }) : null,
      time),
    buttons);
}

export function threecxCard(task: AgentTask, openSettings: () => void): HTMLElement {
  const d = data();
  const info = State.integrations[THREECX];
  const profiles = d.profiles ?? [];
  const current = profiles.find((p) => p.id === d.profile);

  // Header: who, status (a menu with the login), missed calls.
  const statusBtn = h("button", { class: "tcx-status", title: profiles.length ? t("Cambia stato") : "", onclick: () => {
    if (!profiles.length) return;
    statusOpen = !statusOpen;
    chips.style.display = statusOpen ? "" : "none";
    refit();
  } }, current?.name ?? (d.connected ? (d.number ? t("Interno {n}", { n: d.number }) : t("Collegato")) : t("Non collegato")),
  profiles.length ? h("span", { class: "tcx-caret", text: "▾" }) : null);
  const missed = (d.missed ?? 0) > 0
    ? h("button", { class: "tcx-missed", title: t("Chiamate perse"), onclick: () => dialer?.show("missed") }, `${d.missed} perse`)
    : null;
  // Queue login: only for an extension that is in a queue.
  const queue = d.queue == null ? null : h("button", {
    class: d.queue ? "tcx-queue on" : "tcx-queue",
    title: d.queue ? t("Sei in coda: clic per uscire") : t("Fuori dalle code: clic per entrare"),
    onclick: () => void Bridge.threecxQueue(!d.queue).catch((e) => dialer?.say(message(e))),
  }, d.queue ? t("In coda") : t("Fuori coda"));
  const head = h("div", { class: "int-head" }, brandOrDot(task.id, task.color, 7), h("b", { text: "3CX" }), statusBtn, queue);
  if (missed) head.append(missed);

  const chips = h("div", { class: "tcx-chips" });
  chips.style.display = statusOpen ? "" : "none";
  for (const p of profiles) {
    chips.append(h("button", { class: p.id === d.profile ? "clip-chip on" : "clip-chip", text: p.name, onclick: () => {
      statusOpen = false;
      chips.style.display = "none";
      refit();
      void Bridge.threecxStatus(p.id).catch((e) => dialer?.say(message(e)));
    } }));
  }

  const card = h("div", { class: "int-card tcx-card" }, head, chips);

  if (!d.connected) {
    const configured = info?.loaded || info?.error;
    card.append(
      h("div", { class: "int-status wrap" }, dot(info?.error ? RED : "#5b5f67", 5),
        h("span", { text: info?.error ?? (configured ? t("Collegamento a 3CX…") : t("Collego il centralino…")) })),
      h("div", { class: "int-actions" },
        h("button", { class: "link-btn", style: "color:#8e939c", text: t("Impostazioni…"), onclick: openSettings })),
    );
    return card;
  }

  const calls = d.calls ?? [];
  if (calls.length) {
    const box = h("div", { class: "tcx-calls" });
    for (const c of calls) box.append(callRow(c));
    card.append(box);
  }

  dialer ??= new Dialer();
  card.append(dialer.el);

  dialer.update();

  // Footer: team, chats, voicemail, recent and missed calls, and the device the calls start from.
  const foot = h("div", { class: "int-actions tcx-foot" });
  if (d.mode === "user") {
    const link = (text: string, panel: Parameters<Dialer["show"]>[0], count = 0, title = "") =>
      h("button", { class: "link-btn tcx-link", style: `color:${task.color}d9`, title, onclick: () => dialer?.show(panel) },
        text, count > 0 ? h("span", { class: "tcx-badge", text: String(count) }) : null);
    const free = (d.team ?? []).filter((c) => c.presence === "available").length;
    foot.append(
      link(t("Team"), "team", 0, t("{n} colleghi disponibili", { n: free })),
      link(t("Chat"), "chats", d.unread ?? 0),
      link(t("Segreteria"), "voicemail", d.voicemail ?? 0),
      link(t("Recenti"), "recent"),
      link(t("Perse"), "missed"),
    );
  }
  // The device list is drawn in the card: a native <select> opens its list in a
  // window of its own, which lands behind the always-on-top island.
  const devices = d.devices ?? [];
  const chosen = devices.find((x) => x.id === device());
  const pickList = h("div", { class: "tcx-chips" });
  pickList.style.display = devicesOpen ? "" : "none";
  if (devices.length > 1) {
    const label = h("span", { text: t("Da {name}", { name: chosen?.name ?? t("automatico") }) });
    foot.append(h("button", { class: "tcx-from tcx-pick", title: t("Dispositivo da cui partono le chiamate"), onclick: () => {
      devicesOpen = !devicesOpen;
      pickList.style.display = devicesOpen ? "" : "none";
      refit();
    } }, label, h("span", { class: "tcx-caret", text: "▾" })));
    // The card is not rebuilt for a setting: update it in place.
    const choose = (id: string, name: string) => {
      devicesOpen = false;
      State.settings.integrationConfig = { ...State.settings.integrationConfig, threecxDevice: id };
      void Bridge.saveSettings(State.settings);
      label.textContent = t("Da {name}", { name: id ? name : t("automatico") });
      for (const c of Array.from(pickList.children) as HTMLElement[]) c.classList.toggle("on", c.dataset.dev === id);
      pickList.style.display = "none";
      refit();
    };
    const chip = (id: string, name: string) =>
      h("button", { class: (chosen?.id ?? "") === id ? "clip-chip on" : "clip-chip", "data-dev": id, text: name, onclick: () => choose(id, name) });
    pickList.append(chip("", t("Automatico")), ...devices.map((x) => chip(x.id, x.name)));
  } else if (devices.length === 1) {
    foot.append(h("span", { class: "tcx-from", text: t("Da {name}", { name: devices[0].name }) }));
  }
  card.append(foot, pickList);
  // After the card is in the page: keyboard back to the dialer, the open chat
  // read (the card may just have come on screen), island fitted to the card.
  queueMicrotask(() => { dialer?.attached(); dialer?.markRead(); });
  refit();
  return card;
}

/** True when the extension has a call ringing for the user. */
export function ringing(): boolean {
  return (data().calls ?? []).some((c) => c.incoming && c.state === "ringing");
}

/** A chat message pushed by the PBX. True when it showed in the open, visible conversation. */
export function chatMessage(m: ThreecxMessage): boolean {
  return dialer?.onMessage(m) ?? false;
}

export function chatTyping(conversation: number, name: string) {
  dialer?.onTyping(conversation, name);
}

/** The card opens on this conversation (a new message was announced). */
export function openChat(conversation: number) {
  dialer ??= new Dialer();
  if (!dialer.isOpenChat(conversation)) void dialer.openChatById(conversation);
  else dialer.markRead();
}
