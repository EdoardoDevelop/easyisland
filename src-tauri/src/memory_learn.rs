// The memory written after the answer (13 Nov 2026). Measured on the laptop
// over two weeks: 375 of 3,984 steps were the chat keeping its own memory
// (memory_note, memory_page, memory_page_write, memory_forget), each one
// re-reading the whole conversation, ~84k tokens on average. Now EasyIsland
// sends the question and the final answer alone, with no conversation and no
// tools, to a light model (Claude Code's Haiku with the subscription, or the
// «Motore per la memoria»), and writes what it says is worth keeping with
// memory::note. The chat is told it does not need to (memory::preface): it
// uses memory_note only when the user asks it to remember something.
//
// One at a time, in the background: the answer is already on screen.

use crate::claude::Chat;
use crate::i18n::tf;
use tauri::{AppHandle, Manager};

/// Questions shorter than this are not worth a call ("ok", "grazie", "sì").
const MIN_QUESTION: usize = 20;
const MAX_QUESTION: usize = 2_000;
const MAX_ANSWER: usize = 2_500;
const MAX_NOTES: usize = 3;

static ONE_AT_A_TIME: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Engine and model for the pass, when there is one: the memory's own engine
/// (Impostazioni → Chat → Memoria), else Claude Code's light model.
fn engine(app: &AppHandle) -> Option<(String, Option<String>)> {
    let shared = app.try_state::<crate::Shared>()?;
    let s = shared.settings.lock().unwrap();
    if !s.chat_learn {
        return None;
    }
    if !s.memory_engine.is_empty() {
        return Some((s.memory_engine.clone(), None));
    }
    (s.chat_engine == "subscription").then(|| ("subscription".to_string(), Some("haiku".to_string())))
}

/// EasyIsland keeps the memory after the answers: the chat need not.
pub fn active(app: &AppHandle) -> bool {
    engine(app).is_some()
}

/// After a turn of the chat (lib.rs chat_turn): learn from it in the background.
pub fn after(app: &AppHandle, question: &str, answer: &str) {
    let question = question.trim();
    if question.chars().count() < MIN_QUESTION || question.starts_with('/') {
        return;
    }
    let Some((engine, model)) = engine(app) else { return };
    let answer = crate::agentchat::clean_reply(answer).unwrap_or_default();
    if answer.chars().count() < 40 {
        return;
    }
    let prompt = prompt(&cut(question, MAX_QUESTION), &cut(&answer, MAX_ANSWER), &crate::memory::notes());
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let _one = ONE_AT_A_TIME.lock().await;
        let chat = Chat::plain();
        let reply = crate::chat_turn(&app, &chat, prompt, None, Some(engine.clone()), model, false, crate::Channel::Helper, &|_| {}).await;
        if engine == "opencode" {
            crate::opencode::forget(chat.cli_session());
        }
        let text = match reply {
            Ok(r) => r.text,
            Err(e) => {
                crate::log::line(format!("memoria dopo la risposta: non riuscita: {e}"));
                return;
            }
        };
        let before = crate::memory::notes().len();
        for note in notes_of(&text) {
            let _ = crate::memory::note(&note);
        }
        let kept = crate::memory::notes().len().saturating_sub(before);
        crate::log::line(format!("memoria dopo la risposta: {kept} note"));
        if kept > 0 {
            use tauri::Emitter;
            let _ = app.emit_to(crate::MEMORY_LABEL, "memory-refresh", ());
        }
    });
}

fn cut(text: &str, max: usize) -> String {
    let n = text.chars().count();
    if n <= max {
        text.to_string()
    } else {
        format!("{}…", text.chars().take(max).collect::<String>())
    }
}

fn prompt(question: &str, answer: &str, notes: &[String]) -> String {
    let skip = notes.len().saturating_sub(40);
    let known: String = notes.iter().skip(skip).map(|n| format!("{}\n", n.trim())).collect();
    tf(
        "Sei la memoria di EasyIsland. Da questo scambio tra l'utente e il suo assistente tieni solo ciò che servirà le prossime volte: preferenze dell'utente, fatti che restano veri su clienti, persone, PC, reti, indirizzi e percorsi, come si fa una cosa che ha funzionato, decisioni prese. Non tenere: cose del momento, risposte generiche, ciò che sa chiunque, password, codici o chiavi.

NOTE GIÀ IN MEMORIA (non ripeterle):
{known}
DOMANDA DELL'UTENTE:
{question}

RISPOSTA DELL'ASSISTENTE:
{answer}

Rispondi con al massimo {max} righe che iniziano con \"- \", ognuna una nota completa da sola (chi o cosa, poi il fatto), in italiano, al massimo 200 caratteri; oppure solo NIENTE. Nient'altro.",
        &[("known", &if known.is_empty() { "(nessuna)\n".to_string() } else { known }), ("question", &question), ("answer", &answer), ("max", &MAX_NOTES.to_string())],
    )
}

/// The "- " lines of the answer, at most MAX_NOTES; none for NIENTE.
fn notes_of(text: &str) -> Vec<String> {
    text.lines()
        .map(str::trim)
        .filter_map(|l| l.strip_prefix("- ").or_else(|| l.strip_prefix("• ")))
        .map(|l| l.trim().trim_matches('"').trim().to_string())
        .filter(|l| l.chars().count() >= 10 && !l.eq_ignore_ascii_case("niente"))
        .take(MAX_NOTES)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn notes_from_the_answer() {
        assert!(notes_of("NIENTE").is_empty());
        assert_eq!(notes_of("- Talenti: dominio talenti.local\n- Rossi preferisce le offerte in PDF\ntesto\n- uno\n- Quarta nota abbastanza lunga\n- Quinta nota abbastanza lunga"), vec![
            "Talenti: dominio talenti.local".to_string(),
            "Rossi preferisce le offerte in PDF".to_string(),
            "Quarta nota abbastanza lunga".to_string(),
        ]);
    }

    #[test]
    fn the_prompt_has_the_exchange_and_the_notes() {
        let p = prompt("Qual è il dominio di Talenti?", "talenti.local", &["- 2026-11-01: nota vecchia".to_string()]);
        assert!(p.contains("Qual è il dominio di Talenti?"));
        assert!(p.contains("nota vecchia"));
        assert!(p.contains("al massimo 3 righe"));
    }
}
