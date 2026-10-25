// Flows in Impostazioni → Flussi (flows.rs, docs/flussi.md): the drawing of
// an automation whose steps are linked, the editor built on it (click a box to
// edit it in the panel below, add, move, remove, link and branch), and the runs
// kept on disk with what each step did and "Riprendi da qui". The drawing is
// plain SVG made here: no library.

import { Bridge, onEvent, type FlowRun, type FlowRunInfo } from "../core/bridge";
import { CHAT_ENGINES, type Automation, type AutomationStep } from "../core/state";

const ENGINES = () => CHAT_ENGINES.map((e): [string, string] => [e.id, e.name]);
import { h, clear } from "../views/dom";
import { locale, t } from "../core/i18n";

/** Steps with links or with kinds the step list cannot edit: shown as a drawing. */
export function isLinked(a: Automation): boolean {
  return a.steps.some((s) => !!s.next || (s.branches?.length ?? 0) > 0 || ["agent", "decide", "ask", "foreach"].includes(s.kind));
}

const nodeName = (s: AutomationStep, i: number) => s.node?.trim() || `s${i + 1}`;

function stepWords(s: AutomationStep): string {
  const what = s.title?.trim() || s.text?.trim() || "";
  switch (s.kind) {
    case "agent": return t("Agente: {x}", { x: what });
    case "decide": return s.branches?.some((b) => b.op === "model") ? t("Scelta del modello") : t("Scelta");
    case "foreach": return t("Per ogni voce di {x}", { x: s.text });
    case "ask": return t("Domanda: {x}", { x: what });
    case "quick": return t("Azione rapida");
    case "notice": return t("Avviso: {x}", { x: what });
    case "profile": return t("Profilo");
    case "app": return t("Apri {x}", { x: s.target });
    case "url": return t("Apri {x}", { x: s.url });
    case "chat": return t("Chiedi alla chat");
    case "task": return t("Compito: {x}", { x: what });
    case "wait": return t("Aspetta {n} minuti", { n: s.minutes ?? 5 });
    case "confirm": return t("Chiedi prima di continuare");
    default: return s.kind;
  }
}

const KIND_COLOR: Record<string, string> = { agent: "#a78bfa", decide: "#f59e0b", ask: "#38bdf8", wait: "#8e939c", confirm: "#38bdf8", foreach: "#22c55e" };

const SVG = "http://www.w3.org/2000/svg";
function el(name: string, attrs: Record<string, string | number>, text?: string): SVGElement {
  const e = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text !== undefined) e.textContent = text;
  return e;
}

const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * The flow drawn top to bottom: one box per step in order, a short arrow to
 * the next one when it simply follows, and links that jump (next, branches)
 * as curves on the right with their condition. "Fine" closes the column.
 */
