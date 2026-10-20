// Recipes: how the chat answered a kind of question, learnt by use (asked by
// Edoardo on 20 October 2026: "qualcosa che si mantenga in memoria con
// l'utilizzo", faster and with fewer tokens). After a turn that went well,
// the easyisland tools it called (agent.rs) are kept with the question's
// words; when a similar question comes, those steps go in front of it in a
// few lines, so the engine goes straight to them instead of exploring (an
// Antigravity turn took 16 steps to add one row).
//
// Kept on this PC, encrypted (DPAPI) like the Notion map; saved on their own,
// no confirmation (Edoardo's choice). Impostazioni → Chat shows how many there
// are and forgets them. Only EasyIsland's tools are seen: an engine's own
// connectors are not.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

const MAX_RECIPES: usize = 60;
const MAX_STEPS: usize = 4;
const MAX_WORDS: usize = 40;

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct Recipe {
    /// The last question answered this way, short.
    pub question: String,
    /// Stems of every question answered this way.
    pub words: Vec<String>,
    /// "notion_query {\"database\":…}", in order.
    pub steps: Vec<String>,
    pub uses: u32,
    pub at: i64,
}

#[derive(Serialize, Deserialize, Default)]
struct Book {
    recipes: Vec<Recipe>,
}

static BOOK: Mutex<Option<Book>> = Mutex::new(None);

/// The calls of the turns going on: (sequence, tool, arguments).
static CALLS: Mutex<Vec<(u64, String, Value)>> = Mutex::new(Vec::new());
static SEQ: AtomicU64 = AtomicU64::new(0);
static ACTIVE: AtomicU64 = AtomicU64::new(0);
/// Bumped by every turn that starts: two turns at once mix their calls, and
/// then neither learns.
static STARTS: AtomicU64 = AtomicU64::new(0);

pub struct Mark {
    seq: u64,
    starts: u64,
    alone: bool,
}

fn path() -> std::path::PathBuf {
    crate::settings::config_dir().join("recipes.bin")
}

fn now() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn with_book<R>(f: impl FnOnce(&mut Book) -> R) -> R {
    let mut g = BOOK.lock().unwrap();
    if g.is_none() {
        // Tests never read nor write the real book.
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
                crate::log::line(format!("ricette: non salvate ({e})"));
            }
        }
        None => crate::log::line("ricette: non cifrate, non salvate"),
    }
}

/// A chat turn starts (lib.rs, chat_turn).
pub fn begin() -> Mark {
    let alone = ACTIVE.fetch_add(1, Ordering::SeqCst) == 0;
    Mark { seq: SEQ.load(Ordering::SeqCst), starts: STARTS.fetch_add(1, Ordering::SeqCst) + 1, alone }
}

/// An easyisland tool was called (agent.rs). Failed calls teach nothing.
pub fn saw(tool: &str, args: &Value, ok: bool) {
    if !ok || ACTIVE.load(Ordering::SeqCst) == 0 {
        return;
    }
    let seq = SEQ.fetch_add(1, Ordering::SeqCst) + 1;
    CALLS.lock().unwrap().push((seq, tool.to_string(), args.clone()));
}

/// The turn is over: when it went well and ran alone, what it did is kept.
pub fn end(mark: Mark, question: &str, ok: bool) {
    let calls: Vec<(String, Value)> = {
        let mut c = CALLS.lock().unwrap();
        let mine = c.iter().filter(|(s, _, _)| *s > mark.seq).map(|(_, t, a)| (t.clone(), a.clone())).collect();
        if ACTIVE.fetch_sub(1, Ordering::SeqCst) == 1 {
            c.clear();
        }
        mine
    };
    let alone = mark.alone && STARTS.load(Ordering::SeqCst) == mark.starts;
    if !ok || !alone {
        return;
    }
    if let Some(steps) = steps_of(&calls) {
        learn(question, steps);
    }
}

/// Looking around (the map, a search, reading a page) is how a turn finds
/// its way: what is worth keeping is what it did once it knew.
const EXPLORING: &[&str] = &["notion_map", "notion_search", "notion_read"];

fn steps_of(calls: &[(String, Value)]) -> Option<Vec<String>> {
    let mut steps: Vec<String> = Vec::new();
    for (tool, args) in calls.iter().filter(|(t, _)| !EXPLORING.contains(&t.as_str())) {
        let line = format!("{tool} {}", compact(args));
        if !steps.contains(&line) {
            steps.push(line);
        }
    }
    // Only exploring, or a long wander: nothing to repeat.
    (!steps.is_empty() && steps.len() <= MAX_STEPS).then_some(steps)
}

fn compact(args: &Value) -> String {
    let s = args.to_string();
    if s.chars().count() <= 400 { s } else { format!("{}…", s.chars().take(400).collect::<String>()) }
}

