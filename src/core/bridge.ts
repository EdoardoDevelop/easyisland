// Thin wrapper over the Tauri commands/events. Every call is a no-op when the
// page is opened in a plain browser, so the island can be iterated on with
// `npm run dev` alone.

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { AppMenuLine, Settings, WidgetStatus, PickedWindow, AgentTaskItem, Skill, Custom, CustomRecord, NewsItem, NewsProposal } from "./state";
import type { RecapHistory } from "../island/recap";

export const IS_TAURI =
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface WorkEntry {
  name: string;
  rel: string;
  dir: boolean;
  size: number;
  at: number;
}

export interface WorkListing {
  root: string;
  rel: string;
  entries: WorkEntry[];
  more: boolean;
}

export interface TelegramInfo {
  token: boolean;
  running: boolean;
  bot: string;
  linked: boolean;
  name: string;
  error: string | null;
}

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

/** A tool of EasyIsland that changed something (permits.rs «Cosa ho fatto»). */
export interface DoneItem {
  id: string;
  /** Milliseconds since 1970. */
  at: number;
  tool: string;
  what: string;
  /** "" = the chat; else the task's title. */
  task: string;
  /** Ran without a click. */
  alone: boolean;
  /** Present when it can be taken back. */
  undo?: { kind: string };
  undone: boolean;
}

/** The summary of the day written by an engine (giornata.rs). */
export interface DayText {
  which: string;
  day: string;
  text: string;
  error: string;
  busy: boolean;
}

