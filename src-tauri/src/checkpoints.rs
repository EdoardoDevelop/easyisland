// «⟲ File» under a question of the chat (Modalità terminale): the files
// Claude Code changed from that question on go back to how they were, as
// Claude Desktop's rewind does (8 Nov 2026).
//
// Each turn of a conversation is a checkpoint: before Edit / Write / MultiEdit
// / NotebookEdit touch a file for the first time in that turn, its bytes are
// kept (or that it did not exist). Going back to a question restores, for
// every file changed from that turn on, what it was before the earliest of
// them, and deletes the files those turns created. As in Claude Desktop, what
// a command did (Bash, PowerShell) is not tracked.
//
// Kept on disk by conversation of the history, as Claude Desktop keeps its
// own: `%LOCALAPPDATA%\EasyIsland\punti\<conversation>\` (`indice.json`, one
// `.bin` per file), so they outlive a restart and a conversation reopened has
// them. Deleted with the conversation, and after 30 days. Without the history
// (Impostazioni → Chat → Cronologia off) in memory only.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::i18n::tf;

/// A file kept whole up to this size; a bigger one is not restored.
const MAX_FILE: u64 = 10 * 1024 * 1024;
/// Files kept per conversation, in all its turns.
const MAX_FILES: usize = 400;
/// Checkpoints of conversations untouched this long go at the start.
const KEEP_DAYS: u64 = 30;

#[derive(Clone, Serialize, Deserialize)]
struct Saved {
    path: PathBuf,
    /// The `.bin` with its bytes before the turn; None = it did not exist.
    blob: Option<String>,
}

#[derive(Clone, Serialize, Deserialize)]
struct Turn {
    /// Lines of the conversation before its question (chat_log::line_count).
    at: usize,
    files: Vec<Saved>,
}

#[derive(Default)]
struct Book {
    turns: Vec<Turn>,
    /// Bytes of the books kept in memory only (no history), by blob name.
    memory: HashMap<String, Vec<u8>>,
    loaded: bool,
}

struct State {
    books: HashMap<String, Book>,
    /// The conversation each running chat writes to (its `Chat`'s address → key).
    current: HashMap<usize, String>,
}

static STATE: Mutex<Option<State>> = Mutex::new(None);

fn with<R>(f: impl FnOnce(&mut State) -> R) -> R {
    let mut g = STATE.lock().unwrap();
    f(g.get_or_insert_with(|| State { books: HashMap::new(), current: HashMap::new() }))
}

fn root() -> PathBuf {
    crate::settings::local_dir().join("punti")
}

/// A conversation's key: its id in the history, or "mem-…" kept in memory only.
pub fn key(chat: usize, log_id: Option<String>) -> String {
    log_id.filter(|id| id.chars().all(|c| c.is_ascii_alphanumeric())).unwrap_or_else(|| format!("mem-{chat:x}"))
}

fn on_disk(key: &str) -> bool {
    !key.starts_with("mem-")
}

fn book<'a>(st: &'a mut State, key: &str) -> &'a mut Book {
    let b = st.books.entry(key.to_string()).or_default();
    if !b.loaded {
        b.loaded = true;
        if on_disk(key) {
            if let Some(turns) = std::fs::read(root().join(key).join("indice.json")).ok().and_then(|t| serde_json::from_slice::<Vec<Turn>>(&t).ok()) {
                b.turns = turns;
            }
        }
    }
    b
}

fn save_index(key: &str, b: &Book) {
    if !on_disk(key) {
        return;
    }
    let dir = root().join(key);
    let _ = std::fs::create_dir_all(&dir);
    if let Ok(json) = serde_json::to_vec(&b.turns) {
        let _ = std::fs::write(dir.join("indice.json"), json);
    }
}

/// A turn of the conversation starts, after `at` lines; `chat` writes to `key`.
pub fn begin(chat: usize, key: &str, at: usize) {
    with(|st| {
        st.current.insert(chat, key.to_string());
        let b = book(st, key);
        // Back to an earlier point (Modifica, Rigenera): the turns after it are gone.
        b.turns.retain(|t| t.at < at);
        b.turns.push(Turn { at, files: Vec::new() });
        save_index(key, b);
    });
}

/// Claude Code is about to change `path` in the turn running for `chat`.
pub fn touching(chat: usize, path: &Path) {
    with(|st| {
        let Some(key) = st.current.get(&chat).cloned() else { return };
        let b = book(st, &key);
        let total: usize = b.turns.iter().map(|t| t.files.len()).sum();
        let n = b.turns.len();
        let Some(turn) = b.turns.last_mut() else { return };
        if total >= MAX_FILES || turn.files.iter().any(|f| same(&f.path, path)) {
            return;
        }
        let bytes = match std::fs::metadata(path) {
            Ok(m) if m.len() > MAX_FILE => return,
            Ok(_) => match std::fs::read(path) {
                Ok(b) => Some(b),
                Err(_) => return,
            },
            Err(_) => None,
        };
        let blob = bytes.as_ref().map(|_| format!("{n}-{}.bin", turn.files.len()));
        if let (Some(name), Some(data)) = (&blob, bytes) {
            if on_disk(&key) {
                let dir = root().join(&key);
                let _ = std::fs::create_dir_all(&dir);
                if std::fs::write(dir.join(name), &data).is_err() {
                    return;
                }
            } else {
                b.memory.insert(name.clone(), data);
            }
        }
        if let Some(turn) = b.turns.last_mut() {
            turn.files.push(Saved { path: path.to_path_buf(), blob });
        }
        save_index(&key, b);
    });
}

