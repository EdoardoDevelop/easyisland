// The Dock's window (docs/piano-dock.md; Edoardo, 19 Nov 2026): at the bottom
// of the screen, its own page (dock.html, src/dock/) in the same WebView2 as the
// other windows, made only while the Dock is on.
//
// - Fixed size: as wide as the monitor, tall enough for the magnified icons,
//   their labels and the shadow (`HEIGHT`). Never resized while the mouse moves
//   (that flickered and moved the other windows).
// - Clicks: only inside the shape the page sends (`dock_shape`: the capsule,
//   plus the magnified icons while the mouse is on them), a window region
//   (SetWindowRgn): outside it the clicks reach what is below, and at rest
//   nothing runs.
// - Room: its own appbar at the bottom keeps the band at rest (`dock_shape`'s
//   `band`) free for the other windows; none when it hides by itself.
// - The Windows taskbar: hidden while the Dock is on and the user chose so
//   (`dock_hides_taskbar`, taskbar_hide.rs with its guard), back otherwise.
// Separate from appbar.rs (the Top bar, tied to the island and the character):
// a mistake here cannot move the Top bar.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use tauri::{AppHandle, Manager, WebviewWindowBuilder};
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{CombineRgn, CreateRectRgn, DeleteObject, SetWindowRgn, HRGN, RGN_OR};
use windows::Win32::UI::Shell::{DefSubclassProc, SHAppBarMessage, SetWindowSubclass, ABE_BOTTOM, ABM_ACTIVATE, ABM_NEW, ABM_QUERYPOS, ABM_REMOVE, ABM_SETPOS, ABM_WINDOWPOSCHANGED, ABN_FULLSCREENAPP, ABN_POSCHANGED, APPBARDATA};
use windows::Win32::UI::WindowsAndMessaging::{RegisterWindowMessageW, WM_ACTIVATE, WM_APP, WM_DISPLAYCHANGE, WM_DPICHANGED, WM_WINDOWPOSCHANGED};

pub const LABEL: &str = "dock";
/// The window's height, logical px: band + magnified icons + labels + shadow.
const HEIGHT: f64 = 180.0;
/// The band kept free until the page says its own (logical px).
const DEFAULT_BAND: f64 = 64.0;
const CALLBACK: u32 = WM_APP + 0x52;
const SUBCLASS_ID: usize = 0xEA5C;
/// Taking the taskbar: Explorer may not have it yet (just signed in) or be busy.
const TAKE_TRIES: u32 = 50;
const TAKE_EVERY: Duration = Duration::from_millis(600);

static APP: OnceLock<AppHandle> = OnceLock::new();
/// The Dock's window registered as an appbar (its HWND).
static REGISTERED: Mutex<Option<isize>> = Mutex::new(None);
/// The band last given to the shell: the same again is not sent (the Top bar
/// and the Dock would answer each other's ABN_POSCHANGED forever).
static LAST_BAND: Mutex<Option<(isize, i32, i32, i32, i32)>> = Mutex::new(None);
/// The band at rest the page asked for (logical px; 0 = hides by itself).
static BAND: Mutex<f64> = Mutex::new(DEFAULT_BAND);
/// A full-screen app is in front: the Dock steps away.
pub static FULLSCREEN: AtomicBool = AtomicBool::new(false);
/// The guard runs (one per app run).
static GUARDED: AtomicBool = AtomicBool::new(false);
/// Bumped by each request to take the taskbar: an older retry loop stops.
static TAKE_GEN: AtomicU32 = AtomicU32::new(0);

fn taskbar_created() -> u32 {
    static MSG: OnceLock<u32> = OnceLock::new();
    *MSG.get_or_init(|| unsafe { RegisterWindowMessageW(w!("TaskbarCreated")) })
}

fn hwnd(raw: isize) -> HWND {
    HWND(raw as *mut _)
}

