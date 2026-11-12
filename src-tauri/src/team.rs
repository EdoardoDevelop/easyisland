// «Multi motore» in the island's chat: the engines picked in Impostazioni → Chat
// work with the conversation's engine, which leads and is the only one that
// speaks to the user. docs/chat.md → Multi agent; why it works this way in
// docs/decisioni.md.
//
// - Helpers (`team_delegate`): the lead hands over a piece of work. Helpers
//   read and report, run together, and a helper that may write (`write`) takes
//   the turn's only writer place: parallel writers undo each other.
// - The check (`reviewed`): run by the app, not left to the lead's good will.
//   Another engine, of another family when there is one, sees the request and
//   the work without knowing who did it, and looks at the real state of things
//   in read-only mode. The lead weighs what it found against what the user
//   asked; no dialogue between the engines. Two checks at most.
// - One voice: with the check on the user sees the steps, not the draft, and then
//   one answer. Serious findings are rewritten into it by the lead; the engines
//   and their findings never appear in it (Edoardo, 6 Nov 2026).
//
// Only the lead's turn counts as the conversation; helpers' turns stay out of
// the history. A failed helper or check never costs the lead's answer.

use std::collections::HashMap;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::claude::{Chat, ChatContext, ChatReply};
use crate::i18n::{t, tf};

/// Pieces of work a turn may hand over at most.
const MAX_JOBS: usize = 6;
/// A helper answers within this: a tool call has 330 s (hook mcp.rs CALL_BUDGET).
const JOB_TIME: Duration = Duration::from_secs(300);
/// The check has no such limit, but a turn must end.
const CHECK_TIME: Duration = Duration::from_secs(480);
/// What goes back to the lead at most, what a helper gets of the conversation,
/// and what the checker gets of the request and of the work.
const MAX_RESULT: usize = 12_000;
const MAX_TAIL: usize = 6_000;
const MAX_QUESTION: usize = 4_000;
const MAX_WORK: usize = 16_000;
/// A plain answer shorter than this, with no steps, is not worth a check.
const WORTH_CHECKING: usize = 600;

/// A line of the chat while the team works.
#[derive(Clone, Serialize)]
struct Row {
    id: usize,
    engine: String,
    job: String,
    /// The last thing it said, for the chat's moving line.
    status: String,
    /// "work", "done" or "error".
    state: &'static str,
}

/// A turn with the team at work.
struct Turn {
    sid: String,
    chat: Arc<Chat>,
    members: Vec<(String, String)>,
    question: String,
    jobs: AtomicUsize,
    /// Held by the helper that may write.
    writer: tokio::sync::Mutex<()>,
    rows: Mutex<Vec<Row>>,
}

static TURNS: LazyLock<Mutex<HashMap<String, Arc<Turn>>>> = LazyLock::new(Default::default);
static NEXT_ROW: AtomicUsize = AtomicUsize::new(1);

/// The turn ends, whatever way it does.
struct Registered(String);

impl Drop for Registered {
    fn drop(&mut self) {
        TURNS.lock().unwrap().remove(&self.0);
    }
}

fn cut(text: &str, max: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= max {
        return text.to_string();
    }
    format!("{}…", text.chars().take(max).collect::<String>())
}

/// A line that only says what it was doing, a refused step included.
fn is_step(line: &str) -> bool {
    ["> ⚙", "> 💭", "> ✗"].iter().any(|m| line.trim_start().starts_with(m))
}

/// The reply without those lines.
fn clean(text: &str) -> String {
    text.lines().filter(|l| !is_step(l)).collect::<Vec<_>>().join("\n").trim().to_string()
}

/// Only those lines: what the chat shows of a draft.
fn steps_of(text: &str) -> String {
    text.lines().filter(|l| is_step(l)).collect::<Vec<_>>().join("\n\n")
}

/// Which makers' models an engine runs: two of a family tend to make the same mistakes.
fn family(id: &str, model: &str) -> String {
    let model = model.to_lowercase();
    match id {
        "subscription" | "api" => "claude".into(),
        "gemini" | "antigravity" => "gemini".into(),
        "openai" => "gpt".into(),
        _ if model.contains("claude") || model.contains("anthropic") => "claude".into(),
        _ if model.contains("gemini") => "gemini".into(),
        _ if model.contains("gpt") || model.contains("openai") => "gpt".into(),
        _ => id.to_string(),
    }
}

