// The elements of the fixed bar (docs/architettura.md → «Barra fissa»): the user's
// integrations, widgets and quick actions in the bar's three areas, the strip
// (permission, call, recording, meeting, agent at work, the bar of the app in
// use), beside the character unless the user put it elsewhere, and the
// «Widget della barra» of the system (clock, volume, microphone, brightness,
// battery, network, power menu), which may be added more than once with
// different options. The island keeps the data and prepares each element here,
// with the same icons as its menu and its actions; the character's window (the
// bar) only lays them out and sends the clicks back (src/core/link.ts). Texts
// are put in with textContent: a value read from a service, or the user's own
// format, never becomes markup.

import { h } from "../views/dom";
import { renderActionIcon } from "../views/action-icons";
import { taskIcon } from "../views/rail";
import { State, type BarAct, type BarItem } from "../core/state";
import { BAR_KINDS, barKind } from "../core/barkinds";
import { locale, t } from "../core/i18n";
import type { BarButton, BarPiece } from "../core/link";
import type { StripItem } from "../views/strip";

/** An element's key in the bar: its id, plus its uid for system elements (two clocks). */
function keyOf(it: BarItem): string {
  return it.id.startsWith("sys:") && it.uid ? `${it.id}#${it.uid}` : it.id;
}

/** The element a key stands for (a key without uid finds the first of its id). */
export function barItemOf(key: string): BarItem | null {
  const items = State.settings.fixedBarItems ?? [];
  return items.find((x) => keyOf(x) === key) ?? items.find((x) => x.id === key.split("#")[0]) ?? null;
}

/** Elements showing their second text («alt»), by key. Not saved. */
const altOn = new Set<string>();

export function toggleAlt(key: string) {
  if (altOn.has(key)) altOn.delete(key);
  else altOn.add(key);
}

/** What a button does on an element: the user's choice, else the element's own. */
export function barAct(it: BarItem, button: "left" | "middle" | "right"): BarAct {
  const own = it.opts?.[button];
  if (own) return own;
  const kind = barKind(it.id);
  if (kind) return kind[button];
  if (button !== "left") return "none";
  return it.id.startsWith("action:") ? (`action:${it.id.slice(7)}` as BarAct) : "card";
}

/** True when the wheel changes something on this element. */
export function barWheels(it: BarItem): boolean {
  return !!barKind(it.id)?.wheel && it.opts?.wheel !== false;
}

/**
 * The strip as one element: its line and its buttons. Each button carries its
 * index (`data-btn`): the click comes back as `strip:btn:<i>` (Island.barClick).
 */
function stripPiece(item: StripItem, area: BarPiece["area"]): BarPiece {
  const el = h("span", { class: "bar-strip" });
  el.dataset.tone = item.tone;
  if (item.title || item.sub) {
    el.append(h("span", { class: "bar-strip-text" },
      ...(item.title ? [h("strong", { text: item.title })] : []),
      ...(item.sub ? [h("span", { class: "bar-strip-sub", text: item.sub })] : [])));
  }
  item.buttons.forEach((b, i) => {
    const look = b.look ?? "both";
    const icon = b.icon !== undefined && look !== "text";
    const btn = h("span", { class: `bar-strip-btn ${b.tone}`, title: b.hint ?? b.label });
    btn.dataset.btn = String(i);
    if (b.color) btn.style.setProperty("--action", b.color);
    if (icon) btn.append(h("span", { class: "bar-icon" }, renderActionIcon(b.icon, 14)));
    if (look !== "icon" || !icon) btn.append(h("span", { text: b.label }));
    el.append(btn);
  });
  return { key: "strip", area, html: el.outerHTML, title: [item.title, item.sub].filter(Boolean).join(" — ") };
}

/** The status line of an integration or widget: its summary, or its last step. */
function valueOf(taskId: string): { value: string; level?: "ok" | "warn" | "error" } {
  const st = State.widgetStatus[taskId.replace(/^widget:/, "")];
  const task = State.tasks.find((x) => x.id === taskId);
  const step = task?.steps.length ? task.steps[task.steps.length - 1] : "";
  return { value: st?.summary || step || "", level: st?.level };
}

/** Bytes per second, short: «850 kB/s», «1,2 MB/s». */
function speed(n: number): string {
  if (n < 1000) return `${Math.round(n)} B/s`;
  if (n < 1_000_000) return `${Math.round(n / 1000)} kB/s`;
  return `${(n / 1_000_000).toLocaleString(locale(), { maximumFractionDigits: 1 })} MB/s`;
}

