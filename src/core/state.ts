// App state — mirror of AppState.swift (the parts the island needs).

import type { AnchorH, AnchorV, BotEmoteName, BotStateName, IslandMode, IslandViewName } from "./layout";
import type { EyeShape } from "../character/engine";

/** "agent": Codex, Gemini CLI or any tool that sends `easyisland_agent` (hooks.ts). */
export type AgentSource = "claudeCode" | "n8n" | "agent";
export type PillBadge = "approval" | "finished" | "error";

export interface AgentTask {
  id: string;
  name: string;
  color: string;
  state: BotStateName;
  stepIndex: number;
  /** The last 20 steps only; `stepSeq` counts every step ever added. */
  steps: string[];
  /** Steps added since the session started: steps[i] is step number stepSeq - steps.length + i. */
  stepSeq?: number;
  /** Claude's last message when the session finished (relay: easyisland_last_message). */
  lastMessage?: string | null;
  source: AgentSource;
  isIntegration: boolean;
  emote?: BotEmoteName | null;
  miniEye?: EyeShape | null;
  pillBadge?: PillBadge | null;
  sessionCwd?: string | null;
  /** Where the Claude Code session runs, so "Apri" brings back the right app. */
  sessionHost?: SessionHost | null;
  /** An agent's own name ("Codex", "Gemini CLI"); `name` is then its project. */
  agentName?: string;
}

/** A coding session: Claude Code's task, or another agent's (`agent:<id>`). */
export function isSessionTask(t: AgentTask | null | undefined): boolean {
  return !!t && (t.id === "integration_claude" || t.id.startsWith("agent:"));
}

export type ChatEngine = "subscription" | "api" | "openrouter" | "openai" | "gemini" | "ollama" | "lmstudio";

/** The chat engines: name, Credential Manager key (if any), default address (local ones). */
export const CHAT_ENGINES: { id: ChatEngine; name: string; key?: string; url?: string; hint: string }[] = [
  { id: "subscription", name: "Claude (abbonamento)", hint: "Claude Code su questo PC e il tuo piano Claude" },
  { id: "api", name: "Claude (chiave API)", key: "anthropic-api-key", hint: "API di Anthropic, a consumo" },
  { id: "openrouter", name: "OpenRouter", key: "openrouter-api-key", hint: "una chiave per centinaia di modelli (openrouter.ai)" },
  { id: "openai", name: "OpenAI", key: "openai-api-key", hint: "API di OpenAI (platform.openai.com)" },
  { id: "gemini", name: "Gemini", key: "gemini-api-key", hint: "Google AI Studio (aistudio.google.com)" },
  { id: "ollama", name: "Ollama", url: "http://localhost:11434", hint: "modelli locali, nessuna chiave" },
  { id: "lmstudio", name: "LM Studio", url: "http://localhost:1234", hint: "modelli locali, nessuna chiave" },
];

/** "Gemini · gemini-2.5-flash": the engine and its model, for the chat. */
export function engineLabel(s: { chatEngine: ChatEngine; engineModels?: Record<string, string>; cliModel?: string; model?: string }): string {
  const e = CHAT_ENGINES.find((x) => x.id === s.chatEngine) ?? CHAT_ENGINES[0];
  const model = s.chatEngine === "subscription" ? s.cliModel || "" : s.chatEngine === "api" ? s.model ?? "" : s.engineModels?.[s.chatEngine] ?? "";
  return model ? `${e.name} · ${model}` : e.name;
}

/** One file edit of the Claude Code session, as the relay computed it (hook/src/diff.rs). */
export interface FileDiff {
  id: number;
  /** The session's task: integration_claude or agent:<id>. */
  task: string;
  /** Full path, as Claude Code wrote it. */
  file: string;
  added: number;
  removed: number;
  /** Past 200 KB or 4,000 lines: counts only. */
  tooBig: boolean;
  /** `old` / `new`: first line numbers, 0 when unknown. Lines start with "+", "-" or " ". */
  hunks: { old: number; new: number; lines: string[] }[];
  at: number;
}

