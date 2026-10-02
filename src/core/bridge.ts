// Thin wrapper over the Tauri commands/events. Every call is a no-op when the
// page is opened in a plain browser, so the island can be iterated on with
// `npm run dev` alone.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Settings } from "./state";

export const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!IS_TAURI) return null;
  try {
    return await invoke<T>(cmd, args);
  } catch (err) {
    console.error(`[easyisland] ${cmd} failed`, err);
    return null;
  }
}

export interface BootInfo {
  settings: Settings;
  /** Logical screen rect of the monitor the island lives on. */
  screen: { x: number; y: number; width: number; height: number; scale: number };
  version: string;
  hookPath: string;
}

/** A newer EasyIsland on GitHub. */
export interface UpdateInfo {
  version: string;
  current: string;
  notes: string;
}

export interface ClaudeCliStatus {
  found: boolean;
  path: string;
  loggedIn: boolean;
}

export const Bridge = {
  boot: () => call<BootInfo>("boot"),

  saveSettings: (settings: Settings) => call<void>("save_settings", { settings }),

  /** Shrink the window down to the invisible wake strip (hidden) or back to full. */
  setCollapsed: (collapsed: boolean, width?: number, height?: number) =>
    call<void>("set_collapsed", { collapsed, width, height }),

  /**
   * Pushes the island shape in window coordinates. Rust flips click-through from
   * its own cursor poll, so the flag is never a frame behind a click.
   */
  setIslandRect: (x: number, y: number, width: number, height: number) =>
    call<void>("set_island_rect", { x, y, width, height }),

  /** Give the window keyboard focus (chat field) and take it away again. */
  focusWindow: (focused: boolean) => call<void>("focus_window", { focused }),

  reposition: () => call<void>("reposition"),

  /** "Copia info PC": the text it put on the clipboard. */
  copyPcInfo: () => callOrThrow<string>("copy_pc_info"),
  /** "Davanti al cliente" right now: why, or null. */
  presenceState: () => call<string | null>("presence_state"),
  /** "Prova" for messages from scripts. */
  notifyTest: () => callOrThrow<void>("notify_test"),

  /** Moves the window while the character is dragged; `endDrag` saves where it was left. */
  dragIsland: (dx: number, dy: number) => call<void>("drag_island", { dx, dy }),
  endDrag: () => call<void>("end_drag"),

  openUrl: (url: string) => call<void>("open_url", { url }),

  /** "Open terminal" → opens the folder in VS Code when `code` is on PATH. */
  openInVSCode: (path: string | null) => call<boolean>("open_in_vscode", { path }),
  /** The newer version on GitHub, or null (throws when the check fails). */
  updateCheck: () => callOrThrow<UpdateInfo | null>("update_check"),
  /** Downloads, verifies and runs the new installer; the app closes and restarts. */
  updateInstall: () => callOrThrow<void>("update_install"),
  /** Brings back the app a Claude Code session runs in (Claude, VS Code, a terminal). */
  openSession: (host: string | null, path: string | null) => call<string>("open_session", { host, path }),

  quit: () => call<void>("quit_app"),

  openSettingsWindow: () => call<void>("open_settings_window"),

  /** Writes to %LOCALAPPDATA%\EasyIsland\easyisland.log, next to the Rust lines. */
  log: (message: string) => call<void>("log_line", { message }),

  // ── Claude Code hooks ─────────────────────────────────────────────────────
  hooksStatus: () => call<HookStatus>("hooks_status"),
  /** Diff to show before anything is written. `install: false` previews removal. */
  hooksPreview: (install: boolean) => callOrThrow<HookPreview>("hooks_preview", { install }),
  /**
   * Writes ~/.claude/settings.json — only ever after an explicit click, and only
   * when the file still matches the preview the user looked at.
   */
  hooksApply: (install: boolean, fingerprint: string) =>
    callOrThrow<string>("hooks_apply", { install, fingerprint }),

  approvalDecision: (requestId: string, decision: "allow" | "deny") =>
    call<void>("approval_decision", { requestId, decision }),
  /** "The card is up" — until this lands the relay only waits a moment. */
  approvalAck: (requestId: string) => call<void>("approval_ack", { requestId }),

  /** Answers to an AskUserQuestion: question text → chosen label(s). */
  approvalAnswers: (requestId: string, answers: Record<string, string>) =>
    call<void>("approval_answers", { requestId, answers }),
  /** "Nobody can act on this" — Claude Code asks in the terminal right away. */
  approvalDecline: (requestId: string) => call<void>("approval_decline", { requestId }),

  // ── Chat, files, secrets ──────────────────────────────────────────────────
  /** One chat turn. The API key and any file bytes never leave Rust. */
  chatSend: (query: string, context: ChatContext | null) =>
    callOrThrow<{ text: string }>("chat_send", { query, context }),
  chatReset: () => call<void>("chat_reset"),
  /** Quick actions. */
  actionOpenApp: (target: string, args: string) => callOrThrow<void>("action_open_app", { target, args }),
  actionRunScript: (runId: string, shell: string, script: string) =>
    callOrThrow<{ code: number | null; output: string; timedOut: boolean }>(
      "action_run_script", { runId, shell, script },
    ),
  actionKill: (runId: string) => call<void>("action_kill", { runId }),
  clipboardText: () => call<string | null>("clipboard_text"),
  hotkeyFailures: () => call<string[]>("hotkey_failures"),
  /** Widgets. */
  widgetTest: (widget: unknown) =>
    callOrThrow<{ id: string; level: string; summary: string; fields: { label: string; value: string }[]; at: number }>(
      "widget_test", { widget },
    ),
  widgetRefresh: (id: string) => call<void>("widget_refresh", { id }),
  /** Profiles, backup. */
  switchProfile: (id: string) => call<void>("switch_profile", { id }),
  settingsExport: () => callOrThrow<string>("settings_export"),
  settingsImport: (text: string) => callOrThrow<Settings>("settings_import", { text }),
  currentNetwork: () => call<string | null>("current_network"),
  /** Settings window: MCP servers configured in Claude Code (names only). */
  mcpServersConfigured: () => call<string[]>("mcp_servers_configured"),
  /** Settings window: is Claude Code installed and signed in? */
  claudeCliStatus: () => call<ClaudeCliStatus>("claude_cli_status"),
  /** Copies a dropped file into the inbox. */
  ingestFile: (path: string) => callOrThrow<DroppedFile>("ingest_file", { path }),
  /** Only ever tells you whether a key exists — never its value. */
  secretPresent: (key: string) => call<boolean>("secret_present", { key }),
  secretSet: (key: string, value: string) => callOrThrow<void>("secret_set", { key, value }),
  secretClear: (key: string) => callOrThrow<void>("secret_clear", { key }),

  // ── Integrations ──────────────────────────────────────────────────────────
  refreshIntegration: (id: string) => call<void>("refresh_integration", { id }),
  /** Opens the configured n8n instance in the browser. */
  openN8n: () => call<void>("open_n8n"),

  /** Tray → Pause. Stops the integration pollers, not just the island. */
  setPaused: (paused: boolean) => call<void>("set_paused", { paused }),
};

