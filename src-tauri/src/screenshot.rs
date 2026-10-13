// "Cerchia e chiedi": the shortcut (or + → Cattura) freezes the screen under the
// mouse, the island's own window covers that screen and shows the frozen picture
// (src/island/capture.ts), the user circles or boxes a zone, and the zone goes to
// the chat, a quick action, the clipboard, the tray or the OCR. No second
// webview (one made after launch comes up blank here), no snipping tool.
//
// The frozen screen lives in memory only while the overlay is up; `clear` drops it.

use std::ffi::c_void;
use std::sync::Mutex;

use serde::Serialize;
use windows::Win32::Foundation::POINT;
use windows::Win32::Graphics::Gdi::{
    BitBlt, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GetDC, GetMonitorInfoW, MonitorFromPoint,
    ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CAPTUREBLT, DIB_RGB_COLORS, HGDIOBJ, MONITORINFO,
    MONITOR_DEFAULTTONEAREST, SRCCOPY,
};
use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;

use crate::clipimage::{self, Rgba};
use crate::files::{self, DroppedFile};
use crate::i18n::t;

/// "Schermata 2026-10-04 15.30.12.png"
pub fn file_name(prefix: &str) -> String {
    let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    format!(
        "{prefix} {:04}-{:02}-{:02} {:02}.{:02}.{:02}.png",
        t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond
    )
}

/// The picture on the clipboard as a PNG in the inbox (Ctrl+Alt+K with an image copied).
pub fn clipboard_picture() -> Result<Option<DroppedFile>, String> {
    if crate::actions::clipboard_text().is_some() || !clipimage::has_image() {
        return Ok(None);
    }
    let Some(img) = clipimage::read() else { return Ok(None) };
    files::save_new(&file_name(t("Immagine copiata")), &clipimage::encode_png(&img)?).map(Some)
}

/// The frozen screen: where it is on the desktop (physical px) and its pixels.
struct Frozen {
    x: i32,
    y: i32,
    img: Rgba,
}

static FROZEN: Mutex<Option<Frozen>> = Mutex::new(None);