/** Diffs kept per session, and for how long (memory only). */
export const MAX_DIFFS = 50;
export const DIFF_TTL_MS = 60 * 60 * 1000;

/** The Claude desktop app, VS Code, Cursor, Windows Terminal, or any other console. */
export type SessionHost = "desktop" | "vscode" | "cursor" | "wt" | "terminal";

/** A message card in the island: from a script (`easyisland-hook notify`) or an update. */
export interface Notice {
  title: string;
  text: string;
  level: "ok" | "warn" | "error" | "info";
  url: string;
  /** A new version to install with a click (the update notice). */
  install?: string;
  /** A proposal from the habits (fingerprint): Crea / Non ora / No, mai. */
  suggestion?: string;
  /** Its accept button: "Crea" or "Spegni". */
  suggestionAccept?: string;
}

/** An automation proposed from the user's habits (src-tauri/src/habits.rs). */
export interface HabitSuggestion {
  fp: string;
  title: string;
  text: string;
  automation: Partial<Automation> | { disable: string };
  /** Label of the accept button: "Crea" or "Spegni". */
  accept: string;
}

/** The label of the button that brings a session's app back. */
export function sessionOpenLabel(host: SessionHost | null | undefined): string {
  switch (host) {
    case "desktop": return "Apri Claude";
    case "vscode": return "Apri VS Code";
    case "cursor": return "Apri Cursor";
    default: return "Apri terminale";
  }
}

export interface ApprovalInfo {
  requestId: string;
  /** The session's task (Claude Code or another agent); absent = Claude Code. */
  taskId?: string;
  sessionId: string;
  tool: string;
  command: string;
  /** "chat": a connector call from the character's own chat, not a Claude Code session. */
  source?: "chat";
  /** AskUserQuestion: the questions to answer from the island. */
  questions?: AskQuestion[];
  /**
   * What "Sempre" would allow from now on, in words (Claude Code's own
   * permission_suggestions); absent when it proposed nothing usable.
   */
  always?: string;
}

/** One question of Claude Code's AskUserQuestion tool. */
export interface AskQuestion {
  question: string;
  header: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
}

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
}

export type PromptContext =
  | { kind: "window"; appName: string; title: string; url?: string }
  | { kind: "file"; name: string; path?: string };

export interface ResultItem {
  label: string;
  detail: string;
  url?: string;
}

export interface SearchResult {
  title: string;
  items: ResultItem[];
  note?: string;
}

const task = (
  id: string, name: string, color: string, source: AgentSource,
): AgentTask => ({
  id, name, color, state: "idle", stepIndex: 0, steps: [], source, isIntegration: true,
});

/**
 * Integrations that run as checks through the widget engine (src-tauri/src/widgets.rs,
 * settings::PROBE_INTEGRATIONS): their results arrive as `widget-update` with the
 * integration's id, and their cards are drawn like a widget's. id → probe kind.
 */
export const PROBE_INTEGRATIONS: Record<string, string> = {
  integration_system: "system",
  integration_security: "security",
  integration_network: "network",
  integration_weather: "weather",
  integration_outlook: "outlook",
  integration_zammad: "zammad",
};

