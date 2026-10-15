// "Download finito": a new file in the Downloads folder that stops growing →
// a card with Apri, Mostra nella cartella and the file actions (moments.rs).
//
// One thread sleeps in ReadDirectoryChangesW (no polling while nothing
// happens). A name that appears there (created, or renamed from a browser's
// .crdownload / .part) becomes a candidate; a second thread looks at the
// candidates once a second, only while there are some, and announces each one
// when its size has stopped changing and nobody holds it open for writing.
// Browsers' own temporary files, hidden files and folders are never announced.

use std::collections::HashMap;
use std::os::windows::ffi::OsStrExt;
use std::os::windows::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::sync::{Condvar, Mutex};
use std::time::{Duration, Instant};

use serde_json::json;
use tauri::{AppHandle, Manager};
use windows::core::PCWSTR;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::Storage::FileSystem::{
    CreateFileW, ReadDirectoryChangesW, FILE_ACTION, FILE_ACTION_ADDED, FILE_ACTION_MODIFIED, FILE_ACTION_REMOVED,
    FILE_ACTION_RENAMED_NEW_NAME, FILE_ACTION_RENAMED_OLD_NAME, FILE_FLAG_BACKUP_SEMANTICS, FILE_LIST_DIRECTORY,
    FILE_NOTIFY_CHANGE_FILE_NAME, FILE_NOTIFY_CHANGE_LAST_WRITE, FILE_NOTIFY_CHANGE_SIZE, FILE_SHARE_DELETE,
    FILE_SHARE_READ, FILE_SHARE_WRITE, OPEN_EXISTING,
};

/// Quiet for this long after the last change before the size is looked at.
const SETTLE: Duration = Duration::from_millis(1500);
/// A candidate that never settles (a stuck download) is forgotten after this.
const GIVE_UP: Duration = Duration::from_secs(30 * 60);
/// The same file is not announced twice within this.
const AGAIN: Duration = Duration::from_secs(60);

/// Suffixes of files browsers and download managers write while downloading.
const PARTIAL: &[&str] = &[
    ".crdownload", ".part", ".partial", ".download", ".tmp", ".temp", ".opdownload", ".!ut", ".bc!", ".aria2",
    ".filepart", ".sync", ".dtapart",
];

#[derive(Debug, Clone)]
struct Candidate {
    since: Instant,
    last_event: Instant,
    size: Option<u64>,
    stable_since: Instant,
    /// Renamed from a browser's partial file: the download is complete already.
    finished: bool,
}

static CANDIDATES: Mutex<Option<HashMap<PathBuf, Candidate>>> = Mutex::new(None);
static WAKE: Condvar = Condvar::new();

/// A browser's temporary file, or something nobody downloads.
pub fn is_partial(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower.starts_with("~$")
        || lower.starts_with('.')
        || lower.starts_with("unconfirmed ")
        || lower == "desktop.ini"
        || lower.ends_with(".lnk")
        || PARTIAL.iter().any(|s| lower.ends_with(s))
}

/// The user's Downloads folder (it may have been moved to another drive).
fn downloads_dir() -> Option<PathBuf> {
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::{FOLDERID_Downloads, SHGetKnownFolderPath, KF_FLAG_DEFAULT};
    unsafe {
        let p = SHGetKnownFolderPath(&FOLDERID_Downloads, KF_FLAG_DEFAULT, None).ok()?;
        let path = p.to_string().ok().map(PathBuf::from);
        CoTaskMemFree(Some(p.0 as _));
        path.filter(|d| d.is_dir())
    }
}

fn enabled(app: &AppHandle) -> bool {
    app.try_state::<crate::Shared>().is_some_and(|s| s.settings.lock().unwrap().moment_downloads)
}

/// One change seen by the watcher.
fn on_change(path: PathBuf, action: FILE_ACTION, from_partial: bool) {
    let mut guard = CANDIDATES.lock().unwrap();
    let map = guard.get_or_insert_with(HashMap::new);
    let now = Instant::now();
    match action {
        FILE_ACTION_REMOVED | FILE_ACTION_RENAMED_OLD_NAME => {
            map.remove(&path);
        }
        FILE_ACTION_ADDED | FILE_ACTION_RENAMED_NEW_NAME => {
            let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
            if is_partial(&name) {
                return;
            }
            let finished = action == FILE_ACTION_RENAMED_NEW_NAME && from_partial;
            map.insert(path, Candidate { since: now, last_event: now, size: None, stable_since: now, finished });
            WAKE.notify_all();
        }
        FILE_ACTION_MODIFIED => {
            // Only files that appeared while we watch: editing an old file is not a download.
            if let Some(c) = map.get_mut(&path) {
                c.last_event = now;
            }
        }
        _ => {}
    }
}

