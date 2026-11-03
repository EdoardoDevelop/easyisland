// The links of the memory map, judged by the AI (Edoardo, 3 Nov 2026: «ho
// visto collegamenti che non mi fanno impazzire»). The map guesses links from
// words in common (brain.rs `graph_in`); here the memory engine looks at each
// note with its candidates — the pages it may be about, the notes that may say
// the same — and says which are real. The verdict is kept by the note's text
// (`brain::note_hash`) in `collegamenti.json` beside MEMORIA.md, and the map
// then draws those links instead of the guesses. Only notes that are new or
// changed are asked again; a few batches per run.
//
// The copy of another PC's memory (memshare.rs) brings that PC's own file when
// it has one; otherwise this PC judges the copy and keeps the verdict beside
// it (`memoria-condivise/<pc>.collegamenti.json`), never inside the copy.
//
// Nothing is written into the notes or the pages: the file only says what the
// map draws. Any engine works (JSON answer, no tools).

use crate::brain;
use crate::claude::Chat;
use crate::i18n::{t, tf};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;

pub const FILE: &str = "collegamenti.json";
/// Notes asked in one turn, and turns in one run.
const BATCH: usize = 30;
const MAX_TURNS: usize = 6;

static RUNNING: AtomicBool = AtomicBool::new(false);

/// What the AI said about one note: the pages (slugs) and notes (hashes) it belongs with.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Verdict {
    #[serde(default)]
    pub pages: Vec<String>,
    #[serde(default)]
    pub notes: Vec<String>,
}

#[derive(Default, Serialize, Deserialize)]
struct Store {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    notes: HashMap<String, Verdict>,
}

/// The file for `dir`: its own, or for a copy the one kept beside it.
fn file_for(dir: &Path) -> PathBuf {
    let own = dir.join(FILE);
    if own.exists() {
        return own;
    }
    beside(dir)
}

/// Beside a copy: «memoria-condivise/<pc>.collegamenti.json».
fn beside(dir: &Path) -> PathBuf {
    let name = dir.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    dir.with_file_name(format!("{name}.{FILE}"))
}

fn read(path: &Path) -> Store {
    std::fs::read_to_string(path).ok().and_then(|t| serde_json::from_str(&t).ok()).unwrap_or_default()
}

/// The verdicts for the memory in `dir`, by note hash.
pub fn load(dir: &Path) -> HashMap<String, Verdict> {
    read(&file_for(dir)).notes
}

/// Where the verdicts of `source` go: this PC's memory, or beside the copy.
fn target(source: &str) -> (PathBuf, PathBuf) {
    if source.is_empty() {
        let dir = crate::memory::dir();
        (dir.clone(), dir.join(FILE))
    } else {
        let dir = crate::memshare::copy_dir(source);
        let file = beside(&dir);
        (dir, file)
    }
}

/// «Collega con l'IA»: the notes not judged yet (or changed), a few batches.
/// `source`: "" this PC, or the name of a PC whose copy is here.
pub async fn judge(app: &AppHandle, source: &str) -> Result<String, String> {
    let engine = crate::memory_ai::engine(app);
    if engine.is_empty() {
        return Err(t("Scegli il motore per la memoria in Impostazioni → Chat → Memoria.").into());
    }
    if RUNNING.swap(true, Ordering::SeqCst) {
        return Err(t("Sto già controllando i collegamenti: un attimo.").into());
    }
    let out = judge_with(app, &engine, source).await;
    RUNNING.store(false, Ordering::SeqCst);
    if out.is_ok() {
        use tauri::Emitter;
        let _ = app.emit_to(crate::MEMORY_LABEL, "memory-refresh", ());
    }
    out
}

async fn judge_with(app: &AppHandle, engine: &str, source: &str) -> Result<String, String> {
    let (dir, file) = target(source);
    let mut store = read(&file);
    // The copy's own file (from the other PC) wins: nothing to do here.
    if !source.is_empty() && dir.join(FILE).exists() {
        return Ok(tf("I collegamenti della memoria di {name} li ha già controllati quel PC.", &[("name", &source)]));
    }
    let all = brain::candidates(&dir, &HashSet::new());
    // Notes gone from MEMORIA.md: their verdicts go too.
    let alive: HashSet<String> = all.iter().map(|c| c.hash.clone()).collect();
    store.notes.retain(|h, _| alive.contains(h));
    let todo: Vec<&brain::Candidates> = all.iter().filter(|c| !store.notes.contains_key(&c.hash)).collect();
    if todo.is_empty() {
        save(&file, &mut store)?;
        return Ok(t("Collegamenti già controllati: niente di nuovo.").into());
    }
    let mut done = 0;
    let mut kept = 0;
    let mut failed = None;
    for batch in todo.chunks(BATCH).take(MAX_TURNS) {
        let chat = Chat::default();
        let reply = crate::chat_turn(app, &chat, prompt(batch), None, Some(engine.to_string()), None, false, crate::Channel::Helper, &|_| {}).await;
        if engine == "opencode" {
            crate::opencode::forget(chat.cli_session());
        }
        let text = match reply {
            Ok(r) => r.text,
            Err(e) => {
                failed = Some(e);
                break;
            }
        };
        let Some(answer) = parse(&text) else {
            failed = Some(t("Il motore non ha risposto nel formato chiesto: riprova, o scegli un altro motore.").into());
            break;
        };
        for (i, c) in batch.iter().enumerate() {
            let v = verdict_of(&answer, i + 1, c);
            kept += v.pages.len() + v.notes.len();
            store.notes.insert(c.hash.clone(), v);
            done += 1;
        }
        save(&file, &mut store)?;
    }
    let left = todo.len().saturating_sub(done);
    match (done, failed) {
        (0, Some(e)) => Err(e),
        (_, Some(e)) => Ok(tf("Controllate {n} note ({k} collegamenti tenuti), poi: {err}", &[("n", &done), ("k", &kept), ("err", &e)])),
        (_, None) if left > 0 => Ok(tf("Controllate {n} note, {k} collegamenti tenuti; ne restano {left}: premi ancora «Collega con l'IA».", &[("n", &done), ("k", &kept), ("left", &left)])),
        _ => Ok(tf("Controllate {n} note, {k} collegamenti tenuti.", &[("n", &done), ("k", &kept)])),
    }
}

