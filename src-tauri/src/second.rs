// «⇄ Seconda opinione» (asked by Edoardo on 19 October 2026): under the last
// answer of the chat, in the island and on Telegram, another engine reviews
// it — the last question and its answer only, in a conversation of its own,
// one turn, with no tools of ours (no Notion map, no easyisland tools, no
// terminal mode). What it says is shown as its own message and rides in
// front of the next question to the main engine, which can then correct
// itself. Never started by itself, and no dialogue between the engines.
//
// "Ferma" stops it like a turn (lib.rs `until_stopped`).

use tauri::{AppHandle, Manager};

use crate::claude::Chat;
use crate::i18n::tf;

/// What the reviewer gets of the question and of the answer at most (Antigravity's prompt rides on the command line).
const MAX_QUESTION: usize = 4_000;
const MAX_ANSWER: usize = 12_000;

fn cut(text: &str, max: usize) -> String {
    let text = text.trim();
    if text.chars().count() <= max {
        return text.to_string();
    }
    format!("{}…", text.chars().take(max).collect::<String>())
}

/// An engine's name, as the chat menus show it.
pub(crate) fn engine_name(app: &AppHandle, id: &str) -> String {
    crate::telegram::engines(app).into_iter().find(|(e, _, _)| *e == id).map(|(_, name, _)| name).unwrap_or_else(|| id.to_string())
}

fn prompt(first: &str, question: &str, answer: &str) -> String {
    tf(
        "Un altro assistente ({first}) ha risposto alla domanda dell'utente qui sotto. Fai da revisore: cerca errori, imprecisioni, cose mancanti o rischiose. Rispondi in modo breve, nella lingua dell'utente: solo i punti da correggere o aggiungere, ognuno con il motivo. Se la risposta va bene, dillo in una riga. Non riscriverla da capo.\n\nDomanda dell'utente:\n{q}\n\nRisposta di {first}:\n{a}",
        &[("first", &first), ("q", &cut(question, MAX_QUESTION)), ("a", &cut(answer, MAX_ANSWER))],
    )
}

/// What goes in front of the next question to the main engine.
pub(crate) fn note(reviewer: &str, text: &str) -> String {
    format!("{}\n{}]\n\n", tf("[Seconda opinione di {r} sulla tua ultima risposta, chiesta e letta dall'utente:", &[("r", &reviewer)]), cut(text, MAX_ANSWER))
}

/// Runs the review with `engine`; on success, its text, already put in front
/// of the next question of `main` (the conversation that was reviewed).
#[allow(clippy::too_many_arguments)]
pub(crate) async fn run(
    app: &AppHandle,
    main: &Chat,
    engine: &str,
    first: &str,
    question: &str,
    answer: &str,
    telegram: bool,
    on_text: &(dyn Fn(&str) + Sync),
) -> Result<String, String> {
    if answer.trim().is_empty() {
        return Err(crate::i18n::t("Non c'è una risposta da rivedere.").into());
    }
    let (model, cli_model, other, url) = {
        let shared = app.state::<crate::Shared>();
        let s = shared.settings.lock().unwrap();
        (s.model.clone(), s.cli_model.clone(), s.engine_models.get(engine).cloned().unwrap_or_default(), s.engine_urls.get(engine).cloned())
    };
    let first_name = engine_name(app, first);
    let reviewer = engine_name(app, engine);
    crate::log::line(format!("chat: seconda opinione di {engine} su {first}"));
    let query = prompt(&first_name, question, answer);
    // A conversation of its own, forgotten at the end.
    let chat = Chat::default();
    let turn = async {
        match engine {
            "api" => crate::claude::send(&chat, &model, query, None).await,
            "subscription" => crate::claude_cli::send(&chat, &cli_model, &[], false, query, None, None, false, on_text, telegram, None).await,
            "opencode" => {
                let o = crate::opencode::Options { telegram, ..Default::default() };
                crate::opencode::send(app, &chat, &other, query, None, &o, on_text).await
            }
            "antigravity" => crate::antigravity::send(&chat, &other, query, None, None, on_text, telegram).await,
            e if crate::openai::ENGINES.contains(&e) => crate::openai::send(&chat, e, &other, url.as_deref(), query, None, on_text).await,
            _ => Err(crate::i18n::t("Motore della chat sconosciuto.").into()),
        }
    };
    let reply = crate::until_stopped(telegram, turn).await;
    crate::opencode::forget(chat.cli_session());
    let text = reply?.text;
    let before = main.take_preamble().unwrap_or_default();
    main.put_back_preamble(format!("{before}{}", note(&reviewer, &text)));
    Ok(text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn long_texts_are_cut() {
        assert_eq!(cut("  breve ", 10), "breve");
        assert_eq!(cut("abcdef", 3), "abc…");
        let p = prompt("Claude", "domanda", &"x".repeat(MAX_ANSWER + 50));
        assert!(p.contains("Risposta di Claude:"));
        assert!(p.len() < MAX_ANSWER + 1_000);
        assert!(note("Gemini", "Va bene.").starts_with("[Seconda opinione di Gemini"));
    }
}
