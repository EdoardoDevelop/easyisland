// App state — mirror of AppState.swift (the parts the island needs).

import type { AnchorH, AnchorV, BotEmoteName, BotStateName, IslandMode, IslandViewName } from "./layout";
import type { EyeShape } from "../character/engine";
import type { PlanItem } from "../island/plan";
import { isSky, type Sky } from "../character/weather";
import { t } from "./i18n";
import type { WindowShot } from "./bridge";

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

/**
 * How the character takes a situation (Impostazioni → Notifiche → Reazioni del
 * personaggio): "show" = it shows, sounds and opens as usual; "quiet" = it
 * changes face but makes no sound and does not open; "off" = it stays calm and
 * only the pill tells. Permissions and questions always show: an agent waits on them.
 */
export type Reaction = "show" | "quiet" | "off";

/**
 * The situation a pill's state is, for the reactions: agents by what happened
 * ("agentFinished", "agentError", "agentLimit"), every other pill (Rete, a
 * widget…) by its own id when something is wrong or new. Null: always shown.
 */
export function reactionKey(t: AgentTask): string | null {
  if (isSessionTask(t)) {
    return t.state === "finished" ? "agentFinished" : t.state === "error" ? "agentError" : t.state === "ratelimit" ? "agentLimit" : null;
  }
  return t.state === "error" || t.state === "ratelimit" || t.state === "finished" ? t.id : null;
}

export type ChatEngine = "subscription" | "api" | "opencode" | "antigravity" | "openrouter" | "openai" | "gemini" | "ollama" | "lmstudio";

/** The chat engines: name, Credential Manager key (if any), default address (local ones). */
export const CHAT_ENGINES: { id: ChatEngine; name: string; key?: string; url?: string; hint: string }[] = [
  { id: "subscription", name: t("Claude (abbonamento)"), hint: t("il tuo piano Pro o Max, serve Claude Code da riga di comando con il login") },
  { id: "api", name: t("Claude (chiave API)"), key: "anthropic-api-key",
 hint: t("API di Anthropic, a consumo") },
  { id: "opencode", name: "opencode", hint: t("modelli gratuiti o locali con strumenti (comandi, file, web), con i permessi nell'isola; serve opencode 2 sul PC") },
  { id: "antigravity", name: "Antigravity", hint: t("l'agente di Google con strumenti (comandi, file, web, server MCP) e i permessi nell'isola; serve la sua CLI (agy) con il login Google") },
  { id: "openrouter", name: "OpenRouter", key: "openrouter-api-key", hint: t("una chiave per centinaia di modelli (openrouter.ai)") },
  { id: "openai", name: "OpenAI", key: "openai-api-key", hint: t("API di OpenAI (platform.openai.com)") },
  { id: "gemini", name: "Gemini", key: "gemini-api-key", hint: t("Google AI Studio (aistudio.google.com)") },
  { id: "ollama", name: "Ollama", url: "http://localhost:11434", hint: t("modelli locali, nessuna chiave") },
  { id: "lmstudio", name: "LM Studio", url: "http://localhost:1234", hint: t("modelli locali, nessuna chiave") },
];

/**
 * One element of the fixed bar (docs/architettura.md → «Barra fissa»): `task:<id>` an
 * integration or a widget, `action:<id>` a quick action; in which area, and
 * with its icon, its value (or name) or both.
 */
export interface BarItem {
  id: string;
  area: "start" | "center" | "end";
  show?: "icon" | "value" | "both";
  /** Tells apart two copies of the same element (two clocks); set when added. */
  uid?: string;
  opts?: BarOpts;
}

/**
 * What a click, the middle button, the right button do on an element of the
 * bar: "" its own default (BAR_KINDS in src/island/bar.ts), nothing, open its
 * card, show the second text, its menu, mute (volume, microphone), or one of
 * the user's quick actions.
 */
export type BarAct = "" | "none" | "card" | "alt" | "menu" | "mute" | `action:${string}`;

/** The «Opzioni» of an element of the fixed bar (Impostazioni → Barra fissa). */
export interface BarOpts {
  /** What it shows, with placeholders ({icon}, {value}, {time}…); "" = `show`. */
  format?: string;
  /** Shown instead of `format` after a click on «alt» (the time becoming the date). */
  alt?: string;
  /** Tooltip; "" = the element's own. */
  tip?: string;
  left?: BarAct;
  middle?: BarAct;
  right?: BarAct;
  /** false: the wheel does nothing on volume or brightness. */
  wheel?: boolean;
  /** Clock: an IANA time zone ("" = the PC's) and whether it shows seconds. */
  tz?: string;
  seconds?: boolean;
}

