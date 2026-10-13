// The 3CX card (src-tauri/src/threecx), laid out like a phone: on the left the
// display, the keypad and the green button, with the device the calls start
// from ("Questo PC" makes EasyIsland itself the phone, src/core/softphone.ts);
// on the right the calls in progress and one list at a time (recent calls,
// missed, team, chats, voicemail, phonebook results); below, the tab bar.
//
// The card is rebuilt whenever the PBX sends news; the phone (Dialer) is one
// element kept across rebuilds, so typing (a number or a chat message) is
// never interrupted by an incoming update.

import { h, svg, clear, dot, brandOrDot } from "./dom";
import { ICONS } from "./icons";
import { State, type AgentTask } from "../core/state";
import {
  Bridge, type ThreecxCall, type ThreecxChat, type ThreecxColleague, type ThreecxContact, type ThreecxHistoryItem,
  type ThreecxMessage, type ThreecxVoicemail,
} from "../core/bridge";
import { locale, t } from "../core/i18n";
import {
  answerOnPc, callFromPc, muted, onPc, pickupOnPc, ringOn, rtcFor, setMuted, setRingOn, tone, type RtcCall,
} from "../core/softphone";

export const THREECX = "integration_3cx";

/** The device setting that makes EasyIsland the phone (threecx::PC_DEVICE). */
const PC = "pc";

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
  /** "Questo PC" is registered as a phone of the extension. */
  pc?: boolean;
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
const BLUE = "#0596D4";

/** The keypad: digit and the letters under it, like a phone. */
const KEYS: [string, string][] = [
  ["1", ""], ["2", "ABC"], ["3", "DEF"],
  ["4", "GHI"], ["5", "JKL"], ["6", "MNO"],
  ["7", "PQRS"], ["8", "TUV"], ["9", "WXYZ"],
  ["*", ""], ["0", "+"], ["#", ""],
];

/**
 * The poller's snapshot, made safe to read: every list a list of objects,
 * every count a number. Whatever a newer centralino or a half-failed poll
 * sends, the card and the strip read it without throwing.
 */
