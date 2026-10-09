// Weekly recap: last week's agent sessions, counted in recap.rs, summed up here
// (weeks, days and "Monday 8:00" are local time, which the webview knows).
// Taken from Coucou's recap/summary.ts and recap/recap.ts.
//
// It opens on its own once a week, on Monday from 8:00, at the first of:
// the app starting, an agent starting work (UserPromptSubmit / SessionStart in
// hooks.ts). And any time from the tray or Impostazioni. Nothing runs on a timer.

import { Bridge, IS_TAURI } from "../core/bridge";
import type { IslandViewName } from "../core/layout";
import { State } from "../core/state";

/** One finished turn, as recap.rs stores it. Times are Unix seconds. */
export interface RecapTurn {
  agent: string;
  project: string;
  start: number;
  end: number;
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  commandsRun: number;
  questions: number;
}

export interface RecapDecision {
  agent: string;
  date: number;
  decision: string;
}

export interface RecapHistory {
  turns: RecapTurn[];
  decisions: RecapDecision[];
  /** Monday (YYYY-MM-DD) of the week the recap last opened on its own. */
  lastShownWeek: string;
}

export interface WeeklySummary {
  weekStart: Date;
  /** Last second of the week (Sunday 23:59:59). */
  weekEnd: Date;
  totalMinutes: number;
  sessionCount: number;
  filesChanged: number;
  linesAdded: number;
  linesRemoved: number;
  commandsRun: number;
  questions: number;
  permissionsAllowed: number;
  permissionsDenied: number;
  topAgent: string | null;
  topProject: string | null;
  busiestDay: string | null;
  longestSessionMinutes: number;
}

// ── Weeks (Monday to Sunday, local time) ──────────────────────────────────────

/** Local midnight `n` days after `d`'s date: safe across daylight saving. */
export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

/** Monday 00:00 (local) of the week holding `d`. */
export function mondayOf(d: Date): Date {
  return addDays(d, -((d.getDay() + 6) % 7));
}

/** Monday 00:00 of the last completed week. */
export function previousWeekStart(now: Date): Date {
  return addDays(mondayOf(now), -7);
}

/** YYYY-MM-DD of a local date. */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** The recap opens on its own on Monday from this hour. */
export const RECAP_HOUR = 8;

export function shouldAutoShow(now: Date, lastShownWeek: string): boolean {
  return now.getDay() === 1 && now.getHours() >= RECAP_HOUR && dayKey(mondayOf(now)) !== lastShownWeek;
}

// ── Aggregation ───────────────────────────────────────────────────────────────

const DAY_NAMES = ["domenica", "lunedì", "martedì", "mercoledì", "giovedì", "venerdì", "sabato"];

/** recap.rs agent ids → the names of the island's pills. */
const AGENT_NAMES: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  gemini: "Gemini CLI",
  cursor: "Cursor",
  copilot: "Copilot CLI",
  opencode: "opencode",
};

export function agentName(id: string): string {
  return AGENT_NAMES[id] ?? (id ? id.charAt(0).toUpperCase() + id.slice(1) : id);
}

/** The most frequent key; ties go to whatever `order` ranks first. */
function topKey<K>(counts: Map<K, number>, order: (a: K, b: K) => number): K | null {
  let best: K | null = null;
  let bestCount = 0;
  for (const [key, n] of counts) {
    if (n > bestCount || (n === bestCount && best !== null && order(key, best) < 0)) {
      best = key;
      bestCount = n;
    }
  }
  return best;
}

/** Wall time covered by the turns, overlapping ones counted once. Seconds. */
export function mergedSeconds(turns: RecapTurn[]): number {
  const sorted = turns.filter((t) => t.end > t.start).sort((a, b) => a.start - b.start);
  let total = 0;
  let segStart = 0;
  let segEnd = -Infinity;
  for (const t of sorted) {
    if (t.start <= segEnd) {
      segEnd = Math.max(segEnd, t.end);
    } else {
      if (segEnd > segStart) total += segEnd - segStart;
      segStart = t.start;
      segEnd = t.end;
    }
  }
  if (segEnd > segStart) total += segEnd - segStart;
  return total;
}