/** System values the bar shows, from src-tauri/src/barsys.rs (`bar-sys`). */
export interface BarSys {
  volume?: { level: number; muted: boolean; device?: string } | null;
  mic?: { level: number; muted: boolean; device?: string } | null;
  brightness?: number | null;
  battery?: { percent: number; plugged: boolean; charging: boolean; minutes?: number | null; saver?: boolean } | null;
  /** `name` and `link` (bit/s) are the busiest adapter's; `ip` the PC's address. */
  net?: { down: number; up: number; wifi: boolean; name?: string; link?: number; ip?: string } | null;
}

/** «Barra fissa» on: its edge (src-tauri/src/appbar.rs); null when off. */
export function barEdge(s: { fixedBar?: string }): "top" | "bottom" | null {
  return s.fixedBar === "top" || s.fixedBar === "bottom" ? s.fixedBar : null;
}

/** The fixed bar's thickness, logical px: the user's height, or the compact view's
 *  and the strip's when it is on (mirrors Settings::bar_thickness in settings.rs). */
export function barThickness(s: { hoverStyle: string; hoverSize: number; compactStrip?: string; fixedBarHeight?: number }): number {
  if ((s.fixedBarHeight ?? 0) > 0) return Math.min(96, Math.max(24, s.fixedBarHeight ?? 0));
  const compact = s.hoverStyle === "bar" ? 32 : s.hoverSize;
  const withStrip = (s.compactStrip ?? "right") === "off" ? compact : Math.max(compact, 44);
  return Math.min(96, Math.max(24, withStrip));
}

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
export type SessionHost = "desktop" | "vscode" | "cursor" | "wt" | "terminal" | "opencode" | "compiti";

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

