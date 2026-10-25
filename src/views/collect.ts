// La Raccolta (asked by Edoardo on 25 Oct 2026): bits gathered from any app —
// the selected text with one shortcut, or a zone from «Riquadra e chiedi» —
// each with where it came from, then handed to the chat all together. Not tied
// to any job: a quote, a comparison, a search for a house are the same thing,
// a collection with a name and, if wanted, the fields the chat should fill
// ("Prodotto, Prezzo, Fornitore"). One collection at a time; the fields are
// filled when it goes to the chat, never at each add. Kept by collect.rs.

import { Bridge } from "../core/bridge";
import { t } from "../core/i18n";
import { State } from "../core/state";
import { h, clear, svg } from "./dom";
import { ICONS } from "./icons";
import type { ViewActions, ViewHost } from "./views";

export interface CollectItem {
  id: string;
  text: string;
  /** "chrome.exe", lower case; "" for a zone of the screen. */
  app: string;
  title: string;
  /** The page, when a browser copied the text. */
  url: string;
  /** Unix ms. */
  at: number;
  /** A zone of the screen: the picture in the inbox. */
  image?: string;
}

export interface Collection {
  name: string;
  /** "Prodotto, Prezzo, Fornitore": what the chat fills for every item ("" = none). */
  fields: string;
  items: CollectItem[];
}

let current: Collection = { name: "", fields: "", items: [] };
let loaded: Promise<void> | null = null;

/** The collection, read once from collect.rs. */
export function loadCollection(): Promise<void> {
  loaded ??= Bridge.collectLoad().then((json) => {
    try {
      const c = JSON.parse(json || "{}") as Partial<Collection>;
      current = { name: String(c.name ?? ""), fields: String(c.fields ?? ""), items: Array.isArray(c.items) ? c.items : [] };
    } catch {
      /* unreadable: start again, the file is rewritten at the next add */
    }
    State.notify();
  }).catch(() => undefined);
  return loaded;
}

export function collection(): Collection {
  return current;
}

async function save(): Promise<void> {
  State.notify();
  await Bridge.collectSave(JSON.stringify(current));
}

/** Adds one bit; returns how many there are now. */
export async function addToCollection(item: Omit<CollectItem, "id" | "at">): Promise<number> {
  await loadCollection();
  current.items.push({ ...item, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, at: Date.now() });
  await save();
  return current.items.length;
}

/** What the chat gets: every item with its source, and what to do with the fields. */
export function collectionForChat(c: Collection): { label: string; text: string } {
  const name = c.name.trim() || t("Raccolta");
  const fields = c.fields.split(",").map((f) => f.trim()).filter(Boolean);
  const lines: string[] = [t("Raccolta «{name}»: {n} voci messe da parte dall'utente, ognuna con la sua fonte.", { name, n: c.items.length })];
  if (fields.length) {
    lines.push(t("Per ogni voce ricava questi campi: {fields}. Mostrali in una tabella (lascia vuoto ciò che non c'è, non inventare), poi aspetta la mia domanda.", { fields: fields.join(", ") }));
  }
  c.items.forEach((it, i) => {
    lines.push("", `${i + 1}. ${it.text.trim()}`);
    const from = [it.app, it.title, it.url].filter(Boolean).join(" — ");
    if (from) lines.push(`   ${t("Fonte")}: ${from}`);
    if (it.image) lines.push(`   ${t("Immagine")}: ${it.image}`);
  });
  return { label: t("Raccolta «{name}» ({n})", { name, n: c.items.length }), text: lines.join("\n") };
}

/** The panel in «File e schermo». */
export function buildCollectPanel(actions: ViewActions): ViewHost {
  const name = h("input", { class: "col-name", type: "text", spellcheck: "false", placeholder: t("Nome, es. Preventivo Rossi") }) as HTMLInputElement;
  const fields = h("input", { class: "col-fields", type: "text", spellcheck: "false", placeholder: t("Campi da ricavare (facoltativi): Prodotto, Prezzo, Fornitore") }) as HTMLInputElement;
  const count = h("span", { class: "files-count" });
  const list = h("div", { class: "col-list" });
  const empty = h("div", { class: "files-note" });
  const ask = h("button", { class: "col-ask", text: t("Chiedi alla chat") }) as HTMLButtonElement;
  const wipe = h("button", { class: "files-clear", text: t("Svuota") }) as HTMLButtonElement;
  const el = h("div", { class: "col-panel" },
    h("div", { class: "files-head" }, h("b", { text: t("Raccolta") }), count, wipe),
    h("div", { class: "col-meta" }, name, fields),
    list, empty, h("div", { class: "col-row" }, ask));

  const edit = (input: HTMLInputElement, set: (v: string) => void) => {
    // The island must not close under the cursor while a field is being written.
    input.addEventListener("focus", () => actions.holdOpen(true));
    input.addEventListener("blur", () => actions.holdOpen(false));
    input.addEventListener("change", () => { set(input.value); void save(); });
  };
  edit(name, (v) => { current.name = v.trim(); });
  edit(fields, (v) => { current.fields = v.trim(); });

  let confirming = false;
  wipe.addEventListener("click", () => {
    if (!confirming) {
      confirming = true;
      wipe.textContent = t("Sicuro? Clic per svuotare");
      wipe.classList.add("confirm");
      window.setTimeout(() => { confirming = false; key = ""; State.notify(); }, 3000);
      return;
    }
    confirming = false;
    current.items = [];
    void save();
  });
  ask.addEventListener("click", () => {
    if (!current.items.length) return;
    const c = collectionForChat(current);
    actions.askAboutText(c.label, c.text);
  });

  let key = "";
  return {
    el,
    sync() {
      void loadCollection();
      const k = `${current.name}|${current.fields}|${confirming}|${State.settings.hotkeyCollect}|` + current.items.map((i) => i.id).join(",");
      if (k === key) return;
      key = k;
      if (document.activeElement !== name) name.value = current.name;
      if (document.activeElement !== fields) fields.value = current.fields;
      const n = current.items.length;
      count.textContent = n ? `· ${n}` : "";
      wipe.style.display = n ? "" : "none";
      if (!confirming) {
        wipe.textContent = t("Svuota");
        wipe.classList.remove("confirm");
      }
      ask.disabled = !n;
      const hotkey = State.settings.hotkeyCollect || t("la scorciatoia della Raccolta");
      empty.textContent = n ? "" : t("Seleziona del testo in qualsiasi app, anche un nome e un prezzo su un sito, e premi {key}: finisce qui con la sua fonte. Da «Riquadra e chiedi» anche una zona dello schermo. Poi «Chiedi alla chat».", { key: hotkey });
      empty.style.display = n ? "none" : "";
      clear(list);
      for (const it of current.items) {
        const from = [it.app.replace(/\.exe$/i, ""), it.title].filter(Boolean).join(" · ") || (it.image ? t("Zona dello schermo") : "");
        const remove = h("button", { class: "clip-btn", style: "--c:#F4505E", title: t("Togli dalla raccolta"),
          onclick: () => { current.items = current.items.filter((x) => x.id !== it.id); void save(); } }, svg(ICONS.xmark, 11));
        const source = it.url
          ? h("a", { class: "col-src", text: from || it.url, title: it.url, href: "#", onclick: (e: Event) => { e.preventDefault(); actions.openUrl(it.url); } })
          : h("span", { class: "col-src", text: from });
        list.append(h("div", { class: "col-item" },
          h("div", { class: "col-text", text: it.text.trim() || t("(nessun testo)"), title: it.text }),
          h("div", { class: "col-foot" }, source, remove)));
      }
    },
  };
}
