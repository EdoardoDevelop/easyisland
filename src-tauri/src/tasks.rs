// Compiti (asked by Edoardo on 23 October 2026, first step of EasyIsland as a
// personal agent, docs/idee.md): a goal the agent carries on by itself, in
// turns of the chat's engine (`chat_turn` with Channel::Task), until it says it
// is done (task_done), needs the user (task_ask) or runs out of the turns and
// minutes it was given.
//
// - One file per task in %APPDATA%\EasyIsland\compiti (`<id>.json`, written
//   atomically) and its log `<id>.md`, readable by the user.
// - One task at a time: a queue, run by `runner`, which sleeps on a Notify
//   when there is nothing to do; with scheduled tasks it looks at the clock
//   once every 30 s (no frames, no polling of anything else).
// - The island sees a task as an agent session ("Compiti", hook payloads like
//   opencode_agent.rs), so the character, the Agenti tab and the cards work as
//   for Claude Code. Its questions are the island's AskUserQuestion card.
// - What a task may do is what the chat may do: the same tools, the same
//   Consenti / Nega on the island (never Telegram's "Automatica").

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::claude::Chat;
use crate::i18n::{t, tf};
use crate::island::WINDOW_LABEL;

/// Turns and minutes of one run, when the settings say nothing.
pub const DEFAULT_TURNS: u32 = 12;
pub const DEFAULT_MINUTES: u32 = 30;
/// The steps of a plan, at most.
const MAX_STEPS: usize = 20;
/// Tasks kept: past this the oldest finished ones are removed with their log.
const MAX_TASKS: usize = 100;
const AGENT_COLOR: &str = "#0EA5E9";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TaskState {
    /// Waiting for its hour (`when`).
    Scheduled,
    /// In the queue, it starts as soon as the one running is over.
    Queued,
    Running,
    /// The agent asked something (task_ask) and nobody answered yet.
    Asking,
    /// Paused by the user, by a limit or by a restart of EasyIsland.
    Paused,
    Done,
    Failed,
    Stopped,
}

