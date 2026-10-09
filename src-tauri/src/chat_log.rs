// Chat history: the conversations of the island's chat, to read again and
// carry on.
//
// Each finished turn is written to chats.json in %LOCALAPPDATA%\EasyIsland
// (whole file to a temporary sibling, then renamed over the old one). It keeps
// what the chat showed (questions and answers) and, for the engines that send
// the whole conversation each time (API, OpenRouter, OpenAI, Gemini, Ollama,
// LM Studio), the messages as the model saw them, without the dropped files'
// bytes. Claude Code (`claude -p`) and opencode keep their conversation in a
// session of their own, which does not outlive EasyIsland reliably: reopened,
// they get the previous conversation as text in the first message
// (`Chat::take_preamble`). Nothing leaves the PC. Off with Impostazioni → Chat
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
    /// Unix milliseconds.
    created: i64,
    updated: i64,
    lines: Vec<Line>,
    /// The engine's own messages, for the engines that resend them each turn.
    messages: Vec<Value>,
}

/// One row of the list in the chat.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    pub id: String,
    pub title: String,
    pub engine: String,
    pub updated: i64,
    pub turns: usize,
}

/// A conversation reopened: the island shows `lines` and keeps using `engine`.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    pub engine: String,
    pub lines: Vec<Line>,
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
        c.lines.push(Line { role: "user".into(), content: query.into() });
        c.lines.push(Line { role: "assistant".into(), content: reply.into() });
        c.messages = messages;
        // Most recent first; the oldest beyond the cap go.
        let c = self.list.remove(pos);
        self.list.insert(0, c);
        self.list.truncate(MAX_CONVERSATIONS);
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

/// After a turn that went well (lib.rs `chat_send`).
pub fn record(chat: &Chat, engine: &str, query: &str, reply: &str) {
    let id = chat.log_id().unwrap_or_else(|| {
        let id = new_id();
        chat.set_log_id(Some(id.clone()));
        id
    });
    let messages = if resends(engine) { without_files(chat.snapshot()) } else { Vec::new() };
    let now = now();
    with_store(|s| {
        s.record(&id, engine, query, reply, messages, now);
        s.save();
    });
}

pub fn list() -> Vec<Summary> {
    with_store(|s| {
        s.list
            .iter()
            .map(|c| Summary { id: c.id.clone(), title: c.title.clone(), engine: c.engine.clone(), updated: c.updated, turns: c.lines.len() / 2 })
            .collect()
    })
}

/// Puts the conversation back in `chat`, ready for the next question.
/// `key` is what `chat_send` will pass to `Chat::use_engine` for its engine.
pub fn open(chat: &Chat, id: &str, key: &str) -> Result<Opened, String> {
    let c = with_store(|s| s.list.iter().find(|c| c.id == id).cloned())
        .ok_or_else(|| t("Questa conversazione non c'è più.").to_string())?;
    let preamble = if resends(&c.engine) && !c.messages.is_empty() { None } else { Some(preamble(&c.lines)) };
    chat.restore(key, c.messages, Some(c.id), preamble);
    Ok(Opened { engine: c.engine, lines: c.lines })
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