/// The engines with the lead, those of another family first (the first one checks).
fn order(lead: &str, picked: &[String], ready: Vec<(String, String)>, model_of: &dyn Fn(&str) -> String) -> Vec<(String, String)> {
    let own = family(lead, &model_of(lead));
    let mut members: Vec<(String, String)> = ready.into_iter().filter(|(id, _)| id != lead && picked.contains(id)).collect();
    members.sort_by_key(|(id, _)| family(id, &model_of(id)) == own);
    members
}

/// Can this engine open files and data? One that cannot only guesses at facts: at
/// the first real check it denied a line it had no way of reading.
fn can_look(id: &str, terminal: bool) -> bool {
    terminal || !crate::openai::ENGINES.contains(&id)
}

fn members(app: &AppHandle, lead: &str) -> Vec<(String, String)> {
    let (picked, models) = {
        let shared = app.state::<crate::Shared>();
        let s = shared.settings.lock().unwrap();
        (s.chat_team.clone(), s.engine_models.clone())
    };
    let ready = crate::telegram::engines(app).into_iter().filter(|(_, _, ok)| *ok).map(|(id, name, _)| (id.to_string(), name)).collect();
    order(lead, &picked, ready, &|id| models.get(id).cloned().unwrap_or_default())
}

/// What the lead is told in front of the question.
fn brief(sid: &str, members: &[(String, String)]) -> String {
    let list = members.iter().map(|(id, name)| format!("{id} ({name})")).collect::<Vec<_>>().join(", ");
    let mut text = tf(
        "[Multi agent. Guidi tu e con l'utente parli solo tu. Con lo strumento team_delegate (team: \"{sid}\") puoi affidare pezzi del lavoro a questi motori: {list}.\nDelega quando ci sono parti indipendenti, quando un altro modello è più adatto a quel pezzo o quando dati riservati devono restare su un motore locale. Una domanda semplice o ciò che fai subito da solo non si delega. Al massimo {max} incarichi per turno; quelli indipendenti mandali insieme.\nOgni incarico dice l'obiettivo, il risultato atteso, dove guardare e cosa non fare. L'aiutante vede solo la richiesta e la fine della conversazione, non ciò che hai letto o deciso: scrivigli ciò che gli serve.\nGli aiutanti leggono e riferiscono: le modifiche le fai tu. Usa write: true solo per un pezzo che quel motore fa meglio di te. Quello che ricevi è un parere da verificare, non un fatto.",
        &[("sid", &sid), ("list", &list), ("max", &MAX_JOBS)],
    );
    text.push(' ');
    text.push_str(t("Scrivi sempre come unico autore: non nominare gli altri motori, gli incarichi o i controlli."));
    text.push_str("]\n\n");
    text
}

/// What a helper gets: the request, the end of the conversation, its piece.
fn job_prompt(task: &str, output: &str, question: &str, tail: &str, write: bool) -> String {
    let mut text = t("Lavori come aiutante: un altro motore guida il lavoro e usa il tuo risultato. Non parli con l'utente.").to_string();
    text.push(' ');
    text.push_str(if write {
        t("Puoi modificare, ma solo ciò che chiede l'incarico.")
    } else {
        t("Sei in sola lettura: leggi, cerca e riferisci, non provare a modificare nulla.")
    });
    text.push_str("\n\n");
    text.push_str(&tf("Richiesta dell'utente:\n{q}", &[("q", &cut(question, MAX_QUESTION))]));
    if !tail.is_empty() {
        text.push_str("\n\n");
        text.push_str(&tf("Fine della conversazione:\n{c}", &[("c", &tail)]));
    }
    text.push_str("\n\n");
    text.push_str(&tf("Il tuo incarico:\n{task}", &[("task", &task)]));
    if !output.is_empty() {
        text.push_str("\n\n");
        text.push_str(&tf("Risultato atteso:\n{o}", &[("o", &output)]));
    }
    text.push_str("\n\n");
    text.push_str(t("Resta dentro l'incarico. Rispondi in modo sintetico, con le prove (file, righe, dati). Riferisci anche ciò che hai scoperto e chi guida deve sapere, pure se non era chiesto. Se ti manca qualcosa dillo, non indovinare."));
    text
}

