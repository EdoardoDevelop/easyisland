// Island window: placement on the chosen display, the two window sizes
// (full panel / rest icon or wake strip), click-through, the cursor poll and
// the full-screen watch.
//
// There is no notch on a PC, so the island is a shape drawn in a borderless,
// transparent, always-on-top window that never takes focus, pinned to the
// corner or edge the user picked in the settings.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use crate::settings::Settings;
use tauri::{AppHandle, Emitter, Manager, Monitor, PhysicalPosition, PhysicalSize, WebviewWindow};

use windows::Win32::Foundation::{HWND, POINT};
use windows::Win32::UI::Input::KeyboardAndMouse::{GetAsyncKeyState, VK_LBUTTON};
use windows::Win32::UI::WindowsAndMessaging::{
    GetCursorPos, GetWindowLongPtrW, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE, HWND_TOPMOST,
    SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE, WS_EX_NOACTIVATE,
    WS_EX_TOOLWINDOW,
};

/// Logical size of the full window while open. Taller than any fixed view so the
/// island can grow with its content. MUST match PANEL_W / PANEL_H in
/// src/core/layout.ts: the front end places the island inside a window of this
/// size, and a mismatch puts a bottom-anchored island outside the window.
pub const PANEL_W: f64 = 720.0;
pub const PANEL_H: f64 = 560.0;
/// Logical size of the invisible strip that wakes the island when it is hidden.
pub const STRIP_W: f64 = 240.0;
pub const STRIP_H: f64 = 6.0;

pub const WINDOW_LABEL: &str = "island";

/// Margin around the island that still counts as "on the island", in logical px.
/// Wider than the macOS 6 pt because a click must never be swallowed.
const HIT_MARGIN: f64 = 14.0;
/// How often the island takes the front back from the taskbar, when it sits over it.
const RAISE_EVERY: Duration = Duration::from_millis(150);
/// Beyond this distance from the island (logical px) the cursor is sampled at 20 Hz.
const FAR_FROM_ISLAND: f64 = 240.0;

#[derive(Serialize, Clone)]
pub struct CursorPayload {
    pub x: f64,
    pub y: f64,
}

#[derive(Serialize, Clone)]
pub struct ScreenInfo {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub scale: f64,
}

/// The island shape in window-logical coordinates, pushed by the front end.
/// The poll thread owns the click-through decision so it lands in the same 16 ms
/// tick as the cursor read — an IPC round trip here loses clicks.
#[derive(Clone, Copy, Default)]
pub struct IslandRect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// Wakes / parks the cursor poll thread so a hidden island costs literally nothing.
pub struct PollGate {
    active: Mutex<bool>,
    cv: Condvar,
    pub collapsed: AtomicBool,
    pub rect: Mutex<IslandRect>,
    /// Mirrors the window flag so we only call into Win32 when it changes.
    ignoring: AtomicBool,
    /// Logical size of the window while collapsed: the rest icon's box, or the
    /// invisible wake strip. Set by the front end, which knows the icon size.
    pub collapsed_size: Mutex<(f64, f64)>,
    /// A full-screen app (video, game, presentation) is in front.
    pub fullscreen: AtomicBool,
    /// The character is being dragged: the window keeps the mouse even when a quick
    /// move leaves the cursor outside it for a moment.
    pub dragging: AtomicBool,
}

impl PollGate {
    pub fn new() -> Self {
        Self {
            active: Mutex::new(false),
            cv: Condvar::new(),
            collapsed: AtomicBool::new(true),
            rect: Mutex::new(IslandRect::default()),
            ignoring: AtomicBool::new(false),
            collapsed_size: Mutex::new((STRIP_W, STRIP_H)),
            fullscreen: AtomicBool::new(false),
            dragging: AtomicBool::new(false),
        }
    }

    pub fn set_rect(&self, rect: IslandRect) {
        *self.rect.lock().unwrap() = rect;
    }

    /// Forces the next poll tick to re-apply the flag (after a window resize).
    pub fn forget_ignore_state(&self) {
        self.ignoring.store(false, Ordering::Relaxed);
    }

