// Dropped files are copied into %LOCALAPPDATA%\EasyIsland\inbox so the original is
// never touched and the copy survives the drag source going away.
//
// The inbox is the island's tray ("Vassoio"): temporary. It is emptied every
// time EasyIsland starts (so after a restart of the PC too), and by hand, one
// file or all of them. A file of the tray can be dragged out into another app
// (`drag_out`).

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Serialize;

use crate::settings;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DroppedFile {
    pub name: String,
    pub path: String,
    pub size: u64,
}

pub fn inbox_dir() -> PathBuf {
    settings::local_dir().join("inbox")
}

pub fn ingest(source: &str) -> Result<DroppedFile, String> {
    let src = Path::new(source);
    let meta = std::fs::metadata(src).map_err(|e| format!("impossibile leggere {source}: {e}"))?;
    if meta.is_dir() {
        return Err("Le cartelle non si possono ancora rilasciare.".into());
    }

    let dir = inbox_dir();
    // Dragged from the tray back onto the island: it is already here.
    if in_dir(src, &dir) {
        return Ok(DroppedFile {
            name: src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "file".into()),
            path: src.to_string_lossy().to_string(),
            size: meta.len(),
        });
    }
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let name = src
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "file".into());

    let dest = unique_dest(&dir, &name);
    std::fs::copy(src, &dest).map_err(|e| format!("copia non riuscita: {e}"))?;
    // CopyFileEx carries the source's timestamps across, so a file last edited
    // three years ago would arrive already older than the sweep window and be
    // listed by its date as if dropped long ago. The tray sorts by when *we* copied it.
    if let Ok(file) = std::fs::File::options().write(true).open(&dest) {
        let _ = file.set_modified(SystemTime::now());
    }

    Ok(DroppedFile {
        name,
        path: dest.to_string_lossy().to_string(),
        size: meta.len(),
    })
}

/// `name` in `dir`, or "name (2).ext", "name (3).ext"… when it is taken.
fn unique_dest(dir: &Path, name: &str) -> PathBuf {
    let dest = dir.join(name);
    if !dest.exists() {
        return dest;
    }
    let p = Path::new(name);
    let stem = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = p.extension().map(|s| format!(".{}", s.to_string_lossy())).unwrap_or_default();
    (2..1000)
        .map(|i| dir.join(format!("{stem} ({i}){ext}")))
        .find(|c| !c.exists())
        .unwrap_or(dest)
}

/// A file made by EasyIsland itself (a screenshot, a picture from the clipboard)
/// lands in the inbox like a dropped one, so the chat and the tray ("Vassoio") see it.
pub fn save_new(name: &str, bytes: &[u8]) -> Result<DroppedFile, String> {
    let dir = inbox_dir();
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let dest = unique_dest(&dir, name);
    std::fs::write(&dest, bytes).map_err(|e| format!("salvataggio non riuscito: {e}"))?;
    Ok(DroppedFile {
        name: dest.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| name.to_string()),
        path: dest.to_string_lossy().to_string(),
        size: bytes.len() as u64,
    })
}

/// True when `path` is a file directly inside `dir` (paths compared without case, as Windows does).
fn in_dir(path: &Path, dir: &Path) -> bool {
    let norm = |p: &Path| std::fs::canonicalize(p).map(|c| c.to_string_lossy().to_lowercase()).unwrap_or_default();
    match path.parent() {
        Some(parent) => !norm(dir).is_empty() && norm(parent) == norm(dir),
        None => false,
    }
}

/// Drags `path` out of the island into another app (a mail, Teams, Explorer),
/// as a copy. Runs on the window's thread: Windows' own drag loop, with the
/// shell's data object and drop source, so nothing of ours has to be a COM object.
pub fn drag_out(hwnd: windows::Win32::Foundation::HWND, path: &Path) -> Result<(), String> {
    use windows::core::HSTRING;
    use windows::Win32::System::Com::{IBindCtx, IDataObject};
    use windows::Win32::System::Ole::{IDropSource, OleInitialize, OleUninitialize, DROPEFFECT_COPY};
    use windows::Win32::UI::Shell::{IShellItem, SHCreateItemFromParsingName, SHDoDragDrop, BHID_DataObject};
    unsafe {
        // Already initialised on the window's thread (S_FALSE) in practice; balanced either way.
        let ole = OleInitialize(None).is_ok();
        let result = (|| -> windows::core::Result<()> {
            let item: IShellItem = SHCreateItemFromParsingName(&HSTRING::from(path.as_os_str()), None::<&IBindCtx>)?;
            let data: IDataObject = item.BindToHandler(None::<&IBindCtx>, &BHID_DataObject)?;
            SHDoDragDrop(Some(hwnd), &data, None::<&IDropSource>, DROPEFFECT_COPY).map(|_| ())
        })();
        if ole {
            OleUninitialize();
        }
        result.map_err(|e| format!("Trascinamento non riuscito: {}", e.message()))
    }
}

