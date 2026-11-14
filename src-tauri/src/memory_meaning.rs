// «Ricerca per significato» (14 Nov 2026, docs/idee.md → Memoria, seguiti):
// with a service chosen in Impostazioni → Chat → Memoria, the memory is also
// searched by meaning, not only by the words in common ("computer" finds a
// note about a "PC"). Off by default: the words and the pages' aliases are
// enough for a small memory.
//
// Each line of the memory (notes, archive, page lines; not the diary) is
// turned once into a vector by the service's `/embeddings` (OpenAI-compatible:
// OpenAI, Gemini, OpenRouter, Ollama, LM Studio), kept in %LOCALAPPDATA%\EasyIsland\
// significato.json (8-bit, a line's hash → its vector; a new service or
// model starts over). Before each question the question is turned into a
// vector too and the closest lines go in front with `memory::related`.
// With a cloud service the lines leave the PC (as with any cloud engine);
// with Ollama or LM Studio they stay here; with «locale» (meaning_local.rs,
// 14 Nov 2026) EasyIsland does it itself, with a model downloaded once from
// Impostazioni: no key, no network, nothing out of the PC.

use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

/// The lines turned into vectors, at most (the newest first).
const MAX_LINES: usize = 3_000;
/// Lines sent in one request, and requests before a question at most (the rest next time).
const BATCH: usize = 64;
const MAX_BATCHES: usize = 8;
/// How close a line must be (cosine), and how far below the best one it may go.
const MIN_SCORE: f32 = 0.45;
const BELOW_BEST: f32 = 0.12;
const MAX_FOUND: usize = 4;
/// The model on this PC has lower numbers: same-meaning lines 0.23–0.54,
/// unrelated ones up to 0.21 (test meaning_on_this_pc, 14 Nov 2026).
const LOCAL_MIN_SCORE: f32 = 0.30;
const LOCAL_BELOW_BEST: f32 = 0.10;
/// On this PC every missing line at once: no service to spare.
const LOCAL_BATCH: usize = 512;

/// EasyIsland's own model (meaning_local.rs).
pub const LOCAL: &str = "locale";
pub const ENGINES: &[&str] = &[LOCAL, "openai", "gemini", "openrouter", "ollama", "lmstudio"];

fn limits(engine: &str) -> (f32, f32) {
    if engine == LOCAL { (LOCAL_MIN_SCORE, LOCAL_BELOW_BEST) } else { (MIN_SCORE, BELOW_BEST) }
}

pub fn default_model(engine: &str) -> &'static str {
    match engine {
        LOCAL => "potion-multilingual-128M",
        "openai" => "text-embedding-3-small",
        "gemini" => "gemini-embedding-001",
        "openrouter" => "openai/text-embedding-3-small",
        "ollama" => "nomic-embed-text",
        "lmstudio" => "text-embedding-nomic-embed-text-v1.5",
        _ => "",
    }
}

#[derive(Serialize, Deserialize, Default)]
struct Store {
    engine: String,
    model: String,
    /// Line hash → vector, 8-bit, as hex.
    items: HashMap<String, String>,
}

static STORE: Mutex<Option<Store>> = Mutex::new(None);

fn store_path() -> std::path::PathBuf {
    crate::settings::local_dir().join("significato.json")
}

/// A unit vector as 8 bits per number, in hex.
fn pack(v: &[f32]) -> String {
    let norm = v.iter().map(|x| x * x).sum::<f32>().sqrt().max(1e-9);
    v.iter().map(|x| format!("{:02x}", ((x / norm * 127.0).round().clamp(-127.0, 127.0) as i8) as u8)).collect()
}

fn unpack(hex: &str) -> Vec<f32> {
    (0..hex.len() / 2)
        .filter_map(|i| hex.get(i * 2..i * 2 + 2).and_then(|b| u8::from_str_radix(b, 16).ok()))
        .map(|b| b as i8 as f32 / 127.0)
        .collect()
}

