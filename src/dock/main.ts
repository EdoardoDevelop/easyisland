// Dedicated Dock WebView entry point (dock.html, docs/piano-dock.md).
// Receives visual snapshot & widget pieces from the island via BroadcastChannel,
// and live windows/icons/coverage directly from Rust events & commands.

import "./dock.css";
import { Bridge, IS_TAURI, onEvent, type DockWin, type DockWindowDiff } from "../core/bridge";
import { addFaces } from "../core/fonts";
import { dockChannel, type DockSnapshot, type DockToIsland, type IslandToDock } from "../core/link";
import { syncLanguage, t } from "../core/i18n";
import { DEFAULT_SETTINGS, type Settings } from "../core/state";
import { DockView } from "./view";

async function main() {
  const root = document.getElementById("dock-root");
  if (!root) return;

  const boot = await Bridge.boot();
  if (boot?.settings) syncLanguage(boot.settings.language);

  const initial: DockSnapshot = {
    background: boot?.settings.dockBackground ?? "",
    ink: "#f5f6f8",
    items: [],
    look: boot?.settings.dockLook ?? {},
    pinned: boot?.settings.dockPinned ?? [],
    font: null,
    scheme: boot?.settings.theme.scheme === "light" ? "light" : "dark",
    style: (boot?.settings.theme.style as DockSnapshot["style"]) ?? "windows",
    accent: "#4cc2ff",
    animations: (boot?.settings.animations as DockSnapshot["animations"]) ?? "ricche",
    reduceTransparency: false,
  };

  let windows: DockWin[] = [];
  let settings = boot?.settings ?? { ...DEFAULT_SETTINGS };

  const sendToIsland = dockChannel<IslandToDock, DockToIsland>((msg) => {
    if (msg.kind === "dock-look") {
      if (msg.snap.font) addFaces(document);
      view.setSnapshot(msg.snap);
    } else if (msg.kind === "dock-windows") {
      windows = msg.windows;
      view.setWindows(windows);
    } else if (msg.kind === "dock-icons") {
      view.setIcons(msg.icons);
    }
  });

  const view = new DockView(root, {
    onAction: (what, opts) => {
      void Bridge.dockDo(what, opts);
    },
    onWidgetClick: (key, button, x) => {
      sendToIsland({ kind: "bar", key, button, x });
    },
    onPinReorder: (pinned) => {
      settings = { ...settings, dockPinned: pinned };
      void Bridge.saveSettings(settings);
    },
    onPinToggle: (entry, pin) => {
      const current = [...(settings.dockPinned ?? [])];
      const next = pin
        ? [...current.filter((p) => p.id !== entry.id), { id: entry.id, name: entry.name, aumid: entry.aumid, path: entry.path }]
        : current.filter((p) => p.id !== entry.id);
      settings = { ...settings, dockPinned: next };
      void Bridge.saveSettings(settings);
    },
    onThumbsChange: (rects) => {
      void Bridge.dockThumbs(rects);
    },
    onOpenIsland: () => sendToIsland({ kind: "open" }),
    onOpenSettings: () => {
      sendToIsland({ kind: "settings" });
    },
    onFilesDrop: (_app, files) => {
      for (const path of files) void Bridge.ingestFile(path).catch(() => {});
    },
  }, initial);

  document.title = t("Dock — EasyIsland");
  if (IS_TAURI) {
    const initialWins = await Bridge.dockWindows();
    if (initialWins) {
      windows = initialWins;
      view.setWindows(windows);
    }
    await onEvent<DockWindowDiff>("dock-windows", (diff) => {
      const byHwnd = new Map(windows.map((w) => [w.hwnd, w]));
      for (const hwnd of diff.remove ?? []) byHwnd.delete(hwnd);
      for (const w of diff.add ?? []) byHwnd.set(w.hwnd, w);
      for (const w of diff.change ?? []) byHwnd.set(w.hwnd, w);
      windows = [...byHwnd.values()];
      view.setWindows(windows);
    });
    await onEvent<Record<string, string>>("dock-icons", (icons) => {
      view.setIcons(icons);
    });
    await onEvent<boolean>("dock-covered", (covered) => {
      view.setCovered(covered);
    });
    await onEvent<Settings>("settings-changed", (next) => {
      settings = { ...settings, ...next };
    });
  }

  sendToIsland({ kind: "hello" });
}

void main();
