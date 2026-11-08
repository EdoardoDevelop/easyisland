// Chat history: the conversations of the island's chat, to read again and
// carry on.
//
// Each finished turn is written to chats.json in %LOCALAPPDATA%\EasyIsland
// (whole file to a temporary sibling, then renamed over the old one). It keeps
// what the chat showed (questions and answers) and, for the engines that send
// the whole conversation each time (API, OpenRouter, OpenAI, Gemini, Ollama,
// LM Studio), the messages as the model saw them, without the dropped files'
// bytes. Claude Code keeps its conversation in a session of its own: its id is
// kept here, and a conversation reopened resumes that session with all its
// context, as Claude Desktop does (8 Nov 2026), and shows the context read
// from the session's file. opencode, and a Claude Code session gone (30 days)
// or kept under another folder, get the previous conversation as text in the
// first message (`Chat::take_preamble`, `Chat::take_resume_fallback`). Nothing leaves the PC. Off with Impostazioni → Chat
// → Cronologia (`chat_history`), which also empties it.

use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::claude::Chat;
use crate::i18n::{t, tf};

const MAX_CONVERSATIONS: usize = 100;
const MAX_TITLE_CHARS: usize = 80;
/// The previous conversation handed to Claude Code or opencode: its last part.
const MAX_PREAMBLE_CHARS: usize = 24_000;

/// One line of the conversation, as the chat shows it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Line {
    /// "user" or "assistant".
    pub role: String,
    pub content: String,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
struct Conversation {
    id: String,
    title: String,
    engine: String,
    /// 📌 in the list: kept on top and never dropped by the cap.
    pinned: bool,
    /// Unix milliseconds.
    created: i64,
    updated: i64,
    lines: Vec<Line>,
    /// The engine's own messages, for the engines that resend them each turn.
    messages: Vec<Value>,
    /// The folder picked for it; empty = the one of the settings.
    folder: String,
    /// The last answer is not finished yet (`begin`): its line says so until it is.
    pending: bool,
    /// Claude Code's session (engine "subscription"): resumed when reopened.
    session: String,
    /// The size of the context at the last turn (0 = unknown).
    context_size: u64,
    /// After each turn of Claude Code: how many lines the conversation had and
    /// the session's answer then (`--resume-session-at` for Modifica, Rigenera, Dirama).
    marks: Vec<(usize, String)>,
}

/// One row of the list in the chat.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub id: String,
    pub title: String,
    pub engine: String,
    /// The folder picked for it (the sidebar groups by it); empty = none.
    pub folder: String,
    pub updated: i64,
    pub turns: usize,
    pub pinned: bool,
}

/// A conversation reopened: the island shows `lines` and keeps using `engine`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    pub engine: String,
    pub lines: Vec<Line>,
    pub folder: String,
    /// Tokens in the context and its size (0 = unknown), when the session is resumed.
    pub context: Option<(u64, u64)>,
}

static STORE: Mutex<Option<Store>> = Mutex::new(None);

struct Store {
    path: PathBuf,
    list: Vec<Conversation>,
}

impl Store {
    fn load(path: PathBuf) -> Self {
        let list = std::fs::read(&path)
            .ok()
            .and_then(|b| serde_json::from_slice::<Vec<Conversation>>(&b).ok())
            .unwrap_or_default();
        Self { path, list }
    }

    fn save(&self) {
        if self.list.is_empty() {
            let _ = std::fs::remove_file(&self.path);
            return;
        }
        let Ok(json) = serde_json::to_vec(&self.list) else { return };
        if let Some(dir) = self.path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        let temp = self.path.with_extension(format!("json.tmp-{}", std::process::id()));
        let done = std::fs::write(&temp, &json).and_then(|()| std::fs::rename(&temp, &self.path));
        if let Err(err) = done {
            let _ = std::fs::remove_file(&temp);
            #[cfg(not(test))]
            crate::log::line(format!("chat history: could not save: {err}"));
            #[cfg(test)]
            eprintln!("{err}");
        }
    }

