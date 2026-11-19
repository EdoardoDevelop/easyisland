// The Dock's apps (docs/piano-dock.md): what an app is called and looks like,
// the apps pinned to the Dock (imported from the Windows taskbar and kept in
// step with it), every app installed (the Start menu's list, for «Aggiungi
// app») and opening them.
//
// An app id is a shell name that opens it and gives its icon: a program's path
// in lower case, a shortcut (.lnk) when it opens something else than a
// program, or `shell:AppsFolder\<AppUserModelID>` for Store apps. taskwin.rs
// gives every window the same kind of id, so a pinned app and its windows meet.
//
// Everything that touches the shell (icons, names, shortcuts, the apps folder)
// runs on one thread of its own with COM: the shell may load slow extensions
// and must never hold the Dock or a command. Icons and names come from a cache
// on disk (the shell takes 10–250 ms per app, the disk under 1 ms).
//
// Pinned apps, icons, names and shortcuts: adapted from a MIT-licensed dock
// for Windows (LICENSE, third parties).

use std::collections::HashSet;
use std::fs;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::path::{Path, PathBuf};
use std::sync::mpsc::{channel, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter};
use windows::core::{w, Interface, HSTRING, PCSTR, PCWSTR, PSTR};
use windows::Win32::Foundation::{S_OK, SIZE};
use windows::Win32::Graphics::Gdi::{
    DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    HBITMAP,
};
use windows::Win32::Storage::EnhancedStorage::PKEY_Link_TargetParsingPath;
use windows::Win32::Storage::FileSystem::GetDriveTypeW;
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CoTaskMemFree, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
    COINIT_DISABLE_OLE1DDE, STGM_READ,
};
use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_BINARY};
use windows::Win32::UI::Shell::{
    BHID_EnumItems, BHID_SFUIObject, FOLDERID_AppsFolder, IContextMenu, IEnumShellItems, IShellItem, IShellItem2,
    IShellItemImageFactory, IShellLinkW, SHCreateItemFromParsingName, SHDefExtractIconW, SHGetKnownFolderItem,
    ShellExecuteExW, ShellLink, CMF_NORMAL, CMINVOKECOMMANDINFO, GCS_VERBW, KF_FLAG_DEFAULT, SEE_MASK_NOASYNC,
    SHELLEXECUTEINFOW, SIGDN_NORMALDISPLAY, SIGDN_PARENTRELATIVEPARSING, SIIGBF_ICONONLY,
};
use windows::Win32::UI::WindowsAndMessaging::{
    AllowSetForegroundWindow, CreatePopupMenu, DestroyIcon, DestroyMenu, GetIconInfo, GetMenuItemCount, GetMenuItemID,
    ASFW_ANY, HICON, ICONINFO, SW_SHOWNORMAL,
};

pub const APPS_FOLDER: &str = "shell:AppsFolder\\";
/// The Windows taskbar's pins: shortcuts here, order and Store apps in `Favorites`.
pub const TASKBAND: PCWSTR = w!(r"Software\Microsoft\Windows\CurrentVersion\Explorer\Taskband");
/// Side of the icons sent to the Dock: crisp at 48 px magnified 1.42× on a 150 % screen.
const ICON_SIZE: u32 = 128;
/// Changed when icons or names are read differently: older cache entries are read again.
const MAGIC: &[u8; 4] = b"EIC1";
const SECONDS_PER_DAY: u64 = 86_400;
/// A launch that has not come back by then is left to itself (a hung shell handler).
const LAUNCH_TIMEOUT: Duration = Duration::from_secs(30);

/* ------------------------------------------------------------------ ids */

/// Program paths in lower case; shortcuts and Store apps as they are (a
/// shortcut's file name is its label).
pub fn normalize_id(id: &str) -> String {
    if id.starts_with(APPS_FOLDER) || is_shortcut(id) {
        id.to_owned()
    } else {
        id.to_lowercase()
    }
}

pub fn is_shortcut(id: &str) -> bool {
    id.len() > 4 && id.get(id.len() - 4..).is_some_and(|e| e.eq_ignore_ascii_case(".lnk"))
}

pub fn is_program(path: &str) -> bool {
    path.len() > 4 && path.get(path.len() - 4..).is_some_and(|e| e.eq_ignore_ascii_case(".exe"))
}

/* --------------------------------------------------------- shell thread */

type Job = Box<dyn FnOnce() + Send>;

/// The thread that talks to the shell, started at the first need.
fn shell() -> &'static Mutex<Sender<Job>> {
    static SHELL: OnceLock<Mutex<Sender<Job>>> = OnceLock::new();
    SHELL.get_or_init(|| {
        let (tx, rx) = channel::<Job>();
        let _ = std::thread::Builder::new().name("dock-shell".into()).spawn(move || {
            unsafe {
                let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
            }
            for job in rx {
                // A panic in the shell (a broken extension) must not end the thread.
                let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(job));
            }
        });
        Mutex::new(tx)
    })
}

