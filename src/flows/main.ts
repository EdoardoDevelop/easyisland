// The flows window (docs/flussi.md, stage 6): every automation is a flow and
// is built here. Left, the list of flows; middle, the flow drawn top to bottom
// ("Quando" card, step cards, a "+" between every two, "Fine"), with the bar
// of blocks at the bottom to drag in; right, the panel of the chosen card,
// with the data the step can use as chips to click in. One flow is saved at a
// time (flow_save), a moment after each change, so this window never undoes
// what another one changed.

import "../settings/settings.css";
import "../settings/settings-windows.css";
import "../settings/settings-light.css";
import "./flows.css";
import { Bridge, IS_TAURI, onEvent, type FlowRun, type FlowRunInfo } from "../core/bridge";
import { CHAT_ENGINES, DEFAULT_SETTINGS, PROBE_INTEGRATIONS, type Automation, type AutomationCondition, type AutomationStep, type AutomationTrigger, type QuickAction, type Settings } from "../core/state";
import { h, clear } from "../views/dom";
import { locale, syncLanguage, t } from "../core/i18n";
import { applyUiStyle } from "../core/uistyle";
import { CONDITIONS, GROUPS, PLACEHOLDERS, TRIGGERS, blankCondition, blankFlow, blankStep, block, missing, stepWords, triggerWords } from "./catalog";

let settings: Settings = { ...DEFAULT_SETTINGS };
let current = "";
/** The card whose panel is open: "trigger", a step's index, or nothing. */
let picked: "trigger" | number | null = "trigger";
let tab: "edit" | "runs" = "edit";
/** The run shown in "Esecuzioni": its steps mark the cards. */
let shownRun: FlowRun | null = null;
let status = "";
/** The status says something is missing. */
let statusWarn = false;
let savedAt = 0;
let saveTimer = 0;
/** The field the data chips write into. */
let lastField: HTMLInputElement | HTMLTextAreaElement | null = null;

const root = document.getElementById("flows-root")!;

const flows = () => settings.automations as Automation[];
const flow = () => flows().find((a) => a.id === current);

// ── Saving ────────────────────────────────────────────────────────────────────

function commit(redraw = false) {
  const f = flow();
  if (!f) return;
  status = t("Salvataggio…");
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(async () => {
    savedAt = Date.now();
    try {
      const left = IS_TAURI ? await Bridge.flowSave(f) : "";
      const issue = problems(f) || (left ? t("Da completare: {x}", { x: left }) : "");
      statusWarn = !!issue;
      status = issue || t("Salvato");
    } catch (e) {
      status = String(e).replace(/^Error:\s*/, "");
    }
    drawStatus();
  }, 450);
  drawStatus();
  if (redraw) render();
}

/** What the flow still needs, in words: the first card that is not complete. */
function problems(f: Automation): string {
  if (f.steps.length === 0) return t("Da completare: aggiungi almeno un passo");
  for (const s of f.steps) {
    const m = missing(s);
    if (m) return t("Da completare: «{name}», {what}", { name: s.node || block(s.kind).label, what: m });
  }
  return "";
}

let statusEl: HTMLElement | null = null;
function drawStatus() {
  if (statusEl) {
    statusEl.textContent = status;
    statusEl.classList.toggle("warn", statusWarn);
  }
}

// ── Names and links ───────────────────────────────────────────────────────────

