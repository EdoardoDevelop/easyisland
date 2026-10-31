// The window in front, as the fixed bar's «Titolo della finestra» shows it
// (docs/architettura.md → «Barra fissa»): the program's own name (its file
// description, «Google Chrome», «Esplora file»), the window title without that
// name repeated at its end, and the program's icon as a PNG data URL. Store
// apps run inside ApplicationFrameHost: the real program is its child window's.
//
// Sent to the island as `bar-window` only while that element is in the bar
// (`watch`): at each change of window in front (context.rs) and, through a
// WinEvent hook limited to the process in front, when its title changes (a
// new tab, a new document). Names and icons are kept per program.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicIsize, AtomicU32, Ordering};
use std::sync::Mutex;

use serde_json::{json, Value};
use tauri::Emitter;
use windows::core::{BOOL, HSTRING};
use windows::Win32::Foundation::{HWND, LPARAM, WPARAM};
use windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumChildWindows, GetWindowTextW, GetWindowThreadProcessId, IsWindow, PostThreadMessageW, EVENT_OBJECT_NAMECHANGE,
    WINEVENT_OUTOFCONTEXT, WM_APP,
};

/// Posted to context.rs's hook thread: start or stop following the window in front.
pub const WATCH_MSG: u32 = WM_APP + 0x60;

/// The element is in the bar.
static WATCH: AtomicBool = AtomicBool::new(false);
/// context.rs's hook thread (it owns the hooks and their messages).
pub static THREAD: AtomicU32 = AtomicU32::new(0);
/// The window followed, and the hook on its process's title changes.
static FOLLOWED: AtomicIsize = AtomicIsize::new(0);
static NAME_HOOK: AtomicIsize = AtomicIsize::new(0);
/// The last thing sent: a title change of another object is not news.
static SENT: Mutex<String> = Mutex::new(String::new());
/// Program path → (name, icon data URL).
static KNOWN: Mutex<Option<HashMap<String, (String, String)>>> = Mutex::new(None);

/// barsys.rs: the title element came into the bar (or left it).
pub fn watch(on: bool) {
    if WATCH.swap(on, Ordering::SeqCst) == on {
        return;
    }
    let thread = THREAD.load(Ordering::SeqCst);
    if thread != 0 {
        unsafe {
            let _ = PostThreadMessageW(thread, WATCH_MSG, WPARAM(on as usize), LPARAM(0));
        }
    }
}

/// On the hook thread: a new window in front (context.rs), or the watch turned on.
pub fn follow(hwnd: HWND) {
    if !WATCH.load(Ordering::SeqCst) || hwnd.0.is_null() {
        return;
    }
    // EasyIsland's own windows (the bar, the island and its small islands, the
    // settings) and the desktop or the taskbar, which take the focus when the
    // island closes, are never shown: the element keeps the last program the
    // user worked in (Edoardo, 31 Oct 2026), and the title's menu is its menu.
    let ours = crate::context::exe_path(hwnd).is_some_and(|p| p.to_lowercase().ends_with("\\easyisland.exe"));
    if ours || crate::island::is_shell(hwnd) {
        return;
    }
    FOLLOWED.store(hwnd.0 as isize, Ordering::SeqCst);
    unhook();
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut pid)) };
    if pid != 0 {
        let hook = unsafe { SetWinEventHook(EVENT_OBJECT_NAMECHANGE, EVENT_OBJECT_NAMECHANGE, None, Some(on_name), pid, 0, WINEVENT_OUTOFCONTEXT) };
        NAME_HOOK.store(hook.0 as isize, Ordering::SeqCst);
    }
    send(hwnd);
}

/// The window the element shows, for its menu (appmenu.rs); never EasyIsland's.
pub fn target() -> Option<HWND> {
    let hwnd = HWND(FOLLOWED.load(Ordering::SeqCst) as *mut _);
    (!hwnd.0.is_null() && unsafe { IsWindow(Some(hwnd)) }.as_bool()).then_some(hwnd)
}

/// On the hook thread: the watch went off.
pub fn stop() {
    unhook();
    FOLLOWED.store(0, Ordering::SeqCst);
    SENT.lock().unwrap().clear();
}

