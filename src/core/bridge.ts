// Thin wrapper over the Tauri commands/events. Every call is a no-op when the
// page is opened in a plain browser, so the island can be iterated on with
// `npm run dev` alone.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { Settings, WidgetStatus } from "./state";
import type { RecapHistory } from "../island/recap";

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

export interface NetAdapter {
  index: number;
  name: string;
  up: boolean;
  wireless: boolean;
  virtualHost: boolean;
  dhcp: boolean;
  dnsAuto: boolean;
  addresses: { ip: string; prefix: number }[];
  gateway: string;
  dns: string[];
  main: boolean;
}

export interface NetConfigInput {
  index: number;
  dhcp: boolean;
  ip: string;
  mask: string;
  gateway: string;
  dnsAuto: boolean;
  dns: string[];
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

/** A model of a chat engine, with its price when the engine says it (openai.rs, opencode.rs). */
export interface ModelOption {
  id: string;
  price?: "free" | "paid" | "local";
  /** Dollars per million tokens, input / output. */
  cost?: string;
}

export const Bridge = {
  boot: () => call<BootInfo>("boot"),

  saveSettings: (settings: Settings) => call<void>("save_settings", { settings }),

  /** Shrink the window down to the invisible wake strip (hidden) or back to full. */
  /** Open or closed: closing takes a dragged open island back to the character's place. */
  /** `place`: this opening goes there instead of `islandPlace` (the launch greeting). */
  setExpanded: (expanded: boolean, place: string | null = null) => call<void>("set_expanded", { expanded, place }),
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
  /** 📌 on: the open island as an ordinary app window (taskbar, not always on top). island.rs → set_app_mode. */
  setAppMode: (on: boolean) => call<void>("set_app_mode", { on }),
  /** The pinned island behind other windows: flash its taskbar button. */
  flashIfBehind: () => call<void>("flash_if_behind"),
  /** The notification-area menu at the cursor (tray.rs `popup`). */
  showIslandMenu: () => call<void>("show_island_menu"),
  isFolder: (path: string) => call<boolean>("is_folder", { path }),

  reposition: () => call<void>("reposition"),
  /** The window the open island needs, logical px (island.rs `set_panel_size`). */
  setPanelSize: (width: number, height: number) => call<void>("set_panel_size", { width, height }),
  /** The largest the window may be on the island's screen: [width, height], logical px. */
  panelLimits: () => call<[number, number]>("panel_limits"),

  /** "Copia info PC": the text it put on the clipboard. */
  copyPcInfo: () => callOrThrow<string>("copy_pc_info"),
  /** Rete: the adapters with their address and DNS settings (netconfig.rs). */
  networkAdapters: () => call<NetAdapter[]>("network_adapters"),
  /** Rete: applies an adapter's settings as administrator (Windows asks). */
  networkApply: (config: NetConfigInput) => callOrThrow<void>("network_apply", { config }),
  /** Rete: a continuous ping in a new terminal; "gateway" = the main adapter's. */
  networkPing: (target: string) => callOrThrow<string>("network_ping", { target }),
  /** "Davanti al cliente" right now: why, or null. */
  presenceState: () => call<string | null>("presence_state"),
  /** "Prova" for messages from scripts. */
  notifyTest: () => callOrThrow<void>("notify_test"),

  /** Moves the window while the character is dragged; `endDrag` saves where it was left. */
  dragIsland: (dx: number, dy: number) => call<void>("drag_island", { dx, dy }),
  /** The open island's offset from home; the file or folder the character was dropped on (lib.rs `end_drag`). */
  endDrag: () => call<{ offset: [number, number] | null; path: string | null }>("end_drag"),

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
  /** The settings on `page`, with `item` (an integration, a widget, an action) open. */
  openSettingsAt: (page: string, item = "") => call<void>("open_settings_at", { page, item }),

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
  chatSend: (query: string, context: ChatContext | null, engine: string | null = null, auto = false) =>
    callOrThrow<{ text: string }>("chat_send", { query, context, engine, auto }),
  /** Model ids an OpenAI-compatible engine offers (Impostazioni → Chat). */
  chatModels: (engine: string, url: string | null) => callOrThrow<ModelOption[]>("chat_models", { engine, url }),
  chatReset: () => call<void>("chat_reset"),
  /** "Continua": the next message for a session (session_reply.rs). "sent" or "prefilled". */
  sessionReply: (mode: string, text: string, pid: number | null, session: string | null, scheme: string | null) =>
    callOrThrow<string>("session_reply", { mode, text, pid, session, scheme }),
  /** "Chiedi a questa sessione": a read-only copy answers (claude_cli.rs → ask_session). */
  sessionAsk: (session: string, fork: string | null, cwd: string, question: string) =>
    callOrThrow<{ text: string; fork: string | null }>("session_ask", { session, fork, cwd, question }),
  /** The chat history (chat_log.rs): list, reopen in place of the current conversation, delete. */
  chatHistoryList: () => call<ChatSummary[]>("chat_history_list"),
  chatHistoryOpen: (id: string) => callOrThrow<{ engine: string; lines: { role: "user" | "assistant"; content: string }[] }>("chat_history_open", { id }),
  chatHistoryDelete: (id: string) => call<void>("chat_history_delete", { id }),
  chatHistoryClear: () => call<void>("chat_history_clear"),
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
  /** "Sostituisci": the selected text rewritten as `prompt` asks, outside the chat (lib.rs rewrite_text). */
  /** `formatted`: it can be pasted with the selection's formatting; `lost`: the
   * selection had some and the rewrite could not keep it (richtext.rs). */
  rewriteText: (prompt: string, text: string) =>
    callOrThrow<{ text: string; formatted: boolean; lost: boolean }>("rewrite_text", { prompt, text }),
  /** `text` in place of the selection, if it is still `original`; else why not
   * ("changed" | "no-window" | "no-focus" | "held" | "clipboard"). `formatted`:
   * with the rewrite's formatting (when `text` is still the rewrite). */
  replaceSelection: async (original: string, text: string, formatted: boolean): Promise<string | null> => {
    if (!IS_TAURI) return null;
    try {
      await invoke<void>("replace_selection", { original, text, formatted });
      return null;
    } catch (err) {
      return String(err);
    }
  },
  /** "Copia" in the rewrite card: with the formatting, or plain text. */
  copyRewrite: async (text: string, formatted: boolean) => {
    if (!IS_TAURI) { await navigator.clipboard?.writeText(text).catch(() => undefined); return; }
    await invoke<void>("copy_rewrite", { text, formatted });
  },
  /** The native menu at the mouse; a click comes back as the "tray" event "sel:<id>". */
  selectionMenu: (entries: { id: string; label: string; enabled?: boolean }[]) =>
    call<void>("selection_menu", { entries }),
  foregroundApp: () => call<{ exe: string; title: string } | null>("foreground_app"),
  /** Is process `pid` still running `exe`? (A session's agent, hooks.ts → watchSessions.) True when unknown. */
  processAlive: async (pid: number, exe: string) => (await call<boolean>("process_alive", { pid, exe })) ?? true,
  /** The selected text, or why there is none ("no-window" | "no-focus" | "held" | "empty" | "not-text"). */
  captureSelection: async (): Promise<{ text: string } | { error: string }> => {
    if (!IS_TAURI) return { error: "empty" };
    try {
      return { text: await invoke<string>("capture_selection") };
    } catch (err) {
      return { error: String(err) };
    }
  },
  /** Teams (teams.rs): a meeting command ("mute", "video", "hand", "share", "leave", "open"). Throws with the reason. */
  teamsAction: (kind: string) => callOrThrow<void>("teams_action", { kind }),
  /** "Registra" (record.rs). Throws with why it could not start. */
  recordStart: (request: { kind: "audio" | "screen"; mic: boolean; system: boolean; fps: number }) =>
    callOrThrow<void>("record_start", { request }),
  recordStop: () => call<void>("record_stop"),
  /** Microsoft account (msgraph.rs). */
  msStatus: () => call<{ configured: boolean; signedIn: boolean; account: string | null; error: string | null; redirect: string; scopes: string }>("ms_status"),
  msLogin: () => callOrThrow<string>("ms_login"),
  msLogout: () => callOrThrow<void>("ms_logout"),
  msTeamsSnapshot: () => call<import("./state").MsTeams>("ms_teams_snapshot"),
  teamsJoin: (url: string) => callOrThrow<void>("teams_join", { url }),
  /** Teams: join the meeting link in the clipboard. Throws when there is none. */
  teamsJoinClipboard: () => callOrThrow<void>("teams_join_clipboard"),
  /** A "Tasti" action: the sequence to the app in front (keys.rs). Throws with the reason. */
  actionSendKeys: (keys: string) => callOrThrow<void>("action_send_keys", { keys }),
  /** All the text of the window in front (Ctrl+A, Ctrl+C), or why not (as captureSelection). */
  captureWindowText: async (): Promise<{ text: string } | { error: string }> => {
    if (!IS_TAURI) return { error: "empty" };
    try {
      return { text: await invoke<string>("capture_window_text") };
    } catch (err) {
      return { error: String(err) };
    }
  },
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
  /** The tray ("Vassoio"): the copies of dropped files, kept until EasyIsland restarts. */
  inboxList: () => call<{ name: string; path: string; size: number; at: number; kept?: boolean }[]>("inbox_list"),
  inboxDelete: (name: string) => callOrThrow<void>("inbox_delete", { name }),
  /** "Svuota": every file that is not pinned. */
  inboxClear: () => call<number>("inbox_clear"),
  /** The programs of the Start menu (shortcuts), for the search bar. Empty in the browser preview. */
  startApps: async () => (await call<{ name: string; path: string }[]>("start_apps")) ?? [],
  /** Pins a file of the tray: it stays across restarts and "Svuota". */
  inboxKeep: (name: string, keep: boolean) => callOrThrow<void>("inbox_keep", { name, keep }),
  inboxOpen: (name: string, reveal: boolean) => callOrThrow<void>("inbox_open", { name, reveal }),
  /** Notion pages and databases matching `query`, most recently edited first (notion.rs). */
  notionSearch: (query: string, limit = 8, kind: "page" | "database" | null = null) =>
    callOrThrow<NotionPage[]>("notion_search", { query, limit, kind }),
  /** "Fatto" on a task of the card (the database chosen in the settings). */
  notionTaskDone: (id: string) => callOrThrow<void>("notion_task_done", { id }),
  /** "Nuova nota": into the page or database chosen in the settings; its title back. */
  notionAddNote: (text: string, stamp: string) => callOrThrow<string>("notion_add_note", { text, stamp }),
  // Remote Desktop Manager (rdm.rs): never a password, only names, folders, hosts and ids.
  rdmSearch: async (query: string, limit = 8) => (await call<RdmEntry[]>("rdm_search", { query, limit })) ?? [],
  rdmByHost: async (host: string) => (await call<RdmEntry[]>("rdm_by_host", { host })) ?? [],
  rdmOpen: (entry: RdmEntry) => callOrThrow<void>("rdm_open", { entry }),
  rdmEdit: (id: string) => callOrThrow<void>("rdm_edit", { id }),
  rdmFilter: (text: string) => callOrThrow<void>("rdm_filter", { text }),
  rdmQuick: (kind: "RDP" | "SSH" | "VNC", host: string) => callOrThrow<void>("rdm_quick", { kind, host }),
  rdmStatus: () => call<RdmStatus>("rdm_status"),
  rdmDataSources: () => callOrThrow<{ id: string; name: string; kind: string }[]>("rdm_data_sources"),
  /** "+ Attività" in the Notion card (due: "YYYY-MM-DD" or null). */
  notionAddTask: (title: string, due: string | null) => callOrThrow<void>("notion_add_task", { title, due }),
  /** "Rimanda" on a task: its new due date. */
  notionPostpone: (id: string, date: string) => callOrThrow<void>("notion_postpone", { id, date }),
  /** Impostazioni → Notion: the databases that look like tasks (score 2 = also by name) or notes. */
  notionSuggest: () => callOrThrow<(NotionPage & { tasks: boolean; notes: boolean; score: number })[]>("notion_suggest"),
  /** Impostazioni → Notion → Viste: what the tasks can be filtered by. */
  notionProperties: (id: string) => callOrThrow<{ name: string; kind: string; options: [string, string][] }[]>("notion_properties", { id }),
  /** Another tasks database chosen: its properties are read again. */
  notionForgetSchemas: () => call<void>("notion_forget_schemas"),
  /** A Notion page's title and text, for the chat. */
  notionPageText: (id: string) => callOrThrow<[string, string]>("notion_page_text", { id }),
  /** A picture of the tray on the clipboard. */
  inboxCopy: (name: string) => callOrThrow<void>("inbox_copy", { name }),
  /** A file anywhere (a finished download): open it as Explorer would, or select it there. */
  fileOpen: (path: string, reveal: boolean) => callOrThrow<void>("file_open", { path, reveal }),
  /** Drags a file of the tray out of the island into another app (Windows' own drag); resolves when it is over. */
  inboxDrag: (name: string) => callOrThrow<void>("inbox_drag", { name }),
  /** Is the left mouse button held (anywhere on the screen)? */
  mouseButtonDown: () => call<boolean>("mouse_button_down"),
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
  /** The checks' last results (the first round runs before the island listens). */
  widgetResults: async () => (await call<WidgetStatus[]>("widget_results")) ?? [],
  /** Weekly recap (recap.rs): turns and decisions from `since` (Unix seconds). */
  recapHistory: (since: number) => call<RecapHistory>("recap_history", { since }),
  recapMarkShown: (week: string) => call<void>("recap_mark_shown", { week }),
  /** The morning ("morning") or end-of-day ("evening") recap was shown on `day` (YYYY-MM-DD). */
  recapMarkDay: (which: "morning" | "evening", day: string) => call<void>("recap_mark_day", { which, day }),
  /** Repositories with changes not committed, pull requests waiting (daily.rs). */
  dailyDigest: () => call<DailyDigest>("daily_digest"),
  /** A card from Claude Code: the button clicked, or why there is none ("closed", "hidden", "replaced"). */
  momentCardAnswer: (id: string, choice: string | null, reason: string | null) =>
    call<void>("moment_card_answer", { id, choice, reason }),
  /** EasyIsland's tools in Claude Code's user configuration (mcp_setup.rs). */
  mcpClaudeStatus: () => call<{ cli: boolean; installed: boolean; current: boolean; entry: string }>("mcp_claude_status"),
  mcpClaudeApply: (install: boolean) => callOrThrow<string>("mcp_claude_apply", { install }),
  recapClear: () => call<void>("recap_clear"),
  /** From the settings window: the island opens the recap. */
  recapShow: () => call<void>("recap_show"),
  dailyShow: () => call<void>("daily_show"),
  /** Lingua: the windows are rebuilt in the new language. */
  restartApp: () => call<void>("restart_app"),
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
  /** "Cerchia e chiedi" (screenshot.rs): freezes the screen under the mouse; where it is, in physical px. */
  captureBegin: () => callOrThrow<CaptureScreen>("capture_begin"),
  /** The frozen screen's pixels, RGBA, raw. */
  captureFrame: () => callOrThrow<ArrayBuffer>("capture_frame"),
  /** The island's window covers the frozen screen and takes mouse and keys. */
  captureShow: () => callOrThrow<void>("capture_show"),
  /** Back to the island; the frozen screen is dropped. */
  captureEnd: () => call<void>("capture_end"),
  /** A zone of the frozen screen (physical px) as a PNG in the inbox. */
  captureSave: (z: CaptureZone) => callOrThrow<DroppedFile>("capture_save", { ...z }),
  /** A zone on the clipboard, as a picture. */
  captureCopy: (z: CaptureZone) => callOrThrow<void>("capture_copy", { ...z }),
  /** A zone's text (Windows' OCR), also copied. */
  captureText: (z: CaptureZone) => callOrThrow<string>("capture_text", { ...z }),
  /** The carried character's face, drawn under the pointer in a window of its own (carry.rs). */
  carryFrame: (width: number, height: number, rgba: number[]) => call<void>("carry_frame", { width, height, rgba }),
  /** The character of the chat tab carried over other windows: the island keeps the mouse meanwhile. */
  windowPick: (active: boolean) => call<void>("window_pick", { active }),
  /** The window under the cursor while the character is carried. */
  windowUnderCursor: () => call<WindowInfo | null>("window_under_cursor"),
  /** The character let go: the window under the cursor, captured. */
  windowDrop: () => callOrThrow<WindowShot | null>("window_drop"),
  /** Only ever tells you whether a key exists — never its value. */
  secretPresent: (key: string) => call<boolean>("secret_present", { key }),
  secretSet: (key: string, value: string) => callOrThrow<void>("secret_set", { key, value }),
  secretClear: (key: string) => callOrThrow<void>("secret_clear", { key }),

  // ── Integrations ──────────────────────────────────────────────────────────
  refreshIntegration: (id: string) => call<void>("refresh_integration", { id }),
  /** Opens the configured n8n instance in the browser. */
  openN8n: () => call<void>("open_n8n"),
  openZammad: () => call<void>("open_zammad"),
  /** "Apri" for the integrations that are a Windows tool or a server (lib.rs, open_integration). */
  openIntegration: (id: string) => call<boolean>("open_integration", { id }),

  // ── 3CX ───────────────────────────────────────────────────────────────────
  threecxCall: (number: string, device: string | null) => callOrThrow<void>("threecx_call", { number, device }),
  /** "answer" | "hangup" | "decline" */
  threecxAction: (id: string, action: string) => callOrThrow<void>("threecx_action", { id, action }),
  threecxContacts: (query: string) => callOrThrow<ThreecxContact[]>("threecx_contacts", { query }),
  threecxHistory: (missed: boolean) => callOrThrow<ThreecxHistoryItem[]>("threecx_history", { missed }),
  threecxStatus: (profile: string) => callOrThrow<void>("threecx_status", { profile }),
  threecxResetMissed: () => call<void>("threecx_reset_missed"),
  /** Our connected call handed to a colleague or a number. */
  threecxTransfer: (id: string, number: string) => callOrThrow<void>("threecx_transfer", { id, number }),
  /** A call ringing for us sent to a number, or to our voicemail (""). */
  threecxDivert: (id: string, number: string) => callOrThrow<void>("threecx_divert", { id, number }),
  /** A colleague's ringing call answered here. */
  threecxPickup: (id: string, device: string | null) => callOrThrow<void>("threecx_pickup", { id, device }),
  /** "Questo PC": one step of a WebRTC call; the PBX's id of the call. */
  threecxWebrtc: (id: number, sdpType: number, transaction: number | null, sdp: string, destination: string, replace: number | null) =>
    callOrThrow<number>("threecx_webrtc", { id, sdpType, transaction, sdp, destination, replace }),
  /** The user's ringtone as a data URL; null = the built-in one. */
  threecxRingtone: () => call<string | null>("threecx_ringtone"),
  /** A picked ringtone file (empty = back to the built-in one). */
  threecxSetRingtone: async (name: string, data: Uint8Array) => {
    if (!IS_TAURI) return;
    await invoke<void>("threecx_set_ringtone", data, { headers: { "x-name": encodeURIComponent(name) } });
  },
  threecxQueue: (loggedIn: boolean) => callOrThrow<void>("threecx_queue", { loggedIn }),
  threecxChats: () => callOrThrow<ThreecxChat[]>("threecx_chats"),
  threecxMessages: (conversation: number, before: number | null = null) =>
    callOrThrow<ThreecxMessage[]>("threecx_messages", { conversation, before }),
  threecxChatWith: (numbers: string[]) => callOrThrow<ThreecxChat>("threecx_chat_with", { numbers }),
  threecxSend: (conversation: number, text: string) => callOrThrow<void>("threecx_send", { conversation, text }),
  threecxRead: (conversation: number, ids: number[]) => call<void>("threecx_read", { conversation, ids }),
  threecxTyping: (conversation: number) => call<void>("threecx_typing", { conversation }),
  threecxVoicemails: () => callOrThrow<ThreecxVoicemail[]>("threecx_voicemails"),
  /** The PBX calls our phone and plays it. */
  threecxPlayVoicemail: (id: number) => callOrThrow<void>("threecx_play_voicemail", { id }),
  threecxVoicemailHeard: (id: number) => call<void>("threecx_voicemail_heard", { id }),

  /** Tray → Pause. Stops the integration pollers, not just the island. */
  setPaused: (paused: boolean) => call<void>("set_paused", { paused }),
};

export interface IntegrationUpdate {
  id: string;
  data: Record<string, unknown>;
  error: string | null;
  event: { success: boolean; label: string; detail: string | null } | null;
}

/** One conversation in the chat history (chat_log.rs `Summary`); `updated` in ms. */
export interface ChatSummary {
  id: string;
  title: string;
  engine: string;
  updated: number;
  turns: number;
}

export type ChatContext =
  | { kind: "file"; name: string; path: string }
  | { kind: "text"; label: string; text: string }
  | { kind: "window"; appName: string; title: string; url?: string; image?: string };

/** The window the character of the chat tab is carried over (window_drop.rs). */
export interface WindowInfo {
  appName: string;
  title: string;
}

/** The window the character was dropped on: its picture in the inbox, a small copy for the chip. */
export interface WindowShot extends WindowInfo {
  name: string;
  path: string;
  thumb: string;
}

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

/** A colleague on the PBX (3CX team). */
export interface ThreecxColleague {
  number: string;
  name: string;
  presence: "available" | "away" | "dnd" | "busy" | "ringing" | "offline";
  status: string;
  /** The call ringing for them, which can be answered here. */
  ringingCall: string | null;
  mobile: string;
}

/** A 3CX chat conversation. */
export interface ThreecxChat {
  id: number;
  name: string;
  external: boolean;
  group: boolean;
  /** The colleague's extension in a one-to-one chat, else "". */
  number: string;
  last: string;
  lastAt: number;
  lastMine: boolean;
  unread: number;
}

export interface ThreecxMessage {
  id: number;
  conversation: number;
  mine: boolean;
  from: string;
  text: string;
  file: string | null;
  at: number;
  isNew: boolean;
  system: boolean;
}

export interface ThreecxVoicemail {
  id: number;
  name: string;
  number: string;
  at: number;
  seconds: number;
  isNew: boolean;
  transcription: string;
}

/** A call of the extension, as the 3CX integration reports it. */
/** A connection of Remote Desktop Manager (rdm.rs Entry). */
export interface RdmEntry {
  id: string;
  name: string;
  /** Folder path in RDM ("Clienti\\Rossi Srl"). */
  group: string;
  host: string;
  /** RDM's connection type ("RDPConfigured", "SSHShell"…). */
  kind: string;
}

/** Impostazioni → Remote Desktop Manager: what is installed (rdm.rs Status). */
export interface RdmStatus {
  exe: string | null;
  protocol: boolean;
  pwsh: string | null;
  module: string | null;
  count: number;
  dataSource: string | null;
  listError: string | null;
}

export interface ThreecxCall {
  id: string;
  state: "ringing" | "dialing" | "connected" | "other";
  incoming: boolean;
  name: string;
  number: string;
  since: number;
  canAnswer: boolean;
  /** SIP dialog: links the call to one of "Questo PC" (softphone.ts). */
  dialog: string;
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
  /** Installed, but an event added by a newer version is missing: install again. */
  outdated?: boolean;
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
 * Files dragged onto the island. Only reaches us when the window takes the mouse,
 * and only a drop near the island itself counts (`accepts`; the window takes a
 * held mouse near the island only, see DROP_MARGIN in src-tauri/src/island.rs).
 *
 * The page takes the drop itself (HTML5): Tauri's native drop target is never
 * reached on current WebView2 runtimes. A `File` has no path in the page, so
 * the files go back to Rust with postMessageWithAdditionalObjects, and Rust
 * answers with `file-drop` and their real paths (src-tauri/src/drop.rs).
 */
export async function onDragDrop(handler: (e: DragDropPayload) => void, accepts: (x: number, y: number) => boolean) {
  if (!IS_TAURI) return () => {};
  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");
  // dragenter/dragleave fire for every element crossed: count them.
  let depth = 0;
  // Over the island (its shape plus a margin, `accepts`) or not. The window is
  // much larger than the island: a file anywhere else is refused, never taken.
  let inZone = false;
  const track = (e: DragEvent) => {
    // Always cancelled, or WebView2 would open the file in place of the island;
    // "none" outside the island refuses the drop (the file stays where it was).
    e.preventDefault();
    const ok = accepts(e.clientX, e.clientY);
    if (e.dataTransfer) e.dataTransfer.dropEffect = ok ? "copy" : "none";
    if (ok && !inZone) {
      inZone = true;
      handler({ type: "enter" });
    } else if (!ok && inZone) {
      inZone = false;
      handler({ type: "leave" });
    }
    if (ok) handler({ type: "over" });
  };
  window.addEventListener("dragenter", (e) => {
    if (!hasFiles(e)) return;
    depth++;
    track(e);
  });
  window.addEventListener("dragover", (e) => {
    if (!hasFiles(e)) return;
    track(e);
  });
  window.addEventListener("dragleave", (e) => {
    if (!hasFiles(e)) return;
    if (--depth <= 0) {
      depth = 0;
      if (inZone) {
        inZone = false;
        handler({ type: "leave" });
      }
    }
  });
  window.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    const wasInZone = inZone;
    inZone = false;
    // Dropped away from the island: refused, whatever reached the page. (The
    // last dragover, just before the drop, decided; the drop's own coordinates
    // are not trusted.)
    if (!wasInZone) {
      handler({ type: "drop", paths: [] });
      return;
    }
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

/** What the morning and end-of-day card shows (daily.rs). */
export interface DailyDigest {
  repos: { name: string; path: string; branch: string; changed: number; ahead: number }[];
  /** null when neither `gh` nor a GitHub token is there. */
  prs: { title: string; repo: string; url: string; number: number; review: boolean }[] | null;
}

/** A Notion page or database (integrations.rs parse_notion_page). */
export interface NotionPage {
  id: string;
  title: string;
  emoji: string | null;
  database?: boolean;
  lastEditedAt: string;
  url: string;
}

/** The frozen screen of "Cerchia e chiedi", physical px. */
export interface CaptureScreen {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A zone of the frozen screen, physical px from its top-left corner. */
export interface CaptureZone {
  x: number;
  y: number;
  width: number;
  height: number;
}

export async function onEvent<T>(name: string, handler: (payload: T) => void) {
  if (!IS_TAURI) return () => {};
  return listen<T>(name, (e) => handler(e.payload));
}
