// The "Consumo Claude" integration: how many tokens Claude Code used in the
// last 5 hours, today and in the last 7 days, per project and per model.
//
// Read from the transcripts Claude Code already writes, every session included
// (terminal, VS Code, the Claude desktop app): %USERPROFILE%\.claude\projects\
// <folder>\<session>.jsonl. Only `message.usage`, `message.model`,
// `message.id`, `timestamp` and `cwd` are read — never the text — and nothing
// leaves the PC. Files are read incrementally (from where the last check
// stopped), and only those touched in the last 8 days.
//
// Anthropic does not publish the Pro / Max limits in tokens: the percentages
// of the plan come from Claude Code itself, which hands them (`rate_limits`) to
// its status line command — the relay's `statusline` (hook/src/statusline.rs,
// installed with the hooks). They arrive only from sessions that draw a status
// line (terminal, VS Code), and survive a restart in plan-limits.json.
//
// One answer appears on several lines (one per content block), each with the
// same usage: entries are counted once per `message.id`.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::widgets::{days_from_civil, FieldValue, Widget, WidgetResult};

const WEEK: i64 = 7 * 86_400;
const FIVE_HOURS: i64 = 5 * 3600;

#[derive(Clone, Debug, Default, PartialEq)]
struct Entry {
    /// Unix seconds (UTC).
    at: i64,
    model: String,
    input: u64,
    output: u64,
    cache_write: u64,
    cache_read: u64,
}

impl Entry {
    /// What counts as "tokens": new input, cache writes and output. Cache reads
    /// are listed apart (they are many and cheap).
    fn tokens(&self) -> u64 {
        self.input + self.output + self.cache_write
    }
}

#[derive(Default)]
struct FileState {
    offset: u64,
    project: String,
    /// The island's own chat (claude -p from EasyIsland), counted apart.
    chat: bool,
    entries: HashMap<String, Entry>,
}

static FILES: Mutex<Option<HashMap<PathBuf, FileState>>> = Mutex::new(None);

fn projects_dir() -> Option<PathBuf> {
    let home = std::env::var_os("USERPROFILE")?;
    Some(PathBuf::from(home).join(".claude").join("projects"))
}

/// "2026-10-05T13:32:29.027Z" → Unix seconds.
fn parse_ts(s: &str) -> Option<i64> {
    let b = s.as_bytes();
    if b.len() < 19 || b[4] != b'-' || b[10] != b'T' {
        return None;
    }
    let n = |r: std::ops::Range<usize>| s.get(r)?.parse::<i64>().ok();
    let days = days_from_civil(n(0..4)?, n(5..7)?, n(8..10)?);
    Some(days * 86_400 + n(11..13)? * 3600 + n(14..16)? * 60 + n(17..19)?)
}

/// One transcript line → (message id, entry, cwd), when it is an answer with usage.
fn parse_line(line: &str) -> Option<(String, Entry, Option<String>)> {
    // Cheap test first: most lines (prompts, tool results…) carry no usage.
    if !line.contains("\"usage\"") {
        return None;
    }
    let v: Value = serde_json::from_str(line).ok()?;
    let msg = v.get("message")?;
    let u = msg.get("usage")?;
    let num = |k: &str| u.get(k).and_then(Value::as_u64).unwrap_or(0);
    let id = msg
        .get("id")
        .and_then(Value::as_str)
        .or_else(|| v.get("requestId").and_then(Value::as_str))
        .or_else(|| v.get("uuid").and_then(Value::as_str))?
        .to_string();
    let entry = Entry {
        at: v.get("timestamp").and_then(Value::as_str).and_then(parse_ts)?,
        model: msg.get("model").and_then(Value::as_str).unwrap_or_default().to_string(),
        input: num("input_tokens"),
        output: num("output_tokens"),
        cache_write: num("cache_creation_input_tokens"),
        cache_read: num("cache_read_input_tokens"),
    };
    // "<synthetic>" answers (errors, interruptions) used nothing.
    if entry.model.starts_with('<') {
        return None;
    }
    let cwd = v.get("cwd").and_then(Value::as_str).map(str::to_string);
    Some((id, entry, cwd))
}

fn last_component(p: &str) -> String {
    p.trim_end_matches(['\\', '/']).rsplit(['\\', '/']).next().unwrap_or(p).to_string()
}

