// The "moment" card (src/island/moments.ts): a finished download, a copied
// error, a development server that started, a card from Claude Code. Laid out
// like the notices: the character on the left, a title, one line, the buttons.

import { h, clear } from "./dom";
import { washRGBA, type Wash } from "../core/layout";
import { Bridge } from "../core/bridge";
import { State, type Moment, type QuickAction } from "../core/state";
import { answerCard } from "../island/moments";
import { fileActions } from "./actions";
import { size } from "./upload";
import type { ViewActions, ViewHost } from "./views";
import { t } from "../core/i18n";

/** What the card's buttons do in the island. */
export interface MomentActions {
  /** «Spiega e correggi»: the chat with the error attached. */
  explainError(text: string, note: string): void;
}

const WASH: Record<string, Wash> = { ok: "green", warn: "amber", error: "red", info: "indigo" };

function btn(label: string, kind: "primary" | "secondary", onClick: () => void, title = ""): HTMLElement {
  return h("button", { class: `btn ${kind}`, title, onclick: onClick }, h("span", { text: label }));
}

/** "La porta 3000 è occupata da node.exe (PID 1234)." */
export function holderLine(m: Extract<Moment, { kind: "error" }>): string {
  if (!m.port) return "";
  if (!m.holder) return t("La porta {port} è occupata, ma non si vede da quale programma.", { port: m.port });
  return t("La porta {port} è occupata da {name} (PID {pid}).", { port: m.port, name: m.holder.name, pid: m.holder.pid });
}

export function buildMoment(actions: ViewActions & MomentActions): ViewHost {
  const host = h("div", { class: "view" });
  let key = "";

  /** A file action on the downloaded file itself (no copy in the tray first). */
  const onFile = (m: Extract<Moment, { kind: "download" | "tray" }>, a: QuickAction) => {
    State.droppedFile = { name: m.name, path: m.path, source: m.path };
    State.promptContext = { kind: "file", name: m.name, path: m.path };
    actions.runAction(a);
  };

  function body(m: Moment): { wash: Wash; who: string; title: string; text: string; row: HTMLElement[] } {
    const done = () => {
      State.moment = null;
      actions.collapse();
    };
    switch (m.kind) {
      case "download":
      case "tray": {
        const file = { name: m.name, path: m.path };
        return {
          wash: "indigo",
          who: m.kind === "download" ? t("Download finito") : t("Nel Vassoio"),
          title: m.name,
          text: m.kind === "download" ? size(m.size) : t("{size} · da Claude Code", { size: size(m.size) }),
          row: [
            btn(t("Apri"), "primary", () => { void Bridge.fileOpen(m.path, false).catch(() => {}); done(); }),
            m.kind === "download"
              ? btn(t("Mostra nella cartella"), "secondary", () => { void Bridge.fileOpen(m.path, true).catch(() => {}); done(); })
              : btn(t("Vassoio"), "secondary", () => actions.openFiles()),
            btn(t("Chiedi"), "secondary", () => actions.askAboutPicture(file), t("Fai una domanda sul file alla chat")),
            ...fileActions(m.name).map((a) => btn(a.name || t("Senza nome"), "secondary", () => onFile(m, a), a.prompt)),
          ],
        };
      }
      case "recording": {
        const mins = Math.floor(m.seconds / 60);
        const len = mins ? t("{m} min {s} s", { m: mins, s: m.seconds % 60 }) : t("{s} s", { s: m.seconds });
        return {
          wash: "red",
          who: t("Registrazione pronta"),
          title: m.name,
          text: `${len} · ${size(m.size)}`,
          row: [
            btn(t("Nel Vassoio"), "primary", () => {
              void Bridge.ingestFile(m.path).then(() => { State.moment = null; actions.openFiles(); }, () => undefined);
            }, t("Una copia nel Vassoio, da trascinare in una mail o in un ticket")),
            btn(t("Apri"), "secondary", () => { void Bridge.fileOpen(m.path, false).catch(() => {}); done(); }),
            btn(t("Mostra nella cartella"), "secondary", () => { void Bridge.fileOpen(m.path, true).catch(() => {}); done(); }),
            ...fileActions(m.name).map((a) => btn(a.name || t("Senza nome"), "secondary", () => onFile({ kind: "download", name: m.name, path: m.path, size: m.size }, a), a.prompt)),
            btn(t("Non ora"), "secondary", done),
          ],
        };
      }
      case "error": {
        const port = holderLine(m);
        return {
          wash: "red",
          who: t("Errore copiato"),
          title: m.summary,
          text: port,
          row: [
            btn(t("Spiega e correggi"), "primary", () => actions.explainError(m.text, port)),
            btn(t("Non ora"), "secondary", done),
          ],
        };
      }
      case "server":
        return {
          wash: "green",
          who: t("Server di sviluppo"),
          title: t("In ascolto su localhost:{port}", { port: m.port }),
          text: m.process,
          row: [
            btn(t("Apri nel browser"), "primary", () => { actions.openUrl(m.url); done(); }),
            btn(t("Copia indirizzo"), "secondary", () => { void navigator.clipboard?.writeText(m.url).catch(() => undefined); done(); }),
          ],
        };
      case "card": {
        const answer = (choice: string | null) => {
          answerCard(m.id, choice, "closed");
          actions.holdOpen(false);
          done();
        };
        return {
          wash: WASH[m.level] ?? "indigo",
          who: "Claude Code",
          title: m.title,
          text: m.text,
          row: m.buttons.length
            ? m.buttons.map((b, i) => btn(b, i === 0 ? "primary" : "secondary", () => answer(b)))
            : [btn("OK", "primary", () => answer(null))],
        };
      }
    }
  }

  return {
    el: host,
    sync() {
      const m = State.moment;
      const k = m ? JSON.stringify(m) + (State.settings.actions ?? []).length : "";
      if (k === key) return;
      key = k;
      clear(host);
      if (!m) return;
      const b = body(m);
      const who = h("div", { class: "who-row" }, h("span", { class: "n", text: b.who }));
      const title = h("div", { class: "title moment-title", text: b.title });
      const text = h("div", { class: "sub moment-text", text: b.text });
      const row = h("div", { class: "actions" }, ...b.row);
      const stack = h("div", { class: "stack" }, who, title, ...(b.text ? [text] : []), row);
      stack.style.padding = "4px 16px 4px max(16px, calc(116px * var(--bot-room, 1)))";
      const card = h("div", { class: "card wash" }, stack);
      card.style.setProperty("--wash", washRGBA(b.wash));
      host.append(card);
    },
    fitHeight: () => {
      const stack = host.querySelector<HTMLElement>(".stack");
      return stack ? stack.scrollHeight + 28 : 0;
    },
  };
}