/// Runs `f` on the shell thread and waits for its answer (at most `limit`).
fn on_shell<T: Send + 'static>(limit: Duration, f: impl FnOnce() -> T + Send + 'static) -> Option<T> {
    let (tx, rx) = channel();
    shell().lock().ok()?.send(Box::new(move || {
        let _ = tx.send(f());
    })).ok()?;
    rx.recv_timeout(limit).ok()
}

fn on_shell_later(f: impl FnOnce() + Send + 'static) {
    if let Ok(tx) = shell().lock() {
        let _ = tx.send(Box::new(f));
    }
}

/* ------------------------------------------------------- names and icons */

/// An app's name: the program's description («Visual Studio Code»), else the
/// shell's name, else the file name. Shell thread.
fn display_name(id: &str) -> String {
    if id.to_lowercase().ends_with("\\windows\\explorer.exe") {
        return crate::i18n::t("Esplora file").to_string();
    }
    let described = if is_program(id) { crate::window_drop::file_description(id) } else { None };
    described
        .or_else(|| shell_name(id))
        .map(|n| n.trim().trim_end_matches(".exe").to_owned())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| Path::new(id).file_stem().map_or_else(|| id.to_owned(), |s| s.to_string_lossy().into_owned()))
}

fn shell_name(id: &str) -> Option<String> {
    unsafe {
        let item: IShellItem = SHCreateItemFromParsingName(&HSTRING::from(id), None).ok()?;
        let raw = item.GetDisplayName(SIGDN_NORMALDISPLAY).ok()?;
        let name = raw.to_string().ok();
        CoTaskMemFree(Some(raw.as_ptr().cast()));
        name
    }
}

/// The icon of `id` as a PNG, `ICON_SIZE` square. Shell thread.
fn icon_png(id: &str) -> Option<Vec<u8>> {
    // A program's icon from its own resources, as on the taskbar: the shell's
    // factory gives a blank page for some valid icons (only PNG images inside,
    // as some Electron tools write).
    let rgba = if is_program(id) { program_icon(id) } else { None }.or_else(|| factory_icon(id))?;
    crate::clipimage::encode_png(&rgba).ok()
}

fn program_icon(path: &str) -> Option<crate::clipimage::Rgba> {
    let mut icon = HICON::default();
    let result = unsafe { SHDefExtractIconW(&HSTRING::from(path), 0, 0, Some(&mut icon), None, ICON_SIZE) };
    if result != S_OK || icon.is_invalid() {
        return None;
    }
    let image = icon_rgba(icon);
    unsafe {
        let _ = DestroyIcon(icon);
    }
    image
}

/// An icon's pixels, straight alpha; None for a monochrome icon.
fn icon_rgba(icon: HICON) -> Option<crate::clipimage::Rgba> {
    let mut info = ICONINFO::default();
    unsafe { GetIconInfo(icon, &mut info) }.ok()?;
    let read = (|| {
        if info.hbmColor.is_invalid() {
            return None;
        }
        let (width, height, mut bgra) = read_bits(info.hbmColor)?;
        if !bgra.chunks_exact(4).any(|p| p[3] != 0) {
            // No alpha: the mask says which pixels are transparent.
            let (_, _, mask) = read_bits(info.hbmMask)?;
            if mask.len() != bgra.len() {
                return None;
            }
            for (p, m) in bgra.chunks_exact_mut(4).zip(mask.chunks_exact(4)) {
                if m[0] == 0 {
                    p[3] = 255;
                } else {
                    p.copy_from_slice(&[0; 4]);
                }
            }
        }
        Some(to_rgba(width, height, &bgra, false))
    })();
    unsafe {
        let _ = DeleteObject(info.hbmColor.into());
        let _ = DeleteObject(info.hbmMask.into());
    }
    read
}

fn factory_icon(id: &str) -> Option<crate::clipimage::Rgba> {
    unsafe {
        let factory: IShellItemImageFactory = SHCreateItemFromParsingName(&HSTRING::from(id), None).ok()?;
        let side = ICON_SIZE as i32;
        let bitmap = factory.GetImage(SIZE { cx: side, cy: side }, SIIGBF_ICONONLY).ok()?;
        let bits = read_bits(bitmap);
        let _ = DeleteObject(bitmap.into());
        let (width, height, mut bgra) = bits?;
        // Old icons without alpha: every pixel opaque.
        if bgra.chunks_exact(4).all(|p| p[3] == 0) {
            bgra.chunks_exact_mut(4).for_each(|p| p[3] = 255);
        }
        // The factory's pixels are premultiplied.
        Some(to_rgba(width, height, &bgra, true))
    }
}

