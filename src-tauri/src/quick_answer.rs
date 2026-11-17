// Quick answers in the island's search (Edoardo, 17 Nov 2026: «quali vm ha la
// farmacia Falchi?» answered right in the results). The lines are the ones the
// chat's direct answer uses (router::memory_lines: Potion, its threshold, the
// votes); none sure enough, no answer: a wrong one is worse than none. Who
// writes them is the user's choice (Impostazioni → Chat, `quick_answers`):
// the lines as they are (Potion, the default), the model on this PC (only
// when its server is already up), or an engine already configured, never
// Ollama or LM Studio (decided 15 Nov) and never Claude Code (too slow here).
// Whatever writes, a name, number or code that is not in the lines and the
// lines are shown instead (local_model::faithful).

use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::i18n::{t, tf};

/// Engines that may write a quick answer, besides the model on this PC.
pub const ENGINES: &[&str] = &["api", "openrouter", "openai", "gemini"];

/// An engine has this long to write; then the lines as they are.
const ENGINE_TIMEOUT: Duration = Duration::from_secs(12);

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct QuickAnswer {
    /// The answer: written by a model, or the lines themselves.
    pub text: String,
    /// The memory's lines it comes from, as shown.
    pub lines: Vec<String>,
    /// Where each line is from: a page's title, or «nota».
    pub sources: Vec<String>,
    /// Who wrote it: «Potion», or the model's name.
    pub by: String,
}

/// The answer to a question typed in the search, if the memory has one.
pub async fn answer(app: &AppHandle, question: &str) -> Option<QuickAnswer> {
    let question = question.trim();
    let how = app.try_state::<crate::Shared>()?.settings.lock().unwrap().quick_answers.clone();
    if how == "off" || question.chars().count() < 6 || !crate::memory_answer::is_lookup(question) {
        return None;
    }
    let mut lines = crate::router::memory_lines(app, question).await;
    let mut from_pc = None;
    // Nothing sure here: the copy of the other PC's memory (memshare.rs), by its
    // words, read only (on the office PC Falchi is only in the laptop's, 17 Nov 2026).
    if lines.is_empty() {
        if let Some(agent) = crate::memshare::source(app) {
            let dir = crate::memshare::copy_dir(&agent);
            let q = question.to_string();
            lines = tauri::async_runtime::spawn_blocking(move || pick_in_copy(&q, &dir)).await.unwrap_or_default();
            from_pc = Some(agent);
        }
    }
    if lines.is_empty() {
        return None;
    }
    // Plain text in the search: no markdown bold.
    let shown: Vec<String> = lines.iter().map(|l| crate::memory_answer::shown(l).replace("**", "")).collect();
    let sources = lines.iter().map(|l| match &from_pc {
        Some(pc) => format!("{} ({pc})", source_of(l)),
        None => source_of(l),
    }).collect();
    let plain = QuickAnswer { text: shown.join("\n"), lines: shown.clone(), sources, by: "Potion".into() };
    let written = match how.as_str() {
        "local" => crate::local_model::compose(app, question, &lines).await,
        e if ENGINES.contains(&e) => by_engine(app, e, question, &lines).await,
        _ => None,
    };
    crate::log::line(format!("risposta rapida: {} righe, {}", lines.len(), if written.is_some() { "scritta" } else { "le righe" }));
    Some(match written {
        Some((text, by)) => QuickAnswer { text, by, ..plain },
        None => plain,
    })
}

/// The lines of a copy of another PC's memory, as the meaning's corpus
/// (memory_meaning `corpus`): notes, archive, each page's summary and lines.
fn copy_lines(dir: &std::path::Path) -> Vec<String> {
    let read = |f: &str| std::fs::read_to_string(dir.join(f)).unwrap_or_default();
    let mut lines: Vec<String> = crate::memory::notes_of(&read("MEMORIA.md")).into_iter().rev().collect();
    lines.extend(crate::memory::notes_of(&read("archivio.md")).into_iter().rev());
    for p in crate::brain::pages_in(&dir.join("pagine")) {
        if p.summary.trim().chars().count() > 20 {
            lines.push(format!("[[{}]] riassunto: {}", p.title, p.summary.trim()));
        }
        for l in p.body.lines().map(str::trim).filter(|l| l.chars().count() > 20) {
            lines.push(format!("[[{}]] {}", p.title, l.trim_start_matches("- ")));
        }
    }
    lines
}

/// The lines of a copy that answer for sure, by their words (as the chat
/// without a meaning service: memory_answer::pick with no threshold).
fn pick_in_copy(question: &str, dir: &std::path::Path) -> Vec<String> {
    let all: Vec<(f32, String)> = copy_lines(dir).into_iter().map(|l| (0.0, l)).collect();
    crate::memory_answer::pick(question, &all, 0.0)
}

/// The page a line belongs to («[[Farmacia Falchi]] …»), else «nota».
fn source_of(line: &str) -> String {
    line.trim_start_matches("- ")
        .strip_prefix("[[")
        .and_then(|r| r.split_once("]]"))
        .map(|(title, _)| title.trim().to_string())
        .filter(|t| !t.is_empty())
        .unwrap_or_else(|| t("nota").to_string())
}

