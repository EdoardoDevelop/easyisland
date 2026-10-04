// Automations: "quando… (se…) allora…", set up in Impostazioni → Automazioni.
//
// Triggers: a time of day on chosen days, EasyIsland starting (with the PC),
// the PC being unlocked, joining a Wi-Fi network, a program starting, a drive
// (USB stick, external disk) being plugged in, a new file in a folder, an
// integration or widget reporting a problem or an event (new ticket…).
// Condition: optionally, only in one profile.
// Actions, in order: a quick action of the user's, a notice in the island, a
// profile switch, opening a program/folder or a link.
//
// The user approved each automation by creating it, so it runs without
// asking — except a quick-action script marked "Chiedi conferma", which the
// island shows with Esegui as always, and "Chiedi a Claude" actions, which open
// the chat. Nothing runs while EasyIsland is paused. Every run lands in a log
// (in memory, the last 100) shown in the settings.
//
// Cost: one thread that sleeps 5 s between looks, 30 s when no automation is
// on, and only asks for what an enabled automation needs (process list, drive
// letters, a folder, the Wi-Fi name every 30 s). Unlock comes from Windows
// (WTSRegisterSessionNotification) on a thread that sleeps in GetMessageW.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::island::WINDOW_LABEL;

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Trigger {
    /// time | startup | unlock | wifi | app | drive | folder | integration
    pub kind: String,
    /// time: "HH:MM".
    pub time: String,
    /// time: 1 = Monday … 7 = Sunday; empty = every day.
    pub days: Vec<u8>,
    /// startup: seconds after EasyIsland starts.
    pub delay: u64,
    pub ssid: String,
    /// app: executable name, e.g. "teams.exe".
    pub exe: String,
    pub folder: String,
    /// integration: id of the integration or widget ("integration_zammad", a widget id).
    pub source: String,
    /// integration: "problem" (turns warn/error) | "event" (new ticket…) | "any".
    pub when: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Step {
    /// quick | notice | profile | app | url
    pub kind: String,
    /// quick: action id · profile: profile id.
    pub id: String,
    pub title: String,
    pub text: String,
    pub level: String,
    pub target: String,
    pub args: String,
    pub url: String,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Automation {
    pub id: String,
    pub name: String,
    pub enabled: bool,
    pub trigger: Trigger,
    /// Only while this profile is active; "" = any.
    pub profile: String,
    pub steps: Vec<Step>,
    /// A notice in the island every time it runs (errors always show).
    pub notify: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub at: u64,
    pub name: String,
    /// What set it off ("ore 09:00", "chiavetta E:", "Prova"…).
    pub cause: String,
    pub ok: bool,
    pub detail: String,
}

static LOG: Mutex<VecDeque<LogEntry>> = Mutex::new(VecDeque::new());
const LOG_KEEP: usize = 100;
static UNLOCKED: AtomicBool = AtomicBool::new(false);
/// (source id, "problem" | "event", text) reported by widgets.rs.
static WIDGET_EVENTS: Mutex<Vec<(String, String, String)>> = Mutex::new(Vec::new());

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn log() -> Vec<LogEntry> {
    LOG.lock().unwrap().iter().cloned().collect()
}

fn push_log(entry: LogEntry) {
    let mut log = LOG.lock().unwrap();
    log.push_front(entry);
    log.truncate(LOG_KEEP);
}

/// widgets.rs: a check came back. `prev` is the previous level, if any.
pub fn on_widget(id: &str, prev: Option<&str>, level: &str, summary: &str, event: Option<&str>) {
    let mut q = WIDGET_EVENTS.lock().unwrap();
    if level != "ok" && prev.is_some_and(|p| p == "ok") {
        q.push((id.to_string(), "problem".into(), summary.to_string()));
    }
    if let (Some(e), Some(_)) = (event, prev) {
        q.push((id.to_string(), "event".into(), e.to_string()));
    }
    q.truncate(50);
}

fn list(app: &AppHandle) -> (Vec<Automation>, String, Vec<Value>) {
    let Some(shared) = app.try_state::<crate::Shared>() else { return (Vec::new(), String::new(), Vec::new()) };
    let s = shared.settings.lock().unwrap();
    let autos = s
        .automations
        .iter()
        .filter_map(|v| serde_json::from_value::<Automation>(v.clone()).ok())
        .collect();
    // Quick actions belong to profiles: look in the active one first, then in all.
    let mut actions = s.actions.clone();
    for p in &s.profiles {
        if let Some(Value::Array(a)) = p.values.get("actions") {
            actions.extend(a.iter().cloned());
        }
    }
    (autos, s.active_profile.clone(), actions)
}

fn notice(app: &AppHandle, title: &str, text: &str, level: &str) {
    let cut = |s: &str, n: usize| s.chars().take(n).collect::<String>();
    let _ = app.emit_to(WINDOW_LABEL, "hook", json!({
        "hook_event_name": "EasyIslandNotify",
        "title": cut(title, 120),
        "text": cut(text, 600),
        "level": level,
        "url": "",
    }));
}

async fn run_step(app: &AppHandle, step: &Step, actions: &[Value]) -> Result<String, String> {
    match step.kind.as_str() {
        "quick" => {
            let a = actions
                .iter()
                .find(|a| a.get("id").and_then(Value::as_str) == Some(step.id.as_str()))
                .ok_or("azione rapida non trovata (eliminata?)")?;
            let get = |k: &str| a.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
            let name = get("name");
            match get("kind").as_str() {
                "url" => {
                    crate::open_url_now(&get("target"));
                    Ok(format!("aperto «{name}»"))
                }
                "app" => crate::actions::open_app(&get("target"), &get("args")).map(|_| format!("avviato «{name}»")),
                "script" if !a.get("confirm").and_then(Value::as_bool).unwrap_or(false) => {
                    let run_id = format!("auto-{}", now_ms());
                    let r = crate::actions::run_script(&run_id, &get("shell"), &get("script")).await?;
                    if r.timed_out {
                        return Err(format!("«{name}» interrotto: tempo scaduto"));
                    }
                    let first = r.output.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("").to_string();
                    match r.code {
                        Some(0) | None => Ok(format!("«{name}» eseguito{}", if first.is_empty() { String::new() } else { format!(": {first}") })),
                        Some(c) => Err(format!("«{name}» terminato con codice {c}{}", if first.is_empty() { String::new() } else { format!(": {first}") })),
                    }
                }
                // A script that wants confirmation, or a question to Claude:
                // the island takes it from here, exactly as from the ⚡ tab.
                _ => {
                    let _ = app.emit_to(WINDOW_LABEL, "automation-action", get("id"));
                    Ok(format!("«{name}» aperto nell'isola"))
                }
            }
        }
        "notice" => {
            let level = match step.level.as_str() {
                "ok" | "warn" | "error" => step.level.as_str(),
                _ => "info",
            };
            notice(app, &step.title, &step.text, level);
            Ok("avviso mostrato".into())
        }
        "profile" => {
            crate::activate_profile(app, &step.id, "automazione");
            Ok("profilo cambiato".into())
        }
        "app" => {
            if step.target.trim().is_empty() {
                return Err("programma non indicato".into());
            }
            crate::actions::open_app(step.target.trim(), &step.args).map(|_| format!("aperto {}", step.target.trim()))
        }
        "url" => {
            let url = step.url.trim();
            if !(url.starts_with("https://") || url.starts_with("http://")) {
                return Err("il link deve iniziare con http:// o https://".into());
            }
            crate::open_url_now(url);
            Ok(format!("aperto {url}"))
        }
        other => Err(format!("passo sconosciuto: {other}")),
    }
}

/// Runs every step, in order, logs the outcome and tells the island when
/// asked to (or when something failed).
pub async fn run(app: AppHandle, auto: Automation, cause: String, actions: Vec<Value>) {
    crate::log::line(format!("automation {} ({cause})", auto.name));
    let mut done = Vec::new();
    let mut ok = true;
    for step in &auto.steps {
        match run_step(&app, step, &actions).await {
            Ok(t) => done.push(t),
            Err(e) => {
                ok = false;
                done.push(format!("errore: {e}"));
            }
        }
    }
    if auto.steps.is_empty() {
        done.push("nessun passo da eseguire".into());
    }
    let detail = done.join(" · ");
    let name = if auto.name.trim().is_empty() { "Automazione".to_string() } else { auto.name.clone() };
    if auto.notify || !ok {
        notice(&app, &format!("Automazione «{name}»"), &detail, if ok { "ok" } else { "error" });
    }
    push_log(LogEntry { at: now_ms(), name, cause, ok, detail });
    let _ = app.emit_to(crate::SETTINGS_LABEL, "automations-log", ());
}

/// Settings → "Prova ora".
pub fn run_now(app: &AppHandle, id: &str) -> Result<(), String> {
    let (autos, _, actions) = list(app);
    let auto = autos.into_iter().find(|a| a.id == id).ok_or("Automazione non trovata (salvata?)")?;
    let app = app.clone();
    tauri::async_runtime::spawn(run(app, auto, "Prova".into(), actions));
    Ok(())
}

// ── Sensors ──────────────────────────────────────────────────────────────────

fn drives() -> u32 {
    unsafe { windows::Win32::Storage::FileSystem::GetLogicalDrives() }
}

fn folder_names(path: &str) -> Option<HashSet<String>> {
    let entries = std::fs::read_dir(path).ok()?;
    Some(
        entries
            .flatten()
            .take(5000)
            .filter(|e| e.file_type().map(|t| t.is_file()).unwrap_or(false))
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect(),
    )
}

/// Date + minute key, so a "time" automation fires once per minute it matches.
fn minute_key() -> (u8, String) {
    let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    let day = if t.wDayOfWeek == 0 { 7 } else { t.wDayOfWeek as u8 };
    (day, format!("{:04}-{:02}-{:02} {:02}:{:02}", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute))
}

/// Follows lock/unlock from Windows; only sets a flag the engine reads.
fn spawn_unlock_watch() {
    use windows::core::w;
    use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::System::LibraryLoader::GetModuleHandleW;
    use windows::Win32::System::RemoteDesktop::{WTSRegisterSessionNotification, NOTIFY_FOR_THIS_SESSION};
    use windows::Win32::UI::WindowsAndMessaging::{
        CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW, HWND_MESSAGE, MSG,
        WINDOW_EX_STYLE, WINDOW_STYLE, WNDCLASSW,
    };
    const WM_WTSSESSION_CHANGE: u32 = 0x02B1;
    const WTS_SESSION_UNLOCK: usize = 0x8;

    unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
        if msg == WM_WTSSESSION_CHANGE && wparam.0 == WTS_SESSION_UNLOCK {
            UNLOCKED.store(true, Ordering::Relaxed);
        }
        DefWindowProcW(hwnd, msg, wparam, lparam)
    }

    std::thread::spawn(|| unsafe {
        let Ok(instance) = GetModuleHandleW(None) else { return };
        let class = WNDCLASSW {
            lpfnWndProc: Some(wndproc),
            hInstance: instance.into(),
            lpszClassName: w!("EasyIslandSession"),
            ..Default::default()
        };
        RegisterClassW(&class);
        let Ok(hwnd) = CreateWindowExW(
            WINDOW_EX_STYLE(0), w!("EasyIslandSession"), w!(""), WINDOW_STYLE(0),
            0, 0, 0, 0, Some(HWND_MESSAGE), None, Some(instance.into()), None,
        ) else { return };
        if WTSRegisterSessionNotification(hwnd, NOTIFY_FOR_THIS_SESSION).is_err() {
            crate::log::line("automations: no session notifications");
            return;
        }
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            DispatchMessageW(&msg);
        }
    });
}

