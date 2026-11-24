// «Personalizza la barra» (Edoardo, 21 Nov 2026): its own window, beside the
// fixed bar and above the other windows (lib.rs show_bar_editor). A click on a
// widget puts it in the bar; on the bar, while this window is open, the
// elements are dragged to move them, × takes one away and the right button
// opens its options here (src/character-window/main.ts, bar_edit_relay).
// The look of the bar is here too. Everything is saved at once (save_settings);
// the other windows follow through settings-changed.

import "../settings/settings.css";
import "../settings/settings-windows.css";
import "../settings/settings-light.css";
import "./bar-edit.css";
import { Bridge, IS_TAURI, onEvent } from "../core/bridge";
import { BAR_KINDS, barKind } from "../core/barkinds";
import { BAR_BG_PRESETS, barBgCss, parseBarBg } from "../core/barbg";
import { DEFAULT_SETTINGS, INTEGRATION_AGENTS, barThickness, type BarAct, type BarItem, type BarOpts, type FixedBarLook, type Settings } from "../core/state";
import { clockText } from "../core/clock";
import { syncLanguage, t } from "../core/i18n";
import { applyUiStyle } from "../core/uistyle";
import { applyFonts } from "../core/fonts";
import { h, clear } from "../views/dom";
import { renderActionIcon } from "../views/action-icons";

let settings: Settings = structuredClone(DEFAULT_SETTINGS);
let tab: "widgets" | "look" = "widgets";
/** The element whose options are open (its key in the bar), or "". */
let optionsKey = "";
let query = "";
/** A folder being filled (its key): a click on a widget puts it inside, not in the bar. */
let fillKey = "";
/** Our own last save: its settings-changed is not drawn again. */
let savedAt = 0;
const root = document.getElementById("bar-edit-root")!;

// ── Saving and the bar ──────────────────────────────────────────────────────

function save() {
  savedAt = Date.now();
  void Bridge.saveSettings(settings);
}

function toBar(payload: Record<string, unknown>) {
  void Bridge.barEditRelay("bar", payload);
}

/** The bar in its customize mode, with its words. */
function barOn() {
  toBar({ on: true, options: optionsKey, words: { remove: t("Togli"), done: t("Fine"), hint: t("Trascina per spostare, destro per le opzioni, × per togliere"), pin: t("Aggiungi alla barra") } });
}

/** An element's key in the bar, as src/island/bar.ts keyOf. */
function keyOf(it: BarItem): string {
  return (it.id.startsWith("sys:") || it.id === "folder") && it.uid ? `${it.id}#${it.uid}` : it.id;
}

const uid = () => Math.random().toString(36).slice(2, 8);

/** A folder of the bar by its key. */
function folderOf(key: string): BarItem | undefined {
  return items().find((x) => x.id === "folder" && keyOf(x) === key);
}

/** A new folder at the end of the bar, its options open. */
function newFolder() {
  const f: BarItem = { id: "folder", uid: uid(), area: "end", show: "icon", name: t("Cartella"), icon: "i:folder", children: [], opts: { layout: "grid", iconSize: 28 } };
  const list = [...items()];
  place(list, f, settings.fixedBarSlot === "end" ? "center" : "end", null);
  settings.fixedBarItems = list;
  save();
  optionsKey = keyOf(f);
  toBar({ options: optionsKey });
  draw();
}

const items = (): BarItem[] => (settings.fixedBarItems ??= []);

/** Puts `it` in `area`, before the element with key `before` (null: after the last one of that area). */
function place(list: BarItem[], it: BarItem, area: string, before: string | null) {
  it.area = area === "start" || area === "end" ? area : "center";
  const at = before ? list.findIndex((x) => keyOf(x) === before) : -1;
  if (at >= 0) {
    list.splice(at, 0, it);
    return;
  }
  let last = -1;
  list.forEach((x, i) => { if (x.area === it.area) last = i; });
  list.splice(last >= 0 ? last + 1 : list.length, 0, it);
}

/** A widget clicked: at the end of the bar, lit a moment on it; or inside the folder being filled. */
function add(id: string) {
  const it: BarItem = { id, uid: uid(), area: "end", show: "both" };
  const into = fillKey ? folderOf(fillKey) : undefined;
  if (into) {
    (into.children ??= []).push(it);
    settings.fixedBarItems = [...items()];
    save();
    draw();
    return;
  }
  const list = [...items()];
  place(list, it, settings.fixedBarSlot === "end" ? "center" : "end", null);
  settings.fixedBarItems = list;
  save();
  const key = keyOf(it);
  toBar({ options: key });
  window.setTimeout(() => { if (optionsKey !== key) toBar({ options: optionsKey }); }, 1400);
  draw();
}