/// BGRA (premultiplied or not) → RGBA with straight alpha, as PNG wants.
fn to_rgba(width: u32, height: u32, bgra: &[u8], premultiplied: bool) -> crate::clipimage::Rgba {
    let mut pixels = Vec::with_capacity(bgra.len());
    for p in bgra.chunks_exact(4) {
        let (b, g, r, a) = (p[0], p[1], p[2], p[3]);
        let un = |c: u8| {
            if !premultiplied {
                c
            } else if a == 0 {
                0
            } else {
                ((u32::from(c) * 255 + u32::from(a) / 2) / u32::from(a)).min(255) as u8
            }
        };
        pixels.extend_from_slice(&[un(r), un(g), un(b), a]);
    }
    crate::clipimage::Rgba { width, height, pixels }
}

/// A bitmap's pixels as 32-bit BGRA, rows top to bottom.
fn read_bits(bitmap: HBITMAP) -> Option<(u32, u32, Vec<u8>)> {
    let mut desc = BITMAP::default();
    let written = unsafe { GetObjectW(bitmap.into(), size_of::<BITMAP>() as i32, Some((&raw mut desc).cast())) };
    if written == 0 || desc.bmWidth <= 0 || desc.bmHeight <= 0 || desc.bmWidth > 1024 || desc.bmHeight > 1024 {
        return None;
    }
    let (width, height) = (desc.bmWidth as u32, desc.bmHeight as u32);
    let mut info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: desc.bmWidth,
            biHeight: -desc.bmHeight,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut bgra = vec![0u8; (width * height * 4) as usize];
    let lines = unsafe {
        let dc = GetDC(None);
        let lines = GetDIBits(dc, bitmap, 0, height, Some(bgra.as_mut_ptr().cast()), &mut info, DIB_RGB_COLORS);
        ReleaseDC(None, dc);
        lines
    };
    (lines != 0).then_some((width, height, bgra))
}

/// Name and icon (data URL) of `id`, from the cache on disk if still valid.
/// Shell thread.
fn visual(id: &str) -> Option<(String, String)> {
    let path = cache_path(id);
    let stamp = stamp_of(id);
    if let Some((name, png)) = fs::read(&path).ok().and_then(|b| decode(&b, stamp)) {
        return Some((name, crate::clipimage::data_url(&png)));
    }
    let png = icon_png(id)?;
    let name = display_name(id);
    // An unwritable cache only makes the next start slower.
    if let Some(dir) = path.parent() {
        let _ = fs::create_dir_all(dir);
    }
    let _ = fs::write(&path, encode(&name, &png, stamp));
    Some((name, crate::clipimage::data_url(&png)))
}

fn cache_path(id: &str) -> PathBuf {
    let mut h = DefaultHasher::new();
    id.hash(&mut h);
    crate::settings::local_dir().join("icons").join(format!("{:016x}-{ICON_SIZE}.bin", h.finish()))
}

/// Files: their modification time (an update changes it). Store apps and
/// folders: the day, so they are read again at most once a day.
fn stamp_of(id: &str) -> u64 {
    let secs = |t: SystemTime| t.duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
    match fs::metadata(id) {
        Ok(m) if m.is_file() => m.modified().map_or(0, secs),
        _ => secs(SystemTime::now()) / SECONDS_PER_DAY,
    }
}

fn encode(name: &str, png: &[u8], stamp: u64) -> Vec<u8> {
    let mut b = Vec::with_capacity(16 + name.len() + png.len());
    b.extend_from_slice(MAGIC);
    b.extend_from_slice(&stamp.to_le_bytes());
    b.extend_from_slice(&(name.len() as u32).to_le_bytes());
    b.extend_from_slice(name.as_bytes());
    b.extend_from_slice(png);
    b
}

fn decode(bytes: &[u8], expected: u64) -> Option<(String, Vec<u8>)> {
    let (magic, rest) = bytes.split_first_chunk::<4>()?;
    let (stamp, rest) = rest.split_first_chunk::<8>()?;
    let (len, rest) = rest.split_first_chunk::<4>()?;
    if magic != MAGIC || u64::from_le_bytes(*stamp) != expected {
        return None;
    }
    let (name, png) = rest.split_at_checked(u32::from_le_bytes(*len) as usize)?;
    if png.is_empty() {
        return None;
    }
    Some((String::from_utf8(name.to_vec()).ok()?, png.to_vec()))
}

/// Ids whose icon is on its way: asked again meanwhile, they are not read twice.
static PENDING: Mutex<Option<HashSet<String>>> = Mutex::new(None);

/// Reads the icons and names of `ids` on the shell thread and sends them to the
/// Dock as they come: `dock-icons` `{ id: { name, icon } }`, a few at a time.
pub fn request_icons(app: &AppHandle, ids: Vec<String>) {
    let fresh: Vec<String> = {
        let Ok(mut pending) = PENDING.lock() else { return };
        let pending = pending.get_or_insert_with(HashSet::new);
        ids.into_iter().filter(|id| !id.is_empty() && pending.insert(id.clone())).collect()
    };
    if fresh.is_empty() {
        return;
    }
    let app = app.clone();
    on_shell_later(move || {
        let mut batch = Map::new();
        let total = fresh.len();
        for (i, id) in fresh.into_iter().enumerate() {
            let entry = match visual(&id) {
                Some((name, icon)) => json!({ "name": name, "icon": icon }),
                None => json!({ "name": display_name(&id), "icon": Value::Null }),
            };
            if let Ok(mut p) = PENDING.lock() {
                if let Some(p) = p.as_mut() {
                    p.remove(&id);
                }
            }
            batch.insert(id, entry);
            // In small batches: the first icons show while the rest is read.
            if batch.len() >= 8 || i + 1 == total {
                let _ = app.emit_to(crate::taskwin::DOCK_LABEL, "dock-icons", Value::Object(std::mem::take(&mut batch)));
            }
        }
    });
}