fn cosine(a: &[f32], b: &[f32]) -> f32 {
    if a.len() != b.len() || a.is_empty() {
        return 0.0;
    }
    let dot: f32 = a.iter().zip(b).map(|(x, y)| x * y).sum();
    let na = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let nb = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if na == 0.0 || nb == 0.0 { 0.0 } else { dot / (na * nb) }
}

/// The lines worth searching: notes, archive, page lines, newest first.
fn corpus() -> Vec<String> {
    let mut lines: Vec<String> = crate::memory::notes().into_iter().rev().collect();
    let archive = std::fs::read_to_string(crate::memory::dir().join("archivio.md")).unwrap_or_default();
    lines.extend(crate::memory::notes_of(&archive).into_iter().rev());
    for p in crate::brain::pages() {
        // The page's summary, kept apart from its body: «chi è Falchi?» (memory_answer.rs).
        if p.summary.trim().chars().count() > 20 {
            lines.push(format!("[[{}]] riassunto: {}", p.title, p.summary.trim()));
        }
        for l in p.body.lines().map(str::trim).filter(|l| l.chars().count() > 20) {
            lines.push(format!("[[{}]] {}", p.title, l.trim_start_matches("- ")));
        }
    }
    let mut seen = std::collections::HashSet::new();
    lines.retain(|l| seen.insert(crate::brain::note_hash(l)));
    lines.truncate(MAX_LINES);
    lines
}

/// The service and model chosen, if any.
fn chosen(app: &AppHandle) -> Option<(String, String, Option<String>)> {
    let shared = app.try_state::<crate::Shared>()?;
    let s = shared.settings.lock().unwrap();
    let engine = s.memory_meaning.trim().to_string();
    if !ENGINES.contains(&engine.as_str()) || !s.chat_history {
        return None;
    }
    drop(s);
    if engine == LOCAL {
        // Chosen but not downloaded (or removed): the words alone, as when off.
        return crate::meaning_local::ready().then(|| (engine, default_model(LOCAL).to_string(), None));
    }
    let s = shared.settings.lock().unwrap();
    let model = if s.memory_meaning_model.trim().is_empty() { default_model(&engine).to_string() } else { s.memory_meaning_model.trim().to_string() };
    let url = s.engine_urls.get(&engine).cloned();
    Some((engine, model, url))
}

async fn embed(engine: &str, model: &str, url: Option<&str>, inputs: &[String]) -> Result<Vec<Vec<f32>>, String> {
    if engine == LOCAL {
        let inputs = inputs.to_vec();
        return tauri::async_runtime::spawn_blocking(move || crate::meaning_local::embed(&inputs)).await.map_err(|e| e.to_string())?;
    }
    let base = crate::openai::base_url(engine, url)?;
    let client = reqwest::Client::builder().timeout(Duration::from_secs(30)).build().map_err(|e| e.to_string())?;
    let request = crate::openai::auth(engine, client.post(format!("{base}/embeddings")).json(&json!({ "model": model, "input": inputs })))?;
    let response = request.send().await.map_err(|e| e.to_string())?;
    let status = response.status();
    let v: Value = response.json().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        let why = v.pointer("/error/message").and_then(Value::as_str).unwrap_or("").to_string();
        return Err(format!("{status} {why}"));
    }
    let mut out: Vec<(usize, Vec<f32>)> = v.get("data").and_then(Value::as_array).into_iter().flatten()
        .map(|d| {
            let i = d.get("index").and_then(Value::as_u64).unwrap_or(0) as usize;
            let e = d.get("embedding").and_then(Value::as_array).into_iter().flatten().filter_map(Value::as_f64).map(|x| x as f32).collect();
            (i, e)
        })
        .collect();
    out.sort_by_key(|(i, _)| *i);
    if out.len() != inputs.len() {
        return Err(format!("{} vettori per {} righe", out.len(), inputs.len()));
    }
    Ok(out.into_iter().map(|(_, e)| e).collect())
}

