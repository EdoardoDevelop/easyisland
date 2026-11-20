// The open windows, for the Dock (docs/piano-dock.md): which ones the Windows
// taskbar would show, the app each belongs to (the same ids as applist.rs, so
// a pinned app meets its windows), which is in front, minimized or asking for
// attention; and what the Dock does with them: bring to front, minimize,
// close, open apps, and the system buttons (Windows' own shortcuts).
//
// Nothing polls. One thread with a hidden window hears the shell hook (a
// window created, destroyed, activated, flashing) and a few WinEvents
// (minimize, restore, front, cloaked by a virtual-desktop switch): each only
// starts a 40 ms timer, then every window is read again (EnumWindows, under a
// millisecond) and the Dock hears only what changed (`dock-windows`). Title
// changes are not followed: browsers and terminals change titles all the
// time, which kept the CPU busy at rest. The thread starts with the Dock
// (`dock_windows`) and ends when the Dock's window is gone. It also tells the
// Dock when the window in front reaches its band (`dock-covered`, for «hide
// when covered»): followed only for that window, moved or resized.
//
// Window filter, app ids, the bring-to-front sequence and the system keys:
// adapted from MIT-licensed docks for Windows (LICENSE, third parties); so are
// the retries when the focus is refused, closing Start or the notification
// centre first, and what counts as a full-screen app.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicI8, AtomicIsize, AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};
use windows::core::{w, BOOL, PWSTR};
use windows::Win32::Foundation::{CloseHandle, HANDLE, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::Foundation::RECT;
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::Security::{GetTokenInformation, TokenElevation, TOKEN_ELEVATION, TOKEN_QUERY};
use windows::Win32::Storage::EnhancedStorage::PKEY_AppUserModel_ID;
use windows::Win32::Storage::Packaging::Appx::GetApplicationUserModelId;
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Threading::{
    GetCurrentProcessId, OpenProcess, OpenProcessToken, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
    PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
use windows::Win32::Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_KEYUP, VIRTUAL_KEY,
    VK_A, VK_D, VK_ESCAPE, VK_LBUTTON, VK_LCONTROL, VK_LWIN, VK_MBUTTON, VK_N, VK_RBUTTON, VK_S, VK_TAB, VK_V, VK_W,
};
use windows::Win32::UI::Shell::PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DeregisterShellHookWindow, DestroyWindow, DispatchMessageW, EnumWindows,
    GetClassNameW, GetForegroundWindow, GetMessageW, GetWindow, GetWindowLongW, GetWindowRect, GetWindowTextLengthW, GetWindowTextW,
    GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, KillTimer, PostMessageW, PostQuitMessage,
    RegisterClassW, RegisterShellHookWindow, RegisterWindowMessageW, SendMessageTimeoutW, SetForegroundWindow,
    SetTimer, SetWindowPos, ShowWindowAsync, SwitchToThisWindow, TranslateMessage, EVENT_OBJECT_CLOAKED,
    EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_UNCLOAKED, EVENT_SYSTEM_MOVESIZEEND, EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MINIMIZEEND, EVENT_SYSTEM_MINIMIZESTART, GWL_EXSTYLE,
    GW_OWNER, MSG, OBJID_WINDOW, SMTO_ABORTIFHUNG, SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE, SWP_NOMOVE,
    SWP_NOOWNERZORDER, SWP_NOSIZE, SW_MINIMIZE, SW_RESTORE, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS, WM_APP,
    WM_CLOSE, WM_NULL, WM_SYSCOMMAND, WM_TIMER, WNDCLASSW, WS_CAPTION, WS_EX_APPWINDOW, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW,
    WS_EX_TOPMOST, GWL_STYLE, SC_RESTORE,
};

/// The Dock's window (created by lib.rs when the Dock is on).
pub const DOCK_LABEL: &str = "dock";

/// Window notifications come in bursts (an app opening): one read after them.
const SYNC_DELAY_MS: u32 = 40;
/// Explorer writes a pin change in a few steps: read it once they settled.
const PINS_DELAY_MS: u32 = 400;
const SYNC_TIMER: usize = 1;
const PINS_TIMER: usize = 2;
/// The window in front moved or changed size: is the Dock covered now?
const COVER_TIMER: usize = 3;
const COVER_DELAY_MS: u32 = 100;
/// The part of the Dock's window a window in front must reach to cover it (logical px from its bottom).
const COVER_BAND: f64 = 72.0;
/// The registry watch on the taskbar's pins fired (regwatch.rs).
const WM_PINS: u32 = WM_APP + 1;
/// Asked to end (the Dock's window is gone).
const WM_STOP: u32 = WM_APP + 2;
/// Asked to read the windows again (a command changed them).
const WM_RESYNC: u32 = WM_APP + 3;

const HSHELL_WINDOWCREATED: usize = 1;
const HSHELL_WINDOWDESTROYED: usize = 2;
const HSHELL_WINDOWACTIVATED: usize = 4;
const HSHELL_REDRAW: usize = 6;
const HSHELL_HIGHBIT: usize = 0x8000;
const HSHELL_FLASH: usize = HSHELL_REDRAW | HSHELL_HIGHBIT;
const HSHELL_RUDEAPPACTIVATED: usize = HSHELL_WINDOWACTIVATED | HSHELL_HIGHBIT;

