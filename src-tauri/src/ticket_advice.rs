// «Consiglio IA» on a Zammad ticket (asked by Edoardo on 4 Nov 2026): the
// first advice comes from the chat (the card opens it with the ticket, the
// customer's page and the similar tickets, zammad::prepare; the first reply is
// kept here), then it follows the ticket: when it has new messages a helper
// turn of the chat's engine rewrites it, with the previous one and what
// changed, and the old one goes to the history. Checked when the ticket is
// opened in the card and every 10 minutes for the open tickets that have one
// (one light request each). Kept on this PC, encrypted for the Windows user
// (DPAPI, like rdm-cache.bin): it holds customers' words.

use crate::claude::Chat;
use crate::i18n::{t, tf};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Old versions kept per ticket.
const MAX_HISTORY: usize = 8;
/// Tickets looked at per round of the watch.
const MAX_WATCHED: usize = 12;
const WATCH_EVERY: Duration = Duration::from_secs(600);

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Advice {
    /// "2026-11-04 09:30", local time.
    pub at: String,
    pub text: String,
    /// The ticket's messages when it was written: more now = news.
    pub articles: u64,
    /// "chat" (from the chat), "news" (new messages), "manual" (Aggiorna).
    pub why: String,
}

#[derive(Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: i64,
    pub title: String,
    pub current: Option<Advice>,
    #[serde(default)]
    pub history: Vec<Advice>,
    #[serde(default)]
    pub closed: bool,
    /// The last update that failed (shown in the card), "" when fine.
    #[serde(default)]
    pub error: String,
    /// Being rewritten right now (not saved).
    #[serde(default, skip_deserializing)]
    pub updating: bool,
}

#[derive(Serialize, Deserialize, Default)]
struct Store {
    tickets: HashMap<String, Entry>,
}

static STORE: Mutex<Option<Store>> = Mutex::new(None);
static BUSY: Mutex<Vec<i64>> = Mutex::new(Vec::new());

fn path() -> PathBuf {
    crate::settings::config_dir().join("consigli-ticket.bin")
}

fn load() -> Store {
    std::fs::read(path())
        .ok()
        .and_then(|b| crate::secrets::dpapi(&b, false))
        .and_then(|j| serde_json::from_slice(&j).ok())
        .unwrap_or_default()
}

fn persist(s: &Store) {
    let Ok(json) = serde_json::to_vec(s) else { return };
    match crate::secrets::dpapi(&json, true) {
        Some(sealed) => {
            if let Err(e) = crate::settings::write_atomic(&path(), &sealed) {
                crate::log::line(format!("consigli: non salvati ({e})"));
            }
        }
        None => crate::log::line("consigli: non cifrati, non salvati"),
    }
}

fn with<R>(f: impl FnOnce(&mut Store) -> R) -> R {
    let mut g = STORE.lock().unwrap();
    let s = g.get_or_insert_with(load);
    f(s)
}

fn busy(id: i64) -> bool {
    BUSY.lock().unwrap().contains(&id)
}

fn now() -> String {
    let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    format!("{:04}-{:02}-{:02} {:02}:{:02}", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute)
}

/// The ticket's advice and history, if any.
pub fn get(id: i64) -> Option<Entry> {
    with(|s| s.tickets.get(&id.to_string()).cloned()).map(|mut e| {
        e.updating = busy(id);
        e
    })
}

fn put(id: i64, title: &str, text: &str, articles: u64, why: &str, closed: bool) {
    with(|s| {
        let e = s.tickets.entry(id.to_string()).or_insert_with(|| Entry { id, ..Default::default() });
        if !title.is_empty() {
            e.title = title.to_string();
        }
        if let Some(old) = e.current.take() {
            e.history.insert(0, old);
            e.history.truncate(MAX_HISTORY);
        }
        e.current = Some(Advice { at: now(), text: text.trim().to_string(), articles, why: why.to_string() });
        e.closed = closed;
        e.error.clear();
        persist(s);
    });
}

fn emit(app: &AppHandle, id: i64) {
    let _ = app.emit("ticket-advice", id);
}

/// What the engine is asked for, the first time (the chat) and when rewriting.
pub fn question() -> String {
    t("Dammi il tuo consiglio su questo ticket (i dati sono allegati), in italiano e conciso, con questi titoli: «Situazione» (cosa chiede il cliente e a che punto siamo, in 2–3 righe), «Cosa fare» (i passi da provare, in ordine, dal più probabile; cita i ticket simili e la pagina del cliente se servono), «Da chiedere al cliente» (solo se manca qualcosa), «Bozza di risposta» (breve e cordiale, nella lingua del cliente). Se il cliente non è negli allegati cercalo nella memoria con memory_search. Non inviare niente.").to_string()
}

