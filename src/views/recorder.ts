// The "Registra" card (src-tauri/src/record.rs): a conversation (microphone
// and/or the PC's sound, .m4a) or the screen under the mouse (.mp4, with that
// sound), until Stop. While it records the strip beside the closed character
// says so with Stop (`stripRecording`): never a recording without it showing.
// When it ends a card asks what to do with the file (moment "recording").

import { h, brandOrDot, clear } from "./dom";
import { State } from "../core/state";
import { Bridge } from "../core/bridge";
import { t } from "../core/i18n";
import { Sound } from "../core/sound";
import type { QuickReply } from "./threecx";
import type { ViewActions, ViewHost } from "./views";

export const RECORDER = "integration_recorder";
const COLOR = "#F4505E";

interface Live {
  kind: "audio" | "screen";
  /** The window recorded ("Excel — Budget.xlsx"), "" for the whole screen. */
  window?: string;
  mic: boolean;
  system: boolean;
  since: number;
  path: string;
}

interface RecorderData {
  recording?: boolean;
  live?: Live | null;
  error?: string | null;
  folder?: string;
}

function data(): RecorderData {
  return (State.integrations[RECORDER]?.data ?? {}) as RecorderData;
}

/** "01:23" or "1:02:03". */
export function elapsed(since: number, now = Date.now()): string {
  const s = Math.max(0, Math.floor((now - since) / 1000));
  const two = (n: number) => String(n).padStart(2, "0");
  const hh = Math.floor(s / 3600);
  return hh ? `${hh}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}` : `${two(Math.floor(s / 60))}:${two(s % 60)}`;
}

function what(l: Live): string {
  if (l.kind === "screen") return l.window ? t("Registro la finestra {w}", { w: l.window }) : t("Registro lo schermo");
  return l.mic && l.system ? t("Registro la conversazione") : l.mic ? t("Registro il microfono") : t("Registro l'audio del PC");
}

/** The line for the Panoramica. */
export function recorderLine(): string {
  const l = data().live;
  return l ? `${what(l)} · ${elapsed(l.since)}` : data().error ? data().error! : t("Pronto a registrare");
}

export function isRecording(): boolean {
  return !!data().live;
}

function stop() {
  Sound.play("blip");
  void Bridge.recordStop();
}

/** The strip while recording: what, for how long, and Stop. */
export function stripRecording(): { title: string; sub: string; buttons: QuickReply[] } | null {
  const l = data().live;
  if (!l) return null;
  return { title: `● ${elapsed(l.since)}`, sub: what(l), buttons: [{ label: t("Stop"), tone: "red", run: stop }] };
}

/** Starts one; the card says why not. */
export async function startRecording(kind: "audio" | "screen", say?: (m: string) => void) {
  const c = State.settings.integrationConfig;
  Sound.play("blip");
  try {
    await Bridge.recordStart({ kind, mic: c.recordMic !== false, system: c.recordSystem !== false, fps: c.recordFps || 15 });
  } catch (e) {
    say?.(String(e).replace(/^Error:\s*/, ""));
  }
}

export function recorderCard(openSettings: () => void): HTMLElement {
  const d = data();
  const c = State.settings.integrationConfig;
  const note = h("div", { class: "notion-note bad", style: d.error ? "" : "display:none", text: d.error ?? "" });
  const say = (m: string) => { note.textContent = m; note.style.display = m ? "" : "none"; };
  const save = () => void Bridge.saveSettings(State.settings);
  const chip = (label: string, on: boolean, set: (v: boolean) => void) => h("button", {
    class: on ? "rec-chip on" : "rec-chip", text: label,
    onclick: (e: Event) => { e.stopPropagation(); set(!on); save(); State.notify(); },
  });
  const body = h("div", { class: "rec-body" });
  const live = d.live;
  if (live) {
    body.append(
      h("div", { class: "rec-live" }, h("span", { class: "rec-dot" }), h("b", { class: "rec-time", text: elapsed(live.since) }), h("span", { text: what(live) })),
      h("div", { class: "rec-actions" }, h("button", { class: "teams-btn red", text: t("Stop"), onclick: (e: Event) => { e.stopPropagation(); stop(); } })),
    );
  } else {
    body.append(
      h("div", { class: "rec-actions" },
        h("button", { class: "teams-btn light rec-start", text: t("● Registra conversazione"),
          onclick: (e: Event) => { e.stopPropagation(); void startRecording("audio", say); } }),
        h("button", { class: "teams-btn plain rec-start", text: t("▣ Registra schermo"),
          onclick: (e: Event) => { e.stopPropagation(); void startRecording("screen", say); } })),
      h("div", { class: "rec-actions" },
        h("span", { class: "hint", text: t("Audio:") }),
        chip(t("Microfono"), c.recordMic !== false, (v) => { c.recordMic = v; }),
        chip(t("Audio del PC"), c.recordSystem !== false, (v) => { c.recordSystem = v; })),
      h("div", { class: "hint rec-hint", text: t("Avvisa chi è in chiamata prima di registrarlo. I file vanno in {f}; alla fine scegli se metterli nel Vassoio.", { f: d.folder || t("Video\\EasyIsland") }) }),
    );
  }
  body.append(note);
  // The time goes on between updates (which come only at start and stop).
  if (live) {
    const timer = window.setInterval(() => {
      const el = body.querySelector<HTMLElement>(".rec-time");
      if (!el || !el.isConnected || !isRecording()) { window.clearInterval(timer); return; }
      el.textContent = elapsed(live.since);
    }, 1000);
  }
  const head = h("div", { class: "int-head" }, brandOrDot(RECORDER, COLOR, 7), h("b", { text: t("Registra") }),
    h("span", { text: live ? t("In registrazione") : t("Fermo") }),
    h("button", { class: "link-btn", style: "color:#8e939c", text: t("Impostazioni…"), onclick: openSettings }));
  return h("div", { class: "int-card notion-card" }, head, body);
}