/** What the bar asks: move or remove an element, its options, done. */
function onReply(p: { kind?: string; key?: string; area?: string; before?: string | null }) {
  if (p.kind === "done") {
    void Bridge.closeBarEditor();
    return;
  }
  const list = [...items()];
  const i = p.key ? list.findIndex((x) => keyOf(x) === p.key) : -1;
  if (p.kind === "options" && i >= 0) {
    optionsKey = p.key!;
    toBar({ options: optionsKey });
    draw();
    return;
  }
  if (i < 0) return;
  if (p.kind === "into") {
    const f = folderOf((p as { folder?: string }).folder ?? "");
    if (!f || f === list[i]) return;
    const [it] = list.splice(i, 1);
    (f.children ??= []).push(it);
  } else if (p.kind === "move") {
    const [it] = list.splice(i, 1);
    place(list, it, p.area ?? it.area, p.before ?? null);
  } else if (p.kind === "remove") {
    list.splice(i, 1);
    if (optionsKey === p.key) optionsKey = "";
  } else return;
  settings.fixedBarItems = list;
  save();
  draw();
}

// ── Small controls ──────────────────────────────────────────────────────────

function segmented<T extends string>(choices: [T, string][], now: T, set: (v: T) => void): HTMLElement {
  const box = h("div", { class: "be-seg", role: "radiogroup" });
  for (const [v, label] of choices) {
    const b = h("button", { class: v === now ? "on" : "", role: "radio", "aria-checked": String(v === now), text: label }) as HTMLButtonElement;
    b.addEventListener("click", () => set(v));
    box.append(b);
  }
  return box;
}

function switchEl(on: boolean, set: (v: boolean) => void): HTMLElement {
  const b = h("button", { class: on ? "switch on" : "switch", "aria-pressed": String(on) }) as HTMLButtonElement;
  b.addEventListener("click", () => {
    const next = !b.classList.contains("on");
    b.classList.toggle("on", next);
    b.setAttribute("aria-pressed", String(next));
    set(next);
  });
  return b;
}

function range(min: number, max: number, step: number, value: number, unit: string, set: (v: number) => void): HTMLElement {
  const input = h("input", { type: "range", min: String(min), max: String(max), step: String(step), value: String(value) }) as HTMLInputElement;
  const out = h("span", { class: "be-range-v", text: `${value}${unit}` });
  input.addEventListener("input", () => { out.textContent = `${input.value}${unit}`; });
  input.addEventListener("change", () => set(Number(input.value)));
  return h("div", { class: "be-range" }, input, out);
}

function pick(choices: [string, string][], now: string, set: (v: string) => void): HTMLElement {
  const s = h("select", {}) as HTMLSelectElement;
  for (const [v, label] of choices) s.append(h("option", { value: v, text: label }));
  s.value = now;
  s.addEventListener("change", () => set(s.value));
  return s;
}

function text(value: string | undefined, placeholder: string, set: (v: string) => void): HTMLElement {
  const el = h("input", { type: "text", value: value ?? "", placeholder, spellcheck: "false" }) as HTMLInputElement;
  el.addEventListener("change", () => set(el.value.trim()));
  return el;
}

function line(label: string, control: HTMLElement, hint = ""): HTMLElement {
  return h("div", { class: "be-line" },
    h("div", { class: "be-line-text" }, h("span", { text: label }), ...(hint ? [h("small", { text: hint })] : [])),
    control);
}

// ── The catalog ─────────────────────────────────────────────────────────────

interface Entry { id: string; name: string; icon: string; color?: string; repeat: boolean }

