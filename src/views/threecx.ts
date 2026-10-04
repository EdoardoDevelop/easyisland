// The 3CX card (src-tauri/src/threecx): status, the calls in progress with
// answer / decline / hang up, and a dialer that searches the phonebook, shows
// the recent and missed calls and calls from the chosen device.
//
// The card is rebuilt whenever the PBX sends news; the dialer is one element
// kept across rebuilds, so typing is never interrupted by an incoming update.

import { h, svg, clear, dot } from "./dom";
import { ICONS } from "./icons";
import { State, type AgentTask } from "../core/state";
import { Bridge, type ThreecxCall, type ThreecxContact, type ThreecxHistoryItem } from "../core/bridge";

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

/** The device chosen in the card ("" = let EasyIsland pick). */
function device(): string | null {
  return State.settings.integrationConfig?.threecxDevice || null;
}

// ── The dialer: one element for the life of the island ──────────────────────

type Panel = "search" | "recent" | "missed";

class Dialer {
  el: HTMLElement;
  private input: HTMLInputElement;
  private list: HTMLElement;
  private note: HTMLElement;
  private panel: Panel = "search";
  private timer = 0;
  private seq = 0;
  private focused = false;
  private results: ThreecxContact[] = [];

  constructor() {
    this.input = h("input", {
      type: "text", class: "tcx-input", placeholder: "Cerca o componi",
      title: "Un nome, un'azienda o un numero; Invio chiama",
      spellcheck: "false", autocomplete: "off",
    }) as HTMLInputElement;
    // The island never takes the keyboard by itself: ask for it while typing here.
    this.input.addEventListener("pointerdown", () => void Bridge.focusWindow(true));
    this.input.addEventListener("focus", () => { this.focused = true; void Bridge.focusWindow(true); });
    this.input.addEventListener("blur", () => { this.focused = false; });
    this.input.addEventListener("input", () => this.search());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        const typed = dialable(this.input.value);
        const first = this.results[0]?.numbers[0];
        const to = typed ?? first;
        if (to) void this.call(to);
      } else if (e.key === "Escape" && this.input.value) {
        e.stopPropagation();
        this.input.value = "";
        this.search();
      }
    });
    const go = h("button", { class: "tcx-go", title: "Chiama", style: `--c:${GREEN}`, onclick: () => {
      const to = dialable(this.input.value) ?? this.results[0]?.numbers[0];
      if (to) void this.call(to);
      else this.say("Scrivi un numero o cerca un nome");
    } }, svg(ICONS.phone, 13));
    this.list = h("div", { class: "tcx-list" });
    this.note = h("div", { class: "tcx-note" });
    this.el = h("div", { class: "tcx-dialer" }, h("div", { class: "tcx-dial" }, this.input, go), this.note, this.list);
  }

  /** Back in a freshly built card: give the keyboard back if it was here. */
  attached() {
    if (this.focused && document.activeElement !== this.input) {
      const pos = this.input.selectionStart;
      this.input.focus();
      if (pos != null) this.input.setSelectionRange(pos, pos);
    }
  }

  say(text: string, bad = true) {
    this.note.textContent = text;
    this.note.style.color = bad ? RED : "";
    const shown = text;
    window.setTimeout(() => { if (this.note.textContent === shown) this.note.textContent = ""; }, 4000);
  }

  async call(number: string) {
    try {
      await Bridge.threecxCall(number, device());
      this.say(`Chiamo ${number}…`, false);
    } catch (e) {
      this.say(message(e));
    }
  }

  show(panel: Panel) {
    this.panel = panel;
    if (panel === "search") {
      this.search();
      return;
    }
    this.input.value = "";
    clear(this.list);
    this.list.append(h("div", { class: "int-empty", text: "Carico…" }));
    const seq = ++this.seq;
    Bridge.threecxHistory(panel === "missed")
      .then((items) => {
        if (seq !== this.seq) return;
        this.renderHistory(items);
        refit();
        if (panel === "missed" && (data().missed ?? 0) > 0) void Bridge.threecxResetMissed();
      })
      .catch((e) => { if (seq === this.seq) { clear(this.list); this.say(message(e)); } });
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
      this.list.append(this.row(`Chiama ${number}`, "", [number], GREEN));
    }
    refit();
    if (q.length < 2 || (number && /^\+?\d+$/.test(number) && number.length > 6)) return;
    this.timer = window.setTimeout(() => {
      Bridge.threecxContacts(q)
        .then((list) => {
          if (seq !== this.seq) return;
          this.results = list;
          for (const c of list.slice(0, 8)) {
            this.list.append(this.row(c.name, c.colleague ? "interno" : c.company, c.numbers, c.colleague ? "#38BDF8" : "#A78BFA"));
          }
          if (list.length === 0 && !number) this.list.append(h("div", { class: "int-empty", text: "Nessun contatto" }));
          refit();
        })
        .catch((e) => { if (seq === this.seq) this.say(message(e)); });
    }, 250);
  }

  private row(name: string, sub: string, numbers: string[], color: string): HTMLElement {
    const nums = h("span", { class: "tcx-nums" });
    for (const n of numbers.slice(0, 3)) {
      nums.append(h("button", { class: "tcx-num", title: `Chiama ${n}`, onclick: (e: Event) => { e.stopPropagation(); void this.call(n); } },
        svg(ICONS.phone, 9), h("span", { text: n })));
    }
    return h("div", { class: "int-row tcx-row", title: `Chiama ${numbers[0]}`, onclick: () => void this.call(numbers[0]) },
      dot(color, 5),
      h("span", { class: "int-name", text: name }),
      sub ? h("span", { class: "int-ago", text: sub }) : null,
      nums);
  }

  private renderHistory(items: ThreecxHistoryItem[]) {
    clear(this.list);
    if (items.length === 0) {
      this.list.append(h("div", { class: "int-empty", text: this.panel === "missed" ? "Nessuna chiamata persa" : "Nessuna chiamata" }));
      return;
    }
    const colors = { missed: RED, received: GREEN, outgoing: "#38BDF8", other: "#8e939c" } as const;
    const kinds = { missed: "persa", received: "ricevuta", outgoing: "fatta", other: "" } as const;
    for (const it of items.slice(0, 15)) {
      const when = it.at ? new Date(it.at) : null;
      const time = when
        ? when.toDateString() === new Date().toDateString()
          ? when.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
          : when.toLocaleDateString("it-IT", { day: "numeric", month: "short" })
        : "";
      const label = it.name || it.number || "Sconosciuto";
      const r = this.row(label, [kinds[it.kind], time].filter(Boolean).join(" · "), it.number ? [it.number] : [], colors[it.kind]);
      if (!it.number) r.onclick = null;
      this.list.append(r);
    }
  }
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
  const label = c.name || c.number || "Sconosciuto";
  const what = ringing ? (c.incoming ? "Ti sta chiamando" : "Squilla") : c.state === "dialing" ? "Sto chiamando" : c.state === "connected" ? "In linea" : "";
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
  const buttons = h("span", { class: "tcx-acts" });
  if (ringing && c.incoming) {
    if (c.canAnswer) buttons.append(act(ICONS.phone, "Rispondi", GREEN, "answer"));
    buttons.append(act(ICONS.hangup, "Rifiuta", RED, "decline"));
  } else {
    buttons.append(act(ICONS.hangup, "Riaggancia", RED, "hangup"));
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
  const statusBtn = h("button", { class: "tcx-status", title: profiles.length ? "Cambia stato" : "", onclick: () => {
    if (!profiles.length) return;
    statusOpen = !statusOpen;
    chips.style.display = statusOpen ? "" : "none";
    refit();
  } }, current?.name ?? (d.connected ? (d.number ? `Interno ${d.number}` : "Collegato") : "Non collegato"),
  profiles.length ? h("span", { class: "tcx-caret", text: "▾" }) : null);
  const missed = (d.missed ?? 0) > 0
    ? h("button", { class: "tcx-missed", title: "Chiamate perse", onclick: () => dialer?.show("missed") }, `${d.missed} perse`)
    : null;
  const head = h("div", { class: "int-head" }, dot(task.color, 7), h("b", { text: "3CX" }), statusBtn);
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
        h("span", { text: info?.error ?? (configured ? "Collegamento a 3CX…" : "Collego il centralino…") })),
      h("div", { class: "int-actions" },
        h("button", { class: "link-btn", style: "color:#8e939c", text: "Impostazioni…", onclick: openSettings })),
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

  // Footer: recent and missed calls, and the device the calls start from.
  const foot = h("div", { class: "int-actions tcx-foot" });
  if (d.mode === "user") {
    foot.append(
      h("button", { class: "link-btn", style: `color:${task.color}d9`, text: "Recenti", onclick: () => dialer?.show("recent") }),
      h("button", { class: "link-btn", style: `color:${task.color}d9`, text: "Perse", onclick: () => dialer?.show("missed") }),
    );
  }
  // The device list is drawn in the card: a native <select> opens its list in a
  // window of its own, which lands behind the always-on-top island.
  const devices = d.devices ?? [];
  const chosen = devices.find((x) => x.id === device());
  const pickList = h("div", { class: "tcx-chips" });
  pickList.style.display = devicesOpen ? "" : "none";
  if (devices.length > 1) {
    const label = h("span", { text: `Da ${chosen?.name ?? "automatico"}` });
    foot.append(h("button", { class: "tcx-from tcx-pick", title: "Dispositivo da cui partono le chiamate", onclick: () => {
      devicesOpen = !devicesOpen;
      pickList.style.display = devicesOpen ? "" : "none";
      refit();
    } }, label, h("span", { class: "tcx-caret", text: "▾" })));
    // The card is not rebuilt for a setting: update it in place.
    const choose = (id: string, name: string) => {
      devicesOpen = false;
      State.settings.integrationConfig = { ...State.settings.integrationConfig, threecxDevice: id };
      void Bridge.saveSettings(State.settings);
      label.textContent = `Da ${id ? name : "automatico"}`;
      for (const c of Array.from(pickList.children) as HTMLElement[]) c.classList.toggle("on", c.dataset.dev === id);
      pickList.style.display = "none";
      refit();
    };
    const chip = (id: string, name: string) =>
      h("button", { class: (chosen?.id ?? "") === id ? "clip-chip on" : "clip-chip", "data-dev": id, text: name, onclick: () => choose(id, name) });
    pickList.append(chip("", "Automatico"), ...devices.map((x) => chip(x.id, x.name)));
  } else if (devices.length === 1) {
    foot.append(h("span", { class: "tcx-from", text: `Da ${devices[0].name}` }));
  }
  card.append(foot, pickList);
  // After the card is in the page: keyboard back to the dialer, island fitted to the card.
  queueMicrotask(() => dialer?.attached());
  refit();
  return card;
}

/** True when the extension has a call ringing for the user. */
export function ringing(): boolean {
  return (data().calls ?? []).some((c) => c.incoming && c.state === "ringing");
}
