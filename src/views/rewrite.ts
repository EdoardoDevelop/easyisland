// "Sostituisci": the text selected in an app and its rewrite, before and after.
// The new text can be edited here; it takes the selection's place only on
// "Sostituisci" (island.ts applyRewrite → context.rs `replace`, which first
// checks the selection is still the same).

import { h, clear } from "./dom";
import { Bridge } from "../core/bridge";
import { State } from "../core/state";
import type { ViewHost } from "./views";
import { t } from "../core/i18n";

export interface RewriteHandlers {
  applyRewrite(text: string): void;
  retryRewrite(): void;
  closeRewrite(): void;
}

export function buildRewrite(handlers: RewriteHandlers): ViewHost {
  const title = h("div", { class: "title" });
  const status = h("div", { class: "sub" });
  const before = h("div", { class: "rw-before" });
  const after = h("textarea", { class: "rw-after", spellcheck: "false" }) as HTMLTextAreaElement;
  const row = h("div", { class: "actions" });
  const body = h("div", { class: "run-body" },
    title, status,
    h("div", { class: "rw-label", text: t("Prima") }), before,
    h("div", { class: "rw-label", text: t("Dopo") }), after,
    row);
  const el = h("div", { class: "view" }, h("div", { class: "card run-card rw-card" }, body));

  // The text area takes the keys only when the user goes there: the island
  // never steals them on its own (the app still holds the selection).
  after.addEventListener("pointerdown", () => void Bridge.focusWindow(true));
  after.addEventListener("input", () => {
    if (State.rewrite) State.rewrite.result = after.value;
  });
  after.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handlers.applyRewrite(after.value);
    }
  });

  let key = "";
  return {
    el,
    sync() {
      const w = State.rewrite;
      if (!w) return;
      const k = `${w.id}|${w.status}|${w.message}|${w.status === "loading" ? "" : w.result.length}`;
      if (k === key) return;
      key = k;

      title.textContent = w.label;
      before.textContent = w.original;
      if (after.value !== w.result) after.value = w.result;
      after.disabled = w.status !== "ready";
      after.classList.toggle("loading", w.status === "loading");
      status.classList.toggle("bad", w.status === "error" || !!w.message);
      status.textContent = w.message || {
        loading: t("Sto riscrivendo il testo selezionato…"),
        ready: t("Controlla e, se va bene, sostituisci. Puoi modificare il testo qui sotto."),
        replacing: t("Sostituisco nell'app…"),
        error: "",
      }[w.status];
      if (w.status === "loading") after.value = "";

      clear(row);
      const button = (label: string, kind: "primary" | "secondary", fn: () => void, key?: string) =>
        h("button", { class: `btn ${kind}`, onclick: fn, ...(key ? { "data-key": key } : {}) }, h("span", { text: label }));
      row.append(button(t("Annulla"), "secondary", handlers.closeRewrite));
      if (w.status === "ready" || w.status === "error") {
        row.append(button(t("Rigenera"), "secondary", handlers.retryRewrite));
      }
      if (w.status === "ready") {
        row.append(
          button(t("Copia"), "secondary", () => {
            void navigator.clipboard?.writeText(after.value).catch(() => undefined);
          }),
          button(t("Sostituisci"), "primary", () => handlers.applyRewrite(after.value), "Enter"),
        );
      }
    },
  };
}
