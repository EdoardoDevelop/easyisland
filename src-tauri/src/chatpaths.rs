// Files and folders named in the chat's replies (asked by Edoardo on 3 Nov
// 2026, docs/idee.md): the reply's paths are checked here — absolute, "~\…",
// relative to the chat's folder (Modalità terminale, preview::resolve_path),
// with an optional ":line" or ":line:col" — and only those that exist become
// links (core/markdown.ts, views/chat.ts). A click shows a file in the
// Anteprima when it can, else opens it; the right-click menu (island.ts
// contextItems) opens, «Scarica» copies it into Downloads, «Apri percorso»
// shows it selected in Explorer. Nothing is written but that copy.
// A network path (UNC, or a drive mapped to a share) is looked at in its own
// thread for at most NET_WAIT: a server that does not answer kept Windows in
// CreateFile for tens of seconds (the island hung, 9 Nov 2026, \\192.168.0.250\c
// in a chat); that server is then skipped for DEAD_FOR.

use crate::i18n::{t, tf};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Component, Path, PathBuf, Prefix};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::AppHandle;

/// Paths looked at per call (a reply rarely names more).
const MAX: usize = 80;
/// How long a network path may take to answer.
const NET_WAIT: Duration = Duration::from_millis(1500);
/// A server that did not answer is not asked again for this long.
const DEAD_FOR: Duration = Duration::from_secs(120);

static DEAD: Mutex<Option<HashMap<String, Instant>>> = Mutex::new(None);

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

fn info(app: &AppHandle, raw: &str, base: Option<&str>) -> PathInfo {
    let (path, line) = split_line(raw.trim());
    // Relative to the folder picked for the conversation, when there is one.
    let resolved = match base {
        Some(b) if std::path::Path::new(path).is_relative() && !path.starts_with('~') => PathBuf::from(b).join(path),
        _ => crate::preview::resolve_path(app, path),
    };
    let kind = kind_of(&resolved);
    PathInfo { path: raw.to_string(), resolved: resolved.to_string_lossy().into_owned(), kind, line }
}

fn local_kind(p: &Path) -> &'static str {
    if p.is_file() {
        "file"
    } else if p.is_dir() {
        "dir"
    } else {
        "missing"
    }
}

/// The server of a network path ("\\server\share\…" → "server", a mapped
/// drive → "Z:"), None for a local one.
fn network_of(p: &Path) -> Option<String> {
    match p.components().next()? {
        Component::Prefix(pre) => match pre.kind() {
            Prefix::UNC(server, _) | Prefix::VerbatimUNC(server, _) => Some(server.to_string_lossy().to_lowercase()),
            Prefix::Disk(d) | Prefix::VerbatimDisk(d) => {
                let letter = (d as char).to_ascii_uppercase();
                remote_drive(letter).then(|| format!("{letter}:"))
            }
            _ => None,
        },
        _ => None,
    }
}

#[cfg(windows)]
fn remote_drive(letter: char) -> bool {
    use windows::core::HSTRING;
    use windows::Win32::Storage::FileSystem::GetDriveTypeW;
    const DRIVE_REMOTE: u32 = 4;
    unsafe { GetDriveTypeW(&HSTRING::from(format!("{letter}:\\"))) == DRIVE_REMOTE }
}

#[cfg(not(windows))]
fn remote_drive(_: char) -> bool {
    false
}

fn kind_of(p: &Path) -> &'static str {
    let Some(server) = network_of(p) else { return local_kind(p) };
    let now = Instant::now();
    {
        let mut dead = DEAD.lock().unwrap_or_else(|e| e.into_inner());
        let dead = dead.get_or_insert_with(HashMap::new);
        dead.retain(|_, at| now.duration_since(*at) < DEAD_FOR);
        if dead.contains_key(&server) {
            return "missing";
        }
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let q = p.to_path_buf();
    std::thread::spawn(move || {
        let _ = tx.send(local_kind(&q));
    });
    match rx.recv_timeout(NET_WAIT) {
        Ok(kind) => kind,
        Err(_) => {
            crate::log::line(format!("chat paths: {server} does not answer, skipped for {} s", DEAD_FOR.as_secs()));
            DEAD.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(HashMap::new).insert(server, now);
            "missing"
        }
    }
}

pub fn infos(app: &AppHandle, paths: &[String], base: Option<&str>) -> Vec<PathInfo> {
    paths.iter().take(MAX).map(|p| info(app, p, base)).collect()
}

/// "open" (its program, or Explorer for a folder), "reveal" (Explorer, selected),
/// "download" (a copy in Downloads, shown selected; returns where).
pub fn act(app: &AppHandle, path: &str, action: &str) -> Result<String, String> {
    let i = info(app, path, None);
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
    use super::{network_of, split_line};
    use std::path::Path;

    #[test]
    fn network_paths_are_told_apart() {
        assert_eq!(network_of(Path::new(r"\\192.168.0.250\c")).as_deref(), Some("192.168.0.250"));
        assert_eq!(network_of(Path::new(r"\\Server\share\a.txt")).as_deref(), Some("server"));
        assert_eq!(network_of(Path::new(r"\\?\UNC\srv\x\y")).as_deref(), Some("srv"));
        assert_eq!(network_of(Path::new(r"C:\Windows")), None);
        assert_eq!(network_of(Path::new(r"src\app.ts")), None);
    }

    /// A server that does not answer costs at most NET_WAIT, then nothing.
    #[test]
    fn a_dead_server_does_not_hold_the_caller() {
        let p = Path::new(r"\\192.0.2.1\c\x.txt");
        let at = std::time::Instant::now();
        assert_eq!(super::kind_of(p), "missing");
        assert!(at.elapsed() < super::NET_WAIT + std::time::Duration::from_millis(500));
        let again = std::time::Instant::now();
        assert_eq!(super::kind_of(p), "missing");
        assert!(again.elapsed() < std::time::Duration::from_millis(50));
    }

    #[test]
    fn lines_split_off_but_not_the_drive() {
        assert_eq!(split_line(r"src\app.ts:42"), (r"src\app.ts", Some(42)));
        assert_eq!(split_line(r"src\app.ts:42:7"), (r"src\app.ts", Some(42)));
        assert_eq!(split_line(r"C:\x\y.md"), (r"C:\x\y.md", None));
        assert_eq!(split_line(r"C:\x\y.md:3"), (r"C:\x\y.md", Some(3)));
        assert_eq!(split_line("a:b"), ("a:b", None));
    }
}
