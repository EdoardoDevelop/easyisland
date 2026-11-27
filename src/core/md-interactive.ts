// Answers that can be used, not only read (26 Nov 2026, Edoardo):
// - a list of «- [ ] …» items is a procedure to tick: «3 di 7», the ticks kept
//   on this PC, a step asked about, the whole saved to the memory;
// - a block of code with {{Nome}} (or {{Nome|valore}}) has fields above it:
//   the command fills in as you type and is copied, saved or written in the
//   terminal already complete.
// Both only text the engine wrote: no code of its own runs.

import "./md-interactive.css";
import { t } from "./i18n";

/** «[ ] text» or «[x] text» at the start of a list item. */
export const TASK = /^\[( |x|X)\]\s+(.*)$/;

/** «{{IP}}», «{{Gateway|192.168.1.1}}»: a value to fill in a block of code. */
const FIELD = /\{\{\s*([\p{L}\p{N}_ .-]{1,30}?)\s*(?:\|([^{}\n]{0,60}))?\}\}/gu;

const CHECKS = "easyisland.chatChecks";
const KEPT = 300;

function hash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0).toString(36);
}

/** The ticks kept, list by list (only this PC: a convenience, not data). */
function readChecks(): Record<string, string> {
  try {
    const all: unknown = JSON.parse(localStorage.getItem(CHECKS) ?? "{}");
    return all && typeof all === "object" ? (all as Record<string, string>) : {};
  } catch {
    return {};
  }
}