/* ------------------------------------------------ Windows taskbar pins */

fn taskbar_folder() -> Option<PathBuf> {
    Some(PathBuf::from(std::env::var_os("APPDATA")?).join("Microsoft\\Internet Explorer\\Quick Launch\\User Pinned\\TaskBar"))
}

/// The apps pinned to the Windows taskbar, in its order: desktop programs by
/// the program their shortcut opens, Store apps as `shell:AppsFolder\…`.
/// `None` when nothing can be read: never taken for «everything unpinned».
/// The order and the Store apps come from `Taskband\Favorites`, an
/// undocumented binary list, only searched as text: if its format changes the
/// desktop pins still come, in alphabetical order. Shell thread.
fn taskbar_pins_if_readable() -> Option<Vec<String>> {
    let links = taskbar_folder().map(|f| fs::read_dir(f).map(|entries| {
        entries.filter_map(|e| Some(e.ok()?.path())).filter(|p| is_shortcut(&p.to_string_lossy())).collect::<Vec<_>>()
    }));
    let links = links.unwrap_or_else(|| Err(std::io::Error::other("no APPDATA")));
    let (favorites, mut links) = match (favorites(), links) {
        (None, Err(_)) => return None,
        (f, l) => (f.unwrap_or_default(), l.unwrap_or_default()),
    };
    links.sort();
    let mut found: Vec<(usize, String)> = Vec::new();
    for link in &links {
        let Some(id) = shortcut_id(link) else { continue };
        let at = link.file_name().and_then(|n| n.to_str()).and_then(|n| find_utf16(&favorites, n)).unwrap_or(usize::MAX);
        found.push((at, id));
    }
    found.extend(app_user_model_ids(&favorites).into_iter().map(|(at, aumid)| (at, format!("{APPS_FOLDER}{aumid}"))));
    found.sort_by_key(|(at, _)| *at);
    let mut pins: Vec<String> = Vec::new();
    for (_, id) in found {
        if !pins.contains(&id) {
            pins.push(id);
        }
    }
    Some(pins)
}

fn favorites() -> Option<Vec<u8>> {
    let mut size = 0u32;
    unsafe {
        RegGetValueW(HKEY_CURRENT_USER, TASKBAND, w!("Favorites"), RRF_RT_REG_BINARY, None, None, Some(&mut size)).ok().ok()?;
        let mut blob = vec![0u8; size as usize];
        RegGetValueW(HKEY_CURRENT_USER, TASKBAND, w!("Favorites"), RRF_RT_REG_BINARY, None, Some(blob.as_mut_ptr().cast()), Some(&mut size))
            .ok()
            .ok()?;
        blob.truncate(size as usize);
        Some(blob)
    }
}

/// Byte offset of `text` as UTF-16 inside `blob`, ignoring ASCII case.
fn find_utf16(blob: &[u8], text: &str) -> Option<usize> {
    let needle: Vec<u8> = text.to_ascii_lowercase().encode_utf16().flat_map(u16::to_le_bytes).collect();
    if needle.is_empty() {
        return None;
    }
    let lowered: Vec<u8> = blob.iter().map(u8::to_ascii_lowercase).collect();
    lowered.windows(needle.len()).position(|w| w == needle.as_slice())
}

/// AppUserModelIDs (`Name_publisherid!App`) in `blob` with their offsets, in
/// order. Strings may start at any byte: both alignments are read.
fn app_user_model_ids(blob: &[u8]) -> Vec<(usize, String)> {
    let mut found = Vec::new();
    for start in 0..2 {
        let units: Vec<u16> = blob.get(start..).unwrap_or_default().chunks_exact(2).map(|p| u16::from_le_bytes([p[0], p[1]])).collect();
        let allowed = |u: u16| char::from_u32(u32::from(u)).is_some_and(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '!'));
        let mut i = 0;
        while i < units.len() {
            if !allowed(units[i]) {
                i += 1;
                continue;
            }
            let begin = i;
            while i < units.len() && allowed(units[i]) {
                i += 1;
            }
            let word = String::from_utf16_lossy(units.get(begin..i).unwrap_or_default());
            if is_app_user_model_id(&word) {
                found.push((start + begin * 2, word));
            }
        }
    }
    found.sort_by_key(|(at, _)| *at);
    found
}

