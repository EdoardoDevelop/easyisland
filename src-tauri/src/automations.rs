// Automations: "quando… (se…) allora…", set up in Impostazioni → Flussi.
//
// Triggers: a time of day on chosen days, EasyIsland starting (with the PC),
// the PC being unlocked, joining a Wi-Fi network, a program starting or coming
// to the front, a drive (USB stick, external disk) being plugged in, a new file
// in a folder, a download finishing, an integration or widget reporting a
// problem or an event (new ticket…), a 3CX call ringing, an agent finishing or
// waiting for a permission, a dev server starting, coming back after a break,
// a Teams meeting starting or ending (teams.rs).
// Most of them can be narrowed with a filter (".pdf", a caller, a project).
// Conditions ("se", all of them must hold, each one can be turned into "non"):
// a profile, hours and days, a Wi-Fi network, a program open or in front, on
// battery or below N %, away for N minutes, microphone or webcam in use, "davanti
// al cliente". Plus how often: every time, at most every N minutes, once a day.
// Actions, in order: a quick action of the user's, a notice in the island, a
// profile switch, opening a program/folder or a link, a question to the chat,
// a task, waiting N minutes, asking first (a card: Continua / Annulla). After a
// step that failed the rest is skipped, unless "keepGoing".
// The trigger's data ({file}, {chiamante}, {progetto}…) fill notices, links,
// arguments and questions (`fill`), never a script: see `run_step` for the rules.
//
// The user approved each automation by creating it, so it runs without
// asking — except a quick-action script marked "Chiedi conferma", which the
// island shows with Esegui as always, and "Chiedi alla chat" actions, which open
// the chat. Nothing runs while EasyIsland is paused. Every run lands in a log
// (in memory, the last 100) shown in the settings.
//
// Cost: one thread that sleeps 5 s between looks, 30 s when no automation is
// on, and only asks for what an enabled automation needs (process list, drive
// letters, a folder, the Wi-Fi name every 30 s). Conditions are looked at only
// when their automation is about to run. Unlock comes from Windows
// (WTSRegisterSessionNotification) on a thread that sleeps in GetMessageW;
// downloads, calls, agents, dev servers and the window in front are pushed by
// their own modules (`on_event`), and only while an automation wants them.

use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
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
    /// time | startup | unlock | wifi | app | foreground | drive | folder | download
    /// | integration | call | agent | server | back
    pub kind: String,
    /// time: "HH:MM".
    pub time: String,
    /// time: 1 = Monday … 7 = Sunday; empty = every day.
    pub days: Vec<u8>,
    /// startup: seconds after EasyIsland starts.
    pub delay: u64,
    pub ssid: String,
    /// app, foreground: executable name, e.g. "teams.exe".
    pub exe: String,
    pub folder: String,
    /// integration: id of the integration or widget ("integration_zammad", a widget id).
    pub source: String,
    /// integration: "problem" (turns warn/error) | "event" (new ticket…) | "any".
    /// agent: "stop" (finished) | "permission" (waits for Consenti) | "any".
    pub when: String,
    /// folder, download, integration, call, agent, server: only when the event
    /// matches, comma-separated: ".pdf" / "*.pdf" = the file's extension, any
    /// other word = contained in the file name, caller, project… "" = always.
    pub filter: String,
    /// back: away (no keyboard or mouse) for at least these minutes.
    pub minutes: u64,
}

/// One "se": all of an automation's conditions must hold when it would run.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Condition {
    /// hours | wifi | app | foreground | battery | idle | meeting | client
    pub kind: String,
    /// "non": the condition must NOT hold.
    pub not: bool,
    /// hours: "HH:MM" to "HH:MM" (across midnight when `to` is earlier).
    pub from: String,
    pub to: String,
    /// hours: 1 = Monday … 7 = Sunday; empty = every day.
    pub days: Vec<u8>,
    pub ssid: String,
    /// app (open), foreground (in front): "excel.exe".
    pub exe: String,
    /// idle: no keyboard or mouse for at least these minutes.
    pub minutes: u64,
    /// battery: 0 = running on battery, otherwise the charge is below this %.
    pub percent: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Step {
    /// quick | notice | profile | app | url | chat (`text` is the question) | task
    /// | wait (`minutes`) | confirm (a card with `title` / `text`: Continua or Annulla)
    pub kind: String,
    /// quick: action id · profile: profile id.
    pub id: String,
    pub title: String,
    pub text: String,
    pub level: String,
    pub target: String,
    pub args: String,
    pub url: String,
    /// wait: how long.
    pub minutes: u64,
    /// Flows (flows.rs): this step's name for links and for its result in the
    /// data ("{id}"); "" = "s1", "s2"… by position.
    pub node: String,
    /// Where to go after this step: another step's `node`, "end", or "" = the next one.
    pub next: String,
    /// decide: the first branch that holds sets where to go.
    pub branches: Vec<Branch>,
    /// agent: engine and model of the task ("" = Impostazioni → Flussi).
    pub engine: String,
    pub model: String,
    /// ask: the buttons of the card (1–3; empty = Sì / No).
    pub options: Vec<String>,
    /// foreach: the step each item starts from (`node`); `next` comes after the last one.
    pub body: String,
}

/// One way out of a "decide" step.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Branch {
    /// The value looked at, with placeholders: "{agente}", "{chiamante}".
    pub value: String,
    /// contains | equals | empty | filled | else, or "model": the engine picks
    /// one of the branches by their `to_match`, the way described.
    pub op: String,
    /// What `contains` / `equals` compare with (case does not matter); for
    /// "model", what the branch means ("il cliente chiede un preventivo").
    pub to_match: String,
    /// The step to go to (`node`) or "end".
    pub to: String,
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
    /// More "se", all of them must hold.
    pub conditions: Vec<Condition>,
    /// "" = every time · "every" = at most once every `every` minutes · "day" = once a day.
    pub repeat: String,
    pub every: u64,
    pub steps: Vec<Step>,
    /// A notice in the island every time it runs (errors always show).
    pub notify: bool,
    /// Go on with the next steps after one that failed (off: they are skipped).
    pub keep_going: bool,
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