/// What the overlay needs to cover the frozen screen.
#[derive(Serialize, Clone, Copy, Debug)]
pub struct Screen {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// Freezes the screen under the mouse (all of it, as it looks now).
pub fn freeze() -> Result<Screen, String> {
    let (x, y, w, h) = monitor_under_cursor().ok_or(t("Schermo non trovato"))?;
    let img = grab(x, y, w, h).ok_or(t("Non riesco a leggere lo schermo"))?;
    let screen = Screen { x, y, width: img.width, height: img.height };
    *FROZEN.lock().unwrap() = Some(Frozen { x, y, img });
    Ok(screen)
}

/// The frozen screen's RGBA pixels, for the overlay to draw.
pub fn frame() -> Option<Vec<u8>> {
    FROZEN.lock().unwrap().as_ref().map(|f| f.img.pixels.clone())
}

/// The frozen screen's place, for the island's window to cover it.
pub fn frozen_screen() -> Option<Screen> {
    FROZEN.lock().unwrap().as_ref().map(|f| Screen { x: f.x, y: f.y, width: f.img.width, height: f.img.height })
}

pub fn clear() {
    *FROZEN.lock().unwrap() = None;
}

/// A zone of the frozen screen (physical px from its corner), kept inside it.
fn zone(x: f64, y: f64, w: f64, h: f64) -> Result<Rgba, String> {
    let guard = FROZEN.lock().unwrap();
    let f = guard.as_ref().ok_or(t("La cattura è già chiusa"))?;
    let (x0, y0, x1, y1) = clamp_zone(f.img.width, f.img.height, x, y, w, h).ok_or(t("Zona troppo piccola"))?;
    Ok(crop(&f.img, x0, y0, x1, y1))
}

/// The box (x0, y0)–(x1, y1) inside a `width` × `height` picture; None when it is under 2 px.
fn clamp_zone(width: u32, height: u32, x: f64, y: f64, w: f64, h: f64) -> Option<(u32, u32, u32, u32)> {
    let x0 = x.max(0.0).floor().min(width as f64) as u32;
    let y0 = y.max(0.0).floor().min(height as f64) as u32;
    let x1 = (x + w).ceil().clamp(0.0, width as f64) as u32;
    let y1 = (y + h).ceil().clamp(0.0, height as f64) as u32;
    (x1 >= x0 + 2 && y1 >= y0 + 2).then_some((x0, y0, x1, y1))
}

fn crop(img: &Rgba, x0: u32, y0: u32, x1: u32, y1: u32) -> Rgba {
    let mut pixels = Vec::with_capacity(((x1 - x0) * (y1 - y0) * 4) as usize);
    for y in y0..y1 {
        let start = ((y * img.width + x0) * 4) as usize;
        pixels.extend_from_slice(&img.pixels[start..start + ((x1 - x0) * 4) as usize]);
    }
    Rgba { width: x1 - x0, height: y1 - y0, pixels }
}

/// The zone as a PNG in the inbox: for the chat, a quick action, or kept in the tray.
pub fn save_zone(x: f64, y: f64, w: f64, h: f64) -> Result<DroppedFile, String> {
    let img = zone(x, y, w, h)?;
    files::save_new(&file_name(t("Schermata")), &clipimage::encode_png(&img)?)
}

/// The zone on the clipboard, as a picture.
pub fn copy_zone(x: f64, y: f64, w: f64, h: f64) -> Result<(), String> {
    clipimage::write(&zone(x, y, w, h)?)
}

/// The zone's text, read by Windows' own OCR (Windows.Media.Ocr, the languages
/// installed for the user), one line per line; also put on the clipboard.
pub fn zone_text(x: f64, y: f64, w: f64, h: f64) -> Result<String, String> {
    let img = zone(x, y, w, h)?;
    let text = ocr(&img)?;
    if text.trim().is_empty() {
        return Err(t("Nessun testo riconosciuto nella zona").into());
    }
    crate::actions::set_clipboard_text(&text)?;
    Ok(text)
}

fn ocr(img: &Rgba) -> Result<String, String> {
    use windows::Graphics::Imaging::{BitmapAlphaMode, BitmapPixelFormat, SoftwareBitmap};
    use windows::Media::Ocr::OcrEngine;
    use windows::Storage::Streams::DataWriter;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    let unavailable = |_| t("Riconoscimento del testo non disponibile su questo PC").to_string();
    unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    }
    // Small text reads better a little bigger; the engine has its own size limit.
    let max = OcrEngine::MaxImageDimension().unwrap_or(10000);
    let factor = if img.width.max(img.height) * 2 <= max && img.height < 400 { 2 } else { 1 };
    let img = if factor > 1 { upscale(img, factor) } else { Rgba { width: img.width, height: img.height, pixels: img.pixels.clone() } };
    if img.width > max || img.height > max {
        return Err(t("Zona troppo grande per il riconoscimento del testo").into());
    }
    let bgra: Vec<u8> = img.pixels.chunks_exact(4).flat_map(|p| [p[2], p[1], p[0], 255]).collect();
    let writer = DataWriter::new().map_err(unavailable)?;
    writer.WriteBytes(&bgra).map_err(unavailable)?;
    let buffer = writer.DetachBuffer().map_err(unavailable)?;
    let bitmap = SoftwareBitmap::CreateCopyWithAlphaFromBuffer(
        &buffer,
        BitmapPixelFormat::Bgra8,
        img.width as i32,
        img.height as i32,
        BitmapAlphaMode::Premultiplied,
    )
    .map_err(unavailable)?;
    let engine = OcrEngine::TryCreateFromUserProfileLanguages()
        .map_err(|_| t("Nessuna lingua di Windows con il riconoscimento del testo"))?;
    let result = engine.RecognizeAsync(&bitmap).map_err(unavailable)?.get().map_err(unavailable)?;
    let mut lines = Vec::new();
    for line in result.Lines().map_err(unavailable)? {
        lines.push(line.Text().map(|s| s.to_string()).unwrap_or_default());
    }
    Ok(lines.join("\n"))
}

/// Nearest-neighbour enlargement: sharp edges are what the OCR wants.
fn upscale(img: &Rgba, k: u32) -> Rgba {
    let (w, h) = (img.width * k, img.height * k);
    let mut pixels = Vec::with_capacity((w * h * 4) as usize);
    for y in 0..h {
        let row = ((y / k) * img.width * 4) as usize;
        for x in 0..w {
            let at = row + ((x / k) * 4) as usize;
            pixels.extend_from_slice(&img.pixels[at..at + 4]);
        }
    }
    Rgba { width: w, height: h, pixels }
}

