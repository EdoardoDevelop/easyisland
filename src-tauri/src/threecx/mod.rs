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
use crate::i18n::{t, tf};

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
    /// SIPDialogID: links the call to one of our WebRTC calls (`RtcCall::dialog`).
    pub dialog: String,
}

/// A call of our WebRTC phone, with the PBX's SDP: the island page does the audio.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RtcCall {
    pub id: i64,
    /// WebRTCEndpointSDPState: 1 offer, 4 request for offer, 8 answer provided, 9 confirmed…
    pub sdp_type: i64,
    pub name: String,
    pub number: String,
    pub transaction: i64,
    pub sdp: String,
    pub dialog: String,
    pub hold: i64,
}

/// Our WebRTC phone, sent to the island as `threecx-webrtc`.
#[derive(Serialize, Clone, Default)]
struct Rtc {
    registered: bool,
    calls: Vec<RtcCall>,
}

/// The device setting that makes EasyIsland itself the phone.
pub const PC_DEVICE: &str = "pc";

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

/// A colleague of the same PBX and how they are right now.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Colleague {
    pub number: String,
    pub name: String,
    /// "available" | "away" | "dnd" | "busy" | "ringing" | "offline"
    pub presence: String,
    /// Their status as they set it ("Pausa pranzo", a custom message…).
    pub status: String,
    /// The call ringing for them, which we can answer in their place.
    pub ringing_call: Option<String>,
    pub mobile: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChatSummary {
    pub id: i64,
    pub name: String,
    /// A visitor of the site, WhatsApp, SMS…: not a colleague.
    pub external: bool,
    pub group: bool,
    /// The colleague's extension in a one-to-one chat (to call them), else "".
    pub number: String,
    pub last: String,
    pub last_at: u64,
    pub last_mine: bool,
    pub unread: i64,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ChatMessage {
    pub id: i64,
    pub conversation: i64,
    pub mine: bool,
    pub from: String,
    pub text: String,
    /// The name of an attached file (the file itself stays on the PBX).
    pub file: Option<String>,
    pub at: u64,
    pub is_new: bool,
    /// Written by the PBX (chat closed, transferred…), not by a person.
    pub system: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Voicemail {
    pub id: i64,
    pub name: String,
    pub number: String,
    pub at: u64,
    pub seconds: i64,
    pub is_new: bool,
    /// The PBX's transcription, when it makes one.
    pub transcription: String,
}

/// Someone is writing in a conversation.
#[derive(Serialize, Clone)]
struct Typing {
    conversation: i64,
    name: String,
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
    /// The colleagues (login mode only).
    team: Vec<Colleague>,
    /// Unread chat messages, all conversations.
    unread: i64,
    /// Conversation id → unread messages.
    unread_by_chat: HashMap<String, i64>,
    voicemail: i64,
    /// Logged in to the queues; None when the extension is in no queue.
    queue: Option<bool>,
    /// EasyIsland is a phone of the extension (WebRTC, "Questo PC" chosen and accepted by the PBX).
    pc: bool,
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
    /// Conversation id → unread chat messages.
    unread: HashMap<i64, i64>,
    /// Our WebRTC phone, re-sent when the card opens.
    rtc: Rtc,
}

impl Live {
    fn set_unread(&mut self, unread: HashMap<i64, i64>) {
        self.unread = unread;
        self.snapshot.unread = self.unread.values().sum();
        self.snapshot.unread_by_chat = self.unread.iter().map(|(k, v)| (k.to_string(), *v)).collect();
    }
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
        .ok_or(t("Indirizzo del centralino mancante (Impostazioni → Integrazioni → 3CX)"))?;
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
        return Err(t("Mancano Client ID, chiave API o interno").into());
    }
    if !api && (cfg.user.is_empty() || cfg.password.is_empty()) {
        return Err(t("Mancano interno (o e-mail) e password").into());

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
    offer_note(app, &snapshot.calls);
    for c in ring {
        crate::automations::on_event(
            "call",
            &format!("{} {}", c.name, c.number),
            "",
            &[("chiamante", if c.name.is_empty() { c.number.clone() } else { c.name.clone() }), ("numero", c.number.clone())],
        );
        let _ = app.emit_to(WINDOW_LABEL, "threecx-call", &c);
    }
}

/// Calls seen answered, by id: when one is gone it ended, and the island
/// offers to note what was said («Annota», src/island/moments.ts).
static ANSWERED: Mutex<Option<HashMap<String, Call>>> = Mutex::new(None);
/// Shorter calls (a wrong number, "richiamo dopo") get no «Annota».
const NOTE_AFTER_MS: u64 = 30_000;

/// The answered calls of `seen` that are no longer in `calls`, with how long
/// they lasted (ms, from the answer to `now`); `seen` learns the new ones.
fn ended_calls(seen: &mut HashMap<String, Call>, calls: &[Call], now: u64) -> Vec<(Call, u64)> {
    for c in calls.iter().filter(|c| c.state == "connected") {
        seen.entry(c.id.clone()).or_insert_with(|| c.clone());
    }
    let gone: Vec<String> = seen.keys().filter(|id| !calls.iter().any(|c| &c.id == *id)).cloned().collect();
    gone.into_iter()
        .filter_map(|id| seen.remove(&id))
        .map(|c| {
            let len = now.saturating_sub(c.since);
            (c, len)
        })
        .collect()
}

/// «Annota» after an answered call of at least NOTE_AFTER_MS (moments.rs).
fn offer_note(app: &AppHandle, calls: &[Call]) {
    let ended = {
        let mut guard = ANSWERED.lock().unwrap();
        ended_calls(guard.get_or_insert_with(HashMap::new), calls, now_ms())
    };
    let on = app.try_state::<crate::Shared>().is_some_and(|s| s.settings.lock().unwrap().moment_calls);
    for (c, len) in ended {
        if !on || len < NOTE_AFTER_MS {
            continue;
        }
        crate::moments::emit(app, serde_json::json!({
            "kind": "call", "name": c.name, "number": c.number, "incoming": c.incoming, "seconds": len / 1000,
        }));
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

/// A 3CX call is on (ringing, dialing or answered, here or on another phone of
/// the extension). "Davanti al cliente" ignores the microphone then: the
/// character must stay, the call is ended from the island.
pub fn in_call() -> bool {
    let guard = LIVE.lock().unwrap();
    guard.as_ref().is_some_and(|l| !l.snapshot.calls.is_empty() || !l.rtc.calls.is_empty())
}

/// Re-sends the last state (the card asks when it first opens).
pub fn publish_now(app: &AppHandle) {
    publish(app);
    let rtc = live(|l| l.rtc.clone());
    let _ = app.emit_to(WINDOW_LABEL, "threecx-webrtc", &rtc);
}

/// Reconnects only when something 3CX cares about changed (on, mode, extension).
pub fn settings_saved(s: &crate::settings::Settings) {
    static LAST: Mutex<String> = Mutex::new(String::new());
    let c = &s.integration_config;
    // The device is not here (the island passes it with every call), except
    // "Questo PC": the session registers as a phone only when it opens.
    let key = format!(
        "{}|{}|{}|{}",
        s.active_integrations.iter().any(|x| x == ID),
        c.threecx_mode,
        c.threecx_extension,
        c.threecx_device == PC_DEVICE
    );
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
        l.rtc = Rtc::default();
    });
    publish(app);
    let _ = app.emit_to(WINDOW_LABEL, "threecx-webrtc", Rtc::default());
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
            Ok(None) => Err(t("Il centralino ha chiuso il canale degli eventi").to_string()),
            Err(e) => Err(e),
        };
        if tx.send(msg).is_err() || stop {
            break;
        }
    });
    Ok(rx)
}