/// The trigger's data, by placeholder name without braces ("file" → "fattura.pdf").
pub type Ctx = Vec<(String, String)>;

/// Something another module saw (`on_event`): trigger kind, what the filter
/// looks at, the "when" ("stop", "permission"… or ""), the data for the steps.
struct Event {
    kind: String,
    subject: String,
    when: String,
    ctx: Ctx,
}
static EVENTS: Mutex<Vec<Event>> = Mutex::new(Vec::new());
/// Bit i = an enabled automation listens to TRIGGER_KINDS[i]: the modules that
/// push events stop at one atomic load otherwise.
static WANTED: AtomicU32 = AtomicU32::new(0);

fn kind_bit(kind: &str) -> u32 {
    TRIGGER_KINDS.iter().position(|k| *k == kind).map(|i| 1u32 << i).unwrap_or(0)
}

/// Is any enabled automation waiting for this kind of event?
pub fn wants(kind: &str) -> bool {
    WANTED.load(Ordering::Relaxed) & kind_bit(kind) != 0
}

/// downloads.rs, threecx, pipe.rs, devservers.rs, context.rs: an event happened.
/// Queued for the engine's next look (at most 5 s later).
pub fn on_event(kind: &str, subject: &str, when: &str, ctx: &[(&str, String)]) {
    if !wants(kind) {
        return;
    }
    let mut q = EVENTS.lock().unwrap();
    if q.len() >= 50 {
        return;
    }
    q.push(Event {
        kind: kind.into(),
        subject: subject.into(),
        when: when.into(),
        ctx: ctx.iter().map(|(k, v)| (k.to_string(), v.clone())).collect(),
    });
}

/// An agent's hook (pipe.rs): finished (Stop) or waiting for a permission.
/// The island's own chat does not count.
pub fn on_hook(event: &str, payload: &Value) {
    let when = match event {
        "Stop" => "stop",
        "PermissionRequest" => "permission",
        _ => return,
    };
    if payload.get("easyisland_chat").is_some() || !wants("agent") {
        return;
    }
    let agent = payload
        .pointer("/easyisland_agent/name")
        .and_then(Value::as_str)
        .unwrap_or("Claude Code")
        .to_string();
    let cwd = payload.get("cwd").and_then(Value::as_str).unwrap_or_default().to_string();
    let project = cwd.trim_end_matches(['\\', '/']).rsplit(['\\', '/']).next().unwrap_or_default().to_string();
    on_event(
        "agent",
        &format!("{agent} {project}"),
        when,
        &[("agente", agent.clone()), ("progetto", project.clone()), ("cartella", cwd)],
    );
}

/// The program in front changed (context.rs): only a different program counts,
/// not another window of the same one.
pub fn on_foreground(exe: &str) {
    static LAST: Mutex<String> = Mutex::new(String::new());
    let mut last = LAST.lock().unwrap();
    if *last == exe {
        return;
    }
    *last = exe.to_string();
    drop(last);
    on_event("foreground", exe, "", &[("programma", exe.to_string())]);
}

/// File name, full path and folder of a path, for the steps.
pub fn file_ctx(path: &std::path::Path) -> Vec<(&'static str, String)> {
    vec![
        ("file", path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default()),
        ("percorso", path.to_string_lossy().into_owned()),
        ("cartella", path.parent().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default()),
    ]
}

/// The trigger's filter: comma-separated terms, any of them may match.
/// ".pdf" or "*.pdf" = the subject ends with that extension; anything else =
/// contained in the subject. Case does not matter; an empty filter matches all.
pub fn matches(filter: &str, subject: &str) -> bool {
    let subject = subject.to_lowercase();
    let terms: Vec<String> = filter.split(',').map(|t| t.trim().to_lowercase()).filter(|t| !t.is_empty()).collect();
    terms.is_empty()
        || terms.iter().any(|term| match term.strip_prefix("*.").or_else(|| term.strip_prefix('.')) {
            Some(ext) => subject.ends_with(&format!(".{ext}")),
            None => subject.contains(term.as_str()),
        })
}

