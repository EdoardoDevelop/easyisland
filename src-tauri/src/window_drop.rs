// The character of the chat tab carried onto another app's window: which
// window is under the cursor, and a picture of it for the chat (the window as
// context, as Coucou did on the Mac).
//
// The window is found by walking the top-level windows front to back
// (EnumWindows follows the z-order), skipping our own, the hidden, cloaked
// (other virtual desktops, suspended Store apps), minimised and click-through
// ones, the desktop and the taskbar. No click-through trick as in
// folder_drop.rs: this runs while the character is carried around.
//
// The picture comes from PrintWindow with PW_RENDERFULLCONTENT, which also
// draws a window partly covered by others and the GPU-composed ones (Chrome,
// Edge, WebView2), cropped to the visible frame (without the invisible resize
// borders). Nothing is sent anywhere here: the PNG goes to the inbox and the
// chat attaches it only when the user sends a question.

use std::ffi::c_void;
use std::sync::Mutex;

use serde::Serialize;
use windows::core::{w, BOOL, HSTRING, PCWSTR};
use windows::Win32::Foundation::{HWND, LPARAM, POINT, RECT};
use windows::Win32::Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC, SelectObject, BITMAPINFO,
    BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HGDIOBJ,
};
use windows::Win32::Storage::FileSystem::{GetFileVersionInfoSizeW, GetFileVersionInfoW, VerQueryValueW};
use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
use windows::Win32::System::Threading::GetCurrentProcessId;
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetClassNameW, GetWindowLongPtrW, GetWindowRect, GetWindowTextW, GetWindowThreadProcessId, IsIconic,
    IsWindow, IsWindowVisible, GWL_EXSTYLE, WS_EX_TRANSPARENT,
};

use crate::clipimage::{self, Rgba};
use crate::files::{self, DroppedFile};
use crate::i18n::t;

/// Not in the windows crate: PrintWindow draws what DWM composes too.
const PW_RENDERFULLCONTENT: PRINT_WINDOW_FLAGS = PRINT_WINDOW_FLAGS(2);
/// Longest side of the picture: Claude scales larger ones down anyway, and a
/// 4K window would only make the request heavier.
const MAX_SIDE: u32 = 1600;
/// The chip in the chat.
const THUMB: u32 = 64;

/// Desktop and taskbar: not a window to talk about.
const SKIPPED_CLASSES: &[&str] = &["Progman", "WorkerW", "Shell_TrayWnd", "Shell_SecondaryTrayWnd"];

#[derive(Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    /// "Google Chrome", from the program's version information, else its file name.
    pub app_name: String,
    pub title: String,
}

/// The window the character was dropped on, its picture saved in the inbox.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowShot {
    pub app_name: String,
    pub title: String,
    pub name: String,
    pub path: String,
    /// A small PNG data URL, for the chip.
    pub thumb: String,
}

/// The last window looked up, so the name of its program is read once per window.
static LAST: Mutex<Option<(isize, WindowInfo)>> = Mutex::new(None);

/// The window under the physical point (x, y), with its program and title.
pub fn info_at(x: i32, y: i32) -> Option<(HWND, WindowInfo)> {
    let hwnd = window_at(POINT { x, y })?;
    let mut last = LAST.lock().unwrap();
    if let Some((h, info)) = last.as_ref() {
        if *h == hwnd.0 as isize {
            // The title may have changed (a tab switched).
            let info = WindowInfo { title: title(hwnd), ..info.clone() };
            return Some((hwnd, info));
        }
    }
    let info = WindowInfo { app_name: app_name(hwnd), title: title(hwnd) };
    *last = Some((hwnd.0 as isize, info.clone()));
    Some((hwnd, info))
}

/// The window under (x, y) as a PNG in the inbox.
pub fn capture_at(x: i32, y: i32) -> Result<Option<WindowShot>, String> {
    let Some((hwnd, info)) = info_at(x, y) else { return Ok(None) };
    let img = capture(hwnd).ok_or_else(|| t("Non riesco a catturare questa finestra").to_string())?;
    let img = if img.width.max(img.height) > MAX_SIDE { clipimage::thumbnail(&img, MAX_SIDE) } else { img };
    let png = clipimage::encode_png(&img)?;
    let thumb = clipimage::data_url(&clipimage::encode_png(&clipimage::thumbnail(&img, THUMB))?);
    let DroppedFile { name, path, .. } = files::save_new(&crate::screenshot::file_name(t("Finestra")), &png)?;
    Ok(Some(WindowShot { app_name: info.app_name, title: info.title, name, path, thumb }))
}

