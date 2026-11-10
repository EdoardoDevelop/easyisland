// A «link» of an integrazione personale (custom.rs, docs/integrazioni.md):
// a box that searches the records of another integration as you type (a
// client, a service of a price list, an article…) and, on a pick, fills other
// fields from that record (`fill`). Generic on purpose: nothing here knows
// what the records are. What is written by hand stays as it is; with
// `remember` it is added to the other integration when the record is saved.

import { h, clear } from "./dom";
import { t } from "../core/i18n";
import { Bridge } from "../core/bridge";
import { State, type Custom, type CustomLink, type CustomRecord } from "../core/state";

/** The records of a source, read once for a few seconds (every picker of a card shares them). */
const cache = new Map<string, { at: number; list: Promise<CustomRecord[]> }>();

export function sourceRecords(id: string): Promise<CustomRecord[]> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < 5000) return hit.list;
  const list = Bridge.customRecords(id).then((r) => r ?? [], () => [] as CustomRecord[]);
  cache.set(id, { at: Date.now(), list });
  return list;
}

/** A record added to a source (remember, the chat): read it again next time. */
export function forgetSource(id: string) {
  cache.delete(id);
}

/** "Città" and "citta", "PERONI" and "Peroni" match. */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Every value of a record as one line of text to search in (tables too). */
function haystack(r: CustomRecord): string {
  return fold(Object.values(r.values).map((v) => (v && typeof v === "object" ? JSON.stringify(v) : String(v ?? ""))).join(" "));
}

/** What custom.ts lends: how a record is named, and a value of it by `fill`'s spec. */
export interface LinkKit {
  titleOf: (c: Custom, r: CustomRecord) => string;
  valueOf: (c: Custom, r: CustomRecord, spec: string) => unknown;
  /** The same value as it reads (euro, dates), for the line under a match. */
  textOf: (c: Custom, r: CustomRecord, spec: string) => string;
  hold: (el: HTMLElement) => void;
}

/** The values `fill` takes from a record: target → value. */
export function filledFrom(link: CustomLink, source: Custom, r: CustomRecord, kit: LinkKit): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [to, spec] of Object.entries(link.fill ?? {})) out[to] = kit.valueOf(source, r, spec);
  return out;
}

export interface Picker {
  el: HTMLElement;
  /** Where the list of matches goes (under the box, or a row of its own in a table). */
  list: HTMLElement;
}

/**
 * The box. `pick` gets the record's name and the values to fill; `typed` every
 * change by hand (the value is the text as it is).
 */
export function linkPicker(link: CustomLink, value: string, kit: LinkKit, pick: (name: string, filled: Record<string, unknown>) => void,
  typed: (text: string) => void): Picker {
  const source = State.customs.find((x) => x.id === link.source) ?? null;
  const input = h("input", {
    type: "text", class: "custom-input custom-pick-input", value, spellcheck: "false", autocomplete: "off",
    role: "combobox", "aria-autocomplete": "list", "aria-expanded": "false",
    placeholder: source ? t("Cerca in {name}…", { name: source.name }) : t("Integrazione collegata non trovata"),
  }) as HTMLInputElement;
  kit.hold(input);
  const list = h("div", { class: "custom-pick-list", role: "listbox" });
  list.style.display = "none";
  const el = h("div", { class: "custom-pick" }, input);
  let found: CustomRecord[] = [];
  let active = -1;
  let records: CustomRecord[] = [];
  let shown = false;

  const close = () => {
    shown = false;
    active = -1;
    list.style.display = "none";
    input.setAttribute("aria-expanded", "false");
  };

  const choose = (r: CustomRecord) => {
    if (!source) return;
    const name = kit.titleOf(source, r);
    input.value = name;
    close();
    pick(name, filledFrom(link, source, r, kit));
  };

  /** A second line under the name: the values it would fill, so two «Rossi» can be told apart. */
  const detail = (r: CustomRecord) => {
    if (!source) return "";
    const parts = Object.values(link.fill ?? {}).map((spec) => kit.textOf(source, r, spec).trim()).filter(Boolean);
    return [...new Set(parts)].slice(0, 3).join(" · ");
  };

  const draw = () => {
    clear(list);
    if (!source) return;
    const q = fold(input.value.trim());
    found = records.filter((r) => !q || haystack(r).includes(q))
      // Those whose name starts with what is written first, then by name.
      .sort((a, b) => {
        const na = fold(kit.titleOf(source, a));
        const nb = fold(kit.titleOf(source, b));
        return Number(nb.startsWith(q)) - Number(na.startsWith(q)) || na.localeCompare(nb);
      })
      .slice(0, 8);
    if (active >= found.length) active = found.length - 1;
    found.forEach((r, i) => {
      const item = h("button", { class: i === active ? "custom-pick-item on" : "custom-pick-item", type: "button", role: "option", "aria-selected": String(i === active) },
        h("span", { class: "custom-pick-name", text: kit.titleOf(source, r) }),
        h("span", { class: "custom-pick-detail", text: detail(r) }));
      // Before the box loses the focus, or the list would be gone first.
      item.addEventListener("pointerdown", (e) => e.preventDefault());
      item.addEventListener("click", () => choose(r));
      list.append(item);
    });
    // Said only when nothing matches: while searching, a part of a name is not a new one.
    const text = input.value.trim();
    if (!found.length) {
      list.append(h("div", { class: "custom-pick-new", text: !text
        ? t("Nessuna scheda in {name}.", { name: source.name })
        : link.remember
          ? t("«{text}» è nuovo: salvando la scheda lo aggiungo a {name}.", { text, name: source.name })
          : t("«{text}» non è in {name}: resta scritto così.", { text, name: source.name }) }));
    }
    shown = true;
    list.style.display = "";
    input.setAttribute("aria-expanded", "true");
  };

  const open = () => {
    if (!source) return;
    void sourceRecords(source.id).then((r) => {
      records = r;
      if (document.activeElement === input) draw();
    });
  };

  input.addEventListener("focus", open);
  input.addEventListener("input", () => {
    active = -1;
    typed(input.value);
    if (records.length || !source) draw();
    else open();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!shown) {
        open();
        return;
      }
      if (!found.length) return;
      active = e.key === "ArrowDown" ? (active + 1) % found.length : (active <= 0 ? found.length : active) - 1;
      draw();
    } else if (e.key === "Enter" && shown && active >= 0 && found[active]) {
      e.preventDefault();
      choose(found[active]);
    } else if (e.key === "Escape" && shown) {
      // Only the list: the island stays open.
      e.stopPropagation();
      close();
    }
  });
  input.addEventListener("blur", () => window.setTimeout(close, 120));
  return { el, list };
}
