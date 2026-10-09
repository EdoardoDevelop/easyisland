// Integration events → island state. Port of the `handle…` methods in the Swift
// pollers: a genuinely new item flips the pill to finished/error, badges it when
// the pill isn't focused, plays a sound, and clears itself after 60 s.

import { onEvent, Bridge, type IntegrationUpdate, type ThreecxCall } from "../core/bridge";
import { THREECX, ringing } from "../views/threecx";
import { Sound } from "../core/sound";
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
  void onEvent<IntegrationUpdate>("integration", (update) => handle(island, update));
  void onEvent<WidgetStatus>("widget-update", (r) => handleWidget(island, r));
  void onEvent<ThreecxCall>("threecx-call", (c) => incomingCall(island, c));
  void refreshConfigured();
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
 * recovering clears the badge.
 */
function handleWidget(island: Island, r: WidgetStatus) {
  if (State.paused) return;
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
    if (isBad && !wasBad) {
      if (State.focusId !== task.id) task.pillBadge = "error";
      // The very first result only sets the badge: no fanfare at startup.
      if (prev) {
        Sound.play("error");
        island.reveal();
      }
    } else if (!isBad && wasBad) {
      task.pillBadge = null;
      Sound.play("finish");
    } else if (r.event && prev) {
      // A new ticket and the like: announced even though the level stayed put.
      if (State.focusId !== task.id && task.pillBadge !== "error") task.pillBadge = "finished";
      Sound.play("finish");
      island.reveal();
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
  Sound.play("question");
  if (State.quiet) {
    State.notify();
    return;
  }
  State.setFocus(THREECX);
  heldByCall = true;
  island.setPinned(true);
  island.alert("overview");
}

function handle(island: Island, update: IntegrationUpdate) {
  if (State.paused) return;

  const previous = State.integrations[update.id];
  State.integrations[update.id] = {
    data: update.error ? (previous?.data ?? {}) : update.data,
    error: update.error,
    loaded: update.error ? (previous?.loaded ?? false) : true,
    configured: previous?.configured ?? true,
  };

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
      Sound.play(event.success ? "finish" : "error");
      // Same as the Swift pollers: show the compact island so the badge is seen,
      // but never steal the screen for a successful deploy.
      island.reveal();

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