/// The first reply of the chat opened with «Consiglio IA»: kept as the advice.
pub async fn save_from_chat(app: &AppHandle, id: i64, text: &str) -> Result<Entry, String> {
    if text.trim().is_empty() {
        return Err(t("Risposta vuota: niente da salvare.").into());
    }
    let (articles, closed, title) = crate::zammad::stamp(id).await?;
    put(id, &title, text, articles, "chat", closed);
    emit(app, id);
    get(id).ok_or_else(|| t("Consiglio non salvato.").to_string())
}

/// The ticket opened in the card: its advice, rewritten in the background
/// when the ticket has new messages since.
pub async fn check(app: &AppHandle, id: i64) -> Option<Entry> {
    let e = get(id)?;
    if !e.updating {
        if let Ok((articles, closed, _)) = crate::zammad::stamp(id).await {
            let behind = e.current.as_ref().is_some_and(|c| articles > c.articles);
            if behind && !closed {
                start(app, id, "news");
            }
        }
    }
    get(id)
}

/// Rewrites the advice in the background («Aggiorna», or news). False if it already is.
pub fn start(app: &AppHandle, id: i64, why: &str) -> bool {
    {
        let mut b = BUSY.lock().unwrap();
        if b.contains(&id) {
            return false;
        }
        b.push(id);
    }
    emit(app, id);
    let (app, why) = (app.clone(), why.to_string());
    tauri::async_runtime::spawn(async move {
        let out = rewrite(&app, id, &why).await;
        BUSY.lock().unwrap().retain(|x| *x != id);
        if let Err(e) = out {
            crate::log::line(format!("consigli: ticket {id} non aggiornato ({e})"));
            with(|s| {
                if let Some(entry) = s.tickets.get_mut(&id.to_string()) {
                    entry.error = e;
                }
            });
        }
        emit(&app, id);
    });
    true
}

async fn rewrite(app: &AppHandle, id: i64, why: &str) -> Result<(), String> {
    let prep = crate::zammad::prepare(id).await?;
    let (articles, closed, title) = crate::zammad::stamp(id).await?;
    let mut prompt = format!("{}\n\n{}\n\n", t("[Ticket, pagina del cliente nella memoria e ticket simili]"), prep.context);
    match get(id).and_then(|e| e.current) {
        Some(prev) => {
            prompt.push_str(&tf(
                "Il tuo consiglio precedente (del {at}, quando il ticket aveva {n} messaggi):\n{text}\n\n",
                &[("at", &prev.at), ("n", &prev.articles), ("text", &prev.text)],
            ));
            prompt.push_str(&t("Aggiorna il consiglio con le novità del ticket (i messaggi arrivati dopo): in testa una riga «Novità: …» con cosa è cambiato, poi il consiglio intero aggiornato, con gli stessi titoli. Se le novità non cambiano niente, dillo nella riga Novità e ripeti il consiglio."));
            prompt.push('\n');
            prompt.push_str(&question());
        }
        None => prompt.push_str(&question()),
    }
    let chat = Chat::default();
    let reply = crate::chat_turn(app, &chat, prompt, None, None, None, false, crate::Channel::Helper, &|_| {}).await;
    crate::opencode::forget(chat.cli_session());
    let text = reply?.text;
    if text.trim().is_empty() {
        return Err(t("Il motore non ha risposto.").into());
    }
    put(id, &title, &text, articles, why, closed);
    Ok(())
}

/// Every 10 minutes: the open tickets with an advice that have new messages.
pub fn start_watch(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            tokio::time::sleep(WATCH_EVERY).await;
            let mut ids: Vec<(String, i64)> = with(|s| {
                s.tickets.values().filter(|e| !e.closed).map(|e| (e.current.as_ref().map(|c| c.at.clone()).unwrap_or_default(), e.id)).collect()
            });
            if ids.is_empty() {
                continue;
            }
            ids.sort_by(|a, b| b.0.cmp(&a.0));
            for (_, id) in ids.into_iter().take(MAX_WATCHED) {
                if busy(id) {
                    continue;
                }
                let Ok((articles, closed, _)) = crate::zammad::stamp(id).await else { break };
                let had = get(id).and_then(|e| e.current).map(|c| c.articles).unwrap_or(0);
                if closed {
                    with(|s| {
                        if let Some(e) = s.tickets.get_mut(&id.to_string()) {
                            e.closed = true;
                            persist(s);
                        }
                    });
                } else if articles > had && start(&app, id, "news") {
                    // One at a time: the engine is shared with the chat.
                    while busy(id) {
                        tokio::time::sleep(Duration::from_secs(3)).await;
                    }
                }
            }
        }
    });
}
