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
    /// The engine for this task; "" = Impostazioni → Flussi, else the chat's.
    #[serde(default)]
    pub engine: String,
    /// Its model ("" = the engine's in Impostazioni → Chat).
    #[serde(default)]
    pub model: String,
    /// Engines it may hand a piece of work to (task_delegate); empty = none.
    #[serde(default)]
    pub helpers: Vec<String>,
    /// Reversible tools it may use without asking (permits.rs), chosen when it
    /// is created or in Impostazioni → Flussi; the others ask as in the chat.
    #[serde(default)]
    pub may: Vec<String>,
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
    /// The evening digest of the memory: today's diary goes into its goal, and
    /// with an empty diary the run is skipped.
    #[serde(default)]
    pub digest: bool,
    /// A job on the memory (brain.rs) started from its window: "inbox" reads
    /// da-leggere, "check" proposes the fixes the check found.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub memory: String,
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
/// A task's turn (or its helper's) is running: its permissions also go to Telegram.
static IN_TURN: AtomicBool = AtomicBool::new(false);
/// The question on screen of the running task (task_ask): an answer from
/// Telegram arrives here while the island's card is still up.
static ASK_WAIT: Mutex<Option<(String, tokio::sync::oneshot::Sender<String>)>> = Mutex::new(None);

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
    create_with(app, title, goal, when, engine, |_| {})
}

/// `create`, with `set` applied before the queue can see it.
fn create_with(app: &AppHandle, title: &str, goal: &str, when: &str, engine: &str, set: impl FnOnce(&mut Task)) -> Result<Task, String> {
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
        may: Vec::new(),
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
        digest: false,
        memory: String::new(),
        created: now.clone(),
        updated: now,
    };
    let mut task = task;
    set(&mut task);
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

/// Impostazioni → Flussi: the engine, model and helpers of a task. Not while
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

/// What a task may do without asking (permits.rs): only reversible tools.
pub fn set_may(app: &AppHandle, id: &str, may: &[String]) -> Result<(), String> {
    get(id).ok_or(t("Compito non trovato."))?;
    let may = crate::permits::only_reversible(may);
    update(app, id, |t| t.may = may.clone());
    Ok(())
}

