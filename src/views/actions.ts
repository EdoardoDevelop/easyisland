// Quick actions: the Azioni tab (a grid of the user's buttons) and the Run view
// (confirm a script, watch it, read its output).

import { h, clear } from "./dom";
import { renderActionIcon } from "./action-icons";
import { State, type QuickAction } from "../core/state";
import type { ViewHost } from "./views";

export interface ActionHandlers {
  runAction(a: QuickAction): void;
  confirmRun(): void;
  killRun(): void;
  closeRun(): void;
  openSettingsWindow(): void;
}

const KIND_HINT: Record<QuickAction["kind"], string> = {
  url: "Apre un link",
  app: "Avvia un programma",
  script: "Esegue uno script",
  prompt: "Chiede a Claude",
};

const isFileAction = (a: QuickAction) => a.kind === "prompt" && a.input === "file";

/** The actions offered on "Cosa vuoi farne?" after a drop: prompts applied to the file. */
export function fileActions(): QuickAction[] {
  return (State.settings.actions ?? []).filter(isFileAction);
}

/** The ⚡ tab: everything but the file actions, which only make sense with a file. */
export function tabActions(): QuickAction[] {
  return (State.settings.actions ?? []).filter((a) => !isFileAction(a));
}

function actionButton(a: QuickAction, onClick: () => void): HTMLElement {
  const color = /^#[0-9a-f]{6}$/i.test(a.color) ? a.color : "#8e939c";
  const b = h(
    "button",
    {
      class: "qa",
      title: `${KIND_HINT[a.kind]}${a.hotkey ? ` · ${a.hotkey}` : ""}`,
      onclick: onClick,
    },
    h("span", { class: "qa-icon" }, renderActionIcon(a.icon, 18)),
    h("span", { class: "qa-name", text: a.name || "Senza nome" }),
  );
  b.style.setProperty("--qa", color);
  return b;
}

export function buildActions(handlers: ActionHandlers): ViewHost {
  const grid = h("div", { class: "qa-grid" });
  const el = h("div", { class: "view" }, h("div", { class: "card qa-card" }, grid));
  let key = "";
  return {
    el,
    sync() {
      const list = tabActions();
      const k = JSON.stringify(list.map((a) => [a.id, a.name, a.icon, a.color, a.kind, a.hotkey]));
      if (k === key) return;
      key = k;
      clear(grid);
      if (list.length === 0) {
        grid.append(
          h("div", { class: "qa-empty" },
            h("div", { class: "title", text: "Nessuna azione rapida." }),
            h("div", { class: "sub", text: "Creale in Impostazioni → Azioni rapide: link, programmi, script e domande a Claude." }),
            h("button", {
              class: "btn secondary", text: "Apri le impostazioni",
              onclick: () => handlers.openSettingsWindow(),
            }),
          ),
        );
        return;
      }
      for (const a of list) grid.append(actionButton(a, () => handlers.runAction(a)));
    },
    // Many actions wrap onto more rows: the island grows to show them all.
    fitHeight: () => grid.offsetHeight + 26,
  };
}

export function buildRun(handlers: ActionHandlers): ViewHost {
  const title = h("div", { class: "title" });
  const status = h("div", { class: "sub" });
  const code = h("pre", { class: "run-code" });
  const output = h("pre", { class: "run-output" });
  const row = h("div", { class: "actions" });
  const el = h(
    "div",
    { class: "view" },
    h("div", { class: "card run-card" }, h("div", { class: "run-body" }, title, status, code, output, row)),
  );

  let key = "";
  return {
    el,
    sync() {
      const run = State.run;
      if (!run) return;
      const k = `${run.runId}|${run.status}|${run.output.length}`;
      if (k === key) return;
      key = k;

      title.textContent = run.action.name;
      code.textContent = run.action.script;
      clear(row);
      const btn = (label: string, kind: "primary" | "secondary", fn: () => void) =>
        h("button", { class: `btn ${kind}`, text: label, onclick: fn });

      switch (run.status) {
        case "confirm":
          status.textContent = `Controlla i comandi prima di eseguirli (${run.action.shell === "cmd" ? "Prompt dei comandi" : "PowerShell"}).`;
          code.style.display = "";
          output.style.display = "none";
          row.append(btn("Annulla", "secondary", handlers.closeRun), btn("Esegui", "primary", handlers.confirmRun));
          break;
        case "running":
          status.textContent = "In esecuzione…";
          code.style.display = "";
          output.style.display = "none";
          row.append(btn("Interrompi", "secondary", handlers.killRun));
          break;
        case "done":
        case "error": {
          status.textContent = run.status === "error"
            ? "Errore"
            : run.timedOut
              ? "Tempo scaduto: lo script è stato interrotto."
              : `Terminato${run.code != null ? ` (codice ${run.code})` : ""}`;
          status.classList.toggle("bad", run.status === "error" || run.timedOut || (run.code ?? 0) !== 0);
          code.style.display = "none";
          output.style.display = "";
          output.textContent = run.output || "(nessun output)";
          const copy = btn("Copia output", "secondary", () => {
            void navigator.clipboard?.writeText(run.output).catch(() => undefined);
          });
          row.append(copy, btn("Chiudi", "primary", handlers.closeRun));
          break;
        }
      }
    },
  };
}