pub fn spawn(app: AppHandle) {
    spawn_unlock_watch();
    std::thread::spawn(move || {
        let started = Instant::now();
        let mut fired_startup: HashSet<String> = HashSet::new();
        let mut fired_minute: HashMap<String, String> = HashMap::new();
        let mut procs: Option<HashSet<String>> = None;
        let mut drive_mask: Option<u32> = None;
        let mut folders: HashMap<String, HashSet<String>> = HashMap::new();
        let mut ssid: Option<Option<String>> = None;
        let mut ssid_checked = Instant::now() - Duration::from_secs(60);
        let mut ticks: u64 = 0;

        loop {
            let (autos, profile, actions) = list(&app);
            let on: Vec<&Automation> = autos
                .iter()
                .filter(|a| a.enabled && (a.profile.is_empty() || a.profile == profile))
                .collect();
            let paused = crate::integrations::PAUSED.load(Ordering::Relaxed);
            let unlocked = UNLOCKED.swap(false, Ordering::Relaxed);
            let widget_events: Vec<_> = std::mem::take(&mut *WIDGET_EVENTS.lock().unwrap());
            if on.is_empty() {
                // Forget the baselines, so switching one on later does not fire
                // on everything that changed meanwhile.
                procs = None;
                drive_mask = None;
                folders.clear();
                ssid = None;
                std::thread::sleep(Duration::from_secs(30));
                continue;
            }
            let wants = |k: &str| on.iter().any(|a| a.trigger.kind == k);
            let mut fire: Vec<(Automation, String)> = Vec::new();

            // Time of day.
            if wants("time") {
                let (day, key) = minute_key();
                let hhmm = &key[11..];
                for a in on.iter().filter(|a| a.trigger.kind == "time") {
                    let t = &a.trigger;
                    if t.time == hhmm
                        && (t.days.is_empty() || t.days.contains(&day))
                        && fired_minute.get(&a.id) != Some(&key)
                    {
                        fired_minute.insert(a.id.clone(), key.clone());
                        fire.push(((*a).clone(), format!("ore {hhmm}")));
                    }
                }
            }

            // EasyIsland started (with the PC, when it starts with Windows).
            for a in on.iter().filter(|a| a.trigger.kind == "startup") {
                if !fired_startup.contains(&a.id) && started.elapsed() >= Duration::from_secs(a.trigger.delay.max(5)) {
                    fired_startup.insert(a.id.clone());
                    fire.push(((*a).clone(), "avvio".into()));
                }
            }

            if unlocked {
                for a in on.iter().filter(|a| a.trigger.kind == "unlock") {
                    fire.push(((*a).clone(), "PC sbloccato".into()));
                }
            }

            // Wi-Fi network joined: asked every 30 s (netsh is a process).
            if wants("wifi") && ssid_checked.elapsed() >= Duration::from_secs(30) {
                ssid_checked = Instant::now();
                let now = crate::profiles::current_ssid();
                if let Some(prev) = &ssid {
                    if *prev != now {
                        if let Some(name) = &now {
                            for a in on.iter().filter(|a| a.trigger.kind == "wifi") {
                                if a.trigger.ssid.trim().eq_ignore_ascii_case(name) {
                                    fire.push(((*a).clone(), format!("rete {name}")));
                                }
                            }
                        }
                    }
                }
                ssid = Some(now);
            }

            // A program started.
            if wants("app") {
                let now: HashSet<String> = crate::presence::processes().into_iter().collect();
                if let Some(prev) = &procs {
                    for a in on.iter().filter(|a| a.trigger.kind == "app") {
                        let mut exe = a.trigger.exe.trim().to_lowercase();
                        if !exe.is_empty() && !exe.ends_with(".exe") {
                            exe.push_str(".exe");
                        }
                        if !exe.is_empty() && now.contains(&exe) && !prev.contains(&exe) {
                            fire.push(((*a).clone(), format!("avviato {exe}")));
                        }
                    }
                }
                procs = Some(now);
            } else {
                procs = None;
            }

            // A drive appeared (USB stick, external disk, phone as a drive…).
            if wants("drive") {
                let now = drives();
                if let Some(prev) = drive_mask {
                    let new = now & !prev;
                    if new != 0 {
                        let letters: String = (0..26)
                            .filter(|i| new & (1 << i) != 0)
                            .map(|i| format!("{}:", (b'A' + i as u8) as char))
                            .collect::<Vec<_>>()
                            .join(" ");
                        for a in on.iter().filter(|a| a.trigger.kind == "drive") {
                            fire.push(((*a).clone(), format!("unità {letters}")));
                        }
                    }
                }
                drive_mask = Some(now);
            } else {
                drive_mask = None;
            }

            // A new file in a folder: every 10 s.
            if wants("folder") && ticks % 2 == 0 {
                let wanted: HashSet<String> = on
                    .iter()
                    .filter(|a| a.trigger.kind == "folder")
                    .map(|a| a.trigger.folder.trim().to_string())
                    .filter(|f| !f.is_empty())
                    .collect();
                folders.retain(|k, _| wanted.contains(k));
                for folder in &wanted {
                    let Some(now) = folder_names(folder) else { continue };
                    if let Some(prev) = folders.get(folder) {
                        let mut new: Vec<&String> = now.difference(prev).collect();
                        new.sort();
                        if let Some(first) = new.first() {
                            let what = if new.len() == 1 { (*first).clone() } else { format!("{} e altri {}", first, new.len() - 1) };
                            for a in on.iter().filter(|a| a.trigger.kind == "folder" && a.trigger.folder.trim() == folder) {
                                fire.push(((*a).clone(), format!("nuovo file {what}")));
                            }
                        }
                    }
                    folders.insert(folder.clone(), now);
                }
            }

            // Integrations and widgets.
            for (source, kind, text) in &widget_events {
                for a in on.iter().filter(|a| a.trigger.kind == "integration" && &a.trigger.source == source) {
                    let when = if a.trigger.when.is_empty() { "any" } else { a.trigger.when.as_str() };
                    if when == "any" || when == kind {
                        fire.push(((*a).clone(), text.clone()));
                    }
                }
            }

            if !paused {
                for (auto, cause) in fire {
                    tauri::async_runtime::spawn(run(app.clone(), auto, cause, actions.clone()));
                }
            }
            ticks += 1;
            std::thread::sleep(Duration::from_secs(5));
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_with_defaults() {
        let a: Automation = serde_json::from_value(json!({
            "id": "a1", "name": "Mattina", "enabled": true,
            "trigger": { "kind": "time", "time": "09:00", "days": [1, 2, 3, 4, 5] },
            "steps": [{ "kind": "url", "url": "https://example.com" }]
        }))
        .unwrap();
        assert_eq!(a.trigger.days.len(), 5);
        assert!(a.profile.is_empty());
        assert!(!a.notify);
        assert_eq!(a.steps[0].kind, "url");
    }

    #[test]
    fn widget_transitions_become_events() {
        WIDGET_EVENTS.lock().unwrap().clear();
        on_widget("w1", Some("ok"), "error", "Sito giù", None);
        on_widget("w1", Some("error"), "error", "Sito giù", None); // still down: nothing new
        on_widget("w2", None, "warn", "primo controllo", None); // first result: no fanfare
        on_widget("z", Some("ok"), "ok", "", Some("Nuovo ticket #12"));
        let q = WIDGET_EVENTS.lock().unwrap().clone();
        assert_eq!(q.len(), 2);
        assert_eq!(q[0].1, "problem");
        assert_eq!(q[1], ("z".into(), "event".into(), "Nuovo ticket #12".into()));
    }
}
