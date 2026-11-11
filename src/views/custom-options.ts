// A «select» of an integrazione personale whose choices come from one of its
// own sources (custom.rs `optionsFrom`, docs/integrazioni.md): the models and
// voices of a service, read when the card opens and kept a few minutes. A box
// that searches as you type (lists of 30–100 and more), the list over the form
// like the links' (custom-link.ts, same classes). `match` picks the item equal
// to another field's value and `list` its inner list (a select that depends on
// another); `fill` copies paths of the choice into other fields. If the service
// does not answer, the value stays and can be written by hand. Generic: nothing
// here knows what the choices are.

import { h, clear } from "./dom";
import { t } from "../core/i18n";
import { Bridge } from "../core/bridge";
import { pick, type Val } from "../core/expr";
import type { Custom, CustomField } from "../core/state";

/** The answer of each source ("id/source") for five minutes, shared by every select of a card. */
const cache = new Map<string, { at: number; data: Promise<Val> }>();
const KEEP_MS = 5 * 60_000;

function sourceData(c: Custom, source: string): Promise<Val> {
  const key = `${c.id}/${source}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.data;
  const data = Bridge.customFetch(c.id, source).then((r) => {
    if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
    return r.data as Val;
  });
  // A failure is not kept: the next opening tries again.
  data.catch(() => cache.delete(key));
  cache.set(key, { at: Date.now(), data });
  return data;
}

export interface Choice {
  value: string;
  label: string;
  item: Val;
}

const text = (v: Val): string => (v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v));

/** {{campo}} of `match` with the form's values. */
function filled(tpl: string, values: Record<string, unknown>): string {
  return tpl.replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (_, k: string) => String(values[k] ?? ""));
}

/** The fields a select's `match` reads: emptied when one of them changes. */
export function dependsOn(f: CustomField, id: string): boolean {
  return Object.values(f.optionsFrom?.match ?? {}).some((v) => new RegExp(`\\{\\{\\s*${id}\\s*\\}\\}`).test(v));
}

/** The choices out of a source's answer, for these values; null when `match` waits for another field. */
export function choicesOf(c: Custom, f: CustomField, data: Val, values: Record<string, unknown>): Choice[] | null {
  const o = f.optionsFrom;
  if (!o) return [];
  const s = (c.sources ?? []).find((x) => x.id === o.source);
  const all = pick(data, s?.items ?? "");
  let items: Val[] = Array.isArray(all) ? all : [];
  const rules = Object.entries(o.match ?? {}).map(([path, tpl]) => [path, filled(tpl, values)] as const);
  if (rules.length) {
    if (rules.some(([, want]) => !want)) return null;
    items = items.filter((it) => rules.every(([path, want]) => text(pick(it, path)) === want));
  }
  const raw: Val[] = o.list ? items.flatMap((it) => {
    const inner = pick(it, o.list ?? "");
    return Array.isArray(inner) ? inner : [];
  }) : items;
  const out: Choice[] = [];
  const seen = new Set<string>();
  for (const ch of raw) {
    const object = ch != null && typeof ch === "object" && !Array.isArray(ch);
    const value = text(o.value ? pick(ch, o.value) : object ? pick(ch, "id") : ch);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push({ value, label: text(o.label ? pick(ch, o.label) : null) || value, item: ch });
  }
  return out;
}

/** "Città" and "citta" match. */
const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Shown at most: every voice of a model (about a hundred), the list scrolls. */
const MAX_SHOWN = 500;
const LIST_H = 240;

/**
 * The box. `chose` gets the value and the fields `fill` takes from the choice;
 * `typed` every change by hand. `values` is read when the list opens (for `match`).
 */
export function optionsPicker(c: Custom, f: CustomField, values: () => Record<string, unknown>, hold: (el: HTMLElement) => void,
  chose: (value: string, fill: Record<string, unknown>) => void, typed: (text: string) => void): HTMLElement {
  const current = text((values()[f.id] ?? "") as Val);
  const input = h("input", {
    type: "text", class: "custom-input custom-pick-input", value: current, spellcheck: "false", autocomplete: "off",
    role: "combobox", "aria-autocomplete": "list", "aria-expanded": "false", placeholder: f.help || t("Cerca…"),
    // custom.ts finds the box of a dependent select to empty it.
    "data-field": f.id,
  }) as HTMLInputElement;
  hold(input);
  const list = h("div", { class: "custom-pick-list", role: "listbox" });
  list.style.display = "none";
  const el = h("div", { class: "custom-pick" }, input, list);

  let choices: Choice[] | null = [];
  let error = "";
  let loaded = false;
  let found: Choice[] = [];
  let active = -1;
  let shown = false;

  const place = () => {
    const area = el.closest<HTMLElement>(".custom-body") ?? document.body;
    const a = area.getBoundingClientRect();
    const b = input.getBoundingClientRect();
    const need = Math.min(LIST_H, list.scrollHeight || LIST_H);
    list.classList.toggle("up", a.bottom - b.bottom < need && b.top - a.top > a.bottom - b.bottom);
    el.classList.toggle("end", b.left + Math.max(b.width, list.offsetWidth) > a.right - 4);
  };
  const reveal = () => {
    const item = list.querySelector<HTMLElement>(".custom-pick-item.on");
    if (!item) return;
    if (item.offsetTop < list.scrollTop) list.scrollTop = item.offsetTop;
    else if (item.offsetTop + item.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = item.offsetTop + item.offsetHeight - list.clientHeight;
  };
  const close = () => {
    shown = false;
    active = -1;
    list.style.display = "none";
    input.setAttribute("aria-expanded", "false");
  };
  const choose = (ch: Choice) => {
    input.value = ch.label;
    input.title = ch.value;
    close();
    const fill: Record<string, unknown> = {};
    for (const [to, spec] of Object.entries(f.fill ?? {})) {
      fill[to] = spec.includes("{{")
        ? spec.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (_, path: string) => text(pick(ch.item, path) ?? null))
        : pick(ch.item, spec);
    }
    chose(ch.value, fill);
  };
  const note = (s: string) => list.append(h("div", { class: "custom-pick-new", text: s }));

  const draw = () => {
    clear(list);
    const q = fold(input.value.trim());
    // The box shows the label of the value chosen: with it as it is, every choice.
    const all = choices ?? [];
    const exact = all.some((ch) => fold(ch.label) === q || fold(ch.value) === q);
    found = all.filter((ch) => !q || exact || fold(`${ch.label} ${ch.value}`).includes(q))
      .sort((a, b) => Number(fold(b.label).startsWith(q)) - Number(fold(a.label).startsWith(q)))
      .slice(0, MAX_SHOWN);
    if (active >= found.length) active = found.length - 1;
    found.forEach((ch, i) => {
      const item = h("button", { class: i === active ? "custom-pick-item on" : "custom-pick-item", type: "button", role: "option", "aria-selected": String(i === active) },
        h("span", { class: "custom-pick-name", text: ch.label }),
        h("span", { class: "custom-pick-detail", text: ch.label === ch.value ? "" : ch.value }));
      item.addEventListener("pointerdown", (e) => e.preventDefault());
      item.addEventListener("click", () => choose(ch));
      list.append(item);
    });
    if (!loaded) note("…");
    else if (error) note(t("Scelte non lette ({e}): scrivi il valore a mano.", { e: error }));
    else if (choices == null) {
      const other = Object.values(f.optionsFrom?.match ?? {}).join(" ").match(/\{\{\s*([A-Za-z0-9_]+)/)?.[1] ?? "";
      const label = c.fields.find((x) => x.id === other)?.label ?? other;
      note(t("Scegli prima «{name}».", { name: label }));
    } else if (!found.length) note(all.length ? t("Nessuna scelta con «{text}»: resta scritto così.", { text: input.value.trim() }) : t("Nessuna scelta."));
    else if (all.length > 12 && !q) note(t("{n} scelte: scrivi per cercare.", { n: all.length }));
    shown = true;
    list.style.display = "";
    input.setAttribute("aria-expanded", "true");
    place();
    reveal();
  };

  const load = async (show: boolean) => {
    try {
      const data = await sourceData(c, f.optionsFrom?.source ?? "");
      choices = choicesOf(c, f, data, values());
      error = "";
    } catch (e) {
      choices = [];
      error = String(e).replace(/^Error:\s*/, "");
    }
    loaded = true;
    // The value saved, read by its label.
    const now = text((values()[f.id] ?? "") as Val);
    const known = choices?.find((ch) => ch.value === now);
    if (known && document.activeElement !== input) {
      input.value = known.label;
      input.title = known.value;
    }
    if (show && document.activeElement === input) draw();
  };

  input.addEventListener("focus", () => {
    loaded = false;
    draw();
    void load(true);
  });
  input.addEventListener("input", () => {
    active = -1;
    // A label typed or left as it is saves its value; anything else as written.
    const ch = choices?.find((x) => x.label === input.value || x.value === input.value);
    typed(ch ? ch.value : input.value);
    draw();
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!shown) {
        draw();
        return;
      }
      if (!found.length) return;
      active = e.key === "ArrowDown" ? (active + 1) % found.length : (active <= 0 ? found.length : active) - 1;
      draw();
    } else if (e.key === "Enter" && shown && active >= 0 && found[active]) {
      e.preventDefault();
      choose(found[active]);
    } else if (e.key === "Escape" && shown) {
      e.stopPropagation();
      close();
    }
  });
  input.addEventListener("blur", () => window.setTimeout(close, 120));
  // The label of the value saved, as soon as the source is there (from the cache when it is).
  if (current) void load(false);
  return el;
}