    pub fn set_active(&self, on: bool) {
        let mut guard = self.active.lock().unwrap();
        *guard = on;
        self.cv.notify_all();
    }

    fn wait_until_active(&self) {
        let mut guard = self.active.lock().unwrap();
        while !*guard {
            guard = self.cv.wait(guard).unwrap();
        }
    }

    fn is_active(&self) -> bool {
        *self.active.lock().unwrap()
    }
}

pub fn window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window(WINDOW_LABEL)
}

fn cursor_physical() -> Option<(f64, f64)> {
    let mut p = POINT::default();
    unsafe { GetCursorPos(&mut p).ok()? };
    Some((p.x as f64, p.y as f64))
}

/// True while the left mouse button is held — the only signal we get that a
/// drag might be in flight before it reaches the window.
fn left_button_down() -> bool {
    unsafe { (GetAsyncKeyState(VK_LBUTTON.0 as i32) as u16 & 0x8000) != 0 }
}

fn monitor_contains(m: &Monitor, x: f64, y: f64) -> bool {
    let p = m.position();
    let s = m.size();
    x >= p.x as f64
        && x < (p.x + s.width as i32) as f64
        && y >= p.y as f64
        && y < (p.y + s.height as i32) as f64
}

/// The display the island lives on: the primary one, or the one under the cursor.
fn target_monitor(app: &AppHandle, pref: &str) -> Option<Monitor> {
    let monitors = app.available_monitors().ok()?;
    if pref == "cursor" {
        if let Some((cx, cy)) = cursor_physical() {
            if let Some(m) = monitors.iter().find(|m| monitor_contains(m, cx, cy)) {
                return Some(m.clone());
            }
        }
    }
    app.primary_monitor()
        .ok()
        .flatten()
        .or_else(|| monitors.into_iter().next())
}

pub fn screen_info(app: &AppHandle, pref: &str) -> ScreenInfo {
    match target_monitor(app, pref) {
        Some(m) => {
            let scale = m.scale_factor();
            let p = m.position();
            let s = m.size();
            ScreenInfo {
                x: p.x as f64 / scale,
                y: p.y as f64 / scale,
                width: s.width as f64 / scale,
                height: s.height as f64 / scale,
                scale,
            }
        }
        None => ScreenInfo { x: 0.0, y: 0.0, width: 1920.0, height: 1080.0, scale: 1.0 },
    }
}

/// Places and sizes the window. `collapsed` picks the rest icon / wake strip box
/// instead of the panel. Both are pinned to the same corner (or edge centre) of
/// the work area, so the island never jumps when the window grows or shrinks,
/// and nothing ever sits on the taskbar.
pub fn apply_geometry(app: &AppHandle, gate: &PollGate, settings: &Settings, collapsed: bool) {
    let Some(win) = window(app) else { return };
    let Some(m) = target_monitor(app, &settings.screen) else { return };

    let scale = m.scale_factor();
    let work = island_area(&m, settings);

    let (lw, lh) = if collapsed { *gate.collapsed_size.lock().unwrap() } else { (PANEL_W, PANEL_H) };
    let pw = (lw * scale).round().max(1.0) as u32;
    let ph = (lh * scale).round().max(1.0) as u32;
    let (x, y) = anchored_origin(work, (pw, ph), &settings.anchor_h, &settings.anchor_v);
    // Where the user dragged the character to, kept on screen whatever the display.
    let (x, y) = clamp_to_work(
        work,
        (pw, ph),
        x + (settings.offset_x * scale).round() as i32,
        y + (settings.offset_y * scale).round() as i32,
    );

    let _ = win.set_size(PhysicalSize::new(pw, ph));
    let _ = win.set_position(PhysicalPosition::new(x, y));
    // Moving across displays can rescale the window: re-assert the physical size.
    let _ = win.set_size(PhysicalSize::new(pw, ph));
    let _ = win.set_always_on_top(true);
}

