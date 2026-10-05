// The "3CX" integration: calls, incoming calls, phonebook and status of the
// user's extension on a 3CX V20 PBX, from the island.
//
// Two ways in, chosen in Impostazioni → Integrazioni:
//   - "user": the extension's own login, like the 3CX apps (myphone.rs);
//   - "api":  an API client from the Admin Console (api.rs).
// Either way a live channel (wss.rs) brings the changes; nothing is polled.
// Connected only while the integration is on and EasyIsland is not paused.
// Numbers and names stay in memory: never written to disk.

pub mod api;
pub mod myphone;
pub mod pb;

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Notify;

use crate::integrations::{self, IntegrationUpdate};
use crate::island::WINDOW_LABEL;
use crate::secrets;
use crate::wss::{self, Frame};

pub const ID: &str = "integration_3cx";

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Device {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct Profile {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Call {
    pub id: String,
    /// "ringing" | "dialing" | "connected" | "other"
    pub state: String,
    pub incoming: bool,
    pub name: String,
    pub number: String,
    /// ms since 1970: when it started ringing, or when it was answered.
    pub since: u64,
    pub can_answer: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct Contact {
    pub name: String,
    pub company: String,
    pub numbers: Vec<String>,
    /// An extension of the same PBX.
    pub colleague: bool,
}

#[derive(Serialize, Clone, Debug)]
pub struct HistoryItem {
    pub name: String,
    pub number: String,
    /// "missed" | "received" | "outgoing" | "other"
    pub kind: String,
    pub at: u64,
    pub answered: bool,
}

/// What the island is shown.
#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
struct Snapshot {
    mode: String,
    connected: bool,
    number: String,
    name: String,
    profile: String,
    profiles: Vec<Profile>,
    devices: Vec<Device>,
    device: String,
    calls: Vec<Call>,
    missed: i64,
}

enum Conn {
    User(myphone::Session),
    Api { base: String, token: String, dn: String },
}

#[derive(Default)]
struct Live {
    conn: Option<Arc<Conn>>,
    snapshot: Snapshot,
    error: Option<String>,
    /// Incoming calls already announced to the island.
    announced: HashSet<String>,
    /// Last state of every call, for the log (states only, never numbers or names).
    states: HashMap<String, String>,
}

static LIVE: Mutex<Option<Live>> = Mutex::new(None);
static APP: OnceLock<AppHandle> = OnceLock::new();
static WAKE: OnceLock<Arc<Notify>> = OnceLock::new();
/// Bumped by `refresh`: the running connection ends and starts again with the new settings.
static GENERATION: AtomicU64 = AtomicU64::new(0);
static CLOSER: Mutex<Option<wss::Closer>> = Mutex::new(None);

fn wake() -> Arc<Notify> {
    WAKE.get_or_init(|| Arc::new(Notify::new())).clone()
}

fn live<R>(f: impl FnOnce(&mut Live) -> R) -> R {
    let mut guard = LIVE.lock().unwrap();
    f(guard.get_or_insert_with(Live::default))
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

fn http() -> reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .timeout(Duration::from_secs(15))
                .user_agent("EasyIsland")
                .build()
                .unwrap_or_default()
        })
        .clone()
}

// ── Settings ─────────────────────────────────────────────────────────────────

struct Config {
    api: bool,
    base: String,
    user: String,
    password: String,
    client_id: String,
    secret: String,
    extension: String,
    device: String,
}

/// "pbx.my3cx.it:5001/", "https://pbx…/webclient" → "https://pbx.my3cx.it:5001".
pub fn base_url(raw: &str) -> Option<String> {
    let raw = raw.trim();
    let rest = raw.strip_prefix("https://").or_else(|| raw.strip_prefix("http://")).unwrap_or(raw);
    let host = rest.split(['/', '?', '#']).next()?.trim();
    if host.is_empty() || host.contains(char::is_whitespace) {
        return None;
    }
    Some(format!("https://{host}"))
}

fn config(app: &AppHandle) -> Result<Config, String> {
    let (mode, extension, device) = app
        .try_state::<crate::Shared>()
        .map(|s| {
            let s = s.settings.lock().unwrap();
            let c = &s.integration_config;
            (c.threecx_mode.clone(), c.threecx_extension.trim().to_string(), c.threecx_device.clone())
        })
        .unwrap_or_default();
    let base = base_url(&secrets::get("3cx-url").unwrap_or_default())
        .ok_or("Indirizzo del centralino mancante (Impostazioni → Integrazioni → 3CX)")?;
    let api = mode == "api";
    let cfg = Config {
        api,
        base,
        user: secrets::get("3cx-user").unwrap_or_default(),
        password: secrets::get("3cx-password").unwrap_or_default(),
        client_id: secrets::get("3cx-client-id").unwrap_or_default(),
        secret: secrets::get("3cx-client-secret").unwrap_or_default(),
        extension,
        device,
    };
    if api && (cfg.client_id.is_empty() || cfg.secret.is_empty() || cfg.extension.is_empty()) {
        return Err("Mancano Client ID, chiave API o interno".into());
    }
    if !api && (cfg.user.is_empty() || cfg.password.is_empty()) {
        return Err("Mancano interno (o e-mail) e password".into());
    }
    Ok(cfg)
}

fn wanted(app: &AppHandle) -> bool {
    !integrations::PAUSED.load(Ordering::Relaxed) && integrations::enabled(app, ID)
}

// ── Island updates ───────────────────────────────────────────────────────────

/// Sends the current state to the island; announces calls that just started ringing.
fn publish(app: &AppHandle) {
    let (snapshot, error, ring, changes) = live(|l| {
        let changes = call_changes(&mut l.states, &l.snapshot.calls);
        let ringing: Vec<Call> = l.snapshot.calls.iter().filter(|c| c.incoming && c.state == "ringing").cloned().collect();
        let fresh: Vec<Call> = ringing.iter().filter(|c| !l.announced.contains(&c.id)).cloned().collect();
        l.announced.retain(|id| ringing.iter().any(|c| &c.id == id));
        for c in &fresh {
            l.announced.insert(c.id.clone());
        }
        (l.snapshot.clone(), l.error.clone(), fresh, changes)
    });
    for line in changes {
        crate::log::line(line);
    }
    integrations::emit(
        app,
        IntegrationUpdate { id: ID, data: serde_json::to_value(&snapshot).unwrap_or(Value::Null), error, event: None },
    );
    for c in ring {
        let _ = app.emit_to(WINDOW_LABEL, "threecx-call", &c);
    }
}

/// "3cx: call 50 ringing → connected", "3cx: call 50 ended (was ringing)": what
/// the PBX reported, to check on a real PBX how a call answered elsewhere ends.
fn call_changes(states: &mut HashMap<String, String>, calls: &[Call]) -> Vec<String> {
    let mut out = Vec::new();
    for c in calls {
        let dir = if c.incoming { "in" } else { "out" };
        match states.insert(c.id.clone(), c.state.clone()) {
            None => out.push(format!("3cx: call {} {dir} {}", c.id, c.state)),
            Some(old) if old != c.state => out.push(format!("3cx: call {} {old} → {}", c.id, c.state)),
            _ => {}
        }
    }
    states.retain(|id, old| {
        let keep = calls.iter().any(|c| &c.id == id);
        if !keep {
            out.push(format!("3cx: call {id} ended (was {old})"));
        }
        keep
    });
    out
}

/// Re-sends the last state (the card asks when it first opens).
pub fn publish_now(app: &AppHandle) {
    publish(app);
}

/// Reconnects only when something 3CX cares about changed (on, mode, extension).
pub fn settings_saved(s: &crate::settings::Settings) {
    static LAST: Mutex<String> = Mutex::new(String::new());
    let c = &s.integration_config;
    // The device is not here: the island passes it with every call.
    let key = format!("{}|{}|{}", s.active_integrations.iter().any(|x| x == ID), c.threecx_mode, c.threecx_extension);
    let mut last = LAST.lock().unwrap();
    if *last != key {
        let first = last.is_empty();
        *last = key;
        if !first {
            refresh();
        }
    }
}

/// Settings or credentials changed, the integration was switched, the app was paused.
pub fn refresh() {
    GENERATION.fetch_add(1, Ordering::SeqCst);
    if let Some(c) = CLOSER.lock().unwrap().take() {
        c.close();
    }
    wake().notify_one();
}

fn set_error(app: &AppHandle, e: Option<String>) {
    live(|l| {
        l.error = e;
        l.snapshot.connected = false;
        l.snapshot.calls.clear();
        l.conn = None;
    });
    publish(app);
}

// ── Connection loop ──────────────────────────────────────────────────────────

pub fn spawn(app: AppHandle) {
    let _ = APP.set(app.clone());
    tauri::async_runtime::spawn(async move { run(app).await });
}

async fn wait(secs: Option<u64>) {
    let w = wake();
    match secs {
        Some(s) => {
            let _ = tokio::time::timeout(Duration::from_secs(s), w.notified()).await;
        }
        None => w.notified().await,
    }
}

async fn run(app: AppHandle) {
    let mut delay = 5;
    loop {
        let generation = GENERATION.load(Ordering::SeqCst);
        if !wanted(&app) {
            let was = live(|l| std::mem::take(l).snapshot.connected);
            if was {
                publish(&app);
            }
            wait(None).await;
            continue;
        }
        let result = match config(&app) {
            Err(e) => Err(e),
            Ok(cfg) if cfg.api => run_api(&app, &cfg, generation).await,
            Ok(cfg) => run_user(&app, &cfg, generation).await,
        };
        *CLOSER.lock().unwrap() = None;
        match result {
            // Stopped on purpose (new settings): start again at once.
            Ok(()) => {
                delay = 5;
                live(|l| l.conn = None);
            }
            Err(e) => {
                crate::log::line(format!("3cx: {e}"));
                set_error(&app, Some(e));
                if GENERATION.load(Ordering::SeqCst) == generation {
                    wait(Some(delay)).await;
                    delay = (delay * 2).min(300);
                }
            }
        }
    }
}

/// Opens the live channel on its own thread; frames come back through `rx`.
async fn events(url: String, headers: Vec<(String, String)>) -> Result<tokio::sync::mpsc::UnboundedReceiver<Result<Frame, String>>, String> {
    let ws = tauri::async_runtime::spawn_blocking(move || {
        let h: Vec<(&str, &str)> = headers.iter().map(|(k, v)| (k.as_str(), v.as_str())).collect();
        wss::WebSocket::connect(&url, &h)
    })
    .await
    .map_err(|e| e.to_string())??;
    *CLOSER.lock().unwrap() = Some(ws.closer());
    let (tx, rx) = tokio::sync::mpsc::unbounded_channel();
    std::thread::spawn(move || loop {
        let next = ws.recv();
        let stop = !matches!(next, Ok(Some(_)));
        let msg = match next {
            Ok(Some(f)) => Ok(f),
            Ok(None) => Err("Il centralino ha chiuso il canale degli eventi".to_string()),
            Err(e) => Err(e),
        };
        if tx.send(msg).is_err() || stop {
            break;
        }
    });
    Ok(rx)
}

fn stale(generation: u64) -> bool {
    GENERATION.load(Ordering::SeqCst) != generation
}

async fn run_user(app: &AppHandle, cfg: &Config, generation: u64) -> Result<(), String> {
    let http = http();
    let session = myphone::open(&http, &cfg.base, &cfg.user, &cfg.password).await?;
    let mut rx = events(session.events_url(), Vec::new()).await?;
    // The PBX acknowledges this and sends the extension's state on the live channel
    // (some versions answer with it directly).
    let (reply, info_msg) = session.request(&http, myphone::T_MY_INFO_REQUEST, myphone::my_info()).await?;
    let mut info = myphone::MyInfo::default();
    if reply == myphone::T_MY_INFO {
        info.apply(&info_msg);
    }
    let mut seen: HashMap<i64, (u64, bool)> = HashMap::new();
    // Only the first few message types, for diagnosis: never their content.
    let mut logged = 0;

    let refresh_snapshot = |info: &myphone::MyInfo, seen: &mut HashMap<i64, (u64, bool)>| {
        let calls = info.calls(seen, now_ms());
        live(|l| {
            l.error = None;
            l.snapshot = Snapshot {
                mode: "user".into(),
                connected: true,
                number: info.number.clone(),
                name: format!("{} {}", info.first, info.last).trim().to_string(),
                profile: info.profile.to_string(),
                profiles: info.profiles(),
                devices: info.devices(),
                device: cfg.device.clone(),
                calls,
                missed: info.missed,
            };
        });
    };
    live(|l| l.conn = Some(Arc::new(Conn::User(session))));
    refresh_snapshot(&info, &mut seen);
    publish(app);
    crate::log::line("3cx: connected (login)");

    loop {
        match tokio::time::timeout(Duration::from_secs(60), rx.recv()).await {
            Ok(Some(Ok(Frame::Binary(bytes)))) => {
                if let Some((id, m)) = myphone::unwrap(&bytes) {
                    if logged < 5 {
                        logged += 1;
                        crate::log::line(format!("3cx: event type {id}"));
                    }
                    if id == myphone::T_MY_INFO {
                        info.apply(&m);
                        refresh_snapshot(&info, &mut seen);
                        publish(app);
                    }
                }
            }
            Ok(Some(Ok(Frame::Text(t)))) => {
                if t == "NOT AUTH" || t == "STOP" {
                    return Err("Il centralino ha chiuso la sessione".into());
                }
            }
            Ok(Some(Err(e))) => return if stale(generation) { Ok(()) } else { Err(e) },
            Ok(None) => return if stale(generation) { Ok(()) } else { Err("Canale degli eventi chiuso".into()) },
            Err(_) => {
                if stale(generation) || !wanted(app) {
                    return Ok(());
                }
            }
        }
    }
}

async fn run_api(app: &AppHandle, cfg: &Config, generation: u64) -> Result<(), String> {
    let http = http();
    let token = api::token(&http, &cfg.base, &cfg.client_id, &cfg.secret, now_ms()).await?;
    let dn = cfg.extension.clone();
    let state = api::state(&http, &cfg.base, &token.access, &dn).await?;
    let host = cfg.base.trim_start_matches("https://");
    let mut rx = events(format!("wss://{host}/callcontrol/ws"), vec![("Authorization".into(), format!("Bearer {}", token.access))]).await?;

    let devices = api::devices(&state);
    let mut participants: HashMap<i64, Value> = HashMap::new();
    for p in state["participants"].as_array().cloned().unwrap_or_default() {
        if let Some(id) = p["id"].as_i64() {
            participants.insert(id, p);
        }
    }
    let mut seen: HashMap<i64, (u64, bool)> = HashMap::new();
    let refresh_snapshot = |participants: &HashMap<i64, Value>, seen: &mut HashMap<i64, (u64, bool)>, devices: &Vec<Device>| {
        let now = now_ms();
        let mut calls: Vec<Call> = participants.values().filter_map(|p| api::call(p, seen, now)).collect();
        calls.sort_by_key(|c| c.since);
        seen.retain(|id, _| participants.contains_key(id));
        live(|l| {
            l.error = None;
            l.snapshot = Snapshot {
                mode: "api".into(),
                connected: true,
                number: dn.clone(),
                name: String::new(),
                profile: String::new(),
                profiles: Vec::new(),
                devices: devices.clone(),
                device: cfg.device.clone(),
                calls,
                missed: 0,
            };
        });
    };
    live(|l| l.conn = Some(Arc::new(Conn::Api { base: cfg.base.clone(), token: token.access.clone(), dn: dn.clone() })));
    refresh_snapshot(&participants, &mut seen, &devices);
    publish(app);
    crate::log::line(format!("3cx: connected to {dn} (API)"));

    loop {
        // A new token well before this one expires: reconnect with it.
        let left = token.renew_at.saturating_sub(now_ms()) / 1000;
        if left == 0 {
            return Ok(());
        }
        match tokio::time::timeout(Duration::from_secs(left.min(60)), rx.recv()).await {
            Ok(Some(Ok(Frame::Text(text)))) => {
                let Some((kind, entity)) = api::event(&text) else { continue };
                let pid = entity
                    .split("/participants/")
                    .nth(1)
                    .and_then(|s| s.split('/').next())
                    .and_then(|s| s.parse::<i64>().ok());
                match (kind, pid) {
                    (1, Some(id)) => {
                        participants.remove(&id);
                    }
                    (0, Some(id)) => match api::participant(&http, &cfg.base, &token.access, &entity).await {
                        Ok(p) => {
                            participants.insert(id, p);
                        }
                        Err(_) => {
                            participants.remove(&id);
                        }
                    },
                    // Anything else: read the whole state again.
                    _ => {
                        if let Ok(s) = api::state(&http, &cfg.base, &token.access, &dn).await {
                            participants.clear();
                            for p in s["participants"].as_array().cloned().unwrap_or_default() {
                                if let Some(id) = p["id"].as_i64() {
                                    participants.insert(id, p);
                                }
                            }
                        }
                    }
                }
                refresh_snapshot(&participants, &mut seen, &devices);
                publish(app);
            }
            Ok(Some(Ok(Frame::Binary(_)))) => {}
            Ok(Some(Err(e))) => return if stale(generation) { Ok(()) } else { Err(e) },
            Ok(None) => return if stale(generation) { Ok(()) } else { Err("Canale degli eventi chiuso".into()) },
            Err(_) => {
                if stale(generation) || !wanted(app) {
                    return Ok(());
                }
            }
        }
    }
}

// ── Commands from the island ─────────────────────────────────────────────────

fn conn() -> Result<Arc<Conn>, String> {
    live(|l| l.conn.clone()).ok_or_else(|| "3CX non è collegato".to_string())
}

/// Digits, +, * and #: what a phone can dial. Spaces, dots and dashes are dropped.
pub fn dialable(raw: &str) -> Option<String> {
    let out: String = raw.chars().filter(|c| !matches!(c, ' ' | '.' | '-' | '/' | '(' | ')')).collect();
    let ok = !out.is_empty()
        && out.len() <= 32
        && out.chars().enumerate().all(|(i, c)| c.is_ascii_digit() || c == '*' || c == '#' || (c == '+' && i == 0));
    ok.then_some(out)
}

/// The device that places the call: the chosen one, else the 3CX app for Windows, else the first.
fn pick_device(requested: Option<&str>) -> Option<String> {
    live(|l| {
        let s = &l.snapshot;
        let wanted = requested.filter(|d| !d.is_empty()).map(String::from).or_else(|| Some(s.device.clone()).filter(|d| !d.is_empty()));
        if let Some(d) = wanted {
            if s.devices.iter().any(|x| x.id == d) {
                return Some(d);
            }
        }
        s.devices.iter().find(|d| d.name == "App 3CX per Windows").or(s.devices.first()).map(|d| d.id.clone())
    })
}

pub async fn call(number: &str, device: Option<&str>) -> Result<(), String> {
    let to = dialable(number).ok_or("Numero non valido")?;
    let device = pick_device(device);
    match &*conn()? {
        Conn::User(s) => s.request(&http(), myphone::T_MAKE_CALL, myphone::make_call(&to, device.as_deref())).await.map(|_| ()),
        Conn::Api { base, token, dn } => api::make_call(&http(), base, token, dn, device.as_deref(), &to).await,
    }
}

/// "answer" | "hangup" | "decline".
pub async fn call_action(id: &str, what: &str) -> Result<(), String> {
    let n: i64 = id.parse().map_err(|_| "Chiamata sconosciuta".to_string())?;
    match &*conn()? {
        Conn::User(s) => {
            let (t, body) = match what {
                "answer" => (myphone::T_AUTO_ANSWER, myphone::answer(n)),
                "hangup" | "decline" => (myphone::T_DROP_CALL, myphone::drop_call(n)),
                _ => return Err("Azione sconosciuta".into()),
            };
            s.request(&http(), t, body).await.map(|_| ()).map_err(|e| {
                if what == "answer" { format!("Questo dispositivo non si può far rispondere da qui: {e}") } else { e }
            })
        }
        Conn::Api { base, token, dn } => {
            let action = match what {
                "answer" => "answer",
                "hangup" | "decline" => "drop",
                _ => return Err("Azione sconosciuta".into()),
            };
            api::action(&http(), base, token, dn, id, action).await
        }
    }
}

pub async fn contacts(query: &str) -> Result<Vec<Contact>, String> {
    let q = query.trim();
    if q.chars().count() < 2 {
        return Ok(Vec::new());
    }
    match &*conn()? {
        Conn::User(s) => {
            let (id, m) = s.request(&http(), myphone::T_LOOKUP_CONTACT, myphone::lookup(q, 20)).await?;
            Ok(if id == myphone::T_LOOKUP_RESULT { myphone::contacts(&m) } else { Vec::new() })
        }
        Conn::Api { base, token, .. } => api::contacts(&http(), base, token, q).await,
    }
}

pub async fn history(missed_only: bool) -> Result<Vec<HistoryItem>, String> {
    match &*conn()? {
        Conn::User(s) => {
            let (id, m) = s.request(&http(), myphone::T_CALL_HISTORY, myphone::call_history(missed_only, 20)).await?;
            Ok(if id == myphone::T_CALL_HISTORY_RESULT { myphone::history(&m) } else { Vec::new() })
        }
        Conn::Api { .. } => Err("La cronologia è disponibile solo con l'accesso dell'interno".into()),
    }
}

pub async fn set_status(profile: &str) -> Result<(), String> {
    let id: i64 = profile.parse().map_err(|_| "Stato sconosciuto".to_string())?;
    match &*conn()? {
        Conn::User(s) => s.request(&http(), myphone::T_CHANGE_STATUS, myphone::change_status(id)).await.map(|_| ()),
        Conn::Api { .. } => Err("Lo stato si cambia solo con l'accesso dell'interno".into()),
    }
}

pub async fn reset_missed() -> Result<(), String> {
    match &*conn()? {
        Conn::User(s) => s.request(&http(), myphone::T_RESET_MISSED, pb::Writer::new()).await.map(|_| ()),
        Conn::Api { .. } => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn call_changes_are_logged_without_numbers() {
        let call = |state: &str| Call {
            id: "50".into(), state: state.into(), incoming: true, name: "Cliente".into(),
            number: "+39051".into(), since: 0, can_answer: false,
        };
        let mut states = HashMap::new();
        assert_eq!(call_changes(&mut states, &[call("ringing")]), vec!["3cx: call 50 in ringing"]);
        assert!(call_changes(&mut states, &[call("ringing")]).is_empty());
        assert_eq!(call_changes(&mut states, &[call("connected")]), vec!["3cx: call 50 ringing → connected"]);
        let gone = call_changes(&mut states, &[]);
        assert_eq!(gone, vec!["3cx: call 50 ended (was connected)"]);
        assert!(gone.iter().all(|l| !l.contains("39051") && !l.contains("Cliente")));
    }

    #[test]
    fn urls_and_numbers() {
        assert_eq!(base_url("pbx.my3cx.it:5001/").as_deref(), Some("https://pbx.my3cx.it:5001"));
        assert_eq!(base_url("https://pbx.example.com/webclient/#/people").as_deref(), Some("https://pbx.example.com"));
        assert_eq!(base_url("  "), None);
        assert_eq!(dialable("+39 051 123-45.67").as_deref(), Some("+390511234567"));
        assert_eq!(dialable("*99#").as_deref(), Some("*99#"));
        assert!(dialable("39+051").is_none());
        assert!(dialable("abc").is_none());
        assert!(dialable("").is_none());
    }
}