fn unhook() {
    let old = NAME_HOOK.swap(0, Ordering::SeqCst);
    if old != 0 {
        unsafe {
            let _ = UnhookWinEvent(HWINEVENTHOOK(old as *mut _));
        }
    }
}

unsafe extern "system" fn on_name(_hook: HWINEVENTHOOK, _event: u32, hwnd: HWND, obj: i32, child: i32, _thread: u32, _time: u32) {
    // Only the title of the window followed (OBJID_WINDOW, the window itself).
    if obj == 0 && child == 0 && hwnd.0 as isize == FOLLOWED.load(Ordering::SeqCst) {
        send(hwnd);
    }
}

fn send(hwnd: HWND) {
    let v = describe(hwnd);
    let key = v.to_string();
    {
        let mut sent = SENT.lock().unwrap();
        if *sent == key {
            return;
        }
        *sent = key;
    }
    if let Some(app) = crate::context::app() {
        let _ = app.emit_to(crate::island::WINDOW_LABEL, "bar-window", &v);
    }
}

fn text_of(hwnd: HWND) -> String {
    let mut buf = [0u16; 512];
    let n = unsafe { GetWindowTextW(hwnd, &mut buf) };
    String::from_utf16_lossy(buf.get(..n.max(0) as usize).unwrap_or(&[]))
}

/// A Store app's frame: the program is its child window's, from another process.
fn real_program(hwnd: HWND) -> Option<String> {
    let path = crate::context::exe_path(hwnd)?;
    if !path.to_lowercase().ends_with("\\applicationframehost.exe") {
        return Some(path);
    }
    unsafe extern "system" fn each(child: HWND, data: LPARAM) -> BOOL {
        let out = &mut *(data.0 as *mut Option<String>);
        if let Some(p) = crate::context::exe_path(child) {
            if !p.to_lowercase().ends_with("\\applicationframehost.exe") {
                *out = Some(p);
                return false.into();
            }
        }
        true.into()
    }
    let mut found: Option<String> = None;
    unsafe {
        let _ = EnumChildWindows(Some(hwnd), Some(each), LPARAM(&mut found as *mut _ as isize));
    }
    Some(found.unwrap_or(path))
}

/// { exe, name, title, icon }: the program's name and icon, the title without the name at its end.
fn describe(hwnd: HWND) -> Value {
    let raw = text_of(hwnd);
    let Some(path) = real_program(hwnd) else { return json!({ "title": raw }) };
    let exe = path.rsplit('\\').next().unwrap_or(&path).to_lowercase();
    let (name, icon) = {
        let mut known = KNOWN.lock().unwrap();
        let map = known.get_or_insert_with(HashMap::new);
        if let Some(v) = map.get(&path) {
            v.clone()
        } else {
            // explorer.exe describes itself as the old «Esplora risorse»: its windows are folders.
            let folders = path.to_lowercase().ends_with("\\windows\\explorer.exe");
            let name = if folders { Some(crate::i18n::t("Esplora file").to_string()) } else { crate::window_drop::file_description(&path) };
            let name = name.unwrap_or_else(|| {
                let file = path.rsplit('\\').next().unwrap_or(&path);
                file.get(..file.len().saturating_sub(4)).filter(|_| file.to_lowercase().ends_with(".exe")).unwrap_or(file).to_string()
            });
            let icon = icon_of(&path).unwrap_or_default();
            if map.len() > 200 {
                map.clear();
            }
            map.insert(path.clone(), (name.clone(), icon.clone()));
            (name, icon)
        }
    };
    json!({ "exe": exe, "name": name, "title": clean_title(&raw, &name), "icon": icon })
}

/// «Pagina - Google Chrome» → «Pagina»: the program's name at the end says nothing new.
fn clean_title(title: &str, name: &str) -> String {
    // Edge writes «Microsoft\u{200b} Edge» in its titles.
    let title = title.replace('\u{200b}', "");
    let t = title.trim();
    if name.is_empty() {
        return t.to_string();
    }
    for sep in [" - ", " — ", " – ", " | "] {
        if let Some(rest) = t.strip_suffix(&format!("{sep}{name}")) {
            return rest.trim().to_string();
        }
        // «… - Google Chrome» while the description is «Google Chrome»; some add a profile: «… - Google Chrome (Lavoro)».
        if let Some(i) = t.rfind(&format!("{sep}{name}")) {
            if t.get(i + sep.len() + name.len()..).is_some_and(|r| r.trim_start().starts_with('(')) {
                return t.get(..i).unwrap_or(t).trim().to_string();
            }
        }
    }
    if t.eq_ignore_ascii_case(name) {
        return String::new();
    }
    t.to_string()
}

