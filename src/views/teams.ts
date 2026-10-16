// The Teams card (src-tauri/src/teams.rs, local part): whether Teams is open
// and in a meeting, the meeting's commands (Teams' own shortcuts sent to its
// window), "Apri Teams" and "Partecipa dal link copiato". The same commands go
// on the strip beside the closed character during a meeting (`stripTeams`).
// No account: chats, today's meetings and status will come with Graph (docs/idee.md).

import { h, brandOrDot } from "./dom";
import { State } from "../core/state";
import { Bridge } from "../core/bridge";
import { t } from "../core/i18n";
import { Sound } from "../core/sound";
import type { QuickReply } from "./threecx";

export const TEAMS = "integration_teams";
const COLOR = "#5B5FC7";

interface TeamsData {
  running?: boolean;
  inCall?: boolean;
  mic?: boolean;
  camera?: boolean;
}

function data(): TeamsData {
  return (State.integrations[TEAMS]?.data ?? {}) as TeamsData;
}

export function teamsActive(): boolean {
  return State.settings.activeIntegrations.includes(TEAMS);
}

/** The line for the Panoramica and the menu. */
export function teamsLine(): string {
  const d = data();
  if (!d.running) return t("Teams non è aperto");
  if (!d.inCall) return t("Teams aperto, nessuna riunione");
  return d.camera ? t("In riunione · webcam accesa") : t("In riunione");
}

function run(kind: string, say?: (m: string) => void) {
  Sound.play("blip");
  void Bridge.teamsAction(kind).catch((e: unknown) => say?.(String(e).replace(/^Error:\s*/, "")));
}

/** The meeting's commands, for the card and the strip. */
function meetingButtons(say?: (m: string) => void): QuickReply[] {
  return [
    { label: t("Microfono"), tone: "plain", run: () => run("mute", say) },
    { label: t("Video"), tone: "plain", run: () => run("video", say) },
    { label: t("Alza la mano"), tone: "plain", run: () => run("hand", say) },
    { label: t("Condividi"), tone: "plain", run: () => run("share", say) },
    { label: t("Esci"), tone: "red", run: () => run("leave", say) },
  ];
}

/** The strip during a Teams meeting: its main commands without opening the island. */
export function stripTeams(): { title: string; sub: string; buttons: QuickReply[] } | null {
  if (!teamsActive() || !data().inCall) return null;
  const all = meetingButtons((m) => void Bridge.log(`Teams dalla striscia: ${m}`));
  return { title: t("Riunione Teams"), sub: data().camera ? t("webcam accesa") : "", buttons: [all[0], all[1], all[4]] };
}

/** Microsoft Graph's availability in words. */
function presenceLabel(a: string): string {
  const map: Record<string, string> = {
    Available: t("Disponibile"), AvailableIdle: t("Disponibile"), Busy: t("Occupato"), BusyIdle: t("Occupato"),
    DoNotDisturb: t("Non disturbare"), BeRightBack: t("Torno subito"), Away: t("Assente"), Offline: t("Offline"),
  };
  return map[a] ?? a;
}

/** "09:30" from Graph's local "2026-10-16T09:30:00.0000000". */
function hhmm(s: string): string {
  return /T(\d{2}:\d{2})/.exec(s)?.[1] ?? "";
}

/** With the Microsoft account: status and today's online meetings with Partecipa. */
function graphPart(say: (m: string) => void): HTMLElement | null {
  const g = State.msTeams;
  if (!g?.signedIn) return null;
  const box = h("div", { class: "teams-graph" });
  if (g.availability) {
    box.append(h("div", { class: "teams-status" },
      h("span", { class: `teams-dot presence-${g.availability.toLowerCase()}` }),
      h("span", { text: t("Stato: {s}", { s: presenceLabel(g.availability) }) })));
  }
  const today = new Date().toISOString().slice(0, 10);
  const meetings = (g.meetings ?? []).filter((m) => m.start.slice(0, 10) >= today).slice(0, 4);
  for (const m of meetings) {
    box.append(h("div", { class: "int-row teams-meeting" },
      h("span", { class: "int-ago", text: m.allDay ? t("tutto il giorno") : hhmm(m.start) }),
      h("span", { class: "int-name", text: m.subject || t("(senza oggetto)") }),
      h("button", { class: "teams-btn light", text: t("Partecipa"),
        onclick: (e: Event) => {
          e.stopPropagation();
          Sound.play("blip");
          void Bridge.teamsJoin(m.joinUrl).catch((err: unknown) => say(String(err).replace(/^Error:\s*/, "")));
        } })));
  }
  if (!meetings.length) box.append(h("div", { class: "hint", text: t("Nessuna riunione Teams oggi e domani") }));
  if (g.error) box.append(h("div", { class: "notion-note bad", text: g.error }));
  return box;
}

export function teamsCard(openSettings: () => void): HTMLElement {
  const d = data();
  const note = h("div", { class: "notion-note", style: "display:none" });
  const say = (m: string) => { note.textContent = m; note.style.display = m ? "" : "none"; };
  const button = (b: QuickReply) => h("button", {
    class: `teams-btn ${b.tone}`, text: b.label, style: `--c:${COLOR}`,
    onclick: (e: Event) => { e.stopPropagation(); b.run(); },
  });
  const rows = h("div", { class: "teams-body" },
    h("div", { class: "teams-status" },
      h("span", { class: `teams-dot${d.inCall ? " live" : d.running ? " on" : ""}` }),
      h("span", { text: teamsLine() })));
  if (d.inCall) {
    rows.append(h("div", { class: "teams-actions" }, ...meetingButtons(say).map(button)),
      h("div", { class: "hint teams-hint", text: t("Sono le scorciatoie di Teams, mandate alla sua finestra: il microfono si accende e si spegne a ogni clic.") }));
  } else {
    rows.append(h("div", { class: "teams-actions" },
      button({ label: d.running ? t("Mostra Teams") : t("Apri Teams"), tone: "plain", run: () => run("open", say) }),
      button({
        label: t("Partecipa dal link copiato"), tone: "light",
        run: () => {
          Sound.play("blip");
          void Bridge.teamsJoinClipboard().then(() => say(""), (e: unknown) => say(String(e).replace(/^Error:\s*/, "")));
        },
      })));
  }
  const graph = graphPart(say);
  if (graph) rows.append(graph);
  rows.append(note);
  const head = h("div", { class: "int-head" }, brandOrDot(TEAMS, COLOR, 7), h("b", { text: "Microsoft Teams" }),
    h("span", { text: d.inCall ? t("In riunione") : d.running ? t("Aperto") : t("Chiuso") }),
    h("button", { class: "link-btn", style: "color:#8e939c", text: t("Impostazioni…"), onclick: openSettings }));
  return h("div", { class: "int-card notion-card" }, head, rows);
}
