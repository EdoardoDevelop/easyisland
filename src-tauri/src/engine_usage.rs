// The "Consumo" integration beyond Claude Code (13 Nov 2026): one section per
// engine, each with its own numbers, never added together.
//
// Where each engine's numbers come from:
//   - opencode: `opencode stats --standalone --json` (its own totals: tokens,
//     cost, models), today and the last 7 days, read at most every 5 minutes;
//   - OpenRouter: its key's usage and limit (`GET /api/v1/key`) and the
//     account's credit (`GET /api/v1/credits`), with the key the chat uses;
//   - Antigravity, Claude with an API key, OpenAI, Gemini, Ollama, LM Studio:
//     only the answers given in EasyIsland, as each call reports them
//     (`record`, one line per call in consumo-motori.jsonl in
//     %LOCALAPPDATA%\EasyIsland; estimated from the characters when the
//     service says nothing). Antigravity keeps its plan's quota to itself.
// Claude Code (usage.rs) stays the first section, with its plan.
//
// Only counts are kept, never the text. Nothing leaves the PC except the two
// OpenRouter requests, to the service the user configured.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};

use crate::i18n::{t, tf};
use crate::widgets::FieldValue;

const DAY: i64 = 86_400;
const WEEK: i64 = 7 * DAY;
/// opencode and OpenRouter are asked again only after this.
const FRESH: Duration = Duration::from_secs(5 * 60);
/// Past this size the older half of the log goes.
const LOG_MAX: u64 = 2_000_000;

/// One engine's section of the card, and what the island's header shows for it.
#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EngineUsage {
    /// The chat engine's id (subscription, opencode, openrouter…).
    pub id: String,
    pub name: String,
    pub color: String,
    /// "ok" | "warn" | "error"
    pub level: String,
    pub summary: String,
    pub fields: Vec<FieldValue>,
    /// For the header: percentages when the engine has a limit, else today's tokens.
    pub gauge: Vec<GaugePart>,
    /// When the numbers arrived (Unix seconds): old ones are shown grey.
    pub at: i64,
}

#[derive(Clone, Debug, Default, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GaugePart {
    pub label: String,
    /// Used, 0–100; None = a plain number (`text`), no bar.
    pub pct: Option<f64>,
    pub text: String,
}

fn engine_name(id: &str) -> &'static str {
    match id {
        "subscription" => "Claude Code",
        "api" => "Claude API",
        "opencode" => "opencode",
        "antigravity" => "Antigravity",
        "openrouter" => "OpenRouter",
        "openai" => "OpenAI",
        "gemini" => "Gemini",
        "ollama" => "Ollama",
        "lmstudio" => "LM Studio",
        _ => "?",
    }
}

fn engine_color(id: &str) -> &'static str {
    match id {
        "subscription" | "api" => "#D97757",
        "opencode" => "#F5A524",
        "antigravity" => "#4C8BF5",
        "openrouter" => "#8B8FF8",
        "openai" => "#10A37F",
        "gemini" => "#22D3EE",
        "ollama" => "#C7CBD1",
        "lmstudio" => "#A78BFA",
        _ => "#8E939C",
    }
}

/// The order of the sections (and of the header's clicks) after Claude Code.
const ORDER: &[&str] = &["api", "opencode", "antigravity", "openrouter", "openai", "gemini", "ollama", "lmstudio"];

fn unix_now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn amount(n: u64) -> String {
    let one_decimal = |x: f64| {
        let s = format!("{x:.1}");
        s.strip_suffix(".0").map(str::to_string).unwrap_or(s).replace('.', ",")
    };
    match n {
        0..=999 => n.to_string(),
        1_000..=999_999 => tf("{n} mila", &[("n", &((n as f64 / 1000.0).round() as u64))]),
        _ => format!("{} M", one_decimal(n as f64 / 1e6)),
    }
}

fn dollars(x: f64) -> String {
    if x > 0.0 && x < 0.01 { "< $0,01".into() } else { format!("${:.2}", x).replace('.', ",") }
}

// ── The answers given in EasyIsland ───────────────────────────────────────────