/// `Package.Name_publisherid!AppId`, the publisher id 13 lower-case letters and digits.
fn is_app_user_model_id(word: &str) -> bool {
    let Some((family, app)) = word.split_once('!') else { return false };
    let Some((name, publisher)) = family.rsplit_once('_') else { return false };
    !app.is_empty()
        && !app.contains('!')
        && !name.is_empty()
        && publisher.len() == 13
        && publisher.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit())
}

/// The program a shortcut opens (None: no file, like a Control Panel item) and its arguments.
fn read_link(link: &Path) -> Option<(Option<String>, String)> {
    unsafe {
        let shell_link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).ok()?;
        shell_link.cast::<IPersistFile>().ok()?.Load(&HSTRING::from(link.as_os_str()), STGM_READ).ok()?;
        let text = |b: &[u16]| String::from_utf16_lossy(b.get(..b.iter().position(|&u| u == 0).unwrap_or(0)).unwrap_or_default());
        let mut path = [0u16; 1024];
        let target = shell_link.GetPath(&mut path, std::ptr::null_mut(), 0).ok().map(|()| text(&path)).filter(|t| !t.is_empty());
        let mut args = vec![0u16; 32_768];
        let args = shell_link.GetArguments(&mut args).map_or_else(|_| String::new(), |()| text(&args));
        Some((target, args.trim().to_owned()))
    }
}

/// What a pinned shortcut stands for, as on the taskbar: the program it opens,
/// whatever its arguments, so its windows gather under one icon; or the
/// shortcut itself when it opens something else. None for a missing target.
fn shortcut_id(link: &Path) -> Option<String> {
    let (target, _) = read_link(link)?;
    let target = target.filter(|t| Path::new(t).exists())?;
    Some(if is_program(&target) { normalize_id(&target) } else { normalize_id(&link.to_string_lossy()) })
}

/// The taskbar's shortcut to open the program `id` with, when it carries
/// arguments (a browser profile, a web app). Shell thread.
fn launch_target(id: &str) -> Option<String> {
    if is_shortcut(id) || id.starts_with("shell:") {
        return None;
    }
    fs::read_dir(taskbar_folder()?)
        .ok()?
        .filter_map(|e| Some(e.ok()?.path()))
        .filter(|l| is_shortcut(&l.to_string_lossy()))
        .find(|l| read_link(l).is_some_and(|(t, a)| !a.is_empty() && t.is_some_and(|t| normalize_id(&t) == id)))
        .map(|l| l.to_string_lossy().into_owned())
}

/// Unpins `id` from the Windows taskbar with the shell's own «Unpin from
/// taskbar» (Windows lets programs unpin, never pin). Shell thread.
fn unpin_from_taskbar(id: &str) -> bool {
    let item = if id.starts_with(APPS_FOLDER) || is_shortcut(id) {
        Some(id.to_owned())
    } else {
        taskbar_folder().and_then(|f| fs::read_dir(f).ok()).and_then(|entries| {
            entries
                .filter_map(|e| Some(e.ok()?.path()))
                .find(|l| read_link(l).and_then(|(t, _)| t).is_some_and(|t| normalize_id(&t) == id))
                .map(|l| l.to_string_lossy().into_owned())
        })
    };
    item.is_some_and(|i| invoke_verb(&i, "taskbarunpin"))
}

/// Runs the context-menu command `verb` on the shell item at `path`.
fn invoke_verb(path: &str, verb: &str) -> bool {
    unsafe {
        let Ok(item) = SHCreateItemFromParsingName::<_, _, IShellItem>(&HSTRING::from(path), None) else { return false };
        let Ok(menu) = item.BindToHandler::<_, IContextMenu>(None, &BHID_SFUIObject) else { return false };
        let Ok(popup) = CreatePopupMenu() else { return false };
        let mut done = false;
        if menu.QueryContextMenu(popup, 0, 1, 0x7FFF, CMF_NORMAL).is_ok() {
            for at in 0..GetMenuItemCount(Some(popup)).max(0) {
                let command = GetMenuItemID(popup, at);
                if command == u32::MAX || command == 0 {
                    continue;
                }
                let offset = (command - 1) as usize;
                let mut name = [0u16; 64];
                let named = menu.GetCommandString(offset, GCS_VERBW, None, PSTR(name.as_mut_ptr().cast()), name.len() as u32).is_ok();
                let len = name.iter().position(|&u| u == 0).unwrap_or(0);
                if !named || !String::from_utf16_lossy(name.get(..len).unwrap_or_default()).eq_ignore_ascii_case(verb) {
                    continue;
                }
                let info = CMINVOKECOMMANDINFO {
                    cbSize: size_of::<CMINVOKECOMMANDINFO>() as u32,
                    // A command offset where a verb name would go.
                    lpVerb: PCSTR(offset as *const u8),
                    nShow: SW_SHOWNORMAL.0,
                    ..Default::default()
                };
                done = menu.InvokeCommand(&info).is_ok();
                break;
            }
        }
        let _ = DestroyMenu(popup);
        done
    }
}

