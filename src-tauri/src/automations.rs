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
// island shows with Esegui as always, and "Chiedi alla chat" actions, which open
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
use crate::i18n::{t, tf};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
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

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
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
    /// Fingerprint of the habit proposal it came from (habits.rs), "" otherwise.
    #[serde(skip_serializing_if = "String::is_empty")]
    pub origin: String,
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
                .ok_or(t("azione rapida non trovata (eliminata?)"))?;
            let get = |k: &str| a.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
            let name = get("name");
            match get("kind").as_str() {
                "url" => {
                    crate::open_url_now(&get("target"));
                    Ok(tf("aperto «{name}»", &[("name", &name)]))
                }
                "app" => crate::actions::open_app(&get("target"), &get("args")).map(|_| tf("avviato «{name}»", &[("name", &name)])),
                "script" if !a.get("confirm").and_then(Value::as_bool).unwrap_or(false) => {
                    let run_id = format!("auto-{}", now_ms());
                    let r = crate::actions::run_script(&run_id, &get("shell"), &get("script")).await?;
                    if r.timed_out {
                        return Err(tf("«{name}» interrotto: tempo scaduto", &[("name", &name)]));
                    }
                    let first = r.output.lines().map(str::trim).find(|l| !l.is_empty()).unwrap_or("").to_string();
                    match r.code {
                        Some(0) | None => Ok(tf("«{name}» eseguito", &[("name", &name)]) + &if first.is_empty() { String::new() } else { format!(": {first}") }),
                        Some(c) => Err(tf("«{name}» terminato con codice {c}", &[("name", &name), ("c", &c)]) + &if first.is_empty() { String::new() } else { format!(": {first}") }),
                    }
                }
                // A script that wants confirmation, or a question to Claude:
                // the island takes it from here, exactly as from the ⚡ tab.
                _ => {
                    let _ = app.emit_to(WINDOW_LABEL, "automation-action", get("id"));
                    Ok(tf("«{name}» aperto nell'isola", &[("name", &name)]))
                }
            }
        }
        "notice" => {
            let level = match step.level.as_str() {
                "ok" | "warn" | "error" => step.level.as_str(),
                _ => "info",
            };
            notice(app, &step.title, &step.text, level);
            Ok(t("avviso mostrato").into())
        }
        "profile" => {
            crate::activate_profile(app, &step.id, "automazione");
            Ok(t("profilo cambiato").into())
        }
        "app" => {
            if step.target.trim().is_empty() {
                return Err(t("programma non indicato").into());
            }
            crate::actions::open_app(step.target.trim(), &step.args).map(|_| format!("aperto {}", step.target.trim()))
        }
        "url" => {
            let url = step.url.trim();
            if !(url.starts_with("https://") || url.starts_with("http://")) {
                return Err(t("il link deve iniziare con http:// o https://").into());
            }
            crate::open_url_now(url);
            Ok(format!("aperto {url}"))
        }
        other => Err(tf("passo sconosciuto: {other}", &[("other", &other)])),
    }
}

/// Runs every step, in order, logs the outcome and tells the island when
/// asked to (or when something failed).
pub async fn run(app: AppHandle, auto: Automation, cause: String, actions: Vec<Value>) {
    crate::log::line(format!("automation {} ({cause})", auto.name));
    if cause != t("Prova") {
        crate::habits::note("auto", &auto.id);
    }
    let mut done = Vec::new();
    let mut ok = true;
    for step in &auto.steps {
        match run_step(&app, step, &actions).await {
            Ok(t) => done.push(t),
            Err(e) => {
                ok = false;
                done.push(tf("errore: {e}", &[("e", &e)]));
            }
        }
    }
    if auto.steps.is_empty() {
        done.push(t("nessun passo da eseguire").into());
    }
    let detail = done.join(" · ");
    let name = if auto.name.trim().is_empty() { t("Automazione").to_string() } else { auto.name.clone() };
    if auto.notify || !ok {
        notice(&app, &tf("Automazione «{name}»", &[("name", &name)]), &detail, if ok { "ok" } else { "error" });
    }
    push_log(LogEntry { at: now_ms(), name, cause, ok, detail });
    let _ = app.emit_to(crate::SETTINGS_LABEL, "automations-log", ());
}

/// Settings → "Prova ora".
pub fn run_now(app: &AppHandle, id: &str) -> Result<(), String> {
    let (autos, _, actions) = list(app);
    let auto = autos.into_iter().find(|a| a.id == id).ok_or(t("Automazione non trovata (salvata?)"))?;
    let app = app.clone();
    tauri::async_runtime::spawn(run(app, auto, t("Prova").into(), actions));
    Ok(())
}

// ── Made from the chat (agent.rs: create_automation) ─────────────────────────