/// Nobody is writing it: it opens with others allowed only to read.
fn not_being_written(path: &Path) -> bool {
    std::fs::OpenOptions::new().read(true).share_mode(FILE_SHARE_READ.0).open(path).is_ok()
}

/// What to do with a candidate now. `None` = keep waiting.
enum Verdict {
    Wait,
    Drop,
    Ready(u64),
}

fn judge(path: &Path, c: &mut Candidate, now: Instant) -> Verdict {
    if now.duration_since(c.since) > GIVE_UP {
        return Verdict::Drop;
    }
    if now.duration_since(c.last_event) < if c.finished { Duration::from_millis(400) } else { SETTLE } {
        return Verdict::Wait;
    }
    let Ok(meta) = std::fs::metadata(path) else { return Verdict::Drop };
    // Hidden or system files (thumbnail caches, sync tools' own files), folders.
    if meta.is_dir() || meta.file_attributes() & 0x6 != 0 {
        return Verdict::Drop;
    }
    let len = meta.len();
    if len == 0 {
        // Firefox's placeholder, or a file still being created: wait for the real one.
        return Verdict::Wait;
    }
    if c.size != Some(len) {
        c.size = Some(len);
        c.stable_since = now;
        if !c.finished {
            return Verdict::Wait;
        }
    }
    if !c.finished && now.duration_since(c.stable_since) < SETTLE {
        return Verdict::Wait;
    }
    if !not_being_written(path) {
        return Verdict::Wait;
    }
    Verdict::Ready(len)
}

fn settle_loop(app: AppHandle) {
    let mut announced: HashMap<PathBuf, Instant> = HashMap::new();
    loop {
        {
            let mut guard = CANDIDATES.lock().unwrap();
            while guard.as_ref().is_none_or(|m| m.is_empty()) {
                guard = WAKE.wait(guard).unwrap();
            }
        }
        std::thread::sleep(Duration::from_secs(1));
        let now = Instant::now();
        let list: Vec<(PathBuf, Candidate)> =
            CANDIDATES.lock().unwrap().as_ref().map(|m| m.iter().map(|(p, c)| (p.clone(), c.clone())).collect()).unwrap_or_default();
        for (path, mut c) in list {
            let verdict = judge(&path, &mut c, now);
            let mut guard = CANDIDATES.lock().unwrap();
            let Some(map) = guard.as_mut() else { continue };
            // A newer event replaced it meanwhile: next round.
            if map.get(&path).is_none_or(|cur| cur.last_event != c.last_event) {
                continue;
            }
            match verdict {
                Verdict::Wait => {
                    map.insert(path, c);
                }
                Verdict::Drop => {
                    map.remove(&path);
                }
                Verdict::Ready(size) => {
                    map.remove(&path);
                    drop(guard);
                    announced.retain(|_, t| now.duration_since(*t) < AGAIN);
                    if announced.contains_key(&path) || !enabled(&app) {
                        continue;
                    }
                    announced.insert(path.clone(), now);
                    let name = path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
                    crate::log::line(format!("download finito ({} KB)", size / 1024));
                    crate::automations::on_event("download", &name, "", &crate::automations::file_ctx(&path));
                    crate::moments::emit(&app, json!({
                        "kind": "download",
                        "name": name,
                        "path": path.to_string_lossy(),
                        "size": size,
                    }));
                }
            }
        }
    }
}

/// The file names in one buffer of FILE_NOTIFY_INFORMATION records.
fn parse(buf: &[u8]) -> Vec<(FILE_ACTION, String)> {
    let mut out = Vec::new();
    let mut at = 0usize;
    loop {
        let Some(head) = buf.get(at..at + 12) else { break };
        let next = u32::from_ne_bytes([head[0], head[1], head[2], head[3]]) as usize;
        let action = FILE_ACTION(u32::from_ne_bytes([head[4], head[5], head[6], head[7]]));
        let len = u32::from_ne_bytes([head[8], head[9], head[10], head[11]]) as usize;
        let Some(name) = buf.get(at + 12..at + 12 + len) else { break };
        let wide: Vec<u16> = name.chunks_exact(2).map(|c| u16::from_ne_bytes([c[0], c[1]])).collect();
        out.push((action, String::from_utf16_lossy(&wide)));
        if next == 0 {
            break;
        }
        at += next;
    }
    out
}