/// Top-left corner, in physical px, of a `size` window pinned to the requested
/// side of the `work` area (x, y, width, height).
fn anchored_origin(
    work: (i32, i32, u32, u32),
    size: (u32, u32),
    anchor_h: &str,
    anchor_v: &str,
) -> (i32, i32) {
    let (wx, wy, ww, wh) = work;
    let (pw, ph) = (size.0 as i32, size.1 as i32);
    let x = match anchor_h {
        "left" => wx,
        "right" => wx + ww as i32 - pw,
        _ => wx + (ww as i32 - pw) / 2,
    };
    let y = if anchor_v == "bottom" { wy + wh as i32 - ph } else { wy };
    (x, y)
}

fn clamp_to_work(work: (i32, i32, u32, u32), size: (u32, u32), x: i32, y: i32) -> (i32, i32) {
    let (wx, wy, ww, wh) = work;
    let max_x = (wx + ww as i32 - size.0 as i32).max(wx);
    let max_y = (wy + wh as i32 - size.1 as i32).max(wy);
    (x.clamp(wx, max_x), y.clamp(wy, max_y))
}

/// Snaps within this many logical px of an edge or of the centre line.
const SNAP: f64 = 16.0;

/// Where a drag left the character, turned into settings: the side the island opens
/// from (the third / half of the screen the icon is in, so the panel grows
/// towards the middle) and the offset from that side's home position, logical px.
/// `box_origin` is the rest box's top-left corner, `box_size` its size, both physical.
pub fn placement_from_drop(
    work: (i32, i32, u32, u32),
    box_origin: (i32, i32),
    box_size: (u32, u32),
    scale: f64,
) -> (String, String, f64, f64) {
    let (wx, wy, ww, wh) = work;
    let cx = box_origin.0 + box_size.0 as i32 / 2 - wx;
    let cy = box_origin.1 + box_size.1 as i32 / 2 - wy;
    let anchor_h = if cx < ww as i32 / 3 {
        "left"
    } else if cx > ww as i32 * 2 / 3 {
        "right"
    } else {
        "center"
    };
    let anchor_v = if cy > wh as i32 / 2 { "bottom" } else { "top" };
    let (hx, hy) = anchored_origin(work, box_size, anchor_h, anchor_v);
    let snap = |d: i32| {
        let d = d as f64 / scale;
        if d.abs() < SNAP { 0.0 } else { d.round() }
    };
    (
        anchor_h.to_string(),
        anchor_v.to_string(),
        snap(box_origin.0 - hx),
        snap(box_origin.1 - hy),
    )
}

/// The rest box's top-left corner for a window at `win_origin` of `win_size`:
/// both are pinned to the same side, so the box sits in the matching corner.
pub fn box_in_window(
    win_origin: (i32, i32),
    win_size: (u32, u32),
    box_size: (u32, u32),
    anchor_h: &str,
    anchor_v: &str,
) -> (i32, i32) {
    let (dw, dh) = (win_size.0 as i32 - box_size.0 as i32, win_size.1 as i32 - box_size.1 as i32);
    let x = match anchor_h {
        "left" => win_origin.0,
        "right" => win_origin.0 + dw,
        _ => win_origin.0 + dw / 2,
    };
    let y = if anchor_v == "bottom" { win_origin.1 + dh } else { win_origin.1 };
    (x, y)
}

/// Where the island may sit on `m`, physical px: the work area, or the whole
/// screen when the user wants it over the taskbar too.
fn island_area(m: &Monitor, settings: &Settings) -> (i32, i32, u32, u32) {
    if settings.over_taskbar {
        let (p, s) = (m.position(), m.size());
        (p.x, p.y, s.width, s.height)
    } else {
        let wa = m.work_area();
        (wa.position.x, wa.position.y, wa.size.width, wa.size.height)
    }
}

/// The island's area (physical) and scale on its screen.
pub fn work_area(app: &AppHandle, settings: &Settings) -> Option<((i32, i32, u32, u32), f64)> {
    let m = target_monitor(app, &settings.screen)?;
    Some((island_area(&m, settings), m.scale_factor()))
}