    /// A finished turn joins the conversation `id` (a new one when it is not there).
    /// ✎ in the list: the user's title, on one line; empty = the first question again.
    fn rename(&mut self, id: &str, new_title: &str) -> bool {
        let Some(c) = self.list.iter_mut().find(|c| c.id == id) else { return false };
        let first = c.lines.iter().find(|l| l.role == "user").map(|l| l.content.as_str()).unwrap_or_default();
        c.title = title(if new_title.trim().is_empty() { first } else { new_title });
        true
    }

    fn record(&mut self, id: &str, engine: &str, query: &str, reply: &str, messages: Vec<Value>, now: i64) {
        let pos = match self.list.iter().position(|c| c.id == id) {
            Some(p) => p,
            None => {
                self.list.push(Conversation { id: id.into(), title: title(query), created: now, ..Default::default() });
                self.list.len() - 1
            }
        };
        let c = &mut self.list[pos];
        c.engine = engine.into();
        c.updated = now;
        // The question was written when it was sent (`begin`): its answer takes the place kept for it.
        let open = c.pending && c.lines.len() >= 2 && c.lines.get(c.lines.len() - 2).is_some_and(|l| l.role == "user" && crate::redact::redact(&l.content).starts_with(query));
        if open {
            if let Some(last) = c.lines.last_mut() {
                last.content = reply.into();
            }
        } else {
            c.lines.push(Line { role: "user".into(), content: query.into() });
            c.lines.push(Line { role: "assistant".into(), content: reply.into() });
        }
        c.pending = false;
        c.messages = messages;
        // Most recent first; the oldest beyond the cap go, never a pinned one.
        let c = self.list.remove(pos);
        self.list.insert(0, c);
        while self.list.len() > MAX_CONVERSATIONS {
            match self.list.iter().rposition(|c| !c.pinned) {
                Some(i) => { self.list.remove(i); }
                None => break,
            }
        }
    }
}

fn with_store<R>(f: impl FnOnce(&mut Store) -> R) -> R {
    let mut guard = STORE.lock().unwrap();
    let store = guard.get_or_insert_with(|| Store::load(crate::settings::local_dir().join("chats.json")));
    f(store)
}

fn now() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

fn new_id() -> String {
    format!("c{:x}{:x}", now(), std::process::id())
}

/// The first question, on one line.
fn title(query: &str) -> String {
    let one: String = query.split_whitespace().collect::<Vec<_>>().join(" ");
    if one.chars().count() <= MAX_TITLE_CHARS {
        return one;
    }
    let cut: String = one.chars().take(MAX_TITLE_CHARS - 1).collect();
    format!("{}…", cut.trim_end())
}

/// Dropped files ride in the messages as base64 (claude.rs, openai.rs): only a
/// note of them is kept on disk.
fn without_files(messages: Vec<Value>) -> Vec<Value> {
    fn strip(v: Value) -> Value {
        match v {
            Value::Object(map) => {
                let kind = map.get("type").and_then(Value::as_str).unwrap_or("");
                if matches!(kind, "image" | "document" | "image_url" | "input_image" | "file") {
                    return json!({ "type": "text", "text": t("[file allegato: non più disponibile]") });
                }
                Value::Object(map.into_iter().map(|(k, v)| (k, strip(v))).collect())
            }
            Value::Array(items) => Value::Array(items.into_iter().map(strip).collect()),
            other => other,
        }
    }
    messages.into_iter().map(strip).collect()
}

/// The engines whose whole conversation is in `Chat`'s messages.
fn resends(engine: &str) -> bool {
    engine == "api" || crate::openai::ENGINES.contains(&engine)
}

