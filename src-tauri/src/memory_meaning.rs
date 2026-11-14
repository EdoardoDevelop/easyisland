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
// with Ollama or LM Studio they stay here.

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

pub const ENGINES: &[&str] = &["openai", "gemini", "openrouter", "ollama", "lmstudio"];

pub fn default_model(engine: &str) -> &'static str {
    match engine {
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
    let model = if s.memory_meaning_model.trim().is_empty() { default_model(&engine).to_string() } else { s.memory_meaning_model.trim().to_string() };
    let url = s.engine_urls.get(&engine).cloned();
    Some((engine, model, url))
}

async fn embed(engine: &str, model: &str, url: Option<&str>, inputs: &[String]) -> Result<Vec<Vec<f32>>, String> {
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

/// The closest lines of `corpus` to `query`, best first.
fn closest(query: &[f32], lines: &[String], store: &Store) -> Vec<String> {
    let mut scored: Vec<(f32, &String)> = lines.iter()
        .filter_map(|l| store.items.get(&crate::brain::note_hash(l)).map(|h| (cosine(query, &unpack(h)), l)))
        .filter(|(s, _)| *s >= MIN_SCORE)
        .collect();
    scored.sort_by(|a, b| b.0.total_cmp(&a.0));
    let best = scored.first().map(|s| s.0).unwrap_or(0.0);
    scored.into_iter().filter(|(s, _)| *s >= best - BELOW_BEST).take(MAX_FOUND).map(|(_, l)| l.clone()).collect()
}

/// The memory's lines closest in meaning to the question (none when off or on any error).
pub async fn related(app: &AppHandle, question: &str) -> Vec<String> {
    let Some((engine, model, url)) = chosen(app) else { return Vec::new() };
    let question = question.trim();
    if question.chars().count() < 8 {
        return Vec::new();
    }
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
    for chunk in missing.chunks(BATCH).take(MAX_BATCHES) {
        match embed(&engine, &model, url.as_deref(), chunk).await {
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
    let query = match embed(&engine, &model, url.as_deref(), &[question.chars().take(2_000).collect()]).await {
        Ok(mut v) if !v.is_empty() => v.remove(0),
        Ok(_) => return Vec::new(),
        Err(e) => {
            crate::log::line(format!("ricerca per significato: {e}"));
            return Vec::new();
        }
    };
    let guard = STORE.lock().unwrap();
    guard.as_ref().map(|s| closest(&query, &lines, s)).unwrap_or_default()
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
        assert_eq!(closest(&[1.0, 0.1, 0.0], &lines, &store), vec!["PC di Rossi".to_string(), "computer di Rossi".to_string()]);
        assert!(closest(&[0.0, 1.0, 0.0], &lines, &store).len() <= 1);
    }
}