fn log_path() -> std::path::PathBuf {
    crate::settings::local_dir().join("consumo-motori.jsonl")
}

/// One model call of `engine` in EasyIsland: its tokens (and cost, when the
/// service says). `estimated`: counted from the characters (chars / 4).
/// Tokens recorded since EasyIsland started, read and written: the turn log
/// (router.rs) takes the difference over a turn.
pub static TOTAL_IN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
pub static TOTAL_OUT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

pub fn record(engine: &str, model: &str, input: u64, output: u64, cost: Option<f64>, estimated: bool) {
    if input + output == 0 {
        return;
    }
    TOTAL_IN.fetch_add(input, std::sync::atomic::Ordering::Relaxed);
    TOTAL_OUT.fetch_add(output, std::sync::atomic::Ordering::Relaxed);
    let path = log_path();
    if std::fs::metadata(&path).is_ok_and(|m| m.len() > LOG_MAX) {
        if let Ok(text) = std::fs::read_to_string(&path) {
            let lines: Vec<&str> = text.lines().collect();
            let keep = lines.get(lines.len() / 2..).unwrap_or_default().join("\n");
            let _ = std::fs::write(&path, format!("{keep}\n"));
        }
    }
    let mut line = json!({ "at": unix_now(), "engine": engine, "model": model.trim(), "in": input, "out": output });
    if let Some(c) = cost.filter(|c| c.is_finite() && *c >= 0.0) {
        line["cost"] = json!(c);
    }
    if estimated {
        line["est"] = json!(true);
    }
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        use std::io::Write as _;
        let _ = writeln!(f, "{line}");
    }
}

/// Tokens counted from text, when the service gives none.
pub fn estimate(chars: usize) -> u64 {
    (chars as u64).div_ceil(4)
}

#[derive(Default, Clone, Debug, PartialEq)]
struct Sum {
    tokens: u64,
    calls: u64,
    cost: f64,
    estimated: bool,
}

impl Sum {
    fn add(&mut self, v: &Value) {
        let n = |k: &str| v.get(k).and_then(Value::as_u64).unwrap_or(0);
        self.tokens += n("in") + n("out");
        self.calls += 1;
        self.cost += v.get("cost").and_then(Value::as_f64).unwrap_or(0.0);
        self.estimated |= v.get("est").and_then(Value::as_bool).unwrap_or(false);
    }
    fn text(&self) -> String {
        let calls = if self.calls == 1 { t("1 chiamata").to_string() } else { tf("{n} chiamate", &[("n", &self.calls)]) };
        let mut s = format!("{}{} token · {calls}", if self.estimated { "~" } else { "" }, amount(self.tokens));
        if self.cost > 0.0 {
            s.push_str(&format!(" · {}", dollars(self.cost)));
        }
        s
    }
}

/// The log's sections, at `now` with local midnight at `midnight`.
fn from_log(text: &str, now: i64, midnight: i64) -> Vec<EngineUsage> {
    struct Acc {
        today: Sum,
        week: Sum,
        models: Vec<(String, u64)>,
    }
    let mut by: Vec<(String, Acc)> = Vec::new();
    for line in text.lines() {
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        let at = v.get("at").and_then(Value::as_i64).unwrap_or(0);
        let Some(engine) = v.get("engine").and_then(Value::as_str) else { continue };
        if now - at >= WEEK || !ORDER.contains(&engine) {
            continue;
        }
        let i = match by.iter().position(|(e, _)| e == engine) {
            Some(i) => i,
            None => {
                by.push((engine.to_string(), Acc { today: Sum::default(), week: Sum::default(), models: Vec::new() }));
                by.len() - 1
            }
        };
        let Some((_, acc)) = by.get_mut(i) else { continue };
        acc.week.add(&v);
        if at >= midnight {
            acc.today.add(&v);
        }
        let model = v.get("model").and_then(Value::as_str).filter(|m| !m.is_empty()).unwrap_or("?").to_string();
        let tokens = v.get("in").and_then(Value::as_u64).unwrap_or(0) + v.get("out").and_then(Value::as_u64).unwrap_or(0);
        match acc.models.iter_mut().find(|(m, _)| *m == model) {
            Some(m) => m.1 += tokens,
            None => acc.models.push((model, tokens)),
        }
    }
    by.into_iter()
        .map(|(engine, mut acc)| {
            let mut fields = vec![
                FieldValue { label: t("Oggi").into(), value: acc.today.text() },
                FieldValue { label: t("7 giorni").into(), value: acc.week.text() },
            ];
            acc.models.sort_by(|a, b| b.1.cmp(&a.1));
            if !acc.models.is_empty() {
                fields.push(FieldValue { label: t("Modelli").into(), value: top(&acc.models, acc.week.tokens) });
            }
            fields.push(FieldValue { label: t("Fonte").into(), value: t("solo le risposte date in EasyIsland").into() });
            EngineUsage {
                id: engine.clone(),
                name: engine_name(&engine).into(),
                color: engine_color(&engine).into(),
                level: "ok".into(),
                summary: tf("Oggi {today} token · 7 giorni {week}", &[("today", &amount(acc.today.tokens)), ("week", &amount(acc.week.tokens))]),
                fields,
                gauge: vec![GaugePart { label: t("oggi").into(), pct: None, text: amount(acc.today.tokens) }],
                at: now,
            }
        })
        .collect()
}

