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
  rows.append(note);
  const head = h("div", { class: "int-head" }, brandOrDot(TEAMS, COLOR, 7), h("b", { text: "Microsoft Teams" }),
    h("span", { text: d.inCall ? t("In riunione") : d.running ? t("Aperto") : t("Chiuso") }),
    h("button", { class: "link-btn", style: "color:#8e939c", text: t("Impostazioni…"), onclick: openSettings }));
  return h("div", { class: "int-card notion-card" }, head, rows);
}
