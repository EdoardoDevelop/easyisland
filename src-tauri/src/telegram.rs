// The "Telegram" integration: EasyIsland's chat in a Telegram chat, through
// the user's own bot (created with BotFather; the token is in the Credential
// Manager as "telegram-bot-token").
//
// How it works (docs/integrazioni.md → Telegram):
//   * long polling (`getUpdates`, 50 s), never a webhook: no open port, no
//     server in between, only api.telegram.org;
//   * the bot answers one chat only: the one linked with `/start <code>`, the
//     code shown in the settings for 10 minutes (`integrationConfig.telegramChatId`).
//     Everyone else is ignored;
//   * a conversation of its own (`CHAT`), separate from the island's, with its
//     own engine and model (/motore, /modello), never saved as the default.
//     It goes in the chat history as "Telegram · …";
//   * messages sent while the app was not running (PC off, asleep or app
//     closed) are handled as soon as it is back, in order, with one line
//     saying so (asked by Edoardo on 24 Oct 2026: write from the phone, let the
//     PC do it later). Telegram keeps them about 24 hours, then they are lost;
//   * "Modalità terminale": every permission is a Consenti / Nega message with
//     buttons here, never on the island (`request_decision`; Claude Code's hook
//     carries `easyisland_channel`, opencode asks through `opencode::Options::telegram`).
//     With Telegram's own "Automatica" (/automatica, `telegramAuto`) every
//     permission is answered yes at once, except deleting (`asks_anyway`),
//     asked by Edoardo on 17 Oct 2026; the island's "Automatica" is never used;
//   * photos and files sent to the bot land in the Vassoio and go with the
//     question (the caption, or the next message).

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::claude::{Chat, ChatContext};
use crate::i18n::{t, tf};
use crate::log;

pub const ID: &str = "integration_telegram";
const SECRET: &str = "telegram-bot-token";
const API: &str = "https://api.telegram.org";
/// How long a getUpdates waits for a message.
const POLL_SECS: u64 = 50;
/// A Consenti / Nega waits this long: inside the hook's 110 s (hook/src/main.rs).
const DECISION_WAIT: Duration = Duration::from_secs(100);
/// The reply being written is shown at most this often (Telegram's edit limits).
const EDIT_EVERY: Duration = Duration::from_millis(1500);
/// A Telegram message holds 4096 characters; some room for the HTML marks.
const CHUNK: usize = 3500;
/// The Bot API gives bots files up to 20 MB.
const MAX_FILE: u64 = 20 * 1024 * 1024;
/// …and takes uploads from them up to 50 MB.
const MAX_UPLOAD: u64 = 50 * 1024 * 1024;
const LINK_VALID: Duration = Duration::from_secs(600);

/// Telegram's own conversation, and what was picked for it.
static CHAT: LazyLock<Chat> = LazyLock::new(Chat::default);
static PICK: Mutex<Pick> = Mutex::new(Pick { engine: None, model: None });
/// The last answer, for «⇄ Seconda opinione» (second.rs): who wrote it, the
/// question, the text and the message that has the button.
static LAST: Mutex<Option<Last>> = Mutex::new(None);
/// A file sent without a caption: it goes with the next question.
static NEXT_FILE: Mutex<Option<(String, String)>> = Mutex::new(None);
/// A turn is running (one at a time).
static BUSY: AtomicBool = AtomicBool::new(false);
/// Questions written while EasyIsland was not running, answered one after the
/// other once it is back (`run_late`).
static LATE: Mutex<std::collections::VecDeque<(i64, String, Option<ChatContext>)>> = Mutex::new(std::collections::VecDeque::new());
static LATE_RUNNING: AtomicBool = AtomicBool::new(false);
/// Consenti / Nega waiting for a tap: short id → the answer's channel.
static PENDING: LazyLock<Mutex<HashMap<String, tokio::sync::oneshot::Sender<bool>>>> =
    LazyLock::new(|| Mutex::new(HashMap::new()));
/// The files offered by /vassoio (paths; the buttons carry the index).
static TRAY: Mutex<Vec<String>> = Mutex::new(Vec::new());
/// /cartella: the entries shown (relative paths) and the folder they are in.
static WORK: Mutex<(String, Vec<String>)> = Mutex::new((String::new(), Vec::new()));
/// Files received in the Vassoio, for «Nella cartella di lavoro» (names by index).
static RECEIVED: Mutex<Vec<String>> = Mutex::new(Vec::new());
/// The models offered by /modello (the buttons carry the index: 64 bytes at most).
static MODELS: Mutex<Vec<String>> = Mutex::new(Vec::new());
/// The code shown in the settings for linking, and when it was made.
static LINK: Mutex<Option<(String, Instant)>> = Mutex::new(None);
static STATUS: Mutex<Status> = Mutex::new(Status { bot: String::new(), error: None, running: false });
/// The getUpdates in flight: aborted when the token changes (`restart`).
static POLL: Mutex<Option<tokio::task::AbortHandle>> = Mutex::new(None);

struct Pick {
    engine: Option<String>,
    model: Option<String>,
}

#[derive(Clone)]
struct Last {
    engine: String,
    question: String,
    answer: String,
    message: i64,
}

#[derive(Clone)]
struct Status {
    bot: String,
    error: Option<String>,
    running: bool,
}

/// What the settings show.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Info {
    token: bool,
    running: bool,
    bot: String,
    linked: bool,
    name: String,
    error: Option<String>,
}

// ── Settings window ───────────────────────────────────────────────────────────

pub fn info(app: &AppHandle) -> Info {
    let st = STATUS.lock().unwrap().clone();
    let (linked, name) = linked_chat(app).map_or((false, String::new()), |(_, n)| (true, n));
    Info { token: crate::secrets::get(SECRET).is_some(), running: st.running, bot: st.bot, linked, name, error: st.error }
}

/// A fresh six-digit code for `/start <code>`, valid for 10 minutes.
pub fn link_code() -> String {
    let b = crate::msgraph::random(4);
    let n = u32::from_le_bytes([b.first().copied().unwrap_or(0), b.get(1).copied().unwrap_or(0), b.get(2).copied().unwrap_or(0), b.get(3).copied().unwrap_or(0)]);
    let code = format!("{:06}", n % 1_000_000);
    *LINK.lock().unwrap() = Some((code.clone(), Instant::now()));
    code
}

/// "Scollega": the bot answers nobody until the next code.
pub fn unlink(app: &AppHandle) -> Result<(), String> {
    reset_conversation();
    crate::agent::update_settings(app, |s| {
        s.integration_config.telegram_chat_id = 0;
        s.integration_config.telegram_name.clear();
    })
}

/// The token changed: the next getUpdates uses the new one at once.
pub fn restart() {
    if let Some(h) = POLL.lock().unwrap().take() {
        h.abort();
    }
}

// ── Polling ───────────────────────────────────────────────────────────────────

/// On in the current profile or in any other: an automatic profile (away from
/// the PC, in front of a client) must not stop the bot the user is writing to.
fn active(app: &AppHandle) -> bool {
    app.try_state::<crate::Shared>().is_some_and(|s| {
        let s = s.settings.lock().unwrap();
        s.active_integrations.iter().any(|a| a == ID)
            || s.profiles.iter().any(|p| {
                p.values.get("activeIntegrations").and_then(Value::as_array).is_some_and(|a| a.iter().any(|v| v.as_str() == Some(ID)))
            })
    })
}

/// The linked chat and its name, if any.
fn linked_chat(app: &AppHandle) -> Option<(i64, String)> {
    let shared = app.try_state::<crate::Shared>()?;
    let s = shared.settings.lock().unwrap();
    let c = &s.integration_config;
    (c.telegram_chat_id != 0).then(|| (c.telegram_chat_id, c.telegram_name.clone()))
}

fn set_status(change: impl FnOnce(&mut Status)) {
    change(&mut STATUS.lock().unwrap());
}

pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        // Anything older than this was sent while EasyIsland was not running.
        let started = unix_now();
        let mut offset: i64 = 0;
        let mut ready_for = String::new();
        loop {
            let token = if active(&app) && !crate::integrations::PAUSED.load(Ordering::Relaxed) {
                crate::secrets::get(SECRET)
            } else {
                None
            };
            let Some(token) = token else {
                set_status(|s| s.running = false);
                ready_for.clear();
                tokio::time::sleep(Duration::from_secs(5)).await;
                continue;
            };
            if token != ready_for {
                match hello(&token).await {
                    Ok(bot) => {
                        log::line(format!("telegram: collegato al bot @{bot}"));
                        set_status(|s| {
                            s.bot = bot;
                            s.error = None;
                            s.running = true;
                        });
                        ready_for = token.clone();
                        offset = 0;
                    }
                    Err(e) => {
                        set_status(|s| {
                            s.error = Some(e.clone());
                            s.running = false;
                        });
                        log::line(format!("telegram: {e}"));
                        tokio::time::sleep(Duration::from_secs(30)).await;
                        continue;
                    }
                }
            }

            let poll = tokio::spawn(get_updates(token.clone(), offset));
            *POLL.lock().unwrap() = Some(poll.abort_handle());
            let updates = match poll.await {
                Ok(r) => r,
                // Aborted: the token changed, start over with the new one.
                Err(_) => {
                    ready_for.clear();
                    continue;
                }
            };
            match updates {
                Ok(list) => {
                    set_status(|s| s.error = None);
                    let mut offline: Option<(i64, usize)> = None;
                    for u in &list {
                        if let Some(id) = u.get("update_id").and_then(Value::as_i64) {
                            offset = offset.max(id + 1);
                        }
                        if let Some(chat) = handle(&app, &token, u, started).await {
                            offline = Some((chat, offline.map_or(1, |(_, n)| n + 1)));
                        }
                    }
                    if let Some((chat, n)) = offline {
                        let text = tf("Ero spento: ora elaboro i messaggi che mi hai scritto nel frattempo ({n}).", &[("n", &n)]);
                        let _ = send(&token, chat, &text, None).await;
                    }
                }
                Err(e) => {
                    log::line(format!("telegram: {e}"));
                    set_status(|s| s.error = Some(e));
                    tokio::time::sleep(Duration::from_secs(10)).await;
                }
            }
        }
    });
}