/// Percent-encoding for a value put inside a link.
fn url_encode(s: &str) -> String {
    let mut out = String::new();
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

/// Replaces `{name}` with the trigger's data. `wrap(value, at_start)` shapes
/// each value for where it goes (a link, an argument…); unknown names stay as
/// they are, so a typo shows in the result instead of vanishing.
pub fn fill(template: &str, ctx: &Ctx, wrap: &dyn Fn(&str, bool) -> String) -> String {
    let mut out = String::new();
    let mut rest = template;
    while let Some(open) = rest.find('{') {
        let (before, after) = rest.split_at(open);
        out.push_str(before);
        let found = after.find('}').and_then(|close| {
            let name = after.get(1..close)?;
            ctx.iter().find(|(k, _)| k == name).map(|(_, v)| (close, v))
        });
        match found {
            Some((close, value)) => {
                out.push_str(&wrap(value, out.trim().is_empty()));
                rest = after.get(close + 1..).unwrap_or("");
            }
            None => {
                out.push('{');
                rest = after.get(1..).unwrap_or("");
            }
        }
    }
    out.push_str(rest);
    out
}

/// Did the template use any of the trigger's data?
fn uses_ctx(template: &str, ctx: &Ctx) -> bool {
    ctx.iter().any(|(k, _)| template.contains(&format!("{{{k}}}")))
}

/// Programs that would run their arguments as code: the trigger's data (a file
/// name, a caller…) never goes to them.
const SHELLS: &[&str] = &[
    "cmd", "powershell", "pwsh", "wscript", "cscript", "mshta", "bash", "wsl", "sh", "rundll32", "regsvr32", "python",
    "pythonw", "py", "node", "conhost", "wt",
];

/// Files that would run if opened: an automation never opens one it was handed
/// by an event (a download, a new file).
const RUNNABLE: &[&str] = &[
    "exe", "com", "bat", "cmd", "ps1", "psm1", "vbs", "vbe", "js", "jse", "wsf", "wsh", "msi", "msp", "scr", "pif",
    "hta", "cpl", "msc", "jar", "lnk", "reg", "url", "appref-ms", "application", "gadget", "inf", "scf",
];

fn stem_of(target: &str) -> String {
    let name = target.trim().trim_matches('"').rsplit(['\\', '/']).next().unwrap_or("").to_lowercase();
    name.strip_suffix(".exe").unwrap_or(&name).to_string()
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn log() -> Vec<LogEntry> {
    LOG.lock().unwrap().iter().cloned().collect()
}

pub(crate) fn push_log(entry: LogEntry) {
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

pub(crate) fn list(app: &AppHandle) -> (Vec<Automation>, String, Vec<Value>) {
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

pub(crate) fn notice(app: &AppHandle, title: &str, text: &str, level: &str) {
    let cut = |s: &str, n: usize| s.chars().take(n).collect::<String>();
    let _ = app.emit_to(WINDOW_LABEL, "hook", json!({
        "hook_event_name": "EasyIslandNotify",
        "title": cut(title, 120),
        "text": cut(text, 600),
        "level": level,
        "url": "",
    }));
}

pub(crate) async fn run_step(app: &AppHandle, step: &Step, actions: &[Value], ctx: &Ctx) -> Result<String, String> {
    let plain = |v: &str, _: bool| v.to_string();
    match step.kind.as_str() {
        // The user's own action, as it is: a script never gets the trigger's data.
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
                // Keys to the program in front, as from its button.
                "keys" => {
                    let keys = get("keys");
                    tauri::async_runtime::spawn_blocking(move || crate::context::send_keys(&keys))
                        .await
                        .map_err(|e| e.to_string())?
                        .map(|_| tf("tasti di «{name}» inviati", &[("name", &name)]))
                }
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
            notice(app, &fill(&step.title, ctx, &plain), &fill(&step.text, ctx, &plain), level);
            Ok(t("avviso mostrato").into())
        }
        "profile" => {
            crate::activate_profile(app, &step.id, "automazione");
            Ok(t("profilo cambiato").into())
        }
        "app" => {
            let target = fill(step.target.trim(), ctx, &plain);
            let target = target.trim();
            if target.is_empty() {
                return Err(t("programma non indicato").into());
            }
            // A file handed over by the event is opened only if opening it
            // does not run it (a downloaded setup.exe, a script).
            if uses_ctx(&step.target, ctx) {
                let ext = target.rsplit_once('.').map(|(_, e)| e.to_lowercase()).unwrap_or_default();
                if RUNNABLE.contains(&ext.as_str()) {
                    return Err(tf("non apro {target}: è un file che si esegue", &[("target", &target)]));
                }
            }
            // The event's data as separate quoted arguments, and never for a
            // program that would run them as code.
            if uses_ctx(&step.args, ctx) && SHELLS.contains(&stem_of(target).as_str()) {
                return Err(tf("i dati dell'evento non vanno passati a {target}", &[("target", &target)]));
            }
            let args = fill(&step.args, ctx, &|v: &str, _| {
                let v = v.replace('"', "");
                if v.chars().any(char::is_whitespace) { format!("\"{v}\"") } else { v }
            });
            crate::actions::open_app(target, &args).map(|_| format!("aperto {target}"))
        }
        "url" => {
            // A value at the very start may be the link itself ({link} of a dev
            // server); anywhere else it is encoded, so it stays one value.
            let url = fill(step.url.trim(), ctx, &|v: &str, at_start| if at_start { v.to_string() } else { url_encode(v) });
            if !(url.starts_with("https://") || url.starts_with("http://")) {
                return Err(t("il link deve iniziare con http:// o https://").into());
            }
            crate::open_url_now(&url);
            Ok(format!("aperto {url}"))
        }
        "chat" => {
            let prompt = fill(step.text.trim(), ctx, &plain);
            if prompt.is_empty() {
                return Err(t("domanda per la chat vuota").into());
            }
            let _ = app.emit_to(WINDOW_LABEL, "automation-ask", prompt);
            Ok(t("domanda mandata alla chat").into())
        }
        // A task (tasks.rs) with the trigger's data in its goal: the agent works on it by itself.
        "task" => {
            let goal = fill(step.text.trim(), ctx, &plain);
            let title = fill(step.title.trim(), ctx, &plain);
            let task = crate::tasks::create(app, &title, &goal, "", "")?;
            Ok(tf("compito «{title}» in coda", &[("title", &task.title)]))
        }
        other => Err(tf("passo sconosciuto: {other}", &[("other", &other)])),
    }
}

/// Runs the flow (flows.rs: steps in order or along their links), logs the
/// outcome and tells the island when asked to (or when something failed).
pub async fn run(app: AppHandle, auto: Automation, cause: String, actions: Vec<Value>, ctx: Ctx) {
    crate::flows::start(app, auto, cause, actions, ctx).await;
}

/// A "chiedi prima" card waits this long, then the automation stops.
pub(crate) const CONFIRM_WAIT: Duration = Duration::from_secs(180);

/// A step in a few words, for the "chiedi prima" card.
pub(crate) fn step_words(st: &Step) -> String {
    match st.kind.as_str() {
        "quick" => t("un'azione rapida").to_string(),
        "notice" => tf("avviso «{t}»", &[("t", &st.title)]),
        "profile" => t("cambio di profilo").to_string(),
        "app" => tf("apro {x}", &[("x", &st.target)]),
        "url" => tf("apro {x}", &[("x", &st.url)]),
        "chat" => t("domanda alla chat").to_string(),
        "task" => tf("compito «{x}»", &[("x", &if st.title.is_empty() { st.text.clone() } else { st.title.clone() })]),
        "wait" => tf("attendo {n} minuti", &[("n", &st.minutes)]),
        "agent" => tf("agente «{x}»", &[("x", &if st.title.is_empty() { st.text.clone() } else { st.title.clone() })]),
        "ask" => tf("domanda «{x}»", &[("x", &if st.title.is_empty() { st.text.clone() } else { st.title.clone() })]),
        "decide" => t("una scelta").to_string(),
        "foreach" => t("per ogni elemento").to_string(),
        _ => st.kind.clone(),
    }
}

/// Settings → "Prova ora".
pub fn run_now(app: &AppHandle, id: &str) -> Result<(), String> {
    let (autos, _, actions) = list(app);
    let auto = autos.into_iter().find(|a| a.id == id).ok_or(t("Automazione non trovata (salvata?)"))?;
    let app = app.clone();
    // No event behind it: the placeholders stay as they are, so they show.
    tauri::async_runtime::spawn(run(app, auto, t("Prova").into(), actions, Vec::new()));
    Ok(())
}

// ── Made from the chat (agent.rs: create_automation) ─────────────────────────

const TRIGGER_KINDS: &[&str] = &[
    "time", "startup", "unlock", "wifi", "app", "foreground", "drive", "folder", "download", "integration", "call", "agent",
    "server", "back", "teams",
];
const STEP_KINDS: &[&str] = &["quick", "notice", "profile", "app", "url", "chat", "task", "wait", "confirm", "agent", "decide", "ask", "foreach"];
const CONDITION_KINDS: &[&str] = &["hours", "wifi", "app", "foreground", "battery", "idle", "meeting", "client"];

/// "HH:MM" → minutes since midnight.
fn hhmm(s: &str) -> Option<u32> {
    let s = s.trim();
    let (h, m) = s.split_once(':')?;
    let (h, m) = (h.parse::<u32>().ok()?, m.parse::<u32>().ok()?);
    (h < 24 && m < 60 && s.len() == 5).then_some(h * 60 + m)
}

fn exe_name(exe: &str) -> String {
    let mut e = exe.trim().to_lowercase();
    if !e.is_empty() && !e.ends_with(".exe") {
        e.push_str(".exe");
    }
    e
}

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
            if hhmm(&t.time).is_none() {
                return Err("trigger.time deve essere HH:MM (es. 09:00).".into());
            }
            t.days.retain(|d| (1..=7).contains(d));
            t.days.sort();
            t.days.dedup();
        }
        "startup" => t.delay = t.delay.clamp(5, 3600),
        "wifi" if t.ssid.trim().is_empty() => return Err("trigger.ssid: il nome della rete Wi-Fi.".into()),
        "app" | "foreground" if t.exe.trim().is_empty() => return Err("trigger.exe: l'eseguibile, es. teams.exe.".into()),
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
        "agent" if !["stop", "permission", "any"].contains(&t.when.as_str()) => t.when = "stop".into(),
        "teams" if !["start", "end"].contains(&t.when.as_str()) => t.when = "start".into(),
        "back" => t.minutes = if t.minutes == 0 { 15 } else { t.minutes.clamp(1, 720) },
        _ => {}
    }
    t.filter = t.filter.trim().chars().take(200).collect();
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
    if a.conditions.len() > 8 {
        return Err("Al massimo 8 condizioni.".into());
    }
    for c in &mut a.conditions {
        if !CONDITION_KINDS.contains(&c.kind.as_str()) {
            return Err(format!("conditions[].kind deve essere uno di: {}", CONDITION_KINDS.join(", ")));
        }
        match c.kind.as_str() {
            "hours" => {
                if hhmm(&c.from).is_none() || hhmm(&c.to).is_none() {
                    return Err("conditions[]: from e to devono essere HH:MM.".into());
                }
                c.days.retain(|d| (1..=7).contains(d));
                c.days.sort();
                c.days.dedup();
            }
            "wifi" if c.ssid.trim().is_empty() => return Err("conditions[].ssid: il nome della rete Wi-Fi.".into()),
            "app" | "foreground" if c.exe.trim().is_empty() => return Err("conditions[].exe: l'eseguibile, es. excel.exe.".into()),
            "idle" => c.minutes = if c.minutes == 0 { 10 } else { c.minutes.clamp(1, 720) },
            "battery" => c.percent = c.percent.min(100),
            _ => {}
        }
    }
    match a.repeat.as_str() {
        "every" => a.every = if a.every == 0 { 60 } else { a.every.clamp(1, 1440) },
        "day" => {}
        _ => a.repeat.clear(),
    }
    if a.steps.is_empty() {
        return Err("Serve almeno un passo in steps.".into());
    }
    if a.steps.len() > 30 {
        return Err("Al massimo 30 passi.".into());
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
            "url" if !(st.url.starts_with("https://") || st.url.starts_with("http://") || st.url.starts_with('{')) => {
                return Err("steps[].url deve iniziare con http:// o https:// (o con {link}).".into());
            }
            "chat" if st.text.trim().is_empty() => return Err("steps[].text: la domanda per la chat.".into()),
            "task" if st.text.trim().is_empty() => return Err("steps[].text: l'obiettivo del compito.".into()),
            "wait" => st.minutes = if st.minutes == 0 { 5 } else { st.minutes.clamp(1, 240) },
            "agent" if st.text.trim().is_empty() => return Err("steps[].text: l'obiettivo dell'agente.".into()),
            "decide" if st.branches.is_empty() => return Err("steps[].branches: almeno un ramo per una scelta.".into()),
            "ask" if st.options.len() > 3 => return Err("steps[].options: al massimo 3 scelte.".into()),
            "decide" if st.branches.iter().any(|b| b.op == "model") && st.branches.len() < 2 => {
                return Err("steps[].branches: per una scelta del modello servono almeno due rami.".into());
            }
            "foreach" if st.text.trim().is_empty() || st.body.trim().is_empty() => {
                return Err("steps[]: un foreach ha bisogno di text (l'elenco, una voce per riga) e body (il passo da cui parte ogni voce).".into());
            }
            _ => {}
        }
        if st.level.is_empty() {
            st.level = "info".into();
        }
    }
    crate::flows::name_steps(&mut a.steps);
    crate::flows::check_links(&a.steps)?;
    a.id = format!("a{}", now_ms());
    a.enabled = true;
    a.origin.clear();
    Ok(a)
}

