// «Ricorda questo» (asked by Edoardo on 31 October 2026): the text selected in
// any app, or typed here, goes in the memory's da-leggere with where it came
// from; a task (or the evening digest) writes it into the right linked page
// (src-tauri/src/brain.rs `remember`, docs/chat.md → Memoria). The card is the
// confirmation: nothing is saved before «Ricorda».

import { h, clear } from "./dom";
import { Bridge } from "../core/bridge";
import { State } from "../core/state";
import type { ViewHost } from "./views";
import { t } from "../core/i18n";

export interface RememberHandlers {
  saveRemember(text: string, about: string): void;
  closeRemember(): void;
}

/** "Outlook — Re: preventivo · https://…", or "" when nothing is known. */
function origin(r: { app: string; title: string; url: string }): string {
  // "OUTLOOK.EXE" → "Outlook"; a name that is not a program ("3CX") stays.
  let app = r.app;
  if (/\.exe$/i.test(app)) {
    app = app.replace(/\.exe$/i, "");
    if (app === app.toUpperCase()) app = app.charAt(0) + app.slice(1).toLowerCase();
  }
  return [[app, r.title].filter(Boolean).join(" — "), r.url].filter(Boolean).join(" · ");
}

export function buildRemember(handlers: RememberHandlers): ViewHost {
  const status = h("div", { class: "sub" });
  const text = h("textarea", { class: "rw-after", spellcheck: "false", placeholder: t("Cosa vuoi ricordare? Per esempio: Rossi preferisce essere chiamato dopo le 15.") }) as HTMLTextAreaElement;
  const about = h("input", { type: "text", class: "rem-about", placeholder: t("Riguarda… (facoltativo: un cliente, una persona, un progetto)") }) as HTMLInputElement;
  const row = h("div", { class: "actions" });
  const body = h("div", { class: "run-body" },
    h("div", { class: "title", text: t("Ricorda") }), status,
    text,
    about,
    row);
  const el = h("div", { class: "view" }, h("div", { class: "card run-card rw-card rem-card" }, body));

  // The fields take the keys only when the user goes there; an empty card
  // (nothing selected) takes them at once, to type.
  for (const f of [text, about]) f.addEventListener("pointerdown", () => void Bridge.focusWindow(true));
  const keep = () => {
    if (!State.remember) return;
    State.remember.text = text.value;
    State.remember.about = about.value;
  };
  text.addEventListener("input", keep);
  about.addEventListener("input", keep);
  const save = () => handlers.saveRemember(text.value, about.value);
  text.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      save();
    }
  });
  about.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      save();
    }
  });

  let key = "";
  return {
    el,
    sync() {
      const r = State.remember;
      if (!r) return;
      const k = `${r.id}|${r.status}|${r.message}`;
      if (k === key) return;
      const fresh = !key.startsWith(`${r.id}|`);
      key = k;
      if (fresh) {
        text.value = r.text;
        about.value = r.about;
        if (!r.text) {
          void Bridge.focusWindow(true);
          window.setTimeout(() => text.focus(), 60);
        }
      }
      const saving = r.status === "saving";
      text.disabled = about.disabled = saving;
      const from = origin(r);
      status.classList.toggle("bad", !!r.message);
      status.textContent = r.message
        || (saving ? t("Lo metto nella memoria…")
          : from && !r.text ? t("Da {from}. Scrivi cosa ricordare: l'IA lo mette nella pagina giusta della memoria.", { from })
          : from ? t("Da {from}. Controlla e, se va bene, ricordalo: l'IA lo mette nella pagina giusta della memoria.", { from })
          : t("Scrivi cosa ricordare: l'IA lo mette nella pagina giusta della memoria."));

      clear(row);
      const button = (label: string, kind: "primary" | "secondary", fn: () => void, dataKey?: string) =>
        h("button", { class: `btn ${kind}`, onclick: fn, disabled: saving, ...(dataKey ? { "data-key": dataKey } : {}) }, h("span", { text: label }));
      row.append(
        button(t("Annulla"), "secondary", handlers.closeRemember),
        button(t("Ricorda"), "primary", save, "Enter"),
      );
    },
  };
}
