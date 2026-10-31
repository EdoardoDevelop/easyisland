// The cards of the fixed bar's system elements (docs/architettura.md → «Barra
// fissa», «Widget della barra»): a click on the clock, the volume, the
// microphone, the brightness, the battery or the network opens its card in the
// island, against the bar, instead of a Windows panel. `State.barCard` says
// which one. Values come from src-tauri/src/barsys.rs (`State.barSys`) and are
// redrawn when they change; a slider being dragged is left alone. Each card
// keeps a button to the matching Windows page for what it does not do itself.

import { h, clear } from "./dom";
import { washRGBA, type Wash } from "../core/layout";
import { Bridge } from "../core/bridge";
import { State, type AppMenuLine } from "../core/state";
import { renderActionIcon } from "./action-icons";
import { actionForApp } from "./strip";
import { BAR_KINDS } from "../core/barkinds";
import type { ViewActions, ViewHost } from "./views";
import { locale, t } from "../core/i18n";

const WASH: Record<string, Wash> = { clock: "indigo", volume: "cyan", mic: "pink", brightness: "amber", battery: "green", net: "cyan", appmenu: "indigo" };

/** Bytes per second, short: «850 kB/s», «1,2 MB/s». */
function speed(n: number): string {
  if (n < 1000) return `${Math.round(n)} B/s`;
  if (n < 1_000_000) return `${Math.round(n / 1000)} kB/s`;
  return `${(n / 1_000_000).toLocaleString(locale(), { maximumFractionDigits: 1 })} MB/s`;
}

