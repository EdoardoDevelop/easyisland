// 👍 / 👎 under the chat's answers (15 Nov 2026, Edoardo: «non converrebbe
// mettere un like o dislike alle risposte?»). EasyIsland learns from them,
// with no model of its own and no tokens:
//   - 👍 on an answer from the memory: those lines are the answer to the
//     similar questions (memory_answer::similar), before the usual choice;
//   - 👎 on it: those lines are never the answer to them again;
//   - 👍 on an engine's answer to a lookup: the memory lines it was made of
//     (memory_answer::used_lines) answer the similar questions directly;
//   - every vote is a test: «Riprova» in Impostazioni → Chat runs the voted
//     questions again on today's memory (router::memory_lines) and says which
//     ones changed.
// Encrypted (DPAPI) like the turn log, the last MAX_VOTES, never sent anywhere.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Mutex;
use tauri::AppHandle;

const MAX_VOTES: usize = 1000;

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Vote {
    pub at: i64,
    pub question: String,
    /// The start of the answer, to tell two answers to the same question apart.
    pub answer: String,
    pub engine: String,
    /// "memoria" (lines from the memory), "diretta" (a recipe or a command), "motore".
    pub how: String,
    /// The memory lines of the answer (memoria) or the ones it was made of (motore, 👍).
    #[serde(default)]
    pub lines: Vec<String>,
    pub up: bool,
}

#[derive(Serialize, Deserialize, Default)]
struct Book {
    votes: Vec<Vote>,
}

static BOOK: Mutex<Option<Book>> = Mutex::new(None);