/** AgentTask.integrationAgents — same ids, names and colours as macOS. */
export const INTEGRATION_AGENTS: AgentTask[] = [
  task("integration_claude", "VS Code", "#F5F6F8", "claudeCode"),
  task("integration_resend", "Resend", "#22C55E", "n8n"),
  task("integration_n8n", "n8n", "#F29B38", "n8n"),
  task("integration_vercel", "Vercel", "#7C5CFF", "n8n"),
  task("integration_github", "GitHub", "#F4505E", "n8n"),
  task("integration_notion", "Notion", "#8C8C8C", "n8n"),
  task("integration_calcom", "Cal.com", "#C9956A", "n8n"),
  task("integration_stripe", "Stripe", "#0570DE", "n8n"),
  task("integration_system", "PC", "#38BDF8", "n8n"),
  task("integration_security", "Sicurezza", "#22C55E", "n8n"),
  task("integration_network", "Rete", "#6366F1", "n8n"),
  task("integration_weather", "Meteo", "#0EA5E9", "n8n"),
  task("integration_outlook", "Outlook", "#0A84D6", "n8n"),
  task("integration_zammad", "Ticket", "#F59E0B", "n8n"),
  task("integration_clipboard", "Appunti", "#A78BFA", "n8n"),
  task("integration_media", "Musica", "#1ED760", "n8n"),
  task("integration_3cx", "3CX", "#0596D4", "n8n"),
];

export const TOGGLEABLE_INTEGRATION_IDS = [
  "integration_resend", "integration_n8n", "integration_vercel", "integration_github",
  "integration_notion", "integration_calcom", "integration_stripe",
  ...Object.keys(PROBE_INTEGRATIONS),
  "integration_clipboard", "integration_media", "integration_3cx",
];

/** What an integration poller last reported. */
export interface IntegrationInfo {
  data: Record<string, unknown>;
  error: string | null;
  loaded: boolean;
  configured: boolean;
}

export interface Settings {
  soundEnabled: boolean;
  soundVolume: number;
  autoCloseInterval: number;
  absenceInterval: number;
  activeIntegrations: string[];
  /** Integrations shown as a tab in the island's header instead of a pill. */
  integrationTabs: string[];
  /** Tabs that show an icon (emoji or short text) instead of the name: id → icon. */
  integrationTabIcons: Record<string, string>;
  /** Order of the pills, as dragged in the island (per profile). */
  pillOrder: string[];
  /** Order of the header's tabs, fixed ("tab:home"…) and integrations, as dragged (per profile). */
  tabOrder: string[];
  /** No dragging pills and tabs around in the island (this PC). */
  lockOrder: boolean;
  screen: "primary" | "cursor";
  autostart: boolean;
  hooksInstalled: boolean;
  /** Claude model used by the chat with an API key. */
  model: string;
  /**
   * "subscription" = Claude Code (`claude -p`, Claude plan), "api" = Anthropic
   * API key, or an OpenAI-compatible engine (openai.rs).
   */
  chatEngine: ChatEngine;
  /** Model chosen for each OpenAI-compatible engine. */
  engineModels?: Record<string, string>;
  /** Address of the local servers (ollama, lmstudio); empty = their default. */
  engineUrls?: Record<string, string>;
  /** Model alias for the Claude Code engine; "" = Claude Code's default. */
  cliModel: string;
  /** Where the island sits; content opens aligned to that side. */
  anchorV: AnchorV;
  anchorH: AnchorH;
  /** Where the character was dragged: logical px from the anchored home position. */
  offsetX: number;
  offsetY: number;
  /** Touch the screen edge (square corners) when left at it, not only top centre. */
  glueEdges: boolean;
  /** Use the whole screen, taskbar included, instead of the work area. */
  overTaskbar: boolean;
  /** ✕ in the open island's header. */
  closeButton: boolean;
  /** The compact view follows the cursor too (the open island always does). */
  followCursorCompact: boolean;
  /** "Davanti al cliente" during a call (microphone or webcam in use). */
  presenceMeeting: boolean;
  /** … while someone is connected to this PC (Remote Desktop, Quick Assist, TeamViewer). */
  presenceRemote: boolean;
  /** More executables that mean remote help is on. */
  presenceApps: string[];
  /** "hide": the character disappears (permission requests still show); "silent": no sounds only. */
  presenceMode: "hide" | "silent";
  /** What stays visible at rest. "none" = the old invisible wake strip. */
  iconStyle: "character" | "dot" | "none";
  /** Rest icon size, px. */
  iconSize: number;
  /** What the hover shows: a bigger live the character, or the compact bar. */
  hoverStyle: "icon" | "bar";
  /** Hovered icon size, px. */
  hoverSize: number;
  /** Seconds of hover before the island opens; 0 = only on click. */
  openDelay: number;
  /** Seconds the hover icon / bar stays up after the mouse leaves or an event. */
  revealDuration: number;
  /** Stay out of the way while a full-screen app runs. */
  quietFullscreen: boolean;
  schemaVersion: number;
  theme: Theme;
  /** What may surface the island: everything, alerts only, or permissions only. */
  notify: "all" | "alerts" | "permissions";
  /** Quick actions (6.2). */
  actions: QuickAction[];
  /** Configurable widgets (6.4). */
  widgets: WidgetDef[];
  /** MCP servers the chat may use (6.3); `confirm` = ask before every call. */
  mcpServers: { name: string; confirm: boolean }[];
  profiles: Profile[];
  activeProfile: string;
  autoProfile: boolean;
  /** Global shortcuts ("" = none); they belong to the PC, not to a profile. */
  hotkeyOpen: string;
  hotkeyAsk: string;
  /** Opens the clipboard history (Appunti). */
  hotkeyClipboard: string;
  /** Captures a zone of the screen and asks Claude about it. */
  hotkeyScreenshot: string;
  /** Goes to the permission or question waiting for an answer. */
  hotkeyPending: string;
  /** Brings the session's app to the front. */
  hotkeySession: string;
  /** The next pill. */
  hotkeyNextPill: string;
  /** Sounds on / off. */
  hotkeyMute: string;
  /** ⚡ tab: actions suggested for the app in front. */
  contextActions: boolean;
  /** The chat (Claude Code engine) may use EasyIsland's tools: open programs, quick actions… */
  agentTools: boolean;
  /** "Quando… allora…" rules, run by src-tauri/src/automations.rs. */
  automations: Automation[];
  /** Record what happens on the PC to propose automations; off until switched on. */
  habitsEnabled: boolean;
  /** Proposals refused with "No, mai" (kept, and can be undone). */
  suggestionsDismissed: { fp: string; title: string; text: string; at: number }[];
  /** "Non ora": fingerprint → ms. */
  suggestionsSnoozed: Record<string, number>;
  /** "Programmi da non osservare" (exe names). */
  habitsExcluded: string[];
  /** Look for a new version on GitHub at start and once a day. */
  updateCheck: boolean;
  /** Options of the integrations that run as checks (PROBE_INTEGRATIONS). Belongs to the PC. */
  integrationConfig: IntegrationConfig;
}

