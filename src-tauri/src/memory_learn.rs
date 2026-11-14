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
//
// What it answers (14 Nov 2026, from the laptop's memory: 60 notes, most of
// them site details, ids and EasyIsland's own development):
//   - «REGOLA: …»: a rule or preference that holds for every question → MEMORIA.md;
//   - «[[Pagina]] …»: a fact about one customer, site, project → that page
//     (brain::add_line), found when a question is about it;
//   - «SUPERATA n»: note n (as numbered in the prompt) is corrected or
//     repeated by this exchange → archivio.md.

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
    let titles: Vec<String> = crate::brain::pages().into_iter().map(|p| p.title).collect();
    let prompt = prompt(&cut(question, MAX_QUESTION), &cut(&answer, MAX_ANSWER), &crate::memory::notes(), &titles);
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
        let known = crate::memory::notes();
        let mut kept = 0;
        let mut gone = Vec::new();
        for item in items_of(&text) {
            match item {
                Item::Rule(r) => {
                    if crate::memory::note(&format!("regola: {r}")).is_ok_and(|m| m == crate::i18n::t("Salvato in memoria.")) {
                        kept += 1;
                    }
                }
                Item::Fact(page, fact) => {
                    let day: String = crate::memory::stamp().chars().take(10).collect();
                    if crate::brain::add_line(&page, &format!("- {day}: {fact}")).unwrap_or(false) {
                        kept += 1;
                    }
                }
                Item::Gone(n) => {
                    if let Some(old) = numbered(&known).get(n.wrapping_sub(1)) {
                        gone.push(old.clone());
                    }
                }
            }
        }
        let archived = crate::memory::archive(&gone).unwrap_or(0);
        crate::log::line(format!("memoria dopo la risposta: {kept} aggiunte, {archived} superate"));
        if kept + archived > 0 {
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

/// The notes the prompt shows, numbered from 1 (the newest 40).
fn numbered(notes: &[String]) -> Vec<String> {
    notes.iter().skip(notes.len().saturating_sub(40)).cloned().collect()
}

fn prompt(question: &str, answer: &str, notes: &[String], pages: &[String]) -> String {
    let known: String = numbered(notes).iter().enumerate().map(|(i, n)| format!("{}. {}\n", i + 1, n.trim().trim_start_matches("- "))).collect();
    let titles = pages.iter().take(80).cloned().collect::<Vec<_>>().join(", ");
    tf(
        "Sei la memoria di EasyIsland. Da questo scambio tra l'utente e il suo assistente tieni solo ciò che servirà le prossime volte: preferenze e regole dell'utente, fatti che restano veri su clienti, persone, PC, reti, indirizzi e percorsi, come si fa una cosa che ha funzionato, decisioni prese.
Non tenere: cose del momento o di oggi, stati temporanei («in attesa», «da confermare»), numeri di versione, identificativi interni (id di automazioni, hash, numeri di messaggio), il lavoro su EasyIsland stesso (sue funzioni, rami, installer, richieste di migliorie), risposte generiche, ciò che sa chiunque, password, codici o chiavi.

NOTE GIÀ IN MEMORIA (numerate):
{known}
PAGINE ESISTENTI: {titles}

DOMANDA DELL'UTENTE:
{question}

RISPOSTA DELL'ASSISTENTE:
{answer}

Rispondi con al massimo {max} righe, ognuna di uno di questi tipi:
- REGOLA: una regola o preferenza che vale per qualsiasi domanda (come lavora l'utente, cosa vuole sempre o mai)
- [[Titolo]] un fatto su un cliente, una persona, un sito, un progetto: il titolo è quello di una pagina esistente se c'è, altrimenti il nome giusto
- SUPERATA n: la nota n è corretta o ripetuta da questo scambio (si archivia)
Ogni riga completa da sola, in italiano, al massimo 200 caratteri; non ripetere le note già in memoria. Se non c'è niente, rispondi solo NIENTE. Nient'altro.",
        &[
            ("known", &if known.is_empty() { "(nessuna)\n".to_string() } else { known }),
            ("titles", &if titles.is_empty() { "(nessuna)".to_string() } else { titles }),
            ("question", &question),
            ("answer", &answer),
            ("max", &MAX_NOTES.to_string()),
        ],
    )
}

#[derive(Debug, PartialEq)]
enum Item {
    Rule(String),
    Fact(String, String),
    Gone(usize),
}

/// The lines of the answer, at most MAX_NOTES additions; none for NIENTE.
/// A line without a type is a rule only if it reads as one, else it is dropped.
fn items_of(text: &str) -> Vec<Item> {
    let mut out = Vec::new();
    let mut added = 0;
    for l in text.lines().map(str::trim) {
        let l = l.strip_prefix("- ").or_else(|| l.strip_prefix("• ")).unwrap_or(l).trim().trim_matches('"').trim();
        if l.is_empty() || l.eq_ignore_ascii_case("niente") {
            continue;
        }
        let upper = l.to_uppercase();
        if let Some(rest) = upper.strip_prefix("SUPERATA") {
            if let Ok(n) = rest.trim_start_matches([' ', ':']).split(|c: char| !c.is_ascii_digit()).next().unwrap_or("").parse() {
                out.push(Item::Gone(n));
            }
            continue;
        }
        if added >= MAX_NOTES {
            continue;
        }
        if let Some(rest) = l.strip_prefix("[[") {
            if let Some((title, fact)) = rest.split_once("]]") {
                let fact = fact.trim().trim_start_matches([':', '-', '–']).trim();
                if !title.trim().is_empty() && fact.chars().count() >= 10 {
                    out.push(Item::Fact(title.trim().to_string(), fact.to_string()));
                    added += 1;
                }
            }
            continue;
        }
        let rule = l.get(..7).filter(|p| p.eq_ignore_ascii_case("regola:")).map(|_| l.get(7..).unwrap_or("").trim());
        let rule = rule.or_else(|| crate::memory::general(l).then_some(l));
        if let Some(r) = rule.filter(|r| r.chars().count() >= 10) {
            out.push(Item::Rule(r.to_string()));
            added += 1;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn items_from_the_answer() {
        assert!(items_of("NIENTE").is_empty());
        assert_eq!(items_of("- REGOLA: preventivi sempre in PDF con la grafica standard\n- [[Talenti]] dominio talenti.locale sui PC\n- SUPERATA 3\n- testo libero senza tipo\n- [[Rossi]]: corto"), vec![
            Item::Rule("preventivi sempre in PDF con la grafica standard".into()),
            Item::Fact("Talenti".into(), "dominio talenti.locale sui PC".into()),
            Item::Gone(3),
        ]);
        let many = "- REGOLA: prima regola lunga abbastanza\n- REGOLA: seconda regola lunga abbastanza\n- REGOLA: terza regola lunga abbastanza\n- REGOLA: quarta regola lunga abbastanza\n- SUPERATA: 7";
        let got = items_of(many);
        assert_eq!(got.len(), 4);
        assert_eq!(got.last(), Some(&Item::Gone(7)));
    }

    #[test]
    fn the_prompt_has_the_exchange_and_the_notes() {
        let p = prompt("Qual è il dominio di Talenti?", "talenti.local", &["- 2026-11-01: nota vecchia".to_string()], &["Talenti".to_string()]);
        assert!(p.contains("Qual è il dominio di Talenti?"));
        assert!(p.contains("1. 2026-11-01: nota vecchia"));
        assert!(p.contains("PAGINE ESISTENTI: Talenti"));
        assert!(p.contains("al massimo 3 righe"));
    }
}
