// "Proposte al momento giusto" (src-tauri/src/moments.rs): a finished download,
// a copied error, a development server that started, a card from Claude Code.
// Rust only reports what happened; here it is decided whether the island may
// show it now, by the same rules as any other card, and never over something
// the user is doing: one that comes while the user is busy (a chat, a permission,
// the greeting) waits up to a minute for the island to be free, then is dropped
// (the file is still in Downloads, the error still on the clipboard). A card
// from Claude Code that cannot show answers "hidden", so Claude asks in the
// terminal instead.

import { onEvent, Bridge } from "../core/bridge";
import type { IslandViewName } from "../core/layout";
import { Sound } from "../core/sound";
import { State, type Moment } from "../core/state";

/** What the moments need from the island. */
export interface MomentHost {
  alert(view: IslandViewName): void;
  collapse(): void;
  /** A question from Claude Code keeps the island open until it is answered. */
  holdOpen(on: boolean): void;
}

/** Views a proposal may replace; anything else is the user busy with something. */
const QUIET_VIEWS: ReadonlySet<IslandViewName> = new Set(["overview", "empty", "notify", "moment", "recap", "daily", "finished", "note"]);

const str = (v: unknown, max = 4000): string => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** A `moment` event as it should be, or null: Rust sends it, but nothing here trusts its shape. */
export function readMoment(raw: unknown): Moment | null {
  if (!raw || typeof raw !== "object") return null;
  const m = raw as Record<string, unknown>;
  switch (m.kind) {
    case "download":
    case "tray": {
      const path = str(m.path, 2000);
      if (!path) return null;
      return { kind: m.kind, name: str(m.name, 300) || path.split(/[\\/]/).pop() || "file", path, size: Math.max(0, num(m.size)) };
    }
    case "recording": {
      const path = str(m.path, 2000);
      if (!path) return null;
      return { kind: "recording", name: str(m.name, 300) || path.split(/[\\/]/).pop() || "file", path, size: Math.max(0, num(m.size)), seconds: Math.max(0, num(m.seconds)) };
    }
    case "error": {
      const text = str(m.text, 8000);
      if (!text) return null;
      const h = m.holder as Record<string, unknown> | null | undefined;
      const port = num(m.port);
      return {
        kind: "error", error: str(m.error, 20), summary: str(m.summary, 200) || text.split("\n")[0].slice(0, 160), text,
        port: port > 0 && port < 65536 ? port : null,
        holder: h && typeof h === "object" && str(h.name) ? { name: str(h.name, 100), pid: num(h.pid) } : null,
      };
    }
    case "server": {
      const port = num(m.port);
      if (!(port > 0 && port < 65536)) return null;
      return { kind: "server", port, url: `http://localhost:${port}/`, process: str(m.process, 100) };
    }
    case "card": {
      const id = str(m.id, 40);
      if (!id) return null;
      const level = ["ok", "warn", "error", "info"].includes(m.level as string) ? (m.level as "ok") : "info";
      const buttons = Array.isArray(m.buttons) ? m.buttons.map((b) => str(b, 40)).filter(Boolean).slice(0, 3) : [];
      return { kind: "card", id, title: str(m.title, 120) || "Claude Code", text: str(m.text, 1200), level, buttons };
    }
    default:
      return null;
  }
}

/** The user's rules allow this proposal at all (notifications, in front of a client). */
function allowed(m: Moment): boolean {
  // A recording the user just stopped: its file must not be lost from sight,
  // even in a meeting or with "solo permessi".
  if (m.kind === "recording") return true;
  if (State.paused) return false;
  // Proposals count as alerts (each has its own switch): only "solo permessi" keeps them away.
  if (State.settings.notify === "permissions") return false;
  // In front of a client nothing shows, problems included (as for the notices).
  return !State.quiet;
}

/** Nothing on screen that the proposal would cover. */
function free(): boolean {
  if (State.pendingApproval) return false;
  return State.mode !== "expanded" || QUIET_VIEWS.has(State.view);
}

/** A proposal that came while the user was busy: shown when they are done, within WAIT_MS. */
let pending: { m: Moment; until: number } | null = null;
let retry: number | null = null;
const WAIT_MS = 60_000;
const RETRY_MS = 2000;
/** When the last proposal showed (a burst of downloads plays one sound). */
let lastShown = 0;

/** The card waiting for a click, if the one on screen is from Claude Code. */
function waitingCard(): string | null {
  return State.moment?.kind === "card" ? State.moment.id : null;
}

/** Answers a card of Claude Code (once: the Rust side forgets it). */
export function answerCard(id: string, choice: string | null, reason: string | null = null) {
  void Bridge.momentCardAnswer(id, choice, choice === null ? (reason ?? "closed") : null);
}

export function handleMoment(host: MomentHost, raw: unknown) {
  if (raw && typeof raw === "object" && (raw as { kind?: unknown }).kind === "card-expired") {
    // Claude Code stopped waiting: its card goes away if it is still up.
    const id = str((raw as { id?: unknown }).id, 40);
    if (pending?.m.kind === "card" && pending.m.id === id) pending = null;
    if (id && waitingCard() === id) {
      State.moment = null;
      host.holdOpen(false);
      if (State.view === "moment") host.collapse();
      State.notify();
    }
    return;
  }
  const m = readMoment(raw);
  if (!m) return;
  if (!allowed(m)) {
    void Bridge.log(`moment ${m.kind}: not now (paused, in front of a client or "solo permessi")`);
    if (m.kind === "card") answerCard(m.id, null, "hidden");
    return;
  }
  if (!free()) {
    void Bridge.log(`moment ${m.kind}: waiting, the island is busy (${State.mode} ${State.view})`);
    // Only the latest waits: an older card of Claude Code gets its answer now.
    if (pending?.m.kind === "card") answerCard(pending.m.id, null, "replaced");
    pending = { m, until: Date.now() + WAIT_MS };
    if (retry === null) retry = window.setTimeout(() => tryPending(host), RETRY_MS);
    return;
  }
  show(host, m);
}

function tryPending(host: MomentHost) {
  retry = null;
  const p = pending;
  if (!p) return;
  if (!allowed(p.m) || Date.now() > p.until) {
    pending = null;
    void Bridge.log(`moment ${p.m.kind}: dropped, the island stayed busy`);
    if (p.m.kind === "card") answerCard(p.m.id, null, "hidden");
    return;
  }
  if (!free()) {
    retry = window.setTimeout(() => tryPending(host), RETRY_MS);
    return;
  }
  pending = null;
  show(host, p.m);
}

function show(host: MomentHost, m: Moment) {
  // Another card of Claude Code was waiting: it gets its answer now.
  const before = waitingCard();
  if (before && (m.kind !== "card" || m.id !== before)) answerCard(before, null, "replaced");
  // Many files downloaded together: one sound, the card shows the latest.
  const burst = m.kind === "download" && State.moment?.kind === "download" && State.view === "moment" && Date.now() - lastShown < 5000;
  lastShown = Date.now();
  State.moment = m;
  host.holdOpen(m.kind === "card" && m.buttons.length > 0);
  if (!burst) Sound.play(m.kind === "card" ? (m.level === "error" ? "error" : m.level === "warn" ? "question" : "blip") : "blip");
  host.alert("moment");
  void Bridge.log(`moment ${m.kind}: shown`);
}

export function registerMoments(host: MomentHost) {
  void onEvent<unknown>("moment", (raw) => {
    try {
      handleMoment(host, raw);
    } catch (err) {
      void Bridge.log(`moment: ${err}`);
    }
  });
}