impl TaskState {
    fn over(self) -> bool {
        matches!(self, TaskState::Done | TaskState::Failed | TaskState::Stopped)
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Step {
    pub text: String,
    #[serde(default)]
    pub done: bool,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub id: String,
    pub title: String,
    pub goal: String,
    /// The engine for this task; "" = Impostazioni → Compiti, else the chat's.
    #[serde(default)]
    pub engine: String,
    /// Its model ("" = the engine's in Impostazioni → Chat).
    #[serde(default)]
    pub model: String,
    /// Engines it may hand a piece of work to (task_delegate); empty = none.
    #[serde(default)]
    pub helpers: Vec<String>,
    pub state: TaskState,
    #[serde(default)]
    pub plan: Vec<Step>,
    /// "" = now; "at:2026-10-24 09:00"; "daily:09:00"; "weekdays:09:00".
    #[serde(default)]
    pub when: String,
    /// The minute it last started on its own ("2026-10-24 09:00"), for `when`.
    #[serde(default)]
    pub last_fired: String,
    /// The question waiting for the user (task_ask).
    #[serde(default)]
    pub question: String,
    /// The user's answer, given to the agent on the next turn.
    #[serde(default)]
    pub answer: String,
    #[serde(default)]
    pub result: String,
    /// The latest thing that happened, one line (the card, the list).
    #[serde(default)]
    pub last: String,
    /// Turns of the current run.
    #[serde(default)]
    pub turns: u32,
    #[serde(default)]
    pub runs: u32,
    /// The last run had nothing to report (task_done with quiet): no card, no message.
    #[serde(default)]
    pub quiet: bool,
    /// The heartbeat (Battito): BATTITO.md goes into its goal at every run, and
    /// with nothing in it the run is skipped without asking any engine.
    #[serde(default)]
    pub heartbeat: bool,
    pub created: String,
    pub updated: String,
}

impl Task {
    fn recurring(&self) -> bool {
        ["daily:", "weekdays:", "weekly:", "every:"].iter().any(|p| self.when.starts_with(p))
    }
}

// ── Time ─────────────────────────────────────────────────────────────────────

/// ("2026-10-24 09:00", day 1–7) of the local clock.
fn now_key() -> (String, u8) {
    let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    let day = if t.wDayOfWeek == 0 { 7 } else { t.wDayOfWeek as u8 };
    (format!("{:04}-{:02}-{:02} {:02}:{:02}", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute), day)
}

fn hhmm_ok(s: &str) -> bool {
    let mut it = s.split(':');
    let (Some(h), Some(m), None) = (it.next(), it.next(), it.next()) else { return false };
    h.len() == 2 && m.len() == 2 && h.parse::<u32>().is_ok_and(|h| h < 24) && m.parse::<u32>().is_ok_and(|m| m < 60)
}

/// "2026-10-24 09:00" written as such.
fn stamp_ok(s: &str) -> bool {
    let (Some(date), Some(time)) = (s.get(..10), s.get(11..)) else { return false };
    let d: Vec<&str> = date.split('-').collect();
    s.get(10..11) == Some(" ")
        && d.len() == 3
        && d.first().is_some_and(|y| y.len() == 4 && y.parse::<u32>().is_ok())
        && d.get(1).is_some_and(|m| m.len() == 2 && m.parse::<u32>().is_ok_and(|m| (1..=12).contains(&m)))
        && d.get(2).is_some_and(|x| x.len() == 2 && x.parse::<u32>().is_ok_and(|x| (1..=31).contains(&x)))
        && hhmm_ok(time)
}

/// A valid `when`, or the reason it is not.
pub fn check_when(when: &str) -> Result<(), String> {
    let w = when.trim();
    if w.is_empty() {
        return Ok(());
    }
    let ok = match w.split_once(':') {
        Some(("at", s)) => stamp_ok(s.trim()),
        Some(("daily" | "weekdays", s)) => hhmm_ok(s.trim()),
        Some(("every", n)) => n.trim().parse::<u32>().is_ok_and(|n| (MIN_EVERY..=1440).contains(&n)),
        Some(("weekly", rest)) => rest.split_once(':').is_some_and(|(d, hm)| d.parse::<u8>().is_ok_and(|d| (1..=7).contains(&d)) && hhmm_ok(hm)),
        _ => false,
    };
    if ok { Ok(()) } else { Err(t("Quando non valido: vuoto (subito), «at:AAAA-MM-GG HH:MM», «daily:HH:MM», «weekdays:HH:MM», «weekly:G:HH:MM» (G 1 = lunedì) o «every:N» (ogni N minuti, da 15).").into()) }
}

/// Should a task with this `when` start now? `now` is "AAAA-MM-GG HH:MM",
/// `day` 1–7; `last` the minute it last started. A one-off hour already past
/// (EasyIsland was closed) starts at once.
fn due(when: &str, now: &str, day: u8, last: &str) -> bool {
    let time = now.get(11..).unwrap_or_default();
    let today = now.get(..10).unwrap_or_default();
    match when.split_once(':') {
        Some(("at", at)) => last.is_empty() && now >= at.trim(),
        Some(("daily", hm)) => time >= hm.trim() && last.get(..10) != Some(today),
        Some(("weekdays", hm)) => day <= 5 && time >= hm.trim() && last.get(..10) != Some(today),
        Some(("weekly", rest)) => rest.split_once(':').is_some_and(|(d, hm)| {
            d.parse::<u8>().ok() == Some(day) && time >= hm && last.get(..10) != Some(today)
        }),
        Some(("every", n)) => {
            let n = n.trim().parse::<i64>().unwrap_or(60).max(MIN_EVERY as i64);
            match (minutes(now), minutes(last)) {
                (Some(a), Some(b)) => a - b >= n,
                _ => true,
            }
        }
        _ => false,
    }
}

/// The shortest «every N minutes».
const MIN_EVERY: u32 = 15;

/// "AAAA-MM-GG HH:MM" → minutes since 1970 (calendar days, no time zone: both
/// sides are local time). None when it is not written that way.
fn minutes(stamp: &str) -> Option<i64> {
    if !stamp_ok(stamp) {
        return None;
    }
    let n = |a: usize, b: usize| stamp.get(a..b).and_then(|x| x.parse::<i64>().ok());
    let (y, m, d, hh, mm) = (n(0, 4)?, n(5, 7)?, n(8, 10)?, n(11, 13)?, n(14, 16)?);
    // Days from the civil date (Howard Hinnant's algorithm).
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(days * 1440 + hh * 60 + mm)
}

// ── Storage ──────────────────────────────────────────────────────────────────

pub fn dir() -> PathBuf {
    crate::settings::config_dir().join("compiti")
}

fn file(id: &str) -> PathBuf {
    dir().join(format!("{id}.json"))
}

fn log_file(id: &str) -> PathBuf {
    dir().join(format!("{id}.md"))
}

/// A safe id: letters, digits and dashes only (it names files).
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
}

static TASKS: LazyLock<Mutex<Vec<Task>>> = LazyLock::new(|| Mutex::new(Vec::new()));
static WAKE: LazyLock<tokio::sync::Notify> = LazyLock::new(tokio::sync::Notify::new);
static RUNNING: Mutex<Option<String>> = Mutex::new(None);
/// The conversation of each task while EasyIsland runs (after a restart the
/// plan and the goal start a new one).
static CHATS: LazyLock<Mutex<HashMap<String, Arc<Chat>>>> = LazyLock::new(|| Mutex::new(HashMap::new()));
/// What the user asked of the running task: pause (true) or stop (false).
static HALT: Mutex<Option<bool>> = Mutex::new(None);
/// A task_* tool was called in the current turn.
static TOOLED: AtomicBool = AtomicBool::new(false);
static APP: Mutex<Option<AppHandle>> = Mutex::new(None);

fn save(task: &Task) {
    let _ = std::fs::create_dir_all(dir());
    if let Ok(bytes) = serde_json::to_vec_pretty(task) {
        if let Err(e) = crate::settings::write_atomic(&file(&task.id), &bytes) {
            crate::log::line(format!("compiti: non salvato {}: {e}", task.id));
        }
    }
}

/// One line in the task's log (the .md the user reads).
fn note(id: &str, text: &str) {
    use std::io::Write;
    let (now, _) = now_key();
    let path = log_file(id);
    let fresh = !path.exists();
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(&path) {
        if fresh {
            let title = TASKS.lock().unwrap().iter().find(|t| t.id == id).map(|t| t.title.clone()).unwrap_or_default();
            let _ = writeln!(f, "# {title}\n");
        }
        let one = text.split_whitespace().collect::<Vec<_>>().join(" ");
        let _ = writeln!(f, "- {now} {one}");
    }
}

fn changed(app: &AppHandle) {
    let list = TASKS.lock().unwrap().clone();
    let _ = app.emit("tasks-changed", list);
}

/// Changes one task, saves it and tells both windows.
fn update(app: &AppHandle, id: &str, f: impl FnOnce(&mut Task)) -> Option<Task> {
    let task = {
        let mut all = TASKS.lock().unwrap();
        let t = all.iter_mut().find(|t| t.id == id)?;
        f(t);
        t.updated = now_key().0;
        t.clone()
    };
    save(&task);
    changed(app);
    Some(task)
}

pub fn get(id: &str) -> Option<Task> {
    TASKS.lock().unwrap().iter().find(|t| t.id == id).cloned()
}

pub fn list() -> Vec<Task> {
    TASKS.lock().unwrap().clone()
}

/// Reads the tasks at start. One left running by a closed EasyIsland is paused.
pub fn init(app: &AppHandle) {
    *APP.lock().unwrap() = Some(app.clone());
    let mut all = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir()) {
        for e in entries.flatten().take(500) {
            let path = e.path();
            if path.extension().and_then(|x| x.to_str()) != Some("json") {
                continue;
            }
            let Some(task) = std::fs::read(&path).ok().and_then(|b| serde_json::from_slice::<Task>(&b).ok()) else { continue };
            if !valid_id(&task.id) {
                continue;
            }
            all.push(task);
        }
    }
    all.sort_by(|a, b| a.created.cmp(&b.created));
    for task in all.iter_mut().filter(|t| t.state == TaskState::Running) {
        task.state = TaskState::Paused;
        task.last = t("In pausa: EasyIsland si è riavviato. «Riprendi» per continuare.").into();
        save(task);
    }
    *TASKS.lock().unwrap() = all;
    let app = app.clone();
    tauri::async_runtime::spawn(async move { runner(app).await });
}

