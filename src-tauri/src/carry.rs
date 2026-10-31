// The character of the chat tab carried over the other windows (window_drop.rs):
// a small layered window that follows the mouse and shows it.
//
// A CSS cursor was not enough: outside the island's window Windows puts the
// arrow back, and every new picture left the pointer empty for a moment. This
// window is click-through, never takes the focus, stays on top, and is not in
// the taskbar or Alt+Tab. Its own thread moves it with the cursor (every 8 ms,
// only while it is shown); the island sends the character's face a few times
// a second (`frame`). The thread ends, and the window with it, on `hide`.

use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use windows::core::w;
use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, POINT, SIZE, WPARAM};
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, ReleaseDC, SelectObject, AC_SRC_ALPHA,
    AC_SRC_OVER, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, BLENDFUNCTION, DIB_RGB_COLORS, HGDIOBJ,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DestroyWindow, DispatchMessageW, GetCursorPos, PeekMessageW, RegisterClassW,
    ShowWindow, TranslateMessage, UpdateLayeredWindow, MSG, PM_REMOVE, SW_SHOWNOACTIVATE, ULW_ALPHA,
    WINDOW_STYLE, WNDCLASSW, WS_EX_LAYERED, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TOPMOST, WS_EX_TRANSPARENT,
    WS_POPUP,
};

/// The character's picture: RGBA rows, top to bottom, in physical pixels.
struct Frame {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
    version: u64,
}

static FRAME: Mutex<Option<Frame>> = Mutex::new(None);
static SHOWN: AtomicBool = AtomicBool::new(false);
/// Each window's thread runs while this is still its number: a quick hide and
/// show never leaves two of them.
static GENERATION: AtomicU64 = AtomicU64::new(0);

/// Shows the window (if it is not already) with this picture, or changes the picture.
pub fn frame(width: u32, height: u32, rgba: Vec<u8>) {
    if width == 0 || height == 0 || rgba.len() != (width * height * 4) as usize {
        return;
    }
    {
        let mut f = FRAME.lock().unwrap();
        let version = f.as_ref().map_or(1, |f| f.version + 1);
        *f = Some(Frame { width, height, rgba, version });
    }
    if !SHOWN.swap(true, Ordering::SeqCst) {
        let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
        std::thread::spawn(move || run(generation));
    }
}

/// Hides the window: its thread destroys it and ends.
pub fn hide() {
    SHOWN.store(false, Ordering::SeqCst);
    GENERATION.fetch_add(1, Ordering::SeqCst);
    *FRAME.lock().unwrap() = None;
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    DefWindowProcW(hwnd, msg, wparam, lparam)
}

fn run(generation: u64) {
    unsafe {
        let Ok(instance) = GetModuleHandleW(None) else { return };
        let class = WNDCLASSW {
            lpfnWndProc: Some(wndproc),
            hInstance: instance.into(),
            lpszClassName: w!("EasyIslandCarry"),
            ..Default::default()
        };
        // Fails harmlessly the second time: the class is already there.
        RegisterClassW(&class);
        let Ok(hwnd) = CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOPMOST | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
            w!("EasyIslandCarry"),
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
        ) else {
            return;
        };

        let mut drawn: u64 = 0;
        let mut size = SIZE::default();
        let mut last = POINT { x: i32::MIN, y: i32::MIN };
        let mut visible = false;
        let mut msg = MSG::default();
        while GENERATION.load(Ordering::SeqCst) == generation {
            while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            let mut cursor = POINT::default();
            let _ = GetCursorPos(&mut cursor);
            let new_picture = {
                let f = FRAME.lock().unwrap();
                match f.as_ref() {
                    Some(f) if f.version != drawn => {
                        drawn = f.version;
                        size = SIZE { cx: f.width as i32, cy: f.height as i32 };
                        Some(bgra_premultiplied(&f.rgba))
                    }
                    _ => None,
                }
            };
            if size.cx > 0 && (new_picture.is_some() || cursor.x != last.x || cursor.y != last.y) {
                last = cursor;
                // Centred on the pointer, a little below it: the hand holds it by the top.
                let at = POINT { x: cursor.x - size.cx / 2, y: cursor.y - size.cy * 3 / 10 };
                update(hwnd, at, size, new_picture.as_deref());
                if !visible {
                    let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
                    visible = true;
                }
            }
            std::thread::sleep(Duration::from_millis(8));
        }
        let _ = DestroyWindow(hwnd);
    }
}