/** A proposal at the right moment (src-tauri/src/moments.rs, src/island/moments.ts). */
export type Moment =
  /** A finished download, or a file Claude Code put in the tray. */
  | { kind: "download" | "tray"; name: string; path: string; size: number }
  /** A recording just closed (record.rs): what to do with it. */
  | { kind: "recording"; name: string; path: string; size: number; seconds: number }
  /** An error copied to the clipboard; `holder` holds the port of an EADDRINUSE. */
  | { kind: "error"; error: string; summary: string; text: string; port: number | null; holder: { name: string; pid: number } | null }
  /** A development server that started listening. */
  | { kind: "server"; port: number; url: string; process: string }
  /** A card from Claude Code (`show_card`): waits for a button. */
  | { kind: "card"; id: string; title: string; text: string; level: "ok" | "warn" | "error" | "info"; buttons: string[] };

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
  /** When the relay stops waiting (Date.now() ms): the card shows the time left. */
  deadline?: number;
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
  /** The engine that wrote an answer (for «Seconda opinione»). */
  engine?: string;
  /** A second opinion: the name of the engine that gave it. */
  reviewer?: string;
  /** A file added to this question (pasted or dropped during the conversation). */
  file?: string;
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
  task("integration_rdm", "RDM", "#E8542A", "n8n"),
  task("integration_remote", t("Accesso remoto"), "#14B8A6", "n8n"),
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
  task("integration_media", t("Media"), "#1ED760", "n8n"),
  task("integration_3cx", "3CX", "#0596D4", "n8n"),
  task("integration_teams", "Teams", "#5B5FC7", "n8n"),
  task("integration_recorder", t("Registra"), "#F4505E", "n8n"),
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
  "integration_rdm", "integration_teams", "integration_recorder",
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
  "integration_clipboard", "integration_media", "integration_3cx", "integration_rdm", "integration_teams", "integration_recorder",
  "integration_remote", "integration_telegram",
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
  /** Colour chosen for an integration (pill, card, the character on its tab): id → "#rrggbb". */
  integrationColors: Record<string, string>;
  /** Order of the pills, as dragged in the island (per profile). */
  pillOrder: string[];
  /** Order of the header's tabs, fixed ("tab:home"…) and integrations, as dragged (per profile). */
  tabOrder: string[];
  /** No dragging pills and tabs around in the island (this PC). */
  lockOrder: boolean;
  /** The one field in the open island's top bar (src/views/search.ts). */
  searchBar: boolean;
  /** The character at the head of the open island's menu (src/views/rail.ts). */
  menuCharacter: "large" | "medium" | "small";
  /** The character's bubble in the top bar: what is going on. */
  characterBubble: boolean;
  /** Interface language: "it", "en", or "" for Windows' own (src/core/i18n.ts). */
  language: string;
  /** The weekly recap of the coding agents (recap.rs, src/island/recap.ts). */
  weeklyRecap: boolean;
  /** The morning and end-of-day recap (daily.rs, src/island/daily.ts). */
  dailyRecap: "both" | "morning" | "evening" | "off";
  /** From which hour (local) the end-of-day recap may open. */
  eveningHour: number;
  /** Proposals at the right moment (moments.rs, src/island/moments.ts). */
  momentDownloads: boolean;
  momentErrors: boolean;
  momentServers: boolean;
  /** A copied password or key leaves the clipboard after 30 s. */
  clearSecrets: boolean;
  /** The chat history (chat_log.rs), on this PC. */
  chatHistory: boolean;
  /** Compiti (tasks.rs): their engine ("" = the chat's) and how long one run may go on. */
  tasksEngine: string;
  /** «Motore per la memoria» (memory_ai.rs): "" = none, the map guesses the links by itself. */
  memoryEngine: string;
  tasksMaxTurns: number;
  tasksMaxMinutes: number;
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
  /** Touch the screen edge (square corners) when left at it; off, it floats off every edge. */
  glueEdges: boolean;
  /** Use the whole screen, taskbar included, instead of the work area. */
  overTaskbar: boolean;
  /** «Barra fissa» (appbar.rs): "" off, or the band Windows keeps free at the top / bottom. Of the PC, not of a profile. */
  fixedBar?: "" | "top" | "bottom";
  /** Where the character sits in the fixed bar. */
  fixedBarSlot?: "start" | "center" | "end";
  /** What else the fixed bar shows, in order (BarItem). */
  fixedBarItems?: BarItem[];
  /** The fixed bar's background: "" the island's, "transparent", or "#rrggbb". */
  fixedBarBackground?: string;
  /** The fixed bar's height, px; 0 = automatic (barThickness). */
  fixedBarHeight?: number;
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
  /** The island as an app: taskbar button always, Alt+Tab, — and ▢ in the header. */
  islandApp?: boolean;
  /** Opened by the user: it stays open as with 📌. */
  stayOpenByUser?: boolean;
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
  /** The strip beside the closed island's character (status, quick replies): its side, or off. */
  compactStrip: "right" | "left" | "off";
  /** The strip holds the user's actions for the app in use (a "Touch Bar"); only theirs, nothing by default. */
  appBar: boolean;
  /** How its buttons look, unless an action says otherwise. */
  appBarLook: "both" | "icon" | "text";
  /** At most this many buttons. */
  appBarMax: number;
  /** The program's name before the buttons. */
  appBarName: boolean;
  /** Seconds of hover before the island opens; 0 = only on click. */
  openDelay: number;
  /** Seconds the hover icon / bar stays up after the mouse leaves or an event. */
  revealDuration: number;
  /** Stay out of the way while a full-screen app runs. */
  quietFullscreen: boolean;
  /** Permissions, agents' questions and ringing calls open the island by themselves. */
  alertsOpen?: boolean;
  schemaVersion: number;
  theme: Theme;
  /** What may surface the island: everything, alerts only, or permissions only. */
  notify: "all" | "alerts" | "permissions";
  /** How the character takes each situation (see `reactionKey`); missing = "show". */
  reactions?: Record<string, Reaction>;
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
  /** The menu by the mouse on the selected text (src/island/selection-menu.ts). */
  hotkeySelectionMenu: string;
  /** The selected text into the Raccolta (src/views/collect.ts). */
  hotkeyCollect: string;
  /** ⚡ tab: actions suggested for the app in front. */
  contextActions: boolean;
  /** The chat (Claude Code engine) may use EasyIsland's tools: open programs, quick actions… */
  agentTools: boolean;
  /** "Modalità terminale" (docs/chat.md): the chat works as Claude Code / opencode in a terminal, in chatFolder. */
  chatTerminal?: boolean;
  /** Its working folder; "" = the user's home. */
  chatFolder?: string;
  /** «Anteprima» (src/preview/): the chat's links and the files terminal mode edits open in the preview window. */
  chatPreview?: boolean;
  /** The preview stuck to the open island instead of a window of its own. */
  previewDocked?: boolean;
  /** The panel's width in the island, logical px (dragged by its edge); 0 = the usual. */
  previewWidth?: number;
  /** In front of every new conversation; of the profile (PROFILE_KEYS). */
  chatInstructions?: string;
  /** Impostazioni → Chat → Assistenti: an engine and instructions for a conversation, picked with "/". */
  chatAssistants?: ChatAssistant[];
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
  /** Consumo Claude: the plan's percentages in the open island's header too. */
  planInHeader: boolean;
  /** 3CX: "user" (the extension's own login) or "api" (an API client). */
  threecxMode: "user" | "api";
  /** 3CX, API mode: the extension the API client monitors. */
  threecxExtension: string;
  /** 3CX: the device that places calls; "" = automatic, "pc" = EasyIsland itself (WebRTC). */
  threecxDevice: string;
  /** 3CX, "Questo PC": the PC rings for incoming calls. */
  threecxRing: boolean;
  /** 3CX: an incoming call opens the island with a sound (off: only the badge). */
  threecxAlert: boolean;
  /** 3CX: name of the user's own ringtone; "" = the built-in one. */
  threecxRingtone: string;
  /** Notion: the pages and databases kept in the card. */
  notionPins: NotionRef[];
  /** Notion: the database of the user's tasks. */
  notionTasks: NotionRef | null;
  /** Notion: where "Nuova nota" writes (a page or a database). */
  notionInbox: NotionRef | null;
  /** Notion: the views of the tasks (saved filters); none = all not done. */
  notionViews?: NotionView[];
  /** Notion: the view shown in the card (its name; "" = the first). */
  notionView?: string;
  /** Notion notices (notion.rs): before a task with a time, this many minutes before. */
  notionAlertDue?: boolean;
  notionAlertLead?: number;
  /** Notion notices: a new comment on a kept page or a task due today. */
  notionAlertComments?: boolean;
  /** Notion: today's tasks in the morning recap. */
  notionMorning?: boolean;
  /** Notion: the structure for the chat (notion_map.rs) read again every so many hours (0 = only by hand). */
  notionMapHours?: number;
  /** Remote Desktop Manager: the workspace read (its id; "" = RDM's current one). */
  /** "Registra" (record.rs): folder ("" = Videos\EasyIsland), sound sources, screen fps. */
  recordFolder?: string;
  recordMic?: boolean;
  recordSystem?: boolean;
  recordFps?: number;
  /** Microsoft account (msgraph.rs): app registration id (public) and tenant. */
  msClientId?: string;
  msTenant?: string;
  rdmDataSource?: string;
  /** Remote Desktop Manager: connections kept in the card, and the last opened (rdm.rs). */
  rdmPins?: RdmRef[];
  rdmRecent?: RdmRef[];
  /** Telegram (telegram.rs): the linked chat (0 = none) and its name. */
  telegramChatId?: number;
  telegramName?: string;
  /** Telegram "Automatica": in Modalità terminale only deleting is asked (telegram.rs). */
  telegramAuto?: boolean;
  /** Telegram «Vocali»: who transcribes voice messages (transcribe.rs); "" = nobody. */
  telegramVoice?: string;
  /** The model of «Vocali»; "" = the service's default (transcribe.rs). */
  telegramVoiceModel?: string;
}