/// Reads what was appended to `path` since `st.offset` (whole lines only).
fn read_new(path: &Path, st: &mut FileState) {
    let Ok(mut f) = std::fs::File::open(path) else { return };
    let len = f.metadata().map(|m| m.len()).unwrap_or(0);
    if len < st.offset {
        // Rewritten from scratch: start over.
        *st = FileState { chat: st.chat, ..Default::default() };
    }
    if len == st.offset || f.seek(SeekFrom::Start(st.offset)).is_err() {
        return;
    }
    let mut buf = Vec::with_capacity((len - st.offset) as usize);
    if f.read_to_end(&mut buf).is_err() {
        return;
    }
    // A line still being written stays for the next check.
    let Some(end) = buf.iter().rposition(|b| *b == b'\n') else { return };
    for line in String::from_utf8_lossy(&buf[..=end]).lines() {
        if let Some((id, entry, cwd)) = parse_line(line) {
            if st.project.is_empty() {
                if let Some(c) = cwd.filter(|c| !c.is_empty()) {
                    st.project = last_component(&c);
                }
            }
            st.entries.insert(id, entry);
        }
    }
    st.offset += end as u64 + 1;
}

/// Every answer of the last 7 days, with its project and whether it was the island's chat.
fn scan(now: i64) -> Vec<(String, bool, Entry)> {
    let Some(root) = projects_dir() else { return Vec::new() };
    let cutoff = SystemTime::now() - Duration::from_secs(8 * 86_400);
    let mut wanted: Vec<(PathBuf, String)> = Vec::new();
    if let Ok(dirs) = std::fs::read_dir(&root) {
        for dir in dirs.flatten() {
            let folder = dir.file_name().to_string_lossy().to_string();
            let Ok(files) = std::fs::read_dir(dir.path()) else { continue };
            for f in files.flatten() {
                let p = f.path();
                let recent = f.metadata().and_then(|m| m.modified()).map(|t| t >= cutoff).unwrap_or(false);
                if recent && p.extension().is_some_and(|e| e == "jsonl") {
                    wanted.push((p, folder.clone()));
                }
            }
        }
    }
    let mut guard = FILES.lock().unwrap();
    let files = guard.get_or_insert_with(HashMap::new);
    files.retain(|p, _| wanted.iter().any(|(w, _)| w == p));
    let mut out = Vec::new();
    for (path, folder) in wanted {
        let st = files.entry(path.clone()).or_insert_with(|| FileState {
            chat: folder.ends_with("-EasyIsland-chat") || folder.ends_with("-Coucou-chat"),
            ..Default::default()
        });
        read_new(&path, st);
        st.entries.retain(|_, e| now - e.at < WEEK + 86_400);
        let project = if st.project.is_empty() { folder.clone() } else { st.project.clone() };
        out.extend(st.entries.values().filter(|e| now - e.at < WEEK).map(|e| (project.clone(), st.chat, e.clone())));
    }
    out
}

// ── Summary ──────────────────────────────────────────────────────────────────

/// 1_234_567 → "1,2 M", 45_300 → "45 mila", 870 → "870".
fn amount(n: u64) -> String {
    let one_decimal = |x: f64| {
        let s = format!("{x:.1}");
        s.strip_suffix(".0").map(str::to_string).unwrap_or(s).replace('.', ",")
    };
    match n {
        0..=999 => n.to_string(),
        1_000..=999_999 => format!("{} mila", (n as f64 / 1000.0).round() as u64),
        1_000_000..=999_999_999 => format!("{} M", one_decimal(n as f64 / 1e6)),
        _ => format!("{} miliardi", one_decimal(n as f64 / 1e9)),
    }
}

/// "claude-opus-5-5" → "Opus 5.5", "claude-sonnet-4-5-20250929" → "Sonnet 4.5".
fn model_name(m: &str) -> String {
    let parts: Vec<&str> = m.trim_start_matches("claude-").split('-').filter(|p| !(p.len() == 8 && p.chars().all(|c| c.is_ascii_digit()))).collect();
    let Some((family, version)) = parts.split_first() else { return m.to_string() };
    let mut name = family.to_string();
    if let Some(c) = name.get_mut(0..1) {
        c.make_ascii_uppercase();
    }
    if version.is_empty() { name } else { format!("{name} {}", version.join(".")) }
}

#[derive(Default)]
struct Totals {
    tokens: u64,
    cache_read: u64,
    answers: u64,
}