static APP: OnceLock<AppHandle> = OnceLock::new();
/// The thread's hidden window, 0 while it does not run.
static HOOK_WINDOW: AtomicIsize = AtomicIsize::new(0);
/// The registered "SHELLHOOK" message.
static SHELL_MSG: AtomicU32 = AtomicU32::new(0);
/// What the Dock was last told about being covered: -1 nothing yet.
static COVERED: AtomicI8 = AtomicI8::new(-1);
/// Whether a full-screen app was last said to be in front: -1 nothing yet.
static FULLSCREEN: AtomicI8 = AtomicI8::new(-1);
/// Screen tools that cover the screen for a moment (Win+Maiusc+S): never a game.
const SCREEN_TOOLS: &[&str] = &[
    "screenclippinghost.exe", "snippingtool.exe", "screensketch.exe", "sharex.exe", "lightshot.exe", "greenshot.exe",
    "powertoys.screenruler.exe", "powertoys.powerocr.exe", "powertoys.colorpickerui.exe",
];

/// One open window as the Dock shows it.
#[derive(Clone, Debug, PartialEq)]
struct Win {
    hwnd: isize,
    app: String,
    title: String,
    active: bool,
    minimized: bool,
    attention: bool,
    last_used: u64,
}

impl Win {
    fn json(&self) -> Value {
        // The picture comes once per app in `dock-icons` (keyed by the app id in
        // lower case): never a source here, an id would show a broken image.
        json!({
            "hwnd": self.hwnd, "app": self.app, "icon": "", "title": self.title,
            "active": self.active, "minimized": self.minimized, "attention": self.attention, "lastUsed": self.last_used,
        })
    }
}

#[derive(Default)]
struct State {
    /// The app of each window, read once when it appears (Windows reuses handles: dropped when it goes).
    app_ids: HashMap<isize, String>,
    /// Use order: higher is more recent.
    last_used: HashMap<isize, u64>,
    seq: u64,
    /// Windows asking for attention (HSHELL_FLASH), until activated.
    attention: HashSet<isize>,
    /// What the Dock was last sent.
    sent: Vec<Win>,
    /// Apps whose icon was already asked for.
    icons_asked: HashSet<String>,
}

static STATE: Mutex<Option<State>> = Mutex::new(None);

fn with_state<T>(f: impl FnOnce(&mut State) -> T) -> Option<T> {
    let mut guard = STATE.lock().ok()?;
    Some(f(guard.get_or_insert_with(State::default)))
}

/// A window the Dock was shown (commands take only those, never any handle).
pub fn is_known(hwnd: isize) -> bool {
    with_state(|s| s.sent.iter().any(|w| w.hwnd == hwnd)).unwrap_or(false)
}

/* ---------------------------------------------------------- the filter */

fn class_name(hwnd: HWND) -> String {
    let mut buf = [0u16; 128];
    let n = unsafe { GetClassNameW(hwnd, &mut buf) };
    String::from_utf16_lossy(buf.get(..n.max(0) as usize).unwrap_or_default())
}

fn title_of(hwnd: HWND) -> String {
    let mut buf = [0u16; 256];
    let n = unsafe { GetWindowTextW(hwnd, &mut buf) };
    String::from_utf16_lossy(buf.get(..n.max(0) as usize).unwrap_or_default())
}

/// Hidden by the system although «visible»: on another virtual desktop, a suspended Store app.
fn is_cloaked(hwnd: HWND) -> bool {
    let mut cloaked = 0u32;
    unsafe {
        let _ = DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, (&raw mut cloaked).cast(), size_of::<u32>() as u32);
    }
    cloaked != 0
}

/// A window the Windows taskbar would show: visible, with a title, not a tool
/// window, not owned or not-activating unless it asks to be on the taskbar,
/// not cloaked, not EasyIsland's own.
fn is_app_window(hwnd: HWND) -> bool {
    unsafe {
        if !IsWindowVisible(hwnd).as_bool() || GetWindowTextLengthW(hwnd) == 0 {
            return false;
        }
        let ex = GetWindowLongW(hwnd, GWL_EXSTYLE) as u32;
        let has = |flag: u32| ex & flag != 0;
        if has(WS_EX_TOOLWINDOW.0) {
            return false;
        }
        let owned = GetWindow(hwnd, GW_OWNER).is_ok_and(|o| !o.is_invalid());
        if (owned || has(WS_EX_NOACTIVATE.0)) && !has(WS_EX_APPWINDOW.0) {
            return false;
        }
        if is_cloaked(hwnd) {
            return false;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        pid != GetCurrentProcessId()
    }
}

fn window_aumid(hwnd: HWND) -> Option<String> {
    let value = unsafe {
        let store: IPropertyStore = SHGetPropertyStoreForWindow(hwnd).ok()?;
        store.GetValue(&PKEY_AppUserModel_ID).ok()?
    };
    let aumid = value.to_string();
    (!aumid.is_empty()).then_some(aumid)
}

/// The app of a window, as applist.rs names apps: a Store app's frame by its
/// window's AUMID, a packaged process by its AUMID, else the program's path;
/// a program whose windows live in a host that is no .exe (LibreOffice's
/// soffice.bin) by its window's AUMID. None while a new Store app has not said
/// which it is yet (asked again at the next read).
fn app_id(hwnd: HWND) -> Option<String> {
    use crate::applist::{is_program, normalize_id, APPS_FOLDER};
    if class_name(hwnd) == "ApplicationFrameWindow" {
        return window_aumid(hwnd).map(|a| format!("{APPS_FOLDER}{a}"));
    }
    unsafe {
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let id = if GetApplicationUserModelId(process, &mut len, Some(PWSTR(buf.as_mut_ptr()))).is_ok() {
            let aumid = String::from_utf16_lossy(buf.get(..len.saturating_sub(1) as usize).unwrap_or_default());
            Some(format!("{APPS_FOLDER}{aumid}"))
        } else {
            len = buf.len() as u32;
            QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).ok().map(|()| {
                let image = String::from_utf16_lossy(buf.get(..len as usize).unwrap_or_default());
                if is_program(&image) {
                    normalize_id(&image)
                } else {
                    window_aumid(hwnd).map_or_else(|| normalize_id(&image), |a| format!("{APPS_FOLDER}{a}"))
                }
            })
        };
        let _ = CloseHandle(process);
        id
    }
}

