// The Meteo card: on top the sky as it is now, moving (character/weather.ts
// `drawSkyScene`) and fading out downwards, with the temperature over it; then
// humidity, wind, rain, sunrise and sunset, the next 12 hours and the next 7
// days. The data is the probe's `forecast` (src-tauri/src/probes.rs
// `forecast_of`); without it (an older reading) the card waits for the next.
// The sky is drawn only while the card is on screen in the open island.

import { h } from "./dom";
import { State, type AgentTask } from "../core/state";
import { Bridge } from "../core/bridge";
import { locale, t } from "../core/i18n";
import { drawSkyIcon, drawSkyScene, isSky, type Sky } from "../character/weather";
import { timeAgo } from "./integrations";

interface Hour { hour: string; temp: number | null; sky: string | null; rain: number | null }
interface Day { date: string; max: number | null; min: number | null; sky: string | null; text: string; rain: number | null }
export interface Forecast {
  place: string;
  temp: number | null;
  feels: number | null;
  humidity: number | null;
  wind: number | null;
  windDir: number | null;
  day: boolean;
  sky: string | null;
  text: string;
  sunrise: string | null;
  sunset: string | null;
  uv: number | null;
  hourly: Hour[];
  daily: Day[];
}

/** The sky's height, px: the card's top, under the temperature. */
const SKY_H = 150;
/** At most this many frames a second: a sky has no need of more. */
const FPS = 30;