/// getMe (the bot's name) and the command menu Telegram shows.
async fn hello(token: &str) -> Result<String, String> {
    let me = call(token, "getMe", json!({}), 20).await?;
    let bot = me.get("username").and_then(Value::as_str).unwrap_or_default().to_string();
    let commands = json!({ "commands": [
        { "command": "motore", "description": t("Scegli il motore della chat") },
        { "command": "modello", "description": t("Scegli il modello del motore") },
        { "command": "nuova", "description": t("Nuova conversazione") },
        { "command": "riprendi", "description": t("Continua qui l'ultima chat dell'isola") },
        { "command": "stop", "description": t("Ferma la risposta in corso") },
        { "command": "oggi", "description": t("La tua giornata di oggi") },
        { "command": "domani", "description": t("La tua giornata di domani") },
        { "command": "notizie", "description": t("Le ultime notizie sui tuoi argomenti") },
        { "command": "compito", "description": t("Un obiettivo che EasyIsland porta avanti da solo") },
        { "command": "rispondi", "description": t("Rispondi alla domanda di un compito") },
        { "command": "stato", "description": t("Motore, modello e modalità") },
        { "command": "vassoio", "description": t("I file del Vassoio") },
        { "command": "cartella", "description": t("La cartella di lavoro") },
        { "command": "aiuto", "description": t("Cosa posso fare") },
    ]});
    let _ = call(token, "setMyCommands", commands, 20).await;
    Ok(bot)
}

async fn get_updates(token: String, offset: i64) -> Result<Vec<Value>, String> {
    let body = json!({ "offset": offset, "timeout": POLL_SECS, "allowed_updates": ["message", "callback_query"] });
    let v = call(&token, "getUpdates", body, POLL_SECS + 20).await?;
    Ok(v.as_array().cloned().unwrap_or_default())
}

/// One update. Returns the chat to tell "I was off" when it is an old message
/// (handled anyway, after the ones before it).
async fn handle(app: &AppHandle, token: &str, u: &Value, started: i64) -> Option<i64> {
    if let Some(q) = u.get("callback_query") {
        on_button(app, token, q).await;
        return None;
    }
    let m = u.get("message")?;
    let chat = m.pointer("/chat/id").and_then(Value::as_i64)?;
    let private = m.pointer("/chat/type").and_then(Value::as_str) == Some("private");
    let text = m.get("text").or_else(|| m.get("caption")).and_then(Value::as_str).unwrap_or_default().trim().to_string();
    let owner = linked_chat(app).map(|(id, _)| id);

    // Linking: `/start <code>` from a private chat, with the code of the settings.
    if let Some(code) = text.strip_prefix("/start").map(str::trim).filter(|c| !c.is_empty()) {
        if private && owner != Some(chat) {
            link(app, token, chat, m, code).await;
            return None;
        }
    }
    if owner != Some(chat) || !private {
        return None;
    }
    let date = m.get("date").and_then(Value::as_i64).unwrap_or(0);
    let late = date < started;
    let result = handle_message(app, token, chat, m, text, late.then_some(date)).await;
    late.then_some(chat).or(result)
}

