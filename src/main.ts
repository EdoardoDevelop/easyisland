// Entry point: boot the bridge, wire the island, start the greeting.

import "./style.css";
import "./style-windows.css";
import "./style-light.css";
import "./character/roster";
import { Bridge, IS_TAURI, onEvent, type UpdateInfo } from "./core/bridge";
import { Sound } from "./core/sound";
import { State, barEdge, barThickness, type BarSys, type Custom, type NewsItem, type Settings } from "./core/state";
import { forgetRecords, receiveSource } from "./views/custom";
import { Island } from "./island/island";
import { installTooltips } from "./core/tooltip";
import { registerHookHandlers } from "./island/hooks";
import { Recap } from "./island/recap";
import { Daily } from "./island/daily";
import { registerMoments } from "./island/moments";
import { syncLanguage } from "./core/i18n";
import { registerIntegrationHandlers, refreshConfigured } from "./island/integrations";
import { linkChannel, type CharacterToIsland, type IslandToCharacter } from "./core/link";
import { barClockDelay, barPieces, barSysKinds, recordBarSys } from "./island/bar";

/**
 * Uncaught errors of the page go to easyisland.log (the WebView's console is
 * read by nobody on a PC), each at most once and no more than 30 in all.
 */
function logPageErrors() {
  const seen = new Set<string>();
  const report = (text: string) => {
    if (seen.has(text) || seen.size >= 30) return;
    seen.add(text);
    void Bridge.log(`errore nella pagina · ${text}`).catch(() => {});
  };
  window.addEventListener("error", (e) => report(`${e.message} (${e.filename}:${e.lineno})${e.error?.stack ? ` ${e.error.stack}` : ""}`));
  window.addEventListener("unhandledrejection", (e) => report(`promessa rifiutata: ${(e.reason as Error)?.stack ?? String(e.reason)}`));
}