export interface IntegrationConfig {
  /** Stato del PC: warn below this % of free space on the system disk. */
  systemWarn: number;
  /** Outlook: warn this many minutes before a meeting. */
  outlookWarn: number;
  weatherCity: string;
  /** 3CX: "user" (the extension's own login) or "api" (an API client). */
  threecxMode: "user" | "api";
  /** 3CX, API mode: the extension the API client monitors. */
  threecxExtension: string;
  /** 3CX: the device that places calls; "" = automatic. */
  threecxDevice: string;
}

/** A user-defined button in the Azioni tab. */
export interface QuickAction {
  id: string;
  name: string;
  /** An emoji or a short text shown on the button. */
  icon: string;
  color: string;
  kind: "url" | "app" | "script" | "prompt";
  /** url: the link · app: program, folder or file. */
  target: string;
  /** app: arguments, quotes group words. */
  args: string;
  /** script: the commands. */
  script: string;
  shell: "powershell" | "cmd";
  /** prompt: what Claude is asked. */
  prompt: string;
  /** prompt: what the prompt is applied to. */
  input: "clipboard" | "file" | "none";
  /** script: show the commands and wait for "Esegui". */
  confirm: boolean;
  /** Optional global shortcut, e.g. "Ctrl+Alt+E". */
  hotkey: string;
}

