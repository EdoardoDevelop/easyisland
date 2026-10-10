// App state — mirror of AppState.swift (the parts the island needs).

import type { AnchorH, AnchorV, BotEmoteName, BotStateName, IslandMode, IslandViewName } from "./layout";
import type { EyeShape } from "../character/engine";
import type { PlanItem } from "../island/plan";
import { isSky, type Sky } from "../character/weather";
import { t } from "./i18n";

const WEATHER = "integration_weather";

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
  /** The agent's plan, rebuilt from its plan tools (src/island/plan.ts). */
  plan?: PlanItem[];
  /** Claude Code's permission mode ("plan", "acceptEdits", "bypassPermissions"…), from every event. */
  permissionMode?: string | null;
  /** The agent's own process, found by the relay: the session is over when it is gone. */
  sessionPid?: { pid: number; exe: string } | null;
  /** The agent's session id (Claude Code's uuid, opencode's `ses_…`): "Continua" and "Chiedi". */
  sessionId?: string | null;
  /** Claude Code's CLAUDE_CODE_ENTRYPOINT ("cli", "claude-vscode", "claude-desktop"…). */
  sessionEntry?: string | null;
  /** When its last hook event arrived (ms): the Agenti tab opens on the most recent agent. */
  lastActive?: number;
}

/**
 * How "Continua" reaches a session: typed into its console, prefilled in the VS
 * Code / Cursor extension, or through opencode's service. Null where it cannot
 * (the Claude app, a session that is over). src-tauri/src/session_reply.rs.
 */
export function replyMode(t: AgentTask | null | undefined): { mode: "console" | "link" | "opencode"; scheme?: "vscode" | "cursor" } | null {
  if (!t || !isSessionTask(t)) return null;
  if (t.sessionHost === "opencode") return t.sessionId ? { mode: "opencode" } : null;
  if (t.sessionEntry === "claude-vscode") return { mode: "link", scheme: t.sessionHost === "cursor" ? "cursor" : "vscode" };
  if (t.sessionHost === "desktop") return null;
  return t.sessionPid ? { mode: "console" } : null;
}

/** "Chiedi a questa sessione": Claude Code sessions with an id and a folder. */
export function canAskSession(t: AgentTask | null | undefined): boolean {
  return !!t && t.id === "integration_claude" && !!t.sessionId && !!t.sessionCwd;
}

/** A coding session: Claude Code's task, or another agent's (`agent:<id>`). */
export function isSessionTask(t: AgentTask | null | undefined): boolean {
  return !!t && (t.id === "integration_claude" || t.id.startsWith("agent:"));
}

export type ChatEngine = "subscription" | "api" | "opencode" | "openrouter" | "openai" | "gemini" | "ollama" | "lmstudio";

/** The chat engines: name, Credential Manager key (if any), default address (local ones). */
export const CHAT_ENGINES: { id: ChatEngine; name: string; key?: string; url?: string; hint: string }[] = [
  { id: "subscription", name: t("Claude (abbonamento)"), hint: t("il tuo piano Pro o Max, serve Claude Code da riga di comando con il login") },
  { id: "api", name: t("Claude (chiave API)"), key: "anthropic-api-key",
 hint: t("API di Anthropic, a consumo") },
  { id: "opencode", name: "opencode", hint: t("modelli gratuiti o locali con strumenti (comandi, file, web), con i permessi nell'isola; serve opencode 2 sul PC") },
  { id: "openrouter", name: "OpenRouter", key: "openrouter-api-key", hint: t("una chiave per centinaia di modelli (openrouter.ai)") },
  { id: "openai", name: "OpenAI", key: "openai-api-key", hint: t("API di OpenAI (platform.openai.com)") },
  { id: "gemini", name: "Gemini", key: "gemini-api-key", hint: t("Google AI Studio (aistudio.google.com)") },
  { id: "ollama", name: "Ollama", url: "http://localhost:11434", hint: t("modelli locali, nessuna chiave") },
  { id: "lmstudio", name: "LM Studio", url: "http://localhost:1234", hint: t("modelli locali, nessuna chiave") },
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
export type SessionHost = "desktop" | "vscode" | "cursor" | "wt" | "terminal" | "opencode";

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
    case "desktop": return t("Apri Claude");
    case "vscode": return t("Apri VS Code");
    case "cursor": return t("Apri Cursor");
    case "opencode": return t("Apri opencode");
    default: return t("Apri terminale");
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
  /** What deserves a second look before allowing it (src/island/risk.ts). */
  risks?: string[];
  /** ExitPlanMode: the plan to approve, in markdown. */
  plan?: string;
  /** Tool and what it acts on, as first received: how hooks.ts recognises the same call ran. */
  target?: string;
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
  integration_claude_usage: "claude_usage",
};