/// After a turn that went well (lib.rs `chat_turn`).
/// `prefix` marks a new conversation's title ("Telegram · ").
pub fn record(chat: &Chat, engine: &str, query: &str, reply: &str, prefix: &str) {
    // Passwords written in the chat never reach the disk (redact.rs).
    let query = &crate::redact::redact(query);
    let reply = &crate::redact::redact(reply);
    let id = chat.log_id().unwrap_or_else(|| {
        let id = new_id();
        chat.set_log_id(Some(id.clone()));
        id
    });
    let mut messages = if resends(engine) { without_files(chat.snapshot()) } else { Vec::new() };
    for m in messages.iter_mut() {
        redact_strings(m);
    }
    let now = now();
    let folder = chat.folder().unwrap_or_default();
    let session = if engine == "subscription" { chat.cli_session().unwrap_or_default() } else { String::new() };
    let size = chat.peek_context().map_or(0, |(_, size)| size);
    // Where the session is now, once the answer is there (not for the question just sent).
    let mark = (!session.is_empty() && reply != unfinished().as_str()).then(|| crate::desktop::last_answer_uuid(&session)).flatten();
    with_store(|s| {
        s.record(&id, engine, query, reply, messages, now);
        if let Some(c) = s.list.iter_mut().find(|c| c.id == id) {
            c.folder = folder;
            if !session.is_empty() {
                c.session = session;
            }
            if size > 0 {
                c.context_size = size;
            }
            if let Some(uuid) = mark.as_ref() {
                let n = c.lines.len();
                if c.marks.last().is_none_or(|(_, u)| u != uuid) {
                    c.marks.retain(|(at, _)| *at < n);
                    c.marks.push((n, uuid.clone()));
                }
            }
        }
        if !prefix.is_empty() {
            if let Some(c) = s.list.iter_mut().find(|c| c.id == id && c.lines.len() == 2 && !c.title.starts_with(prefix)) {
                c.title = format!("{prefix}{}", c.title);
            }
        }
        s.save();
    });
}

/// redact.rs scrub_once: the passwords of every conversation, learned first.
pub fn learn_secrets() {
    with_store(|s| {
        for c in &s.list {
            for l in &c.lines {
                crate::redact::learn(&l.content);
            }
        }
    });
}

/// Every string inside a JSON value, masked; whether one changed.
fn redact_strings(v: &mut Value) -> bool {
    match v {
        Value::String(s) => {
            let clean = crate::redact::redact(s);
            let changed = clean != *s;
            *s = clean;
            changed
        }
        Value::Array(items) => items.iter_mut().fold(false, |a, x| redact_strings(x) | a),
        Value::Object(map) => map.values_mut().fold(false, |a, x| redact_strings(x) | a),
        _ => false,
    }
}

/// redact.rs scrub_once: the conversations with a password masked; how many changed.
pub fn scrub() -> usize {
    with_store(|s| {
        let mut changed = 0;
        for c in s.list.iter_mut() {
            let mut any = false;
            for l in c.lines.iter_mut() {
                let clean = crate::redact::redact(&l.content);
                if clean != l.content {
                    l.content = clean;
                    any = true;
                }
            }
            let title = crate::redact::redact(&c.title);
            if title != c.title {
                c.title = title;
                any = true;
            }
            // The engine's own messages hold the same text.
            for m in c.messages.iter_mut() {
                any |= redact_strings(m);
            }
            if any {
                changed += 1;
            }
        }
        if changed > 0 {
            s.save();
        }
        changed
    })
}

/// What the answer's line says while it is being written, and stays if
/// EasyIsland stops before the end (closed, the turn lost): the question is
/// never lost again (4 Nov 2026: a long turn ended with no trace, and the
/// next chat knew nothing of it).
fn unfinished() -> String {
    t("⚠ Risposta interrotta prima della fine.").to_string()
}

/// A question as it is sent (lib.rs `chat_turn`): in the history at once,
/// with a line for its answer that `record` fills in.
pub fn begin(chat: &Chat, engine: &str, query: &str, prefix: &str) {
    record(chat, engine, query, &unfinished(), prefix);
    if let Some(id) = chat.log_id() {
        with_store(|s| {
            if let Some(c) = s.list.iter_mut().find(|c| c.id == id) {
                c.pending = true;
            }
        });
    }
}

/// The answer so far, while the turn goes on (every few seconds): what is
/// kept if EasyIsland closes before the end.
pub fn partial(chat: &Chat, text: &str) {
    let Some(id) = chat.log_id() else { return };
    with_store(|s| {
        let Some(c) = s.list.iter_mut().find(|c| c.id == id && c.pending) else { return };
        // The session is named as the turn starts: a turn never finished is resumed too.
        if let Some(sid) = chat.cli_session().filter(|_| c.engine == "subscription") {
            c.session = sid;
        }
        let Some(last) = c.lines.last_mut().filter(|l| l.role == "assistant") else { return };
        last.content = format!("{}\n\n{}", crate::redact::redact(text.trim()), unfinished());
        s.save();
    });
}