export interface IntegrationUpdate {
  id: string;
  data: Record<string, unknown>;
  error: string | null;
  event: { success: boolean; label: string; detail: string | null } | null;
}

export type ChatContext =
  | { kind: "file"; name: string; path: string }
  | { kind: "text"; label: string; text: string }
  | { kind: "window"; appName: string; title: string; url?: string };

export interface DroppedFile {
  name: string;
  path: string;
  size: number;
}

export interface HookStatus {
  installed: boolean;
  /** settings.json still runs the relay of the old version (Coucou). */
  legacy: boolean;
  settingsPath: string;
  hookPath: string;
  hookReady: boolean;
}

export interface HookPreview {
  diff: string;
  backup: string;
  settingsPath: string;
  /** Hand back to hooksApply so only the reviewed diff is ever written. */
  fingerprint: string;
}

/** Same as `call`, but surfaces the error so the UI can show what went wrong. */
async function callOrThrow<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!IS_TAURI) throw new Error("not running inside EasyIsland");
  return invoke<T>(cmd, args);
}

export type BridgeEvent =
  | { name: "cursor"; payload: { x: number; y: number } }
  | { name: "tray"; payload: string }
  | { name: "hook"; payload: Record<string, unknown> }
  | { name: "screen-changed"; payload: null };

export interface DragDropPayload {
  type: "enter" | "over" | "drop" | "leave";
  paths?: string[];
}

/**
 * Files dragged onto the island. Only reaches us when the window takes the mouse.
 *
 * The page takes the drop itself (HTML5): Tauri's native drop target is never
 * reached on current WebView2 runtimes. A `File` has no path in the page, so
 * the files go back to Rust with postMessageWithAdditionalObjects, and Rust
 * answers with `file-drop` and their real paths (src-tauri/src/drop.rs).
 */
export async function onDragDrop(handler: (e: DragDropPayload) => void) {
  if (!IS_TAURI) return () => {};
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  // dragenter/dragleave fire for every element crossed: count them.
  let depth = 0;
  window.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (depth++ === 0) handler({ type: "enter" });
  });
  window.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    handler({ type: "over" });
  });
  window.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    if (--depth <= 0) {
      depth = 0;
      handler({ type: "leave" });
    }
  });
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    const files = Array.from(e.dataTransfer?.files ?? []);
    const webview = (window as unknown as {
      chrome?: { webview?: { postMessageWithAdditionalObjects?: (m: unknown, o: File[]) => void } };
    }).chrome?.webview;
    if (!files.length || !webview?.postMessageWithAdditionalObjects) {
      handler({ type: "drop", paths: [] });
      return;
    }
    // A string: Tauri's own handler sees every message first and, on anything
    // else, fails in a way that stops WebView2 from calling ours.
    try {
      webview.postMessageWithAdditionalObjects("easyisland-drop", files);
    } catch (err) {
      void Bridge.log(`drop: could not hand the files over: ${err}`);
      handler({ type: "drop", paths: [] });
    }
  });
  return listen<string[]>("file-drop", (ev) => handler({ type: "drop", paths: ev.payload }));
}

export async function onEvent<T>(name: string, handler: (payload: T) => void) {
  if (!IS_TAURI) return () => {};
  return listen<T>(name, (e) => handler(e.payload));
}