/** A connection of Remote Desktop Manager (settings.rs RdmRef, rdm.rs Entry). */
export interface RdmRef {
  id: string;
  name: string;
  group: string;
  host: string;
  kind: string;
}

/** A view of the Notion tasks (settings.rs NotionView, notion.rs view_filter). */
export interface NotionView {
  name: string;
  /** "all", "today", "week" (to Sunday), "month" (to its end), "days" (the next `days`). Late ones always in. */
  period: string;
  days: number;
  /** Tasks without a due date too. */
  undated: boolean;
  /** One per property; within one, any of the values (option names or page ids). */
  filters: { prop: string; kind: string; values: string[] }[];
  /** "due" or "priority". */
  sort: string;
}

/** A Notion page or database chosen in the settings (settings.rs NotionRef). */
export interface NotionRef {
  id: string;
  title: string;
  emoji: string | null;
  url: string;
  database: boolean;
}

/** An assistant of the chat (Raycast's "Agents", LibreChat's presets): a name, an engine, instructions. */
export interface ChatAssistant {
  id: string;
  name: string;
  icon: string;
  /** "" = the chat's default engine. */
  engine: string;
  instructions: string;
}

/** A user-defined button in the Azioni tab. */
export interface QuickAction {
  id: string;
  name: string;
  /** An emoji or a short text shown on the button. */
  icon: string;
  color: string;
  kind: "url" | "app" | "script" | "prompt" | "keys";
  /** url: the link · app: program, folder or file. */
  target: string;
  /** app: arguments, quotes group words. */
  args: string;
  /** script: the commands. */
  script: string;
  shell: "powershell" | "cmd";
  /** prompt: what Claude is asked. */
  prompt: string;
  /** prompt: what the prompt is applied to ("selection": the text selected in the
   * app in front; "page": all the text of its window, Ctrl+A). */
  input: "clipboard" | "selection" | "file" | "none" | "page";
  /** prompt on "selection": the answer goes to the chat (default) or takes the selection's place, after a preview. */
  output?: "chat" | "replace";
  /** script: show the commands and wait for "Esegui". */
  confirm: boolean;
  /** Optional global shortcut, e.g. "Ctrl+Alt+E". */
  hotkey: string;
  /** Programs it belongs to, "outlook.exe, excel.exe" ("*" = any): its button in the bar of the app in use (strip.ts). */
  apps?: string;
  /** keys: the sequence sent to the program in front (src-tauri/src/keys.rs). */
  keys?: string;
  /** Only in the bar of the app in use: not in the ⚡ tab, the search or the selection menu. */
  barOnly?: boolean;
  /** Its button in the bar: "" = the bar's choice (`appBarLook`). */
  barLook?: "" | "both" | "icon" | "text";
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
  kind: "time" | "startup" | "unlock" | "wifi" | "app" | "foreground" | "drive" | "folder" | "download" | "integration"
    | "call" | "agent" | "server" | "back" | "teams";
  /** time: "HH:MM". */
  time: string;
  /** time: 1 = Monday … 7 = Sunday; empty = every day. */
  days: number[];
  /** startup: seconds after EasyIsland starts. */
  delay: number;
  ssid: string;
  /** app, foreground: executable, e.g. "teams.exe". */
  exe: string;
  folder: string;
  /** integration: id of the integration or widget. */
  source: string;
  /** integration: problem | event | any · agent: stop | permission | any. */
  when: "problem" | "event" | "any" | "stop" | "permission" | "start" | "end";
  /** Comma-separated: ".pdf" = extension, other words = contained (automations.rs `matches`). */
  filter?: string;
  /** back: away for at least these minutes. */
  minutes?: number;
}

