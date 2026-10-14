// The morning and end-of-day recap: the agents' time yesterday (or today), the
// repositories with changes not committed and the pull requests waiting
// (daily.rs asks git and gh). Times are local, which the webview knows.
//
// The morning card opens once a day from 8:00 to 13:00, the end-of-day one
// from Impostazioni → «Fine giornata alle» (18 by default), at the first of:
// the app starting, an agent starting work (hooks.ts), a timer set for the
// next of those two hours (one timeout, nothing polls). Only with something
// to say and nobody busy; also from the tray and Impostazioni («Mostra ora»).

import { Bridge, IS_TAURI, type DailyDigest } from "../core/bridge";
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
  return s.minutes > 0 || s.digest.repos.length > 0 || (s.digest.prs?.length ?? 0) > 0;
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
const QUIET_VIEWS: ReadonlySet<IslandViewName> = new Set(["overview", "empty", "settings"]);
const SHOW_DELAY_MS = 1500;

class DailyController {
  summary: DailySummary | null = null;
  /** Bumped on every load, so the view knows to rebuild. */
  version = 0;
  private checking = false;
  private timer: number | null = null;

  async load(which: DailyWhich, now = new Date()): Promise<DailySummary> {
    const day = which === "morning" ? addDays(now, -1) : now;
    const since = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime() / 1000;
    const history = IS_TAURI ? await Bridge.recapHistory(since) : sampleHistory(day);
    const digest = (IS_TAURI ? await Bridge.dailyDigest() : sampleDigest()) ?? { repos: [], prs: null };
    const empty: RecapHistory = { turns: [], decisions: [], lastShownWeek: "" };
    this.summary = { which, day, digest, ...sumDay(history ?? empty, day) };
    this.version++;
    return this.summary;
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

  /** One timeout for the next 8:00 or end-of-day hour, set again after it fires. */
  schedule(host: DailyHost, now = new Date()) {
    if (this.timer !== null) window.clearTimeout(this.timer);
    const at = (d: Date, hour: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), hour, 0, 5);
    const next = [at(now, MORNING_FROM), at(now, eveningHour()), at(addDays(now, 1), MORNING_FROM)]
      .find((d) => d.getTime() > now.getTime())!;
    // Timers are not reliable past a sleep of the PC: never more than 6 hours ahead.
    const wait = Math.min(next.getTime() - now.getTime(), 6 * 3600_000);
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.check(host);
      this.schedule(host);
    }, wait);
  }

  private quiet(): boolean {
    if (State.paused || State.pendingApproval || State.quiet) return false;
    if (State.settings.notify === "permissions") return false;
    return State.mode !== "expanded" || QUIET_VIEWS.has(State.view);
  }
}

export const Daily = new DailyController();
