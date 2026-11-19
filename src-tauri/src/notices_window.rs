// The notices' own window (Edoardo, 17 Nov 2026: «qualsiasi notifica deve
// essere meno invasiva … separate dall'isola»). Like the popped-out views
// (popout.ts) it is a blank page drawn by the island's page (src/notices/),
// so the island keeps the one brain; unlike them it has no frame, is
// transparent, stays in front, is out of the taskbar and never takes the
// focus (as the character's window: clicks yes, keys never). Hidden when
// there is nothing to say: no frames, CPU ~0.

use std::sync::atomic::Ordering;
use std::sync::Mutex;

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

/// Its width (logical px): the toasts are laid out for it.
pub const WIDTH: f64 = 340.0;
/// Room from the screen's edges and from the island (logical px).
const MARGIN: f64 = 12.0;

/// Its name, once made.
static LABEL: Mutex<Option<String>> = Mutex::new(None);
/// A new name each time it is made again (a window just closed may still hold the old one).
static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);

/// Made by popout_window (lib.rs) when the island asked for the notices'
/// window (Bridge.popoutKind("avvisi") right before window.open).
pub fn build(app: &AppHandle, features: tauri::webview::NewWindowFeatures) -> tauri::Result<tauri::WebviewWindow> {
    // A window made before (the island's page lost it, e.g. after a reload)
    // goes: nobody would hide it again, and it stayed in front, empty and
    // transparent, taking the clicks (laptop, 19 Nov 2026).
    for old in others(app, None) {
        let _ = old.hide();
        let _ = old.destroy();
    }
    let label = format!("avvisi-{}", NEXT.fetch_add(1, Ordering::Relaxed));
    let built = WebviewWindowBuilder::new(app, &label, WebviewUrl::External("about:blank".parse().expect("about:blank")))
        .window_features(features)
        .title("EasyIsland")
        .inner_size(WIDTH, 120.0)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .maximizable(false)
        .minimizable(false)
        .visible(false)
        .build()?;
    crate::island::make_non_activating(&built.as_ref().window());
    *LABEL.lock().unwrap_or_else(|e| e.into_inner()) = Some(label);
    Ok(built)
}

/// Every notices' window but `keep`.
fn others(app: &AppHandle, keep: Option<&str>) -> Vec<tauri::Window> {
    app.windows().into_iter().filter(|(label, _)| label.starts_with("avvisi-") && Some(label.as_str()) != keep).map(|(_, w)| w).collect()
}

fn window(app: &AppHandle) -> Option<tauri::Window> {
    let label = LABEL.lock().unwrap_or_else(|e| e.into_inner()).clone()?;
    app.get_window(&label)
}

/// Where the toasts go (physical px, top-left), for a stack `w`×`h` (physical).
/// `place`: "isola" under the island when it rests (beside it, top right, when
/// it is open, not to cover it), "alto-destra", "basso-destra".
fn spot(place: &str, area: (i32, i32, u32, u32), island: Option<(i32, i32, u32, u32)>, open: bool, size: (i32, i32), margin: i32) -> (i32, i32) {
    let (ax, ay, aw, ah) = (area.0, area.1, area.2 as i32, area.3 as i32);
    let (w, h) = size;
    let right = ax + aw - w - margin;
    match place {
        "basso-destra" => (right, ay + ah - h - margin),
        "isola" if !open => match island {
            // Under the resting island, centred on it.
            Some((ix, iy, iw, ih)) => ((ix + iw as i32 / 2 - w / 2).clamp(ax + margin, right), (iy + ih as i32 + margin).min(ay + ah - h - margin)),
            None => (ax + aw / 2 - w / 2, ay + margin),
        },
        _ => (right, ay + margin),
    }
}

/// The island's page laid out `height` (logical px) of toasts: the window
/// takes that size and its place, shown without taking the focus.
#[tauri::command]
pub fn notices_show(app: AppHandle, height: f64, place: String) {
    let Some(win) = window(&app) else { return };
    let settings = app.state::<crate::Shared>().settings.lock().unwrap().clone();
    let Some((area, scale)) = crate::island::work_area(&app, &settings) else { return };
    let open = !app.state::<crate::Shared>().gate.collapsed.load(Ordering::Relaxed);
    let island = app.get_window(crate::island::WINDOW_LABEL).and_then(|w| {
        let p = w.outer_position().ok()?;
        let s = w.outer_size().ok()?;
        Some((p.x, p.y, s.width, s.height))
    });
    let height = if height.is_finite() { height.clamp(40.0, 900.0) } else { 120.0 };
    let size = ((WIDTH * scale).round() as i32, (height * scale).round() as i32);
    let (x, y) = spot(&place, area, island, open, size, (MARGIN * scale).round() as i32);
    for old in others(&app, Some(win.label())) {
        let _ = old.hide();
    }
    show_at(&win, x, y, size.0, size.1);
}

/// Nothing to say: hidden (no frames while hidden).
#[tauri::command]
pub fn notices_hide(app: AppHandle) {
    // All of them: one the island's page lost track of included.
    for win in others(&app, None) {
        let _ = win.hide();
    }
}

/// Size, place and show in one call, in front, never activated.
fn show_at(win: &tauri::Window, x: i32, y: i32, w: i32, h: i32) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{SetWindowPos, ShowWindow, HWND_TOPMOST, SWP_NOACTIVATE, SWP_SHOWWINDOW, SW_SHOWNOACTIVATE};
    let Ok(raw) = win.hwnd() else { return };
    let hwnd = HWND(raw.0);
    unsafe {
        let _ = SetWindowPos(hwnd, Some(HWND_TOPMOST), x, y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW);
        let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
    }
}

#[cfg(test)]
mod tests {
    use super::spot;

    #[test]
    fn where_the_toasts_go() {
        let area = (0, 0, 1920, 1040);
        let island = Some((760, 0, 400, 60));
        // Under the resting island, centred on it; beside it, top right, when it is open.
        assert_eq!(spot("isola", area, island, false, (340, 200), 12), (790, 72));
        assert_eq!(spot("isola", area, island, true, (340, 200), 12), (1568, 12));
        assert_eq!(spot("alto-destra", area, island, false, (340, 200), 12), (1568, 12));
        assert_eq!(spot("basso-destra", area, island, false, (340, 200), 12), (1568, 828));
        // An island at the right edge: the toasts stay on the screen.
        assert_eq!(spot("isola", area, Some((1800, 0, 120, 60)), false, (340, 200), 12).0, 1568);
    }
}
