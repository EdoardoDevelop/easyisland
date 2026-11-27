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
    "notion_query", "notion_read", "remote_status", "pc_check", "todo_list",
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
/// The memory lines of a reply from the memory, per conversation, until chat_send takes them.
static MEMORY: Mutex<Vec<(usize, Vec<String>)>> = Mutex::new(Vec::new());
/// The command offered with a reply, per conversation, until chat_send takes it.
static COMMANDS: Mutex<Vec<(usize, crate::commands::Command)>> = Mutex::new(Vec::new());

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
/// `only` («Solo EasyIsland»): never to the engine, so a question asked again
/// is answered again; `recipes`: the agent's tools are on (a recipe reads with them).
pub async fn direct(app: &AppHandle, chat: &Chat, asked: &str, command: Option<crate::commands::Command>, only: bool, recipes: bool) -> Direct {
    let k = key(chat);
    let last = {
        let mut g = LAST_DIRECT.lock().unwrap();
        g.iter().position(|(c, _, _)| *c == k).map(|i| g.remove(i))
    };
    if let Some((_, q, steps)) = last.filter(|_| !only) {
        if asked_again(&q, asked, &steps) {
            if steps.iter().all(|s| !s.starts_with('@')) {
                crate::recipes::no_direct(&steps);
            }
            crate::log::line("smistatore: domanda ripetuta dopo una risposta diretta, al motore");
            return Direct::Refused;
        }
    }
    if let Some(c) = command {
        return offer(chat, asked, c);
    }
    let Some((r, steps)) = crate::recipes::sure(asked).filter(|_| recipes) else { return from_memory(app, chat, asked, only).await };
    let Some(step) = steps.first() else { return Direct::None };
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

/// The memory lines that answer this question, no engine: the ones voted (or
/// learnt) for a similar question first (votes.rs), else memory_answer::pick
/// without the lines voted 👎. With no meaning service, the words alone.
pub async fn memory_lines(app: &AppHandle, question: &str) -> Vec<String> {
    lines_from_memory(app, question, true).await
}

/// The same lines without the votes: «Riprova» (votes.rs `check`) tests the
/// memory, not the votes again.
pub async fn memory_lines_unvoted(app: &AppHandle, question: &str) -> Vec<String> {
    lines_from_memory(app, question, false).await
}

async fn lines_from_memory(app: &AppHandle, question: &str, voted: bool) -> Vec<String> {
    // The memory off (Impostazioni → Chat): nothing from it.
    let remember = tauri::Manager::try_state::<crate::Shared>(app).is_some_and(|s| s.settings.lock().unwrap().chat_history);
    if !remember || !crate::memory_answer::is_lookup(question) {
        return Vec::new();
    }
    let (mut found, engine) = crate::memory_meaning::deep_scored(app, question).await;
    let min = if found.is_empty() {
        found = crate::memory_meaning::all_lines().await.into_iter().map(|l| (0.0, l)).collect();
        0.0
    } else {
        crate::memory_meaning::answer_min(&engine)
    };
    if voted {
        let taught = crate::votes::taught(question, &|l| found.iter().any(|(_, x)| x == l));
        if !taught.is_empty() {
            return taught;
        }
        let rejected = crate::votes::rejected(question);
        found.retain(|(_, l)| !rejected.contains(l));
    }
    crate::memory_answer::pick(question, &found, min)
}

/// «Risposte dalla memoria» (memory_answer.rs): a lookup the memory's lines
/// answer for sure, shown as they are, no engine. Asked again, or «Chiedi al
/// motore», the engine (the lines ride in front of it, as always).
async fn from_memory(app: &AppHandle, chat: &Chat, asked: &str, only: bool) -> Direct {
    let question = crate::recipes::bare_question(asked);
    let lines = memory_lines(app, &question).await;
    if lines.is_empty() {
        return Direct::None;
    }
    let k = key(chat);
    let body: String = lines.iter().map(|l| format!("- {}
", crate::memory_answer::shown(l))).collect();
    // The engine hears of it at the next question, as a preamble.
    let note = tf("[Prima di questa domanda EasyIsland ha risposto da solo, dalla memoria, a «{q}» con:
{a}]

", &[("q", &question), ("a", &body)]);
    let before = chat.take_preamble().unwrap_or_default();
    chat.put_back_preamble(format!("{before}{note}"));
    mark_direct(k, asked);
    {
        let mut m = MEMORY.lock().unwrap();
        m.retain(|(x, _)| *x != k);
        m.push((k, lines.clone()));
    }
    crate::log::line(format!("smistatore: risposta dalla memoria ({} righe)", lines.len()));
    let tail = if only { t("«Chiedi al motore» per la risposta di un motore.") } else { t("Per la risposta del motore riscrivi la domanda.") };
    // «Modello sul PC» (local_model.rs): it writes the lines as an answer, the
    // lines stay under it; anything it names that they do not have, and the lines alone.
    let text = match crate::local_model::compose(app, &question, &lines).await {
        Some((composed, model)) => format!(
            "{composed}

{}

{body}
📒 {}",
            t("Dalle righe della memoria:"),
            tf("Scritta da {m} su questo PC con le righe della memoria, senza motore. {tail}", &[("m", &model), ("tail", &tail)])
        ),
        None => format!("{}

{body}
📒 {}", t("Dalla memoria:"), tf("Risposta di EasyIsland dalla memoria, senza motore. {tail}", &[("tail", &tail)])),
    };
    Direct::Answer(text, "memoria".into())
}

fn mark_direct(k: usize, asked: &str) {
    LAST_DIRECT.lock().unwrap().push((k, asked.to_string(), Vec::new()));
    let mut w = WAS_DIRECT.lock().unwrap();
    if !w.contains(&k) {
        w.push(k);
    }
}

/// «Solo EasyIsland» with no answer of its own: the closest lines, and
/// «Chiedi al motore» under it (the same question then goes to the engine).
pub async fn only_none(app: &AppHandle, chat: &Chat, asked: &str) -> String {
    let question = crate::recipes::bare_question(asked);
    let (mut found, _) = crate::memory_meaning::deep_scored(app, &question).await;
    if found.is_empty() {
        found = crate::memory_meaning::all_lines().await.into_iter().map(|l| (0.0, l)).collect();
    }
    let rejected = crate::votes::rejected(&question);
    found.retain(|(_, l)| !rejected.contains(l));
    let near = crate::memory_answer::near(&question, &found, 3);
    mark_direct(key(chat), asked);
    crate::log::line(format!("smistatore: solo EasyIsland, nessuna risposta sicura ({} righe vicine)", near.len()));
    if near.is_empty() {
        return format!("📒 {}", t("Solo EasyIsland: nella memoria non trovo niente di sicuro su questo. «Chiedi al motore» per la risposta di un motore."));
    }
    let body: String = near.iter().map(|l| format!("- {}
", crate::memory_answer::shown(l))).collect();
    format!("{}

{body}
📒 {}", t("Non ho una risposta sicura dalla memoria. Le righe più vicine:"), t("Solo EasyIsland. «Chiedi al motore» per la risposta di un motore; se una di queste era la risposta, scrivilo in una nota con le parole della domanda."))
}

/// The memory lines of the last reply of this conversation (chat_send, once): for its 👍 / 👎.
pub fn take_memory(chat: &Chat) -> Vec<String> {
    let k = key(chat);
    let mut g = MEMORY.lock().unwrap();
    match g.iter().position(|(c, _)| *c == k) {
        Some(i) => g.remove(i).1,
        None => Vec::new(),
    }
}

/// LAST_DIRECT marks: a command offered, and that offer taken back by
/// «Chiedi al motore» / Rigenera (the chat rewound).
const OFFERED: &str = "@offerta";
const TO_ENGINE: &str = "@motore";

/// The chat went back before its last question (chat_rewind: «Chiedi al
/// motore», Rigenera, a question edited): a command offered there sends the
/// same question, asked again, to the engine.
pub fn rewound(chat: &Chat) {
    let k = key(chat);
    for (c, _, steps) in LAST_DIRECT.lock().unwrap_or_else(|e| e.into_inner()).iter_mut() {
        if *c == k && steps.first().is_some_and(|s| s == OFFERED) {
            *steps = vec![TO_ENGINE.to_string()];
        }
    }
}

/// The question after a direct answer asks the same again (so the engine's
/// turn). After an answer from the memory (no steps) the same things asked:
/// «quale ip ha Falchi?» after «quale vm ha Falchi?» is another question
/// (same_question drops «vm» and «ip»; review of 16 Nov 2026).
fn asked_again(before: &str, asked: &str, steps: &[String]) -> bool {
    // A command offered: written again it is offered again («pausa» twice);
    // after «Chiedi al motore» (rewound) the same question goes to the engine.
    if steps.first().is_some_and(|s| s == OFFERED) {
        return false;
    }
    if steps.first().is_some_and(|s| s == TO_ENGINE) {
        return crate::recipes::same_question(before, asked);
    }
    if steps.is_empty() {
        crate::memory_answer::similar(&crate::recipes::bare_question(before), &crate::recipes::bare_question(asked))
    } else {
        crate::recipes::same_question(before, asked)
    }
}

/// Tappa 1 of the 14 Nov ideas: a short order («apri Teams», «profilo
/// Ufficio», «pausa») gets its button at once, no engine; nothing runs until
/// the user presses «Esegui» (chat_command_run). Written again it gets its
/// button again («pausa» twice is two pauses, not a question rewritten,
/// review of 16 Nov 2026); «Chiedi al motore» (the chat rewound, then the same
/// question: `rewound`) sends it to the engine.
fn offer(chat: &Chat, asked: &str, c: crate::commands::Command) -> Direct {
    let k = key(chat);
    LAST_DIRECT.lock().unwrap().push((k, asked.to_string(), vec![OFFERED.to_string()]));
    {
        let mut w = WAS_DIRECT.lock().unwrap();
        if !w.contains(&k) {
            w.push(k);
        }
    }
    let text = tf("Posso farlo subito, senza motore: **{what}**.", &[("what", &c.label)]);
    let tool = c.tool.clone();
    {
        let mut p = COMMANDS.lock().unwrap();
        p.retain(|(x, _)| *x != k);
        p.push((k, c));
    }
    crate::log::line(format!("smistatore: comando {tool}"));
    Direct::Answer(text, tool)
}

/// The command offered with the last reply of this conversation (chat_send, once).
pub fn take_command(chat: &Chat) -> Option<crate::commands::Command> {
    let k = key(chat);
    let mut g = COMMANDS.lock().unwrap();
    let i = g.iter().position(|(c, _)| *c == k)?;
    Some(g.remove(i).1)
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
        // A recipe with placeholders: its steps for this question, or none.
        let filled = crate::recipes::steps_for(&r, asked);
        if !r.template.is_empty() && filled.is_none() {
            continue;
        }
        let steps = filled.unwrap_or_else(|| r.steps.clone());
        for step in &steps {
            let (tool, args) = split(step);
            if !READS.contains(&tool) || SLOW.contains(&tool) || done.contains(step) || room < 200 {
                continue;
            }
            // Values that change with the question (a month) are the engine's
            // to pick, unless the recipe knows which of them the question gives.
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
    fn repeated_after_memory_means_the_same_things() {
        // After the memory: the same subjects again → the engine; another subject → not.
        assert!(asked_again("quale vm ha Falchi?", "che VM ha falchi", &[]));
        assert!(!asked_again("quale vm ha Falchi?", "quale ip ha Falchi?", &[]));
        assert!(!asked_again("che pc ha la comunale 2?", "che pc ha la comunale 3?", &[]));
        // After a recipe: as before.
        let steps = vec!["pc_check".to_string()];
        assert!(asked_again("stato del computer", "Stato del computer?", &steps));
        // A command: written again, offered again; after «Chiedi al motore», the engine.
        assert!(!asked_again("pausa", "pausa", &[OFFERED.to_string()]));
        assert!(asked_again("pausa", "pausa", &[TO_ENGINE.to_string()]));
        assert!(!asked_again("pausa", "apri teams", &[TO_ENGINE.to_string()]));
    }

    #[test]
    fn only_reads() {
        for w in ["notion_add_row", "run_quick_action", "open_app", "open_url", "remote_run", "memory_note", "media_control", "dvc_show"] {
            assert!(!READS.contains(&w), "{w}");
        }
    }
}