const TRIGGER_KINDS: &[&str] = &["time", "startup", "unlock", "wifi", "app", "drive", "folder", "integration"];
const STEP_KINDS: &[&str] = &["quick", "notice", "profile", "app", "url"];

/// Checks an automation proposed by Claude against the user's settings and
/// fills the defaults the settings page expects. Err = a message for Claude.
pub fn validate(v: &Value, s: &crate::settings::Settings) -> Result<Automation, String> {
    let mut a: Automation = serde_json::from_value(v.clone()).map_err(|e| tf("Automazione non valida: {e}", &[("e", &e)]))?;
    a.name = a.name.trim().chars().take(80).collect();
    if a.name.is_empty() {
        return Err(t("Serve un nome.").into());
    }
    let t = &mut a.trigger;
    if !TRIGGER_KINDS.contains(&t.kind.as_str()) {
        return Err(format!("trigger.kind deve essere uno di: {}", TRIGGER_KINDS.join(", ")));
    }
    match t.kind.as_str() {
        "time" => {
            let ok = t.time.len() == 5
                && t.time.as_bytes()[2] == b':'
                && t.time[..2].parse::<u8>().is_ok_and(|h| h < 24)
                && t.time[3..].parse::<u8>().is_ok_and(|m| m < 60);
            if !ok {
                return Err("trigger.time deve essere HH:MM (es. 09:00).".into());
            }
            t.days.retain(|d| (1..=7).contains(d));
            t.days.sort();
            t.days.dedup();
        }
        "startup" => t.delay = t.delay.clamp(5, 3600),
        "wifi" if t.ssid.trim().is_empty() => return Err("trigger.ssid: il nome della rete Wi-Fi.".into()),
        "app" if t.exe.trim().is_empty() => return Err("trigger.exe: l'eseguibile, es. teams.exe.".into()),
        "folder" if t.folder.trim().is_empty() => return Err("trigger.folder: il percorso della cartella.".into()),
        "integration" => {
            let known = crate::widgets::all_widgets(s).iter().any(|w| w.id == t.source);
            if !known {
                return Err("trigger.source: l'id di un'integrazione-controllo accesa o di un widget (vedi list_status).".into());
            }
            if !["problem", "event", "any"].contains(&t.when.as_str()) {
                t.when = "problem".into();
            }
        }
        _ => {}
    }
    if t.when.is_empty() {
        t.when = "problem".into();
    }
    if t.time.is_empty() {
        t.time = "09:00".into();
    }
    if t.delay == 0 {
        t.delay = 30;
    }
    if !a.profile.is_empty() && !s.profiles.iter().any(|p| p.id == a.profile) {
        return Err("profile: l'id di un profilo (vedi list_profiles), oppure vuoto.".into());
    }
    if a.steps.is_empty() {
        return Err("Serve almeno un passo in steps.".into());
    }
    if a.steps.len() > 10 {
        return Err("Al massimo 10 passi.".into());
    }
    let mut actions = s.actions.clone();
    for p in &s.profiles {
        if let Some(Value::Array(x)) = p.values.get("actions") {
            actions.extend(x.iter().cloned());
        }
    }
    for st in &mut a.steps {
        if !STEP_KINDS.contains(&st.kind.as_str()) {
            return Err(format!("steps[].kind deve essere uno di: {}", STEP_KINDS.join(", ")));
        }
        match st.kind.as_str() {
            "quick" if !actions.iter().any(|x| x.get("id").and_then(Value::as_str) == Some(st.id.as_str())) => {
                return Err(format!("Nessuna azione rapida con id «{}» (vedi list_quick_actions).", st.id));
            }
            "profile" if !s.profiles.iter().any(|p| p.id == st.id) => {
                return Err(format!("Nessun profilo con id «{}» (vedi list_profiles).", st.id));
            }
            "notice" if st.title.trim().is_empty() && st.text.trim().is_empty() => {
                return Err("Un avviso ha bisogno almeno di un titolo.".into());
            }
            "app" if st.target.trim().is_empty() => return Err("steps[].target: il programma o la cartella da aprire.".into()),
            "url" if !(st.url.starts_with("https://") || st.url.starts_with("http://")) => {
                return Err("steps[].url deve iniziare con http:// o https://.".into());
            }
            _ => {}
        }
        if st.level.is_empty() {
            st.level = "info".into();
        }
    }
    a.id = format!("a{}", now_ms());
    a.enabled = true;
    a.origin.clear();
    Ok(a)
}

