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
// of the plan come from two places, the newest wins, and survive a restart in
// plan-limits.json:
//   - Anthropic itself, asked every 5 minutes while the card is on, with the
//     login Claude Code keeps in %USERPROFILE%\.claude\.credentials.json (the
//     same call as Claude Code's /usage; read only, never copied or logged:
//     an expired login is renewed by Claude Code itself, started hidden by
//     renew.rs). It is not a documented API: when it stops answering the card
//     keeps the last numbers;
//   - Claude Code's status line (`rate_limits`), the relay's `statusline`
//     (hook/src/statusline.rs, installed with the hooks), from the sessions
//     that draw one (terminal, VS Code).
//
// One answer appears on several lines (one per content block), each with the
// same usage: entries are counted once per `message.id`.

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::widgets::{days_from_civil, FieldValue, Widget, WidgetResult};
use crate::i18n::{t, tf};

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
        let answers = if self.answers == 1 { t("1 risposta").to_string() } else { tf("{n} risposte", &[("n", &self.answers)]) };
        format!("{} token · {answers}", amount(self.tokens))
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
        return WidgetResult::new(id, "ok", t("Nessuna sessione di Claude Code negli ultimi 7 giorni"));
    }

    // Today against the other active days of the week.
    let past: Vec<u64> = days.iter().filter(|(d, _)| **d < 0).map(|(_, t)| *t).collect();
    let average = if past.is_empty() { 0 } else { past.iter().sum::<u64>() / past.len() as u64 };
    let mut summary = tf("Ultime 5 ore: {five} token · oggi {today}", &[("five", &amount(five.tokens)), ("today", &amount(today.tokens))]);
    if average > 0 && today.tokens > average * 3 / 2 {
        summary.push_str(t(" (più del solito)"));
    }

    let mut r = WidgetResult::new(id, "ok", summary);
    let field = |label: &str, value: String| FieldValue { label: label.into(), value };
    r.fields.push(field(t("Ultime 5 ore"), five.text()));
    r.fields.push(field(t("Oggi"), today.text()));
    let mut w = week.text();
    if average > 0 {
        w.push_str(&tf(" · media {n} al giorno", &[("n", &amount(average))]));
    }
    r.fields.push(field(t("7 giorni"), w));

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
        r.fields.push(field(t("Progetti"), top(projects.into_iter().map(|(k, v)| (k.to_string(), v)).collect(), week.tokens)));
    }
    if !models.is_empty() {
        r.fields.push(field(t("Modelli"), top(models.into_iter().collect(), week.tokens)));
    }
    r.fields.push(field(t("Letti dalla cache"), tf("{n} token in 7 giorni", &[("n", &amount(week.cache_read))])));
    if chat.answers > 0 {
        r.fields.push(field(t("Chat dell'isola"), chat.text()));
    }
    r
}

pub async fn probe(w: &Widget) -> WidgetResult {
    // The transcripts are read while Anthropic is asked for the plan.
    let scanning = tauri::async_runtime::spawn_blocking(move || {
        let now = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
        // Local midnight in UTC seconds: now minus the local time of day.
        let local = crate::calendar::now_local();
        let midnight = now - local.rem_euclid(86_400);
        let list = scan(now);
        (list, now, midnight, local)
    });
    ask_anthropic().await;
    scanning
        .await
        .map(|(list, now, midnight, local)| with_plan(result_for(&w.id, &list, now, midnight), plan().as_ref(), now, local - now))
        .unwrap_or_else(|_| WidgetResult::new(&w.id, "error", t("Lettura delle trascrizioni interrotta")))
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
    /// Max plans: the week's own limit for Opus (Anthropic only).
    #[serde(default)]
    pub seven_day_opus: Option<PlanWindow>,
    /// When they last arrived (Unix seconds).
    pub at: i64,
}