async function main() {
  const root = document.getElementById("root");
  if (!root) return;
  logPageErrors();

  void Sound.preload();

  const island = new Island(root);
  installTooltips();

  const boot = await Bridge.boot();
  if (boot) {
    State.settings = { ...State.settings, ...boot.settings };
    // The language this page was built in must be the one chosen (once, at the first start).
    syncLanguage(State.settings.language);
  } else {
    // Plain browser (`npm run dev`): settings can be tried from the URL, e.g.
    // /?anchorV=bottom&anchorH=left&iconSize=32 (lists comma-separated, e.g.
    // ?activeIntegrations= for none). Claude Code's hooks count as installed
    // here, so its card is there; ?hooksInstalled=false shows a PC without them.
    State.settings.hooksInstalled = true;
    const params = new URLSearchParams(location.search);
    const overrides: Record<string, unknown> = {};
    for (const [key, value] of params) {
      if (!(key in State.settings)) continue;
      const current = (State.settings as unknown as Record<string, unknown>)[key];
      overrides[key] = typeof current === "number" ? Number(value)
        : typeof current === "boolean" ? value === "true"
        : Array.isArray(current) ? value.split(",").filter(Boolean) : value;
    }
    State.settings = { ...State.settings, ...overrides } as Settings;
    const who = params.get("character");
    if (who) State.settings.theme = { ...State.settings.theme, character: who };
    // ?ui=classic: the original look.
    if (params.get("ui") === "classic") State.settings.theme = { ...State.settings.theme, style: "classic" };
    // ?scheme=light: the light mode.
    const sch = params.get("scheme");
    if (sch === "light" || sch === "auto") State.settings.theme = { ...State.settings.theme, scheme: sch };

    // Frame the 720×320 "window" in the matching corner of the page.
    document.documentElement.classList.add("browser-preview");
    const s = State.settings;
    root.style.left = s.anchorH === "left" ? "0" : s.anchorH === "right" ? "auto" : "50%";
    root.style.right = s.anchorH === "right" ? "0" : "auto";
    root.style.transform = s.anchorH === "center" ? "translateX(-50%)" : "";
    root.style.top = s.anchorV === "top" ? "0" : "auto";
    root.style.bottom = s.anchorV === "bottom" ? "0" : "auto";
    const bg = params.get("bg");
    if (bg) document.documentElement.style.setProperty("--preview-bg", bg === "dark" ? "#1e1f22" : bg);
  }
  island.applySettings();
  // The user's own integrations (custom.rs), before the menu is built.
  State.customs = (await Bridge.customsList()) ?? State.customs;
  State.loadIntegrationTasks();

  await onEvent<{ x: number; y: number }>("cursor", ({ x, y }) => island.onCursor(x, y));

  /** Pause has to reach Rust too, or the pollers keep calling out. */
  const setPaused = (on: boolean) => {
    if (State.paused === on) return;
    State.paused = on;
    void Bridge.setPaused(on);
  };

  await onEvent<string>("tray", (what) => {
    switch (what) {
      case "settings":
        void Bridge.openSettingsWindow();
        break;
      case "open":
        setPaused(false);
        // Opened by the user (tray icon, EasyIsland started again from the taskbar).
        island.openFromTaskbar();
        break;
      case "close":
        // "Chiudi finestra" from the taskbar: as the island's own ✕.
        island.closeFromTaskbar();
        break;
      case "recap":
        setPaused(false);
        void Recap.open(island);
        break;
      case "daily":
        setPaused(false);
        void Daily.open(island);
        break;
      case "pause":
        setPaused(!State.paused);
        if (State.paused) island.fsm.forceHidden();
        else island.reveal();
        break;
      default:
        // The menu on the selected text (src/island/selection-menu.ts).
        if (what.startsWith("sel:")) island.pickSelectionMenu(what.slice(4));
        // «…» of the fixed bar: a click on an element that did not fit (src/character-window/main.ts).
        else if (what.startsWith("bar:")) island.barClick(what.slice(4));
        break;
    }
  });

  // A press outside an island come out of the fixed bar (island.rs cursor poll).
  await onEvent<null>("click-away", () => island.closePopover());

  await onEvent<null>("screen-changed", () => {
    void Bridge.reposition();
    void island.refreshLimits();
  });

  await onEvent<boolean>("fullscreen", (on) => island.setFullscreen(on));
  // «Notizie» (news.rs): the news kept, then each check's.
  await onEvent<NewsItem[]>("news", (items) => {
    State.news = items ?? [];
    State.notify();
  });
  void Bridge.newsTaste().then((taste) => {
    if (taste) State.newsTaste = taste;
  });
  void Bridge.newsItems().then((items) => {
    if (items) {
      State.news = items;
      State.notify();
    }
  });
  await onEvent<{ active: boolean; reason: string }>("presence", (p) => island.setPresence(p.active, p.reason));
  void Bridge.presenceState().then((why) => { if (why) island.setPresence(true, why); });

  await onEvent<string>("hotkey", (name) => void island.onHotkey(name));
  // An automation reached a quick action that needs the island (a script
  // asking for confirmation, a question to Claude).
  // A habit worth an automation: offered once, with Crea / Non ora / No, mai.
  await onEvent<{ fp: string; title: string; text: string; accept: string }>("habit-suggestion", (g) => {
    island.showNotice({ title: g.title, text: g.text, level: "info", url: "", suggestion: g.fp, suggestionAccept: g.accept });
  });
  await onEvent<string>("automation-action", (id) => {
    const a = (State.settings.actions ?? []).find((x) => x.id === id);
    if (a) void island.runAction(a);
  });
  // The program in front changed (context.rs): the bar of the app in use follows.
  await onEvent<{ exe: string; title: string }>("foreground", (fg) => {
    State.foreground = fg;
    State.notify();
  });
  // An automation's "Chiedi alla chat" step, with the trigger's data filled in.
  await onEvent<string>("automation-ask", (prompt) => island.askChat(prompt));
  // An integration of the user's made or changed (the chat's custom_create), or its records.
  await onEvent<Custom[]>("customs-changed", (list) => {
    State.customs = list;
    State.customVersion += 1;
    State.loadIntegrationTasks();
    State.notify();
  });
  // A source of an integration read by Rust (custom.rs spawn): data, line, alerts.
  await onEvent<{ id: string; source: string; at: string; reply?: { data: unknown; status: number }; error?: string }>("custom-source", (e) => {
    const c = State.customs.find((x) => x.id === e.id);
    if (!c) return;
    receiveSource(c, e.source, { at: e.at, data: (e.reply?.data ?? null) as never, status: e.reply?.status, error: e.error }, (n) => island.showNotice(n));
    State.customVersion += 1;
    State.notify();
  });
  await onEvent<{ id: string }>("custom-records", ({ id }) => {
    forgetRecords(id);
    State.customVersion += 1;
    State.notify();
  });
  // A task's permission answered on Telegram (tasks.rs decide): its card goes.
  await onEvent<string>("approval-cancel", (id) => {
    const req = State.pendingApproval;
    if (req && req.requestId === id) island.settleApproval(req);
  });
  await onEvent<UpdateInfo>("update-available", (u) => island.showUpdate(u.version, u.current));

  // The settings window writes preferences; apply them here without a restart.
  await onEvent<Settings>("settings-changed", (s) => {
    State.settings = { ...State.settings, ...s };
    island.applySettings();
    State.loadIntegrationTasks();
    void refreshConfigured();
  });

  registerHookHandlers(island);
  registerIntegrationHandlers(island);
  registerMoments({
    alert: (v) => island.alert(v),
    collapse: () => island.collapse(),
    holdOpen: (on) => island.setPinned(on),
  });

  linkCharacterWindow(island);
  island.launch();
  // Monday from 8:00: last week's recap, once the greeting is over.
  window.setTimeout(() => void Recap.check(island), 12_000);
  // The morning and end-of-day recap: after the weekly one, then at its hours.
  window.setTimeout(() => void Daily.check(island), 16_000);
  // Its hours come from Rust (giornata.rs), with the engine's summary after.
  await onEvent<string>("daily-due", () => void Daily.check(island));
  await onEvent<null>("daily-ai", () => void Daily.refreshAi());

  // In a plain browser there is no wake strip behind the cursor: make the whole
  // page wake the island so the visuals can be checked with `npm run dev`.
  if (!IS_TAURI) {
    document.addEventListener("click", () => Sound.resume(), { once: true });
    // Staged states for the README screenshots (dev server only).
    const scene = new URLSearchParams(location.search).get("scene");
    if (import.meta.env.DEV && scene) {
      void import("../dev/scenes").then((m) => m.runScene(island, scene));
    }
  }
}