fn new_id() -> String {
    let (now, _) = now_key();
    let digits: String = now.chars().filter(char::is_ascii_digit).collect();
    let rand: String = crate::msgraph::random(3).iter().map(|b| format!("{b:02x}")).collect();
    format!("{digits}-{rand}")
}

/// A new task: queued now, or waiting for its hour.
pub fn create(app: &AppHandle, title: &str, goal: &str, when: &str, engine: &str) -> Result<Task, String> {
    let goal = goal.trim();
    if goal.is_empty() {
        return Err(t("Scrivi l'obiettivo del compito.").into());
    }
    let when = when.trim();
    check_when(when)?;
    let title = match title.trim() {
        "" => goal.split_whitespace().take(8).collect::<Vec<_>>().join(" "),
        t => t.to_string(),
    };
    let (now, _) = now_key();
    let task = Task {
        id: new_id(),
        title: title.chars().take(80).collect(),
        goal: goal.chars().take(4000).collect(),
        engine: engine.trim().to_string(),
        model: String::new(),
        helpers: Vec::new(),
        state: if when.is_empty() { TaskState::Queued } else { TaskState::Scheduled },
        plan: Vec::new(),
        when: when.to_string(),
        last_fired: String::new(),
        question: String::new(),
        answer: String::new(),
        result: String::new(),
        last: if when.is_empty() { t("In coda").into() } else { t("In attesa del suo orario").into() },
        turns: 0,
        runs: 0,
        quiet: false,
        heartbeat: false,
        created: now.clone(),
        updated: now,
    };
    {
        let mut all = TASKS.lock().unwrap();
        all.push(task.clone());
        // Too many: the oldest finished ones go, with their log.
        while all.len() > MAX_TASKS {
            let Some(i) = all.iter().position(|t| t.state.over()) else { break };
            let gone = all.remove(i);
            let _ = std::fs::remove_file(file(&gone.id));
            let _ = std::fs::remove_file(log_file(&gone.id));
        }
    }
    save(&task);
    note(&task.id, &tf("Creato: {goal}", &[("goal", &task.goal)]));
    crate::log::line(format!("compiti: creato {}", task.id));
    changed(app);
    WAKE.notify_one();
    Ok(task)
}

/// The user's buttons: start, pause, resume, stop, delete.
pub fn control(app: &AppHandle, id: &str, action: &str) -> Result<(), String> {
    let task = get(id).ok_or(t("Compito non trovato."))?;
    let running = RUNNING.lock().unwrap().as_deref() == Some(id);
    match action {
        "pause" | "stop" if running => {
            *HALT.lock().unwrap() = Some(action == "pause");
            crate::stop_task_turn();
        }
        "pause" => {
            update(app, id, |t| {
                t.state = TaskState::Paused;
                t.last = crate::i18n::t("In pausa").into();
            });
        }
        "stop" => {
            update(app, id, |t| {
                t.state = TaskState::Stopped;
                t.last = crate::i18n::t("Fermato").into();
            });
            session_end(app, id);
        }
        // "Avvia" / "Riprendi" / "Rifai": into the queue now, whatever its hour.
        "start" | "resume" => {
            if running {
                return Ok(());
            }
            let again = task.state.over();
            update(app, id, |t| {
                if again {
                    t.plan.clear();
                    t.result.clear();
                    CHATS.lock().unwrap().remove(&t.id);
                }
                t.state = TaskState::Queued;
                t.last = crate::i18n::t("In coda").into();
            });
            WAKE.notify_one();
        }
        "delete" => {
            if running {
                *HALT.lock().unwrap() = Some(false);
                crate::stop_task_turn();
            }
            TASKS.lock().unwrap().retain(|t| t.id != id);
            CHATS.lock().unwrap().remove(id);
            let _ = std::fs::remove_file(file(id));
            let _ = std::fs::remove_file(log_file(id));
            session_end(app, id);
            changed(app);
        }
        _ => return Err(t("Azione sconosciuta.").into()),
    }
    if action != "delete" {
        note(id, &tf("Azione dell'utente: {a}", &[("a", &action.to_string())]));
    }
    Ok(())
}

/// Impostazioni → Compiti: the engine, model and helpers of a task. Not while
/// it runs (its conversation is on one engine); a new engine starts a new one.
pub fn set_engines(app: &AppHandle, id: &str, engine: &str, model: &str, helpers: &[String]) -> Result<(), String> {
    if running().as_deref() == Some(id) {
        return Err(t("Mettilo in pausa prima di cambiare motore.").into());
    }
    let known: Vec<&str> = KNOWN_ENGINES.to_vec();
    let engine = engine.trim();
    if !engine.is_empty() && !known.contains(&engine) {
        return Err(tf("Motore sconosciuto: {e}", &[("e", &engine.to_string())]));
    }
    let helpers: Vec<String> = helpers.iter().map(|h| h.trim().to_string()).filter(|h| known.contains(&h.as_str())).take(8).collect();
    let before = get(id).ok_or(t("Compito non trovato."))?;
    if before.engine != engine || before.model != model.trim() {
        CHATS.lock().unwrap().remove(id);
    }
    update(app, id, |t| {
        t.engine = engine.to_string();
        t.model = model.trim().chars().take(120).collect();
        t.helpers = helpers.clone();
    });
    Ok(())
}

// ── Battito (heartbeat) ──────────────────────────────────────────────────────

pub fn heartbeat_file() -> PathBuf {
    crate::settings::config_dir().join("BATTITO.md")
}

/// The things to watch: the "- " lines of BATTITO.md.
fn heartbeat_items() -> Vec<String> {
    std::fs::read_to_string(heartbeat_file()).unwrap_or_default().lines()
        .map(str::trim).filter(|l| l.starts_with("- ") && l.len() > 2).take(40).map(str::to_string).collect()
}