/// The monitor the mouse is on: its rectangle in physical px.
fn monitor_under_cursor() -> Option<(i32, i32, u32, u32)> {
    unsafe {
        let mut p = POINT::default();
        GetCursorPos(&mut p).ok()?;
        let m = MonitorFromPoint(p, MONITOR_DEFAULTTONEAREST);
        let mut info = MONITORINFO { cbSize: size_of::<MONITORINFO>() as u32, ..Default::default() };
        if !GetMonitorInfoW(m, &mut info).as_bool() {
            return None;
        }
        let r = info.rcMonitor;
        let (w, h) = (r.right - r.left, r.bottom - r.top);
        (w > 0 && h > 0).then_some((r.left, r.top, w as u32, h as u32))
    }
}

/// What is on screen in that rectangle, layered windows included (CAPTUREBLT).
fn grab(x: i32, y: i32, w: u32, h: u32) -> Option<Rgba> {
    unsafe {
        let screen = GetDC(None);
        let dc = CreateCompatibleDC(Some(screen));
        let mut info = BITMAPINFO::default();
        info.bmiHeader = BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w as i32,
            biHeight: -(h as i32), // top-down rows
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        };
        let mut bits: *mut c_void = std::ptr::null_mut();
        let result = match CreateDIBSection(Some(dc), &info, DIB_RGB_COLORS, &mut bits, None, 0) {
            Ok(bitmap) => {
                let old = SelectObject(dc, HGDIOBJ(bitmap.0));
                let copied = BitBlt(dc, 0, 0, w as i32, h as i32, Some(screen), x, y, SRCCOPY | CAPTUREBLT).is_ok();
                let img = (copied && !bits.is_null()).then(|| {
                    let src = std::slice::from_raw_parts(bits as *const u8, (w * h * 4) as usize);
                    crate::window_drop::crop_bgra(src, w, (0, 0, w, h))
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

#[cfg(test)]
mod tests {
    use super::{clamp_zone, crop, upscale};
    use crate::clipimage::Rgba;

    #[test]
    fn zones_stay_inside_the_screen() {
        assert_eq!(clamp_zone(100, 50, 10.4, 5.0, 20.0, 10.0), Some((10, 5, 31, 15)));
        assert_eq!(clamp_zone(100, 50, -5.0, -5.0, 20.0, 20.0), Some((0, 0, 15, 15)));
        assert_eq!(clamp_zone(100, 50, 90.0, 40.0, 50.0, 50.0), Some((90, 40, 100, 50)));
        assert_eq!(clamp_zone(100, 50, 10.0, 10.0, 1.0, 30.0), None);
        assert_eq!(clamp_zone(100, 50, 200.0, 10.0, 10.0, 10.0), None);
    }

    #[test]
    fn crops_and_enlarges() {
        // 3 × 2: pixel n is [n, n, n, 255].
        let img = Rgba { width: 3, height: 2, pixels: (0..6u8).flat_map(|n| [n, n, n, 255]).collect() };
        let c = crop(&img, 1, 0, 3, 2);
        assert_eq!((c.width, c.height), (2, 2));
        assert_eq!(c.pixels.chunks(4).map(|p| p[0]).collect::<Vec<_>>(), vec![1, 2, 4, 5]);
        let big = upscale(&c, 2);
        assert_eq!((big.width, big.height), (4, 4));
        assert_eq!(big.pixels.chunks(4).map(|p| p[0]).collect::<Vec<_>>(), vec![1, 1, 2, 2, 1, 1, 2, 2, 4, 4, 5, 5, 4, 4, 5, 5]);
    }
}

/// The screen under the mouse, frozen, and the OCR of its top-left corner:
/// `cargo test -p easyisland --lib screenshot::live -- --ignored --nocapture`.
#[cfg(test)]
mod live {
    #[test]
    #[ignore]
    fn live() {
        let s = super::freeze().expect("freeze");
        println!("schermo: {s:?}");
        let w = (s.width as f64).min(900.0);
        let started = std::time::Instant::now();
        let text = super::ocr(&super::zone(0.0, 0.0, w, 300.0).expect("zone")).expect("ocr");
        println!("ocr in {:?}:\n{text}", started.elapsed());
        super::clear();
    }
}
