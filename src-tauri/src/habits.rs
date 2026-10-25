// Habits → proposed automations. Off until the user switches it on
// (Impostazioni → Flussi → "Proponimi automazioni dalle mie abitudini").
//
// What is recorded, locally only, in %LOCALAPPDATA%\EasyIsland\habits.jsonl:
// a program coming to the front for the first time in two hours (name and
// path of the executable — never window titles or content), EasyIsland
// starting, the PC being unlocked, the Wi-Fi network changing, a drive being
// plugged in, a quick action used, a profile chosen by hand. 45 days are kept;
// "Cancella lo storico" deletes the file.
//
// The analysis is plain counting, no AI, and proposes only whole routines,
// never "open one program at a time" (Edoardo, 24 Oct 2026): the programs
// opened together at the start of the day or of a slot (with the profile and,
// in the morning, the day's summary), a profile with its programs after
// joining a network, a group of programs that follow another one, a quick
// action used after plugging in a drive. A pattern becomes a proposal only above a threshold, never when an
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
use crate::i18n::{t, tf};

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
    /// The automation to create (automations.rs shape), or {"disable": id}
    /// for "this automation is not useful any more".
    pub automation: Value,
    /// Label of the button that accepts: "Crea" or "Spegni".
    pub accept: String,
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

/// Follows the settings; called at start and after every save.
pub fn apply(s: &crate::settings::Settings) {
    ENABLED.store(s.habits_enabled, Ordering::Relaxed);
    *EXCLUDED.lock().unwrap() = excluded(s);
    if !s.habits_enabled {
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
    if !ENABLED.load(Ordering::Relaxed) || IGNORED.contains(&exe) || EXCLUDED.lock().unwrap().iter().any(|x| x == exe) {
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
    let _ = crate::settings::write_atomic(&path(), kept.as_bytes());
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
    /// Automations created from a proposal and still on: (id, name, what they
    /// open — an exe path for "app" steps, a profile id for "profile" steps).
    pub adopted: Vec<(String, String, Vec<(String, String)>)>,
    /// Programs the user asked not to watch (lower-case exe names).
    pub excluded: Vec<String>,
}

/// The habits found in `events` (newest last), up to `now_ms`.
pub fn analyse(events: &[Event], now: u64, ctx: &Context) -> Vec<Suggestion> {
    let since = now.saturating_sub(WINDOW_DAYS * 86_400_000);
    let ev: Vec<&Event> = events
        .iter()
        .filter(|e| e.t >= since && !(e.k == "app" && ctx.excluded.iter().any(|x| x == &e.v)))
        .collect();
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

    // 1. A routine: two or more programs first opened at about the same time
    // on most days (asked by Edoardo on 24 Oct 2026: never "open Chrome at 12",
    // only something complete). One automation for the whole moment: the
    // profile usually chosen then, the programs in their usual order, and in
    // the morning the day's summary from the chat. It starts when the user
    // sits at the PC in that slot (start or unlock), once a day — not at a time
    // the PC may be empty.
    let mut first: HashMap<&str, HashMap<&str, &Event>> = HashMap::new();
    for e in ev.iter().filter(|e| e.k == "app") {
        first.entry(&e.v).or_default().entry(&e.y).or_insert(e);
    }
    // (median minute, exe, path, weekdays only, days it happened)
    let mut usual: Vec<(u32, &str, String, bool, Vec<&str>)> = Vec::new();
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
        let exe_path = near.iter().map(|e| e.p.as_str()).find(|p| !p.is_empty()).unwrap_or(exe).to_string();
        usual.push((med, exe, exe_path, weekdays_only, near.iter().map(|e| e.y.as_str()).collect()));
    }
    usual.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(b.1)));
    // Programs whose usual times are within 45 minutes of the previous one.
    let mut groups: Vec<Vec<&(u32, &str, String, bool, Vec<&str>)>> = Vec::new();
    for u in &usual {
        match groups.last_mut() {
            Some(g) if g.last().is_some_and(|l| u.0.saturating_sub(l.0) <= 45) => g.push(u),
            _ => groups.push(vec![u]),
        }
    }
    for g in groups.iter().filter(|g| g.len() >= 2) {
        let (Some(start), Some(end)) = (g.first(), g.last()) else { continue };
        let targets: Vec<&str> = g.iter().map(|u| u.2.as_str()).collect();
        if targets.iter().all(|t| ctx.existing.iter().any(|(_, _, s)| s.eq_ignore_ascii_case(t))) {
            continue;
        }
        let weekdays_only = g.iter().all(|u| u.3);
        let days: Vec<u8> = if weekdays_only { vec![1, 2, 3, 4, 5] } else { Vec::new() };
        let from = start.0.saturating_sub(60);
        let to = (end.0 + 60).min(23 * 60 + 59);
        let days_seen: HashSet<&str> = g.iter().flat_map(|u| u.4.iter().copied()).collect();
        // Turned on or unlocked? Whichever came first on most of those days.
        let mut by_start = 0;
        for y in &days_seen {
            let first_app = g.iter().filter_map(|u| first.get(u.1).and_then(|d| d.get(y))).map(|e| e.t).min().unwrap_or(0);
            let before = |k: &str| ev.iter().filter(|e| e.k == k && &e.y == y && e.t <= first_app && first_app - e.t <= 1_800_000).map(|e| e.t).max();
            if before("start") >= before("unlock") && before("start").is_some() {
                by_start += 1;
            }
        }
        let trigger = if by_start * 2 > days_seen.len() {
            json!({ "kind": "startup", "delay": 30 })
        } else {
            json!({ "kind": "unlock" })
        };
        // The profile chosen by hand in that slot on most of those days.
        let mut picked: HashMap<&str, usize> = HashMap::new();
        for e in ev.iter().filter(|e| e.k == "profile" && days_seen.contains(e.y.as_str()) && e.m >= from && e.m <= to) {
            *picked.entry(&e.v).or_default() += 1;
        }
        let profile = picked.into_iter().filter(|(_, n)| (*n as f64) >= 0.6 * days_seen.len() as f64).max_by_key(|(_, n)| *n).map(|(p, _)| p);
        let morning = start.0 < 11 * 60;
        let names: Vec<String> = g.iter().map(|u| pretty_exe(u.1)).collect();
        let mut steps = Vec::new();
        let mut lines = Vec::new();
        if let Some(p) = profile {
            steps.push(json!({ "kind": "profile", "id": p }));
            lines.push(tf("passo al profilo {p}", &[("p", &(ctx.profile_name)(p).unwrap_or_else(|| p.to_string()))]));
        }
        for u in g {
            steps.push(json!({ "kind": "app", "target": u.2 }));
        }
        lines.push(tf("apro {list}", &[("list", &names.join(", "))]));
        if morning {
            steps.push(json!({ "kind": "chat", "text": crate::telegram::day_prompt(false) }));
            lines.push(t("ti faccio il punto della giornata (appuntamenti, posta, ticket, attività)").to_string());
        }
        let label = if morning { t("Inizio giornata").to_string() } else { tf("Routine delle {time}", &[("time", &hhmm((start.0 / 30) * 30))]) };
        let when = if trigger["kind"] == "startup" { t("quando accendi il PC") } else { t("quando sblocchi il PC") };
        out.push(Suggestion {
            fp: format!("routine|{}|{}", if weekdays_only { "wd" } else { "all" }, g.iter().map(|u| u.1).collect::<Vec<_>>().join("+")),
            title: tf("Preparo la tua «{label}»?", &[("label", &label)]),
            text: tf(
                "Tra le {from} e le {to} {days}, {when} la prima volta nel giorno: {steps}. Negli ultimi {window} giorni l'hai fatto a mano quasi ogni giorno.",
                &[
                    ("from", &hhmm(from)),
                    ("to", &hhmm(to)),
                    ("days", &if weekdays_only { t("nei giorni lavorativi") } else { t("ogni giorno") }),
                    ("when", &when),
                    ("steps", &lines.join(", ")),
                    ("window", &WINDOW_DAYS),
                ],
            ),
            automation: json!({
                "name": label,
                "trigger": trigger,
                "conditions": [{ "kind": "hours", "from": hhmm(from), "to": hhmm(to), "days": days }],
                "repeat": "day",
                "steps": steps,
            }),
            accept: t("Crea").into(),
        });
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
        // The programs opened within 10 minutes of joining, most times: they come along.
        let mut after: HashMap<&str, (usize, &str)> = HashMap::new();
        for w in ev.iter().filter(|e| e.k == "wifi" && e.v == net) {
            let mut seen = HashSet::new();
            for e in ev.iter().filter(|e| e.k == "app" && e.t >= w.t && e.t <= w.t + 600_000) {
                if seen.insert(e.v.as_str()) {
                    let x = after.entry(&e.v).or_insert((0, &e.p));
                    x.0 += 1;
                }
            }
        }
        let mut apps: Vec<(&str, &str)> = after
            .into_iter()
            .filter(|(_, (k, _))| *k >= 3 && (*k as f64) >= 0.6 * joins as f64)
            .map(|(exe, (_, p))| (exe, if p.is_empty() { exe } else { p }))
            .collect();
        apps.sort();
        let mut steps = vec![json!({ "kind": "profile", "id": profile })];
        steps.extend(apps.iter().map(|(_, p)| json!({ "kind": "app", "target": p })));
        let names: Vec<String> = apps.iter().map(|(exe, _)| pretty_exe(exe)).collect();
        let extra = if names.is_empty() { String::new() } else { tf(" e apro {list}", &[("list", &names.join(", "))]) };
        out.push(Suggestion {
            fp: format!("wifi|{}|{profile}", net.to_lowercase()),
            title: tf("Sulla rete {net} passo al profilo {pname}{extra}?", &[("pname", &pname), ("net", &net), ("extra", &extra)]),
            text: tf("Quando ti colleghi a {net} passi quasi sempre a {pname} ({n} volte su {joins}).", &[("net", &net), ("pname", &pname), ("n", &n), ("joins", &joins)]),
            automation: json!({
                "name": format!("{pname} su {net}"),
                "trigger": { "kind": "wifi", "ssid": net },
                "steps": steps,
            }),
            accept: t("Crea").into(),
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
                        title: tf("Eseguo «{aname}» quando colleghi una chiavetta?", &[("aname", &aname)]),
                        text: tf("Dopo aver collegato una chiavetta o un disco hai usato «{aname}» {n} volte su {total}.", &[("aname", &aname), ("n", &n), ("total", &plugs.len())]),
                        automation: json!({
                            "name": tf("{aname} con la chiavetta", &[("aname", &aname)]),
                            "trigger": { "kind": "drive" },
                            "steps": [{ "kind": "quick", "id": id }],
                        }),
                        accept: t("Crea").into(),
                    });
                }
            }
        }
    }

    // 5. Sequences: after opening X, Y is opened within 5 minutes most times.
    let apps: Vec<&&Event> = ev.iter().filter(|e| e.k == "app").collect();
    let mut opens: HashMap<&str, usize> = HashMap::new();
    let mut follows: HashMap<(&str, &str), (usize, String)> = HashMap::new();
    for (i, x) in apps.iter().enumerate() {
        *opens.entry(&x.v).or_default() += 1;
        let mut seen = HashSet::new();
        for y in apps[i + 1..].iter().take_while(|y| y.t <= x.t + 300_000) {
            if y.v != x.v && seen.insert(y.v.as_str()) {
                let e = follows.entry((&x.v, &y.v)).or_insert((0, String::new()));
                e.0 += 1;
                if e.1.is_empty() {
                    e.1 = y.p.clone();
                }
            }
        }
    }
    // Only a group of two or more programs that follow: "open Y after X"
    // alone is not worth an automation.
    let mut by_first: HashMap<&str, Vec<(&str, String)>> = HashMap::new();
    for ((x, y), (n, p)) in follows {
        let total = opens.get(x).copied().unwrap_or(0);
        if n < 5 || (n as f64) < 0.6 * total as f64 {
            continue;
        }
        let target = if p.is_empty() { y.to_string() } else { p };
        if exists("app", x, &target) || exists("app", x, y) {
            continue;
        }
        by_first.entry(x).or_default().push((y, target));
    }
    let mut firsts: Vec<_> = by_first.into_iter().filter(|(_, f)| f.len() >= 2).collect();
    firsts.sort_by(|a, b| a.0.cmp(b.0));
    for (x, mut ys) in firsts {
        ys.sort();
        let xn = pretty_exe(x);
        let names: Vec<String> = ys.iter().map(|(y, _)| pretty_exe(y)).collect();
        let total = opens.get(x).copied().unwrap_or(0);
        out.push(Suggestion {
            fp: format!("seq|{x}|{}", ys.iter().map(|(y, _)| *y).collect::<Vec<_>>().join("+")),
            title: tf("Quando apri {xn}, preparo anche {list}?", &[("xn", &xn), ("list", &names.join(", "))]),
            text: tf("Dopo aver aperto {xn} apri quasi sempre anche {list} entro pochi minuti (su {total} volte). Una volta al giorno al massimo.", &[("xn", &xn), ("list", &names.join(", ")), ("total", &total)]),
            automation: json!({
                "name": format!("{xn} + {}", names.join(" + ")),
                "trigger": { "kind": "app", "exe": x },
                "repeat": "day",
                "steps": ys.iter().map(|(_, p)| json!({ "kind": "app", "target": p })).collect::<Vec<_>>(),
            }),
            accept: t("Crea").into(),
        });
    }

    // 6. Automations created from a proposal that are no longer used: after
    // most of their last runs the program they open was not used within 30
    // minutes, or another profile was chosen by hand within 10 minutes.
    for (id, name, opens_what) in &ctx.adopted {
        let runs: Vec<&&Event> = ev.iter().filter(|e| e.k == "auto" && &e.v == id).collect();
        if runs.len() < 5 {
            continue;
        }
        let recent = &runs[runs.len().saturating_sub(7)..];
        let unused = recent
            .iter()
            .filter(|r| {
                opens_what.iter().all(|(kind, what)| match kind.as_str() {
                    "app" => {
                        let exe = what.rsplit('\\').next().unwrap_or(what).to_lowercase();
                        !ev.iter().any(|e| e.k == "app" && e.v == exe && e.t >= r.t && e.t <= r.t + 1_800_000)
                    }
                    "profile" => ev.iter().any(|e| e.k == "profile" && &e.v != what && e.t >= r.t && e.t <= r.t + 600_000),
                    _ => false,
                })
            })
            .count();
        if (unused as f64) < 0.8 * recent.len() as f64 {
            continue;
        }
        out.push(Suggestion {
            fp: format!("off|{id}"),
            title: tf("Spengo l'automazione «{name}»?", &[("name", &name)]),
            text: tf("Le ultime {total} volte che è partita sembra che non ti sia servita ({unused} su {total}).", &[("total", &recent.len()), ("unused", &unused)]),
            automation: json!({ "disable": id }),
            accept: t("Spegni").into(),
        });
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
                "app" => a.trigger.exe.trim().to_lowercase(),
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

/// "Programmi da non osservare", as lower-case exe names.
fn excluded(s: &crate::settings::Settings) -> Vec<String> {
    s.habits_excluded
        .iter()
        .map(|x| {
            let mut x = x.trim().to_lowercase();
            if !x.is_empty() && !x.ends_with(".exe") {
                x.push_str(".exe");
            }
            x
        })
        .filter(|x| !x.is_empty())
        .collect()
}

/// Kept in step with the settings by set_enabled.
static EXCLUDED: Mutex<Vec<String>> = Mutex::new(Vec::new());

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
    let adopted = s
        .automations
        .iter()
        .filter_map(|v| serde_json::from_value::<crate::automations::Automation>(v.clone()).ok())
        .filter(|a| a.enabled && !a.origin.is_empty())
        .map(|a| {
            let opens = a
                .steps
                .iter()
                .filter_map(|st| match st.kind.as_str() {
                    "app" => Some(("app".to_string(), st.target.clone())),
                    "profile" => Some(("profile".to_string(), st.id.clone())),
                    _ => None,
                })
                .collect::<Vec<_>>();
            (a.id, a.name, opens)
        })
        .filter(|(_, _, opens)| !opens.is_empty())
        .collect();
    let ctx = Context {
        existing: existing(&s),
        profile_name: &profile_name,
        action_name: &action_name,
        adopted,
        excluded: excluded(&s),
    };
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
    let shared = app.try_state::<crate::Shared>().ok_or(t("EasyIsland non è pronto."))?;
    let sugg = PENDING.lock().unwrap().iter().find(|g| g.fp == fp).cloned();
    let dismissed = {
        let s = shared.settings.lock().unwrap();
        s.suggestions_dismissed.iter().find(|d| d.get("fp").and_then(Value::as_str) == Some(fp)).cloned()
    };
    let result = match choice {
        "create" if sugg.as_ref().and_then(|g| g.automation.get("disable")).is_some() => {
            let id = sugg.as_ref().and_then(|g| g.automation["disable"].as_str()).unwrap_or_default().to_string();
            crate::agent::update_settings(app, |s| {
                for a in s.automations.iter_mut() {
                    if a.get("id").and_then(Value::as_str) == Some(id.as_str()) {
                        a["enabled"] = json!(false);
                    }
                }
            })?;
            Ok(t("Automazione spenta: la riaccendi quando vuoi in Impostazioni → Flussi.").into())
        }
        "create" => {
            // A refused proposal can be created later from the settings.
            let automation = sugg
                .as_ref()
                .map(|g| g.automation.clone())
                .or_else(|| dismissed.as_ref().and_then(|d| d.get("automation").cloned()))
                .ok_or(t("Proposta non più disponibile."))?;
            if let Some(id) = automation.get("disable").and_then(Value::as_str) {
                let id = id.to_string();
                crate::agent::update_settings(app, |s| {
                    for a in s.automations.iter_mut() {
                        if a.get("id").and_then(Value::as_str) == Some(id.as_str()) {
                            a["enabled"] = json!(false);
                        }
                    }
                    s.suggestions_dismissed.retain(|d| d.get("fp").and_then(Value::as_str) != Some(fp));
                })?;
                PENDING.lock().unwrap().retain(|g| g.fp != fp);
                let _ = app.emit_to(crate::SETTINGS_LABEL, "habits-changed", ());
                return Ok(t("Automazione spenta.").into());
            }
            let s = shared.settings.lock().unwrap().clone();
            let mut auto = crate::automations::validate(&automation, &s)?;
            // Remembered, so it can be checked later for still being useful.
            auto.origin = fp.to_string();
            let value = serde_json::to_value(&auto).map_err(|e| e.to_string())?;
            crate::agent::update_settings(app, |s| {
                s.automations.push(value);
                s.suggestions_dismissed.retain(|d| d.get("fp").and_then(Value::as_str) != Some(fp));
                s.suggestions_snoozed.remove(fp);
            })?;
            Ok(tf("Creata l'automazione «{name}».", &[("name", &auto.name)]))
        }
        "snooze" => {
            let until = now_ms() + SNOOZE_DAYS * 86_400_000;
            crate::agent::update_settings(app, |s| {
                s.suggestions_snoozed.insert(fp.to_string(), json!(until));
            })?;
            Ok(t("Te la ripropongo più avanti, se l'abitudine continua.").into())
        }
        "dismiss" => {
            let g = sugg.ok_or(t("Proposta non più disponibile."))?;
            crate::agent::update_settings(app, |s| {
                s.suggestions_dismissed.retain(|d| d.get("fp").and_then(Value::as_str) != Some(fp));
                s.suggestions_dismissed.push(json!({
                    "fp": g.fp, "title": g.title, "text": g.text, "automation": g.automation, "accept": g.accept, "at": now_ms(),
                }));
            })?;
            Ok(t("Non te la propongo più. La ritrovi tra le proposte rifiutate.").into())
        }
        // "Togli dai rifiutati": may be proposed again.
        "restore" => {
            crate::agent::update_settings(app, |s| {
                s.suggestions_dismissed.retain(|d| d.get("fp").and_then(Value::as_str) != Some(fp));
            })?;
            Ok(t("Potrà essere riproposta.").into())
        }
        _ => Err(t("Scelta sconosciuta.").into()),
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
        apply(&s.settings.lock().unwrap());
    }
    note("start", "");
    std::thread::spawn(move || {
        let mut drives: Option<u32> = None;
        let mut ssid: Option<Option<String>> = None;
        // No `Instant::now() - d`: an Instant counts from boot on Windows, so
        // it panics in the first hours after a restart (and panic = "abort").
        let started = Instant::now();
        let mut last_ssid: Option<Instant> = None;
        let mut last_analysis: Option<Instant> = None;
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
            if last_ssid.is_none_or(|t| t.elapsed() >= Duration::from_secs(600)) {
                last_ssid = Some(Instant::now());
                let cur = crate::profiles::current_ssid();
                if ssid.as_ref().is_some_and(|p| *p != cur) {
                    if let Some(n) = &cur {
                        note("wifi", n);
                    }
                }
                ssid = Some(cur);
            }
            // The first analysis 10 minutes after start, then every 6 hours.
            let due = match last_analysis {
                None => started.elapsed() >= Duration::from_secs(600),
                Some(t) => t.elapsed() >= Duration::from_secs(6 * 3600),
            };
            if due {
                last_analysis = Some(Instant::now());
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
    fn one_program_alone_is_never_proposed() {
        let mut events = Vec::new();
        // Three weeks of Chrome at noon: not worth an automation.
        for day in 0..21u64 {
            let d = (day % 7 + 1) as u8;
            events.push(ev(day, d, 720 + (day % 3) as u32 * 5, "app", "chrome.exe"));
        }
        let (p, a) = ctx_none();
        let ctx = Context { existing: Vec::new(), profile_name: &*p, action_name: &*a, adopted: Vec::new(), excluded: Vec::new() };
        assert!(analyse(&events, 21 * DAY, &ctx).is_empty());
    }

    #[test]
    fn finds_a_weekday_morning_routine() {
        let mut events = Vec::new();
        // Three weeks: on workdays the PC is unlocked at 8:45, the profile
        // "lavoro" chosen, Outlook ~8:50 and Teams ~9:05; Excel at random times.
        for day in 0..21u64 {
            let d = (day % 7 + 1) as u8;
            if d <= 5 {
                events.push(ev(day, d, 525, "unlock", ""));
                events.push(ev(day, d, 527, "profile", "lavoro"));
                events.push(ev(day, d, 530 + (day % 3) as u32 * 5, "app", "outlook.exe"));
                events.push(ev(day, d, 545 + (day % 2) as u32 * 5, "app", "teams.exe"));
                events.push(ev(day, d, 600 + (day * 37 % 200) as u32, "app", "excel.exe"));
            } else {
                events.push(ev(day, d, 700, "app", "steam.exe"));
            }
        }
        let (p, a) = ctx_none();
        let ctx = Context { existing: Vec::new(), profile_name: &*p, action_name: &*a, adopted: Vec::new(), excluded: Vec::new() };
        let out = analyse(&events, 21 * DAY, &ctx);
        let r = out.iter().find(|g| g.fp.starts_with("routine|wd|")).expect("routine proposed");
        let auto = &r.automation;
        assert_eq!(auto["trigger"]["kind"], "unlock");
        assert_eq!(auto["repeat"], "day");
        assert_eq!(auto["conditions"][0]["days"], json!([1, 2, 3, 4, 5]));
        let kinds: Vec<&str> = auto["steps"].as_array().unwrap().iter().map(|s| s["kind"].as_str().unwrap()).collect();
        assert_eq!(kinds, ["profile", "app", "app", "chat"]);
        assert_eq!(auto["steps"][1]["target"], "C:\\Apps\\outlook.exe");
        assert_eq!(auto["steps"][2]["target"], "C:\\Apps\\teams.exe");
        assert!(!out.iter().any(|g| g.fp.contains("excel") || g.fp.contains("steam")));

        // Same fingerprint every time, and nothing when automations already open them.
        assert_eq!(analyse(&events, 21 * DAY, &ctx)[0].fp, out[0].fp);
        let ctx2 = Context {
            existing: vec![
                ("time".into(), String::new(), "C:\\Apps\\outlook.exe".into()),
                ("unlock".into(), String::new(), "C:\\Apps\\teams.exe".into()),
            ],
            profile_name: &*p,
            action_name: &*a,
            adopted: Vec::new(),
            excluded: Vec::new(),
        };
        assert!(!analyse(&events, 21 * DAY, &ctx2).iter().any(|g| g.fp.starts_with("routine|")));
    }

    #[test]
    fn network_and_drive_habits() {
        let mut events = Vec::new();
        for day in 0..6u64 {
            events.push(ev(day, 1, 480, "start", ""));
            events.push(ev(day, 1, 485, "wifi", "Ufficio"));
            events.push(ev(day, 1, 487, "profile", "lavoro"));
            events.push(ev(day, 1, 489, "app", "gestionale.exe"));
            if day < 4 {
                events.push(ev(day, 1, 700, "drive", "E:"));
                events.push(ev(day, 1, 702, "quick", "backup"));
            }
        }
        let (p, a) = ctx_none();
        let ctx = Context { existing: Vec::new(), profile_name: &*p, action_name: &*a, adopted: Vec::new(), excluded: Vec::new() };
        let out = analyse(&events, 6 * DAY, &ctx);
        let wifi = out.iter().find(|g| g.fp == "wifi|ufficio|lavoro").expect("network proposed");
        assert_eq!(wifi.automation["steps"][1]["target"], "C:\\Apps\\gestionale.exe");
        assert!(out.iter().any(|g| g.fp == "drive|backup"));
    }

    #[test]
    fn sequences_exclusions_and_unused_automations() {
        let mut events = Vec::new();
        for day in 0..8u64 {
            events.push(ev(day, 1, 600 + (day % 4) as u32 * 70, "app", "gestionale.exe"));
            events.push(ev(day, 1, 602 + (day % 4) as u32 * 70, "app", "excel.exe"));
            events.push(ev(day, 1, 603 + (day % 4) as u32 * 70, "app", "word.exe"));
            // An automation opened Teams at 9:00, but Teams was never used after.
            events.push(ev(day, 1, 540, "auto", "a1"));
        }
        let (p, a) = ctx_none();
        let mut ctx = Context {
            existing: Vec::new(),
            profile_name: &*p,
            action_name: &*a,
            adopted: vec![("a1".into(), "Teams alle 9".into(), vec![("app".into(), "C:\\Apps\\teams.exe".into())])],
            excluded: Vec::new(),
        };
        let out = analyse(&events, 8 * DAY, &ctx);
        let seq = out.iter().find(|g| g.fp == "seq|gestionale.exe|excel.exe+word.exe").expect("sequence proposed");
        assert_eq!(seq.automation["trigger"]["exe"], "gestionale.exe");
        assert_eq!(seq.automation["steps"].as_array().unwrap().len(), 2);
        let off = out.iter().find(|g| g.fp == "off|a1").expect("unused automation flagged");
        assert_eq!(off.accept, "Spegni");
        assert_eq!(off.automation["disable"], "a1");

        // Excluded programs are not looked at: one follower left, not worth it.
        ctx.excluded = vec!["excel.exe".into()];
        assert!(!analyse(&events, 8 * DAY, &ctx).iter().any(|g| g.fp.starts_with("seq|gestionale.exe")));
    }

    #[test]
    fn too_little_data_proposes_nothing() {
        let events: Vec<Event> = (0..3u64).map(|d| ev(d, 1, 540, "app", "outlook.exe")).collect();
        let (p, a) = ctx_none();
        let ctx = Context { existing: Vec::new(), profile_name: &*p, action_name: &*a, adopted: Vec::new(), excluded: Vec::new() };
        assert!(analyse(&events, 3 * DAY, &ctx).is_empty());
    }
}
