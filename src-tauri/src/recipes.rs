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
//
// Values the question decides (14 Nov 2026): the dates of a period it names
// («ottobre», «mese scorso», «ieri», periods.rs) and its numbers («ticket
// 1234») become placeholders in `template`, so «spese di novembre» reuses the
// recipe of «spese di ottobre» with November's dates, also for an answer
// without the engine (router.rs).

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
    /// Turns in a row that called exactly these steps, values too: from 2 the
    /// smistatore (router.rs) may run it without an engine.
    #[serde(default)]
    pub same: u32,
    /// The user asked the engine after a direct answer: never direct again.
    #[serde(default)]
    pub direct_off: bool,
    /// `steps` with the question's values as placeholders ({inizio}, {fine},
    /// {dopo}, {mese}, {n1}…; "{#n1}" for a number), when it had any.
    #[serde(default)]
    pub template: Vec<String>,
    /// The kind of period its dates are (periods.rs `Span::name`), "" for none.
    #[serde(default)]
    pub span: String,
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
/// Returns the tools it called, for the turn log (router.rs). `prepared`: the
/// steps the smistatore read before the engine (router::prepare), which count
/// as called: the engine no longer needs to, and the recipe must still learn
/// that they stay the same.
pub fn end(mark: Mark, question: &str, ok: bool, prepared: &[String]) -> Vec<String> {
    let calls: Vec<(String, Value)> = {
        let mut c = CALLS.lock().unwrap();
        let mut mine: Vec<(String, Value)> = prepared.iter()
            .filter_map(|s| {
                let (tool, args) = s.split_once(' ').unwrap_or((s.as_str(), "{}"));
                serde_json::from_str::<Value>(args).ok().map(|a| (tool.to_string(), a))
            })
            .collect();
        mine.extend(c.iter().filter(|(s, _, _)| *s > mark.seq).map(|(_, t, a)| (t.clone(), a.clone())));
        if ACTIVE.fetch_sub(1, Ordering::SeqCst) == 1 {
            c.clear();
        }
        mine
    };
    let alone = mark.alone && STARTS.load(Ordering::SeqCst) == mark.starts;
    let names: Vec<String> = if alone { calls.iter().map(|(t, _)| t.clone()).collect() } else { Vec::new() };
    if !ok || !alone {
        return names;
    }
    if let Some(steps) = steps_of(&calls) {
        learn(question, steps);
    }
    names
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
    stems_of(text, false)
}

/// `stems`, without the words that only name a period («novembre», «scorso»).
fn stems_no_period(text: &str) -> Vec<String> {
    stems_of(text, true)
}

