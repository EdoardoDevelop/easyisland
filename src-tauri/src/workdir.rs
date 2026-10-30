// The work folder ("Cartella di lavoro"): one folder of the user's PC that
// EasyIsland browses and manages, chosen in Impostazioni → Chat or in «File e
// schermo» (`settings.chatFolder`, the same folder "Modalità terminale" works in).
//
// Where it is used (docs/strumenti.md → Cartella di lavoro):
//   * «File e schermo»: a browser under the Vassoio (src/views/workdir.ts):
//     folders open with a double click, and every file or folder can be opened,
//     shown in Explorer, renamed, moved, put in the Vassoio, dragged out, or
//     moved to the Recycle Bin (never deleted for good);
//   * the Vassoio: «Sposta nella cartella di lavoro»;
//   * the chat's engines, through the easyisland tools (`list_work_folder`,
//     `move_to_work_folder` in agent.rs) and, in terminal mode, as their folder;
//   * Telegram: /cartella (telegram.rs).
//
// Every path from the island, the tools or Telegram is relative to the folder
// and checked to stay inside it (`resolve`): `..`, drive letters and links
// out of it are refused.

use std::os::windows::fs::MetadataExt;
use std::path::{Component, Path, PathBuf};
use std::time::SystemTime;

use serde::Serialize;
use tauri::{AppHandle, Manager};

use crate::i18n::{t, tf};

const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;
/// A folder with more entries than this shows the first ones.
const MAX_ENTRIES: usize = 500;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub name: String,
    /// Relative to the work folder, with "/".
    pub rel: String,
    pub dir: bool,
    pub size: u64,
    /// Last change, Unix milliseconds.
    pub at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Listing {
    /// The work folder itself.
    pub root: String,
    /// The folder shown, relative ("" = the work folder).
    pub rel: String,
    /// Folders first, then files, by name.
    pub entries: Vec<Entry>,
    /// More than MAX_ENTRIES: the rest is not listed.
    pub more: bool,
}

/// The work folder, if one is chosen and exists.
pub fn root(app: &AppHandle) -> Option<PathBuf> {
    let shared = app.try_state::<crate::Shared>()?;
    let chosen = shared.settings.lock().unwrap().chat_folder.trim().to_string();
    let p = PathBuf::from(chosen);
    (!p.as_os_str().is_empty() && p.is_dir()).then_some(p)
}

fn need_root(app: &AppHandle) -> Result<PathBuf, String> {
    root(app).ok_or_else(|| t("Nessuna cartella di lavoro: sceglila in «File e schermo» o in Impostazioni → Chat.").to_string())
}

/// `rel` inside the work folder, or an error. The path must exist.
pub fn resolve(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let joined = join(root, rel)?;
    let real = std::fs::canonicalize(&joined).map_err(|_| tf("«{rel}» non c'è nella cartella di lavoro.", &[("rel", &rel)]))?;
    let base = std::fs::canonicalize(root).map_err(|e| e.to_string())?;
    if !real.starts_with(&base) {
        return Err(t("Fuori dalla cartella di lavoro.").into());
    }
    Ok(real)
}

/// `rel` joined to the folder, refusing anything that could leave it.
fn join(root: &Path, rel: &str) -> Result<PathBuf, String> {
    let rel = rel.trim().replace('/', "\\");
    let mut out = root.to_path_buf();
    for c in Path::new(&rel).components() {
        match c {
            Component::Normal(part) => out.push(part),
            Component::CurDir => {}
            _ => return Err(t("Fuori dalla cartella di lavoro.").into()),
        }
    }
    Ok(out)
}

/// The path relative to the folder, with "/".
fn rel_of(base: &Path, path: &Path) -> String {
    path.strip_prefix(base).map(|r| r.to_string_lossy().replace('\\', "/")).unwrap_or_default()
}

/// A file or folder name typed by the user: no separators or Windows' reserved characters.
fn check_name(name: &str) -> Result<String, String> {
    let name = name.trim().trim_end_matches('.').to_string();
    let bad = name.is_empty() || name == "." || name == ".." || name.chars().any(|c| r#"<>:"/\|?*"#.contains(c) || c.is_control());
    if bad {
        return Err(t("Nome non valido: niente / \\ : * ? \" < > |").into());
    }
    Ok(name)
}

fn millis(t: std::io::Result<SystemTime>) -> u64 {
    t.ok().and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis() as u64)
}

pub fn list(app: &AppHandle, rel: &str) -> Result<Listing, String> {
    let root = need_root(app)?;
    list_in(&root, rel)
}