fn data(raw: isize) -> APPBARDATA {
    APPBARDATA { cbSize: std::mem::size_of::<APPBARDATA>() as u32, hWnd: hwnd(raw), uCallbackMessage: CALLBACK, uEdge: ABE_BOTTOM, ..Default::default() }
}

/// Follows the settings: the Dock made, placed and shown, or gone; the
/// Windows taskbar hidden or given back.
pub fn apply(app: &AppHandle) {
    let _ = APP.set(app.clone());
    let (on, hide_taskbar) = app.try_state::<crate::Shared>().map(|s| {
        let s = s.settings.lock().unwrap();
        (s.dock, s.dock && s.dock_hides_taskbar)
    }).unwrap_or((false, false));
    if hide_taskbar {
        take_taskbar();
    } else {
        TAKE_GEN.fetch_add(1, Ordering::SeqCst);
        if crate::taskbar_hide::taken() {
            std::thread::spawn(crate::taskbar_hide::give_back);
        }
    }
    crate::log::line(format!("dock: apply (accesa {on}, barra di Windows nascosta {hide_taskbar})"));
    if !on {
        remove(app);
        return;
    }
    let win = match app.get_webview_window(LABEL) {
        Some(w) => w,
        None => match build(app) {
            Some(w) => w,
            None => return,
        },
    };
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || place(&app2, &win));
}

fn build(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    let mut builder = WebviewWindowBuilder::new(app, LABEL, crate::page_url(app, "dock.html"));
    if let Some(dir) = crate::webview_dir() {
        builder = builder.data_directory(dir);
    }
    let built = builder
        .additional_browser_args(crate::BROWSER_ARGS)
        .title("EasyIsland Dock")
        .inner_size(800.0, HEIGHT)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .visible(false)
        .build();
    match built {
        Ok(win) => {
            crate::island::make_non_activating(&win.as_ref().window());
            // No clicks (and nothing drawn) until the page sends its shape:
            // a 180 px transparent strip across the screen would take them all.
            if let Ok(h) = win.hwnd() {
                set_region(h.0 as isize, &[]);
            }
            crate::webview_memory::set_low(win.as_ref(), true);
            Some(win)
        }
        Err(err) => {
            crate::log::line(format!("dock: finestra non creata: {err}"));
            None
        }
    }
}

/// On the main thread: the band reserved, the window at the bottom of the
/// island's monitor, shown (through tao, so it knows: see notices_window.rs).
fn place(app: &AppHandle, win: &tauri::WebviewWindow) {
    let Ok(raw) = win.hwnd().map(|h| h.0 as isize) else {
        crate::log::line("dock: finestra senza hwnd");
        return;
    };
    let screen = app.try_state::<crate::Shared>().map(|s| s.settings.lock().unwrap().screen.clone()).unwrap_or_default();
    let Some(m) = crate::island::target_monitor(app, &screen) else {
        crate::log::line("dock: nessuno schermo");
        return;
    };
    let (p, s, scale) = (m.position(), m.size(), m.scale_factor());
    let registered = *REGISTERED.lock().unwrap();
    if registered != Some(raw) {
        let mut abd = data(raw);
        if unsafe { SHAppBarMessage(ABM_NEW, &mut abd) } == 0 {
            crate::log::line("dock: fascia rifiutata da Windows");
        } else {
            unsafe {
                let _ = SetWindowSubclass(hwnd(raw), Some(subclass), SUBCLASS_ID, 0);
            }
            *REGISTERED.lock().unwrap() = Some(raw);
        }
    }
    let band = (*BAND.lock().unwrap() * scale).round() as i32;
    let mut abd = data(raw);
    abd.rc = RECT { left: p.x, top: p.y + s.height as i32 - band, right: p.x + s.width as i32, bottom: p.y + s.height as i32 };
    let wanted = (raw, abd.rc.left, abd.rc.top, abd.rc.right, abd.rc.bottom);
    let mut last = LAST_BAND.lock().unwrap();
    if *last != Some(wanted) {
        unsafe {
            SHAppBarMessage(ABM_QUERYPOS, &mut abd);
            abd.rc.top = abd.rc.bottom - band;
            SHAppBarMessage(ABM_SETPOS, &mut abd);
        }
        *last = Some(wanted);
    } else {
        abd.rc.bottom = p.y + s.height as i32;
    }
    drop(last);
    let h = (HEIGHT * scale).round() as i32;
    let sized = win.set_size(tauri::PhysicalSize::new(s.width, h as u32));
    let moved = win.set_position(tauri::PhysicalPosition::new(p.x, abd.rc.bottom - h));
    let shown = if FULLSCREEN.load(Ordering::Relaxed) { win.hide() } else { win.show() };
    crate::log::line(format!("dock: a {},{} {}x{} fascia {band}px (size {sized:?}, pos {moved:?}, show {shown:?})", p.x, abd.rc.bottom - h, s.width, h));
}