/// One short answer from an engine the user configured, with the lines only;
/// None (and the lines) when it fails, is slow, says they do not answer, or
/// names what they do not have.
async fn by_engine(app: &AppHandle, engine: &str, question: &str, lines: &[String]) -> Option<(String, String)> {
    let (model, url) = {
        let shared = app.try_state::<crate::Shared>()?;
        let s = shared.settings.lock().unwrap();
        let model = if engine == "api" { s.model.clone() } else { s.engine_models.get(engine).cloned().unwrap_or_default() };
        (model, s.engine_urls.get(engine).cloned())
    };
    if model.trim().is_empty() {
        return None;
    }
    // The lines leave the PC for that engine: never one that looks like a key or a password.
    if lines.iter().any(|l| secret_like(l)) {
        crate::log::line(format!("risposta rapida: righe con chiavi o password, non mandate a {engine}"));
        return None;
    }
    let listed: String = lines.iter().map(|l| format!("- {}\n", crate::memory_answer::shown(l))).collect();
    let query = format!(
        "{}\n\n{}",
        t("Rispondi alla domanda in italiano, in una o due frasi brevi, usando solo le righe date. Copia nomi, numeri, indirizzi IP e codici esattamente come sono scritti. Non aggiungere niente che non sia nelle righe. Se le righe non rispondono alla domanda, scrivi solo: NO"),
        tf("Righe:\n{lines}\nDomanda: {q}", &[("lines", &listed), ("q", &question)])
    );
    let chat = crate::claude::Chat::default();
    let turn = async {
        if engine == "api" {
            crate::claude::send(&chat, &model, query, None).await
        } else {
            crate::openai::send(&chat, engine, &model, url.as_deref(), query, None, &|_| {}).await
        }
    };
    let text = match tokio::time::timeout(ENGINE_TIMEOUT, turn).await {
        Ok(Ok(r)) => r.text,
        Ok(Err(e)) => {
            crate::log::line(format!("risposta rapida: {engine} non ha risposto ({e})"));
            return None;
        }
        Err(_) => {
            crate::log::line(format!("risposta rapida: {engine} troppo lento, restano le righe"));
            return None;
        }
    };
    let text = crate::local_model::without_thinking(&text).trim().trim_matches('"').trim().to_string();
    if text.is_empty() || text.eq_ignore_ascii_case("no") || text.chars().count() > 700 || !crate::local_model::useful(&text, lines) || !crate::local_model::faithful(&text, lines) {
        crate::log::line(format!("risposta rapida: quella di {engine} scartata, restano le righe"));
        return None;
    }
    Some((text, engine_name(engine, &model)))
}

/// A line that names a password, a key or a token: it stays on the PC.
fn secret_like(line: &str) -> bool {
    const WORDS: &[&str] = &["password", "passwd", "pwd", "passphrase", "token", "api key", "apikey", "api_key", "secret", "segreto", "chiave", "credenzial", "pin:", "otp", "id_rsa", ".ssh", "private key"];
    let l = line.to_lowercase();
    WORDS.iter().any(|w| l.contains(w)) || crate::opencode::secret_place(&l)
}

fn engine_name(engine: &str, model: &str) -> String {
    let who = match engine {
        "api" => "Claude",
        "openrouter" => "OpenRouter",
        "openai" => "OpenAI",
        "gemini" => "Gemini",
        other => other,
    };
    if model.is_empty() { who.to_string() } else { format!("{who} · {model}") }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_source_of_a_line() {
        assert_eq!(source_of("[[Farmacia Falchi]] VM: FALCHI-DC, WINFARM"), "Farmacia Falchi");
        assert_eq!(source_of("- [[BEB]] - Backup: QNAP"), "BEB");
        assert_eq!(source_of("- 2026-11-14: FALCHI-DC ha 4 GB RAM"), "nota");
        assert_eq!(source_of("[[]] vuota"), "nota");
    }

    /// On a real copy, read only:
    /// EI_COPY=%APPDATA%\EasyIsland\memoria-condivise\lavoro cargo test quick_answer -- --ignored --nocapture
    #[test]
    #[ignore]
    fn answers_from_a_real_copy() {
        let dir = std::path::PathBuf::from(std::env::var("EI_COPY").unwrap());
        for q in ["quali vm ha la farmacia Falchi?", "che ip ha il pbs di falchi?", "chi è il fornitore della stampante di Rossi?", "come stai?"] {
            let found = pick_in_copy(q, &dir);
            println!("\n«{q}» consultazione={} → {} righe", crate::memory_answer::is_lookup(q), found.len());
            for l in &found {
                println!("  → {} [{}]", crate::memory_answer::shown(l).chars().take(160).collect::<String>(), source_of(l));
            }
        }
    }

    #[test]
    fn lines_with_keys_stay_on_the_pc() {
        assert!(secret_like("[[Falchi]] password admin: xyz"));
        assert!(secret_like("- 2026-11-10: la chiave di WINFARM è in Devolutions"));
        assert!(!secret_like("[[Farmacia Falchi]] VM: FALCHI-DC, WINFARM, POLLER, PBS"));
    }

    #[test]
    fn only_engines_the_user_configures_and_never_the_local_servers() {
        assert!(!ENGINES.contains(&"ollama") && !ENGINES.contains(&"lmstudio") && !ENGINES.contains(&"subscription"));
        assert_eq!(engine_name("openrouter", "x/y"), "OpenRouter · x/y");
    }
}