function freeName(steps: AutomationStep[], kind: string): string {
  const base = block(kind).label.toLowerCase().normalize("NFD").replace(/[^a-z0-9]/g, "") || "passo";
  const used = new Set(steps.map((s) => s.node));
  if (!used.has(base)) return base;
  let n = 2;
  while (used.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

function nameAll(f: Automation) {
  f.steps.forEach((s, i) => { if (!s.node?.trim()) s.node = freeName(f.steps.slice(0, i), s.kind); });
}

function relink(steps: AutomationStep[], from: string, to: string) {
  for (const s of steps) {
    if (s.next === from) s.next = to;
    if (s.onError === from) s.onError = to;
    if (s.body === from) s.body = to;
    for (const b of s.branches ?? []) if (b.to === from) b.to = to;
  }
}

function insertStep(at: number, kind: AutomationStep["kind"]) {
  const f = flow();
  if (!f || f.steps.length >= 30) return;
  const s = { ...blankStep(kind), node: freeName(f.steps, kind) };
  f.steps.splice(at, 0, s);
  picked = at;
  tab = "edit";
  commit(true);
}

function moveStep(from: number, to: number) {
  const f = flow();
  if (!f || from === to || from + 1 === to) return;
  const [s] = f.steps.splice(from, 1);
  if (!s) return;
  const at = to > from ? to - 1 : to;
  f.steps.splice(at, 0, s);
  picked = at;
  commit(true);
}

function removeStep(i: number) {
  const f = flow();
  if (!f) return;
  const [gone] = f.steps.splice(i, 1);
  if (gone) relink(f.steps, gone.node ?? "", "");
  picked = f.steps.length ? Math.max(0, i - 1) : "trigger";
  commit(true);
}

// ── Small controls ────────────────────────────────────────────────────────────

function select<T extends string>(options: [T, string][], value: T, onChange: (v: T) => void): HTMLSelectElement {
  const el = h("select", {}) as HTMLSelectElement;
  for (const [v, label] of options) el.append(h("option", { value: v, text: label }));
  el.value = value;
  el.addEventListener("change", () => onChange(el.value as T));
  return el;
}

function toggle(on: boolean, onChange: (v: boolean) => void): HTMLElement {
  const el = h("button", { class: on ? "switch on" : "switch", "aria-pressed": on });
  el.addEventListener("click", () => {
    const next = !el.classList.contains("on");
    el.classList.toggle("on", next);
    onChange(next);
  });
  return el;
}

/** A text field that takes data chips; `long` = a box of a few lines. */
function text(value: string, placeholder: string, apply: (v: string) => void, long = false): HTMLInputElement | HTMLTextAreaElement {
  const el = long
    ? (h("textarea", { rows: "3", placeholder, spellcheck: "false" }) as HTMLTextAreaElement)
    : (h("input", { type: "text", placeholder, spellcheck: "false" }) as HTMLInputElement);
  el.value = value ?? "";
  el.addEventListener("focus", () => { lastField = el; });
  el.addEventListener("input", () => { apply(el.value); commit(); });
  // The drawing follows; the panel stays, so the next click lands where aimed.
  el.addEventListener("change", () => refreshCanvas());
  return el;
}

function num(value: number, min: number, max: number, apply: (n: number) => void): HTMLInputElement {
  const el = h("input", { type: "number", min: String(min), max: String(max), value: String(value), class: "num" }) as HTMLInputElement;
  el.addEventListener("change", () => {
    const n = Math.min(max, Math.max(min, Math.round(Number(el.value)) || min));
    el.value = String(n);
    apply(n);
    commit(true);
  });
  return el;
}

function time(value: string, apply: (v: string) => void): HTMLInputElement {
  const el = h("input", { type: "time", value: value || "09:00" }) as HTMLInputElement;
  el.addEventListener("change", () => { apply(el.value); commit(true); });
  return el;
}

const DAYS: [number, string][] = [[1, "L"], [2, "M"], [3, "M"], [4, "G"], [5, "V"], [6, "S"], [7, "D"]];
function days(value: number[], apply: (d: number[]) => void): HTMLElement {
  const box = h("div", { class: "days" });
  let now = [...(value ?? [])];
  for (const [d, label] of DAYS) {
    const b = h("button", { class: now.includes(d) ? "day on" : "day", text: label, title: t("Nessun giorno = tutti i giorni") });
    b.addEventListener("click", () => {
      now = now.includes(d) ? now.filter((x) => x !== d) : [...now, d].sort();
      b.classList.toggle("on");
      apply(now);
      commit(true);
    });
    box.append(b);
  }
  return box;
}

/** One line of the panel: a label above its control(s). */
function line(label: string, ...controls: (Node | string | null)[]): HTMLElement {
  return h("div", { class: "fl-line" }, h("label", { text: label }), h("div", { class: "fl-controls" }, ...controls.filter((c): c is Node | string => c != null)));
}

const note = (x: string) => h("div", { class: "fl-note", text: x });

// ── Data the steps can use ────────────────────────────────────────────────────

/** The data available at step `i`: the trigger's, the steps before it, the run's. */
function dataAt(f: Automation, i: number): string[] {
  const out = [...(PLACEHOLDERS[f.trigger.kind] ?? []), "ora", "data"];
  f.steps.slice(0, Math.max(0, i)).forEach((s) => {
    if (!s.node) return;
    out.push(s.node);
    for (const fld of s.fields ?? []) out.push(`${s.node}.${fld}`);
  });
  if (i > 0) out.push("risultato");
  if (f.steps.some((s) => s.kind === "foreach")) out.push("elemento");
  if (f.steps.some((s) => s.onError)) out.push("errore");
  return [...new Set(out)];
}

function chips(names: string[]): HTMLElement {
  const box = h("div", { class: "fl-chips" }, h("span", { class: "fl-note", text: t("Dati da usare (clic per inserire):") }));
  for (const n of names) {
    const c = h("button", { class: "fl-chip", text: `{${n}}` });
    // Keep the focus where it was, so the chip goes into that field.
    c.addEventListener("mousedown", (e) => e.preventDefault());
    c.addEventListener("click", () => {
      const el = lastField;
      if (!el || !el.isConnected) return;
      const at = el.selectionStart ?? el.value.length;
      el.value = `${el.value.slice(0, at)}{${n}}${el.value.slice(el.selectionEnd ?? at)}`;
      el.dispatchEvent(new Event("input"));
      el.focus();
    });
    box.append(c);
  }
  return box;
}

// ── The canvas ────────────────────────────────────────────────────────────────

let dragging: { kind?: AutomationStep["kind"]; from?: number } | null = null;

function slot(at: number): HTMLElement {
  const plus = h("button", { class: "fl-plus", text: "+", title: t("Aggiungi un passo qui") });
  plus.addEventListener("click", (e) => { e.stopPropagation(); openMenu(plus, at); });
  const el = h("div", { class: "fl-slot" }, h("div", { class: "fl-wire" }), plus, h("div", { class: "fl-wire" }));
  el.addEventListener("dragover", (e) => {
    if (!dragging) return;
    e.preventDefault();
    el.classList.add("over");
  });
  el.addEventListener("dragleave", () => el.classList.remove("over"));
  el.addEventListener("drop", (e) => {
    e.preventDefault();
    el.classList.remove("over");
    const d = dragging;
    dragging = null;
    if (d?.kind) insertStep(at, d.kind);
    else if (d?.from !== undefined) moveStep(d.from, at);
  });
  return el;
}

/** The "+" menu: the blocks by group, the one clicked goes there. */
function openMenu(anchor: HTMLElement, at: number) {
  document.querySelector(".fl-menu")?.remove();
  const menu = h("div", { class: "fl-menu" });
  for (const g of GROUPS) {
    menu.append(h("div", { class: "fl-menu-group", text: g.name }));
    for (const b of g.blocks) {
      menu.append(h("button", { class: "fl-menu-item", onclick: () => { menu.remove(); insertStep(at, b.kind); } },
        h("span", { class: "fl-ico", style: `background:${b.color}22;color:${b.color}`, text: b.icon }),
        h("span", {}, h("b", { text: b.label }), h("small", { text: b.hint }))));
    }
  }
  document.body.append(menu);
  const r = anchor.getBoundingClientRect();
  const top = Math.min(r.bottom + 6, window.innerHeight - menu.offsetHeight - 8);
  menu.style.left = `${Math.max(8, r.left + r.width / 2 - menu.offsetWidth / 2)}px`;
  menu.style.top = `${Math.max(8, top)}px`;
  const away = (e: MouseEvent) => {
    if (!menu.contains(e.target as Node)) {
      menu.remove();
      document.removeEventListener("mousedown", away);
    }
  };
  window.setTimeout(() => document.addEventListener("mousedown", away), 0);
}

/** Where a link goes, in words. */
function dest(_f: Automation, to: string): string {
  if (to === "end") return t("fine");
  if (!to) return t("passo seguente");
  return to;
}

function ranState(node: string): "ok" | "bad" | "" {
  if (!shownRun) return "";
  const steps = shownRun.trace.filter((x) => x.node === node);
  if (!steps.length) return "";
  return steps[steps.length - 1].ok ? "ok" : "bad";
}

function triggerCard(f: Automation): HTMLElement {
  const conds = (f.conditions ?? []).map((c) => {
    const what = CONDITIONS.find(([k]) => k === c.kind)?.[1] ?? c.kind;
    return c.not ? t("non {what}", { what }) : what;
  });
  const prof = settings.profiles.find((p) => p.id === f.profile)?.name;
  if (prof) conds.unshift(t("profilo {x}", { x: prof }));
  const card = h("div", { class: `fl-card trigger${picked === "trigger" ? " picked" : ""}` },
    h("div", { class: "fl-card-head" },
      h("span", { class: "fl-ico", style: "background:#4cc2ff22;color:#4cc2ff", text: "⏰" }),
      h("span", { class: "fl-kind", text: t("Quando") })),
    h("div", { class: "fl-sum", text: triggerWords(f.trigger) }),
    conds.length ? h("div", { class: "fl-tags" }, ...conds.map((c) => h("span", { class: "fl-tag", text: t("se {x}", { x: c }) }))) : null);
  card.addEventListener("click", () => { picked = "trigger"; tab = "edit"; render(); });
  return card;
}

function stepCard(f: Automation, s: AutomationStep, i: number): HTMLElement {
  const b = block(s.kind);
  const miss = missing(s);
  const ran = ranState(s.node ?? "");
  const del = h("button", { class: "fl-del", text: "✕", title: t("Togli questo passo") });
  del.addEventListener("click", (e) => { e.stopPropagation(); removeStep(i); });
  const tags: HTMLElement[] = [];
  if (s.kind === "decide") {
    for (const br of s.branches ?? []) {
      const cond = br.op === "model" ? (br.toMatch || t("…")) : br.op === "else" ? t("altrimenti")
        : br.op === "empty" ? t("{x} è vuoto", { x: br.value }) : br.op === "filled" ? t("{x} non è vuoto", { x: br.value })
          : `${br.value} ${br.op === "equals" ? t("è") : t("contiene")} «${br.toMatch}»`;
      tags.push(h("div", { class: "fl-way" }, h("span", { text: cond }), h("b", { text: `→ ${dest(f, br.to)}` })));
    }
  }
  if (s.kind === "foreach") tags.push(h("div", { class: "fl-way" }, h("span", { text: t("ogni voce") }), h("b", { text: `→ ${s.body || "?"}` })));
  const badges: HTMLElement[] = [];
  if (s.next && s.kind !== "decide") badges.push(h("span", { class: "fl-tag jump", text: `→ ${dest(f, s.next)}` }));
  if ((s.retries ?? 0) > 0) badges.push(h("span", { class: "fl-tag", text: t("riprova {n}", { n: s.retries ?? 0 }) }));
  if (s.onError) badges.push(h("span", { class: "fl-tag err", text: t("se non riesce → {x}", { x: dest(f, s.onError) }) }));
  if (miss) badges.push(h("span", { class: "fl-tag warn", text: miss }));
  const card = h("div", { class: `fl-card${picked === i ? " picked" : ""}${ran ? ` ran-${ran}` : ""}`, draggable: "true" },
    h("div", { class: "fl-card-head" },
      h("span", { class: "fl-ico", style: `background:${b.color}22;color:${b.color}`, text: b.icon }),
      h("span", { class: "fl-kind", text: b.label }),
      h("span", { class: "fl-node", text: s.node ?? "" }),
      del),
    h("div", { class: "fl-sum", text: stepWords(s) }),
    tags.length ? h("div", { class: "fl-ways" }, ...tags) : null,
    badges.length ? h("div", { class: "fl-tags" }, ...badges) : null);
  card.addEventListener("click", () => { picked = i; tab = "edit"; render(); });
  card.addEventListener("dragstart", (e) => {
    dragging = { from: i };
    e.dataTransfer?.setData("text/plain", String(i));
    card.classList.add("dragging");
    root.classList.add("is-dragging");
  });
  card.addEventListener("dragend", () => { dragging = null; card.classList.remove("dragging"); root.classList.remove("is-dragging"); });
  return card;
}

function canvas(f: Automation): HTMLElement {
  const col = h("div", { class: "fl-column" }, triggerCard(f));
  f.steps.forEach((s, i) => col.append(slot(i), stepCard(f, s, i)));
  col.append(slot(f.steps.length));
  if (f.steps.length === 0) col.append(starter(f));
  col.append(h("div", { class: "fl-end" }, h("span", { text: t("Fine") })));
  return h("div", { class: "fl-canvas" }, col);
}

/** An empty flow: ready-made starts, or say it in words. */
function starter(f: Automation): HTMLElement {
  const make = (name: string, fill: (f: Automation) => void) => h("button", { class: "fl-template", onclick: () => {
    if (!f.name || f.name === t("Nuovo flusso")) f.name = name;
    fill(f);
    nameAll(f);
    picked = 0;
    commit(true);
  } }, h("b", { text: name }));
  return h("div", { class: "fl-starter" },
    h("div", { class: "fl-note", text: t("Trascina qui un blocco dalla barra in basso, premi + oppure parti da un modello:") }),
    h("div", { class: "fl-templates" },
      make(t("Inizio giornata"), (x) => {
        x.trigger = { ...x.trigger, kind: "unlock" };
        x.repeat = "day";
        x.steps = [
          { ...blankStep("agent"), node: "punto", title: t("Punto della giornata"), text: t("Guarda la mia posta, il calendario di oggi e i ticket aperti e fammi un punto della giornata in 5 righe.") },
          { ...blankStep("notice"), node: "avviso", title: t("Buongiorno"), text: "{punto}" },
        ];
      }),
      make(t("File in arrivo"), (x) => {
        x.trigger = { ...x.trigger, kind: "download", filter: ".pdf" };
        x.steps = [
          { ...blankStep("agent"), node: "leggi", title: t("Leggi il file"), text: t("Leggi {percorso} e dimmi in due righe cos'è."), fields: ["tipo"] },
          { ...blankStep("notice"), node: "avviso", title: "{file}", text: "{leggi}" },
        ];
      }),
      make(t("Ticket urgenti"), (x) => {
        x.trigger = { ...x.trigger, kind: "time", time: "09:00" };
        x.steps = [
          { ...blankStep("agent"), node: "leggi", title: t("Leggi i ticket"), text: t("Leggi i ticket nuovi e dimmi se ce n'è uno urgente."), fields: ["urgente"] },
          { ...blankStep("decide"), node: "scelta", branches: [{ value: "{leggi.urgente}", op: "contains", toMatch: t("sì"), to: "avviso" }, { value: "", op: "else", toMatch: "", to: "end" }] },
          { ...blankStep("notice"), node: "avviso", title: t("Ticket urgente"), text: "{leggi}", level: "warn" },
        ];
      })),
    h("div", { class: "fl-note", text: t("…oppure descrivilo a parole nella colonna a sinistra: lo prepara la chat.") }));
}

function palette(): HTMLElement {
  const bar = h("div", { class: "fl-palette" });
  for (const g of GROUPS) {
    const grp = h("div", { class: "fl-pal-group" }, h("span", { class: "fl-pal-name", text: g.name }));
    for (const b of g.blocks) {
      const el = h("button", { class: "fl-pal-block", draggable: "true", title: b.hint },
        h("span", { class: "fl-ico", style: `background:${b.color}22;color:${b.color}`, text: b.icon }),
        h("span", { text: b.label }));
      el.addEventListener("dragstart", (e) => {
        dragging = { kind: b.kind };
        e.dataTransfer?.setData("text/plain", b.kind);
        root.classList.add("is-dragging");
      });
      el.addEventListener("dragend", () => { dragging = null; root.classList.remove("is-dragging"); });
      // A click puts it at the end.
      el.addEventListener("click", () => { const f = flow(); if (f) insertStep(f.steps.length, b.kind); });
      grp.append(el);
    }
    bar.append(grp);
  }
  return bar;
}

// ── The panel ─────────────────────────────────────────────────────────────────

function quickActions(): [string, string][] {
  const seen = new Map<string, string>();
  for (const a of settings.actions ?? []) seen.set(a.id, a.name || t("Senza nome"));
  for (const p of settings.profiles) {
    const acts = (p.values as Record<string, unknown>).actions;
    if (Array.isArray(acts)) for (const a of acts as QuickAction[]) if (!seen.has(a.id)) seen.set(a.id, `${a.name || t("Senza nome")} (${p.name})`);
  }
  return [...seen.entries()];
}

function sources(): [string, string][] {
  const out: [string, string][] = [];
  for (const id of Object.keys(PROBE_INTEGRATIONS)) {
    if (settings.activeIntegrations.includes(id)) out.push([id, id.replace(/^integration_/, "").replace(/_/g, " ")]);
  }
  for (const w of settings.widgets ?? []) out.push([w.id, w.name || "Widget"]);
  return out;
}

function triggerPanel(f: Automation): HTMLElement {
  const tr = f.trigger;
  const p = h("div", { class: "fl-panel" }, h("h3", { text: t("Quando parte") }));
  p.append(line(t("Evento"), select<AutomationTrigger["kind"]>(TRIGGERS, tr.kind, (v) => {
    tr.kind = v;
    if (v === "agent" && !["stop", "permission", "any"].includes(tr.when)) tr.when = "stop";
    if (v === "integration" && !["problem", "event", "any"].includes(tr.when)) tr.when = "problem";
    if (v === "teams" && !["start", "end"].includes(tr.when)) tr.when = "start";
    commit(true);
  })));
  const filter = (ph: string) => line(t("Solo se contiene"), text(tr.filter ?? "", ph, (v) => { tr.filter = v.trim(); }));
  switch (tr.kind) {
    case "time": p.append(line(t("Ora"), time(tr.time, (v) => { tr.time = v; })), line(t("Giorni"), days(tr.days, (d) => { tr.days = d; }))); break;
    case "startup": p.append(line(t("Secondi dopo l'avvio"), num(tr.delay || 30, 5, 3600, (n) => { tr.delay = n; }))); break;
    case "back": p.append(line(t("Minuti di assenza"), num(tr.minutes || 15, 1, 720, (n) => { tr.minutes = n; }))); break;
    case "wifi": p.append(line(t("Rete Wi-Fi"), text(tr.ssid, t("es. Ufficio-5G"), (v) => { tr.ssid = v.trim(); }))); break;
    case "app": case "foreground": p.append(line(t("Programma"), text(tr.exe, t("es. teams.exe"), (v) => { tr.exe = v.trim(); }))); break;
    case "folder": p.append(line(t("Cartella"), text(tr.folder, t("es. C:\\Users\\nome\\Scansioni"), (v) => { tr.folder = v.trim(); })), filter(t("es. .pdf"))); break;
    case "download": p.append(filter(t("es. .pdf, .zip"))); break;
    case "call": p.append(filter(t("nome o numero, es. Rossi"))); break;
    case "server": p.append(filter(t("es. node, 5173"))); break;
    case "agent":
      p.append(line(t("Quando l'agente"), select<AutomationTrigger["when"]>([["stop", t("ha finito")], ["permission", t("aspetta un permesso")], ["any", t("tutti e due")]], tr.when, (v) => { tr.when = v; commit(true); })),
        filter(t("progetto, es. easyisland")));
      break;
    case "teams":
      p.append(line(t("La riunione"), select<AutomationTrigger["when"]>([["start", t("inizia")], ["end", t("finisce")]], tr.when === "end" ? "end" : "start", (v) => { tr.when = v; commit(true); })));
      break;
    case "integration": {
      const opts = sources();
      if (!tr.source && opts[0]) tr.source = opts[0][0];
      p.append(line(t("Da"), opts.length ? select<string>(opts, tr.source, (v) => { tr.source = v; commit(true); }) : note(t("Accendi un'integrazione come Stato del PC o Zammad, o crea un widget."))),
        line(t("Quando segnala"), select<AutomationTrigger["when"]>([["problem", t("un problema")], ["event", t("una novità")], ["any", t("tutti e due")]], (tr.when || "problem") as AutomationTrigger["when"], (v) => { tr.when = v; commit(true); })),
        filter(t("es. urgente")));
      break;
    }
  }
  p.append(h("h3", { text: t("Solo se") }));
  p.append(line(t("Profilo"), select<string>([["", t("Qualsiasi")], ...settings.profiles.map((x): [string, string] => [x.id, x.name])], f.profile, (v) => { f.profile = v; commit(true); })));
  const conds = (f.conditions ??= []);
  conds.forEach((c, ci) => {
    const row = h("div", { class: "fl-cond" },
      select<string>([["", t("se")], ["not", t("se non")]], c.not ? "not" : "", (v) => { c.not = v === "not"; commit(true); }),
      select<AutomationCondition["kind"]>(CONDITIONS, c.kind, (v) => { conds[ci] = { ...blankCondition(v), not: c.not }; commit(true); }),
      h("button", { class: "danger icon", text: "✕", onclick: () => { conds.splice(ci, 1); commit(true); } }));
    p.append(row);
    switch (c.kind) {
      case "hours": p.append(h("div", { class: "fl-cond-more" }, time(c.from, (v) => { c.from = v; }), h("span", { text: t("e le") }), time(c.to || "18:00", (v) => { c.to = v; }), days(c.days, (d) => { c.days = d; }))); break;
      case "wifi": p.append(h("div", { class: "fl-cond-more" }, text(c.ssid, t("nome della rete"), (v) => { c.ssid = v.trim(); }))); break;
      case "app": case "foreground": p.append(h("div", { class: "fl-cond-more" }, text(c.exe, t("es. excel.exe"), (v) => { c.exe = v.trim(); }))); break;
      case "idle": p.append(h("div", { class: "fl-cond-more" }, num(c.minutes || 10, 1, 720, (n) => { c.minutes = n; }), h("span", { text: t("minuti") }))); break;
      case "battery": p.append(h("div", { class: "fl-cond-more" }, h("span", { text: t("sotto il") }), num(c.percent, 0, 100, (n) => { c.percent = n; }), h("span", { text: t("% (0 = solo a batteria)") }))); break;
    }
  });
  p.append(h("button", { text: t("+ Aggiungi una condizione"), onclick: () => { conds.push(blankCondition("hours")); commit(true); } }));
  p.append(h("h3", { text: t("Altro") }));
  p.append(line(t("Quante volte"), select<"" | "every" | "day">([["", t("ogni volta")], ["every", t("al massimo ogni N minuti")], ["day", t("una volta al giorno")]], (f.repeat ?? "") as "" | "every" | "day", (v) => { f.repeat = v; if (v === "every" && !f.every) f.every = 60; commit(true); }),
    f.repeat === "every" ? num(f.every || 60, 1, 1440, (n) => { f.every = n; }) : null));
  p.append(line(t("Avvisami ogni volta che gira"), toggle(f.notify, (v) => { f.notify = v; commit(); })));
  return p;
}

function stepPanel(f: Automation, s: AutomationStep, i: number): HTMLElement {
  const b = block(s.kind);
  const others = f.steps.map((x) => x.node ?? "").filter((n, j) => n && j !== i);
  const targets: [string, string][] = [["", t("il passo seguente")], ["end", t("la fine")], ...others.map((n): [string, string] => [n, n])];
  const p = h("div", { class: "fl-panel" },
    h("div", { class: "fl-panel-head" },
      h("span", { class: "fl-ico big", style: `background:${b.color}22;color:${b.color}`, text: b.icon }),
      h("div", {}, h("h3", { text: b.label }), h("div", { class: "fl-note", text: b.hint }))));
  const nameIn = h("input", { type: "text", value: s.node ?? "", spellcheck: "false" }) as HTMLInputElement;
  nameIn.addEventListener("change", () => {
    const v = nameIn.value.trim().replace(/[\s{}]/g, "");
    if (!v || v === "end" || others.includes(v)) { nameIn.value = s.node ?? ""; return; }
    relink(f.steps, s.node ?? "", v);
    s.node = v;
    commit(true);
  });
  p.append(line(t("Nome del passo"), nameIn), note(t("Il suo risultato si usa nei passi dopo come {x}.", { x: `{${s.node}}` })));

  switch (s.kind) {
    case "notice":
      p.append(line(t("Titolo"), text(s.title, t("es. Ticket urgente"), (v) => { s.title = v; })),
        line(t("Testo"), text(s.text, t("es. {leggi}"), (v) => { s.text = v; }, true)),
        line(t("Tipo"), select<string>([["info", t("Informazione")], ["ok", t("Fatto")], ["warn", t("Attenzione")], ["error", t("Errore")]], s.level || "info", (v) => { s.level = v; commit(); })));
      break;
    case "app":
      p.append(line(t("Cosa aprire"), text(s.target, t("es. outlook, C:\\Clienti, {percorso}"), (v) => { s.target = v.trim(); })),
        line(t("Argomenti"), text(s.args, t("facoltativi"), (v) => { s.args = v; })));
      break;
    case "url": p.append(line(t("Link"), text(s.url, "https://…", (v) => { s.url = v.trim(); }))); break;
    case "quick": {
      const opts = quickActions();
      if (!s.id && opts[0]) s.id = opts[0][0];
      p.append(line(t("Azione"), opts.length ? select<string>(opts, s.id, (v) => { s.id = v; commit(true); }) : note(t("Crea prima un'azione rapida in Impostazioni."))));
      break;
    }
    case "profile":
      if (!s.id && settings.profiles[0]) s.id = settings.profiles[0].id;
      p.append(line(t("Profilo"), select<string>(settings.profiles.map((x): [string, string] => [x.id, x.name]), s.id, (v) => { s.id = v; commit(true); })));
      break;
    case "chat": p.append(line(t("Domanda alla chat"), text(s.text, t("es. Riassumi {percorso}"), (v) => { s.text = v; }, true))); break;
    case "task":
      p.append(line(t("Titolo"), text(s.title, t("facoltativo"), (v) => { s.title = v; })),
        line(t("Obiettivo"), text(s.text, t("es. Prepara un riepilogo dei ticket in Notion"), (v) => { s.text = v; }, true)));
      break;
    case "agent": {
      p.append(line(t("Cosa deve fare"), text(s.text, t("es. Leggi i ticket nuovi e dimmi se ce n'è uno urgente"), (v) => { s.text = v; }, true)),
        line(t("Titolo"), text(s.title, t("facoltativo, per riconoscerlo"), (v) => { s.title = v; })),
        line(t("Motore"), select<string>([["", t("quello dei Compiti")], ...CHAT_ENGINES.map((e): [string, string] => [e.id, e.name])], s.engine ?? "", (v) => { s.engine = v; s.model = ""; commit(); })));
      const fieldsIn = h("input", { type: "text", value: (s.fields ?? []).join(", "), placeholder: t("es. urgente, cliente"), spellcheck: "false" }) as HTMLInputElement;
      fieldsIn.addEventListener("change", () => {
        s.fields = fieldsIn.value.split(",").map((x) => x.trim().replace(/[^\p{L}\p{N}_]/gu, "")).filter(Boolean).slice(0, 8);
        commit(true);
      });
      p.append(line(t("Risposte da usare dopo"), fieldsIn),
        note(s.fields?.length ? t("Le trovi come {x}", { x: s.fields.map((x) => `{${s.node}.${x}}`).join(" ") }) : t("Facoltative: nomi separati da virgola che l'agente compila, comodi nelle scelte.")),
        line(t("Tempo massimo (minuti)"), num(s.minutes || 60, 1, 720, (n) => { s.minutes = n; })));
      break;
    }
    case "ask":
      p.append(line(t("Domanda"), text(s.title, t("es. Creo l'attività su To Do?"), (v) => { s.title = v; })),
        line(t("Dettagli"), text(s.text, t("facoltativi, es. {leggi}"), (v) => { s.text = v; }, true)),
        line(t("Risposte"), text((s.options ?? []).join(", "), t("fino a 3, separate da virgola (vuoto = Sì, No)"), (v) => { s.options = v.split(",").map((x) => x.trim()).filter(Boolean).slice(0, 3); })),
        note(t("Con Telegram collegato la domanda arriva anche lì.")));
      break;
    case "confirm":
      p.append(line(t("Titolo"), text(s.title, t("facoltativo"), (v) => { s.title = v; })),
        line(t("Testo"), text(s.text, t("facoltativo: di serie elenca i passi che seguono"), (v) => { s.text = v; }, true)));
      break;
    case "wait": p.append(line(t("Minuti"), num(s.minutes || 5, 1, 240, (n) => { s.minutes = n; }))); break;
    case "foreach":
      p.append(line(t("Elenco (una voce per riga)"), text(s.text, t("es. {leggi}"), (v) => { s.text = v; })),
        line(t("Per ogni voce vai a"), others.length ? select<string>([["", t("scegli un passo")], ...others.map((n): [string, string] => [n, n])], s.body ?? "", (v) => { s.body = v; commit(true); }) : note(t("Aggiungi prima i passi da ripetere."))),
        note(t("Nei passi ripetuti la voce è {elemento}; l'ultimo di loro torna qui con «Dopo questo passo».")));
      break;
    case "decide": {
      const model = s.branches?.some((x) => x.op === "model") ?? false;
      p.append(line(t("Chi sceglie"), select<string>([["rules", t("una regola")], ["model", t("il modello, leggendo")]], model ? "model" : "rules", (v) => {
        s.branches = v === "model"
          ? [{ value: "", op: "model", toMatch: "", to: "" }, { value: "", op: "model", toMatch: "", to: "" }]
          : [{ value: "{risultato}", op: "contains", toMatch: "", to: "" }, { value: "", op: "else", toMatch: "", to: "" }];
        if (v === "model") s.text ||= "{risultato}";
        commit(true);
      })));
      if (model) p.append(line(t("Cosa legge"), text(s.text, t("es. {leggi}"), (v) => { s.text = v; })));
      const ops: [string, string][] = [["contains", t("contiene")], ["equals", t("è uguale a")], ["empty", t("è vuoto")], ["filled", t("non è vuoto")], ["else", t("altrimenti")]];
      (s.branches ??= []).forEach((br, bi) => {
        const box = h("div", { class: "fl-branch" }, h("div", { class: "fl-branch-title", text: t("Strada {n}", { n: bi + 1 }) }));
        if (model) {
          box.append(text(br.toMatch, t("quando, es. chiede un preventivo"), (v) => { br.toMatch = v; }));
        } else {
          const row = h("div", { class: "fl-cond" });
          if (br.op !== "else") row.append(text(br.value, "{risultato}", (v) => { br.value = v; }));
          row.append(select<string>(ops, br.op, (v) => { br.op = v as typeof br.op; commit(true); }));
          if (br.op === "contains" || br.op === "equals") row.append(text(br.toMatch, t("testo"), (v) => { br.toMatch = v; }));
          box.append(row);
        }
        box.append(h("div", { class: "fl-cond" }, h("span", { text: t("vai a") }),
          select<string>(targets, br.to, (v) => { br.to = v; commit(true); }),
          h("button", { class: "danger icon", text: "✕", title: t("Togli questa strada"), onclick: () => { s.branches?.splice(bi, 1); commit(true); } })));
        p.append(box);
      });
      p.append(h("button", { text: t("+ Aggiungi una strada"), onclick: () => { s.branches?.push(model ? { value: "", op: "model", toMatch: "", to: "" } : { value: "{risultato}", op: "contains", toMatch: "", to: "" }); commit(true); } }),
        note(model ? t("Il motore legge e sceglie la strada descritta meglio.") : t("Vince la prima strada che vale.")));
      break;
    }
  }
  if (s.kind !== "decide") {
    p.append(line(s.kind === "foreach" ? t("Finite le voci, vai a") : t("Dopo questo passo"), select<string>(targets, s.next ?? "", (v) => { s.next = v; commit(true); })));
  }
  if (!["wait", "confirm", "ask", "foreach"].includes(s.kind) && !(s.kind === "decide" && !s.branches?.some((x) => x.op === "model"))) {
    p.append(h("h3", { text: t("Se non riesce") }),
      line(t("Riprova"), select<string>([["0", t("no")], ["1", t("1 volta")], ["2", t("2 volte")], ["3", t("3 volte")]], String(s.retries ?? 0), (v) => { s.retries = Number(v); commit(true); })),
      line(t("Poi"), select<string>([["", t("ferma il flusso")], ["end", t("finisci senza errore")], ...others.map((n): [string, string] => [n, t("vai a {x}", { x: n })])], s.onError ?? "", (v) => { s.onError = v; commit(true); })),
      note(t("Il motivo dell'errore è in {errore}.")));
  }
  p.append(chips(dataAt(f, i)));
  p.append(h("div", { class: "fl-panel-foot" },
    h("button", { text: t("Prova da qui"), onclick: () => tryFrom(f, s.node ?? "") }),
    h("button", { class: "danger", text: t("Togli il passo"), onclick: () => removeStep(i) })));
  return p;
}

async function tryFrom(f: Automation, node: string) {
  window.clearTimeout(saveTimer);
  try {
    await Bridge.flowSave(f);
    await Bridge.flowTryFrom(f.id, node);
    status = t("Partito: lo vedi in Esecuzioni");
    tab = "runs";
    window.setTimeout(() => render(), 1200);
  } catch (e) {
    status = String(e).replace(/^Error:\s*/, "");
  }
  render();
}

async function runsPanel(f: Automation): Promise<HTMLElement> {
  const p = h("div", { class: "fl-panel" }, h("h3", { text: t("Esecuzioni") }));
  const all = ((await Bridge.flowsRuns()) ?? []).filter((r: FlowRunInfo) => r.flowId === f.id);
  if (!all.length) {
    p.append(note(t("Ancora nessuna. Premi «Prova» in alto per farlo partire adesso.")));
    return p;
  }
  const colors: Record<string, string> = { running: "#38bdf8", done: "#22c55e", failed: "#f4505e", stopped: "#8e939c" };
  const words: Record<string, string> = { running: t("in corso"), done: t("riuscita"), failed: t("errore"), stopped: t("fermata") };
  for (const r of all.slice(0, 30)) {
    const when = new Date(r.started).toLocaleString(locale(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    const row = h("button", { class: `fl-run${shownRun?.id === r.id ? " on" : ""}` },
      h("i", { class: "dot", style: `background:${colors[r.status] ?? "#8e939c"}` }),
      h("span", { text: when }), h("b", { text: words[r.status] ?? r.status }), h("small", { text: r.cause }));
    row.addEventListener("click", async () => {
      shownRun = shownRun?.id === r.id ? null : await Bridge.flowRun(r.id);
      render();
    });
    p.append(row);
    if (shownRun?.id === r.id) {
      for (const st of shownRun.trace) {
        const again = h("button", { class: "small", text: t("Riprendi da qui"), disabled: shownRun.status === "running" });
        again.addEventListener("click", async () => {
          try { await Bridge.flowRerun(shownRun!.id, st.node); status = t("Ripartito"); } catch (e) { status = String(e); }
          window.setTimeout(() => render(), 1000);
        });
        p.append(h("div", { class: "fl-trace" },
          h("div", { class: "fl-trace-head" }, h("i", { class: "dot", style: `background:${st.ok ? "#22c55e" : "#f4505e"}` }), h("b", { text: st.node }), h("span", { class: "fl-note", text: st.what }), again),
          h("div", { class: "fl-out", text: st.out })));
      }
    }
  }
  return p;
}

// ── The window ────────────────────────────────────────────────────────────────

function sidebar(): HTMLElement {
  const list = h("div", { class: "fl-list" });
  for (const a of flows()) {
    const item = h("button", { class: `fl-item${a.id === current ? " on" : ""}` },
      h("i", { class: "dot", style: `background:${a.enabled ? "#22c55e" : "#5b5f66"}` }),
      h("span", {}, h("b", { text: a.name || t("Senza nome") }), h("small", { text: triggerWords(a.trigger) })));
    item.addEventListener("click", () => { current = a.id; picked = "trigger"; shownRun = null; tab = "edit"; status = problems(a); statusWarn = !!status; render(); });
    list.append(item);
  }
  const add = h("button", { class: "primary", text: t("+ Nuovo flusso"), onclick: () => {
    const f = blankFlow();
    settings.automations.push(f);
    current = f.id;
    picked = "trigger";
    shownRun = null;
    commit(true);
  } });
  const ask = h("textarea", { rows: "4", placeholder: t("es. Ogni mattina leggi i ticket nuovi; se ce n'è uno urgente avvisami, altrimenti chiedimi se creare l'attività su To Do."), spellcheck: "false" }) as HTMLTextAreaElement;
  const send = h("button", { text: t("Crealo con la chat"), onclick: () => {
    if (!ask.value.trim()) return;
    void Bridge.flowAskChat(ask.value);
    ask.value = "";
    send.textContent = t("Mandato alla chat: conferma nell'isola");
  } });
  return h("aside", { class: "fl-side" },
    h("div", { class: "fl-side-head" }, h("h2", { text: t("Flussi") }), add),
    list,
    h("div", { class: "fl-describe" }, h("b", { text: t("Descrivilo a parole") }), ask, send));
}

function header(f: Automation): HTMLElement {
  const name = h("input", { type: "text", class: "fl-name", value: f.name, placeholder: t("Nome del flusso"), spellcheck: "false" }) as HTMLInputElement;
  name.addEventListener("input", () => { f.name = name.value; commit(); });
  name.addEventListener("change", () => refreshCanvas());
  statusEl = h("span", { class: "fl-status" });
  const del = h("button", { class: "danger", text: t("Elimina") });
  del.addEventListener("click", async () => {
    if (del.dataset.sure !== "1") { del.dataset.sure = "1"; del.textContent = t("Sicuro? Clic di nuovo"); return; }
    settings.automations = flows().filter((a) => a.id !== f.id);
    current = flows()[0]?.id ?? "";
    try { await Bridge.flowDelete(f.id); } catch { /* the settings echo shows what is there */ }
    render();
  });
  const run = h("button", { class: "primary", text: t("▶ Prova"), title: t("Fa partire il flusso adesso, senza aspettare il «Quando»") });
  run.addEventListener("click", async () => {
    window.clearTimeout(saveTimer);
    try {
      await Bridge.flowSave(f);
      await Bridge.automationRunNow(f.id);
      status = t("Partito: lo vedi in Esecuzioni");
      tab = "runs";
      window.setTimeout(() => render(), 1200);
    } catch (e) {
      status = String(e).replace(/^Error:\s*/, "");
    }
    render();
  });
  const head = h("div", { class: "fl-head" },
    name,
    h("label", { class: "fl-on" }, toggle(f.enabled, (v) => { f.enabled = v; commit(true); }), h("span", { text: f.enabled ? t("Acceso") : t("Spento") })),
    statusEl, run, del);
  drawStatus();
  return head;
}

/** Only the drawing and the list again (after typing in the panel). */
function refreshCanvas() {
  const f = flow();
  if (!f) return;
  root.querySelector(".fl-canvas")?.replaceWith(canvas(f));
  root.querySelector(".fl-side")?.replaceWith(sidebar());
}

async function render() {
  clear(root);
  root.className = "fl-root";
  const f = flow();
  const side = sidebar();
  if (!f) {
    root.append(side, h("main", { class: "fl-main empty" },
      h("div", { class: "fl-empty" }, h("h2", { text: t("Nessun flusso aperto") }),
        h("p", { text: t("Un flusso parte da solo quando succede qualcosa e fa dei passi per te: aprire programmi, avvisarti, far lavorare un agente, chiederti cosa fare.") }),
        h("p", { text: t("Crea un flusso nuovo a sinistra, o descrivilo a parole.") }))));
    return;
  }
  nameAll(f);
  if (typeof picked === "number" && !f.steps[picked]) picked = "trigger";
  const main = h("main", { class: "fl-main" }, header(f), canvas(f), palette());
  const tabs = h("div", { class: "fl-tabs" },
    h("button", { class: tab === "edit" ? "on" : "", text: t("Modifica"), onclick: () => { tab = "edit"; render(); } }),
    h("button", { class: tab === "runs" ? "on" : "", text: t("Esecuzioni"), onclick: () => { tab = "runs"; render(); } }));
  const right = h("aside", { class: "fl-right" }, tabs);
  root.append(side, main, right);
  if (tab === "runs") {
    right.append(await runsPanel(f));
  } else if (picked === "trigger") {
    right.append(triggerPanel(f));
  } else if (typeof picked === "number" && f.steps[picked]) {
    right.append(stepPanel(f, f.steps[picked], picked));
  }
}

function open(id: string) {
  if (id && flows().some((a) => a.id === id)) {
    current = id;
    picked = "trigger";
    shownRun = null;
    tab = "edit";
  }
  if (!current) current = flows()[0]?.id ?? "";
  const f = flow();
  status = f ? problems(f) : "";
  statusWarn = !!status;
  void render();
}

async function main() {
  document.title = t("Flussi — EasyIsland");
  const info = await Bridge.boot();
  if (info) {
    settings = { ...settings, ...info.settings };
    syncLanguage(settings.language);
  }
  applyUiStyle(settings.theme.style, settings.theme.scheme);
  document.body.removeAttribute("style");
  open((await Bridge.flowPending()) ?? "");
  void onEvent<string>("flows-open", (id) => open(id));
  void onEvent<Settings>("settings-changed", (s) => {
    // The echo of this window's own save is not taken: the panel keeps the
    // objects it is editing. A change from elsewhere (the chat made a flow,
    // the list in Impostazioni switched one off) redraws.
    if (Date.now() - savedAt < 2500) return;
    settings = { ...settings, ...s };
    applyUiStyle(settings.theme.style, settings.theme.scheme);
    void render();
  });
  void onEvent<null>("automations-log", () => { if (tab === "runs") void render(); });
  document.addEventListener("keydown", (e) => {
    const typing = (e.target as HTMLElement)?.closest("input, textarea, select");
    if (typing || typeof picked !== "number") return;
    if (e.key === "Delete") removeStep(picked);
  });
}

void main();