/// Every two seconds: is a full-screen app in front? Cheap (one shell call),
/// and it only runs while the user has asked for quiet in full screen.
pub fn spawn_fullscreen_watch(app: AppHandle, gate: Arc<PollGate>) {
    use windows::Win32::UI::Shell::{
        SHQueryUserNotificationState, QUNS_BUSY, QUNS_PRESENTATION_MODE,
        QUNS_RUNNING_D3D_FULL_SCREEN,
    };
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(2));
        // Resting over the taskbar the cursor poll is parked: keep the icon in front from here.
        let over = app
            .try_state::<crate::Shared>()
            .map(|s| s.settings.lock().unwrap().over_taskbar)
            .unwrap_or(false);
        if over && gate.collapsed.load(Ordering::Relaxed) {
            raise_over_taskbar(&app);
        }
        let wanted = app
            .try_state::<crate::Shared>()
            .map(|s| s.settings.lock().unwrap().quiet_fullscreen)
            .unwrap_or(false);
        let busy = wanted
            && matches!(
                unsafe { SHQueryUserNotificationState() },
                Ok(s) if s == QUNS_BUSY || s == QUNS_RUNNING_D3D_FULL_SCREEN || s == QUNS_PRESENTATION_MODE
            );
        if gate.fullscreen.swap(busy, Ordering::Relaxed) == busy {
            continue;
        }
        crate::log::line(format!("full screen: {busy}"));
        // Only the resting icon goes away; an open island (a permission request)
        // stays where it is.
        if gate.collapsed.load(Ordering::Relaxed) {
            if let Some(win) = window(&app) {
                let _ = if busy { win.hide() } else { win.show() };
            }
        }
        let _ = app.emit_to(WINDOW_LABEL, "fullscreen", busy);
    });
}

/// Puts the island back at the top of the topmost band. The taskbar is topmost
/// too and comes forward whenever it is touched; Tauri's set_always_on_top does
/// nothing when the flag is already set, so this goes to Win32 directly.
pub fn raise_over_taskbar(app: &AppHandle) {
    let Some(win) = window(app) else { return };
    let Some(hwnd) = hwnd_of(&win) else { return };
    unsafe {
        let _ = SetWindowPos(
            hwnd,
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_ASYNCWINDOWPOS,
        );
    }
}

fn hwnd_of(win: &WebviewWindow) -> Option<HWND> {
    let raw = win.hwnd().ok()?.0 as isize;
    if raw == 0 {
        return None;
    }
    Some(HWND(raw as *mut _))
}

/// WS_EX_NOACTIVATE keeps clicks from stealing focus; WS_EX_TOOLWINDOW keeps the
/// island out of Alt-Tab.
pub fn make_non_activating(win: &WebviewWindow) {
    let Some(hwnd) = hwnd_of(win) else { return };
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let want = ex | WS_EX_NOACTIVATE.0 as isize | WS_EX_TOOLWINDOW.0 as isize;
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, want);
    }
}

/// Temporarily allow activation so a text field inside the island can be typed in.
pub fn set_activating(win: &WebviewWindow, activating: bool) {
    let Some(hwnd) = hwnd_of(win) else { return };
    unsafe {
        let ex = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let want = if activating {
            ex & !(WS_EX_NOACTIVATE.0 as isize)
        } else {
            ex | WS_EX_NOACTIVATE.0 as isize
        };
        SetWindowLongPtrW(hwnd, GWL_EXSTYLE, want);
    }
}

/// Position, size and scale of the monitor the island lives on. Any change here
/// means the island has to be placed again.
fn current_screen_key(app: &AppHandle) -> Option<(i32, i32, u32, u32, u64)> {
    let pref = app
        .try_state::<crate::Shared>()
        .map(|s| s.settings.lock().unwrap().screen.clone())
        .unwrap_or_else(|| "primary".into());
    let m = target_monitor(app, &pref)?;
    let p = m.position();
    let size = m.size();
    Some((p.x, p.y, size.width, size.height, m.scale_factor().to_bits()))
}

