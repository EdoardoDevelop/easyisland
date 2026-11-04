// The proposals of a task's question (task_ask `items`, tasks.rs): the memory
// check's corrections, the second brain's lines. One checkbox each, ticked by
// default, and a comment for each one — often a proposal is nearly right and
// the user says what is wrong with it. The answer to the engine lists what to
// do, what not to and the comments. Used by the island's question card
// (views.ts buildAsk) and by Impostazioni → Flussi (a question answered later).

import { h } from "./dom";
import { Bridge } from "../core/bridge";
import { t } from "../core/i18n";

export interface ProposalPicks {
  checked: boolean[];
  comments: string[];
  /** Which comment fields are open. */
  open: boolean[];
}

export function freshPicks(items: string[]): ProposalPicks {
  return { checked: items.map(() => true), comments: items.map(() => ""), open: items.map(() => false) };
}

/** The answer for the engine: what to do, what not to, the comments, a note for all. */
export function proposalsAnswer(items: string[], p: ProposalPicks, note = ""): string {
  const yes: number[] = [];
  const no: number[] = [];
  items.forEach((_, i) => (p.checked[i] ? yes : no).push(i + 1));
  const none = t("nessuna");
  const lines = [
    t("Da fare: {list}", { list: yes.join(", ") || none }),
    t("Da non fare: {list}", { list: no.join(", ") || none }),
  ];
  const commented = items.map((item, i) => ({ item, i, c: (p.comments[i] ?? "").trim() })).filter((x) => x.c);
  if (commented.length) {
    lines.push(t("Commenti dell'utente (seguili: se dice cosa è sbagliato, correggi la proposta prima di farla, o chiedi se non è chiaro):"));
    for (const { item, i, c } of commented) {
      const short = item.length > 70 ? item.slice(0, 69) + "…" : item;
      lines.push(`- ${i + 1}. «${short}»${p.checked[i] ? "" : ` (${t("non fare")})`}: ${c}`);
    }
  }
  if (note.trim()) lines.push(t("Nota dell'utente: {n}", { n: note.trim() }));
  return lines.join("\n");
}

/**
 * The list: checkbox, the whole text, «Commenta» opening a field under it.
 * `island`: fields in the island take the keyboard (focusWindow).
 */
export function proposalsBox(items: string[], p: ProposalPicks, island: boolean, onEnter?: () => void): HTMLElement {
  const take = () => { if (island) void Bridge.focusWindow(true); };
  const list = h("div", { class: "prop-list" });
  items.forEach((item, i) => {
    const box = h("input", { type: "checkbox" }) as HTMLInputElement;
    box.checked = p.checked[i] ?? true;
    const row = h("div", { class: box.checked ? "prop-item" : "prop-item off" });
    box.addEventListener("change", () => { p.checked[i] = box.checked; row.classList.toggle("off", !box.checked); });
    const field = h("input", { class: "prop-comment", type: "text", value: p.comments[i] ?? "", spellcheck: "true",
      placeholder: t("Cosa c'è che non va, o come la vuoi…") }) as HTMLInputElement;
    field.addEventListener("pointerdown", take);
    field.addEventListener("focus", take);
    field.addEventListener("input", () => { p.comments[i] = field.value; commentBtn.classList.toggle("on", !!field.value.trim()); });
    field.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" && onEnter) { e.preventDefault(); onEnter(); }
    });
    if (!p.open[i]) field.style.display = "none";
    const commentBtn = h("button", { class: p.comments[i]?.trim() ? "link-btn prop-btn on" : "link-btn prop-btn", text: t("Commenta"),
      onclick: (e: Event) => {
        e.stopPropagation();
        p.open[i] = !p.open[i];
        field.style.display = p.open[i] ? "" : "none";
        if (p.open[i]) { take(); field.focus(); }
      } });
    row.append(
      h("label", { class: "prop-main" }, box, h("span", { class: "prop-n", text: `${i + 1}.` }), h("span", { class: "prop-text", text: item })),
      commentBtn,
      field);
    list.append(row);
  });
  return list;
}

/** «Tutte» / «Nessuna»: every checkbox at once (the list is redrawn by the caller). */
export function setAll(p: ProposalPicks, on: boolean) {
  p.checked = p.checked.map(() => on);
}
