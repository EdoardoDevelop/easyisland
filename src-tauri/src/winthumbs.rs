// Live previews of open windows in the Dock (docs/piano-dock.md): DWM draws
// each window, live, into a rectangle of the Dock's own window, on top of its
// web content (tried in the phase 0 prototype, opaque and transparent: it
// holds). The page leaves those rectangles empty and puts nothing over them.
// Drawn by DWM on the GPU: nothing runs here between two calls.
//
// Windows minimized by apps that draw with DirectComposition (Chromium,
// Electron, Edge, VS Code…) give an empty picture: the Dock shows their icon
// and title instead of asking for one. (Pictures of files: thumbs.rs.)

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Deserialize;
use tauri::{AppHandle, Manager};
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::Graphics::Dwm::{
    DwmGetWindowAttribute, DwmQueryThumbnailSourceSize, DwmRegisterThumbnail, DwmUnregisterThumbnail,
    DwmUpdateThumbnailProperties, DWMWA_EXTENDED_FRAME_BOUNDS, DWM_THUMBNAIL_PROPERTIES, DWM_TNP_OPACITY,
    DWM_TNP_RECTDESTINATION, DWM_TNP_RECTSOURCE, DWM_TNP_SOURCECLIENTAREAONLY, DWM_TNP_VISIBLE,
};
use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;

/// One preview: the window and where it goes, logical px of the Dock's window.
#[derive(Deserialize)]
pub struct ThumbRect {
    pub hwnd: isize,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// The visible part of a window in its own coordinates: without the invisible
/// resize borders (8 px past the screen for a maximized window), which shifted
/// the picture in its card. None: the whole window.
fn visible_part(source: HWND) -> Option<RECT> {
    let mut whole = RECT::default();
    let mut frame = RECT::default();
    unsafe {
        GetWindowRect(source, &mut whole).ok()?;
        DwmGetWindowAttribute(source, DWMWA_EXTENDED_FRAME_BOUNDS, (&raw mut frame).cast(), size_of::<RECT>() as u32).ok()?;
    }
    let r = RECT { left: frame.left - whole.left, top: frame.top - whole.top, right: frame.right - whole.left, bottom: frame.bottom - whole.top };
    (r.right > r.left && r.bottom > r.top && r.left >= 0 && r.top >= 0).then_some(r)
}

/// Source window → DWM thumbnail.
static THUMBS: Mutex<Option<HashMap<isize, isize>>> = Mutex::new(None);

/// `rect` (physical px) shrunk to the source's proportions, centred.
fn fit(rect: RECT, source: (i32, i32)) -> RECT {
    let (sw, sh) = source;
    let (w, h) = (rect.right - rect.left, rect.bottom - rect.top);
    if sw <= 0 || sh <= 0 || w <= 0 || h <= 0 {
        return rect;
    }
    let scale = (w as f64 / sw as f64).min(h as f64 / sh as f64);
    let (fw, fh) = ((sw as f64 * scale).round() as i32, (sh as f64 * scale).round() as i32);
    let (x, y) = (rect.left + (w - fw) / 2, rect.top + (h - fh) / 2);
    RECT { left: x, top: y, right: x + fw, bottom: y + fh }
}

/// Shows these previews and only these: `[]` takes them all away (the card closed).
#[tauri::command]
pub fn dock_thumbs(app: AppHandle, rects: Vec<ThumbRect>) {
    let Some(dock) = app.get_webview_window(crate::taskwin::DOCK_LABEL) else {
        clear();
        return;
    };
    let (Ok(dest), Ok(scale)) = (dock.hwnd(), dock.scale_factor()) else { return };
    let dest = HWND(dest.0);
    let Ok(mut guard) = THUMBS.lock() else { return };
    let thumbs = guard.get_or_insert_with(HashMap::new);
    // Only windows the Dock was shown, never any handle; at most 16 (more drop frames).
    let wanted: Vec<&ThumbRect> = rects.iter().filter(|r| crate::taskwin::is_known(r.hwnd)).take(16).collect();
    thumbs.retain(|source, id| {
        let keep = wanted.iter().any(|r| r.hwnd == *source);
        if !keep {
            unsafe {
                let _ = DwmUnregisterThumbnail(*id);
            }
        }
        keep
    });
    for r in wanted {
        let id = match thumbs.get(&r.hwnd) {
            Some(&id) => id,
            None => match unsafe { DwmRegisterThumbnail(dest, HWND(r.hwnd as *mut _)) } {
                Ok(id) => {
                    thumbs.insert(r.hwnd, id);
                    id
                }
                Err(_) => continue,
            },
        };
        let px = |v: f64| (v * scale).round() as i32;
        let rect = RECT { left: px(r.x), top: px(r.y), right: px(r.x + r.w), bottom: px(r.y + r.h) };
        let part = visible_part(HWND(r.hwnd as *mut _));
        let source = match part {
            Some(p) => (p.right - p.left, p.bottom - p.top),
            None => unsafe { DwmQueryThumbnailSourceSize(id) }.map(|s| (s.cx, s.cy)).unwrap_or((0, 0)),
        };
        let mut flags = DWM_TNP_RECTDESTINATION | DWM_TNP_VISIBLE | DWM_TNP_OPACITY | DWM_TNP_SOURCECLIENTAREAONLY;
        if part.is_some() {
            flags |= DWM_TNP_RECTSOURCE;
        }
        let props = DWM_THUMBNAIL_PROPERTIES {
            dwFlags: flags,
            rcSource: part.unwrap_or_default(),
            rcDestination: fit(rect, source),
            opacity: 255,
            fVisible: true.into(),
            fSourceClientAreaOnly: false.into(),
            ..Default::default()
        };
        unsafe {
            let _ = DwmUpdateThumbnailProperties(id, &props);
        }
    }
}

/// Every preview away (the Dock's window is going).
pub fn clear() {
    if let Ok(mut guard) = THUMBS.lock() {
        for (_, id) in guard.take().unwrap_or_default() {
            unsafe {
                let _ = DwmUnregisterThumbnail(id);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_preview_keeps_the_window_proportions_centred() {
        let r = RECT { left: 0, top: 0, right: 200, bottom: 100 };
        // A tall window in a wide card: full height, centred across.
        assert_eq!(fit(r, (100, 200)), RECT { left: 75, top: 0, right: 125, bottom: 100 });
        // Same proportions: the whole card.
        assert_eq!(fit(r, (400, 200)), r);
        // Unknown size: the card as it is.
        assert_eq!(fit(r, (0, 0)), r);
    }
}