/// A message of the linked chat. `late`: when it was written, if EasyIsland
/// was not running then.
async fn handle_message(app: &AppHandle, token: &str, chat: i64, m: &Value, text: String, late: Option<i64>) -> Option<i64> {

    notify_island(app, &text);
    if let Some(cmd) = text.strip_prefix('/') {
        command(app, token, chat, cmd).await;
        return None;
    }

    // A file: in the Vassoio, then with the caption or the next question.
    let mut context = None;
    let mut query = text;
    // A voice message (and, with «Vocali» on, an audio file): its words are the question.
    let voice = m.get("voice").or_else(|| if voice_service(app).is_empty() { None } else { m.get("audio") });
    if let Some(v) = voice {
        match hear(app, token, v).await {
            Ok(words) => {
                let _ = send(token, chat, &format!("🎙 «{words}»"), None).await;
                query = if query.is_empty() { words } else { format!("{query}

{words}") };
            }
            Err(e) => {
                let _ = send(token, chat, &format!("⚠️ {e}"), None).await;
                return None;
            }
        }
    } else if let Some(file) = file_of(m) {
        match download(app, token, &file).await {
            Ok((name, path)) => {
                if query.is_empty() {
                    let msg = tf("«{name}» è nel Vassoio. Scrivimi cosa vuoi farne.", &[("name", &name)]);
                    let keyboard = crate::workdir::root(app).map(|_| {
                        let mut r = RECEIVED.lock().unwrap();
                        r.push(name.clone());
                        let n = r.len() - 1;
                        json!({ "inline_keyboard": [[{ "text": format!("📁 {}", t("Sposta nella cartella di lavoro")), "callback_data": format!("w:{n}") }]] })
                    });
                    let _ = send(token, chat, &msg, keyboard).await;
                    *NEXT_FILE.lock().unwrap() = Some((name, path));
                    return None;
                }
                context = Some((name, path));
            }
            Err(e) => {
                let _ = send(token, chat, &format!("⚠️ {e}"), None).await;
                return None;
            }
        }
    } else if m.get("sticker").is_some() || m.get("location").is_some() {
        let _ = send(token, chat, t("Per ora leggo testo, foto, file e vocali."), None).await;
        return None;
    }
    if query.is_empty() {
        return None;
    }
    // Late ones, and new ones while late ones are still being answered, queue up.
    if late.is_some() || LATE_RUNNING.load(Ordering::SeqCst) {
        // The engine must know it is not "now": "domani" meant the day it was written.
        let query = match late {
            Some(date) => {
                let minutes = ((unix_now() - date) / 60).max(1);
                let when = if minutes < 120 { tf("circa {n} minuti fa", &[("n", &minutes)]) } else { tf("circa {n} ore fa", &[("n", &(minutes / 60))]) };
                format!("{}

{query}", tf("(Messaggio scritto {when}, mentre EasyIsland era spento.)", &[("when", &when)]))
            }
            None => query,
        };
        let context = context.or_else(|| NEXT_FILE.lock().unwrap().take()).map(|(name, path)| ChatContext::File { name, path });
        LATE.lock().unwrap().push_back((chat, query, context));
        run_late(app, token);
        return None;
    }
    if BUSY.load(Ordering::SeqCst) {
        let _ = send(token, chat, t("Sto ancora rispondendo alla domanda di prima: aspetta la risposta o fermala con ⏹ Ferma (o /stop)."), None).await;
        return None;
    }
    let context = context.or_else(|| NEXT_FILE.lock().unwrap().take()).map(|(name, path)| {
        // Most engines read an attachment with the first message only; later
        // on, the ones with tools can still open it from its path.
        if !CHAT.is_empty() {
            query = format!("{}\n\n{query}", tf("File allegato: {name}\nPercorso: {path}", &[("name", &name), ("path", &path)]));
        }
        ChatContext::File { name, path }
    });
    BUSY.store(true, Ordering::SeqCst);
    let (app, token) = (app.clone(), token.to_string());
    tauri::async_runtime::spawn(async move {
        turn(&app, &token, chat, query, context, None).await;
        BUSY.store(false, Ordering::SeqCst);
    });
    None
}

/// Answers the late questions one at a time, each when no other turn runs.
fn run_late(app: &AppHandle, token: &str) {
    if LATE_RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    let (app, token) = (app.clone(), token.to_string());
    tauri::async_runtime::spawn(async move {
        loop {
            let Some((chat, query, context)) = LATE.lock().unwrap().pop_front() else { break };
            while BUSY.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst).is_err() {
                tokio::time::sleep(Duration::from_secs(1)).await;
            }
            turn(&app, &token, chat, query, context, None).await;
            BUSY.store(false, Ordering::SeqCst);
        }
        LATE_RUNNING.store(false, Ordering::SeqCst);
        // Something added between the last pop and the flag going down.
        if !LATE.lock().unwrap().is_empty() {
            run_late(&app, &token);
        }
    });
}

async fn link(app: &AppHandle, token: &str, chat: i64, m: &Value, code: &str) {
    let ok = {
        let mut link = LINK.lock().unwrap();
        let good = link.as_ref().is_some_and(|(c, at)| c == code && at.elapsed() < LINK_VALID);
        if good {
            *link = None;
        }
        good
    };
    if !ok {
        let _ = send(token, chat, t("Codice non valido o scaduto. Prendine uno nuovo in EasyIsland: Impostazioni → Integrazioni → Telegram."), None).await;
        return;
    }
    let first = m.pointer("/from/first_name").and_then(Value::as_str).unwrap_or_default();
    let user = m.pointer("/from/username").and_then(Value::as_str).map(|u| format!(" (@{u})")).unwrap_or_default();
    let name = format!("{first}{user}").trim().to_string();
    reset_conversation();
    match crate::agent::update_settings(app, |s| {
        s.integration_config.telegram_chat_id = chat;
        s.integration_config.telegram_name = name.clone();
    }) {
        Ok(()) => {
            log::line("telegram: chat collegata");
            let _ = send(token, chat, &format!("✅ {}\n\n{}", t("Collegato a EasyIsland."), help()), None).await;
        }
        Err(e) => {
            let _ = send(token, chat, &format!("⚠️ {e}"), None).await;
        }
    }
}

/// A short notice on the island: someone is using the chat from Telegram.
fn notify_island(app: &AppHandle, text: &str) {
    let text: String = text.chars().take(120).collect();
    let _ = app.emit_to(crate::island::WINDOW_LABEL, "hook", json!({
        "hook_event_name": "EasyIslandNotify",
        "title": "Telegram",
        "text": if text.is_empty() { t("File ricevuto").to_string() } else { text },
        "level": "info",
        "url": "",
    }));
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// News in /notizie, at most.
const TELEGRAM_NEWS: usize = 8;

fn help() -> String {
    [
        t("Scrivimi come nella chat dell'isola: rispondo con il motore scelto."),
        t("/motore — scegli il motore (solo per questa conversazione)"),
        t("/modello — scegli il modello"),
        t("/nuova — nuova conversazione"),
        t("/riprendi — continua qui l'ultima conversazione della chat dell'isola"),
        t("/stop — ferma la risposta in corso (anche ⏹ Ferma sotto la risposta)"),
        t("/oggi e /domani — la giornata: appuntamenti, posta, ticket, attività di Notion, meteo"),
        t("/notizie — le ultime notizie sugli argomenti che segui"),
        t("/compito … — un obiettivo che EasyIsland porta avanti da solo; /compito da solo elenca i compiti"),
        t("/rispondi … — la risposta alla domanda di un compito che aspetta"),
        t("/nome-abilità … — usa una delle tue abilità"),
        t("/stato — motore, modello e modalità"),
        t("/automatica — niente permessi da confermare, tranne le cancellazioni"),
        t("/vassoio — i file del Vassoio, da farti mandare qui"),
        t("/cartella — la cartella di lavoro: apri le cartelle, fatti mandare i file"),
        t("Foto e file finiscono nel Vassoio e vanno con la domanda."),
    ]
    .join("\n")
}

/// /oggi and /domani (asked by Edoardo: the day, from the integrations, in a
/// friendly way). The engine gathers it with the easyisland tools.
pub(crate) fn day_prompt(tomorrow: bool) -> String {
    let when = if tomorrow { t("domani") } else { t("oggi") };
    tf(
        "Fammi il punto della mia giornata di {when}, in modo amichevole e breve. Usa gli strumenti di easyisland: list_status (appuntamenti e posta di Outlook, ticket, meteo, PC) e, se c'è Notion, notion_query sui database di attività per quelle con scadenza {when} e quelle scadute non ancora fatte, e todo_list per le attività di To Do. Prima le cose da fare, con l'ora se c'è, poi il resto in poche righe. Se uno strumento non c'è o non risponde, salta quella parte senza dirlo a lungo. Non cambiare niente.",
        &[("when", &when)],
    )
}

async fn command(app: &AppHandle, token: &str, chat: i64, cmd: &str) {
    // "/motore@NomeBot argomento"
    let (name, arg) = cmd.split_once(char::is_whitespace).unwrap_or((cmd, ""));
    let name = name.split('@').next().unwrap_or_default().to_lowercase();
    let arg = arg.trim();
    match name.as_str() {
        "start" | "aiuto" | "help" => {
            let _ = send(token, chat, &help(), None).await;
        }
        // The island's last conversation, carried on here (asked on 21 October 2026).
        "riprendi" | "resume" => {
            if BUSY.load(Ordering::SeqCst) {
                let _ = send(token, chat, t("Aspetta la fine della risposta in corso."), None).await;
                return;
            }
            let Some(last) = crate::chat_log::list().into_iter().max_by_key(|c| c.updated) else {
                let _ = send(token, chat, t("Non c'è nessuna conversazione da riprendere."), None).await;
                return;
            };
            reset_conversation();
            let key = crate::chat_key_for(app, &last.engine);
            match crate::chat_log::open(&CHAT, &last.id, &key) {
                Ok(opened) => {
                    *PICK.lock().unwrap() = Pick { engine: Some(opened.engine.clone()), model: None };
                    let answer = opened.lines.iter().rev().find(|l| l.role == "assistant").map(|l| l.content.clone()).unwrap_or_default();
                    let text = tf(
                        "Ripresa «{title}» ({n} domande). L'ultima risposta:\n\n{answer}\n\nContinua da qui.",
                        &[("title", &last.title), ("n", &last.turns), ("answer", &tail(&answer, 1500))],
                    );
                    let _ = send(token, chat, &text, None).await;
                }
                Err(e) => {
                    let _ = send(token, chat, &e, None).await;
                }
            }
        }
        "nuova" | "new" => {
            if BUSY.load(Ordering::SeqCst) {
                let _ = send(token, chat, t("Aspetta la fine della risposta in corso."), None).await;
                return;
            }
            reset_conversation();
            let _ = send(token, chat, t("Nuova conversazione."), None).await;
        }
        // The day at a glance, written by the chat's engine with EasyIsland's tools.
        "oggi" | "today" | "domani" | "tomorrow" => {
            if BUSY.load(Ordering::SeqCst) {
                let _ = send(token, chat, t("Aspetta la fine della risposta in corso."), None).await;
                return;
            }
            let query = day_prompt(matches!(name.as_str(), "domani" | "tomorrow"));
            BUSY.store(true, Ordering::SeqCst);
            let (app, token) = (app.clone(), token.to_string());
            tauri::async_runtime::spawn(async move {
                turn(&app, &token, chat, query, None, None).await;
                BUSY.store(false, Ordering::SeqCst);
            });
        }
        // The answer to a task's question (tasks.rs task_ask).
        "rispondi" | "answer" => {
            let text = match crate::flows::answer_latest(arg).map_or_else(|| crate::tasks::answer_latest(app, arg), Ok) {
                Ok(title) => tf("Risposta data a «{title}».", &[("title", &title)]),
                Err(e) => e,
            };
            let _ = send(token, chat, &text, None).await;
        }
        // Compiti (tasks.rs): a new one, or the list.
        "compito" | "compiti" | "task" => {
            let text = if arg.trim().is_empty() {
                crate::tasks::tool_list()
            } else {
                match crate::tasks::create(app, "", arg, "", "") {
                    Ok(task) => tf("Compito «{title}» in coda. Ti scrivo qui quando ha finito o se mi serve qualcosa.", &[("title", &task.title)]),
                    Err(e) => e,
                }
            };
            let _ = send(token, chat, &text, None).await;
        }
        "stop" | "ferma" => {
            if BUSY.load(Ordering::SeqCst) {
                crate::stop_turn(true);
            } else {
                let _ = send(token, chat, t("Non sto facendo niente da fermare."), None).await;
            }
        }
        "cartella" | "folder" => {
            show_folder(app, token, chat, arg, None).await;
        }
        // «Notizie» (news.rs): the latest found, a link each; nothing searched here.
        "notizie" | "news" => {
            let items = crate::news::latest(TELEGRAM_NEWS);
            if items.is_empty() {
                let _ = send(token, chat, t("Nessuna notizia: scegli gli argomenti da seguire in Impostazioni → Notizie."), None).await;
                return;
            }
            let mut html = format!("<b>{}</b>", escape(t("Notizie")));
            for n in items {
                html.push_str(&format!(
                    "\n\n• <a href=\"{}\">{}</a>\n<i>{} · {}</i>",
                    escape(&n.link).replace('"', "&quot;"),
                    escape(&n.title),
                    escape(&n.source),
                    escape(&n.topic)
                ));
            }
            let body = json!({ "chat_id": chat, "text": html, "parse_mode": "HTML", "link_preview_options": { "is_disabled": true } });
            if let Err(e) = call(token, "sendMessage", body, 20).await {
                let _ = send(token, chat, &format!("⚠️ {e}"), None).await;
            }
        }
        "vassoio" | "tray" => {
            let files: Vec<crate::files::InboxFile> = crate::files::list_inbox().into_iter().take(10).collect();
            if files.is_empty() {
                let _ = send(token, chat, t("Il Vassoio è vuoto."), None).await;
                return;
            }
            *TRAY.lock().unwrap() = files.iter().map(|f| f.path.clone()).collect();
            let rows: Vec<Value> = files
                .iter()
                .enumerate()
                .map(|(i, f)| json!([{ "text": format!("{} ({})", f.name, size_text(f.size)), "callback_data": format!("f:{i}") }]))
                .collect();
            let _ = send(token, chat, t("Quale file ti mando?"), Some(json!({ "inline_keyboard": rows }))).await;
        }
        "automatica" | "auto" => {
            let on = match arg.to_lowercase().as_str() {
                "on" | "si" | "sì" | "1" => true,
                "off" | "no" | "0" => false,
                _ => !auto_on(app),
            };
            let saved = crate::agent::update_settings(app, |s| s.integration_config.telegram_auto = on);
            let msg = match saved {
                Err(e) => format!("⚠️ {e}"),
                Ok(()) if on => t("Automatica accesa: in modalità terminale comandi e modifiche vanno senza chiedere; le cancellazioni chiedono ancora.").to_string(),
                Ok(()) => t("Automatica spenta: ogni permesso chiede Consenti / Nega.").to_string(),
            };
            let _ = send(token, chat, &msg, None).await;
        }
        "stato" | "status" => {
            let _ = send(token, chat, &status_text(app), None).await;
        }
        "motore" | "engine" => {
            let current = current_engine(app);
            let rows: Vec<Value> = engines(app)
                .into_iter()
                .filter(|(_, _, ready)| *ready)
                .map(|(id, name, _)| {
                    let mark = if id == current { "✓ " } else { "" };
                    json!([{ "text": format!("{mark}{name}"), "callback_data": format!("e:{id}") }])
                })
                .collect();
            if rows.is_empty() {
                let _ = send(token, chat, t("Nessun motore pronto: sceglilo in EasyIsland, Impostazioni → Chat."), None).await;
                return;
            }
            let _ = send(token, chat, t("Con quale motore rispondo? Vale solo per questa conversazione."), Some(json!({ "inline_keyboard": rows }))).await;
        }
        "modello" | "model" if !arg.is_empty() => {
            set_model(Some(arg.to_string()));
            let msg = tf("Modello: {m}. Nuova conversazione.", &[("m", &arg)]);
            let _ = send(token, chat, &msg, None).await;
        }
        "modello" | "model" => {
            let engine = current_engine(app);
            let list = models(app, &engine).await;
            let current = current_model(app, &engine);
            *MODELS.lock().unwrap() = list.clone();
            let mut rows: Vec<Value> = list
                .iter()
                .enumerate()
                .map(|(i, m)| {
                    let mark = if *m == current { "✓ " } else { "" };
                    json!([{ "text": format!("{mark}{m}"), "callback_data": format!("m:{i}") }])
                })
                .collect();
            rows.push(json!([{ "text": t("Quello delle impostazioni"), "callback_data": "m:-" }]));
            let text = format!(
                "{}\n{}",
                tf("Modello in uso: {m}", &[("m", &if current.is_empty() { "—".to_string() } else { current })]),
                t("Scegline uno, oppure scrivi /modello seguito dal nome."),
            );
            let _ = send(token, chat, &text, Some(json!({ "inline_keyboard": rows }))).await;
        }
        // A skill of the user (skills.rs): its instructions, then the words after it.
        other => {
            let Some(skill) = crate::skills::find(other) else {
                let _ = send(token, chat, &help(), None).await;
                return;
            };
            if BUSY.load(Ordering::SeqCst) {
                let _ = send(token, chat, t("Aspetta la fine della risposta in corso."), None).await;
                return;
            }
            let query = crate::skills::as_prompt(&skill, arg);
            BUSY.store(true, Ordering::SeqCst);
            let (app, token) = (app.clone(), token.to_string());
            tauri::async_runtime::spawn(async move {
                turn(&app, &token, chat, query, None, None).await;
                BUSY.store(false, Ordering::SeqCst);
            });
        }
    }
}

/// /cartella: the folder's entries as buttons (folders open, files are sent).
/// `replace`: the message of the folder before, edited in place.
async fn show_folder(app: &AppHandle, token: &str, chat: i64, rel: &str, replace: Option<i64>) {
    let listing = match crate::workdir::list(app, rel.trim().trim_matches('/')) {
        Ok(l) => l,
        Err(e) => {
            let msg = format!("⚠️ {e}");
            let _ = send(token, chat, &msg, None).await;
            return;
        }
    };
    let shown: Vec<&crate::workdir::Entry> = listing.entries.iter().take(40).collect();
    *WORK.lock().unwrap() = (listing.rel.clone(), shown.iter().map(|e| e.rel.clone()).collect());
    let mut rows: Vec<Value> = Vec::new();
    if !listing.rel.is_empty() {
        rows.push(json!([{ "text": format!("⬆️ {}", t("Su")), "callback_data": "c:.." }]));
    }
    for (i, e) in shown.iter().enumerate() {
        let label = if e.dir { format!("📁 {}", e.name) } else { format!("{} ({})", e.name, size_text(e.size)) };
        rows.push(json!([{ "text": label, "callback_data": format!("c:{i}") }]));
    }
    let place = if listing.rel.is_empty() { listing.root.clone() } else { format!("{}\\{}", listing.root, listing.rel.replace('/', "\\")) };
    let mut text = format!("📁 {place}");
    if shown.is_empty() {
        text.push_str(&format!("\n{}", t("(vuota)")));
    } else if listing.entries.len() > shown.len() {
        text.push_str(&format!("\n{}", tf("Mostrati i primi {n}: chiedi alla chat per gli altri.", &[("n", &shown.len())])));
    }
    let keyboard = json!({ "inline_keyboard": rows });
    if let Some(mid) = replace {
        let body = json!({ "chat_id": chat, "message_id": mid, "text": text, "reply_markup": keyboard });
        if call(token, "editMessageText", body, 20).await.is_ok() {
            return;
        }
    }
    let _ = send(token, chat, &text, Some(keyboard)).await;
}

fn reset_conversation() {
    let before = CHAT.cli_session();
    CHAT.reset();
    crate::opencode::forget(before);
    *LAST.lock().unwrap() = None;
    *NEXT_FILE.lock().unwrap() = None;
}

fn set_model(model: Option<String>) {
    PICK.lock().unwrap().model = model;
    reset_conversation();
}

/// The engines of the chat (ids as in CHAT_ENGINES, src/core/state.ts), with
/// whether each one can answer now.
pub(crate) fn engines(app: &AppHandle) -> Vec<(&'static str, String, bool)> {
    let models = app
        .try_state::<crate::Shared>()
        .map(|s| s.settings.lock().unwrap().engine_models.clone())
        .unwrap_or_default();
    let has_model = |e: &str| models.get(e).is_some_and(|m| !m.trim().is_empty());
    let mut list = vec![
        ("subscription", t("Claude (abbonamento)").to_string(), crate::claude_cli::find_claude().is_some()),
        ("api", t("Claude (chiave API)").to_string(), crate::secrets::get("anthropic-api-key").is_some()),
        ("opencode", "opencode".to_string(), crate::opencode::find_exe().is_some() && has_model("opencode")),
        ("antigravity", "Antigravity".to_string(), crate::antigravity::find_exe().is_some()),
    ];
    for e in crate::openai::ENGINES {
        if let Some(p) = crate::openai::provider(e) {
            let key = p.key.is_none_or(|k| crate::secrets::get(k).is_some());
            let name = if *e == "gemini" { "Gemini" } else { p.name };
            list.push((*e, name.to_string(), key && has_model(e)));
        }
    }
    list
}

fn current_engine(app: &AppHandle) -> String {
    PICK.lock().unwrap().engine.clone().unwrap_or_else(|| {
        app.try_state::<crate::Shared>().map(|s| s.settings.lock().unwrap().chat_engine.clone()).unwrap_or_default()
    })
}

fn current_model(app: &AppHandle, engine: &str) -> String {
    if let Some(m) = PICK.lock().unwrap().model.clone() {
        return m;
    }
    let Some(shared) = app.try_state::<crate::Shared>() else { return String::new() };
    let s = shared.settings.lock().unwrap();
    match engine {
        "api" => s.model.clone(),
        "subscription" => s.cli_model.clone(),
        e => s.engine_models.get(e).cloned().unwrap_or_default(),
    }
}

/// What /modello offers: Claude's names, or the first models the engine lists.
async fn models(app: &AppHandle, engine: &str) -> Vec<String> {
    let url = app.try_state::<crate::Shared>().and_then(|s| s.settings.lock().unwrap().engine_urls.get(engine).cloned());
    let list = match engine {
        "subscription" => return ["opus", "sonnet", "haiku"].map(String::from).to_vec(),
        "api" => return [crate::claude::DEFAULT_MODEL, "claude-sonnet-5-5", "claude-haiku-5-5"].map(String::from).to_vec(),
        "opencode" => crate::opencode::models().await,
        "antigravity" => crate::antigravity::models().await,
        e => crate::openai::models(e, url.as_deref()).await,
    };
    list.map(|l| l.into_iter().map(|m| m.id).take(12).collect()).unwrap_or_default()
}

fn status_text(app: &AppHandle) -> String {
    let engine = current_engine(app);
    let name = engines(app).into_iter().find(|(id, _, _)| *id == engine).map(|(_, n, _)| n).unwrap_or(engine.clone());
    let model = current_model(app, &engine);
    let terminal = app.try_state::<crate::Shared>().is_some_and(|s| s.settings.lock().unwrap().chat_terminal);
    let mode = match (terminal, auto_on(app)) {
        (false, _) => t("chat semplice"),
        (true, true) => t("modalità terminale, automatica: chiede solo per le cancellazioni"),
        (true, false) => t("modalità terminale: comandi e file con Consenti / Nega qui"),
    };
    let model = if model.is_empty() { "—".to_string() } else { model };
    format!(
        "{}\n{}\n{}",
        tf("Motore: {e}", &[("e", &name)]),
        tf("Modello: {m}", &[("m", &model)]),
        tf("Modalità: {m}", &[("m", &mode)]),
    )
}

// ── Buttons ───────────────────────────────────────────────────────────────────

async fn on_button(app: &AppHandle, token: &str, q: &Value) {
    let id = q.get("id").and_then(Value::as_str).unwrap_or_default().to_string();
    let data = q.get("data").and_then(Value::as_str).unwrap_or_default();
    let from = q.pointer("/message/chat/id").and_then(Value::as_i64);
    let message = q.pointer("/message/message_id").and_then(Value::as_i64);
    let original = q.pointer("/message/text").and_then(Value::as_str).unwrap_or_default().to_string();
    let owner = linked_chat(app).map(|(c, _)| c);
    if from.is_none() || from != owner {
        let _ = call(token, "answerCallbackQuery", json!({ "callback_query_id": id }), 10).await;
        return;
    }
    let chat = from.unwrap_or_default();
    let mut note = String::new();

    if data == "s" {
        // ⏹ Ferma: the turn ends; turn() writes "Fermato." in this message.
        note = if BUSY.load(Ordering::SeqCst) {
            crate::stop_turn(true);
            t("Fermo…").into()
        } else {
            t("Già finita").into()
        };
    } else if let Some(n) = data.strip_prefix("q:") {
        // A button under a task's question (ask_task).
        let picked = TASK_ASK.lock().unwrap().clone()
            .and_then(|(task, options)| n.parse::<usize>().ok().and_then(|i| options.get(i).cloned()).map(|o| (task, o)));
        note = match picked {
            Some((task, answer)) => match if task.starts_with("flow-") { crate::flows::answer(&task, &answer) } else { crate::tasks::answer_from_outside(app, &task, &answer) } {
                Ok(_) => {
                    if let Some(mid) = message {
                        let _ = edit(token, chat, mid, &format!("{original}\n\n✅ {answer}"), false).await;
                    }
                    t("Risposta data").into()
                }
                Err(e) => e,
            },
            None => t("Richiesta scaduta").into(),
        };
    } else if let Some(rest) = data.strip_prefix("p:") {
        // Consenti / Nega: "p:<id>:1" or "p:<id>:0".
        let (rid, yes) = rest.rsplit_once(':').map_or((rest, false), |(r, y)| (r, y == "1"));
        let tx = PENDING.lock().unwrap().remove(rid);
        note = match tx {
            Some(tx) => {
                let _ = tx.send(yes);
                if yes { t("Consentito").into() } else { t("Negato").into() }
            }
            None => t("Richiesta scaduta").into(),
        };
        if let Some(mid) = message {
            let mark = if note == t("Consentito") { "✅" } else { "⛔" };
            let _ = edit(token, chat, mid, &format!("{original}\n\n{mark} {note}"), false).await;
        }
    } else if data == "o" {
        // ⇄ Seconda opinione: which engine (the one that answered is left out).
        let answered = LAST.lock().unwrap().as_ref().map(|l| l.engine.clone());
        match answered {
            None => note = t("Richiesta scaduta").into(),
            Some(_) if BUSY.load(Ordering::SeqCst) => note = t("Aspetta la fine della risposta in corso.").into(),
            Some(answered) => {
                let rows: Vec<Value> = engines(app)
                    .into_iter()
                    .filter(|(e, _, ready)| *ready && *e != answered)
                    .map(|(e, name, _)| json!([{ "text": name, "callback_data": format!("o:{e}") }]))
                    .collect();
                if rows.is_empty() {
                    note = t("Nessun altro motore pronto.").into();
                } else {
                    let _ = send(token, chat, t("Chi dà la seconda opinione?"), Some(json!({ "inline_keyboard": rows }))).await;
                }
            }
        }
    } else if let Some(engine) = data.strip_prefix("o:") {
        let known = engines(app).into_iter().find(|(e, _, ready)| *e == engine && *ready);
        if BUSY.load(Ordering::SeqCst) {
            note = t("Aspetta la fine della risposta in corso.").into();
        } else if LAST.lock().unwrap().is_none() {
            note = t("Richiesta scaduta").into();
        } else if let Some((e, name, _)) = known {
            if let Some(mid) = message {
                let msg = tf("Seconda opinione: {e}.", &[("e", &name)]);
                let _ = edit(token, chat, mid, &msg, false).await;
            }
            BUSY.store(true, Ordering::SeqCst);
            let (app, token, e) = (app.clone(), token.to_string(), e.to_string());
            tauri::async_runtime::spawn(async move {
                turn(&app, &token, chat, String::new(), None, Some(e)).await;
                BUSY.store(false, Ordering::SeqCst);
            });
            note = name;
        }
    } else if let Some(engine) = data.strip_prefix("e:") {
        let known = engines(app).into_iter().find(|(e, _, ready)| *e == engine && *ready);
        if let Some((e, name, _)) = known {
            if BUSY.load(Ordering::SeqCst) {
                note = t("Aspetta la fine della risposta in corso.").into();
            } else {
                {
                    let mut pick = PICK.lock().unwrap();
                    pick.engine = Some(e.to_string());
                    pick.model = None;
                }
                reset_conversation();
                note = name.clone();
                if let Some(mid) = message {
                    let text = tf("Motore: {e}. Nuova conversazione.", &[("e", &name)]);
                    let _ = edit(token, chat, mid, &text, false).await;
                }
            }
        }
    } else if let Some(i) = data.strip_prefix("c:") {
        // /cartella: open a folder ("c:.." = up) or send a file ("c:<n>").
        let _ = call(token, "answerCallbackQuery", json!({ "callback_query_id": id }), 10).await;
        let (here, list) = WORK.lock().unwrap().clone();
        let target = if i == ".." {
            Some(here.rsplit_once('/').map(|(up, _)| up.to_string()).unwrap_or_default())
        } else {
            i.parse::<usize>().ok().and_then(|n| list.get(n).cloned())
        };
        let Some(rel) = target else { return };
        match crate::workdir::path_of(app, &rel) {
            Ok(path) if path.is_dir() => show_folder(app, token, chat, &rel, message).await,
            Ok(path) => {
                if let Err(e) = send_file(token, chat, &path).await {
                    let msg = format!("⚠️ {e}");
                    let _ = send(token, chat, &msg, None).await;
                }
            }
            Err(e) => {
                let msg = format!("⚠️ {e}");
                let _ = send(token, chat, &msg, None).await;
            }
        }
        return;
    } else if let Some(i) = data.strip_prefix("w:") {
        // A file just received: from the Vassoio into the work folder.
        let name = i.parse::<usize>().ok().and_then(|n| RECEIVED.lock().unwrap().get(n).cloned());
        note = match name {
            Some(name) => match crate::workdir::from_inbox(app, &name, "", false) {
                Ok(rel) => {
                    if let Some(mid) = message {
                        let msg = tf("«{name}» è nella cartella di lavoro.", &[("name", &rel)]);
                        let _ = edit(token, chat, mid, &msg, false).await;
                    }
                    t("Spostato").into()
                }
                Err(e) => e,
            },
            None => t("Richiesta scaduta").into(),
        };
    } else if let Some(i) = data.strip_prefix("f:") {
        let path = i.parse::<usize>().ok().and_then(|i| TRAY.lock().unwrap().get(i).cloned());
        let _ = call(token, "answerCallbackQuery", json!({ "callback_query_id": id }), 10).await;
        if let Some(path) = path {
            if let Err(e) = send_file(token, chat, std::path::Path::new(&path)).await {
                let msg = format!("⚠️ {e}");
                let _ = send(token, chat, &msg, None).await;
            }
        }
        return;
    } else if let Some(i) = data.strip_prefix("m:") {
        if BUSY.load(Ordering::SeqCst) {
            note = t("Aspetta la fine della risposta in corso.").into();
        } else {
            let model = if i == "-" { None } else { i.parse::<usize>().ok().and_then(|i| MODELS.lock().unwrap().get(i).cloned()) };
            if i == "-" || model.is_some() {
                set_model(model.clone());
                let shown = model.unwrap_or_else(|| t("quello delle impostazioni").to_string());
                note = shown.clone();
                if let Some(mid) = message {
                    let msg = tf("Modello: {m}. Nuova conversazione.", &[("m", &shown)]);
                    let _ = edit(token, chat, mid, &msg, false).await;
                }
            }
        }
    }
    let _ = call(token, "answerCallbackQuery", json!({ "callback_query_id": id, "text": note }), 10).await;
}

/// A permission of a chat turn from Telegram (Claude Code's hook payload, or
/// opencode's in the same shape): Consenti / Nega as buttons. `allow` or
/// `deny`; None when Telegram is not linked. No answer in time is a no.
/// A message to the linked chat, when there is one (a task that finished or
/// waits for the user, tasks.rs). Nothing when Telegram is off or not linked.
pub async fn tell(app: &AppHandle, text: &str) {
    let Some(token) = crate::secrets::get(SECRET) else { return };
    let Some((chat, _)) = linked_chat(app) else { return };
    let _ = send(&token, chat, text, None).await;
}

pub async fn request_decision(app: &AppHandle, payload: Value) -> Option<String> {
    // A reversible tool allowed for good: no buttons (permits.rs).
    if crate::permits::allowed_now(app, &payload) {
        return Some("allow".into());
    }
    decide(app, payload, true).await
}

/// Consenti / Nega here for a task's permission (tasks.rs): never "Automatica",
/// which belongs to the turns written on Telegram.
pub async fn ask_permission(app: &AppHandle, payload: Value) -> Option<String> {
    decide(app, payload, false).await
}

/// Telegram is set up and linked to a chat.
pub fn linked(app: &AppHandle) -> bool {
    linked_chat(app).is_some() && crate::secrets::get(SECRET).is_some()
}

/// The options of the task question last sent here (tasks.rs task_ask): its id and the answers.
static TASK_ASK: Mutex<Option<(String, Vec<String>)>> = Mutex::new(None);

/// A task's question as a message with a button per option; any other answer with /rispondi.
pub async fn ask_task(app: &AppHandle, task_id: &str, title: &str, question: &str, options: &[String]) {
    let header = tf("Compito «{title}»", &[("title", &title.to_string())]);
    ask_buttons(app, task_id, &header, question, options).await;
}

/// A flow's "ask" step (flows.rs): `key` starts with "flow-", the answer goes back to the flow.
pub async fn ask_flow(app: &AppHandle, key: &str, name: &str, question: &str, options: &[String]) {
    let header = tf("Flusso «{name}»", &[("name", &name.to_string())]);
    ask_buttons(app, key, &header, question, options).await;
}

async fn ask_buttons(app: &AppHandle, key: &str, header: &str, question: &str, options: &[String]) {
    let Some(token) = crate::secrets::get(SECRET) else { return };
    let Some((chat, _)) = linked_chat(app) else { return };
    *TASK_ASK.lock().unwrap() = Some((key.to_string(), options.to_vec()));
    let rows: Vec<Value> = options.iter().enumerate().take(6)
        .map(|(i, o)| json!([{ "text": o, "callback_data": format!("q:{i}") }])).collect();
    let text = format!("❓ {header}\n\n{question}\n\n{}", t("Rispondi con un pulsante oppure con /rispondi seguito dalla risposta."));
    let keyboard = (!rows.is_empty()).then(|| json!({ "inline_keyboard": rows }));
    let _ = send(&token, chat, &text, keyboard).await;
}

async fn decide(app: &AppHandle, payload: Value, allow_auto: bool) -> Option<String> {
    let token = crate::secrets::get(SECRET)?;
    let (chat, _) = linked_chat(app)?;
    if allow_auto && auto_on(app) && !asks_anyway(&payload) {
        log::line(format!("telegram: automatica, consentito {}", payload.get("tool_name").and_then(Value::as_str).unwrap_or("?")));
        return Some("allow".into());
    }
    let rid = crate::msgraph::random(6).iter().map(|b| format!("{b:02x}")).collect::<String>();
    let (tx, rx) = tokio::sync::oneshot::channel();
    PENDING.lock().unwrap().insert(rid.clone(), tx);

    let text = permission_text(&payload);
    let keyboard = json!({ "inline_keyboard": [[
        { "text": format!("✅ {}", t("Consenti")), "callback_data": format!("p:{rid}:1") },
        { "text": format!("⛔ {}", t("Nega")), "callback_data": format!("p:{rid}:0") },
    ]]});
    let sent = send(&token, chat, &text, Some(keyboard)).await;
    log::line("telegram: permesso chiesto");
    let answer = tokio::time::timeout(DECISION_WAIT, rx).await;
    PENDING.lock().unwrap().remove(&rid);
    match answer {
        Ok(Ok(true)) => Some("allow".into()),
        Ok(Ok(false)) => Some("deny".into()),
        _ => {
            if let Ok(mid) = sent {
                let _ = edit(&token, chat, mid, &format!("{text}\n\n⌛ {}", t("Nessuna risposta: negato")), false).await;
            }
            Some("deny".into())
        }
    }
}

fn auto_on(app: &AppHandle) -> bool {
    app.try_state::<crate::Shared>().is_some_and(|s| s.settings.lock().unwrap().integration_config.telegram_auto)
}

/// With "Automatica" on, what is still asked: deleting (a command, a
/// connector's tool), a command that could hide one (code built from a string
/// or downloaded), and the agent's own questions to the user.
fn asks_anyway(payload: &Value) -> bool {
    let tool = payload.get("tool_name").and_then(Value::as_str).unwrap_or_default();
    let lower = tool.to_ascii_lowercase();
    if matches!(lower.as_str(), "askuserquestion" | "exitplanmode" | "question") {
        return true;
    }
    if let Some(cmd) = payload.pointer("/tool_input/command").and_then(Value::as_str) {
        return deletes(cmd);
    }
    // A connector's tool, EasyIsland's own included: the same list as the
    // chat's ⚡ with opencode (permits.rs).
    crate::permits::delicate_tool(tool)
}

/// A command that deletes files, folders, data or history, or that runs code
/// built from a string or downloaded (it could delete anything).
fn deletes(command: &str) -> bool {
    const WORDS: &[&str] = &[
        "rm", "rmdir", "rd", "del", "erase", "remove-item", "clear-content", "cipher", "format", "format-volume",
        "diskpart", "clear-disk", "remove-partition", "mkfs", "dd", "shred", "unlink", "clear-recyclebin", "iex",
        "invoke-expression",
    ];
    const PHRASES: &[&str] = &[
        "git clean", "git reset --hard", "git branch -d", "git stash drop", "git stash clear", "git tag -d",
        "git push --force", "git push -f", "git push --delete", "git rm", "git checkout --", "git restore",
        "gh repo delete", "gh release delete", "docker rm", "docker system prune", "docker volume rm",
        "npm uninstall", "pip uninstall", "winget uninstall", "drop table", "drop database", "truncate table",
        "delete from", "::delete(", "-delete", "--delete",
        "downloadstring", "frombase64string", "-encodedcommand", " -enc ", "| sh", "| bash", "| powershell",
    ];
    let c = command.trim().to_ascii_lowercase();
    if c.contains('`') || c.contains("$(") || PHRASES.iter().any(|p| c.contains(p)) {
        return true;
    }
    // Every command of a chain: its first word, without a path or ".exe".
    // "cmd /c del …": the word after /c counts too.
    c.split(|ch| matches!(ch, ';' | '&' | '|' | '\n' | '(' | '{'))
        .flat_map(|part| {
            let mut words = part.split_whitespace();
            let first = words.next();
            let after_c = part.split_whitespace().skip_while(|w| *w != "/c" && *w != "-command" && *w != "-c").nth(1);
            first.into_iter().chain(after_c)
        })
        .map(|w| {
            let w = w.trim_matches(|ch| ch == '"' || ch == '\'');
            let w = w.rsplit(['\\', '/']).next().unwrap_or(w);
            w.strip_suffix(".exe").unwrap_or(w).to_string()
        })
        .any(|w| WORDS.contains(&w.as_str()))
}

/// "🔐 Bash\n<the command>": what is asked, as the island's card shows it.
fn permission_text(payload: &Value) -> String {
    let tool = payload.get("tool_name").and_then(Value::as_str).unwrap_or("?");
    let input = payload.get("tool_input").cloned().unwrap_or(Value::Null);
    let field = ["command", "file_path", "path", "url", "query", "pattern"]
        .iter()
        .find_map(|k| input.get(*k).and_then(Value::as_str).filter(|v| !v.is_empty()).map(str::to_string));
    let detail = field.unwrap_or_else(|| if input.is_null() { String::new() } else { input.to_string() });
    let detail: String = detail.chars().take(1500).collect();
    format!("🔐 {}\n{tool}\n\n{detail}", t("Permesso richiesto"))
}

// ── A turn ────────────────────────────────────────────────────────────────────

/// A turn of the conversation, or with `second` (an engine's id) the second
/// opinion of that engine on the last answer.
async fn turn(app: &AppHandle, token: &str, chat: i64, query: String, context: Option<ChatContext>, second: Option<String>) {
    // «⇄ Seconda opinione» stays only under the newest answer.
    let previous = LAST.lock().unwrap().as_ref().map(|l| l.message);
    if let Some(mid) = previous {
        let _ = call(token, "editMessageReplyMarkup", json!({ "chat_id": chat, "message_id": mid, "reply_markup": { "inline_keyboard": [] } }), 10).await;
    }
    let header = second
        .as_deref()
        .map(|e| format!("⇄ {}\n\n", tf("Seconda opinione · {e}", &[("e", &crate::second::engine_name(app, e))])))
        .unwrap_or_default();
    let _ = call(token, "sendChatAction", json!({ "chat_id": chat, "action": "typing" }), 10).await;
    // "⏹ Ferma" under the reply while it is written (the finished reply drops it).
    let stop_kb = json!({ "inline_keyboard": [[{ "text": format!("⏹ {}", t("Ferma")), "callback_data": "s" }]] });
    let Ok(placeholder) = send(token, chat, "…", Some(stop_kb.clone())).await else { return };
    let (engine, model) = {
        let p = PICK.lock().unwrap();
        (p.engine.clone(), p.model.clone())
    };

    // The reply so far, shown by a ticker (on_text is called far more often).
    let latest = Arc::new(Mutex::new(String::new()));
    let done = Arc::new(AtomicBool::new(false));
    {
        let (latest, done, token, stop_kb) = (latest.clone(), done.clone(), token.to_string(), stop_kb.clone());
        tauri::async_runtime::spawn(async move {
            let mut shown = String::new();
            let mut typing = Instant::now();
            while !done.load(Ordering::SeqCst) {
                tokio::time::sleep(EDIT_EVERY).await;
                if done.load(Ordering::SeqCst) {
                    break;
                }
                let now = latest.lock().unwrap().clone();
                if !now.trim().is_empty() && now != shown {
                    let body = json!({ "chat_id": chat, "message_id": placeholder, "text": tail(&now, CHUNK), "reply_markup": stop_kb });
                    let _ = call(&token, "editMessageText", body, 20).await;
                    shown = now;
                }
                if typing.elapsed() > Duration::from_secs(5) {
                    typing = Instant::now();
                    let _ = call(&token, "sendChatAction", json!({ "chat_id": chat, "action": "typing" }), 10).await;
                }
            }
        });
    }
    let on_text = |text: &str| {
        *latest.lock().unwrap() = format!("{header}{text}");
    };
    let asked = query.clone();
    // How a file reaches the user here: through the Vassoio (said once, at the start).
    // opencode and the CLIs keep the conversation themselves: their session says it has begun.
    let query = if CHAT.is_empty() && CHAT.cli_session().is_none() && second.is_none() {
        let dir = crate::files::inbox_dir();
        let note = tf("[Questa conversazione è su Telegram. Per mandare un file all'utente mettilo nel Vassoio di EasyIsland: con lo strumento add_to_tray, se c'è, oppure copiandolo nella cartella {dir}. Ogni file nuovo del Vassoio gli arriva su Telegram alla fine della risposta.]", &[("dir", &dir.display())]);
        format!("{note}\n\n{query}")
    } else {
        query
    };
    let before = tray_names();
    let last = LAST.lock().unwrap().clone();
    let reply = match (&second, &last) {
        (None, _) => crate::chat_turn(app, &CHAT, query, context, engine, model, false, crate::Channel::Telegram, &on_text).await.map(|r| r.text),
        (Some(e), Some(l)) => crate::second::run(app, &CHAT, e, &l.engine, &l.question, &l.answer, true, &on_text).await,
        (Some(_), None) => Err(t("Non c'è una risposta da rivedere.").to_string()),
    };
    done.store(true, Ordering::SeqCst);
    match reply {
        Ok(text) => {
            let mid = deliver(token, chat, placeholder, &format!("{header}{text}")).await;
            // The button under it: the answer (or the one just reviewed) can be reviewed again.
            let next = match last.filter(|_| second.is_some()) {
                Some(l) => Last { message: mid, ..l },
                None => Last { engine: current_engine(app), question: asked, answer: text, message: mid },
            };
            *LAST.lock().unwrap() = Some(next);
            let kb = json!({ "inline_keyboard": [[{ "text": format!("⇄ {}", t("Seconda opinione")), "callback_data": "o" }]] });
            let _ = call(token, "editMessageReplyMarkup", json!({ "chat_id": chat, "message_id": mid, "reply_markup": kb }), 10).await;
        }
        // Stopped: what was written so far stays, marked.
        Err(e) if e == crate::stopped_text() => {
            let so_far = latest.lock().unwrap().trim().to_string();
            let mark = format!("⏹ {}", t("Fermato."));
            let text = if so_far.is_empty() { mark } else { format!("{}\n\n{mark}", tail(&so_far, CHUNK - 40)) };
            let _ = edit(token, chat, placeholder, &text, false).await;
        }
        Err(e) => {
            let _ = edit(token, chat, placeholder, &format!("⚠️ {e}"), false).await;
        }
    }
    // Files the turn put in the Vassoio go to the user, oldest first.
    for f in crate::files::list_inbox().into_iter().rev() {
        if before.contains(&f.name) {
            continue;
        }
        if let Err(e) = send_file(token, chat, std::path::Path::new(&f.path)).await {
            let msg = format!("⚠️ {}: {e}", f.name);
            let _ = send(token, chat, &msg, None).await;
        }
    }
}

fn tray_names() -> std::collections::HashSet<String> {
    crate::files::list_inbox().into_iter().map(|f| f.name).collect()
}

fn size_text(bytes: u64) -> String {
    if bytes >= 1024 * 1024 {
        format!("{:.1} MB", bytes as f64 / 1_048_576.0)
    } else {
        format!("{} KB", bytes.div_ceil(1024))
    }
}

/// A file of the PC to the chat: a picture as a photo, an .mp4 as a video,
/// anything else as a document. Built by hand as multipart (no new feature).
async fn send_file(token: &str, chat: i64, path: &std::path::Path) -> Result<(), String> {
    let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "file".into());
    let owned = path.to_path_buf();
    let bytes = tauri::async_runtime::spawn_blocking(move || std::fs::read(&owned))
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| tf("File non leggibile: {e}", &[("e", &e)]))?;
    if bytes.len() as u64 > MAX_UPLOAD {
        return Err(t("Il file supera 50 MB, il limite di Telegram per i bot.").into());
    }
    let ext = name.rsplit('.').next().unwrap_or_default().to_lowercase();
    let (method, field) = match ext.as_str() {
        "jpg" | "jpeg" | "png" | "webp" if bytes.len() < 10 * 1024 * 1024 => ("sendPhoto", "photo"),
        "mp4" => ("sendVideo", "video"),
        _ => ("sendDocument", "document"),
    };
    let boundary = format!("easyisland{}", crate::msgraph::random(8).iter().map(|b| format!("{b:02x}")).collect::<String>());
    let safe: String = name.chars().map(|c| if c == '"' || c.is_control() { '_' } else { c }).collect();
    let mut body = Vec::with_capacity(bytes.len() + 512);
    body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"chat_id\"\r\n\r\n{chat}\r\n").as_bytes());
    body.extend_from_slice(
        format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{field}\"; filename=\"{safe}\"\r\nContent-Type: application/octet-stream\r\n\r\n").as_bytes(),
    );
    body.extend_from_slice(&bytes);
    body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
    let client = reqwest::Client::builder().timeout(Duration::from_secs(300)).build().map_err(|e| e.to_string())?;
    let resp = client
        .post(format!("{API}/bot{token}/{method}"))
        .header("Content-Type", format!("multipart/form-data; boundary={boundary}"))
        .body(body)
        .send()
        .await
        .map_err(|e| net_error(&e))?;
    let status = resp.status();
    let v: Value = resp.json().await.unwrap_or(Value::Null);
    if v.get("ok").and_then(Value::as_bool) == Some(true) {
        log::line("telegram: file mandato");
        return Ok(());
    }
    let why = v.get("description").and_then(Value::as_str).unwrap_or_default().to_string();
    Err(tf("Telegram {status}: {why}", &[("status", &status.as_u16()), ("why", &why)]))
}