/// The page's shape: the band at rest (logical px from the bottom; 0 = hides
/// by itself) and the rectangles that take clicks (logical px in the window).
#[tauri::command]
pub fn dock_shape(app: AppHandle, band: f64, rects: Vec<[f64; 4]>) {
    let band = if band.is_finite() { band.clamp(0.0, HEIGHT) } else { DEFAULT_BAND };
    let band_changed = {
        let mut b = BAND.lock().unwrap();
        let changed = (*b - band).abs() > 0.5;
        *b = band;
        changed
    };
    let Some(win) = app.get_webview_window(LABEL) else { return };
    let scale = win.scale_factor().unwrap_or(1.0);
    let Ok(raw) = win.hwnd().map(|h| h.0 as isize) else { return };
    let rects: Vec<(i32, i32, i32, i32)> = rects
        .iter()
        .filter(|r| r.iter().all(|v| v.is_finite()) && r[2] > 0.0 && r[3] > 0.0)
        .take(64)
        .map(|r| ((r[0] * scale).floor() as i32, (r[1] * scale).floor() as i32, ((r[0] + r[2]) * scale).ceil() as i32, ((r[1] + r[3]) * scale).ceil() as i32))
        .collect();
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        set_region(raw, &rects);
        if band_changed {
            place(&app2, &win);
        }
    });
}

/// Clicks only inside `rects` (window px); none at all for an empty shape.
fn set_region(raw: isize, rects: &[(i32, i32, i32, i32)]) {
    unsafe {
        let all: HRGN = CreateRectRgn(0, 0, 0, 0);
        for &(l, t, r, b) in rects {
            let one = CreateRectRgn(l, t, r, b);
            CombineRgn(Some(all), Some(all), Some(one), RGN_OR);
            let _ = DeleteObject(one.into());
        }
        // The system owns the region from here on.
        SetWindowRgn(hwnd(raw), Some(all), true);
    }
}

/// Explorer restarted, the Dock's own messages: the band again, the taskbar taken again.
unsafe extern "system" fn subclass(h: HWND, msg: u32, wp: WPARAM, lp: LPARAM, _id: usize, _data: usize) -> LRESULT {
    let raw = h.0 as isize;
    match msg {
        CALLBACK => match wp.0 as u32 {
            ABN_POSCHANGED => later(Duration::from_millis(50)),
            ABN_FULLSCREENAPP => {
                FULLSCREEN.store(lp.0 != 0, Ordering::Relaxed);
                later(Duration::ZERO);
            }
            _ => {}
        },
        WM_DISPLAYCHANGE | WM_DPICHANGED => later(Duration::from_millis(1500)),
        m if m != 0 && m == taskbar_created() => {
            // The shell forgot every bar: registered again, the taskbar taken again.
            *REGISTERED.lock().unwrap() = None;
            *LAST_BAND.lock().unwrap() = None;
            later(Duration::from_millis(600));
        }
        WM_ACTIVATE => {
            let mut abd = data(raw);
            SHAppBarMessage(ABM_ACTIVATE, &mut abd);
        }
        WM_WINDOWPOSCHANGED => {
            let mut abd = data(raw);
            SHAppBarMessage(ABM_WINDOWPOSCHANGED, &mut abd);
        }
        _ => {}
    }
    DefSubclassProc(h, msg, wp, lp)
}