/** A probe the user set up in the settings (src-tauri/src/widgets.rs). */
/** When an automation starts (src-tauri/src/automations.rs). */
export interface AutomationTrigger {
  kind: "time" | "startup" | "unlock" | "wifi" | "app" | "drive" | "folder" | "integration";
  /** time: "HH:MM". */
  time: string;
  /** time: 1 = Monday … 7 = Sunday; empty = every day. */
  days: number[];
  /** startup: seconds after EasyIsland starts. */
  delay: number;
  ssid: string;
  /** app: executable, e.g. "teams.exe". */
  exe: string;
  folder: string;
  /** integration: id of the integration or widget. */
  source: string;
  when: "problem" | "event" | "any";
}

/** One thing an automation does. */
export interface AutomationStep {
  kind: "quick" | "notice" | "profile" | "app" | "url";
  /** quick: action id · profile: profile id. */
  id: string;
  title: string;
  text: string;
  level: string;
  target: string;
  args: string;
  url: string;
}

/** "Quando… (se…) allora…" — Impostazioni → Automazioni. Belongs to the PC. */
export interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  /** Only while this profile is active; "" = any. */
  profile: string;
  steps: AutomationStep[];
  /** A notice every time it runs (errors always show). */
  notify: boolean;
}

export interface WidgetDef {
  id: string;
  name: string;
  color: string;
  kind: "ping" | "tcp" | "http" | "tls" | "service" | "json" | "calendar" | "domain";
  /** Seconds between checks; 0 = the kind's default. */
  every: number;
  url: string;
  method: "GET" | "POST";
  /** `secret` headers keep their value in the Credential Manager. */
  headers: { name: string; value: string; secret: boolean }[];
  fields: { label: string; path: string }[];
  alert: { path: string; op: string; value: string } | null;
  host: string;
  port: number;
  expectStatus: number;
  warnDays: number;
  service: string;
}

/** Last result of a widget check. */
export interface WidgetStatus {
  id: string;
  level: "ok" | "warn" | "error";
  summary: string;
  fields: { label: string; value: string }[];
  /** Unix seconds. */
  at: number;
  /** Something that just happened (a new ticket), announced even when the level stays the same. */
  event?: string;
}

/** A script launched from the Azioni tab. */
export interface ScriptRun {
  action: QuickAction;
  runId: string;
  status: "confirm" | "running" | "done" | "error";
  output: string;
  code: number | null;
  timedOut: boolean;
}

export interface Theme {
  /** Who lives in the island: the character, or the cube (src/character/cube.ts). */
  /** A character id from src/character/roster.ts ("slime", "cube", "drop"…). */
  character: string;
  /** "#rrggbb", or "" for the original cream (the logo's orange for the cube). */
  slimeColor: string;
  islandColor: string;
  islandOpacity: number;
  /** Volume multipliers per sound family, 0–1. */
  volumeAlerts: number;
  volumeUi: number;
  volumeEmotes: number;
  /** The island's colour behind the character while it is closed; off = the character alone. */
  compactBackground: boolean;
}

export interface ProfileRules {
  ssids: string[];
  /** 1 = Monday … 7 = Sunday. */
  days: number[];
  from: string;
  to: string;
}

export interface Profile {
  id: string;
  name: string;
  values: Record<string, unknown>;
  rules: ProfileRules;
}

export const DEFAULT_THEME: Theme = {
  character: "slime",
  slimeColor: "",
  islandColor: "#000000",
  islandOpacity: 1,
  volumeAlerts: 1,
  volumeUi: 1,
  volumeEmotes: 1,
  compactBackground: true,
};