/// What the checker gets: the request and the work, not who did it. Knowing
/// the author makes a judge lean; so does the author's reasoning.
pub(crate) fn check_prompt(question: &str, work: &str, folder: Option<&str>, tools: bool) -> String {
    let mut text = t("Controlla in modo indipendente il lavoro qui sotto, fatto per l'utente da un collega. Non modificare nulla.").to_string();
    if let Some(f) = folder {
        text.push(' ');
        text.push_str(&tf("Il lavoro riguarda la cartella {f}: guarda lo stato reale (file, git diff, dati) invece di fidarti del racconto.", &[("f", &f)]));
    }
    if !tools {
        text.push(' ');
        text.push_str(t("Non puoi aprire file o dati: guarda solo se il lavoro regge da sé, e non dire che qualcosa non esiste."));
    }
    text.push_str("\n\n");
    text.push_str(t("Cerca solo problemi che cambierebbero ciò che l'utente decide o fa: errori di fatto o di logica, parti della richiesta non fatte, certezze senza prova, rischi. Non sono problemi lo stile, il lavoro in più, un dubbio dichiarato, una domanda all'utente, un limite detto apertamente. Ciò che non puoi verificare non segnalarlo."));
    text.push_str("\n\n");
    text.push_str(t("Se non trovi problemi reali scrivi solo VA BENE. Altrimenti al massimo 5 punti, uno per riga: [GRAVE] o [MINORE], il problema e la prova."));
    text.push(' ');
    text.push_str(t("[GRAVE] solo se la risposta così sbaglia o può fare danni."));
    text.push_str("\n\n");
    text.push_str(&tf("Richiesta dell'utente:\n{q}", &[("q", &cut(question, MAX_QUESTION))]));
    text.push_str("\n\n");
    text.push_str(&tf("Lavoro del collega:\n{w}", &[("w", &cut(work, MAX_WORK))]));
    text
}

/// What goes back to the lead: it knows what the user asked, so it decides.
fn fix_prompt(findings: &str) -> String {
    tf(
        "[Rileggendo il tuo lavoro sono emersi questi punti. Verificali tu: correggi davvero ciò che è fondato e ignora il resto, senza aggiungere altro. Poi scrivi la risposta per l'utente, che non ha visto quella di prima: deve leggersi come la tua prima e unica risposta, completa. Non parlare di controlli, revisioni, altri motori o punti scartati. Se un dubbio resta, dillo come dubbio tuo.]\n\n{f}",
        &[("f", &findings)],
    )
}

#[derive(Debug, PartialEq)]
pub(crate) enum Verdict {
    Fine,
    Findings { text: String, count: usize, serious: bool },
    Empty,
}

pub(crate) fn verdict(reply: &str) -> Verdict {
    let text = clean(reply);
    if text.is_empty() {
        return Verdict::Empty;
    }
    let upper = text.to_uppercase();
    let serious = upper.contains("[GRAVE]") || upper.contains("[SERIOUS]");
    let marked = text.lines().filter(|l| {
        let l = l.to_uppercase();
        ["[GRAVE]", "[SERIOUS]", "[MINORE]", "[MINOR]"].iter().any(|m| l.contains(m))
    }).count();
    // Some engines think aloud first: the word may be the last line.
    let last = upper.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or_default();
    let fine = |l: &str| {
        let l = l.trim_start_matches(|c: char| !c.is_alphanumeric());
        l.starts_with("VA BENE") || l.starts_with("ALL GOOD")
    };
    if marked == 0 && (fine(&upper) || fine(last)) {
        return Verdict::Fine;
    }
    Verdict::Findings { text, count: marked.max(1), serious }
}

/// A plain short answer is left alone: a check there costs a turn and finds nothing.
fn worth_checking(reply: &str) -> bool {
    reply.lines().any(|l| l.trim_start().starts_with("> ⚙")) || clean(reply).chars().count() >= WORTH_CHECKING
}

/// A note under the answer: never a step, so it does not fold away.
fn with_note(answer: &str, note: &str) -> String {
    let quoted = note.lines().map(|l| format!("> {l}")).collect::<Vec<_>>().join("\n");
    format!("{}\n\n{quoted}", answer.trim_end())
}