export const Bridge = {
  boot: () => call<BootInfo>("boot"),

  saveSettings: (settings: Settings) => call<void>("save_settings", { settings }),

  /** Shrink the window down to the invisible wake strip (hidden) or back to full. */
  /** Open or closed: closing takes a dragged open island back to the character's place. */
  /** `place`: this opening goes there instead of `islandPlace` (the launch greeting). */
  /** Answers how far the window could not follow the bar's element of a "pop:<x>" place (logical px). */
  setExpanded: (expanded: boolean, place: string | null = null) => call<number>("set_expanded", { expanded, place }),
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
  minimizeIsland: () => call<void>("minimize_island"),
  /** Windows' preview of a picture (thumbs.rs); null for other files. */
  /** La Raccolta (collect.rs): the collection as JSON, "" for none. */
  collectLoad: () => call<string>("collect_load"),
  collectSave: (json: string) => call<void>("collect_save", { json }),
  /** Where the selection just read came from: app, title and, from a browser, the page. */
  collectSource: (text: string) => call<{ exe: string; title: string; url: string }>("collect_source", { text }),
  fileThumb: (path: string) => call<string | null>("file_thumb", { path }),
  /** A quick action's automatic icon (thumbs.rs): the program's, or the site's favicon. */
  programIcon: (target: string) => call<string | null>("program_icon", { target }),
  siteIcon: (url: string) => call<string | null>("site_icon", { url }),
  /** The user's PNG in place of the character (logo.rs): a data: URL in, a data: URL out. */
  logoSave: (data: string) => call<void>("logo_save", { data }),
  logoLoad: () => call<string | null>("logo_load"),
  logoClear: () => call<void>("logo_clear"),
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
  /** The fixed bar's system elements now shown: barsys.rs reads only those. */
  barSysWatch: (kinds: string[]) => call<void>("bar_sys_watch", { kinds }),
  /** Volume, brightness, mute, a Windows panel, the power menu (barsys.rs). */
  barSysDo: (what: string, arg?: number, path?: string) => call<void>("bar_sys_do", { what, arg, path }),
  /** The fixed bar that hides by itself: the mouse came (true) or left. */
  barReveal: (on: boolean) => call<void>("bar_reveal", { on }),
  /** «Notizie»: the subjects the memory proposes, without the excluded ones (news.rs). */
  newsProposals: (excluded: string[]) => call<NewsProposal[]>("news_proposals", { excluded }),
  /** «Scegli adesso»: the engine picks among the memory's subjects now; how many were added. */
  newsAuto: () => callOrThrow<number>("news_auto"),
  /** A news' thumbnail as a data URL (news.rs fetches and keeps it), null without one. */
  newsImage: (id: string) => call<string | null>("news_image", { id }),
  /** The news kept, newest first; `newsRefresh` checks now and says how many are new. */
  newsItems: () => call<NewsItem[]>("news_items"),
  newsRefresh: () => callOrThrow<number>("news_refresh"),
  /** «Salva»: the news goes to the memory's da-leggere. */
  newsSave: (title: string, link: string, source: string) => callOrThrow<string>("news_save", { title, link, source }),
  /** What the user said of each subject: «Di più» +1, «Non mi interessa» −1. */
  newsTaste: () => call<Record<string, number>>("news_taste"),
  /** «Non mi interessa» (`more` false) or «Di più» (which also searches the same story now). */
  newsFeedback: (id: string, more: boolean) => callOrThrow<{ topic: string; taste: number; added: number }>("news_feedback", { id, more }),
  /** «Tienilo»: the subject's taste starts again from zero. */
  newsKeep: (topic: string) => call<void>("news_keep", { topic }),
  /** A Windows menu at the bar; a line comes back as the tray's `bar:<key>`. */
  barMenu: (entries: [string, string][]) => call<void>("bar_overflow_menu", { entries }),
  /** The program in front's own menu, for the window title's card (appmenu.rs). */
  appMenuRead: () => call<{ items: AppMenuLine[] }>("app_menu_read"),
  /** A line of that menu, to the program. */
  appMenuRun: (line: number) => call<void>("app_menu_run", { line }),
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
  /** Back to where a session runs; a task of EasyIsland (tasks.rs) opens Impostazioni → Flussi. */
  openSession: (host: string | null, path: string | null) =>
    host === "compiti" ? call<string>("open_settings_at", { page: "compiti", item: "" }) : call<string>("open_session", { host, path }),

  quit: () => call<void>("quit_app"),

  openSettingsWindow: () => call<void>("open_settings_window"),
  /** The settings on `page`, with `item` (an integration, a widget, an action) open. */
  openSettingsAt: (page: string, item = "") => call<void>("open_settings_at", { page, item }),

  /** Writes to %LOCALAPPDATA%\EasyIsland\easyisland.log, next to the Rust lines. */
  log: (message: string) => call<void>("log_line", { message }),
  /** The screens: [setting value ("monitor:<name>"), label], the main one first. */
  monitorList: () => call<[string, string][]>("monitor_list"),
  /** The resting character shown by its own window (docs/due-webview.md), or not. */
  characterRest: (on: boolean) => call<void>("character_rest", { on }),
  /** The compact character's window over the badge: [x, y, w, h] in the island window's px, or null. */
  characterSpot: (spot: [number, number, number, number] | null, open = false) => call<void>("character_spot", { spot, open }),
  /** How far the open island moves away from the character (logical px), so it opens beside it. */
  characterClearance: (dx: number, dy: number) => call<void>("character_clearance", { dx, dy }),

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
  /** Impostazioni → Chat → Antigravity: is its CLI (agy) on this PC (antigravity.rs). */
  antigravityStatus: () => call<{ found: boolean; path: string }>("antigravity_status"),
  /** Impostazioni → Telegram → «Vocali»: the models of a service that take audio, cheapest first (transcribe.rs). */
  voiceModels: (service: string) => callOrThrow<ModelOption[]>("voice_models", { service }),
  /** "Ferma": ends the island's turn in progress (lib.rs chat_stop); chatSend then fails with "Interrotta.". */
  chatStop: () => call<void>("chat_stop"),
  chatSecond: (engine: string, first: string, question: string, answer: string) =>
    callOrThrow<string>("chat_second", { engine, first, question, answer }),
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
  recordStart: (request: { kind: "audio" | "screen"; mic: boolean; system: boolean; fps: number; window?: number; label?: string }) =>
    callOrThrow<void>("record_start", { request }),
  /** File e schermo: the windows one can record or photograph (window_drop.rs). */
  recordWindows: async () => (await call<PickedWindow[]>("record_windows")) ?? [],
  /** The character let go on a window in File e schermo: which one (no picture). */
  windowPickDrop: () => call<PickedWindow | null>("window_pick_drop"),
  /** "Foto nel Vassoio": the window as a PNG in the inbox. */
  windowShot: (id: number) => callOrThrow<DroppedFile>("window_shot", { id }),
  recordStop: () => call<void>("record_stop"),
  /** Accesso remoto (remote.rs): throws with why it could not connect. */
  remoteConnect: (request: { kind: "winrm" | "ssh"; host: string; port: number | null; user: string; password: string; https: boolean; trust: boolean }) =>
    callOrThrow<void>("remote_connect", { request }),
  remoteDisconnect: () => callOrThrow<void>("remote_disconnect"),
  remoteLink: (on: boolean) => callOrThrow<void>("remote_link", { on }),
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
  /** Impostazioni → Flussi: the last runs and "Prova ora". */
  automationsLog: () => call<{ at: number; name: string; cause: string; ok: boolean; detail: string }[]>("automations_log"),
  flowsRuns: () => call<FlowRunInfo[]>("flows_runs"),
  flowRun: (id: string) => call<FlowRun>("flow_run", { id }),
  flowRerun: (id: string, node: string) => callOrThrow<void>("flow_rerun", { id, node }),
  flowTryFrom: (id: string, node: string) => callOrThrow<void>("flow_try_from", { id, node }),
  /** The flows window (src/flows/): opened on `id`, made the first time. */
  openFlowsWindow: (id = "") => call<void>("open_flows_window", { id }),
  /** Saves one flow; what it still needs to run comes back ("" = complete). */
  flowSave: (flow: import("./state").Automation) => callOrThrow<string>("flow_save", { flow }),
  flowDelete: (id: string) => callOrThrow<void>("flow_delete", { id }),
  flowAskChat: (text: string) => call<void>("flow_ask_chat", { text }),
  flowPending: () => call<string>("flow_pending"),
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
  /** Notion's structure kept for the chat (notion_map.rs): how many, and when (s since 1970, 0 = never). */
  notionMapStatus: () => call<NotionMapStatus>("notion_map_status"),
  notionMapSync: () => callOrThrow<NotionMapStatus>("notion_map_sync"),
  /** The chat's memory (memory.rs): counts, a note («/ricorda»), opening MEMORIA.md or its folder. */
  memoryInfo: () => call<MemoryInfo>("memory_info"),
  /** Compiti (tasks.rs). */
  tasksList: () => call<AgentTaskItem[]>("tasks_list"),
  taskNew: (title: string, goal: string, when: string, engine: string, model = "", helpers: string[] = []) =>
    callOrThrow<AgentTaskItem>("task_new", { title, goal, when, engine, model, helpers }),
  /** Battito (tasks.rs): every `minutes`, 0 = off; its list in BATTITO.md. */
  heartbeatSet: (minutes: number) => callOrThrow<void>("heartbeat_set", { minutes }),
  heartbeatOpen: () => callOrThrow<void>("heartbeat_open"),
  /** The evening digest of the memory (tasks.rs). */
  digestSet: (on: boolean) => callOrThrow<void>("digest_set", { on }),
  taskSetEngines: (id: string, engine: string, model: string, helpers: string[]) => callOrThrow<void>("task_set_engines", { id, engine, model, helpers }),
  /** What a task may do without asking (permits.rs). */
  taskSetMay: (id: string, may: string[]) => callOrThrow<void>("task_set_may", { id, may }),
  /** «Consenti sempre» for a reversible tool, or taken away. */
  toolsAllow: (tool: string, on: boolean) => callOrThrow<void>("tools_allow", { tool, on }),
  /** «Cosa ho fatto», the newest first. */
  didList: () => call<DoneItem[]>("did_list"),
  didUndo: (id: string) => callOrThrow<void>("did_undo", { id }),
  /** The chat's engines: [id, name, ready now]. */
  enginesReady: () => call<[string, string, boolean][]>("engines_ready"),
  /** Integrazioni personali (custom.rs). */
  customsList: () => call<Custom[]>("customs_list"),
  customSave: (definition: Custom) => callOrThrow<Custom>("custom_save", { definition }),
  customDelete: (id: string) => callOrThrow<void>("custom_delete", { id }),
  customRecords: (id: string) => call<CustomRecord[]>("custom_records", { id }),
  customRecordSave: (id: string, record: string, values: Record<string, unknown>) => callOrThrow<CustomRecord>("custom_record_save", { id, record, values }),
  customRecordDelete: (id: string, record: string) => callOrThrow<void>("custom_record_delete", { id, record }),
  customDocument: (name: string, ext: string, text: string) => callOrThrow<{ name: string; path: string }>("custom_document", { name, ext, text }),
  customCopy: (text: string) => callOrThrow<void>("custom_copy", { text }),
  /** An integration's call to a service (keys put in by Rust) and a source read now. */
  customHttp: (id: string, method: string, url: string, headers: Record<string, string>, body: string) =>
    callOrThrow<{ status: number; ok: boolean; data: unknown }>("custom_http", { id, method, url, headers, body }),
  customFetch: (id: string, source: string) => callOrThrow<{ status: number; ok: boolean; data: unknown }>("custom_fetch", { id, source }),
  /** «Compila con l'IA»: the fields read from a pasted text. */
  customFill: (id: string, text: string) => callOrThrow<Record<string, unknown>>("custom_fill", { id, text }),
  customToNotion: (database: string, properties: Record<string, unknown>) => callOrThrow<string>("custom_to_notion", { database, properties }),
  /** Abilità (skills.rs). */
  skillsList: () => call<Skill[]>("skills_list"),
  skillSave: (s: { name: string; description: string; engine: string; tools: string[]; body: string }, old: string) =>
    callOrThrow<Skill>("skill_save", { ...s, old }),
  skillDelete: (id: string) => callOrThrow<void>("skill_delete", { id }),
  skillsOpen: () => call<void>("skills_open"),
  skillPrompt: (id: string, arg: string) => callOrThrow<string>("skill_prompt", { id, arg }),
  taskControl: (id: string, action: "start" | "pause" | "resume" | "stop" | "delete") => callOrThrow<void>("task_control", { id, action }),
  taskAnswer: (id: string, text: string) => callOrThrow<void>("task_answer", { id, text }),
  taskLog: (id: string) => call<string>("task_log", { id }),
  memoryNote: (text: string) => callOrThrow<string>("memory_note", { text }),
  memoryOpen: (folder: boolean) => callOrThrow<void>("memory_open", { folder }),
  /** The memory window (brain.rs): the graph, its jobs, a node's file, opening it. */
  memoryGraph: () => call<import("../memory/data").MemGraph>("memory_graph"),
  /** «Collega con l'IA» (memory_ai.rs): what the engine added. */
  memoryLink: () => callOrThrow<string>("memory_link"),
  memoryJob: (kind: "inbox" | "check") => callOrThrow<void>("memory_job", { kind }),
  memoryNodeOpen: (id: string) => callOrThrow<void>("memory_node_open", { id }),
  memoryWindowOpen: () => call<void>("memory_window_open"),
  memoryInboxAdd: (name: string, data: number[]) => callOrThrow<string>("memory_inbox_add", { name, data }),
  memoryNoteAdd: (text: string) => callOrThrow<string>("memory_note_add", { text }),
  /** «Anteprima» (preview.rs, src/preview/): files and web pages in their window. */
  previewOpen: (target: string, newTab = false) => callOrThrow<number>("preview_open", { target, newTab }),
  previewShow: () => call<void>("preview_show"),
  previewHide: () => call<void>("preview_hide"),
  previewPane: (x: number, y: number, w: number, h: number) => call<void>("preview_pane", { x, y, w, h }),
  previewState: () => call<import("../preview/types").PreviewState>("preview_state"),
  previewSelect: (id: number) => call<void>("preview_select", { id }),
  previewClose: (id: number) => call<void>("preview_close", { id }),
  previewLayout: (x: number, y: number, w: number, h: number, covered: boolean) => call<void>("preview_layout", { x, y, w, h, covered }),
  previewNav: (id: number, action: string) => callOrThrow<void>("preview_nav", { id, action }),
  previewView: (preset: string, scheme: string, width?: number, height?: number, zoom?: string) => call<void>("preview_view", { preset, scheme, width, height, zoom }),
  previewFile: (path: string) => call<import("../preview/types").FileView>("preview_file", { path }),
  previewConsole: (id: number) => call<import("../preview/types").ConsoleLine[]>("preview_console", { id }),
  previewConsoleClear: (id: number) => call<void>("preview_console_clear", { id }),
  previewDevtools: (id: number) => callOrThrow<void>("preview_devtools", { id }),
  previewServers: () => call<import("../preview/types").DevServer[]>("preview_servers"),
  previewExternal: (pathOrUrl: string, reveal: boolean) => callOrThrow<void>("preview_external", { pathOrUrl, reveal }),
  /** Ctrl+V in the chat: files copied in Explorer or a picture, into the inbox (null: plain text). */
  /** Ctrl+V in the chat: every file and folder copied in Explorer, or a picture. */
  chatPaste: () => callOrThrow<ChatAttachment[]>("chat_paste"),
  /** Paths dropped on the chat: files into the Vassoio, folders as they are. */
  chatAttach: (paths: string[]) => callOrThrow<ChatAttachment[]>("chat_attach", { paths }),
  /** 📎: Windows' dialog for several files, or several folders. */
  chatPick: (folders: boolean) => callOrThrow<ChatAttachment[]>("chat_pick", { folders }),
  /** «Modifica» / «Rigenera»: the conversation goes back to these lines. */
  chatRewind: (keep: { role: "user" | "assistant"; content: string }[]) => call<void>("chat_rewind", { keep }),
  /** «Esporta»: the conversation as Markdown in the Vassoio. */
  chatExport: (title: string, lines: { role: "user" | "assistant"; content: string }[]) => callOrThrow<DroppedFile>("chat_export", { title, lines }),
  /** «/oggi», «/domani»: the question that gathers the day with the tools (telegram.rs day_prompt). */
  chatDayPrompt: (tomorrow: boolean) => call<string>("chat_day_prompt", { tomorrow }),
  /** «⑂ Dirama da qui»: a new conversation from these lines; the old one stays in the history. */
  chatFork: (keep: { role: "user" | "assistant"; content: string }[]) => call<void>("chat_fork", { keep }),
  /** The assistant of the conversation that starts (its instructions); null = none. */
  chatPersona: (instructions: string | null) => call<void>("chat_persona", { instructions }),
  /** 🎤: the recorded audio to text (Telegram's «Vocali» service). */
  chatTranscribe: (audio: number[], mime: string) => callOrThrow<string>("chat_transcribe", { audio, mime }),
  /** The island compact (true) or open: WebView2 keeps less memory (webview_memory.rs). */
  webviewMemoryLow: (low: boolean) => call<void>("webview_memory_low", { low }),
  /** Windows' accent colour ("#rrggbb", the shade for dark backgrounds), or null. */
  systemAccent: () => call<string | null>("system_accent"),
  systemLight: () => call<boolean>("system_light"),
  setWindowLight: (light: boolean) => call<void>("set_window_light", { light }),
  /** 🎤 records or stopped: the microphone in use is not a meeting (presence.rs). */
  chatDictation: (on: boolean) => call<void>("chat_dictation", { on }),
  /** 🎤 with no service: Windows' dictation (Win+H) in the focused field. */
  chatDictateWindows: () => callOrThrow<void>("chat_dictate_windows"),
  chatHistorySearch: (query: string) => call<ChatSummary[]>("chat_history_search", { query }),
  /** The field at the top: memory pages (brain.rs find_pages). */
  memoryFind: (query: string) => call<MemoryHit[]>("memory_find", { query }),
  /** A page found there: the memory window with it selected. */
  memoryWindowSelect: (id: string) => call<void>("memory_window_select", { id }),
  /** The field at the top: Zammad's tickets (zammad.rs search). */
  zammadSearch: (query: string) => call<TicketHit[]>("zammad_search", { query }),
  chatHistoryPin: (id: string, pinned: boolean) => call<void>("chat_history_pin", { id, pinned }),
  /** ✎ in the history list; an empty title goes back to the first question. */
  chatHistoryRename: (id: string, title: string) => call<void>("chat_history_rename", { id, title }),
  /** What the chat learnt by use (recipes.rs): how many, and forgetting them. */
  recipesCount: () => call<number>("recipes_count"),
  recipesForget: () => call<void>("recipes_forget"),
  /** Telegram (telegram.rs): the bot, the linked chat, the last error. */
  telegramInfo: () => call<TelegramInfo>("telegram_info"),
  telegramLinkCode: () => callOrThrow<string>("telegram_link_code"),
  telegramUnlink: () => callOrThrow<void>("telegram_unlink"),
  telegramRestart: () => call<void>("telegram_restart"),
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
  /** The mini Notion of the card (notion_page.rs, views/notionpage.ts): a page or a database to draw. */
  notionOpenPage: (id: string) => callOrThrow<unknown>("notion_open_page", { id }),
  /** `prop`/`page`: only the rows whose relation `prop` contains `page`. */
  notionOpenDatabase: (id: string, prop?: string, page?: string) => callOrThrow<unknown>("notion_open_database", { id, prop, page }),
  notionBlockText: (id: string, kind: string, spans: unknown[]) => callOrThrow<void>("notion_block_text", { id, kind, spans }),
  notionBlockCheck: (id: string, checked: boolean) => callOrThrow<void>("notion_block_check", { id, checked }),
  notionBlockAdd: (parent: string, after: string | null, kind: string, spans: unknown[]) =>
    callOrThrow<unknown>("notion_block_add", { parent, after, kind, spans }),
  notionBlockRetype: (parent: string, id: string, kind: string, spans: unknown[]) =>
    callOrThrow<unknown>("notion_block_retype", { parent, id, kind, spans }),
  /** To Notion's trash. */
  notionBlockDelete: (id: string) => callOrThrow<void>("notion_block_delete", { id }),
  notionPageTitle: (id: string, title: string) => callOrThrow<void>("notion_page_title", { id, title }),
  notionRowSet: (page: string, name: string, kind: string, value: unknown) => callOrThrow<unknown>("notion_row_set", { page, name, kind, value }),
  notionRowAdd: (db: string, title: string, name?: string, kind?: string, value?: unknown) =>
    callOrThrow<unknown>("notion_row_add", { db, title, name, kind, value }),
  /** A row (a page) to Notion's trash. */
  notionPageDelete: (id: string) => callOrThrow<void>("notion_page_delete", { id }),
  /** A picture of a page from Notion's own files, as a data URL. */
  notionImage: (url: string) => callOrThrow<string>("notion_image", { url }),
  /** A picture of the tray on the clipboard. */
  inboxCopy: (name: string) => callOrThrow<void>("inbox_copy", { name }),
  /** A file anywhere (a finished download): open it as Explorer would, or select it there. */
  fileOpen: (path: string, reveal: boolean) => callOrThrow<void>("file_open", { path, reveal }),
  /** Drags a file of the tray out of the island into another app (Windows' own drag); resolves when it is over. */
  inboxDrag: (name: string) => callOrThrow<void>("inbox_drag", { name }),
  /** «Sposta nella cartella di lavoro»: into `dest` (relative), moved or copied. */
  inboxToWork: (name: string, dest: string, copy: boolean) => callOrThrow<string>("inbox_to_work", { name, dest, copy }),
  /** The work folder (workdir.rs): `rel` is relative to it, with "/". */
  workList: (rel: string) => callOrThrow<WorkListing>("work_list", { rel }),
  workOpen: (rel: string, reveal: boolean) => callOrThrow<void>("work_open", { rel, reveal }),
  workRename: (rel: string, name: string) => callOrThrow<string>("work_rename", { rel, name }),
  workMkdir: (parent: string, name: string) => callOrThrow<string>("work_mkdir", { parent, name }),
  workMove: (rel: string, dest: string) => callOrThrow<string>("work_move", { rel, dest }),
  workTrash: (rel: string) => callOrThrow<void>("work_trash", { rel }),
  workToInbox: (rel: string) => callOrThrow<{ name: string; path: string; size: number }>("work_to_inbox", { rel }),
  workDrag: (rel: string) => callOrThrow<void>("work_drag", { rel }),
  /** Windows' folder dialog; the folder chosen becomes the work folder (null: cancelled). */
  workPick: () => callOrThrow<string | null>("work_pick"),
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
  /** The engine's summary for the recap card, when there is one for today (giornata.rs). */
  dailyAiText: (which: "morning" | "evening") => call<DayText | null>("daily_ai_text", { which }),
  /** «Chiedi il riassunto» on the recap card. */
  dailyAiWrite: (which: "morning" | "evening") => callOrThrow<void>("daily_ai_write", { which }),
  /** Repositories with changes not committed, pull requests waiting (daily.rs). */
  dailyDigest: () => call<DailyDigest>("daily_digest"),
  /** A card from Claude Code: the button clicked, or why there is none ("closed", "hidden", "replaced"). */
  momentCardAnswer: (id: string, choice: string | null, reason: string | null) =>
    call<void>("moment_card_answer", { id, choice, reason }),
  /** EasyIsland's tools in Claude Code's user configuration (mcp_setup.rs). */
  mcpClaudeStatus: () => call<{ cli: boolean; installed: boolean; current: boolean; entry: string }>("mcp_claude_status"),
  mcpClaudeApply: (install: boolean) => callOrThrow<string>("mcp_claude_apply", { install }),
  mcpAgyStatus: () => call<{ cli: boolean; installed: boolean; current: boolean; entry: string }>("mcp_agy_status"),
  mcpAgyApply: (install: boolean) => callOrThrow<string>("mcp_agy_apply", { install }),
  recapClear: () => call<void>("recap_clear"),
  /** From the settings window: the island opens the recap. */
  recapShow: () => call<void>("recap_show"),
  dailyShow: () => call<void>("daily_show"),
  /** Lingua: the windows are rebuilt in the new language. */
  restartApp: () => call<void>("restart_app"),
  /** Profiles, backup. */
  switchProfile: (id: string) => call<void>("switch_profile", { id }),
  settingsExport: () => callOrThrow<string>("settings_export"),
  settingsImport: (text: string) => callOrThrow<{ settings: Settings; note: string }>("settings_import", { text }),
  currentNetwork: () => call<string | null>("current_network"),
  /** Settings window: MCP servers configured in Claude Code (names only). */
  mcpServersConfigured: () => call<string[]>("mcp_servers_configured"),
  /** Settings window: is Claude Code installed and signed in? */
  claudeCliStatus: () => call<ClaudeCliStatus>("claude_cli_status"),
  /** Copies a dropped file into the inbox. */
  ingestFile: (path: string) => callOrThrow<DroppedFile>("ingest_file", { path }),
  /** "Riquadra e chiedi" (screenshot.rs): freezes the screen under the mouse; where it is, in physical px. */
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

/** Impostazioni → Chat → Memoria (memory.rs `Info`). */
export interface MemoryInfo {
  notes: number;
  days: number;
  pages: number;
  inbox: number;
  folder: string;
}

/** One conversation in the chat history (chat_log.rs `Summary`); `updated` in ms. */
/** A memory page found from the field at the top (brain.rs PageHit). */
export interface MemoryHit {
  /** The memory window's node, "p:<slug>". */
  id: string;
  title: string;
  gist: string;
}

/** A Zammad ticket found from the field at the top (zammad.rs TicketHit). */
export interface TicketHit {
  title: string;
  url: string;
}

export interface ChatSummary {
  id: string;
  title: string;
  engine: string;
  updated: number;
  turns: number;
  /** 📌: on top, never dropped. */
  pinned?: boolean;
}

/** Something attached to the chat's question (files.rs → ChatAttachment). */
export interface ChatAttachment {
  name: string;
  path: string;
  folder: boolean;
}

export type ChatContext =
  | { kind: "file"; name: string; path: string }
  | { kind: "files"; files: ChatAttachment[] }
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
  running: boolean;
  at: number;
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
  | { name: "screen-changed"; payload: null }
  | { name: "click-away"; payload: null };

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

/** The frozen screen of "Riquadra e chiedi", physical px. */
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

export interface NotionMapStatus {
  databases: number;
  pages: number;
  at: number;
}

/** A run of a flow (flows.rs), as Impostazioni → Esecuzioni lists it. */
export interface FlowRunInfo {
  id: string;
  flowId: string;
  name: string;
  cause: string;
  status: "running" | "done" | "failed" | "stopped";
  started: number;
  ended: number;
  steps: number;
}

export interface FlowRun {
  id: string;
  flow: import("./state").Automation;
  cause: string;
  status: FlowRunInfo["status"];
  started: number;
  ended: number;
  trace: { node: string; kind: string; what: string; ok: boolean; out: string; at: number }[];
}