/// The closest lines of `corpus` to `query`, best first, with their score;
/// and the best score of all, also when under the threshold (for the log).
fn closest(query: &[f32], lines: &[String], store: &Store) -> (Vec<(f32, String)>, f32) {
    let (min, below) = limits(&store.engine);
    let mut scored: Vec<(f32, &String)> = lines.iter()
        .filter_map(|l| store.items.get(&crate::brain::note_hash(l)).map(|h| (cosine(query, &unpack(h)), l)))
        .collect();
    scored.sort_by(|a, b| b.0.total_cmp(&a.0));
    let best = scored.first().map(|s| s.0).unwrap_or(0.0);
    let found = scored.into_iter()
        .filter(|(s, _)| *s >= min && *s >= best - below)
        .take(MAX_FOUND)
        .map(|(s, l)| (s, l.clone()))
        .collect();
    (found, best)
}

/// The `n` closest lines, best first, with no threshold: memory_answer.rs
/// picks by their words, the meaning only breaks ties.
fn ranked(query: &[f32], lines: &[String], store: &Store, n: usize) -> Vec<(f32, String)> {
    let mut scored: Vec<(f32, &String)> = lines.iter()
        .filter_map(|l| store.items.get(&crate::brain::note_hash(l)).map(|h| (cosine(query, &unpack(h)), l)))
        .collect();
    scored.sort_by(|a, b| b.0.total_cmp(&a.0));
    scored.into_iter().take(n).map(|(s, l)| (s, l.clone())).collect()
}

/// Lines looked at for a direct answer from the memory.
const DEEP: usize = 5_000;

/// What the meaning brought in this turn (before the question and in
/// memory_search), for the mark under the answer in the island. One list for
/// all the conversations: a turn elsewhere at the same time may add to it.
static FOUND: Mutex<Vec<(String, f32)>> = Mutex::new(Vec::new());

/// At the start of a turn of the island's chat.
pub fn turn_start() {
    if let Ok(mut f) = FOUND.lock() {
        f.clear();
    }
    if let Ok(mut l) = LAST.lock() {
        *l = None;
    }
}

/// The lines found by meaning in this turn, once, each with its best score.
pub fn take_found() -> Vec<(String, f32)> {
    FOUND.lock().map(|mut f| std::mem::take(&mut *f)).unwrap_or_default()
}

fn note_found(found: &[(f32, String)]) {
    let Ok(mut f) = FOUND.lock() else { return };
    for (score, line) in found {
        match f.iter_mut().find(|(l, _)| l == line) {
            Some(x) => x.1 = x.1.max(*score),
            None => f.push((line.clone(), *score)),
        }
    }
}

/// memory_search (memshare::search): the lines close in meaning that the
/// words did not find, under what they found.
pub async fn with_meaning(app: &AppHandle, query: &str, found: String) -> String {
    let lines = related(app, query).await;
    let nothing = found == crate::i18n::t("Niente in memoria su questo.");
    let new: Vec<String> = lines.into_iter()
        .filter(|l| {
            let core: String = l.rsplit("- ").next().unwrap_or(l).chars().take(80).collect();
            nothing || !found.contains(&core)
        })
        .map(|l| format!("- {}", l.trim_start_matches("- ")))
        .collect();
    if new.is_empty() {
        return found;
    }
    let head = crate::i18n::t("Vicine per significato:");
    if nothing { format!("{head}\n{}", new.join("\n")) } else { format!("{found}\n\n{head}\n{}", new.join("\n")) }
}

/// The memory's lines closest in meaning to the question (none when off or on any error).
pub async fn related(app: &AppHandle, question: &str) -> Vec<String> {
    related_scored(app, question).await.0.into_iter().map(|(_, l)| l).collect()
}

/// A line found this close or closer answers a lookup with no engine
/// (memory_answer.rs), and tells the engine not to search further. The model
/// on this PC: same-meaning lines 0.23–0.54 in the tests, 0.62–0.77 on the
/// laptop's memory for «quale vm ha la farmacia falchi?» (15 Nov 2026).
pub fn strong(engine: &str) -> f32 {
    if engine == LOCAL { 0.55 } else { 0.62 }
}