fn publish(app: &AppHandle, turn: &Turn) {
    let rows = turn.rows.lock().unwrap().clone();
    let _ = app.emit_to(crate::island::WINDOW_LABEL, "chat-team", json!({ "sid": turn.sid, "rows": rows }));
}

fn add_row(app: &AppHandle, turn: &Turn, engine: &str, job: &str) -> usize {
    let id = NEXT_ROW.fetch_add(1, Ordering::Relaxed);
    turn.rows.lock().unwrap().push(Row { id, engine: engine.to_string(), job: cut(job, 120), status: String::new(), state: "work" });
    publish(app, turn);
    id
}

fn set_row(app: &AppHandle, turn: &Turn, id: usize, status: &str, state: &'static str) {
    if let Some(r) = turn.rows.lock().unwrap().iter_mut().find(|r| r.id == id) {
        r.status = status.to_string();
        r.state = state;
    }
    publish(app, turn);
}

/// The last block of what it is writing: the chat's line takes its step from there.
fn last_block(text: &str) -> String {
    cut(text.rsplit("\n\n").next().unwrap_or_default(), 300)
}

/// One turn of `engine` out of the conversation, stopped by the lead's «Ferma».
/// Ok(None): out of time, `so_far` holds what it had said.
async fn side_turn(app: &AppHandle, turn: &Turn, engine: &str, prompt: String, read_only: bool, row: usize, limit: Duration, so_far: &Mutex<String>) -> Result<Option<String>, String> {
    let chat = Chat::default();
    chat.set_folder(turn.chat.folder());
    chat.set_read_only(read_only);
    let on_text = |text: &str| {
        *so_far.lock().unwrap() = text.to_string();
        set_row(app, turn, row, &last_block(text), "work");
    };
    let work = Box::pin(crate::chat_turn(app, &chat, prompt, None, Some(engine.to_string()), None, false, crate::Channel::Helper, &on_text));
    let reply = tokio::time::timeout(limit, crate::until_stopped_in(&turn.chat, crate::Channel::Island, work)).await;
    crate::opencode::forget(chat.cli_session());
    crate::claude_cli::drop_live(&chat);
    match reply {
        Ok(r) => r.map(|r| Some(r.text)),
        Err(_) => Ok(None),
    }
}

/// team_delegate: a piece of the work to another engine; its result back to the lead.
pub async fn tool_delegate(app: &AppHandle, args: &Value) -> Result<String, String> {
    let arg = |key: &str| args.get(key).and_then(Value::as_str).unwrap_or_default().trim().to_string();
    let Some(turn) = TURNS.lock().unwrap().get(&arg("team")).cloned() else {
        return Err(t("Multi agent non è attivo in questo turno: fai tu il lavoro.").into());
    };
    let (engine, task, output) = (arg("engine"), arg("task"), arg("output"));
    if task.is_empty() {
        return Err(t("task: cosa deve fare l'altro motore, con il contesto che gli serve.").into());
    }
    let Some((_, name)) = turn.members.iter().find(|(id, _)| *id == engine) else {
        let list = turn.members.iter().map(|(id, _)| id.as_str()).collect::<Vec<_>>().join(", ");
        return Err(tf("engine: uno dei motori di questo turno ({list}).", &[("list", &list)]));
    };
    if turn.jobs.fetch_add(1, Ordering::SeqCst) >= MAX_JOBS {
        return Err(tf("Limite di {n} incarichi per turno raggiunto: finisci tu il lavoro.", &[("n", &MAX_JOBS)]));
    }
    let write = args.get("write").and_then(Value::as_bool).unwrap_or(false);
    crate::log::line(format!("chat: multi agent, incarico a {engine}{}", if write { " con modifiche" } else { "" }));
    let row = add_row(app, &turn, name, &task);
    // One writer at a time: the others wait here, the readers go on.
    let _writer = if write { Some(turn.writer.lock().await) } else { None };
    let prompt = job_prompt(&task, &output, &turn.question, &crate::chat_log::tail(&turn.chat, MAX_TAIL), write);
    let so_far = Mutex::new(String::new());
    match side_turn(app, &turn, &engine, prompt, !write, row, JOB_TIME, &so_far).await {
        Ok(Some(text)) => {
            set_row(app, &turn, row, "", "done");
            Ok(cut(&clean(&text), MAX_RESULT))
        }
        Ok(None) => {
            set_row(app, &turn, row, t("Tempo scaduto"), "error");
            let part = clean(&so_far.lock().unwrap());
            Ok(format!("{}\n\n{}", tf("{e} non ha finito in tempo. Ecco cosa aveva scritto:", &[("e", name)]), cut(&part, MAX_RESULT)))
        }
        Err(e) => {
            set_row(app, &turn, row, &e, "error");
            Err(e)
        }
    }
}