/** One "se" of an automation: all must hold; `not` turns it around. */
export interface AutomationCondition {
  kind: "hours" | "wifi" | "app" | "foreground" | "battery" | "idle" | "meeting" | "client";
  not: boolean;
  from: string;
  to: string;
  days: number[];
  ssid: string;
  exe: string;
  minutes: number;
  /** battery: 0 = on battery, otherwise below this %. */
  percent: number;
}

/** One thing an automation does. */
export interface AutomationStep {
  kind: "quick" | "notice" | "profile" | "app" | "url" | "chat" | "task" | "wait" | "confirm" | "agent" | "decide" | "ask" | "foreach";
  /** quick: action id · profile: profile id. */
  id: string;
  title: string;
  text: string;
  level: string;
  target: string;
  args: string;
  url: string;
  /** wait: minutes. */
  minutes?: number;
  /** Flows (flows.rs): the step's name for links and its result ("" = s1, s2…). */
  node?: string;
  /** Where to go after: a step's node, "end", or "" = the next one. */
  next?: string;
  /** decide: the first branch that holds. */
  branches?: { value: string; op: "contains" | "equals" | "empty" | "filled" | "else" | "model"; toMatch: string; to: string }[];
  /** foreach: the step each item starts from. */
  body?: string;
  /** Tries again this many times (0–3) after a failure. */
  retries?: number;
  /** The step to go to when this one fails ({errore} has the reason). */
  onError?: string;
  /** agent: fields its answer ends with as JSON, each one {node.field}. */
  fields?: string[];
  /** agent: engine and model of its task. */
  engine?: string;
  model?: string;
  /** ask: the card's buttons. */
  options?: string[];
}

/** A window chosen in File e schermo (window_drop.rs): its HWND as a number. */
export interface PickedWindow {
  id: number;
  appName: string;
  title: string;
}

/** Teams through Microsoft Graph: status and today's online meetings. */
export interface MsTeams {
  signedIn: boolean;
  availability?: string;
  activity?: string;
  meetings?: { subject: string; start: string; end: string; allDay: boolean; joinUrl: string }[];
  error?: string | null;
}

/** "Quando… (se…) allora…" — Impostazioni → Flussi. Belongs to the PC. */
export interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  trigger: AutomationTrigger;
  /** Only while this profile is active; "" = any. */
  profile: string;
  conditions?: AutomationCondition[];
  /** "" = every time · "every" = at most every `every` minutes · "day" = once a day. */
  repeat?: "" | "every" | "day";
  every?: number;
  steps: AutomationStep[];
  /** A notice every time it runs (errors always show). */
  notify: boolean;
  /** Go on after a step that failed (off: the rest is skipped). */
  keepGoing?: boolean;
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
  /** Consumo Claude: [used %, resets at (Unix s)] per window of the plan, and when they arrived (usage.rs PlanGauge). */
  plan?: { fiveHour?: [number, number]; sevenDay?: [number, number]; sevenDayOpus?: [number, number]; at?: number };
  /** Meteo: now, the next hours and days, for its card (src/views/weather.ts). */
  forecast?: unknown;
}

/**
 * "Sostituisci": a text selected in an app, rewritten, shown before and after
 * in the card (src/views/rewrite.ts), pasted in its place only on a click.
 */