/// The finished reply: the first piece in place of "…", the rest after it.
/// The reply in the placeholder and, if long, in more messages: the last one's id.
async fn deliver(token: &str, chat: i64, placeholder: i64, text: &str) -> i64 {
    let mut last = placeholder;
    for (i, piece) in chunks(text, CHUNK).iter().enumerate() {
        let html = to_html(piece);
        if i == 0 {
            if edit(token, chat, placeholder, &html, true).await.is_err() {
                let _ = edit(token, chat, placeholder, piece, false).await;
            }
        } else {
            match send_html(token, chat, &html).await {
                Ok(id) => last = id,
                Err(_) => last = send(token, chat, piece, None).await.unwrap_or(last),
            }
        }
    }
    last
}

// ── Files ─────────────────────────────────────────────────────────────────────

struct TgFile {
    id: String,
    name: String,
    size: u64,
}

fn file_of(m: &Value) -> Option<TgFile> {
    // A photo comes in several sizes: the largest is the last.
    if let Some(p) = m.get("photo").and_then(Value::as_array).and_then(|a| a.last()) {
        let stamp = chrono_like_stamp();
        return Some(TgFile {
            id: p.get("file_id")?.as_str()?.to_string(),
            name: format!("Telegram {stamp}.jpg"),
            size: p.get("file_size").and_then(Value::as_u64).unwrap_or(0),
        });
    }
    for kind in ["document", "video", "audio"] {
        if let Some(d) = m.get(kind) {
            let name = d.get("file_name").and_then(Value::as_str).map(str::to_string)
                .unwrap_or_else(|| format!("Telegram {}", chrono_like_stamp()));
            return Some(TgFile {
                id: d.get("file_id")?.as_str()?.to_string(),
                name,
                size: d.get("file_size").and_then(Value::as_u64).unwrap_or(0),
            });
        }
    }
    None
}