/// "a 70%, b 20% e altri 2".
fn top(models: &[(String, u64)], total: u64) -> String {
    let shown: Vec<String> = models.iter().take(3)
        .map(|(name, n)| format!("{name} {}%", if total == 0 { 0 } else { (n * 100 + total / 2) / total }))
        .collect();
    let more = models.len().saturating_sub(3);
    if more > 0 { tf("{list} e altri {n}", &[("list", &shown.join(", ")), ("n", &more)]) } else { shown.join(", ") }
}

// ── opencode ──────────────────────────────────────────────────────────────────

static OPENCODE: Mutex<Option<(Instant, Option<EngineUsage>)>> = Mutex::new(None);

/// `opencode stats --json` → tokens (input, output, reasoning, cache writes), cost, models.
fn opencode_numbers(v: &Value) -> (u64, f64, u64) {
    let n = |p: &str| v.pointer(p).and_then(Value::as_u64).unwrap_or(0);
    let tokens = n("/tokens/input") + n("/tokens/output") + n("/tokens/reasoning") + n("/tokens/cache/write");
    (tokens, v.get("cost").and_then(Value::as_f64).unwrap_or(0.0), v.get("prompts").and_then(Value::as_u64).unwrap_or(0))
}

fn opencode_section(today: &Value, week: &Value, now: i64) -> Option<EngineUsage> {
    let (t_tok, t_cost, t_prompts) = opencode_numbers(today);
    let (w_tok, w_cost, w_prompts) = opencode_numbers(week);
    if w_tok == 0 && t_tok == 0 {
        return None;
    }
    let line = |tokens: u64, cost: f64, prompts: u64| {
        let mut s = format!("{} token", amount(tokens));
        // Sessions started outside opencode's prompt (EasyIsland's) count no prompts.
        if prompts > 0 {
            s.push_str(&format!(" · {}", if prompts == 1 { t("1 richiesta").to_string() } else { tf("{n} richieste", &[("n", &prompts)]) }));
        }
        if cost > 0.0 {
            s.push_str(&format!(" · {}", dollars(cost)));
        }
        s
    };
    let mut fields = vec![
        FieldValue { label: t("Oggi").into(), value: line(t_tok, t_cost, t_prompts) },
        FieldValue { label: t("7 giorni").into(), value: line(w_tok, w_cost, w_prompts) },
    ];
    let mut models: Vec<(String, u64)> = week.get("models").and_then(Value::as_array).into_iter().flatten()
        .map(|m| {
            let id = m.pointer("/model/id").and_then(Value::as_str).unwrap_or("?");
            let provider = m.pointer("/model/providerID").and_then(Value::as_str).unwrap_or("");
            let (tokens, _, _) = opencode_numbers(m);
            (if provider.is_empty() { id.to_string() } else { format!("{provider}/{id}") }, tokens)
        })
        .collect();
    models.sort_by(|a, b| b.1.cmp(&a.1));
    if !models.is_empty() {
        fields.push(FieldValue { label: t("Modelli").into(), value: top(&models, w_tok) });
    }
    let cache = week.pointer("/tokens/cache/read").and_then(Value::as_u64).unwrap_or(0);
    if cache > 0 {
        fields.push(FieldValue { label: t("Letti dalla cache").into(), value: tf("{n} token in 7 giorni", &[("n", &amount(cache))]) });
    }
    fields.push(FieldValue { label: t("Fonte").into(), value: t("tutte le sessioni di opencode (statistiche di opencode)").into() });
    Some(EngineUsage {
        id: "opencode".into(),
        name: engine_name("opencode").into(),
        color: engine_color("opencode").into(),
        level: "ok".into(),
        summary: tf("Oggi {today} token · 7 giorni {week}", &[("today", &amount(t_tok)), ("week", &amount(w_tok))]),
        fields,
        gauge: vec![GaugePart { label: t("oggi").into(), pct: None, text: amount(t_tok) }],
        at: now,
    })
}

