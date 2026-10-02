// Entry point: boot the bridge, wire the island, start the greeting.

import "./style.css";
import { Bridge, IS_TAURI, onEvent } from "./core/bridge";
import { Sound } from "./core/sound";
import { State, type Settings } from "./core/state";
import { Island } from "./island/island";
import { registerHookHandlers } from "./island/hooks";
import { registerIntegrationHandlers, refreshConfigured } from "./island/integrations";

async function main() {
  const root = document.getElementById("root");
  if (!root) return;

  void Sound.preload();

  const island = new Island(root);

  const boot = await Bridge.boot();
  if (boot) {
    State.settings = { ...State.settings, ...boot.settings };
  } else {
    // Plain browser (`npm run dev`): settings can be tried from the URL, e.g.
    // /?anchorV=bottom&anchorH=left&iconSize=32 (lists comma-separated, e.g.
    // ?activeIntegrations= for none)
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
    if (who) State.settings.theme = { ...State.settings.theme, character: who === "cube" ? "cube" : "mochi" };

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
        setPaused(false);
        island.alert("settings");
        break;
      case "open":
        setPaused(false);
        island.alert(State.defaultView());
        break;
      case "pause":
        setPaused(!State.paused);
        if (State.paused) island.fsm.forceHidden();
        else island.reveal();
        break;
    }
  });

  await onEvent<null>("screen-changed", () => void Bridge.reposition());

  await onEvent<boolean>("fullscreen", (on) => island.setFullscreen(on));

  await onEvent<string>("hotkey", (name) => void island.onHotkey(name));

  // The settings window writes preferences; apply them here without a restart.
  await onEvent<Settings>("settings-changed", (s) => {
    State.settings = { ...State.settings, ...s };
    island.applySettings();
    State.loadIntegrationTasks();
    void refreshConfigured();
  });

  registerHookHandlers(island);
  registerIntegrationHandlers(island);

  island.launch();

  // In a plain browser there is no wake strip behind the cursor: make the whole
  // page wake the island so the visuals can be checked with `npm run dev`.
  if (!IS_TAURI) {
    document.addEventListener("click", () => Sound.resume(), { once: true });
  }
}

void main();