impl Plan {
    /// The highest window, counting a window past its reset as 0.
    pub fn top(&self, now: i64) -> f64 {
        [self.five_hour, self.seven_day, self.seven_day_opus].iter().flatten().map(|w| effective(w, now)).fold(0.0, f64::max)
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
    (five_hour.is_some() || seven_day.is_some()).then_some(Plan { five_hour, seven_day, seven_day_opus: None, at: now })
}

// ── Asking Anthropic ──

const USAGE_URL: &str = "https://api.anthropic.com/api/oauth/usage";
/// Between two questions; after a refusal or an error, much longer.
const ASK_EVERY: i64 = 5 * 60;
const ASK_AFTER_ERROR: i64 = 30 * 60;
struct Ask {
    /// When the next question may go (Unix seconds).
    next: i64,
    /// The last outcome, logged when it changes.
    outcome: String,
    /// `.credentials.json`'s last change: a new one is asked about at once.
    stamp: Option<SystemTime>,
}

static ASK: Mutex<Ask> = Mutex::new(Ask { next: 0, outcome: String::new(), stamp: None });

/// "Aggiorna" on the card: the next check asks Anthropic without waiting its
/// turn, and renews an expired login at once.
pub fn ask_now() {
    ASK.lock().unwrap_or_else(|e| e.into_inner()).next = 0;
    RENEW_NEXT.store(0, Ordering::Relaxed);
}

/// An expired login is renewed by Claude Code (renew.rs) at most once per
/// RENEW_EVERY on its own: one that does not renew is not started every round.
const RENEW_EVERY: i64 = 30 * 60;
const RENEW_TIMEOUT: Duration = Duration::from_secs(45);
static RENEW_NEXT: AtomicI64 = AtomicI64::new(0);
static RENEWING: AtomicBool = AtomicBool::new(false);
/// The last attempt did not renew it (for the card's reason).
static RENEW_FAILED: AtomicBool = AtomicBool::new(false);

fn unix_now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

/// Has Claude Code renew an expired login; the new token when it did.
async fn renew_login(now: i64) -> Option<String> {
    if now < RENEW_NEXT.load(Ordering::Relaxed) || RENEWING.swap(true, Ordering::AcqRel) {
        return None;
    }
    RENEW_NEXT.store(now + RENEW_EVERY, Ordering::Relaxed);
    let renewed = match crate::claude_cli::find_claude() {
        Some(exe) => tokio::task::spawn_blocking(move || {
            crate::renew::renew(&exe, RENEW_TIMEOUT, || matches!(claude_login(unix_now()), Login::Valid(_)))
        })
        .await
        .unwrap_or(false),
        None => false,
    };
    RENEWING.store(false, Ordering::Release);
    RENEW_FAILED.store(!renewed, Ordering::Relaxed);
    crate::log::line(if renewed {
        "limiti del piano: accesso di Claude Code rinnovato".to_string()
    } else {
        "limiti del piano: Claude Code non ha rinnovato l'accesso".to_string()
    });
    match claude_login(unix_now()) {
        Login::Valid(token) => Some(token),
        _ => None,
    }
}

/// "2026-10-12T15:00:00.123456+00:00" (or "Z", or another offset) → Unix seconds.
fn iso_seconds(s: &str) -> Option<i64> {
    let (date, rest) = s.split_once('T')?;
    let mut d = date.split('-').map(|x| x.parse::<i64>().ok());
    let (y, m, day) = (d.next()??, d.next()??, d.next()??);
    let (time, offset) = match rest.find(['Z', 'z', '+', '-']) {
        Some(i) => rest.split_at(i),
        None => (rest, ""),
    };
    let mut t = time.split(':');
    let h = t.next()?.parse::<i64>().ok()?;
    let mi = t.next()?.parse::<i64>().ok()?;
    let sec = t.next().map_or(Some(0.0), |x| x.parse::<f64>().ok())? as i64;
    let off = match offset.as_bytes().first() {
        Some(b'+') | Some(b'-') => {
            let sign = if offset.starts_with('-') { -1 } else { 1 };
            let body = &offset[1..];
            let (oh, om) = body.split_once(':').unwrap_or((body.get(..2)?, body.get(2..).filter(|x| !x.is_empty()).unwrap_or("0")));
            sign * (oh.parse::<i64>().ok()? * 3600 + om.parse::<i64>().ok()? * 60)
        }
        _ => 0,
    };
    Some(crate::widgets::days_from_civil(y, m, day) * DAY + h * 3600 + mi * 60 + sec - off)
}

/// One window of Anthropic's answer: `utilization` (0–100) and `resets_at` (ISO).
fn usage_window(v: Option<&Value>, now: i64) -> Option<PlanWindow> {
    let v = v?;
    let pct = v.get("utilization").and_then(Value::as_f64)?;
    let at = v.get("resets_at").and_then(Value::as_str).and_then(iso_seconds)?;
    if !(0.0..=200.0).contains(&pct) || at <= 0 || at > now + 400 * DAY {
        return None;
    }
    Some(PlanWindow { pct: pct.min(100.0), resets_at: at })
}

pub fn parse_usage(v: &Value, now: i64) -> Option<Plan> {
    let five_hour = usage_window(v.get("five_hour"), now);
    let seven_day = usage_window(v.get("seven_day"), now);
    let seven_day_opus = usage_window(v.get("seven_day_opus"), now);
    (five_hour.is_some() || seven_day.is_some()).then_some(Plan { five_hour, seven_day, seven_day_opus, at: now })
}

fn credentials_file() -> Option<PathBuf> {
    Some(Path::new(&std::env::var_os("USERPROFILE")?).join(".claude").join(".credentials.json"))
}

fn credentials_stamp() -> Option<SystemTime> {
    std::fs::metadata(credentials_file()?).and_then(|m| m.modified()).ok()
}

#[derive(Debug, PartialEq)]
enum Login {
    Valid(String),
    /// Past `expiresAt`. The Claude desktop app does not renew this file, nor
    /// `claude auth status` (tried 13 October 2026): renew.rs has an
    /// interactive Claude Code do it.
    Expired,
    Missing,
}

/// Claude Code's login (`claudeAiOauth.accessToken`).
fn claude_login(now: i64) -> Login {
    let Some(v) = credentials_file().and_then(|f| std::fs::read(f).ok()).and_then(|b| serde_json::from_slice::<Value>(&b).ok()) else {
        return Login::Missing;
    };
    read_login(&v, now)
}

fn read_login(v: &Value, now: i64) -> Login {
    let Some(oauth) = v.get("claudeAiOauth") else { return Login::Missing };
    let Some(token) = oauth.get("accessToken").and_then(Value::as_str).filter(|t| !t.is_empty()) else {
        return Login::Missing;
    };
    // Milliseconds; a minute's margin.
    match oauth.get("expiresAt").and_then(Value::as_i64) {
        Some(expires) if expires / 1000 <= now + 60 => Login::Expired,
        _ => Login::Valid(token.to_string()),
    }
}

/// Why the plan's numbers stopped coming, for the card's "Piano aggiornato".
fn plan_problem() -> Option<&'static str> {
    let ask = ASK.lock().unwrap_or_else(|e| e.into_inner());
    match ask.outcome.as_str() {
        "" | "ok" => None,
        "expired" if RENEW_FAILED.load(Ordering::Relaxed) => {
            Some(t("l'accesso di Claude Code è scaduto e Claude Code non l'ha rinnovato: riprovo tra mezz'ora, o premi Aggiorna"))
        }
        "expired" => Some(t("l'accesso di Claude Code è scaduto: lo rinnovo con Claude Code")),
        "no-login" => Some(t("Claude Code non ha un accesso su questo PC")),
        _ => Some(t("Anthropic non risponde")),
    }
}

