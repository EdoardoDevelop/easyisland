// An integration the user made from the chat (custom.rs): its form, the rows of
// its tables, the computed values, the data read from services, the document
// from its template, its actions and the records saved. Everything comes from
// the description; formulas go through core/expr.ts (read here, never eval), the
// template is filled as text (values escaped and the page cleaned when it is
// HTML, core/template.ts), calls to services go through Rust (only to the hosts
// in the description, keys put in there), actions are a fixed set. The one that
// runs code is "script" (and "quick" on a script): always shown first, its
// values in a JSON file (Rust), never in the script's text.

import { h, clear } from "./dom";
import { Bridge } from "../core/bridge";
import { renderMarkdown } from "../core/markdown";
import { num, pick, scopeOf, truthy, tryRun, type Val } from "../core/expr";
import { cellValue, cleanPage, htmlValue, isHtmlTemplate, italianNumber, longDate, onTableLine } from "../core/template";
import {
  State, type AgentTask, type Custom, type CustomAction, type CustomField, type CustomLink, type CustomRecord, type CustomSource, type Notice,
} from "../core/state";
import { t } from "../core/i18n";
import { Sound } from "../core/sound";
import { forgetSource, linkPicker, sourceRecords, type LinkKit } from "./custom-link";
import { fileViewer, viewKind } from "./file-viewer";
import { dependsOn, optionsPicker } from "./custom-options";

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
  /** A script waiting for the user's click, shown in the card. */
  ask: { name: string; shell: string; script: string; done: (go: boolean) => void } | null;
  /** A file the last "http" action answered with and no field took: its viewer under the note. */
  media?: { path: string; action: string; kept: boolean } | null;
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
    d = { tab, record: "", values: blank(c), records: null, query: "", note: null, answer: null, ask: null };
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

/** The same with the format of {{campo|formato}}: "lunga" for dates, "it" for numbers. */
function shownAs(kind: string, v: unknown, format?: string): string {
  if (v == null || v === "") return "";
  if (format === "lunga") return longDate(v) ?? shown(kind, v);
  if (format === "it") {
    const n = toNumber(v);
    if (n != null) return italianNumber(n, kind === "money" ? 2 : undefined);
  }
  return shown(kind, v);
}

/** Where a document's text goes: as it is (copy, messages), Markdown or HTML. */
type Fill = "plain" | "md" | "html";

/** A value as it goes into a template at `at` of `whole`. */
function placed(value: string, mode: Fill, whole: string, at: number): string {
  if (mode === "html") return htmlValue(value);
  return mode === "md" && onTableLine(whole, at) ? cellValue(value) : value;
}

/** {{campo}} and {{risposta.percorso}} in a text, as they read; {{campo|formato}} in a format. */
function fillText(c: Custom, text: string, all: Record<string, unknown>, answer: Val, encode = false, mode: Fill = "plain"): string {
  const byId = new Map(c.fields.map((f) => [f.id, f]));
  return text.replace(/\{\{([A-Za-zÀ-ÿ0-9_.]+)(?:\|([a-z]+))?\}\}/g, (m, k: string, format: string | undefined, at: number, whole: string) => {
    if (k.startsWith("secret:")) return m;
    let out: string | null = null;
    if (k === "oggi") out = shownAs("date", today(), format);
    else if (k === "risposta" || k.startsWith("risposta.")) {
      out = shownAs("text", pick(answer, k.slice("risposta.".length)), format);
    } else {
      const f = byId.get(k);
      if (f) out = shownAs(formatOf(f), all[k], format);
      else if (k.includes(".")) out = shownAs("text", pick(all as Val, k), format);
    }
    if (out == null) return m;
    return encode ? encodeURIComponent(out) : placed(out, mode, whole, at);
  });
}

/** The same for a request's body: values that are not text go in as JSON. */
export function fillBody(c: Custom, text: string, all: Record<string, unknown>, answer: Val): string {
  return text.replace(/\{\{([A-Za-zÀ-ÿ0-9_.]+)\}\}/g, (m, k: string, at: number, whole: string) => {
    if (k.startsWith("secret:")) return m;
    const f = c.fields.find((x) => x.id === k);
    const quoted = inJsonString(whole.slice(0, at));
    if (!f) {
      const out = fillText(c, m, all, answer);
      return out === m ? m : quoted ? jsonInner(out) : jsonBare(out);
    }
    const v = all[k];
    // Between quotes the text escaped; outside them the JSON value ("0,9" → 0.9, lists, rows).
    if (quoted) return jsonInner(typeof v === "string" ? v : v == null ? "" : JSON.stringify(v));
    return typeof v === "string" ? jsonBare(v) : JSON.stringify(v ?? null);
  });
}