/// Every top-level window, front to back.
fn all_windows() -> Vec<HWND> {
    unsafe extern "system" fn collect(hwnd: HWND, list: LPARAM) -> BOOL {
        unsafe { (*(list.0 as *mut Vec<HWND>)).push(hwnd) };
        true.into()
    }
    let mut all: Vec<HWND> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(collect), LPARAM(&raw mut all as isize));
    }
    all
}

/// The windows now, with what is known of each.
fn read(state: &mut State) -> Vec<Win> {
    let front = unsafe { GetForegroundWindow() }.0 as isize;
    let mut out = Vec::new();
    let windows: Vec<HWND> = all_windows().into_iter().filter(|&h| is_app_window(h)).collect();
    let count = windows.len() as u64;
    for (z, hwnd) in windows.into_iter().enumerate() {
        let key = hwnd.0 as isize;
        let app = match state.app_ids.get(&key) {
            Some(a) => a.clone(),
            None => {
                let Some(a) = app_id(hwnd) else { continue };
                state.app_ids.insert(key, a.clone());
                a
            }
        };
        // Never seen in front since the Dock started: the stacking order says how recent.
        let last_used = *state.last_used.entry(key).or_insert(count.saturating_sub(z as u64));
        out.push(Win {
            hwnd: key,
            app,
            title: title_of(hwnd),
            active: key == front,
            minimized: unsafe { IsIconic(hwnd).as_bool() },
            attention: state.attention.contains(&key),
            last_used,
        });
    }
    let alive: HashSet<isize> = out.iter().map(|w| w.hwnd).collect();
    state.app_ids.retain(|h, _| alive.contains(h));
    state.last_used.retain(|h, _| alive.contains(h));
    state.attention.retain(|h| alive.contains(h));
    out
}

/// What changed between two reads: `{ add, change, remove }`, None if nothing.
fn diff(before: &[Win], now: &[Win]) -> Option<Value> {
    let old: HashMap<isize, &Win> = before.iter().map(|w| (w.hwnd, w)).collect();
    let new: HashSet<isize> = now.iter().map(|w| w.hwnd).collect();
    let mut add = Vec::new();
    let mut change = Vec::new();
    for w in now {
        match old.get(&w.hwnd) {
            None => add.push(w.json()),
            Some(o) if *o != w => change.push(w.json()),
            _ => {}
        }
    }
    let remove: Vec<isize> = before.iter().map(|w| w.hwnd).filter(|h| !new.contains(h)).collect();
    (!add.is_empty() || !change.is_empty() || !remove.is_empty()).then(|| json!({ "add": add, "change": change, "remove": remove }))
}

/// The visible frame of a window (without the invisible resize borders).
fn frame_of(hwnd: HWND) -> Option<RECT> {
    let mut r = RECT::default();
    let dwm = unsafe { DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, (&raw mut r).cast(), size_of::<RECT>() as u32) };
    if dwm.is_err() {
        unsafe { GetWindowRect(hwnd, &mut r) }.ok()?;
    }
    (r.right > r.left && r.bottom > r.top).then_some(r)
}

/// Whether the window in front reaches the Dock's band. The desktop, Alt+Tab,
/// hidden, minimized or cloaked windows and EasyIsland's own never do.
fn covered_now(app: &AppHandle) -> Option<bool> {
    let dock = app.get_webview_window(DOCK_LABEL)?;
    let scale = dock.scale_factor().ok()?;
    let dock_rect = frame_of(HWND(dock.hwnd().ok()?.0))?;
    let band_top = dock_rect.bottom - (COVER_BAND * scale).round() as i32;
    unsafe {
        let front = GetForegroundWindow();
        if front.is_invalid() || !IsWindowVisible(front).as_bool() || IsIconic(front).as_bool() || is_cloaked(front) {
            return Some(false);
        }
        let class = class_name(front);
        if matches!(class.as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd" | "XamlExplorerHostIslandWindow" | "MultitaskingViewFrame") {
            return Some(false);
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(front, Some(&mut pid));
        if pid == GetCurrentProcessId() {
            return Some(false);
        }
        let r = frame_of(front)?;
        Some(r.bottom > band_top && r.top < dock_rect.bottom && r.right > dock_rect.left && r.left < dock_rect.right)
    }
}

/// The program file of a process, in lower case ("" if it cannot be read).
fn process_exe(pid: u32) -> String {
    unsafe {
        let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return String::new() };
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, PWSTR(buf.as_mut_ptr()), &mut len).is_ok();
        let _ = CloseHandle(process);
        if ok { String::from_utf16_lossy(buf.get(..len as usize).unwrap_or_default()).to_lowercase() } else { String::new() }
    }
}