/// Asks Anthropic for the plan, at most every ASK_EVERY. Quiet on failure:
/// one log line when the outcome changes, the token never in it.
async fn ask_anthropic() {
    let now = unix_now();
    let stamp = credentials_stamp();
    {
        let ask = ASK.lock().unwrap_or_else(|e| e.into_inner());
        // A login renewed meanwhile (Claude Code in a terminal) is used at once.
        let renewed = ask.outcome != "ok" && stamp != ask.stamp;
        if (now < ask.next && !renewed) || crate::integrations::PAUSED.load(std::sync::atomic::Ordering::Relaxed) {
            return;
        }
    }
    let outcome = match claude_login(now) {
        Login::Missing => "no-login".to_string(),
        Login::Expired => match renew_login(now).await {
            Some(token) => request(token, now).await,
            None => "expired".to_string(),
        },
        Login::Valid(token) => request(token, now).await,
    };
    let mut ask = ASK.lock().unwrap_or_else(|e| e.into_inner());
    ask.next = now + if matches!(outcome.as_str(), "ok" | "no-login" | "expired") { ASK_EVERY } else { ASK_AFTER_ERROR };
    ask.stamp = credentials_stamp();
    if ask.outcome != outcome {
        crate::log::line(format!("limiti del piano da Anthropic: {outcome}"));
        ask.outcome = outcome;
    }
}