struct Search {
    pt: POINT,
    own: u32,
    found: Option<HWND>,
}

fn window_at(pt: POINT) -> Option<HWND> {
    let mut search = Search { pt, own: unsafe { GetCurrentProcessId() }, found: None };
    unsafe {
        // Stopping early makes EnumWindows report an error: not one.
        let _ = EnumWindows(Some(visit), LPARAM(&mut search as *mut Search as isize));
    }
    search.found
}

unsafe extern "system" fn visit(hwnd: HWND, lparam: LPARAM) -> BOOL {
    let search = &mut *(lparam.0 as *mut Search);
    if !IsWindowVisible(hwnd).as_bool() || IsIconic(hwnd).as_bool() {
        return BOOL(1);
    }
    let mut rect = RECT::default();
    if GetWindowRect(hwnd, &mut rect).is_err() {
        return BOOL(1);
    }
    let pt = search.pt;
    if pt.x < rect.left || pt.x >= rect.right || pt.y < rect.top || pt.y >= rect.bottom {
        return BOOL(1);
    }
    if GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & WS_EX_TRANSPARENT.0 as isize != 0 || cloaked(hwnd) {
        return BOOL(1);
    }
    let mut pid = 0u32;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));
    if pid == search.own {
        // The island's window is larger than the island, and takes the mouse
        // while the character is carried: look through it (the front end
        // knows when the cursor is over the island itself).
        return BOOL(1);
    }
    // The visible frame, not the invisible resize borders around it.
    let frame = frame(hwnd).unwrap_or(rect);
    if pt.x < frame.left || pt.x >= frame.right || pt.y < frame.top || pt.y >= frame.bottom {
        return BOOL(1);
    }
    if !SKIPPED_CLASSES.contains(&class_name(hwnd).as_str()) {
        search.found = Some(hwnd);
    }
    BOOL(0)
}

unsafe fn cloaked(hwnd: HWND) -> bool {
    let mut value = 0u32;
    DwmGetWindowAttribute(hwnd, DWMWA_CLOAKED, &mut value as *mut u32 as *mut c_void, 4).is_ok() && value != 0
}

unsafe fn frame(hwnd: HWND) -> Option<RECT> {
    let mut r = RECT::default();
    DwmGetWindowAttribute(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, &mut r as *mut RECT as *mut c_void, size_of::<RECT>() as u32)
        .ok()?;
    (r.right > r.left && r.bottom > r.top).then_some(r)
}

fn title(hwnd: HWND) -> String {
    let mut buf = [0u16; 512];
    let n = unsafe { GetWindowTextW(hwnd, &mut buf) };
    String::from_utf16_lossy(&buf[..n.max(0) as usize])
}

unsafe fn class_name(hwnd: HWND) -> String {
    let mut buf = [0u16; 64];
    let n = GetClassNameW(hwnd, &mut buf) as usize;
    String::from_utf16_lossy(&buf[..n])
}

/// "Microsoft Excel", "Google Chrome": the program's description; else its
/// file name without ".exe".
fn app_name(hwnd: HWND) -> String {
    let Some(path) = crate::context::exe_path(hwnd) else { return String::new() };
    if let Some(desc) = file_description(&path) {
        return desc;
    }
    let file = path.rsplit('\\').next().unwrap_or(&path);
    file.strip_suffix(".exe").or_else(|| file.strip_suffix(".EXE")).unwrap_or(file).to_string()
}

fn file_description(path: &str) -> Option<String> {
    unsafe {
        let file = HSTRING::from(path);
        let size = GetFileVersionInfoSizeW(&file, None);
        if size == 0 {
            return None;
        }
        let mut data = vec![0u8; size as usize];
        GetFileVersionInfoW(&file, None, size, data.as_mut_ptr() as *mut c_void).ok()?;
        // The first language the file declares.
        let mut ptr: *mut c_void = std::ptr::null_mut();
        let mut len = 0u32;
        if !VerQueryValueW(data.as_ptr() as *const c_void, w!("\\VarFileInfo\\Translation"), &mut ptr, &mut len).as_bool()
            || len < 4
        {
            return None;
        }
        let lang = *(ptr as *const u16);
        let codepage = *(ptr as *const u16).add(1);
        let key = HSTRING::from(format!("\\StringFileInfo\\{lang:04x}{codepage:04x}\\FileDescription"));
        if !VerQueryValueW(data.as_ptr() as *const c_void, PCWSTR(key.as_ptr()), &mut ptr, &mut len).as_bool() || len == 0 {
            return None;
        }
        let text = std::slice::from_raw_parts(ptr as *const u16, len as usize);
        let end = text.iter().position(|&c| c == 0).unwrap_or(text.len());
        let desc = String::from_utf16_lossy(&text[..end]).trim().to_string();
        (!desc.is_empty()).then_some(desc)
    }
}