/** A link speed in bit/s: «866 Mbit/s», «1 Gbit/s». */
function link(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toLocaleString(locale(), { maximumFractionDigits: 1 })} Gbit/s`;
  return `${Math.round(n / 1e6)} Mbit/s`;
}

function minutes(m: number): string {
  const hh = Math.floor(m / 60);
  return hh ? t("circa {h} h {m} min", { h: hh, m: m % 60 }) : t("circa {m} min", { m });
}

export function buildBarCard(actions: ViewActions): ViewHost {
  const body = h("div", { class: "stack recap-stack barcard" });
  const card = h("div", { class: "card wash recap-card" }, body);
  const el = h("div", { class: "view" }, card);
  /** The card on screen and what updates it when values change. */
  let shown = "";
  let update: () => void = () => {};
  /** The clock card's month, as an offset from this one (‹ ›). */
  let month = 0;

  /** «Apri in Windows»-style buttons at the bottom. */
  const windowsButtons = (...pages: [string, string][]) =>
    h("div", { class: "actions" },
      ...pages.map(([page, label]) => h("button", { class: "btn secondary", onclick: () => void Bridge.barSysDo(`panel:${page}`) }, h("span", { text: label }))),
      h("button", { class: "btn secondary", onclick: () => actions.collapse() }, h("span", { text: "OK" })));

  const head = (kind: string, title: string, side: HTMLElement | string = "") =>
    h("div", { class: "recap-head" },
      h("span", { class: "barcard-icon" }, renderActionIcon(BAR_KINDS[kind]?.icon, 16)),
      h("span", { class: "recap-title", text: title }),
      h("span", { class: "grow" }),
      typeof side === "string" ? h("span", { class: "recap-range", text: side }) : side);

  /**
   * A slider 0–100 that sends while dragged (at most every 80 ms) and once more
   * when let go; `get` reads the value to show, unless the slider is in use.
   */
  const slider = (send: (v: number) => void, get: () => number | null) => {
    const input = h("input", { type: "range", min: "0", max: "100", step: "1", class: "barcard-range" }) as HTMLInputElement;
    const value = h("span", { class: "barcard-value" });
    let held = false;
    let last = 0;
    input.addEventListener("pointerdown", () => { held = true; });
    input.addEventListener("input", () => {
      value.textContent = `${input.value}%`;
      const now = performance.now();
      if (now - last > 80) {
        last = now;
        send(Number(input.value));
      }
    });
    input.addEventListener("change", () => {
      held = false;
      send(Number(input.value));
    });
    const row = h("div", { class: "barcard-slider" }, input, value);
    const sync = () => {
      const v = get();
      input.disabled = v === null;
      if (held || v === null) {
        if (v === null) value.textContent = "—";
        return;
      }
      input.value = String(Math.round(v));
      value.textContent = `${Math.round(v)}%`;
    };
    return { row, sync };
  };

  const muteButton = (kind: "volume" | "mic") => {
    const b = h("button", { class: "barcard-mute", onclick: () => void Bridge.barSysDo(kind === "mic" ? "mic-mute" : "mute") }) as HTMLButtonElement;
    const sync = () => {
      const muted = !!(kind === "mic" ? State.barSys.mic : State.barSys.volume)?.muted;
      b.classList.toggle("on", muted);
      b.title = muted ? t("Riattiva l'audio") : t("Disattiva l'audio");
      clear(b);
      b.append(renderActionIcon(kind === "mic" ? "i:mic" : "i:volume", 16), h("span", { text: muted ? t("Muto") : t("Acceso") }));
    };
    return { b, sync };
  };

  function sound(kind: "volume" | "mic"): Node[] {
    const device = h("div", { class: "sub barcard-device" });
    const mute = muteButton(kind);
    const s = slider(
      (v) => void Bridge.barSysDo(kind === "mic" ? "mic-set" : "volume-set", v),
      () => { const x = kind === "mic" ? State.barSys.mic : State.barSys.volume; return x ? x.level * 100 : null; },
    );
    update = () => {
      const x = kind === "mic" ? State.barSys.mic : State.barSys.volume;
      device.textContent = x?.device || (x ? "" : t("Nessun dispositivo"));
      mute.sync();
      s.sync();
    };
    return [
      head(kind, kind === "mic" ? t("Microfono") : t("Volume")),
      device,
      h("div", { class: "barcard-row" }, mute.b, s.row),
      windowsButtons(...(kind === "volume" ? [["volume", t("Mixer di Windows")] as [string, string]] : []), ["sound", t("Impostazioni audio")]),
    ];
  }

  function brightness(): Node[] {
    const note = h("div", { class: "sub" });
    const s = slider((v) => void Bridge.barSysDo("brightness-set", v), () => (typeof State.barSys.brightness === "number" ? State.barSys.brightness : null));
    update = () => {
      note.textContent = typeof State.barSys.brightness === "number" ? "" : t("Nessuno schermo permette di cambiare la luminosità da qui.");
      s.sync();
    };
    return [head("brightness", t("Luminosità")), s.row, note, windowsButtons(["display", t("Impostazioni dello schermo")])];
  }

  function battery(): Node[] {
    const big = h("div", { class: "barcard-big" });
    const bar = h("div", { class: "barcard-meter" }, h("span"));
    const info = h("div", { class: "sub" });
    update = () => {
      const b = State.barSys.battery;
      big.textContent = b ? `${b.percent}%` : "—";
      (bar.firstElementChild as HTMLElement).style.width = `${b ? b.percent : 0}%`;
      bar.classList.toggle("low", !!b && b.percent <= 15 && !b.plugged);
      info.textContent = !b ? t("Questo PC non ha una batteria.") : [
        b.charging ? t("in carica") : b.plugged ? t("collegata") : t("a batteria"),
        !b.plugged && typeof b.minutes === "number" ? minutes(b.minutes) : "",
        b.saver ? t("risparmio energia acceso") : "",
      ].filter(Boolean).join(" · ");
    };
    return [head("battery", t("Batteria")), big, bar, info, windowsButtons(["power", t("Alimentazione")], ["quick", t("Impostazioni rapide")])];
  }

  function net(): Node[] {
    const down = h("span", { class: "v" });
    const up = h("span", { class: "v" });
    const info = h("div", { class: "sub" });
    const name = h("span", { class: "recap-range" });
    update = () => {
      const n = State.barSys.net;
      down.textContent = n ? speed(n.down) : "—";
      up.textContent = n ? speed(n.up) : "—";
      name.textContent = n?.name ?? "";
      info.textContent = !n ? t("Nessuna rete") : [n.ip ? `IP ${n.ip}` : "", n.link ? t("collegamento a {s}", { s: link(n.link) }) : ""].filter(Boolean).join(" · ");
    };
    return [
      head("net", t("Rete"), name),
      h("div", { class: "recap-chips" },
        h("div", { class: "recap-chip" }, down, h("div", { class: "l", text: t("↓ in arrivo") })),
        h("div", { class: "recap-chip" }, up, h("div", { class: "l", text: t("↑ in uscita") }))),
      info,
      windowsButtons(["network", t("Stato della rete")]),
    ];
  }

  function clock(): Node[] {
    const time = h("span", { class: "recap-range barcard-time" });
    const grid = h("div", { class: "barcard-cal" });
    const title = h("span", { class: "barcard-month" });
    const others = h("div", { class: "daily-list" });
    const events = h("div", { class: "daily-list" });
    const draw = () => {
      const now = new Date();
      const first = new Date(now.getFullYear(), now.getMonth() + month, 1);
      title.textContent = first.toLocaleDateString(locale(), { month: "long", year: "numeric" });
      clear(grid);
      // Weekday initials, Monday first (as in Italy and most of Europe).
      for (let i = 0; i < 7; i++) {
        const d = new Date(2024, 0, 1 + i);
        grid.append(h("span", { class: "barcard-wd", text: d.toLocaleDateString(locale(), { weekday: "narrow" }) }));
      }
      const lead = (first.getDay() + 6) % 7;
      for (let i = 0; i < lead; i++) grid.append(h("span"));
      const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
      for (let d = 1; d <= days; d++) {
        const today = month === 0 && d === now.getDate();
        grid.append(h("span", { class: today ? "barcard-day today" : "barcard-day", text: String(d) }));
      }
    };
    const nav = h("span", { class: "barcard-nav" },
      h("button", { text: "‹", title: t("Mese prima"), onclick: () => { month--; draw(); } }),
      title,
      h("button", { text: "›", title: t("Mese dopo"), onclick: () => { month++; draw(); } }));
    update = () => {
      const now = new Date();
      time.textContent = now.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
      // The other clocks in the bar, with their zone.
      clear(others);
      const clocks = (State.settings.fixedBarItems ?? []).filter((x) => x.id === "sys:clock" && x.opts?.tz);
      if (clocks.length) {
        others.append(h("div", { class: "daily-h", text: t("Altri fusi orari") }));
        for (const c of clocks) {
          let v = "";
          try {
            v = new Intl.DateTimeFormat(locale(), { hour: "2-digit", minute: "2-digit", weekday: "short", timeZone: c.opts?.tz }).format(now);
          } catch { v = "—"; }
          others.append(h("div", { class: "daily-row" },
            h("span", { class: "daily-main", text: (c.opts?.tz ?? "").split("/").pop()?.replace(/_/g, " ") ?? "" }),
            h("span", { class: "daily-side", text: v })));
        }
      }
      // Appointments from the user's calendar widgets (ICS links, calendar.rs).
      clear(events);
      const cals = (State.settings.widgets ?? []).filter((w) => w.kind === "calendar");
      const rows = cals.flatMap((w) => (State.widgetStatus[w.id]?.fields ?? []).map((f) => ({ f, w })));
      if (rows.length) {
        events.append(h("div", { class: "daily-h", text: t("Prossimi appuntamenti") }));
        for (const { f } of rows.slice(0, 5)) {
          events.append(h("div", { class: "daily-row" },
            h("span", { class: "daily-main", text: f.value }),
            h("span", { class: "daily-side", text: f.label })));
        }
      }
    };
    month = 0;
    draw();
    const date = new Date().toLocaleDateString(locale(), { weekday: "long", day: "numeric", month: "long" });
    return [
      head("clock", date.charAt(0).toUpperCase() + date.slice(1), time),
      nav,
      grid,
      others,
      events,
      windowsButtons(["calendar", t("Calendario di Windows")], ["datetime", t("Data e ora")]),
    ];
  }

  /** Submenus of the program's menu opened in the card, by their path («0.3»). */
  const opened = new Set<string>();

  /**
   * The window title's card (appmenu.rs, asked by Edoardo on 31 Oct 2026): the
   * program in front's own menu — its submenus open inside the card, a line
   * goes to the program — then the user's quick actions for that program.
   */
  function appMenu(): Node[] {
    const w = State.barWindow;
    const icon = w?.icon?.startsWith("data:image/png;base64,")
      ? h("img", { class: "appmenu-app", src: w.icon, alt: "" })
      : renderActionIcon("i:window", 16);
    const title = h("div", { class: "recap-head" },
      h("span", { class: "barcard-icon" }, icon),
      h("span", { class: "recap-title", text: w?.name || t("Programma in primo piano") }));
    const list = h("div", { class: "appmenu-list" });
    const mine = h("div", { class: "actions appmenu-actions" });
    let drawn: unknown = undefined;
    // «&File» → «File» («&&» is a real «&»); the shortcut after a tab, apart.
    const parts = (label: string) => {
      const [text, key = ""] = label.split("\t");
      return { text: text.replace(/&(&?)/g, "$1"), key: key.trim() };
    };
    const lines = (items: AppMenuLine[], path: string, depth: number) => {
      items.forEach((it, i) => {
        if (it.sep) {
          list.append(h("div", { class: "appmenu-sep" }));
          return;
        }
        const here = `${path}${i}`;
        const { text, key } = parts(it.label);
        const sub = it.items.length > 0;
        const open = sub && opened.has(here);
        const row = h("button", { class: `appmenu-row${it.enabled ? "" : " off"}`, disabled: !it.enabled },
          h("span", { class: "appmenu-check", text: it.checked ? "✓" : "" }),
          h("span", { class: "appmenu-text", text }),
          h("span", { class: "appmenu-key", text: sub ? (open ? "▾" : "▸") : key }));
        row.style.paddingLeft = `${8 + depth * 14}px`;
        row.addEventListener("click", () => {
          if (sub) {
            if (open) opened.delete(here);
            else opened.add(here);
            draw(true);
            State.notify(); // the island follows the card's new height
          } else if (it.line != null) {
            void Bridge.appMenuRun(it.line);
            actions.collapse();
          }
        });
        list.append(row);
        if (open) lines(it.items, `${here}.`, depth + 1);
      });
    };
    const draw = (force = false) => {
      if (!force && drawn === State.appMenu) return;
      drawn = State.appMenu;
      clear(list);
      const menu = State.appMenu;
      if (!menu) list.append(h("div", { class: "sub", text: t("Lettura del menu…") }));
      else if (!menu.length) list.append(h("div", { class: "sub", text: t("Nessun menu da leggere per questo programma") }));
      else lines(menu, "", 0);
      clear(mine);
      const exe = w?.exe ?? "";
      for (const a of exe ? (State.settings.actions ?? []).filter((x) => actionForApp(x, exe)) : []) {
        mine.append(h("button", { class: "btn secondary", title: a.name, onclick: () => { actions.collapse(); actions.runAction(a); } },
          h("span", { class: "bar-icon" }, renderActionIcon(a.icon, 14)), h("span", { text: a.name || t("Senza nome") })));
      }
      mine.style.display = mine.childElementCount ? "" : "none";
    };
    opened.clear();
    update = () => draw();
    return [title, list, mine];
  }

  const build = (kind: string): Node[] => {
    switch (kind) {
      case "appmenu": return appMenu();
      case "volume": case "mic": return sound(kind);
      case "brightness": return brightness();
      case "battery": return battery();
      case "net": return net();
      default: return clock();
    }
  };

  let minute = -1;
  return {
    el,
    sync() {
      const kind = State.barCard ?? "clock";
      // The program's menu: drawn again for another program.
      const key = kind === "appmenu" ? `appmenu:${State.barWindow?.exe ?? ""}:${State.barWindow?.name ?? ""}` : kind;
      if (key !== shown) {
        shown = key;
        card.style.setProperty("--wash", washRGBA(WASH[kind] ?? "indigo"));
        clear(body);
        body.append(...build(kind));
      }
      update();
    },
    // Only the clock card changes by itself: redrawn when the minute turns.
    tick() {
      if (shown !== "clock") return;
      const m = new Date().getMinutes();
      if (m !== minute) {
        minute = m;
        update();
      }
    },
    fitHeight: () => [...body.children].reduce((n, c) => n + (c as HTMLElement).offsetHeight, 0)
      + 7 * Math.max(0, body.children.length - 1) + 8 + 20,
  };
}
