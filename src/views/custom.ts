// An integration the user made from the chat (custom.rs): its form, the rows of
// its tables, the computed values, the data read from services, the document
// from its template, its actions and the records saved. Everything comes from
// the description; nothing here runs code from it: formulas go through
// core/expr.ts (read here, never eval), the template is filled as text, calls
// to services go through Rust (only to the hosts in the description, keys put
// in there), actions are a fixed set.

import { h, clear } from "./dom";
import { Bridge } from "../core/bridge";
import { renderMarkdown } from "../core/markdown";
import { num, pick, scopeOf, truthy, tryRun, type Val } from "../core/expr";
import {
  State, type AgentTask, type Custom, type CustomAction, type CustomField, type CustomRecord, type CustomSource, type Notice,
} from "../core/state";
import { t } from "../core/i18n";
import { Sound } from "../core/sound";

export interface CustomHooks {
  askChat(question: string): void;
  runQuick(id: string): void;
  holdOpen(on: boolean): void;
  showNotice(n: Notice): void;
}

type Row = Record<string, unknown>;

/** What the card keeps for each integration while EasyIsland runs. */
interface Draft {
  tab: "form" | "list" | "data";
  record: string;
  values: Record<string, unknown>;
  records: CustomRecord[] | null;
  query: string;
  note: { text: string; ok: boolean } | null;
  /** The last answer of an "http" action, for {{risposta.…}}. */
  answer: Val;
}

const drafts = new Map<string, Draft>();

/** The last data of each source ("id/source"), from Rust's poller or "Aggiorna". */
const sourceData = new Map<string, { at: string; data?: Val; error?: string; status?: number }>();
/** Items already alerted for ("id/source/key"): an alert is said once. */
const alerted = new Set<string>();

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** A field's starting value. */
function initial(f: CustomField): unknown {
  switch (f.kind) {
    case "checkbox":
      return f.default === "true";
    case "multiselect":
      return f.default ? f.default.split(",").map((x) => x.trim()).filter(Boolean) : [];
    case "rows":
      return [];
    case "counter":
      return "";
    case "number":
    case "money":
      return f.default ? num(f.default) : null;
    case "date":
      return f.default === "oggi" || f.default === "today" ? today() : f.default;
    default:
      return f.default ?? "";
  }
}

function blank(c: Custom): Record<string, unknown> {
  const v: Record<string, unknown> = {};
  for (const f of c.fields) if (f.kind !== "computed") v[f.id] = initial(f);
  return v;
}

function draftOf(c: Custom): Draft {
  let d = drafts.get(c.id);
  if (!d) {
    const tab: Draft["tab"] = c.fields.length ? "form" : "data";
    d = { tab, record: "", values: blank(c), records: null, query: "", note: null, answer: null };
    drafts.set(c.id, d);
  }
  return d;
}

function toNumber(v: unknown): number | null {
  return num(v as Val);
}

function rounded(v: Val): Val {
  return typeof v === "number" ? Math.round(v * 100) / 100 : v;
}

/** A formula over the values (core/expr.ts); null when it cannot be read. */
export function evalFormula(formula: string, values: Record<string, unknown>, fields: CustomField[]): Val {
  return rounded(tryRun(formula, scopeOf(values, fields.filter((f) => f.kind === "rows").map((f) => f.id))));
}

/** A formula over one row's columns ("quantita*prezzo"), the record's values behind them. */
export function rowFormula(formula: string, row: Row, values: Record<string, unknown> = {}): Val {
  return rounded(tryRun(formula, scopeOf({ ...values, ...row })));
}

/** The values with the computed columns and fields filled in, in order. */
export function withComputed(c: Custom, values: Record<string, unknown>): Record<string, unknown> {
  const all = { ...values };
  for (const f of c.fields) {
    if (f.kind !== "rows" || !Array.isArray(all[f.id])) continue;
    const cols = f.columns.filter((x) => x.kind === "computed" && x.formula);
    if (!cols.length) continue;
    all[f.id] = (all[f.id] as Row[]).map((row) => {
      const out = { ...row };
      for (const col of cols) out[col.id] = rowFormula(col.formula ?? "", out, values);
      return out;
    });
  }
  for (const f of c.fields) if (f.kind === "computed") all[f.id] = evalFormula(f.formula, all, c.fields);
  return all;
}

/** showIf: any formula ("urgente", "pagamento=Bonifico", "totale > 1000 e non urgente"). Empty: always. */
export function visible(f: CustomField, values: Record<string, unknown>): boolean {
  const rule = (f.showIf ?? "").trim();
  return !rule || truthy(tryRun(rule, scopeOf(values)));
}