pub fn list_in(root: &Path, rel: &str) -> Result<Listing, String> {
    let dir = resolve(root, rel)?;
    let base = std::fs::canonicalize(root).map_err(|e| e.to_string())?;
    if !dir.is_dir() {
        return Err(tf("«{rel}» non è una cartella.", &[("rel", &rel)]));
    }
    let mut entries: Vec<Entry> = std::fs::read_dir(&dir)
        .map_err(|e| tf("Cartella non leggibile: {e}", &[("e", &e)]))?
        .flatten()
        .filter_map(|e| {
            let meta = e.metadata().ok()?;
            if meta.file_attributes() & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM) != 0 {
                return None;
            }
            let path = e.path();
            Some(Entry {
                name: e.file_name().to_string_lossy().to_string(),
                rel: rel_of(&base, &path),
                dir: meta.is_dir(),
                size: if meta.is_dir() { 0 } else { meta.len() },
                at: millis(meta.modified()),
            })
        })
        .collect();
    entries.sort_by(|a, b| b.dir.cmp(&a.dir).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    let more = entries.len() > MAX_ENTRIES;
    entries.truncate(MAX_ENTRIES);
    Ok(Listing { root: base.to_string_lossy().trim_start_matches(r"\\?\").to_string(), rel: rel_of(&base, &dir), entries, more })
}

/// The full path of an entry, for opening, dragging, sending.
pub fn path_of(app: &AppHandle, rel: &str) -> Result<PathBuf, String> {
    let root = need_root(app)?;
    resolve(&root, rel).map(strip_verbatim)
}

/// `\\?\C:\…` (from canonicalize) back to `C:\…`, which every program understands.
fn strip_verbatim(p: PathBuf) -> PathBuf {
    let s = p.to_string_lossy();
    match s.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with("UNC\\") => PathBuf::from(rest),
        _ => p,
    }
}

pub fn rename(app: &AppHandle, rel: &str, name: &str) -> Result<String, String> {
    let root = need_root(app)?;
    let from = resolve(&root, rel)?;
    if from == std::fs::canonicalize(&root).map_err(|e| e.to_string())? {
        return Err(t("La cartella di lavoro si cambia, non si rinomina da qui.").into());
    }
    let name = check_name(name)?;
    let to = from.parent().ok_or(t("Fuori dalla cartella di lavoro."))?.join(&name);
    if to.exists() && !same_name_other_case(&from, &to) {
        return Err(tf("C'è già «{name}».", &[("name", &name)]));
    }
    std::fs::rename(&from, &to).map_err(|e| tf("Non rinominato: {e}", &[("e", &e)]))?;
    Ok(name)
}

/// "foto.JPG" → "foto.jpg" is the same file on Windows, and allowed.
fn same_name_other_case(a: &Path, b: &Path) -> bool {
    a.to_string_lossy().to_lowercase() == b.to_string_lossy().to_lowercase()
}

pub fn mkdir(app: &AppHandle, parent: &str, name: &str) -> Result<String, String> {
    let root = need_root(app)?;
    let dir = resolve(&root, parent)?;
    let name = check_name(name)?;
    let target = dir.join(&name);
    if target.exists() {
        return Err(tf("C'è già «{name}».", &[("name", &name)]));
    }
    std::fs::create_dir(&target).map_err(|e| tf("Cartella non creata: {e}", &[("e", &e)]))?;
    let base = std::fs::canonicalize(&root).map_err(|e| e.to_string())?;
    Ok(rel_of(&base, &target))
}

/// Moves an entry into another folder of the work folder (same name, or "nome (2)").
pub fn move_entry(app: &AppHandle, rel: &str, dest: &str) -> Result<String, String> {
    let root = need_root(app)?;
    let from = resolve(&root, rel)?;
    let into = resolve(&root, dest)?;
    if !into.is_dir() {
        return Err(tf("«{rel}» non è una cartella.", &[("rel", &dest)]));
    }
    if into.starts_with(&from) {
        return Err(t("Una cartella non può andare dentro sé stessa.").into());
    }
    let name = from.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let to = crate::files::unique_dest(&into, &name);
    std::fs::rename(&from, &to).map_err(|e| tf("Non spostato: {e}", &[("e", &e)]))?;
    let base = std::fs::canonicalize(&root).map_err(|e| e.to_string())?;
    Ok(rel_of(&base, &to))
}

/// A file of the Vassoio into a folder of the work folder: moved (it leaves the
/// Vassoio) or copied. Returns where it went, relative.
pub fn from_inbox(app: &AppHandle, name: &str, dest: &str, copy: bool) -> Result<String, String> {
    let root = need_root(app)?;
    let src = crate::files::inbox_path(name)?;
    let into = resolve(&root, dest)?;
    if !into.is_dir() {
        return Err(tf("«{rel}» non è una cartella.", &[("rel", &dest)]));
    }
    let to = crate::files::unique_dest(&into, name);
    if copy {
        std::fs::copy(&src, &to).map_err(|e| tf("copia non riuscita: {e}", &[("e", &e)]))?;
    } else if std::fs::rename(&src, &to).is_err() {
        // Another drive: copy, then take it out of the Vassoio.
        std::fs::copy(&src, &to).map_err(|e| tf("copia non riuscita: {e}", &[("e", &e)]))?;
        let _ = crate::files::delete_from_inbox(name);
    }
    if !copy {
        let _ = crate::files::set_kept(name, false);
    }
    let base = std::fs::canonicalize(&root).map_err(|e| e.to_string())?;
    Ok(rel_of(&base, &to))
}

/// A file of the work folder copied into the Vassoio.
pub fn to_inbox(app: &AppHandle, rel: &str) -> Result<crate::files::DroppedFile, String> {
    let path = path_of(app, rel)?;
    if path.is_dir() {
        return Err(t("Solo file, non cartelle (comprimile prima in uno ZIP).").into());
    }
    crate::files::ingest(&path.to_string_lossy())
}

/// To the Recycle Bin, never deleted for good: Explorer's own "Elimina".
pub fn trash(app: &AppHandle, rel: &str) -> Result<(), String> {
    let root = need_root(app)?;
    let path = resolve(&root, rel)?;
    if path == std::fs::canonicalize(&root).map_err(|e| e.to_string())? {
        return Err(t("La cartella di lavoro non si cestina da qui.").into());
    }
    recycle(&strip_verbatim(path))
}

fn recycle(path: &Path) -> Result<(), String> {
    use windows::core::PCWSTR;
    use windows::Win32::UI::Shell::{SHFileOperationW, FOF_ALLOWUNDO, FOF_NOCONFIRMATION, FOF_NOERRORUI, FOF_SILENT, FO_DELETE, SHFILEOPSTRUCTW};
    // A list of paths, each ending in 0, the list in another 0.
    let mut from: Vec<u16> = path.as_os_str().to_string_lossy().encode_utf16().collect();
    from.extend([0, 0]);
    let mut op = SHFILEOPSTRUCTW {
        wFunc: FO_DELETE,
        pFrom: PCWSTR(from.as_ptr()),
        fFlags: (FOF_ALLOWUNDO | FOF_NOCONFIRMATION | FOF_SILENT | FOF_NOERRORUI).0 as u16,
        ..Default::default()
    };
    let code = unsafe { SHFileOperationW(&mut op) };
    if code != 0 || op.fAnyOperationsAborted.as_bool() {
        return Err(tf("Non spostato nel Cestino (codice {code}).", &[("code", &code)]));
    }
    Ok(())
}

/// Windows' "Seleziona cartella" dialog; None when cancelled.
pub fn pick_folder(start: Option<String>) -> Result<Option<String>, String> {
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{FileOpenDialog, IFileOpenDialog, IShellItem, SHCreateItemFromParsingName, FOS_FORCEFILESYSTEM, FOS_PICKFOLDERS, SIGDN_FILESYSPATH};
    unsafe {
        let init = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let result = (|| -> windows::core::Result<Option<String>> {
            let dialog: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)?;
            dialog.SetOptions(dialog.GetOptions()? | FOS_PICKFOLDERS | FOS_FORCEFILESYSTEM)?;
            let title: Vec<u16> = t("Scegli la cartella di lavoro").encode_utf16().chain([0]).collect();
            dialog.SetTitle(windows::core::PCWSTR(title.as_ptr()))?;
            if let Some(start) = start.filter(|s| Path::new(s).is_dir()) {
                let wide: Vec<u16> = start.encode_utf16().chain([0]).collect();
                if let Ok(item) = SHCreateItemFromParsingName::<_, _, IShellItem>(windows::core::PCWSTR(wide.as_ptr()), None) {
                    let _ = dialog.SetFolder(&item);
                }
            }
            if dialog.Show(None).is_err() {
                return Ok(None); // cancelled
            }
            let item = dialog.GetResult()?;
            let name = item.GetDisplayName(SIGDN_FILESYSPATH)?;
            let path = name.to_string().unwrap_or_default();
            CoTaskMemFree(Some(name.0 as *const _));
            Ok(Some(path))
        })();
        if init.is_ok() {
            CoUninitialize();
        }
        result.map_err(|e| e.message().to_string())
    }
}

/// Windows' open dialog for the chat's 📎: several files, or several folders; empty when cancelled.
pub fn pick_paths(folders: bool) -> Result<Vec<String>, String> {
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
    use windows::Win32::UI::Shell::{FileOpenDialog, IFileOpenDialog, FOS_ALLOWMULTISELECT, FOS_FORCEFILESYSTEM, FOS_PICKFOLDERS, SIGDN_FILESYSPATH};
    unsafe {
        let init = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let result = (|| -> windows::core::Result<Vec<String>> {
            let dialog: IFileOpenDialog = CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER)?;
            let mut options = dialog.GetOptions()? | FOS_FORCEFILESYSTEM | FOS_ALLOWMULTISELECT;
            if folders {
                options |= FOS_PICKFOLDERS;
            }
            dialog.SetOptions(options)?;
            let title: Vec<u16> = if folders { t("Allega cartelle alla chat") } else { t("Allega file alla chat") }.encode_utf16().chain([0]).collect();
            dialog.SetTitle(windows::core::PCWSTR(title.as_ptr()))?;
            if dialog.Show(None).is_err() {
                return Ok(Vec::new()); // cancelled
            }
            let items = dialog.GetResults()?;
            let mut out = Vec::new();
            for i in 0..items.GetCount()? {
                let item = items.GetItemAt(i)?;
                let name = item.GetDisplayName(SIGDN_FILESYSPATH)?;
                out.push(name.to_string().unwrap_or_default());
                CoTaskMemFree(Some(name.0 as *const _));
            }
            Ok(out)
        })();
        if init.is_ok() {
            CoUninitialize();
        }
        result.map_err(|e| e.message().to_string())
    }
}