/// A full-screen app in front (a game, a video, a presentation): it covers its
/// whole monitor and has no title bar. A window with a title bar never is,
/// even covering the screen with the taskbar hidden (Chrome keeps
/// WS_MAXIMIZE in F11, only the caption goes). The desktop, tool windows,
/// screen-capture tools, hidden, minimized or cloaked windows and
/// EasyIsland's own never are. With the Windows taskbar hidden its own
/// notice (ABN_FULLSCREENAPP) does not hold: this replaces it.
fn foreground_fullscreen() -> bool {
    unsafe {
        let front = GetForegroundWindow();
        if front.is_invalid() || !IsWindowVisible(front).as_bool() || IsIconic(front).as_bool() || is_cloaked(front) {
            return false;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(front, Some(&mut pid));
        if pid == 0 || pid == GetCurrentProcessId() {
            return false;
        }
        if GetWindowLongW(front, GWL_EXSTYLE) as u32 & WS_EX_TOOLWINDOW.0 != 0 {
            return false;
        }
        if GetWindowLongW(front, GWL_STYLE) as u32 & WS_CAPTION.0 == WS_CAPTION.0 {
            return false;
        }
        if matches!(class_name(front).as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd" | "Shell_SecondaryTrayWnd")
            || matches!(class_name(front).as_str(), "XamlExplorerHostIslandWindow" | "MultitaskingViewFrame")
        {
            return false;
        }
        let exe = process_exe(pid);
        if SCREEN_TOOLS.iter().any(|t| exe.ends_with(&format!("\\{t}"))) {
            return false;
        }
        let mut rect = RECT::default();
        let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
        if GetWindowRect(front, &mut rect).is_err() || !GetMonitorInfoW(MonitorFromWindow(front, MONITOR_DEFAULTTONEAREST), &mut info).as_bool() {
            return false;
        }
        covers(rect, info.rcMonitor)
    }
}

fn covers(window: RECT, screen: RECT) -> bool {
    window.left <= screen.left && window.top <= screen.top && window.right >= screen.right && window.bottom >= screen.bottom
}

/// Tells the Dock's window when a full-screen app comes in front or leaves.
fn check_fullscreen() {
    let now = foreground_fullscreen();
    if FULLSCREEN.swap(now as i8, Ordering::SeqCst) != now as i8 {
        if let Some(app) = APP.get() {
            // dock_window.rs hides the Dock (and the Top bar follows); until its
            // function is merged, the Dock's page hears it.
            let _ = app.emit_to(DOCK_LABEL, "dock-fullscreen", now);
        }
    }
}

/// Tells the Dock if it became covered or uncovered.
fn check_covered() {
    check_fullscreen();
    let Some(app) = APP.get() else { return };
    let Some(now) = covered_now(app) else { return };
    if COVERED.swap(now as i8, Ordering::SeqCst) != now as i8 {
        let _ = app.emit_to(DOCK_LABEL, "dock-covered", now);
    }
}

/// Reads the windows, sends the Dock what changed and asks for the icons of new apps.
fn sync() {
    let Some(app) = APP.get() else { return };
    if app.get_webview_window(DOCK_LABEL).is_none() {
        stop();
        return;
    }
    let Some((change, new_apps)) = with_state(|s| {
        let now = read(s);
        let change = diff(&s.sent, &now);
        let new_apps: Vec<String> = now.iter().map(|w| w.app.clone()).filter(|a| s.icons_asked.insert(a.clone())).collect();
        s.sent = now;
        (change, new_apps)
    }) else {
        return;
    };
    if let Some(change) = change {
        let _ = app.emit_to(DOCK_LABEL, "dock-windows", change);
    }
    if !new_apps.is_empty() {
        crate::applist::request_icons(app, new_apps);
    }
    check_covered();
}

/* ------------------------------------------------------------- thread */

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    let schedule = |hwnd: HWND| unsafe {
        SetTimer(Some(hwnd), SYNC_TIMER, SYNC_DELAY_MS, None);
    };
    let shell = SHELL_MSG.load(Ordering::Relaxed);
    if shell != 0 && msg == shell {
        let target = lparam.0;
        match wparam.0 {
            HSHELL_WINDOWCREATED | HSHELL_WINDOWDESTROYED => schedule(hwnd),
            HSHELL_WINDOWACTIVATED | HSHELL_RUDEAPPACTIVATED => {
                with_state(|s| s.attention.remove(&target));
                schedule(hwnd);
            }
            HSHELL_FLASH => {
                with_state(|s| s.attention.insert(target));
                schedule(hwnd);
            }
            // A title changed: only a window not yet known matters (it may now have one).
            HSHELL_REDRAW => {
                if with_state(|s| !s.app_ids.contains_key(&target)).unwrap_or(false) {
                    schedule(hwnd);
                }
            }
            _ => {}
        }
        return LRESULT(0);
    }
    match msg {
        WM_TIMER => {
            unsafe {
                let _ = KillTimer(Some(hwnd), wparam.0);
            }
            if wparam.0 == SYNC_TIMER {
                sync();
            } else if wparam.0 == COVER_TIMER {
                check_covered();
            } else if wparam.0 == PINS_TIMER {
                // On a thread of its own: the shell may be slow, this thread must stay free.
                std::thread::spawn(|| {
                    if let (Some(app), Some(change)) = (APP.get(), crate::applist::windows_pins_change()) {
                        let _ = app.emit_to(DOCK_LABEL, "dock-pins-windows", change);
                    }
                });
            }
            LRESULT(0)
        }
        WM_PINS => {
            PINS_WATCH.with(|w| {
                if let Some(w) = w.borrow_mut().as_mut() {
                    w.arm();
                }
            });
            unsafe {
                SetTimer(Some(hwnd), PINS_TIMER, PINS_DELAY_MS, None);
            }
            LRESULT(0)
        }
        WM_RESYNC => {
            schedule(hwnd);
            LRESULT(0)
        }
        WM_STOP => {
            unsafe {
                let _ = DestroyWindow(hwnd);
                PostQuitMessage(0);
            }
            LRESULT(0)
        }
        _ => unsafe { DefWindowProcW(hwnd, msg, wparam, lparam) },
    }
}

thread_local! {
    /// Moves and resizes of the process in front only (re-hooked at each change of front).
    static FRONT_HOOK: std::cell::Cell<isize> = const { std::cell::Cell::new(0) };
    static PINS_WATCH: std::cell::RefCell<Option<crate::regwatch::RegistryWatch>> = const { std::cell::RefCell::new(None) };
}

fn cover_soon() {
    let window = HWND(HOOK_WINDOW.load(Ordering::Relaxed) as *mut _);
    if !window.is_invalid() {
        unsafe {
            SetTimer(Some(window), COVER_TIMER, COVER_DELAY_MS, None);
        }
    }
}

/// Follows moves and resizes of the front window's process only (maximize,
/// restore, snap, a drag); anything else than that window is filtered out in the callback.
fn follow_front(front: HWND) {
    unsafe {
        let old = FRONT_HOOK.with(|h| h.replace(0));
        if old != 0 {
            let _ = UnhookWinEvent(HWINEVENTHOOK(old as *mut _));
        }
        if front.is_invalid() {
            return;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(front, Some(&mut pid));
        if pid == 0 || pid == GetCurrentProcessId() {
            return;
        }
        let hook = SetWinEventHook(EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE, None, Some(on_win_event), pid, 0, WINEVENT_OUTOFCONTEXT);
        FRONT_HOOK.with(|h| h.set(hook.0 as isize));
    }
}

unsafe extern "system" fn on_win_event(_h: HWINEVENTHOOK, event: u32, hwnd: HWND, object: i32, _c: i32, _t: u32, _time: u32) {
    if object != OBJID_WINDOW.0 {
        return;
    }
    if event == EVENT_OBJECT_LOCATIONCHANGE {
        if hwnd == unsafe { GetForegroundWindow() } {
            cover_soon();
        }
        return;
    }
    if event == EVENT_SYSTEM_MOVESIZEEND {
        cover_soon();
        return;
    }
    if event == EVENT_SYSTEM_FOREGROUND {
        // Alt+Tab passes through windows of its own: never the user's choice.
        let class = class_name(hwnd);
        if matches!(class.as_str(), "XamlExplorerHostIslandWindow" | "MultitaskingViewFrame" | "ForegroundStaging") {
            return;
        }
        with_state(|s| {
            s.seq += 1;
            let seq = s.seq + 1_000_000;
            s.last_used.insert(hwnd.0 as isize, seq);
            s.attention.remove(&(hwnd.0 as isize));
        });
        follow_front(hwnd);
    }
    let window = HWND(HOOK_WINDOW.load(Ordering::Relaxed) as *mut _);
    if !window.is_invalid() {
        unsafe {
            SetTimer(Some(window), SYNC_TIMER, SYNC_DELAY_MS, None);
        }
    }
}

/// Starts following the windows (once): the Dock has opened.
pub fn start(app: &AppHandle) {
    let _ = APP.set(app.clone());
    if HOOK_WINDOW.load(Ordering::Relaxed) != 0 {
        return;
    }
    // Claimed before the thread runs: two calls never start two threads.
    if HOOK_WINDOW.compare_exchange(0, -1, Ordering::SeqCst, Ordering::SeqCst).is_err() {
        return;
    }
    let spawned = std::thread::Builder::new().name("dock-windows".into()).spawn(|| unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let instance = GetModuleHandleW(None).unwrap_or_default();
        let class = w!("EasyIslandDockWindows");
        let wc = WNDCLASSW { lpfnWndProc: Some(wndproc), hInstance: instance.into(), lpszClassName: class, ..Default::default() };
        RegisterClassW(&wc);
        // A hidden top-level window: the shell hook is not sent to message-only ones.
        let Ok(hwnd) = CreateWindowExW(Default::default(), class, w!(""), Default::default(), 0, 0, 0, 0, None, None, Some(instance.into()), None)
        else {
            HOOK_WINDOW.store(0, Ordering::SeqCst);
            return;
        };
        HOOK_WINDOW.store(hwnd.0 as isize, Ordering::SeqCst);
        SHELL_MSG.store(RegisterWindowMessageW(w!("SHELLHOOK")), Ordering::SeqCst);
        let _ = RegisterShellHookWindow(hwnd);
        let flags = WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS;
        let hooks = [
            SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, None, Some(on_win_event), 0, 0, flags),
            SetWinEventHook(EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND, None, Some(on_win_event), 0, 0, flags),
            SetWinEventHook(EVENT_OBJECT_CLOAKED, EVENT_OBJECT_UNCLOAKED, None, Some(on_win_event), 0, 0, flags),
            SetWinEventHook(EVENT_SYSTEM_MOVESIZEEND, EVENT_SYSTEM_MOVESIZEEND, None, Some(on_win_event), 0, 0, flags),
        ];
        follow_front(GetForegroundWindow());
        PINS_WATCH.with(|w| *w.borrow_mut() = crate::regwatch::RegistryWatch::new(crate::applist::TASKBAND, false, hwnd.0 as isize, WM_PINS));
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        PINS_WATCH.with(|w| *w.borrow_mut() = None);
        follow_front(HWND::default());
        COVERED.store(-1, Ordering::SeqCst);
        FULLSCREEN.store(-1, Ordering::SeqCst);
        for h in hooks {
            if !h.is_invalid() {
                let _ = UnhookWinEvent(h);
            }
        }
        let _ = DeregisterShellHookWindow(hwnd);
        HOOK_WINDOW.store(0, Ordering::SeqCst);
        with_state(|s| *s = State::default());
    });
    if spawned.is_err() {
        HOOK_WINDOW.store(0, Ordering::SeqCst);
    }
}

