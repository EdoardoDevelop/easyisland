// Smistatore (14 Nov 2026, Edoardo: "una llm per gestire tutta l'app… fargli
// fare i compiti base per poi passarli agli attuali motori"). No model of its
// own: it learns from use, with the recipes (recipes.rs).
//
// 1. Registro dei turni: every chat turn (question, engine, tools, tokens, how
//    it went) in `turni.bin`, encrypted (DPAPI) like the recipes, the last
//    MAX_TURNS. Impostazioni → Chat shows what it saved.
// 2. Strada diretta: a question a recipe answers for sure (recipes::sure: one
//    read, the same values twice in a row, no word it never saw) gets the read
//    here, with no engine and no tokens. Asked again (or «Chiedi al motore»),
//    it goes to the engine and that recipe is never direct again.
// 4. Preparazione: the reads of the recipes that fit, with fixed values, run
//    before the engine and ride in front of the question: a step less, and a
//    step re-reads the whole conversation.
//
// Only READS, never anything that changes, opens or sends.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::AppHandle;

use crate::claude::Chat;
use crate::i18n::{t, tf};

/// What the smistatore may run by itself: reads of the user's own data.
pub const READS: &[&str] = &[
    "list_status", "list_quick_actions", "media_status", "list_work_folder", "list_uploaded_files",
    "notion_query", "notion_read", "remote_status", "pc_check", "todo_list", "list_profiles",
    "list_automations", "task_list", "skill_list", "document_templates", "custom_list",
    "custom_records", "portal_list", "memory_check",
];
/// Seconds, not milliseconds: answered directly when asked, never prepared.
const SLOW: &[&str] = &["pc_check"];
const MAX_TURNS: usize = 500;
const MAX_PREPARED: usize = 3000;
const MAX_DIRECT: usize = 6000;
/// Asked again within this time: the answer was not enough.
const AGAIN_SECS: i64 = 600;

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Turn {
    pub at: i64,
    pub question: String,
    pub engine: String,
    #[serde(default)]
    pub model: String,
    pub channel: String,
    /// "motore", "diretta", "al motore" (asked again after a direct answer), "errore".
    pub how: String,
    #[serde(default)]
    pub tools: Vec<String>,
    #[serde(default)]
    pub prepared: Vec<String>,
    #[serde(default)]
    pub ms: u64,
    #[serde(default)]
    pub steps: u64,
    #[serde(default)]
    pub read: u64,
    #[serde(default)]
    pub out: u64,
    /// The same question came again soon after.
    #[serde(default)]
    pub again: bool,
}

#[derive(Serialize, Deserialize, Default)]
struct Log {
    turns: Vec<Turn>,
}

static LOG: Mutex<Option<Log>> = Mutex::new(None);
/// The last direct answer of each conversation: (chat, question, steps).
static LAST_DIRECT: Mutex<Vec<(usize, String, Vec<String>)>> = Mutex::new(Vec::new());
/// Conversations whose last reply was direct (chat_send tells the island).
static WAS_DIRECT: Mutex<Vec<usize>> = Mutex::new(Vec::new());