export const DEFAULT_SETTINGS: Settings = {
  soundEnabled: true,
  soundVolume: 0.12,
  autoCloseInterval: 15,
  absenceInterval: 180,
  activeIntegrations: [
    "integration_resend", "integration_n8n", "integration_vercel", "integration_github",
  ],
  integrationTabs: [],
  integrationTabIcons: {},
  pillOrder: [],
  tabOrder: [],
  lockOrder: false,
  screen: "primary",
  autostart: false,
  hooksInstalled: false,
  model: "claude-opus-5-5",
  chatEngine: "subscription",
  cliModel: "",
  anchorV: "top",
  anchorH: "center",
  offsetX: 0,
  offsetY: 0,
  glueEdges: true,
  overTaskbar: false,
  closeButton: true,
  followCursorCompact: false,
  presenceMeeting: true,
  presenceRemote: true,
  presenceApps: [],
  presenceMode: "hide",
  iconStyle: "character",
  iconSize: 24,
  hoverStyle: "icon",
  hoverSize: 40,
  openDelay: 0.6,
  revealDuration: 8,
  quietFullscreen: true,
  schemaVersion: 2,
  theme: { ...DEFAULT_THEME },
  notify: "all",
  actions: [],
  widgets: [],
  mcpServers: [],
  profiles: [],
  activeProfile: "",
  autoProfile: false,
  hotkeyOpen: "Ctrl+Alt+Shift+M",
  hotkeyAsk: "Ctrl+Alt+K",
  hotkeyClipboard: "Ctrl+Alt+H",
  hotkeyScreenshot: "Ctrl+Alt+Shift+S",
  hotkeyPending: "Ctrl+Alt+Shift+P",
  hotkeySession: "Ctrl+Alt+Shift+T",
  hotkeyNextPill: "",
  hotkeyMute: "",
  contextActions: true,
  agentTools: true,
  automations: [],
  habitsEnabled: false,
  suggestionsDismissed: [],
  suggestionsSnoozed: {},
  habitsExcluded: [],
  updateCheck: true,
  integrationConfig: {
    systemWarn: 10, outlookWarn: 10, weatherCity: "",
    threecxMode: "user", threecxExtension: "", threecxDevice: "",
  },
};

type Listener = () => void;

class AppState {
  mode: IslandMode = "hidden";
  view: IslandViewName = "overview";

  /** 📌 in the header: the island stays open until unpinned, Esc or ✕. */
  keepOpen = false;

  /** The app in front when the island last opened (src/island/context.ts). */
  foreground: { exe: string; title: string } | null = null;

  tasks: AgentTask[] = [];
  focusId: string | null = null;

  stateOverride: BotStateName | null = null;

  /** Cursor in logical screen pixels, origin top-left (like AppState.mousePosition). */
  mouse = { x: 0, y: 0 };
  /** Cursor relative to the island's top-left corner. */
  mouseInIsland = { x: 0, y: 0 };

  isPinned = false;
  paused = false;
  /** A full-screen app is in front (reported by Rust every couple of seconds). */
  fullscreen = false;
  /** "Davanti al cliente" (src-tauri/src/presence.rs): why, or inactive. */
  presence = { active: false, reason: "" };
  /** The last message from `easyisland-hook notify`. */
  notice: Notice | null = null;

  /** The character keeps out of sight: over a full-screen app, or in front of a client. */
  get quiet(): boolean {
    return (this.fullscreen && this.settings.quietFullscreen) ||
      (this.presence.active && this.settings.presenceMode !== "silent");
  }

  uploadProgress = 0;
  uploadDuration = 2.4;
  fileDragOver = false;

  promptContext: PromptContext | null = null;
  /** `source`: where the file was dropped from (the copy is in `path`). */
  droppedFile: { name: string; path: string; source?: string } | null = null;
  /** "File caricati": the inbox, as last listed. */
  inbox: { name: string; path: string; size: number; at: number }[] | null = null;
  /** "Estrai…" on a dropped ZIP: what is inside, and how the extraction went. */
  unzip: {
    info: { count: number; size: number; names: string[] } | null;
    status: "loading" | "ready" | "working" | "done" | "error";
    message: string;
  } | null = null;
  /** Text the chat is about (clipboard, a quick action) — sent with the first message. */
  chatText: { label: string; text: string } | null = null;
  /** The script being confirmed / run / shown in the Run view. */
  run: ScriptRun | null = null;
  /** Latest result per widget id. */
  widgetStatus: Record<string, WidgetStatus> = {};
  noteMessage: string | null = null;
  searchResult: SearchResult | null = null;
  chatHistory: ChatMessage[] = [];
  pendingApproval: ApprovalInfo | null = null;