fn same(a: &Path, b: &Path) -> bool {
    a.to_string_lossy().replace('/', "\\").eq_ignore_ascii_case(&b.to_string_lossy().replace('/', "\\"))
}

/// Going back to the question after `at` lines: each file as it was before the
/// earliest of those turns.
fn plan(key: &str, at: usize) -> Vec<Saved> {
    with(|st| {
        let b = book(st, key);
        let mut out: Vec<Saved> = Vec::new();
        for turn in b.turns.iter().filter(|t| t.at >= at) {
            for f in &turn.files {
                if !out.iter().any(|g| same(&g.path, &f.path)) {
                    out.push(f.clone());
                }
            }
        }
        out
    })
}

/// The files that would change, for the question's confirmation:
/// (path, true when it would be deleted because those turns created it).
pub fn changed_since(key: &str, at: usize) -> Vec<(String, bool)> {
    plan(key, at).into_iter().map(|f| (f.path.display().to_string(), f.blob.is_none())).collect()
}

/// Back: every file as it was before the question after `at` lines.
pub fn restore(key: &str, at: usize) -> Result<usize, String> {
    let files = plan(key, at);
    let mut done = 0;
    let mut failed: Vec<String> = Vec::new();
    for f in &files {
        let bytes = f.blob.as_ref().map(|name| {
            if on_disk(key) {
                std::fs::read(root().join(key).join(name)).ok()
            } else {
                with(|st| book(st, key).memory.get(name).cloned())
            }
        });
        let ok = match bytes {
            Some(Some(data)) => std::fs::write(&f.path, data).is_ok(),
            // Its copy is gone: left as it is.
            Some(None) => false,
            None => !f.path.exists() || std::fs::remove_file(&f.path).is_ok(),
        };
        if ok {
            done += 1;
        } else {
            failed.push(f.path.display().to_string());
        }
    }
    // Those turns are gone: the next one starts from here.
    with(|st| {
        let b = book(st, key);
        b.turns.retain(|t| t.at < at);
        save_index(key, b);
    });
    crate::log::line(format!("file ripristinati: {done} di {}", files.len()));
    if failed.is_empty() {
        Ok(done)
    } else {
        Err(tf("Non riesco a ripristinare: {files}", &[("files", &failed.join(", "))]))
    }
}

/// The chat closed: what it kept in memory goes (what is on disk stays with its conversation).
pub fn forget(chat: usize) {
    with(|st| {
        if let Some(key) = st.current.remove(&chat) {
            if !on_disk(&key) {
                st.books.remove(&key);
            }
        }
    });
}

/// The conversation deleted from the history (or the history emptied: None).
pub fn delete(id: Option<&str>) {
    with(|st| match id {
        Some(id) => {
            st.books.remove(id);
            if id.chars().all(|c| c.is_ascii_alphanumeric()) && !id.is_empty() {
                let _ = std::fs::remove_dir_all(root().join(id));
            }
        }
        None => {
            st.books.retain(|k, _| !on_disk(k));
            let _ = std::fs::remove_dir_all(root());
        }
    });
}

/// At the start: checkpoints of conversations left alone for 30 days go.
pub fn prune() {
    let limit = std::time::SystemTime::now() - std::time::Duration::from_secs(KEEP_DAYS * 86_400);
    for d in std::fs::read_dir(root()).into_iter().flatten().flatten() {
        let old = std::fs::metadata(d.path().join("indice.json")).and_then(|m| m.modified()).map(|m| m < limit).unwrap_or(true);
        if old {
            let _ = std::fs::remove_dir_all(d.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn back_to_a_question_restores_and_deletes_what_came_after() {
        let dir = std::env::temp_dir().join(format!("ei-ckpt-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let a = dir.join("a.txt");
        let b = dir.join("b.txt");
        std::fs::write(&a, "uno").unwrap();
        let chat = 7usize;
        // Without the history: in memory.
        let k = key(chat, None);
        // Turn 1 (after 0 lines): a changes.
        begin(chat, &k, 0);
        touching(chat, &a);
        std::fs::write(&a, "due").unwrap();
        // Turn 2 (after 2 lines): a changes again, b is created.
        begin(chat, &k, 2);
        touching(chat, &a);
        std::fs::write(&a, "tre").unwrap();
        touching(chat, &b);
        std::fs::write(&b, "nuovo").unwrap();
        let list = changed_since(&k, 2);
        assert_eq!(list.len(), 2);
        assert!(list.iter().any(|(p, del)| p.ends_with("b.txt") && *del));
        assert_eq!(restore(&k, 2).unwrap(), 2);
        assert_eq!(std::fs::read_to_string(&a).unwrap(), "due");
        assert!(!b.exists());
        // From the first question: a as it was at the start.
        assert_eq!(restore(&k, 0).unwrap(), 1);
        assert_eq!(std::fs::read_to_string(&a).unwrap(), "uno");
        forget(chat);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
