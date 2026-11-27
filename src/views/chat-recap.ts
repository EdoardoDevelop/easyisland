// A conversation reopened after hours (26 Nov 2026, Edoardo): a card under
// its last message on where it was. At once and without an engine, what the
// conversation itself says (the titles of the answers, the files changed,
// the question or choice left open, the last exchange); with «Riassunto del
// motore», three lines written by its engine (lib.rs chat_recap). It goes
// with the next question.

import "./chat-recap.css";
import { Bridge } from "../core/bridge";
import { t } from "../core/i18n";
import { plainText, renderMarkdown, type MarkdownHooks } from "../core/markdown";
import type { ChatMessage, ChatRecap, ChatSessionState } from "../core/state";
import { h } from "./dom";

/** Away this long, the card shows. */
export const RECAP_AFTER = 3 * 3600_000;

/** The card for a conversation of `lines` last changed at `updated`, or null. */
export function recapFor(updated: number | undefined, engine: string, lines: number): ChatRecap | null {
  if (!updated || lines < 4 || Date.now() - updated < RECAP_AFTER) return null;
  return { since: updated, engine };
}

function clip(s: string, n: number): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > n ? `${one.slice(0, n - 1).trimEnd()}…` : one;
}

/** «da 5 ore», «da 2 giorni». */
function away(since: number): string {
  const hours = Math.max(1, Math.round((Date.now() - since) / 3600_000));
  if (hours < 48) return hours === 1 ? t("da un'ora") : t("da {n} ore", { n: hours });
  return t("da {n} giorni", { n: Math.round(hours / 24) });
}

/** The lines read from the conversation itself: [label, text]. */
export function localRecap(list: ChatMessage[]): [string, string][] {
  const replies = list.filter((m) => m.role === "assistant");
  const out: [string, string][] = [];
  // Done: the answers' section titles and the files changed.
  const titles: string[] = [];
  const files: string[] = [];
  for (const r of replies) {
    for (const m of r.content.matchAll(/^#{2,3}\s+(?:\d+[.)]\s*)?(.+)$/gm)) {
      const title = clip(plainText(m[1]), 50);
      if (title && !titles.includes(title)) titles.push(title);
    }
    for (const m of r.content.matchAll(/^```modifica[ \t]*\n(.+)$/gm)) {
      try {
        const file = String((JSON.parse(m[1]) as { file?: string }).file ?? "").split(/[\\/]/).pop();
        if (file && !files.includes(file)) files.push(file);
      } catch {
        /* not one of ours */
      }
    }
  }
  const done: string[] = [];
  if (titles.length) done.push(titles.slice(-4).join(" · "));
  if (files.length) done.push(t("file cambiati: {list}", { list: files.slice(-4).join(", ") + (files.length > 4 ? ` +${files.length - 4}` : "") }));
  const first = list.find((m) => m.role === "user");
  if (!done.length && first) done.push(clip(first.content, 110));
  if (done.length) out.push([t("Fatto"), done.join("; ")]);
  // Open: what the last answer left to the user.
  const last = replies[replies.length - 1]?.content ?? "";
  const choice = /^```scelte[ \t]*\n([\s\S]*?)^```/m.exec(last);
  const tasks = (last.match(/^\s*[-*]\s+\[ \]\s+/gm) ?? []).length;
  const asked = plainText(last.replace(/^```scelte[\s\S]*?^```/gm, "")).split("\n").map((l) => l.trim()).filter((l) => l.endsWith("?")).pop();
  if (choice) out.push([t("Ancora aperto"), t("una scelta: {list}", { list: choice[1].split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 4).join(" · ") })]);
  else if (asked) out.push([t("Ancora aperto"), clip(asked, 140)]);
  else if (tasks) out.push([t("Ancora aperto"), t("una procedura di {n} passi", { n: tasks })]);
  // The last step: the last question, and how the answer began.
  const lastQ = [...list].reverse().find((m) => m.role === "user");
  if (lastQ) {
    // The words of the answer: not its steps, changes, options or titles.
    const words = last
      .replace(/^```(?:modifica|esito|errore|scelte)[ \t]*\n[\s\S]*?^```[ \t]*$/gm, "")
      .split("\n")
      .filter((l) => !/^\s*(?:>\s*[⚙💭✗]|#{1,6}\s)/u.test(l))
      .join("\n");
    const began = plainText(words).split(/(?<=[.!?])\s|\n/).map((s) => s.trim()).find((s) => s.length > 8) ?? "";
    out.push([t("Ultimo passo"), `«${clip(lastQ.content, 90)}»${began ? ` → ${clip(began, 110)}` : ""}`]);
  }
  return out;
}

/** The card under the last message; `changed` redraws the chat. */
export function recapCard(c: ChatSessionState, hooks: MarkdownHooks, changed: () => void): HTMLElement | null {
  const r = c.recap;
  if (!r) return null;
  const close = h("button", { class: "chat-recap-x", title: t("Chiudi"), text: "✕", type: "button" });
  close.addEventListener("click", () => {
    c.recap = null;
    changed();
  });
  const head = h("div", { class: "chat-recap-head" }, h("span", { class: "chat-recap-ico", text: "↩" }), h("span", { text: t("Bentornato: questa conversazione è ferma {away}", { away: away(r.since) }) }), close);
  const body = h("div", { class: "chat-recap-body" });
  if (r.text) {
    body.append(...renderMarkdown(r.text, hooks));
  } else {
    for (const [label, text] of localRecap(c.history)) {
      body.append(h("div", { class: "chat-recap-line" }, h("b", { text: `${label}: ` }), h("span", { text })));
    }
  }
  const card = h("div", { class: "chat-row chat-recap" }, head, body);
  if (r.error) card.append(h("div", { class: "chat-recap-err", text: r.error }));
  if (!r.text && r.engine && r.engine !== "easyisland") {
    const ask = h("button", { class: "chat-recap-ask", type: "button", text: r.busy ? t("Il motore scrive il riassunto…") : `✨ ${t("Riassunto del motore")}`, title: t("Tre righe scritte dal motore della conversazione: una sua risposta, a parte") }) as HTMLButtonElement;
    ask.disabled = !!r.busy;
    ask.addEventListener("click", () => {
      r.busy = true;
      r.error = "";
      changed();
      Bridge.chatRecap(r.engine, c.history.map((m) => ({ role: m.role, content: m.content })))
        .then((text) => {
          r.text = text;
        })
        .catch((err) => {
          r.error = String(err).replace(/^Error:\s*/, "");
        })
        .finally(() => {
          r.busy = false;
          if (c.recap === r) changed();
        });
    });
    card.append(ask);
  }
  return card;
}