/// New chat messages pushed by the PBX: counted as unread (unless ours) and
/// handed to the island, which shows them in an open chat or announces them.
fn new_messages(app: &AppHandle, m: &pb::Msg, me: &str) {
    let messages: Vec<ChatMessage> = m.msgs(1).iter().filter_map(|x| myphone::chat_message(x, me)).collect();
    if messages.is_empty() {
        return;
    }
    live(|l| {
        let mut unread = std::mem::take(&mut l.unread);
        for msg in messages.iter().filter(|x| x.is_new && !x.mine && !x.system) {
            *unread.entry(msg.conversation).or_insert(0) += 1;
        }
        l.set_unread(unread);
    });
    publish(app);
    for msg in messages {
        let _ = app.emit_to(WINDOW_LABEL, "threecx-chat", &msg);
    }
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
    let mut team = myphone::Team::default();
    let mut rtc = myphone::WebRtc::default();
    // "Questo PC": the session becomes a WebRTC phone of the extension.
    let pc = cfg.device == PC_DEVICE;
    if pc {
        if let Err(e) = session.request(&http, myphone::T_REGISTER_WEBRTC, myphone::register_webrtc(true)).await {
            crate::log::line(format!("3cx: webrtc not registered: {e}"));
        }
    }
    // In at least one queue: the queues pushed on connect are those of the extension.
    let mut in_queues = false;
    // Only the first few message types, for diagnosis: never their content.
    let mut logged = 0;

    let refresh_snapshot = |info: &myphone::MyInfo, team: &myphone::Team, rtc: &myphone::WebRtc, in_queues: bool, seen: &mut HashMap<i64, (u64, bool)>| {
        let calls = info.calls(seen, now_ms());
        live(|l| {
            l.error = None;
            let unread = std::mem::take(&mut l.unread);
            l.snapshot = Snapshot {
                mode: "user".into(),
                connected: true,
                number: info.number.clone(),
                name: format!("{} {}", info.first, info.last).trim().to_string(),
                profile: info.profile.to_string(),
                profiles: info.profiles(),
                // Our own WebRTC phone is "Questo PC", not one of the devices.
                devices: info.devices().into_iter().filter(|d| rtc.contact.is_empty() || d.id != rtc.contact).collect(),
                device: cfg.device.clone(),
                calls,
                missed: info.missed,
                team: team.colleagues(&info.number),
                voicemail: info.new_voicemails,
                queue: in_queues.then_some(info.queue),
                pc: pc && rtc.registered,
                ..Snapshot::default()
            };
            l.set_unread(unread);
        });
    };
    // The unread chat messages, once: then they come pushed.
    if let Ok((reply, m)) = session.request(&http, myphone::T_UNREAD_COUNT, pb::Writer::new()).await {
        if reply == myphone::T_UNREAD {
            live(|l| l.unread = myphone::unread(&m).into_iter().collect());
        }
    }
    live(|l| l.conn = Some(Arc::new(Conn::User(session))));
    refresh_snapshot(&info, &team, &rtc, in_queues, &mut seen);
    publish(app);
    crate::log::line("3cx: connected (login)");

    loop {
        match tokio::time::timeout(Duration::from_secs(60), rx.recv()).await {
            Ok(Some(Ok(Frame::Binary(bytes)))) => {
                if let Some((id, m)) = myphone::unwrap(&bytes) {
                    if logged < 8 {
                        logged += 1;
                        crate::log::line(format!("3cx: event type {id}"));
                    }
                    match id {
                        myphone::T_MY_INFO => info.apply(&m),
                        myphone::T_GROUPS => {
                            let before = team.colleagues(&info.number).len();
                            team.apply(&m);
                            // How many, never who: enough to check a real PBX from the log.
                            let now = team.colleagues(&info.number).len();
                            if now != before && (before == 0 || now == 0) {
                                crate::log::line(format!("3cx: team of {now} colleagues"));
                            }
                        }
                        myphone::T_QUEUES => {
                            // Whole list: in a queue if it has any. A delta can only add one.
                            if m.int(1) == Some(1) {
                                in_queues = !m.msgs(2).is_empty();
                            } else if !m.msgs(2).is_empty() {
                                in_queues = true;
                            }
                        }
                        myphone::T_UNREAD => live(|l| l.set_unread(myphone::unread(&m).into_iter().collect())),
                        myphone::T_WEBRTC => {
                            let was = rtc.registered;
                            rtc.apply(&m);
                            if rtc.registered != was {
                                crate::log::line(format!("3cx: webrtc registered {}", rtc.registered));
                            }
                            let state = Rtc { registered: rtc.registered, calls: rtc.calls() };
                            live(|l| l.rtc = state.clone());
                            let _ = app.emit_to(WINDOW_LABEL, "threecx-webrtc", &state);
                        }
                        myphone::T_MESSAGES => {
                            new_messages(app, &m, &info.number);
                            continue;
                        }
                        myphone::T_TYPING => {
                            let conversation = m.int(3).unwrap_or(0);
                            let name = m.str(2).filter(|s| !s.trim().is_empty()).unwrap_or_default();
                            let _ = app.emit_to(WINDOW_LABEL, "threecx-typing", Typing { conversation, name });
                            continue;
                        }
                        _ => continue,
                    }
                    refresh_snapshot(&info, &team, &rtc, in_queues, &mut seen);
                    publish(app);
                }
            }
            Ok(Some(Ok(Frame::Text(t)))) => {
                if t == "NOT AUTH" || t == "STOP" {
                    return Err(crate::i18n::t("Il centralino ha chiuso la sessione").into());
                }
            }
            Ok(Some(Err(e))) => return if stale(generation) { unregister(pc).await } else { Err(e) },
            Ok(None) => return if stale(generation) { unregister(pc).await } else { Err(t("Canale degli eventi chiuso").into()) },
            Err(_) => {
                if stale(generation) || !wanted(app) {
                    return unregister(pc).await;
                }
            }
        }
    }
}