export function flowDiagram(a: Automation, highlight?: Set<string>, pick?: { selected: number; onPick: (i: number) => void }): HTMLElement {
  const steps = a.steps;
  const W = 360, BOX_H = 44, GAP = 26, X = 16;
  const index = new Map(steps.map((s, i) => [nodeName(s, i), i]));
  const top = (i: number) => 12 + i * (BOX_H + GAP);
  const endY = top(steps.length);
  type Jump = { from: number; to: number; label: string };
  const jumps: Jump[] = [];
  const falls: boolean[] = [];
  steps.forEach((s, i) => {
    const branches = s.branches ?? [];
    if (s.kind === "decide" && branches.length) {
      for (const b of branches) {
        const to = b.to === "end" ? steps.length : b.to ? index.get(b.to) ?? -1 : i + 1;
        const label = b.op === "model" ? b.toMatch : b.op === "else" ? t("altrimenti")
          : b.op === "empty" ? t("vuoto") : b.op === "filled" ? t("non vuoto") : `${b.op === "equals" ? "=" : "∋"} ${b.toMatch ?? ""}`;
        if (to >= 0) jumps.push({ from: i, to, label });
      }
      falls.push(false);
      return;
    }
    if (s.kind === "foreach" && s.body) {
      const to = index.get(s.body) ?? -1;
      if (to >= 0) jumps.push({ from: i, to, label: t("ogni voce") });
    }
    const next = s.next?.trim() ?? "";
    if (!next) {
      falls.push(true);
      return;
    }
    falls.push(false);
    const to = next === "end" ? steps.length : index.get(next) ?? -1;
    if (to >= 0) jumps.push({ from: i, to, label: "" });
  });
  const H = endY + 30;
  const width = W + 60 + jumps.length * 22;
  const svg = el("svg", { viewBox: `0 0 ${width} ${H}`, width, height: H, class: "flow-svg" });
  const defs = el("defs", {});
  const marker = el("marker", { id: "flow-arrow", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: "auto-start-reverse" });
  marker.append(el("path", { d: "M0,0 L10,5 L0,10 z", class: "flow-arrowhead" }));
  defs.append(marker);
  svg.append(defs);

  // Straight arrows to the step below.
  steps.forEach((_, i) => {
    if (!falls[i]) return;
    const y1 = top(i) + BOX_H, y2 = i + 1 < steps.length ? top(i + 1) : endY;
    svg.append(el("line", { x1: X + W / 2, y1, x2: X + W / 2, y2: y2 - 2, class: "flow-edge", "marker-end": "url(#flow-arrow)" }));
  });
  // Jumps: curves on the right, each a little further out.
  // Several ways out of one box start a little apart, each with its label above.
  const fromCount = new Map<number, number>();
  const nth = jumps.map((j) => {
    const n = fromCount.get(j.from) ?? 0;
    fromCount.set(j.from, n + 1);
    return n;
  });
  jumps.forEach((j, k) => {
    const many = fromCount.get(j.from) ?? 1;
    const y1 = top(j.from) + BOX_H / 2 + (nth[k] - (many - 1) / 2) * 14;
    const y2 = j.to >= steps.length ? endY + 9 : top(j.to) + BOX_H / 2;
    const x = X + W, out = X + W + 18 + k * 22;
    const x2 = j.to >= steps.length ? X + W / 2 + 34 : x;
    svg.append(el("path", { d: `M${x},${y1} C${out},${y1} ${out},${y2} ${x2 + 2},${y2}`, class: "flow-edge jump", "marker-end": "url(#flow-arrow)" }));
    if (j.label) svg.append(el("text", { x: x + 6, y: y1 - 3, class: "flow-label" }, cut(j.label, 16)));
  });
  // Boxes.
  steps.forEach((s, i) => {
    const y = top(i);
    const name = nodeName(s, i);
    const g = el("g", { class: `flow-node${highlight?.has(name) ? " ran" : ""}${pick?.selected === i ? " picked" : ""}${pick ? " pickable" : ""}` });
    if (pick) g.addEventListener("click", () => pick.onPick(i));
    g.append(el("rect", { x: X, y, width: W, height: BOX_H, rx: 10, class: "flow-box" }));
    g.append(el("rect", { x: X, y, width: 5, height: BOX_H, rx: 2, fill: KIND_COLOR[s.kind] ?? "var(--accent, #4cc2ff)" }));
    g.append(el("text", { x: X + 16, y: y + 18, class: "flow-name" }, name));
    g.append(el("text", { x: X + 16, y: y + 34, class: "flow-text" }, cut(stepWords(s), 52)));
    svg.append(g);
  });
  svg.append(el("circle", { cx: X + W / 2, cy: endY + 9, r: 7, class: "flow-end" }));
  svg.append(el("text", { x: X + W / 2 + 14, y: endY + 13, class: "flow-text" }, t("fine")));
  return h("div", { class: "flow-wrap" }, svg as unknown as HTMLElement);
}

const STATUS: Record<string, [string, () => string]> = {
  running: ["#38bdf8", () => t("in corso")],
  done: ["#22c55e", () => t("riuscita")],
  failed: ["#f4505e", () => t("errore")],
  stopped: ["#8e939c", () => t("fermata")],
};