/// «Vocali» in the settings: who transcribes ("" = nobody).
fn voice_service(app: &AppHandle) -> String {
    app.try_state::<crate::Shared>().map(|s| s.settings.lock().unwrap().integration_config.telegram_voice.clone()).unwrap_or_default()
}

/// The model chosen for «Vocali» ("" = the service's default).
fn voice_model(app: &AppHandle) -> String {
    app.try_state::<crate::Shared>().map(|s| s.settings.lock().unwrap().integration_config.telegram_voice_model.clone()).unwrap_or_default()
}

/// The words of a voice message or audio file (transcribe.rs); the audio is not kept.
async fn hear(app: &AppHandle, token: &str, v: &Value) -> Result<String, String> {
    let service = voice_service(app);
    if service.is_empty() {
        return Err(t("Per i vocali scegli chi li trascrive in Impostazioni → Telegram → Vocali.").into());
    }
    let f = TgFile {
        id: v.get("file_id").and_then(Value::as_str).ok_or(t("Telegram non ha dato il file."))?.to_string(),
        name: String::new(),
        size: v.get("file_size").and_then(Value::as_u64).unwrap_or(0),
    };
    let bytes = fetch(token, &f).await?;
    let mime = v.get("mime_type").and_then(Value::as_str).unwrap_or("audio/ogg");
    let words = crate::transcribe::transcribe(&service, &voice_model(app), &bytes, mime).await?;
    if words.is_empty() {
        return Err(t("Nel vocale non ho sentito parole.").into());
    }
    Ok(words)
}

