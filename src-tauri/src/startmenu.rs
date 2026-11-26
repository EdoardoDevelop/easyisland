// The «EasyIsland» folder in Windows' Start menu (26 Nov 2026, Edoardo: «crei
// in start di windows la classica cartella del programma ed all'interno tutte
// le integrazioni»): EasyIsland, its settings, the chat and every integration
// that is on, the user's own included. Each shortcut starts easyisland.exe
// with `--do "integrazione:<id>"`, which opens that integration in a window of
// its own, apart from the island (lib.rs single instance, island.ts onHotkey),
// also when EasyIsland was not running yet (BootInfo.launch).
//
// Icons are drawn by the island (the integration's logo or emoji) and arrive
// as PNGs; each is kept as a .ico (a PNG inside an ICO header) in
// %LOCALAPPDATA%\EasyIsland\start. The shortcuts made here are listed in
// start-menu.json there, so only those are ever removed: the installer's own
// shortcut stays the installer's. Impostazioni → Integrazioni can turn it off.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use serde::Deserialize;
use windows::core::{Interface, HSTRING};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, STGM_READ};
use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

use crate::i18n::t;

/// One integration for the menu, from the island.
#[derive(Debug, Clone, Deserialize)]
pub struct Item {
    /// Task id: "integration_weather", "custom:clienti", "chat".
    pub id: String,
    pub name: String,
    /// Its icon, a PNG as base64 (no `data:` prefix); empty = EasyIsland's.
    #[serde(default)]
    pub png: String,
}

/// %APPDATA%\Microsoft\Windows\Start Menu\Programs
fn programs_dir() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|a| PathBuf::from(a).join("Microsoft").join("Windows").join("Start Menu").join("Programs"))
}

fn folder() -> Option<PathBuf> {
    programs_dir().map(|p| p.join("EasyIsland"))
}

fn icons_dir() -> PathBuf {
    crate::settings::local_dir().join("start")
}

/// What was made here: shortcut file name → id. Only these are ever removed.
fn made_file() -> PathBuf {
    crate::settings::local_dir().join("start-menu.json")
}

