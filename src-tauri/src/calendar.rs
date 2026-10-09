// The calendar widget: the next appointments from an ICS link (the "secret
// address" Google, Outlook.com and iCloud give for a calendar), no login and no
// OAuth. The link is a secret, so it lives in the Credential Manager as
// `widget:<id>:ics`, never in settings.json.
//
// Times are handled as local wall-clock seconds since 1970. UTC times ("…Z")
// are converted with Windows' own time zone rules; a TZID is taken as the PC's
// zone (true for almost everyone using it on their own PC). Recurring events:
// FREQ DAILY / WEEKLY / MONTHLY / YEARLY with INTERVAL, COUNT, UNTIL, BYDAY
// (also 1MO / -1FR), BYMONTHDAY and BYMONTH; EXDATE and RECURRENCE-ID overrides.

use std::collections::{HashMap, HashSet};

use crate::widgets::{client, days_from_civil, secret_key, FieldValue, Widget, WidgetResult};
use crate::i18n::{t, tf};

/// How far ahead the widget looks.
const HORIZON_DAYS: i64 = 7;
const MAX_ICS_BYTES: usize = 8 * 1024 * 1024;

#[derive(Debug, Clone, Default)]
struct Event {
    uid: String,
    summary: String,
    start: i64,
    end: i64,
    all_day: bool,
    rrule: Option<String>,
    exdates: Vec<i64>,
    recurrence_id: Option<i64>,
    cancelled: bool,
}

/// One appointment in the window.
#[derive(Debug, Clone, PartialEq)]
pub struct Occurrence {
    pub summary: String,
    pub start: i64,
    pub end: i64,
    pub all_day: bool,
}

// ── Calendar arithmetic ───────────────────────────────────────────────────────