/// Emits `cursor` (window-logical coordinates) at ~60 Hz while the island is
/// visible. Parked on a condvar the rest of the time.
pub fn spawn_cursor_poll(app: AppHandle, gate: Arc<PollGate>) {
    std::thread::spawn(move || {
        // Remembered across wakes so a display change while hidden is noticed the
        // moment the island comes back.
        let mut last_screen: Option<(i32, i32, u32, u32, u64)> = None;
        loop {
            gate.wait_until_active();
            let mut last = (f64::MIN, f64::MIN);
            let mut ticks: u32 = 0;
            let mut over_taskbar = false;
            // Far from the island nothing needs 60 Hz: the gaze barely changes
            // there and nothing can be clicked. Sample at 20 Hz until it comes close.
            let mut slow = false;
            let mut last_raise = Instant::now();
            while gate.is_active() {
                std::thread::sleep(Duration::from_millis(if slow { 50 } else { 16 }));
                // The island may have collapsed during the sleep: a tick on stale
                // data would turn click-through back on over the rest icon.
                if !gate.is_active() {
                    break;
                }

                ticks = ticks.wrapping_add(1);
                // The taskbar comes forward on every touch: over it, take the
                // front back within a few frames (one cheap async SetWindowPos).
                if over_taskbar && last_raise.elapsed() >= RAISE_EVERY {
                    last_raise = Instant::now();
                    raise_over_taskbar(&app);
                }
                // Monitors get plugged in, unplugged, rearranged and rescaled, and
                // an island pinned to coordinates that no longer exist is an island
                // nobody can reach. Checked about twice a second — the cursor poll
                // is already running, so this costs one monitor query.
                if ticks % 30 == 0 {
                    over_taskbar = app
                        .try_state::<crate::Shared>()
                        .map(|s| s.settings.lock().unwrap().over_taskbar)
                        .unwrap_or(false);
                    let now = current_screen_key(&app);
                    if now.is_some() && now != last_screen {
                        let first = last_screen.is_none();
                        last_screen = now;
                        if !first {
                            crate::log::line("display layout changed — repositioning".to_string());
                            let _ = app.emit_to(WINDOW_LABEL, "screen-changed", ());
                        }
                    }
                }

                let Some(win) = window(&app) else { continue };
                let Ok(origin) = win.outer_position() else { continue };
                let scale = win.scale_factor().unwrap_or(1.0);
                let Some((cx, cy)) = cursor_physical() else { continue };
                let x = (cx - origin.x as f64) / scale;
                let y = (cy - origin.y as f64) / scale;
                let size = match win.inner_size() {
                    Ok(s) => (s.width as f64 / scale, s.height as f64 / scale),
                    Err(_) => (PANEL_W, PANEL_H),
                };
                if (x - last.0).abs() < 1.0 && (y - last.1).abs() < 1.0 {
                    continue;
                }
                last = (x, y);

                // Click-through: the window only takes the mouse over the island
                // shape. A small entry margin means the flag is already off by the
                // time a moving cursor reaches a button.
                let r = *gate.rect.lock().unwrap();
                let on_island = r.w > 0.0
                    && x >= r.x - HIT_MARGIN
                    && x <= r.x + r.w + HIT_MARGIN
                    && y >= r.y - HIT_MARGIN
                    && y <= r.y + r.h + HIT_MARGIN;

                // A file being dragged has to be able to find us. WS_EX_TRANSPARENT
                // — what click-through is on Windows — hides the window from
                // WindowFromPoint, so OLE finds no drop target and shows the "no
                // drop" cursor. macOS has no such problem: AppKit delivers drags to
                // registered destinations whatever ignoresMouseEvents says. So while
                // a button is held anywhere over the panel, the whole panel takes
                // the mouse, which also makes the drop zone as forgiving as the Mac's.
                let down = left_button_down();

                let dragging = down
                    && x >= 0.0
                    && x <= size.0
                    && y >= 0.0
                    && y <= size.1;

                // Collapsed, the whole window is the rest icon or the wake strip,
                // and it must always take the mouse. Checked here too because
                // set_collapsed can land between the check above and this line.
                let accept = on_island
                    || dragging
                    || gate.dragging.load(Ordering::Relaxed)
                    || gate.collapsed.load(Ordering::Relaxed);
                if gate.ignoring.load(Ordering::Relaxed) == accept {
                    gate.ignoring.store(!accept, Ordering::Relaxed);
                    let _ = win.set_ignore_cursor_events(!accept);
                    // Reaching the character over the taskbar: be in front before the click.
                    if accept && over_taskbar {
                        raise_over_taskbar(&app);
                    }
                }

                let dx = (r.x - x).max(x - (r.x + r.w)).max(0.0);
                let dy = (r.y - y).max(y - (r.y + r.h)).max(0.0);
                slow = !down && !gate.dragging.load(Ordering::Relaxed)
                    && (r.w <= 0.0 || dx.hypot(dy) > FAR_FROM_ISLAND);
                let _ = win.emit("cursor", CursorPayload { x, y });
            }
            // Parking: this thread is the last one to touch the flag, so it has
            // the final say — a resting island takes the mouse.
            if gate.collapsed.load(Ordering::Relaxed) {
                if let Some(win) = window(&app) {
                    let _ = win.set_ignore_cursor_events(false);
                }
                gate.forget_ignore_state();
            }
        }
    });
}

