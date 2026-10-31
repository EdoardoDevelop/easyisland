// «Parla» (asked by Edoardo on 31 October 2026): the card while the island
// listens to the microphone and then transcribes (src-tauri/src/talk.rs). It
// shows all the time that the microphone is on; «Fine» ends the question,
// «Annulla» throws it away. The words then go to the chat as a question.

import { h, clear } from "./dom";
import { State } from "../core/state";
import type { ViewHost } from "./views";
import { t } from "../core/i18n";

export interface TalkHandlers {
  /** «Fine»: the question ends here, it goes to be transcribed. */
  endTalk(): void;
  /** «Annulla»: stops and throws the sound away. */
  cancelTalk(): void;
}

export function buildTalk(handlers: TalkHandlers): ViewHost {
  const bars = Array.from({ length: 5 }, () => h("i"));
  const meter = h("div", { class: "talk-meter" }, ...bars);
  const title = h("div", { class: "title" });
  const status = h("div", { class: "sub" });
  const row = h("div", { class: "actions" });
  const el = h("div", { class: "view" },
    h("div", { class: "card run-card talk-card" },
      meter,
      h("div", { class: "run-body" }, title, status, row)));

  let key = "";
  return {
    el,
    sync() {
      const talk = State.talk;
      if (!talk) return;
      // The bars follow the voice: the middle one the most.
      const level = talk.state === "listening" ? talk.level : 0;
      bars.forEach((b, i) => {
        const weight = [0.45, 0.75, 1, 0.75, 0.45][i];
        b.style.transform = `scaleY(${(0.18 + 0.82 * Math.min(1, level * 1.6) * weight).toFixed(3)})`;
      });
      meter.classList.toggle("busy", talk.state === "hearing");
      const k = `${talk.state}|${talk.spoke}`;
      if (k === key) return;
      key = k;
      const hotkey = State.settings.hotkeyTalk ?? "";
      title.textContent = talk.state === "hearing" ? t("Trascrivo…") : t("Ti ascolto");
      status.textContent = talk.state === "hearing"
        ? t("Poi la domanda va alla chat.")
        : talk.spoke
          ? t("Quando smetti di parlare la domanda parte da sola.")
          : hotkey
            ? t("Parla pure: finisci con una pausa, «Fine» o di nuovo {key}.", { key: hotkey })
            : t("Parla pure: finisci con una pausa o con «Fine».");
      clear(row);
      const button = (label: string, kind: "primary" | "secondary", fn: () => void, dataKey?: string) =>
        h("button", { class: `btn ${kind}`, onclick: fn, ...(dataKey ? { "data-key": dataKey } : {}) }, h("span", { text: label }));
      row.append(button(t("Annulla"), "secondary", handlers.cancelTalk));
      if (talk.state === "listening") row.append(button(t("Fine"), "primary", handlers.endTalk, "Enter"));
    },
  };
}
