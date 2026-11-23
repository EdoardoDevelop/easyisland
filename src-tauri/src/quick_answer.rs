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
    /// The memory's page it comes from, when it is one section of it (a
    /// procedure): the node of the Mappa («p:proxmox», «lavoro|p:proxmox»).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub node: Option<String>,
}

/// The answer to a question typed in the search, if the memory has one.
pub async fn answer(app: &AppHandle, question: &str) -> Option<QuickAnswer> {
    let question = question.trim();
    let how = app.try_state::<crate::Shared>()?.settings.lock().unwrap().quick_answers.clone();
    if how == "off" || question.chars().count() < 6 {
        return None;
    }
    // «come cambiare l'ip del proxmox?»: the section of a page that says how (17 Nov
    // 2026: the procedure was in the memory, the search answered nothing).
    if crate::memory_answer::is_procedure(question) {
        let other = crate::memshare::source(app);
        let q = question.to_string();
        let found = tauri::async_runtime::spawn_blocking(move || {
            let mut pages: Vec<(String, crate::brain::Page, Option<String>)> = crate::brain::pages().into_iter().map(|p| (format!("p:{}", p.slug), p, None)).collect();
            if let Some(pc) = other {
                for p in crate::brain::pages_in(&crate::memshare::copy_dir(&pc).join("pagine")) {
                    pages.push((format!("{pc}|p:{}", p.slug), p, Some(pc.clone())));
                }
            }
            procedure(&q, &pages, potion)
        })
        .await
        .ok()
        .flatten();
        crate::log::line(format!("risposta rapida: procedura {}", if found.is_some() { "trovata" } else { "non trovata" }));
        return found;
    }
    if !crate::memory_answer::is_lookup(question) {
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
    let plain = QuickAnswer { text: shown.join("\n"), lines: shown.clone(), sources, by: "Potion".into(), node: None };
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

/// The most lines of a procedure shown in the search (the page has the rest).
const PROCEDURE_LINES: usize = 14;

/// How close (Potion) a section must be to a how-to question when its words
/// alone do not find it. Measured on the laptop's proxmox.md (17 Nov 2026): the
/// right sections 0.49–0.57, unrelated questions 0.28–0.37; a question in quite
/// other words («rimetto l'indirizzo del server di virtualizzazione») only 0.32–0.35,
/// too close to the unrelated ones to answer it.
const PROCEDURE_MEANING: f32 = 0.5;

/// Potion's vectors for `texts`, when its model is on this PC.
fn potion(texts: &[String]) -> Option<Vec<Vec<f32>>> {
    if !crate::meaning_local::ready() {
        return None;
    }
    crate::meaning_local::embed(texts).ok()
}

/// The section («## …») of a page that answers a how-to question.
/// - By the words: every word that matters in the page's name, the section's
///   title or its text, and at least two of them (or the only one) in the title.
/// - With Potion (`embed`, its model on this PC): among those, the closest in
///   meaning; with none, a section that has at least one of the words (in its
///   title, or half of them anywhere) and is at least `PROCEDURE_MEANING` close.
///
/// None: no answer, as for the lookups (a wrong one is worse).
fn procedure(question: &str, pages: &[(String, crate::brain::Page, Option<String>)], embed: impl Fn(&[String]) -> Option<Vec<Vec<f32>>>) -> Option<QuickAnswer> {
    use crate::brain::fold;
    let words: Vec<String> = crate::memory_answer::search_words(question).iter().map(|w| fold(w)).collect();
    if words.is_empty() {
        return None;
    }
    let has = |hay: &str, w: &String| {
        let hay_words: Vec<&str> = hay.split(|c: char| !c.is_alphanumeric()).filter(|x| !x.is_empty()).collect();
        // A short word whole («ip» not in «tipo»); a long one by its root.
        if w.chars().count() < 6 { hay_words.contains(&w.as_str()) } else { crate::memory_answer::roots(w).iter().any(|r| hay.contains(r.as_str())) }
    };
    let need = words.len().min(2);
    // (score by the words, or None when only Potion may take it; page; section)
    let mut found: Vec<(Option<usize>, usize, String, Vec<String>)> = Vec::new();
    for (i, (_, page, _)) in pages.iter().enumerate() {
        let names = fold(&format!("{} {}", page.title, page.aliases.join(" ")));
        for (title, body) in sections(&page.body) {
            let head = fold(&title);
            let text = fold(&body.join("\n"));
            let in_title = words.iter().filter(|w| has(&head, w)).count();
            let in_names = words.iter().filter(|w| has(&names, w)).count();
            let anywhere = words.iter().filter(|w| has(&head, w) || has(&names, w) || has(&text, w)).count();
            let by_words = anywhere == words.len() && in_title > 0 && in_title + in_names.min(1) >= need;
            if by_words {
                found.push((Some(in_title * 2 + in_names), i, title, body));
            } else if in_title > 0 || anywhere * 2 >= words.len() {
                found.push((None, i, title, body));
            }
        }
    }
    if found.is_empty() {
        return None;
    }
    // Potion: the question and each section (page, title, first lines) side by side.
    let mut texts = vec![question.to_string()];
    texts.extend(found.iter().map(|(_, i, title, body)| format!("{}: {title}. {}", pages[*i].1.title, body.iter().take(3).cloned().collect::<Vec<_>>().join(" "))));
    let close: Option<Vec<f32>> = embed(&texts).and_then(|v| {
        let (q, rest) = v.split_first()?;
        Some(rest.iter().map(|s| if q.is_empty() || s.is_empty() { 0.0 } else { q.iter().zip(s).map(|(a, b)| a * b).sum() }).collect())
    });
    let pick = match &close {
        // The words found some: the best by the words, the closest among equals.
        // None: the closest that is close enough.
        Some(c) => {
            let top = found.iter().filter_map(|f| f.0).max();
            let best = |keep: &dyn Fn(Option<usize>) -> bool| found.iter().enumerate().filter(|(_, f)| keep(f.0)).max_by(|a, b| c[a.0].total_cmp(&c[b.0])).map(|(k, _)| k);
            match top {
                Some(t) => best(&|s| s == Some(t)),
                None => best(&|s| s.is_none()).filter(|&k| c[k] >= PROCEDURE_MEANING),
            }
        }
        None => found.iter().enumerate().filter_map(|(k, f)| f.0.map(|s| (k, s))).max_by_key(|&(k, s)| (s, std::cmp::Reverse(k))).map(|(k, _)| k),
    }?;
    if let Some(c) = &close {
        crate::log::line(format!("risposta rapida: sezione vicina {:.2} (Potion)", c[pick]));
    }
    let (_, i, title, body) = &found[pick];
    let (node, page, pc) = &pages[*i];
    let lines: Vec<String> = body.iter().take(PROCEDURE_LINES).cloned().collect();
    let mut text = format!("{title}\n{}", lines.join("\n"));
    if body.len() > PROCEDURE_LINES {
        text.push_str(&format!("\n{}", t("… il resto nella pagina.")));
    }
    let source = match pc {
        Some(pc) => format!("{} ({pc})", page.title),
        None => page.title.clone(),
    };
    Some(QuickAnswer { text, lines, sources: vec![source], by: "Potion".into(), node: Some(node.clone()) })
}

/// The «## » sections of a page's text: (title, its lines without the empty ones).
fn sections(body: &str) -> Vec<(String, Vec<String>)> {
    let mut out: Vec<(String, Vec<String>)> = Vec::new();
    for line in body.lines() {
        if let Some(title) = line.trim().strip_prefix("## ") {
            out.push((title.trim().to_string(), Vec::new()));
        } else if let Some((_, lines)) = out.last_mut() {
            let l = line.trim();
            if !l.is_empty() {
                lines.push(l.to_string());
            }
        }
    }
    out
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
pub(crate) fn secret_like(line: &str) -> bool {
    const WORDS: &[&str] = &["password", "passwd", "pwd", "passphrase", "token", "api key", "apikey", "api_key", "secret", "segreto", "chiave", "credenzial", "pin:", "otp", "id_rsa", ".ssh", "private key"];
    let l = line.to_lowercase();
    WORDS.iter().any(|w| l.contains(w)) || crate::opencode::secret_place(&l)
}

pub(crate) fn engine_name(engine: &str, model: &str) -> String {
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

    fn page(title: &str, aliases: &[&str], body: &str) -> crate::brain::Page {
        crate::brain::Page { slug: crate::brain::fold(title), title: title.into(), source: String::new(), updated: String::new(), summary: String::new(), aliases: aliases.iter().map(|a| a.to_string()).collect(), kind: String::new(), body: body.into(), links: Vec::new() }
    }

    #[test]
    fn a_procedure_is_the_section_whose_title_has_the_words() {
        let body = "Hypervisor delle farmacie.\n\n## Cambiare l'IP del Proxmox (host fisico, nodo singolo)\nFarlo dalla console locale: si chiude anche la Shell web.\n1. Backup: cp /etc/network/interfaces …\n2. vmbr0: address NUOVOIP/24\n\n## Cambiare l'IP del PBS (VM, oggi in DHCP)\n1. Backup\n2. inet static\n\n## Attenzione\n- fingerprint";
        let pages = vec![("p:proxmox".to_string(), page("Proxmox", &["PVE", "PBS"], body), None)];
        let a = procedure("come cambiare ip di proxmox da shell?", &pages, |_| None).unwrap();
        assert!(a.text.starts_with("Cambiare l'IP del Proxmox") && a.text.contains("vmbr0") && !a.text.contains("inet static"));
        assert_eq!((a.node.as_deref(), a.sources[0].as_str()), (Some("p:proxmox"), "Proxmox"));
        let pbs = procedure("come si cambia l'ip del pbs?", &pages, |_| None).unwrap();
        assert!(pbs.text.starts_with("Cambiare l'IP del PBS"));
        // Another verb of changing: the same section.
        assert!(procedure("come modificare ip proxmox", &pages, |_| None).unwrap().text.starts_with("Cambiare l'IP del Proxmox"));
        // Nothing in the titles, or a word nowhere: no answer.
        assert!(procedure("come si installa una stampante?", &pages, |_| None).is_none());
        assert!(procedure("come cambiare ip del firewall?", &pages, |_| None).is_none());
        // With Potion: a section the words alone miss, if close enough; never one far off.
        let near = |close: f32| move |t: &[String]| Some(t.iter().enumerate().map(|(i, x)| if i == 0 { vec![1.0, 0.0] } else if x.contains("PBS") { vec![close, (1.0 - close * close).sqrt()] } else { vec![0.1, 0.99] }).collect());
        assert!(procedure("come rimetto l'indirizzo del pbs?", &pages, near(0.8)).unwrap().text.starts_with("Cambiare l'IP del PBS"));
        assert!(procedure("come rimetto l'indirizzo del pbs?", &pages, near(0.3)).is_none());
        // The words found one: Potion picks among those, never a far one instead.
        assert!(procedure("come cambiare ip di proxmox?", &pages, near(0.9)).unwrap().text.starts_with("Cambiare l'IP del Proxmox"));
    }

    /// On the real page, read only:
    /// EI_PAGE=…\proxmox.md cargo test quick_answer -- --ignored --nocapture
    #[test]
    #[ignore]
    fn procedures_on_a_real_page() {
        let path = std::path::PathBuf::from(std::env::var("EI_PAGE").unwrap());
        let dir = path.parent().unwrap();
        let pages: Vec<_> = crate::brain::pages_in(dir).into_iter().map(|p| (format!("p:{}", p.slug), p, None)).collect();
        // EI_MEANING_DIR=%LOCALAPPDATA%\EasyIsland\significato-locale: Potion as in the app.
        for q in ["come cambiare ip di proxmox da shell?", "come si cambia l'ip del proxmox?", "come cambio l'ip del pbs", "come modificare ip proxmox", "come rimetto l'indirizzo del server di virtualizzazione?", "come cambio l'indirizzo dell'hypervisor?", "come configuro la rete del pve?", "come installo una stampante?", "come faccio il backup delle vm?", "come cambio la password di windows?"] {
            match procedure(q, &pages, potion) {
                Some(a) => println!("\n«{q}» → {} ({} righe)\n  {}", a.sources[0], a.lines.len(), a.text.lines().take(3).collect::<Vec<_>>().join("\n  ")),
                None => println!("\n«{q}» → niente"),
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