/// (year, month, day) for days since 1970-01-01 (Howard Hinnant).
fn civil_from_days(z: i64) -> (i64, i64, i64) {
    let z = z + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

/// 0 = Monday … 6 = Sunday.
fn weekday(days: i64) -> i64 {
    (days + 3).rem_euclid(7)
}

fn days_in_month(y: i64, m: i64) -> i64 {
    let (ny, nm) = if m == 12 { (y + 1, 1) } else { (y, m + 1) };
    days_from_civil(ny, nm, 1) - days_from_civil(y, m, 1)
}

const DAY_CODES: [&str; 7] = ["MO", "TU", "WE", "TH", "FR", "SA", "SU"];

// ── Parsing ───────────────────────────────────────────────────────────────────

/// "20261002T090000Z", "20261002T090000" or "20261002" → local seconds, all-day.
fn parse_time(value: &str, params: &str, to_local: &dyn Fn(i64) -> i64) -> Option<(i64, bool)> {
    let v = value.trim();
    let date = v.get(..8)?;
    let (y, m, d): (i64, i64, i64) = (date[..4].parse().ok()?, date[4..6].parse().ok()?, date[6..8].parse().ok()?);
    let day = days_from_civil(y, m, d);
    if v.len() < 15 || params.to_uppercase().contains("VALUE=DATE") && !params.to_uppercase().contains("VALUE=DATE-TIME") {
        return Some((day * 86_400, true));
    }
    let t = &v[9..15];
    let (hh, mm, ss): (i64, i64, i64) = (t[..2].parse().ok()?, t[2..4].parse().ok()?, t[4..6].parse().ok()?);
    let secs = day * 86_400 + hh * 3600 + mm * 60 + ss;
    let tzid = params.split(';').find_map(|p| p.strip_prefix("TZID=")).unwrap_or("").trim_matches('"').to_uppercase();
    let utc = v.ends_with('Z') || matches!(tzid.as_str(), "UTC" | "ETC/UTC" | "GMT" | "Z" | "ETC/GMT");
    Some((if utc { to_local(secs) } else { secs }, false))
}

/// "PT1H30M", "P1D", "-PT15M" → seconds.
fn parse_duration(v: &str) -> Option<i64> {
    let (neg, v) = match v.strip_prefix('-') { Some(r) => (true, r), None => (false, v.strip_prefix('+').unwrap_or(v)) };
    let v = v.strip_prefix('P')?;
    let mut total = 0i64;
    let mut num = String::new();
    for c in v.chars() {
        match c {
            '0'..='9' => num.push(c),
            'T' => {}
            'W' | 'D' | 'H' | 'M' | 'S' => {
                let n: i64 = num.parse().ok()?;
                num.clear();
                total += n * match c { 'W' => 604_800, 'D' => 86_400, 'H' => 3600, 'M' => 60, _ => 1 };
            }
            _ => return None,
        }
    }
    Some(if neg { -total } else { total })
}

fn unescape(s: &str) -> String {
    s.replace("\\n", " ").replace("\\N", " ").replace("\\,", ",").replace("\\;", ";").replace("\\\\", "\\")
}

fn parse(text: &str, to_local: &dyn Fn(i64) -> i64) -> Vec<Event> {
    // Unfold: a line starting with a space or a tab continues the previous one.
    let mut lines: Vec<String> = Vec::new();
    for raw in text.split('\n') {
        let line = raw.trim_end_matches('\r');
        if (line.starts_with(' ') || line.starts_with('\t')) && !lines.is_empty() {
            lines.last_mut().unwrap().push_str(&line[1..]);
        } else {
            lines.push(line.to_string());
        }
    }
    let mut out = Vec::new();
    let mut cur: Option<Event> = None;
    let mut duration: Option<i64> = None;
    let mut has_end = false;
    let mut depth = 0; // VALARM and friends inside a VEVENT
    for line in lines {
        let Some((head, value)) = line.split_once(':') else { continue };
        let (name, params) = head.split_once(';').unwrap_or((head, ""));
        let name = name.to_uppercase();
        match (name.as_str(), value.trim()) {
            ("BEGIN", "VEVENT") => {
                cur = Some(Event::default());
                duration = None;
                has_end = false;
                depth = 0;
                continue;
            }
            ("BEGIN", _) if cur.is_some() => depth += 1,
            ("END", "VEVENT") => {
                if let Some(mut e) = cur.take() {
                    if !has_end {
                        e.end = e.start + duration.unwrap_or(if e.all_day { 86_400 } else { 0 });
                    }
                    out.push(e);
                }
                continue;
            }
            ("END", _) if cur.is_some() => depth -= 1,
            _ => {}
        }
        let Some(e) = cur.as_mut() else { continue };
        if depth > 0 {
            continue;
        }
        match name.as_str() {
            "UID" => e.uid = value.trim().to_string(),
            "SUMMARY" => e.summary = unescape(value.trim()),
            "DTSTART" => {
                if let Some((t, all_day)) = parse_time(value, params, to_local) {
                    e.start = t;
                    e.all_day = all_day;
                }
            }
            "DTEND" => {
                if let Some((t, _)) = parse_time(value, params, to_local) {
                    e.end = t;
                    has_end = true;
                }
            }
            "DURATION" => duration = parse_duration(value.trim()),
            "RRULE" => e.rrule = Some(value.trim().to_uppercase()),
            "EXDATE" => {
                for part in value.split(',') {
                    if let Some((t, _)) = parse_time(part, params, to_local) {
                        e.exdates.push(t);
                    }
                }
            }
            "RECURRENCE-ID" => e.recurrence_id = parse_time(value, params, to_local).map(|(t, _)| t),
            "STATUS" => e.cancelled = value.trim().eq_ignore_ascii_case("CANCELLED"),
            _ => {}
        }
    }
    out
}

// ── Recurrence ────────────────────────────────────────────────────────────────

struct Rule {
    freq: String,
    interval: i64,
    count: Option<i64>,
    until: Option<i64>,
    by_day: Vec<(i64, i64)>, // (ordinal, weekday): ordinal 0 = every
    by_month_day: Vec<i64>,
    by_month: Vec<i64>,
}

fn parse_rule(rule: &str, to_local: &dyn Fn(i64) -> i64) -> Option<Rule> {
    let mut r = Rule { freq: String::new(), interval: 1, count: None, until: None, by_day: Vec::new(), by_month_day: Vec::new(), by_month: Vec::new() };
    for part in rule.split(';') {
        let (k, v) = part.split_once('=')?;
        match k {
            "FREQ" => r.freq = v.to_string(),
            "INTERVAL" => r.interval = v.parse().ok().filter(|n: &i64| *n > 0).unwrap_or(1),
            "COUNT" => r.count = v.parse().ok(),
            "UNTIL" => r.until = parse_time(v, "", to_local).map(|(t, all_day)| if all_day { t + 86_399 } else { t }),
            "BYDAY" => {
                for d in v.split(',') {
                    let code = &d[d.len().saturating_sub(2)..];
                    let ord: i64 = d[..d.len().saturating_sub(2)].parse().unwrap_or(0);
                    if let Some(wd) = DAY_CODES.iter().position(|c| *c == code) {
                        r.by_day.push((ord, wd as i64));
                    }
                }
            }
            "BYMONTHDAY" => r.by_month_day = v.split(',').filter_map(|x| x.parse().ok()).collect(),
            "BYMONTH" => r.by_month = v.split(',').filter_map(|x| x.parse().ok()).collect(),
            _ => {}
        }
    }
    (!r.freq.is_empty()).then_some(r)
}

/// Days in month (y, m) picked by BYDAY / BYMONTHDAY, or `fallback_day`.
fn month_days(r: &Rule, y: i64, m: i64, fallback_day: i64) -> Vec<i64> {
    let first = days_from_civil(y, m, 1);
    let len = days_in_month(y, m);
    let mut days: Vec<i64> = Vec::new();
    if !r.by_month_day.is_empty() {
        for &md in &r.by_month_day {
            let d = if md < 0 { len + md + 1 } else { md };
            if (1..=len).contains(&d) {
                days.push(first + d - 1);
            }
        }
    } else if !r.by_day.is_empty() {
        for &(ord, wd) in &r.by_day {
            let all: Vec<i64> = (0..len).map(|i| first + i).filter(|d| weekday(*d) == wd).collect();
            match ord {
                0 => days.extend(all),
                n if n > 0 => days.extend(all.get(n as usize - 1)),
                n => days.extend(all.len().checked_sub((-n) as usize).and_then(|i| all.get(i))),
            }
        }
    } else if fallback_day <= len {
        days.push(first + fallback_day - 1);
    }
    days.sort_unstable();
    days.dedup();
    days
}

/// Start times of `e` (local seconds) up to `until`, at most `cap` of them.
fn expand(e: &Event, from: i64, until: i64, to_local: &dyn Fn(i64) -> i64) -> Vec<i64> {
    let Some(rule) = e.rrule.as_deref().and_then(|r| parse_rule(r, to_local)) else {
        return vec![e.start];
    };
    let tod = e.start.rem_euclid(86_400);
    let day0 = e.start.div_euclid(86_400);
    let (y0, m0, d0) = civil_from_days(day0);
    let span = (e.end - e.start).max(0);
    let stop = rule.until.unwrap_or(i64::MAX).min(until);
    let mut out = Vec::new();
    let mut n = 0i64; // occurrences counted for COUNT, from the first one
    let mut push = |t: i64, out: &mut Vec<i64>| -> bool {
        if t < e.start {
            return true;
        }
        if t > stop || rule.count.is_some_and(|c| n >= c) {
            return false;
        }
        n += 1;
        if t + span >= from {
            out.push(t);
        }
        true
    };
    let max_steps = 20_000;
    match rule.freq.as_str() {
        "DAILY" => {
            let step = rule.interval;
            // Without COUNT, jump straight to the window instead of walking years of days.
            let mut k = if rule.count.is_none() { ((from - span - e.start).div_euclid(86_400 * step) - 1).max(0) } else { 0 };
            for _ in 0..max_steps {
                let day = day0 + k * step;
                k += 1;
                if !rule.by_day.is_empty() && !rule.by_day.iter().any(|(_, wd)| *wd == weekday(day)) {
                    if day * 86_400 > stop { break; }
                    continue;
                }
                if !push(day * 86_400 + tod, &mut out) { break; }
            }
        }
        "WEEKLY" => {
            let week0 = day0 - weekday(day0);
            let wds: Vec<i64> = if rule.by_day.is_empty() { vec![weekday(day0)] } else {
                let mut v: Vec<i64> = rule.by_day.iter().map(|(_, wd)| *wd).collect();
                v.sort_unstable();
                v.dedup();
                v
            };
            let mut k = if rule.count.is_none() { ((from - span - e.start).div_euclid(7 * 86_400 * rule.interval) - 1).max(0) } else { 0 };
            'weeks: for _ in 0..max_steps {
                let week = week0 + k * 7 * rule.interval;
                k += 1;
                for &wd in &wds {
                    if !push((week + wd) * 86_400 + tod, &mut out) { break 'weeks; }
                }
            }
        }
        "MONTHLY" => {
            for k in 0..max_steps {
                let mi = (m0 - 1) + k * rule.interval;
                let (y, m) = (y0 + mi.div_euclid(12), mi.rem_euclid(12) + 1);
                if days_from_civil(y, m, 1) * 86_400 > stop { break; }
                let mut go = true;
                for day in month_days(&rule, y, m, d0) {
                    if !push(day * 86_400 + tod, &mut out) { go = false; break; }
                }
                if !go { break; }
            }
        }
        "YEARLY" => {
            for k in 0..max_steps {
                let y = y0 + k * rule.interval;
                if days_from_civil(y, 1, 1) * 86_400 > stop { break; }
                let months: Vec<i64> = if rule.by_month.is_empty() { vec![m0] } else { rule.by_month.clone() };
                let mut go = true;
                for m in months {
                    let picked = if rule.by_day.is_empty() && rule.by_month_day.is_empty() {
                        if d0 <= days_in_month(y, m) { vec![days_from_civil(y, m, d0)] } else { vec![] }
                    } else {
                        month_days(&rule, y, m, d0)
                    };
                    for day in picked {
                        if !push(day * 86_400 + tod, &mut out) { go = false; break; }
                    }
                    if !go { break; }
                }
                if !go { break; }
            }
        }
        _ => return vec![e.start],
    }
    out
}

/// Appointments overlapping [now, now + horizon), soonest first.
pub fn upcoming(text: &str, now: i64, to_local: &dyn Fn(i64) -> i64) -> Vec<Occurrence> {
    let events = parse(text, to_local);
    let horizon = now + HORIZON_DAYS * 86_400;
    // Single occurrences moved or edited on their own (RECURRENCE-ID).
    let overridden: HashSet<(String, i64)> =
        events.iter().filter_map(|e| e.recurrence_id.map(|r| (e.uid.clone(), r))).collect();
    let mut out = Vec::new();
    for e in &events {
        if e.cancelled || e.start == 0 {
            continue;
        }
        let span = (e.end - e.start).max(0);
        let starts = if e.recurrence_id.is_some() { vec![e.start] } else { expand(e, now, horizon, to_local) };
        for s in starts {
            if s >= horizon || s + span <= now {
                continue;
            }
            if e.recurrence_id.is_none() && (e.exdates.contains(&s) || overridden.contains(&(e.uid.clone(), s))) {
                continue;
            }
            out.push(Occurrence { summary: if e.summary.is_empty() { t("(senza titolo)").into() } else { e.summary.clone() }, start: s, end: s + span, all_day: e.all_day });
        }
    }
    out.sort_by_key(|o| (o.start, o.all_day));
    // The same occurrence twice (a feed listing an override and its series both).
    let mut seen: HashMap<(i64, String), ()> = HashMap::new();
    out.retain(|o| seen.insert((o.start, o.summary.clone()), ()).is_none());
    out
}

// ── Text ──────────────────────────────────────────────────────────────────────

const DAYS_IT: [&str; 7] = ["lun", "mar", "mer", "gio", "ven", "sab", "dom"];
const MONTHS_IT: [&str; 12] = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"];
const DAYS_EN: [&str; 7] = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS_EN: [&str; 12] = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

fn hm(t: i64) -> String {
    let s = t.rem_euclid(86_400);
    format!("{}:{:02}", s / 3600, (s % 3600) / 60)
}

/// "oggi", "domani" or "lun 6 ott".
fn day_label(t: i64, now: i64) -> String {
    let (d, today) = (t.div_euclid(86_400), now.div_euclid(86_400));
    match d - today {
        0 => crate::i18n::t("oggi").into(),
        1 => crate::i18n::t("domani").into(),
        _ => {
            let (_, m, day) = civil_from_days(d);
            if crate::i18n::english() {
                format!("{} {day} {}", DAYS_EN[weekday(d) as usize], MONTHS_EN[(m - 1) as usize])
            } else {
                format!("{} {day} {}", DAYS_IT[weekday(d) as usize], MONTHS_IT[(m - 1) as usize])
            }
        }
    }
}

/// (level, summary, fields) for what is coming. `warn_min`: minutes before a
/// start that count as "about to begin".
pub fn describe(list: &[Occurrence], now: i64, warn_min: i64) -> (&'static str, String, Vec<FieldValue>) {
    let fields: Vec<FieldValue> = list
        .iter()
        .take(4)
        .map(|o| FieldValue {
            label: if o.all_day { day_label(o.start, now) } else { format!("{} {}", day_label(o.start, now), hm(o.start)) },
            value: o.summary.clone(),
        })
        .collect();
    let timed: Vec<&Occurrence> = list.iter().filter(|o| !o.all_day).collect();
    if let Some(o) = timed.iter().find(|o| o.start <= now && o.end > now) {
        return ("ok", tf("In corso: {what} (fino alle {end})", &[("what", &o.summary), ("end", &hm(o.end))]), fields);
    }
    if let Some(o) = timed.iter().find(|o| o.start > now) {
        let mins = (o.start - now + 59) / 60;
        let soon = mins <= warn_min;
        let when = if mins < 60 {
            tf("Tra {mins} min", &[("mins", &mins)])
        } else {
            capitalise(&tf("{day} alle {time}", &[("day", &day_label(o.start, now)), ("time", &hm(o.start))]))
        };
        return (if soon { "warn" } else { "ok" }, format!("{when}: {}", o.summary), fields);
    }
    if let Some(o) = list.first() {
        return ("ok", tf("{day}: {what} (tutto il giorno)", &[("day", &capitalise(&day_label(o.start, now))), ("what", &o.summary)]), fields);

    }
    ("ok", t("Nessun appuntamento nei prossimi 7 giorni").into(), fields)
}

fn capitalise(s: &str) -> String {
    let mut c = s.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
}

// ── Windows clock and the probe ───────────────────────────────────────────────

fn systemtime_secs(t: &windows::Win32::Foundation::SYSTEMTIME) -> i64 {
    days_from_civil(t.wYear as i64, t.wMonth as i64, t.wDay as i64) * 86_400
        + t.wHour as i64 * 3600 + t.wMinute as i64 * 60 + t.wSecond as i64
}

pub(crate) fn now_local() -> i64 {
    systemtime_secs(&unsafe { windows::Win32::System::SystemInformation::GetLocalTime() })
}

/// UTC wall-clock seconds → local wall-clock seconds, with Windows' rules (DST included).
fn utc_to_local(secs: i64) -> i64 {
    use windows::Win32::Foundation::SYSTEMTIME;
    use windows::Win32::System::Time::SystemTimeToTzSpecificLocalTime;
    let (y, m, d) = civil_from_days(secs.div_euclid(86_400));
    let s = secs.rem_euclid(86_400);
    let utc = SYSTEMTIME {
        wYear: y as u16, wMonth: m as u16, wDay: d as u16, wDayOfWeek: 0,
        wHour: (s / 3600) as u16, wMinute: ((s % 3600) / 60) as u16, wSecond: (s % 60) as u16, wMilliseconds: 0,
    };
    let mut local = SYSTEMTIME::default();
    if unsafe { SystemTimeToTzSpecificLocalTime(None, &utc, &mut local) }.is_ok() {
        systemtime_secs(&local)
    } else {
        secs
    }
}

pub async fn probe(w: &Widget) -> WidgetResult {
    let Some(link) = crate::secrets::get(&secret_key(&w.id, "ics")) else {
        return WidgetResult::new(&w.id, "error", t("Incolla il link ICS del calendario nelle impostazioni del widget"));
    };
    let link = link.trim().replacen("webcal://", "https://", 1);
    if !link.starts_with("https://") && !link.starts_with("http://") {
        return WidgetResult::new(&w.id, "error", t("Il link del calendario deve iniziare con https://"));
    }
    let Some(c) = client() else { return WidgetResult::new(&w.id, "error", t("HTTP non disponibile")) };
    let resp = match c.get(&link).send().await {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => return WidgetResult::new(&w.id, "error", format!("Calendario: HTTP {}", r.status().as_u16())),
        Err(e) => return WidgetResult::new(&w.id, "error", tf("Calendario non raggiungibile: {e}", &[("e", &e)])),
    };
    let bytes = match resp.bytes().await {
        Ok(b) if b.len() <= MAX_ICS_BYTES => b,
        Ok(_) => return WidgetResult::new(&w.id, "error", t("Calendario troppo grande")),
        Err(e) => return WidgetResult::new(&w.id, "error", tf("Calendario non leggibile: {e}", &[("e", &e)])),
    };
    let text = String::from_utf8_lossy(&bytes);
    if !text.contains("BEGIN:VCALENDAR") {
        return WidgetResult::new(&w.id, "error", t("Il link non è un calendario ICS"));
    }
    let now = now_local();
    let list = upcoming(&text, now, &utc_to_local);
    let warn_min = if w.warn_days > 0 { w.warn_days } else { 10 };
    let (level, summary, fields) = describe(&list, now, warn_min);
    let mut r = WidgetResult::new(&w.id, level, summary);
    r.fields = fields;
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAME: fn(i64) -> i64 = |t| t;
    // A fixed "UTC+2": to check that only …Z times move.
    const PLUS2: fn(i64) -> i64 = |t| t + 7200;

    fn at(y: i64, m: i64, d: i64, hh: i64, mm: i64) -> i64 {
        days_from_civil(y, m, d) * 86_400 + hh * 3600 + mm * 60
    }

    fn ics(body: &str) -> String {
        format!("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n{body}END:VCALENDAR\r\n")
    }

    #[test]
    fn civil_round_trip_and_weekdays() {
        for d in [-1000, 0, 19_000, 20_727, 30_000] {
            let (y, m, dd) = civil_from_days(d);
            assert_eq!(days_from_civil(y, m, dd), d);
        }
        assert_eq!(weekday(days_from_civil(2026, 10, 2)), 4); // Friday
        assert_eq!(days_in_month(2028, 2), 29);
    }

    #[test]
    fn single_events_utc_and_folded_summary() {
        let text = ics("BEGIN:VEVENT\r\nUID:a\r\nDTSTART:20261002T080000Z\r\nDTEND:20261002T090000Z\r\nSUMMARY:Riunione\r\n  cliente\\, Milano\r\nEND:VEVENT\r\n");
        let now = at(2026, 10, 2, 9, 30);
        let list = upcoming(&text, now, &PLUS2);
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].start, at(2026, 10, 2, 10, 0), "UTC 08:00 is 10:00 at UTC+2");
        assert_eq!(list[0].summary, "Riunione cliente, Milano");
        let (level, summary, _) = describe(&list, now, 10);
        assert_eq!((level, summary.as_str()), ("ok", "Tra 30 min: Riunione cliente, Milano"));
        let (level, _, _) = describe(&list, at(2026, 10, 2, 9, 55), 10);
        assert_eq!(level, "warn");
        let (_, summary, _) = describe(&list, at(2026, 10, 2, 10, 15), 10);
        assert_eq!(summary, "In corso: Riunione cliente, Milano (fino alle 11:00)");
    }

    #[test]
    fn weekly_recurrence_with_exdate_and_override() {
        let text = ics(concat!(
            "BEGIN:VEVENT\r\nUID:w\r\nDTSTART;TZID=Europe/Rome:20250106T093000\r\nDTEND;TZID=Europe/Rome:20250106T100000\r\n",
            "RRULE:FREQ=WEEKLY;BYDAY=MO,WE\r\nEXDATE;TZID=Europe/Rome:20261005T093000\r\nSUMMARY:Stand-up\r\nEND:VEVENT\r\n",
            "BEGIN:VEVENT\r\nUID:w\r\nRECURRENCE-ID;TZID=Europe/Rome:20261007T093000\r\nDTSTART;TZID=Europe/Rome:20261007T110000\r\n",
            "DTEND;TZID=Europe/Rome:20261007T113000\r\nSUMMARY:Stand-up (spostato)\r\nEND:VEVENT\r\n",
        ));
        let now = at(2026, 10, 2, 12, 0); // Friday
        let list = upcoming(&text, now, &SAME);
        let starts: Vec<(i64, &str)> = list.iter().map(|o| (o.start, o.summary.as_str())).collect();
        assert_eq!(starts, vec![
            // Monday 5th is an EXDATE; Wednesday 7th was moved to 11:00.
            (at(2026, 10, 7, 11, 0), "Stand-up (spostato)"),
        ]);
    }

    #[test]
    fn monthly_nth_weekday_daily_count_and_all_day() {
        let text = ics(concat!(
            "BEGIN:VEVENT\r\nUID:m\r\nDTSTART:20260105T140000\r\nDURATION:PT1H\r\nRRULE:FREQ=MONTHLY;BYDAY=1MO\r\nSUMMARY:Consiglio\r\nEND:VEVENT\r\n",
            "BEGIN:VEVENT\r\nUID:d\r\nDTSTART:20260928T080000\r\nRRULE:FREQ=DAILY;COUNT=5\r\nSUMMARY:Backup\r\nEND:VEVENT\r\n",
            "BEGIN:VEVENT\r\nUID:x\r\nDTSTART;VALUE=DATE:20261003\r\nSUMMARY:Ferie\r\nEND:VEVENT\r\n",
            "BEGIN:VEVENT\r\nUID:c\r\nDTSTART:20261003T100000\r\nSTATUS:CANCELLED\r\nSUMMARY:Annullato\r\nEND:VEVENT\r\n",
        ));
        let now = at(2026, 9, 30, 12, 0);
        let list = upcoming(&text, now, &SAME);
        let got: Vec<(i64, &str, bool)> = list.iter().map(|o| (o.start, o.summary.as_str(), o.all_day)).collect();
        assert_eq!(got, vec![
            (at(2026, 10, 1, 8, 0), "Backup", false),
            (at(2026, 10, 2, 8, 0), "Backup", false), // COUNT=5: 28, 29, 30, 1, 2
            (at(2026, 10, 3, 0, 0), "Ferie", true),
            (at(2026, 10, 5, 14, 0), "Consiglio", false), // first Monday of October
        ]);
        assert_eq!(describe(&list, now, 10).1, "Domani alle 8:00: Backup");
    }

    #[test]
    fn durations() {
        assert_eq!(parse_duration("PT1H30M"), Some(5400));
        assert_eq!(parse_duration("P1D"), Some(86_400));
        assert_eq!(parse_duration("P1W"), Some(604_800));
        assert_eq!(parse_duration("-PT15M"), Some(-900));
    }
}
