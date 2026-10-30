// «Barra fissa» (asked by Edoardo on 27 Oct 2026, docs/architettura.md → «Barra fissa»): a band
// at the top or bottom of the screen that Windows keeps free, like the taskbar,
// so maximised and snapped windows stop at its edge.
//
// The character's own window is the bar (on top of the
// two windows of docs/architettura.md → «Finestra del personaggio»):
// registered with SHAppBarMessage, as wide as the monitor and as tall as the
// band, always in front, taking the whole mouse. The island is a window of its
// own: hidden while closed, it opens against the band (the work area ends
// there), so it is never under the bar and can go behind other apps.
// The shell's notifications reach the bar through a window subclass: at rest
// nothing runs. ABM_REMOVE gives the space back when the setting goes off and
// when the app exits. After a display change (a monitor off and on, another
// monitor, a new resolution) or an Explorer restart the shell's record of the
// band goes stale, so the bar is taken off and registered again once the
// screens have settled (`display_changed`).

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use tauri::{AppHandle, Manager};
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::UI::Shell::{
    DefSubclassProc, RemoveWindowSubclass, SHAppBarMessage, SetWindowSubclass, ABE_BOTTOM, ABE_TOP, ABM_ACTIVATE,
    ABM_NEW, ABM_QUERYPOS, ABM_REMOVE, ABM_SETPOS, ABM_WINDOWPOSCHANGED, ABN_FULLSCREENAPP, ABN_POSCHANGED, APPBARDATA,
};
use windows::core::w;
use windows::Win32::UI::WindowsAndMessaging::{
    RegisterWindowMessageW, WM_ACTIVATE, WM_APP, WM_DISPLAYCHANGE, WM_DPICHANGED, WM_WINDOWPOSCHANGED,
};

/// The shell's notifications (ABN_*) arrive as this message.
const CALLBACK: u32 = WM_APP + 0x51;
const SUBCLASS_ID: usize = 0xEA5B;

static APP: OnceLock<AppHandle> = OnceLock::new();

/// The band as registered: the character's window and the band (physical px).
#[derive(Clone, Copy)]
struct Registered {
    hwnd: isize,
    edge: u32,
    rect: (i32, i32, i32, i32),
}

static REGISTERED: Mutex<Option<Registered>> = Mutex::new(None);
/// Inside `place`: the shell's answer to our own move is not a new move.
static PLACING: AtomicBool = AtomicBool::new(false);
/// A full-screen app is on the bar's monitor (ABN_FULLSCREENAPP): the bar steps away.
pub static FULLSCREEN: AtomicBool = AtomicBool::new(false);
/// Bumped by every display change: only the last of a burst registers again.
static DISPLAY_GEN: AtomicU32 = AtomicU32::new(0);
/// A monitor waking up sends several changes in a row and reports its size late.
const SETTLE: Duration = Duration::from_millis(1500);
/// The shell frees the old band a moment after ABM_REMOVE: registering at once
/// put the new band right under the ghost of the old one, off the edge.
const FREED: Duration = Duration::from_millis(500);
/// One more look after registering again, once the work area is final.
const RECHECK: Duration = Duration::from_millis(1500);

/// Sent to every top-level window when Explorer (and so the taskbar) restarts:
/// the shell has forgotten every bar.
fn taskbar_created() -> u32 {
    static MSG: OnceLock<u32> = OnceLock::new();
    *MSG.get_or_init(|| unsafe { RegisterWindowMessageW(w!("TaskbarCreated")) })
}

fn edge_of(setting: &str) -> Option<u32> {
    match setting {
        "top" => Some(ABE_TOP),
        "bottom" => Some(ABE_BOTTOM),
        _ => None,
    }
}

fn hwnd(raw: isize) -> HWND {
    HWND(raw as *mut _)
}

fn data(raw: isize, edge: u32) -> APPBARDATA {
    APPBARDATA {
        cbSize: std::mem::size_of::<APPBARDATA>() as u32,
        hWnd: hwnd(raw),
        uCallbackMessage: CALLBACK,
        uEdge: edge,
        ..Default::default()
    }
}

/// The reserved band (physical px: x, y, width, height), when the bar is on:
/// where the character's window goes (sync_character).
pub fn band() -> Option<(i32, i32, u32, u32)> {
    REGISTERED.lock().unwrap().map(|r| {
        let (l, t, rr, b) = r.rect;
        (l, t, (rr - l).max(0) as u32, (b - t).max(0) as u32)
    })
}