/// Stops following the windows: the Dock's window is gone. Nothing runs after.
pub fn stop() {
    crate::winthumbs::clear();
    let hwnd = HOOK_WINDOW.load(Ordering::Relaxed);
    if hwnd > 0 {
        unsafe {
            let _ = PostMessageW(Some(HWND(hwnd as *mut _)), WM_STOP, WPARAM(0), LPARAM(0));
        }
    }
}

fn resync() {
    let hwnd = HOOK_WINDOW.load(Ordering::Relaxed);
    if hwnd > 0 {
        unsafe {
            let _ = PostMessageW(Some(HWND(hwnd as *mut _)), WM_RESYNC, WPARAM(0), LPARAM(0));
        }
    }
}

/* ------------------------------------------------------------ actions */

/// The windows of `app`, most recently used first.
fn windows_of(app: &str) -> Vec<isize> {
    with_state(|s| {
        // The Dock keys apps in lower case: ids compared ignoring case.
        let mut list: Vec<&Win> = s.sent.iter().filter(|w| w.app.eq_ignore_ascii_case(app)).collect();
        list.sort_by_key(|w| std::cmp::Reverse(w.last_used));
        list.into_iter().map(|w| w.hwnd).collect()
    })
    .unwrap_or_default()
}

/// Brings windows to the front, the first one focused; if all are minimized,
/// only the first comes back. Restoring and focusing are separate requests: a
/// shell flyout may refuse the focus, the window must not stay minimized.
/// `SwitchToThisWindow` restores windows of programs run as administrator, as Alt+Tab does.
fn activate(windows: &[isize]) {
    let handles = || windows.iter().map(|&h| HWND(h as *mut _));
    unsafe {
        let valid = |h: HWND| IsWindow(Some(h)).as_bool() && IsWindowVisible(h).as_bool();
        let Some(front) = handles().find(|&h| valid(h) && !IsIconic(h).as_bool()).or_else(|| handles().find(|&h| valid(h))) else {
            return;
        };
        if IsIconic(front).as_bool() && !ShowWindowAsync(front, SW_RESTORE).as_bool() {
            SwitchToThisWindow(front, true);
        }
        if !SetForegroundWindow(front).as_bool() && !focus_retrying(front) {
            return;
        }
        // Still minimized (a program run as administrator refused ShowWindow): the
        // system command passes where UIPI stops the rest.
        if IsIconic(front).as_bool() {
            let _ = PostMessageW(Some(front), WM_SYSCOMMAND, WPARAM(SC_RESTORE as usize), LPARAM(0));
        }
        // Activation across input queues is asynchronous: let it settle (a hung app answers no).
        if SendMessageTimeoutW(front, WM_NULL, WPARAM(0), LPARAM(0), SMTO_ABORTIFHUNG, 100, None).0 == 0 {
            return;
        }
        // The app's other windows right behind it, never above, only while it is still in front.
        if GetWindowLongW(front, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST.0 != 0 {
            return;
        }
        let mut previous = front;
        for h in handles() {
            if GetForegroundWindow() != front {
                break;
            }
            if h == front || !valid(h) || IsIconic(h).as_bool() || GetWindowLongW(h, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST.0 != 0 {
                continue;
            }
            let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_ASYNCWINDOWPOS;
            if SetWindowPos(h, Some(previous), 0, 0, 0, 0, flags).is_ok() {
                previous = h;
            }
        }
    }
}

/// A mouse button went down since the last call: the user clicked elsewhere.
fn new_press() -> bool {
    [VK_LBUTTON, VK_RBUTTON, VK_MBUTTON].iter().any(|vk| unsafe { GetAsyncKeyState(vk.0 as i32) } & 1 != 0)
}

/// Start, Search or the notification centre keep the focus and refuse it to
/// the window: Esc closes them first.
fn dismiss_shell_flyout() {
    const SHELL: [&str; 4] = ["\\shellexperiencehost.exe", "\\startmenuexperiencehost.exe", "\\searchhost.exe", "\\shellhost.exe"];
    let front = unsafe { GetForegroundWindow() };
    let mut pid = 0u32;
    unsafe {
        GetWindowThreadProcessId(front, Some(&mut pid));
    }
    if pid != 0 && SHELL.iter().any(|s| process_exe(pid).ends_with(s)) {
        tap(&[VK_ESCAPE]);
    }
}

/// The focus was refused: Start and the like closed, then asked again every
/// 20 ms for at most 600 ms, until the window has it; a click meanwhile means
/// the user moved on, and it is not taken back. True once the window is in front.
fn focus_retrying(front: HWND) -> bool {
    dismiss_shell_flyout();
    let _ = new_press();
    let started = std::time::Instant::now();
    while started.elapsed() < Duration::from_millis(600) {
        std::thread::sleep(Duration::from_millis(20));
        unsafe {
            if GetForegroundWindow() == front {
                return true;
            }
            if new_press() || !IsWindow(Some(front)).as_bool() {
                return false;
            }
            let _ = SetForegroundWindow(front);
        }
    }
    unsafe { GetForegroundWindow() == front }
}

/// Asynchronous: a program that does not answer never holds the Dock.
fn minimize(windows: &[isize]) {
    for &h in windows {
        let h = HWND(h as *mut _);
        unsafe {
            if IsWindowVisible(h).as_bool() && !IsIconic(h).as_bool() {
                let _ = ShowWindowAsync(h, SW_MINIMIZE);
            }
        }
    }
}

/// As the close button: each app may ask to save first.
fn close(windows: &[isize]) {
    for &h in windows {
        unsafe {
            let _ = PostMessageW(Some(HWND(h as *mut _)), WM_CLOSE, WPARAM(0), LPARAM(0));
        }
    }
}

/// The taskbar's click: the window (or the app's most recent one) in front and
/// not minimized goes down; otherwise it comes to the front. A minimized window
/// Windows still reports in front comes back on the first click.
fn click(windows: &[isize]) {
    let Some(&first) = windows.first() else { return };
    let h = HWND(first as *mut _);
    let in_front = unsafe { GetForegroundWindow() == h && !IsIconic(h).as_bool() };
    if in_front {
        minimize(&[first]);
    } else {
        activate(windows);
    }
}

/// Whether a process runs as administrator; one that cannot be opened counts as one.
fn process_is_elevated(pid: u32) -> bool {
    unsafe {
        let Ok(process) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid) else { return true };
        let mut token = HANDLE::default();
        let opened = OpenProcessToken(process, TOKEN_QUERY, &mut token).is_ok();
        let _ = CloseHandle(process);
        if !opened {
            return true;
        }
        let mut e = TOKEN_ELEVATION::default();
        let mut len = 0u32;
        let ok = GetTokenInformation(token, TokenElevation, Some((&raw mut e).cast()), size_of::<TOKEN_ELEVATION>() as u32, &mut len).is_ok();
        let _ = CloseHandle(token);
        !ok || e.TokenIsElevated != 0
    }
}

/// Presses keys together and releases them. Windows drops simulated keys aimed
/// at a program run as administrator: with one in front the Dock first takes
/// the focus (the user's click on it allows it), then the keys go to Windows.
fn tap(keys: &[VIRTUAL_KEY]) {
    unsafe {
        let front = GetForegroundWindow();
        let mut pid = 0u32;
        if !front.is_invalid() {
            GetWindowThreadProcessId(front, Some(&mut pid));
        }
        if pid != 0 && pid != GetCurrentProcessId() && process_is_elevated(pid) {
            if let Some(dock) = APP.get().and_then(|a| a.get_webview_window(DOCK_LABEL)).and_then(|w| w.hwnd().ok()) {
                let _ = SetForegroundWindow(HWND(dock.0));
            }
        }
        let key = |vk: VIRTUAL_KEY, flags: KEYBD_EVENT_FLAGS| INPUT {
            r#type: INPUT_KEYBOARD,
            Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: vk, dwFlags: flags, ..Default::default() } },
        };
        let inputs: Vec<INPUT> = keys
            .iter()
            .map(|&vk| key(vk, KEYBD_EVENT_FLAGS(0)))
            .chain(keys.iter().rev().map(|&vk| key(vk, KEYEVENTF_KEYUP)))
            .collect();
        SendInput(&inputs, size_of::<INPUT>() as i32);
    }
}