export interface Rewrite {
  id: string;
  /** "Correggi", "Riscrivi"…: the card's title. */
  label: string;
  prompt: string;
  /** The text selected in the app, as copied. */
  original: string;
  /** The new text; the user may edit it in the card. */
  result: string;
  status: "loading" | "ready" | "replacing" | "error";
  /** Why it failed, or why nothing was pasted. */
  message: string;
  /** The rewrite can be pasted with the selection's formatting (as long as it is not edited). */
  formatted?: boolean;
  /** The text `formatted` belongs to: once edited in the card, it pastes as plain text. */
  formattedText?: string;
  /** The selection had formatting and the rewrite lost it. */
  lost?: boolean;
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
  /** A character id from src/character/roster.ts ("drop", "slime", "cube", "gecko", "flame", "magma"…). */
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
  /** The look of the island and the settings: "windows" (Windows 11, the default) or "classic". */
  style: "windows" | "classic";
  /** Light or dark: "dark" (the default), "light", or "auto" (follows Windows' app mode). */
  scheme: "dark" | "light" | "auto";
  /** What sits in the island: the character, the EasyIsland logo, the user's PNG or the weather (character/figure.ts). */
  figure: "character" | "easyisland" | "logo" | "weather";
  /** Bumped when the user's PNG changes, so the island loads it again (logo.rs). */
  logoStamp: number;
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
  character: "jarvis-sfera",
  slimeColor: "",
  islandColor: "#000000",
  islandOpacity: 1,
  volumeAlerts: 1,
  volumeUi: 1,
  volumeEmotes: 1,
  compactBackground: true,
  style: "windows",
  scheme: "dark",
  figure: "character",
  logoStamp: 0,
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
  integrationColors: {},
  pillOrder: [],
  tabOrder: [],
  lockOrder: false,
  searchBar: true,
  menuCharacter: "large",
  characterBubble: true,
  weeklyRecap: true,
  dailyRecap: "both",
  eveningHour: 18,
  momentDownloads: true,
  momentErrors: true,
  momentServers: true,
  clearSecrets: true,
  chatHistory: true,
  tasksEngine: "",
  memoryEngine: "",
  tasksMaxTurns: 12,
  tasksMaxMinutes: 30,
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
  fixedBar: "",
  fixedBarSlot: "center",
  fixedBarItems: [],
  fixedBarBackground: "",
  fixedBarHeight: 0,
  islandWidth: 640,
  islandHeight: 0,
  islandPlace: "character",
  greeting: true,
  greetingPlace: "center",
  closeButton: true,
  islandApp: false,
  stayOpenByUser: false,
  followCursorCompact: false,
  presenceMeeting: true,
  presenceRemote: true,
  presenceApps: [],
  presenceMode: "hide",
  iconStyle: "character",
  iconSize: 24,
  hoverStyle: "icon",
  hoverSize: 40,
  compactStrip: "right",
  appBar: true,
  appBarLook: "both",
  appBarMax: 6,
  appBarName: true,
  openDelay: 0.6,
  revealDuration: 8,
  quietFullscreen: true,
  schemaVersion: 2,
  theme: { ...DEFAULT_THEME },
  notify: "all",
  reactions: {},
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
  hotkeySelectionMenu: "Win+Alt+A",
  hotkeyCollect: "Ctrl+Alt+Shift+R",
  contextActions: true,
  agentTools: true,
  chatTerminal: false,
  chatFolder: "",
  chatPreview: true,
  previewDocked: false,
  previewWidth: 0,
  chatInstructions: "",
  chatAssistants: [],
  opencodeWatch: false,
  automations: [],
  habitsEnabled: false,
  suggestionsDismissed: [],
  suggestionsSnoozed: {},
  habitsExcluded: [],
  updateCheck: true,
  integrationConfig: {
    systemWarn: 10, outlookWarn: 10, weatherCity: "", weatherOnCharacter: false, planInHeader: true,
    threecxMode: "user", threecxExtension: "", threecxDevice: "",
    threecxRing: true, threecxAlert: true, threecxRingtone: "",
    notionPins: [], notionTasks: null, notionInbox: null, notionViews: [], notionView: "",
    notionAlertDue: true, notionAlertLead: 10, notionAlertComments: true, notionMorning: true, notionMapHours: 6,
    rdmDataSource: "", rdmPins: [], rdmRecent: [],
  },
};

type Listener = () => void;

class AppState {
  mode: IslandMode = "hidden";
  view: IslandViewName = "overview";

  /** 📌 in the header: the island stays open until unpinned, Esc or ✕. */
  keepOpen = false;
  /** 📌 turned on by "Resta aperta", not by the user: it keeps the island open but does not make it an app. */
  keptByItself = false;
  /** The open island is an app window right now (📌 or "Come un'app"). */
  appWindow = false;
  /** ▢ in the header of the island as an app: it fills the work area until closed. */
  maximized = false;