/// False only when `id` certainly no longer exists: a program gone from a
/// fixed drive, an uninstalled Store app. Removable and network drives count as present.
fn app_exists(id: &str) -> bool {
    if id.starts_with(APPS_FOLDER) {
        return unsafe { SHCreateItemFromParsingName::<_, _, IShellItem>(&HSTRING::from(id), None) }.is_ok();
    }
    let Some(root) = id.get(..3).filter(|r| r.ends_with(":\\")) else { return true };
    const DRIVE_FIXED: u32 = 3;
    let fixed = unsafe { GetDriveTypeW(&HSTRING::from(root)) } == DRIVE_FIXED;
    !fixed || Path::new(id).exists()
}

/* ------------------------------------------------------- the Dock's pins */

#[derive(Default, Serialize, Deserialize)]
struct PinsFile {
    /// The Dock's pinned apps, in its order.
    pins: Vec<String>,
    /// The Windows taskbar's pins as last read: what changed there since is
    /// added to or taken from the Dock.
    windows: Vec<String>,
}

static PINS: Mutex<Option<PinsFile>> = Mutex::new(None);

fn pins_path() -> PathBuf {
    crate::settings::config_dir().join("dock-pins.json")
}

fn load_pins() -> Option<PinsFile> {
    serde_json::from_slice(&fs::read(pins_path()).ok()?).ok()
}

fn save_pins(p: &PinsFile) {
    if let Ok(text) = serde_json::to_vec_pretty(p) {
        let _ = fs::create_dir_all(crate::settings::config_dir());
        let _ = crate::settings::write_atomic(&pins_path(), &text);
    }
}

/// Follows the Windows taskbar's pins: the first time the Dock takes them all;
/// later, what was pinned there since is added at the end and what was
/// unpinned there is taken away. Unreadable: nothing changes. Shell thread.
fn follow_windows(file: &mut PinsFile, now: Option<Vec<String>>, first: bool) -> bool {
    let Some(now) = now else { return false };
    let changed = merge_windows_pins(file, &now, first);
    file.windows = now;
    changed
}

fn merge_windows_pins(file: &mut PinsFile, now: &[String], first: bool) -> bool {
    let before = file.pins.clone();
    if first {
        for id in now {
            if !file.pins.contains(id) {
                file.pins.push(id.clone());
            }
        }
    } else {
        file.pins.retain(|id| !(file.windows.contains(id) && !now.contains(id)));
        for id in now {
            if !file.windows.contains(id) && !file.pins.contains(id) {
                file.pins.push(id.clone());
            }
        }
    }
    file.pins != before
}

/// The Dock's pins, in order (read and followed with Windows' on the first call).
pub fn pins() -> Vec<String> {
    on_shell(Duration::from_secs(10), || {
        let mut guard = PINS.lock().ok()?;
        if guard.is_none() {
            let loaded = load_pins();
            let first = loaded.is_none();
            let mut file = loaded.unwrap_or_default();
            if follow_windows(&mut file, taskbar_pins_if_readable(), first) || first {
                save_pins(&file);
            }
            // Uninstalled apps leave quietly.
            let before = file.pins.len();
            file.pins.retain(|id| app_exists(id));
            if file.pins.len() != before {
                save_pins(&file);
            }
            *guard = Some(file);
        }
        guard.as_ref().map(|f| f.pins.clone())
    })
    .flatten()
    .unwrap_or_default()
}

/// The Windows taskbar's pins changed (taskwin.rs heard `Taskband`): the Dock follows.
/// True if the Dock's pins changed.
pub fn windows_pins_changed() -> bool {
    on_shell(Duration::from_secs(10), || {
        let now = taskbar_pins_if_readable();
        let mut guard = PINS.lock().ok()?;
        let file = guard.as_mut()?;
        let changed = follow_windows(file, now, false);
        save_pins(file);
        Some(changed)
    })
    .flatten()
    .unwrap_or(false)
}

fn update_pins(f: impl FnOnce(&mut Vec<String>)) -> Vec<String> {
    let _ = pins();
    let Ok(mut guard) = PINS.lock() else { return Vec::new() };
    let Some(file) = guard.as_mut() else { return Vec::new() };
    f(&mut file.pins);
    save_pins(file);
    file.pins.clone()
}

/// The Dock's pins in a new order, or a new set (from the editor in Settings).
pub fn set_pins(ids: Vec<String>) -> Vec<String> {
    update_pins(|pins| {
        let mut seen = HashSet::new();
        *pins = ids.into_iter().filter(|id| !id.is_empty() && seen.insert(id.clone())).collect();
    })
}

pub fn pin(id: &str) -> Vec<String> {
    let id = normalize_id(id);
    update_pins(|pins| {
        if !pins.contains(&id) {
            pins.push(id);
        }
    })
}