fn path() -> std::path::PathBuf {
    crate::settings::config_dir().join("turni.bin")
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn with_log<R>(f: impl FnOnce(&mut Log) -> R) -> R {
    let mut g = LOG.lock().unwrap();
    if g.is_none() {
        let saved = if cfg!(test) { None } else { std::fs::read(path()).ok() }
            .and_then(|b| crate::secrets::dpapi(&b, false))
            .and_then(|j| serde_json::from_slice::<Log>(&j).ok());
        *g = Some(saved.unwrap_or_default());
    }
    f(g.as_mut().unwrap())
}

fn save(log: &Log) {
    if cfg!(test) {
        return;
    }
    let Ok(json) = serde_json::to_vec(log) else { return };
    match crate::secrets::dpapi(&json, true) {
        Some(sealed) => {
            if let Err(e) = crate::settings::write_atomic(&path(), &sealed) {
                crate::log::line(format!("smistatore: registro non salvato ({e})"));
            }
        }
        None => crate::log::line("smistatore: registro non cifrato, non salvato"),
    }
}

fn key(chat: &Chat) -> usize {
    chat as *const Chat as usize
}

/// Tappa 1: a turn is over.
pub fn record(mut turn: Turn) {
    turn.at = now();
    turn.question = crate::redact::redact(&crate::recipes::bare_question(&turn.question)).chars().take(200).collect();
    with_log(|l| {
        if let Some(last) = l.turns.iter_mut().rev().find(|x| x.channel == turn.channel) {
            if turn.at - last.at <= AGAIN_SECS && crate::recipes::same_question(&last.question, &turn.question) {
                last.again = true;
            }
        }
        l.turns.push(turn);
        if l.turns.len() > MAX_TURNS {
            let extra = l.turns.len() - MAX_TURNS;
            l.turns.drain(..extra);
        }
        save(l);
    });
}

pub enum Direct {
    /// Answered here: the text, the tool read.
    Answer(String, String),
    /// The same question after a direct answer: the engine, this time and from now on.
    Refused,
    None,
}

fn split(step: &str) -> (&str, &str) {
    step.split_once(' ').unwrap_or((step, "{}"))
}

/// Tappa 2: the answer without an engine, when a recipe is sure of it.
pub async fn direct(app: &AppHandle, chat: &Chat, asked: &str) -> Direct {
    let k = key(chat);
    let last = {
        let mut g = LAST_DIRECT.lock().unwrap();
        g.iter().position(|(c, _, _)| *c == k).map(|i| g.remove(i))
    };
    if let Some((_, q, steps)) = last {
        if crate::recipes::same_question(&q, asked) {
            crate::recipes::no_direct(&steps);
            crate::log::line("smistatore: domanda ripetuta dopo una risposta diretta, al motore");
            return Direct::Refused;
        }
    }
    let Some(r) = crate::recipes::sure(asked) else { return Direct::None };
    let Some(step) = r.steps.first() else { return Direct::None };
    let (tool, args) = split(step);
    if !READS.contains(&tool) {
        return Direct::None;
    }
    // A recipe keeps 400 characters of the values: cut ones are not run.
    let Ok(args) = serde_json::from_str::<Value>(args) else { return Direct::None };
    let Ok(out) = crate::agent::read(app, tool, &args).await else { return Direct::None };
    let shown = show(&out);
    // The engine hears of it at the next question, as a preamble.
    let note = tf("[Prima di questa domanda EasyIsland ha risposto da solo, senza motore, a «{q}» con:\n{a}]\n\n", &[
        ("q", &crate::recipes::bare_question(asked)),
        ("a", &cap(&shown, 1500)),
    ]);
    let before = chat.take_preamble().unwrap_or_default();
    chat.put_back_preamble(format!("{before}{note}"));
    LAST_DIRECT.lock().unwrap().push((k, asked.to_string(), r.steps.clone()));
    {
        let mut w = WAS_DIRECT.lock().unwrap();
        if !w.contains(&k) {
            w.push(k);
        }
    }
    crate::log::line(format!("smistatore: risposta diretta con {tool}"));
    Direct::Answer(
        format!(
            "{shown}\n\n⚡ {}",
            tf("Risposta diretta di EasyIsland, senza motore: come per «{q}». Per la risposta del motore riscrivi la domanda.", &[("q", &r.question)])
        ),
        tool.to_string(),
    )
}

/// The last reply of this conversation was direct (chat_send, once).
pub fn was_direct(chat: &Chat) -> bool {
    let k = key(chat);
    let mut g = WAS_DIRECT.lock().unwrap();
    match g.iter().position(|c| *c == k) {
        Some(i) => {
            g.remove(i);
            true
        }
        None => false,
    }
}

/// Tappa 4: the reads the fitting recipes needed, done now, in front of the
/// question. Returns the text and the steps read (recipes::end counts them).
pub async fn prepare(app: &AppHandle, asked: &str) -> Option<(String, Vec<String>)> {
    let mut parts: Vec<String> = Vec::new();
    let mut done: Vec<String> = Vec::new();
    let mut room = MAX_PREPARED;
    for r in crate::recipes::fitting(asked) {
        for step in &r.steps {
            let (tool, args) = split(step);
            if !READS.contains(&tool) || SLOW.contains(&tool) || done.contains(step) || room < 200 {
                continue;
            }
            // Values that change with the question (a month) are the engine's to pick.
            let fixed = args.trim() == "{}" || r.same >= 2;
            let Ok(a) = serde_json::from_str::<Value>(args) else { continue };
            if !fixed {
                continue;
            }
            if let Ok(out) = crate::agent::read(app, tool, &a).await {
                let text = cap(out.trim(), room);
                room = room.saturating_sub(text.chars().count());
                parts.push(format!("{step} →\n{text}"));
                done.push(step.clone());
            }
        }
    }
    if parts.is_empty() {
        return None;
    }
    Some((
        format!(
            "{}\n{}]\n\n",
            t("[Già letto da EasyIsland per questa domanda, con gli strumenti che le domande simili hanno usato: se questi dati bastano rispondi con questi, senza richiamare gli strumenti."),
            parts.join("\n\n")
        ),
        done,
    ))
}

fn cap(text: &str, max: usize) -> String {
    if text.chars().count() <= max {
        text.to_string()
    } else {
        format!("{}…", text.chars().take(max).collect::<String>())
    }
}

/// A tool's answer as something to read: JSON as a list, text as it is.
fn show(text: &str) -> String {
    let out = match serde_json::from_str::<Value>(text.trim()) {
        Ok(Value::Array(items)) if !items.is_empty() => items.iter().map(|i| format!("- {}", line_of(i))).collect::<Vec<_>>().join("\n"),
        Ok(Value::Object(o)) if !o.is_empty() => o.iter().map(|(k, v)| format!("- **{k}**: {}", plain(v))).collect::<Vec<_>>().join("\n"),
        _ => text.trim().to_string(),
    };
    cap(&out, MAX_DIRECT)
}

const NAMES: &[&str] = &["nome", "name", "titolo", "title"];

fn line_of(v: &Value) -> String {
    let Value::Object(o) = v else { return plain(v) };
    let head = NAMES.iter().find_map(|n| o.get(*n).and_then(Value::as_str)).map(str::to_string);
    let rest: Vec<String> = o.iter()
        .filter(|(k, v)| !NAMES.contains(&k.as_str()) && !plain(v).is_empty())
        .map(|(k, v)| format!("{k}: {}", plain(v)))
        .collect();
    match head {
        Some(h) if rest.is_empty() => format!("**{h}**"),
        Some(h) => format!("**{h}** · {}", rest.join(" · ")),
        None => rest.join(" · "),
    }
}

fn plain(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::String(s) => s.trim().to_string(),
        Value::Array(a) => a.iter().map(plain).filter(|s| !s.is_empty()).collect::<Vec<_>>().join(", "),
        Value::Object(o) => o.iter().map(|(k, v)| format!("{k} {}", plain(v))).collect::<Vec<_>>().join(", "),
        other => other.to_string(),
    }
}

