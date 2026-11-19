// The search on its own (the search shortcut), in a window of its own: the
// island stays as it is, open on its view or closed (Edoardo, 17 Nov 2026:
// «se l'isola è aperta e avvio la ricerca non si dovrebbe chiudere l'isola»).
// Like the popped-out views (popout.ts) the window is a blank page the
// island's page draws the search into (src/island/search-window.ts): state,
// results and actions stay in the island, nothing runs twice. Made once, then
// shown and hidden; hidden it costs nothing (no frames are drawn).

use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub const LABEL: &str = "ricerca";
/// Its width (logical px), as the search-only island's.
const WIDTH: f64 = 640.0;

/// The window `window.open` asks for when the island opens the search's
/// (lib.rs popout_window, after popout_kind("ricerca")): no frame, transparent,
/// in front, out of the taskbar, hidden until placed.
pub fn build(app: &AppHandle, features: tauri::webview::NewWindowFeatures) -> tauri::Result<WebviewWindow> {
    WebviewWindowBuilder::new(app, LABEL, WebviewUrl::External("about:blank".parse().expect("about:blank")))
        .window_features(features)
        .title("EasyIsland")
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .maximizable(false)
        .minimizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()
}

/// Where on the work area (y, physical): "alto" a little under the top edge,
/// "basso" a little over the bottom one (it grows upward), "centro" centred
/// (Edoardo, 18 Nov 2026: «dammi la possibilità di decidere dove mettere la ricerca»).
fn top_of(place: &str, area_y: i32, area_h: i32, h: i32) -> i32 {
    let margin = area_h / 12;
    match place {
        "alto" => area_y + margin,
        "basso" => area_y + area_h - h - margin,
        _ => area_y + (area_h - h) / 2,
    }
}

fn place_setting(app: &AppHandle) -> String {
    app.try_state::<crate::Shared>().map(|s| s.settings.lock().unwrap().search_place.clone()).unwrap_or_default()
}

/// The search window's place on the screen of the mouse (Impostazioni → «Ricerca da sola»).
fn place(app: &AppHandle, win: &WebviewWindow, height: f64) {
    let at = crate::island::cursor_physical();
    let monitors = app.available_monitors().unwrap_or_default();
    let monitor = at
        .and_then(|(x, y)| {
            monitors.iter().find(|m| {
                let (p, s) = (m.position(), m.size());
                x >= p.x as f64 && y >= p.y as f64 && x < p.x as f64 + s.width as f64 && y < p.y as f64 + s.height as f64
            })
        })
        .cloned()
        .or_else(|| app.primary_monitor().ok().flatten());
    let Some(m) = monitor else { return };
    let scale = m.scale_factor();
    let area = m.work_area();
    let w = (WIDTH * scale).round().min(area.size.width as f64) as u32;
    let most = (area.size.height as f64 * 0.7).max(120.0);
    let h = (height.max(54.0) * scale).round().min(most) as u32;
    let x = area.position.x + (area.size.width as i32 - w as i32) / 2;
    let y = top_of(&place_setting(app), area.position.y, area.size.height as i32, h as i32);
    let _ = win.set_size(PhysicalSize::new(w, h));
    let _ = win.set_position(PhysicalPosition::new(x, y));
}

/// Shown where the mouse is, `height` (logical px) tall, with the keyboard.
#[tauri::command]
pub fn search_window_show(app: AppHandle, height: f64) -> bool {
    let Some(win) = app.get_webview_window(LABEL) else { return false };
    place(&app, &win, height);
    let _ = win.show();
    let _ = win.set_always_on_top(true);
    // Windows lets a background process bring a window forward only with a
    // little help (as island::activate_window): without it the keys stayed in
    // the app in front and the search, never focused, closed at once (17 Nov 2026).
    let w = win.clone();
    let _ = app.run_on_main_thread(move || {
        bring_forward(&w);
        let _ = w.set_focus();
    });
    true
}

/// The window in front with the keyboard, also when another app has it.
fn bring_forward(win: &WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
    use windows::Win32::UI::Input::KeyboardAndMouse::{SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VK_MENU};
    use windows::Win32::UI::WindowsAndMessaging::{BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId, SetForegroundWindow};
    let Ok(raw) = win.hwnd() else { return };
    let hwnd = HWND(raw.0);
    unsafe {
        let fg = GetForegroundWindow();
        if fg == hwnd {
            return;
        }
        let cur = GetCurrentThreadId();
        let other = if fg.0.is_null() { 0 } else { GetWindowThreadProcessId(fg, None) };
        let attached = other != 0 && other != cur && AttachThreadInput(cur, other, true).as_bool();
        let _ = SetForegroundWindow(hwnd);
        let _ = BringWindowToTop(hwnd);
        if attached {
            let _ = AttachThreadInput(cur, other, false);
        }
        if GetForegroundWindow() != hwnd {
            // A tap of Alt: Windows then allows the change of foreground window.
            let key = |flags| INPUT { r#type: INPUT_KEYBOARD, Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VK_MENU, dwFlags: flags, ..Default::default() } } };
            let _ = SendInput(&[key(Default::default()), key(KEYEVENTF_KEYUP)], std::mem::size_of::<INPUT>() as i32);
            let _ = SetForegroundWindow(hwnd);
            let _ = BringWindowToTop(hwnd);
        }
    }
}

/// As tall as its results (logical px), kept at its place: centred, against
/// the top or against the bottom.
#[tauri::command]
pub fn search_window_fit(app: AppHandle, height: f64) {
    let Some(win) = app.get_webview_window(LABEL) else { return };
    let Ok(size) = win.inner_size() else { return };
    let Ok(pos) = win.outer_position() else { return };
    let scale = win.scale_factor().unwrap_or(1.0);
    let Some(m) = win.current_monitor().ok().flatten() else { return };
    let area = m.work_area();
    let most = (area.size.height as f64 * 0.7).max(120.0);
    let h = (height.max(54.0) * scale).round().min(most) as u32;
    if h == size.height {
        return;
    }
    let y = top_of(&place_setting(&app), area.position.y, area.size.height as i32, h as i32);
    // Size and place together: no frame at the old place with the new size.
    let _ = win.set_position(PhysicalPosition::new(pos.x, y));
    let _ = win.set_size(PhysicalSize::new(size.width, h));
}

#[tauri::command]
pub fn search_window_hide(app: AppHandle) {
    if let Some(win) = app.get_webview_window(LABEL) {
        let _ = win.hide();
    }
}
