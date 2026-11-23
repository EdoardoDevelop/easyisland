// «Chiedi alla memoria» in the Panoramica of the memory window (Edoardo,
// 21 Nov 2026: «devo avere la possibilità di interagire con l'IA ma solo
// riguardo la memoria»). A small conversation beside the log: the engine gets
// the memory's lines and pages closest to the question (never one that looks
// like a key or a password) and answers only from them; anything else it
// declines. No tools: it reads, it never writes nor acts. The nodes it found
// light up in the nucleus and open on a click.
//
// Engine: the one of the quick answers (Impostazioni → Chat) when it is an
// engine, else the chat's, else the first configured among quick_answer::ENGINES.
// None: the lines as they are (Potion).

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::i18n::{t, tf};

/// The engine has this long; then the lines as they are.
const TIMEOUT: Duration = Duration::from_secs(45);
/// Lines and pages given to the engine.
const MAX_LINES: usize = 40;
const MAX_NODES: usize = 12;
/// Earlier turns kept (question and answer).
const MAX_TURNS: usize = 4;

#[derive(Deserialize, Clone, Debug)]
pub struct Turn {
    pub q: String,
    pub a: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct NodeRef {
    pub id: String,
    pub title: String,
}

#[derive(Serialize, Clone, Debug)]
pub struct Reply {
    pub text: String,
    /// Who wrote it: the engine and model, or «Potion».
    pub by: String,
    /// The memory's nodes the answer comes from, to light and open.
    pub nodes: Vec<NodeRef>,
}

/// `facts`: what the map shows and the lines do not (the week's news, lone
/// notes, files to read, the page being looked at), from the Panoramica.
pub async fn ask(app: &AppHandle, question: &str, history: &[Turn], facts: &str) -> Reply {
    let question = question.trim();
    let other = crate::memshare::source(app);
    let q = question.to_string();
    let hits = tauri::async_runtime::spawn_blocking(move || crate::brain::find_nodes(&q, MAX_NODES, other)).await.unwrap_or_default();
    let lines = lines_for(app, question).await;
    let mut nodes: Vec<NodeRef> = hits.iter().map(|h| NodeRef { id: h.id.clone(), title: h.title.clone() }).collect();
    // The pages the lines come from («[[Titolo]] …»).
    let pages = tauri::async_runtime::spawn_blocking(crate::brain::pages).await.unwrap_or_default();
    for l in &lines {
        if let Some(title) = page_of(l) {
            if let Some(p) = pages.iter().find(|p| p.title.eq_ignore_ascii_case(&title)) {
                let id = format!("p:{}", p.slug);
                if !nodes.iter().any(|n| n.id == id) {
                    nodes.push(NodeRef { id, title: p.title.clone() });
                }
            }
        }
    }
    nodes.truncate(MAX_NODES * 2);
    let plain = |lines: &[String]| -> String {
        if lines.is_empty() {
            t("Nella memoria non trovo niente su questo.").to_string()
        } else {
            lines.iter().take(8).map(|l| crate::memory_answer::shown(l).replace("**", "")).collect::<Vec<_>>().join("\n")
        }
    };
    let Some((engine, model, url)) = engine(app) else {
        crate::log::line("chiedi alla memoria: nessun motore configurato, le righe");
        return Reply { text: plain(&lines), by: "Potion".into(), nodes };
    };
    let listed: String = lines.iter().map(|l| format!("- {}\n", crate::memory_answer::shown(l))).collect();
    let found: String = hits.iter().map(|h| format!("- {} ({}): {}\n", h.title, h.kind, h.gist)).collect();
    let titles: String = pages.iter().take(300).map(|p| p.title.as_str()).collect::<Vec<_>>().join(", ");
    // The map's facts leave the PC too: never a line that looks like a secret.
    let facts: String = facts.lines().filter(|l| !crate::quick_answer::secret_like(l)).take(40).map(|l| format!("{}\n", l.chars().take(1500).collect::<String>())).collect();
    let before: String = history.iter().rev().take(MAX_TURNS).rev().map(|h| tf("Utente: {q}\nTu: {a}\n", &[("q", &h.q), ("a", &h.a)])).collect();
    let query = format!(
        "{}\n\n{}",
        t("Sei l'assistente della memoria di EasyIsland: pagine, note e fonti che l'utente ha salvato. Rispondi in italiano, breve e chiaro, usando solo quello che trovi qui sotto. Copia nomi, numeri, indirizzi IP e codici esattamente come sono scritti. Puoi riassumere, confrontare, contare e dire dove sta una cosa (il titolo della pagina). Se qui sotto non c'è, dillo. Se la domanda non riguarda la memoria, rispondi solo: «Qui rispondo solo sulla memoria: per il resto usa la chat.» Non inventare niente e non proporre di fare azioni."),
        tf(
            "Pagine della memoria: {titles}\n\nDalla mappa:\n{facts}\nPagine e note trovate:\n{found}\nRighe della memoria:\n{lines}\n{before}Domanda: {q}",
            &[("titles", &titles), ("facts", &facts), ("found", &found), ("lines", &listed), ("before", &before), ("q", &question)],
        )
    );
    let chat = crate::claude::Chat::default();
    let turn = async {
        if engine == "api" {
            crate::claude::send(&chat, &model, query, None).await
        } else {
            crate::openai::send(&chat, &engine, &model, url.as_deref(), query, None, &|_| {}).await
        }
    };
    let text = match tokio::time::timeout(TIMEOUT, turn).await {
        Ok(Ok(r)) => crate::local_model::without_thinking(&r.text).trim().to_string(),
        Ok(Err(e)) => {
            crate::log::line(format!("chiedi alla memoria: {engine} non ha risposto ({e})"));
            String::new()
        }
        Err(_) => {
            crate::log::line(format!("chiedi alla memoria: {engine} troppo lento"));
            String::new()
        }
    };
    if text.is_empty() {
        return Reply { text: plain(&lines), by: "Potion".into(), nodes };
    }
    crate::log::line(format!("chiedi alla memoria: {} righe, risposta di {engine}", lines.len()));
    Reply { text, by: crate::quick_answer::engine_name(&engine, &model), nodes }
}

/// «Apri in chat»: the island's chat with the question and the memory's answer.
pub fn open_in_chat(app: &AppHandle, question: &str, answer: &str) {
    use tauri::Emitter;
    let _ = app.emit_to("island", "memory-chat-open", serde_json::json!({ "question": question, "answer": answer }));
}

/// The lines closest to the question, never one that looks like a secret.
async fn lines_for(app: &AppHandle, question: &str) -> Vec<String> {
    let (mut found, _) = crate::memory_meaning::deep_scored(app, question).await;
    if found.is_empty() {
        // No meaning model: the lines with the question's words.
        let words: Vec<String> = crate::memory_answer::search_words(question).iter().map(|w| crate::brain::fold(w)).filter(|w| !w.is_empty()).collect();
        found = crate::memory_meaning::all_lines()
            .await
            .into_iter()
            .filter_map(|l| {
                let low = crate::brain::fold(&l);
                let n = words.iter().filter(|w| low.contains(w.as_str())).count();
                (n > 0).then_some((n as f32, l))
            })
            .collect();
    }
    found.sort_by(|a, b| b.0.total_cmp(&a.0));
    found.into_iter().map(|(_, l)| l).filter(|l| !crate::quick_answer::secret_like(l)).take(MAX_LINES).collect()
}

/// The engine, its model and address.
fn engine(app: &AppHandle) -> Option<(String, String, Option<String>)> {
    let shared = app.try_state::<crate::Shared>()?;
    let s = shared.settings.lock().unwrap();
    let model_of = |e: &str| if e == "api" { s.model.clone() } else { s.engine_models.get(e).cloned().unwrap_or_default() };
    let candidates = [s.quick_answers.as_str(), s.chat_engine.as_str()];
    let pick = candidates
        .into_iter()
        .chain(crate::quick_answer::ENGINES.iter().copied())
        .find(|e| crate::quick_answer::ENGINES.contains(e) && !model_of(e).trim().is_empty())?;
    Some((pick.to_string(), model_of(pick), s.engine_urls.get(pick).cloned()))
}

/// «[[Titolo]] …» → «Titolo».
fn page_of(line: &str) -> Option<String> {
    let (title, _) = line.trim_start_matches("- ").strip_prefix("[[")?.split_once("]]")?;
    let title = title.trim();
    (!title.is_empty()).then(|| title.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_page_of_a_line() {
        assert_eq!(page_of("[[Farmacia Falchi]] VM: FALCHI-DC").as_deref(), Some("Farmacia Falchi"));
        assert_eq!(page_of("- [[BEB]] - Backup"), Some("BEB".into()));
        assert_eq!(page_of("- 2026-11-14: nota"), None);
        assert_eq!(page_of("[[]] vuota"), None);
    }
}
