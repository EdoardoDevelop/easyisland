// Where each popped-out window (the Launcher, the chat, an integration) was
// when it closed, as Windows apps do: it opens there again, at that size,
// maximized if it was. Kept in physical pixels by Rust (finestre.json in the
// local folder): the page's screenX and window.open's left/top disagreed at
// 125 % and on the second screen, the windows came back elsewhere (26 Nov 2026).

use std::collections::HashMap;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

#[derive(Clone, Copy, Serialize, Deserialize, Default)]
pub struct Place {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
    #[serde(default)]
    pub max: bool,
}

/// The window's name (`staccata-N`) → its key (popout.ts), from popout_place.
static KEYS: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);
static PLACES: Mutex<Option<HashMap<String, Place>>> = Mutex::new(None);

fn file() -> std::path::PathBuf {
    crate::settings::local_dir().join("finestre.json")
}

fn with_places<R>(f: impl FnOnce(&mut HashMap<String, Place>) -> R) -> R {
    let mut g = PLACES.lock().unwrap_or_else(|e| e.into_inner());
    let map = g.get_or_insert_with(|| {
        std::fs::read_to_string(file()).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
    });
    f(map)
}

fn key_of(name: &str) -> Option<String> {
    KEYS.lock().unwrap_or_else(|e| e.into_inner()).as_ref().and_then(|m| m.get(name).cloned())
}

/// The title bar of `p` is on one of the screens (a screen unplugged since: not).
fn on_screen(app: &AppHandle, p: &Place) -> bool {
    let (x, y) = (p.x + 120, p.y + 12);
    app.available_monitors().unwrap_or_default().iter().any(|m| {
        let (mx, my) = (m.position().x, m.position().y);
        let (mw, mh) = (m.size().width as i32, m.size().height as i32);
        x >= mx && x < mx + mw && y >= my && y < my + mh
    })
}

/// `p` made to fit the work area of the screen its title bar is on: smaller if
/// it must, then moved in. Maximized ones are left to Windows.
fn fit(app: &AppHandle, mut p: Place) -> Place {
    if p.max {
        return p;
    }
    let (x, y) = (p.x + 120, p.y + 12);
    let Some(m) = app.available_monitors().unwrap_or_default().into_iter().find(|m| {
        let (mx, my) = (m.position().x, m.position().y);
        let (mw, mh) = (m.size().width as i32, m.size().height as i32);
        x >= mx && x < mx + mw && y >= my && y < my + mh
    }) else {
        return p;
    };
    let area = m.work_area();
    let (ax, ay) = (area.position.x, area.position.y);
    let (aw, ah) = (area.size.width.max(1) as i32, area.size.height.max(1) as i32);
    // `w`/`h` are the inside (inner_size), `x`/`y` the frame's corner
    // (outer_position): the frame's title bar and borders count too.
    let k = m.scale_factor();
    let (fw, fh) = ((16.0 * k).round() as i32, (40.0 * k).round() as i32);
    p.w = (p.w as i32).min(aw - fw).max(300) as u32;
    p.h = (p.h as i32).min(ah - fh).max(240) as u32;
    p.x = p.x.clamp(ax, (ax + aw - p.w as i32 - fw).max(ax));
    p.y = p.y.clamp(ay, (ay + ah - p.h as i32 - fh).max(ay));
    p
}

/// The window `name` is the one of `key`: placed where it was last time (or
/// at `at`, logical screen px, where it was dropped; or centred), then shown in
/// front. `activate` false (opened by a notice or a permission, not by the
/// user): shown without taking the keyboard from the app being typed in.
pub fn place(app: &AppHandle, name: &str, key: &str, at: Option<(f64, f64)>, activate: bool) -> bool {
    let Some(placed) = restore(app, name, key, at) else { return false };
    let Some(w) = app.get_window(name) else { return false };
    show(&w, activate);
    placed
}

/// Shown in front, taking the keyboard or (`activate` false) leaving it to the
/// app being typed in; back from the taskbar if it was minimized.
pub fn show(w: &tauri::Window, activate: bool) {
    if activate {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        if let Ok(h) = w.hwnd() {
            crate::search_window::bring_hwnd_forward(h.0);
        }
    } else if let Ok(h) = w.hwnd() {
        // As it is (maximized stays so); minimized, back from the taskbar.
        // Neither takes the keyboard. Tauri does not see this show: hide the
        // window with `hide` below, or Tauri's own hide does nothing.
        use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_SHOWNA, SW_SHOWNOACTIVATE};
        let how = if w.is_minimized().unwrap_or(false) { SW_SHOWNOACTIVATE } else { SW_SHOWNA };
        let _ = unsafe { ShowWindow(windows::Win32::Foundation::HWND(h.0), how) };
    }
}

/// Hidden for Tauri and for Windows: a window shown by `show` without the
/// keyboard is visible behind Tauri's back, and Tauri's hide alone left the
/// Launcher on the screen with its page closed (27 Nov 2026).
pub fn hide(w: &tauri::Window) {
    let _ = w.hide();
    if let Ok(h) = w.hwnd() {
        use windows::Win32::UI::WindowsAndMessaging::{ShowWindow, SW_HIDE};
        let _ = unsafe { ShowWindow(windows::Win32::Foundation::HWND(h.0), SW_HIDE) };
    }
}

/// The window `name` sized and placed for `key`, not shown: `Some(true)` when
/// a remembered place was used, `None` without the window.
pub fn restore(app: &AppHandle, name: &str, key: &str, at: Option<(f64, f64)>) -> Option<bool> {
    KEYS.lock().unwrap_or_else(|e| e.into_inner()).get_or_insert_with(HashMap::new).insert(name.to_string(), key.to_string());
    let w = app.get_window(name)?;
    let saved = with_places(|m| m.get(key).copied()).filter(|p| p.w >= 300 && p.h >= 240 && on_screen(app, p));
    if let Some((x, y)) = at {
        let _ = w.set_position(tauri::LogicalPosition::new(x - 80.0, y - 16.0));
    } else if let Some(p) = saved {
        // Inside the work area of its screen: a place kept from another screen
        // layout (a second monitor gone, another resolution) had the Launcher
        // out past the right and bottom edges (26 Nov 2026).
        let p = fit(app, p);
        let _ = w.set_size(tauri::PhysicalSize::new(p.w, p.h));
        let _ = w.set_position(tauri::PhysicalPosition::new(p.x, p.y));
        if p.max {
            let _ = w.maximize();
        }
    } else {
        let _ = w.center();
    }
    Some(saved.is_some() && at.is_none())
}

/// The window `name` is closing: where it is now, kept for its key.
pub fn remember(app: &AppHandle, name: &str) {
    let Some(key) = key_of(name) else { return };
    let Some(win) = app.get_window(name) else { return };
    if win.is_minimized().unwrap_or(false) {
        return;
    }
    let max = win.is_maximized().unwrap_or(false);
    let place = if max {
        // Maximized: the size it goes back to stays the one it had.
        with_places(|m| m.get(&key).copied()).map(|p| Place { max: true, ..p })
    } else {
        match (win.outer_position(), win.inner_size()) {
            (Ok(pos), Ok(size)) => Some(Place { x: pos.x, y: pos.y, w: size.width, h: size.height, max: false }),
            _ => None,
        }
    };
    let Some(place) = place else { return };
    let text = with_places(|m| {
        m.insert(key, place);
        serde_json::to_string_pretty(m).ok()
    });
    if let Some(text) = text {
        let _ = std::fs::write(file(), text);
    }
}