  /** File edits of the Claude Code session (addDiff); cleared when it starts or ends. */
  diffs: FileDiff[] = [];
  private diffSeq = 0;
  /** The file the diff view shows, and whose session it belongs to. */
  diffFile: string | null = null;
  diffTask: string | null = null;

  /** Another agent's pill, made when its first event arrives (hooks.ts). */
  ensureAgentTask(id: string, name: string, color: string) {
    if (this.tasks.some((t) => t.id === id)) return;
    this.tasks.push({ ...task(id, name, color, "agent"), agentName: name, isIntegration: false });
    this.notify();
  }

  /** An agent's session ended: its pill goes. */
  removeTask(id: string) {
    this.tasks = this.tasks.filter((t) => t.id !== id);
    if (this.focusId === id) this.focusId = "integration_claude";
    this.notify();
  }

  integrations: Record<string, IntegrationInfo> = {};

  lastActivity = performance.now();

  settings: Settings = { ...DEFAULT_SETTINGS };

  private listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Marks the UI dirty; the island re-renders on the next frame. */
  notify() {
    for (const fn of this.listeners) fn();
  }

  get focusTask(): AgentTask | null {
    return this.tasks.find((t) => t.id === this.focusId) ?? this.tasks[0] ?? null;
  }

  get effectiveState(): BotStateName {
    return this.stateOverride ?? this.focusTask?.state ?? "idle";
  }

  /** Pills in the overview: everything but the focused task and the header tabs. */
  get otherTasks(): AgentTask[] {
    return this.tasks.filter((t) => t.id !== this.focusId && !this.isTab(t.id));
  }

  /** Active integrations the user put in the header as tabs, in pill order. */
  get tabTasks(): AgentTask[] {
    return this.tasks.filter((t) => this.isTab(t.id));
  }

  isTab(id: string): boolean {
    return (this.settings.integrationTabs ?? []).includes(id);
  }

  setFocus(id: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    this.focusId = id;
    t.pillBadge = null;
    this.notify();
  }