/// A turn that did not go well: what it wrote, then why it ended.
pub fn failed(chat: &Chat, text: &str, why: &str) {
    let Some(id) = chat.log_id() else { return };
    with_store(|s| {
        let Some(c) = s.list.iter_mut().find(|c| c.id == id && c.pending) else { return };
        // The session is named as the turn starts: a turn never finished is resumed too.
        if let Some(sid) = chat.cli_session().filter(|_| c.engine == "subscription") {
            c.session = sid;
        }
        let Some(last) = c.lines.last_mut().filter(|l| l.role == "assistant") else { return };
        let why = format!("⚠ {}", why.trim());
        let text = crate::redact::redact(text.trim());
        last.content = if text.is_empty() { why } else { format!("{text}\n\n{why}") };
        c.pending = false;
        s.save();
    });
}

/// An answer written after the turn, when work left in the background ended
/// (claude_cli::follow): one more assistant line of the conversation.
pub fn later(chat: &Chat, reply: &str) {
    let Some(id) = chat.log_id() else { return };
    let now = now();
    with_store(|s| {
        let Some(c) = s.list.iter_mut().find(|c| c.id == id) else { return };
        c.lines.push(Line { role: "assistant".into(), content: reply.to_string() });
        c.updated = now;
        s.save();
    });
}

/// The last answer as it ended up (team.rs: after the check).
pub fn amend(chat: &Chat, reply: &str) {
    let Some(id) = chat.log_id() else { return };
    with_store(|s| {
        let Some(c) = s.list.iter_mut().find(|c| c.id == id) else { return };
        let Some(line) = c.lines.iter_mut().rev().find(|l| l.role == "assistant") else { return };
        line.content = reply.to_string();
        s.save();
    });
}

/// The end of the conversation, for an engine that has not seen it (team.rs).
pub fn tail(chat: &Chat, max: usize) -> String {
    let Some(id) = chat.log_id() else { return String::new() };
    let lines = with_store(|s| s.list.iter().find(|c| c.id == id).map(|c| c.lines.clone())).unwrap_or_default();
    tail_of(&lines, max)
}

fn tail_of(lines: &[Line], max: usize) -> String {
    let mut out: Vec<String> = Vec::new();
    let mut left = max;
    for l in lines.iter().rev() {
        let text = l.content.lines().filter(|x| !x.trim_start().starts_with("> ")).collect::<Vec<_>>().join("\n");
        let text = text.trim();
        let size = text.chars().count();
        if text.is_empty() {
            continue;
        }
        if size > left {
            break;
        }
        left -= size;
        out.push(format!("{}: {text}", if l.role == "user" { t("Utente") } else { t("Assistente") }));
    }
    out.reverse();
    out.join("\n\n")
}

/// Lines said elsewhere (desktop.rs: in Claude Desktop), after the conversation's own.
pub fn append(chat: &Chat, engine: &str, lines: &[Line]) {
    let Some(id) = chat.log_id() else { return };
    let now = now();
    with_store(|s| {
        let Some(pos) = s.list.iter().position(|c| c.id == id) else { return };
        let mut c = s.list.remove(pos);
        if c.engine.is_empty() {
            c.engine = engine.into();
        }
        c.updated = now;
        c.lines.push(Line { role: "assistant".into(), content: t("↗ Conversazione proseguita in Claude Desktop").to_string() });
        c.lines.extend(lines.iter().cloned());
        s.list.insert(0, c);
        s.save();
    });
}

fn summary(c: &Conversation) -> Summary {
    Summary { id: c.id.clone(), title: c.title.clone(), engine: c.engine.clone(), folder: c.folder.clone(), updated: c.updated, turns: c.lines.len() / 2, pinned: c.pinned }
}

/// Pinned first, then most recent first.
pub fn list() -> Vec<Summary> {
    with_store(|s| {
        let mut out: Vec<Summary> = s.list.iter().map(summary).collect();
        out.sort_by_key(|c| !c.pinned);
        out
    })
}

