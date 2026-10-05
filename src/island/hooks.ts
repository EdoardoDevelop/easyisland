// Claude Code hook events → island state; also Codex, Gemini CLI and any tool
// that sends `easyisland_agent` (the relay adds it: hook/src/agents.rs), each
// with a pill of its own (`agent:<id>`).
// Port of HookServer.processEvent / processPermissionRequest from the macOS app.
// Difference from macOS: no terminal filter. On Windows the hook fires from any
// terminal (Windows Terminal, VS Code, PowerShell…) and all of them are handled.

import { Bridge, onEvent } from "../core/bridge";
import { Sound } from "../core/sound";
import { State, type AskQuestion, type SessionHost } from "../core/state";
import type { Island } from "./island";
import { applyPlanTool, planStep } from "./plan";
import { risksOf } from "./risk";

const CLAUDE_ID = "integration_claude";

/** Clears the approval card if no decision was made before the hook gave up. */
let pendingTimeout: number | null = null;

interface HookPayload {
  hook_event_name?: string;
  request_id?: string;
  session_id?: string;
  cwd?: string;
  message?: string;
  /** UserPromptSubmit carries `prompt`; `message` belongs to Notification/Stop. */
  prompt?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  /** Set by easyisland-hook.exe --chat: a connector call from the character's own chat. */
  easyisland_chat?: boolean;
  /** PermissionRequest: the rules Claude Code offers to remember ("Sempre"). */
  permission_suggestions?: unknown;
  /** Added by the relay (hook/src/diff.rs) to Edit / MultiEdit / Write. */
  easyisland_diff?: {
    file?: string; added?: number; removed?: number; too_big?: boolean;
    hunks?: { old: number; new: number; lines: string[] }[];
  };
  /** Codex's apply_patch: one diff per file. */
  easyisland_diffs?: HookPayload["easyisland_diff"][];
  /** Added by the relay to Stop: Claude's last message. */
  easyisland_last_message?: string;
  /** Added by the relay (hook/src/testrun.rs) to a test run: what its output said. */
  easyisland_tests?: TestVerdict;
  /** Another agent (Codex, Gemini CLI, any tool): its pill. */
  easyisland_agent?: { id?: string; name?: string; color?: string };
  /** Gemini asks for a permission in its terminal (the island cannot answer it). */
  easyisland_waiting?: boolean;
  /** Claude Code started in Cursor's terminal. */
  cursor?: boolean;
  /** Added by the relay from the session's environment. */
  entrypoint?: string;
  term_program?: string;
  wt_session?: string;
  vscode_pid?: string;
}

interface TestVerdict {
  status?: "passed" | "failed";
  passed?: number;
  failed?: number;
  skipped?: number;
  /** False: no summary in the output, only the failed exit status. */
  known?: boolean;
  unit?: string;
  reason?: string;
}

/**
 * "✓ Test · 12 superati", "✗ Test · 1 fallito su 13 · math › adds — Expected: 3…".
 * The ✓ / ✗ in front is what the ticker colours (views/ticker.ts).
 */
export function testStep(t: TestVerdict): string {
  const n = (x: number | undefined) => x ?? 0;
  const unit = t.unit === "pacchetti" ? " pacchetti" : "";
  const skipped = n(t.skipped) ? `, ${n(t.skipped)} saltati` : "";
  if (t.status === "passed") {
    return `✓ Test · ${n(t.passed)}${unit} ${n(t.passed) === 1 ? "superato" : "superati"}${skipped}`;
  }
  const total = n(t.passed) + n(t.failed);
  const head = t.known === false
    ? "✗ Test falliti"
    : `✗ Test · ${n(t.failed)}${unit} ${n(t.failed) === 1 ? "fallito" : "falliti"} su ${total}`;
  return t.reason ? `${head} · ${t.reason}` : head;
}