  /** The app in front when the island last opened (src/island/context.ts). */
  foreground: { exe: string; title: string } | null = null;
  /** File e schermo: the window chosen for "Registra" or "Foto nel Vassoio". */
  pickedWindow: PickedWindow | null = null;
  /** Microsoft Graph for the Teams card (msgraph.rs `teams_snapshot`), once signed in. */
  msTeams: MsTeams | null = null;

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
  /** The proposal in the "moment" view. */
  moment: Moment | null = null;

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
  /** The zone just put in the tray by "Riquadra e chiedi": lit, with Chiedi and Copia at hand. */
  trayFresh: { name: string; until: number } | null = null;
  /** "Estrai…" on a dropped ZIP: what is inside, and how the extraction went. */
  unzip: {
    info: { count: number; size: number; names: string[] } | null;
    status: "loading" | "ready" | "working" | "done" | "error";
    message: string;
  } | null = null;
  /** Text the chat is about (clipboard, a quick action) — sent with the first message. */
  chatText: { label: string; text: string } | null = null;
  /** Another app's window the character of the chat tab was dropped on — sent with the first message. */
  chatWindow: WindowShot | null = null;
  /** The character of the chat tab is being carried: the window it is over ("" = none yet). */
  windowPick: { over: string } | null = null;
  /** Put in the chat field once, not sent (an action with no selection: the text goes after it). */
  chatDraft: string | null = null;
  /** A file added to a conversation going on (dropped or pasted): sent with the next question. */
  chatAttach: { name: string; path: string } | null = null;
  /** Added once to the chat field, after what is there (a folder the character was dropped on). */
  chatInsert: string | null = null;
  /**
   * "Chiedi a questa sessione": the chat asks a read-only copy of a Claude Code
   * session instead of its engine. `fork` is that copy, once the first answer made it.
   */
  chatSession: { sessionId: string; cwd: string; name: string; fork: string | null } | null = null;
  /** The script being confirmed / run / shown in the Run view. */
  run: ScriptRun | null = null;
  rewrite: Rewrite | null = null;
  /** Latest result per widget id. */
  widgetStatus: Record<string, WidgetStatus> = {};
  /** Volume, battery, network… for the fixed bar's system elements (barsys.rs). */
  barSys: BarSys = {};
  /** The system element whose card the island shows (src/views/barcard.ts). */
  barCard: string | null = null;
  noteMessage: string | null = null;
  searchResult: SearchResult | null = null;
  chatHistory: ChatMessage[] = [];
  /** The user's own integrations (custom.rs). */
  customs: Custom[] = [];
  /** Bumped when one of them or its records changed elsewhere: its card is redrawn. */
  customVersion = 0;
  /** The engine picked in the chat's menu for the conversation in progress; null = the default (settings.chatEngine). Never saved. */
  chatEngineOverride: ChatEngine | null = null;
  /** "Automatica" (chat head, Modalità terminale only): no Consenti / Nega for this conversation. Never saved. */
  chatAuto = false;
  /** The Anteprima is open as the island's panel (island.ts setPaneOpen). */
  previewOpen = false;
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