/// The task in its turn allows this tool without asking (permits.rs).
pub fn may_now(tool: &str) -> bool {
    if !in_turn() {
        return false;
    }
    running().and_then(|id| get(&id)).is_some_and(|t| t.may.iter().any(|m| m == tool))
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

/// Impostazioni → Flussi → Battito: on every `minutes` (0 = off). There is one heartbeat task.
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

/// Impostazioni → Chat → Memoria: the evening digest on (every day at 22:30) or off.
pub fn set_digest(app: &AppHandle, on: bool) -> Result<(), String> {
    let existing = TASKS.lock().unwrap().iter().find(|t| t.digest).map(|t| t.id.clone());
    match (on, existing) {
        (false, Some(id)) => control(app, &id, "delete"),
        (false, None) | (true, Some(_)) => Ok(()),
        (true, None) => {
            let task = create(app, t("Riordino della memoria"), t("Rileggi il diario di oggi e proponi all'utente le cose da ricordare."), "daily:22:30", "")?;
            update(app, &task.id, |t| t.digest = true);
            Ok(())
        }
    }
}

/// The memory window's «Leggi adesso» ("inbox") and «Controlla» ("check"):
/// a task in the queue now, one of each at a time.
pub fn memory_job(app: &AppHandle, kind: &str) -> Result<(), String> {
    let (title, goal) = match kind {
        "inbox" => {
            if crate::brain::inbox_files().is_empty() {
                return Err(t("La cartella da-leggere è vuota: mettici i file da far imparare.").into());
            }
            (t("Lettura delle fonti"), t("Leggi i file di da-leggere e scrivi quello che insegnano nelle pagine della memoria."))
        }
        "check" => (t("Controllo della memoria"), t("Controlla la memoria e proponi all'utente come sistemarla.")),
        _ => return Err("kind".into()),
    };
    let busy = TASKS.lock().unwrap().iter().any(|t| t.memory == kind && matches!(t.state, TaskState::Queued | TaskState::Running | TaskState::Asking));
    if busy {
        return Err(t("C'è già un compito così in corso: lo segui in Agenti.").into());
    }
    create_with(app, title, goal, "", "", |t| t.memory = kind.to_string()).map(|_| ())
}

/// The part of the goal about da-leggere (the digest and «Leggi adesso»).
fn inbox_section() -> Option<String> {
    let files = crate::brain::inbox_files();
    if files.is_empty() {
        return None;
    }
    let list = files.iter().map(|f| f.name.clone()).collect::<Vec<_>>().join(", ");
    Some(tf(
        "[Fonti da leggere (la cartella da-leggere della memoria): {list}.
Per ognuna: leggila con memory_inbox (file); poi scrivi o aggiorna le pagine della memoria con memory_page_write, una per argomento (una persona, un cliente, un progetto, un concetto), con il nome del file in source. Testo breve in Markdown, con [[Titolo]] verso le altre pagine e righe «- relazione: [[Altra pagina]]» per dire come sono legate (lavora con, cliente di, parte di, usa…). Prima guarda con memory_page (senza titolo: l'elenco) se la pagina o una simile esiste già, e aggiorna quella partendo dal suo testo e con la sua versione. Niente password o dati sensibili. Poi sposta la fonte con memory_inbox_done. Alla fine riassumi in task_done cosa hai imparato e quali pagine hai scritto.]",
        &[("list", &list)],
    ))
}

/// The part of the goal about the check (Sunday's digest and «Controlla»).
fn check_section(found: &[String]) -> String {
    let report = if found.is_empty() { t("niente di evidente").to_string() } else { found.join("
") };
    tf(
        "[Controllo della memoria. Ecco cosa ha trovato EasyIsland:
{report}
Guarda anche se note e pagine si contraddicono o sono superate (memory_page, memory_search). Proponi le correzioni all'utente con task_ask, una per riga (unire due pagine, correggere o completare una pagina, archiviare una nota vecchia, creare una pagina che manca), con le opzioni «Fai tutto» e «Niente» (può anche scrivere quali). Poi fai solo quelle approvate: memory_page_write per scrivere (con la versione letta), memory_forget per archiviare (non si cancella niente), memory_note per una nota nuova. Se non c'è niente da proporre chiudi con task_done e quiet true; altrimenti con task_done e cosa hai sistemato.]",
        &[("report", &report)],
    )
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
        // The evening digest also lets the memory engine tie the memory (memory_ai.rs).
        if fired.iter().any(|id| get(id).is_some_and(|t| t.digest)) {
            crate::memory_ai::after_digest(&app);
        }
        for id in &fired {
            // A heartbeat with nothing to watch costs nothing: skipped.
            let empty_digest = get(id).is_some_and(|t| t.digest) && crate::memory::diary_today(1).is_empty() && crate::brain::inbox_files().is_empty() && (day != 7 || crate::brain::check().is_empty());
            if empty_digest || (get(id).is_some_and(|t| t.heartbeat) && heartbeat_items().is_empty()) {
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
    if task.digest && !crate::memory::diary_today(1).is_empty() {
        let notes = crate::memory::notes();
        text.push_str(&format!("\n\n{}", tf(
            "[Riordino della memoria. Il diario di oggi:\n{diary}\n\nNote già in memoria: {n}.\nScegli al massimo 5 cose che valgono anche nei prossimi giorni (preferenze dell'utente, clienti, persone, come si fanno le cose) e che non sono già in memoria; niente password o dati sensibili. Se non ce n'è nessuna chiudi con task_done e quiet true. Altrimenti mostrale con task_ask, una per riga, con le opzioni «Salva tutte» e «Nessuna» (l'utente può anche scrivere quali); poi salva quelle approvate con memory_note, una per volta, e chiudi con task_done.]",
            &[("diary", &crate::memory::diary_today(80).join("\n")), ("n", &notes.len().to_string())],
        )));
    }
    if task.digest || task.memory == "inbox" {
        if let Some(inbox) = inbox_section() {
            text.push_str(&format!("

{inbox}"));
        }
    }
    // The digest checks the memory on Sundays, when there is something to fix.
    let sunday = now_key().1 == 7;
    if task.memory == "check" || (task.digest && sunday && !crate::brain::check().is_empty()) {
        text.push_str(&format!("

{}", check_section(&crate::brain::check())));
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
        IN_TURN.store(true, Ordering::SeqCst);
        let reply = crate::chat_turn(app, &chat, text, None, engine_opt, model_opt, false, crate::Channel::Task, &|_| {}).await;
        IN_TURN.store(false, Ordering::SeqCst);
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
    let task = update(&app, &id, |t| t.question = question.to_string());
    let input = json!({ "questions": [{ "question": question, "header": t("Compito"), "options": options, "multiSelect": false }] });
    let mut p = payload("PermissionRequest", &id);
    p.insert("tool_name".into(), json!("AskUserQuestion"));
    p.insert("tool_input".into(), input.clone());
    // On Telegram too: a button per option, or /rispondi.
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    *ASK_WAIT.lock().unwrap() = Some((id.clone(), tx));
    if crate::telegram::linked(&app) {
        let labels: Vec<String> = options.iter().filter_map(|o| o.get("label").and_then(Value::as_str).map(str::to_string)).collect();
        let title = task.map(|t| t.title).unwrap_or_default();
        crate::telegram::ask_task(&app, &id, &title, question, &labels).await;
    }
    let request = crate::pipe::new_request_id();
    let island = async {
        let decision = crate::pipe::request_decision_as(&app, &request, Value::Object(p)).await;
        decision.as_deref().and_then(|d| d.strip_prefix("answer ")).and_then(|j| serde_json::from_str::<Map<String, Value>>(j).ok())
            .and_then(|m| m.values().find_map(|v| v.as_str().map(str::to_string)))
    };
    let telegram = async { rx.await.ok() };
    let (answered, from_telegram) = match first_some(island, telegram).await {
        Some((a, 1)) => (Some(a), true),
        Some((a, _)) => (Some(a), false),
        None => (None, false),
    };
    ASK_WAIT.lock().unwrap().take();
    if from_telegram {
        // The island's card goes away: answered elsewhere.
        crate::pipe::decline(&app, &request);
        let mut done = payload("PostToolUse", &id);
        done.insert("tool_name".into(), json!("AskUserQuestion"));
        done.insert("tool_input".into(), input);
        hook(&app, done);
    }
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

/// The first of two answers that is Some, with which one it was (0 or 1);
/// None when both end with None.
pub(crate) async fn first_some<A, B>(a: A, b: B) -> Option<(String, u8)>
where
    A: std::future::Future<Output = Option<String>>,
    B: std::future::Future<Output = Option<String>>,
{
    let mut a = Some(Box::pin(a));
    let mut b = Some(Box::pin(b));
    std::future::poll_fn(move |cx| {
        if let Some(f) = a.as_mut() {
            if let std::task::Poll::Ready(r) = f.as_mut().poll(cx) {
                a = None;
                if let Some(v) = r {
                    return std::task::Poll::Ready(Some((v, 0)));
                }
            }
        }
        if let Some(f) = b.as_mut() {
            if let std::task::Poll::Ready(r) = f.as_mut().poll(cx) {
                b = None;
                if let Some(v) = r {
                    return std::task::Poll::Ready(Some((v, 1)));
                }
            }
        }
        if a.is_none() && b.is_none() { std::task::Poll::Ready(None) } else { std::task::Poll::Pending }
    })
    .await
}

pub fn in_turn() -> bool {
    IN_TURN.load(Ordering::SeqCst)
}

/// A permission of a task's turn (pipe::request_decision): the island's card
/// and, when linked, Telegram's buttons; the first answer wins, the other goes.
pub async fn decide(app: &AppHandle, payload: Value) -> Option<String> {
    let request = crate::pipe::new_request_id();
    if !crate::telegram::linked(app) {
        return crate::pipe::request_decision_as(app, &request, payload).await;
    }
    let island = crate::pipe::request_decision_as(app, &request, payload.clone());
    let telegram = crate::telegram::ask_permission(app, payload);
    let decision = first_some(island, telegram).await;
    if let Some((_, 1)) = &decision {
        crate::pipe::decline(app, &request);
        let _ = app.emit_to(WINDOW_LABEL, "approval-cancel", request.clone());
    }
    decision.map(|(d, _)| d)
}

/// An answer to a task's question from outside the island (Telegram): to the
/// card still waiting, or to the task waiting in «Attende te».
pub fn answer_from_outside(app: &AppHandle, id: &str, text: &str) -> Result<String, String> {
    let waiting = ASK_WAIT.lock().unwrap().take();
    match waiting {
        Some((task, tx)) if task == id => {
            let _ = tx.send(text.to_string());
            Ok(get(id).map(|t| t.title).unwrap_or_default())
        }
        other => {
            *ASK_WAIT.lock().unwrap() = other;
            answer(app, id, text)?;
            Ok(get(id).map(|t| t.title).unwrap_or_default())
        }
    }
}

/// /rispondi on Telegram: the question on screen, else the task waiting longest.
pub fn answer_latest(app: &AppHandle, text: &str) -> Result<String, String> {
    if text.trim().is_empty() {
        return Err(t("Scrivi la risposta dopo /rispondi.").into());
    }
    let on_screen = ASK_WAIT.lock().unwrap().as_ref().map(|(id, _)| id.clone());
    let id = on_screen
        .or_else(|| TASKS.lock().unwrap().iter().filter(|t| t.state == TaskState::Asking).min_by(|a, b| a.updated.cmp(&b.updated)).map(|t| t.id.clone()))
        .ok_or(t("Nessun compito sta aspettando una risposta."))?;
    answer_from_outside(app, &id, text)
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
    // What it may do alone: on the card the user approved (hooks.ts shows it).
    let may: Vec<String> = args.get("may").and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default();
    if !may.is_empty() {
        set_may(app, &task.id, &may)?;
    }
    Ok(match task.state {
        TaskState::Scheduled => tf("Compito «{title}» creato: parte da solo ({when}). Lo vedi in Impostazioni → Flussi.", &[("title", &task.title), ("when", &task.when)]),
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
    fn the_first_answer_wins_and_a_none_waits_for_the_other() {
        use tauri::async_runtime::block_on;
        assert_eq!(block_on(first_some(async { None }, async { Some("sì".to_string()) })), Some(("sì".to_string(), 1)));
        assert_eq!(block_on(first_some(async { Some("allow".to_string()) }, std::future::pending())), Some(("allow".to_string(), 0)));
        assert_eq!(block_on(first_some(async { None }, async { None })), None);
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
            id: "1".into(), title: "Resoconto".into(), goal: "Prepara il resoconto di Rossi".into(), engine: String::new(), model: String::new(), helpers: Vec::new(), may: Vec::new(),
            state: TaskState::Running, plan: vec![Step { text: "Leggi i ticket".into(), done: true }, Step { text: "Scrivi la bozza".into(), done: false }],
            when: String::new(), last_fired: String::new(), question: "Che mese?".into(), answer: "Settembre".into(),
            result: String::new(), last: String::new(), turns: 0, runs: 0, quiet: false, heartbeat: false, digest: false, memory: String::new(), created: String::new(), updated: String::new(),
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