/// Leaving on purpose (new settings, integration off): our WebRTC phone stops
/// ringing at once instead of when the PBX drops the session.
async fn unregister(pc: bool) -> Result<(), String> {
    if pc {
        let _ = user_request(myphone::T_REGISTER_WEBRTC, myphone::register_webrtc(false)).await;
    }
    Ok(())
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
                ..Snapshot::default()
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
            Ok(None) => return if stale(generation) { Ok(()) } else { Err(t("Canale degli eventi chiuso").into()) },
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
    live(|l| l.conn.clone()).ok_or_else(|| t("3CX non è collegato").to_string())
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
    let to = dialable(number).ok_or(t("Numero non valido"))?;
    let device = pick_device(device);
    match &*conn()? {
        Conn::User(s) => s.request(&http(), myphone::T_MAKE_CALL, myphone::make_call(&to, device.as_deref())).await.map(|_| ()),
        Conn::Api { base, token, dn } => api::make_call(&http(), base, token, dn, device.as_deref(), &to).await,
    }
}

/// "answer" | "hangup" | "decline".
pub async fn call_action(id: &str, what: &str) -> Result<(), String> {
    let n: i64 = id.parse().map_err(|_| t("Chiamata sconosciuta").to_string())?;
    match &*conn()? {
        Conn::User(s) => {
            let (t, body) = match what {
                "answer" => (myphone::T_AUTO_ANSWER, myphone::answer(n)),
                "hangup" | "decline" => (myphone::T_DROP_CALL, myphone::drop_call(n)),
                _ => return Err(t("Azione sconosciuta").into()),
            };
            s.request(&http(), t, body).await.map(|_| ()).map_err(|e| {
                if what == "answer" { tf("Questo dispositivo non si può far rispondere da qui: {e}", &[("e", &e)]) } else { e }
            })
        }
        Conn::Api { base, token, dn } => {
            let action = match what {
                "answer" => "answer",
                "hangup" | "decline" => "drop",
                _ => return Err(t("Azione sconosciuta").into()),
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
        Conn::Api { .. } => Err(t("La cronologia è disponibile solo con l'accesso dell'interno").into()),
    }
}

pub async fn set_status(profile: &str) -> Result<(), String> {
    let id: i64 = profile.parse().map_err(|_| t("Stato sconosciuto").to_string())?;
    match &*conn()? {
        Conn::User(s) => s.request(&http(), myphone::T_CHANGE_STATUS, myphone::change_status(id)).await.map(|_| ()),
        Conn::Api { .. } => Err(t("Lo stato si cambia solo con l'accesso dell'interno").into()),
    }
}

pub async fn reset_missed() -> Result<(), String> {
    match &*conn()? {
        Conn::User(s) => s.request(&http(), myphone::T_RESET_MISSED, pb::Writer::new()).await.map(|_| ()),
        Conn::Api { .. } => Ok(()),
    }
}

/// The login session: team, chat, voicemail and queues only exist there.
fn user_session() -> Result<Arc<Conn>, String> {
    let c = conn()?;
    match &*c {
        Conn::User(_) => Ok(c),
        Conn::Api { .. } => Err(t("Disponibile solo con l'accesso dell'interno").into()),
    }
}

async fn user_request(type_id: i64, body: pb::Writer) -> Result<(i64, pb::Msg), String> {
    let c = user_session()?;
    let Conn::User(s) = &*c else { unreachable!() };
    s.request(&http(), type_id, body).await
}

fn my_number() -> String {
    live(|l| l.snapshot.number.clone())
}

fn connection_id(id: &str) -> Result<i64, String> {
    id.parse().map_err(|_| t("Chiamata sconosciuta").to_string())
}

/// Our connected call handed to `number` (a colleague or any number).
pub async fn transfer(id: &str, number: &str) -> Result<(), String> {
    let to = dialable(number).ok_or(t("Numero non valido"))?;
    user_request(myphone::T_TRANSFER_CALL, myphone::transfer(connection_id(id)?, &to)).await.map(|_| ())
}

/// A call ringing for us sent to `number`, or to our voicemail when `number` is empty.
pub async fn divert(id: &str, number: &str) -> Result<(), String> {
    let n = connection_id(id)?;
    let body = if number.trim().is_empty() {
        myphone::divert(n, &my_number(), true)
    } else {
        myphone::divert(n, &dialable(number).ok_or(t("Numero non valido"))?, false)
    };
    user_request(myphone::T_DIVERT_CALL, body).await.map(|_| ())
}

// ── Ringtone of "Questo PC" ──────────────────────────────────────────────────
//
// The built-in one is synthesised in the page (softphone.ts). The user's own
// is a copy of the file they picked, `ringtone.<ext>` next to the settings:
// their file, not an asset of the app, and never sent anywhere.

const RINGTONE_TYPES: [(&str, &str); 4] = [("mp3", "audio/mpeg"), ("wav", "audio/wav"), ("ogg", "audio/ogg"), ("m4a", "audio/mp4")];
const RINGTONE_MAX: usize = 10 * 1024 * 1024;

fn ringtone_path(ext: &str) -> std::path::PathBuf {
    crate::settings::config_dir().join(format!("ringtone.{ext}"))
}

/// The user's ringtone as a data URL, or None for the built-in one.
pub fn ringtone() -> Option<String> {
    RINGTONE_TYPES.iter().find_map(|(ext, mime)| {
        let bytes = std::fs::read(ringtone_path(ext)).ok()?;
        Some(format!("data:{mime};base64,{}", crate::claude::base64_for(&bytes)))
    })
}

/// Keeps a copy of the picked file as the ringtone (the old one goes).
pub fn set_ringtone(name: &str, data: &[u8]) -> Result<(), String> {
    let ext = name.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
    if !RINGTONE_TYPES.iter().any(|(e, _)| *e == ext) {
        return Err(t("Scegli un file MP3, WAV, OGG o M4A").into());
    }
    if data.is_empty() || data.len() > RINGTONE_MAX {
        return Err(t("La suoneria deve essere più piccola di 10 MB").into());
    }
    clear_ringtone();
    let _ = std::fs::create_dir_all(crate::settings::config_dir());
    std::fs::write(ringtone_path(&ext), data).map_err(|e| tf("Suoneria non salvata: {e}", &[("e", &e)]))
}

/// Back to the built-in ringtone.
pub fn clear_ringtone() {
    for (ext, _) in RINGTONE_TYPES {
        let _ = std::fs::remove_file(ringtone_path(ext));
    }
}

/// "Questo PC" speaks through the island page: WebView2 would ask for the
/// microphone with its own prompt, which an always-on-top island without a
/// frame cannot show well. Only the microphone, only for our page.
pub fn allow_microphone(app: &AppHandle) {
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        COREWEBVIEW2_PERMISSION_KIND, COREWEBVIEW2_PERMISSION_KIND_MICROPHONE, COREWEBVIEW2_PERMISSION_STATE_ALLOW,
    };
    let Some(page) = crate::island::page(app) else { return };
    let _ = page.with_webview(|webview| unsafe {
        let Ok(core) = webview.controller().CoreWebView2() else { return };
        let handler = webview2_com::PermissionRequestedEventHandler::create(Box::new(|_, args| {
            let Some(args) = args else { return Ok(()) };
            let mut kind = COREWEBVIEW2_PERMISSION_KIND::default();
            args.PermissionKind(&mut kind)?;
            if kind == COREWEBVIEW2_PERMISSION_KIND_MICROPHONE {
                args.SetState(COREWEBVIEW2_PERMISSION_STATE_ALLOW)?;
            }
            Ok(())
        }));
        let mut token = 0i64;
        if let Err(e) = core.add_PermissionRequested(&handler, &mut token) {
            crate::log::line(format!("3cx: microphone permission not set: {e}"));
        }
    });
}

/// One step of a call of our WebRTC phone (see `myphone::webrtc_sdp`); the
/// PBX's id of the call (new for an offer that starts one).
pub async fn webrtc(id: i64, sdp_type: i64, transaction: Option<i64>, sdp: &str, destination: &str, replace: Option<i64>) -> Result<i64, String> {
    let to = if destination.is_empty() { String::new() } else { dialable(destination).ok_or(t("Numero non valido"))? };
    let (reply, m) = user_request(myphone::T_WEBRTC_SDP, myphone::webrtc_sdp(id, sdp_type, transaction, sdp, &to, replace)).await?;
    if reply != myphone::T_WEBRTC_SDP_RESULT {
        return Ok(id);
    }
    if m.bool(1) != Some(true) {
        return Err(m.str(2).filter(|s| !s.is_empty()).unwrap_or_else(|| t("Il centralino ha rifiutato la chiamata dal PC").into()));
    }
    Ok(m.int(3).unwrap_or(id))
}

/// A colleague's ringing call answered here.
pub async fn pickup(id: &str, device: Option<&str>) -> Result<(), String> {
    let device = pick_device(device);
    user_request(myphone::T_PICKUP_CALL, myphone::pickup(connection_id(id)?, device.as_deref())).await.map(|_| ())
}

pub async fn set_queue(logged_in: bool) -> Result<(), String> {
    user_request(myphone::T_CHANGE_STATUS, myphone::queue_status(logged_in)).await.map(|_| ())
}

/// The latest conversations, with each one's unread messages.
pub async fn chats() -> Result<Vec<ChatSummary>, String> {
    let (id, m) = user_request(myphone::T_MY_CHAT_PARTIES, myphone::chat_parties(30)).await?;
    if id != myphone::T_CHAT_PARTIES {
        return Ok(Vec::new());
    }
    let me = my_number();
    let mut list = myphone::conversations(&m, &me);
    live(|l| {
        for c in &mut list {
            c.unread = l.unread.get(&c.id).copied().unwrap_or(0);
        }
    });
    Ok(list)
}

/// The latest messages of a conversation (or those before `before`), oldest first.
pub async fn messages(conversation: i64, before: Option<i64>) -> Result<Vec<ChatMessage>, String> {
    let (id, m) = user_request(myphone::T_LAST_MESSAGES, myphone::last_messages(conversation, 30, before)).await?;
    if id != myphone::T_MESSAGES {
        return Ok(Vec::new());
    }
    let me = my_number();
    let mut list: Vec<ChatMessage> = m.msgs(1).iter().filter_map(|x| myphone::chat_message(x, &me)).collect();
    list.sort_by_key(|x| x.id);
    Ok(list)
}

/// The conversation with these colleagues (created if new).
pub async fn chat_with(numbers: &[String]) -> Result<ChatSummary, String> {
    let me = my_number();
    let others: Vec<&str> = numbers.iter().map(|s| s.trim()).filter(|s| !s.is_empty() && *s != me).collect();
    if others.is_empty() {
        return Err(t("Scegli almeno un collega").into());
    }
    let (id, m) = user_request(myphone::T_CREATE_CONVERSATION, myphone::create_conversation(&myphone::party(&me, &others))).await?;
    let info = (id == myphone::T_CONVERSATION_INFO).then(|| m.msg(1)).flatten();
    let mut chat = info.and_then(|i| myphone::conversation(&i, &me)).ok_or(t("Il centralino non ha aperto la conversazione"))?;
    chat.unread = live(|l| l.unread.get(&chat.id).copied().unwrap_or(0));
    Ok(chat)
}

pub async fn send(conversation: i64, text: &str) -> Result<(), String> {
    let text = text.trim();
    if text.is_empty() {
        return Ok(());
    }
    if text.chars().count() > 4000 {
        return Err(t("Messaggio troppo lungo").into());
    }
    user_request(myphone::T_SEND_TO_CONVERSATION, myphone::send_message(conversation, text)).await.map(|_| ())
}

/// The conversation was read on screen: its new messages are marked as received.
pub async fn read(conversation: i64, ids: &[i64]) -> Result<(), String> {
    if !ids.is_empty() {
        user_request(myphone::T_SET_CHAT_RECEIVED, myphone::chat_received(ids)).await?;
    }
    if let Some(app) = APP.get() {
        let changed = live(|l| {
            let mut unread = std::mem::take(&mut l.unread);
            let had = unread.remove(&conversation).is_some();
            l.set_unread(unread);
            had
        });
        if changed {
            publish(app);
        }
    }
    Ok(())
}

/// "Is typing" to the others in the conversation.
pub async fn typing(conversation: i64) -> Result<(), String> {
    user_request(myphone::T_TYPING, myphone::typing(conversation)).await.map(|_| ())
}

pub async fn voicemails() -> Result<Vec<Voicemail>, String> {
    let (id, m) = user_request(myphone::T_GET_VOICEMAILS, myphone::voicemails(20)).await?;
    Ok(if id == myphone::T_VOICEMAILS { myphone::voicemail_list(&m) } else { Vec::new() })
}

/// Plays a voicemail on our phone (the PBX calls it), and marks it heard.
pub async fn play_voicemail(id: i64) -> Result<(), String> {
    user_request(myphone::T_PLAY_VOICEMAIL, myphone::play_voicemail(id)).await?;
    user_request(myphone::T_SET_VOICEMAIL_HEARD, myphone::voicemail_heard(id)).await.map(|_| ())
}

pub async fn voicemail_heard(id: i64) -> Result<(), String> {
    user_request(myphone::T_SET_VOICEMAIL_HEARD, myphone::voicemail_heard(id)).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_answered_call_that_ends_is_offered_once() {
        let call = |id: &str, state: &str, since: u64| Call {
            id: id.into(), state: state.into(), incoming: true, name: "Rossi".into(), number: "0212".into(),
            since, can_answer: false, dialog: String::new(),
        };
        let mut seen = HashMap::new();
        assert!(ended_calls(&mut seen, &[call("1", "ringing", 1_000)], 2_000).is_empty());
        assert!(ended_calls(&mut seen, &[call("1", "connected", 5_000), call("2", "ringing", 6_000)], 7_000).is_empty());
        // 2 rang and was not answered: nothing; 1 ended after 60 s.
        let ended = ended_calls(&mut seen, &[], 65_000);
        assert_eq!(ended.len(), 1);
        assert_eq!((ended[0].0.id.as_str(), ended[0].1), ("1", 60_000));
        assert!(ended_calls(&mut seen, &[], 70_000).is_empty());
    }

    #[test]
    fn call_changes_are_logged_without_numbers() {
        let call = |state: &str| Call {
            id: "50".into(), state: state.into(), incoming: true, name: "Cliente".into(),
            number: "+39051".into(), since: 0, can_answer: false, dialog: String::new(),
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