/** Where the session runs, from what the relay saw in its environment. */
/** The pill an event belongs to: Claude Code's, or the agent's (made on its first event). */
function taskFor(p: HookPayload): string {
  const a = p.easyisland_agent;
  if (!a?.id) return CLAUDE_ID;
  const id = `agent:${a.id}`;
  State.ensureAgentTask(id, a.name || a.id, a.color || "#8E939C");
  return id;
}

function sessionHost(p: HookPayload): SessionHost {
  // CLAUDE_CODE_ENTRYPOINT describes Claude Code; another agent may only have
  // inherited it from a terminal the Claude app opened.
  if (p.entrypoint === "claude-desktop" && !p.easyisland_agent) return "desktop";
  if (p.cursor) return "cursor";
  if (p.entrypoint === "claude-vscode" || p.term_program === "vscode" || p.vscode_pid) return "vscode";
  if (p.wt_session) return "wt";
  return "terminal";
}

/** The preview of an automation Claude wants to create: "Quando… / Allora…". */
function describeAutomation(input: Record<string, unknown>): string {
  const t = (input.trigger ?? {}) as Record<string, unknown>;
  const str = (o: Record<string, unknown>, k: string) => String(o[k] ?? "").trim();
  const names = ["", "lun", "mar", "mer", "gio", "ven", "sab", "dom"];
  const days = Array.isArray(t.days) && t.days.length && t.days.length < 7
    ? (t.days as number[]).map((d) => names[d] ?? d).join(", ")
    : "ogni giorno";
  const src = (State.settings.widgets ?? []).find((w) => w.id === str(t, "source"))?.name
    ?? State.tasks.find((x) => x.id === str(t, "source"))?.name ?? str(t, "source");
  const when: Record<string, string> = {
    time: `alle ${str(t, "time")}, ${days}`,
    startup: `${Number(t.delay ?? 30) || 30} secondi dopo l'avvio del PC`,
    unlock: "quando sblocchi il PC",
    wifi: `quando ti colleghi alla rete ${str(t, "ssid")}`,
    app: `quando parte ${str(t, "exe")}`,
    drive: "quando colleghi una chiavetta o un disco",
    folder: `quando arriva un file in ${str(t, "folder")}`,
    integration: `quando ${src} segnala ${str(t, "when") === "event" ? "una novità" : str(t, "when") === "any" ? "un problema o una novità" : "un problema"}`,
  };
  const actions = State.settings.actions ?? [];
  const profiles = State.settings.profiles ?? [];
  const steps = (Array.isArray(input.steps) ? input.steps : []) as Record<string, unknown>[];
  const what = steps.map((st) => {
    switch (str(st, "kind")) {
      case "quick": return `esegue «${actions.find((a) => a.id === str(st, "id"))?.name ?? str(st, "id")}»`;
      case "notice": return `mostra l'avviso «${str(st, "title") || str(st, "text")}»`;
      case "profile": return `passa al profilo «${profiles.find((p) => p.id === str(st, "id"))?.name ?? str(st, "id")}»`;
      case "app": return `apre ${str(st, "target")}${str(st, "args") ? ` ${str(st, "args")}` : ""}`;
      case "url": return `apre ${str(st, "url")}`;
      default: return str(st, "kind");
    }
  });
  const profile = profiles.find((p) => p.id === str(input, "profile"))?.name;
  return `Creare l'automazione «${str(input, "name")}»\nQuando: ${when[str(t, "kind")] ?? str(t, "kind")}${profile ? ` (solo nel profilo ${profile})` : ""}\nAllora: ${what.join(", poi ") || "niente"}`;
}