/// `apply` again a moment later, outside the message being handled.
fn later(after: Duration) {
    std::thread::spawn(move || {
        std::thread::sleep(after);
        if let Some(app) = APP.get() {
            apply(app);
        }
    });
}

/// The taskbar taken on a thread of its own (Explorer can block), retried
/// while Explorer is not ready; the guard started once.
fn take_taskbar() {
    if !GUARDED.swap(true, Ordering::SeqCst) {
        crate::taskbar_hide::spawn_guard();
    }
    let gen = TAKE_GEN.fetch_add(1, Ordering::SeqCst).wrapping_add(1);
    std::thread::spawn(move || {
        for _ in 0..TAKE_TRIES {
            if TAKE_GEN.load(Ordering::SeqCst) != gen {
                return;
            }
            if crate::taskbar_hide::take_over() {
                return;
            }
            std::thread::sleep(TAKE_EVERY);
        }
        crate::log::line("dock: barra di Windows non presa dopo 50 tentativi; di nuovo al riavvio di Explorer");
    });
}

/// The Dock off: its band given back, its window gone.
pub fn remove(app: &AppHandle) {
    let registered = REGISTERED.lock().unwrap().take();
    *LAST_BAND.lock().unwrap() = None;
    if let Some(raw) = registered {
        let mut abd = data(raw);
        unsafe { SHAppBarMessage(ABM_REMOVE, &mut abd) };
    }
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.destroy();
    }
}

/// At exit: the band and the taskbar given back (the guard would too).
pub fn shutdown() {
    let registered = REGISTERED.lock().unwrap().take();
    if let Some(raw) = registered {
        let mut abd = data(raw);
        unsafe { SHAppBarMessage(ABM_REMOVE, &mut abd) };
    }
    TAKE_GEN.fetch_add(1, Ordering::SeqCst);
    if crate::taskbar_hide::taken() {
        crate::taskbar_hide::give_back_on_exit();
    }
}

/// «Ripristina barra di Windows adesso» (Settings → Dock): back now, whatever
/// the setting (the page turns the setting off too). True when it is visible.
#[tauri::command]
pub fn dock_restore_taskbar() -> bool {
    TAKE_GEN.fetch_add(1, Ordering::SeqCst);
    crate::taskbar_hide::give_back();
    !crate::taskbar_hide::taken()
}

/// Windows' own «Animation effects» (Settings → Accessibility → Visual
/// effects): off, the Dock's movements would look broken, so Settings says so.
#[tauri::command]
pub fn windows_animations() -> bool {
    use windows::Win32::UI::WindowsAndMessaging::{SystemParametersInfoW, SPI_GETCLIENTAREAANIMATION, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS};
    let mut on = windows::core::BOOL(1);
    unsafe {
        let _ = SystemParametersInfoW(SPI_GETCLIENTAREAANIMATION, 0, Some(&mut on as *mut _ as *mut _), SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0));
    }
    on.as_bool()
}

/// That Windows page.
#[tauri::command]
pub fn open_animation_settings() {
    let _ = std::process::Command::new("explorer.exe").arg("ms-settings:easeofaccess-visualeffects").spawn();
}

/// A full-screen app came or went (taskwin.rs: with the Windows taskbar
/// hidden the shell's ABN_FULLSCREENAPP does not hold). The Dock steps away.
pub fn set_fullscreen(on: bool) {
    if FULLSCREEN.swap(on, Ordering::Relaxed) == on {
        return;
    }
    let Some(app) = APP.get() else { return };
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = if on { win.hide() } else { win.show() };
    }
}
