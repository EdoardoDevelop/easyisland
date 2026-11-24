// «Documenti» beside the chat (Edoardo, 24 Nov 2026: «i documenti in un unico
// posto … come sidebar a destra come fa anteprima e terminale»): the files the
// conversation made or named — offers, DDT, Word, PDF, sheets, audio, images —
// in one list, the newest first, each with Apri, Cartella, Anteprima and
// Vassoio. The replies already say every file's full path (the prompts ask for
// it): this reads them from the conversation, asks Rust which exist
// (chatpaths.rs, as the links of the replies), and keeps only those.

import { Bridge } from "../core/bridge";
import { State, type ChatMessage } from "../core/state";
import { t, tn } from "../core/i18n";
import { h, svg } from "./dom";
import { ICONS } from "./icons";
import { canPreview, chatPathAction } from "./chat";
import { BARE_PATH } from "../core/markdown";
import { renderActionIcon } from "./action-icons";

/** What counts as a document: what the user makes and sends, not code or logs. */
const DOC = /\.(pdf|docx?|xlsx?|xlsm|pptx?|odt|ods|rtf|csv|md|txt|html?|eml|msg|wav|mp3|m4a|ogg|png|jpe?g|gif|webp|svg|zip|7z|rar|xml|json)$/i;

/** Absolute paths in a text, spaces in their names too: the same rule as the links of the replies (markdown.ts). */
const PATH_RE = new RegExp(BARE_PATH.source, "g");

/** The documents named in a conversation's replies, the last named first, each once. */
export function docsIn(history: ChatMessage[], streamed = ""): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const texts = [...history.filter((m) => m.role === "assistant").map((m) => m.content), streamed].reverse();
  for (const text of texts) {
    // `C:\…` in code too: the backticks out first (the rule skips a path right after one).
    const found = [...(text ?? "").replace(/`/g, " ").matchAll(PATH_RE)].map((m) => m[0].replace(/(:\d+){1,2}$/, "")).filter((p) => DOC.test(p)).reverse();
    for (const p of found) {
      const k = p.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push(p);
    }
  }
  return out.slice(0, 200);
}

/** What Rust said about each path (exists or not), and when: a missing one is asked again later. */
const known = new Map<string, { file: boolean; resolved: string; at: number }>();
let asking = false;

/** The paths that exist as files, asking Rust for those not known yet. `then` runs when an answer changes the list. */
function existing(paths: string[], then: () => void): string[] {
  const now = Date.now();
  const ask = paths.filter((p) => {
    const k = known.get(p.toLowerCase());
    return !k || (!k.file && now - k.at > 15_000);
  });
  if (ask.length && !asking) {
    asking = true;
    void Bridge.pathsInfo(ask.slice(0, 100), null)
      .then((infos) => {
        for (const i of infos ?? []) known.set(i.path.toLowerCase(), { file: i.kind === "file", resolved: i.resolved, at: Date.now() });
        // Asked and not answered (an odd path): not asked again at once.
        for (const p of ask) if (!known.has(p.toLowerCase())) known.set(p.toLowerCase(), { file: false, resolved: p, at: Date.now() });
      })
      .catch(() => {})
      .finally(() => {
        asking = false;
        then();
      });
  }
  return paths.filter((p) => known.get(p.toLowerCase())?.file).map((p) => known.get(p.toLowerCase())?.resolved || p);
}

function nameOf(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

/** The folder, by its last two names («…\WORK\Offerte PDF»): the whole path is in the row's tooltip. */
function folderOf(path: string): string {
  const parts = path.split(/[\\/]/).slice(0, -1).filter(Boolean);
  return parts.length > 2 ? `…\\${parts.slice(-2).join("\\")}` : parts.join("\\");
}

/** A short label of the kind, for the badge: PDF, DOCX… */
function kindOf(path: string): string {
  return (path.split(".").pop() ?? "").toUpperCase().slice(0, 4);
}

/**
 * The panel's element (chat.ts puts it in the dock's «Documenti» panel) and
 * its drawing: redrawn only when the list changes.
 */
export function docsPanel(): { el: HTMLElement; draw(): void } {
  const list = h("div", { class: "chat-docs-list" });
  const count = h("span", { class: "chat-docs-count" });
  const el = h("div", { class: "chat-docs" },
    h("div", { class: "chat-docs-head" }, svg(ICONS.doc, 13, { stroke: 1.8 }), h("span", { class: "chat-docs-title", text: t("Documenti della conversazione") }), count),
    list);
  el.style.display = "none";
  // Out of the view (in its panel): taken home before its window goes (popout.ts rescue).
  el.dataset.followsView = "";
  let drawn = "";
  const draw = () => {
    const c = State.chat;
    const docs = existing(docsIn(c.history, c.sending ? c.streamed : ""), () => draw());
    const key = `${c.sid}|${docs.join("|")}`;
    if (key === drawn) return;
    drawn = key;
    count.textContent = docs.length ? String(docs.length) : "";
    if (!docs.length) {
      list.replaceChildren(h("p", { class: "chat-docs-empty", text: t("Ancora nessun documento: i file che la chat crea o nomina in questa conversazione compaiono qui.") }));
      return;
    }
    list.replaceChildren(...docs.map((p) => {
      // Small icons beside the name (four words did not fit on a line of a narrow panel).
      const btn = (icon: Node, title: string, run: () => void) => {
        const b = h("button", { class: "chat-docs-btn", title, "aria-label": title }, icon) as HTMLButtonElement;
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          run();
        });
        return b;
      };
      const tray = btn(renderActionIcon("i:inbox", 14), t("Una copia nel Vassoio, da trascinare in una mail o in un ticket"), () => {
        void Bridge.ingestFile(p).then(() => {
          tray.classList.add("done");
          tray.title = t("Nel Vassoio");
        }).catch((e: unknown) => {
          tray.title = String(e).replace(/^Error:\s*/, "");
        });
      });
      const row = h("div", { class: "chat-docs-row", title: `${p}\n${t("Clic: apri con il suo programma")}` },
        h("span", { class: "chat-docs-kind", text: kindOf(p) }),
        h("div", { class: "chat-docs-text" },
          h("span", { class: "chat-docs-name", text: nameOf(p) }),
          h("span", { class: "chat-docs-folder", text: folderOf(p) })),
        h("div", { class: "chat-docs-actions" },
          btn(renderActionIcon("i:folder", 14), t("Mostra nella cartella"), () => chatPathAction(p, "reveal")),
          ...(canPreview(p) && State.settings.chatPreview !== false ? [btn(svg(ICONS.preview, 14, { stroke: 1.8 }), t("Apri nell'Anteprima accanto alla chat"), () => chatPathAction(p, "preview"))] : []),
          tray));
      // A click on the row: the file in its program (the icons do the rest).
      row.addEventListener("click", () => chatPathAction(p, "open"));
      return row;
    }));
    list.setAttribute("aria-label", tn("{n} documento", "{n} documenti", docs.length));
  };
  return { el, draw };
}