/** A clock's time and date, in its time zone (an unknown zone falls back to the PC's). */
function clockText(it: BarItem): Record<string, string> {
  const now = new Date();
  const fmt = (o: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat(locale(), { ...o, timeZone: it.opts?.tz || undefined }).format(now);
    } catch {
      return new Intl.DateTimeFormat(locale(), o).format(now);
    }
  };
  const time = fmt({ hour: "2-digit", minute: "2-digit", ...(it.opts?.seconds ? { second: "2-digit" } : {}) });
  return {
    time, value: time,
    date: fmt({ weekday: "short", day: "numeric", month: "short" }),
    day: fmt({ weekday: "long" }),
    full: fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" }),
  };
}

/** What a system element shows now: its placeholders, the icon, the tooltip, how it looks. */
function sysValues(kind: string, it: BarItem): { v: Record<string, string>; icon: string; tip: string; dim?: boolean } {
  const s = State.barSys;
  const k = BAR_KINDS[kind];
  const pct = (n: number) => `${Math.round(n)}%`;
  switch (kind) {
    case "clock": {
      const v = clockText(it);
      return { v, icon: k.icon, tip: `${v.full}${it.opts?.tz ? ` · ${it.opts.tz.replace(/_/g, " ")}` : ""}` };
    }
    case "volume": {
      const muted = !!s.volume?.muted;
      const v = s.volume ? (muted ? t("muto") : pct(s.volume.level * 100)) : "—";
      return { v: { volume: v, value: v }, icon: k.icon, tip: `${t("Volume")}: ${v}`, dim: muted };
    }
    case "mic": {
      const muted = !!s.mic?.muted;
      const v = s.mic ? (muted ? t("muto") : t("acceso")) : "—";
      return { v: { mic: v, value: v }, icon: k.icon, tip: `${t("Microfono")}: ${v}`, dim: muted };
    }
    case "brightness": {
      const v = typeof s.brightness === "number" ? pct(s.brightness) : "—";
      return { v: { brightness: v, value: v }, icon: k.icon, tip: `${t("Luminosità")}: ${v}` };
    }
    case "battery": {
      const b = s.battery;
      const v = b ? pct(b.percent) : t("nessuna batteria");
      const state = !b ? "" : b.charging ? t("in carica") : b.plugged ? t("collegata") : "";
      return { v: { battery: v, state, value: v }, icon: k.icon, tip: [t("Batteria"), v, state].filter(Boolean).join(" · "), dim: !!b && b.percent <= 15 && !b.plugged };
    }
    case "net": {
      const n = s.net;
      const down = n ? speed(n.down) : "—";
      const up = n ? speed(n.up) : "—";
      return { v: { down, up, value: `↓ ${down} ↑ ${up}` }, icon: n?.wifi ? "i:wifi" : k.icon, tip: `${t("Rete")}: ↓ ${down} · ↑ ${up}` };
    }
    default:
      return { v: { value: "" }, icon: k?.icon ?? "i:power", tip: k?.name ?? "" };
  }
}

/**
 * Puts an element together from its format: {icon} becomes the icon, every other
 * placeholder its value, the rest stays as typed. Only text nodes: nothing the
 * user typed or a service sent becomes markup.
 */
function compose(el: HTMLElement, format: string, icon: () => Node, v: Record<string, string>) {
  const parts = format.split(/(\{[a-z]+\})/);
  let text = "";
  const flush = () => {
    if (text.trim()) el.append(h("span", { class: "bar-text", text: text.trim() }));
    text = "";
  };
  for (const p of parts) {
    const m = /^\{([a-z]+)\}$/.exec(p);
    if (m && m[1] === "icon") {
      flush();
      el.append(h("span", { class: "bar-icon" }, icon()));
    } else if (m) {
      text += v[m[1]] ?? "";
    } else {
      text += p;
    }
  }
  flush();
}

/** The format an element uses now: its second text after an «alt» click, its own, or one from `show`. */
function formatOf(it: BarItem, key: string): string {
  const kind = barKind(it.id);
  const alt = it.opts?.alt || kind?.alt;
  if (altOn.has(key) && alt) return alt;
  if (it.opts?.format) return it.opts.format;
  const show = it.show ?? "both";
  return show === "icon" ? "{icon}" : show === "value" ? "{value}" : "{icon} {value}";
}