/// The conversations whose title or text has every word of `query` (no case).
pub fn search(query: &str) -> Vec<Summary> {
    let words: Vec<String> = query.split_whitespace().map(str::to_lowercase).collect();
    if words.is_empty() {
        return list();
    }
    with_store(|s| {
        let mut out: Vec<Summary> = s
            .list
            .iter()
            .filter(|c| {
                let mut text = c.title.to_lowercase();
                for l in &c.lines {
                    text.push('\n');
                    text.push_str(&l.content.to_lowercase());
                }
                words.iter().all(|w| text.contains(w.as_str()))
            })
            .map(summary)
            .collect();
        out.sort_by_key(|c| !c.pinned);
        out
    })
}

pub fn set_pinned(id: &str, pinned: bool) {
    with_store(|s| {
        if let Some(c) = s.list.iter_mut().find(|c| c.id == id) {
            c.pinned = pinned;
            s.save();
        }
    });
}

/// ✎ in the history list (asked by Edoardo on 27 Oct 2026).
pub fn rename(id: &str, new_title: &str) {
    with_store(|s| {
        if s.rename(id, new_title) {
            s.save();
        }
    });
}

/// «⑂ Dirama da qui»: a new conversation that starts with the first `keep`
/// lines of this one; this one stays in the history as it was.
pub fn fork(chat: &Chat, keep: Vec<Line>) {
    let key = chat.engine_key();
    let at = at_mark(chat, keep.len());
    let session = chat.cli_session();
    let preamble = (!keep.is_empty()).then(|| preamble(&keep));
    go_back(chat, &key, None, session, at, preamble);
}

/// The session's answer at the end of the first `n` lines of this conversation, if kept.
fn at_mark(chat: &Chat, n: usize) -> Option<String> {
    let id = chat.log_id()?;
    if n == 0 {
        return None;
    }
    with_store(|s| s.list.iter().find(|c| c.id == id).and_then(|c| c.marks.iter().rev().find(|(at, _)| *at == n).map(|(_, u)| u.clone())))
}

/// Back to an earlier point: Claude Code goes on in its own session from that
/// answer, as Claude Desktop does (a new session, the old one stays); else, or
/// if that session cannot be resumed, the conversation as text.
fn go_back(chat: &Chat, key: &str, id: Option<String>, session: Option<String>, at: Option<String>, preamble: Option<String>) {
    match (session.filter(|s| crate::desktop::session_exists(s)), at) {
        (Some(session), Some(at)) => {
            chat.restore(key, Vec::new(), id, None);
            chat.set_cli_session(Some(session));
            chat.set_resume_at(Some(at));
            chat.set_resume_fallback(preamble);
        }
        _ => chat.restore(key, Vec::new(), id, preamble),
    }
}

/// «Modifica» or «Rigenera» in the chat: the conversation goes back to its
/// first `keep` lines (in the history too) and the engine starts a new
/// conversation with them as text in front of the next question.
pub fn rewind(chat: &Chat, keep: Vec<Line>) {
    let key = chat.engine_key();
    let at = at_mark(chat, keep.len());
    let session = chat.cli_session();
    let mut id = chat.log_id();
    if let Some(i) = id.clone() {
        let n = keep.len();
        with_store(|s| {
            if n == 0 {
                s.list.retain(|c| c.id != i);
            } else if let Some(c) = s.list.iter_mut().find(|c| c.id == i) {
                c.lines.truncate(n);
                c.messages.clear();
                c.marks.retain(|(at, _)| *at <= n);
            }
            s.save();
        });
        if n == 0 {
            id = None;
        }
    }
    let preamble = (!keep.is_empty()).then(|| preamble(&keep));
    go_back(chat, &key, id, session, at, preamble);
}

/// Puts the conversation back in `chat`, ready for the next question.
/// `key` is what `chat_send` will pass to `Chat::use_engine` for its engine.
pub fn open(chat: &Chat, id: &str, key: &str) -> Result<Opened, String> {
    let c = with_store(|s| s.list.iter().find(|c| c.id == id).cloned())
        .ok_or_else(|| t("Questa conversazione non c'è più.").to_string())?;
    // Claude Code: its own session again, with all its context (Claude Desktop does the same).
    if c.engine == "subscription" && crate::desktop::session_exists(&c.session) {
        chat.restore(key, Vec::new(), Some(c.id.clone()), None);
        chat.set_cli_session(Some(c.session.clone()));
        chat.set_resume_fallback(Some(preamble(&c.lines)));
        let context = crate::desktop::last_context(&c.session).map(|used| (used, c.context_size));
        return Ok(Opened { engine: c.engine, lines: c.lines, folder: c.folder, context });
    }
    let preamble = if resends(&c.engine) && !c.messages.is_empty() { None } else { Some(preamble(&c.lines)) };
    chat.restore(key, c.messages, Some(c.id), preamble);
    Ok(Opened { engine: c.engine, lines: c.lines, folder: c.folder, context: None })
}

