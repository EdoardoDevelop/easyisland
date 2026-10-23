// An integration the user made from the chat (custom.rs): its form, the rows of
// its tables, the computed values, the document from its template, its actions
// and the records saved. Everything comes from the description; nothing here
// runs code from it: formulas go through the calculator (core/calc.ts), the
// template is filled as text, actions are a fixed set.

import { h, clear } from "./dom";
import { Bridge } from "../core/bridge";
import { calculate } from "../core/calc";
import { renderMarkdown } from "../core/markdown";
import { State, type AgentTask, type Custom, type CustomField, type CustomRecord } from "../core/state";
import { t } from "../core/i18n";
import { Sound } from "../core/sound";

export interface CustomHooks {
  askChat(question: string): void;
  runQuick(id: string): void;
  holdOpen(on: boolean): void;
}

type Row = Record<string, unknown>;

/** What the card keeps for each integration while EasyIsland runs. */
interface Draft {
  tab: "form" | "list";
  record: string;
  values: Record<string, unknown>;
  records: CustomRecord[] | null;
  query: string;
  note: { text: string; ok: boolean } | null;
}

const drafts = new Map<string, Draft>();

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
      return f.default ? toNumber(f.default) : null;
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
    d = { tab: "form", record: "", values: blank(c), records: null, query: "", note: null };
    drafts.set(c.id, d);
  }
  return d;
}

/** "1.234,50" or "1234.5" → 1234.5; null when it is not a number. */
function toNumber(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string" || !v.trim()) return null;
  return calculate(`0+${v.trim()}`);
}

/** A number written for the calculator: comma as the decimal point, no grouping. */
function forCalc(n: number): string {
  return `(${String(n).replace(".", ",")})`;
}

/**
 * A formula over the values: field ids, numbers, + - * / ( ) and sum(…) over
 * the rows of a table (sum(quantita*prezzo)). Unknown names count as 0.
 */
export function evalFormula(formula: string, values: Record<string, unknown>, fields: CustomField[]): number | null {
  const tables = fields.filter((f) => f.kind === "rows");
  // sum(expr): the expression for every row of the table whose columns it names.
  let expr = formula.replace(/sum\(([^()]*)\)/gi, (_, inner: string) => {
    const names = inner.match(/[A-Za-z_][A-Za-z0-9_]*/g) ?? [];
    const table = tables.find((tb) => names.some((n) => tb.columns.some((c) => c.id === n)));
    if (!table) return "0";
    const rows = (values[table.id] as Row[] | undefined) ?? [];
    let total = 0;
    for (const row of rows) {
      const one = inner.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (n) => forCalc(toNumber(row[n]) ?? 0));
      total += calculate(`0+${one}`) ?? 0;
    }
    return forCalc(total);
  });
  expr = expr.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (n) => forCalc(toNumber(values[n]) ?? 0));
  // "0+…": the calculator answers only expressions, not a lone number.
  const out = calculate(`0+${expr}`);
  return out == null ? null : Math.round(out * 100) / 100;
}

/** The values with the computed fields filled in, in order (one may use another). */
export function withComputed(c: Custom, values: Record<string, unknown>): Record<string, unknown> {
  const all = { ...values };
  // The computed columns of each row first: the totals may sum them.
  for (const f of c.fields) {
    if (f.kind !== "rows" || !Array.isArray(all[f.id])) continue;
    const cols = f.columns.filter((x) => x.kind === "computed" && x.formula);
    if (!cols.length) continue;
    all[f.id] = (all[f.id] as Row[]).map((row) => {
      const out = { ...row };
      for (const col of cols) out[col.id] = rowFormula(col.formula ?? "", out);
      return out;
    });
  }
  for (const f of c.fields) if (f.kind === "computed") all[f.id] = evalFormula(f.formula, all, c.fields);
  return all;
}

/** A formula over one row's columns ("quantita*prezzo"). */
export function rowFormula(formula: string, row: Row): number | null {
  const expr = formula.replace(/[A-Za-z_][A-Za-z0-9_]*/g, (n) => forCalc(toNumber(row[n]) ?? 0));
  const out = calculate(`0+${expr}`);
  return out == null ? null : Math.round(out * 100) / 100;
}

