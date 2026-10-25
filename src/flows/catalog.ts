// What a flow is made of, in words: the "Quando" kinds, the blocks of the
// palette (grouped as the user thinks of them), the conditions and the data
// each trigger hands to the steps. Shared by the flows window and the list in
// Impostazioni → Flussi (docs/flussi.md).

import type { Automation, AutomationCondition, AutomationStep, AutomationTrigger } from "../core/state";
import { t } from "../core/i18n";

export const TRIGGERS: [AutomationTrigger["kind"], string][] = [
  ["time", t("A un orario")],
  ["startup", t("All'avvio (con il PC)")],
  ["unlock", t("Quando sblocchi il PC")],
  ["back", t("Quando torni al PC dopo una pausa")],
  ["wifi", t("Quando ti colleghi a una rete Wi-Fi")],
  ["app", t("Quando parte un programma")],
  ["foreground", t("Quando passi a un programma")],
  ["drive", t("Quando colleghi una chiavetta o un disco")],
  ["folder", t("Quando arriva un file in una cartella")],
  ["download", t("Quando finisce un download")],
  ["integration", t("Quando un'integrazione o un widget segnala…")],
  ["call", t("Quando arriva una chiamata (3CX)")],
  ["agent", t("Quando un agente finisce o chiede un permesso")],
  ["server", t("Quando parte un server di sviluppo")],
  ["teams", t("Quando inizia o finisce una riunione Teams")],
];

export interface Block {
  kind: AutomationStep["kind"];
  label: string;
  icon: string;
  color: string;
  hint: string;
}

/** The palette, by group. */
export const GROUPS: { name: string; blocks: Block[] }[] = [
  {
    name: t("Fai"),
    blocks: [
      { kind: "notice", label: t("Avviso"), icon: "🔔", color: "#38bdf8", hint: t("Un avviso nell'isola") },
      { kind: "app", label: t("Apri"), icon: "📂", color: "#38bdf8", hint: t("Un programma, una cartella o un file") },
      { kind: "url", label: t("Link"), icon: "🔗", color: "#38bdf8", hint: t("Apre un sito") },
      { kind: "quick", label: t("Azione rapida"), icon: "⚡", color: "#facc15", hint: t("Una delle tue azioni rapide") },
      { kind: "profile", label: t("Profilo"), icon: "👤", color: "#38bdf8", hint: t("Passa a un profilo") },
    ],
  },
  {
    name: t("Intelligenza"),
    blocks: [
      { kind: "agent", label: t("Agente"), icon: "✨", color: "#a78bfa", hint: t("Un agente fa un lavoro e aspetti il risultato") },
      { kind: "chat", label: t("Chat"), icon: "💬", color: "#a78bfa", hint: t("Manda una domanda alla chat dell'isola") },
      { kind: "task", label: t("Compito"), icon: "📋", color: "#a78bfa", hint: t("Affida un compito senza aspettarlo") },
    ],
  },
  {
    name: t("Decidi"),
    blocks: [
      { kind: "decide", label: t("Scelta"), icon: "🔀", color: "#f59e0b", hint: t("Strade diverse secondo una regola o il modello") },
      { kind: "foreach", label: t("Per ogni"), icon: "🔁", color: "#22c55e", hint: t("Ripete dei passi per ogni voce di un elenco") },
    ],
  },
  {
    name: t("Con te"),
    blocks: [
      { kind: "ask", label: t("Domanda"), icon: "❓", color: "#f472b6", hint: t("Ti chiede qualcosa (anche su Telegram)") },
      { kind: "confirm", label: t("Conferma"), icon: "✋", color: "#f472b6", hint: t("Continua solo se dici sì") },
      { kind: "wait", label: t("Attesa"), icon: "⏳", color: "#8e939c", hint: t("Aspetta qualche minuto") },
    ],
  },
];

export const BLOCKS: Block[] = GROUPS.flatMap((g) => g.blocks);
export const block = (kind: string): Block =>
  BLOCKS.find((b) => b.kind === kind) ?? { kind: kind as AutomationStep["kind"], label: kind, icon: "•", color: "#8e939c", hint: "" };

export const CONDITIONS: [AutomationCondition["kind"], string][] = [
  ["hours", t("è tra le…")],
  ["wifi", t("sei sulla rete Wi-Fi")],
  ["app", t("è aperto il programma")],
  ["foreground", t("è in primo piano il programma")],
  ["meeting", t("sei in riunione (microfono o webcam in uso)")],
  ["client", t("sei «davanti al cliente»")],
  ["idle", t("sei assente da")],
  ["battery", t("il PC va a batteria")],
];

