// Integration events → island state. Port of the `handle…` methods in the Swift
// pollers: a genuinely new item flips the pill to finished/error, badges it when
// the pill isn't focused, plays a sound, and clears itself after 60 s.

import { onEvent, Bridge, type IntegrationUpdate, type ThreecxCall, type ThreecxMessage } from "../core/bridge";
import { THREECX, ringing, chatMessage, chatTyping, openChat } from "../views/threecx";
import { TEAMS, teamsLine } from "../views/teams";
import { Sound } from "../core/sound";
import { startSoftphone, onSoftphone } from "../core/softphone";
import { State, type WidgetStatus } from "../core/state";
import type { Island } from "./island";

/** Which Credential Manager key backs each pill. */
const KEY_FOR: Record<string, string> = {
  integration_stripe: "stripe-api-key",
  integration_github: "github-token",
  integration_vercel: "vercel-token",
  integration_n8n: "n8n-api-key",
  integration_resend: "resend-api-key",
  integration_notion: "notion-api-key",
  integration_calcom: "calcom-api-key",
  integration_zammad: "zammad-token",
};

const clearTimers = new Map<string, number>();

export function registerIntegrationHandlers(island: Island) {
  void onEvent<IntegrationUpdate>("integration", (update) => handleIntegration(island, update));
  void onEvent<WidgetStatus>("widget-update", (r) => handleWidget(island, r)).then(() => catchUpWidgets(island));
  void onEvent<ThreecxCall>("threecx-call", (c) => incomingCall(island, c));
  void onEvent<ThreecxMessage>("threecx-chat", (m) => incomingMessage(island, m));
  void onEvent<{ conversation: number; name: string }>("threecx-typing", (e) => chatTyping(e.conversation, e.name));
  // "Questo PC": the 3CX card follows the calls of EasyIsland's own phone.
  startSoftphone();
  onSoftphone(() => State.notify());
  void refreshConfigured();
}

/**
 * The checks that ran before the island was listening (the first round starts
 * with the app): their last results, unless a newer one has arrived since.
 * Without this Meteo had no sky until its next run, 15 minutes later.
 */
async function catchUpWidgets(island: Island) {
  for (const r of await Bridge.widgetResults()) {
    const seen = State.widgetStatus[r.id];
    if (!seen || seen.at < r.at) handleWidget(island, r);
  }
}

/** Asks Rust which keys exist so the idle cards can say so. */
export async function refreshConfigured() {
  for (const [id, key] of Object.entries(KEY_FOR)) {
    const present = (await Bridge.secretPresent(key)) ?? false;
    const info = State.integrations[id] ?? { data: {}, error: null, loaded: false, configured: false };
    State.integrations[id] = { ...info, configured: present };
  }
  const hooks = State.settings.hooksInstalled;
  const claude = State.integrations.integration_claude ?? {
    data: {}, error: null, loaded: false, configured: false,
  };
  State.integrations.integration_claude = { ...claude, configured: hooks };
  State.notify();
}

/**
 * A widget check came back. Going from fine to not fine badges the pill, plays
 * a sound and shows the island (within the profile's notification rules);
 * recovering clears the badge. Sound and island only when the check's
 * reaction is "show" (Impostazioni → Notifiche → Reazioni del personaggio);
 * the badge stays in any case.
 */
export function handleWidget(island: Island, r: WidgetStatus) {
  if (State.paused || !r || typeof r.id !== "string") return;
  // What the poller sent, made whole: an older or newer backend may leave a field out.
  r = { ...r, summary: String(r.summary ?? ""), fields: Array.isArray(r.fields) ? r.fields : [] };
  const prev = State.widgetStatus[r.id];
  State.widgetStatus[r.id] = r;
  // A widget's pill is `widget:<id>`; an integration run as a check uses its own id.
  const task = State.tasks.find((t) => t.id === `widget:${r.id}` || t.id === r.id);
  if (task) {
    task.state = r.level === "ok" ? "idle" : r.level === "warn" ? "ratelimit" : "error";
    // Meteo wears its sky (rain on the way shows as the clouds and the badge), not the tired, sweating warn.
    if (r.sky && r.level === "warn") task.state = "idle";
    task.steps = [r.summary];
    task.stepIndex = 0;
    const wasBad = prev ? prev.level !== "ok" : false;
    const isBad = r.level !== "ok";
    const shows = State.reaction(task.id) === "show";
    if (isBad && !wasBad) {
      if (State.focusId !== task.id) task.pillBadge = "error";
      // The very first result only sets the badge: no fanfare at startup.
      if (prev && shows) {
        Sound.play("error");
        island.reveal();
      }
    } else if (!isBad && wasBad) {
      task.pillBadge = null;
      if (shows) Sound.play("finish");
    } else if (r.event && prev) {
      // A new ticket and the like: announced even though the level stayed put.
      if (State.focusId !== task.id && task.pillBadge !== "error") task.pillBadge = "finished";
      if (shows) {
        Sound.play("finish");
        island.reveal();
      }
    }
    if (r.event) task.steps = [r.event, r.summary];
  }
  State.notify();
}

/** Kept open by a ringing call (so the island lets go once it stops). */
let heldByCall = false;