/// The system buttons: Windows' own shortcuts (docs/piano-dock.md).
fn system_keys(what: &str) -> Option<&'static [VIRTUAL_KEY]> {
    Some(match what {
        "start" => &[VK_LWIN],
        "quick-settings" => &[VK_LWIN, VK_A],
        "notifications" => &[VK_LWIN, VK_N],
        "search" => &[VK_LWIN, VK_S],
        "task-view" => &[VK_LWIN, VK_TAB],
        "widgets" => &[VK_LWIN, VK_W],
        // The output-device page of quick settings (Windows 11 22H2 and later).
        "sound" => &[VK_LWIN, VK_LCONTROL, VK_V],
        "show-desktop" => &[VK_LWIN, VK_D],
        _ => return None,
    })
}

/* ------------------------------------------------------------ commands */

fn com() {
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
}

/// The Dock opened: every open window (`[Win]`), then only changes in `dock-windows`.
#[tauri::command]
pub async fn dock_windows(app: AppHandle) -> Value {
    start(&app);
    tauri::async_runtime::spawn_blocking(move || {
        com();
        let (list, apps) = with_state(|s| {
            let now = read(s);
            let apps: Vec<String> = now.iter().map(|w| w.app.clone()).collect();
            s.icons_asked.extend(apps.iter().cloned());
            let list = Value::Array(now.iter().map(Win::json).collect());
            s.sent = now;
            (list, apps)
        })
        .unwrap_or((Value::Array(Vec::new()), Vec::new()));
        crate::applist::request_icons(&app, apps);
        list
    })
    .await
    .unwrap_or(Value::Array(Vec::new()))
}