/// A line with every word of a lookup and at least this close answers it
/// with no engine (memory_answer.rs). Low: the words decide. On the laptop the
/// line with Falchi's VMs was 0.30 for «quale vm ha la farmacia falchi?», under
/// a note about another pharmacy at 0.41 (15 Nov 2026).
pub fn answer_min(engine: &str) -> f32 {
    if engine == LOCAL { 0.15 } else { 0.25 }
}

/// The same question in the same turn (the direct answer, then the engine's
/// preface): asked of the model once.
static LAST: Mutex<Option<(String, String, Vec<(f32, String)>, Vec<(f32, String)>, std::time::Instant)>> = Mutex::new(None);

/// The closest lines with their score, best first, and the service that found them.
pub async fn related_scored(app: &AppHandle, question: &str) -> (Vec<(f32, String)>, String) {
    let Some((engine, model, url)) = chosen(app) else { return (Vec::new(), String::new()) };
    let question = question.trim();
    if question.chars().count() < 8 {
        return (Vec::new(), engine);
    }
    if let Some((q, e, found, _, at)) = LAST.lock().ok().and_then(|g| g.clone()) {
        if q == question && e == engine && at.elapsed() < Duration::from_secs(60) {
            return (found, engine);
        }
    }
    let lines = index(&engine, &model, url.as_deref()).await;
    if lines.is_empty() {
        return (Vec::new(), engine);
    }
    let query = match embed(&engine, &model, url.as_deref(), &[question.chars().take(2_000).collect()]).await {
        Ok(mut v) if v.first().is_some_and(|q| !q.is_empty()) => v.remove(0),
        Ok(_) => return (Vec::new(), engine),
        Err(e) => {
            crate::log::line(format!("ricerca per significato: {e}"));
            return (Vec::new(), engine);
        }
    };
    let ((found, best), deep) = {
        let guard = STORE.lock().unwrap();
        guard.as_ref().map(|s| (closest(&query, &lines, s), ranked(&query, &lines, s, DEEP))).unwrap_or_default()
    };
    // Scores only, never the memory's text, in the log.
    if found.is_empty() {
        crate::log::line(format!("significato ({engine}): niente sopra la soglia, la più vicina {best:.2}"));
    } else {
        let scores: Vec<String> = found.iter().map(|(s, _)| format!("{s:.2}")).collect();
        let what = if found.len() == 1 { "riga vicina" } else { "righe vicine" };
        crate::log::line(format!("significato ({engine}): {} {what} ({})", found.len(), scores.join(", ")));
    }
    note_found(&found);
    if let Ok(mut g) = LAST.lock() {
        *g = Some((question.to_string(), engine.clone(), found.clone(), deep, std::time::Instant::now()));
    }
    (found, engine)
}

/// The closest lines, many more than `related_scored` gives (memory_answer.rs
/// picks among them by their words), and the service that found them.
pub async fn deep_scored(app: &AppHandle, question: &str) -> (Vec<(f32, String)>, String) {
    let (_, engine) = related_scored(app, question).await;
    let deep = LAST.lock().ok().and_then(|g| g.clone()).filter(|(q, e, ..)| q == question.trim() && *e == engine).map(|(.., d, _)| d).unwrap_or_default();
    (deep, engine)
}

/// Every line of the memory turned into a vector now (after the model's
/// download), not at the next question.
pub async fn prepare(app: &AppHandle) {
    if let Some((engine, model, url)) = chosen(app) {
        let n = index(&engine, &model, url.as_deref()).await.len();
        crate::log::line(format!("ricerca per significato: {n} righe pronte con {engine}"));
    }
}