function writeChecks(key: string, marks: string) {
  try {
    const all = readChecks();
    delete all[key];
    all[key] = marks;
    const keys = Object.keys(all);
    for (const old of keys.slice(0, Math.max(0, keys.length - KEPT))) delete all[old];
    localStorage.setItem(CHECKS, JSON.stringify(all));
  } catch {
    /* storage off: the ticks last until the chat is laid again */
  }
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/**
 * A list with tasks (its items carry `data-task` " " or "x" and `data-text`)
 * as a procedure: a box per step, how many are done, «?» on a step and
 * «Salva in memoria» when `ask` puts a request in the chat's field.
 */
export function checklist(list: HTMLElement, ask?: (text: string) => void): HTMLElement {
  const items = [...list.querySelectorAll<HTMLLIElement>(":scope > li[data-task]")];
  const texts = items.map((li) => li.dataset.text ?? "");
  const key = hash(texts.join("\n"));
  const kept = readChecks()[key];
  const box = el("div", "md-checklist");
  const head = el("div", "md-check-head");
  const count = el("span", "md-check-count");
  const bar = el("span", "md-check-bar");
  const fill = el("span", "md-check-fill");
  bar.append(fill);
  head.append(count, bar);
  const boxes: HTMLInputElement[] = [];
  const paint = () => {
    const done = boxes.filter((b) => b.checked).length;
    count.textContent = t("{n} di {m} fatti", { n: done, m: boxes.length });
    fill.style.width = `${boxes.length ? Math.round((done / boxes.length) * 100) : 0}%`;
    box.classList.toggle("all-done", done === boxes.length && done > 0);
  };
  items.forEach((li, i) => {
    li.classList.add("md-task");
    const check = el("input");
    check.type = "checkbox";
    check.checked = kept ? kept[i] === "1" : li.dataset.task !== " ";
    check.disabled = !ask;
    check.setAttribute("aria-label", texts[i]);
    check.addEventListener("change", () => {
      li.classList.toggle("done", check.checked);
      writeChecks(key, boxes.map((b) => (b.checked ? "1" : "0")).join(""));
      paint();
    });
    boxes.push(check);
    li.classList.toggle("done", check.checked);
    const label = el("span", "md-task-text");
    label.append(...li.childNodes);
    li.append(check, label);
    if (ask) {
      const q = el("button", "md-task-ask", "?");
      q.title = t("Chiedi su questo passo");
      q.addEventListener("click", () => ask(t("Sul passo «{s}»: {{domanda}}", { s: texts[i] })));
      li.append(q);
    }
  });
  if (ask) {
    const save = el("button", "md-check-save", t("Salva in memoria"));
    save.title = t("Prepara nel campo la richiesta di salvare questa procedura nella memoria");
    save.addEventListener("click", () => {
      const steps = texts.map((s, i) => `${i + 1}. ${s}`).join("\n");
      ask(t("Salva nella memoria questa procedura, nella pagina di {{cliente o argomento}}:\n{steps}", { steps }));
    });
    head.append(save);
  }
  paint();
  box.append(head, list);
  return box;
}

/** Values given to the fields, by name, for the next blocks too (this session). */
const given = new Map<string, string>();
/** The fields on screen by name: a value written in one goes to the others of that name. */
const twins = new Map<string, Set<WeakRef<HTMLInputElement>>>();

function echo(name: string, from: HTMLInputElement) {
  const set = twins.get(name);
  if (!set) return;
  for (const ref of set) {
    const other = ref.deref();
    if (!other) set.delete(ref);
    else if (other !== from && other.value !== from.value) {
      other.value = from.value;
      other.dispatchEvent(new Event("input"));
    }
  }
}

/** The fields of a block of code: none when it has no {{…}}. */
export function fieldsOf(code: string): { name: string; value: string }[] {
  const out: { name: string; value: string }[] = [];
  for (const m of code.matchAll(FIELD)) {
    const name = m[1].trim();
    if (!out.some((f) => f.name.toLowerCase() === name.toLowerCase())) out.push({ name, value: (m[2] ?? "").trim() });
  }
  return out.slice(0, 12);
}

/**
 * The fields above a block of code. `changed` gets the code with what is
 * written in them (a field left empty stays {{Nome}}) and whether all are filled.
 */
export function codeFields(code: string, changed: (filled: string, complete: boolean) => void): HTMLElement {
  const fields = fieldsOf(code);
  const row = el("div", "md-fields");
  const inputs = new Map<string, HTMLInputElement>();
  const update = () => {
    let complete = true;
    const filled = code.replace(FIELD, (whole, raw: string) => {
      const v = inputs.get(raw.trim().toLowerCase())?.value.trim() ?? "";
      if (!v) complete = false;
      return v || whole;
    });
    changed(filled, complete);
  };
  for (const f of fields) {
    const label = el("label", "md-field");
    const name = el("span", "md-field-name", f.name);
    const input = el("input");
    input.type = "text";
    input.spellcheck = false;
    input.placeholder = f.value || f.name;
    input.value = given.get(f.name.toLowerCase()) ?? f.value;
    input.size = Math.max(6, Math.min(28, (input.value || input.placeholder).length + 2));
    const key = f.name.toLowerCase();
    if (!twins.has(key)) twins.set(key, new Set());
    twins.get(key)?.add(new WeakRef(input));
    input.addEventListener("input", () => {
      given.set(key, input.value);
      input.classList.toggle("empty", !input.value.trim());
      update();
      echo(key, input);
    });
    // Enter in a field: on to the next one, as Tab.
    input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const all = [...inputs.values()];
      all[(all.indexOf(input) + 1) % all.length]?.focus();
    });
    input.classList.toggle("empty", !input.value.trim());
    inputs.set(f.name.toLowerCase(), input);
    label.append(name, input);
    row.append(label);
  }
  queueMicrotask(update);
  return row;
}

/**
 * The options of a ```scelte block (one per line, «- » or «1. » allowed),
 * at most 6, each at most 120 characters; none when fewer than two.
 */
export function choicesOf(body: string): string[] {
  const out = body
    .split("\n")
    .map((l) => l.trim().replace(/^(?:[-*•]|\d{1,2}[.)])\s+/, "").trim())
    .filter((l) => l && l.length <= 120);
  return out.length >= 2 ? out.slice(0, 6) : [];
}

/**
 * A question with options (26 Nov 2026): a button each, which sends that
 * answer at once. The chat (views/chat.ts) turns them off under older replies
 * and marks the one picked.
 */
export function choicesBlock(options: string[], reply?: (text: string) => void): HTMLElement {
  const box = el("div", "md-choices");
  for (const o of options) {
    const b = el("button", "md-choice", o);
    b.type = "button";
    b.dataset.choice = o;
    b.title = reply ? t("Rispondi così") : "";
    b.disabled = !reply;
    b.addEventListener("click", () => {
      if (b.disabled) return;
      box.querySelectorAll("button").forEach((x) => (x.disabled = true));
      b.classList.add("picked");
      reply?.(o);
    });
    box.append(b);
  }
  return box;
}