// "always": 1.501,00 € (Italian grouping starts only at five digits otherwise).
const money = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", useGrouping: "always" } as unknown as Intl.NumberFormatOptions);

/** How a computed value reads: its format, or money for a number. */
function formatOf(f: { kind: string; format?: string }): string {
  if (f.kind !== "computed") return f.kind;
  return f.format || "money";
}

/** A value as it reads in a document or a list. */
function shown(kind: string, v: unknown): string {
  if (v == null || v === "") return "";
  switch (kind) {
    case "money":
    case "computed": {
      const n = toNumber(v);
      return n == null ? String(v) : money.format(n);
    }
    case "number": {
      const n = toNumber(v);
      return n == null ? String(v) : n.toLocaleString("it-IT");
    }
    case "percent": {
      const n = toNumber(v);
      return n == null ? String(v) : `${(n * 100).toLocaleString("it-IT", { maximumFractionDigits: 1 })}%`;
    }
    case "checkbox":
    case "yesno":
      return truthy(v as Val) ? t("Sì") : t("No");
    case "date": {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
      return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v);
    }
    case "multiselect":
      return Array.isArray(v) ? v.join(", ") : String(v);
    case "file":
      return String(v).split(/[\\/]/).pop() ?? String(v);
    case "text":
    default:
      return typeof v === "object" ? JSON.stringify(v) : String(v);
  }
}

/** {{campo}} and {{risposta.percorso}} in a text, as they read. */
function fillText(c: Custom, text: string, all: Record<string, unknown>, answer: Val, encode = false): string {
  const byId = new Map(c.fields.map((f) => [f.id, f]));
  return text.replace(/\{\{([A-Za-zÀ-ÿ0-9_.]+)\}\}/g, (m, k: string) => {
    if (k.startsWith("secret:")) return m;
    let out: string | null = null;
    if (k === "oggi") out = shown("date", today());
    else if (k === "risposta" || k.startsWith("risposta.")) {
      const v = pick(answer, k.slice("risposta.".length));
      out = v == null ? "" : typeof v === "object" ? JSON.stringify(v) : String(v);
    } else {
      const f = byId.get(k);
      if (f) out = shown(formatOf(f), all[k]);
      else if (k.includes(".")) {
        const v = pick(all as Val, k);
        out = v == null ? "" : String(v);
      }
    }
    if (out == null) return m;
    return encode ? encodeURIComponent(out) : out;
  });
}

/** The same for a request's body: values that are not text go in as JSON. */
function fillBody(c: Custom, text: string, all: Record<string, unknown>, answer: Val): string {
  return text.replace(/\{\{([A-Za-zÀ-ÿ0-9_.]+)\}\}/g, (m, k: string) => {
    if (k.startsWith("secret:")) return m;
    const f = c.fields.find((x) => x.id === k);
    if (!f) return fillText(c, m, all, answer);
    const v = all[k];
    // Inside quotes: the text; outside: the JSON value (numbers, lists, rows).
    return typeof v === "string" ? v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') : JSON.stringify(v ?? null);
  });
}