export const CLAUDE_TASK = "integration_claude";
/** opencode's agent task (hook/src/agents.rs gives it this name and colour). */
const OPENCODE_TASK = "agent:opencode";

/** AgentTask.integrationAgents — same ids, names and colours as macOS. */
export const INTEGRATION_AGENTS: AgentTask[] = [
  task("integration_claude", "Claude Code", "#F5F6F8", "claudeCode"),
  task("integration_resend", "Resend", "#22C55E", "n8n"),
  task("integration_n8n", "n8n", "#F29B38", "n8n"),
  task("integration_vercel", "Vercel", "#7C5CFF", "n8n"),
  task("integration_github", "GitHub", "#F4505E", "n8n"),
  task("integration_notion", "Notion", "#8C8C8C", "n8n"),
  task("integration_calcom", "Cal.com", "#C9956A", "n8n"),
  task("integration_stripe", "Stripe", "#0570DE", "n8n"),
  task("integration_system", "PC", "#38BDF8", "n8n"),
  task("integration_security", t("Sicurezza"), "#22C55E", "n8n"),
  task("integration_network", t("Rete"), "#6366F1", "n8n"),
  task("integration_weather", t("Meteo"), "#0EA5E9", "n8n"),
  task("integration_outlook", "Outlook", "#0A84D6", "n8n"),
  task("integration_zammad", t("Ticket"), "#F59E0B", "n8n"),
  task("integration_claude_usage", t("Consumo"), "#D97757", "n8n"),
  task("integration_clipboard", t("Appunti"), "#A78BFA", "n8n"),
  task("integration_media", t("Musica"), "#1ED760", "n8n"),
  task("integration_3cx", "3CX", "#0596D4", "n8n"),
];

/** "Apri" on an integration card: its web dashboard… */
export const OPEN_URLS: Record<string, string> = {
  integration_resend: "https://resend.com/emails",
  integration_vercel: "https://vercel.com/dashboard",
  integration_github: "https://github.com",
  integration_stripe: "https://dashboard.stripe.com/payments",
  integration_notion: "https://notion.so",
  integration_calcom: "https://app.cal.com/bookings",
};
/** …the Windows tool or server it watches (open_integration in lib.rs)… */
export const OPENED_BY_APP = new Set([
  "integration_n8n", "integration_zammad", "integration_system", "integration_security",
  "integration_network", "integration_clipboard", "integration_weather", "integration_outlook", "integration_3cx",
]);
/** …and nothing for the others: no "Apri" button there. */
export function canOpen(t: AgentTask | null): boolean {
  return !!t && (isSessionTask(t) || !!OPEN_URLS[t.id] || OPENED_BY_APP.has(t.id));
}

/** States from least to most urgent: on the summary the character shows the top one. */
const URGENCY: BotStateName[] = [
  "idle", "sleeping", "finished", "searching", "thinking", "working", "ratelimit", "error", "question", "approval",
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
  /** The search bar at the bottom of the open island (src/views/search.ts). */
  searchBar: boolean;
  /** Interface language: "it", "en", or "" for Windows' own (src/core/i18n.ts). */
  language: string;
  /** The weekly recap of the coding agents (recap.rs, src/island/recap.ts). */
  weeklyRecap: boolean;
  /** The chat history (chat_log.rs), on this PC. */
  chatHistory: boolean;
  /** "primary", "cursor", or "monitor:<name>" (the display the character was dragged to). */
  screen: string;
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
  /** Width of the open island, px (dragged with its corner, or Impostazioni → Posizione). */
  islandWidth: number;
  /** Minimum height of the open island, px; 0 = each view's own height. */
  islandHeight: number;
  /** Where the open island appears: where the character is, or top / centre / bottom of the screen (island.rs). */
  islandPlace: "character" | "top" | "center" | "bottom";
  /** The greeting at launch; off, the character just shows up at its place. */
  greeting: boolean;
  /** Where the greeting plays: the centre of the screen, or where the character lives. */
  greetingPlace: "center" | "character";
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
  /** opencode 2's sessions in the island, from its background service (opencode_agent.rs). Of the PC. */
  opencodeWatch?: boolean;
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
  /** Meteo: the sky stays on the idle character, not only on the Meteo pill. */
  weatherOnCharacter: boolean;
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
  /** prompt: what the prompt is applied to ("selection": the text selected in the app in front). */
  input: "clipboard" | "selection" | "file" | "none";
  /** script: show the commands and wait for "Esegui". */
  confirm: boolean;
  /** Optional global shortcut, e.g. "Ctrl+Alt+E". */
  hotkey: string;
  /** Folder in the ⚡ tab ("" or missing: top level): "i:<icon> Name", "🖥 Name" or "Name". */
  folder?: string;
}

