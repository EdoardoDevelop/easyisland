// The elements of the fixed bar (docs/architettura.md → «Barra fissa»): the user's
// integrations, widgets and quick actions in the bar's three areas, the strip
// (permission, call, recording, meeting, agent at work, the bar of the app in
// use), beside the character unless the user put it elsewhere, and the
// «Widget della barra» (clock, volume, microphone, brightness, battery,
// network, CPU, memory, disk, GPU, keyboard language, recycle bin, updates,
// window title, news, power menu; the bar of the app in use, music, weather,
// VS Code's recent folders), which may be added more than once with
// different options. The island keeps the data and prepares each element here,
// with the same icons as its menu and its actions; the character's window (the
// bar) only lays them out and sends the clicks back (src/core/link.ts). Texts
// are put in with textContent: a value read from a service, or the user's own
// format, never becomes markup.

import { h } from "../views/dom";
import { renderActionIcon } from "../views/action-icons";
import { taskIcon } from "../views/rail";
import { unreadNews } from "../views/news";
import { appName } from "./context";
import { State, type BarAct, type BarItem, type BarSys, type FixedBarDesign } from "../core/state";
import { BAR_KINDS, barKind } from "../core/barkinds";
import { locale, t, tn } from "../core/i18n";
import type { BarButton, BarPiece } from "../core/link";
import type { StripItem } from "../views/strip";

/** An element's key in the bar: its id, plus its uid for system elements (two clocks). */
export function keyOf(it: BarItem): string {
  return (it.id.startsWith("sys:") || it.id === "folder") && it.uid ? `${it.id}#${it.uid}` : it.id;
}

/** An element by its key: in the bar, or inside one of its folders. */
export function barItemOf(key: string): BarItem | null {
  const items = State.settings.fixedBarItems ?? [];
  const all = [...items, ...items.flatMap((x) => x.children ?? [])];
  return all.find((x) => keyOf(x) === key) ?? all.find((x) => x.id === key.split("#")[0]) ?? null;
}