/// A message that joined the turn in progress (lib.rs `chat_steer`): after the
/// question, on its line, as the chat shows it («↪ …»).
pub fn steered(chat: &Chat, text: &str) {
    let Some(id) = chat.log_id() else { return };
    let text = crate::redact::redact(text.trim());
    with_store(|s| {
        let Some(c) = s.list.iter_mut().find(|c| c.id == id && c.pending) else { return };
        let n = c.lines.len();
        if let Some(q) = n.checked_sub(2).and_then(|i| c.lines.get_mut(i)).filter(|l| l.role == "user") {
            q.content.push_str(&format!("\n\n↪ {text}"));
            s.save();
        }
    });
}

/// How many lines the conversation of `chat` has in the history (0 = none yet).
pub fn line_count(chat: &Chat) -> usize {
    let Some(id) = chat.log_id() else { return 0 };
    with_store(|s| s.list.iter().find(|c| c.id == id).map_or(0, |c| c.lines.len()))
}

/// The Claude Code sessions the history already has.
pub fn sessions() -> std::collections::HashSet<String> {
    with_store(|s| s.list.iter().filter(|c| !c.session.is_empty()).map(|c| c.session.clone()).collect())
}

/// A Claude Code session started elsewhere, taken into the history (once):
/// reopened, it resumes that session (`open`). Back: the conversation's id.
pub fn import(session: &str) -> Result<String, String> {
    if let Some(id) = with_store(|s| s.list.iter().find(|c| c.session == session).map(|c| c.id.clone())) {
        return Ok(id);
    }
    let (lines, folder) = crate::desktop::whole(session).ok_or_else(|| t("Il file della sessione di Claude Code non si trova.").to_string())?;
    let first = lines.iter().find(|l| l.role == "user").map(|l| l.content.clone()).unwrap_or_default();
    let lines: Vec<Line> = lines.into_iter().map(|l| Line { role: l.role, content: crate::redact::redact(&l.content) }).collect();
    let id = new_id();
    let now = now();
    with_store(|s| {
        s.list.insert(0, Conversation {
            id: id.clone(),
            title: title(&crate::redact::redact(&first)),
            engine: "subscription".into(),
            created: now,
            updated: now,
            lines,
            folder,
            session: session.to_string(),
            ..Default::default()
        });
        s.save();
    });
    Ok(id)
}

pub fn folder_of(id: &str) -> Option<String> {
    with_store(|s| s.list.iter().find(|c| c.id == id).map(|c| c.folder.clone())).filter(|f| !f.is_empty())
}

/// The folders of the latest conversations, the most recent first.
pub fn folders() -> Vec<String> {
    let mut seen: Vec<String> = Vec::new();
    with_store(|s| {
        for c in &s.list {
            if !c.folder.is_empty() && !seen.iter().any(|f| f.eq_ignore_ascii_case(&c.folder)) {
                seen.push(c.folder.clone());
            }
        }
    });
    seen.into_iter().filter(|f| std::path::Path::new(f).is_dir()).take(8).collect()
}

pub fn engine_of(id: &str) -> Option<String> {
    with_store(|s| s.list.iter().find(|c| c.id == id).map(|c| c.engine.clone()))
}

pub fn delete(id: &str) {
    with_store(|s| {
        s.list.retain(|c| c.id != id);
        s.save();
    });
}

pub fn clear() {
    with_store(|s| {
        s.list.clear();
        s.save();
    });
}