/// The memory's lines, with the vectors of the new ones made and kept on disk.
async fn index(engine: &str, model: &str, url: Option<&str>) -> Vec<String> {
    let (engine, model) = (engine.to_string(), model.to_string());
    let lines = tauri::async_runtime::spawn_blocking(corpus).await.unwrap_or_default();
    if lines.is_empty() {
        return Vec::new();
    }
    // The vectors kept on disk, for this service and model.
    let missing: Vec<String> = {
        let mut guard = STORE.lock().unwrap();
        let store = guard.get_or_insert_with(|| std::fs::read_to_string(store_path()).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default());
        if store.engine != engine || store.model != model {
            *store = Store { engine: engine.clone(), model: model.clone(), items: HashMap::new() };
        }
        let wanted: std::collections::HashSet<String> = lines.iter().map(|l| crate::brain::note_hash(l)).collect();
        store.items.retain(|k, _| wanted.contains(k));
        lines.iter().filter(|l| !store.items.contains_key(&crate::brain::note_hash(l))).cloned().collect()
    };
    let mut added = false;
    let (batch, batches) = if engine == LOCAL { (LOCAL_BATCH, usize::MAX) } else { (BATCH, MAX_BATCHES) };
    for chunk in missing.chunks(batch).take(batches) {
        match embed(&engine, &model, url, chunk).await {
            Ok(vectors) => {
                let mut guard = STORE.lock().unwrap();
                if let Some(store) = guard.as_mut() {
                    for (l, v) in chunk.iter().zip(vectors) {
                        store.items.insert(crate::brain::note_hash(l), pack(&v));
                    }
                }
                added = true;
            }
            Err(e) => {
                crate::log::line(format!("ricerca per significato: {e}"));
                break;
            }
        }
    }
    if added {
        let text = STORE.lock().unwrap().as_ref().and_then(|s| serde_json::to_string(s).ok());
        if let Some(text) = text {
            let _ = std::fs::write(store_path(), text);
        }
    }
    lines
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vectors_survive_eight_bits() {
        let a = vec![0.3, -0.5, 0.8, 0.0];
        let b = unpack(&pack(&a));
        assert!(cosine(&a, &b) > 0.999);
        assert_eq!(cosine(&a, &[1.0]), 0.0);
    }

    /// Two test sentences only, never the memory.
    #[test]
    #[ignore = "asks the service with this PC's key: EI_ENGINE=gemini cargo test meaning_live -- --ignored --nocapture"]
    fn meaning_live() {
        let engine = std::env::var("EI_ENGINE").unwrap_or_else(|_| "gemini".into());
        let inputs = ["Il computer dell'ufficio non si accende".to_string(), "Il PC della segreteria è spento".to_string(), "Previsioni del tempo per domani".to_string()];
        let v = tauri::async_runtime::block_on(embed(&engine, default_model(&engine), None, &inputs)).unwrap();
        let (same, other) = (cosine(&v[0], &v[1]), cosine(&v[0], &v[2]));
        println!("{engine}: {} numeri; vicine {same:.2}, lontane {other:.2}", v[0].len());
        assert!(same > other);
    }

    #[test]
    fn only_the_close_lines_and_near_the_best() {
        let lines = vec!["PC di Rossi".to_string(), "computer di Rossi".to_string(), "meteo".to_string()];
        let mut store = Store::default();
        store.items.insert(crate::brain::note_hash(&lines[0]), pack(&[1.0, 0.0, 0.0]));
        store.items.insert(crate::brain::note_hash(&lines[1]), pack(&[0.9, 0.3, 0.0]));
        store.items.insert(crate::brain::note_hash(&lines[2]), pack(&[0.0, 0.0, 1.0]));
        let names = |q: &[f32]| closest(q, &lines, &store).0.into_iter().map(|(_, l)| l).collect::<Vec<_>>();
        assert_eq!(names(&[1.0, 0.1, 0.0]), vec!["PC di Rossi".to_string(), "computer di Rossi".to_string()]);
        assert!(names(&[0.0, 1.0, 0.0]).len() <= 1);
    }
}