  /**
   * Marks the UI dirty; the island re-renders on the next frame. A listener
   * that throws does not keep the others (the island's own) from hearing it.
   */
  notify() {
    for (const fn of this.listeners) {
      try {
        fn();
      } catch (e) {
        console.error(e);
      }
    }
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

  /** How the character takes `key` (a `reactionKey`); "show" when not set. */
  reaction(key: string | null): Reaction {
    return (key && this.settings.reactions?.[key]) || "show";
  }

  /** A pill whose state the character should not take on ("Resta tranquillo"). */
  private calm(t: AgentTask): boolean {
    return this.reaction(reactionKey(t)) === "off";
  }

  get effectiveState(): BotStateName {
    if (this.stateOverride) return this.stateOverride;
    if (!this.showsSummary) {
      const f = this.focusTask;
      return f && !this.calm(f) ? f.state : "idle";
    }
    let best: BotStateName = "idle";
    for (const t of this.tasks) {
      if (!this.calm(t) && URGENCY.indexOf(t.state) > URGENCY.indexOf(best)) best = t.state;
    }
    return best;
  }

  /**
   * The Meteo sky over the character: on the Meteo pill, and on the idle
   * character when "Sul personaggio" says so. None once the reading is stale.
   */
  /** Meteo now, for the weather in place of the character: its sky and "18°". */
  get weatherNow(): { sky: Sky | null; temp: string } {
    const w = this.widgetStatus[WEATHER];
    if (!w || Date.now() / 1000 - w.at > 3 * 3600) return { sky: null, temp: "" };
    const f = w.forecast as { temp?: number } | undefined;
    return { sky: isSky(w.sky) ? w.sky : null, temp: typeof f?.temp === "number" ? `${Math.round(f.temp)}°` : "" };
  }

  get characterSky(): Sky | null {
    const w = this.widgetStatus[WEATHER];
    if (!w || !isSky(w.sky) || Date.now() / 1000 - w.at > 3 * 3600) return null;
    if (!this.tasks.some((t) => t.id === WEATHER)) return null;
    if (this.characterTask?.id === WEATHER) return w.sky;
    return this.settings.integrationConfig.weatherOnCharacter && this.effectiveState === "idle" ? w.sky : null;
  }

  /** Everything but the focused task: the compact bar's mini characters. */
  get otherTasks(): AgentTask[] {
    return this.tasks.filter((t) => t.id !== this.focusId);
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
      // The user's colour for it (Impostazioni → Integrazioni), or its own.
      const chosen = this.settings.integrationColors?.[proto.id] ?? "";
      const color = /^#[0-9a-f]{6}$/i.test(chosen) ? chosen : proto.color;
      if (shouldLoad && idx < 0) this.tasks.push({ ...proto, color, steps: [] });
      if (shouldLoad && idx >= 0) this.tasks[idx].color = color;
      if (!shouldLoad && idx >= 0) this.tasks.splice(idx, 1);
    }
    // The user's own integrations (custom.rs), switched on in Impostazioni.
    this.tasks = this.tasks.filter((t) => !t.id.startsWith("custom:") || this.customs.some((c) => c.enabled && `custom:${c.id}` === t.id));
    for (const c of this.customs.filter((x) => x.enabled)) {
      const id = `custom:${c.id}`;
      const existing = this.tasks.find((t) => t.id === id);
      if (existing) {
        existing.name = c.name;
        existing.color = c.color;
      } else {
        this.tasks.push(task(id, c.name, c.color, "n8n"));
      }
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
    // The chat's own requests wait inside the chat (chat.ts), not on a card.
    return p ? (p.source === "chat" ? "prompt" : p.questions ? "ask" : "approval") : null;
  }

  /** Where the island opens: a request waiting for an answer comes first. */
  defaultView(): IslandViewName {
    return this.pendingCard() ?? (this.tasks.length === 0 ? "empty" : "overview");
  }
}

export const State = new AppState();

/** A task of EasyIsland (tasks.rs): a goal the agent carries on by itself. */
export type TaskState = "scheduled" | "queued" | "running" | "asking" | "paused" | "done" | "failed" | "stopped";

export interface AgentTaskItem {
  id: string;
  title: string;
  goal: string;
  engine: string;
  /** "" = the engine's model in Impostazioni → Chat. */
  model: string;
  /** Engines it may hand a piece of work to (task_delegate). */
  helpers: string[];
  state: TaskState;
  plan: { text: string; done: boolean }[];
  /** "" = now; "at:AAAA-MM-GG HH:MM"; "daily:HH:MM"; "weekdays:HH:MM". */
  when: string;
  lastFired: string;
  question: string;
  answer: string;
  result: string;
  last: string;
  turns: number;
  runs: number;
  /** The last run had nothing to report. */
  quiet: boolean;
  /** The heartbeat (Battito): BATTITO.md at every run. */
  heartbeat: boolean;
  /** The evening digest of the memory. */
  digest: boolean;
  created: string;
  updated: string;
}

/** A skill of the user (skills.rs): a procedure the chat and the tasks follow. */
export interface Skill {
  id: string;
  name: string;
  description: string;
  engine: string;
  tools: string[];
  body: string;
}

/** An integration made by the user from the chat (custom.rs): a description, never code. */
export interface CustomColumn { id: string; label: string; kind: string; options: string[]; formula?: string; format?: string }
export interface CustomField {
  id: string;
  label: string;
  kind: string;
  options: string[];
  required: boolean;
  default: string;
  help: string;
  columns: CustomColumn[];
  formula: string;
  /** counter: "PREV-{anno}-" and the digits of the number. */
  prefix?: string;
  digits?: number;
  /** Shown only when: "urgente" or "pagamento=Bonifico". */
  showIf?: string;
  /** link: the integration whose records are picked from. */
  source?: string;
  /** Summed or counted in the list of the saved records. */
  summary?: boolean;
  /** computed: money (default), number, percent, text, date, yesno. */
  format?: string;
}
export interface CustomAction {
  label: string;
  kind: string;
  prompt: string;
  url: string;
  quick: string;
  database: string;
  format: string;
  method?: string;
  headers?: Record<string, unknown>;
  body?: string;
  store?: Record<string, unknown>;
  message?: string;
  steps?: string[];
}
/** Data read from a service (custom.rs Source). */
export interface CustomSource {
  id: string;
  label: string;
  method?: string;
  url: string;
  headers?: Record<string, unknown>;
  body?: string;
  every?: number;
  items?: string;
  title?: string;
  subtitle?: string;
  value?: string;
  values?: Record<string, unknown>;
  alert?: string;
  alertText?: string;
}
export interface Custom {
  id: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  enabled: boolean;
  fields: CustomField[];
  template: string;
  actions: CustomAction[];
  titleField: string;
  sources?: CustomSource[];
  secrets?: string[];
}
export interface CustomRecord { id: string; created: string; updated: string; values: Record<string, unknown> }