/// Unpins from the Dock and, if it was pinned there, from the Windows taskbar
/// too (otherwise the next change there would bring it back).
pub fn unpin(id: &str) -> Vec<String> {
    let id = normalize_id(id);
    let pins = update_pins(|pins| pins.retain(|p| p != &id));
    let was_windows = PINS.lock().ok().and_then(|g| g.as_ref().map(|f| f.windows.contains(&id))).unwrap_or(false);
    if was_windows {
        on_shell_later(move || {
            let _ = unpin_from_taskbar(&id);
        });
    }
    pins
}

/* ------------------------------------------------------- installed apps */

/// Every app of the Start menu's list (Store and desktop): `{ id, name }`,
/// by name. A desktop program by its path, so it meets its windows. Shell thread.
fn catalog() -> Vec<(String, String)> {
    let mut out: Vec<(String, String)> = Vec::new();
    let mut seen = HashSet::new();
    unsafe {
        let Ok(folder) = SHGetKnownFolderItem::<IShellItem>(&FOLDERID_AppsFolder, KF_FLAG_DEFAULT, None) else { return out };
        let Ok(items) = folder.BindToHandler::<_, IEnumShellItems>(None, &BHID_EnumItems) else { return out };
        loop {
            let mut got = [None];
            let mut n = 0u32;
            if items.Next(&mut got, Some(&mut n)).is_err() || n == 0 {
                break;
            }
            let Some(item) = got[0].take() else { break };
            let text = |sigdn| {
                item.GetDisplayName(sigdn).ok().and_then(|raw| {
                    let s = raw.to_string().ok();
                    CoTaskMemFree(Some(raw.as_ptr().cast()));
                    s
                })
            };
            let (Some(name), Some(parsing)) = (text(SIGDN_NORMALDISPLAY), text(SIGDN_PARENTRELATIVEPARSING)) else { continue };
            // A desktop program: the program itself, as its windows say.
            let target = item
                .cast::<IShellItem2>()
                .ok()
                .and_then(|i2| i2.GetString(&PKEY_Link_TargetParsingPath).ok())
                .and_then(|raw| {
                    let s = raw.to_string().ok();
                    CoTaskMemFree(Some(raw.as_ptr().cast()));
                    s
                })
                .filter(|t| is_program(t) && Path::new(t).exists());
            let id = target.map_or_else(|| format!("{APPS_FOLDER}{parsing}"), |t| normalize_id(&t));
            if seen.insert(id.clone()) {
                out.push((id, name));
            }
        }
    }
    out.sort_by_key(|(_, n)| n.to_lowercase());
    out
}

/// The installed apps for «Aggiungi app»: `[{ id, name }]` (icons via `dock_icons`).
pub fn apps_catalog() -> Value {
    let list = on_shell(Duration::from_secs(20), catalog).unwrap_or_default();
    Value::Array(list.into_iter().map(|(id, name)| json!({ "id": id, "name": name })).collect())
}

/* ---------------------------------------------------------------- open */

/// What to open: by its id, as administrator, or files with a program.
pub enum Launch {
    Open { id: String },
    Admin { id: String },
    Files { app: String, files: Vec<String> },
}

/// Opens it on a thread of its own: the shell (DDE, a slow handler, UAC) never
/// holds the Dock. The click was the Dock's, which lets it hand the right to
/// come in front to what it opens.
pub fn launch(what: Launch) {
    unsafe {
        let _ = AllowSetForegroundWindow(ASFW_ANY);
    }
    let _ = std::thread::Builder::new().name("dock-launch".into()).spawn(move || {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
        }
        let (verb, file, args) = match what {
            // A program pinned from a shortcut with arguments opens through it.
            Launch::Open { id } => ("open", launch_target(&id).unwrap_or(id), None),
            Launch::Admin { id } => ("runas", id, None),
            Launch::Files { app, files } => ("open", app, Some(quote_all(&files))),
        };
        let started = std::time::Instant::now();
        if let Err(e) = shell_execute(verb, &file, args.as_deref()) {
            crate::log::line(format!("dock: apertura non riuscita ({}): {e}", crate::log::mask(&file)));
        }
        if started.elapsed() > LAUNCH_TIMEOUT {
            crate::log::line("dock: apertura lenta (oltre 30 s)");
        }
    });
}

/// Every file as one argument, in quotes; quotes inside a path are not possible on Windows.
fn quote_all(files: &[String]) -> String {
    files.iter().filter(|f| !f.contains('"')).map(|f| format!("\"{f}\"")).collect::<Vec<_>>().join(" ")
}

