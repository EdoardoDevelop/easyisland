// App state — mirror of AppState.swift (the parts the island needs).

import type { AnchorH, AnchorV, BotEmoteName, BotStateName, IslandMode, IslandViewName } from "./layout";
import type { EyeShape } from "../mochi/engine";

export type AgentSource = "claudeCode" | "n8n";
export type PillBadge = "approval" | "finished" | "error";

export interface AgentTask {
  id: string;
  name: string;
  color: string;
  state: BotStateName;
  stepIndex: number;
  steps: string[];
  source: AgentSource;
  isIntegration: boolean;
  emote?: BotEmoteName | null;
  miniEye?: EyeShape | null;
  pillBadge?: PillBadge | null;
  sessionCwd?: string | null;
}

export interface ApprovalInfo {
  requestId: string;
  sessionId: string;
  tool: string;
  command: string;
  /** "chat": a connector call from Mochi's own chat, not a Claude Code session. */
  source?: "chat";
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
];

export const TOGGLEABLE_INTEGRATION_IDS = [
  "integration_resend", "integration_n8n", "integration_vercel", "integration_github",
  "integration_notion", "integration_calcom", "integration_stripe",
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
  screen: "primary" | "cursor";
  autostart: boolean;
  hooksInstalled: boolean;
  /** Claude model used by the chat with an API key. */
  model: string;
  /** "subscription" = Claude Code (`claude -p`, Claude plan), "api" = API key. */
  chatEngine: "subscription" | "api";
  /** Model alias for the Claude Code engine; "" = Claude Code's default. */
  cliModel: string;
  /** Where the island sits; content opens aligned to that side. */
  anchorV: AnchorV;
  anchorH: AnchorH;
  /** What stays visible at rest. "none" = the old invisible wake strip. */
  iconStyle: "mochi" | "dot" | "none";
  /** Rest icon size, px. */
  iconSize: number;
  /** What the hover shows: a bigger live Mochi, or the compact bar. */
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
  widgets: unknown[];
  /** MCP servers the chat may use (6.3); `confirm` = ask before every call. */
  mcpServers: { name: string; confirm: boolean }[];
  profiles: Profile[];
  activeProfile: string;
  autoProfile: boolean;
  /** Global shortcuts ("" = none); they belong to the PC, not to a profile. */
  hotkeyOpen: string;
  hotkeyAsk: string;
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
  /** "#rrggbb", or "" for the original cream. */
  mochiColor: string;
  islandColor: string;
  islandOpacity: number;
  /** Volume multipliers per sound family, 0–1. */
  volumeAlerts: number;
  volumeUi: number;
  volumeEmotes: number;
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
  mochiColor: "",
  islandColor: "#000000",
  islandOpacity: 1,
  volumeAlerts: 1,
  volumeUi: 1,
  volumeEmotes: 1,
};

export const DEFAULT_SETTINGS: Settings = {
  soundEnabled: true,
  soundVolume: 0.12,
  autoCloseInterval: 15,
  absenceInterval: 180,
  activeIntegrations: [
    "integration_resend", "integration_n8n", "integration_vercel", "integration_github",
  ],
  screen: "primary",
  autostart: false,
  hooksInstalled: false,
  model: "claude-opus-5-5",
  chatEngine: "subscription",
  cliModel: "",
  anchorV: "top",
  anchorH: "center",
  iconStyle: "mochi",
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
  hotkeyOpen: "Ctrl+Alt+M",
  hotkeyAsk: "Ctrl+Alt+K",
};

type Listener = () => void;

class AppState {
  mode: IslandMode = "hidden";
  view: IslandViewName = "overview";

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

  uploadProgress = 0;
  uploadDuration = 2.4;
  fileDragOver = false;

  promptContext: PromptContext | null = null;
  droppedFile: { name: string; path: string } | null = null;
  /** Text the chat is about (clipboard, a quick action) — sent with the first message. */
  chatText: { label: string; text: string } | null = null;
  /** The script being confirmed / run / shown in the Run view. */
  run: ScriptRun | null = null;
  noteMessage: string | null = null;
  searchResult: SearchResult | null = null;
  chatHistory: ChatMessage[] = [];
  pendingApproval: ApprovalInfo | null = null;

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

  get otherTasks(): AgentTask[] {
    return this.tasks.filter((t) => t.id !== this.focusId);
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
    this.notify();
  }

  setPillBadge(id: string, badge: PillBadge | null) {
    const t = this.tasks.find((x) => x.id === id);
    if (!t) return;
    t.pillBadge = badge;
    this.notify();
  }

  /** loadIntegrationTasks() — VS Code always on, the rest opt-in (max 4). */
  loadIntegrationTasks() {
    for (const proto of INTEGRATION_AGENTS) {
      const shouldLoad =
        proto.id === "integration_claude" || this.settings.activeIntegrations.includes(proto.id);
      const idx = this.tasks.findIndex((t) => t.id === proto.id);
      if (shouldLoad && idx < 0) this.tasks.push({ ...proto, steps: [] });
      if (!shouldLoad && idx >= 0) this.tasks.splice(idx, 1);
    }
    // Keep the declared order so pills never shuffle.
    const order = INTEGRATION_AGENTS.map((t) => t.id);
    this.tasks.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    if (!this.focusId) this.focusId = "integration_claude";
    this.notify();
  }

  toggleIntegration(id: string) {
    if (id === "integration_claude") return;
    const active = this.settings.activeIntegrations;
    if (active.includes(id)) {
      this.settings.activeIntegrations = active.filter((x) => x !== id);
      if (this.focusId === id) this.focusId = "integration_claude";
    } else {
      if (active.length >= 4) return;
      this.settings.activeIntegrations = [...active, id];
    }
    this.loadIntegrationTasks();
  }

  defaultView(): IslandViewName {
    return this.tasks.length === 0 ? "empty" : "overview";
  }
}

export const State = new AppState();