impl Totals {
    fn add(&mut self, e: &Entry) {
        self.tokens += e.tokens();
        self.cache_read += e.cache_read;
        self.answers += 1;
    }
    fn text(&self) -> String {
        format!("{} token · {} {}", amount(self.tokens), self.answers, if self.answers == 1 { "risposta" } else { "risposte" })
    }
}

/// The card for the answers in `list`, at `now` (UTC) with local midnight at `midnight`.
fn result_for(id: &str, list: &[(String, bool, Entry)], now: i64, midnight: i64) -> WidgetResult {
    let (mut five, mut today, mut week, mut chat) = (Totals::default(), Totals::default(), Totals::default(), Totals::default());
    let mut projects: HashMap<&str, u64> = HashMap::new();
    let mut models: HashMap<String, u64> = HashMap::new();
    let mut days: HashMap<i64, u64> = HashMap::new();
    for (project, is_chat, e) in list {
        if *is_chat {
            chat.add(e);
            continue;
        }
        week.add(e);
        *projects.entry(project.as_str()).or_default() += e.tokens();
        *models.entry(model_name(&e.model)).or_default() += e.tokens();
        // Local days, counted back from today's midnight.
        *days.entry((e.at - midnight).div_euclid(86_400)).or_default() += e.tokens();
        if now - e.at < FIVE_HOURS {
            five.add(e);
        }
        if e.at >= midnight {
            today.add(e);
        }
    }
    if week.answers == 0 && chat.answers == 0 {
        return WidgetResult::new(id, "ok", "Nessuna sessione di Claude Code negli ultimi 7 giorni");
    }

    // Today against the other active days of the week.
    let past: Vec<u64> = days.iter().filter(|(d, _)| **d < 0).map(|(_, t)| *t).collect();
    let average = if past.is_empty() { 0 } else { past.iter().sum::<u64>() / past.len() as u64 };
    let mut summary = format!("Ultime 5 ore: {} token · oggi {}", amount(five.tokens), amount(today.tokens));
    if average > 0 && today.tokens > average * 3 / 2 {
        summary.push_str(" (più del solito)");
    }

    let mut r = WidgetResult::new(id, "ok", summary);
    let field = |label: &str, value: String| FieldValue { label: label.into(), value };
    r.fields.push(field("Ultime 5 ore", five.text()));
    r.fields.push(field("Oggi", today.text()));
    let mut w = week.text();
    if average > 0 {
        w.push_str(&format!(" · media {} al giorno", amount(average)));
    }
    r.fields.push(field("7 giorni", w));

    let top = |map: Vec<(String, u64)>, total: u64| -> String {
        let mut v = map;
        v.sort_by(|a, b| b.1.cmp(&a.1));
        let shown: Vec<String> = v
            .iter()
            .take(3)
            .map(|(name, t)| format!("{name} {}%", if total == 0 { 0 } else { (t * 100 + total / 2) / total }))
            .collect();
        let more = v.len().saturating_sub(3);
        if more > 0 { format!("{} e altri {more}", shown.join(", ")) } else { shown.join(", ") }
    };
    if !projects.is_empty() {
        r.fields.push(field("Progetti", top(projects.into_iter().map(|(k, v)| (k.to_string(), v)).collect(), week.tokens)));
    }
    if !models.is_empty() {
        r.fields.push(field("Modelli", top(models.into_iter().collect(), week.tokens)));
    }
    r.fields.push(field("Letti dalla cache", format!("{} token in 7 giorni", amount(week.cache_read))));
    if chat.answers > 0 {
        r.fields.push(field("Chat dell'isola", chat.text()));
    }
    r
}

pub async fn probe(w: &Widget) -> WidgetResult {
    let id = w.id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
        // Local midnight in UTC seconds: now minus the local time of day.
        let local = crate::calendar::now_local();
        let midnight = now - local.rem_euclid(86_400);
        let list = scan(now);
        with_plan(result_for(&id, &list, now, midnight), plan().as_ref(), now, local - now)
    })
    .await
    .unwrap_or_else(|_| WidgetResult::new(&w.id, "error", "Lettura delle trascrizioni interrotta"))
}

// ── Plan limits (Pro / Max) ──────────────────────────────────────────────────

/// One window of the plan: used percentage (0–100) and when it starts over.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct PlanWindow {
    pub pct: f64,
    /// Unix seconds.
    pub resets_at: i64,
}