fn day_names(d: &[u8]) -> String {
    if d.is_empty() || d.len() == 7 {
        "ogni giorno".to_string()
    } else {
        d.iter()
            .filter_map(|x| ["", "lun", "mar", "mer", "gio", "ven", "sab", "dom"].get(*x as usize))
            .copied()
            .collect::<Vec<_>>()
            .join(", ")
    }
}

/// One condition in words, for the chat: "non in riunione".
fn describe_condition(c: &Condition) -> String {
    let what = match c.kind.as_str() {
        "hours" => format!("tra le {} e le {} ({})", c.from, c.to, day_names(&c.days)),
        "wifi" => format!("in rete Wi-Fi {}", c.ssid),
        "app" => format!("{} aperto", c.exe),
        "foreground" => format!("{} in primo piano", c.exe),
        "battery" if c.percent == 0 => "a batteria".into(),
        "battery" => format!("batteria sotto il {}%", c.percent),
        "idle" => format!("assente da {} minuti", c.minutes),
        "meeting" => "in riunione (microfono o webcam in uso)".into(),
        "client" => "davanti al cliente".into(),
        k => k.to_string(),
    };
    if c.not { format!("non {what}") } else { what }
}

/// One line per automation for the chat: "Mattina (accesa): alle 09:00 L-V → …".
pub fn describe(a: &Automation, s: &crate::settings::Settings) -> String {
    let t = &a.trigger;
    let mut when = match t.kind.as_str() {
        "time" => format!("alle {} ({})", t.time, day_names(&t.days)),
        "startup" => format!("{} s dopo l'avvio", t.delay),
        "unlock" => "allo sblocco del PC".into(),
        "wifi" => format!("in rete Wi-Fi {}", t.ssid),
        "app" => format!("quando parte {}", t.exe),
        "foreground" => format!("quando passi a {}", t.exe),
        "drive" => "quando si collega una chiavetta o un disco".into(),
        "folder" => format!("nuovo file in {}", t.folder),
        "download" => "download finito".into(),
        "integration" => format!("{} da {}", if t.when == "event" { "novità" } else { "problema" }, t.source),
        "call" => "chiamata 3CX in arrivo".into(),
        "agent" => match t.when.as_str() {
            "permission" => "un agente aspetta un permesso".into(),
            "any" => "un agente finisce o aspetta un permesso".into(),
            _ => "un agente ha finito".into(),
        },
        "server" => "parte un server di sviluppo".into(),
        "back" => format!("rientro dopo {} minuti di assenza", t.minutes),
        "teams" if t.when == "end" => "finisce una riunione Teams".into(),
        "teams" => "inizia una riunione Teams".into(),
        k => k.to_string(),
    };
    if !t.filter.is_empty() && FILTERED.contains(&t.kind.as_str()) {
        when.push_str(&format!(" (solo «{}»)", t.filter));
    }
    let mut ifs: Vec<String> = a.conditions.iter().map(describe_condition).collect();
    if !a.profile.is_empty() {
        ifs.insert(0, format!("solo nel profilo {}", a.profile));
    }
    match a.repeat.as_str() {
        "every" => ifs.push(format!("al massimo ogni {} minuti", a.every)),
        "day" => ifs.push("una volta al giorno".into()),
        _ => {}
    }
    let linked = a.steps.iter().any(|s| !s.next.is_empty() || s.kind == "decide");
    let steps: Vec<String> = a
        .steps
        .iter()
        .map(|st| match st.kind.as_str() {
            "quick" => format!("azione rapida {}", st.id),
            "notice" => format!("avviso «{}»", st.title),
            "profile" => format!("profilo {}", s.profiles.iter().find(|p| p.id == st.id).map(|p| p.name.as_str()).unwrap_or(&st.id)),
            "app" => format!("apri {}", st.target),
            "url" => format!("apri {}", st.url),
            "chat" => format!("chiedi alla chat «{}»", st.text),
            "task" => format!("avvia il compito «{}»", if st.title.is_empty() { &st.text } else { &st.title }),
            "wait" => format!("aspetta {} minuti", st.minutes),
            "confirm" => "chiedi prima di continuare".into(),
            "agent" => format!("agente «{}»", if st.title.is_empty() { &st.text } else { &st.title }),
            "ask" => format!("domanda «{}»", if st.title.is_empty() { &st.text } else { &st.title }),
            "decide" => format!(
                "scelta ({})",
                st.branches.iter().map(|b| format!("{} {} {} → {}", b.value, b.op, b.to_match, b.to)).collect::<Vec<_>>().join("; ")
            ),
            k => k.to_string(),
        })
        .zip(a.steps.iter())
        .map(|(text, st)| {
            if !linked {
                text
            } else if st.next.is_empty() {
                format!("[{}] {text}", st.node)
            } else {
                format!("[{}] {text} → {}", st.node, st.next)
            }
        })
        .collect();
    format!(
        "{} [id {}] ({}): {}{} → {}",
        a.name,
        a.id,
        if a.enabled { "accesa" } else { "spenta" },
        when,
        if ifs.is_empty() { String::new() } else { format!(", se {}", ifs.join(" e ")) },
        steps.join(", ")
    )
}

