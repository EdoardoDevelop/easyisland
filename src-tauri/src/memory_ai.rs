// «Motore per la memoria» (asked by Edoardo on 25 Oct 2026): an AI engine of
// the user's choice — a free or local one too — ties the memory together. The
// map's own links guess from words every time it opens; this writes them into
// the files, where the chat finds them as well: topic pages that gather the
// notes about one subject (a customer, a project), and named relations between
// pages ("- cliente di: [[Easytech]]").
//
// Any engine works, tools or not: EasyIsland sends the notes and pages and asks
// for a JSON answer, then writes it itself. Only additions, written without
// asking (the user's choice): new pages, lines appended to existing ones. It
// never deletes or rewrites what is there, and never touches MEMORIA.md. The
// one exception is the header's "riassunto:" line, which it keeps up to date
// (it sums up the page, so the chat reads it for a linked page), and "alias:",
// to which it only adds names.
// Runs from «Collega con l'IA» in the memory window and after the evening
// digest, when the memory changed since the last time.

use crate::brain::{self, Page};
use crate::claude::Chat;
use crate::i18n::{t, tf};
use serde::Deserialize;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager};

static RUNNING: AtomicBool = AtomicBool::new(false);

/// What the engine answers.
#[derive(Deserialize, Default)]
struct Answer {
    #[serde(default)]
    pages: Vec<TopicPage>,
    #[serde(default)]
    links: Vec<Relation>,
    #[serde(default)]
    summaries: Vec<Summary>,
}

/// One sentence and the other names of an existing page.
#[derive(Deserialize)]
struct Summary {
    title: String,
    #[serde(default)]
    summary: String,
    #[serde(default)]
    aliases: Vec<String>,
}

#[derive(Deserialize)]
struct TopicPage {
    title: String,
    #[serde(default)]
    text: String,
    /// Numbers of the notes it gathers.
    #[serde(default)]
    notes: Vec<usize>,
}

#[derive(Deserialize)]
struct Relation {
    from: String,
    to: String,
    #[serde(default)]
    relation: String,
}

/// The engine chosen in Impostazioni, "" for none.
pub fn engine(app: &AppHandle) -> String {
    app.try_state::<crate::Shared>().map(|s| s.settings.lock().unwrap().memory_engine.clone()).unwrap_or_default()
}

fn stamp_file() -> std::path::PathBuf {
    crate::settings::local_dir().join("memoria-collegata.txt")
}

/// The newest change in the memory folder, seconds.
fn memory_changed_at() -> u64 {
    fn newest(dir: &std::path::Path) -> u64 {
        let Ok(rd) = std::fs::read_dir(dir) else { return 0 };
        rd.flatten()
            .map(|e| {
                let p = e.path();
                if p.is_dir() {
                    newest(&p)
                } else {
                    e.metadata().ok().and_then(|m| m.modified().ok()).and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0)
                }
            })
            .max()
            .unwrap_or(0)
    }
    newest(&crate::memory::dir())
}

/// After the evening digest: only when an engine is chosen and the memory changed since the last run.
pub fn after_digest(app: &AppHandle) {
    if engine(app).is_empty() {
        return;
    }
    let last: u64 = std::fs::read_to_string(stamp_file()).ok().and_then(|s| s.trim().parse().ok()).unwrap_or(0);
    if memory_changed_at() <= last {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let r = run(&app).await;
        crate::log::line(format!("memoria collegata: {}", r.unwrap_or_else(|e| e)));
    });
}

/// One pass: ask, then write. Returns what was done, for the user.
pub async fn run(app: &AppHandle) -> Result<String, String> {
    let engine = engine(app);
    if engine.is_empty() {
        return Err(t("Scegli il motore per la memoria in Impostazioni → Chat → Memoria.").into());
    }
    if RUNNING.swap(true, Ordering::SeqCst) {
        return Err(t("Sto già collegando la memoria: un attimo.").into());
    }
    let out = pass(app, &engine).await;
    RUNNING.store(false, Ordering::SeqCst);
    if out.is_ok() {
        let _ = std::fs::write(stamp_file(), memory_changed_at().to_string());
        use tauri::Emitter;
        let _ = app.emit_to(crate::MEMORY_LABEL, "memory-refresh", ());
    }
    out
}

async fn pass(app: &AppHandle, engine: &str) -> Result<String, String> {
    let notes = crate::memory::notes();
    let pages = brain::pages();
    if notes.is_empty() && pages.is_empty() {
        return Err(t("La memoria è ancora vuota: non c'è niente da collegare.").into());
    }
    let chat = Chat::default();
    let reply = crate::chat_turn(app, &chat, prompt(&notes, &pages), None, Some(engine.to_string()), None, false, crate::Channel::Helper, &|_| {}).await;
    if engine == "opencode" {
        crate::opencode::forget(chat.cli_session());
    }
    let text = reply?.text;
    let answer = parse(&text).ok_or_else(|| t("Il motore non ha risposto nel formato chiesto: riprova, o scegli un altro motore.").to_string())?;
    Ok(apply(&answer, &notes))
}