/// Impostazioni → Chat → «Smistatore».
pub fn stats() -> Value {
    with_log(|l| {
        let engine: Vec<&Turn> = l.turns.iter().filter(|t| t.how == "motore" || t.how == "al motore").collect();
        let read: Vec<u64> = engine.iter().map(|t| t.read).filter(|r| *r > 0).collect();
        let avg = if read.is_empty() { 0 } else { read.iter().sum::<u64>() / read.len() as u64 };
        let direct = l.turns.iter().filter(|t| t.how == "diretta").count();
        json!({
            "turns": l.turns.len(),
            "direct": direct,
            "refused": l.turns.iter().filter(|t| t.how == "al motore").count(),
            "prepared": l.turns.iter().filter(|t| !t.prepared.is_empty()).count(),
            "again": l.turns.iter().filter(|t| t.again).count(),
            "saved": avg * direct as u64,
        })
    })
}

pub fn forget() {
    with_log(|l| {
        l.turns.clear();
        save(l);
    });
    if !cfg!(test) {
        let _ = std::fs::remove_file(path());
    }
    crate::log::line("smistatore: registro dei turni dimenticato");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tool_answers_read_as_lists() {
        let status = r#"[{"nome":"Rete","livello":"ok","riassunto":"Online","dettagli":[{"IP":"192.168.1.5"}]},{"nome":"Meteo","riassunto":"in attesa"}]"#;
        assert_eq!(show(status), "- **Rete** · livello: ok · riassunto: Online · dettagli: IP 192.168.1.5\n- **Meteo** · riassunto: in attesa");
        assert_eq!(show(r#"{"brano":"X","stato":"in pausa"}"#), "- **brano**: X\n- **stato**: in pausa");
        assert_eq!(show("Nessuna azione rapida."), "Nessuna azione rapida.");
        assert!(show(&"a".repeat(MAX_DIRECT + 10)).ends_with('…'));
    }

    #[test]
    fn asked_again_is_marked() {
        let before = with_log(|l| std::mem::take(&mut l.turns));
        record(Turn { question: "stato del computer".into(), channel: "isola".into(), how: "diretta".into(), ..Default::default() });
        record(Turn { question: "[x]\n\nStato del computer?".into(), channel: "isola".into(), how: "al motore".into(), read: 30_000, ..Default::default() });
        record(Turn { question: "che tempo fa".into(), channel: "isola".into(), how: "motore".into(), read: 10_000, ..Default::default() });
        let (first, s) = (with_log(|l| l.turns.first().map(|t| t.again)), stats());
        with_log(|l| l.turns = before);
        assert_eq!(first, Some(true));
        assert_eq!(s["direct"], 1);
        assert_eq!(s["refused"], 1);
        assert_eq!(s["saved"], 20_000);
    }

    #[test]
    fn only_reads() {
        for w in ["notion_add_row", "run_quick_action", "open_app", "open_url", "remote_run", "memory_note", "media_control", "dvc_show"] {
            assert!(!READS.contains(&w), "{w}");
        }
    }
}
