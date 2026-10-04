// Habits → proposed automations. Off until the user switches it on
// (Impostazioni → Automazioni → "Proponimi automazioni dalle mie abitudini").
//
// What is recorded, locally only, in %LOCALAPPDATA%\EasyIsland\habits.jsonl:
// a program coming to the front for the first time in two hours (name and
// path of the executable — never window titles or content), EasyIsland
// starting, the PC being unlocked, the Wi-Fi network changing, a drive being
// plugged in, a quick action used, a profile chosen by hand. 45 days are kept;
// "Cancella lo storico" deletes the file.
//
// The analysis is plain counting, no AI: a program opened at about the same
// time on most days, a program opened right after the PC starts, a profile
// chosen after joining a network, a quick action used after plugging in a
// drive. A pattern becomes a proposal only above a threshold, never when an
// automation already does the same, never when it was refused ("No, mai",
// kept in the settings and in the backup, and can be undone), and not before
// a snooze ends ("Non ora", 30 days). At most one proposal a day reaches the
// island; the rest wait in the settings page.

use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

const KEEP_DAYS: u64 = 45;
/// Days looked at to find a habit.
const WINDOW_DAYS: u64 = 21;
const SNOOZE_DAYS: u64 = 30;
/// A program counts as "opened" again only after this long out of the front.
const REOPEN_AFTER: Duration = Duration::from_secs(2 * 3600);