#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
pub struct Plan {
    pub five_hour: Option<PlanWindow>,
    pub seven_day: Option<PlanWindow>,
    /// When Claude Code last sent them (Unix seconds).
    pub at: i64,
}

impl Plan {
    /// The higher of the two windows, counting a window past its reset as 0.
    fn top(&self, now: i64) -> f64 {
        [self.five_hour, self.seven_day].iter().flatten().map(|w| effective(w, now)).fold(0.0, f64::max)
    }
}

const DAY: i64 = 86_400;

fn effective(w: &PlanWindow, now: i64) -> f64 {
    if w.resets_at <= now { 0.0 } else { w.pct }
}

/// `rate_limits.five_hour` or `.seven_day`: `used_percentage` and `resets_at`
/// (epoch seconds). Anything that does not look like it is dropped.
fn parse_window(v: Option<&Value>, now: i64) -> Option<PlanWindow> {
    let v = v?;
    let pct = v.get("used_percentage").and_then(Value::as_f64)?;
    let at = v.get("resets_at").and_then(Value::as_f64)? as i64;
    // 100–200 is a plan over its limit, shown full; a date more than 400 days
    // away is milliseconds in disguise.
    if !(0.0..=200.0).contains(&pct) || at <= 0 || at > now + 400 * DAY {
        return None;
    }
    Some(PlanWindow { pct: pct.min(100.0), resets_at: at })
}

pub fn parse_plan(rate_limits: &Value, now: i64) -> Option<Plan> {
    let five_hour = parse_window(rate_limits.get("five_hour"), now);
    let seven_day = parse_window(rate_limits.get("seven_day"), now);
    (five_hour.is_some() || seven_day.is_some()).then_some(Plan { five_hour, seven_day, at: now })
}

/// The last numbers; `None` until a status line has sent some.
static PLAN: Mutex<Option<Option<Plan>>> = Mutex::new(None);

fn plan_file() -> PathBuf {
    crate::settings::local_dir().join("plan-limits.json")
}

fn plan() -> Option<Plan> {
    let mut guard = PLAN.lock().unwrap_or_else(|e| e.into_inner());
    guard
        .get_or_insert_with(|| std::fs::read(plan_file()).ok().and_then(|b| serde_json::from_slice(&b).ok()))
        .clone()
}

/// Which band the plan is in (under 50, 80, 100 %, full): the card is checked
/// again at once when it changes, not at the next round.
fn band(p: Option<&Plan>, now: i64) -> u8 {
    match p.map(|p| p.top(now)) {
        None => 0,
        Some(x) if x < 50.0 => 1,
        Some(x) if x < 80.0 => 2,
        Some(x) if x < 100.0 => 3,
        Some(_) => 4,
    }
}

/// A status line call with `rate_limits` (pipe.rs). True when the card should
/// be checked again now (first numbers, or another band).
pub fn set_plan(rate_limits: &Value) -> bool {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    let Some(next) = parse_plan(rate_limits, now) else { return false };
    let before = plan();
    // On disk only when the numbers change, or once a minute (the status line
    // runs at every message).
    let same = before.as_ref().is_some_and(|b| b.five_hour == next.five_hour && b.seven_day == next.seven_day);
    if !same || before.as_ref().is_none_or(|b| now - b.at >= 60) {
        let _ = std::fs::write(plan_file(), serde_json::to_vec(&next).unwrap_or_default());
    }
    let changed = band(before.as_ref(), now) != band(Some(&next), now);
    *PLAN.lock().unwrap_or_else(|e| e.into_inner()) = Some(Some(next));
    changed
}

/// "tra 1 h 20" / "tra 5 min" for the 5 hours; "lun 9:00" for the week.
/// `offset`: local time minus UTC, in seconds.
fn reset_text(w: &PlanWindow, weekly: bool, now: i64, offset: i64) -> String {
    let left = w.resets_at - now;
    if left <= 0 {
        return "azzerato".into();
    }
    if weekly && left > DAY {
        const DAYS: [&str; 7] = ["gio", "ven", "sab", "dom", "lun", "mar", "mer"]; // 1 Jan 1970 was a Thursday
        let local = w.resets_at + offset;
        let day = DAYS[local.div_euclid(DAY).rem_euclid(7) as usize];
        let secs = local.rem_euclid(DAY);
        return format!("si azzera {day} {}:{:02}", secs / 3600, (secs % 3600) / 60);
    }
    let (h, m) = (left / 3600, (left % 3600) / 60);
    if h > 0 { format!("si azzera tra {h} h {m:02}") } else { format!("si azzera tra {} min", m.max(1)) }
}