fn read_made() -> BTreeMap<String, String> {
    std::fs::read(made_file()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

/// A shortcut's file name from what the user calls it: no characters Windows
/// refuses, not empty, not too long.
pub fn file_name(name: &str) -> String {
    let clean: String = name
        .chars()
        .map(|c| if r#"\/:*?"<>|"#.contains(c) || c.is_control() { ' ' } else { c })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    let clean: String = clean.trim_end_matches('.').chars().take(80).collect();
    format!("{}.lnk", if clean.is_empty() { "EasyIsland".to_string() } else { clean })
}

/// A PNG as a Windows icon: the ICO header with one 256-pixel entry around it.
pub fn ico_of(png: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(png.len() + 22);
    out.extend([0u8, 0, 1, 0, 1, 0]);
    // 0 = 256 wide and high, no palette, 1 plane, 32 bits.
    out.extend([0u8, 0, 0, 0, 1, 0, 32, 0]);
    out.extend((png.len() as u32).to_le_bytes());
    out.extend(22u32.to_le_bytes());
    out.extend(png);
    out
}

/// Makes the folder match `items` (or empties what was made here, `on` false).
/// Returns how many integrations are in it.
pub fn sync(items: &[Item], on: bool) -> Result<usize, String> {
    let dir = folder().ok_or("APPDATA non trovata")?;
    let exe = local_path(&std::env::current_exe().map_err(|e| e.to_string())?);
    let mut made = read_made();
    // The shortcuts wanted now: file name → (id, arguments, description, icon).
    let mut want: BTreeMap<String, (String, String, String, Option<PathBuf>)> = BTreeMap::new();
    if on {
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        std::fs::create_dir_all(icons_dir()).map_err(|e| e.to_string())?;
        want.insert("EasyIsland.lnk".into(), ("app".into(), String::new(), t("Apri EasyIsland").into(), None));
        want.insert(file_name(t("Impostazioni di EasyIsland")), ("settings".into(), "--settings".into(), t("Impostazioni di EasyIsland").into(), None));
        for it in items {
            let mut name = file_name(&it.name);
            if want.contains_key(&name) {
                name = file_name(&format!("{} ({})", it.name, it.id));
            }
            let icon = crate::backup::base64_decode(&it.png).filter(|b| b.starts_with(b"\x89PNG")).and_then(|png| {
                let safe: String = it.id.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).collect();
                let path = icons_dir().join(format!("{safe}.ico"));
                let bytes = ico_of(&png);
                if std::fs::read(&path).ok().as_deref() != Some(bytes.as_slice()) {
                    std::fs::write(&path, &bytes).ok()?;
                }
                Some(path)
            });
            let args = format!("--do \"integrazione:{}\"", it.id.replace('"', ""));
            want.insert(name, (it.id.clone(), args, crate::i18n::tf("{name} in una finestra di EasyIsland", &[("name", &it.name)]), icon));
        }
    }
    // Gone: what was made here and is not wanted any more (the app's own
    // shortcut stays: it may have taken the installer's place).
    for (file, id) in made.clone() {
        if !want.contains_key(&file) && id != "app" {
            let _ = std::fs::remove_file(dir.join(&file));
            made.remove(&file);
        }
    }
    let wanted = want.len();
    unsafe {
        let init = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        for (file, (id, args, desc, icon)) in &want {
            let path = dir.join(file);
            // The installer's own shortcut for the app stays as it is.
            if id == "app" && path.exists() && !made.contains_key(file) {
                continue;
            }
            match write_link(&path, &exe, args, desc, icon.as_deref()) {
                Ok(()) => {
                    made.insert(file.clone(), id.clone());
                }
                Err(e) => crate::log::line(format!("menu Start: {file}: {e}")),
            }
        }
        // The installer's shortcut outside the folder (before it had one): one is enough.
        if on {
            if let Some(top) = programs_dir().map(|p| p.join("EasyIsland.lnk")) {
                if top.exists() && points_to(&top, &exe) {
                    let _ = std::fs::remove_file(&top);
                }
            }
        }
        if init.is_ok() {
            CoUninitialize();
        }
    }
    if let Ok(bytes) = serde_json::to_vec_pretty(&made) {
        let _ = crate::settings::write_atomic(&made_file(), &bytes);
    }
    // An empty folder of ours goes too.
    if !on {
        let _ = std::fs::remove_dir(&dir);
    }
    Ok(wanted.saturating_sub(2))
}

/// The Launcher (settings.rs `launcher`) starts from an icon on the desktop
/// too (Edoardo, 26 Nov 2026): «EasyIsland» there when none is. Never removed
/// (it may be the installer's or one the user moved), never written over.
pub fn desktop_icon() {
    use windows::Win32::System::Com::CoTaskMemFree;
    use windows::Win32::UI::Shell::{FOLDERID_Desktop, SHGetKnownFolderPath, KF_FLAG_DEFAULT};
    std::thread::spawn(|| {
        let desk = unsafe {
            let Ok(p) = SHGetKnownFolderPath(&FOLDERID_Desktop, KF_FLAG_DEFAULT, None) else { return };
            let path = p.to_string().ok().map(PathBuf::from);
            CoTaskMemFree(Some(p.0 as _));
            path
        };
        let Some(link) = desk.filter(|d| d.is_dir()).map(|d| d.join("EasyIsland.lnk")) else { return };
        if link.exists() {
            return;
        }
        let Ok(exe) = std::env::current_exe().map(|e| local_path(&e)) else { return };
        unsafe {
            let init = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            match write_link(&link, &exe, "", t("Apri EasyIsland"), None) {
                Ok(()) => crate::log::line("Launcher: icona sul desktop"),
                Err(e) => crate::log::line(format!("Launcher: icona sul desktop non creata: {e}")),
            }
            if init.is_ok() {
                CoUninitialize();
            }
        }
    });
}

unsafe fn write_link(path: &Path, exe: &Path, args: &str, desc: &str, icon: Option<&Path>) -> windows::core::Result<()> {
    unsafe {
        let link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
        link.SetPath(&HSTRING::from(exe.as_os_str()))?;
        link.SetArguments(&HSTRING::from(args))?;
        link.SetDescription(&HSTRING::from(desc))?;
        if let Some(dir) = exe.parent() {
            link.SetWorkingDirectory(&HSTRING::from(dir.as_os_str()))?;
        }
        match icon {
            Some(ico) => link.SetIconLocation(&HSTRING::from(ico.as_os_str()), 0)?,
            None => link.SetIconLocation(&HSTRING::from(exe.as_os_str()), 0)?,
        }
        link.cast::<IPersistFile>()?.Save(&HSTRING::from(path.as_os_str()), true)
    }
}

/// The shortcut opens this very program.
unsafe fn points_to(link: &Path, exe: &Path) -> bool {
    unsafe {
        let Ok(l) = CoCreateInstance::<_, IShellLinkW>(&ShellLink, None, CLSCTX_INPROC_SERVER) else { return false };
        let Ok(file) = l.cast::<IPersistFile>() else { return false };
        if file.Load(&HSTRING::from(link.as_os_str()), STGM_READ).is_err() {
            return false;
        }
        let mut buf = [0u16; 1024];
        if l.GetPath(&mut buf, std::ptr::null_mut(), 0).is_err() {
            return false;
        }
        let end = buf.iter().position(|&u| u == 0).unwrap_or(buf.len());
        let target = String::from_utf16_lossy(buf.get(..end).unwrap_or_default());
        target.eq_ignore_ascii_case(&exe.to_string_lossy())
    }
}

/// The program's path as a shortcut should hold it: `\\localhost\C$\…` (started
/// from a share of this very PC) and `\\?\C:\…` become `C:\…`.
pub fn local_path(p: &Path) -> PathBuf {
    let s = p.to_string_lossy();
    for host in [r"\\localhost\", r"\\127.0.0.1\"] {
        let Some(head) = s.get(..host.len()) else { continue };
        if !head.eq_ignore_ascii_case(host) {
            continue;
        }
        let rest = s.get(host.len()..).unwrap_or_default();
        let mut c = rest.chars();
        if let (Some(d), Some('$')) = (c.next(), c.next()) {
            if d.is_ascii_alphabetic() {
                return PathBuf::from(format!("{}:{}", d.to_ascii_uppercase(), rest.get(2..).unwrap_or_default()));
            }
        }
    }
    match s.strip_prefix(r"\\?\") {
        Some(rest) if rest.get(1..2) == Some(":") => PathBuf::from(rest),
        _ => p.to_path_buf(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_and_icons_are_safe() {
        assert_eq!(file_name("Meteo"), "Meteo.lnk");
        assert_eq!(file_name("Clienti: DDT / ordini?"), "Clienti DDT ordini.lnk");
        assert_eq!(file_name("  "), "EasyIsland.lnk");
        assert_eq!(file_name("Fine."), "Fine.lnk");
        let ico = ico_of(b"\x89PNGxxxx");
        assert_eq!(ico.get(..6), Some(&[0u8, 0, 1, 0, 1, 0][..]));
        assert_eq!(ico.get(14..18), Some(&8u32.to_le_bytes()[..]));
        assert_eq!(ico.get(18..22), Some(&22u32.to_le_bytes()[..]));
        assert_eq!(ico.len(), 30);
        let p = |s: &str| local_path(Path::new(s)).to_string_lossy().to_string();
        assert_eq!(p(r"\\localhost\C$\Users\Me\AppData\Local\EasyIsland\easyisland.exe"), r"C:\Users\Me\AppData\Local\EasyIsland\easyisland.exe");
        assert_eq!(p(r"\\LOCALHOST\d$\x\e.exe"), r"D:\x\e.exe");
        assert_eq!(p(r"\\?\D:\x\e.exe"), r"D:\x\e.exe");
        assert_eq!(p(r"C:\x\e.exe"), r"C:\x\e.exe");
        assert_eq!(p(r"\\server\c$\x"), r"\\server\c$\x");
    }
}
