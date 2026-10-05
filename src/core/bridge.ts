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
  /** "cli" (installed on its own), "vscode" (the VS Code extension's copy), "desktop" (the Claude app's). */
  source?: string;
}

export const Bridge = {
  boot: () => call<BootInfo>("boot"),

  saveSettings: (settings: Settings) => call<void>("save_settings", { settings }),

  /** Shrink the window down to the invisible wake strip (hidden) or back to full. */
  /** Open or closed: closing takes a dragged open island back to the character's place. */
  setExpanded: (expanded: boolean) => call<void>("set_expanded", { expanded }),
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
  /** `code -g file:line`, for the diff view's ↗. */
  openFileInVSCode: (file: string, line: number) => call<boolean>("open_file_in_vscode", { file, line }),
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
  /** `agent`: "codex" or "gemini" for their hooks; absent = Claude Code. */
  hooksStatus: (agent?: string) => call<HookStatus>("hooks_status", { agent: agent ?? null }),
  /** Diff to show before anything is written. `install: false` previews removal. */
  hooksPreview: (install: boolean, agent?: string) =>
    callOrThrow<HookPreview>("hooks_preview", { install, agent: agent ?? null }),
  /**
   * Writes ~/.claude/settings.json — only ever after an explicit click, and only
   * when the file still matches the preview the user looked at.
   */
  hooksApply: (install: boolean, fingerprint: string, agent?: string) =>
    callOrThrow<string>("hooks_apply", { install, fingerprint, agent: agent ?? null }),

  approvalDecision: (requestId: string, decision: "allow" | "deny" | "always") =>
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
  /** Model ids an OpenAI-compatible engine offers (Impostazioni → Chat). */
  chatModels: (engine: string, url: string | null) => callOrThrow<string[]>("chat_models", { engine, url }),
  chatReset: () => call<void>("chat_reset"),
  /** Quick actions. */
  actionOpenApp: (target: string, args: string) => callOrThrow<void>("action_open_app", { target, args }),
  actionRunScript: (runId: string, shell: string, script: string) =>
    callOrThrow<{ code: number | null; output: string; timedOut: boolean }>(
      "action_run_script", { runId, shell, script },
    ),
  actionKill: (runId: string) => call<void>("action_kill", { runId }),
  clipboardText: () => call<string | null>("clipboard_text"),
  /** Appunti: copy an entry back (transformed: "", upper, lower, oneline, trim, json, urldecode) and paste it. */
  clipboardUse: (id: number, transform: string, paste: boolean) =>
    callOrThrow<void>("clipboard_use", { id, transform, paste }),
  clipboardPin: (id: number, pinned: boolean) => call<void>("clipboard_pin", { id, pinned }),
  /** A picture of the history saved in the inbox, to ask Claude about it. */
  clipboardAsk: (id: number) => callOrThrow<DroppedFile>("clipboard_ask", { id }),
  /** The picture on the clipboard (when there is no text) saved in the inbox. */
  clipboardPicture: () => call<DroppedFile | null>("clipboard_picture"),
  clipboardRemove: (id: number) => call<void>("clipboard_remove", { id }),
  clipboardClear: () => call<void>("clipboard_clear"),
  /** The app in front, and the text selected in it (⚡ suggestions). */
  foregroundApp: () => call<{ exe: string; title: string } | null>("foreground_app"),
  captureSelection: () => call<string | null>("capture_selection"),
  /** Proposals from the habits (habits.rs). */
  habitsStats: () => call<{ events: number; days: number; since: number | null }>("habits_stats"),
  habitsSuggestions: () => call<import("./state").HabitSuggestion[]>("habits_suggestions"),
  habitAnswer: (fp: string, choice: "create" | "snooze" | "dismiss" | "restore") =>
    callOrThrow<string>("habit_answer", { fp, choice }),
  habitsClear: () => call<void>("habits_clear"),
  habitNoteQuick: (id: string) => call<void>("habit_note_quick", { id }),
  /** Impostazioni → Automazioni: the last runs and "Prova ora". */
  automationsLog: () => call<{ at: number; name: string; cause: string; ok: boolean; detail: string }[]>("automations_log"),
  automationRunNow: (id: string) => callOrThrow<void>("automation_run_now", { id }),
  /** "File caricati": the copies of dropped files kept in the inbox. */
  inboxList: () => call<{ name: string; path: string; size: number; at: number }[]>("inbox_list"),
  inboxDelete: (name: string) => callOrThrow<void>("inbox_delete", { name }),
  inboxClear: () => call<number>("inbox_clear"),
  inboxOpen: (name: string, reveal: boolean) => callOrThrow<void>("inbox_open", { name, reveal }),
  /** "Estrai…" on a dropped ZIP. `place`: "beside" | "downloads" | "desktop". */
  zipList: (path: string) => callOrThrow<{ count: number; size: number; names: string[] }>("zip_list", { path }),
  zipExtract: (path: string, name: string, place: string, source: string | null) =>
    callOrThrow<string>("zip_extract", { path, name, place, source }),
  /** Musica: "toggle", "prev", "next". */
  mediaCommand: (command: string) => call<void>("media_command", { command }),
  hotkeyFailures: () => call<string[]>("hotkey_failures"),
  /** Settings: a shortcut field is listening, so no shortcut may fire meanwhile. */
  hotkeysSuspend: (on: boolean) => call<void>("hotkeys_suspend", { on }),
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
  /** Windows' snipping overlay; the picture saved in the inbox, or null if the user gave up. */
  captureScreen: () => callOrThrow<DroppedFile | null>("capture_screen"),
  /** Only ever tells you whether a key exists — never its value. */
  secretPresent: (key: string) => call<boolean>("secret_present", { key }),
  secretSet: (key: string, value: string) => callOrThrow<void>("secret_set", { key, value }),
  secretClear: (key: string) => callOrThrow<void>("secret_clear", { key }),

  // ── Integrations ──────────────────────────────────────────────────────────
  refreshIntegration: (id: string) => call<void>("refresh_integration", { id }),
  /** Opens the configured n8n instance in the browser. */
  openN8n: () => call<void>("open_n8n"),
  openZammad: () => call<void>("open_zammad"),

  // ── 3CX ───────────────────────────────────────────────────────────────────
  threecxCall: (number: string, device: string | null) => callOrThrow<void>("threecx_call", { number, device }),
  /** "answer" | "hangup" | "decline" */
  threecxAction: (id: string, action: string) => callOrThrow<void>("threecx_action", { id, action }),
  threecxContacts: (query: string) => callOrThrow<ThreecxContact[]>("threecx_contacts", { query }),
  threecxHistory: (missed: boolean) => callOrThrow<ThreecxHistoryItem[]>("threecx_history", { missed }),
  threecxStatus: (profile: string) => callOrThrow<void>("threecx_status", { profile }),
  threecxResetMissed: () => call<void>("threecx_reset_missed"),

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

export interface ThreecxContact {
  name: string;
  company: string;
  numbers: string[];
  colleague: boolean;
}

export interface ThreecxHistoryItem {
  name: string;
  number: string;
  kind: "missed" | "received" | "outgoing" | "other";
  at: number;
  answered: boolean;
}

/** A call of the extension, as the 3CX integration reports it. */
export interface ThreecxCall {
  id: string;
  state: "ringing" | "dialing" | "connected" | "other";
  incoming: boolean;
  name: string;
  number: string;
  since: number;
  canAnswer: boolean;
}

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