/// A file's bytes from Telegram (at most 20 MB, the Bot API's limit).
async fn fetch(token: &str, f: &TgFile) -> Result<Vec<u8>, String> {
    if f.size > MAX_FILE {
        return Err(t("Il file supera 20 MB, il limite di Telegram per i bot.").into());
    }
    let info = call(token, "getFile", json!({ "file_id": f.id }), 30).await?;
    let path = info.get("file_path").and_then(Value::as_str).ok_or(t("Telegram non ha dato il file."))?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(120)).build().map_err(|e| e.to_string())?;
    let resp = client
        .get(format!("{API}/file/bot{token}/{path}"))
        .send()
        .await
        .map_err(|e| net_error(&e))?;
    if !resp.status().is_success() {
        return Err(tf("Telegram: file non scaricato (HTTP {s}).", &[("s", &resp.status().as_u16())]));
    }
    resp.bytes().await.map(|b| b.to_vec()).map_err(|e| net_error(&e))
}

/// The file in the Vassoio: its name and path there.
async fn download(app: &AppHandle, token: &str, f: &TgFile) -> Result<(String, String), String> {
    let bytes = fetch(token, f).await?;
    // A name of the sender's, made safe for Windows.
    let name: String = f.name.chars().map(|c| if r#"<>:"/\|?*"#.contains(c) || c.is_control() { '_' } else { c }).collect();
    let name = if name.trim().is_empty() { "Telegram".to_string() } else { name };
    let saved = tauri::async_runtime::spawn_blocking(move || crate::files::save_new(&name, &bytes))
        .await
        .map_err(|e| e.to_string())??;
    crate::moments::emit(app, json!({ "kind": "tray", "name": saved.name, "path": saved.path, "size": saved.size }));
    Ok((saved.name, saved.path))
}

/// "2026-10-17 14.05.31", for a photo's name (local time, as Windows shows it).
fn chrono_like_stamp() -> String {
    let st = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    format!("{:04}-{:02}-{:02} {:02}.{:02}.{:02}", st.wYear, st.wMonth, st.wDay, st.wHour, st.wMinute, st.wSecond)
}

// ── Bot API ───────────────────────────────────────────────────────────────────

/// A method of the Bot API. The token is in the URL: errors never show it.
async fn call(token: &str, method: &str, body: Value, timeout_secs: u64) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(timeout_secs))
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .post(format!("{API}/bot{token}/{method}"))
        .json(&body)
        .send()
        .await
        .map_err(|e| net_error(&e))?;
    let status = resp.status();
    let v: Value = resp.json().await.unwrap_or(Value::Null);
    if v.get("ok").and_then(Value::as_bool) == Some(true) {
        return Ok(v.get("result").cloned().unwrap_or(Value::Null));
    }
    if status.as_u16() == 401 || status.as_u16() == 404 {
        return Err(t("Token del bot non valido: copialo di nuovo da BotFather.").into());
    }
    let why = v.get("description").and_then(Value::as_str).unwrap_or_default();
    Err(tf("Telegram {status}: {why}", &[("status", &status.as_u16()), ("why", &why)]))
}