fn path() -> std::path::PathBuf {
    crate::settings::config_dir().join("voti.bin")
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn with_book<R>(f: impl FnOnce(&mut Book) -> R) -> R {
    let mut g = BOOK.lock().unwrap_or_else(|e| e.into_inner());
    if g.is_none() {
        let saved = if cfg!(test) { None } else { std::fs::read(path()).ok() }
            .and_then(|b| crate::secrets::dpapi(&b, false))
            .and_then(|j| serde_json::from_slice::<Book>(&j).ok());
        *g = Some(saved.unwrap_or_default());
    }
    f(g.as_mut().unwrap())
}

fn save(book: &Book) {
    if cfg!(test) {
        return;
    }
    let Ok(json) = serde_json::to_vec(book) else { return };
    match crate::secrets::dpapi(&json, true) {
        Some(sealed) => {
            if let Err(e) = crate::settings::write_atomic(&path(), &sealed) {
                crate::log::line(format!("voti: non salvati ({e})"));
            }
        }
        None => crate::log::line("voti: non cifrati, non salvati"),
    }
}

fn head(answer: &str) -> String {
    answer.trim().chars().take(300).collect()
}

/// A vote given (`up` Some) or taken back (None). Returns what was learnt, for
/// the notice in the chat.
pub async fn vote(question: &str, answer: &str, engine: &str, direct: bool, lines: Vec<String>, up: Option<bool>) -> String {
    let question = crate::recipes::bare_question(question);
    let answer_head = head(answer);
    let how = if !lines.is_empty() { "memoria" } else if direct { "diretta" } else { "motore" };
    // An engine's answer to a lookup: the memory lines it was made of.
    let lines = if how == "motore" && up == Some(true) {
        let all = crate::memory_meaning::all_lines().await;
        crate::memory_answer::used_lines(&question, answer, &all)
    } else {
        lines
    };
    let learnt = match (up, how) {
        (None, _) => String::new(),
        (Some(true), "memoria") => crate::i18n::t("Bene: alle domande come questa risponderò con queste righe.").into(),
        (Some(false), "memoria") => crate::i18n::t("Segnato: queste righe non sono più la risposta a domande come questa. «Chiedi al motore» per la sua risposta.").into(),
        (Some(true), "motore") if !lines.is_empty() => crate::i18n::tf("Imparato: alle domande come questa risponderò da solo con {n}.", &[("n", &if lines.len() == 1 { crate::i18n::t("la riga della memoria che ha usato il motore").to_string() } else { crate::i18n::t("le righe della memoria che ha usato il motore").to_string() })]),
        (Some(true), _) => crate::i18n::t("Grazie, segnato.").into(),
        (Some(false), _) => crate::i18n::t("Segnato. Se manca qualcosa nella memoria, scrivilo in una nota: la prossima volta lo trovo.").into(),
    };
    with_book(|b| {
        b.votes.retain(|v| !(v.question == question && v.answer == answer_head));
        if let Some(up) = up {
            b.votes.push(Vote { at: now(), question: question.clone(), answer: answer_head, engine: engine.to_string(), how: how.to_string(), lines: lines.clone(), up });
            if b.votes.len() > MAX_VOTES {
                let extra = b.votes.len() - MAX_VOTES;
                b.votes.drain(..extra);
            }
        }
        save(b);
    });
    crate::log::line(format!("voti: {} su una risposta {how} ({} righe)", match up { Some(true) => "👍", Some(false) => "👎", None => "tolto" }, lines.len()));
    learnt
}

/// The lines voted (or learnt) as the answer to a question like this one, the
/// newest first; only those still in the memory (`present`).
pub fn taught(question: &str, present: &dyn Fn(&str) -> bool) -> Vec<String> {
    with_book(|b| {
        let rejected = rejected_in(b, question);
        b.votes
            .iter()
            .rev()
            .filter(|v| v.up && !v.lines.is_empty() && crate::memory_answer::similar(&v.question, question))
            // Still lines that name what is asked: a 👍 on «che controller ha
            // Rossi?» never answers «che contratto ha Rossi?».
            .map(|v| v.lines.iter().filter(|l| present(l) && !rejected.contains(*l) && crate::memory_answer::names_all(question, l)).cloned().collect::<Vec<_>>())
            .find(|l| !l.is_empty())
            .unwrap_or_default()
    })
}

fn rejected_in(b: &Book, question: &str) -> Vec<String> {
    // A newer 👍 on the same line wins over an older 👎.
    let mut out: Vec<String> = Vec::new();
    let mut kept: Vec<String> = Vec::new();
    for v in b.votes.iter().rev().filter(|v| v.how == "memoria" && crate::memory_answer::similar(&v.question, question)) {
        for l in &v.lines {
            if kept.contains(l) || out.contains(l) {
                continue;
            }
            if v.up { kept.push(l.clone()) } else { out.push(l.clone()) }
        }
    }
    out
}

/// The lines voted 👎 for a question like this one.
pub fn rejected(question: &str) -> Vec<String> {
    with_book(|b| rejected_in(b, question))
}

/// Impostazioni → Chat: how many, and how the answers from the memory went.
pub fn stats() -> Value {
    with_book(|b| {
        let n = |how: &str, up: bool| b.votes.iter().filter(|v| v.how == how && v.up == up).count();
        json!({
            "votes": b.votes.len(),
            "memoryUp": n("memoria", true),
            "memoryDown": n("memoria", false),
            "engineUp": n("motore", true),
            "engineDown": n("motore", false),
            "directUp": n("diretta", true),
            "directDown": n("diretta", false),
            "learnt": b.votes.iter().filter(|v| v.how == "motore" && v.up && !v.lines.is_empty()).count(),
        })
    })
}

/// «Riprova»: the voted questions asked again of today's memory, no engine,
/// and without the votes themselves (they would always confirm themselves).
/// A 👍 holds if the same lines still come; a 👎 if they do not.
pub async fn check(app: &AppHandle) -> Value {
    let votes: Vec<Vote> = with_book(|b| b.votes.iter().filter(|v| !v.lines.is_empty()).cloned().collect());
    let mut tried = 0;
    let mut changed: Vec<Value> = Vec::new();
    let mut seen: Vec<String> = Vec::new();
    for v in votes.iter().rev() {
        if seen.iter().any(|q| crate::memory_answer::similar(q, &v.question)) {
            continue;
        }
        seen.push(v.question.clone());
        tried += 1;
        let got = crate::router::memory_lines_unvoted(app, &v.question).await;
        let same = v.lines.iter().all(|l| got.contains(l));
        let holds = if v.up { same } else { !v.lines.iter().any(|l| got.contains(l)) };
        if !holds {
            changed.push(json!({
                "question": v.question,
                "up": v.up,
                "now": got.iter().map(|l| crate::memory_answer::shown(l)).collect::<Vec<_>>(),
            }));
        }
    }
    crate::log::line(format!("voti: riprova di {tried} domande, {} cambiate", changed.len()));
    json!({ "tried": tried, "changed": changed })
}

pub fn forget() {
    with_book(|b| {
        b.votes.clear();
        save(b);
    });
    if !cfg!(test) {
        let _ = std::fs::remove_file(path());
    }
    crate::log::line("voti: dimenticati");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn votes_teach_and_reject() {
        forget();
        let vm = "[[farmacia-falchi]] VM: FALCHI-DC, FALCHI-WINFARM".to_string();
        let ip = "[[farmacia-falchi]] IP 192.168.0.254".to_string();
        tauri::async_runtime::block_on(vote("quale vm ha Falchi?", "Dalla memoria: …", "subscription", true, vec![ip.clone()], Some(false)));
        assert_eq!(rejected("che VM ha falchi"), vec![ip.clone()]);
        assert!(rejected("quale ip ha falchi?").is_empty());
        tauri::async_runtime::block_on(vote("quale vm ha Falchi?", "Dalla memoria: altro", "subscription", true, vec![vm.clone()], Some(true)));
        assert_eq!(taught("che vm ha falchi?", &|_| true), vec![vm.clone()]);
        // A line voted for one thing does not answer another with the same start.
        let ctl = "[[rossi]] controller UniFi".to_string();
        tauri::async_runtime::block_on(vote("che controller ha Rossi?", "Dalla memoria: …", "subscription", true, vec![ctl.clone()], Some(true)));
        assert_eq!(taught("che controller ha rossi", &|_| true), vec![ctl.clone()]);
        assert!(taught("che contratto ha Rossi?", &|_| true).is_empty());
        // Gone from the memory: not taught any more.
        assert!(taught("che vm ha falchi?", &|l| l != vm).is_empty());
        // Taken back.
        tauri::async_runtime::block_on(vote("quale vm ha Falchi?", "Dalla memoria: altro", "subscription", true, vec![vm.clone()], None));
        assert!(taught("che vm ha falchi?", &|_| true).is_empty());
        forget();
    }
}