/// Triggers whose events the filter narrows down.
const FILTERED: &[&str] = &["folder", "download", "integration", "call", "agent", "server"];

// ── Conditions ───────────────────────────────────────────────────────────────

/// What the conditions look at, read once per look and only when asked.
#[derive(Default)]
struct Look {
    procs: Option<HashSet<String>>,
    ssid: Option<Option<String>>,
    fg: Option<String>,
    power: Option<(bool, u8)>,
}

impl Look {
    fn procs(&mut self) -> &HashSet<String> {
        self.procs.get_or_insert_with(|| crate::presence::processes().into_iter().collect())
    }
    fn ssid(&mut self) -> Option<String> {
        self.ssid.get_or_insert_with(crate::profiles::current_ssid).clone()
    }
    fn foreground(&mut self) -> String {
        self.fg.get_or_insert_with(|| crate::context::foreground().map(|f| f.exe).unwrap_or_default()).clone()
    }
    /// (on battery, charge %), charge 255 when unknown.
    fn power(&mut self) -> (bool, u8) {
        *self.power.get_or_insert_with(|| {
            use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
            let mut p = SYSTEM_POWER_STATUS::default();
            if unsafe { GetSystemPowerStatus(&mut p) }.is_ok() && p.BatteryFlag != 128 {
                (p.ACLineStatus == 0, p.BatteryLifePercent)
            } else {
                (false, 255)
            }
        })
    }
}