const when = (ms: number) => (ms ? new Date(ms).toLocaleString(locale(), { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");

/** Impostazioni → Flussi → Esecuzioni: the runs kept on disk, newest first. */
export function runsBox(): { el: HTMLElement; refresh: () => Promise<void> } {
  const box = h("div", { class: "auto-log" });
  let open = "";
  async function refresh() {
    const runs = (await Bridge.flowsRuns()) ?? [];
    clear(box);
    if (runs.length === 0) {
      box.append(h("div", { class: "hint", text: t("Ancora nessuna esecuzione.") }));
      return;
    }
    for (const r of runs.slice(0, 50)) box.append(runRow(r));
  }
  function runRow(r: FlowRunInfo): HTMLElement {
    const [color, label] = STATUS[r.status] ?? STATUS.done;
    const detail = h("div", { class: "flow-run-detail" });
    const row = h("div", { class: "auto-log-row flow-run-row", role: "button", tabindex: "0" },
      h("i", { class: "dot", style: `background:${color}` }),
      h("span", { class: "auto-log-when", text: when(r.started) }),
      h("b", { text: r.name }),
      h("span", { class: "hint", text: r.cause }),
      h("span", { class: "auto-log-detail", text: `${label()} · ${t("{n} passi", { n: r.steps })}` }));
    const toggle = async () => {
      if (open === r.id) {
        open = "";
        clear(detail);
        return;
      }
      open = r.id;
      const run = await Bridge.flowRun(r.id);
      clear(detail);
      if (run) detail.append(runDetail(run));
    };
    row.addEventListener("click", () => void toggle());
    row.addEventListener("keydown", (e) => { if (e.key === "Enter") void toggle(); });
    return h("div", {}, row, detail);
  }
  function runDetail(run: FlowRun): HTMLElement {
    const wrap = h("div", { class: "flow-run" });
    const ran = new Set(run.trace.map((x) => x.node));
    if (isLinked(run.flow)) wrap.append(flowDiagram(run.flow, ran));
    for (const step of run.trace) {
      const again = h("button", { text: t("Riprendi da qui"), disabled: run.status === "running" });
      again.addEventListener("click", async () => {
        try {
          await Bridge.flowRerun(run.id, step.node);
          again.textContent = t("Ripartito");
          window.setTimeout(() => void refresh(), 800);
        } catch (e) {
          again.textContent = String(e);
        }
      });
      wrap.append(h("div", { class: "flow-trace" },
        h("i", { class: "dot", style: `background:${step.ok ? "#22c55e" : "#f4505e"}` }),
        h("span", { class: "auto-log-when", text: when(step.at) }),
        h("b", { text: step.node }),
        h("span", { class: "hint", text: step.what }),
        again,
        h("div", { class: "flow-out", text: step.out })));
    }
    if (run.trace.length === 0) wrap.append(h("div", { class: "hint", text: t("Nessun passo ancora.") }));
    return wrap;
  }
  void onEvent<null>("automations-log", () => void refresh());
  return { el: box, refresh };
}

// ── Editor ────────────────────────────────────────────────────────────────────

export interface EditorHooks {
  /** Saves the settings (the automation object is edited in place). */
  commit: () => void;
  /** Draws the automations page again. */
  redraw: () => void;
  /** The fields of a step after its kind (the same as the step list's). */
  stepFields: (s: AutomationStep, row: HTMLElement) => void;
  kinds: [AutomationStep["kind"], string][];
  blank: (kind: AutomationStep["kind"]) => AutomationStep;
  /** A select element, as the rest of the settings make them. */
  select: <T extends string>(options: [T, string][], value: T, onChange: (v: T) => void) => HTMLElement;
}

/** The box chosen in each automation's drawing, kept across redraws. */
const picked = new Map<string, number>();

function freeName(steps: AutomationStep[]): string {
  const used = new Set(steps.map((s, i) => nodeName(s, i)));
  let n = steps.length + 1;
  while (used.has(`s${n}`)) n++;
  return `s${n}`;
}

/** Every step named, so links survive moving steps around. */
function nameAll(steps: AutomationStep[]) {
  steps.forEach((s, i) => { if (!s.node?.trim()) s.node = `s${i + 1}`; });
}

/** Points every link to `from` at `to` ("" when the step is gone). */
function relink(steps: AutomationStep[], from: string, to: string) {
  for (const s of steps) {
    if (s.next === from) s.next = to;
    for (const b of s.branches ?? []) if (b.to === from) b.to = to;
  }
}

/** The flow editor: the drawing (click a box), a toolbar and the chosen step's panel. */
export function flowEditor(a: Automation, hooks: EditorHooks): HTMLElement {
  const { commit, redraw, stepFields, kinds, blank, select } = hooks;
  nameAll(a.steps);
  const sel = Math.max(0, Math.min(picked.get(a.id) ?? 0, a.steps.length - 1));
  const choose = (i: number) => { picked.set(a.id, i); redraw(); };
  const changed = () => { commit(); redraw(); };
  const wrap = h("div", { class: "flow-editor" });
  wrap.append(flowDiagram(a, undefined, { selected: sel, onPick: choose }));

  const btn = (text: string, title: string, onclick: () => void, disabled = false) =>
    h("button", { text, title, disabled, onclick });
  const add = () => {
    a.steps.splice(sel + 1, 0, { ...blank("notice"), node: freeName(a.steps) });
    picked.set(a.id, sel + 1);
    changed();
  };
  const move = (d: number) => {
    const j = sel + d;
    const here = a.steps[sel], there = a.steps[j];
    if (!here || !there) return;
    a.steps[sel] = there;
    a.steps[j] = here;
    picked.set(a.id, j);
    changed();
  };
  const remove = () => {
    if (a.steps.length <= 1) return;
    const [gone] = a.steps.splice(sel, 1);
    relink(a.steps, gone?.node ?? "", "");
    picked.set(a.id, Math.max(0, sel - 1));
    changed();
  };
  wrap.append(h("div", { class: "row flow-tools" },
    btn(t("+ Passo dopo"), t("Aggiunge un passo dopo quello scelto"), add, a.steps.length >= 30),
    btn("↑", t("Sposta in su"), () => move(-1), sel <= 0),
    btn("↓", t("Sposta in giù"), () => move(1), sel >= a.steps.length - 1),
    btn(t("Togli"), t("Toglie il passo scelto"), remove, a.steps.length <= 1),
    h("span", { class: "hint note", text: t("clic su un passo per cambiarlo") })));

  const step = a.steps[sel];
  if (!step) return wrap;
  const panel = h("div", { class: "flow-panel" });
  const names = a.steps.map((s, i) => nodeName(s, i));
  const targets = (self: number): [string, string][] => [
    ["", t("Il passo seguente")],
    ["end", t("Fine")],
    ...names.filter((_, i) => i !== self).map((n): [string, string] => [n, n]),
  ];

  // Name and kind.
  const nameInput = h("input", { type: "text", value: step.node ?? "", spellcheck: "false", style: "width:120px" }) as HTMLInputElement;
  nameInput.addEventListener("change", () => {
    const v = nameInput.value.trim().replace(/[\s{}]/g, "");
    if (!v || v === "end" || names.includes(v)) {
      nameInput.value = step.node ?? "";
      return;
    }
    relink(a.steps, step.node ?? "", v);
    step.node = v;
    changed();
  });
  panel.append(h("div", { class: "row" }, h("label", { text: t("Passo") }), nameInput,
    select<AutomationStep["kind"]>(kinds, step.kind, (v) => {
      const fresh: AutomationStep = { ...blank(v), node: step.node, next: step.next };
      if (v === "decide") {
        fresh.branches = [{ value: "{risultato}", op: "contains", toMatch: "", to: "" }, { value: "", op: "else", toMatch: "", to: "" }];
      }
      a.steps[sel] = fresh;
      changed();
    }),
    h("span", { class: "hint note", text: t("il suo esito: {x}", { x: `{${step.node}}` }) })));

  if (step.kind !== "decide") {
    const row = h("div", { class: "row" }, h("label", { text: "" }));
    stepFields(step, row);
    if (row.childElementCount > 1) panel.append(row);
    if (step.kind === "foreach") {
      const body: [string, string][] = names.filter((_, i) => i !== sel).map((n): [string, string] => [n, n]);
      if (!step.body && body[0]) step.body = body[0][0];
      panel.append(h("div", { class: "row" }, h("label", { text: t("Ogni voce va a") }),
        body.length ? select<string>(body, step.body ?? "", (v) => { step.body = v; changed(); }) : h("span", { class: "hint", text: t("aggiungi prima i passi del giro") }),
        h("span", { class: "hint note", text: t("l'ultimo passo del giro torna qui con «Poi»") })));
    }
    panel.append(h("div", { class: "row" }, h("label", { text: step.kind === "foreach" ? t("Poi, finite le voci") : t("Poi") }),
      select<string>(targets(sel), step.next ?? "", (v) => { step.next = v; changed(); })));
  } else if (step.branches?.some((b) => b.op === "model")) {
    // The engine picks: one line per way out, described in words.
    const branches = step.branches;
    const what = h("input", { type: "text", value: step.text ?? "", placeholder: t("cosa deve guardare, es. {leggi}"), spellcheck: "false", style: "flex:1 1 auto;min-width:0" }) as HTMLInputElement;
    what.addEventListener("change", () => { step.text = what.value; commit(); });
    panel.append(h("div", { class: "row" }, h("label", { text: t("Guarda") }), what,
      select<string>([["", t("Motore della chat")], ...ENGINES()], step.engine ?? "", (v) => { step.engine = v; step.model = ""; changed(); })));
    branches.forEach((b, bi) => {
      const desc = h("input", { type: "text", value: b.toMatch, placeholder: t("quando, es. chiede un preventivo"), spellcheck: "false", style: "flex:1 1 auto;min-width:0" }) as HTMLInputElement;
      desc.addEventListener("change", () => { b.toMatch = desc.value; commit(); });
      panel.append(h("div", { class: "row" }, h("label", { text: t("Strada {n}", { n: bi + 1 }) }), desc,
        h("span", { class: "hint", text: "→" }),
        select<string>(targets(sel), b.to, (v) => { b.to = v; changed(); }),
        h("button", { class: "danger icon", text: "✕", title: t("Togli questo ramo"), disabled: branches.length <= 2, onclick: () => { branches.splice(bi, 1); changed(); } })));
    });
    panel.append(h("div", { class: "row" }, h("label", { text: "" }),
      h("button", { text: t("+ Aggiungi una strada"), onclick: () => { branches.push({ value: "", op: "model", toMatch: "", to: "" }); changed(); } }),
      h("button", { text: t("Decido io con delle regole"), onclick: () => {
        step.branches = [{ value: "{risultato}", op: "contains", toMatch: "", to: "" }, { value: "", op: "else", toMatch: "", to: "" }];
        changed();
      } }),
      h("span", { class: "hint note", text: t("il motore legge e sceglie la strada descritta meglio") })));
  } else {
    const branches = (step.branches ??= []);
    const ops: [string, string][] = [["contains", t("contiene")], ["equals", t("è")], ["empty", t("è vuoto")], ["filled", t("non è vuoto")], ["else", t("altrimenti")]];
    branches.forEach((b, bi) => {
      const value = h("input", { type: "text", value: b.value, placeholder: "{risultato}", spellcheck: "false", style: "width:130px" }) as HTMLInputElement;
      value.addEventListener("change", () => { b.value = value.value; commit(); });
      const match = h("input", { type: "text", value: b.toMatch, placeholder: t("testo"), spellcheck: "false", style: "width:120px" }) as HTMLInputElement;
      match.addEventListener("change", () => { b.toMatch = match.value; commit(); });
      const row = h("div", { class: "row" }, h("label", { text: bi === 0 ? t("Se") : t("oppure se") }));
      if (b.op !== "else") row.append(value);
      row.append(select<string>(ops, b.op, (v) => { b.op = v as typeof b.op; changed(); }));
      if (b.op === "contains" || b.op === "equals") row.append(match);
      row.append(h("span", { class: "hint", text: "→" }),
        select<string>(targets(sel), b.to, (v) => { b.to = v; changed(); }),
        h("button", { class: "danger icon", text: "✕", title: t("Togli questo ramo"), onclick: () => { branches.splice(bi, 1); changed(); } }));
      panel.append(row);
    });
    panel.append(h("div", { class: "row" }, h("label", { text: "" }),
      h("button", { text: t("+ Aggiungi un ramo"), onclick: () => { branches.push({ value: "{risultato}", op: "contains", toMatch: "", to: "" }); changed(); } }),
      h("button", { text: t("Lascia scegliere al modello"), onclick: () => {
        step.branches = [{ value: "", op: "model", toMatch: "", to: "" }, { value: "", op: "model", toMatch: "", to: "" }];
        step.text ||= "{risultato}";
        changed();
      } }),
      h("span", { class: "hint note", text: t("vince il primo che vale; senza nessuno si va al passo seguente") })));
  }
  wrap.append(panel);
  return wrap;
}