/// What the Dock does. `what`: `click`, `activate` (also `focus`, `restore`), `minimize`, `close` (a
/// window by `hwnd`, else the app's windows), `close-all`, `minimize-all`,
/// `launch` / `launch-new` / `launch-admin` (`app`), `open-files` / `drop-files` (`app`,
/// `files`), `unpin` (`app`: unpinned from the Dock, so from the Windows
/// taskbar too), or a system button: `start`, `quick-settings`,
/// `notifications`, `search`, `task-view`, `widgets`, `sound`, `show-desktop`.
/// False when there was nothing to do it on.
#[tauri::command]
pub fn dock_do(what: String, hwnd: Option<isize>, app: Option<String>, files: Option<Vec<String>>) -> bool {
    let target = app.unwrap_or_default();
    // The Dock's own words for the same things.
    let what = match what.as_str() {
        "focus" | "restore" => "activate".to_string(),
        "drop-files" => "open-files".to_string(),
        _ => what,
    };
    // Windows given by the Dock must be ones it was shown: never any handle.
    let windows: Vec<isize> = match hwnd {
        Some(h) if is_known(h) => vec![h],
        Some(_) => return false,
        None if !target.is_empty() => windows_of(&target),
        None => Vec::new(),
    };
    if let Some(keys) = system_keys(&what) {
        let keys = keys.to_vec();
        std::thread::spawn(move || tap(&keys));
        return true;
    }
    match what.as_str() {
        "click" | "activate" | "minimize" | "close" | "close-all" | "minimize-all" => {
            if windows.is_empty() {
                if what == "click" && !target.is_empty() {
                    // A pinned app with no window: open it.
                    crate::applist::launch(crate::applist::Launch::Open { id: target });
                    return true;
                }
                return false;
            }
            std::thread::spawn(move || {
                match what.as_str() {
                    "click" => click(&windows),
                    "activate" => activate(&windows),
                    "minimize" | "minimize-all" => minimize(&windows),
                    _ => close(&windows),
                }
                std::thread::sleep(Duration::from_millis(60));
                resync();
            });
            true
        }
        "launch" | "launch-new" if !target.is_empty() => {
            crate::applist::launch(crate::applist::Launch::Open { id: target });
            true
        }
        "launch-admin" if !target.is_empty() => {
            crate::applist::launch(crate::applist::Launch::Admin { id: target });
            true
        }
        "open-files" if crate::applist::is_program(&target) => {
            let files: Vec<String> = files.unwrap_or_default().into_iter().filter(|f| std::path::Path::new(f).exists()).collect();
            if files.is_empty() {
                return false;
            }
            crate::applist::launch(crate::applist::Launch::Files { app: target, files });
            true
        }
        "unpin" if !target.is_empty() => {
            crate::applist::unpin_from_windows(&target);
            true
        }
        _ => false,
    }
}