fn prompt(notes: &[String], pages: &[Page]) -> String {
    let mut list = String::new();
    for (i, n) in notes.iter().enumerate() {
        list.push_str(&format!("N{} {}\n", i + 1, n.trim().trim_start_matches("- ")));
    }
    let mut ps = String::new();
    for p in pages {
        let body: String = p.body.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(500).collect();
        let summary = if p.summary.is_empty() { String::new() } else { format!(" [riassunto: {}]", p.summary) };
        let aliases = if p.aliases.is_empty() { String::new() } else { format!(" [alias: {}]", p.aliases.join(", ")) };
        ps.push_str(&format!("- «{}»{summary}{aliases}: {}\n", p.title, body));
    }
    tf(
        "Sei l'archivista della memoria di EasyIsland. Collega le informazioni, non inventarne.

NOTE (numerate):
{notes}
PAGINE ESISTENTI:
{pages}
Rispondi SOLO con un oggetto JSON, senza altro testo, così:
{\"pages\":[{\"title\":\"Nome dell'argomento\",\"text\":\"due o tre righe su cosa sappiamo, prese dalle note\",\"notes\":[1,3]}],\"links\":[{\"from\":\"Pagina A\",\"to\":\"Pagina B\",\"relation\":\"cliente di\"}],\"summaries\":[{\"title\":\"Pagina A\",\"summary\":\"Una frase su chi o cosa è.\",\"aliases\":[\"altro nome\",\"sigla\"]}]}

Regole:
- \"pages\": un argomento che compare in almeno due note o in una nota e una pagina (un cliente, una persona, un progetto, un prodotto, un luogo) e che non ha ancora una pagina. Titolo breve, come lo si chiama (es. il nome del cliente). Se la pagina esiste già usa lo stesso titolo: aggiungerò solo i rimandi alle note.
- \"links\": relazioni vere tra pagine, esistenti o nuove, con una parola o due (cliente di, lavora con, parte di, usa, sede di).
- \"summaries\": per le pagine, esistenti o nuove, senza riassunto o con un riassunto superato dal testo: una frase sola su chi o cosa è (es. «Cliente di Torino, studio di commercialisti, referente Anna»); \"aliases\": gli altri nomi con cui l'utente potrebbe chiamarlo (sigle, nomi di prodotto, soprannomi, nomi in inglese), solo se servono. Le pagine con un riassunto ancora giusto lasciale fuori.
- Niente password, codici o dati sensibili. Se non c'è niente da collegare rispondi {\"pages\":[],\"links\":[],\"summaries\":[]}.",
        &[("notes", &list), ("pages", &if ps.is_empty() { t("(nessuna)").to_string() } else { ps })],
    )
}

/// The JSON object in the reply (models like to wrap it in ``` or prose).
fn parse(text: &str) -> Option<Answer> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    serde_json::from_str(text.get(start..=end)?).ok()
}