fn watch(dir: &Path) {
    let wide: Vec<u16> = dir.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let handle = match unsafe {
        CreateFileW(
            PCWSTR(wide.as_ptr()),
            FILE_LIST_DIRECTORY.0,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            None,
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            None,
        )
    } {
        Ok(h) => h,
        Err(e) => {
            crate::log::line(format!("download: cartella non osservabile: {e}"));
            return;
        }
    };
    // DWORD-aligned, as ReadDirectoryChangesW wants.
    let mut buf = vec![0u32; 16 * 1024];
    let mut last_old: Option<String> = None;
    loop {
        let mut got = 0u32;
        let ok = unsafe {
            ReadDirectoryChangesW(
                handle,
                buf.as_mut_ptr().cast(),
                (buf.len() * 4) as u32,
                false,
                FILE_NOTIFY_CHANGE_FILE_NAME | FILE_NOTIFY_CHANGE_SIZE | FILE_NOTIFY_CHANGE_LAST_WRITE,
                Some(&mut got),
                None,
                None,
            )
        };
        if let Err(e) = ok {
            crate::log::line(format!("download: osservazione finita: {e}"));
            break;
        }
        // 0 bytes: too many changes at once for the buffer; the next ones still come.
        let bytes: &[u8] = unsafe { std::slice::from_raw_parts(buf.as_ptr().cast(), (got as usize).min(buf.len() * 4)) };
        for (action, name) in parse(bytes) {
            let from_partial = action == FILE_ACTION_RENAMED_NEW_NAME && last_old.as_deref().is_some_and(is_partial);
            last_old = (action == FILE_ACTION_RENAMED_OLD_NAME).then(|| name.clone());
            on_change(dir.join(&name), action, from_partial);
        }
    }
    unsafe {
        let _ = CloseHandle(handle);
    }
}

pub fn spawn(app: AppHandle) {
    let Some(dir) = downloads_dir() else {
        crate::log::line("download: cartella Download non trovata".to_string());
        return;
    };
    let settle_app = app.clone();
    std::thread::spawn(move || settle_loop(settle_app));
    std::thread::spawn(move || watch(&dir));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn partial_files_are_not_downloads() {
        for n in ["a.pdf.crdownload", "Unconfirmed 1234.crdownload", "x.zip.part", "~$doc.docx", ".DS_Store", "desktop.ini", "film.mkv.!ut"] {
            assert!(is_partial(n), "{n}");
        }
        for n in ["fattura.pdf", "setup.exe", "foto (1).JPG", "archivio.tar.gz"] {
            assert!(!is_partial(n), "{n}");
        }
    }

    #[test]
    fn parses_records_and_stops_at_a_short_buffer() {
        let rec = |next: u32, action: u32, name: &str| {
            let wide: Vec<u8> = name.encode_utf16().flat_map(|c| c.to_ne_bytes()).collect();
            let mut v = Vec::new();
            v.extend(next.to_ne_bytes());
            v.extend(action.to_ne_bytes());
            v.extend((wide.len() as u32).to_ne_bytes());
            v.extend(wide);
            while v.len() % 4 != 0 {
                v.push(0);
            }
            v
        };
        // "a.crdownload": 12 bytes of header + 24 of name.
        let mut buf = rec(36, 4, "a.crdownload");
        assert_eq!(buf.len(), 36);
        buf.extend(rec(0, 5, "àè.pdf"));
        let got = parse(&buf);
        assert_eq!(got, vec![(FILE_ACTION(4), "a.crdownload".into()), (FILE_ACTION(5), "àè.pdf".into())]);
        // Cut in the middle of the second record: the first only, no panic.
        assert_eq!(parse(&buf[..40]).len(), 1);
        assert!(parse(&[]).is_empty());
        assert!(parse(&[1, 2, 3]).is_empty());
    }

    #[test]
    fn a_file_is_ready_when_it_stops_growing() {
        let dir = std::env::temp_dir().join(format!("easyisland-dl-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("file.bin");
        std::fs::write(&path, b"12345").unwrap();
        let t0 = Instant::now() - Duration::from_secs(10);
        let mut c = Candidate { since: t0, last_event: t0, size: None, stable_since: t0, finished: false };
        let now = Instant::now();
        assert!(matches!(judge(&path, &mut c, now), Verdict::Wait), "first look: size noted");
        assert!(matches!(judge(&path, &mut c, now + SETTLE), Verdict::Ready(5)));
        // Renamed from a .crdownload: ready at the first look.
        let mut c = Candidate { since: t0, last_event: t0, size: None, stable_since: t0, finished: true };
        assert!(matches!(judge(&path, &mut c, now), Verdict::Ready(5)));
        // Held open for writing by someone else: wait.
        let held = std::fs::OpenOptions::new().write(true).share_mode(FILE_SHARE_READ.0 | FILE_SHARE_WRITE.0).open(&path).unwrap();
        let mut c = Candidate { since: t0, last_event: t0, size: Some(5), stable_since: t0, finished: false };
        assert!(matches!(judge(&path, &mut c, now), Verdict::Wait));
        drop(held);
        assert!(matches!(judge(&path, &mut c, now), Verdict::Ready(5)));
        std::fs::remove_file(&path).unwrap();
        assert!(matches!(judge(&path, &mut c, now), Verdict::Drop));
        let _ = std::fs::remove_dir_all(&dir);
    }
}