/**
 * The character's own window (docs/due-webview.md, step 0): it gets the
 * character's look from here and asks back to open the island.
 */
function linkCharacterWindow(island: Island) {
  let sentKey = "";
  const look = (): IslandToCharacter => {
    const t = State.settings.theme;
    const c = t?.slimeColor;
    return {
      kind: "look",
      state: State.effectiveState,
      character: t?.character ?? "",
      figure: t?.figure ?? "",
      color: c && /^#[0-9a-f]{6}$/i.test(c) ? c : null,
      size: island.restIconSize,
      paused: State.paused,
      mode: island.characterMode,
      sky: State.characterSky,
      weather: State.weatherNow,
      agents: State.sessionTasks.filter((x) => x.state === "working" || x.state === "thinking" || x.state === "searching").length,
      bar: barEdge(State.settings)
        ? {
          slot: State.settings.fixedBarSlot ?? "center",
          edge: barEdge(State.settings) === "bottom" ? "bottom" : "top",
          ...barPaint(State.settings.fixedBarBackground ?? "", island.islandBackground, island.islandInk),
          thickness: barThickness(State.settings),
          items: barPieces(island.barStrip(), island.barAppBar()),
          look: State.settings.fixedBarLook ?? {},
        }
        : null,
    };
  };
  const send = linkChannel<CharacterToIsland, IslandToCharacter>((m) => {
    if (m.kind === "hello") {
      sentKey = "";
      push();
    } else if (m.kind === "bar") {
      island.barClick(m.key, m.button, m.x);
    } else if (m.kind === "open") {
      if (State.mode === "expanded") island.collapse();
      else island.openFromTaskbar();
    } else if (m.kind === "ping") {
      send({ kind: "pong", sent: m.sent });
    }
  });
  // The system elements of the bar: barsys.rs reads only those shown, and the
  // clock is redrawn at the turn of each minute (or second) while one is there.
  let watched = "";
  let tick: number | null = null;
  const watch = () => {
    const kinds = barSysKinds();
    const k = kinds.join(",");
    if (k !== watched) {
      watched = k;
      void Bridge.barSysWatch(kinds);
    }
    const delay = barClockDelay();
    if (delay === null) {
      if (tick !== null) window.clearTimeout(tick);
      tick = null;
    } else if (tick === null) {
      tick = window.setTimeout(() => {
        tick = null;
        push();
      }, delay);
    }
  };
  const push = () => {
    watch();
    const m = look();
    const key = JSON.stringify(m);
    if (key === sentKey) return;
    sentKey = key;
    send(m);
  };
  void onEvent<{ exe?: string; name?: string; title?: string; icon?: string }>("bar-window", (v) => {
    State.barWindow = v ?? null;
    push();
  });
  void onEvent<BarSys>("bar-sys", (v) => {
    State.barSys = v ?? {};
    recordBarSys(State.barSys);
    push();
  });
  State.subscribe(push);
  island.onRestChange = push;
  island.mirror = send;
  push();
}

/**
 * The fixed bar's background and text colour: the island's (""), none
 * ("transparent": the wallpaper shows, the island's text colour), or the
 * user's colour with dark or light text, whichever reads better on it.
 */
function barPaint(choice: string, islandBg: string, islandInk: string): { background: string; ink: string } {
  if (choice === "transparent") return { background: "transparent", ink: islandInk };
  const m = /^#([0-9a-f]{6})$/i.exec(choice);
  if (!m) return { background: islandBg, ink: islandInk };
  const n = parseInt(m[1], 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  const light = 0.2126 * r + 0.7152 * g + 0.0722 * b > 150;
  return { background: choice, ink: light ? "#16181d" : "#f5f6f8" };
}

void main();