function data(): Snapshot {
  const raw = (State.integrations[THREECX]?.data ?? {}) as Record<string, unknown>;
  const list = <T,>(v: unknown): T[] => (Array.isArray(v) ? v.filter((x) => x !== null && typeof x === "object") as T[] : []);
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  return {
    ...raw,
    calls: list<ThreecxCall>(raw.calls),
    team: list<ThreecxColleague>(raw.team),
    devices: list<{ id: string; name: string }>(raw.devices),
    profiles: list<{ id: string; name: string }>(raw.profiles),
    missed: num(raw.missed),
    unread: num(raw.unread),
    voicemail: num(raw.voicemail),
    unreadByChat: raw.unreadByChat && typeof raw.unreadByChat === "object" ? raw.unreadByChat as Record<string, number> : {},
  } as Snapshot;
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

/** "MR" for Mario Rossi; "" for a number. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter((w) => /\p{L}/u.test(w[0] ?? ""));
  return words.slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

/** The card is on screen (not just built): new messages count as read. */
function onScreen(el: HTMLElement): boolean {
  return el.isConnected && State.mode === "expanded" && State.focusId === THREECX && !document.hidden;
}

/** The device chosen in the card ("" = let EasyIsland pick, "pc" = this PC). */
function device(): string | null {
  return State.settings.integrationConfig?.threecxDevice || null;
}

function fromPc(): boolean {
  return data().mode === "user" && device() === PC;
}

/** The call of "Questo PC" behind a call of the card, when this PC is the phone. */
function pcCall(c: ThreecxCall): RtcCall | null {
  return data().pc ? rtcFor(c) : null;
}

// ── The phone: one element for the life of the island ───────────────────────

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
  /** The tab bar, at the foot of the card. */
  tabs: HTMLElement;
  private input: HTMLInputElement;
  private pad: HTMLElement;
  private go: HTMLElement;
  /** Under the green button: the device the calls start from (drawn by the card). */
  private padFoot: HTMLElement;
  private calls: HTMLElement;
  private list: HTMLElement;
  private note: HTMLElement;
  private panel: Panel = "recent";
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
  /** A call of this PC in progress: the keypad sends tones to it. */
  private tones: RtcCall | null = null;
  private callCount = 0;

  constructor() {
    this.input = h("input", {
      type: "text", class: "tcx-input", placeholder: t("Cerca o componi"),
      title: t("Un nome, un'azienda o un numero; Invio chiama"),
      spellcheck: "false", autocomplete: "off",
    }) as HTMLInputElement;
    keyboard(this.input, (on) => { this.focused = on; });
    this.input.addEventListener("input", () => this.typed());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.enter();
      } else if (e.key === "Escape" && (this.input.value || this.pick)) {
        e.stopPropagation();
        if (this.input.value) this.input.value = "";
        else this.pick = null;
        this.show(this.panel === "team" && !this.pick ? "team" : "recent", true);
      } else if (this.tones && e.key.length === 1 && /[0-9*#]/.test(e.key)) {
        tone(this.tones, e.key);
      }
    });
    const back = h("button", { class: "tcx-back-key", title: t("Cancella"), onclick: () => {
      this.input.value = this.input.value.slice(0, -1);
      this.typed();
    } }, svg(ICONS.backspace, 14, { stroke: 1.8 }));
    const display = h("div", { class: "tcx-display" }, this.input, back);

    this.pad = h("div", { class: "tcx-pad" });
    for (const [digit, letters] of KEYS) {
      this.pad.append(h("button", { class: "tcx-key", title: digit, onclick: () => this.key(digit) },
        h("b", { text: digit }), h("small", { text: letters })));
    }
    this.go = h("button", { class: "tcx-call-btn", title: t("Chiama"), onclick: () => this.enter() }, svg(ICONS.phone, 17));
    this.padFoot = h("div", { class: "tcx-pad-foot" });
    const phone = h("div", { class: "tcx-phone" }, display, this.pad, h("div", { class: "tcx-call-row" }, this.go), this.padFoot);

    this.calls = h("div", { class: "tcx-calls" });
    this.list = h("div", { class: "tcx-list" });
    this.note = h("div", { class: "tcx-note" });
    const side = h("div", { class: "tcx-side" }, this.calls, this.note, this.list);
    this.el = h("div", { class: "tcx-body" }, phone, side);
    this.tabs = h("div", { class: "tcx-tabs" });
    // With an API client there is no call history: the phonebook is the list.
    this.show(data().mode === "api" ? "search" : "recent", true);
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

  /** A key of the keypad: a tone into the call of this PC, or a digit on the display. */
  private key(digit: string) {
    if (this.tones) tone(this.tones, digit);
    this.input.value += digit;
    this.typed();
  }

  /** The display changed: the team filters, anything else searches the phonebook. */
  private typed() {
    if (this.panel === "team") {
      this.renderTeam();
      return;
    }
    if (this.tones) return; // tones for the call: nothing to look up
    if (this.input.value.trim()) this.search();
    else if (this.panel === "search") this.show("recent", true);
  }

  /** Invio or the green button: call, or hand the waiting call to what was typed / the first match. */
  private enter() {
    const typed = dialable(this.input.value);
    if (this.panel === "team") {
      const to = typed ?? this.team()[0]?.number;
      if (!to) return;
      if (this.pick) void this.handOver(to);
      else void this.call(to);
      return;
    }
    const to = typed ?? this.results[0]?.numbers[0];
    if (to) void this.call(to);
    else this.say(t("Scrivi un numero o cerca un nome"));
  }

  async call(number: string) {
    try {
      if (fromPc()) {
        if (!data().pc) throw new Error(t("Questo PC non è ancora pronto come telefono: riprova tra poco"));
        await callFromPc(number);
      } else {
        await Bridge.threecxCall(number, device());
      }
      this.input.value = "";
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
      this.show("recent", true);
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
    if (!force && panel === this.panel && panel !== "chat") return;
    if (panel !== "chat") this.leaveChat();
    if (panel !== "team") this.pick = null;
    this.panel = panel;
    this.input.placeholder = panel === "team" ? (this.pick ? t("Collega o numero a cui passarla") : t("Cerca un collega")) : t("Cerca o componi");
    this.input.title = this.pick ? t("Invio la passa al primo collega dell'elenco o al numero scritto") : t("Un nome, un'azienda o un numero; Invio chiama");
    this.drawTabs();
    if (panel === "search") {
      this.search();
      return;
    }
    if (panel === "team") {
      this.renderTeam();
      return;
    }
    if (panel === "chat") return; // drawn by openChat
    if (!this.tones) this.input.value = "";
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
          this.renderHistory(items ?? []);
          refit();
          if (panel === "missed" && (data().missed ?? 0) > 0) void Bridge.threecxResetMissed();
        })
        .catch(fail);
    }
  }

  // ── Tab bar ───────────────────────────────────────────────────────────────

  drawTabs() {
    const d = data();
    clear(this.tabs);
    // API client: no team, chat, voicemail or history, so no tabs.
    if (d.mode !== "user") return;
    const free = (d.team ?? []).filter((c) => c.presence === "available").length;
    this.tabs.append(
      this.tab("team", ICONS.people, t("Team"), 0, false, BLUE, t("{n} colleghi disponibili", { n: free })),
      this.tab("chats", ICONS.bubble, t("Chat"), d.unread ?? 0),
      this.tab("voicemail", ICONS.voicemail, t("Segreteria"), d.voicemail ?? 0, true),
      this.tab("recent", ICONS.history, t("Recenti"), 0, true),
      this.tab("missed", ICONS.missed, t("Perse"), d.missed ?? 0, true, RED),
    );
  }

  private tab(panel: Panel, icon: string, label: string, count: number, stroke = false, badge = BLUE, title = ""): HTMLElement {
    const on = this.panel === panel || (panel === "chats" && this.panel === "chat");
    return h("button", { class: on ? "tcx-tab on" : "tcx-tab", title: title || label, onclick: () => this.show(panel, panel === "chats") },
      h("span", { class: "tcx-tab-icon" }, svg(icon, 15, stroke ? { stroke: 1.9 } : {}),
        count > 0 ? h("span", { class: "tcx-tab-badge", style: `background:${badge}`, text: count > 99 ? "99+" : String(count) }) : null),
      h("span", { class: "tcx-tab-label", text: label }));
  }

  // ── What the card draws into the phone ────────────────────────────────────

  /** The calls in progress, at the top of the right side. */
  setCalls(rows: HTMLElement[]) {
    clear(this.calls);
    this.calls.append(...rows);
  }

  /** The device line under the green button. */
  setPadFoot(...els: (HTMLElement | null)[]) {
    clear(this.padFoot);
    for (const el of els) if (el) this.padFoot.append(el);
  }

  /** New data from the PBX: lists that show it are drawn again (the scroll stays). */
  update() {
    const d = data();
    const calls = d.calls ?? [];
    // A call of this PC in progress: the keypad plays tones into it, the green button rests.
    const live = calls.map(pcCall).find((r) => r && onPc(r) && r.sdpType !== 4) ?? null;
    if (!!live !== !!this.tones) this.input.value = "";
    this.tones = live;
    this.go.style.visibility = live ? "hidden" : "";
    this.input.placeholder = live ? t("Toni alla chiamata") : this.panel === "team" ? this.input.placeholder : t("Cerca o componi");
    if (this.panel === "team") this.renderTeam();
    else if (this.panel === "chats") this.renderChats();
    else if ((this.panel === "recent" || this.panel === "missed") && calls.length < this.callCount) {
      // A call just ended: it belongs in the list now.
      window.setTimeout(() => { if (this.panel === "recent" || this.panel === "missed") this.show(this.panel, true); }, 1500);
    }
    this.callCount = calls.length;
    if (this.pick && !calls.some((c) => c.id === this.pick?.callId)) {
      // The call ended (or went) while picking.
      this.pick = null;
      if (this.panel === "team") this.show("team", true);
    }
    this.drawTabs();
  }

  private search() {
    this.panel = "search";
    this.drawTabs();
    window.clearTimeout(this.timer);
    const q = this.input.value.trim();
    const seq = ++this.seq;
    this.results = [];
    clear(this.list);
    this.list.append(this.head(t("Rubrica")));
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
          this.results = list ?? [];
          for (const c of this.results.slice(0, 8)) {
            this.list.append(this.row(c.name, c.colleague ? t("interno") : c.company, c.numbers, c.colleague ? "#38BDF8" : "#A78BFA"));
          }
          if (this.results.length === 0 && !number) this.list.append(h("div", { class: "int-empty", text: t("Nessun contatto") }));
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
    return h("div", { class: "int-row tcx-row", title: numbers[0] ? t("Chiama {n}", { n: numbers[0] }) : "", onclick: () => { if (numbers[0]) void this.call(numbers[0]); } },
      dot(color, 5),
      h("span", { class: "int-name", text: name }),
      sub ? h("span", { class: "int-ago", text: sub }) : null,
      nums);
  }

  /** Title of a list. */
  private head(title?: string): HTMLElement {
    const titles: Partial<Record<Panel, string>> = {
      missed: t("Chiamate perse"), recent: t("Chiamate recenti"), team: t("Team"), chats: t("Chat"), voicemail: t("Segreteria"),
    };
    return h("div", { class: "tcx-list-head" }, h("span", { text: title ?? titles[this.panel] ?? "" }));
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
      this.list.append(this.row(label, [kinds[it.kind], when(it.at)].filter(Boolean).join(" · "), it.number ? [it.number] : [], colors[it.kind]));
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
        btn(ICONS.bubble, t("Scrivi"), BLUE, () => void this.chatWith(c)),
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
      if (fromPc() && data().pc) await pickupOnPc(id);
      else await Bridge.threecxPickup(id, device());
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
      this.show("recent", true);
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
        dot(c.external ? "#A78BFA" : c.group ? "#38BDF8" : BLUE, 6),
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
    const send = h("button", { class: "tcx-go", title: t("Invia (Invio)"), style: `--c:${BLUE}`, onclick: () => void this.sendMessage() }, svg(ICONS.send, 12));
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
        btn(ICONS.play, t("Ascolta (squilla il tuo telefono)"), BLUE, () => {
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

/** A round button with its word under it, like a phone's call screen. */
function callButton(icon: string, label: string, color: string, run: () => void, opts: { stroke?: number; on?: boolean } = {}): HTMLElement {
  return h("button", { class: opts.on ? "tcx-cb on" : "tcx-cb", title: label, style: `--c:${color}`, onclick: (e: Event) => { e.stopPropagation(); run(); } },
    h("span", { class: "tcx-cb-ring" }, svg(icon, 13, opts.stroke ? { stroke: opts.stroke } : {})),
    h("span", { class: "tcx-cb-label", text: label }));
}

function callRow(c: ThreecxCall): HTMLElement {
  const ringing = c.state === "ringing";
  const color = ringing ? AMBER : c.state === "connected" ? GREEN : "#38BDF8";
  const label = c.name || c.number || t("Sconosciuto");
  const rtc = pcCall(c);
  const here = onPc(rtc);
  const what = ringing
    ? (c.incoming ? (rtc ? t("Squilla su questo PC") : t("Ti sta chiamando")) : t("Squilla"))
    : c.state === "dialing" ? t("Sto chiamando") : c.state === "connected" ? (here ? t("In linea dal PC") : t("In linea")) : "";
  const time = h("span", { class: "tcx-sub" });
  const tick = () => { time.textContent = `${what}${c.state === "connected" ? ` · ${mmss(Date.now() - c.since)}` : ""}`; };
  tick();
  if (c.state === "connected") {
    const timer = window.setInterval(() => { if (!time.isConnected) { window.clearInterval(timer); return; } tick(); }, 1000);
  }
  const fail = (err: unknown) => dialer?.say(message(err));
  const act = (action: string) => () => void Bridge.threecxAction(c.id, action).catch(fail);
  const login = data().mode === "user";
  const buttons = h("div", { class: "tcx-cbs" });
  if (ringing && c.incoming) {
    if (rtc) buttons.append(callButton(ICONS.phone, t("Rispondi"), GREEN, () => void answerOnPc(rtc).catch(fail)));
    else if (c.canAnswer) buttons.append(callButton(ICONS.phone, t("Rispondi"), GREEN, act("answer")));
    if (login) buttons.append(callButton(ICONS.forward, t("Devia"), BLUE, () => dialer?.startPick("divert", c)));
    buttons.append(callButton(ICONS.hangup, t("Rifiuta"), RED, act("decline")));
  } else {
    if (here && rtc) {
      const off = muted(rtc);
      buttons.append(callButton(off ? ICONS.micOff : ICONS.mic, off ? t("Riattiva") : t("Muto"), off ? RED : "#8e939c", () => setMuted(rtc, !off), { stroke: 1.9, on: off }));
    }
    if (login && c.state === "connected") buttons.append(callButton(ICONS.forward, t("Trasferisci"), BLUE, () => dialer?.startPick("transfer", c)));
    buttons.append(callButton(ICONS.hangup, t("Riaggancia"), RED, act("hangup")));
  }
  const face = initials(c.name);
  return h("div", { class: ringing ? "tcx-call ringing" : "tcx-call", style: `--c:${color}` },
    h("span", { class: "tcx-avatar" }, face ? h("b", { text: face }) : svg(ICONS.phone, 13)),
    h("div", { class: "tcx-who" },
      h("b", { text: label }),
      c.name && c.number ? h("span", { class: "tcx-sub", text: c.number }) : null,
      time),
    buttons);
}

/** The device line under the keypad: where the calls start from, as chips to pick. */
function deviceLine(d: Snapshot): [HTMLElement | null, HTMLElement | null] {
  const devices = d.devices ?? [];
  const choices: { id: string; name: string }[] = d.mode === "user" ? [{ id: PC, name: t("Questo PC") }, ...devices] : devices;
  if (choices.length === 0) return [null, null];
  const current = device() ?? "";
  const nameOf = (id: string) => (id ? choices.find((x) => x.id === id)?.name : "") || t("automatico");
  const ready = (id: string) => (id === PC ? (d.pc ? GREEN : AMBER) : "");
  const list = h("div", { class: "tcx-chips tcx-devices" });
  list.style.display = devicesOpen ? "" : "none";
  if (choices.length === 1 && d.mode !== "user") {
    return [h("span", { class: "tcx-from", text: t("Da {name}", { name: choices[0].name }) }), null];
  }
  const dotEl = h("span", { class: "tcx-ready" });
  const label = h("span", { text: t("Da {name}", { name: nameOf(current) }) });
  const paint = (id: string) => {
    const c = ready(id);
    dotEl.style.display = c ? "" : "none";
    dotEl.style.background = c;
    dotEl.title = id === PC ? (d.pc ? t("Pronto: il PC squilla e chiama") : t("Mi registro come telefono…")) : "";
  };
  paint(current);
  const btn = h("button", { class: "tcx-from tcx-pick", title: t("Dispositivo da cui partono le chiamate"), onclick: () => {
    devicesOpen = !devicesOpen;
    list.style.display = devicesOpen ? "" : "none";
    refit();
  } }, dotEl, label, h("span", { class: "tcx-caret", text: "▾" }));
  // The card is not rebuilt for a setting: update it in place.
  const choose = (id: string) => {
    devicesOpen = false;
    State.settings.integrationConfig = { ...State.settings.integrationConfig, threecxDevice: id };
    void Bridge.saveSettings(State.settings);
    label.textContent = t("Da {name}", { name: nameOf(id) });
    paint(id);
    for (const c of Array.from(list.children) as HTMLElement[]) c.classList.toggle("on", c.dataset.dev === id);
    list.style.display = "none";
    refit();
  };
  const chip = (id: string, name: string) =>
    h("button", { class: current === id ? "clip-chip on" : "clip-chip", "data-dev": id, text: name, onclick: () => choose(id) });
  list.append(chip("", t("Automatico")), ...choices.map((x) => chip(x.id, x.name)));
  return [btn, list];
}

export function threecxCard(task: AgentTask, openSettings: () => void): HTMLElement {
  const d = data();
  const info = State.integrations[THREECX];
  const profiles = d.profiles ?? [];
  const current = profiles.find((p) => p.id === d.profile);

  // Header: who, status (a menu with the profiles), queues, the ringtone and the island's notice.
  const statusBtn = h("button", { class: "tcx-status", title: profiles.length ? t("Cambia stato") : "", onclick: () => {
    if (!profiles.length) return;
    statusOpen = !statusOpen;
    chips.style.display = statusOpen ? "" : "none";
    refit();
  } }, current?.name ?? (d.connected ? (d.number ? t("Interno {n}", { n: d.number }) : t("Collegato")) : t("Non collegato")),
  profiles.length ? h("span", { class: "tcx-caret", text: "▾" }) : null);
  // Queue login: only for an extension that is in a queue.
  const queue = d.queue == null ? null : h("button", {
    class: d.queue ? "tcx-queue on" : "tcx-queue",
    title: d.queue ? t("Sei in coda: clic per uscire") : t("Fuori dalle code: clic per entrare"),
    onclick: () => void Bridge.threecxQueue(!d.queue).catch((e) => dialer?.say(message(e))),
  }, d.queue ? t("In coda") : t("Fuori coda"));
  const head = h("div", { class: "int-head" }, brandOrDot(task.id, task.color, 7), h("b", { text: "3CX" }), statusBtn, queue);
  if (d.connected) {
    const toggles = h("span", { class: "tcx-toggles" });
    if (fromPc()) {
      const on = ringOn();
      toggles.append(h("button", { class: on ? "tcx-toggle" : "tcx-toggle off", title: on ? t("Suoneria del PC attiva: clic per silenziarla") : t("Suoneria del PC silenziata: clic per riattivarla"),
        onclick: () => setRingOn(!on) }, svg(on ? ICONS.speakerOn : ICONS.speakerOff, 13)));
    }
    const alert = State.settings.integrationConfig?.threecxAlert !== false;
    toggles.append(h("button", { class: alert ? "tcx-toggle" : "tcx-toggle off",
      title: alert ? t("Le chiamate in arrivo aprono l'isola con un suono: clic per avere solo il pallino") : t("Chiamate in arrivo: solo il pallino nel menu. Clic per aprire di nuovo l'isola"),
      onclick: () => {
        State.settings.integrationConfig = { ...State.settings.integrationConfig, threecxAlert: !alert };
        void Bridge.saveSettings(State.settings);
        State.notify();
        refit();
      } }, svg(alert ? ICONS.bell : ICONS.bellOff, 13, { stroke: 1.8 })));
    head.append(toggles);
  }

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

  dialer ??= new Dialer();
  dialer.setCalls((d.calls ?? []).map(callRow));
  const [from, devices] = deviceLine(d);
  dialer.setPadFoot(from);
  dialer.update();
  card.append(dialer.el);
  if (devices) card.append(devices);
  card.append(dialer.tabs);
  // After the card is in the page: keyboard back to the phone, the open chat
  // read (the card may just have come on screen), island fitted to the card.
  queueMicrotask(() => { dialer?.attached(); dialer?.markRead(); });
  refit();
  return card;
}

/** True when the extension has a call ringing for the user. */
export function ringing(): boolean {
  return (data().calls ?? []).some((c) => c.incoming && c.state === "ringing");
}

export interface QuickReply {
  label: string;
  tone: "green" | "red" | "plain" | "light";
  run: () => void;
}

/**
 * The call for the strip beside the closed character (src/views/strip.ts): the
 * one ringing for this user, else the one in progress, with the same replies as
 * the card. In front of a client (`hideNames`) no name or number. Null without a call.
 */
export function stripCall(hideNames: boolean): { id: string; ringing: boolean; title: string; sub: string; buttons: QuickReply[] } | null {
  const calls = data().calls ?? [];
  const c = calls.find((x) => x.incoming && x.state === "ringing") ?? calls.find((x) => x.state === "connected");
  if (!c) return null;
  const rtc = pcCall(c);
  const fail = (action: string) => (e: unknown) => void Bridge.log(`3CX ${action} dalla striscia: ${message(e)}`);
  const act = (action: string) => () => void Bridge.threecxAction(c.id, action).catch(fail(action));
  const who = c.name || c.number || t("Sconosciuto");
  if (c.state === "ringing") {
    const buttons: QuickReply[] = [];
    if (rtc) buttons.push({ label: t("Rispondi"), tone: "green", run: () => void answerOnPc(rtc).catch(fail("answer")) });
    else if (c.canAnswer) buttons.push({ label: t("Rispondi"), tone: "green", run: act("answer") });
    buttons.push({ label: t("Rifiuta"), tone: "red", run: act("decline") });
    return {
      id: c.id, ringing: true, buttons,
      title: hideNames ? t("Chiamata in arrivo") : who,
      sub: hideNames ? "3CX" : [c.name ? c.number : "", "3CX"].filter(Boolean).join(" · "),
    };
  }
  const buttons: QuickReply[] = [];
  if (rtc && onPc(rtc)) {
    const off = muted(rtc);
    buttons.push({ label: off ? t("Riattiva") : t("Muto"), tone: off ? "light" : "plain", run: () => { setMuted(rtc, !off); State.notify(); } });
  }
  buttons.push({ label: t("Riaggancia"), tone: "red", run: act("hangup") });
  return {
    id: c.id, ringing: false, buttons,
    title: `${t("In linea")} · ${mmss(Date.now() - c.since)}`,
    sub: hideNames ? "3CX" : who,
  };
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