fn save(file: &Path, store: &mut Store) -> Result<(), String> {
    store.version = 1;
    let text = serde_json::to_string_pretty(store).map_err(|e| e.to_string())?;
    if let Some(parent) = file.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    std::fs::write(file, text).map_err(|e| tf("Non riesco a salvare i collegamenti: {e}", &[("e", &e)]))
}

/// Each note with its numbered candidates; the answer picks numbers.
fn prompt(batch: &[&brain::Candidates]) -> String {
    let mut list = String::new();
    for (i, c) in batch.iter().enumerate() {
        list.push_str(&format!("\nN{}: {}\n", i + 1, one_line(&c.text, 400)));
        for (j, (_, title, summary)) in c.pages.iter().enumerate() {
            let s = if summary.is_empty() { String::new() } else { format!(" — {}", one_line(summary, 160)) };
            list.push_str(&format!("  P{}: {title}{s}\n", j + 1));
        }
        for (j, (_, text)) in c.notes.iter().enumerate() {
            list.push_str(&format!("  A{}: {}\n", j + 1, one_line(text, 200)));
        }
        if c.pages.is_empty() && c.notes.is_empty() {
            list.push_str("  (nessun candidato)\n");
        }
    }
    tf(
        "Sei l'archivista della memoria di EasyIsland. Per ogni nota (N) ci sono le pagine (P) e le altre note (A) a cui potrebbe essere collegata, scelte contando le parole in comune: molte sono sbagliate.
Tieni solo i collegamenti veri: la nota parla proprio di quella pagina (lo stesso cliente, la stessa persona, lo stesso progetto, lo stesso apparecchio) o l'altra nota parla della stessa cosa. Una parola in comune non basta: «server», «backup», «cliente», un nome di città o un mese non collegano niente da soli. Nel dubbio, lascia fuori.
{list}
Rispondi SOLO con un oggetto JSON, senza altro testo: per ogni nota i numeri da tenere, per esempio
{\"N1\":{\"p\":[1],\"a\":[]},\"N2\":{\"p\":[],\"a\":[2]}}
Ogni nota dell'elenco deve esserci, anche con liste vuote.",
        &[("list", &list)],
    )
}

#[derive(Deserialize, Default)]
struct Pick {
    #[serde(default)]
    p: Vec<usize>,
    #[serde(default)]
    a: Vec<usize>,
}

/// The JSON object in the reply (models like to wrap it in ``` or prose).
fn parse(text: &str) -> Option<HashMap<String, Pick>> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    serde_json::from_str(text.get(start..=end)?).ok()
}

/// Note `n` of the batch: the candidates the AI kept (a note it forgot keeps none).
fn verdict_of(answer: &HashMap<String, Pick>, n: usize, c: &brain::Candidates) -> Verdict {
    let Some(pick) = answer.get(&format!("N{n}")) else { return Verdict::default() };
    let mut v = Verdict::default();
    for i in &pick.p {
        if let Some((slug, _, _)) = c.pages.get(i.wrapping_sub(1)) {
            if !v.pages.contains(slug) {
                v.pages.push(slug.clone());
            }
        }
    }
    for i in &pick.a {
        if let Some((hash, _)) = c.notes.get(i.wrapping_sub(1)) {
            if !v.notes.contains(hash) {
                v.notes.push(hash.clone());
            }
        }
    }
    v
}

fn one_line(s: &str, max: usize) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ").chars().take(max).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cand() -> brain::Candidates {
        brain::Candidates {
            hash: "h".into(),
            text: "Lo Studio Rossi rinnova il contratto".into(),
            pages: vec![("studio-rossi".into(), "Studio Rossi".into(), String::new()), ("backup".into(), "Backup".into(), String::new())],
            notes: vec![("x1".into(), "Rossi chiama per il rinnovo".into())],
        }
    }

    #[test]
    fn keeps_only_the_numbers_chosen() {
        let a = parse("Ecco:\n```json\n{\"N1\":{\"p\":[1],\"a\":[1]}}\n```").unwrap();
        let v = verdict_of(&a, 1, &cand());
        assert_eq!(v.pages, vec!["studio-rossi".to_string()]);
        assert_eq!(v.notes, vec!["x1".to_string()]);
        // Numbers out of range, a note missing from the answer: nothing.
        let a = parse("{\"N1\":{\"p\":[0,9],\"a\":[]}}").unwrap();
        assert_eq!(verdict_of(&a, 1, &cand()), Verdict::default());
        assert_eq!(verdict_of(&a, 2, &cand()), Verdict::default());
    }

    #[test]
    fn a_copy_keeps_its_verdicts_beside_it() {
        let dir = Path::new("C:/x/memoria-condivise/lavoro");
        assert_eq!(beside(dir), Path::new("C:/x/memoria-condivise/lavoro.collegamenti.json"));
    }
}