async fn opencode_stats(exe: &std::path::Path, days: u32) -> Option<Value> {
    let mut cmd = tokio::process::Command::new(exe);
    cmd.args(["stats", "--standalone", "--models", "--json", "--days", &days.to_string()])
        .env("EASYISLAND_INTERNAL", "1")
        .current_dir(std::env::temp_dir())
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    let out = tokio::time::timeout(Duration::from_secs(30), cmd.output()).await.ok()?.ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let start = text.find('{')?;
    serde_json::from_str(text.get(start..)?.trim()).ok()
}

async fn opencode(now: i64) -> Option<EngineUsage> {
    if let Some((when, last)) = OPENCODE.lock().unwrap().as_ref() {
        if when.elapsed() < FRESH {
            return last.clone();
        }
    }
    let section = match crate::opencode::find_exe() {
        Some(exe) => match (opencode_stats(&exe, 0).await, opencode_stats(&exe, 7).await) {
            (Some(today), Some(week)) => opencode_section(&today, &week, now),
            _ => None,
        },
        None => None,
    };
    *OPENCODE.lock().unwrap() = Some((Instant::now(), section.clone()));
    section
}

// ── OpenRouter ────────────────────────────────────────────────────────────────

static OPENROUTER: Mutex<Option<(Instant, Option<EngineUsage>)>> = Mutex::new(None);