function catalog(): [string, Entry[]][] {
  const sys = (group: "windows" | "work" | undefined): Entry[] => Object.keys(BAR_KINDS)
    .filter((k) => BAR_KINDS[k].group === group)
    .map((k) => ({ id: `sys:${k}`, name: BAR_KINDS[k].name, icon: BAR_KINDS[k].icon, repeat: true }));
  const mine: Entry[] = [
    ...settings.activeIntegrations
      .map((id) => INTEGRATION_AGENTS.find((x) => x.id === id))
      .filter((x): x is NonNullable<typeof x> => !!x)
      .map((x) => ({ id: `task:${x.id}`, name: x.name, icon: "i:plug", color: x.color, repeat: false })),
    ...(settings.widgets ?? []).map((w) => ({ id: `task:widget:${w.id}`, name: w.name, icon: "i:chart", repeat: false })),
  ];
  const acts: Entry[] = (settings.actions ?? []).map((a) => ({ id: `action:${a.id}`, name: a.name, icon: a.icon || "i:bolt", repeat: false }));
  return [
    [t("Windows"), sys("windows")],
    [t("Sistema"), sys(undefined)],
    [t("Lavoro"), sys("work")],
    [t("Integrazioni e widget"), mine],
    [t("Le mie azioni"), acts],
    [t("Agenti"), [{ id: "strip", name: t("Striscia: permessi, chiamate, agente al lavoro, app in uso"), icon: "i:robot", repeat: false }]],
  ];
}

function nameOf(id: string): string {
  if (id === "folder") return t("Cartella");
  for (const [, list] of catalog()) {
    const e = list.find((x) => x.id === id);
    if (e) return e.name;
  }
  return id;
}

function iconOf(id: string): string {
  if (id === "folder") return "i:folder";
  for (const [, list] of catalog()) {
    const e = list.find((x) => x.id === id);
    if (e) return e.icon;
  }
  return "i:grid";
}

function widgetsView(): HTMLElement[] {
  const used = new Map<string, number>();
  for (const it of items()) used.set(it.id, (used.get(it.id) ?? 0) + 1);
  const search = h("input", { class: "be-search", type: "search", placeholder: t("Cerca un widget…"), value: query, spellcheck: "false" }) as HTMLInputElement;
  const groups = h("div", { class: "be-groups" });
  const filling = fillKey ? folderOf(fillKey) : undefined;
  if (fillKey && !filling) fillKey = "";
  const banner = filling
    ? h("div", { class: "be-fill" },
      h("span", { text: t("Un clic mette il widget nella cartella «{name}».", { name: filling.name || t("Cartella") }) }),
      (() => {
        const b = h("button", { class: "primary", text: t("Fatto") }) as HTMLButtonElement;
        b.addEventListener("click", () => {
          optionsKey = fillKey;
          fillKey = "";
          toBar({ options: optionsKey });
          draw();
        });
        return b;
      })())
    : null;
  const paint = () => {
    clear(groups);
    if (!filling && !query.trim()) {
      const make = h("button", { class: "be-card be-new" },
        h("span", { class: "be-card-icon" }, renderActionIcon("i:folder", 18)),
        h("span", { class: "be-card-name", text: t("Nuova cartella") })) as HTMLButtonElement;
      make.addEventListener("click", newFolder);
      groups.append(h("div", { class: "be-group" }, h("h3", { text: t("Cartelle") }),
        h("div", { class: "be-grid" }, make),
        h("p", { class: "be-tip", text: t("Trascina un programma, un collegamento o una cartella di Windows sulla barra: diventa un pulsante, come nella barra delle applicazioni. Sopra una cartella della barra ci finisce dentro.") })));
    }
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    for (const [title, list] of catalog()) {
      const shown = list.filter((e) => words.every((w) => e.name.toLowerCase().includes(w)));
      if (!shown.length) continue;
      const grid = h("div", { class: "be-grid" });
      for (const e of shown) {
        const n = filling ? (filling.children ?? []).filter((c) => c.id === e.id).length : used.get(e.id) ?? 0;
        const full = n > 0 && !e.repeat;
        const card = h("button", { class: `be-card${n ? " in" : ""}`, disabled: full, title: full ? t("Già nella barra") : t("Clic: mettilo nella barra") },
          h("span", { class: "be-card-icon", style: e.color ? `--c:${e.color}` : "" }, renderActionIcon(e.icon, 18)),
          h("span", { class: "be-card-name", text: e.name }),
          ...(n ? [h("span", { class: "be-card-in", text: n > 1 ? `×${n}` : "✓" })] : [])) as HTMLButtonElement;
        card.addEventListener("click", () => add(e.id));
        grid.append(card);
      }
      groups.append(h("div", { class: "be-group" }, h("h3", { text: title }), grid));
    }
    if (!groups.childElementCount) groups.append(h("p", { class: "be-empty", text: t("Nessun widget con queste parole.") }));
  };
  search.addEventListener("input", () => {
    query = search.value;
    paint();
  });
  paint();
  return banner ? [banner, search, groups] : [search, groups];
}

// ── An element's options ────────────────────────────────────────────────────