/**
 * 3CX: someone is calling. The island opens on the 3CX card with Rispondi /
 * Rifiuta and stays open while it rings. In front of a client only the pill
 * is badged: no caller name on a shared screen.
 */
function incomingCall(island: Island, _c: ThreecxCall) {
  if (State.paused) return;
  const task = State.tasks.find((t) => t.id === THREECX);
  if (!task) return;
  if (State.focusId !== THREECX) task.pillBadge = "approval";
  // "Chiamata in arrivo: solo il pallino" (Impostazioni or the card's bell).
  if (State.settings.integrationConfig?.threecxAlert === false) {
    State.notify();
    return;
  }
  Sound.play("question");
  if (State.quiet) {
    State.notify();
    return;
  }
  // Closed island: Rispondi / Rifiuta in the strip beside the character.
  if (island.showInStrip()) {
    State.notify();
    return;
  }
  State.setFocus(THREECX);
  heldByCall = true;
  island.setPinned(true);
  island.alert("overview");
}

/**
 * 3CX: a chat message. In the open conversation it just appears; otherwise the
 * 3CX pill is badged, the bell rings and, when the island is not in use, it
 * opens briefly on that conversation, ready for a reply. In front of a client
 * (or with "solo permessi") only the badge: no names or text on a shared screen.
 */
function incomingMessage(island: Island, m: ThreecxMessage) {
  if (State.paused || m.mine || m.system) return;
  if (chatMessage(m)) return;
  if (!m.isNew) return;
  const task = State.tasks.find((t) => t.id === THREECX);
  if (!task) return;
  // Not "approval": that one belongs to a ringing call and goes when it stops.
  if (State.focusId !== THREECX && task.pillBadge !== "approval") task.pillBadge = "finished";
  if (State.settings.notify === "permissions") {
    State.notify();
    return;
  }
  Sound.play("blip");
  // In use (open on something else, or typing): don't pull the island away.
  if (State.quiet || State.mode === "expanded") {
    State.notify();
    return;
  }
  State.setFocus(THREECX);
  openChat(m.conversation);
  island.alert("overview");
}

/** Exported for dev/scenes.ts (the fuzz scene); the app gets these from `registerIntegrationHandlers`. */
export function handleIntegration(island: Island, update: IntegrationUpdate) {
  if (State.paused || !update || typeof update.id !== "string") return;
  // An update without data (an older or newer backend, a poller that failed
  // half-way) is read as empty, never as a crash of every later update.
  if (update.data == null || typeof update.data !== "object") update = { ...update, data: {} };

  const previous = State.integrations[update.id];
  State.integrations[update.id] = {
    data: update.error ? (previous?.data ?? {}) : update.data,
    error: update.error,
    loaded: update.error ? (previous?.loaded ?? false) : true,
    configured: previous?.configured ?? true,
  };

  // Teams: its line in the Panoramica, and "working" while in a meeting.
  if (update.id === TEAMS && !update.error) {
    const task = State.tasks.find((t) => t.id === TEAMS);
    if (task) {
      task.steps = [teamsLine()];
      task.stepIndex = 0;
      task.state = update.data.inCall ? "working" : "idle";
    }
  }

  // Every chat message read (here or on another device): the chat badge goes.
  if (update.id === THREECX && !update.error && !Number(update.data.unread ?? 0)) {
    const task = State.tasks.find((t) => t.id === THREECX);
    if (task?.pillBadge === "finished") task.pillBadge = null;
  }

  // The call stopped ringing (answered, declined, hung up): stop holding the island.
  if (update.id === THREECX && !ringing()) {
    const task = State.tasks.find((t) => t.id === THREECX);
    if (task?.pillBadge === "approval") task.pillBadge = null;
    if (heldByCall) {
      heldByCall = false;
      // Still on the call card: close it. Somewhere else: just let go.
      if (State.focusId === THREECX && State.view === "overview") island.endAlert();
      else island.setPinned(false);
    }
  }

  const event = update.event;
  if (event) {
    const task = State.tasks.find((t) => t.id === update.id);
    if (task) {
      task.state = event.success ? "finished" : "error";
      task.steps = event.detail ? [event.label, event.detail] : [event.label];
      task.stepIndex = task.steps.length - 1;
      if (State.focusId !== update.id) {
        task.pillBadge = event.success ? "finished" : "error";
      }
      // Same as the Swift pollers: show the compact island so the badge is seen,
      // but never steal the screen for a successful deploy.
      if (State.reaction(update.id) === "show") {
        Sound.play(event.success ? "finish" : "error");
        island.reveal();
      }

      const existing = clearTimers.get(update.id);
      if (existing != null) window.clearTimeout(existing);
      clearTimers.set(
        update.id,
        window.setTimeout(() => {
          clearTimers.delete(update.id);
          const t = State.tasks.find((x) => x.id === update.id);
          if (!t || (t.state !== "finished" && t.state !== "error")) return;
          t.state = "idle";
          t.steps = [];
          t.stepIndex = 0;
          t.pillBadge = null;
          State.notify();
        }, 60_000),
      );
    }
  }

  State.notify();
}
