// Screen readers: what changes on its own is read out (review of 9 Nov 2026).
// Two hidden live regions in the island's page: «polite» for a reply that
// arrived or an agent that finished, «assertive» for a permission that waits
// for a click. Only changes are announced, never the state found at start.

import { t } from "./i18n";
import { State } from "./state";

const HIDDEN = "position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0";

function region(level: "polite" | "assertive"): HTMLElement {
  const el = document.createElement("div");
  el.setAttribute("aria-live", level);
  el.setAttribute("role", level === "assertive" ? "alert" : "status");
  el.style.cssText = HIDDEN;
  document.body.append(el);
  return el;
}

/** Reads `text` out; the same text twice in a row is read again. */
function say(el: HTMLElement, text: string) {
  el.textContent = "";
  window.setTimeout(() => { el.textContent = text; }, 50);
}

/** Starts listening to the state; called once by the island. */
export function startAnnouncer() {
  const polite = region("polite");
  const urgent = region("assertive");
  let approvalKey = State.pendingApproval ? `${State.pendingApproval.tool}|${State.pendingApproval.command}` : "";
  let sending = State.chat.sending;
  const finished = new Set(State.sessionTasks.filter((x) => x.state === "finished").map((x) => x.id));
  State.subscribe(() => {
    const req = State.pendingApproval;
    const key = req ? `${req.tool}|${req.command}` : "";
    if (key && key !== approvalKey) {
      const who = req?.source === "chat" ? t("La chat") : State.focusTask?.name ?? t("Un agente");
      say(urgent, `${t("{who} chiede un permesso", { who })}: ${req?.command || req?.tool || ""}`);
    }
    approvalKey = key;
    if (sending && !State.chat.sending) {
      const last = State.chatHistory[State.chatHistory.length - 1];
      if (last && last.role !== "user") say(polite, t("Risposta arrivata nella chat"));
    }
    sending = State.chat.sending;
    for (const task of State.sessionTasks) {
      if (task.state === "finished" && !finished.has(task.id)) {
        finished.add(task.id);
        say(polite, t("{name} ha finito", { name: task.name }));
      } else if (task.state !== "finished") finished.delete(task.id);
    }
  });
}