/// One look of the checker at the work.
async fn look(app: &AppHandle, turn: &Turn, checker: &(String, String), work: &str, terminal: bool) -> Result<Verdict, String> {
    let row = add_row(app, turn, &checker.1, t("Controlla il lavoro"));
    let folder = terminal.then(|| turn.chat.folder()).flatten();
    let prompt = check_prompt(&turn.question, work, folder.as_deref(), can_look(&checker.0, terminal));
    let so_far = Mutex::new(String::new());
    let reply = side_turn(app, turn, &checker.0, prompt, true, row, CHECK_TIME, &so_far).await;
    match reply {
        Ok(Some(text)) => {
            set_row(app, turn, row, "", "done");
            Ok(verdict(&text))
        }
        Ok(None) => {
            set_row(app, turn, row, t("Tempo scaduto"), "error");
            Err(t("tempo scaduto").into())
        }
        Err(e) => {
            set_row(app, turn, row, &e, "error");
            Err(e)
        }
    }
}

/// The lead's answer through the check. The user sees one answer in one voice:
/// only a serious finding goes back to the lead, who rewrites it as its own; what
/// the checker wrote never reaches the chat, and the log says who it was.
/// Whatever fails here, the answer stays.
#[allow(clippy::too_many_arguments)]
async fn reviewed(app: &AppHandle, turn: &Turn, checker: &(String, String), engine: Option<String>, auto: bool, terminal: bool, first: String, on_text: &(dyn Fn(&str) + Sync)) -> String {
    let steps = steps_of(&first);
    let mut answer = first;
    for round in 0..2 {
        crate::log::line(format!("chat: multi agent, controllo di {} ({})", checker.0, round + 1));
        match look(app, turn, checker, &answer, terminal).await {
            Err(e) if e == crate::stopped_text() => return answer,
            Err(e) => {
                crate::log::line(format!("chat: multi agent, controllo non riuscito: {e}"));
                return with_note(&answer, t("⚠ Controllo non riuscito"));
            }
            Ok(Verdict::Empty) => return with_note(&answer, t("⚠ Controllo non riuscito")),
            Ok(Verdict::Fine) => return with_note(&answer, t("✓ Controllato")),
            Ok(Verdict::Findings { text, serious: false, .. }) => {
                crate::log::line(format!("chat: multi agent, rilievi minori lasciati: {}", cut(&text, 400)));
                return with_note(&answer, t("✓ Controllato"));
            }
            Ok(Verdict::Findings { text, .. }) => {
                let fix = Box::pin(crate::chat_turn(app, &turn.chat, fix_prompt(&text), None, engine.clone(), None, auto, crate::Channel::Revision, on_text)).await;
                match fix {
                    Ok(r) if steps.is_empty() => answer = r.text,
                    Ok(r) => answer = format!("{steps}\n\n{}", r.text),
                    Err(e) if e == crate::stopped_text() => return answer,
                    Err(_) => return with_note(&answer, t("⚠ Da ricontrollare: la revisione non è riuscita")),
                }
            }
        }
    }
    answer
}

