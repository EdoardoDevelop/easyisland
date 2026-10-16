// The strip beside the closed island's character (the compact view): one
// status line and, when something waits for an answer, its quick replies:
// Nega / Consenti on a permission, Rispondi / Rifiuta on a 3CX call, Muto /
// Riaggancia during one. Impostazioni → Posizione e aspetto → "Accanto al
// personaggio chiuso" (`compactStrip`: right, left or off).
// The bar of the app in use (`appBar`, a "Touch Bar"): the user's own quick
// actions tied to the program in front ("Nella barra con", "*" for any). Nothing
// by default: no actions for that program, no bar. It comes after a permission
// or a call, before the line of an agent at work (asked by Edoardo). How the
// buttons look (icon, text, both), how many and the program's name are the
// user's choice (Impostazioni → Posizione e aspetto, and each action).
// context.rs pushes each change of program; clicks never take the focus from
// it (the island does not activate), so keys and the selection reach it.

import { h } from "./dom";
import { State, type ApprovalInfo, type QuickAction } from "../core/state";
import { t } from "../core/i18n";
import { stripCall, type QuickReply } from "./threecx";
import { renderActionIcon } from "./action-icons";
import { appName, type Suggestion } from "../island/context";

/** A button of the strip: a quick reply, or an action of the app bar with its icon. */
export interface StripButton extends QuickReply {
  icon?: string;
  hint?: string;
  /** In the bar of the app in use: icon, text or both. */
  look?: "both" | "icon" | "text";
  /** The action's colour, on its button. */
  color?: string;
}

export interface StripItem {
  /** Changes when the strip must be drawn again (and measured). */
  key: string;
  title: string;
  sub: string;
  tone: "approval" | "call" | "live" | "work" | "app";
  /** Waits for an answer: the compact island stays up and does not open on hover. */
  urgent: boolean;
  buttons: StripButton[];
}

export interface StripActions {
  decide(d: "allow" | "deny"): void;
  runAction(a: QuickAction): void;
  runSuggestion(s: Suggestion): void;
}

/** Does the action belong to this program? `apps` = "outlook.exe, excel" (".exe" optional), "*" = any. */
export function actionForApp(a: QuickAction, exe: string): boolean {
  return (a.apps ?? "").split(",").some((x) => {
    const want = x.trim().toLowerCase();
    return !!want && (want === "*" || want === exe || `${want}.exe` === exe);
  });
}

/** The bar of the app in use: only the user's actions for it, in their order. */
function appBarItem(actions: StripActions): StripItem | null {
  const s = State.settings;
  if (s.appBar === false) return null;
  const exe = State.foreground?.exe ?? "";
  if (!exe) return null;
  const max = Math.max(1, Math.min(12, Math.round(s.appBarMax || 6)));
  const mine = (s.actions ?? []).filter((a) => actionForApp(a, exe)).slice(0, max);
  if (!mine.length) return null;
  const buttons: StripButton[] = mine.map((a) => ({
    label: a.name || t("Senza nome"),
    icon: a.icon,
    hint: a.name,
    look: a.barLook || s.appBarLook || "both",
    color: /^#[0-9a-f]{6}$/i.test(a.color) ? a.color : undefined,
    tone: "plain",
    run: () => actions.runAction(a),
  }));
  return {
    key: `app:${exe}:${s.appBarName !== false}:${buttons.map((b) => `${b.label}/${b.look}/${b.icon}/${b.color}`).join("|")}`,
    title: s.appBarName === false ? "" : appName(exe), sub: "", tone: "app", urgent: false, buttons,
  };
}

/**
 * A permission the strip may answer: a plain allow or deny. Questions, plans
 * and requests with a risk warning open their card, where they can be read.
 */
export function quickApproval(req: ApprovalInfo | null): boolean {
  return !!req && !req.questions?.length && !req.plan && !req.risks?.length;
}

function approvalItem(req: ApprovalInfo, actions: StripActions): StripItem {
  const task = State.tasks.find((x) => x.id === req.taskId);
  const who = req.source === "chat" ? t("La chat") : task?.name ?? t("Un agente");
  const what = req.command && req.command !== req.tool && !req.command.startsWith(`${req.tool} ·`)
    ? `${req.tool} · ${req.command}` : req.command || req.tool;
  return {
    key: `approval:${req.requestId}`,
    title: t("{who} chiede", { who }),
    sub: what,
    tone: "approval",
    urgent: true,
    buttons: [
      { label: t("Nega"), tone: "plain", run: () => actions.decide("deny") },
      { label: t("Consenti"), tone: "light", run: () => actions.decide("allow") },
    ],
  };
}