// ── In File e schermo ─────────────────────────────────────────────────────────


/**
 * The Registra panel of File e schermo: a conversation, the screen, or one
 * window. The window comes from a list or from the character let go on it
 * (island.ts `endWindowPick`); then "● Registra la finestra" or "Foto nel
 * Vassoio". While recording: the time and Stop.
 */
export function buildRecorderPanel(actions: ViewActions): ViewHost {
  const el = h("div", { class: "rec-panel" });
  let key = "";
  let windows: { id: number; appName: string; title: string }[] | null = null;
  let message = "";
  let timer = 0;
  const say = (m: string) => { message = m; key = ""; State.notify(); };
  const save = () => void Bridge.saveSettings(State.settings);
  const label = (w: { appName: string; title: string }) => (w.title && w.title !== w.appName ? `${w.appName} — ${w.title}` : w.appName || w.title);

  const chip = (text: string, on: boolean, set: (v: boolean) => void) => h("button", {
    class: on ? "rec-chip on" : "rec-chip", text,
    onclick: (e: Event) => { e.stopPropagation(); set(!on); save(); key = ""; State.notify(); },
  });
  const button = (text: string, cls: string, run: () => void, title = "") => h("button", {
    class: `teams-btn ${cls}`, text, title,
    onclick: (e: Event) => { e.stopPropagation(); run(); },
  });

  const recordWindow = (w: { id: number; appName: string; title: string }) => {
    const c = State.settings.integrationConfig;
    Sound.play("blip");
    void Bridge.recordStart({ kind: "screen", mic: c.recordMic !== false, system: c.recordSystem !== false, fps: c.recordFps || 15, window: w.id, label: label(w) })
      .then(() => { State.pickedWindow = null; message = ""; }, (e: unknown) => say(String(e).replace(/^Error:\s*/, "")));
  };
  const photo = (w: { id: number }) => {
    Sound.play("blip");
    void Bridge.windowShot(w.id).then(() => { State.pickedWindow = null; message = ""; actions.refreshFiles(); },
      (e: unknown) => say(String(e).replace(/^Error:\s*/, "")));
  };

  function draw() {
    const d = data();
    const c = State.settings.integrationConfig;
    const live = d.live;
    clear(el);
    window.clearInterval(timer);
    const head = h("div", { class: "rec-panel-head" }, h("span", { class: live ? "rec-dot" : "rec-dot off" }), h("b", { text: t("Registra") }));
    el.append(head);
    if (live) {
      const time = h("b", { class: "rec-time", text: elapsed(live.since) });
      el.append(h("div", { class: "rec-live" }, time,
        h("span", { class: "rec-what", text: what(live) }),
        button(t("Stop"), "red", stop)));
      timer = window.setInterval(() => {
        if (!time.isConnected || !isRecording()) { window.clearInterval(timer); return; }
        time.textContent = elapsed(live.since);
      }, 1000);
      return;
    }
    head.append(
      h("span", { class: "rec-spacer" }),
      chip(t("Microfono"), c.recordMic !== false, (v) => { c.recordMic = v; }),
      chip(t("Audio del PC"), c.recordSystem !== false, (v) => { c.recordSystem = v; }));
    el.append(h("div", { class: "rec-actions" },
      button(t("● Conversazione"), "light rec-start", () => void startRecording("audio", say), t("Microfono e audio del PC, in .m4a")),
      button(t("▣ Schermo"), "plain", () => void startRecording("screen", say), t("Lo schermo dove c'è il mouse, in .mp4")),
      button(windows ? t("Chiudi l'elenco") : t("▢ Una finestra…"), "plain", () => {
        if (windows) { windows = null; key = ""; State.notify(); return; }
        void Bridge.recordWindows().then((list) => { windows = list; key = ""; State.notify(); });
      }, t("Scegli una finestra da registrare o fotografare"))));
    if (windows) {
      const box = h("div", { class: "rec-windows" });
      for (const w of windows) {
        box.append(h("button", { class: "rec-window", text: label(w), title: label(w),
          onclick: (e: Event) => { e.stopPropagation(); State.pickedWindow = w; windows = null; key = ""; State.notify(); } }));
      }
      if (!windows.length) box.append(h("div", { class: "hint", text: t("Nessuna finestra da registrare") }));
      el.append(box);
    }
    const w = State.pickedWindow;
    if (w) {
      el.append(h("div", { class: "rec-picked" },
        h("span", { class: "rec-picked-name", text: label(w), title: label(w) }),
        button(t("● Registra la finestra"), "light rec-start", () => recordWindow(w)),
        button(t("Foto nel Vassoio"), "plain", () => photo(w)),
        button("✕", "plain rec-x", () => { State.pickedWindow = null; key = ""; State.notify(); }, t("Lascia stare"))));
    } else {
      el.append(h("div", { class: "hint rec-hint", text: t("Trascina il personaggio su una finestra per sceglierla. Avvisa chi è in chiamata prima di registrarlo.") }));
    }
    if (message || d.error) el.append(h("div", { class: "notion-note bad", text: message || d.error || "" }));
  }

  return {
    el,
    sync() {
      const d = data();
      const c = State.settings.integrationConfig;
      el.style.display = State.settings.activeIntegrations.includes(RECORDER) ? "" : "none";
      const k = JSON.stringify([d.live, d.error, State.pickedWindow, windows, message, c.recordMic, c.recordSystem]);
      if (k === key) return;
      key = k;
      draw();
    },
  };
}