/** A folder's options: name, icon, grid or list, icons' size, what it holds. */
function folderView(it: BarItem): HTMLElement[] {
  const o = (it.opts ??= {});
  const commit = () => { settings.fixedBarItems = [...items()]; save(); };
  const back = h("button", { class: "be-back", text: `← ${t("Widget")}` }) as HTMLButtonElement;
  back.addEventListener("click", () => { optionsKey = ""; toBar({ options: "" }); draw(); });
  const icons = ["i:folder", "i:star", "i:briefcase", "i:grid", "i:wrench", "i:code", "i:globe", "i:chart", "i:music", "i:monitor", "i:heart", "i:home"];
  const iconRow = h("div", { class: "be-icons" });
  for (const ic of icons) {
    const b = h("button", { class: `be-icon-pick${(it.icon || "i:folder") === ic ? " on" : ""}` }, renderActionIcon(ic, 16)) as HTMLButtonElement;
    b.addEventListener("click", () => { it.icon = ic; commit(); draw(); });
    iconRow.append(b);
  }
  const content = h("div", { class: "be-panel" });
  const kids = it.children ?? [];
  kids.forEach((c, i) => {
    const move = (d: number) => {
      const j = i + d;
      if (j < 0 || j >= kids.length) return;
      [kids[i], kids[j]] = [kids[j], kids[i]];
      commit();
      draw();
    };
    const btn = (label: string, title: string, run: () => void, cls = "") => {
      const b = h("button", { class: `be-mini ${cls}`, text: label, title }) as HTMLButtonElement;
      b.addEventListener("click", run);
      return b;
    };
    content.append(h("div", { class: "be-line" },
      h("span", { class: "be-card-icon be-small" }, renderActionIcon(iconOf(c.id), 14)),
      h("div", { class: "be-line-text" }, h("span", { text: nameOf(c.id) })),
      btn("↑", t("Su"), () => move(-1)),
      btn("↓", t("Giù"), () => move(1)),
      btn("⤴", t("Rimetti nella barra"), () => {
        kids.splice(i, 1);
        const list = [...items()];
        place(list, c, it.area, null);
        settings.fixedBarItems = list;
        save();
        draw();
      }),
      btn("×", t("Togli"), () => { kids.splice(i, 1); commit(); draw(); }, "danger")));
  });
  if (!kids.length) content.append(h("p", { class: "be-empty", text: t("Ancora vuota.") }));
  const fill = h("button", { class: "primary be-fill-btn", text: t("+ Aggiungi widget alla cartella") }) as HTMLButtonElement;
  fill.addEventListener("click", () => {
    fillKey = keyOf(it);
    optionsKey = "";
    tab = "widgets";
    toBar({ options: fillKey });
    draw();
  });
  const remove = h("button", { class: "be-remove", text: t("Togli la cartella (e quello che contiene)") }) as HTMLButtonElement;
  remove.addEventListener("click", () => onReply({ kind: "remove", key: keyOf(it) }));
  return [
    back,
    h("div", { class: "be-opt-head" },
      h("span", { class: "be-card-icon" }, renderActionIcon(it.icon || "i:folder", 20)),
      h("div", {}, h("b", { text: it.name || t("Cartella") }), h("small", { text: t("Un clic sulla cartella nella barra apre una piccola isola con il suo contenuto.") }))),
    h("div", { class: "be-panel" },
      line(t("Nome"), text(it.name, t("Cartella"), (v) => { it.name = v || t("Cartella"); commit(); draw(); })),
      h("div", { class: "be-line be-line-col" }, h("div", { class: "be-line-text" }, h("span", { text: t("Icona") })), iconRow),
      line(t("Come mostra il contenuto"), segmented([["grid", t("Griglia")], ["list", t("Lista")]] as ["grid" | "list", string][], o.layout === "list" ? "list" : "grid", (v) => { o.layout = v; commit(); draw(); })),
      line(t("Grandezza delle icone"), range(16, 48, 2, o.iconSize ?? 28, " px", (v) => { o.iconSize = v; commit(); })),
      line(t("Nella barra"), segmented([["both", t("Icona e nome")], ["icon", t("Solo icona")]] as ["both" | "icon", string][], it.show === "icon" ? "icon" : "both", (v) => { it.show = v; commit(); draw(); })),
    ),
    h("h3", { class: "be-sub", text: t("Contenuto") }),
    content,
    fill,
    h("p", { class: "be-tip", text: t("Anche trascinando un elemento della barra sopra la cartella ci finisce dentro.") }),
    remove,
  ];
}