/// Moves the window to `at`, with a new picture when there is one (BGRA, premultiplied).
/// Also the fixed bar's shadow (barshadow.rs).
pub(crate) unsafe fn update(hwnd: HWND, at: POINT, size: SIZE, picture: Option<&[u8]>) {
    let blend = BLENDFUNCTION {
        BlendOp: AC_SRC_OVER as u8,
        BlendFlags: 0,
        SourceConstantAlpha: 255,
        AlphaFormat: AC_SRC_ALPHA as u8,
    };
    let Some(bgra) = picture else {
        // Only the position: the picture already in the window stays.
        let _ = UpdateLayeredWindow(hwnd, None, Some(&at), None, None, None, COLORREF(0), None, ULW_ALPHA);
        return;
    };
    let screen = GetDC(None);
    let dc = CreateCompatibleDC(Some(screen));
    let mut info = BITMAPINFO::default();
    info.bmiHeader = BITMAPINFOHEADER {
        biSize: size_of::<BITMAPINFOHEADER>() as u32,
        biWidth: size.cx,
        biHeight: -size.cy,
        biPlanes: 1,
        biBitCount: 32,
        biCompression: BI_RGB.0,
        ..Default::default()
    };
    let mut bits: *mut std::ffi::c_void = std::ptr::null_mut();
    if let Ok(bitmap) = CreateDIBSection(Some(dc), &info, DIB_RGB_COLORS, &mut bits, None, 0) {
        if !bits.is_null() {
            std::ptr::copy_nonoverlapping(bgra.as_ptr(), bits as *mut u8, bgra.len());
        }
        let old = SelectObject(dc, HGDIOBJ(bitmap.0));
        let origin = POINT::default();
        let _ = UpdateLayeredWindow(
            hwnd,
            Some(screen),
            Some(&at),
            Some(&size),
            Some(dc),
            Some(&origin),
            COLORREF(0),
            Some(&blend),
            ULW_ALPHA,
        );
        SelectObject(dc, old);
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
    }
    let _ = DeleteDC(dc);
    ReleaseDC(None, screen);
}

/// RGBA (as a canvas gives it) → BGRA with the colour multiplied by alpha, as
/// UpdateLayeredWindow wants it.
fn bgra_premultiplied(rgba: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(rgba.len());
    for p in rgba.chunks_exact(4) {
        let a = p[3] as u16;
        let m = |c: u8| ((c as u16 * a + 127) / 255) as u8;
        out.extend_from_slice(&[m(p[2]), m(p[1]), m(p[0]), p[3]]);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::bgra_premultiplied;

    #[test]
    fn colours_are_swapped_and_multiplied_by_alpha() {
        assert_eq!(bgra_premultiplied(&[200, 100, 50, 255, 200, 100, 50, 0, 255, 0, 0, 128]), vec![
            50, 100, 200, 255, 0, 0, 0, 0, 0, 0, 128, 128,
        ]);
    }

    /// Shows a red disc under the pointer for a moment, checks the window, hides
    /// it: `cargo test --lib carry::tests::live -- --ignored`.
    #[test]
    #[ignore]
    fn live() {
        use windows::core::w;
        use windows::Win32::UI::WindowsAndMessaging::{FindWindowW, GetWindowLongPtrW, IsWindowVisible, GWL_EXSTYLE, WS_EX_TRANSPARENT};
        let n = 64u32;
        let mut rgba = vec![0u8; (n * n * 4) as usize];
        for y in 0..n {
            for x in 0..n {
                let (dx, dy) = (x as f32 - 31.5, y as f32 - 31.5);
                if dx * dx + dy * dy < 900.0 {
                    rgba[((y * n + x) * 4) as usize..][..4].copy_from_slice(&[230, 40, 40, 255]);
                }
            }
        }
        super::frame(n, n, rgba);
        std::thread::sleep(std::time::Duration::from_millis(600));
        let hwnd = unsafe { FindWindowW(w!("EasyIslandCarry"), None) }.expect("the carry window");
        unsafe {
            assert!(IsWindowVisible(hwnd).as_bool());
            assert!(GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & WS_EX_TRANSPARENT.0 as isize != 0);
        }
        super::hide();
        std::thread::sleep(std::time::Duration::from_millis(200));
        assert!(unsafe { FindWindowW(w!("EasyIslandCarry"), None) }.is_err());
    }
}