/** EasyIsland's own tools (agent.rs) in words, for the Consenti / Nega card. */
function easyislandTarget(name: string, input: Record<string, unknown>): string | null {
  const s = (k: string) => String(input[k] ?? "").trim();
  const short = (t: string, n = 160) => (t.length > n ? `${t.slice(0, n)}…` : t);
  switch (name) {
    case "open_app":
      return `Aprire ${s("target")}${s("args") ? ` ${s("args")}` : ""}`;
    case "open_url":
      return `Aprire ${s("url")}`;
    case "run_quick_action": {
      const a = (State.settings.actions ?? []).find((x) => x.id === s("id"));
      if (!a) return `Eseguire l'azione rapida ${s("id")}`;
      const what = a.kind === "script" ? `lo script «${a.name}»:\n${short(a.script, 400)}` : `l'azione «${a.name}»`;
      return `Eseguire ${what}`;
    }
    case "read_clipboard":
      return "Leggere il testo negli appunti";
    case "write_clipboard":
      return `Mettere negli appunti: ${short(s("text"))}`;
    case "switch_profile": {
      const p = (State.settings.profiles ?? []).find((x) => x.id === s("id"));
      return `Passare al profilo «${p?.name ?? s("id")}»`;
    }
    case "create_automation":
      return describeAutomation(input);
    case "set_automation_enabled": {
      const a = (State.settings.automations ?? []).find((x) => x.id === s("id"));
      return `${input.enabled ? "Accendere" : "Spegnere"} l'automazione «${a?.name ?? s("id")}»`;
    }
    default:
      return null;
  }
}

/** "mcp__agenda__create_event" + input → "agenda › create_event · {…}". */
function connectorTarget(tool: string, input: Record<string, unknown>): string {
  const own = /^mcp__easyisland__(.+)$/.exec(tool);
  if (own) {
    const said = easyislandTarget(own[1], input);
    if (said) return said;
  }
  const m = /^mcp__(.+?)__(.+)$/.exec(tool);
  const name = m ? `${m[1]} › ${m[2]}` : tool;
  const args = JSON.stringify(input);
  return args && args !== "{}" ? `${name} · ${args.length > 220 ? `${args.slice(0, 220)}…` : args}` : name;
}

/**
 * A connector call from the chat asks for a click. It is the user's own chat,
 * already on screen, so the card simply takes over and hands back to the chat.
 */
function handleChatPermission(island: Island, payload: HookPayload) {
  const requestId = payload.request_id ?? "";
  if (State.pendingApproval && State.pendingApproval.requestId !== requestId) {
    if (requestId) void Bridge.approvalDecline(requestId);
    return;
  }
  const raw = payload.tool_name ?? "Connettore";
  const tool = raw.startsWith("mcp__easyisland__") ? "EasyIsland" : raw;
  State.pendingApproval = {
    requestId,
    sessionId: payload.session_id ?? "",
    tool,
    command: connectorTarget(raw, payload.tool_input ?? {}),
    source: "chat",
  };
  if (requestId) void Bridge.approvalAck(requestId);
  State.isPinned = true;
  Sound.play("approval");
  island.alert("approval");
  State.notify();
  // The relay gives up after ~110 s and the call is refused; the card must not
  // outlive it.
  window.setTimeout(() => {
    const req = State.pendingApproval;
    if (req?.requestId !== requestId) return;
    island.settleApproval(req);
    State.notify();
  }, 110_000);
}

const PROJECT_ALIASES: Record<string, string> = {
  "notch-buddy": "Notch Buddy",
  notchbuddy: "Notch Buddy",
  notch_buddy: "Notch Buddy",
};

/**
 * Only permission requests may take the screen: over a full-screen app, or in a
 * profile that asked for permissions only (e.g. "Concentrazione").
 */
function quietNow(): boolean {
  return State.quiet ||
    State.settings.notify === "permissions";
}

function aliasProjectName(name: string): string {
  return PROJECT_ALIASES[name.toLowerCase()] ?? name;
}

function lastPathComponent(p: string): string {
  const cleaned = p.replace(/[\\/]+$/, "");
  const idx = Math.max(cleaned.lastIndexOf("\\"), cleaned.lastIndexOf("/"));
  return idx >= 0 ? cleaned.slice(idx + 1) : cleaned;
}