/// The plan's lines on top of the card; it warns from 80 %.
fn with_plan(mut r: WidgetResult, plan: Option<&Plan>, now: i64, offset: i64) -> WidgetResult {
    let Some(p) = plan else { return r };
    let pct = |w: &PlanWindow| format!("{}%", effective(w, now).round() as i64);
    let mut fields = Vec::new();
    let mut parts = Vec::new();
    if let Some(w) = &p.five_hour {
        fields.push(FieldValue { label: "Piano · 5 ore".into(), value: format!("{} · {}", pct(w), reset_text(w, false, now, offset)) });
        parts.push(format!("5 ore {}", pct(w)));
    }
    if let Some(w) = &p.seven_day {
        fields.push(FieldValue { label: "Piano · settimana".into(), value: format!("{} · {}", pct(w), reset_text(w, true, now, offset)) });
        parts.push(format!("settimana {}", pct(w)));
    }
    let age = now - p.at;
    if age >= 15 * 60 {
        let ago = if age < 3600 { format!("{} min fa", age / 60) } else if age < DAY { format!("{} h fa", age / 3600) } else { format!("{} giorni fa", age / DAY) };
        fields.push(FieldValue { label: "Piano aggiornato".into(), value: format!("{ago}, dall'ultima sessione nel terminale") });
    }
    fields.append(&mut r.fields);
    r.fields = fields;
    r.summary = format!("Piano: {}", parts.join(" · "));
    let top = p.top(now);
    if top >= 80.0 && r.level == "ok" {
        r.level = "warn".into();
        r.summary.push_str(if top >= 100.0 { " (limite raggiunto)" } else { " (quasi al limite)" });
    }
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_limits_from_the_status_line() {
        let now = 1_791_207_149; // Mon 2026-10-05 13:32 UTC
        let rl = serde_json::json!({
            "five_hour": { "used_percentage": 42.4, "resets_at": now + 3600 + 20 * 60 },
            "seven_day": { "used_percentage": 85, "resets_at": now + 3 * DAY },
        });
        let p = parse_plan(&rl, now).unwrap();
        assert_eq!(p.five_hour.unwrap().pct, 42.4);
        // Milliseconds, a negative percentage, nothing at all: dropped.
        assert!(parse_plan(&serde_json::json!({ "five_hour": { "used_percentage": 5, "resets_at": now * 1000 } }), now).is_none());
        assert!(parse_plan(&serde_json::json!({ "five_hour": { "used_percentage": -1, "resets_at": now } }), now).is_none());
        assert!(parse_plan(&serde_json::json!({}), now).is_none());

        let r = with_plan(WidgetResult::new("x", "ok", "Ultime 5 ore: …"), Some(&p), now, 2 * 3600);
        assert_eq!(r.summary, "Piano: 5 ore 42% · settimana 85% (quasi al limite)");
        assert_eq!(r.level, "warn");
        assert_eq!(r.fields[0].value, "42% · si azzera tra 1 h 20");
        // Three days on, 15:32 local time: a Thursday.
        assert_eq!(r.fields[1].value, "85% · si azzera gio 15:32");
        // Past its reset a window counts as 0.
        let later = with_plan(WidgetResult::new("x", "ok", ""), Some(&p), now + 2 * 3600, 0);
        assert!(later.fields[0].value.starts_with("0% · azzerato"));
        assert!(later.fields.iter().any(|f| f.label == "Piano aggiornato"));
        assert_ne!(band(None, now), band(Some(&p), now));
    }

    fn line(
id: &str, ts: &str, model: &str, input: u64, output: u64) -> String {
        serde_json::json!({
            "type": "assistant", "timestamp": ts, "cwd": "C:\\Users\\x\\WORK\\progetto",
            "message": { "id": id, "model": model, "role": "assistant", "content": [{ "type": "text", "text": "segreto" }],
                "usage": { "input_tokens": input, "output_tokens": output, "cache_creation_input_tokens": 100, "cache_read_input_tokens": 5000 } }
        })
        .to_string()
    }

    #[test]
    fn timestamps_and_names() {
        assert_eq!(parse_ts("1970-01-02T00:00:01.500Z"), Some(86_401));
        assert_eq!(parse_ts("2026-10-05T13:32:29.027Z"), Some(1_791_207_149));
        assert_eq!(parse_ts("ieri"), None);
        assert_eq!(model_name("claude-opus-5-5"), "Opus 5.5");
        assert_eq!(model_name("claude-sonnet-4-5-20250929"), "Sonnet 4.5");
        assert_eq!(model_name("claude-haiku-4-5-20251001"), "Haiku 4.5");
        assert_eq!(amount(870), "870");
        assert_eq!(amount(45_300), "45 mila");
        assert_eq!(amount(1_234_567), "1,2 M");
        assert_eq!(amount(3_000_000), "3 M");
    }

    #[test]
    fn reads_usage_never_text_and_counts_each_answer_once() {
        let dir = std::env::temp_dir().join(format!("easyisland-usage-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("s.jsonl");
        let a = line("msg_1", "2026-10-05T10:00:00Z", "claude-opus-5-5", 10, 200);
        // The same answer again (another content block), a prompt, a half-written line.
        let done = format!("{a}\n{a}\n{{\"type\":\"user\",\"message\":{{\"content\":\"ciao\"}}}}\n");
        std::fs::write(&path, format!("{done}{}", &a[..20])).unwrap();
        let mut st = FileState::default();
        read_new(&path, &mut st);
        assert_eq!(st.entries.len(), 1);
        assert_eq!(st.project, "progetto");
        let e = &st.entries["msg_1"];
        assert_eq!((e.tokens(), e.cache_read), (310, 5000));
        // The half line is finished later: read from where it stopped.
        let b = line("msg_2", "2026-10-05T11:00:00Z", "claude-sonnet-4-5-20250929", 1, 9);
        std::fs::write(&path, format!("{done}{b}\n")).unwrap();
        read_new(&path, &mut st);
        assert_eq!(st.entries.len(), 2);
        std::fs::remove_dir_all(&dir).ok();
    }

    /// This PC's real transcripts: `cargo test -p easyisland --lib live_usage -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_usage() {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs() as i64;
        let midnight = now - crate::calendar::now_local().rem_euclid(86_400);
        let start = std::time::Instant::now();
        let list = scan(now);
        let first = start.elapsed();
        let start = std::time::Instant::now();
        let again = scan(now);
        println!("{} risposte; prima lettura {first:?}, seconda {:?}", list.len(), start.elapsed());
        assert_eq!(list.len(), again.len());
        let r = result_for("integration_claude_usage", &list, now, midnight);
        println!("{}", r.summary);
        for f in r.fields {
            println!("  {}: {}", f.label, f.value);
        }
    }

    #[test]
    fn card() {
        let now = 1_791_207_149; // 2026-10-05 13:32 UTC
        let midnight = now - 13 * 3600; // a made-up local midnight
        let e = |at: i64, model: &str, tokens: u64| Entry { at, model: model.into(), input: tokens, ..Default::default() };
        let list = vec![
            ("easyisland".to_string(), false, e(now - 600, "claude-opus-5-5", 1_000_000)),
            ("easyisland".to_string(), false, e(now - 6 * 3600, "claude-opus-5-5", 500_000)),
            ("coucou".to_string(), false, e(now - 2 * 86_400, "claude-sonnet-4-5", 300_000)),
            ("chat".to_string(), true, e(now - 60, "claude-opus-5-5", 2_000)),
        ];
        let r = result_for("integration_claude_usage", &list, now, midnight);
        assert_eq!(r.summary, "Ultime 5 ore: 1 M token · oggi 1,5 M (più del solito)");
        let f = |l: &str| r.fields.iter().find(|x| x.label == l).map(|x| x.value.clone()).unwrap_or_default();
        assert_eq!(f("Ultime 5 ore"), "1 M token · 1 risposta");
        assert_eq!(f("7 giorni"), "1,8 M token · 3 risposte · media 300 mila al giorno");
        assert_eq!(f("Progetti"), "easyisland 83%, coucou 17%");
        assert_eq!(f("Modelli"), "Opus 5.5 83%, Sonnet 4.5 17%");
        assert_eq!(f("Chat dell'isola"), "2 mila token · 1 risposta");
        let none = result_for("x", &[], now, midnight);
        assert_eq!(none.summary, "Nessuna sessione di Claude Code negli ultimi 7 giorni");
    }
}