/// Milliseconds since the last key or mouse movement.
fn idle_ms() -> u64 {
    use windows::Win32::System::SystemInformation::GetTickCount;
    use windows::Win32::UI::Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO};
    let mut li = LASTINPUTINFO { cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32, dwTime: 0 };
    if unsafe { GetLastInputInfo(&mut li) }.as_bool() {
        unsafe { GetTickCount() }.wrapping_sub(li.dwTime) as u64
    } else {
        0
    }
}

/// Is `now` (minutes since midnight, day 1–7) inside from–to on the chosen days?
/// `to` earlier than `from` goes across midnight (22:00–06:00).
fn in_hours(from: u32, to: u32, days: &[u8], now: u32, day: u8) -> bool {
    let inside = if from <= to { now >= from && now < to } else { now >= from || now < to };
    inside && (days.is_empty() || days.contains(&day))
}

fn holds(c: &Condition, look: &mut Look) -> bool {
    let yes = match c.kind.as_str() {
        "hours" => {
            let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
            let day = if t.wDayOfWeek == 0 { 7 } else { t.wDayOfWeek as u8 };
            match (hhmm(&c.from), hhmm(&c.to)) {
                (Some(f), Some(to)) => in_hours(f, to, &c.days, t.wHour as u32 * 60 + t.wMinute as u32, day),
                _ => false,
            }
        }
        "wifi" => look.ssid().is_some_and(|n| n.eq_ignore_ascii_case(c.ssid.trim())),
        "app" => {
            let exe = exe_name(&c.exe);
            look.procs().contains(&exe)
        }
        "foreground" => look.foreground() == exe_name(&c.exe),
        "battery" => {
            let (on_battery, pct) = look.power();
            if c.percent == 0 { on_battery } else { pct <= 100 && pct < c.percent }
        }
        "idle" => idle_ms() >= c.minutes.max(1) * 60_000,
        "meeting" => crate::presence::device_in_use("microphone").is_some() || crate::presence::device_in_use("webcam").is_some(),
        "client" => crate::presence::current().is_some(),
        _ => false,
    };
    yes != c.not
}