function optionsView(it: BarItem): HTMLElement[] {
  if (it.id === "folder") return folderView(it);
  const kind = barKind(it.id);
  const o = (it.opts ??= {});
  const commit = () => {
    settings.fixedBarItems = [...items()];
    save();
  };
  const redraw = () => { commit(); draw(); };
  const back = h("button", { class: "be-back", text: `← ${t("Widget")}` }) as HTMLButtonElement;
  back.addEventListener("click", () => {
    optionsKey = "";
    toBar({ options: "" });
    draw();
  });
  const tokens = ["{icon}", "{value}", ...(kind ? kind.tokens.map(([k]) => `{${k}}`) : it.id === "strip" ? [] : ["{name}"])];
  const labels: Record<string, string> = {
    none: t("Niente"), card: t("Apri la card"), alt: t("Mostra il secondo testo"), menu: t("Menu"), mute: t("Muto sì / no"), action: t("Esegui l'azione"),
  };
  const what = (b: "left" | "middle" | "right"): [string, string][] => {
    const own = kind ? kind[b] : b === "left" ? (it.id.startsWith("action:") ? "action" : "card") : "none";
    const out: [string, string][] = [["", `${t("Predefinito")} (${labels[own] ?? own})`], ["none", labels.none]];
    if (kind ? kind.card : !it.id.startsWith("action:")) out.push(["card", labels.card]);
    out.push(["alt", labels.alt]);
    if (kind?.menu) out.push(["menu", labels.menu]);
    if (it.id === "sys:volume" || it.id === "sys:mic") out.push(["mute", labels.mute]);
    for (const a of settings.actions ?? []) out.push([`action:${a.id}`, `${t("Azione")} · ${a.name}`]);
    return out;
  };
  const show = it.show ?? "both";
  const rows: HTMLElement[] = [
    line(t("Dove sta"), segmented([["start", t("Inizio")], ["center", t("Centro")], ["end", t("Fine")]] as ["start" | "center" | "end", string][], it.area, (v) => {
      const list = [...items()];
      list.splice(list.indexOf(it), 1);
      place(list, it, v, null);
      settings.fixedBarItems = list;
      save();
      draw();
    })),
    line(t("Cosa mostra"), segmented([["both", t("Icona e valore")], ["icon", t("Solo icona")], ["value", t("Solo valore")]] as ["both" | "icon" | "value", string][], show, (v) => { it.show = v; redraw(); })),
    line(t("Formato"), text(o.format, show === "icon" ? "{icon}" : show === "value" ? "{value}" : "{icon} {value}", (v) => { o.format = v || undefined; commit(); }), `${t("Segnaposto")}: ${tokens.join(" ")}`),
    line(t("Secondo testo (al clic)"), text(o.alt, kind?.alt ?? "", (v) => { o.alt = v || undefined; commit(); })),
    line(t("Suggerimento"), text(o.tip, t("Quello dell'elemento"), (v) => { o.tip = v || undefined; commit(); })),
    ...(["left", "middle", "right"] as const).map((b) =>
      line(b === "left" ? t("Clic") : b === "middle" ? t("Clic centrale") : t("Clic destro"),
        pick(what(b), (o[b] ?? "") as string, (v) => { o[b] = (v || undefined) as BarAct | undefined; commit(); }))),
  ];
  if (kind?.wheel) rows.push(line(it.id === "sys:brightness" ? t("Rotella: luminosità") : t("Rotella: volume"), switchEl(o.wheel !== false, (v) => { o.wheel = v ? undefined : false; commit(); })));
  if (kind?.graph) rows.push(line(t("Grafico dell'ultimo minuto"), switchEl(!!o.graph, (v) => { o.graph = v || undefined; commit(); })));
  if (it.id === "sys:disk") {
    rows.push(line(t("Disco"), pick("CDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((l) => [l, `${l}:`] as [string, string]), (o.drive || "C").toUpperCase(), (v) => { o.drive = v === "C" ? undefined : v; commit(); })));
  }
  if (it.id === "sys:title" || it.id === "sys:vscode") {
    const title = it.id === "sys:title";
    rows.push(line(title ? t("Lettere al massimo") : t("Progetti nel menu"), range(title ? 10 : 1, title ? 200 : 15, 1, o.max ?? (title ? 60 : 10), "", (v) => { o.max = v; commit(); })));
  }
  if (it.id === "sys:apps") {
    rows.push(
      line(t("Ingrandisci al passaggio del mouse"), switchEl(!!o.magnify, (v) => { o.magnify = v || undefined; commit(); }), t("l'icona sotto il mouse e le vicine crescono, come su un Mac")),
      line(t("Riduci le finestre nella loro icona"), switchEl(o.minimizeTo !== false, (v) => { o.minimizeTo = v ? undefined : false; commit(); }), t("l'animazione di Windows va verso l'icona nella barra e torna da lì")),
      h("p", { class: "be-tip", text: t("Maiusc+clic apre un'altra finestra, Ctrl+Maiusc+clic la apre come amministratore, il clic centrale ne apre una nuova.") }),
    );
  }
  if (it.id === "sys:downloads") {
    rows.push(line(t("Download nel menu"), range(1, 12, 1, o.max ?? 10, "", (v) => { o.max = v; commit(); })));
  }
  if (it.id === "sys:music") rows.push(line(t("Pulsanti precedente, pausa, successivo"), switchEl(o.buttons !== false, (v) => { o.buttons = v ? undefined : false; commit(); })));
  if (it.id === "sys:clock") {
    const zones = typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : ["Europe/Rome", "Europe/London", "America/New_York", "Asia/Tokyo", "UTC"];
    // Examples of today, as each choice would read.
    const sample = (extra: BarOpts) => clockText({ ...it, opts: { ...o, ...extra } });
    const styles: [NonNullable<BarOpts["dateStyle"]>, string][] = [
      ["short", t("Breve")], ["numeric", t("Numeri")], ["numericYear", t("Numeri con l'anno")], ["long", t("Lunga")], ["iso", "ISO"],
    ];
    // Ready-made texts: the format field below stays free.
    const models: [string, string][] = [
      ["{icon} {time}", t("Ora")],
      ["{icon} {time}  {date}", t("Ora e data")],
      ["{date}  {time}", t("Data e ora")],
      ["{day} {daynum} {month}  {time}", t("Giorno, data e ora")],
      ["{time}  {week}", t("Ora e settimana")],
      ["{label} {time}", t("Nome del fuso e ora")],
    ];
    rows.push(
      line(t("Modello"), pick([["", t("Scegli…")], ...models.map(([f, n]) => [f, n] as [string, string])], "", (v) => {
        if (!v) return;
        o.format = v;
        it.show = undefined;
        redraw();
      }), t("Mette il testo nel campo «Formato», che puoi cambiare ancora")),
      line(t("Fuso orario"), pick([["", t("Quello del PC")], ...zones.map((z) => [z, z.replace(/_/g, " ")] as [string, string])], o.tz ?? "", (v) => { o.tz = v || undefined; commit(); })),
      line(t("Nome del fuso"), text(o.label, (o.tz ?? "").split("/").pop()?.replace(/_/g, " ") || t("per esempio Milano"), (v) => { o.label = v || undefined; commit(); }), t("Per {label} e per la card dei fusi orari")),
      line(t("Formato dell'ora"), segmented([["24", t("24 ore")], ["12", t("12 ore")]] as ["24" | "12", string][], o.h12 ? "12" : "24", (v) => { o.h12 = v === "12" || undefined; redraw(); })),
      line(t("Zero davanti all'ora"), switchEl(o.pad !== false, (v) => { o.pad = v ? undefined : false; redraw(); }), t("09:05 o 9:05")),
      line(t("Con i secondi"), switchEl(!!o.seconds, (v) => { o.seconds = v || undefined; commit(); })),
      line(t("Data"), pick(styles.map(([k, n]) => [k, sample({ dateStyle: k }).date || n] as [string, string]), o.dateStyle ?? "short", (v) => {
        o.dateStyle = v === "short" ? undefined : v as BarOpts["dateStyle"];
        commit();
      })),
      line(t("Quadrante al posto dell'icona"), switchEl(!!o.analog, (v) => { o.analog = v || undefined; commit(); })),
    );
  }
  const remove = h("button", { class: "be-remove", text: t("Togli dalla barra") }) as HTMLButtonElement;
  remove.addEventListener("click", () => onReply({ kind: "remove", key: keyOf(it) }));
  return [
    back,
    h("div", { class: "be-opt-head" },
      h("span", { class: "be-card-icon" }, renderActionIcon(iconOf(it.id), 20)),
      h("div", {}, h("b", { text: nameOf(it.id) }), h("small", { text: t("Opzioni di questo elemento della barra") }))),
    h("div", { class: "be-panel" }, ...rows),
    remove,
  ];
}

// ── The look ────────────────────────────────────────────────────────────────

function lookView(): HTMLElement[] {
  const look = (): FixedBarLook => (settings.fixedBarLook ??= {});
  const set = <K extends keyof FixedBarLook>(k: K, v: FixedBarLook[K]) => {
    look()[k] = v;
    save();
  };
  const redraw = () => { save(); draw(); };
  // The background: Windows-like solid choices and the presets, as swatches.
  const bg = h("div", { class: "be-swatches" });
  const now = settings.fixedBarBackground ?? "";
  const swatch = (value: string, label: string, css: string) => {
    const b = h("button", { class: `be-swatch${value === now ? " on" : ""}`, title: label, "aria-label": label }) as HTMLButtonElement;
    b.style.background = css;
    b.addEventListener("click", () => { settings.fixedBarBackground = value; redraw(); });
    bg.append(b);
  };
  swatch("", t("Come l'isola"), "#141518");
  swatch("transparent", t("Trasparente"), "repeating-conic-gradient(#2a2c31 0 25%, #1b1d21 0 50%) 0 0 / 10px 10px");
  for (const group of Object.values(BAR_BG_PRESETS)) {
    for (const p of group) swatch(p.value, t(p.label), barBgCss(parseBarBg(p.value), { opacity: 100 }));
  }
  const auto = !(settings.fixedBarHeight ?? 0);
  return [
    h("div", { class: "be-panel" },
      line(t("Bordo dello schermo"), segmented([["top", t("Sopra")], ["bottom", t("Sotto")]] as ["top" | "bottom", string][], settings.fixedBar === "bottom" ? "bottom" : "top", (v) => { settings.fixedBar = v; redraw(); })),
      line(t("Il personaggio"), segmented([["start", t("Inizio")], ["center", t("Centro")], ["end", t("Fine")]] as ["start" | "center" | "end", string][], settings.fixedBarSlot ?? "center", (v) => { settings.fixedBarSlot = v; redraw(); })),
      line(t("Altezza"), range(24, 96, 2, Math.round(barThickness(settings)), " px", (v) => { settings.fixedBarHeight = v; redraw(); }), auto ? t("automatica: alta quanto la vista compatta") : ""),
    ),
    h("div", { class: "be-panel" },
      line(t("Stile"), segmented([["band", t("Fascia intera")], ["islands", t("Isolette")]] as ["band" | "islands", string][], look().style ?? "band", (v) => { set("style", v); draw(); })),
      line(t("Aspetto elementi"), segmented([["classic", t("Piatto")], ["pills", t("Pillole")], ["compact", t("Compatto")]] as ["classic" | "pills" | "compact", string][], look().design ?? "classic", (v) => { set("design", v); draw(); })),
      h("div", { class: "be-line be-line-col" }, h("div", { class: "be-line-text" }, h("span", { text: t("Sfondo") })), bg),
      line(t("Opacità dello sfondo"), range(10, 100, 5, look().opacity ?? 100, "%", (v) => set("opacity", v))),
      line(t("Sfocatura dietro la barra"), switchEl(!!look().blur, (v) => { set("blur", v); draw(); })),
      // Windows 11's own materials (lib.rs character_blur): acrylic blurs what is behind, Mica takes the wallpaper's colours.
      ...(look().blur ? [line(t("Materiale"), segmented([["acrylic", t("Acrilico")], ["mica", "Mica"]] as ["acrylic" | "mica", string][], look().material === "mica" ? "mica" : "acrylic",
        (v) => set("material", v === "mica" ? "mica" : undefined)), t("Mica prende i colori dello sfondo del desktop, come le finestre di Windows 11; con lo sfondo poco opaco si vede meglio"))] : []),
    ),
    h("div", { class: "be-panel" },
      line(t("Margine dai lati"), range(0, 400, 4, look().margin ?? 0, " px", (v) => set("margin", v))),
      line(t("Grandezza del testo"), range(80, 150, 5, look().text ?? 100, "%", (v) => set("text", v))),
      line(t("Spazio tra gli elementi"), range(0, 24, 1, look().gap ?? 4, " px", (v) => set("gap", v))),
    ),
    h("div", { class: "be-panel" },
      line(t("Nascondi da sola"), switchEl(!!look().autoHide, (v) => set("autoHide", v)), t("resta un filo sul bordo, esce quando arriva il mouse")),
      line(t("Ombra"), switchEl(look().shadow !== false, (v) => set("shadow", v))),
      line(t("Le schede escono dalla barra"), switchEl(look().popover !== false, (v) => set("popover", v))),
      line(t("Font di Aspetto → Font"), switchEl(look().font !== false, (v) => set("font", v))),
      line(t("Il personaggio cresce sotto il mouse"), switchEl(look().grow !== false, (v) => set("grow", v))),
    ),
    // Over a game, a video, a presentation the bar steps away (appbar.rs), except over these programs.
    h("div", { class: "be-panel" },
      line(t("A schermo intero resta visibile sopra"),
        text((look().fullscreenKeep ?? []).join(", "), "vlc, obs64, *game*", (v) => {
          const list = v.split(/[,;\n]/).map((s) => s.trim()).filter(Boolean).slice(0, 30);
          set("fullscreenKeep", list.length ? list : undefined);
        }),
        t("Sopra giochi, video e presentazioni a schermo intero la barra si toglie; qui i programmi su cui resta (nomi dei file, * e ? come jolly)")),
    ),
  ];
}

// ── The page ────────────────────────────────────────────────────────────────

/** The view drawn last: the same one keeps its scroll, another starts at the top. */
let drawnView = "";

function draw() {
  const scroller = root.querySelector(".be-body");
  const top = scroller?.scrollTop ?? 0;
  clear(root);
  const done = h("button", { class: "primary be-done", text: t("Fine") }) as HTMLButtonElement;
  done.addEventListener("click", () => void Bridge.closeBarEditor());
  const head = h("header", { class: "be-head" },
    h("div", {}, h("h1", { text: t("Personalizza la barra") }),
      h("p", { text: t("Clic su un widget: va nella barra. Nella barra trascinalo per spostarlo, destro per le sue opzioni, × per toglierlo.") })),
    done);
  const tabs = h("div", { class: "be-tabs" },
    ...([["widgets", t("Widget")], ["look", t("Aspetto")]] as const).map(([id, label]) => {
      const b = h("button", { class: tab === id && !optionsKey ? "on" : "", text: label }) as HTMLButtonElement;
      b.addEventListener("click", () => {
        tab = id;
        fillKey = "";
        if (optionsKey) { optionsKey = ""; toBar({ options: "" }); }
        draw();
      });
      return b;
    }));
  const it = optionsKey ? items().find((x) => keyOf(x) === optionsKey) : undefined;
  if (optionsKey && !it) optionsKey = "";
  const body = h("div", { class: "be-body" }, ...(!settings.fixedBar
    ? [h("p", { class: "be-empty", text: t("La barra fissa è spenta: accendila qui sotto.") }),
      h("div", { class: "be-panel" }, line(t("Barra fissa"), segmented([["", t("Spenta")], ["top", t("Sopra")], ["bottom", t("Sotto")]] as ["" | "top" | "bottom", string][], "", (v) => { settings.fixedBar = v; save(); barOn(); draw(); })))]
    : it ? optionsView(it) : tab === "look" ? lookView() : widgetsView()));
  root.append(head, tabs, body);
  // A click on a switch, a choice or a button redraws the page: the same view stays where it was.
  const view = `${tab}|${optionsKey}|${fillKey}`;
  body.scrollTop = view === drawnView ? top : 0;
  drawnView = view;
}

async function main() {
  const info = await Bridge.boot();
  if (info) {
    settings = { ...settings, ...info.settings };
    syncLanguage(settings.language);
  } else {
    // Browser preview (npm run dev): a bar on top with a few elements.
    settings.fixedBar = "top";
    settings.fixedBarItems = [{ id: "sys:start", uid: "a1", area: "start" }, { id: "sys:clock", uid: "c1", area: "end" }];
  }
  document.title = t("Personalizza la barra — EasyIsland");
  applyUiStyle(settings.theme.style, settings.theme.scheme);
  applyFonts(settings.theme.fonts);
  document.body.removeAttribute("style");
  draw();
  if (!IS_TAURI) {
    // Browser preview: what the bar would ask, from the console (__barEdit({ kind: "options", key: "sys:clock#c1" })).
    (window as unknown as { __barEdit: typeof onReply }).__barEdit = onReply;
    return;
  }
  barOn();
  void onEvent<Record<string, unknown>>("bar-edit-reply", (p) => onReply(p as Parameters<typeof onReply>[0]));
  // Shown again: the bar back in its customize mode, the settings as they are now.
  void onEvent("bar-editor-shown", () => {
    optionsKey = "";
    fillKey = "";
    barOn();
    draw();
  });
  void onEvent<Settings>("settings-changed", (s) => {
    if (Date.now() - savedAt < 1500) return;
    settings = { ...settings, ...s };
    draw();
  });
}

void main();