/// A short text listing for the tools and Telegram: "📁 nome/" and "nome (12 KB)".
pub fn describe(l: &Listing) -> String {
    let mut out = String::new();
    let here = if l.rel.is_empty() { l.root.clone() } else { format!("{}\\{}", l.root, l.rel.replace('/', "\\")) };
    out.push_str(&tf("Cartella: {path}", &[("path", &here)]));
    out.push('\n');
    if l.entries.is_empty() {
        out.push_str(t("(vuota)"));
    }
    for e in &l.entries {
        if e.dir {
            out.push_str(&format!("📁 {}/\n", e.rel));
        } else {
            out.push_str(&format!("{} ({} KB)\n", e.rel, e.size.div_ceil(1024)));
        }
    }
    if l.more {
        out.push_str(&tf("… e altri: mostrati i primi {n}.", &[("n", &MAX_ENTRIES)]));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp() -> PathBuf {
        // One folder per test: they run in parallel.
        static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let n = N.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
        let d = std::env::temp_dir().join(format!("easyisland-workdir-{}-{n}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(d.join("sotto")).unwrap();
        std::fs::write(d.join("a.txt"), "ciao").unwrap();
        std::fs::write(d.join("sotto").join("b.txt"), "x").unwrap();
        d
    }

    #[test]
    fn paths_never_leave_the_folder() {
        let d = temp();
        assert!(resolve(&d, "sotto/b.txt").is_ok());
        assert!(resolve(&d, "").is_ok());
        assert!(resolve(&d, "../").is_err());
        assert!(resolve(&d, "sotto/../../x").is_err());
        assert!(resolve(&d, "C:\\Windows").is_err());
        assert!(resolve(&d, "\\Windows").is_err());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn folders_come_first_and_paths_are_relative() {
        let d = temp();
        let l = list_in(&d, "").unwrap();
        let names: Vec<&str> = l.entries.iter().map(|e| e.rel.as_str()).collect();
        assert_eq!(names, vec!["sotto", "a.txt"]);
        let inner = list_in(&d, "sotto").unwrap();
        assert_eq!(inner.rel, "sotto");
        assert_eq!(inner.entries[0].rel, "sotto/b.txt");
        assert!(describe(&l).contains("📁 sotto/"));
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn names_are_checked() {
        assert!(check_name("relazione.docx").is_ok());
        assert!(check_name("a/b").is_err());
        assert!(check_name("..").is_err());
        assert!(check_name("  ").is_err());
        assert_eq!(check_name("nota. ").unwrap(), "nota");
    }
}