/// Writes the answer, only adding. Returns a short summary.
fn apply(a: &Answer, notes: &[String]) -> String {
    let mut created = Vec::new();
    let mut grown = Vec::new();
    let mut relations = 0;
    for p in a.pages.iter().take(12) {
        let title = clean_title(&p.title);
        if title.is_empty() {
            continue;
        }
        let quoted: Vec<String> = p.notes.iter().filter_map(|n| notes.get(n.wrapping_sub(1))).map(|n| format!("- nota: {}", one_line(n, 160))).collect();
        match current(&title) {
            None => {
                let mut body = one_line(&p.text, 600);
                if body.is_empty() {
                    body = tf("Argomento che ricorre nelle note su {t}.", &[("t", &title)]);
                }
                if !quoted.is_empty() {
                    body.push_str(&format!("\n\n{}", quoted.join("\n")));
                }
                if brain::tool_write(&title, &body, "", "").is_ok() {
                    created.push(title);
                }
            }
            Some((text, version)) => {
                let new: Vec<&String> = quoted.iter().filter(|q| !text.contains(q.as_str())).collect();
                if new.is_empty() {
                    continue;
                }
                let body = format!("{}\n{}", body_of(&text), new.iter().map(|s| s.as_str()).collect::<Vec<_>>().join("\n"));
                if brain::tool_write(&title, &body, &version, "").is_ok() {
                    grown.push(title);
                }
            }
        }
    }
    for l in a.links.iter().take(40) {
        let (from, to) = (clean_title(&l.from), clean_title(&l.to));
        if from.is_empty() || to.is_empty() || brain::slug(&from) == brain::slug(&to) {
            continue;
        }
        let Some((text, version)) = current(&from) else { continue };
        if current(&to).is_none() {
            continue;
        }
        let rel = one_line(&l.relation, 40);
        let line = if rel.is_empty() { format!("- [[{to}]]") } else { format!("- {rel}: [[{to}]]") };
        if text.to_lowercase().contains(&format!("[[{}]]", to.to_lowercase())) {
            continue;
        }
        let body = format!("{}\n{line}", body_of(&text));
        if brain::tool_write(&from, &body, &version, "").is_ok() {
            relations += 1;
        }
    }
    let mut summed = 0;
    for s in a.summaries.iter().take(40) {
        let title = clean_title(&s.title);
        let summary = one_line(&s.summary, 300);
        let Some((text, version)) = current(&title) else { continue };
        let page = brain::parse(&brain::slug(&title), &text);
        // Only adds names: the ones the user wrote stay.
        let mut aliases = page.aliases.clone();
        for a in &s.aliases {
            let a = clean_title(a);
            if !a.is_empty() && a.to_lowercase() != page.title.to_lowercase() && !aliases.iter().any(|o| o.to_lowercase() == a.to_lowercase()) {
                aliases.push(a);
            }
        }
        let summary = if summary.is_empty() { page.summary.clone() } else { summary };
        if summary == page.summary && aliases == page.aliases {
            continue;
        }
        let mut body = String::new();
        if !summary.is_empty() {
            body.push_str(&format!("riassunto: {summary}\n"));
        }
        if !aliases.is_empty() {
            body.push_str(&format!("alias: {}\n", aliases.join(", ")));
        }
        body.push_str(&body_of(&text));
        if brain::tool_write(&title, &body, &version, "").is_ok() {
            summed += 1;
        }
    }
    if created.is_empty() && grown.is_empty() && relations == 0 && summed == 0 {
        return t("Niente di nuovo da collegare: la memoria è già in ordine.").into();
    }
    let mut parts = Vec::new();
    if !created.is_empty() {
        parts.push(tf("pagine nuove: {list}", &[("list", &created.join(", "))]));
    }
    if !grown.is_empty() {
        parts.push(tf("rimandi alle note in: {list}", &[("list", &grown.join(", "))]));
    }
    if relations > 0 {
        parts.push(tf("{n} relazioni tra pagine", &[("n", &relations.to_string())]));
    }
    if summed > 0 {
        parts.push(tf("{n} riassunti", &[("n", &summed.to_string())]));
    }
    tf("Memoria collegata — {what}.", &[("what", &parts.join("; "))])
}

/// The page's whole file and version, if it exists.
fn current(title: &str) -> Option<(String, String)> {
    let path = brain::pages_dir().join(format!("{}.md", brain::slug(title)));
    let text = std::fs::read_to_string(path).ok()?;
    let v = brain::version(&text);
    Some((text, v))
}

/// The text under a page's header (title, fonte, aggiornata).
fn body_of(file: &str) -> String {
    let mut lines = file.lines().peekable();
    let mut out = Vec::new();
    let mut in_head = true;
    while let Some(l) = lines.next() {
        if in_head && (l.starts_with("# ") || l.starts_with("fonte:") || l.starts_with("aggiornata:") || l.starts_with("riassunto:") || l.starts_with("alias:") || l.trim().is_empty()) {
            continue;
        }
        in_head = false;
        out.push(l);
    }
    out.join("\n").trim_end().to_string()
}

fn clean_title(s: &str) -> String {
    s.chars().filter(|c| !matches!(c, '[' | ']' | '#' | '\n' | '\r')).collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ").chars().take(80).collect()
}

fn one_line(s: &str, max: usize) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(max).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_json_even_wrapped() {
        let a = parse("Ecco:\n```json\n{\"pages\":[{\"title\":\"Rossi\",\"text\":\"Cliente.\",\"notes\":[1,2]}],\"links\":[]}\n```").unwrap();
        assert_eq!(a.pages.len(), 1);
        assert_eq!(a.pages[0].notes, vec![1, 2]);
        assert!(parse("niente").is_none());
        assert_eq!(clean_title(" [[Rossi]]\n"), "Rossi");
    }

    #[test]
    fn the_header_is_not_part_of_the_body() {
        assert_eq!(body_of("# Rossi\nfonte: a.eml\naggiornata: 2026-10-25\nriassunto: Cliente.\nalias: R\n\nPaga a 60 giorni.\n- nota: x"), "Paga a 60 giorni.\n- nota: x");
        let a = parse("{\"summaries\":[{\"title\":\"Rossi\",\"summary\":\"Cliente di Torino.\",\"aliases\":[\"Studio Rossi\"]}]}").unwrap();
        assert_eq!(a.summaries[0].aliases, vec!["Studio Rossi"]);
    }
}
