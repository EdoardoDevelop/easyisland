// The morning and end-of-day recap: the agents' time yesterday (or today), the
// repositories with changes not committed and the pull requests waiting
// (daily.rs asks git and gh). Times are local, which the webview knows.
//
// The morning card opens once a day from 8:00 to 13:00, the end-of-day one
// from Impostazioni → «Fine giornata alle» (18 by default), at the first of:
// the app starting, an agent starting work (hooks.ts), the hour itself
// ("daily-due" from giornata.rs, which keeps the hours in Rust since 31 Oct
// 2026 and also writes the engine's summary and sends Telegram's). Only with
// something to say and nobody busy; also from the tray and Impostazioni.

import { Bridge, IS_TAURI, type DailyDigest, type DayText } from "../core/bridge";
import type { IslandViewName } from "../core/layout";
import { State } from "../core/state";
import { addDays, dayKey, mergedSeconds, sampleHistory, type RecapHistory } from "./recap";

export type DailyWhich = "morning" | "evening";

export const MORNING_FROM = 8;
export const MORNING_UNTIL = 13;

export interface DailySummary {
  which: DailyWhich;
  /** The day the agents' numbers are about (yesterday in the morning, today in the evening). */
  day: Date;
  minutes: number;
  sessions: number;
  linesAdded: number;
  linesRemoved: number;
  digest: DailyDigest;
  /** The morning only: today's Notion tasks, late ones included (notion.rs → `today`). */
  notion: { id: string; title: string; url: string; due: string | null }[];
  /** The morning only: the news found in the last day (news.rs), newest first. */
  news: { title: string; source: string; link: string }[];
  /** The engine's summary of today (morning) or tomorrow (evening), giornata.rs. */
  ai: DayText | null;
}

/** The news found since yesterday morning, for the morning recap. */
function newsSinceYesterday(): DailySummary["news"] {
  if (!(State.settings.news?.topics ?? []).length) return [];
  const from = Date.now() / 1000 - 86_400;
  return State.news.filter((n) => n.found >= from).map((n) => ({ title: n.title, source: n.source, link: n.link }));
}

/** Today's Notion tasks, if the integration is on and the morning recap may show them. */
function notionToday(): DailySummary["notion"] {
  const c = State.settings.integrationConfig;
  if (c.notionMorning === false || !State.settings.activeIntegrations.includes("integration_notion")) return [];
  const list = State.integrations.integration_notion?.data?.today;
  return (Array.isArray(list) ? list : [])
    .filter((x): x is DailySummary["notion"][number] => !!x && typeof x === "object" && typeof (x as { id?: unknown }).id === "string" && typeof (x as { title?: unknown }).title === "string");
}

/** The end-of-day hour, as set (12–23). */
export function eveningHour(): number {
  const h = Math.round(Number(State.settings.eveningHour));
  return Number.isFinite(h) ? Math.min(23, Math.max(12, h)) : 18;
}

function wants(which: DailyWhich): boolean {
  const s = State.settings.dailyRecap ?? "both";
  return s === "both" || s === which;
}

/** Which card is due now, given the days they last opened. */
export function dueNow(now: Date, lastMorning: string, lastEvening: string): DailyWhich | null {
  const today = dayKey(now);
  const hour = now.getHours();
  if (wants("evening") && hour >= eveningHour() && lastEvening !== today) return "evening";
  if (wants("morning") && hour >= MORNING_FROM && hour < MORNING_UNTIL && lastMorning !== today) return "morning";
  return null;
}

/** The agents' numbers for one local day. */
export function sumDay(history: RecapHistory, day: Date) {
  const from = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime() / 1000;
  const to = addDays(day, 1).getTime() / 1000;
  const turns = history.turns.filter((t) => t.start >= from && t.start < to);
  return {
    minutes: Math.floor(mergedSeconds(turns) / 60),
    sessions: turns.length,
    linesAdded: turns.reduce((n, t) => n + t.linesAdded, 0),
    linesRemoved: turns.reduce((n, t) => n + t.linesRemoved, 0),
  };
}

export function hasNews(s: DailySummary): boolean {
  return s.minutes > 0 || s.digest.repos.length > 0 || (s.digest.prs?.length ?? 0) > 0 || s.notion.length > 0 || s.news.length > 0;
}