  updateTask(id: string, state: BotStateName) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    t.state = state;
    this.notify();
  }

  appendStep(id: string, step: string) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    t.steps.push(step);
    if (t.steps.length > 20) t.steps.shift();
    t.stepIndex = t.steps.length - 1;
    // stepIndex stops at 19 once the list is full; the ticker follows this instead.
    t.stepSeq = (t.stepSeq ?? t.steps.length - 1) + 1;
    this.notify();
  }

  /** Rewrites the newest step equal to `from` (still among the last 20). */
  replaceStep(id: string, from: string, to: string) {
    const t = this.tasks.find((x) => x.id === id);
    const i = t ? t.steps.lastIndexOf(from) : -1;
    if (!t || i < 0) return;
    t.steps[i] = to;
    this.notify();
  }

  /** A file edit of the Claude Code session: newest last, 50 at most, an hour at most. */
  addDiff(d: Omit<FileDiff, "id" | "at">) {
    this.pruneDiffs();
    this.diffs.push({ ...d, id: ++this.diffSeq, at: Date.now() });
    if (this.diffs.length > MAX_DIFFS) this.diffs.splice(0, this.diffs.length - MAX_DIFFS);
    this.notify();
  }

  pruneDiffs() {
    const cutoff = Date.now() - DIFF_TTL_MS;
    if (this.diffs.some((d) => d.at < cutoff)) this.diffs = this.diffs.filter((d) => d.at >= cutoff);
  }

  /** A session's files (`task`, or all), newest edit first, with the edits added up. */
  diffFiles(task?: string | null): { file: string; added: number; removed: number; edits: number }[] {
    const out = new Map<string, { file: string; added: number; removed: number; edits: number }>();
    for (const d of [...this.diffs].reverse()) {
      if (task && d.task !== task) continue;
      const f = out.get(d.file) ?? { file: d.file, added: 0, removed: 0, edits: 0 };
      f.added += d.added;
      f.removed += d.removed;
      f.edits += 1;
      out.set(d.file, f);
    }
    return [...out.values()];
  }

  setPillBadge(id: string, badge: PillBadge | null) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    t.pillBadge = badge;
    this.notify();
  }

  /** loadIntegrationTasks() — VS Code always on, the rest opt-in. */
  loadIntegrationTasks() {
    for (const proto of INTEGRATION_AGENTS) {
      const shouldLoad =
        proto.id === "integration_claude" || this.settings.activeIntegrations.includes(proto.id);
      const idx = this.tasks.findIndex((t) => t.id === proto.id);
      if (shouldLoad && idx < 0) this.tasks.push({ ...proto, steps: [] });
      if (!shouldLoad && idx >= 0) this.tasks.splice(idx, 1);
    }
    // Widgets follow the integrations, in the order they were defined.
    const widgets = this.settings.widgets ?? [];
    this.tasks = this.tasks.filter(
      (t) => !t.id.startsWith("widget:") || widgets.some((w) => `widget:${w.id}` === t.id),
    );
    for (const w of widgets) {
      const id = `widget:${w.id}`;
      const existing = this.tasks.find((t) => t.id === id);
      if (existing) {
        existing.name = w.name || "Widget";
        existing.color = w.color || "#8E939C";
      } else {
        this.tasks.push(task(id, w.name || "Widget", w.color || "#8E939C", "n8n"));
      }
    }
    // The order the user dragged them into, then the declared order, so pills never shuffle.
    const order = [
      ...INTEGRATION_AGENTS.map((t) => t.id),
      ...widgets.map((w) => `widget:${w.id}`),
    ];
    const user = this.settings.pillOrder ?? [];
    const rank = (id: string) => {
      const i = user.indexOf(id);
      return i >= 0 ? i : user.length + order.indexOf(id);
    };
    this.tasks.sort((a, b) => rank(a.id) - rank(b.id));
    if (this.focusId && !this.tasks.some((t) => t.id === this.focusId)) {
      this.focusId = "integration_claude";
    }
    if (!this.focusId) this.focusId = "integration_claude";
    this.notify();
  }

  /**
   * Pills or tabs were dragged into `ids` order. Only those move: they take the
   * places they held among all the tasks, so the others stay where they were.
   */
  reorder(ids: string[]) {
    const all = this.tasks.map((t) => t.id);
    const slots = ids.map((id) => all.indexOf(id)).filter((i) => i >= 0).sort((a, b) => a - b);
    if (slots.length !== ids.length) return;
    const next = [...all];
    slots.forEach((slot, k) => { next[slot] = ids[k]; });
    this.settings.pillOrder = next;
    this.loadIntegrationTasks();
  }

  toggleIntegration(id: string) {
    if (id === "integration_claude") return;
    const active = this.settings.activeIntegrations;
    if (active.includes(id)) {
      this.settings.activeIntegrations = active.filter((x) => x !== id);
      if (this.focusId === id) this.focusId = "integration_claude";
    } else {
      this.settings.activeIntegrations = [...active, id];
    }
    this.loadIntegrationTasks();
  }

  /** The card a pending permission request waits on, if there is one. */
  pendingCard(): IslandViewName | null {
    const p = this.pendingApproval;
    return p ? (p.questions ? "ask" : "approval") : null;
  }

  /** Where the island opens: a request waiting for an answer comes first. */
  defaultView(): IslandViewName {
    return this.pendingCard() ?? (this.tasks.length === 0 ? "empty" : "overview");
  }
}

export const State = new AppState();