function workItem(): StripItem | null {
  const busy = State.sessionTasks.filter((x) => x.state !== "idle" && x.state !== "sleeping" && x.state !== "finished");
  if (!busy.length) return null;
  const first = busy[0];
  const name = first.agentName ? `${first.name} · ${first.agentName}` : first.name;
  const step = first.steps.at(-1) ?? "";
  return busy.length === 1
    ? { key: `work:${name}:${step}`, title: name, sub: step, tone: "work", urgent: false, buttons: [] }
    : {
      key: `work:${busy.length}:${first.name}:${step}`, title: t("{n} sessioni al lavoro", { n: busy.length }),
      sub: step ? `${first.name} · ${step}` : first.name, tone: "work", urgent: false, buttons: [],
    };
}

/** What the strip shows now, most urgent first; null = the character alone. */
export function stripItem(actions: StripActions): StripItem | null {
  if ((State.settings.compactStrip ?? "right") === "off" || State.paused) return null;
  const req = State.pendingApproval;
  if (req && quickApproval(req)) return approvalItem(req, actions);
  const call = stripCall(State.quiet);
  if (call) {
    return {
      // The minutes tick inside the title: not part of the key (see the timer below).
      key: `call:${call.id}:${call.ringing}:${call.buttons.map((b) => b.label).join("|")}:${call.ringing ? call.title : ""}`,
      title: call.title, sub: call.sub, tone: call.ringing ? "call" : "live", urgent: true, buttons: call.buttons,
    };
  }
  // A request it cannot answer: say so; the click opens its card.
  if (req) {
    const task = State.tasks.find((x) => x.id === req.taskId);
    const who = req.source === "chat" ? t("La chat") : task?.name ?? t("Un agente");
    return {
      key: `card:${req.requestId}`, tone: "approval", urgent: false, buttons: [],
      title: req.questions?.length ? t("{who} ha una domanda", { who }) : t("{who} chiede un permesso", { who }),
      sub: t("Clic per rispondere"),
    };
  }
  // The program in use comes before an agent's work line.
  return appBarItem(actions) ?? workItem();
}

export interface Strip {
  el: HTMLElement;
  /** What it shows, as of the last sync. */
  item: StripItem | null;
  /** Draws it again; true when its content (and so its width) changed. */
  sync(): boolean;
}

export function buildStrip(actions: StripActions): Strip {
  const title = h("strong", { class: "strip-title" });
  const sub = h("span", { class: "strip-sub" });
  const buttons = h("span", { class: "strip-buttons" });
  const el = h("div", { id: "strip" }, h("span", { class: "strip-text" }, title, sub), buttons);
  let key = "";
  let timer = 0;

  const strip: Strip = {
    el,
    item: null,
    sync() {
      const item = stripItem(actions);
      strip.item = item;
      // A call in progress: its minutes go on without new data.
      if (item?.tone === "live" && !timer) {
        timer = window.setInterval(() => {
          const now = stripItem(actions);
          if (now?.tone === "live") title.textContent = now.title;
        }, 1000);
      } else if (item?.tone !== "live" && timer) {
        window.clearInterval(timer);
        timer = 0;
      }
      const k = item ? `${item.key}:${item.title.length}` : "";
      if (k === key) {
        if (item) title.textContent = item.title;
        return false;
      }
      key = k;
      if (!item) return true;
      el.dataset.tone = item.tone;
      title.textContent = item.title;
      title.title = item.title;
      title.style.display = item.title ? "" : "none";
      sub.textContent = item.sub;
      sub.title = item.sub;
      sub.style.display = item.sub ? "" : "none";
      buttons.replaceChildren(...item.buttons.map((b) => {
        const look = b.look ?? "both";
        const icon = b.icon !== undefined && look !== "text";
        const label = look !== "icon" || !icon;
        const el = h("button", {
        class: `strip-btn ${b.tone}${icon ? " with-icon" : ""}${icon && !label ? " icon-only" : ""}`,
        title: b.hint ?? "",
        // Not a press on the island: no drag, no opening.
        onpointerdown: (e: Event) => e.stopPropagation(),
        onclick: (e: Event) => {
          e.stopPropagation();
          b.run();
        },
      }, ...(icon ? [h("span", { class: "strip-icon" }, renderActionIcon(b.icon, 14))] : []), ...(label ? [h("span", { class: "strip-label", text: b.label })] : []));
        if (b.color) el.style.setProperty("--qa", b.color);
        return el;
      }));
      return true;
    },
  };
  return strip;
}