fn shell_execute(verb: &str, file: &str, args: Option<&str>) -> windows::core::Result<()> {
    let verb = HSTRING::from(verb);
    let file = HSTRING::from(file);
    let args = args.map(HSTRING::from);
    let mut request = SHELLEXECUTEINFOW {
        cbSize: size_of::<SHELLEXECUTEINFOW>() as u32,
        // The thread ends after: activation (DDE included) must finish first.
        fMask: SEE_MASK_NOASYNC,
        lpVerb: PCWSTR(verb.as_ptr()),
        lpFile: PCWSTR(file.as_ptr()),
        lpParameters: args.as_ref().map_or(PCWSTR::null(), |a| PCWSTR(a.as_ptr())),
        nShow: SW_SHOWNORMAL.0,
        ..Default::default()
    };
    unsafe { ShellExecuteExW(&mut request) }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn utf16(t: &str) -> Vec<u8> {
        t.encode_utf16().flat_map(u16::to_le_bytes).collect()
    }

    #[test]
    fn favorites_give_store_apps_and_shortcuts_in_taskbar_order() {
        let mut blob = vec![0x14, 0x00, 0x1f, 0x80];
        blob.extend(utf16("File Explorer.lnk"));
        blob.extend([0x00, 0x00, 0x07]);
        blob.extend(utf16("Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic"));
        blob.extend([0x00, 0x00, 0x49]);
        blob.extend(utf16("Brave.lnk"));
        let explorer = find_utf16(&blob, "file explorer.lnk");
        let brave = find_utf16(&blob, "Brave.lnk");
        let store = app_user_model_ids(&blob);
        assert_eq!(store.len(), 1);
        assert_eq!(store[0].1, "Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic");
        assert!(explorer < Some(store[0].0) && Some(store[0].0) < brave);
    }

    #[test]
    fn an_aumid_needs_a_publisher_id_and_an_app() {
        assert!(is_app_user_model_id("Microsoft.WindowsCalculator_8wekyb3d8bbwe!App"));
        assert!(!is_app_user_model_id("Microsoft.Windows.Explorer"));
        assert!(!is_app_user_model_id("Microsoft.ZuneMusic_11.2312.8.0_x64__8wekyb3d8bbwe"));
        assert!(!is_app_user_model_id("Name_8wekyb3d8bbwe!"));
    }

    #[test]
    fn ids_keep_case_only_for_shortcuts_and_store_apps() {
        assert_eq!(normalize_id(r"C:\Windows\Explorer.EXE"), r"c:\windows\explorer.exe");
        let store = "shell:AppsFolder\\Microsoft.WindowsTerminal_8wekyb3d8bbwe!App";
        assert_eq!(normalize_id(store), store);
        assert!(is_program(r"C:\App\App.EXE"));
        assert!(!is_program(r"C:\LibreOffice\program\soffice.bin"));
        // A name ending inside a multi-byte character: no program, no panic.
        assert!(!is_program(r"C:\app\x€ab"));
    }

    #[test]
    fn the_cache_gives_back_what_it_stored_while_current() {
        let bytes = encode("Esplora file", &[1, 2, 3], 7);
        assert_eq!(decode(&bytes, 7), Some(("Esplora file".to_string(), vec![1, 2, 3])));
        assert_eq!(decode(&bytes, 8), None);
        assert_eq!(decode(bytes.get(..bytes.len() - 3).unwrap(), 7), None);
    }

    #[test]
    fn the_dock_follows_what_changes_on_the_windows_taskbar() {
        let ids = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        // First time: everything Windows had, after what the Dock has.
        let mut f = PinsFile { pins: ids(&["mine"]), windows: vec![] };
        assert!(merge_windows_pins(&mut f, &ids(&["a", "b"]), true));
        assert_eq!(f.pins, ids(&["mine", "a", "b"]));
        f.windows = ids(&["a", "b"]);
        // Later: unpinned there leaves, newly pinned there comes, the Dock's order stays.
        f.pins = ids(&["b", "mine", "a"]);
        assert!(merge_windows_pins(&mut f, &ids(&["b", "c"]), false));
        assert_eq!(f.pins, ids(&["b", "mine", "c"]));
        // Unpinned from the Dock only: a later change on Windows does not bring it back.
        f.windows = ids(&["b", "c"]);
        f.pins = ids(&["mine", "c"]);
        assert!(!merge_windows_pins(&mut f, &ids(&["b", "c"]), false));
        assert_eq!(f.pins, ids(&["mine", "c"]));
    }

    fn com() {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
        }
    }

    #[test]
    #[ignore = "reads this PC's taskbar pins and app list; nothing is shown or written"]
    fn this_pc() {
        com();
        let pins = taskbar_pins_if_readable();
        println!("fissate di Windows: {pins:#?}");
        for id in pins.unwrap_or_default().iter().take(3) {
            let png = icon_png(id).map(|p| p.len());
            println!("{id}: «{}», icona {png:?} byte", display_name(id));
        }
        let apps = catalog();
        println!("app installate: {}", apps.len());
        for (id, name) in apps.iter().take(15) {
            println!("  {name:<40} {id}");
        }
    }

    #[test]
    fn files_go_quoted_one_by_one() {
        assert_eq!(quote_all(&["C:\\a b.txt".into(), "x\"y".into(), "d".into()]), "\"C:\\a b.txt\" \"d\"");
    }
}