/// The window as it looks, cropped to its visible frame.
fn capture(hwnd: HWND) -> Option<Rgba> {
    unsafe {
        if !IsWindow(Some(hwnd)).as_bool() {
            return None;
        }
        let mut rect = RECT::default();
        GetWindowRect(hwnd, &mut rect).ok()?;
        let (w, h) = (rect.right - rect.left, rect.bottom - rect.top);
        if w <= 0 || h <= 0 {
            return None;
        }
        let crop = frame(hwnd).unwrap_or(rect);
        // The frame, relative to the window and inside it.
        let x0 = (crop.left - rect.left).clamp(0, w);
        let y0 = (crop.top - rect.top).clamp(0, h);
        let x1 = (crop.right - rect.left).clamp(x0, w);
        let y1 = (crop.bottom - rect.top).clamp(y0, h);
        if x1 <= x0 || y1 <= y0 {
            return None;
        }

        let screen = GetDC(None);
        let dc = CreateCompatibleDC(Some(screen));
        let mut info = BITMAPINFO::default();
        info.bmiHeader = BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w,
            biHeight: -h, // top-down rows
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        };
        let mut bits: *mut c_void = std::ptr::null_mut();
        let result = match CreateDIBSection(Some(dc), &info, DIB_RGB_COLORS, &mut bits, None, 0) {
            Ok(bitmap) => {
                let old = SelectObject(dc, HGDIOBJ(bitmap.0));
                let printed = PrintWindow(hwnd, dc, PW_RENDERFULLCONTENT).as_bool();
                let img = (printed && !bits.is_null()).then(|| {
                    let src = std::slice::from_raw_parts(bits as *const u8, (w * h * 4) as usize);
                    crop_bgra(src, w as u32, (x0 as u32, y0 as u32, x1 as u32, y1 as u32))
                });
                SelectObject(dc, old);
                let _ = DeleteObject(HGDIOBJ(bitmap.0));
                img
            }
            Err(_) => None,
        };
        let _ = DeleteDC(dc);
        ReleaseDC(None, screen);
        result
    }
}

/// BGRA rows of `width` pixels → the RGBA box (x0, y0)–(x1, y1), opaque (the
/// alpha PrintWindow leaves is meaningless).
fn crop_bgra(src: &[u8], width: u32, (x0, y0, x1, y1): (u32, u32, u32, u32)) -> Rgba {
    let (cw, ch) = (x1 - x0, y1 - y0);
    let mut pixels = Vec::with_capacity((cw * ch * 4) as usize);
    for y in y0..y1 {
        let row = &src[((y * width + x0) * 4) as usize..((y * width + x1) * 4) as usize];
        for p in row.chunks_exact(4) {
            pixels.extend_from_slice(&[p[2], p[1], p[0], 255]);
        }
    }
    Rgba { width: cw, height: ch, pixels }
}

#[cfg(test)]
mod tests {
    use super::crop_bgra;

    #[test]
    fn crops_and_turns_bgra_into_opaque_rgba() {
        // 3 × 2, BGRA: pixel n has blue = n, green = 10 + n, red = 20 + n, alpha 0.
        let src: Vec<u8> = (0..6u8).flat_map(|n| [n, 10 + n, 20 + n, 0]).collect();
        let img = crop_bgra(&src, 3, (1, 0, 3, 2));
        assert_eq!((img.width, img.height), (2, 2));
        assert_eq!(img.pixels, vec![21, 11, 1, 255, 22, 12, 2, 255, 24, 14, 4, 255, 25, 15, 5, 255]);
    }

    /// The window in the middle of the main screen, saved as window_drop.png in
    /// the temp folder: `cargo test --lib window_drop::tests::live -- --ignored`.
    #[test]
    #[ignore]
    fn live() {
        use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_CXSCREEN, SM_CYSCREEN};
        let (x, y) = unsafe { (GetSystemMetrics(SM_CXSCREEN) / 2, GetSystemMetrics(SM_CYSCREEN) / 2) };
        let (hwnd, info) = super::info_at(x, y).expect("a window in the middle of the screen");
        let img = super::capture(hwnd).expect("its picture");
        let out = std::env::temp_dir().join("window_drop.png");
        std::fs::write(&out, crate::clipimage::encode_png(&img).unwrap()).unwrap();
        println!("{} | {} | {}×{} → {}", info.app_name, info.title, img.width, img.height, out.display());
    }
}