/// The program's icon, 32 px, as a PNG data URL.
fn icon_of(path: &str) -> Option<String> {
    use windows::Win32::Graphics::Gdi::{
        CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    };
    use windows::Win32::Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES;
    use windows::Win32::UI::Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON};
    use windows::Win32::UI::WindowsAndMessaging::{DestroyIcon, DrawIconEx, DI_NORMAL};
    const S: i32 = 32;
    unsafe {
        let mut info = SHFILEINFOW::default();
        let file = HSTRING::from(path);
        let ok = SHGetFileInfoW(&file, FILE_FLAGS_AND_ATTRIBUTES(0), Some(&mut info), std::mem::size_of::<SHFILEINFOW>() as u32, SHGFI_ICON | SHGFI_LARGEICON);
        if ok == 0 || info.hIcon.is_invalid() {
            return None;
        }
        let dc = CreateCompatibleDC(None);
        let mut bmi = BITMAPINFO::default();
        bmi.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: S,
            biHeight: -S,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        };
        let mut bits: *mut std::ffi::c_void = std::ptr::null_mut();
        let Ok(bmp) = CreateDIBSection(Some(dc), &bmi, DIB_RGB_COLORS, &mut bits, None, 0) else {
            let _ = DeleteDC(dc);
            let _ = DestroyIcon(info.hIcon);
            return None;
        };
        let old = SelectObject(dc, bmp.into());
        let drawn = DrawIconEx(dc, 0, 0, info.hIcon, S, S, 0, None, DI_NORMAL).is_ok();
        let n = (S * S * 4) as usize;
        let bgra = if drawn && !bits.is_null() { std::slice::from_raw_parts(bits as *const u8, n).to_vec() } else { Vec::new() };
        SelectObject(dc, old);
        let _ = DeleteObject(bmp.into());
        let _ = DeleteDC(dc);
        let _ = DestroyIcon(info.hIcon);
        if bgra.len() != n {
            return None;
        }
        // Old icons without alpha: what was drawn is opaque.
        let has_alpha = bgra.chunks_exact(4).any(|p| p.get(3).is_some_and(|&a| a != 0));
        let mut pixels = Vec::with_capacity(n);
        for p in bgra.chunks_exact(4) {
            let (b, g, r, a) = (p[0], p[1], p[2], p[3]);
            let a = if has_alpha { a } else if r | g | b != 0 { 255 } else { 0 };
            // GDI gives premultiplied colours; PNG wants them straight.
            let un = |c: u8| if a == 0 { 0 } else { ((c as u32 * 255 + a as u32 / 2) / a as u32).min(255) as u8 };
            pixels.extend_from_slice(&[un(r), un(g), un(b), a]);
        }
        let png = crate::clipimage::encode_png(&crate::clipimage::Rgba { width: S as u32, height: S as u32, pixels }).ok()?;
        Some(crate::clipimage::data_url(&png))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_program_name_leaves_the_title() {
        assert_eq!(clean_title("Notizie - Google Chrome", "Google Chrome"), "Notizie");
        assert_eq!(clean_title("Posta — Mozilla Firefox", "Mozilla Firefox"), "Posta");
        assert_eq!(clean_title("Doc - Google Chrome (Lavoro)", "Google Chrome"), "Doc");
        assert_eq!(clean_title("Calcolatrice", "Calcolatrice"), "");
        assert_eq!(clean_title("bar.ts - EasyIsland - Visual Studio Code", "Visual Studio Code"), "bar.ts - EasyIsland");
        assert_eq!(clean_title("Senza nome", ""), "Senza nome");
        assert_eq!(clean_title("Bing e altre 2 schede - Personale - Microsoft\u{200b} Edge", "Microsoft Edge"), "Bing e altre 2 schede - Personale");
    }
}