/** Whether the end of a JSON text is inside a string (odd unescaped quotes). As in custom.rs. */
function inJsonString(s: string): boolean {
  let inside = false;
  let escaped = false;
  for (const ch of s) {
    if (escaped) escaped = false;
    else if (ch === "\\" && inside) escaped = true;
    else if (ch === '"') inside = !inside;
  }
  return inside;
}

const jsonInner = (s: string) => JSON.stringify(s).slice(1, -1);

/** Outside quotes: a number when it reads as one ("0,9" → 0.9), true/false/null, else a JSON string. */
function jsonBare(s: string): string {
  const v = s.trim();
  if (v === "true" || v === "false" || v === "null") return v;
  const n = v.includes(",") && !v.includes(".") ? v.replace(",", ".") : v;
  return /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(n) ? n : JSON.stringify(s);
}

/** {{#se formula}}…{{/se}} and {{^campo}}…{{/campo}} (only when empty), the inner ones first. */
function conditions(text: string, values: Record<string, unknown>, tables: string[]): string {
  const scope = scopeOf(values, tables);
  const ifs = /\{\{#se\s+([^{}]+?)\}\}((?:(?!\{\{#se\s)[\s\S])*?)\{\{\/se\}\}/g;
  let out = text;
  for (let i = 0; i < 20 && out.search(ifs) >= 0; i++) {
    out = out.replace(ifs, (_, rule: string, body: string) => (truthy(tryRun(rule, scope)) ? body : ""));
  }
  return out.replace(/\{\{\^([A-Za-z0-9_]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, id: string, body: string) => (truthy(values[id] as Val) ? "" : body));
}

/** Stands for "{{" in what is already filled, so that a value is never read as a placeholder. */
const FILLED = "";

/**
 * The template filled: {{campo}}, {{campo|formato}}, {{#tabella}}…{{colonna}}…{{/tabella}}
 * once per row, the conditions. `mode`: "plain" as it is (copy), "md" a document
 * in Markdown (table rows kept whole), "html" an HTML template (values escaped,
 * {{file:nome}} from `files`).
 */
export function fillTemplate(c: Custom, values: Record<string, unknown>, answer: Val = null, mode: Fill = "plain", files: Record<string, string> = {}): string {
  const all = withComputed(c, values);
  const byId = new Map(c.fields.map((f) => [f.id, f]));
  const tables = c.fields.filter((f) => f.kind === "rows").map((f) => f.id);
  // A field with no value yet is empty, not a word of its own (expr.ts).
  const known: Record<string, unknown> = { ...Object.fromEntries(c.fields.map((f) => [f.id, null])), ...all };
  const source = mode === "html" ? c.template.replace(/\{\{file:([^{}]+)\}\}/g, (m, name: string) => files[name.trim()] ?? m) : c.template;
  const rowsDone = source.replace(/\{\{#([A-Za-z0-9_]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, id: string, body: string) => {
    const f = byId.get(id);
    const rows = (all[id] as Row[] | undefined) ?? [];
    if (!f || f.kind !== "rows") return "";
    return rows.map((row, i) => conditions(body, { ...known, ...row }, tables).replace(/\{\{([A-Za-z0-9_#]+)(?:\|([a-z]+))?\}\}/g, (m, k: string, format: string | undefined, at: number, whole: string) => {
      if (k === "#") return String(i + 1);
      const col = f.columns.find((x) => x.id === k);
      if (!col) return m;
      const value = shownAs(col.kind === "computed" ? formatOf({ kind: "computed", format: col.format }) : col.kind, row[k], format);
      return placed(value, mode, whole, at).replace(/\{\{/g, FILLED);
    })).join("");
  });
  return fillText(c, conditions(rowsDone, known, tables), all, answer, false, mode).replaceAll(FILLED, "{{");
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
  // A field still empty leaves no separator hanging at either end.
  const own = c.title ? fillTemplate({ ...c, template: c.title }, r.values).replace(/\s+/g, " ").replace(/^[\s·,;:|–—-]+|[\s·,;:|–—-]+$/g, "") : "";
  if (own) return own;
  const f = c.fields.find((x) => x.id === c.titleField) ?? c.fields.find((x) => x.kind === "text" || x.kind === "counter");
  const v = f ? shown(formatOf(f), r.values[f.id]) : "";
  return v || r.created;
}

/**
 * The description with the template it really uses: its own, or, when that is
 * empty and `templateFrom` names another integration, that one's (one look for
 * DDT and register, 11 Nov 2026; its pictures are found by custom.rs `asset`).
 */
export function withTemplate(c: Custom): Custom {
  if (c.template?.trim() || !c.templateFrom) return c;
  const other = State.customs.find((x) => x.id === c.templateFrom);
  return other?.template ? { ...c, template: other.template } : c;
}

/** The page of the document: an HTML template as it is, cleaned; Markdown on EasyIsland's own page. */
export async function pageFor(c: Custom, values: Record<string, unknown>, answer: Val, name: string): Promise<string> {
  const ct = withTemplate(c);
  if (!isHtmlTemplate(ct.template)) return asHtml(name, fillTemplate(ct, values, answer, "md"));
  const wanted = [...new Set([...ct.template.matchAll(/\{\{file:([^{}]+)\}\}/g)].map((m) => m[1].trim()))];
  const files: Record<string, string> = {};
  for (const file of wanted) files[file] = await Bridge.customAsset(c.id, file);
  return cleanPage(fillTemplate(ct, values, answer, "html", files), name);
}

/**
 * The chat's `custom_preview` (custom.rs): the document with these values, made
 * as «Documento» makes it, and its text for the chat. Nothing is saved.
 */
export async function previewFor(id: string, values: Record<string, unknown>): Promise<{ html: string; text: string }> {
  const c = State.customs.find((x) => x.id === id);
  if (!c) throw new Error(t("Integrazione non trovata."));
  const all = { ...blank(c), ...values };
  const name = `${c.name} ${titleOf(c, { id: "", created: "", updated: "", values: all })}`;
  const html = await pageFor(c, all, null, name);
  const ct = withTemplate(c);
  const text = isHtmlTemplate(ct.template)
    ? (new DOMParser().parseFromString(html, "text/html").body.textContent ?? "").replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim()
    : fillTemplate(ct, all, null, "md");
  return { html, text };
}

/** The field that holds a record's name: where a name written in a link goes (remember). */
function nameField(c: Custom): CustomField | undefined {
  return c.fields.find((x) => x.id === c.titleField) ?? c.fields.find((x) => x.kind === "text");
}

/** A value of a record for a link's `fill`: a field (computed ones too) or a template "{{cap}} {{citta}}". */
function linkValue(c: Custom, r: CustomRecord, spec: string): unknown {
  if (spec.includes("{{")) return fillTemplate({ ...c, template: spec }, r.values).replace(/\s+/g, " ").trim();
  return withComputed(c, r.values)[spec] ?? "";
}

/** The same value as it reads: euro, dates, Sì/No by the field it comes from. */
function linkText(c: Custom, r: CustomRecord, spec: string): string {
  const v = linkValue(c, r, spec);
  const f = spec.includes("{{") ? undefined : c.fields.find((x) => x.id === spec);
  return f ? shown(formatOf(f), v) : String(v ?? "");
}

/**
 * After a save: the names written by hand in links with `remember` go into
 * their integration, with what was filled next to them (the plain `fill`
 * entries, read backwards). Says what was added, or why not.
 */
async function rememberLinks(c: Custom, values: Record<string, unknown>): Promise<string[]> {
  const said: string[] = [];
  const done = new Set<string>();
  const one = async (link: CustomLink, name: string, around: Record<string, unknown>) => {
    const source = State.customs.find((x) => x.id === link.source);
    const text = name.trim();
    if (!link.remember || !source || !text || done.has(`${source.id}|${text.toLowerCase()}`)) return;
    done.add(`${source.id}|${text.toLowerCase()}`);
    const key = nameField(source);
    const known = (await sourceRecords(source.id)).some((r) =>
      titleOf(source, r).trim().toLowerCase() === text.toLowerCase() || (key && String(r.values[key.id] ?? "").trim().toLowerCase() === text.toLowerCase()));
    if (known || !key) return;
    const add: Record<string, unknown> = { [key.id]: text };
    for (const [to, spec] of Object.entries(link.fill ?? {})) {
      const v = around[to];
      if (!spec.includes("{{") && spec !== key.id && v != null && v !== "") add[spec] = v;
    }
    try {
      await Bridge.customRecordSave(source.id, "", add);
      forgetSource(source.id);
      forgetRecords(source.id);
      said.push(t("«{text}» aggiunto a {name}.", { text, name: source.name }));
    } catch (e) {
      said.push(t("«{text}» non aggiunto a {name}: {e}", { text, name: source.name, e: String(e).replace(/^Error:\s*/, "") }));
    }
  };
  for (const f of c.fields) {
    if (f.kind === "link") await one(f, String(values[f.id] ?? ""), values);
    if (f.kind === "rows" && Array.isArray(values[f.id])) {
      for (const row of values[f.id] as Row[]) {
        for (const col of f.columns.filter((x) => x.kind === "link")) await one(col, String(row[col.id] ?? ""), row);
      }
    }
  }
  return said;
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
  // With the template it really uses (its own, or the one of `templateFrom`): document, copy, preview.
  const found = State.customs.find((x) => `custom:${x.id}` === task.id);
  const c = found ? withTemplate(found) : undefined;
  if (!c) return h("div", { class: "int-card" }, h("div", { class: "int-empty", text: t("Integrazione non trovata.") }));
  const d = draftOf(c);
  let fillOpen = false;
  const root = h("div", { class: "int-card custom-card" });
  root.style.setProperty("--c", c.color);
  const body = h("div", { class: "custom-body" });
  const tabs = h("div", { class: "custom-tabs" });
  const hasForm = c.fields.length > 0;
  // A source that only lists the choices of a select (optionsFrom, no values, title or
  // alert) stays out of «Dati»: custom-options.ts reads it, once, when it is needed.
  const shownSources = (c.sources ?? []).filter((s) => !(c.fields.some((f) => f.optionsFrom?.source === s.id)
    && !s.alert && !s.title && !Object.keys(s.values ?? {}).length));
  const hasData = shownSources.length > 0;

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
      tab("form", d.record ? t("Scheda") : t("Nuova scheda"));
      tab("list", d.records ? t("Schede salvate ({n})", { n: d.records.length }) : t("Schede salvate"));
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
  const kit: LinkKit = { titleOf, valueOf: linkValue, textOf: linkText, hold };

  // ── Data from services ──
  function dataView(): HTMLElement {
    const box = h("div", { class: "custom-list" });
    for (const s of shownSources) {
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
          if (f.optionsFrom?.source) {
            // From a source of its own: searched as you type; the selects that depend on it empty.
            // A select that depends on this one (its `match` reads it) empties when the value
            // changes, picked or typed, and so on down the chain.
            const emptyAfter = (id: string, seen = new Set<string>()) => {
              for (const x of c!.fields) {
                if (x.id === id || seen.has(x.id) || !dependsOn(x, id)) continue;
                seen.add(x.id);
                d.values[x.id] = "";
                const shown = box.querySelector<HTMLInputElement>(`.custom-pick-input[data-field="${x.id}"]`);
                if (shown) {
                  shown.value = "";
                  shown.title = "";
                }
                emptyAfter(x.id, seen);
              }
            };
            control = optionsPicker(c!, f, () => d.values, hold, (value, fill) => {
              const changed = String(d.values[f.id] ?? "") !== value;
              d.values[f.id] = value;
              Object.assign(d.values, fill);
              if (changed) emptyAfter(f.id);
              paint();
            }, (text) => {
              const changed = String(d.values[f.id] ?? "") !== text;
              d.values[f.id] = text;
              if (changed) emptyAfter(f.id);
            });
            break;
          }
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
        case "link": {
          // Searched as you type in the other integration; a pick fills the fields of `fill`.
          const p = linkPicker(f, String(d.values[f.id] ?? ""), kit, (name, filled) => {
            d.values[f.id] = name;
            Object.assign(d.values, filled);
            paint();
          }, (text) => {
            d.values[f.id] = text;
          });
          control = p.el;
          break;
        }
        case "file": {
          const el = h("select", { class: "custom-input" }) as HTMLSelectElement;
          const current = String(d.values[f.id] ?? "");
          el.append(h("option", { value: "", text: "—" }));
          if (current) el.append(h("option", { value: current, text: shown("file", current) }));
          el.value = current;
          {
            // A file of the Vassoio (dropped, pasted, captured).
            void Bridge.inboxList().then((files) => {
              el.append(...(files ?? []).filter((x) => x.path !== current).map((x) => h("option", { value: x.path, text: x.name })));
            });
          }
          el.append(h("option", { value: "\u0000pick", text: t("Scegli dal PC…") }));
          el.addEventListener("change", async () => {
            if (el.value === "\u0000pick") {
              el.value = current;
              try {
                const got = await Bridge.chatPick(false);
                if (got?.[0]?.path) d.values[f.id] = got[0].path;
              } catch (e) {
                console.warn(e);
              }
              paint();
              return;
            }
            d.values[f.id] = el.value;
            paint();
          });
          hold(el);
          control = current ? h("div", { class: "custom-file" }, el, fileViewer(current, { place: `${c!.id}/${f.id}` })) : el;
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
      const wide = f.kind === "rows" || f.kind === "textarea" || (f.kind === "file" && !!d.values[f.id]);
      const row = h("div", { class: wide ? "custom-row wide" : "custom-row" }, label, control);
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
      b.disabled = !!d.ask;
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
    // The document as it would come out, without saving: no record, no number used
    // (a counter shows the one the next record would get). Edoardo, 11 Nov 2026.
    if (c!.template.trim() && c!.actions.some((a) => a.kind === "document" || a.kind === "pdf")) {
      const look = h("button", { class: "link-btn", text: t("Anteprima"), title: t("Il documento con questi dati, senza salvare la scheda né usare un numero") }) as HTMLButtonElement;
      look.addEventListener("click", async () => {
        look.disabled = true;
        try {
          const next = await Bridge.customCounters(c!.id);
          const values = { ...d.values };
          for (const [k, v] of Object.entries(next)) if (!values[k]) values[k] = v;
          const name = `${c!.name} ${titleOf(c!, { id: "", created: "", updated: "", values })}`;
          const path = await Bridge.customPreviewFile(c!.id, await pageFor(c!, values, d.answer, name));
          await Bridge.previewOpen(path, true);
          d.note = { text: t("Anteprima aperta: niente è stato salvato."), ok: true };
        } catch (e) {
          d.note = { text: String(e).replace(/^Error:\s*/, ""), ok: false };
        } finally {
          look.disabled = false;
          paint();
        }
      });
      buttons.append(look);
    }
    box.append(buttons, note);
    // The file the last call answered with (an mp3, a picture…): to hear or see, and to keep.
    if (d.media) {
      const m = d.media;
      const a = c!.actions.find((x) => x.label === m.action);
      const save = m.kept ? undefined : async () => {
        try {
          const name = a?.filename ? fillText(c!, a.filename, withComputed(c!, d.values), d.answer) : "";
          const path = await Bridge.customKeep(m.path, name, a?.folder ?? "", !!a?.tray);
          d.media = { ...m, path, kept: true };
          d.note = { text: t("Salvato: {name}", { name: path.split(/[\\/]/).pop() ?? path }), ok: true };
        } catch (e) {
          d.note = { text: String(e).replace(/^Error:\s*/, ""), ok: false };
        }
        paint();
      };
      const title = viewKind(m.path) === "audio" ? t("Audio ricevuto") : t("File ricevuto");
      box.append(fileViewer(m.path, { title, onSave: save, place: `${c!.id}/risposta` }));
    }
    if (d.ask) {
      const ask = d.ask;
      const go = h("button", { class: "btn primary", text: t("Esegui") });
      const no = h("button", { class: "btn secondary", text: t("Annulla") });
      go.addEventListener("click", () => ask.done(true));
      no.addEventListener("click", () => ask.done(false));
      box.append(h("div", { class: "custom-row wide" },
        h("b", { text: t("Eseguire lo script «{name}»?", { name: ask.name }) }),
        h("span", { class: "custom-label", text: t("Controlla i comandi prima di eseguirli ({shell}).", { shell: ask.shell === "cmd" ? t("Prompt dei comandi") : "PowerShell" }) }),
        h("pre", { class: "custom-raw", text: ask.script }),
        h("div", { class: "custom-actions" }, go, no)));
    }
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
          if (col.kind === "link") {
            const p = linkPicker(col, String(row[col.id] ?? ""), kit, (name, filled) => {
              row[col.id] = name;
              Object.assign(row, filled);
              draw();
              refresh();
            }, (text) => {
              row[col.id] = text;
            });
            // In the right half of the table the matches open towards the left, inside the card.
            if (f.columns.indexOf(col) >= f.columns.length / 2) p.el.classList.add("end");
            el = p.el;
          } else if (col.kind === "computed") {
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

  /** The page of the document (see `pageFor`). */
  async function pageOf(name: string): Promise<string> {
    return pageFor(c!, d.values, d.answer, name);
  }

  /**
   * A script, seen and confirmed in the card when `confirm`. What the record holds
   * goes through Rust into a JSON file named by EASYISLAND_SCHEDA, never into its text.
   */
  async function script(name: string, shell: string, text: string, confirm: boolean, say: (text: string, ok: boolean) => void): Promise<boolean> {
    if (confirm) {
      const go = await new Promise<boolean>((done) => {
        d.ask = { name, shell, script: text, done };
        paint();
      });
      d.ask = null;
      if (!go) {
        say(t("Script annullato."), false);
        return false;
      }
    }
    d.note = { text: t("Script in corso…"), ok: true };
    paint();
    const data = { integrazione: c!.id, nome: c!.name, scheda: d.record, valori: withComputed(c!, d.values) };
    const r = await Bridge.actionRunScript(`custom${Date.now().toString(36)}`, shell, text, data);
    const output = r.output.trim().slice(0, 300);
    if (r.timedOut) {
      say(t("Lo script ha superato il tempo massimo."), false);
      return false;
    }
    if ((r.code ?? 0) !== 0) {
      say(t("Lo script è finito con codice {code}: {text}", { code: r.code ?? "?", text: output }), false);
      return false;
    }
    Sound.play("finish");
    say(output || t("Script finito."), true);
    return true;
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
          // Names written by hand in a link that remembers: into their integration.
          const added = await rememberLinks(c!, d.values);
          say([t("Scheda salvata."), ...added].join(" "), true);
          break;
        }
        case "document": {
          const name = `${c!.name} ${titleOf(c!, { id: "", created: "", updated: "", values: d.values })}`;
          const file = a.filename ? fillTemplate({ ...c!, template: a.filename }, d.values, d.answer) : "";
          const folder = a.folder ?? "";
          if (a.format === "md") {
            const f = await Bridge.customDocument(name, "md", fillTemplate(c!, d.values, d.answer, "md"), file, folder);
            say(t("Documento nel Vassoio: {name}", { name: f.name }), true);
          } else {
            const page = await pageOf(file.trim() || name);
            const f = a.format === "pdf" ? await Bridge.customPdf(name, page, file, folder) : await Bridge.customDocument(name, "html", page, file, folder);
            say(t("Documento nel Vassoio: {name}", { name: f.name }), true);
          }
          Sound.play("finish");
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
        case "quick": {
          const q = (State.settings.actions ?? []).find((x) => x.id === a.quick);
          if (!q) {
            say(t("Azione rapida non trovata: {id}", { id: a.quick }), false);
            return false;
          }
          // A script gets the record's data, and the steps wait for it.
          if (q.kind === "script") {
            void Bridge.habitNoteQuick(q.id);
            return await script(q.name, q.shell, q.script, !!q.confirm, say);
          }
          hooks.runQuick(a.quick);
          break;
        }
        case "script":
          return await script(a.label, a.shell || "powershell", a.script ?? "", true, say);
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
          d.media = null;
          // A file (audio, picture, PDF…): kept where the action says, else shown to keep later.
          if (r.file && r.ok) {
            let path = r.file;
            const keepIt = !!(a.folder?.trim() || a.filename?.trim());
            if (keepIt) path = await Bridge.customKeep(r.file, a.filename ? fillText(c!, a.filename, all, d.answer) : "", a.folder ?? "", !!a.tray);
            r.data = { ...(r.data as Record<string, unknown>), file: path };
            const stored = Object.values(a.store ?? {}).some((p) => String(p) === "file");
            if (!stored) d.media = { path, action: a.label, kept: keepIt };
          }
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
          const savedTo = r.file && (a.folder?.trim() || a.filename?.trim()) ? t("Salvato: {name}", { name: String((r.data as Record<string, unknown>).file ?? "").split(/[\\/]/).pop() ?? "" }) : "";
          say(a.message ? fillText(c!, a.message, withComputed(c!, d.values), d.answer) : savedTo || t("Fatto ({s}).", { s: r.status }), true);
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