fn net_error(e: &reqwest::Error) -> String {
    if e.is_timeout() {
        return t("Telegram non ha risposto in tempo.").into();
    }
    // Without the URL: it has the token in it.
    let e = format!("{}", Clean(e));
    tf("Errore di rete con Telegram: {e}", &[("e", &e)])
}

/// A reqwest error printed without its URL.
struct Clean<'a>(&'a reqwest::Error);

impl std::fmt::Display for Clean<'_> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let mut source = std::error::Error::source(self.0);
        let mut last = None;
        while let Some(s) = source {
            last = Some(s.to_string());
            source = s.source();
        }
        let kind = if self.0.is_connect() { t("connessione non riuscita") } else { t("richiesta non riuscita") };
        match last {
            Some(s) => write!(f, "{kind} ({s})"),
            None => write!(f, "{kind}"),
        }
    }
}

/// Sends plain text; the message's id.
async fn send(token: &str, chat: i64, text: &str, keyboard: Option<Value>) -> Result<i64, String> {
    let mut body = json!({ "chat_id": chat, "text": text });
    if let Some(k) = keyboard {
        body["reply_markup"] = k;
    }
    let v = call(token, "sendMessage", body, 20).await?;
    Ok(v.get("message_id").and_then(Value::as_i64).unwrap_or(0))
}