/** A made-up day for the browser preview. */
export function sampleDigest(): DailyDigest {
  return {
    repos: [
      { name: "easyisland", path: "C:\\Users\\Edoardo\\WORK\\easyisland", branch: "claude/sviluppo", changed: 7, ahead: 2 },
      { name: "sito-cliente", path: "C:\\progetti\\sito-cliente", branch: "main", changed: 1, ahead: 0 },
    ],
    prs: [
      { title: "Corregge il calcolo delle ferie", repo: "studio/gestionale", url: "https://github.com/", number: 41, review: true },
      { title: "Nuova card del Meteo", repo: "EdoardoDevelop/easyisland", url: "https://github.com/", number: 12, review: false },
    ],
  };
}

/** What the daily card needs from the island. */
export interface DailyHost {
  alert(view: IslandViewName): void;
}

/** Views the card may replace; anything else is the user busy with something. */
const QUIET_VIEWS: ReadonlySet<IslandViewName> = new Set(["overview", "empty"]);
const SHOW_DELAY_MS = 1500;

class DailyController {
  summary: DailySummary | null = null;
  /** Bumped on every load, so the view knows to rebuild. */
  version = 0;
  private checking = false;

  async load(which: DailyWhich, now = new Date()): Promise<DailySummary> {
    const day = which === "morning" ? addDays(now, -1) : now;
    const since = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime() / 1000;
    const history = IS_TAURI ? await Bridge.recapHistory(since) : sampleHistory(day);
    const digest = (IS_TAURI ? await Bridge.dailyDigest() : sampleDigest()) ?? { repos: [], prs: null };
    const empty: RecapHistory = { turns: [], decisions: [], lastShownWeek: "" };
    const ai = IS_TAURI ? await Bridge.dailyAiText(which) : null;
    this.summary = { which, day, digest, ai, notion: which === "morning" ? notionToday() : [], news: which === "morning" ? newsSinceYesterday() : [], ...sumDay(history ?? empty, day) };
    this.version++;
    return this.summary;
  }

  /** The engine's summary changed (written, failed, started): the card on screen follows. */
  async refreshAi() {
    const s = this.summary;
    if (!s) return;
    s.ai = await Bridge.dailyAiText(s.which);
    this.version++;
    State.notify();
  }

  /** «Chiedi il riassunto» on the card. */
  async askAi(): Promise<string | null> {
    if (!this.summary) return null;
    try {
      await Bridge.dailyAiWrite(this.summary.which);
      return null;
    } catch (e) {
      return String(e).replace(/^Error:\s*/, "");
    }
  }

  /** Tray or Impostazioni: the card now, even with nothing to say. */
  async open(host: DailyHost, which?: DailyWhich) {
    const now = new Date();
    await this.load(which ?? (now.getHours() >= eveningHour() ? "evening" : "morning"), now);
    host.alert("daily");
  }

  async check(host: DailyHost, now = new Date()) {
    // The clock first: most of the day this is all that runs.
    if (this.checking || (State.settings.dailyRecap ?? "both") === "off" || !dueNow(now, "", "") || !this.quiet()) return;
    this.checking = true;
    try {
      const history = IS_TAURI ? await Bridge.recapHistory(Math.floor(now.getTime() / 1000)) : null;
      if (!history) return;
      const which = dueNow(now, history.lastShownMorning ?? "", history.lastShownEvening ?? "");
      if (!which) return;
      const summary = await this.load(which, now);
      // Nothing to say: marked anyway, or it would ask git at every agent start.
      void Bridge.recapMarkDay(which, dayKey(now));
      if (!hasNews(summary)) return;
      window.setTimeout(() => {
        if (this.quiet()) host.alert("daily");
      }, SHOW_DELAY_MS);
    } finally {
      this.checking = false;
    }
  }

  private quiet(): boolean {
    if (State.paused || State.pendingApproval || State.quiet) return false;
    if (State.settings.notify === "permissions") return false;
    return State.mode !== "expanded" || QUIET_VIEWS.has(State.view);
  }
}

export const Daily = new DailyController();