/** The template filled: {{campo}}, and {{#tabella}}…{{colonna}}…{{/tabella}} once per row. */
export function fillTemplate(c: Custom, values: Record<string, unknown>, answer: Val = null): string {
  const all = withComputed(c, values);
  const byId = new Map(c.fields.map((f) => [f.id, f]));
  const text = c.template.replace(/\{\{#([A-Za-z0-9_]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, id: string, body: string) => {
    const f = byId.get(id);
    const rows = (all[id] as Row[] | undefined) ?? [];
    if (!f || f.kind !== "rows") return "";
    return rows.map((row, i) => body.replace(/\{\{([A-Za-z0-9_#]+)\}\}/g, (m, k: string) => {
      if (k === "#") return String(i + 1);
      const col = f.columns.find((x) => x.id === k);
      return col ? shown(col.kind === "computed" ? formatOf({ kind: "computed", format: col.format }) : col.kind, row[k]) : m;
    })).join("");
  });
  return fillText(c, text, all, answer);
}

/** A printable page from the Markdown (the island's renderer, no script). */
function asHtml(title: string, md: string): string {
  const box = document.createElement("div");
  box.append(...renderMarkdown(md, { openUrl: () => {} }));
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{font:15px/1.5 "Segoe UI",system-ui,sans-serif;color:#111;max-width:780px;margin:40px auto;padding:0 24px}
h1,h2,h3{line-height:1.25}table{border-collapse:collapse;width:100%;margin:12px 0}
th,td{border:1px solid #ccc;padding:6px 8px;text-align:left}th{background:#f3f3f3}
code{font-family:Consolas,monospace}@media print{body{margin:0}}
</style></head><body>${box.innerHTML}</body></html>`;
}

/** The records as CSV (semicolons and a BOM, as Excel reads them in Italy). */
export function toCsv(c: Custom, records: CustomRecord[]): string {
  const cols = c.fields.filter((f) => f.kind !== "rows");
  const cell = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [cols.map((f) => cell(f.label)).join(";")];
  for (const r of records) {
    const all = withComputed(c, r.values);
    lines.push(cols.map((f) => cell(shown(formatOf(f), all[f.id]))).join(";"));
  }
  return "﻿" + lines.join("\r\n");
}

/** The totals of the summary fields over the records: sums, or counts per choice. */
export function summaryOf(c: Custom, records: CustomRecord[]): string[] {
  const out: string[] = [];
  for (const f of c.fields.filter((x) => x.summary)) {
    const fmt = formatOf(f);
    if (["number", "money", "computed", "percent"].includes(fmt) || f.kind === "money" || f.kind === "number") {
      let sum = 0;
      for (const r of records) sum += toNumber(withComputed(c, r.values)[f.id]) ?? 0;
      out.push(`${f.label}: ${shown(fmt === "percent" ? "number" : fmt, sum)}`);
    } else {
      const counts = new Map<string, number>();
      for (const r of records) {
        const v = shown(fmt, withComputed(c, r.values)[f.id]);
        if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      out.push(`${f.label}: ${[...counts].map(([k, n]) => `${k} ${n}`).join(", ") || "—"}`);
    }
  }
  return out;
}

/** The name of a record in the list. */
function titleOf(c: Custom, r: CustomRecord): string {
  const f = c.fields.find((x) => x.id === c.titleField) ?? c.fields.find((x) => x.kind === "text" || x.kind === "counter");
  const v = f ? shown(formatOf(f), r.values[f.id]) : "";
  return v || r.created;
}

// ── Sources ──────────────────────────────────────────────────────────────────

function itemsOf(s: CustomSource, data: Val): Val[] {
  const list = pick(data, s.items ?? "");
  return Array.isArray(list) ? list : [];
}

/** One line for the Panoramica: the first value, or how many items. */
function sourceLine(c: Custom): string | null {
  for (const s of c.sources ?? []) {
    const got = sourceData.get(`${c.id}/${s.id}`);
    if (!got) continue;
    if (got.error) return `${s.label}: ${got.error}`;
    const first = Object.entries(s.values ?? {})[0];
    if (first) return `${first[0]}: ${String(pick(got.data ?? null, String(first[1])) ?? "—")}`;
    if (s.items != null && s.title) return t("{label}: {n}", { label: s.label, n: itemsOf(s, got.data ?? null).length });
  }
  return null;
}

/**
 * New data of a source (Rust's poller or "Aggiorna"): kept for the card, a line
 * for the Panoramica, and the alerts not said yet (once per item).
 */
export function receiveSource(c: Custom, sourceId: string, got: { at: string; data?: Val; error?: string; status?: number }, notify: (n: Notice) => void) {
  sourceData.set(`${c.id}/${sourceId}`, got);
  const task = State.tasks.find((x) => x.id === `custom:${c.id}`);
  const line = sourceLine(c);
  if (task && line) task.steps = [line];
  const s = (c.sources ?? []).find((x) => x.id === sourceId);
  if (!s?.alert || got.error) return;
  const targets: Val[] = s.items != null && Array.isArray(pick(got.data ?? null, s.items ?? "")) ? itemsOf(s, got.data ?? null) : [got.data ?? null];
  for (const item of targets) {
    const scope = scopeOf((item && typeof item === "object" ? item : { valore: item }) as Record<string, unknown>);
    if (!truthy(tryRun(s.alert, scope))) continue;
    const key = `${c.id}/${s.id}/${JSON.stringify(s.title ? pick(item, s.title) : item).slice(0, 200)}`;
    if (alerted.has(key)) continue;
    alerted.add(key);
    const text = (s.alertText || s.label).replace(/\{\{([A-Za-zÀ-ÿ0-9_.]+)\}\}/g, (_, k: string) => String(pick(item, k) ?? ""));
    notify({ title: c.name, text, level: "warn", url: "" });
  }
  if (alerted.size > 2000) alerted.clear();
}

// ── The card ─────────────────────────────────────────────────────────────────

function cardTitle(c: Custom): HTMLElement {
  return h("div", { class: "int-head" },
    h("span", { class: "custom-icon", text: c.icon || "✦" }),
    h("b", { text: c.name }),
    h("span", { text: c.description }));
}

export function customCard(task: AgentTask, hooks: CustomHooks): HTMLElement {
  const c = State.customs.find((x) => `custom:${x.id}` === task.id);
  if (!c) return h("div", { class: "int-card" }, h("div", { class: "int-empty", text: t("Integrazione non trovata.") }));
  const d = draftOf(c);
  let fillOpen = false;
  const root = h("div", { class: "int-card custom-card" });
  root.style.setProperty("--c", c.color);
  const body = h("div", { class: "custom-body" });
  const tabs = h("div", { class: "custom-tabs" });
  const hasForm = c.fields.length > 0;
  const hasData = (c.sources ?? []).length > 0;

  const tab = (id: Draft["tab"], label: string) => {
    const b = h("button", { class: d.tab === id ? "chip-btn on" : "chip-btn", text: label }) as HTMLButtonElement;
    b.addEventListener("click", () => {
      d.tab = id;
      d.note = null;
      paint();
    });
    tabs.append(b);
  };

  function paint() {
    clear(tabs);
    if (hasData) tab("data", t("Dati"));
    if (hasForm) {
      tab("form", d.record ? t("Scheda") : t("Nuova"));
      tab("list", d.records ? t("Salvate ({n})", { n: d.records.length }) : t("Salvate"));
    }
    clear(body);
    if (d.tab === "data" && hasData) body.append(dataView());
    else if (d.tab === "list" && hasForm) body.append(listView());
    else if (hasForm) body.append(formView());
    else body.append(dataView());
  }

  function loadRecords() {
    void Bridge.customRecords(c!.id).then((r) => {
      d.records = r ?? [];
      paint();
    });
  }

  const hold = (el: HTMLElement) => {
    el.addEventListener("focus", () => {
      hooks.holdOpen(true);
      void Bridge.focusWindow(true);
    });
    el.addEventListener("blur", () => hooks.holdOpen(false));
  };

  // ── Data from services ──
  function dataView(): HTMLElement {
    const box = h("div", { class: "custom-list" });
    for (const s of c!.sources ?? []) {
      const key = `${c!.id}/${s.id}`;
      const got = sourceData.get(key);
      const refresh = h("button", { class: "link-btn", text: t("Aggiorna") }) as HTMLButtonElement;
      refresh.addEventListener("click", async () => {
        refresh.disabled = true;
        try {
          const r = await Bridge.customFetch(c!.id, s.id);
          receiveSource(c!, s.id, { at: new Date().toLocaleTimeString(), data: r.data as Val, status: r.status }, hooks.showNotice);
        } catch (e) {
          receiveSource(c!, s.id, { at: new Date().toLocaleTimeString(), error: String(e).replace(/^Error:\s*/, "") }, hooks.showNotice);
        }
        paint();
      });
      box.append(h("div", { class: "custom-source-head" },
        h("b", { text: s.label }),
        h("span", { class: "custom-record-when", text: got ? got.at : s.every ? t("ogni {n} min", { n: s.every }) : "" }),
        refresh));
      if (!got) {
        // The first time the card is opened: read it now.
        if (!s.every) void Promise.resolve().then(() => refresh.click());
        box.append(h("div", { class: "int-empty", text: "…" }));
        continue;
      }
      if (got.error) {
        box.append(h("div", { class: "custom-note err", text: got.error }));
        continue;
      }
      const data = got.data ?? null;
      const vals = Object.entries(s.values ?? {});
      if (vals.length) {
        box.append(h("div", { class: "custom-values" }, ...vals.map(([label, path]) =>
          h("div", { class: "custom-value" }, h("span", { class: "custom-label", text: label }), h("b", { text: String(pick(data, String(path)) ?? "—") })))));
      }
      if (s.title || s.items) {
        const items = itemsOf(s, data);
        const list = h("div", { class: "custom-records" });
        if (!items.length) list.append(h("div", { class: "int-empty", text: t("Nessun elemento.") }));
        for (const item of items.slice(0, 100)) {
          const scope = scopeOf((item && typeof item === "object" ? item : {}) as Record<string, unknown>);
          const warn = s.alert ? truthy(tryRun(s.alert, scope)) : false;
          list.append(h("div", { class: warn ? "custom-record custom-item warn" : "custom-record custom-item" },
            h("span", { class: "custom-record-title" },
              h("span", { text: String(pick(item, s.title || "") ?? JSON.stringify(item).slice(0, 80)) }),
              s.subtitle ? h("span", { class: "custom-item-sub", text: String(pick(item, s.subtitle) ?? "") }) : null),
            s.value ? h("span", { class: "custom-record-when", text: String(pick(item, s.value) ?? "") }) : null));
        }
        box.append(list);
      }
      if (!vals.length && !s.title && !s.items) {
        box.append(h("pre", { class: "custom-raw", text: typeof data === "string" ? data.slice(0, 4000) : JSON.stringify(data, null, 2).slice(0, 4000) }));
      }
    }
    return box;
  }

  // ── The form ──
  function formView(): HTMLElement {
    const box = h("div", { class: "custom-form" });
    const computed: { f: CustomField; out: HTMLElement }[] = [];
    const conditional: { f: CustomField; row: HTMLElement }[] = [];
    const refresh = () => {
      const all = withComputed(c!, d.values);
      for (const { f, out } of computed) out.textContent = shown(formatOf(f), all[f.id]) || "—";
      box.querySelectorAll<HTMLElement>("[data-cell]").forEach((el) => {
        const [table, i, col] = (el.dataset.cell ?? "").split("|");
        const rows = all[table] as Row[] | undefined;
        const column = c!.fields.find((f) => f.id === table)?.columns.find((x) => x.id === col);
        el.textContent = shown(formatOf({ kind: "computed", format: column?.format }), rows?.[Number(i)]?.[col]) || "—";
      });
      for (const { f, row } of conditional) row.style.display = visible(f, all) ? "" : "none";
    };
    for (const f of c!.fields) {
      const label = h("label", { class: "custom-label", text: f.required ? `${f.label} *` : f.label, title: f.help });
      let control: HTMLElement;
      switch (f.kind) {
        case "textarea": {
          const el = h("textarea", { class: "custom-input", rows: 3, placeholder: f.help }) as HTMLTextAreaElement;
          el.value = String(d.values[f.id] ?? "");
          el.addEventListener("input", () => (d.values[f.id] = el.value));
          hold(el);
          control = el;
          break;
        }
        case "checkbox": {
          const el = h("input", { type: "checkbox", class: "custom-check" }) as HTMLInputElement;
          el.checked = d.values[f.id] === true;
          el.addEventListener("change", () => (d.values[f.id] = el.checked));
          control = el;
          break;
        }
        case "select": {
          const el = h("select", { class: "custom-input" }) as HTMLSelectElement;
          el.append(h("option", { value: "", text: "—" }), ...f.options.map((o) => h("option", { value: o, text: o })));
          el.value = String(d.values[f.id] ?? "");
          el.addEventListener("change", () => (d.values[f.id] = el.value));
          hold(el);
          control = el;
          break;
        }
        case "multiselect": {
          const chosen = new Set(Array.isArray(d.values[f.id]) ? (d.values[f.id] as string[]) : []);
          const el = h("div", { class: "custom-multi" });
          for (const o of f.options) {
            const b = h("button", { class: chosen.has(o) ? "chip-btn on" : "chip-btn", text: o }) as HTMLButtonElement;
            b.addEventListener("click", () => {
              if (chosen.has(o)) chosen.delete(o);
              else chosen.add(o);
              b.classList.toggle("on", chosen.has(o));
              d.values[f.id] = f.options.filter((x) => chosen.has(x));
              refresh();
            });
            el.append(b);
          }
          control = el;
          break;
        }
        case "rows":
          control = rowsEditor(f, refresh);
          break;
        case "computed": {
          const out = h("span", { class: "custom-computed" });
          computed.push({ f, out });
          control = out;
          break;
        }
        case "counter": {
          const v = String(d.values[f.id] ?? "");
          control = h("span", { class: "custom-computed", text: v || t("al salvataggio") });
          break;
        }
        case "link":
        case "file": {
          const el = h("select", { class: "custom-input" }) as HTMLSelectElement;
          const current = String(d.values[f.id] ?? "");
          el.append(h("option", { value: "", text: "—" }));
          if (current) el.append(h("option", { value: current, text: f.kind === "file" ? shown("file", current) : current }));
          el.value = current;
          if (f.kind === "link") {
            // The other integration's records, by their name.
            const source = State.customs.find((x) => x.id === f.source);
            if (source) {
              void Bridge.customRecords(source.id).then((list) => {
                const names = [...new Set((list ?? []).map((r) => titleOf(source, r)))].filter((n) => n !== current).sort((a, b) => a.localeCompare(b));
                el.append(...names.map((n) => h("option", { value: n, text: n })));
              });
            }
          } else {
            // A file of the Vassoio (dropped, pasted, captured).
            void Bridge.inboxList().then((files) => {
              el.append(...(files ?? []).filter((x) => x.path !== current).map((x) => h("option", { value: x.path, text: x.name })));
            });
          }
          el.addEventListener("change", () => {
            d.values[f.id] = el.value;
            refresh();
          });
          hold(el);
          control = el;
          break;
        }
        default: {
          const type = f.kind === "date" ? "date" : f.kind === "email" ? "email" : f.kind === "phone" ? "tel" : f.kind === "url" ? "url" : "text";
          const numeric = f.kind === "number" || f.kind === "money";
          const el = h("input", { type, class: "custom-input", placeholder: f.help, inputmode: numeric ? "decimal" : undefined }) as HTMLInputElement;
          const v = d.values[f.id];
          el.value = v == null ? "" : numeric ? String(v).replace(".", ",") : String(v);
          el.addEventListener("input", () => {
            d.values[f.id] = numeric ? toNumber(el.value) : el.value;
          });
          hold(el);
          control = el;
        }
      }
      const row = h("div", { class: f.kind === "rows" || f.kind === "textarea" ? "custom-row wide" : "custom-row" }, label, control);
      if (f.showIf) conditional.push({ f, row });
      box.append(row);
    }
    // Any change may change a total or show a field that depends on it.
    box.addEventListener("change", () => refresh());
    box.addEventListener("input", () => refresh());
    refresh();
    const note = h("div", { class: d.note ? (d.note.ok ? "custom-note ok" : "custom-note err") : "custom-note", text: d.note?.text ?? "" });
    const buttons = h("div", { class: "custom-actions" });
    for (const a of c!.actions) {
      const b = h("button", { class: a.kind === "save" ? "btn primary" : "btn secondary", text: a.label }) as HTMLButtonElement;
      b.addEventListener("click", () => void press(a, b));
      buttons.append(b);
    }
    if (d.record) {
      const fresh = h("button", { class: "link-btn", text: t("Nuova scheda") });
      fresh.addEventListener("click", () => {
        d.record = "";
        d.values = blank(c!);
        d.note = null;
        paint();
      });
      buttons.append(fresh);
    }
    box.append(buttons, note);
    if (fillOpen) {
      const area = h("textarea", { class: "custom-input", rows: 4, placeholder: t("Incolla qui la mail, il messaggio o gli appunti: l'IA compila i campi, poi controlli e salvi.") }) as HTMLTextAreaElement;
      hold(area);
      const go = h("button", { class: "btn primary", text: t("Compila") }) as HTMLButtonElement;
      go.addEventListener("click", async () => {
        go.disabled = true;
        go.textContent = t("Sto compilando…");
        try {
          const found = await Bridge.customFill(c!.id, area.value);
          Object.assign(d.values, found);
          fillOpen = false;
          d.note = { text: t("Compilati {n} campi: controllali e salva.", { n: Object.keys(found).length }), ok: true };
        } catch (e) {
          d.note = { text: String(e).replace(/^Error:\s*/, ""), ok: false };
        }
        paint();
      });
      box.append(h("div", { class: "custom-row wide custom-fill" }, area, h("div", { class: "custom-actions" }, go)));
    }
    return box;
  }

  function rowsEditor(f: CustomField, refresh: () => void): HTMLElement {
    const rows = (Array.isArray(d.values[f.id]) ? d.values[f.id] : (d.values[f.id] = [])) as Row[];
    const table = h("div", { class: "custom-table" });
    const draw = () => {
      clear(table);
      table.style.setProperty("--cols", String(f.columns.length));
      table.append(...f.columns.map((col) => h("span", { class: "custom-th", text: col.label })), h("span", {}));
      rows.forEach((row, i) => {
        for (const col of f.columns) {
          let el: HTMLElement;
          if (col.kind === "computed") {
            el = h("span", { class: "custom-cell", "data-cell": `${f.id}|${i}|${col.id}` });
          } else if (col.kind === "checkbox") {
            const cb = h("input", { type: "checkbox" }) as HTMLInputElement;
            cb.checked = row[col.id] === true;
            cb.addEventListener("change", () => (row[col.id] = cb.checked));
            el = cb;
          } else if (col.kind === "select") {
            const s = h("select", { class: "custom-input" }) as HTMLSelectElement;
            s.append(h("option", { value: "", text: "—" }), ...col.options.map((o) => h("option", { value: o, text: o })));
            s.value = String(row[col.id] ?? "");
            s.addEventListener("change", () => (row[col.id] = s.value));
            el = s;
          } else {
            const numeric = col.kind === "number" || col.kind === "money";
            const inp = h("input", { type: col.kind === "date" ? "date" : "text", class: "custom-input", inputmode: numeric ? "decimal" : undefined }) as HTMLInputElement;
            const v = row[col.id];
            inp.value = v == null ? "" : numeric ? String(v).replace(".", ",") : String(v);
            inp.addEventListener("input", () => {
              row[col.id] = numeric ? toNumber(inp.value) : inp.value;
            });
            hold(inp);
            el = inp;
          }
          table.append(el);
        }
        const del = h("button", { class: "icon-btn custom-del", title: t("Togli la riga"), text: "×" });
        del.addEventListener("click", () => {
          rows.splice(i, 1);
          draw();
          refresh();
        });
        table.append(del);
      });
    };
    draw();
    const add = h("button", { class: "link-btn", text: t("+ Aggiungi riga") });
    add.addEventListener("click", () => {
      rows.push({});
      draw();
      refresh();
    });
    return h("div", { class: "custom-rows" }, table, add);
  }

  async function press(a: CustomAction, b: HTMLButtonElement) {
    b.disabled = true;
    try {
      await run(a, 0);
    } finally {
      b.disabled = false;
      paint();
    }
  }

  /** One action; "steps" runs the others by their labels, stopping at the first that fails. */
  async function run(a: CustomAction, depth: number): Promise<boolean> {
    const say = (text: string, ok: boolean) => {
      d.note = { text, ok };
    };
    const all = withComputed(c!, d.values);
    try {
      switch (a.kind) {
        case "save": {
          const r = await Bridge.customRecordSave(c!.id, d.record, d.values);
          d.record = r.id;
          d.values = { ...r.values };
          d.records = null;
          Sound.play("finish");
          say(t("Scheda salvata."), true);
          break;
        }
        case "document": {
          const name = `${c!.name} ${titleOf(c!, { id: "", created: "", updated: "", values: d.values })}`;
          const md = fillTemplate(c!, d.values, d.answer);
          const f = await Bridge.customDocument(name, a.format === "md" ? "md" : "html", a.format === "md" ? md : asHtml(name, md));
          Sound.play("finish");
          say(t("Documento nel Vassoio: {name}", { name: f.name }), true);
          break;
        }
        case "copy":
          await Bridge.customCopy(a.message ? fillText(c!, a.message, all, d.answer) : fillTemplate(c!, d.values, d.answer));
          say(t("Copiato."), true);
          break;
        case "ai":
          hooks.askChat(fillText(c!, a.prompt, all, d.answer));
          break;
        case "url":
          void Bridge.openUrl(fillText(c!, a.url, all, d.answer, true));
          break;
        case "quick":
          hooks.runQuick(a.quick);
          break;
        case "notion": {
          const props: Record<string, unknown> = {};
          for (const f of c!.fields) {
            if (f.kind === "rows") continue;
            const v = all[f.id];
            if (v == null || v === "") continue;
            props[f.label] = ["money", "number"].includes(f.kind) || (f.kind === "computed" && formatOf(f) !== "text") ? toNumber(v) : v;
          }
          const out = await Bridge.customToNotion(a.database, props);
          say(out.split("\n")[0] || t("Aggiunto a Notion."), true);
          break;
        }
        case "fill":
          fillOpen = !fillOpen;
          break;
        case "export": {
          const list = d.records ?? (await Bridge.customRecords(c!.id)) ?? [];
          if (!list.length) {
            say(t("Nessuna scheda da esportare."), false);
            return false;
          }
          const f = await Bridge.customDocument(`${c!.name} schede`, "csv", toCsv(c!, list));
          say(t("{n} schede in CSV nel Vassoio: {name}", { n: list.length, name: f.name }), true);
          break;
        }
        case "http": {
          const headers: Record<string, string> = {};
          for (const [k, v] of Object.entries(a.headers ?? {})) headers[k] = fillText(c!, String(v), all, d.answer);
          const r = await Bridge.customHttp(c!.id, a.method || "GET", fillText(c!, a.url, all, d.answer, true), headers, a.body ? fillBody(c!, a.body, all, d.answer) : "");
          d.answer = r.data as Val;
          // What of the answer goes into the fields.
          for (const [field, path] of Object.entries(a.store ?? {})) {
            const v = pick(r.data as Val, String(path));
            if (v !== null) d.values[field] = v;
          }
          if (!r.ok) {
            say(t("Il servizio ha risposto {s}: {text}", { s: r.status, text: (typeof r.data === "string" ? r.data : JSON.stringify(r.data)).slice(0, 200) }), false);
            return false;
          }
          say(a.message ? fillText(c!, a.message, withComputed(c!, d.values), d.answer) : t("Fatto ({s}).", { s: r.status }), true);
          break;
        }
        case "task": {
          const task = await Bridge.taskNew(a.label, fillText(c!, a.message ?? "", all, d.answer), "", "");
          say(t("Compito «{title}» in coda: lo segui in Agenti.", { title: task.title }), true);
          break;
        }
        case "notice":
          hooks.showNotice({ title: c!.name, text: fillText(c!, a.message ?? "", all, d.answer), level: "info", url: "" });
          break;
        case "steps": {
          if (depth > 3) return false;
          for (const label of a.steps ?? []) {
            const next = c!.actions.find((x) => x.label === label && x !== a);
            if (!next || !(await run(next, depth + 1))) return false;
          }
          break;
        }
      }
      return true;
    } catch (e) {
      say(String(e).replace(/^Error:\s*/, ""), false);
      return false;
    }
  }

  // ── The records saved ──
  function listView(): HTMLElement {
    const box = h("div", { class: "custom-list" });
    if (!d.records) {
      loadRecords();
      box.append(h("div", { class: "int-empty", text: "…" }));
      return box;
    }
    const search = h("input", { type: "text", class: "custom-input", placeholder: t("Cerca nelle schede"), value: d.query }) as HTMLInputElement;
    hold(search);
    const rows = h("div", { class: "custom-records" });
    const draw = () => {
      clear(rows);
      const q = search.value.trim().toLowerCase();
      const found = [...d.records!].reverse().filter((r) => !q || JSON.stringify(r.values).toLowerCase().includes(q));
      if (!found.length) rows.append(h("div", { class: "int-empty", text: d.records!.length ? t("Nessuna scheda trovata.") : t("Ancora nessuna scheda salvata.") }));
      for (const r of found.slice(0, 100)) {
        const open = h("button", { class: "custom-record" },
          h("span", { class: "custom-record-title", text: titleOf(c!, r) }),
          h("span", { class: "custom-record-when", text: r.updated }));
        open.addEventListener("click", () => {
          d.record = r.id;
          d.values = JSON.parse(JSON.stringify(r.values)) as Record<string, unknown>;
          d.tab = "form";
          d.note = null;
          paint();
        });
        const copy = h("button", { class: "link-btn", text: t("Duplica") });
        copy.addEventListener("click", () => {
          d.record = "";
          d.values = JSON.parse(JSON.stringify(r.values)) as Record<string, unknown>;
          // A duplicate gets its own number when saved.
          for (const f of c!.fields) if (f.kind === "counter") d.values[f.id] = "";
          d.tab = "form";
          d.note = { text: t("Copia della scheda: salvala per tenerla."), ok: true };
          paint();
        });
        const del = h("button", { class: "link-btn danger-link", text: t("Elimina") });
        del.addEventListener("click", async () => {
          if (!del.classList.contains("confirm")) {
            del.classList.add("confirm");
            del.textContent = t("Sicuro?");
            return;
          }
          try {
            await Bridge.customRecordDelete(c!.id, r.id);
            d.records = d.records!.filter((x) => x.id !== r.id);
            if (d.record === r.id) d.record = "";
            draw();
          } catch (e) {
            console.warn(e);
          }
        });
        rows.append(h("div", { class: "custom-record-row" }, open, copy, del));
      }
    };
    search.addEventListener("input", () => {
      d.query = search.value;
      draw();
    });
    draw();
    const totals = summaryOf(c!, d.records);
    box.append(h("div", { class: "custom-summary", text: [t("{n} schede", { n: d.records.length }), ...totals].join(" · ") }), search, rows);
    return box;
  }

  root.append(cardTitle(c), tabs, body);
  paint();
  return root;
}

/** A record saved elsewhere (the chat's custom_add_record): the list is read again. */
export function forgetRecords(id: string) {
  const d = drafts.get(id);
  if (d) d.records = null;
}