/** Step labels shown in the ticker (frenchStep() in the macOS app, now in Italian). */
const TOOL_LABELS: Record<string, string> = {
  Bash: "Esegue",
  Read: "Legge",
  Write: "Scrive",
  Edit: "Modifica",
  Glob: "Cerca",
  Grep: "Ricerca",
  WebSearch: "Ricerca web",
  WebFetch: "Scarica",
  TodoWrite: "Attività",
  Task: "Agent",
  LS: "Elenca",
  MultiEdit: "Modifica",
  NotebookEdit: "Notebook",
  PowerShell: "Esegue",
};

/**
 * "Sempre", in words: what Claude Code proposed in permission_suggestions,
 * picked exactly as the relay picks it (always_rules in hook/src/main.rs).
 * Null when nothing usable was proposed — then there is no "Sempre" button.
 */
function alwaysLabel(suggestions: unknown): string | null {
  if (!Array.isArray(suggestions)) return null;
  const where = (d: unknown) =>
    d === "session" ? "in questa sessione" : d === "projectSettings" ? "in questo progetto" : "in questo progetto, solo per te";
  const parts: string[] = [];
  for (const s of suggestions as Record<string, unknown>[]) {
    if (!s || typeof s !== "object") continue;
    const type = typeof s.type === "string" ? s.type : "addRules";
    if (type === "addRules" && s.behavior === "allow" && Array.isArray(s.rules) && s.rules.length) {
      const rules = (s.rules as Record<string, unknown>[]).map((r) =>
        typeof r.ruleContent === "string" && r.ruleContent ? `${r.toolName}(${r.ruleContent})` : String(r.toolName ?? ""));
      parts.push(`${rules.join(", ")} ${where(s.destination)}`);
    } else if (type === "addDirectories" && Array.isArray(s.directories) && s.directories.length) {
      parts.push(`accesso a ${(s.directories as string[]).join(", ")} ${where(s.destination)}`);
    } else if (type === "setMode" && s.mode === "acceptEdits") {
      parts.push("tutte le modifiche ai file in questa sessione");
    }
  }
  return parts.length ? parts.join("; ") : null;
}

/** " +12 −3": the edit's balance, as the ticker colours it (views/ticker.ts). */
export function diffCounts(added: number, removed: number): string {
  return `  +${added} −${removed}`;
}

/** The first non-empty line, cut to `n` characters. */
function firstLine(text: string, n: number): string {
  const line = text.split(/\r?\n/).map((l) => l.trim()).find((l) => l) ?? "";
  return line.length > n ? `${line.slice(0, n - 1)}…` : line;
}

function stepLabel(tool: string, input: Record<string, unknown>): string {
  const label = TOOL_LABELS[tool] ?? tool;
  const str = (k: string) => (typeof input[k] === "string" ? (input[k] as string) : null);
  const cmd = str("command");
  if (cmd) return `${label} · ${cmd.slice(0, 40)}`;
  const path = str("path");
  if (path) return `${label} · ${lastPathComponent(path)}`;
  const file = str("file_path");
  if (file) return `${label} · ${lastPathComponent(file)}`;
  const query = str("query");
  if (query) return `${label} · ${query.slice(0, 40)}`;
  return label;
}

/**
 * What the Allow button actually authorises. Approving "Write" tells you nothing
 * — approving `Write · C:\…\.env` tells you everything, and the difference is
 * the whole point of approving from the island rather than blind.
 *
 * Ordered by how specific the field is, so an unfamiliar tool still shows
 * whatever identifying string it carries instead of falling back to its name.
 */
const APPROVAL_FIELDS = [
  "command", // Bash, PowerShell
  "file_path", // Write, Edit, MultiEdit, NotebookEdit
  "path", // Read, LS
  "url", // WebFetch
  "query", // WebSearch
  "pattern", // Glob, Grep
  "prompt", // Task
] as const;