/// `/api/v1/key` and `/api/v1/credits` → the section, the key's limit or the credit as the gauge.
fn openrouter_section(key: &Value, credits: Option<&Value>, mut local: Option<EngineUsage>, now: i64) -> EngineUsage {
    let k = key.get("data").unwrap_or(key);
    let f = |v: &Value, p: &str| v.get(p).and_then(Value::as_f64);
    let mut fields = Vec::new();
    let mut gauge = Vec::new();
    let mut level = "ok";
    let mut summary = Vec::new();
    if let Some(c) = credits.map(|c| c.get("data").unwrap_or(c)) {
        if let (Some(total), Some(used)) = (f(c, "total_credits"), f(c, "total_usage")) {
            let left = (total - used).max(0.0);
            fields.push(FieldValue { label: t("Credito").into(), value: tf("{left} rimasti su {total}", &[("left", &dollars(left)), ("total", &dollars(total))]) });
            summary.push(tf("credito {left}", &[("left", &dollars(left))]));
            if total > 0.0 {
                let pct = (used / total * 100.0).clamp(0.0, 100.0);
                gauge.push(GaugePart { label: t("credito").into(), pct: Some(pct), text: dollars(left) });
                if left < total * 0.1 {
                    level = "warn";
                }
            }
        }
    }
    if let (Some(limit), Some(remaining)) = (f(k, "limit"), f(k, "limit_remaining")) {
        if limit > 0.0 {
            let used = (limit - remaining).max(0.0);
            let reset = k.get("limit_reset").and_then(Value::as_str).filter(|r| !r.is_empty()).map(|r| match r {
                "daily" => t(" · si azzera ogni giorno").to_string(),
                "weekly" => t(" · si azzera ogni settimana").to_string(),
                "monthly" => t(" · si azzera ogni mese").to_string(),
                _ => String::new(),
            }).unwrap_or_default();
            fields.push(FieldValue { label: t("Limite della chiave").into(), value: format!("{} / {}{reset}", dollars(used), dollars(limit)) });
            gauge.insert(0, GaugePart { label: t("chiave").into(), pct: Some((used / limit * 100.0).clamp(0.0, 100.0)), text: dollars(remaining) });
            if remaining < limit * 0.2 {
                level = "warn";
            }
        }
    }
    for (label, p) in [(t("Speso oggi"), "usage_daily"), (t("Questa settimana"), "usage_weekly"), (t("Questo mese"), "usage_monthly")] {
        if let Some(x) = f(k, p) {
            fields.push(FieldValue { label: label.into(), value: dollars(x) });
            if p == "usage_daily" {
                summary.push(tf("oggi {x}", &[("x", &dollars(x))]));
            }
        }
    }
    if k.get("is_free_tier").and_then(Value::as_bool) == Some(true) {
        fields.push(FieldValue { label: t("Account").into(), value: t("gratuito (limiti giornalieri sui modelli :free)").into() });
    }
    // The tokens of the answers given in EasyIsland, below.
    if let Some(l) = local.take() {
        for mut field in l.fields {
            if field.label == t("Oggi") || field.label == t("7 giorni") {
                field.label = tf("{p} in EasyIsland", &[("p", &field.label)]);
            }
            if field.label != t("Fonte") {
                fields.push(field);
            }
        }
    }
    if gauge.is_empty() {
        if let Some(x) = f(k, "usage_daily") {
            gauge.push(GaugePart { label: t("oggi").into(), pct: None, text: dollars(x) });
        }
    }
    EngineUsage {
        id: "openrouter".into(),
        name: engine_name("openrouter").into(),
        color: engine_color("openrouter").into(),
        level: level.into(),
        summary: if summary.is_empty() { t("Nessun dato da OpenRouter").into() } else { summary.join(" · ") },
        fields,
        gauge,
        at: now,
    }
}

async fn openrouter(local: Option<EngineUsage>, now: i64) -> Option<EngineUsage> {
    if !crate::secrets::present("openrouter-api-key") {
        return local;
    }
    if let Some((when, Some(last))) = OPENROUTER.lock().unwrap().as_ref() {
        if when.elapsed() < FRESH {
            return Some(last.clone());
        }
    }
    let key = crate::secrets::get("openrouter-api-key")?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(15)).build().ok()?;
    let get = |path: &str| client.get(format!("https://openrouter.ai/api/v1/{path}")).bearer_auth(&key).header("X-Title", "EasyIsland").send();
    let key_info = match get("key").await {
        Ok(r) if r.status().is_success() => r.json::<Value>().await.ok(),
        _ => None,
    };
    // `/credits` needs a key allowed to see the account: without it, only the key's numbers.
    let credits = match get("credits").await {
        Ok(r) if r.status().is_success() => r.json::<Value>().await.ok(),
        _ => None,
    };
    let section = match key_info {
        Some(k) => openrouter_section(&k, credits.as_ref(), local, now),
        None => {
            let mut s = local.unwrap_or_else(|| EngineUsage {
                id: "openrouter".into(),
                name: engine_name("openrouter").into(),
                color: engine_color("openrouter").into(),
                level: "ok".into(),
                ..Default::default()
            });
            s.level = "warn".into();
            s.summary = t("OpenRouter non risponde: riprovo tra 5 minuti").into();
            s.at = now;
            return Some(s);
        }
    };
    *OPENROUTER.lock().unwrap() = Some((Instant::now(), Some(section.clone())));
    Some(section)
}

// ── All of them ───────────────────────────────────────────────────────────────