/** An element's name and icon, for a folder's small island (barcard.ts). */
export function barItemLabel(it: BarItem): { name: string; icon: string } {
  if (it.id === "folder") return { name: it.name || t("Cartella"), icon: it.icon || "i:folder" };
  if (it.id === "strip") return { name: t("Striscia"), icon: "i:robot" };
  const kind = barKind(it.id);
  if (kind) return { name: kind.name, icon: kind.icon };
  if (it.id.startsWith("action:")) {
    const a = (State.settings.actions ?? []).find((x) => x.id === it.id.slice(7));
    return { name: a?.name ?? it.id, icon: a?.icon || "i:bolt" };
  }
  if (it.id.startsWith("task:widget:")) {
    const w = (State.settings.widgets ?? []).find((x) => x.id === it.id.slice(12));
    return { name: w?.name ?? t("Widget"), icon: "i:chart" };
  }
  const task = State.tasks.find((x) => x.id === it.id.slice(5));
  return { name: task?.name ?? it.id, icon: "i:plug" };
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

/** The last minute of what the graphs show (a reading every 2 s), by kind. */
const history: Record<string, number[]> = {};
const HISTORY = 30;

/** A new reading of barsys.rs: the graphs get their next point. */
export function recordBarSys(v: BarSys) {
  const push = (k: string, n: number | null | undefined) => {
    if (typeof n !== "number" || !Number.isFinite(n)) return;
    const list = (history[k] ??= []);
    list.push(n);
    if (list.length > HISTORY) list.shift();
  };
  push("cpu", v.cpu);
  push("ram", v.ram?.percent);
  push("gpu", v.gpu);
  push("net", v.net ? v.net.down + v.net.up : null);
}

/** A small line of the last minute: 0–100 for percentages, scaled to the highest for the network. */
function graph(kind: string): Node | null {
  const list = history[kind];
  if (!list || list.length < 2) return null;
  const NS = "http://www.w3.org/2000/svg";
  const W = 34;
  const H = 14;
  const top = kind === "net" ? Math.max(...list, 1) : 100;
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("class", "bar-graph");
  const line = document.createElementNS(NS, "polyline");
  const step = W / (HISTORY - 1);
  const x0 = W - step * (list.length - 1);
  line.setAttribute("points", list.map((n, i) => `${(x0 + i * step).toFixed(1)},${(H - 1 - (Math.min(n, top) / top) * (H - 2)).toFixed(1)}`).join(" "));
  svg.append(line);
  return svg;
}

/** Bytes, short: «850 MB», «1,2 GB». */
function bytes(n: number): string {
  const f = (x: number, d = 1) => x.toLocaleString(locale(), { maximumFractionDigits: d });
  if (n < 1e6) return `${f(n / 1e3, 0)} kB`;
  if (n < 1e9) return `${f(n / 1e6, 0)} MB`;
  if (n < 1e12) return `${f(n / 1e9, n < 1e10 ? 1 : 0)} GB`;
  return `${f(n / 1e12)} TB`;
}

/** The media integration's reading (src/views/integrations.ts → mediaCard), asked once if not there. */
let mediaAsked = false;
function media(): Record<string, unknown> {
  const id = "integration_media";
  if (!State.integrations[id]?.loaded && !mediaAsked && State.tasks.some((x) => x.id === id)) {
    mediaAsked = true;
    void import("../core/bridge").then((m) => m.Bridge.refreshIntegration(id)).catch(() => {});
  }
  return (State.integrations[id]?.data ?? {}) as Record<string, unknown>;
}

/** The Meteo sky as one of the action icons. */
function skyIcon(sky: string | null): string {
  if (!sky) return "i:sun";
  if (sky === "moon" || sky === "moon-cloud") return "i:moon";
  if (sky === "rain" || sky === "drizzle" || sky === "storm") return "i:umbrella";
  if (sky === "sun") return "i:sun";
  return "i:cloud";
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
type SysValue = { v: Record<string, string>; icon: string; tip: string; dim?: boolean; label?: string; pct?: number; wide?: boolean };

function sysValues(kind: string, it: BarItem, design: FixedBarDesign): SysValue {
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
    case "cpu": {
      const raw = typeof s.cpu === "number" ? s.cpu : undefined;
      const v = raw !== undefined ? pct(raw) : "—";
      return { v: { cpu: v, value: v }, icon: k.icon, tip: `${t("Processore")}: ${v}`, label: "CPU", pct: raw };
    }
    case "ram": {
      const r = s.ram;
      const v = r ? pct(r.percent) : "—";
      const used = r ? bytes(r.used) : "—";
      const total = r ? bytes(r.total) : "—";
      return { v: { ram: v, used, total, value: v }, icon: k.icon, tip: `${t("Memoria")}: ${v} · ${used} / ${total}`, label: "RAM", pct: r?.percent };
    }
    case "disk": {
      const drive = (it.opts?.drive || "C").toUpperCase();
      const d = s.disks?.[drive];
      const free = d ? bytes(d.free) : "—";
      const used = d && d.total ? pct(100 - (d.free / d.total) * 100) : "—";
      return {
        v: { free, used, drive: `${drive}:`, value: free }, icon: k.icon,
        tip: d ? t("Disco {d}: {free} liberi su {total}", { d: `${drive}:`, free, total: bytes(d.total) }) : `${t("Disco")} ${drive}:`,
        dim: !!d && d.total > 0 && d.free / d.total < 0.1,
      };
    }
    case "gpu": {
      const raw = typeof s.gpu === "number" ? s.gpu : undefined;
      const v = raw !== undefined ? pct(raw) : "—";
      return { v: { gpu: v, value: v }, icon: k.icon, tip: `${t("Scheda video")}: ${v}`, label: "GPU", pct: raw };
    }
    case "lang": {
      const l = s.lang;
      return { v: { code: l?.code ?? "—", lang: l?.name ?? "", value: l?.code ?? "—" }, icon: k.icon, tip: l ? `${t("Lingua della tastiera")}: ${l.name}` : t("Lingua della tastiera") };
    }
    case "recycle": {
      const r = s.recycle;
      const count = r ? String(r.count) : "";
      const size = r ? bytes(r.bytes) : "";
      const empty = !r || r.count === 0;
      return {
        v: { count, size, value: empty ? "" : count }, icon: k.icon,
        tip: empty ? t("Il cestino è vuoto") : t("Cestino: {n} elementi, {size}", { n: count, size }), dim: empty,
      };
    }
    case "updates": {
      const u = s.updates;
      const n = u?.count ?? 0;
      const v = u?.checking ? "…" : n ? String(n) : "";
      const tip = u?.checking ? t("Controllo degli aggiornamenti…")
        : !u ? t("winget non risponde")
        : n ? `${t("Aggiornamenti disponibili")}: ${(u.names ?? []).slice(0, 8).join(", ")}${n > 8 ? "…" : ""}`
        : t("Tutti i programmi sono aggiornati");
      return { v: { count: n ? String(n) : "", value: v }, icon: k.icon, tip, dim: !n };
    }
    case "title": {
      // The program's own name and icon (fgwin.rs), the title without that name at its end.
      const w = State.barWindow;
      const max = Math.max(10, Math.min(200, it.opts?.max ?? 60));
      const full = w?.title ?? "";
      const title = full.length > max ? `${full.slice(0, max - 1)}…` : full;
      const app = w?.name ?? "";
      const icon = w?.icon?.startsWith("data:image/png;base64,") ? w.icon : k.icon;
      return { v: { title, app, value: title || app }, icon, tip: [app, full].filter(Boolean).join(" — "), wide: true };
    }
    case "weather": {
      const w = State.weatherNow;
      return { v: { temp: w.temp, value: w.temp || "—" }, icon: skyIcon(w.sky), tip: w.temp ? `${t("Meteo")}: ${w.temp}` : t("Meteo: attiva l'integrazione Meteo"), dim: !w.temp, wide: true };
    }
    case "music": {
      const d = media();
      const title = typeof d.title === "string" ? d.title : "";
      const artist = typeof d.artist === "string" ? d.artist : "";
      const idleValue = design === "classic" ? t("Niente in riproduzione") : "";
      return {
        v: { title, artist, value: title || idleValue }, icon: k.icon,
        tip: d.active ? [title, artist].filter(Boolean).join(" — ") : t("Niente in riproduzione"), dim: !d.playing, wide: !!title,
      };
    }
    case "vscode": {
      const list = s.vscode ?? [];
      const first = list[0]?.name ?? "";
      return { v: { name: first, value: first || "VS Code" }, icon: k.icon, tip: list.length ? `${t("Progetti recenti di VS Code")}: ${list.slice(0, 5).map((x) => x.name).join(", ")}` : t("Nessun progetto recente di VS Code") };
    }
    case "appbar": {
      const exe = State.foreground?.exe ?? "";
      const app = exe && State.barWindow?.exe === exe && State.barWindow.name ? State.barWindow.name : exe ? appName(exe) : "";
      return { v: { app, value: app }, icon: k.icon, tip: app ? t("Azioni per {app}", { app }) : t("Barra dell'app in uso") };
    }
    case "search":
      return { v: { value: "" }, icon: k.icon, tip: t("Cerca: apre la ricerca nella sua finestra, l'isola resta com'è") };
    case "memory":
      return { v: { value: "" }, icon: k.icon, tip: t("Memoria: apre la mappa della memoria") };
    case "start": case "winsearch": case "taskview": case "widgets": case "systray":
    case "quicksettings": case "notifications": case "explorer": case "winsettings": case "showdesktop":
      return { v: { value: "" }, icon: k.icon, tip: k.name };
    case "news": {
      const n = unreadNews();
      const title = State.news[0]?.title ?? "";
      const v = n ? String(n) : "";
      return { v: { new: v, title, value: v }, icon: k.icon, tip: title ? `${t("Notizie")}: ${title}` : t("Notizie"), dim: !n };
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
function compose(el: HTMLElement, format: string, icon: () => Node, v: Record<string, string>, steady = false) {
  const parts = format.split(/(\{[a-z]+\})/);
  let text = "";
  const flush = () => {
    const s = text.trim();
    text = "";
    if (!s) return;
    // A value that changes (9 % → 10 %) keeps the room of its widest: the
    // elements beside it do not move (personaggio.html → .bar-steady).
    if (steady && /\d/.test(s)) el.append(h("span", { class: "bar-text bar-steady" }, h("span", { text: s }), h("span", { class: "bar-ghost", text: widest(s), "aria-hidden": "true" })));
    else el.append(h("span", { class: "bar-text", text: s }));
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

/**
 * The widest a changing value may get: each number at least three digits
 * (100 %, 999 KB/s), times, dates and decimals as long as they are, every
 * digit a 0 (the bar's numbers are tabular).
 */
export function widest(s: string): string {
  return s.replace(/\d+/g, (run: string, i: number) => {
    const before = s[i - 1] ?? "";
    const after = s[i + run.length] ?? "";
    const fixed = before === ":" || after === ":" || before === "/" || after === "/" || before === "." || before === ",";
    return "0".repeat(fixed ? run.length : Math.max(3, run.length));
  });
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
 * Small buttons inside an element (music's previous / play / next, the
 * actions of the app in use): each carries its index (`data-btn`), and the
 * click comes back as `<key>:btn:<i>` (Island.barClick).
 */
function innerButtons(el: HTMLElement, buttons: { icon?: string; label: string; color?: string; look?: string }[]) {
  buttons.forEach((b, i) => {
    const look = b.look ?? "icon";
    const icon = b.icon !== undefined && look !== "text";
    const btn = h("span", { class: "bar-strip-btn", title: b.label });
    btn.dataset.btn = String(i);
    if (b.color) btn.style.setProperty("--action", b.color);
    if (icon) btn.append(h("span", { class: "bar-icon" }, renderActionIcon(b.icon, 13)));
    if (look !== "icon" || !icon) btn.append(h("span", { text: b.label }));
    el.append(btn);
  });
}

/** Music's buttons: previous, play or pause, next (Bridge.mediaCommand). */
export function musicButtons(): { icon: string; label: string; cmd: string }[] {
  const playing = !!media().playing;
  return [
    { icon: "i:previous", label: t("Precedente"), cmd: "prev" },
    { icon: playing ? "i:pause" : "i:play", label: playing ? t("Pausa") : t("Riproduci"), cmd: "toggle" },
    { icon: "i:next", label: t("Successivo"), cmd: "next" },
  ];
}

/**
 * What the bar shows now, in the user's order. Elements that are gone are
 * skipped. `strip` is what the strip shows now (null: nothing): at its place in
 * the list, or first beside the character when the user did not place it.
 * `appBar` is the bar of the app in use, for its own element.
 */
function decorateSys(el: HTMLElement, sv: SysValue, it: BarItem, kind: string, design: FixedBarDesign) {
  if (design === "classic") return;
  if (sv.wide) el.classList.add("bar-wide");
  if (kind === "music" && media().playing) {
    el.prepend(h("span", { class: "bar-eq", "aria-hidden": "true" }, h("span"), h("span"), h("span")));
  }
  if (it.opts?.format || (it.show ?? "both") === "icon") return;
  if (sv.label) {
    const label = h("span", { class: "bar-klabel", text: sv.label });
    const textEl = el.querySelector(".bar-text");
    if (textEl) textEl.before(label);
    else el.append(label);
  }
  if (design === "pills" && typeof sv.pct === "number" && !it.opts?.graph) {
    const pct = Math.max(0, Math.min(100, Math.round(sv.pct)));
    const cls = sv.pct >= 90 ? "bar-meter-fill crit" : sv.pct >= 75 ? "bar-meter-fill high" : "bar-meter-fill";
    el.append(h("span", { class: "bar-meter", "aria-hidden": "true" }, h("span", { class: cls, "data-pct": String(pct) })));
  }
}

export function barPieces(strip: StripItem | null, appBar: StripItem | null = null): BarPiece[] {
  const out: BarPiece[] = [];
  const design: FixedBarDesign = State.settings.fixedBarLook?.design ?? "classic";
  const items = State.settings.fixedBarItems ?? [];
  if (strip && !items.some((x) => x.id === "strip")) out.push(stripPiece(strip, State.settings.fixedBarSlot ?? "center"));
  for (const it of items) {
    const area = it.area === "start" || it.area === "end" ? it.area : "center";
    const key = keyOf(it);
    const tip = it.opts?.tip?.trim();
    if (it.id === "strip") {
      if (strip) out.push(stripPiece(strip, area));
      else out.push(emptyPiece(key, area, "i:robot", t("Striscia"), t("Vuota: compare quando c'è un permesso, una chiamata, un agente al lavoro…")));
    } else if (it.id.startsWith("sys:")) {
      const kind = it.id.slice(4);
      if (!BAR_KINDS[kind]) continue;
      // «App»: an empty place, filled by the bar's page with the apps (character-window/apps.ts).
      if (kind === "apps") {
        out.push({ key, area, html: h("span", { class: "bar-item bar-apps-host" }, h("span", { class: "bar-apps" })).outerHTML, title: "" });
        continue;
      }
      // The bar of the app in use: empty when the program in front has no actions of the user.
      if (kind === "appbar" && !appBar?.buttons.length) {
        out.push(emptyPiece(key, area, BAR_KINDS[kind].icon, BAR_KINDS[kind].name, t("Vuota: compare quando il programma davanti ha azioni rapide tue («Nella barra con»)")));
        continue;
      }
      const sv = sysValues(kind, it, design);
      const el = h("span", { class: `bar-item bar-sys${sv.dim ? " dim" : ""}` });
      // A program's own icon (the window title) is a picture; the others are drawn.
      const icon = () => sv.icon.startsWith("data:image/png")
        ? h("img", { class: "bar-app-icon", src: sv.icon, alt: "" })
        : renderActionIcon(sv.icon, 15);
      compose(el, formatOf(it, key), icon, sv.v, true);
      decorateSys(el, sv, it, kind, design);
      if (it.opts?.graph && BAR_KINDS[kind].graph) {
        const g = graph(kind);
        if (g) el.append(g);
      }
      if (kind === "music" && it.opts?.buttons !== false && media().active) innerButtons(el, musicButtons());
      if (kind === "appbar" && appBar) {
        innerButtons(el, appBar.buttons.map((b) => ({ icon: b.icon, label: b.label, color: b.color, look: b.look })));
      }
      out.push({ key, area, html: el.outerHTML, title: tip || sv.tip });
    } else if (it.id.startsWith("task:")) {
      const task = State.tasks.find((x) => x.isIntegration && x.id === it.id.slice(5));
      if (!task) continue;
      const { value, level } = valueOf(task.id);
      const extraCls = design !== "classic"
        ? `${task.id.includes("weather") ? " bar-wide" : ""}${!value && task.id.includes("clipboard") ? " bar-idle-compact" : ""}`
        : "";
      const el = h("span", { class: `bar-item${extraCls}` });
      compose(el, formatOf(it, key), () => taskIcon(task), { value: value || task.name, name: task.name });
      out.push({ key, area, html: el.outerHTML, title: tip || (value ? `${task.name} — ${value}` : task.name), tone: level });
    } else if (it.id.startsWith("action:")) {
      const a = (State.settings.actions ?? []).find((x) => x.id === it.id.slice(7));
      if (!a) continue;
      const el = h("span", { class: "bar-item bar-action" });
      if (a.color) el.style.setProperty("--action", a.color);
      compose(el, formatOf(it, key), () => renderActionIcon(a.icon, 15), { value: a.name, name: a.name });
      out.push({ key, area, html: el.outerHTML, title: tip || a.name });
    } else if (it.id === "folder") {
      // A folder: its icon and name; a click opens its small island (barcard.ts).
      const name = it.name || t("Cartella");
      const n = it.children?.length ?? 0;
      const el = h("span", { class: "bar-item bar-folder" });
      compose(el, formatOf(it, key), () => renderActionIcon(it.icon || "i:folder", 15), { value: name, name });
      out.push({ key, area, html: el.outerHTML, title: tip || `${name} · ${tn("{n} elemento", "{n} elementi", n)}` });
    }
  }
  return out;
}

/**
 * An element with nothing to show now (the strip, the bar of the app in use):
 * sent anyway, hidden in the bar and shown with its name while the bar is
 * customized, or it could be neither seen nor removed (Edoardo, 22 Nov 2026).
 */
function emptyPiece(key: string, area: BarPiece["area"], icon: string, name: string, tip: string): BarPiece {
  const el = h("span", { class: "bar-item bar-empty" });
  compose(el, "{icon} {value}", () => renderActionIcon(icon, 15), { value: name, name });
  return { key, area, html: el.outerHTML, title: tip };
}

/** The system elements barsys.rs has to read now (none while the bar is off). Graphs of the
 *  network need its reading too. */
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

/**
 * The menu of a system element (the «menu» button): lines that come back as
 * `sys:<kind>:<what>[:<arg>]` (Island.barClick); a key starting with "-" only
 * tells, an empty key is a separator (tray.rs → popup_bar_menu).
 */
export function barMenuOf(it: BarItem): [string, string][] {
  const s = State.barSys;
  switch (it.id) {
    case "sys:power": return powerMenu();
    case "sys:volume": return soundMenu("volume");
    case "sys:mic": return soundMenu("mic");
    case "sys:cpu": case "sys:ram": case "sys:gpu":
      return [[`${it.id}:taskmgr`, t("Gestione attività")]];
    case "sys:disk": {
      const d = (it.opts?.drive || "C").toUpperCase();
      return [[`sys:disk:open:${d}`, t("Apri il disco {d}", { d: `${d}:` })], ["sys:disk:storage", t("Archiviazione di Windows")]];
    }
    case "sys:lang":
      return [["sys:lang:switch", t("Cambia lingua")], ["sys:lang:settings", t("Impostazioni della lingua di Windows")]];
    case "sys:recycle": {
      const r = s.recycle;
      const head: [string, string][] = r && r.count ? [["-count", t("Cestino: {n} elementi, {size}", { n: String(r.count), size: bytes(r.bytes) })], ["", ""]] : [];
      return [...head, ["sys:recycle:open", t("Apri il cestino")], ...(r && r.count ? [["sys:recycle:empty", t("Svuota il cestino…")] as [string, string]] : [])];
    }
    case "sys:updates": {
      const u = s.updates;
      const names = (u?.names ?? []).slice(0, 12).map((n, i) => [`-u${i}`, n] as [string, string]);
      return [
        ...names,
        ...(names.length ? [["", ""] as [string, string], ["sys:updates:all", t("Aggiorna tutto…")] as [string, string]] : []),
        ["sys:updates:check", u?.checking ? t("Controllo in corso…") : t("Controlla adesso")],
        ["sys:updates:windows", "Windows Update"],
      ];
    }
    case "sys:vscode": {
      const max = Math.max(1, Math.min(15, it.opts?.max ?? 10));
      const list = (s.vscode ?? []).slice(0, max).map((x, i) => [`sys:vscode:open:${i}`, `${x.name}  —  ${x.path}`] as [string, string]);
      return list.length ? list : [["-none", t("Nessun progetto recente di VS Code")]];
    }
    default: return [];
  }
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

export type { BarButton };