/** AskUserQuestion's questions, or null when the input is not what we expect. */
function askQuestions(input: Record<string, unknown>): AskQuestion[] | null {
  const raw = input.questions;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: AskQuestion[] = [];
  for (const q of raw) {
    if (!q || typeof q !== "object") return null;
    const r = q as Record<string, unknown>;
    if (typeof r.question !== "string" || !Array.isArray(r.options)) return null;
    out.push({
      question: r.question,
      header: typeof r.header === "string" ? r.header : "",
      multiSelect: r.multiSelect === true,
      options: r.options
        .filter((o): o is Record<string, unknown> => !!o && typeof o === "object" && typeof (o as Record<string, unknown>).label === "string")
        .map((o) => ({ label: o.label as string, description: typeof o.description === "string" ? o.description : "" })),
    });
  }
  return out;
}

function approvalTarget(tool: string, input: Record<string, unknown>): string {
  for (const field of APPROVAL_FIELDS) {
    const value = input[field];
    if (typeof value === "string" && value.trim()) {
      return `${tool} · ${value.trim()}`;
    }
  }
  return tool;
}

function upsert(tid: string, projectName: string, cwd: string, host?: SessionHost) {
  const t = State.tasks.find((x) => x.id === tid);
  if (!t) return;
  t.name = projectName;
  if (cwd) t.sessionCwd = cwd;
  if (host) t.sessionHost = host;
}

function clearSession(tid: string) {
  const t = State.tasks.find((x) => x.id === tid);
  if (!t) return;
  t.plan = undefined;
  t.steps = [];
  t.stepIndex = 0;
  t.stepSeq = 0;
  t.lastMessage = null;
  t.name = t.agentName ?? "VS Code";
  t.pillBadge = null;
}

export function registerHookHandlers(island: Island) {
  void onEvent<HookPayload>("hook", (payload) => handleHook(island, payload));
}