const deg = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v)}°`);

/** A small canvas with the icon of `sky` (nothing when there is none). */
function skyIcon(sky: string | null, size: number): HTMLElement {
  const c = document.createElement("canvas");
  c.className = "wx-icon";
  c.style.width = `${size}px`;
  c.style.height = `${size}px`;
  if (!isSky(sky)) return c;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  c.width = Math.round(size * dpr);
  c.height = Math.round(size * dpr);
  const x = c.getContext("2d");
  if (x) {
    x.scale(dpr, dpr);
    drawSkyIcon(x, sky, size);
  }
  return c;
}

/**
 * Draws the sky on `canvas` frame after frame while it is in the page and the
 * island is open; stopped otherwise (no frames with the island closed), and
 * started again by the next change of state that opens it.
 */
function animateSky(canvas: HTMLCanvasElement, sky: Sky, day: boolean) {
  let raf = 0;
  let last = 0;
  const live = () => canvas.isConnected && State.mode === "expanded" && !document.hidden;
  const frame = (now: number) => {
    raf = 0;
    if (!live()) return;
    raf = requestAnimationFrame(frame);
    if (now - last < 1000 / FPS - 2) return;
    last = now;
    const w = canvas.clientWidth;
    const hh = canvas.clientHeight;
    if (!w || !hh) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(hh * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(hh * dpr);
    }
    const x = canvas.getContext("2d");
    if (!x) return;
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawSkyScene(x, sky, day, w, hh, now / 1000);
  };
  const unsubscribe = State.subscribe(() => {
    if (!canvas.isConnected) unsubscribe();
    else if (!raf && live()) raf = requestAnimationFrame(frame);
  });
  raf = requestAnimationFrame(frame);
}

/** "Oggi", "Domani", then the weekday's short name. */
function dayName(date: string, i: number): string {
  if (i === 0) return t("Oggi");
  if (i === 1) return t("Domani");
  const d = new Date(`${date}T12:00`);
  return Number.isNaN(d.getTime()) ? date : d.toLocaleDateString(locale(), { weekday: "short" });
}

/** One fact under the sky: its label and its value. */
function chip(label: string, value: string | Node): HTMLElement {
  return h("div", { class: "wx-chip" }, h("span", { class: "wx-chip-l", text: label }), h("span", { class: "wx-chip-v" }, value));
}

export function weatherCard(task: AgentTask, openSettings: () => void): HTMLElement | null {
  const st = State.widgetStatus[task.id];
  const f = st?.forecast as Forecast | undefined;
  if (!st || !f || st.level === "error") return null;
  const sky: Sky = isSky(f.sky) ? f.sky : "cloud";

  const canvas = document.createElement("canvas");
  canvas.className = "wx-sky";
  canvas.style.height = `${SKY_H}px`;
  animateSky(canvas, sky, f.day);

  const today = f.daily[0];
  const hero = h("div", { class: "wx-hero" },
    h("div", { class: "wx-place" }, h("b", { text: f.place }), h("span", { class: "wx-ago", text: timeAgo(st.at * 1000) })),
    h("div", { class: "wx-now" },
      h("span", { class: "wx-temp", text: deg(f.temp) }),
      h("div", { class: "wx-desc" },
        h("span", { class: "wx-text", text: f.text }),
        h("span", { class: "wx-sub", text: [
          f.feels != null ? `${t("Percepita")} ${deg(f.feels)}` : "",
          today ? `↑ ${deg(today.max)}  ↓ ${deg(today.min)}` : "",
        ].filter(Boolean).join(" · ") }))));

  // The rain field of the old card: this hour and the next three.
  const soon = Math.max(0, ...f.hourly.slice(0, 4).map((x) => x.rain ?? 0));
  const arrow = h("span", { class: "wx-arrow", text: "↑" });
  // Where the wind goes (it is given as where it comes from).
  if (f.windDir != null) arrow.style.transform = `rotate(${Math.round(f.windDir + 180)}deg)`;
  const chips = h("div", { class: "wx-chips" },
    chip(t("Pioggia"), `${soon}%`),
    f.humidity != null ? chip(t("Umidità"), `${f.humidity}%`) : null,
    f.wind != null ? chip(t("Vento"), h("span", {}, f.windDir != null ? arrow : null, `${Math.round(f.wind)} km/h`)) : null,
    f.sunrise ? chip(t("Alba"), f.sunrise) : null,
    f.sunset ? chip(t("Tramonto"), f.sunset) : null,
    f.uv != null ? chip("UV", String(Math.round(f.uv))) : null);

  const hours = h("div", { class: "wx-hours" }, ...f.hourly.map((x, i) =>
    h("div", { class: "wx-hour" },
      h("span", { class: "wx-h", text: i === 0 ? t("Ora") : x.hour }),
      skyIcon(x.sky, 22),
      h("span", { class: "wx-t", text: deg(x.temp) }),
      h("span", { class: "wx-r", text: (x.rain ?? 0) >= 20 ? `${x.rain}%` : "" }))));

  // More hours than room: the wheel scrolls them sideways.
  hours.addEventListener("wheel", (e) => {
    if (hours.scrollWidth <= hours.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    e.preventDefault();
    hours.scrollLeft += e.deltaY;
  }, { passive: false });

  // The week's bars on one scale, from its lowest to its highest.
  const lows = f.daily.map((d) => d.min).filter((v): v is number => v != null);
  const highs = f.daily.map((d) => d.max).filter((v): v is number => v != null);
  const lo = lows.length ? Math.min(...lows) : 0;
  const hi = highs.length ? Math.max(...highs) : 1;
  const span = Math.max(1, hi - lo);
  const days = h("div", { class: "wx-days" }, ...f.daily.map((d, i) => {
    const bar = h("i", { class: "wx-bar-fill" });
    if (d.min != null && d.max != null) {
      bar.style.left = `${((d.min - lo) / span) * 100}%`;
      bar.style.width = `${Math.max(4, ((d.max - d.min) / span) * 100)}%`;
    }
    return h("div", { class: "wx-day", title: d.text },
      h("span", { class: "wx-dn", text: dayName(d.date, i) }),
      skyIcon(d.sky, 20),
      h("span", { class: "wx-r", text: (d.rain ?? 0) >= 20 ? `${d.rain}%` : "" }),
      h("span", { class: "wx-lo", text: deg(d.min) }),
      h("span", { class: "wx-bar" }, bar),
      h("span", { class: "wx-hi", text: deg(d.max) }));
  }));

  return h("div", { class: "int-card weather-card" },
    canvas,
    hero,
    chips,
    h("div", { class: "wx-label", text: t("Prossime ore") }),
    hours,
    h("div", { class: "wx-label", text: t("Prossimi giorni") }),
    days,
    h("div", { class: "int-actions" },
      h("button", { class: "link-btn", style: `color:${task.color}d9`, text: t("Aggiorna"), onclick: () => void Bridge.widgetRefresh(task.id) }),
      h("button", { class: "link-btn", style: "color:#8e939c", text: t("Impostazioni…"), onclick: openSettings })));
}