/// One line per automation for the chat: "Mattina (accesa): alle 09:00 L-V → …".
pub fn describe(a: &Automation, s: &crate::settings::Settings) -> String {
    let t = &a.trigger;
    let days = |d: &[u8]| {
        if d.is_empty() || d.len() == 7 {
            "ogni giorno".to_string()
        } else {
            d.iter().map(|x| ["", "lun", "mar", "mer", "gio", "ven", "sab", "dom"][*x as usize]).collect::<Vec<_>>().join(", ")
        }
    };
    let when = match t.kind.as_str() {
        "time" => format!("alle {} ({})", t.time, days(&t.days)),
        "startup" => format!("{} s dopo l'avvio", t.delay),
        "unlock" => "allo sblocco del PC".into(),
        "wifi" => format!("in rete Wi-Fi {}", t.ssid),
        "app" => format!("quando parte {}", t.exe),
        "drive" => "quando si collega una chiavetta o un disco".into(),
        "folder" => format!("nuovo file in {}", t.folder),
        "integration" => format!("{} da {}", if t.when == "event" { "novità" } else { "problema" }, t.source),
        k => k.to_string(),
    };
    let steps: Vec<String> = a.steps.iter().map(|st| match st.kind.as_str() {
        "quick" => format!("azione rapida {}", st.id),
        "notice" => format!("avviso «{}»", st.title),
        "profile" => format!("profilo {}", s.profiles.iter().find(|p| p.id == st.id).map(|p| p.name.as_str()).unwrap_or(&st.id)),
        "app" => format!("apri {}", st.target),
        "url" => format!("apri {}", st.url),
        k => k.to_string(),
    }).collect();
    format!(
        "{} [id {}] ({}){}: {} → {}",
        a.name,
        a.id,
        if a.enabled { "accesa" } else { "spenta" },
        if a.profile.is_empty() { String::new() } else { format!(", solo nel profilo {}", a.profile) },
        when,
        steps.join(", ")
    )
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
            crate::habits::note("unlock", "");
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
                        fire.push(((*a).clone(), tf("ore {hhmm}", &[("hhmm", &hhmm)])));
                    }
                }
            }

            // EasyIsland started (with the PC, when it starts with Windows).
            for a in on.iter().filter(|a| a.trigger.kind == "startup") {
                if !fired_startup.contains(&a.id) && started.elapsed() >= Duration::from_secs(a.trigger.delay.max(5)) {
                    fired_startup.insert(a.id.clone());
                    fire.push(((*a).clone(), t("avvio").into()));
                }
            }

            if unlocked {
                for a in on.iter().filter(|a| a.trigger.kind == "unlock") {
                    fire.push(((*a).clone(), t("PC sbloccato").into()));
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
                                    fire.push(((*a).clone(), tf("rete {name}", &[("name", &name)])));
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
                            fire.push(((*a).clone(), tf("avviato {exe}", &[("exe", &exe)])));
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
                            fire.push(((*a).clone(), tf("unità {letters}", &[("letters", &letters)])));
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
                                fire.push(((*a).clone(), tf("nuovo file {what}", &[("what", &what)])));

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
    fn proposals_from_the_chat_are_checked() {
        let s = crate::settings::Settings::default();
        let ok = validate(&json!({
            "name": " Mattina ",
            "trigger": { "kind": "time", "time": "08:30", "days": [5, 1, 1, 9] },
            "steps": [{ "kind": "url", "url": "https://example.com" }, { "kind": "notice", "title": "Ciao" }]
        }), &s).unwrap();
        assert_eq!(ok.name, "Mattina");
        assert_eq!(ok.trigger.days, vec![1, 5]);
        assert!(ok.enabled && ok.id.starts_with('a'));
        assert_eq!(ok.steps[1].level, "info");
        assert!(describe(&ok, &s).contains("alle 08:30"));

        let bad = |v: Value| validate(&v, &s).is_err();
        assert!(bad(json!({ "name": "x", "trigger": { "kind": "time", "time": "25:00" }, "steps": [{ "kind": "notice", "title": "a" }] })));
        assert!(bad(json!({ "name": "x", "trigger": { "kind": "boom" }, "steps": [{ "kind": "notice", "title": "a" }] })));
        assert!(bad(json!({ "name": "x", "trigger": { "kind": "unlock" }, "steps": [] })));
        assert!(bad(json!({ "name": "x", "trigger": { "kind": "unlock" }, "steps": [{ "kind": "url", "url": "file:///c:/" }] })));
        assert!(bad(json!({ "name": "x", "trigger": { "kind": "unlock" }, "steps": [{ "kind": "quick", "id": "nope" }] })));
        assert!(bad(json!({ "name": "x", "trigger": { "kind": "unlock" }, "steps": [{ "kind": "script", "id": "rm" }] })));
        assert!(bad(json!({ "name": "", "trigger": { "kind": "unlock" }, "steps": [{ "kind": "notice", "title": "a" }] })));
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