/** The week starting at `weekStart` (a local Monday 00:00), or null when nothing ran. */
export function summarize(history: RecapHistory, weekStart: Date): WeeklySummary | null {
  const end = addDays(weekStart, 7);
  const from = weekStart.getTime() / 1000;
  const to = end.getTime() / 1000;
  const turns = history.turns.filter((t) => t.start >= from && t.start < to);
  if (turns.length === 0) return null;
  const decisions = history.decisions.filter((d) => d.date >= from && d.date < to);
  const sum = (f: (t: RecapTurn) => number) => turns.reduce((n, t) => n + f(t), 0);

  const byAgent = new Map<string, number>();
  const byProject = new Map<string, number>();
  const byDay = new Map<number, number>();
  for (const t of turns) {
    byAgent.set(t.agent, (byAgent.get(t.agent) ?? 0) + 1);
    if (t.project) byProject.set(t.project, (byProject.get(t.project) ?? 0) + 1);
    const day = new Date(t.start * 1000).getDay();
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  const byName = (a: string, b: string) => a.localeCompare(b);
  // Ties go to the earlier day of the (Monday-first) week.
  const byWeekOrder = (a: number, b: number) => ((a + 6) % 7) - ((b + 6) % 7);
  const topAgent = topKey(byAgent, byName);
  const busiest = topKey(byDay, byWeekOrder);

  return {
    weekStart,
    weekEnd: new Date(end.getTime() - 1000),
    totalMinutes: Math.floor(mergedSeconds(turns) / 60),
    sessionCount: turns.length,
    filesChanged: sum((t) => t.filesChanged),
    linesAdded: sum((t) => t.linesAdded),
    linesRemoved: sum((t) => t.linesRemoved),
    commandsRun: sum((t) => t.commandsRun),
    questions: sum((t) => t.questions),
    permissionsAllowed: decisions.filter((d) => d.decision === "allow").length,
    permissionsDenied: decisions.filter((d) => d.decision === "deny").length,
    topAgent: topAgent === null ? null : agentName(topAgent),
    topProject: topKey(byProject, byName),
    busiestDay: busiest === null ? null : DAY_NAMES[busiest],
    longestSessionMinutes: Math.floor(Math.max(0, ...turns.map((t) => t.end - t.start)) / 60),
  };
}

// ── Formatting ────────────────────────────────────────────────────────────────

/** "45 min", "3 h", "3 h 20 min". */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/** 1234 → "1.234"; 12345 → "12,3 mila": keeps a chip narrow. */
export function formatCount(n: number): string {
  if (n >= 10_000) return `${(n / 1000).toLocaleString("it-IT", { maximumFractionDigits: n >= 100_000 ? 0 : 1 })} mila`;
  return n.toLocaleString("it-IT");
}

/** "29 set – 5 ott". */
export function weekRangeLabel(s: Pick<WeeklySummary, "weekStart" | "weekEnd">): string {
  const f = (d: Date) => d.toLocaleDateString("it-IT", { day: "numeric", month: "short" }).replace(".", "");
  return `${f(s.weekStart)} – ${f(s.weekEnd)}`;
}

/** A made-up week, for the browser preview (no Rust side there). */
export function sampleHistory(monday: Date): RecapHistory {
  const at = (day: number, hour: number, minute = 0) =>
    Math.floor(new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + day, hour, minute).getTime() / 1000);
  const turn = (agent: string, project: string, start: number, end: number,
    filesChanged: number, linesAdded: number, linesRemoved: number, commandsRun: number, questions: number): RecapTurn =>
    ({ agent, project, start, end, filesChanged, linesAdded, linesRemoved, commandsRun, questions });
  return {
    turns: [
      turn("claude", "easyisland", at(0, 9), at(0, 11, 30), 8, 312, 87, 14, 2),
      turn("claude", "easyisland", at(0, 14), at(0, 15, 45), 3, 95, 20, 5, 0),
      turn("opencode", "sito", at(1, 10), at(1, 11), 2, 50, 10, 3, 1),
      turn("claude", "easyisland", at(2, 9, 30), at(2, 12), 5, 180, 60, 8, 3),
      turn("codex", "script", at(3, 16), at(3, 17), 1, 40, 5, 2, 0),
      turn("claude", "easyisland", at(4, 8), at(4, 13), 12, 540, 130, 22, 5),
    ],
    decisions: [
      { agent: "claude", date: at(0, 9, 30), decision: "allow" },
      { agent: "claude", date: at(0, 10), decision: "allow" },
      { agent: "claude", date: at(2, 10), decision: "deny" },
      { agent: "claude", date: at(4, 9), decision: "allow" },
    ],
    lastShownWeek: "",
  };
}

// ── When it opens ─────────────────────────────────────────────────────────────

/** What the recap needs from the island. */
export interface RecapHost {
  alert(view: IslandViewName): void;
}

/** Views the Monday card may replace; anything else is the user busy with something. */
const QUIET_VIEWS: ReadonlySet<IslandViewName> = new Set(["overview", "empty", "settings"]);

/** Never on top of the event that triggered it. */
const SHOW_DELAY_MS = 1500;

class RecapController {
  summary: WeeklySummary | null = null;
  /** Bumped on every load, so the view knows to rebuild. */
  version = 0;
  private checking = false;

  /** Last week from recap.rs; the browser preview gets the sample week. */
  async load(now = new Date()): Promise<WeeklySummary | null> {
    const start = previousWeekStart(now);
    const history = IS_TAURI ? await Bridge.recapHistory(start.getTime() / 1000) : sampleHistory(start);
    this.summary = history ? summarize(history, start) : null;
    this.version++;
    return this.summary;
  }

  /** Tray or Impostazioni: the card even for an empty week. */
  async open(host: RecapHost) {
    await this.load();
    host.alert("recap");
  }

  /** Monday from 8:00, not shown yet this week, something to show, nobody busy. */
  async check(host: RecapHost, now = new Date()) {
    // The clock first: six days out of seven this is all that runs.
    if (this.checking || !shouldAutoShow(now, "") || State.settings.weeklyRecap === false || !this.quiet()) return;
    this.checking = true;
    try {
      const history = IS_TAURI ? await Bridge.recapHistory(previousWeekStart(now).getTime() / 1000) : null;
      if (!history || !shouldAutoShow(now, history.lastShownWeek)) return;
      if (!(await this.load(now))) return;
      const week = dayKey(mondayOf(now));
      window.setTimeout(() => {
        if (!this.quiet()) return;
        host.alert("recap");
        void Bridge.recapMarkShown(week);
      }, SHOW_DELAY_MS);
    } finally {
      this.checking = false;
    }
  }

  private quiet(): boolean {
    if (State.paused || State.pendingApproval || State.quiet) return false;
    return State.mode !== "expanded" || QUIET_VIEWS.has(State.view);
  }
}

export const Recap = new RecapController();