/// The question without what rides in front of it ("[Questa conversazione è
/// su Telegram…]", the map, a preamble).
fn bare(question: &str) -> &str {
    let mut q = question.trim_start();
    while q.starts_with('[') {
        match q.find("]\n") {
            Some(i) => q = q.get(i + 2..).unwrap_or_default().trim_start(),
            None => break,
        }
    }
    q.trim()
}

const STOP: &[&str] = &[
    "che", "chi", "cosa", "come", "con", "per", "del", "della", "dei", "delle", "dal", "dalla", "nel", "nella", "sul", "sulla",
    "una", "uno", "gli", "le", "lo", "il", "mi", "ti", "ci", "vi", "si", "non", "sono", "ho", "hai", "ha", "abbiamo", "questo",
    "questa", "quello", "quella", "anche", "solo", "poi", "dove", "quando", "quanto", "quanti", "quante", "quale", "quali",
    "dimmi", "fammi", "puoi", "vorrei", "voglio", "per favore", "grazie", "the", "and", "for", "with", "what", "how",
];

/// Stems of the words that mean something: no accents, no small words, no
/// numbers (dates change), the first five letters.
fn stems(text: &str) -> Vec<String> {
    let plain: String = text.to_lowercase().chars().map(|c| match c {
        'à' | 'á' => 'a',
        'è' | 'é' => 'e',
        'ì' | 'í' => 'i',
        'ò' | 'ó' => 'o',
        'ù' | 'ú' => 'u',
        c => c,
    }).collect();
    let mut out: Vec<String> = Vec::new();
    for w in plain.split(|c: char| !c.is_alphanumeric()) {
        if w.chars().count() < 3 || w.chars().all(|c| c.is_ascii_digit()) || STOP.contains(&w) {
            continue;
        }
        let s: String = w.chars().take(5).collect();
        if !out.contains(&s) {
            out.push(s);
        }
    }
    out
}

fn learn(question: &str, steps: Vec<String>) {
    let q = bare(question);
    let words = stems(q);
    if words.is_empty() {
        return;
    }
    let short: String = q.chars().take(120).collect();
    let tools = |s: &[String]| s.iter().map(|x| signature(x)).collect::<Vec<_>>();
    let sig = tools(&steps);
    with_book(|b| {
        if let Some(r) = b.recipes.iter_mut().find(|r| tools(&r.steps) == sig) {
            for w in words {
                if !r.words.contains(&w) {
                    r.words.push(w);
                }
            }
            if r.words.len() > MAX_WORDS {
                let extra = r.words.len() - MAX_WORDS;
                r.words.drain(..extra);
            }
            r.question = short;
            r.steps = steps;
            r.uses += 1;
            r.at = now();
        } else {
            b.recipes.push(Recipe { question: short, words, steps, uses: 1, at: now() });
            if b.recipes.len() > MAX_RECIPES {
                // The least used, then the oldest, goes.
                if let Some(i) = b.recipes.iter().enumerate().min_by_key(|(_, r)| (r.uses, r.at)).map(|(i, _)| i) {
                    b.recipes.remove(i);
                }
            }
        }
        save(b);
    });
}

/// What makes two recipes the same: the tools and the database, not the dates.
fn signature(step: &str) -> String {
    let (tool, args) = step.split_once(' ').unwrap_or((step, ""));
    let db = serde_json::from_str::<Value>(args).ok()
        .and_then(|v| v.get("database").and_then(Value::as_str).map(str::to_lowercase))
        .unwrap_or_default();
    format!("{tool}:{db}")
}

/// How well a recipe fits: the stems in common, and enough of the question's.
fn score(q: &[String], r: &Recipe) -> usize {
    let common = q.iter().filter(|w| r.words.contains(w)).count();
    let enough = common >= 2 || (common == 1 && q.len() <= 2);
    if enough && common * 10 >= q.len() * 4 { common } else { 0 }
}

/// The recipes that fit this question, as a few lines to put in front of it.
pub fn hint(question: &str) -> Option<String> {
    let q = stems(bare(question));
    if q.is_empty() {
        return None;
    }
    let mut found: Vec<(usize, Recipe)> = with_book(|b| b.recipes.iter().map(|r| (score(&q, r), r.clone())).filter(|(s, _)| *s > 0).collect());
    if found.is_empty() {
        return None;
    }
    found.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.uses.cmp(&a.1.uses)));
    let mut s = crate::i18n::t("[Ricette di EasyIsland: domande simili già risolte con questi strumenti di easyisland. Parti da qui, adattando date e valori alla domanda, senza riguardare la mappa; se non bastano fai come al solito.").to_string();
    for (_, r) in found.into_iter().take(2) {
        s.push_str(&format!("\n- «{}» → {}", r.question, r.steps.join(" ; ")));
    }
    s.push_str("]\n\n");
    Some(s)
}