/// How often: "every" N minutes or once a "day", from the last run.
fn repeat_allows(a: &Automation, last: Option<&(Instant, String)>, now: Instant, today: &str) -> bool {
    let Some((at, day)) = last else { return true };
    match a.repeat.as_str() {
        "every" => now.duration_since(*at) >= Duration::from_secs(a.every.max(1) * 60),
        "day" => day != today,
        _ => true,
    }
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
pub(crate) fn minute_key() -> (u8, String) {
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
    crate::flows::resume(&app, list(&app).2);
    std::thread::spawn(move || {
        let started = Instant::now();
        let mut fired_startup: HashSet<String> = HashSet::new();
        let mut fired_minute: HashMap<String, String> = HashMap::new();
        let mut procs: Option<HashSet<String>> = None;
        let mut drive_mask: Option<u32> = None;
        let mut folders: HashMap<String, HashSet<String>> = HashMap::new();
        let mut ssid: Option<Option<String>> = None;
        let mut ssid_checked: Option<Instant> = None;
        // Longest time without keyboard or mouse in the current absence, in ms.
        let mut away_ms: u64 = 0;
        // When each automation last ran, and on which day ("YYYY-MM-DD").
        let mut last_run: HashMap<String, (Instant, String)> = HashMap::new();
        let mut ticks: u64 = 0;

        loop {
            let (autos, profile, actions) = list(&app);
            let on: Vec<&Automation> = autos
                .iter()
                .filter(|a| a.enabled && (a.profile.is_empty() || a.profile == profile))
                .collect();
            WANTED.store(on.iter().fold(0, |m, a| m | kind_bit(&a.trigger.kind)), Ordering::Relaxed);
            let paused = crate::integrations::PAUSED.load(Ordering::Relaxed);
            let unlocked = UNLOCKED.swap(false, Ordering::Relaxed);
            let widget_events: Vec<_> = std::mem::take(&mut *WIDGET_EVENTS.lock().unwrap());
            let events: Vec<Event> = std::mem::take(&mut *EVENTS.lock().unwrap());
            if on.is_empty() {
                // Forget the baselines, so switching one on later does not fire
                // on everything that changed meanwhile.
                procs = None;
                drive_mask = None;
                folders.clear();
                ssid = None;
                away_ms = 0;
                std::thread::sleep(Duration::from_secs(30));
                continue;
            }
            let wants = |k: &str| on.iter().any(|a| a.trigger.kind == k);
            let mut fire: Vec<(Automation, String, Ctx)> = Vec::new();
            let ctx1 = |k: &str, v: &str| vec![(k.to_string(), v.to_string())];

            // Time of day.
            let (day, key) = minute_key();
            if wants("time") {
                let hhmm = key.get(11..).unwrap_or("");
                for a in on.iter().filter(|a| a.trigger.kind == "time") {
                    let t = &a.trigger;
                    if t.time == hhmm
                        && (t.days.is_empty() || t.days.contains(&day))
                        && fired_minute.get(&a.id) != Some(&key)
                    {
                        fired_minute.insert(a.id.clone(), key.clone());
                        fire.push(((*a).clone(), tf("ore {hhmm}", &[("hhmm", &hhmm)]), Vec::new()));
                    }
                }
            }

            // EasyIsland started (with the PC, when it starts with Windows).
            for a in on.iter().filter(|a| a.trigger.kind == "startup") {
                if !fired_startup.contains(&a.id) && started.elapsed() >= Duration::from_secs(a.trigger.delay.max(5)) {
                    fired_startup.insert(a.id.clone());
                    fire.push(((*a).clone(), t("avvio").into(), Vec::new()));
                }
            }

            if unlocked {
                for a in on.iter().filter(|a| a.trigger.kind == "unlock") {
                    fire.push(((*a).clone(), t("PC sbloccato").into(), Vec::new()));
                }
            }

            // Back after a break: the longest absence is remembered until a key
            // or the mouse moves again.
            if wants("back") {
                let idle = idle_ms();
                if idle >= 60_000 {
                    away_ms = away_ms.max(idle);
                } else if idle < 15_000 && away_ms > 0 {
                    let minutes = away_ms / 60_000;
                    for a in on.iter().filter(|a| a.trigger.kind == "back" && minutes >= a.trigger.minutes.max(1)) {
                        fire.push(((*a).clone(), tf("di nuovo qui dopo {n} min", &[("n", &minutes)]), ctx1("minuti", &minutes.to_string())));
                    }
                    away_ms = 0;
                }
            } else {
                away_ms = 0;
            }

            // Wi-Fi network joined: asked every 30 s (netsh is a process).
            if wants("wifi") && ssid_checked.is_none_or(|t| t.elapsed() >= Duration::from_secs(30)) {
                ssid_checked = Some(Instant::now());
                let now = crate::profiles::current_ssid();
                if let Some(prev) = &ssid {
                    if *prev != now {
                        if let Some(name) = &now {
                            for a in on.iter().filter(|a| a.trigger.kind == "wifi") {
                                if a.trigger.ssid.trim().eq_ignore_ascii_case(name) {
                                    fire.push(((*a).clone(), tf("rete {name}", &[("name", &name)]), ctx1("rete", name)));
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
                        let exe = exe_name(&a.trigger.exe);
                        if !exe.is_empty() && now.contains(&exe) && !prev.contains(&exe) {
                            fire.push(((*a).clone(), tf("avviato {exe}", &[("exe", &exe)]), ctx1("programma", &exe)));
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
                            fire.push(((*a).clone(), tf("unità {letters}", &[("letters", &letters)]), ctx1("unità", &letters)));
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
                        for a in on.iter().filter(|a| a.trigger.kind == "folder" && a.trigger.folder.trim() == folder) {
                            // The first new file that passes the filter is the one the steps get.
                            let mine: Vec<&&String> = new.iter().filter(|n| matches(&a.trigger.filter, n)).collect();
                            let Some(first) = mine.first() else { continue };
                            let what = if mine.len() == 1 { (**first).clone() } else { format!("{} e altri {}", first, mine.len() - 1) };
                            let ctx = file_ctx(&std::path::Path::new(folder).join(first.as_str()))
                                .into_iter()
                                .map(|(k, v)| (k.to_string(), v))
                                .collect();
                            fire.push(((*a).clone(), tf("nuovo file {what}", &[("what", &what)]), ctx));
                        }
                    }
                    folders.insert(folder.clone(), now);
                }
            }

            // Integrations and widgets.
            for (source, kind, text) in &widget_events {
                for a in on.iter().filter(|a| a.trigger.kind == "integration" && &a.trigger.source == source) {
                    let when = if a.trigger.when.is_empty() { "any" } else { a.trigger.when.as_str() };
                    if (when == "any" || when == kind) && matches(&a.trigger.filter, text) {
                        let ctx = vec![("testo".to_string(), text.clone()), ("fonte".to_string(), source.clone())];
                        fire.push(((*a).clone(), text.clone(), ctx));
                    }
                }
            }

            // Events pushed by the other modules: downloads, calls, agents,
            // dev servers, the program in front.
            for e in &events {
                for a in on.iter().filter(|a| a.trigger.kind == e.kind) {
                    let tr = &a.trigger;
                    let ok = match e.kind.as_str() {
                        "foreground" => exe_name(&tr.exe) == e.subject,
                        "agent" => (tr.when == "any" || tr.when == e.when) && matches(&tr.filter, &e.subject),
                        "teams" => tr.when == e.when,
                        _ => matches(&tr.filter, &e.subject),
                    };
                    if ok {
                        let cause = match e.kind.as_str() {
                            "download" => tf("scaricato {what}", &[("what", &e.subject)]),
                            "call" => tf("chiamata da {who}", &[("who", &e.subject)]),
                            "agent" if e.when == "permission" => tf("permesso da {who}", &[("who", &e.subject)]),
                            "agent" => tf("finito: {who}", &[("who", &e.subject)]),
                            "server" => tf("server {what}", &[("what", &e.subject)]),
                            "teams" if e.when == "end" => t("riunione Teams finita").into(),
                            "teams" => t("riunione Teams iniziata").into(),
                            _ => tf("in primo piano {exe}", &[("exe", &e.subject)]),
                        };
                        fire.push(((*a).clone(), cause, e.ctx.clone()));
                    }
                }
            }

            // The "se": looked at only for what is about to run, then how often.
            if !paused && !fire.is_empty() {
                let mut look = Look::default();
                let now = Instant::now();
                let today = key.get(..10).unwrap_or("").to_string();
                for (auto, cause, ctx) in fire {
                    if !auto.conditions.iter().all(|c| holds(c, &mut look)) {
                        continue;
                    }
                    if !repeat_allows(&auto, last_run.get(&auto.id), now, &today) {
                        continue;
                    }
                    last_run.insert(auto.id.clone(), (now, today.clone()));
                    tauri::async_runtime::spawn(run(app.clone(), auto, cause, actions.clone(), ctx));
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

    #[test]
    fn filters_match_extensions_and_words() {
        assert!(matches("", "qualsiasi.txt"));
        assert!(matches(".pdf", "Fattura 12.PDF"));
        assert!(matches("*.pdf, *.docx", "offerta.docx"));
        assert!(!matches(".pdf", "fattura.pdf.exe"));
        assert!(matches("rossi", "Mario Rossi 3331234567"));
        assert!(!matches("bianchi", "Mario Rossi 3331234567"));
        assert!(matches(" , ", "x"));
    }

    #[test]
    fn placeholders_are_filled_and_shaped() {
        let ctx: Ctx = vec![("file".into(), "a b.pdf".into()), ("link".into(), "http://localhost:5173/".into())];
        let plain = |v: &str, _: bool| v.to_string();
        assert_eq!(fill("Scaricato {file}", &ctx, &plain), "Scaricato a b.pdf");
        // Unknown names, a lone brace and multi-byte text stay as they are.
        assert_eq!(fill("{nulla} {file", &ctx, &plain), "{nulla} {file");
        assert_eq!(fill("è {file}à", &ctx, &plain), "è a b.pdfà");
        let url = |v: &str, start: bool| if start { v.to_string() } else { url_encode(v) };
        assert_eq!(fill("https://x.it/?q={file}", &ctx, &url), "https://x.it/?q=a%20b.pdf");
        assert_eq!(fill("{link}docs", &ctx, &url), "http://localhost:5173/docs");
        assert!(uses_ctx("apri {file}", &ctx) && !uses_ctx("apri {altro}", &ctx));
        assert_eq!(stem_of("C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe"), "powershell");
        assert_eq!(stem_of("\"cmd\""), "cmd");
    }

    #[test]
    fn hours_and_repeats() {
        assert!(in_hours(9 * 60, 18 * 60, &[], 12 * 60, 3));
        assert!(!in_hours(9 * 60, 18 * 60, &[1, 2, 3, 4, 5], 12 * 60, 6));
        assert!(!in_hours(9 * 60, 18 * 60, &[], 18 * 60, 3));
        // Across midnight.
        assert!(in_hours(22 * 60, 6 * 60, &[], 23 * 60, 1) && in_hours(22 * 60, 6 * 60, &[], 60, 1));
        assert!(!in_hours(22 * 60, 6 * 60, &[], 12 * 60, 1));
        assert_eq!(hhmm("07:05"), Some(425));
        assert!(hhmm("7:05").is_none() && hhmm("24:00").is_none() && hhmm("é:00").is_none());

        let now = Instant::now();
        let mut a = Automation { repeat: "every".into(), every: 30, ..Default::default() };
        assert!(repeat_allows(&a, None, now, "2026-10-15"));
        let just_now = (now, "2026-10-15".to_string());
        assert!(!repeat_allows(&a, Some(&just_now), now, "2026-10-15"));
        a.repeat = "day".into();
        assert!(!repeat_allows(&a, Some(&just_now), now, "2026-10-15"));
        assert!(repeat_allows(&a, Some(&just_now), now, "2026-10-16"));
        a.repeat.clear();
        assert!(repeat_allows(&a, Some(&just_now), now, "2026-10-15"));
    }

    #[test]
    fn conditions_and_new_triggers_are_checked() {
        let s = crate::settings::Settings::default();
        let ok = validate(&json!({
            "name": "Download in ufficio",
            "trigger": { "kind": "download", "filter": " .pdf " },
            "conditions": [
                { "kind": "hours", "from": "09:00", "to": "18:00", "days": [1, 2, 3, 4, 5] },
                { "kind": "meeting", "not": true },
                { "kind": "idle" }
            ],
            "repeat": "every",
            "steps": [{ "kind": "chat", "text": "Riassumi {percorso}" }]
        }), &s).unwrap();
        assert_eq!(ok.trigger.filter, ".pdf");
        assert_eq!(ok.conditions[2].minutes, 10);
        assert_eq!(ok.every, 60);
        let line = describe(&ok, &s);
        assert!(line.contains("download finito (solo «.pdf»)") && line.contains("non in riunione"), "{line}");

        let agent = validate(&json!({ "name": "x", "trigger": { "kind": "agent", "when": "boh" }, "steps": [{ "kind": "notice", "title": "a" }] }), &s).unwrap();
        assert_eq!(agent.trigger.when, "stop");
        let back = validate(&json!({ "name": "x", "trigger": { "kind": "back" }, "steps": [{ "kind": "notice", "title": "a" }] }), &s).unwrap();
        assert_eq!(back.trigger.minutes, 15);

        let bad = |v: Value| validate(&v, &s).is_err();
        let step = json!([{ "kind": "notice", "title": "a" }]);
        assert!(bad(json!({ "name": "x", "trigger": { "kind": "unlock" }, "conditions": [{ "kind": "luna" }], "steps": step })));
        assert!(bad(json!({ "name": "x", "trigger": { "kind": "unlock" }, "conditions": [{ "kind": "hours", "from": "9", "to": "18:00" }], "steps": step })));
        assert!(bad(json!({ "name": "x", "trigger": { "kind": "foreground" }, "steps": step })));
        assert!(bad(json!({ "name": "x", "trigger": { "kind": "unlock" }, "steps": [{ "kind": "chat", "text": " " }] })));
    }
}