/// One question to Anthropic; the outcome for the log.
async fn request(token: String, now: i64) -> String {
    {
        {
            let client = reqwest::Client::builder().timeout(Duration::from_secs(10)).build().unwrap_or_default();
            let sent = client
                .get(USAGE_URL)
                .bearer_auth(token)
                .header("anthropic-beta", "oauth-2025-04-20")
                .header("accept", "application/json")
                .send()
                .await;
            match sent {
                Err(_) => "network".to_string(),
                Ok(r) if !r.status().is_success() => format!("HTTP {}", r.status().as_u16()),
                Ok(r) => match r.json::<Value>().await.ok().and_then(|v| parse_usage(&v, now)) {
                    Some(p) => {
                        store_plan(p, now);
                        "ok".to_string()
                    }
                    None => "unreadable".to_string(),
                },
            }
        }
    }
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
    let Some(mut next) = parse_plan(rate_limits, now) else { return false };
    // The status line has no Opus week: keep Anthropic's.
    next.seven_day_opus = plan().and_then(|p| p.seven_day_opus);
    store_plan(next, now)
}

/// The newest numbers, from either source. True when the band changed.
fn store_plan(next: Plan, now: i64) -> bool {
    let before = plan();
    // On disk only when the numbers change, or once a minute (the status line
    // runs at every message).
    let same = before.as_ref().is_some_and(|b| b.five_hour == next.five_hour && b.seven_day == next.seven_day && b.seven_day_opus == next.seven_day_opus);
    if !same || before.as_ref().is_none_or(|b| now - b.at >= 60) {
        let _ = crate::settings::write_atomic(&plan_file(), &serde_json::to_vec(&next).unwrap_or_default());
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
        // 1 Jan 1970 was a Thursday.
        const DAYS: [&str; 7] = ["gio", "ven", "sab", "dom", "lun", "mar", "mer"];
        const DAYS_EN: [&str; 7] = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"];
        let local = w.resets_at + offset;
        let i = local.div_euclid(DAY).rem_euclid(7) as usize;
        let day = if crate::i18n::english() { DAYS_EN[i] } else { DAYS[i] };
        let secs = local.rem_euclid(DAY);
        let at = format!("{day} {}:{:02}", secs / 3600, (secs % 3600) / 60);
        return tf("si azzera {when}", &[("when", &at)]);
    }
    let (h, m) = (left / 3600, (left % 3600) / 60);
    if h > 0 { tf("si azzera tra {h} h {m}", &[("h", &h), ("m", &format!("{m:02}"))]) } else { tf("si azzera tra {m} min", &[("m", &m.max(1))]) }
}

/// The plan in the island's header: what is used now (0 past a reset), and when
/// each window starts over (Unix seconds).
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanGauge {
    pub five_hour: Option<[f64; 2]>,
    pub seven_day: Option<[f64; 2]>,
    pub seven_day_opus: Option<[f64; 2]>,
    /// When the numbers arrived (Unix seconds): old ones are shown grey.
    pub at: i64,
}