/// A turn of the island's chat with «Multi motore» on.
#[allow(clippy::too_many_arguments)]
pub(crate) async fn run(app: &AppHandle, chat: Arc<Chat>, sid: &str, query: String, context: Option<ChatContext>, engine: Option<String>, auto: bool, on_text: &(dyn Fn(&str) + Sync)) -> Result<ChatReply, String> {
    let (lead, terminal, agent, check) = {
        let shared = app.state::<crate::Shared>();
        let s = shared.settings.lock().unwrap();
        (engine.clone().filter(|e| !e.is_empty()).unwrap_or_else(|| s.chat_engine.clone()), s.chat_terminal, s.agent_tools, s.chat_team_check)
    };
    let members = members(app, &lead);
    if members.is_empty() {
        return crate::chat_turn(app, &chat, query, context, engine, None, auto, crate::Channel::Island, on_text).await;
    }
    let turn = Arc::new(Turn {
        sid: sid.to_string(),
        chat: chat.clone(),
        members: members.clone(),
        question: query.clone(),
        jobs: AtomicUsize::new(0),
        writer: tokio::sync::Mutex::new(()),
        rows: Mutex::new(Vec::new()),
    });
    TURNS.lock().unwrap().insert(sid.to_string(), turn.clone());
    let _registered = Registered(sid.to_string());
    // Only an engine with our tools can hand work over; any can be checked.
    let delegates = agent && (terminal || !crate::openai::ENGINES.contains(&lead.as_str()));
    let told = delegates.then(|| brief(sid, &members));
    if let Some(b) = &told {
        let before = chat.take_preamble().unwrap_or_default();
        chat.put_back_preamble(format!("{before}{b}"));
    }
    // With a check to come the draft stays here: the chat gets the steps, then one answer.
    let steps = |text: &str| on_text(&steps_of(text));
    let shown: &(dyn Fn(&str) + Sync) = if check { &steps } else { on_text };
    let reply = crate::chat_turn(app, &chat, query, context, engine.clone(), None, auto, crate::Channel::Island, shown).await;
    let reply = match reply {
        Ok(r) => r,
        Err(e) => {
            // An unsent preamble comes back for the next question: not this part of it.
            if let (Some(b), Some(p)) = (&told, chat.take_preamble()) {
                let rest = p.replace(b.as_str(), "");
                if !rest.is_empty() {
                    chat.put_back_preamble(rest);
                }
            }
            return Err(e);
        }
    };
    if !check || !worth_checking(&reply.text) {
        return Ok(reply);
    }
    // The first that can look: the families' order stays among them.
    let Some(checker) = members.iter().find(|(id, _)| can_look(id, terminal)).or(members.first()) else { return Ok(reply) };
    let text = reviewed(app, &turn, checker, engine, auto, terminal, reply.text, shown).await;
    crate::chat_log::amend(&chat, &text);
    Ok(ChatReply { text })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// With the real Claude Code: a read-only helper cannot write, and the check
    /// finds a planted bug and passes the fixed code:
    /// `cargo test --lib team::tests::live_check -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_check() {
        tauri::async_runtime::block_on(async {
            let dir = std::env::temp_dir().join(format!("team-live-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            let file = dir.join("media.py");
            let ask = |q: String| {
                let dir = dir.clone();
                async move {
                    let chat = Chat::default();
                    chat.set_read_only(true);
                    let r = crate::claude_cli::send(&chat, "haiku", &[], false, q, None, Some(dir.as_path()), false, &|_| {}, false, None).await;
                    r.unwrap().text
                }
            };
            let said = ask("Crea il file nuovo.txt in questa cartella con scritto ciao e sovrascrivi media.py. Poi dimmi cosa hai fatto.".to_string()).await;
            println!("--- scrittura\n{said}");
            assert!(!dir.join("nuovo.txt").exists(), "a read-only helper wrote a file");

            std::fs::write(&file, "def media(a):\n    return sum(a) / (len(a) - 1)\n").unwrap();
            let work = "Ho scritto media() in media.py: calcola la media dei numeri della lista. È corretta.";
            let wrong = ask(check_prompt("Scrivi una funzione che calcola la media di una lista", work, dir.to_str(), true)).await;
            println!("--- sbagliato\n{wrong}\n{:?}", verdict(&wrong));
            assert!(matches!(verdict(&wrong), Verdict::Findings { .. }), "the planted bug went unseen");

            std::fs::write(&file, "def media(a):\n    return sum(a) / len(a) if a else 0\n").unwrap();
            let right = ask(check_prompt("Scrivi una funzione che calcola la media di una lista", work, dir.to_str(), true)).await;
            println!("--- giusto\n{right}\n{:?}", verdict(&right));
            let _ = std::fs::remove_dir_all(&dir);
        });
    }

    #[test]
    fn verdicts() {
        assert_eq!(verdict("VA BENE"), Verdict::Fine);
        assert_eq!(verdict("> ⚙ Legge · `a.rs`\n\n**Va bene.**"), Verdict::Fine);
        assert_eq!(verdict("All good."), Verdict::Fine);
        assert_eq!(verdict("> ⚙ Legge · `a.rs`"), Verdict::Empty);
        // A step refused to the read-only checker is not a finding (opencode, live).
        assert_eq!(verdict("> ⚙ Esegue · `python`\n\n> ✗ Permission denied: shell\n\nVA BENE"), Verdict::Fine);
        assert_eq!(verdict("Ho letto il file e la logica torna.\n\nVA BENE"), Verdict::Fine);
        // A point with a mark counts whatever comes first.
        let v = verdict("Va bene, ma:\n[GRAVE] manca il test\n[MINORE] refuso");
        assert!(matches!(v, Verdict::Findings { count: 2, serious: true, .. }));
        assert!(matches!(verdict("[MINORE] refuso"), Verdict::Findings { count: 1, serious: false, .. }));
        // Words without the marks are still findings: better read than lost.
        assert!(matches!(verdict("La cifra è sbagliata."), Verdict::Findings { count: 1, serious: false, .. }));
    }

    #[test]
    fn only_real_work_is_checked() {
        assert!(!worth_checking("Sono le 12."));
        assert!(worth_checking("Fatto.\n\n> ⚙ Modifica · `a.rs`"));
        assert!(worth_checking(&"x".repeat(WORTH_CHECKING)));
    }

    #[test]
    fn another_family_checks_first() {
        let ready = |l: &[&str]| l.iter().map(|e| (e.to_string(), e.to_string())).collect::<Vec<_>>();
        let picked: Vec<String> = ["api", "gemini", "subscription"].iter().map(|s| s.to_string()).collect();
        let none = |_: &str| String::new();
        let m = order("subscription", &picked, ready(&["subscription", "api", "gemini", "openai"]), &none);
        assert_eq!(m.iter().map(|x| x.0.as_str()).collect::<Vec<_>>(), ["gemini", "api"], "not the lead, not unpicked, another family first");
        assert!(order("gemini", &["gemini".to_string()], ready(&["gemini"]), &none).is_empty());
        assert_eq!(family("opencode", "anthropic/claude-sonnet"), "claude");
        assert_eq!(family("ollama", "llama3"), "ollama");
    }

    #[test]
    fn the_checker_does_not_know_the_author() {
        let p = check_prompt("Fai X", "Ho fatto X", Some("C:\\Lavoro"), true);
        assert!(p.contains("Fai X") && p.contains("Ho fatto X") && p.contains("C:\\Lavoro") && p.contains("VA BENE"));
        assert!(!p.contains("Claude") && !p.contains("Gemini"));
        assert!(!p.contains("Non puoi aprire") && check_prompt("Fai X", "Ho fatto X", None, false).contains("Non puoi aprire"));
    }

    #[test]
    fn prompts_say_what_counts() {
        let b = brief("c1", &[("gemini".into(), "Gemini".into())]);
        assert!(b.contains("team: \"c1\"") && b.contains("gemini (Gemini)") && b.contains("unico autore") && b.ends_with("]\n\n"));
        assert!(fix_prompt("[GRAVE] x").contains("prima e unica risposta"));
        let read = job_prompt("Leggi", "Un elenco", "Domanda", "", false);
        assert!(read.contains("sola lettura") && read.contains("Un elenco") && !read.contains("Fine della conversazione"));
        assert!(job_prompt("Scrivi", "", "Domanda", "Utente: ciao", true).contains("Puoi modificare"));
    }

    #[test]
    fn notes_stay_out_of_the_folded_steps() {
        assert_eq!(with_note("Risposta\n", "✓ Controllato"), "Risposta\n\n> ✓ Controllato");
        // The chat gets the steps of a draft, never its words.
        assert_eq!(steps_of("> ⚙ Legge · `a`\n\nBozza da non mostrare\n\n> ✗ Negato"), "> ⚙ Legge · `a`\n\n> ✗ Negato");
        assert_eq!(steps_of("Bozza"), "");
        assert_eq!(clean("Testo\n> 💭 _penso_\n> ⚙ Legge"), "Testo");
        assert_eq!(last_block("uno\n\n> ⚙ Legge"), "> ⚙ Legge");
    }
}