/// Follows the setting: registers the character's window as the bar, moves
/// the band, or gives the space back.
pub fn apply(app: &AppHandle) {
    let _ = APP.set(app.clone());
    let setting = app.try_state::<crate::Shared>().map(|s| s.settings.lock().unwrap().fixed_bar.clone()).unwrap_or_default();
    let Some(edge) = edge_of(&setting) else {
        remove(app);
        return;
    };
    let Some(raw) = app.get_window(crate::CHARACTER_LABEL).and_then(|w| crate::island::hwnd_of(&w)).map(|h| h.0 as isize) else { return };
    // Copied out first: run_on_main_thread runs the closure right away when
    // already on the main thread (a settings save), and `place` locks it again.
    let registered = *REGISTERED.lock().unwrap();
    let _ = app.run_on_main_thread(move || match registered {
        Some(r) if r.hwnd == raw => place(raw, edge),
        _ => register(raw, edge),
    });
}

/// On the main thread: the shell learns about the bar, and the bar its place.
fn register(raw: isize, edge: u32) {
    let mut abd = data(raw, edge);
    if unsafe { SHAppBarMessage(ABM_NEW, &mut abd) } == 0 {
        crate::log::line("barra fissa: registrazione rifiutata da Windows".to_string());
        return;
    }
    let _ = taskbar_created();
    unsafe {
        let _ = SetWindowSubclass(hwnd(raw), Some(subclass), SUBCLASS_ID, 0);
    }
    *REGISTERED.lock().unwrap() = Some(Registered { hwnd: raw, edge, rect: (0, 0, 0, 0) });
    crate::log::line(format!("barra fissa: registrata ({})", if edge == ABE_TOP { "in alto" } else { "in basso" }));
    place(raw, edge);
}

/// Asks the shell for the band on the island's monitor; the island follows.
fn place(raw: isize, edge: u32) {
    if PLACING.swap(true, Ordering::SeqCst) {
        return;
    }
    let moved = reserve(raw, edge);
    PLACING.store(false, Ordering::SeqCst);
    if moved {
        if let Some(app) = APP.get() {
            island_follows(app);
        }
    }
}

/// The band's rect for the shell; true when it changed.
fn reserve(raw: isize, edge: u32) -> bool {
    let Some(app) = APP.get() else { return false };
    let Some(shared) = app.try_state::<crate::Shared>() else { return false };
    let (screen, bar_h) = {
        let s = shared.settings.lock().unwrap();
        (s.screen.clone(), s.bar_thickness())
    };
    let Some(m) = crate::island::target_monitor(app, &screen) else { return false };
    let (p, s) = (m.position(), m.size());
    let thick = (bar_h * m.scale_factor()).round() as i32;
    let mut abd = data(raw, edge);
    abd.rc = RECT { left: p.x, top: p.y, right: p.x + s.width as i32, bottom: p.y + s.height as i32 };
    // The shell moves the proposal off the taskbar and other bars; the
    // thickness is put back on the side it settled.
    if edge == ABE_TOP {
        abd.rc.bottom = abd.rc.top + thick;
    } else {
        abd.rc.top = abd.rc.bottom - thick;
    }
    unsafe { SHAppBarMessage(ABM_QUERYPOS, &mut abd) };
    if edge == ABE_TOP {
        abd.rc.bottom = abd.rc.top + thick;
    } else {
        abd.rc.top = abd.rc.bottom - thick;
    }
    unsafe { SHAppBarMessage(ABM_SETPOS, &mut abd) };
    let rc = (abd.rc.left, abd.rc.top, abd.rc.right, abd.rc.bottom);
    let monitor_edge = if edge == ABE_TOP { p.y } else { p.y + s.height as i32 };
    let band_edge = if edge == ABE_TOP { rc.1 } else { rc.3 };
    if band_edge != monitor_edge {
        crate::log::line(format!("barra fissa: fascia a {} px dal bordo (altre barre?)", (band_edge - monitor_edge).abs()));
    }
    let mut reg = REGISTERED.lock().unwrap();
    match reg.as_mut() {
        Some(r) if r.hwnd == raw => {
            let changed = r.rect != rc || r.edge != edge;
            r.edge = edge;
            r.rect = rc;
            changed
        }
        _ => false,
    }
}

/// The band moved or went: the bar takes its place, the island goes back to
/// its own (the work area changed), and the front end learns the new room.
fn island_follows(app: &AppHandle) {
    use tauri::Emitter;
    let Some(shared) = app.try_state::<crate::Shared>() else { return };
    let settings = shared.settings.lock().unwrap().clone();
    let collapsed = shared.gate.collapsed.load(Ordering::Relaxed);
    crate::sync_character(app);
    crate::island::apply_geometry(app, &shared.gate, &settings, collapsed);
    let _ = app.emit_to(crate::island::WINDOW_LABEL, "screen-changed", ());
}