fn stems_of(text: &str, drop_periods: bool) -> Vec<String> {
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
        if drop_periods && crate::periods::is_period_word(w) {
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
    let (template, span) = templatize(q, &steps, crate::periods::today()).unwrap_or_default();
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
            // The same steps, or the same ones but for the question's own values.
            let alike = r.steps == steps || (!template.is_empty() && r.template == template && r.span == span);
            r.same = if alike { r.same.max(1) + 1 } else { 1 };
            r.steps = steps;
            r.template = template;
            r.span = span;
            r.uses += 1;
            r.at = now();
        } else {
            b.recipes.push(Recipe { question: short, words, steps, uses: 1, at: now(), same: 1, direct_off: false, template, span });
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
    // Both ways: a recipe from a very long question (Agent Chat's whole
    // prompt) shares a few words with almost anything (13 Nov 2026).
    if enough && common * 10 >= q.len() * 4 && common * 10 >= r.words.len().min(40) * 3 { common } else { 0 }
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

/// The recipe a question can be answered with, without an engine (router.rs),
/// and its steps for this question: one step, the same values at least twice
/// in a row (or the same but for the question's own period and numbers), and
/// every other meaningful word of the question already seen with it (so
/// «novembre» never gets October's rows from a recipe with fixed dates).
pub fn sure(question: &str) -> Option<(Recipe, Vec<String>)> {
    let q = bare(question);
    let all = stems(q);
    let plain = stems_no_period(q);
    if all.is_empty() {
        return None;
    }
    let today = crate::periods::today();
    with_book(|b| {
        b.recipes.iter()
            .filter(|r| r.same >= 2 && !r.direct_off && r.steps.len() == 1)
            .filter_map(|r| {
                if r.template.is_empty() {
                    all.iter().all(|w| r.words.contains(w)).then(|| (r.clone(), r.steps.clone()))
                } else {
                    let ok = !plain.is_empty() && plain.iter().all(|w| r.words.contains(w));
                    ok.then(|| fill(&r.template, &r.span, q, today)).flatten().map(|s| (r.clone(), s))
                }
            })
            .max_by_key(|(r, _)| (r.uses, r.at))
    })
}

/// A recipe's steps for this question: its template filled in with the
/// question's period and numbers (None when it has no template, or the
/// question does not give what the template needs).
pub fn steps_for(r: &Recipe, question: &str) -> Option<Vec<String>> {
    if r.template.is_empty() {
        return None;
    }
    fill(&r.template, &r.span, bare(question), crate::periods::today())
}

/// The numbers a question gives (two digits or more), without the year of
/// its period.
fn numbers(question: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for w in question.split(|c: char| !c.is_ascii_digit()) {
        if w.len() < 2 || crate::periods::is_period_word(w) || out.iter().any(|x| x == w) {
            continue;
        }
        out.push(w.to_string());
    }
    out
}

/// The steps with the question's values as placeholders, and the kind of
/// period its dates are; None when nothing in them came from the question.
fn templatize(question: &str, steps: &[String], today: i64) -> Option<(Vec<String>, String)> {
    let period = crate::periods::find(question, today);
    let nums = numbers(question);
    if period.is_none() && nums.is_empty() {
        return None;
    }
    let (mut dates, mut any) = (false, false);
    let mut out: Vec<String> = Vec::new();
    for step in steps {
        let (tool, args) = step.split_once(' ').unwrap_or((step.as_str(), "{}"));
        // Values cut at 400 characters (`compact`) are not JSON any more.
        let Ok(mut v) = serde_json::from_str::<Value>(args) else {
            out.push(step.clone());
            continue;
        };
        mark(&mut v, period.as_ref(), &nums, &mut dates, &mut any);
        out.push(format!("{tool} {v}"));
    }
    let span = if dates { period.map(|p| p.span.name().to_string()).unwrap_or_default() } else { String::new() };
    any.then_some((out, span))
}

fn mark(v: &mut Value, period: Option<&crate::periods::Period>, nums: &[String], dates: &mut bool, any: &mut bool) {
    match v {
        Value::String(s) => {
            if let Some(p) = period {
                let before = s.clone();
                let month = p.start.get(..7).unwrap_or_default().to_string();
                *s = s.replace(&p.start, "{inizio}");
                if p.end != p.start {
                    *s = s.replace(&p.end, "{fine}");
                }
                *s = s.replace(&p.after, "{dopo}");
                if !month.is_empty() {
                    *s = s.replace(&month, "{mese}");
                }
                if *s != before {
                    *dates = true;
                    *any = true;
                }
            }
            if let Some(i) = nums.iter().position(|n| n == s.trim()) {
                *s = format!("{{n{}}}", i + 1);
                *any = true;
            }
        }
        Value::Number(n) => {
            if let Some(i) = nums.iter().position(|x| Some(x.as_str()) == n.as_i64().map(|k| k.to_string()).as_deref()) {
                *v = Value::String(format!("{{#n{}}}", i + 1));
                *any = true;
            }
        }
        Value::Array(list) => list.iter_mut().for_each(|x| mark(x, period, nums, dates, any)),
        Value::Object(map) => map.values_mut().for_each(|x| mark(x, period, nums, dates, any)),
        _ => {}
    }
}

/// The template with this question's values; None when the question does not
/// give a period of the same kind, or the numbers it needs.
fn fill(template: &[String], span: &str, question: &str, today: i64) -> Option<Vec<String>> {
    let nums = numbers(question);
    let joined = template.join("\n");
    // As many numbers as the recipe had: more or fewer is another question.
    let wanted = (1..=9).take_while(|i| joined.contains(&format!("{{n{i}}}")) || joined.contains(&format!("{{#n{i}}}"))).count();
    if wanted != nums.len() {
        return None;
    }
    let period = if span.is_empty() {
        None
    } else {
        Some(crate::periods::find(question, today).filter(|p| p.span.name() == span)?)
    };
    let mut out: Vec<String> = Vec::new();
    for step in template {
        let mut s = step.clone();
        if let Some(p) = &period {
            s = s.replace("{inizio}", &p.start).replace("{fine}", &p.end).replace("{dopo}", &p.after)
                .replace("{mese}", p.start.get(..7).unwrap_or_default());
        }
        for (i, n) in nums.iter().enumerate() {
            s = s.replace(&format!("\"{{#n{}}}\"", i + 1), n).replace(&format!("{{n{}}}", i + 1), n);
        }
        let (_, args) = s.split_once(' ').unwrap_or((s.as_str(), "{}"));
        serde_json::from_str::<Value>(args).ok()?;
        out.push(s);
    }
    Some(out)
}

/// The recipes that fit a question (as `hint`), the best first.
pub fn fitting(question: &str) -> Vec<Recipe> {
    let q = stems(bare(question));
    if q.is_empty() {
        return Vec::new();
    }
    let mut found: Vec<(usize, Recipe)> = with_book(|b| b.recipes.iter().map(|r| (score(&q, r), r.clone())).filter(|(s, _)| *s > 0).collect());
    found.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.uses.cmp(&a.1.uses)));
    found.into_iter().take(2).map(|(_, r)| r).collect()
}