/// What changed on the Windows taskbar's pins since last time (the first time:
/// all of them), for the Dock's own pins in the settings: `{ add: [{ id, name }],
/// remove: [id] }` or null. Later changes come as `dock-pins-windows`.
#[tauri::command]
pub async fn dock_pins_windows() -> Value {
    tauri::async_runtime::spawn_blocking(|| crate::applist::windows_pins_change().unwrap_or(Value::Null))
        .await
        .unwrap_or(Value::Null)
}

/// «Importa da Windows»: every app pinned on the Windows taskbar now.
#[tauri::command]
pub async fn dock_import_pinned() -> Vec<Value> {
    tauri::async_runtime::spawn_blocking(crate::applist::windows_pins_all).await.unwrap_or_default()
}

/// An app's recent documents for its menu: not yet (phase 4), always empty.
#[tauri::command]
pub fn dock_recent(app: String) -> Vec<String> {
    let _ = app;
    Vec::new()
}

/// Icons of these apps (pins, the catalog), sent in `dock-icons` as they are read.
#[tauri::command]
pub fn dock_icons(app: AppHandle, ids: Vec<String>) {
    crate::applist::request_icons(&app, ids.into_iter().take(500).collect());
}

/// Every installed app for «Aggiungi app»: `[{ id, name }]`.
#[tauri::command]
pub async fn apps_catalog() -> Value {
    tauri::async_runtime::spawn_blocking(crate::applist::apps_catalog).await.unwrap_or(Value::Array(Vec::new()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn win(hwnd: isize, title: &str) -> Win {
        Win { hwnd, app: "c:\\a.exe".into(), title: title.into(), active: false, minimized: false, attention: false, last_used: 1 }
    }

    #[test]
    fn the_dock_hears_only_what_changed() {
        let before = vec![win(1, "a"), win(2, "b")];
        assert!(diff(&before, &before).is_none());
        let now = vec![win(1, "a"), win(2, "b2"), win(3, "c")];
        let d = diff(&before, &now).unwrap();
        assert_eq!(d["add"].as_array().unwrap().len(), 1);
        assert_eq!(d["change"][0]["title"], "b2");
        assert_eq!(d["remove"].as_array().unwrap().len(), 0);
        let d = diff(&now, &[win(3, "c")]).unwrap();
        assert_eq!(d["remove"], json!([1, 2]));
    }

    #[test]
    fn only_a_window_over_the_whole_monitor_covers_it() {
        let screen = RECT { left: 0, top: 0, right: 1920, bottom: 1080 };
        assert!(covers(screen, screen));
        // Maximized above the Dock's band: its borders past the sides, not the bottom.
        assert!(!covers(RECT { left: -8, top: -8, right: 1928, bottom: 985 }, screen));
    }

    #[test]
    fn every_system_button_is_a_windows_shortcut() {
        for b in ["start", "quick-settings", "notifications", "search", "task-view", "widgets", "sound", "show-desktop"] {
            assert!(system_keys(b).is_some(), "{b}");
        }
        assert!(system_keys("rm -rf").is_none());
    }

    #[test]
    #[ignore = "reads the real windows of this desktop; nothing is shown or moved"]
    fn the_windows_now() {
        com();
        let mut s = State::default();
        for w in read(&mut s) {
            println!("{:>10} {:<60} {}", w.hwnd, w.app, w.title);
        }
    }
}