// ── The tray (the "Vassoio" view) ───────────────────────────────────────────

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InboxFile {
    pub name: String,
    pub path: String,
    pub size: u64,
    /// When it was dropped (the copy is stamped then), ms since 1970.
    pub at: u64,
}

/// Every copy in the inbox, newest first.
pub fn list_inbox() -> Vec<InboxFile> {
    let Ok(entries) = std::fs::read_dir(inbox_dir()) else { return Vec::new() };
    let mut out: Vec<InboxFile> = entries
        .flatten()
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            if !meta.is_file() {
                return None;
            }
            let at = meta
                .modified()
                .ok()?
                .duration_since(SystemTime::UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            Some(InboxFile {
                name: e.file_name().to_string_lossy().to_string(),
                path: e.path().to_string_lossy().to_string(),
                size: meta.len(),
                at,
            })
        })
        .collect();
    out.sort_by(|a, b| b.at.cmp(&a.at));
    out
}

/// A file of the inbox by name. Only a bare name is accepted, so nothing
/// outside the inbox can ever be reached.
pub fn inbox_path(name: &str) -> Result<PathBuf, String> {
    let bare = Path::new(name).file_name().map(|n| n.to_string_lossy().to_string());
    if bare.as_deref() != Some(name) || name.is_empty() || name == "." || name == ".." {
        return Err("Nome di file non valido".into());
    }
    let path = inbox_dir().join(name);
    if !path.is_file() {
        return Err("Il file non c'è più".into());
    }
    Ok(path)
}

/// Deletes one copy (the original the user dropped is never touched).
pub fn delete_from_inbox(name: &str) -> Result<(), String> {
    std::fs::remove_file(inbox_path(name)?).map_err(|e| format!("Eliminazione non riuscita: {e}"))
}

/// Deletes every copy; returns how many went.
pub fn clear_inbox() -> usize {
    list_inbox()
        .into_iter()
        .filter(|f| std::fs::remove_file(&f.path).is_ok())
        .count()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn inbox_names_cannot_leave_the_inbox() {
        for bad in ["", ".", "..", r"..\settings.json", "../x", r"C:\Windows\win.ini", "sub/a.txt"] {
            assert!(inbox_path(bad).is_err(), "{bad} was accepted");
        }
    }

    #[test]
    fn ingest_copies_and_never_overwrites() {
        let tmp = std::env::temp_dir().join(format!("easyisland-test-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();
        let source = tmp.join("note.txt");
        std::fs::write(&source, b"hello").unwrap();

        let first = ingest(source.to_str().unwrap()).unwrap();
        assert_eq!(first.name, "note.txt");
        assert_eq!(std::fs::read(&first.path).unwrap(), b"hello");

        // A second drop of the same name must not clobber the first copy.
        std::fs::write(&source, b"second").unwrap();
        let second = ingest(source.to_str().unwrap()).unwrap();
        assert_ne!(first.path, second.path);
        assert_eq!(std::fs::read(&first.path).unwrap(), b"hello");
        assert_eq!(std::fs::read(&second.path).unwrap(), b"second");

        // Folders are refused rather than silently ignored.
        assert!(ingest(tmp.to_str().unwrap()).is_err());

        // An ancient source is listed by when it was dropped, not by its own date.
        let old_source = tmp.join("ancient.txt");
        std::fs::write(&old_source, b"old").unwrap();
        let long_ago = SystemTime::now() - std::time::Duration::from_secs(30 * 24 * 60 * 60);
        std::fs::File::options()
            .write(true)
            .open(&old_source)
            .unwrap()
            .set_modified(long_ago)
            .unwrap();
        let aged = ingest(old_source.to_str().unwrap()).unwrap();
        let stamped = std::fs::metadata(&aged.path).unwrap().modified().unwrap();
        assert!(SystemTime::now().duration_since(stamped).unwrap().as_secs() < 60, "the copy keeps the source's date");

        // Dragged from the tray back onto the island: no second copy.
        let again = ingest(&aged.path).unwrap();
        assert_eq!(again.path, aged.path);
        let _ = std::fs::remove_file(&aged.path);

        let _ = std::fs::remove_file(&first.path);
        let _ = std::fs::remove_file(&second.path);
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
