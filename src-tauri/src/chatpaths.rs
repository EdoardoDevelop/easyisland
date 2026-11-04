// Files and folders named in the chat's replies (asked by Edoardo on 3 Nov
// 2026, docs/idee.md): the reply's paths are checked here — absolute, "~\…",
// relative to the chat's folder (Modalità terminale, preview::resolve_path),
// with an optional ":line" or ":line:col" — and only those that exist become
// links (core/markdown.ts, views/chat.ts). A click shows a file in the
// Anteprima when it can, else opens it; the right-click menu (island.ts
// contextItems) opens, «Scarica» copies it into Downloads, «Apri percorso»
// shows it selected in Explorer. Nothing is written but that copy.

use crate::i18n::{t, tf};
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::AppHandle;

/// Paths looked at per call (a reply rarely names more).
const MAX: usize = 80;

#[derive(Serialize)]
pub struct PathInfo {
    /// As written in the reply.
    pub path: String,
    /// Absolute, without the line.
    pub resolved: String,
    /// "file", "dir" or "missing".
    pub kind: &'static str,
    pub line: Option<u32>,
}

/// "src\app.ts:42:7" → ("src\app.ts", Some(42)); "C:\x" stays whole (the drive's colon).
fn split_line(s: &str) -> (&str, Option<u32>) {
    let mut path = s;
    let mut line = None;
    for _ in 0..2 {
        let Some((head, tail)) = path.rsplit_once(':') else { break };
        if tail.is_empty() || !tail.chars().all(|c| c.is_ascii_digit()) || head.len() < 2 {
            break;
        }
        line = tail.parse().ok().or(line);
        path = head;
    }
    (path, line)
}

fn info(app: &AppHandle, raw: &str) -> PathInfo {
    let (path, line) = split_line(raw.trim());
    let resolved = crate::preview::resolve_path(app, path);
    let kind = if resolved.is_file() {
        "file"
    } else if resolved.is_dir() {
        "dir"
    } else {
        "missing"
    };
    PathInfo { path: raw.to_string(), resolved: resolved.to_string_lossy().into_owned(), kind, line }
}

pub fn infos(app: &AppHandle, paths: &[String]) -> Vec<PathInfo> {
    paths.iter().take(MAX).map(|p| info(app, p)).collect()
}

/// "open" (its program, or Explorer for a folder), "reveal" (Explorer, selected),
/// "download" (a copy in Downloads, shown selected; returns where).
pub fn act(app: &AppHandle, path: &str, action: &str) -> Result<String, String> {
    let i = info(app, path);
    let p = PathBuf::from(&i.resolved);
    if i.kind == "missing" {
        return Err(tf("«{p}» non c'è più.", &[("p", &i.resolved)]));
    }
    match action {
        "open" => crate::actions::shell_open(&i.resolved).map(|_| i.resolved.clone()).map_err(|_| tf("Non riesco ad aprire «{p}».", &[("p", &i.resolved)])),
        "reveal" => crate::reveal_in_explorer(&p).map(|_| i.resolved.clone()).map_err(|e| e.to_string()),
        "download" => {
            if i.kind != "file" {
                return Err(t("Si scaricano solo i file, non le cartelle.").into());
            }
            let dir = crate::downloads::downloads_dir().ok_or_else(|| t("Cartella Download non trovata.").to_string())?;
            let to = free_name(&dir, &p);
            std::fs::copy(&p, &to).map_err(|e| tf("Copia non riuscita: {e}", &[("e", &e.to_string())]))?;
            let _ = crate::reveal_in_explorer(&to);
            Ok(to.to_string_lossy().into_owned())
        }
        _ => Err("action".into()),
    }
}

/// "report.pdf", else "report (2).pdf", "report (3).pdf"…
fn free_name(dir: &Path, file: &Path) -> PathBuf {
    let name = file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "file".into());
    let first = dir.join(&name);
    if !first.exists() {
        return first;
    }
    let stem = file.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_else(|| name.clone());
    let ext = file.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (2..1000).map(|n| dir.join(format!("{stem} ({n}){ext}"))).find(|p| !p.exists()).unwrap_or(first)
}

#[cfg(test)]
mod tests {
    use super::split_line;

    #[test]
    fn lines_split_off_but_not_the_drive() {
        assert_eq!(split_line(r"src\app.ts:42"), (r"src\app.ts", Some(42)));
        assert_eq!(split_line(r"src\app.ts:42:7"), (r"src\app.ts", Some(42)));
        assert_eq!(split_line(r"C:\x\y.md"), (r"C:\x\y.md", None));
        assert_eq!(split_line(r"C:\x\y.md:3"), (r"C:\x\y.md", Some(3)));
        assert_eq!(split_line("a:b"), ("a:b", None));
    }
}
