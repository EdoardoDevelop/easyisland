// «⟲ File» under a question of the chat (Modalità terminale): the files
// Claude Code changed from that question on go back to how they were, as
// Claude Desktop's rewind does (8 Nov 2026).
//
// Each turn of a conversation is a checkpoint: before Edit / Write / MultiEdit
// / NotebookEdit touch a file for the first time in that turn, its bytes are
// kept here (or that it did not exist). Going back to a question restores, for
// every file changed from that turn on, what it was before the earliest of
// them, and deletes the files those turns created. As in Claude Desktop, what
// a command did (Bash, PowerShell) is not tracked. In memory only, as long as
// EasyIsland runs; the list asks before anything is written (`changed_since`).

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use crate::i18n::tf;

/// A file kept whole up to this size; a bigger one is not restored.
const MAX_FILE: u64 = 10 * 1024 * 1024;
/// Files kept per conversation, in all its turns.
const MAX_FILES: usize = 400;

struct Turn {
    /// Lines of the conversation before its question (chat_log::line_count).
    at: usize,
    /// Each file as it was before the turn first touched it; None = it did not exist.
    files: Vec<(PathBuf, Option<Vec<u8>>)>,
}

#[derive(Default)]
struct Book {
    turns: Vec<Turn>,
}

/// By conversation (the `Chat`'s address, as claude_cli keeps its processes).
static BOOKS: Mutex<Option<HashMap<usize, Book>>> = Mutex::new(None);

fn with<R>(f: impl FnOnce(&mut HashMap<usize, Book>) -> R) -> R {
    let mut g = BOOKS.lock().unwrap();
    f(g.get_or_insert_with(HashMap::new))
}

/// A turn of the conversation `chat` starts, after `at` lines.
pub fn begin(chat: usize, at: usize) {
    with(|all| {
        let book = all.entry(chat).or_default();
        // Back to an earlier point (Modifica, Rigenera): the turns after it are gone.
        book.turns.retain(|t| t.at < at);
        book.turns.push(Turn { at, files: Vec::new() });
    });
}

/// Claude Code is about to change `path` in the turn running for `chat`.
pub fn touching(chat: usize, path: &std::path::Path) {
    let path = path.to_path_buf();
    with(|all| {
        let Some(book) = all.get_mut(&chat) else { return };
        let total: usize = book.turns.iter().map(|t| t.files.len()).sum();
        let Some(turn) = book.turns.last_mut() else { return };
        if total >= MAX_FILES || turn.files.iter().any(|(p, _)| same(p, &path)) {
            return;
        }
        let before = match std::fs::metadata(&path) {
            Ok(m) if m.len() > MAX_FILE => return,
            Ok(_) => match std::fs::read(&path) {
                Ok(b) => Some(b),
                Err(_) => return,
            },
            Err(_) => None,
        };
        turn.files.push((path, before));
    });
}

fn same(a: &std::path::Path, b: &std::path::Path) -> bool {
    a.to_string_lossy().replace('/', "\\").eq_ignore_ascii_case(&b.to_string_lossy().replace('/', "\\"))
}

/// What going back to the question after `at` lines would restore, each file
/// as it was before the earliest of those turns.
fn plan(chat: usize, at: usize) -> Vec<(PathBuf, Option<Vec<u8>>)> {
    with(|all| {
        let mut out: Vec<(PathBuf, Option<Vec<u8>>)> = Vec::new();
        for turn in all.get(&chat).into_iter().flat_map(|b| b.turns.iter()).filter(|t| t.at >= at) {
            for (p, before) in &turn.files {
                if !out.iter().any(|(q, _)| same(q, p)) {
                    out.push((p.clone(), before.clone()));
                }
            }
        }
        out
    })
}

/// The files that would change, for the question's confirmation:
/// (path, true when it would be deleted because those turns created it).
pub fn changed_since(chat: usize, at: usize) -> Vec<(String, bool)> {
    plan(chat, at).into_iter().map(|(p, b)| (p.display().to_string(), b.is_none())).collect()
}

/// Back: every file as it was before the question after `at` lines.
pub fn restore(chat: usize, at: usize) -> Result<usize, String> {
    let files = plan(chat, at);
    let mut done = 0;
    let mut failed: Vec<String> = Vec::new();
    for (p, before) in &files {
        let ok = match before {
            Some(bytes) => std::fs::write(p, bytes).is_ok(),
            None => !p.exists() || std::fs::remove_file(p).is_ok(),
        };
        if ok {
            done += 1;
        } else {
            failed.push(p.display().to_string());
        }
    }
    // Those turns are gone: the next one starts from here.
    with(|all| {
        if let Some(book) = all.get_mut(&chat) {
            book.turns.retain(|t| t.at < at);
        }
    });
    crate::log::line(format!("file ripristinati: {done} di {}", files.len()));
    if failed.is_empty() {
        Ok(done)
    } else {
        Err(tf("Non riesco a ripristinare: {files}", &[("files", &failed.join(", "))]))
    }
}

/// The conversation closed or started over: its checkpoints go.
pub fn forget(chat: usize) {
    with(|all| {
        all.remove(&chat);
    });
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
        // Turn 1 (after 0 lines): a changes.
        begin(chat, 0);
        touching(chat, &a);
        std::fs::write(&a, "due").unwrap();
        // Turn 2 (after 2 lines): a changes again, b is created.
        begin(chat, 2);
        touching(chat, &a);
        std::fs::write(&a, "tre").unwrap();
        touching(chat, &b);
        std::fs::write(&b, "nuovo").unwrap();
        let list = changed_since(chat, 2);
        assert_eq!(list.len(), 2);
        assert!(list.iter().any(|(p, del)| p.ends_with("b.txt") && *del));
        assert_eq!(restore(chat, 2).unwrap(), 2);
        assert_eq!(std::fs::read_to_string(&a).unwrap(), "due");
        assert!(!b.exists());
        // From the first question: a as it was at the start.
        assert_eq!(restore(chat, 0).unwrap(), 1);
        assert_eq!(std::fs::read_to_string(&a).unwrap(), "uno");
        forget(chat);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
