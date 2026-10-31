// «Cosa ho fatto» in the island (docs/chat.md → Permessi per livelli): what
// EasyIsland's tools changed, from the chat, Telegram and the tasks
// (src-tauri/src/permits.rs), newest first, with Annulla where it can be taken
// back. The same list is in Impostazioni → Chat; here it opens from the field
// at the top and from the card shown when something ran without a click.

import { h, clear } from "./dom";
import { washRGBA } from "../core/layout";
import { Bridge, type DoneItem } from "../core/bridge";
import { State } from "../core/state";
import { toolWords } from "../core/permits";
import type { ViewActions, ViewHost } from "./views";
import { locale, t } from "../core/i18n";

/** Entries shown: the log keeps more, Impostazioni → Chat shows as many. */
const SHOWN = 30;

let items: DoneItem[] = [];
let loaded = 0;

/** The log changed (did-changed) or the view opens: read it again. */
export async function refreshDone() {
  items = (await Bridge.didList()) ?? [];
  loaded++;
  State.notify();
}

/** Annulla on an entry; the error in words, or null. */
export async function undoDone(id: string): Promise<string | null> {
  try {
    await Bridge.didUndo(id);
    return null;
  } catch (e) {
    return String(e).replace(/^Error:\s*/, "");
  }
}

export function buildDone(actions: ViewActions): ViewHost {
  const status = h("span", { class: "recap-range" });
  const list = h("div", { class: "news-items list did-items" });
  const body = h("div", { class: "stack recap-stack news-stack" },
    h("div", { class: "recap-head" },
      h("span", { class: "recap-title", text: t("Cosa ho fatto") }),
      h("span", { class: "grow" }),
      status),
    list,
    h("div", { class: "actions" },
      h("button", { class: "btn secondary", onclick: () => void Bridge.openSettingsAt("chat") }, h("span", { text: t("Permessi") })),
      h("button", { class: "btn secondary", onclick: () => actions.collapse() }, h("span", { text: "OK" }))));
  const card = h("div", { class: "card wash recap-card" }, body);
  card.style.setProperty("--wash", washRGBA("green"));
  const el = h("div", { class: "view" }, card);
  let key = "";
  let wasOpen = false;

  function draw() {
    clear(list);
    status.textContent = "";
    if (!items.length) {
      list.append(h("div", { class: "sub", text: t("Ancora niente: qui compaiono le azioni degli strumenti di EasyIsland che cambiano qualcosa, con Annulla dove si può.") }));
      return;
    }
    for (const d of items.slice(0, SHOWN)) {
      const when = new Date(d.at).toLocaleString(locale(), { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
      const who = d.task ? t("compito «{title}»", { title: d.task }) : t("chat");
      const meta = [when, who, d.alone ? t("senza chiedere") : ""].filter(Boolean).join(" · ");
      let right: HTMLElement | null = null;
      if (d.undone) {
        right = h("span", { class: "did-undone", text: t("Annullato") });
      } else if (d.undo) {
        const b = h("button", { class: "news-save", text: t("Annulla") }) as HTMLButtonElement;
        b.addEventListener("click", async () => {
          b.disabled = true;
          const err = await undoDone(d.id);
          if (err) {
            b.disabled = false;
            status.textContent = err;
          }
        });
        right = b;
      }
      list.append(h("div", { class: d.undone ? "news-item did-item undone" : "news-item did-item" },
        h("div", { class: "news-text" },
          h("div", { class: "news-title", text: toolWords(d.tool) }),
          h("div", { class: "news-summary", text: d.what }),
          h("div", { class: "news-meta" },
            h("span", { class: "news-from", text: meta }),
            h("span", { class: "grow" }),
            right))));
    }
  }

  return {
    el,
    sync() {
      // Opened: read the log again, it may have changed while closed.
      const open = State.view === "done";
      if (open && !wasOpen) void refreshDone();
      wasOpen = open;
      const k = `${loaded}`;
      if (k === key) return;
      key = k;
      draw();
    },
    fitHeight: () => [...body.children].reduce((n, c) => n + (c as HTMLElement).offsetHeight, 0)
      + 7 * Math.max(0, body.children.length - 1) + 8 + 20,
  };
}