export function handleHook(island: Island, payload: HookPayload) {
  if (State.paused) {
    // Silence here used to cost Claude Code nearly two minutes: the relay waited
    // for a decision from an island that had already decided not to look. Say so,
    // and the terminal takes the question immediately.
    if (payload.request_id) void Bridge.approvalDecline(payload.request_id);
    return;
  }

  const name = payload.hook_event_name ?? "";
  // Not Claude Code: a message from `easyisland-hook notify`.
  if (name === "EasyIslandNotify") {
    const p = payload as unknown as Record<string, unknown>;
    const str = (k: string) => (typeof p[k] === "string" ? (p[k] as string) : "");
    const level = str("level");
    island.showNotice({
      title: str("title"),
      text: str("text"),
      level: level === "ok" || level === "warn" || level === "error" ? level : "info",
      url: str("url"),
    });
    return;
  }
  if (payload.easyisland_chat) {
    if (name === "PermissionRequest") handleChatPermission(island, payload);
    return;
  }
  const tid = taskFor(payload);
  const cwd = payload.cwd ?? "";
  const raw = lastPathComponent(cwd);
  const projectName = aliasProjectName(raw || "Session");
  const host = sessionHost(payload);
  const focused = State.focusId === tid;

  /** Alerts force the island open; work events only reveal the compact island. */
  const surface = (view: Parameters<Island["alert"]>[0], isAlert: boolean) => {
    // Over a full-screen app only a permission request may take the screen;
    // anything else waits as a badge for the next time the island is opened.
    if (quietNow() && view !== "approval") {
      if (view === "finished" || view === "error" || view === "question") {
        State.setPillBadge(tid, view === "question" ? "approval" : view);
      }
      return;
    }
    if (State.mode === "expanded") {
      if (isAlert) island.setView(view);
    } else if (isAlert) {
      island.alert(view);
    } else if (State.mode === "hidden") {
      island.reveal();
    }
  };

  switch (name) {
    case "SessionStart":
      upsert(tid, projectName, cwd, host);
      surface("overview", false);
      Sound.play("work");
      break;

    case "UserPromptSubmit": {
      upsert(tid, projectName, cwd, host);
      State.updateTask(tid, "thinking");
      const t = State.tasks.find((x) => x.id === tid);
      if (t) t.lastMessage = null;
      // The field is `prompt`; reading `message` meant this step was always blank.
      const asked = payload.prompt ?? payload.message;
      if (asked) State.appendStep(tid, asked.slice(0, 60));
      surface("overview", false);
      break;
    }

    case "PreToolUse": {
      upsert(tid, projectName, cwd, host);
      State.updateTask(tid, "working");
      const tool = payload.tool_name ?? "Strumento";
      const t = State.tasks.find((x) => x.id === tid);
      // A plan tool: the plan, and "Piano · <what is being done>" as the step.
      const plan = applyPlanTool(t?.plan, tool, payload.tool_input ?? {});
      if (t && plan) {
        t.plan = plan;
        State.appendStep(tid, planStep(plan));
      } else {
        State.appendStep(tid, stepLabel(tool, payload.tool_input ?? {}));
      }
      surface("overview", false);
      break;
    }

    case "PostToolUse": {
      State.updateTask(tid, "working");
      const d = payload.easyisland_diff;
      for (const x of [d, ...(payload.easyisland_diffs ?? [])]) {
        if (!x?.file) continue;
        State.addDiff({
          task: tid, file: x.file, added: x.added ?? 0, removed: x.removed ?? 0,
          tooBig: x.too_big === true, hunks: Array.isArray(x.hunks) ? x.hunks : [],
        });
      }
      if (d?.file) {
        // "Modifica · island.ts" becomes "Modifica · island.ts +12 −3".
        const step = stepLabel(payload.tool_name ?? "", payload.tool_input ?? {});
        State.replaceStep(tid, step, `${step}${diffCounts(d.added ?? 0, d.removed ?? 0)}`);
      } else if (payload.easyisland_diffs?.length) {
        // Codex's patch: one step with every file it touched.
        const all = payload.easyisland_diffs.filter((x) => x?.file);
        const add = all.reduce((n, x) => n + (x?.added ?? 0), 0);
        const del = all.reduce((n, x) => n + (x?.removed ?? 0), 0);
        const names = all.map((x) => lastPathComponent(x!.file!)).join(", ");
        State.appendStep(tid, `Modifica · ${names}${diffCounts(add, del)}`);
      }
      if (payload.easyisland_tests) {
        // "Esegue · npm test" becomes what the run really said.
        const step = stepLabel(payload.tool_name ?? "", payload.tool_input ?? {});
        State.replaceStep(tid, step, testStep(payload.easyisland_tests));
      }
      break;
    }

    case "PostToolUseFailure":
      State.updateTask(tid, "working");
      if (payload.easyisland_tests) {
        const step = stepLabel(payload.tool_name ?? "", payload.tool_input ?? {});
        const text = testStep(payload.easyisland_tests);
        const t = State.tasks.find((x) => x.id === tid);
        if (t?.steps.includes(step)) State.replaceStep(tid, step, text);
        else State.appendStep(tid, text);
      } else {
        State.appendStep(tid, "⚠ fallito");
      }
      break;

    case "Notification": {
      const message = payload.message ?? "";
      if (payload.easyisland_waiting) {
        // Gemini asks in its terminal: say so, loudly enough to be seen.
        upsert(tid, projectName, cwd, host);
        State.updateTask(tid, "question");
        State.appendStep(tid, message.slice(0, 80));
        Sound.play("question");
        // Like a permission card: it blocks the agent, so it shows (a badge only
        // over a full-screen app or in front of a client).
        if (quietNow()) State.setPillBadge(tid, "approval");
        else {
          State.setFocus(tid);
          island.alert("question");
        }
        break;
      }
      const lower = message.toLowerCase();
      if (lower.includes("rate limit") || lower.includes("limite d")) {
        State.updateTask(tid, "ratelimit");
        Sound.play("rate");
      } else if (message.endsWith("?")) {
        State.updateTask(tid, "question");
        State.appendStep(tid, message);
      }
      break;
    }

    case "Stop":
      State.updateTask(tid, "finished");
      {
        // Claude's last words replace the last step as what the session ended on.
        const said = payload.easyisland_last_message?.trim() || payload.message?.trim() || "";
        const t = State.tasks.find((x) => x.id === tid);
        if (t) t.lastMessage = said || null;
        if (said) State.appendStep(tid, firstLine(said, 80));
      }
      Sound.play("finish");
      if (focused) surface("finished", true);
      else State.setPillBadge(tid, "finished");
      window.setTimeout(() => {
        State.updateTask(tid, "idle");
        State.setPillBadge(tid, null);
      }, 5200);
      break;

    case "StopFailure":
      State.updateTask(tid, "error");
      Sound.play("error");
      if (focused) surface("error", true);
      else State.setPillBadge(tid, "error");
      break;

    case "SessionEnd":
      State.updateTask(tid, "idle");
      clearSession(tid);
      // The diffs live as long as the session (or an hour, see State.addDiff).
      State.diffs = State.diffs.filter((d) => d.task !== tid);
      // Another agent's pill lasts as long as its session.
      if (tid !== CLAUDE_ID) State.removeTask(tid);
      break;

    case "SubagentStart":
      State.appendStep(tid, "+ sub-agente");
      break;

    case "SubagentStop":
      State.appendStep(tid, "• sub-agente finito");
      break;

    case "PermissionRequest": {
      const requestId = payload.request_id ?? "";
      // One card, one request. A second one must never quietly replace the first
      // — that would leave a human staring at request B while request A waits for
      // a decision nobody can give. Hand it straight back to the terminal.
      if (State.pendingApproval && State.pendingApproval.requestId !== requestId) {
        if (requestId) void Bridge.approvalDecline(requestId);
        break;
      }
      upsert(tid, projectName, cwd, host);
      if (pendingTimeout != null) window.clearTimeout(pendingTimeout);
      const tool = payload.tool_name ?? "Strumento";
      const input = payload.tool_input ?? {};
      const questions = tool === "AskUserQuestion" ? askQuestions(input) : null;
      const always = questions ? null : alwaysLabel(payload.permission_suggestions);
      const risks = questions ? [] : risksOf(tool, input);
      State.pendingApproval = {
        requestId,
        taskId: tid,
        sessionId: payload.session_id ?? "",
        tool,
        command: approvalTarget(tool, input),
        ...(questions ? { questions } : {}),
        ...(always ? { always } : {}),
        ...(risks.length ? { risks } : {}),
      };
      const card = questions ? "ask" : "approval";
      // The relay's short ack window closes in 800 ms; everything below this
      // line is synchronous, so the card really is up by the time it lands.
      if (requestId) void Bridge.approvalAck(requestId);
      State.updateTask(tid, "approval");
      State.isPinned = true;
      Sound.play("approval");
      // Claude Code is stopped until someone answers, so the card always shows,
      // even over another pill or view; answering goes back there.
      island.rememberBeforeCard();
      State.setFocus(tid);
      island.alert(card);
      // EasyIsland answers within 108 s or not at all; after that the terminal has
      // taken over and the card would be lying.
      pendingTimeout = window.setTimeout(() => {
        pendingTimeout = null;
        const req = State.pendingApproval;
        if (!req || req.requestId !== requestId) return;
        island.settleApproval(req);
        State.notify();
      }, 110_000);
      break;
    }

    default:
      break;
  }
  State.notify();
}