/**
 * What the bar shows now, in the user's order. Elements that are gone are
 * skipped. `strip` is what the strip shows now (null: nothing): at its place in
 * the list, or first beside the character when the user did not place it.
 */
export function barPieces(strip: StripItem | null): BarPiece[] {
  const out: BarPiece[] = [];
  const items = State.settings.fixedBarItems ?? [];
  if (strip && !items.some((x) => x.id === "strip")) out.push(stripPiece(strip, State.settings.fixedBarSlot ?? "center"));
  for (const it of items) {
    const area = it.area === "start" || it.area === "end" ? it.area : "center";
    const key = keyOf(it);
    const tip = it.opts?.tip?.trim();
    if (it.id === "strip") {
      if (strip) out.push(stripPiece(strip, area));
    } else if (it.id.startsWith("sys:")) {
      const kind = it.id.slice(4);
      if (!BAR_KINDS[kind]) continue;
      const sv = sysValues(kind, it);
      const el = h("span", { class: `bar-item bar-sys${sv.dim ? " dim" : ""}` });
      compose(el, formatOf(it, key), () => renderActionIcon(sv.icon, 15), sv.v);
      out.push({ key, area, html: el.outerHTML, title: tip || sv.tip });
    } else if (it.id.startsWith("task:")) {
      const task = State.tasks.find((x) => x.isIntegration && x.id === it.id.slice(5));
      if (!task) continue;
      const { value, level } = valueOf(task.id);
      const el = h("span", { class: "bar-item" });
      compose(el, formatOf(it, key), () => taskIcon(task), { value: value || task.name, name: task.name });
      out.push({ key, area, html: el.outerHTML, title: tip || (value ? `${task.name} — ${value}` : task.name), tone: level });
    } else if (it.id.startsWith("action:")) {
      const a = (State.settings.actions ?? []).find((x) => x.id === it.id.slice(7));
      if (!a) continue;
      const el = h("span", { class: "bar-item bar-action" });
      if (a.color) el.style.setProperty("--action", a.color);
      compose(el, formatOf(it, key), () => renderActionIcon(a.icon, 15), { value: a.name, name: a.name });
      out.push({ key, area, html: el.outerHTML, title: tip || a.name });
    }
  }
  return out;
}

/** The system elements barsys.rs has to read now (none while the bar is off). */
export function barSysKinds(): string[] {
  if (!State.settings.fixedBar) return [];
  const kinds = new Set<string>();
  for (const it of State.settings.fixedBarItems ?? []) {
    const k = barKind(it.id);
    if (k?.native) kinds.add(it.id.slice(4));
  }
  return [...kinds].sort();
}

/** Milliseconds to the next minute (or second) a clock in the bar shows; null without one. */
export function barClockDelay(): number | null {
  if (!State.settings.fixedBar) return null;
  const clocks = (State.settings.fixedBarItems ?? []).filter((x) => x.id === "sys:clock");
  if (!clocks.length) return null;
  const now = Date.now();
  const step = clocks.some((c) => c.opts?.seconds) ? 1000 : 60_000;
  return step - (now % step) + 20;
}

/** The power menu's lines: they come back as `sys:power:<what>` (Island.barClick). */
export function powerMenu(): [string, string][] {
  return [
    ["sys:power:lock", t("Blocca")],
    ["sys:power:sleep", t("Sospendi…")],
    ["sys:power:restart", t("Riavvia…")],
    ["sys:power:shutdown", t("Spegni…")],
  ];
}

/** The menu of the microphone and the volume: mute, and Windows' sound settings. */
export function soundMenu(kind: "volume" | "mic"): [string, string][] {
  const muted = kind === "mic" ? State.barSys.mic?.muted : State.barSys.volume?.muted;
  return [
    [`sys:${kind}:mute`, muted ? t("Riattiva l'audio") : t("Disattiva l'audio")],
    [`sys:${kind}:settings`, t("Impostazioni audio di Windows")],
  ];
}

/** The Windows panel an element's «card» opens (barsys.rs → panel). */
export function barPanel(kind: string): string {
  return kind === "clock" ? "calendar" : kind === "volume" ? "volume" : kind === "mic" ? "sound" : "quick";
}

export type { BarButton };