/// The conversation so far, for an engine that cannot resume it on its own.
fn preamble(lines: &[Line]) -> String {
    let mut text = String::new();
    for l in lines {
        let who = if l.role == "user" { t("Utente") } else { t("Assistente") };
        text.push_str(&format!("{who}: {}\n\n", l.content.trim()));
    }
    let count = text.chars().count();
    if count > MAX_PREAMBLE_CHARS {
        text = format!("…{}", text.chars().skip(count - MAX_PREAMBLE_CHARS).collect::<String>());
    }
    tf(
        "Riprendiamo una conversazione di prima. Ecco com'era andata:\n\n{text}---\n\nNuova domanda: ",
        &[("text", &text)],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn store() -> Store {
        let path = std::env::temp_dir().join(format!("easyisland-chats-{}-{:?}.json", std::process::id(), std::thread::current().id()));
        let _ = std::fs::remove_file(&path);
        Store::load(path)
    }

    #[test]
    fn record_keeps_most_recent_first_and_the_first_question_as_title() {
        let mut s = store();
        s.record("a", "api", "Prima   domanda\nsu due righe", "uno", vec![], 1);
        s.record("b", "openai", "Altra", "due", vec![], 2);
        s.record("a", "api", "Seguito", "tre", vec![json!({"role": "user"})], 3);
        assert_eq!(s.list[0].id, "a");
        assert_eq!(s.list[0].title, "Prima domanda su due righe");
        assert_eq!(s.list[0].lines.len(), 4);
        assert_eq!(s.list[0].messages.len(), 1);
        assert_eq!(s.list[1].id, "b");
    }

    #[test]
    fn pinned_survive_the_cap() {
        let mut s = store();
        s.record("keep", "api", "q", "r", vec![], 0);
        s.list[0].pinned = true;
        for i in 0..MAX_CONVERSATIONS + 5 {
            s.record(&i.to_string(), "api", "q", "r", vec![], i as i64 + 1);
        }
        assert_eq!(s.list.len(), MAX_CONVERSATIONS);
        assert!(s.list.iter().any(|c| c.id == "keep"));
    }

    #[test]
    fn cap_drops_the_oldest() {
        let mut s = store();
        for i in 0..MAX_CONVERSATIONS + 5 {
            s.record(&i.to_string(), "api", "q", "r", vec![], i as i64);
        }
        assert_eq!(s.list.len(), MAX_CONVERSATIONS);
        assert!(s.list.iter().all(|c| c.id != "0"));
    }

    #[test]
    fn long_title_is_cut() {
        let long = "parola ".repeat(40);
        let t = title(&long);
        assert!(t.ends_with('…'));
        assert!(t.chars().count() <= MAX_TITLE_CHARS);
    }

    #[test]
    fn files_are_not_kept() {
        let m = vec![json!({ "role": "user", "content": [
            { "type": "document", "source": { "data": "QUJD" } },
            { "type": "text", "text": "ciao" },
        ]})];
        let out = serde_json::to_string(&without_files(m)).unwrap();
        assert!(!out.contains("QUJD"));
        assert!(out.contains("ciao"));
    }

    #[test]
    fn a_renamed_title_is_one_line_and_empty_goes_back_to_the_question() {
        let mut s = store();
        s.record("a", "api", "Prima domanda", "uno", vec![], 1);
        assert!(s.rename("a", "  Preventivo\n Rossi  "));
        assert_eq!(s.list[0].title, "Preventivo Rossi");
        assert!(s.rename("a", &"x".repeat(200)));
        assert_eq!(s.list[0].title.chars().count(), MAX_TITLE_CHARS);
        assert!(s.rename("a", "   "));
        assert_eq!(s.list[0].title, "Prima domanda");
        assert!(!s.rename("nope", "x"));
    }

    #[test]
    fn save_and_load_round_trip() {
        let mut s = store();
        s.record("a", "api", "q", "r", vec![], 1);
        s.save();
        let again = Store::load(s.path.clone());
        assert_eq!(again.list.len(), 1);
        s.list.clear();
        s.save();
        assert!(!s.path.exists());
    }

    #[test]
    fn preamble_keeps_the_end_of_a_long_conversation() {
        let lines: Vec<Line> = (0..2000).map(|i| Line { role: "user".into(), content: format!("messaggio {i}") }).collect();
        let p = preamble(&lines);
        assert!(p.contains("messaggio 1999"));
        assert!(!p.contains("messaggio 0\n"));
    }
}