/// Programs that are part of Windows or of EasyIsland itself.
const IGNORED: &[&str] = &[
    "explorer.exe", "easyisland.exe", "searchhost.exe", "searchapp.exe", "startmenuexperiencehost.exe",
    "shellexperiencehost.exe", "lockapp.exe", "applicationframehost.exe", "textinputhost.exe",
    "systemsettings.exe", "taskmgr.exe", "rundll32.exe", "consent.exe", "logonui.exe", "dwm.exe",
    "openwith.exe", "pickerhost.exe", "credentialuibroker.exe", "sihost.exe", "ctfmon.exe",
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Event {
    /// ms since 1970.
    pub t: u64,
    /// app | start | unlock | wifi | drive | quick | profile
    pub k: String,
    /// exe name, network, drive letter, action id, profile id.
    #[serde(default)]
    pub v: String,
    /// app: full path of the executable.
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub p: String,
    /// Local date "YYYY-MM-DD", weekday 1–7, minutes since midnight.
    pub y: String,
    pub d: u8,
    pub m: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion {
    /// Stable fingerprint: the same habit always gives the same one.
    pub fp: String,
    pub title: String,
    pub text: String,
    /// The automation to create (automations.rs shape).
    pub automation: Value,
}

static APP: OnceLock<AppHandle> = OnceLock::new();
static ENABLED: AtomicBool = AtomicBool::new(false);
static SEEN: Mutex<Option<HashMap<String, Instant>>> = Mutex::new(None);
static FILE_LOCK: Mutex<()> = Mutex::new(());
/// Current proposals (refused and snoozed ones left out).
static PENDING: Mutex<Vec<Suggestion>> = Mutex::new(Vec::new());
/// The day a proposal last reached the island.
static OFFERED_ON: Mutex<String> = Mutex::new(String::new());

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn path() -> std::path::PathBuf {
    crate::settings::local_dir().join("habits.jsonl")
}

fn local_now() -> (String, u8, u32) {
    let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    let day = if t.wDayOfWeek == 0 { 7 } else { t.wDayOfWeek as u8 };
    (format!("{:04}-{:02}-{:02}", t.wYear, t.wMonth, t.wDay), day, t.wHour as u32 * 60 + t.wMinute as u32)
}

/// Follows the setting; called at start and after every save.
pub fn set_enabled(on: bool) {
    ENABLED.store(on, Ordering::Relaxed);
    if !on {
        PENDING.lock().unwrap().clear();
    }
}

fn record(kind: &str, value: &str, exe_path: &str) {
    if !ENABLED.load(Ordering::Relaxed) || crate::integrations::PAUSED.load(Ordering::Relaxed) {
        return;
    }
    let (y, d, m) = local_now();
    let e = Event { t: now_ms(), k: kind.into(), v: value.into(), p: exe_path.into(), y, d, m };
    let _guard = FILE_LOCK.lock().unwrap();
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(path()) {
        let _ = writeln!(f, "{}", serde_json::to_string(&e).unwrap_or_default());
    }
}

/// context.rs: a window came to the front. Only the first time in two hours
/// counts, so switching back and forth is not "opening" it again.
pub fn note_app(exe: &str, exe_path: &str) {
    if !ENABLED.load(Ordering::Relaxed) || IGNORED.contains(&exe) {
        return;
    }
    {
        let mut seen = SEEN.lock().unwrap();
        let map = seen.get_or_insert_with(HashMap::new);
        if map.get(exe).is_some_and(|t| t.elapsed() < REOPEN_AFTER) {
            map.insert(exe.to_string(), Instant::now());
            return;
        }
        map.insert(exe.to_string(), Instant::now());
    }
    record("app", exe, exe_path);
}

pub fn note(kind: &str, value: &str) {
    record(kind, value, "");
}

fn load() -> Vec<Event> {
    let _guard = FILE_LOCK.lock().unwrap();
    let Ok(text) = std::fs::read_to_string(path()) else { return Vec::new() };
    text.lines().filter_map(|l| serde_json::from_str(l).ok()).collect()
}

/// Drops what is older than KEEP_DAYS.
fn prune(events: &[Event]) {
    let cutoff = now_ms().saturating_sub(KEEP_DAYS * 86_400_000);
    if events.first().is_none_or(|e| e.t >= cutoff) {
        return;
    }
    let kept: String = events
        .iter()
        .filter(|e| e.t >= cutoff)
        .map(|e| format!("{}\n", serde_json::to_string(e).unwrap_or_default()))
        .collect();
    let _guard = FILE_LOCK.lock().unwrap();
    let _ = std::fs::write(path(), kept);
}

/// "Cancella lo storico".
pub fn clear() {
    let _guard = FILE_LOCK.lock().unwrap();
    let _ = std::fs::remove_file(path());
    SEEN.lock().unwrap().take();
    PENDING.lock().unwrap().clear();
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    pub events: usize,
    pub days: usize,
    pub since: Option<u64>,
}

pub fn stats() -> Stats {
    let ev = load();
    let days: HashSet<&str> = ev.iter().map(|e| e.y.as_str()).collect();
    Stats { events: ev.len(), days: days.len(), since: ev.first().map(|e| e.t) }
}

// ── Analysis (pure) ──────────────────────────────────────────────────────────

fn hhmm(m: u32) -> String {
    format!("{:02}:{:02}", m / 60, m % 60)
}

fn pretty_exe(exe: &str) -> String {
    let base = exe.trim_end_matches(".exe");
    let mut c = base.chars();
    c.next().map(|f| f.to_uppercase().collect::<String>() + c.as_str()).unwrap_or_default()
}

fn median(v: &mut [u32]) -> u32 {
    v.sort_unstable();
    v[v.len() / 2]
}

/// Facts about the user's settings the analysis needs.
pub struct Context<'a> {
    /// (trigger kind, trigger value, step value) of the existing automations,
    /// e.g. ("time", "", "c:\\…\\outlook.exe"), ("wifi", "ufficio", "lavoro").
    pub existing: Vec<(String, String, String)>,
    pub profile_name: &'a dyn Fn(&str) -> Option<String>,
    pub action_name: &'a dyn Fn(&str) -> Option<String>,
}

/// The habits found in `events` (newest last), up to `now_ms`.
pub fn analyse(events: &[Event], now: u64, ctx: &Context) -> Vec<Suggestion> {
    let since = now.saturating_sub(WINDOW_DAYS * 86_400_000);
    let ev: Vec<&Event> = events.iter().filter(|e| e.t >= since).collect();
    let mut out = Vec::new();
    let exists = |kind: &str, trig: &str, step: &str| {
        ctx.existing.iter().any(|(k, t, s)| k == kind && (t.is_empty() || t.eq_ignore_ascii_case(trig)) && s.eq_ignore_ascii_case(step))
    };

    // Days the PC was used at all, split into workdays and weekend.
    let mut active: HashMap<&str, u8> = HashMap::new();
    for e in &ev {
        active.insert(&e.y, e.d);
    }
    let workdays = active.values().filter(|d| **d <= 5).count();
    let all_days = active.len();

    // 1. A program first opened at about the same time on most days.
    let mut first: HashMap<&str, HashMap<&str, &Event>> = HashMap::new();
    for e in ev.iter().filter(|e| e.k == "app") {
        first.entry(&e.v).or_default().entry(&e.y).or_insert(e);
    }
    for (exe, by_day) in &first {
        let mut times: Vec<u32> = by_day.values().map(|e| e.m).collect();
        if times.len() < 5 {
            continue;
        }
        let med = median(&mut times);
        let near: Vec<&&Event> = by_day.values().filter(|e| e.m.abs_diff(med) <= 30).collect();
        let weekdays_only = near.iter().all(|e| e.d <= 5);
        let base = if weekdays_only { workdays } else { all_days };
        if near.len() < 5 || base == 0 || (near.len() as f64) < 0.6 * base as f64 {
            continue;
        }
        // A couple of minutes before the usual time, on a 5-minute step.
        let at = (med.saturating_sub(5) / 5) * 5;
        let exe_path = near.iter().map(|e| e.p.as_str()).find(|p| !p.is_empty()).unwrap_or(exe).to_string();
        if exists("time", "", &exe_path) || exists("time", "", exe) {
            continue;
        }
        let days: Vec<u8> = if weekdays_only { vec![1, 2, 3, 4, 5] } else { Vec::new() };
        let slot = (at / 30) * 30;
        let name = pretty_exe(exe);
        out.push(Suggestion {
            fp: format!("time|{exe}|{}|{}", if weekdays_only { "wd" } else { "all" }, hhmm(slot)),
            title: format!("Apro {name} alle {}?", hhmm(at)),
            text: format!(
                "Negli ultimi {} giorni hai aperto {name} verso le {} in {} giorni su {}{}.",
                WINDOW_DAYS, hhmm(med), near.len(), base, if weekdays_only { " lavorativi" } else { "" }
            ),
            automation: json!({
                "name": format!("Apri {name} alle {}", hhmm(at)),
                "trigger": { "kind": "time", "time": hhmm(at), "days": days },
                "steps": [{ "kind": "app", "target": exe_path }],
            }),
        });
    }

    // 2. A program opened within 10 minutes of the PC starting.
    let starts: Vec<&&Event> = ev.iter().filter(|e| e.k == "start").collect();
    if starts.len() >= 4 {
        let mut after: HashMap<&str, (usize, String)> = HashMap::new();
        for s in &starts {
            let mut seen = HashSet::new();
            for e in ev.iter().filter(|e| e.k == "app" && e.t >= s.t && e.t <= s.t + 600_000) {
                if seen.insert(e.v.as_str()) {
                    let entry = after.entry(&e.v).or_insert((0, String::new()));
                    entry.0 += 1;
                    if entry.1.is_empty() {
                        entry.1 = e.p.clone();
                    }
                }
            }
        }
        for (exe, (n, p)) in after {
            if n < 4 || (n as f64) < 0.6 * starts.len() as f64 {
                continue;
            }
            let target = if p.is_empty() { exe.to_string() } else { p };
            if exists("startup", "", &target) || exists("startup", "", exe) {
                continue;
            }
            // Already proposed by time? Opening at start is the better fit only
            // when the time varies; keep both, the fingerprints differ.
            let name = pretty_exe(exe);
            out.push(Suggestion {
                fp: format!("startup|{exe}"),
                title: format!("Apro {name} quando accendi il PC?"),
                text: format!("Le ultime {} volte che hai acceso il PC, in {n} hai aperto {name} subito dopo.", starts.len()),
                automation: json!({
                    "name": format!("Apri {name} all'avvio"),
                    "trigger": { "kind": "startup", "delay": 30 },
                    "steps": [{ "kind": "app", "target": target }],
                }),
            });
        }
    }

    // 3. A profile chosen by hand after joining a network.
    let mut by_net: HashMap<&str, (usize, HashMap<&str, usize>)> = HashMap::new();
    for w in ev.iter().filter(|e| e.k == "wifi" && !e.v.is_empty()) {
        let entry = by_net.entry(&w.v).or_default();
        entry.0 += 1;
        if let Some(p) = ev.iter().find(|e| e.k == "profile" && e.t >= w.t && e.t <= w.t + 600_000) {
            *entry.1.entry(&p.v).or_default() += 1;
        }
    }
    for (net, (joins, profiles)) in by_net {
        let Some((profile, n)) = profiles.into_iter().max_by_key(|(_, n)| *n) else { continue };
        if n < 3 || (n as f64) < 0.6 * joins as f64 || exists("wifi", net, profile) {
            continue;
        }
        let pname = (ctx.profile_name)(profile).unwrap_or_else(|| profile.to_string());
        out.push(Suggestion {
            fp: format!("wifi|{}|{profile}", net.to_lowercase()),
            title: format!("Passo al profilo {pname} sulla rete {net}?"),
            text: format!("Quando ti colleghi a {net} passi quasi sempre a {pname} ({n} volte su {joins})."),
            automation: json!({
                "name": format!("{pname} su {net}"),
                "trigger": { "kind": "wifi", "ssid": net },
                "steps": [{ "kind": "profile", "id": profile }],
            }),
        });
    }

    // 4. A quick action used after plugging in a drive.
    let plugs: Vec<&&Event> = ev.iter().filter(|e| e.k == "drive").collect();
    if plugs.len() >= 3 {
        let mut used: HashMap<&str, usize> = HashMap::new();
        for d in &plugs {
            if let Some(q) = ev.iter().find(|e| e.k == "quick" && e.t >= d.t && e.t <= d.t + 600_000) {
                *used.entry(&q.v).or_default() += 1;
            }
        }
        if let Some((id, n)) = used.into_iter().max_by_key(|(_, n)| *n) {
            if n >= 3 && (n as f64) >= 0.6 * plugs.len() as f64 && !exists("drive", "", id) {
                if let Some(aname) = (ctx.action_name)(id) {
                    out.push(Suggestion {
                        fp: format!("drive|{id}"),
                        title: format!("Eseguo «{aname}» quando colleghi una chiavetta?"),
                        text: format!("Dopo aver collegato una chiavetta o un disco hai usato «{aname}» {n} volte su {}.", plugs.len()),
                        automation: json!({
                            "name": format!("{aname} con la chiavetta"),
                            "trigger": { "kind": "drive" },
                            "steps": [{ "kind": "quick", "id": id }],
                        }),
                    });
                }
            }
        }
    }

    out.sort_by(|a, b| a.fp.cmp(&b.fp));
    out
}

// ── With the user's settings ─────────────────────────────────────────────────

fn existing(s: &crate::settings::Settings) -> Vec<(String, String, String)> {
    s.automations
        .iter()
        .filter_map(|v| serde_json::from_value::<crate::automations::Automation>(v.clone()).ok())
        .flat_map(|a| {
            let trig = match a.trigger.kind.as_str() {
                "wifi" => a.trigger.ssid.clone(),
                _ => String::new(),
            };
            a.steps
                .iter()
                .map(|st| {
                    let v = match st.kind.as_str() {
                        "app" => st.target.clone(),
                        _ => st.id.clone(),
                    };
                    (a.trigger.kind.clone(), trig.clone(), v)
                })
                .collect::<Vec<_>>()
        })
        .collect()
}

/// Runs the analysis and keeps what may still be proposed.
pub fn refresh(app: &AppHandle) -> Vec<Suggestion> {
    let Some(shared) = app.try_state::<crate::Shared>() else { return Vec::new() };
    let s = shared.settings.lock().unwrap().clone();
    if !s.habits_enabled {
        PENDING.lock().unwrap().clear();
        return Vec::new();
    }
    let events = load();
    prune(&events);
    let profile_name = |id: &str| s.profiles.iter().find(|p| p.id == id).map(|p| p.name.clone());
    let mut actions = s.actions.clone();
    for p in &s.profiles {
        if let Some(Value::Array(a)) = p.values.get("actions") {
            actions.extend(a.iter().cloned());
        }
    }
    let action_name = |id: &str| {
        actions
            .iter()
            .find(|a| a.get("id").and_then(Value::as_str) == Some(id))
            .and_then(|a| a.get("name").and_then(Value::as_str).map(str::to_string))
    };
    let ctx = Context { existing: existing(&s), profile_name: &profile_name, action_name: &action_name };
    let now = now_ms();
    let dismissed: HashSet<&str> = s
        .suggestions_dismissed
        .iter()
        .filter_map(|d| d.get("fp").and_then(Value::as_str))
        .collect();
    let list: Vec<Suggestion> = analyse(&events, now, &ctx)
        .into_iter()
        .filter(|g| !dismissed.contains(g.fp.as_str()))
        .filter(|g| s.suggestions_snoozed.get(&g.fp).and_then(Value::as_u64).is_none_or(|until| now >= until))
        .collect();
    *PENDING.lock().unwrap() = list.clone();
    list
}

/// Crea / Non ora / No, mai — from the island or the settings.
pub fn answer(app: &AppHandle, fp: &str, choice: &str) -> Result<String, String> {
    let shared = app.try_state::<crate::Shared>().ok_or("EasyIsland non è pronto.")?;
    let sugg = PENDING.lock().unwrap().iter().find(|g| g.fp == fp).cloned();
    let dismissed = {
        let s = shared.settings.lock().unwrap();
        s.suggestions_dismissed.iter().find(|d| d.get("fp").and_then(Value::as_str) == Some(fp)).cloned()
    };
    let result = match choice {
        "create" => {
            // A refused proposal can be created later from the settings.
            let automation = sugg
                .as_ref()
                .map(|g| g.automation.clone())
                .or_else(|| dismissed.as_ref().and_then(|d| d.get("automation").cloned()))
                .ok_or("Proposta non più disponibile.")?;
            let s = shared.settings.lock().unwrap().clone();
            let auto = crate::automations::validate(&automation, &s)?;
            let value = serde_json::to_value(&auto).map_err(|e| e.to_string())?;
            crate::agent::update_settings(app, |s| {
                s.automations.push(value);
                s.suggestions_dismissed.retain(|d| d.get("fp").and_then(Value::as_str) != Some(fp));
                s.suggestions_snoozed.remove(fp);
            })?;
            Ok(format!("Creata l'automazione «{}».", auto.name))
        }
        "snooze" => {
            let until = now_ms() + SNOOZE_DAYS * 86_400_000;
            crate::agent::update_settings(app, |s| {
                s.suggestions_snoozed.insert(fp.to_string(), json!(until));
            })?;
            Ok("Te la ripropongo più avanti, se l'abitudine continua.".into())
        }
        "dismiss" => {
            let g = sugg.ok_or("Proposta non più disponibile.")?;
            crate::agent::update_settings(app, |s| {
                s.suggestions_dismissed.retain(|d| d.get("fp").and_then(Value::as_str) != Some(fp));
                s.suggestions_dismissed.push(json!({
                    "fp": g.fp, "title": g.title, "text": g.text, "automation": g.automation, "at": now_ms(),
                }));
            })?;
            Ok("Non te la propongo più. La ritrovi tra le proposte rifiutate.".into())
        }
        // "Togli dai rifiutati": may be proposed again.
        "restore" => {
            crate::agent::update_settings(app, |s| {
                s.suggestions_dismissed.retain(|d| d.get("fp").and_then(Value::as_str) != Some(fp));
            })?;
            Ok("Potrà essere riproposta.".into())
        }
        _ => Err("Scelta sconosciuta.".into()),
    };
    PENDING.lock().unwrap().retain(|g| g.fp != fp);
    let _ = app.emit_to(crate::SETTINGS_LABEL, "habits-changed", ());
    result
}

/// At most one proposal a day reaches the island.
fn offer(app: &AppHandle) {
    let (today, _, minutes) = local_now();
    // Not in the first minutes of the day at the PC, not at night.
    if !(9 * 60..20 * 60).contains(&minutes) {
        return;
    }
    let mut last = OFFERED_ON.lock().unwrap();
    if *last == today {
        return;
    }
    let Some(g) = PENDING.lock().unwrap().first().cloned() else { return };
    *last = today;
    let _ = app.emit_to(crate::island::WINDOW_LABEL, "habit-suggestion", g);
}

/// Recording of what needs a look (drives, Wi-Fi) and the periodic analysis.
pub fn spawn(app: AppHandle) {
    let _ = APP.set(app.clone());
    if let Some(s) = app.try_state::<crate::Shared>() {
        set_enabled(s.settings.lock().unwrap().habits_enabled);
    }
    note("start", "");
    std::thread::spawn(move || {
        let mut drives: Option<u32> = None;
        let mut ssid: Option<Option<String>> = None;
        let mut last_ssid = Instant::now() - Duration::from_secs(3600);
        let mut last_analysis = Instant::now() - Duration::from_secs(6 * 3600 - 600);
        loop {
            std::thread::sleep(Duration::from_secs(10));
            if !ENABLED.load(Ordering::Relaxed) {
                drives = None;
                ssid = None;
                continue;
            }
            let now = unsafe { windows::Win32::Storage::FileSystem::GetLogicalDrives() };
            if let Some(prev) = drives {
                let new = now & !prev;
                for i in (0..26).filter(|i| new & (1 << i) != 0) {
                    note("drive", &format!("{}:", (b'A' + i as u8) as char));
                }
            }
            drives = Some(now);
            if last_ssid.elapsed() >= Duration::from_secs(600) {
                last_ssid = Instant::now();
                let cur = crate::profiles::current_ssid();
                if ssid.as_ref().is_some_and(|p| *p != cur) {
                    if let Some(n) = &cur {
                        note("wifi", n);
                    }
                }
                ssid = Some(cur);
            }
            if last_analysis.elapsed() >= Duration::from_secs(6 * 3600) {
                last_analysis = Instant::now();
                refresh(&app);
            }
            offer(&app);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    const DAY: u64 = 86_400_000;

    fn ev(day: u64, d: u8, m: u32, k: &str, v: &str) -> Event {
        Event {
            t: day * DAY + m as u64 * 60_000,
            k: k.into(),
            v: v.into(),
            p: if k == "app" { format!("C:\\Apps\\{v}") } else { String::new() },
            y: format!("2026-09-{:02}", day % 30 + 1),
            d,
            m,
        }
    }

    fn ctx_none() -> (Box<dyn Fn(&str) -> Option<String>>, Box<dyn Fn(&str) -> Option<String>>) {
        (Box::new(|id: &str| Some(format!("P-{id}"))), Box::new(|id: &str| Some(format!("A-{id}"))))
    }

    #[test]
    fn finds_a_weekday_morning_habit() {
        let mut events = Vec::new();
        // Three weeks: Outlook at ~8:50 on workdays, something random at weekends.
        for day in 0..21u64 {
            let d = (day % 7 + 1) as u8;
            if d <= 5 {
                events.push(ev(day, d, 530 + (day % 3) as u32 * 5, "app", "outlook.exe"));
                events.push(ev(day, d, 600 + (day * 37 % 200) as u32, "app", "excel.exe"));
            } else {
                events.push(ev(day, d, 700, "app", "steam.exe"));
            }
        }
        let (p, a) = ctx_none();
        let ctx = Context { existing: Vec::new(), profile_name: &*p, action_name: &*a };
        let out = analyse(&events, 21 * DAY, &ctx);
        let outlook = out.iter().find(|g| g.fp.starts_with("time|outlook.exe")).expect("outlook proposed");
        assert_eq!(outlook.automation["trigger"]["days"], json!([1, 2, 3, 4, 5]));
        assert_eq!(outlook.automation["steps"][0]["target"], "C:\\Apps\\outlook.exe");
        // Excel at random times and Steam on 6 weekend days out of 21: nothing.
        assert!(!out.iter().any(|g| g.fp.contains("excel")));
        assert!(!out.iter().any(|g| g.fp.contains("steam")));

        // Same fingerprint every time, and nothing when an automation already does it.
        assert_eq!(analyse(&events, 21 * DAY, &ctx)[0].fp, out[0].fp);
        let ctx2 = Context {
            existing: vec![("time".into(), String::new(), "C:\\Apps\\outlook.exe".into())],
            profile_name: &*p,
            action_name: &*a,
        };
        assert!(!analyse(&events, 21 * DAY, &ctx2).iter().any(|g| g.fp.contains("outlook")));
    }

    #[test]
    fn startup_network_and_drive_habits() {
        let mut events = Vec::new();
        for day in 0..6u64 {
            events.push(ev(day, 1, 480, "start", ""));
            events.push(ev(day, 1, 482, "app", "teams.exe"));
            events.push(ev(day, 1, 485, "wifi", "Ufficio"));
            events.push(ev(day, 1, 487, "profile", "lavoro"));
            if day < 4 {
                events.push(ev(day, 1, 700, "drive", "E:"));
                events.push(ev(day, 1, 702, "quick", "backup"));
            }
        }
        let (p, a) = ctx_none();
        let ctx = Context { existing: Vec::new(), profile_name: &*p, action_name: &*a };
        let fps: Vec<String> = analyse(&events, 6 * DAY, &ctx).into_iter().map(|g| g.fp).collect();
        assert!(fps.contains(&"startup|teams.exe".to_string()));
        assert!(fps.contains(&"wifi|ufficio|lavoro".to_string()));
        assert!(fps.contains(&"drive|backup".to_string()));
    }

    #[test]
    fn too_little_data_proposes_nothing() {
        let events: Vec<Event> = (0..3u64).map(|d| ev(d, 1, 540, "app", "outlook.exe")).collect();
        let (p, a) = ctx_none();
        let ctx = Context { existing: Vec::new(), profile_name: &*p, action_name: &*a };
        assert!(analyse(&events, 3 * DAY, &ctx).is_empty());
    }
}