/// The user wanted the engine after a direct answer from this recipe.
pub fn no_direct(steps: &[String]) {
    with_book(|b| {
        if let Some(r) = b.recipes.iter_mut().find(|r| r.steps == steps) {
            r.direct_off = true;
            save(b);
        }
    });
}

/// Same words for the turn log: did the user ask the same thing again?
pub fn same_question(a: &str, b: &str) -> bool {
    let (x, y) = (stems(bare(a)), stems(bare(b)));
    !x.is_empty() && x.len() == y.len() && x.iter().all(|w| y.contains(w))
}

/// The question without what rides in front of it, for the turn log.
pub fn bare_question(question: &str) -> String {
    bare(question).to_string()
}

/// A hint as the chat would get it after a month question (claude_cli's live test).
/// Tests that use the real book, one at a time.
#[cfg(test)]
static TEST_BOOK: Mutex<()> = Mutex::new(());

#[cfg(test)]
pub fn sample_hint() -> String {
    let _one = TEST_BOOK.lock().unwrap_or_else(|e| e.into_inner());
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
        Recipe { question: q.into(), words: stems(q), steps: steps.iter().map(|s| s.to_string()).collect(), uses: 1, at: 0, same: 1, direct_off: false, ..Default::default() }
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
        let _one = TEST_BOOK.lock().unwrap_or_else(|e| e.into_inner());
        // Uses the real book: keep it apart.
        let before = with_book(|b| std::mem::take(&mut b.recipes));
        let m = begin();
        saw("notion_query", &json!({ "database": "Movimenti", "filter": { "x": 1 } }), true);
        saw("notion_add_row", &json!({}), false);
        end(m, "[nota]\nQuanto ho speso in benzina questo mese", true, &[]);
        let n1 = with_book(|b| b.recipes.len());
        let a = begin();
        let b2 = begin();
        saw("list_status", &json!({}), true);
        end(b2, "che tempo fa a Roma oggi", true, &[]);
        end(a, "che tempo fa a Milano oggi", true, &[]);
        let n2 = with_book(|b| b.recipes.len());
        let hint = hint("quanto ho speso in benzina a settembre");
        with_book(|b| b.recipes = before);
        assert_eq!(n1, 1);
        assert_eq!(n2, 1, "two turns at once learn nothing");
        let hint = hint.expect("a hint");
        assert!(hint.contains("«Quanto ho speso in benzina questo mese» → notion_query"), "{hint}");
        assert!(!hint.contains("notion_add_row"));
    }

    #[test]
    fn sure_only_after_the_same_steps_twice_and_known_words() {
        let _one = TEST_BOOK.lock().unwrap_or_else(|e| e.into_inner());
        let before = with_book(|b| std::mem::take(&mut b.recipes));
        learn("stato del computer oggi", vec!["list_status {}".into()]);
        let once = sure("stato del computer oggi").is_some();
        learn("stato del computer", vec!["list_status {}".into()]);
        let twice = sure("stato computer").map(|(r, _)| r.steps);
        let new_word = sure("stato computer di Rossi").is_some();
        learn("spese di ottobre", vec![r#"notion_query {"database":"Movimenti","m":10}"#.into()]);
        learn("spese di settembre", vec![r#"notion_query {"database":"Movimenti","m":9}"#.into()]);
        let changing = sure("spese di ottobre").is_some();
        no_direct(&["list_status {}".to_string()]);
        let refused = sure("stato del computer").is_some();
        // A step read before the engine counts as called by it.
        let m = begin();
        end(m, "azioni rapide", true, &[r#"list_quick_actions {}"#.to_string()]);
        let m = begin();
        end(m, "azioni rapide", true, &[r#"list_quick_actions {}"#.to_string()]);
        let prepared = sure("azioni rapide").map(|(r, _)| r.same);
        with_book(|b| b.recipes = before);
        assert!(!once, "one turn is not enough");
        assert_eq!(twice, Some(vec!["list_status {}".to_string()]));
        assert!(!new_word, "a word never seen with it");
        assert!(!changing, "values that change need the engine");
        assert!(!refused);
        assert_eq!(prepared, Some(2));
        assert!(same_question("[x]\n\nStato del computer?", "stato del computer"));
        assert!(!same_question("stato del computer", "stato del computer di Rossi"));
    }

    #[test]
    fn the_question_decides_dates_and_numbers() {
        let today = crate::periods::days_from_civil(2026, 11, 14);
        let step = |a: &str, b: &str| format!(r#"notion_query {{"database":"Movimenti","filter":{{"and":[{{"date":{{"on_or_after":"{a}"}}}},{{"date":{{"before":"{b}"}}}}]}}}}"#);
        let (t, span) = templatize("Quanto ho speso a ottobre?", &[step("2026-10-01", "2026-11-01")], today).unwrap();
        assert_eq!(span, "mese");
        assert_eq!(t, vec![step("{inizio}", "{dopo}")]);
        assert_eq!(fill(&t, &span, "e a settembre?", today), Some(vec![step("2026-09-01", "2026-10-01")]));
        assert_eq!(fill(&t, &span, "e ieri?", today), None, "a day is not a month");
        assert_eq!(fill(&t, &span, "e in totale?", today), None);
        let (n, _) = templatize("stato del ticket 1234", &[r#"custom_records {"id":"ticket","numero":1234,"q":"1234"}"#.into()], today).unwrap();
        assert_eq!(n, vec![r#"custom_records {"id":"ticket","numero":"{#n1}","q":"{n1}"}"#.to_string()]);
        assert_eq!(fill(&n, "", "e il ticket 98?", today), Some(vec![r#"custom_records {"id":"ticket","numero":98,"q":"98"}"#.to_string()]));
        assert_eq!(fill(&n, "", "e il ticket?", today), None);
        assert!(templatize("stato del computer", &["list_status {}".into()], today).is_none());
        assert!(templatize("spese di ottobre", &[r#"notion_query {"database":"Movimenti"}"#.into()], today).is_none(), "nothing came from the question");
    }

    #[test]
    fn a_month_recipe_answers_another_month() {
        let _one = TEST_BOOK.lock().unwrap_or_else(|e| e.into_inner());
        let before = with_book(|b| std::mem::take(&mut b.recipes));
        let today = crate::periods::today();
        let range = |q: &str| {
            let p = crate::periods::find(q, today).unwrap();
            format!(r#"notion_query {{"database":"Movimenti","da":"{}","a":"{}"}}"#, p.start, p.end)
        };
        learn("spese di settembre", vec![range("settembre")]);
        let once = sure("spese di novembre").is_some();
        learn("spese di ottobre", vec![range("ottobre")]);
        let twice = sure("spese di novembre").map(|(_, s)| s);
        let other = sure("spese di Rossi a novembre").is_some();
        with_book(|b| b.recipes = before);
        assert!(!once);
        assert_eq!(twice, Some(vec![range("novembre")]));
        assert!(!other, "a word never seen with it");
    }
}