/** An action's folder split into icon and name; the name groups the actions. */
export function folderLook(folder: string | undefined): { icon: string; name: string } {
  const f = (folder ?? "").trim();
  const drawn = f.match(/^(i:[\w-]+)\s+(.+)$/);
  if (drawn) return { icon: drawn[1], name: drawn[2].trim() };
  const emoji = f.match(/^(\p{Extended_Pictographic}\uFE0F?)\s*(.*)$/u);
  if (emoji && emoji[2]) return { icon: emoji[1], name: emoji[2].trim() };
  return { icon: "i:folder", name: f };
}

/** Writes a folder back: its icon (unless the default) and its name. */
export function folderValue(icon: string, name: string): string {
  const n = name.trim();
  return !n ? "" : icon && icon !== "i:folder" ? `${icon} ${n}` : n;
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
  /** Meteo: the sky the character wears (character/weather.ts). */
  sky?: string;
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
  character: "drop",
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
  searchBar: true,
  weeklyRecap: true,
  chatHistory: true,
  language: "",
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
  islandWidth: 640,
  islandHeight: 0,
  islandPlace: "character",
  greeting: true,
  greetingPlace: "center",
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
  hotkeyOpen: "Ctrl+Space",
  hotkeyAsk: "Ctrl+Alt+K",
  hotkeyClipboard: "Ctrl+Alt+H",
  hotkeyScreenshot: "Ctrl+Alt+Shift+S",
  hotkeyPending: "Ctrl+Alt+Shift+P",
  hotkeySession: "Ctrl+Alt+Shift+T",
  hotkeyNextPill: "",
  hotkeyMute: "",
  contextActions: true,
  agentTools: true,
  opencodeWatch: false,
  automations: [],
  habitsEnabled: false,
  suggestionsDismissed: [],
  suggestionsSnoozed: {},
  habitsExcluded: [],
  updateCheck: true,
  integrationConfig: {
    systemWarn: 10, outlookWarn: 10, weatherCity: "", weatherOnCharacter: false,
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
  /** The ⌂ tab shows the summary of every integration instead of one card; any focus change leaves it. */
  summary = true;

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
  /** A file of the tray is being dragged out: the island ignores it (no drop view, no drop). */
  draggingOut = false;

  promptContext: PromptContext | null = null;
  /** `source`: where the file was dropped from (the copy is in `path`). */
  droppedFile: { name: string; path: string; source?: string } | null = null;
  /** The tray ("Vassoio"): the inbox, as last listed. */
  inbox: { name: string; path: string; size: number; at: number; kept?: boolean }[] | null = null;
  /** "Estrai…" on a dropped ZIP: what is inside, and how the extraction went. */
  unzip: {
    info: { count: number; size: number; names: string[] } | null;
    status: "loading" | "ready" | "working" | "done" | "error";
    message: string;
  } | null = null;
  /** Text the chat is about (clipboard, a quick action) — sent with the first message. */
  chatText: { label: string; text: string } | null = null;
  /** Put in the chat field once, not sent (an action with no selection: the text goes after it). */
  chatDraft: string | null = null;
  /** Added once to the chat field, after what is there (a folder the character was dropped on). */
  chatInsert: string | null = null;
  /**
   * "Chiedi a questa sessione": the chat asks a read-only copy of a Claude Code
   * session instead of its engine. `fork` is that copy, once the first answer made it.
   */
  chatSession: { sessionId: string; cwd: string; name: string; fork: string | null } | null = null;
  /** The script being confirmed / run / shown in the Run view. */
  run: ScriptRun | null = null;
  /** Latest result per widget id. */
  widgetStatus: Record<string, WidgetStatus> = {};
  noteMessage: string | null = null;
  searchResult: SearchResult | null = null;
  chatHistory: ChatMessage[] = [];
  /** The engine picked in the chat's menu for the conversation in progress; null = the default (settings.chatEngine). Never saved. */
  chatEngineOverride: ChatEngine | null = null;
  /** The engine the chat uses right now. */
  get chatEngine(): ChatEngine {
    return this.chatEngineOverride ?? this.settings.chatEngine;
  }
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

  /** A Claude Code event without the hooks known as installed: its task is there for the session. */
  ensureClaudeTask() {
    if (this.tasks.some((t) => t.id === CLAUDE_TASK)) return;
    this.tasks.push({ ...INTEGRATION_AGENTS.find((t) => t.id === CLAUDE_TASK)!, steps: [] });
    this.notify();
  }

  /**
   * The agent that stays in the Agenti tab between sessions: Claude Code when
   * its hooks are installed, else opencode when it is followed. None: the tab
   * shows only while a session runs.
   */
  get homeAgentId(): string | null {
    if (this.settings.hooksInstalled) return CLAUDE_TASK;
    return this.settings.opencodeWatch ? OPENCODE_TASK : null;
  }

  /** Where the focus goes when its task is gone. */
  private fallbackFocus(): string | null {
    return this.tasks.find((t) => t.id === this.homeAgentId)?.id ?? this.tasks[0]?.id ?? null;
  }

  /** An agent's session ended: its pill goes. */
  removeTask(id: string) {
    this.tasks = this.tasks.filter((t) => t.id !== id);
    if (this.focusId === id) this.focusId = this.fallbackFocus();
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

  /** The coding agents' sessions (Claude Code and agent:<id>), most recent first. */
  get sessionTasks(): AgentTask[] {
    return this.tasks.filter((t) => isSessionTask(t)).sort((a, b) => (b.lastActive ?? 0) - (a.lastActive ?? 0));
  }

  /** The agent the Agenti tab opens on: the one heard from last (else the home agent). */
  get latestSessionTask(): AgentTask | null {
    return this.sessionTasks.find((t) => t.lastActive)
      ?? this.tasks.find((t) => t.id === this.homeAgentId)
      ?? this.sessionTasks[0]
      ?? null;
  }

  /** ⌂ shows every integration (not while a permission or a question waits). */
  get showsSummary(): boolean {
    return this.summary && !this.pendingApproval;
  }

  /**
   * The task the character speaks for: the focused one, or none on the summary
   * (then it keeps its own colour and shows the most urgent state of all).
   */
  get characterTask(): AgentTask | null {
    return this.showsSummary ? null : this.focusTask;
  }

  get effectiveState(): BotStateName {
    if (this.stateOverride) return this.stateOverride;
    if (!this.showsSummary) return this.focusTask?.state ?? "idle";
    let best: BotStateName = "idle";
    for (const t of this.tasks) if (URGENCY.indexOf(t.state) > URGENCY.indexOf(best)) best = t.state;
    return best;
  }

  /**
   * The Meteo sky over the character: on the Meteo pill, and on the idle
   * character when "Sul personaggio" says so. None once the reading is stale.
   */
  get characterSky(): Sky | null {
    const w = this.widgetStatus[WEATHER];
    if (!w || !isSky(w.sky) || Date.now() / 1000 - w.at > 3 * 3600) return null;
    if (!this.tasks.some((t) => t.id === WEATHER)) return null;
    if (this.characterTask?.id === WEATHER) return w.sky;
    return this.settings.integrationConfig.weatherOnCharacter && this.effectiveState === "idle" ? w.sky : null;
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
    this.summary = false;
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

  /** loadIntegrationTasks() — Claude Code with its hooks installed, the rest opt-in. */
  loadIntegrationTasks() {
    for (const proto of INTEGRATION_AGENTS) {
      const idx = this.tasks.findIndex((t) => t.id === proto.id);
      // No hooks: a task made by one of its sessions stays until the session ends.
      const shouldLoad = proto.id === CLAUDE_TASK
        ? this.settings.hooksInstalled || (idx >= 0 && !!this.tasks[idx].lastActive)
        : this.settings.activeIntegrations.includes(proto.id);
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
    // opencode in place of Claude Code: waiting in the Agenti tab between sessions.
    const opencode = this.tasks.find((t) => t.id === OPENCODE_TASK);
    if (this.homeAgentId === OPENCODE_TASK && !opencode) {
      this.tasks.push({ ...task(OPENCODE_TASK, "opencode", "#FAB283", "agent"), agentName: "opencode", isIntegration: false });
    } else if (this.homeAgentId !== OPENCODE_TASK && opencode && !opencode.lastActive) {
      this.tasks = this.tasks.filter((t) => t !== opencode);
    }
    this.tasks.sort((a, b) => rank(a.id) - rank(b.id));
    if (!this.focusId || !this.tasks.some((t) => t.id === this.focusId)) {
      this.focusId = this.fallbackFocus();
    }
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
    if (id === CLAUDE_TASK) return;
    const active = this.settings.activeIntegrations;
    if (active.includes(id)) {
      this.settings.activeIntegrations = active.filter((x) => x !== id);
      if (this.focusId === id) this.focusId = null;
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