/** The trigger's data each "quando" hands to the steps (automations.rs `fill`). */
export const PLACEHOLDERS: Partial<Record<AutomationTrigger["kind"], string[]>> = {
  wifi: ["rete"],
  app: ["programma"],
  foreground: ["programma"],
  drive: ["unità"],
  folder: ["file", "percorso", "cartella"],
  download: ["file", "percorso", "cartella"],
  integration: ["testo", "fonte"],
  call: ["chiamante", "numero"],
  agent: ["agente", "progetto", "cartella"],
  server: ["link", "porta", "programma"],
  back: ["minuti"],
};

export function blankStep(kind: AutomationStep["kind"] = "notice"): AutomationStep {
  const s: AutomationStep = { kind, id: "", title: "", text: "", level: "info", target: "", args: "", url: "" };
  if (kind === "decide") {
    s.branches = [{ value: "{risultato}", op: "contains", toMatch: "", to: "" }, { value: "", op: "else", toMatch: "", to: "" }];
  }
  if (kind === "wait") s.minutes = 5;
  return s;
}

export function blankCondition(kind: AutomationCondition["kind"] = "hours"): AutomationCondition {
  return { kind, not: false, from: "09:00", to: "18:00", days: [1, 2, 3, 4, 5], ssid: "", exe: "", minutes: 10, percent: 0 };
}

export function blankFlow(name = t("Nuovo flusso")): Automation {
  return {
    id: `a${Date.now().toString(36)}`,
    name,
    enabled: false,
    trigger: { kind: "time", time: "09:00", days: [1, 2, 3, 4, 5], delay: 30, ssid: "", exe: "", folder: "", source: "", when: "problem", filter: "", minutes: 15 },
    profile: "",
    conditions: [],
    repeat: "",
    every: 60,
    steps: [],
    notify: false,
  };
}

const DAY = ["", t("lun"), t("mar"), t("mer"), t("gio"), t("ven"), t("sab"), t("dom")];

/** "Alle 09:00, lun–ven" and the like: the trigger in a few words. */
export function triggerWords(tr: AutomationTrigger): string {
  const days = tr.days?.length && tr.days.length < 7 ? tr.days.map((d) => DAY[d] ?? d).join(", ") : t("ogni giorno");
  const label = TRIGGERS.find(([k]) => k === tr.kind)?.[1] ?? tr.kind;
  switch (tr.kind) {
    case "time": return t("Alle {time}, {days}", { time: tr.time || "09:00", days });
    case "wifi": return tr.ssid ? t("Quando ti colleghi a {x}", { x: tr.ssid }) : label;
    case "app": return tr.exe ? t("Quando parte {x}", { x: tr.exe }) : label;
    case "foreground": return tr.exe ? t("Quando passi a {x}", { x: tr.exe }) : label;
    case "folder": return tr.folder ? t("Quando arriva un file in {x}", { x: tr.folder }) : label;
    case "back": return t("Quando torni dopo {n} minuti", { n: tr.minutes || 15 });
    case "startup": return t("{n} secondi dopo l'avvio", { n: tr.delay || 30 });
    default: return label;
  }
}

/** A step in a few words, for its card. */
export function stepWords(s: AutomationStep): string {
  const what = s.title?.trim() || s.text?.trim() || "";
  switch (s.kind) {
    case "agent": return what || t("cosa deve fare?");
    case "chat": return s.text?.trim() || t("quale domanda?");
    case "task": return what || t("quale obiettivo?");
    case "notice": return what || t("quale avviso?");
    case "app": return s.target?.trim() || t("cosa aprire?");
    case "url": return s.url?.trim() || t("quale link?");
    case "wait": return t("{n} minuti", { n: s.minutes ?? 5 });
    case "ask": return s.title?.trim() || t("quale domanda?");
    case "confirm": return s.title?.trim() || t("prima di continuare");
    case "foreach": return s.text?.trim() ? t("ogni voce di {x}", { x: s.text }) : t("quale elenco?");
    case "decide": return s.branches?.some((b) => b.op === "model") ? t("decide il modello") : t("secondo una regola");
    default: return what;
  }
}

/** What a step still needs before it can run; "" when nothing. */
export function missing(s: AutomationStep): string {
  switch (s.kind) {
    case "agent": case "task": return s.text?.trim() ? "" : t("scrivi cosa deve fare");
    case "chat": return s.text?.trim() ? "" : t("scrivi la domanda");
    case "notice": return s.title?.trim() || s.text?.trim() ? "" : t("scrivi l'avviso");
    case "app": return s.target?.trim() ? "" : t("scegli cosa aprire");
    case "url": return /^https?:\/\/|^\{/.test(s.url?.trim() ?? "") ? "" : t("scrivi un link che inizia con https://");
    case "quick": case "profile": return s.id ? "" : t("scegline uno");
    case "foreach": return !s.text?.trim() ? t("scrivi l'elenco") : !s.body ? t("scegli da dove parte ogni voce") : "";
    case "decide": return (s.branches?.length ?? 0) === 0 ? t("aggiungi una strada") : "";
    default: return "";
  }
}