async fn send_html(token: &str, chat: i64, html: &str) -> Result<i64, String> {
    let v = call(token, "sendMessage", json!({ "chat_id": chat, "text": html, "parse_mode": "HTML" }), 20).await?;
    Ok(v.get("message_id").and_then(Value::as_i64).unwrap_or(0))
}

/// Replaces a message's text (and drops its buttons).
async fn edit(token: &str, chat: i64, message: i64, text: &str, html: bool) -> Result<(), String> {
    let mut body = json!({ "chat_id": chat, "message_id": message, "text": text });
    if html {
        body["parse_mode"] = json!("HTML");
    }
    call(token, "editMessageText", body, 20).await.map(|_| ())
}

fn unix_now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

// ── Text ──────────────────────────────────────────────────────────────────────

/// The last `max` characters (the reply being written can be long).
fn tail(text: &str, max: usize) -> String {
    let n = text.chars().count();
    if n <= max {
        return text.to_string();
    }
    let rest: String = text.chars().skip(n - max).collect();
    format!("…{rest}")
}

/// Pieces of at most `max` characters, cut at a line break where there is one.
fn chunks(text: &str, max: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    let mut count = 0;
    for line in text.split_inclusive('\n') {
        let len = line.chars().count();
        if count + len > max && count > 0 {
            out.push(std::mem::take(&mut current));
            count = 0;
        }
        if len > max {
            // One very long line: by characters.
            let chars: Vec<char> = line.chars().collect();
            for piece in chars.chunks(max) {
                out.push(piece.iter().collect());
            }
            continue;
        }
        current.push_str(line);
        count += len;
    }
    if !current.trim().is_empty() || out.is_empty() {
        out.push(current);
    }
    out
}

fn escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

/// The chat's markdown as Telegram's HTML: code blocks, inline code, bold,
/// headings as bold. Anything else stays as text.
fn to_html(md: &str) -> String {
    let mut out = String::new();
    let mut in_block = false;
    for line in md.split_inclusive('\n') {
        let bare = line.trim_end_matches(['\n', '\r']);
        if bare.trim_start().starts_with("```") {
            out.push_str(if in_block { "</pre>" } else { "<pre>" });
            in_block = !in_block;
            if line.ends_with('\n') && !in_block {
                out.push('\n');
            }
            continue;
        }
        if in_block {
            out.push_str(&escape(line));
            continue;
        }
        let heading = bare.trim_start_matches('#');
        let line_md = if heading.len() < bare.len() && heading.starts_with(' ') {
            format!("**{}**{}", heading.trim(), if line.ends_with('\n') { "\n" } else { "" })
        } else {
            line.to_string()
        };
        out.push_str(&inline(&line_md));
    }
    if in_block {
        out.push_str("</pre>");
    }
    out
}

/// `code` and **bold** in one line.
fn inline(line: &str) -> String {
    let mut out = String::new();
    let mut rest = line;
    let mut bold = false;
    while !rest.is_empty() {
        if let Some(after) = rest.strip_prefix('`') {
            if let Some(end) = after.find('`') {
                out.push_str("<code>");
                out.push_str(&escape(after.get(..end).unwrap_or_default()));
                out.push_str("</code>");
                rest = after.get(end + 1..).unwrap_or_default();
                continue;
            }
        }
        if let Some(after) = rest.strip_prefix("**") {
            if bold || after.contains("**") {
                out.push_str(if bold { "</b>" } else { "<b>" });
                bold = !bold;
                rest = after;
                continue;
            }
        }
        let c = rest.chars().next().unwrap_or_default();
        out.push_str(&escape(&c.to_string()));
        rest = rest.get(c.len_utf8()..).unwrap_or_default();
    }
    if bold {
        out.push_str("</b>");
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markdown_becomes_telegram_html() {
        assert_eq!(to_html("**Ciao** a <te> & `x<y`"), "<b>Ciao</b> a &lt;te&gt; &amp; <code>x&lt;y</code>");
        assert_eq!(to_html("## Titolo\ntesto"), "<b>Titolo</b>\ntesto");
        assert_eq!(to_html("```rust\nlet a = 1 < 2;\n```\nfine"), "<pre>let a = 1 &lt; 2;\n</pre>\nfine");
        // An unclosed block or bold is closed, so Telegram accepts the HTML.
        assert_eq!(to_html("```\ncodice"), "<pre>codice</pre>");
        assert_eq!(to_html("2 ** 3"), "2 ** 3");
    }

    #[test]
    fn long_replies_are_cut_at_lines() {
        let text = "riga uno\nriga due\nriga tre\n";
        assert_eq!(chunks(text, 18), vec!["riga uno\nriga due\n", "riga tre\n"]);
        assert_eq!(chunks("àèìòù", 2), vec!["àè", "ìò", "ù"]);
        assert_eq!(chunks("", 10), vec![""]);
        assert_eq!(tail("abcdef", 3), "…def");
    }

    #[test]
    fn automatica_asks_only_for_deleting() {
        let bash = |c: &str| json!({ "tool_name": "Bash", "tool_input": { "command": c } });
        assert!(!asks_anyway(&bash("npm run build && git commit -m x")));
        assert!(!asks_anyway(&bash(r"Get-ChildItem C:\temp")));
        assert!(!asks_anyway(&bash("rmdirx --help")));
        assert!(!asks_anyway(&json!({ "tool_name": "Edit", "tool_input": { "file_path": "a.ts" } })));
        assert!(!asks_anyway(&json!({ "tool_name": "mcp__notion__notion-create-pages", "tool_input": {} })));
        assert!(asks_anyway(&bash("rm -rf dist")));
        assert!(asks_anyway(&bash("cd x; Remove-Item -Recurse foo")));
        assert!(asks_anyway(&bash(r"C:\Windows\System32\cmd.exe /c del a.txt")));
        assert!(asks_anyway(&bash("git clean -fdx")));
        assert!(asks_anyway(&bash("iex (iwr https://x)")));
        assert!(asks_anyway(&json!({ "tool_name": "mcp__notion__notion-delete-pages", "tool_input": {} })));
        assert!(asks_anyway(&json!({ "tool_name": "AskUserQuestion", "tool_input": {} })));
    }

    #[test]
    fn permissions_show_the_command() {
        let p = json!({ "tool_name": "Bash", "tool_input": { "command": "dir C:\\" } });
        let text = permission_text(&p);
        assert!(text.contains("Bash") && text.contains("dir C:\\"), "{text}");
    }
}
