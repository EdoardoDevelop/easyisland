// The "Agent Chat" card (src-tauri/src/agentchat.rs `publish`): whether
// EasyIsland is listening in the user's Agent Chat and as whom, which engines
// answer (the lead marked), «Ascolto» on or off, and the last messages of the
// followed rooms. The pill wears the state: working while an engine answers,
// asleep with listening off (integrations.ts).

import { h, brandOrDot } from "./dom";
import { State } from "../core/state";
import { Bridge } from "../core/bridge";
import { t } from "../core/i18n";
import { Sound } from "../core/sound";
import { timeAgo } from "./integrations";

export const AGENTCHAT = "integration_agentchat";
const COLOR = "#8B5CF6";
/** Messages shown in the card, the newest last. */
const SHOWN = 12;

export interface ChatMsg {
  id: number;
  room: string;
  sender: string;
  text: string;
  verified: boolean;
  thread: number | null;
  kind: string;
  ts: number;
  /** Attachments: name, size, SHA-256 and who imported each (one agent only). */
  files?: { id: string; name: string; size: number; sha256: string; imported_by?: string | null }[];
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
  engines?: { name: string; engine: string; lead: boolean }[];
  messages?: ChatMsg[];
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

function messageRow(m: ChatMsg, d: AgentchatData): HTMLElement {
  const me = d.name ?? "";
  const mine = !!me && (m.sender === me || m.sender.startsWith(`${me}/`));
  const owner = !!d.owner && m.sender === d.owner;
  const kind = m.kind === "consult" ? t("consulta") : m.kind === "synthesis" ? t("sintesi") : "";
  const text = m.text.length > 400 ? `${m.text.slice(0, 400)}…` : m.text;
  return h("div", { class: `ac-msg${mine ? " mine" : ""}${owner ? " owner" : ""}${m.thread ? " reply" : ""}` },
    h("div", { class: "ac-meta" },
      h("b", { text: m.sender }),
      m.verified ? null : h("span", { class: "ac-unv", text: "?", title: t("Mittente non verificato") }),
      kind ? h("span", { class: "ac-kind", text: kind }) : null,
      h("span", { class: "int-ago", text: `${m.room} · ${timeAgo(m.ts * 1000)}` })),
    h("div", { class: "ac-text", text }),
    ...(m.files ?? []).map((f) => h("div", { class: "ac-file", title: `SHA-256 ${f.sha256}`,
      text: `📎 ${f.name} · ${kb(f.size)} · ${f.imported_by ? t("importato da {who}", { who: f.imported_by }) : t("da importare")}` })));
}

function kb(n: number): string {
  return n < 1024 ? `${n} B` : n < 1_048_576 ? `${Math.round(n / 1024)} KB` : `${(n / 1_048_576).toFixed(1)} MB`;
}

export function agentchatCard(openSettings: () => void): HTMLElement {
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
      h("span", { class: e.lead ? "ac-engine lead" : "ac-engine", title: e.engine, text: e.lead ? `@${e.name} ★` : `@${e.name}` }))));
  }
  const list = (d.messages ?? []).slice(-SHOWN);
  const box = h("div", { class: "ac-list" });
  if (!list.length) box.append(h("div", { class: "int-empty", text: t("Nessun messaggio nelle stanze seguite.") }));
  for (const m of list) box.append(messageRow(m, d));
  body.append(box);
  if (d.last) body.append(h("div", { class: "hint rec-hint", text: d.last }));
  body.append(note);
  // The newest message in view.
  requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
  return h("div", { class: "int-card notion-card" }, head, body);
}