/// Every engine but Claude Code, in `ORDER`: those with numbers only.
pub async fn sections() -> Vec<EngineUsage> {
    let now = unix_now();
    let midnight = now - crate::calendar::now_local().rem_euclid(DAY);
    let text = tauri::async_runtime::spawn_blocking(|| std::fs::read_to_string(log_path()).unwrap_or_default()).await.unwrap_or_default();
    let mut local = from_log(&text, now, midnight);
    let or_local = local.iter().position(|s| s.id == "openrouter").map(|i| local.remove(i));
    let mut out = local;
    if let Some(s) = opencode(now).await {
        out.push(s);
    }
    if let Some(s) = openrouter(or_local, now).await {
        out.push(s);
    }
    out.sort_by_key(|s| ORDER.iter().position(|o| *o == s.id).unwrap_or(ORDER.len()));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_answers_of_each_engine_apart() {
        let now = 10 * DAY;
        let midnight = now - 3600;
        let log = [
            json!({ "at": now - 60, "engine": "antigravity", "model": "gemini-4-argon-medium", "in": 1000, "out": 200 }),
            json!({ "at": now - 2 * DAY, "engine": "antigravity", "model": "claude-opus-5-5-high", "in": 3000, "out": 0 }),
            json!({ "at": now - 30, "engine": "openai", "model": "gpt-5", "in": 10, "out": 10, "cost": 0.5, "est": true }),
            json!({ "at": now - 8 * DAY, "engine": "openai", "model": "old", "in": 99, "out": 0 }),
            json!({ "at": now, "engine": "subscription", "in": 5, "out": 5 }),
        ].iter().map(Value::to_string).collect::<Vec<_>>().join("\n") + "\nnot json\n";
        let s = from_log(&log, now, midnight);
        assert_eq!(s.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), ["antigravity", "openai"]);
        let ag = &s[0];
        assert_eq!(ag.gauge[0].text, amount(1200));
        assert!(ag.fields.iter().any(|f| f.value.contains("claude-opus-5-5-high 71%")));
        let oa = &s[1];
        assert!(oa.fields[0].value.starts_with("~20 token"));
        assert!(oa.fields[0].value.ends_with("$0,50"));
    }

    #[test]
    fn opencode_from_its_stats() {
        let today = json!({ "prompts": 0, "tokens": { "input": 0, "output": 0 }, "cost": 0 });
        let week = json!({ "prompts": 2, "tokens": { "input": 1000, "output": 500, "reasoning": 100, "cache": { "read": 9000, "write": 400 } }, "cost": 0.0,
            "models": [{ "model": { "id": "auto", "providerID": "freellmapi" }, "tokens": { "input": 1000, "output": 500, "reasoning": 100, "cache": { "write": 400 } } }] });
        let s = opencode_section(&today, &week, 1).unwrap();
        assert_eq!(s.gauge[0].text, "0");
        assert!(s.fields[1].value.starts_with(&format!("{} token · 2", amount(2000))));
        assert!(s.fields[2].value.contains("freellmapi/auto 100%"));
        assert!(opencode_section(&today, &today, 1).is_none());
    }

    #[test]
    fn openrouter_credit_and_key_limit() {
        let key = json!({ "data": { "limit": 10.0, "limit_remaining": 1.5, "limit_reset": "monthly", "usage_daily": 0.25, "usage_monthly": 8.5, "is_free_tier": false } });
        let credits = json!({ "data": { "total_credits": 20.0, "total_usage": 5.0 } });
        let s = openrouter_section(&key, Some(&credits), None, 1);
        assert_eq!(s.gauge.iter().map(|g| g.label.as_str()).collect::<Vec<_>>(), [t("chiave"), t("credito")]);
        assert_eq!(s.gauge[0].pct, Some(85.0));
        assert_eq!(s.gauge[1].pct, Some(25.0));
        assert_eq!(s.level, "warn");
        let only_key = openrouter_section(&json!({ "data": { "usage_daily": 0.0 } }), None, None, 1);
        assert_eq!(only_key.gauge[0].pct, None);
    }

    #[test]
    fn estimates_round_up() {
        assert_eq!(estimate(0), 0);
        assert_eq!(estimate(5), 2);
    }

    #[test]
    #[ignore = "reads this PC's opencode and OpenRouter: cargo test engine_sections_live -- --ignored --nocapture"]
    fn engine_sections_live() {
        let s = tauri::async_runtime::block_on(sections());
        println!("{}", serde_json::to_string_pretty(&s).unwrap());
    }
}