/// A hint as the chat would get it after a month question (claude_cli's live test).
#[cfg(test)]
pub fn sample_hint() -> String {
    let before = with_book(|b| std::mem::take(&mut b.recipes));
    learn("Quanto ho speso a settembre?", vec![r#"notion_query {"database":"Movimenti","filter":{"and":[{"property":"Data","date":{"on_or_after":"2026-09-01"}},{"property":"Data","date":{"on_or_before":"2026-09-30"}}]},"limit":200}"#.into()]);
    let h = hint("Quanto ho speso a ottobre?").unwrap();
    with_book(|b| b.recipes = before);
    h
}

/// Impostazioni → Chat.
pub fn count() -> usize {
    with_book(|b| b.recipes.len())
}

pub fn forget() {
    with_book(|b| {
        b.recipes.clear();
        save(b);
    });
    if !cfg!(test) {
        let _ = std::fs::remove_file(path());
    }
    crate::log::line("ricette: dimenticate");
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn recipe(q: &str, steps: &[&str]) -> Recipe {
        Recipe { question: q.into(), words: stems(q), steps: steps.iter().map(|s| s.to_string()).collect(), uses: 1, at: 0 }
    }

    #[test]
    fn stems_skip_small_words_and_numbers() {
        assert_eq!(stems("Quanto ho speso a Ottobre 2026?"), vec!["speso", "ottob"]);
        assert_eq!(stems("Aggiungi spesa: pranzo 6,40 €"), vec!["aggiu", "spesa", "pranz"]);
        assert_eq!(stems("però è più"), vec!["pero", "piu"]);
    }

    #[test]
    fn what_rides_in_front_is_not_the_question() {
        assert_eq!(bare("[Questa conversazione è su Telegram. …]\n\n[Notion …]\n\nQuanto ho speso?"), "Quanto ho speso?");
        assert_eq!(bare("[senza fine"), "[senza fine");
    }

    #[test]
    fn exploring_alone_teaches_nothing() {
        let c = |t: &str| (t.to_string(), json!({ "database": "Movimenti" }));
        assert!(steps_of(&[c("notion_map"), c("notion_search")]).is_none());
        let s = steps_of(&[c("notion_map"), c("notion_query"), c("notion_query")]).unwrap();
        assert_eq!(s, vec![r#"notion_query {"database":"Movimenti"}"#]);
        assert!(steps_of(&[c("a"), c("b"), c("c"), c("d"), c("e")]).is_none());
    }

    #[test]
    fn similar_questions_fit() {
        let r = recipe("quanto ho speso a ottobre", &[r#"notion_query {"database":"Movimenti"}"#]);
        assert_eq!(score(&stems("e quanto ho speso a settembre?"), &r), 1, "one of two words, a short question");
        let mut r2 = r.clone();
        r2.words.extend(stems("spese di settembre"));
        assert!(score(&stems("quanto ho speso a settembre?"), &r2) >= 2);
        assert_eq!(score(&stems("che tempo fa domani"), &r), 0);
        assert_eq!(score(&stems("speso"), &r), 1);
    }

    #[test]
    fn same_tools_and_database_are_one_recipe() {
        assert_eq!(signature(r#"notion_query {"database":"Movimenti","filter":{"a":1}}"#), signature(r#"notion_query {"database":"movimenti","filter":{"b":2}}"#));
        assert_ne!(signature(r#"notion_query {"database":"Movimenti"}"#), signature(r#"notion_query {"database":"Attività"}"#));
    }

    #[test]
    fn turns_learn_alone_and_only_when_they_went_well() {
        // Uses the real book: keep it apart.
        let before = with_book(|b| std::mem::take(&mut b.recipes));
        let m = begin();
        saw("notion_query", &json!({ "database": "Movimenti", "filter": { "x": 1 } }), true);
        saw("notion_add_row", &json!({}), false);
        end(m, "[nota]\nQuanto ho speso in benzina questo mese", true);
        let n1 = with_book(|b| b.recipes.len());
        let a = begin();
        let b2 = begin();
        saw("list_status", &json!({}), true);
        end(b2, "che tempo fa a Roma oggi", true);
        end(a, "che tempo fa a Milano oggi", true);
        let n2 = with_book(|b| b.recipes.len());
        let hint = hint("quanto ho speso in benzina a settembre");
        with_book(|b| b.recipes = before);
        assert_eq!(n1, 1);
        assert_eq!(n2, 1, "two turns at once learn nothing");
        let hint = hint.expect("a hint");
        assert!(hint.contains("«Quanto ho speso in benzina questo mese» → notion_query"), "{hint}");
        assert!(!hint.contains("notion_add_row"));
    }
}
