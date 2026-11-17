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
    let path = path.trim_end_matches(['.', ',', ';', ':']);
    let tried = candidates(path, base, crate::workdir::root(app), std::env::var_os("USERPROFILE").map(PathBuf::from), || crate::preview::resolve_path(app, path));
    // The first that is there; none: the first, shown as missing.
    let found = tried.iter().map(|p| (p, kind_of(p))).find(|(_, k)| *k != "missing");
    let (resolved, kind) = match found {
        Some((p, k)) => (p.clone(), k),
        None => (tried.first().cloned().unwrap_or_default(), "missing"),
    };
    PathInfo { path: raw.to_string(), resolved: resolved.to_string_lossy().into_owned(), kind, line }
}

/// Where a path of a reply may be, in order. Absolute or «~\…»: itself.
/// Relative: the chat's folder, the work folder (Impostazioni → Chat), each
/// with its two parents, then the user's folder (17 Nov 2026: «WORK\Cardinalini\…»
/// was relative to the folder above the chat's «…\WORK», and the chat had none:
/// no link, no Apri, no Copia).
fn candidates(path: &str, base: Option<&str>, work: Option<PathBuf>, home: Option<PathBuf>, plain: impl FnOnce() -> PathBuf) -> Vec<PathBuf> {
    if !Path::new(path).is_relative() || path.starts_with('~') {
        return vec![plain()];
    }
    let mut out: Vec<PathBuf> = Vec::new();
    let mut add = |dir: &Path| {
        for d in dir.ancestors().take(3) {
            let p = d.join(path);
            if !out.contains(&p) {
                out.push(p);
            }
        }
    };
    if let Some(b) = base.filter(|b| !b.trim().is_empty()) {
        add(Path::new(b));
    }
    if let Some(w) = work {
        add(&w);
    }
    if let Some(h) = home {
        let p = h.join(path);
        if !out.contains(&p) {
            out.push(p);
        }
    }
    if out.is_empty() {
        out.push(plain());
    }
    out
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
    use super::{candidates, network_of, split_line};
    use std::path::{Path, PathBuf};

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
    fn relative_paths_are_looked_for_in_the_folders_of_the_chat() {
        let dir = std::env::temp_dir().join(format!("ei-paths-{}", std::process::id()));
        let file = dir.join("WORK").join("Cardinalini").join("export.sh");
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, "echo").unwrap();
        // The chat in «…\WORK», the path starting from the folder above it.
        let work = dir.join("WORK");
        let tried = candidates("WORK\\Cardinalini\\export.sh", None, Some(work.clone()), None, PathBuf::new);
        assert_eq!(tried.first(), Some(&work.join("WORK\\Cardinalini\\export.sh")));
        assert!(tried.contains(&dir.join("WORK\\Cardinalini\\export.sh")));
        assert_eq!(tried.iter().find(|p| p.is_file()), Some(&dir.join("WORK\\Cardinalini\\export.sh")));
        // The chat's own folder first, then the work folder, then home.
        let t = candidates("a.txt", Some("C:\\x\\y"), Some(PathBuf::from("D:\\w")), Some(PathBuf::from("C:\\Users\\e")), PathBuf::new);
        assert_eq!(t[0], PathBuf::from("C:\\x\\y\\a.txt"));
        assert!(t.iter().position(|p| p == &PathBuf::from("D:\\w\\a.txt")) < t.iter().position(|p| p == &PathBuf::from("C:\\Users\\e\\a.txt")));
        // Absolute: itself.
        assert_eq!(candidates("C:\\a\\b.txt", Some("D:\\x"), None, None, || PathBuf::from("C:\\a\\b.txt")), vec![PathBuf::from("C:\\a\\b.txt")]);
        let _ = std::fs::remove_dir_all(&dir);
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