pub fn set_ignore_cursor(app: &AppHandle, ignore: bool) {
    if let Some(win) = window(app) {
        let _ = win.set_ignore_cursor_events(ignore);
    }
}

#[cfg(test)]
mod tests {
    use super::{box_in_window, clamp_to_work, placement_from_drop, PANEL_H, PANEL_W};

    const WORK: (i32, i32, u32, u32) = (0, 0, 1920, 1040);

    /// The front end lays the island out inside a window of this size: if the two
    /// disagree, a bottom-anchored island ends up outside the window, invisible.
    #[test]
    fn panel_size_matches_the_front_end() {
        let layout = include_str!("../../src/core/layout.ts");
        assert!(layout.contains(&format!("export const PANEL_W = {};", PANEL_W as i64)), "PANEL_W differs from layout.ts");
        assert!(layout.contains(&format!("export const PANEL_H = {};", PANEL_H as i64)), "PANEL_H differs from layout.ts");
    }

    #[test]
    fn drop_picks_the_nearest_side_and_keeps_the_spot() {
        // Top centre, a few px off: snaps back home.
        let (h, v, ox, oy) = placement_from_drop(WORK, (944, 6), (40, 40), 1.0);
        assert_eq!((h.as_str(), v.as_str(), ox, oy), ("center", "top", 0.0, 0.0));
        // Left third, halfway down the top half.
        let (h, v, ox, oy) = placement_from_drop(WORK, (300, 200), (40, 40), 1.0);
        assert_eq!((h.as_str(), v.as_str(), ox, oy), ("left", "top", 300.0, 200.0));
        // Bottom right, offsets are measured from that corner.
        let (h, v, ox, oy) = placement_from_drop(WORK, (1700, 900), (40, 40), 1.0);
        assert_eq!((h.as_str(), v.as_str(), ox, oy), ("right", "bottom", -180.0, -100.0));
        // HiDPI: offsets are logical.
        let (_, _, ox, _) = placement_from_drop(WORK, (400, 0), (80, 80), 2.0);
        assert_eq!(ox, 200.0);
    }

    #[test]
    fn rest_box_sits_in_the_anchored_corner() {
        assert_eq!(box_in_window((100, 0), (720, 320), (40, 40), "center", "top"), (440, 0));
        assert_eq!(box_in_window((100, 50), (720, 320), (40, 40), "right", "bottom"), (780, 330));
        assert_eq!(box_in_window((100, 50), (720, 320), (40, 40), "left", "top"), (100, 50));
    }

    #[test]
    fn window_stays_on_screen() {
        assert_eq!(clamp_to_work(WORK, (720, 320), -50, 900), (0, 720));
        assert_eq!(clamp_to_work(WORK, (720, 320), 1500, 10), (1200, 10));
    }
}