/// The shell's notifications and the window's own moves; nothing runs between them.
unsafe extern "system" fn subclass(h: HWND, msg: u32, wp: WPARAM, lp: LPARAM, _id: usize, _data: usize) -> LRESULT {
    let raw = h.0 as isize;
    let edge = REGISTERED.lock().unwrap().filter(|r| r.hwnd == raw).map(|r| r.edge);
    if let Some(edge) = edge {
        match msg {
            CALLBACK => match wp.0 as u32 {
                ABN_POSCHANGED => place(raw, edge),
                // A full-screen app (video, game, presentation) on this monitor:
                // the bar steps away and comes back after.
                ABN_FULLSCREENAPP => full_screen(lp.0 != 0),
                _ => {}
            },
            WM_DISPLAYCHANGE | WM_DPICHANGED => display_changed(),
            m if m != 0 && m == taskbar_created() => display_changed(),
            WM_ACTIVATE => {
                let mut abd = data(raw, edge);
                SHAppBarMessage(ABM_ACTIVATE, &mut abd);
            }
            WM_WINDOWPOSCHANGED if !PLACING.load(Ordering::Relaxed) => {
                let mut abd = data(raw, edge);
                SHAppBarMessage(ABM_WINDOWPOSCHANGED, &mut abd);
            }
            _ => {}
        }
    }
    DefSubclassProc(h, msg, wp, lp)
}

/// Off and on again once the screens have settled: moving the old band is not
/// enough after a monitor went off or changed, the shell keeps the old size.
fn display_changed() {
    let gen = DISPLAY_GEN.fetch_add(1, Ordering::SeqCst).wrapping_add(1);
    std::thread::spawn(move || {
        std::thread::sleep(SETTLE);
        if DISPLAY_GEN.load(Ordering::SeqCst) != gen {
            return;
        }
        let Some(app) = APP.get() else { return };
        let _ = app.run_on_main_thread(reregister);
    });
}

/// On the main thread: the old registration goes, `apply` makes a new one on
/// today's monitor (or none, if the setting went off meanwhile).
fn reregister() {
    // Taken out first: ABM_REMOVE may reach our window proc, which locks it.
    let registered = REGISTERED.lock().unwrap().take();
    let Some(r) = registered else { return };
    let mut abd = data(r.hwnd, r.edge);
    unsafe {
        SHAppBarMessage(ABM_REMOVE, &mut abd);
        let _ = RemoveWindowSubclass(hwnd(r.hwnd), Some(subclass), SUBCLASS_ID);
    }
    FULLSCREEN.store(false, Ordering::Relaxed);
    crate::log::line("barra fissa: schermo cambiato, registrata di nuovo".to_string());
    std::thread::spawn(|| {
        std::thread::sleep(FREED);
        let Some(app) = APP.get() else { return };
        apply(app);
        std::thread::sleep(RECHECK);
        apply(app);
    });
}

/// The bar hides over a full-screen app (video, game, presentation) and comes back after.
fn full_screen(on: bool) {
    FULLSCREEN.store(on, Ordering::Relaxed);
    let Some(app) = APP.get() else { return };
    crate::sync_character(app);
    crate::log::line(format!("barra fissa: schermo intero {on}"));
}

/// The space goes back to the windows; the island is an island again.
pub fn remove(app: &AppHandle) {
    let registered = REGISTERED.lock().unwrap().take();
    let Some(r) = registered else { return };
    let mut abd = data(r.hwnd, r.edge);
    unsafe {
        SHAppBarMessage(ABM_REMOVE, &mut abd);
        let _ = RemoveWindowSubclass(hwnd(r.hwnd), Some(subclass), SUBCLASS_ID);
    }
    FULLSCREEN.store(false, Ordering::Relaxed);
    crate::log::line("barra fissa: tolta".to_string());
    island_follows(app);
}

/// At exit: only the shell's registration (the window goes with the app).
pub fn shutdown() {
    // Taken out first: ABM_REMOVE may reach our window proc, which locks it.
    let registered = REGISTERED.lock().unwrap().take();
    if let Some(r) = registered {
        let mut abd = data(r.hwnd, r.edge);
        unsafe { SHAppBarMessage(ABM_REMOVE, &mut abd) };
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_top_and_bottom_are_bars() {
        assert_eq!(edge_of("top"), Some(ABE_TOP));
        assert_eq!(edge_of("bottom"), Some(ABE_BOTTOM));
        assert_eq!(edge_of(""), None);
        assert_eq!(edge_of("left"), None);
    }
}