/// The plan's lines on top of the card; it warns from 80 %.
fn with_plan(mut r: WidgetResult, plan: Option<&Plan>, now: i64, offset: i64) -> WidgetResult {
    let Some(p) = plan else { return r };
    let gauge = |w: &Option<PlanWindow>| w.map(|w| [effective(&w, now), w.resets_at as f64]);
    r.plan = Some(PlanGauge { five_hour: gauge(&p.five_hour), seven_day: gauge(&p.seven_day), seven_day_opus: gauge(&p.seven_day_opus), at: p.at });
    let pct = |w: &PlanWindow| format!("{}%", effective(w, now).round() as i64);
    let mut fields = Vec::new();
    let mut parts = Vec::new();
    if let Some(w) = &p.five_hour {
        fields.push(FieldValue { label: t("Piano · 5 ore").into(), value: format!("{} · {}", pct(w), reset_text(w, false, now, offset)) });
        parts.push(tf("5 ore {pct}", &[("pct", &pct(w))]));
    }
    if let Some(w) = &p.seven_day {
        fields.push(FieldValue { label: t("Piano · settimana").into(), value: format!("{} · {}", pct(w), reset_text(w, true, now, offset)) });
        parts.push(tf("settimana {pct}", &[("pct", &pct(w))]));
    }
    if let Some(w) = &p.seven_day_opus {
        fields.push(FieldValue { label: t("Piano · settimana Opus").into(), value: format!("{} · {}", pct(w), reset_text(w, true, now, offset)) });
    }
    let age = now - p.at;
    if age >= 15 * 60 {
        let ago = if age < 3600 {
            tf("{n} min fa", &[("n", &(age / 60))])
        } else if age < DAY {
            tf("{n} h fa", &[("n", &(age / 3600))])
        } else {
            tf("{n} giorni fa", &[("n", &(age / DAY))])
        };
        let value = match plan_problem() {
            Some(why) => format!("{ago} · {why}"),
            None => ago,
        };
        fields.push(FieldValue { label: t("Piano aggiornato").into(), value });
    }
    fields.append(&mut r.fields);
    r.fields = fields;
    r.summary = tf("Piano: {parts}", &[("parts", &parts.join(" · "))]);
    let top = p.top(now);
    if top >= 80.0 && r.level == "ok" {
        r.level = "warn".into();
        r.summary.push_str(if top >= 100.0 { t(" (limite raggiunto)") } else { t(" (quasi al limite)") });

    }
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plan_limits_from_anthropic() {
        assert_eq!(iso_seconds("1970-01-02T00:00:00Z"), Some(86_400));
        assert_eq!(iso_seconds("2026-10-12T15:00:00.123456+00:00"), iso_seconds("2026-10-12T17:00:00+02:00"));
        assert_eq!(iso_seconds("2026-10-12T15:00:00+0200"), iso_seconds("2026-10-12T13:00:00Z"));
        assert_eq!(iso_seconds("2026-10-12"), None);
        let now = iso_seconds("2026-10-12T12:00:00Z").unwrap();
        let v = serde_json::json!({
            "five_hour": { "utilization": 37.0, "resets_at": "2026-10-12T15:00:00.5+00:00" },
            "seven_day": { "utilization": 12.5, "resets_at": "2026-10-16T09:00:00+00:00" },
            "seven_day_opus": null,
        });
        let p = parse_usage(&v, now).unwrap();
        assert_eq!(p.five_hour.unwrap().pct, 37.0);
        assert_eq!(p.five_hour.unwrap().resets_at - now, 3 * 3600);
        assert!(p.seven_day_opus.is_none());
        assert!(parse_usage(&serde_json::json!({ "error": "x" }), now).is_none());
    }

    #[test]
    fn an_expired_login_is_not_a_missing_one() {
        let now = 1_000_000;
        let login = |expires: i64| serde_json::json!({ "claudeAiOauth": { "accessToken": "x", "expiresAt": expires * 1000 } });
        assert_eq!(read_login(&login(now + 3600), now), Login::Valid("x".into()));
        assert_eq!(read_login(&login(now + 30), now), Login::Expired);
        assert_eq!(read_login(&serde_json::json!({ "claudeAiOauth": { "accessToken": "" } }), now), Login::Missing);
        assert_eq!(read_login(&serde_json::json!({}), now), Login::Missing);
    }

    #[test]
    #[ignore = "asks Anthropic with this PC's Claude Code login: cargo test plan_from_anthropic_live -- --ignored"]
    fn plan_from_anthropic_live() {
        tauri::async_runtime::block_on(ask_anthropic());
        let ask = ASK.lock().unwrap();
        println!("outcome: {}", ask.outcome);
        println!("plan: {:?}", plan());
        assert_eq!(ask.outcome, "ok");
    }

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