/** showIf: "urgente" (checked or filled) or "pagamento=Bonifico". Empty: always. */
export function visible(f: CustomField, values: Record<string, unknown>): boolean {
  const rule = (f.showIf ?? "").trim();
  if (!rule) return true;
  const [key, want] = rule.split("=").map((x) => x.trim());
  const v = values[key];
  if (want == null) return Array.isArray(v) ? v.length > 0 : v === true || (typeof v === "string" && v.trim() !== "") || (typeof v === "number" && v !== 0);
  return Array.isArray(v) ? v.includes(want) : String(v ?? "") === want;
}

/** The records as CSV (semicolons, as Excel reads them in Italy). */
export function toCsv(c: Custom, records: CustomRecord[]): string {
  const cols = c.fields.filter((f) => f.kind !== "rows");
  const cell = (s: string) => (/[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = [cols.map((f) => cell(f.label)).join(";")];
  for (const r of records) {
    const all = withComputed(c, r.values);
    lines.push(cols.map((f) => cell(shown(f.kind === "computed" ? "computed" : f.kind, all[f.id]))).join(";"));
  }
  return "\ufeff" + lines.join("\r\n");
}

/** The totals of the summary fields over the records: sums, or counts per choice. */
export function summaryOf(c: Custom, records: CustomRecord[]): string[] {
  const out: string[] = [];
  for (const f of c.fields.filter((x) => x.summary)) {
    if (["number", "money", "computed"].includes(f.kind)) {
      let sum = 0;
      for (const r of records) sum += toNumber(withComputed(c, r.values)[f.id]) ?? 0;
      out.push(`${f.label}: ${f.kind === "number" ? sum.toLocaleString("it-IT") : money.format(sum)}`);
    } else {
      const counts = new Map<string, number>();
      for (const r of records) {
        const v = shown(f.kind, r.values[f.id]);
        if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      out.push(`${f.label}: ${[...counts].map(([k, n]) => `${k} ${n}`).join(", ") || "—"}`);
    }
  }
  return out;
}

// "always": 1.501,00 € (Italian grouping starts only at five digits otherwise).
const money = new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR", useGrouping: "always" } as unknown as Intl.NumberFormatOptions);

/** A value as it reads in a document or a list. */
function shown(kind: string, v: unknown): string {
  if (v == null || v === "") return "";
  switch (kind) {
    case "money":
    case "computed": {
      const n = toNumber(v);
      return n == null ? "" : money.format(n);
    }
    case "number": {
      const n = toNumber(v);
      return n == null ? "" : n.toLocaleString("it-IT");
    }
    case "checkbox":
      return v === true ? t("Sì") : t("No");
    case "date": {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v));
      return m ? `${m[3]}/${m[2]}/${m[1]}` : String(v);
    }
    case "multiselect":
      return Array.isArray(v) ? v.join(", ") : String(v);
    default:
      return String(v);
  }
}

/** The template filled: {{campo}}, and {{#tabella}}…{{colonna}}…{{/tabella}} once per row. */
export function fillTemplate(c: Custom, values: Record<string, unknown>): string {
  const all = withComputed(c, values);
  const byId = new Map(c.fields.map((f) => [f.id, f]));
  let text = c.template.replace(/\{\{#([A-Za-z0-9_]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, id: string, body: string) => {
    const f = byId.get(id);
    const rows = (all[id] as Row[] | undefined) ?? [];
    if (!f || f.kind !== "rows") return "";
    return rows.map((row, i) => body.replace(/\{\{([A-Za-z0-9_#]+)\}\}/g, (m, k: string) => {
      if (k === "#") return String(i + 1);
      const col = f.columns.find((x) => x.id === k);
      return col ? shown(col.kind === "computed" ? "computed" : col.kind, row[k]) : m;
    })).join("");
  });
  text = text.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (m, k: string) => {
    const f = byId.get(k);
    if (k === "oggi") return shown("date", today());
    return f ? shown(f.kind === "computed" ? "computed" : f.kind, all[k]) : m;
  });
  return text;
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

/** The name of a record in the list. */
function titleOf(c: Custom, r: CustomRecord): string {
  const f = c.fields.find((x) => x.id === c.titleField) ?? c.fields.find((x) => x.kind === "text");
  const v = f ? shown(f.kind, r.values[f.id]) : "";
  return v || r.created;
}

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
    tab("form", d.record ? t("Scheda") : t("Nuova"));
    tab("list", d.records ? t("Salvate ({n})", { n: d.records.length }) : t("Salvate"));
    clear(body);
    if (d.tab === "list") body.append(listView());
    else body.append(formView());
  }

  function loadRecords() {
    void Bridge.customRecords(c!.id).then((r) => {
      d.records = r ?? [];
      paint();
    });
  }

  // ── The form ──
  function formView(): HTMLElement {
    const box = h("div", { class: "custom-form" });
    const computed: { f: CustomField; out: HTMLElement }[] = [];
    const conditional: { f: CustomField; row: HTMLElement }[] = [];
    const refresh = () => {
      const all = withComputed(c!, d.values);
      for (const { f, out } of computed) out.textContent = shown("computed", all[f.id]) || "—";
      // The computed columns of the rows, cell by cell.
      box.querySelectorAll<HTMLElement>("[data-cell]").forEach((el) => {
        const [table, i, col] = (el.dataset.cell ?? "").split("|");
        const rows = all[table] as Row[] | undefined;
        el.textContent = shown("computed", rows?.[Number(i)]?.[col]) || "—";
      });
      for (const { f, row } of conditional) row.style.display = visible(f, d.values) ? "" : "none";
    };
    const hold = (el: HTMLElement) => {
      el.addEventListener("focus", () => {
        hooks.holdOpen(true);
        void Bridge.focusWindow(true);
      });
      el.addEventListener("blur", () => hooks.holdOpen(false));
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
            });
            el.append(b);
          }
          control = el;
          break;
        }
        case "rows":
          control = rowsEditor(f, refresh, hold);
          break;
        case "counter": {
          const v = String(d.values[f.id] ?? "");
          control = h("span", { class: "custom-computed", text: v || t("al salvataggio") });
          break;
        }
        case "link": {
          const el = h("select", { class: "custom-input" }) as HTMLSelectElement;
          const current = String(d.values[f.id] ?? "");
          el.append(h("option", { value: "", text: "—" }));
          if (current) el.append(h("option", { value: current, text: current }));
          el.value = current;
          // The other integration's records, by their name.
          const source = State.customs.find((x) => x.id === f.source);
          if (source) {
            void Bridge.customRecords(source.id).then((list) => {
              const names = [...new Set((list ?? []).map((r) => titleOf(source, r)))].filter((n) => n !== current).sort((a, b) => a.localeCompare(b));
              el.append(...names.map((n) => h("option", { value: n, text: n })));
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
        case "computed": {
          const out = h("span", { class: "custom-computed" });
          computed.push({ f, out });
          control = out;
          break;
        }
        default: {
          const type = f.kind === "date" ? "date" : f.kind === "email" ? "email" : f.kind === "phone" ? "tel" : f.kind === "url" ? "url" : "text";
          const el = h("input", { type, class: "custom-input", placeholder: f.help, inputmode: f.kind === "number" || f.kind === "money" ? "decimal" : undefined }) as HTMLInputElement;
          const v = d.values[f.id];
          el.value = v == null ? "" : f.kind === "money" || f.kind === "number" ? String(v).replace(".", ",") : String(v);
          el.addEventListener("input", () => {
            d.values[f.id] = f.kind === "number" || f.kind === "money" ? toNumber(el.value) : el.value;
            refresh();
          });
          hold(el);
          control = el;
        }
      }
      const row = h("div", { class: f.kind === "rows" || f.kind === "textarea" ? "custom-row wide" : "custom-row" }, label, control);
      if (f.showIf) conditional.push({ f, row });
      box.append(row);
    }
    // Any change may show or hide a field that depends on it.
    box.addEventListener("change", () => refresh());
    box.addEventListener("input", () => refresh());
    refresh();
    const note = h("div", { class: d.note ? (d.note.ok ? "custom-note ok" : "custom-note err") : "custom-note", text: d.note?.text ?? "" });
    const buttons = h("div", { class: "custom-actions" });
    for (const a of c!.actions) {
      const b = h("button", { class: a.kind === "save" ? "btn primary" : "btn secondary", text: a.label }) as HTMLButtonElement;
      b.addEventListener("click", () => void run(a, b));
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
          paint();
        } catch (e) {
          d.note = { text: String(e).replace(/^Error:\s*/, ""), ok: false };
          paint();
        }
      });
      box.append(h("div", { class: "custom-row wide custom-fill" }, area, h("div", { class: "custom-actions" }, go)));
    }
    return box;
  }

  function rowsEditor(f: CustomField, refresh: () => void, hold: (el: HTMLElement) => void): HTMLElement {
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
            const num = col.kind === "number" || col.kind === "money";
            const inp = h("input", { type: col.kind === "date" ? "date" : "text", class: "custom-input", inputmode: num ? "decimal" : undefined }) as HTMLInputElement;
            const v = row[col.id];
            inp.value = v == null ? "" : num ? String(v).replace(".", ",") : String(v);
            inp.addEventListener("input", () => {
              row[col.id] = num ? toNumber(inp.value) : inp.value;
              refresh();
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
    });
    return h("div", { class: "custom-rows" }, table, add);
  }

  async function run(a: Custom["actions"][number], b: HTMLButtonElement) {
    const say = (text: string, ok: boolean) => {
      d.note = { text, ok };
      paint();
    };
    const filled = () => fillTemplate(c!, d.values);
    const all = withComputed(c!, d.values);
    const plain = (s: string) => s.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (m, k: string) => {
      const f = c!.fields.find((x) => x.id === k);
      return f ? shown(f.kind, all[k]) : m;
    });
    b.disabled = true;
    try {
      switch (a.kind) {
        case "save": {
          const r = await Bridge.customRecordSave(c!.id, d.record, d.values);
          d.record = r.id;
          d.records = null;
          Sound.play("finish");
          say(t("Scheda salvata."), true);
          break;
        }
        case "document": {
          const name = `${c!.name} ${titleOf(c!, { id: "", created: "", updated: "", values: d.values })}`;
          const md = filled();
          const f = await Bridge.customDocument(name, a.format === "md" ? "md" : "html", a.format === "md" ? md : asHtml(name, md));
          Sound.play("finish");
          say(t("Documento nel Vassoio: {name}", { name: f.name }), true);
          break;
        }
        case "copy":
          await Bridge.customCopy(filled());
          say(t("Copiato."), true);
          break;
        case "ai":
          hooks.askChat(plain(a.prompt));
          break;
        case "url": {
          const url = a.url.replace(/\{\{([A-Za-z0-9_]+)\}\}/g, (m, k: string) => {
            const f = c!.fields.find((x) => x.id === k);
            return f ? encodeURIComponent(shown(f.kind, all[k])) : m;
          });
          void Bridge.openUrl(url);
          break;
        }
        case "quick":
          hooks.runQuick(a.quick);
          break;
        case "fill": {
          // A field for the text, then the fields filled in the form (not saved yet).
          fillOpen = !fillOpen;
          paint();
          break;
        }
        case "export": {
          const list = d.records ?? (await Bridge.customRecords(c!.id)) ?? [];
          if (!list.length) {
            say(t("Nessuna scheda da esportare."), false);
            break;
          }
          const f = await Bridge.customDocument(`${c!.name} schede`, "csv", toCsv(c!, list));
          say(t("{n} schede in CSV nel Vassoio: {name}", { n: list.length, name: f.name }), true);
          break;
        }
        case "notion": {
          const props: Record<string, unknown> = {};
          for (const f of c!.fields) {
            if (f.kind === "rows") continue;
            const v = all[f.id];
            if (v == null || v === "") continue;
            props[f.label] = f.kind === "computed" || f.kind === "money" || f.kind === "number" ? toNumber(v) : v;
          }
          const out = await Bridge.customToNotion(a.database, props);
          say(out.split("\n")[0] || t("Aggiunto a Notion."), true);
          break;
        }
      }
    } catch (e) {
      say(String(e).replace(/^Error:\s*/, ""), false);
    } finally {
      b.disabled = false;
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
    search.addEventListener("focus", () => void Bridge.focusWindow(true));
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
    const head = h("div", { class: "custom-summary", text: [t("{n} schede", { n: d.records.length }), ...totals].join(" · ") });
    box.append(head, search, rows);
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
