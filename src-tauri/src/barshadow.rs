// The fixed bar's shadow (Aspetto della barra → «Ombra», asked by Edoardo on
// 31 Oct 2026): soft and light, outside the band, under it when the bar is at
// the top of the screen and above it at the bottom.
//
// A click-through layered window of its own, just below the bar's: the bar's
// window is as tall as the band, and a taller one would take the clicks meant
// for the windows under the shadow. Drawn once per change of the band
// (UpdateLayeredWindow); nothing runs in between. With the island open it stays,
// below the island so it never darkens it; not with the islands style (each
// island has its own CSS shadow, personaggio.html). Every Win32 call runs
// on the main thread, which owns the window and pumps its messages.

use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::Mutex;

use tauri::AppHandle;
use windows::core::w;
use windows::Win32::Foundation::{HWND, LPARAM, LRESULT, POINT, SIZE, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, RegisterClassW, SetWindowPos, ShowWindow, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    SW_HIDE, SW_SHOWNOACTIVATE, WINDOW_STYLE, WNDCLASSW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST,
    WS_EX_TRANSPARENT, WS_POPUP,
};

/// How the shadow lies: the band (physical px), the edge it hangs from, the
/// band's margins from the sides, the shadow's depth, the window it goes just
/// below (the bar's, or the open island's).
#[derive(Clone, Copy, PartialEq)]
pub struct Shadow {
    pub band: (i32, i32, i32, i32),
    pub top: bool,
    pub margin: i32,
    pub depth: i32,
    pub below: isize,
}

/// Darkest at the band's edge (of 255).
const STRENGTH: f64 = 50.0;

static WINDOW: AtomicIsize = AtomicIsize::new(0);
static SHOWN: Mutex<Option<Shadow>> = Mutex::new(None);

/// Shows the shadow as `want` says, or hides it (None).
pub fn sync(app: &AppHandle, want: Option<Shadow>) {
    if *SHOWN.lock().unwrap() == want {
        return;
    }
    let _ = app.run_on_main_thread(move || unsafe { apply(want) });
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    DefWindowProcW(hwnd, msg, wparam, lparam)
}

unsafe fn window() -> Option<HWND> {
    let raw = WINDOW.load(Ordering::Relaxed);
    if raw != 0 {
        return Some(HWND(raw as *mut _));
    }
    let instance = GetModuleHandleW(None).ok()?;
    let class = WNDCLASSW {
        lpfnWndProc: Some(wndproc),
        hInstance: instance.into(),
        lpszClassName: w!("EasyIslandBarShadow"),
        ..Default::default()
    };
    RegisterClassW(&class);
    let hwnd = CreateWindowExW(
        WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
        w!("EasyIslandBarShadow"),
        w!(""),
        WINDOW_STYLE(WS_POPUP.0),
        0,
        0,
        0,
        0,
        None,
        None,
        Some(instance.into()),
        None,
    )
    .ok()?;
    WINDOW.store(hwnd.0 as isize, Ordering::Relaxed);
    Some(hwnd)
}

unsafe fn apply(want: Option<Shadow>) {
    let mut shown = SHOWN.lock().unwrap();
    if *shown == want {
        return;
    }
    *shown = want;
    let Some(s) = want.filter(|s| s.band.2 > 0 && s.depth > 0) else {
        let raw = WINDOW.load(Ordering::Relaxed);
        if raw != 0 {
            let _ = ShowWindow(HWND(raw as *mut _), SW_HIDE);
        }
        return;
    };
    let Some(hwnd) = window() else { return };
    let (x, y, w, h) = s.band;
    let at = POINT { x, y: if s.top { y + h } else { y - s.depth } };
    let size = SIZE { cx: w, cy: s.depth };
    crate::carry::update(hwnd, at, size, Some(&picture(w, s.depth, s.top, s.margin)));
    // Just below the bar (the band covers the shadow's edge) or the open island.
    let _ = SetWindowPos(hwnd, Some(HWND(s.below as *mut _)), 0, 0, 0, 0, SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE);
    let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
}

/// The shadow, BGRA premultiplied (black, so only alpha): fading away from the
/// band, and at the ends of a band that leaves the sides.
fn picture(w: i32, depth: i32, top: bool, margin: i32) -> Vec<u8> {
    let (w, d) = (w.max(0) as usize, depth.max(1) as usize);
    let mut out = vec![0u8; w * d * 4];
    let m = margin.max(0) as f64;
    let smooth = |t: f64| {
        let t = t.clamp(0.0, 1.0);
        t * t * (3.0 - 2.0 * t)
    };
    for row in 0..d {
        let from_band = if top { row } else { d - 1 - row } as f64;
        let fall = 1.0 - from_band / d as f64;
        let v = STRENGTH * fall * fall;
        for col in 0..w {
            let x = col as f64 + 0.5;
            let along = if m > 0.0 { smooth((x - m).min(w as f64 - m - x) / d as f64) } else { 1.0 };
            let a = (v * along).round().clamp(0.0, 255.0) as u8;
            if let Some(px) = out.get_mut((row * w + col) * 4 + 3) {
                *px = a;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::picture;

    #[test]
    fn the_shadow_fades_away_from_the_band() {
        let p = picture(4, 4, true, 0);
        let alpha = |row: usize| p[(row * 4 + 1) * 4 + 3];
        assert!(alpha(0) > alpha(1) && alpha(1) > alpha(2) && alpha(2) > alpha(3));
        let p = picture(4, 4, false, 0);
        let alpha = |row: usize| p[(row * 4 + 1) * 4 + 3];
        assert!(alpha(3) > alpha(0));
        // Leaving the sides: nothing past the margin.
        let p = picture(20, 4, true, 5);
        assert_eq!(p[3], 0);
    }
}