/// BATTITO.md, made with an explanation the first time.
pub fn ensure_heartbeat_file() -> Result<PathBuf, String> {
    let path = heartbeat_file();
    if !path.exists() {
        let text = format!(
            "# {}\n\n{}\n",
            t("Battito di EasyIsland"),
            t("Cosa deve tenere d'occhio l'agente a ogni battito, una riga per cosa che inizia con «- ». Senza righe il battito non parte e non costa niente. Esempi (togli il # davanti per usarli):\n# - ticket di Zammad nuovi o con priorità alta: preparami una bozza di risposta\n# - mail di clienti senza risposta da più di un giorno\n# - attività di Notion che scadono oggi"),
        );
        let _ = std::fs::create_dir_all(crate::settings::config_dir());
        crate::settings::write_atomic(&path, text.as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(path)
}

/// Impostazioni → Compiti → Battito: on every `minutes` (0 = off). There is one heartbeat task.
pub fn set_heartbeat(app: &AppHandle, minutes: u32) -> Result<Option<Task>, String> {
    let existing = TASKS.lock().unwrap().iter().find(|t| t.heartbeat).map(|t| t.id.clone());
    if minutes == 0 {
        if let Some(id) = existing {
            control(app, &id, "delete")?;
        }
        return Ok(None);
    }
    let when = format!("every:{}", minutes.clamp(MIN_EVERY, 1440));
    ensure_heartbeat_file()?;
    let id = match existing {
        Some(id) => id,
        None => {
            let task = create(app, t("Battito"), t("Controlla le cose dell'elenco del battito e segnala solo ciò che serve."), &when, "")?;
            task.id
        }
    };
    let task = update(app, &id, |t| {
        t.heartbeat = true;
        t.when = when.clone();
        if t.state == TaskState::Queued && t.runs == 0 {
            // The first beat waits for its turn like the others.
            t.state = TaskState::Scheduled;
            t.last_fired = now_key().0;
        }
    });
    WAKE.notify_one();
    Ok(task)
}

/// The chat's engines (CHAT_ENGINES in src/core/state.ts).
const KNOWN_ENGINES: &[&str] = &["subscription", "api", "opencode", "antigravity", "openrouter", "openai", "gemini", "ollama", "lmstudio"];

/// The user answers the question of a task that is waiting: it goes back in the queue.
pub fn answer(app: &AppHandle, id: &str, text: &str) -> Result<(), String> {
    let text = text.trim();
    if text.is_empty() {
        return Err(t("Scrivi la risposta.").into());
    }
    let task = get(id).ok_or(t("Compito non trovato."))?;
    if task.state != TaskState::Asking {
        return Err(t("Questo compito non sta aspettando una risposta.").into());
    }
    update(app, id, |t| {
        t.answer = text.to_string();
        t.state = TaskState::Queued;
        t.last = crate::i18n::t("Risposta data, in coda").into();
    });
    note(id, &tf("Risposta dell'utente: {a}", &[("a", &text.to_string())]));
    WAKE.notify_one();
    Ok(())
}

pub fn log_text(id: &str) -> String {
    if !valid_id(id) {
        return String::new();
    }
    std::fs::read_to_string(log_file(id)).unwrap_or_default()
}

// ── The island ───────────────────────────────────────────────────────────────

fn session(id: &str) -> String {
    format!("task-{id}")
}

fn agent() -> Value {
    json!({ "id": "compiti", "name": t("Compiti"), "color": AGENT_COLOR })
}

fn payload(event: &str, id: &str) -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("hook_event_name".into(), json!(event));
    m.insert("session_id".into(), json!(session(id)));
    // The island names a session after the last part of its folder: the title here.
    let title = get(id).map(|t| t.title.replace(['\\', '/'], " ")).unwrap_or_default();
    m.insert("cwd".into(), json!(title));
    m.insert("easyisland_agent".into(), agent());
    m.insert("easyisland_host".into(), json!("compiti"));
    m
}

fn hook(app: &AppHandle, m: Map<String, Value>) {
    let _ = app.emit_to(WINDOW_LABEL, "hook", Value::Object(m));
}

/// A step on the island: shown like an agent's tool call.
fn show_step(app: &AppHandle, id: &str, text: &str) {
    let mut pre = payload("PreToolUse", id);
    pre.insert("tool_name".into(), json!("Compito"));
    pre.insert("tool_input".into(), json!({ "step": text }));
    hook(app, pre);
    let mut post = payload("PostToolUse", id);
    post.insert("tool_name".into(), json!("Compito"));
    post.insert("tool_input".into(), json!({ "step": text }));
    hook(app, post);
}

fn session_end(app: &AppHandle, id: &str) {
    hook(app, payload("SessionEnd", id));
}

// ── Running ──────────────────────────────────────────────────────────────────

pub fn running() -> Option<String> {
    RUNNING.lock().unwrap().clone()
}

/// The queue: one task at a time. Asleep when there is nothing to do; with
/// tasks waiting for their hour it looks at the clock every 30 s.
async fn runner(app: AppHandle) {
    loop {
        let (now, day) = now_key();
        // Scheduled ones whose hour came: into the queue.
        let fired: Vec<String> = {
            let all = TASKS.lock().unwrap();
            all.iter()
                .filter(|t| matches!(t.state, TaskState::Scheduled | TaskState::Done | TaskState::Failed) && !t.when.is_empty())
                .filter(|t| (t.state == TaskState::Scheduled || t.recurring()) && due(&t.when, &now, day, &t.last_fired))
                .map(|t| t.id.clone())
                .collect()
        };
        for id in &fired {
            // A heartbeat with nothing to watch costs nothing: skipped.
            if get(id).is_some_and(|t| t.heartbeat) && heartbeat_items().is_empty() {
                update(&app, id, |t| t.last_fired = now.clone());
                continue;
            }
            update(&app, id, |t| {
                t.last_fired = now.clone();
                t.state = TaskState::Queued;
                t.plan.clear();
                t.result.clear();
                t.last = crate::i18n::t("È il suo orario: in coda").into();
            });
            CHATS.lock().unwrap().remove(id);
            note(id, t("Partito al suo orario"));
        }
        let next = TASKS.lock().unwrap().iter().find(|t| t.state == TaskState::Queued).map(|t| t.id.clone());
        if let Some(id) = next {
            run(&app, &id).await;
            continue;
        }
        let timed = TASKS.lock().unwrap().iter().any(|t| !t.when.is_empty() && (t.state == TaskState::Scheduled || t.recurring()));
        if timed {
            let _ = tokio::time::timeout(Duration::from_secs(30), WAKE.notified()).await;
        } else {
            WAKE.notified().await;
        }
    }
}

fn plan_text(plan: &[Step]) -> String {
    if plan.is_empty() {
        return t("(ancora nessun piano)").into();
    }
    plan.iter().enumerate().map(|(i, s)| format!("{}. [{}] {}", i + 1, if s.done { "x" } else { " " }, s.text)).collect::<Vec<_>>().join("\n")
}

/// What the agent is told at each turn.
#[cfg(test)]
fn prompt(task: &Task, first: bool) -> String {
    prompt_with(task, first, &[])
}

/// `helpers`: (id, name) of the engines it may hand work to, ready now.
fn prompt_with(task: &Task, first: bool, helpers: &[(String, String)]) -> String {
    let rules = t("Lavori da solo, senza l'utente davanti: usa gli strumenti per fare davvero le cose. Scrivi subito il piano con task_plan (pochi passi concreti) e segna ogni passo fatto con task_step. Se ti serve una decisione o un dato che ha solo l'utente, chiedilo con task_ask. Quando hai finito chiama task_done con il risultato, breve e utile. Non inviare email, non eliminare e non approvare nulla da solo: prepara bozze e lascia a lui l'ultimo clic. Se il procedimento potrà servire di nuovo e non c'è già un'abilità che lo descrive, alla fine salvalo con skill_save (l'utente conferma).");
    let mut text = if first {
        tf("[Compito di EasyIsland «{title}». {rules}]\n\nObiettivo: {goal}", &[("title", &task.title), ("rules", &rules), ("goal", &task.goal)])
    } else {
        tf(
            "[Continua il compito di EasyIsland «{title}». {rules}]\n\nObiettivo: {goal}\n\nPiano finora:\n{plan}",
            &[("title", &task.title), ("rules", &rules), ("goal", &task.goal), ("plan", &plan_text(&task.plan))],
        )
    };
    if task.heartbeat {
        text.push_str(&format!("\n\n{}", tf(
            "[Battito: è un controllo periodico. Ecco cosa l'utente vuole che tu tenga d'occhio (BATTITO.md):\n{list}\nGuarda ognuna con gli strumenti. Se non c'è niente da segnalare chiudi con task_done e quiet true, senza altro testo; altrimenti chiudi con quello che serve sapere o che hai preparato.]",
            &[("list", &heartbeat_items().join("\n"))],
        )));
    }
    if !helpers.is_empty() {
        let list = helpers.iter().map(|(id, name)| format!("{id} ({name})")).collect::<Vec<_>>().join(", ");
        text.push_str(&format!("\n\n{}", tf(
            "[Motori aiutanti: {list}. Puoi affidare a uno di loro un pezzo del lavoro con task_delegate (engine, prompt), per esempio una ricerca, una revisione, un testo, o un passo per cui un'abilità indica il suo motore: lavora in una conversazione sua e ti restituisce il risultato. Dagli tutto il contesto che serve, non vede questa conversazione.]",
            &[("list", &list)],
        )));
    }
    if !task.answer.is_empty() {
        text.push_str(&format!("\n\n{}", tf("Risposta dell'utente alla tua domanda «{q}»: {a}", &[("q", &task.question), ("a", &task.answer)])));
    }
    text
}

/// The task's helpers that can answer now, with their names.
fn ready_helpers(app: &AppHandle, task: &Task) -> Vec<(String, String)> {
    if task.helpers.is_empty() {
        return Vec::new();
    }
    crate::telegram::engines(app).into_iter()
        .filter(|(id, _, ok)| *ok && task.helpers.iter().any(|h| h == id))
        .map(|(id, name, _)| (id.to_string(), name))
        .collect()
}

fn limits(app: &AppHandle) -> (String, u32, u32) {
    app.try_state::<crate::Shared>().map_or((String::new(), DEFAULT_TURNS, DEFAULT_MINUTES), |s| {
        let s = s.settings.lock().unwrap();
        (s.tasks_engine.clone(), s.tasks_max_turns.clamp(1, 100), s.tasks_max_minutes.clamp(1, 600))
    })
}

/// One run of a task: turns until it is done, asks, fails or hits a limit.
async fn run(app: &AppHandle, id: &str) {
    let Some(task) = get(id) else { return };
    *RUNNING.lock().unwrap() = Some(id.to_string());
    *HALT.lock().unwrap() = None;
    let (default_engine, max_turns, max_minutes) = limits(app);
    let engine = if task.engine.is_empty() { default_engine } else { task.engine.clone() };
    update(app, id, |t| {
        t.state = TaskState::Running;
        t.turns = 0;
        t.runs += 1;
        t.quiet = false;
        t.last = crate::i18n::t("Al lavoro").into();
    });
    crate::log::line(format!("compiti: avviato {id}"));
    note(id, t("Avviato"));
    hook(app, payload("SessionStart", id));
    let mut prompt_hook = payload("UserPromptSubmit", id);
    prompt_hook.insert("prompt".into(), json!(task.title));
    hook(app, prompt_hook);

    let chat = CHATS.lock().unwrap().entry(id.to_string()).or_insert_with(|| Arc::new(Chat::default())).clone();
    let started = Instant::now();
    // A new conversation with no plan yet: the first prompt. After a restart
    // (no conversation, a plan) the next one, which repeats the goal.
    let mut first = chat.is_empty() && chat.cli_session().is_none() && task.plan.is_empty();
    let end: (TaskState, String) = loop {
        let Some(task) = get(id) else { break (TaskState::Stopped, String::new()) };
        if task.turns >= max_turns {
            break (TaskState::Paused, tf("In pausa: usati tutti i {n} turni concessi. «Riprendi» per continuare.", &[("n", &max_turns.to_string())]));
        }
        if started.elapsed() >= Duration::from_secs(max_minutes as u64 * 60) {
            break (TaskState::Paused, tf("In pausa: passati i {n} minuti concessi. «Riprendi» per continuare.", &[("n", &max_minutes.to_string())]));
        }
        let text = prompt_with(&task, first, &ready_helpers(app, &task));
        first = false;
        TOOLED.store(false, Ordering::SeqCst);
        update(app, id, |t| {
            t.turns += 1;
            t.answer.clear();
        });
        let engine_opt = (!engine.is_empty()).then(|| engine.clone());
        let model_opt = (!engine.is_empty() && !task.model.is_empty()).then(|| task.model.clone());
        let reply = crate::chat_turn(app, &chat, text, None, engine_opt, model_opt, false, crate::Channel::Task, &|_| {}).await;
        let halt = HALT.lock().unwrap().take();
        if let Some(pause) = halt {
            break if pause { (TaskState::Paused, t("In pausa").into()) } else { (TaskState::Stopped, t("Fermato").into()) };
        }
        let now = get(id).map(|t| t.state);
        match reply {
            Err(e) => break (TaskState::Failed, tf("Non riuscito: {e}", &[("e", &e)])),
            Ok(r) => {
                // Without the tool trace claude_cli.rs puts in the text ("> ⚙ task_plan · …").
                let said = r.text.lines().filter(|l| !l.trim_start().starts_with("> ⚙")).collect::<Vec<_>>().join("\n").trim().to_string();
                if !said.is_empty() {
                    note(id, &tf("Agente: {t}", &[("t", &said.chars().take(600).collect::<String>())]));
                }
                match now {
                    Some(TaskState::Done) | Some(TaskState::Asking) => break (now.unwrap_or(TaskState::Done), String::new()),
                    _ => {}
                }
                // A turn with no task_* tool: an engine without tools, or the
                // agent just answered. Its answer is the result.
                if !TOOLED.load(Ordering::SeqCst) {
                    update(app, id, |t| t.result = said.clone());
                    break (TaskState::Done, String::new());
                }
            }
        }
    };
    let (state, why) = end;
    let task = update(app, id, |t| {
        t.state = state;
        match state {
            TaskState::Done => t.last = crate::i18n::t("Fatto").into(),
            TaskState::Asking => t.last = crate::i18n::tf("Attende te: {q}", &[("q", &t.question)]),
            _ => t.last = why.clone(),
        }
    });
    *RUNNING.lock().unwrap() = None;
    let summary = match state {
        TaskState::Done => task.as_ref().map(|t| t.result.clone()).filter(|r| !r.is_empty()).unwrap_or_else(|| t("Fatto.").into()),
        TaskState::Asking => task.as_ref().map(|t| tf("Attende te: {q}", &[("q", &t.question)])).unwrap_or_default(),
        _ => why.clone(),
    };
    let quiet = state == TaskState::Done && task.as_ref().is_some_and(|t| t.quiet);
    note(id, if quiet { t("Niente da segnalare") } else { &summary });
    crate::log::line(format!("compiti: {id} finito come {state:?}{}", if quiet { ", niente da segnalare" } else { "" }));
    if quiet {
        // Nothing to say: the session goes away, no card, no message.
        session_end(app, id);
    } else if state == TaskState::Asking {
        let mut n = payload("Notification", id);
        n.insert("message".into(), json!(summary));
        n.insert("easyisland_waiting".into(), json!(true));
        hook(app, n);
    } else {
        let mut stop = payload("Stop", id);
        stop.insert("easyisland_last_message".into(), json!(summary));
        hook(app, stop);
    }
    // On Telegram too, when it is linked: done, failed, waiting for you.
    if !quiet && matches!(state, TaskState::Done | TaskState::Failed | TaskState::Asking | TaskState::Paused) {
        let title = task.as_ref().map(|t| t.title.clone()).unwrap_or_default();
        let head = match state {
            TaskState::Done => "✅",
            TaskState::Asking => "❓",
            _ => "⏸",
        };
        crate::telegram::tell(app, &format!("{head} {}

{summary}", tf("Compito «{title}»", &[("title", &title)]))).await;
    }
    // A recurring task waits for its next hour.
    if matches!(state, TaskState::Done | TaskState::Failed) {
        if let Some(task) = get(id).filter(Task::recurring) {
            note(&task.id, t("Di nuovo al prossimo orario"));
        }
    }
}

// ── Tools (agent.rs) ─────────────────────────────────────────────────────────

fn current(app: &AppHandle) -> Result<(AppHandle, String), String> {
    let id = running().ok_or(t("Nessun compito in corso: questi strumenti servono solo dentro un compito di EasyIsland."))?;
    Ok((app.clone(), id))
}

fn str_arg<'a>(args: &'a Value, key: &str) -> &'a str {
    args.get(key).and_then(Value::as_str).unwrap_or_default().trim()
}

pub fn tool_plan(app: &AppHandle, args: &Value) -> Result<String, String> {
    let (app, id) = current(app)?;
    let steps: Vec<Step> = args.get("steps").and_then(Value::as_array).map(|a| {
        a.iter().filter_map(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).take(MAX_STEPS)
            .map(|s| Step { text: s.chars().take(200).collect(), done: false }).collect()
    }).unwrap_or_default();
    if steps.is_empty() {
        return Err(t("steps: un elenco di passi, almeno uno.").into());
    }
    TOOLED.store(true, Ordering::SeqCst);
    // Steps already done with the same words stay done.
    let task = update(&app, &id, |t| {
        let done: Vec<String> = t.plan.iter().filter(|s| s.done).map(|s| s.text.clone()).collect();
        t.plan = steps.into_iter().map(|mut s| { s.done = done.contains(&s.text); s }).collect();
        t.last = crate::i18n::t("Piano pronto").into();
    }).ok_or(t("Compito non trovato."))?;
    note(&id, &tf("Piano:\n{p}", &[("p", &plan_text(&task.plan))]));
    show_step(&app, &id, &tf("Piano: {n} passi", &[("n", &task.plan.len().to_string())]));
    Ok(plan_text(&task.plan))
}

pub fn tool_step(app: &AppHandle, args: &Value) -> Result<String, String> {
    let (app, id) = current(app)?;
    let index = args.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
    let text = str_arg(args, "note");
    TOOLED.store(true, Ordering::SeqCst);
    let mut label = String::new();
    let task = update(&app, &id, |t| {
        if let Some(step) = index.checked_sub(1).and_then(|i| t.plan.get_mut(i)) {
            step.done = args.get("done").and_then(Value::as_bool).unwrap_or(true);
            label = step.text.clone();
        }
        let line = if text.is_empty() { label.clone() } else { format!("{label} — {text}") };
        if !line.trim().is_empty() {
            t.last = line.trim_start_matches(" — ").to_string();
        }
    }).ok_or(t("Compito non trovato."))?;
    if label.is_empty() {
        return Err(tf("index: un numero da 1 a {n} (il passo del piano).", &[("n", &task.plan.len().to_string())]));
    }
    note(&id, &format!("✓ {}", task.last));
    show_step(&app, &id, &task.last);
    Ok(plan_text(&task.plan))
}

pub fn tool_note(app: &AppHandle, args: &Value) -> Result<String, String> {
    let (app, id) = current(app)?;
    let text = str_arg(args, "text");
    if text.is_empty() {
        return Err(t("text: la nota.").into());
    }
    TOOLED.store(true, Ordering::SeqCst);
    note(&id, text);
    update(&app, &id, |t| t.last = text.chars().take(200).collect());
    show_step(&app, &id, text);
    Ok(t("Annotato.").into())
}

pub fn tool_done(app: &AppHandle, args: &Value) -> Result<String, String> {
    let (app, id) = current(app)?;
    let result = str_arg(args, "result");
    let quiet = args.get("quiet").and_then(Value::as_bool).unwrap_or(false);
    TOOLED.store(true, Ordering::SeqCst);
    update(&app, &id, |t| {
        t.result = result.chars().take(4000).collect();
        t.state = TaskState::Done;
        t.quiet = quiet;
    }).ok_or(t("Compito non trovato."))?;
    Ok(t("Compito chiuso. Non serve altro in questo turno.").into())
}

/// A question for the user: the island's card, with buttons for `options` and
/// a field for any other answer. No answer in time: the task waits for one.
pub async fn tool_ask(app: &AppHandle, args: &Value) -> Result<String, String> {
    let (app, id) = current(app)?;
    let question = str_arg(args, "question");
    if question.is_empty() {
        return Err(t("question: la domanda per l'utente.").into());
    }
    TOOLED.store(true, Ordering::SeqCst);
    let options: Vec<Value> = args.get("options").and_then(Value::as_array).map(|a| {
        a.iter().filter_map(Value::as_str).map(str::trim).filter(|s| !s.is_empty()).take(6).map(|s| json!({ "label": s, "description": "" })).collect()
    }).unwrap_or_default();
    note(&id, &tf("Domanda: {q}", &[("q", &question.to_string())]));
    update(&app, &id, |t| t.question = question.to_string());
    let mut p = payload("PermissionRequest", &id);
    p.insert("tool_name".into(), json!("AskUserQuestion"));
    p.insert("tool_input".into(), json!({ "questions": [{ "question": question, "header": t("Compito"), "options": options, "multiSelect": false }] }));
    let decision = crate::pipe::request_decision(&app, Value::Object(p)).await;
    let answered = decision.as_deref().and_then(|d| d.strip_prefix("answer ")).and_then(|j| serde_json::from_str::<Map<String, Value>>(j).ok())
        .and_then(|m| m.values().find_map(|v| v.as_str().map(str::to_string)));
    match answered {
        Some(a) => {
            note(&id, &tf("Risposta dell'utente: {a}", &[("a", &a)]));
            update(&app, &id, |t| t.last = crate::i18n::tf("Risposta: {a}", &[("a", &a)]));
            Ok(tf("L'utente risponde: {a}", &[("a", &a)]))
        }
        None => {
            update(&app, &id, |t| t.state = TaskState::Asking);
            Ok(t("L'utente non ha risposto ora: il compito aspetta la sua risposta. Chiudi qui il turno, senza fare altro.").into())
        }
    }
}

/// task_delegate: a piece of the work to another engine, in a conversation of
/// its own (Channel::Helper: same tools and permissions, not in the history).
/// Only the task's helpers; the answer goes back to the engine that asked.
pub async fn tool_delegate(app: &AppHandle, args: &Value) -> Result<String, String> {
    let (app, id) = current(app)?;
    let task = get(&id).ok_or(t("Compito non trovato."))?;
    let engine = str_arg(args, "engine").to_string();
    let ask = str_arg(args, "prompt").to_string();
    if ask.is_empty() {
        return Err(t("prompt: cosa deve fare l'altro motore, con il contesto che serve.").into());
    }
    let helpers = ready_helpers(&app, &task);
    let Some((_, name)) = helpers.iter().find(|(h, _)| *h == engine) else {
        let list = helpers.iter().map(|(h, _)| h.clone()).collect::<Vec<_>>().join(", ");
        return Err(if list.is_empty() {
            t("Questo compito non ha motori aiutanti pronti: fai tu il lavoro.").into()
        } else {
            tf("engine: uno dei motori aiutanti di questo compito ({list}).", &[("list", &list)])
        });
    };
    let name = name.clone();
    TOOLED.store(true, Ordering::SeqCst);
    note(&id, &tf("Affidato a {e}: {p}", &[("e", &name), ("p", &ask.chars().take(300).collect::<String>())]));
    show_step(&app, &id, &tf("Chiede a {e}", &[("e", &name)]));
    let chat = Chat::default();
    let reply = crate::chat_turn(&app, &chat, ask, None, Some(engine.clone()), None, false, crate::Channel::Helper, &|_| {}).await;
    if engine == "opencode" {
        crate::opencode::forget(chat.cli_session());
    }
    let text = reply?.text;
    let clean = text.lines().filter(|l| !l.trim_start().starts_with("> ⚙")).collect::<Vec<_>>().join("\n");
    let clean = clean.trim();
    note(&id, &tf("Risposta di {e}: {t}", &[("e", &name), ("t", &clean.chars().take(600).collect::<String>())]));
    show_step(&app, &id, &tf("{e} ha risposto", &[("e", &name)]));
    Ok(clean.chars().take(12_000).collect())
}

/// task_create from the chat (Consenti / Nega on the island first: not read-only).
pub fn tool_create(app: &AppHandle, args: &Value) -> Result<String, String> {
    let task = create(app, str_arg(args, "title"), str_arg(args, "goal"), str_arg(args, "when"), "")?;
    // The engine that leads it and its helpers, when the user said which.
    let helpers: Vec<String> = args.get("helpers").and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default();
    if !str_arg(args, "engine").is_empty() || !helpers.is_empty() {
        set_engines(app, &task.id, str_arg(args, "engine"), str_arg(args, "model"), &helpers)?;
    }
    Ok(match task.state {
        TaskState::Scheduled => tf("Compito «{title}» creato: parte da solo ({when}). Lo vedi in Impostazioni → Compiti.", &[("title", &task.title), ("when", &task.when)]),
        _ => tf("Compito «{title}» creato e in coda: lo vedi nella scheda Agenti dell'isola.", &[("title", &task.title)]),
    })
}

pub fn tool_list() -> String {
    let all = list();
    if all.is_empty() {
        return t("Nessun compito.").into();
    }
    all.iter().rev().take(30).map(|t| {
        let done = t.plan.iter().filter(|s| s.done).count();
        format!("- {} «{}» [{:?}] {}/{} passi · {}", t.id, t.title, t.state, done, t.plan.len(), t.last)
    }).collect::<Vec<_>>().join("\n")
}

/// The app is closing: the running task is paused for the next start.
pub fn on_exit() {
    let Some(id) = running() else { return };
    let app = APP.lock().unwrap().clone();
    if let Some(app) = app {
        update(&app, &id, |t| {
            t.state = TaskState::Paused;
            t.last = crate::i18n::t("In pausa: EasyIsland si è chiuso. «Riprendi» per continuare.").into();
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn when_is_checked() {
        for ok in ["", "at:2026-10-24 09:00", "daily:07:30", "weekdays:18:05"] {
            assert!(check_when(ok).is_ok(), "{ok}");
        }
        for bad in ["domani", "at:2026-13-01 09:00", "at:2026-10-24", "daily:25:00", "daily:9:00", "weekly:09:00", "at:2026-10-24T09:00"] {
            assert!(check_when(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn a_one_off_hour_starts_once_even_if_missed() {
        assert!(!due("at:2026-10-24 09:00", "2026-10-24 08:59", 6, ""));
        assert!(due("at:2026-10-24 09:00", "2026-10-24 09:00", 6, ""));
        assert!(due("at:2026-10-24 09:00", "2026-10-25 10:00", 7, ""), "missed while closed: at once");
        assert!(!due("at:2026-10-24 09:00", "2026-10-24 09:01", 6, "2026-10-24 09:00"), "only once");
    }

    #[test]
    fn daily_and_weekdays_start_once_a_day() {
        assert!(due("daily:09:00", "2026-10-24 09:00", 6, "2026-10-23 09:00"));
        assert!(!due("daily:09:00", "2026-10-24 09:30", 6, "2026-10-24 09:00"), "already today");
        assert!(!due("daily:09:00", "2026-10-24 08:00", 6, ""));
        assert!(due("weekdays:09:00", "2026-10-23 09:00", 5, ""));
        assert!(!due("weekdays:09:00", "2026-10-24 09:00", 6, ""), "not on Saturday");
    }

    #[test]
    fn every_and_weekly() {
        assert!(check_when("every:30").is_ok() && check_when("weekly:1:09:00").is_ok());
        assert!(check_when("every:5").is_err() && check_when("weekly:8:09:00").is_err());
        assert!(due("every:30", "2026-10-23 10:30", 5, "2026-10-23 10:00"));
        assert!(!due("every:30", "2026-10-23 10:29", 5, "2026-10-23 10:00"));
        assert!(due("every:60", "2026-11-01 00:10", 7, "2026-10-31 23:05"), "across a month");
        assert!(due("every:60", "2026-10-23 10:00", 5, ""), "never ran: now");
        assert!(due("weekly:5:09:00", "2026-10-23 09:00", 5, "2026-10-16 09:00"));
        assert!(!due("weekly:5:09:00", "2026-10-22 09:00", 4, ""), "not its day");
        assert_eq!(minutes("1970-01-02 00:01"), Some(1441));
    }

    #[test]
    fn ids_name_files_safely() {
        assert!(valid_id("20261023101500-a1b2c3"));
        for bad in ["", "../x", "a b", "a\\b", "x.json"] {
            assert!(!valid_id(bad), "{bad}");
        }
    }

    #[test]
    fn the_prompt_carries_goal_plan_and_answer() {
        let mut task = Task {
            id: "1".into(), title: "Resoconto".into(), goal: "Prepara il resoconto di Rossi".into(), engine: String::new(), model: String::new(), helpers: Vec::new(),
            state: TaskState::Running, plan: vec![Step { text: "Leggi i ticket".into(), done: true }, Step { text: "Scrivi la bozza".into(), done: false }],
            when: String::new(), last_fired: String::new(), question: "Che mese?".into(), answer: "Settembre".into(),
            result: String::new(), last: String::new(), turns: 0, runs: 0, quiet: false, heartbeat: false, created: String::new(), updated: String::new(),
        };
        let first = prompt(&task, true);
        assert!(first.contains("Prepara il resoconto di Rossi") && first.contains("task_plan"));
        let next = prompt(&task, false);
        assert!(next.contains("1. [x] Leggi i ticket") && next.contains("2. [ ] Scrivi la bozza"));
        assert!(next.contains("Settembre"));
        task.answer.clear();
        assert!(!prompt(&task, false).contains("Settembre"));
        assert!(!next.contains("task_delegate"), "no helpers, no delegation");
        let with = prompt_with(&task, false, &[("opencode".into(), "opencode".into())]);
        assert!(with.contains("task_delegate") && with.contains("opencode (opencode)"));
    }
}
