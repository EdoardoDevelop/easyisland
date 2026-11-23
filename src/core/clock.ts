// The clock of the fixed bar (Impostazioni → Barra fissa → Orologio → Opzioni):
// its placeholders as its options say. Here, not in island/bar.ts, so the bar's
// settings window shows examples without loading the bar.

import { locale, t } from "./i18n";
import type { BarItem } from "./state";

/** Now in a time zone ("" = the PC's): year, month, day, hours, minutes, seconds as numbers. */
export function zonedNow(tz: string | undefined, now = new Date()): { y: number; mo: number; d: number; h: number; m: number; s: number } {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-GB", { timeZone: tz || undefined, year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat("en-GB", { year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23" }).formatToParts(now);
  }
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  return { y: n("year"), mo: n("month"), d: n("day"), h: n("hour") % 24, m: n("minute"), s: n("second") };
}

/** The ISO week of a day (1–53): Monday first, week 1 the one with the year's first Thursday. */
function isoWeek(y: number, mo: number, d: number): number {
  const day = new Date(Date.UTC(y, mo - 1, d));
  const dow = day.getUTCDay() || 7;
  day.setUTCDate(day.getUTCDate() + 4 - dow);
  const first = new Date(Date.UTC(day.getUTCFullYear(), 0, 1));
  return Math.ceil(((day.getTime() - first.getTime()) / 86_400_000 + 1) / 7);
}

/** The clock's placeholders, as its options say (Impostazioni → Barra fissa → Orologio → Opzioni). */
export function clockText(it: BarItem): Record<string, string> {
  const o = it.opts ?? {};
  const now = new Date();
  const fmt = (f: Intl.DateTimeFormatOptions) => {
    try {
      return new Intl.DateTimeFormat(locale(), { ...f, timeZone: o.tz || undefined }).format(now);
    } catch {
      return new Intl.DateTimeFormat(locale(), f).format(now);
    }
  };
  const time = fmt({ hour: o.pad === false ? "numeric" : "2-digit", minute: "2-digit", ...(o.seconds ? { second: "2-digit" } : {}), hour12: !!o.h12 });
  const z = zonedNow(o.tz);
  const two = (n: number) => String(n).padStart(2, "0");
  const style = o.dateStyle ?? "short";
  const date = style === "numeric" ? fmt({ day: "2-digit", month: "2-digit" })
    : style === "numericYear" ? fmt({ day: "2-digit", month: "2-digit", year: "numeric" })
    : style === "long" ? fmt({ weekday: "long", day: "numeric", month: "long" })
    : style === "iso" ? `${z.y}-${two(z.mo)}-${two(z.d)}`
    : fmt({ weekday: "short", day: "numeric", month: "short" });
  const city = (o.tz ?? "").split("/").pop()?.replace(/_/g, " ") ?? "";
  return {
    time, value: time, date,
    day: fmt({ weekday: "long" }),
    daynum: String(z.d),
    month: fmt({ month: "long" }),
    year: String(z.y),
    week: t("sett. {n}", { n: isoWeek(z.y, z.mo, z.d) }),
    label: o.label?.trim() || city,
    full: fmt({ weekday: "long", day: "numeric", month: "long", year: "numeric" }),
  };
}

