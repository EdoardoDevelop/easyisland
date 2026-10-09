// Images on the Windows clipboard: read them (the "PNG" format some apps add,
// else CF_DIB, which Windows synthesises from any bitmap), put them back, and
// turn them into PNG files and small thumbnails.
//
// Used by the screenshot ("Cattura una zona") and by the image entries of the
// "Appunti" history. PNG goes through the `png` crate, already in the tree
// through Tauri (tray-icon, muda): nothing new is built.

use std::io::Cursor;
use std::time::Duration;

use windows::core::w;
use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL};
use windows::Win32::System::DataExchange::{
    CloseClipboard, EmptyClipboard, GetClipboardData, GetClipboardSequenceNumber, IsClipboardFormatAvailable,
    OpenClipboard, RegisterClipboardFormatW, SetClipboardData,
};
use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalSize, GlobalUnlock, GMEM_MOVEABLE};
use windows::Win32::System::Ole::CF_DIB;
use crate::i18n::t;

/// Bigger images are not worth keeping (or sending to Claude): 8K × 4K.
const MAX_PIXELS: u64 = 33_000_000;

/// 8-bit RGBA, rows top to bottom.
#[derive(Clone)]
pub struct Rgba {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u8>,
}

/// Changes every time anything is copied, by any app.
pub fn sequence() -> u32 {
    unsafe { GetClipboardSequenceNumber() }
}

fn png_format() -> u32 {
    unsafe { RegisterClipboardFormatW(w!("PNG")) }
}

/// True when the clipboard holds a picture (and reading it is worth a try).
pub fn has_image() -> bool {
    unsafe {
        IsClipboardFormatAvailable(CF_DIB.0 as u32).is_ok()
            || (png_format() != 0 && IsClipboardFormatAvailable(png_format()).is_ok())
    }
}

unsafe fn open() -> bool {
    // Another app may hold the clipboard for a moment.
    for _ in 0..5 {
        if OpenClipboard(None).is_ok() {
            return true;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    false
}

/// The bytes of one clipboard format, if it is there.
unsafe fn read_format(format: u32) -> Option<Vec<u8>> {
    let handle = GetClipboardData(format).ok()?;
    let global = HGLOBAL(handle.0);
    let size = GlobalSize(global);
    let ptr = GlobalLock(global) as *const u8;
    if ptr.is_null() || size == 0 {
        return None;
    }
    let bytes = std::slice::from_raw_parts(ptr, size).to_vec();
    let _ = GlobalUnlock(global);
    Some(bytes)
}

/// The picture on the clipboard, if any.
pub fn read() -> Option<Rgba> {
    unsafe {
        if !open() {
            return None;
        }
        let png = png_format();
        let png_bytes = if png != 0 && IsClipboardFormatAvailable(png).is_ok() { read_format(png) } else { None };
        let dib = if png_bytes.is_none() { read_format(CF_DIB.0 as u32) } else { None };
        let _ = CloseClipboard();
        match (png_bytes, dib) {
            (Some(p), _) => decode_png(&p).ok(),
            (None, Some(d)) => from_dib(&d),
            _ => None,
        }
    }
}

/// Puts `img` on the clipboard as a bitmap (every app) and as PNG (keeps transparency
/// in Office, browsers…).
pub fn write(img: &Rgba) -> Result<(), String> {
    let dib = to_dib(img);
    let png_bytes = encode_png(img)?;
    unsafe {
        if !open() {
            return Err(t("Gli appunti sono occupati da un'altra app").into());
        }
        let result = (|| {
            EmptyClipboard().map_err(|e| e.to_string())?;
            put(CF_DIB.0 as u32, &dib)?;
            let png = png_format();
            if png != 0 {
                // A bitmap is already there: losing the PNG copy is not an error.
                let _ = put(png, &png_bytes);
            }
            Ok(())
        })();
        let _ = CloseClipboard();
        result
    }
}

unsafe fn put(format: u32, bytes: &[u8]) -> Result<(), String> {
    let mem = GlobalAlloc(GMEM_MOVEABLE, bytes.len()).map_err(|e| e.to_string())?;
    let ptr = GlobalLock(mem) as *mut u8;
    if ptr.is_null() {
        let _ = GlobalFree(Some(mem));
        return Err(t("memoria non disponibile").into());
    }
    std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
    let _ = GlobalUnlock(mem);
    // On success the clipboard owns the memory.
    if SetClipboardData(format, Some(HANDLE(mem.0))).is_err() {
        let _ = GlobalFree(Some(mem));
        return Err(t("copia non riuscita").into());
    }
    Ok(())
}

fn u16_at(b: &[u8], at: usize) -> Option<u16> {
    Some(u16::from_le_bytes(b.get(at..at + 2)?.try_into().ok()?))
}

fn u32_at(b: &[u8], at: usize) -> Option<u32> {
    Some(u32::from_le_bytes(b.get(at..at + 4)?.try_into().ok()?))
}

/// A packed DIB (BITMAPINFOHEADER or V4/V5, then masks/palette, then pixels) →
/// RGBA. 24 and 32 bit, uncompressed or with bit fields: what screenshots and
/// copied pictures are in practice.
pub fn from_dib(b: &[u8]) -> Option<Rgba> {
    const BI_RGB: u32 = 0;
    const BI_BITFIELDS: u32 = 3;
    let header = u32_at(b, 0)? as usize;
    let width = u32_at(b, 4)? as i32;
    let raw_height = u32_at(b, 8)? as i32;
    let bits = u16_at(b, 14)?;
    let compression = u32_at(b, 16)?;
    let colors_used = u32_at(b, 32)? as usize;
    if header < 40 || width <= 0 || raw_height == 0 || !(bits == 24 || bits == 32) {
        return None;
    }
    let (width, height) = (width as u32, raw_height.unsigned_abs());
    if width as u64 * height as u64 > MAX_PIXELS {
        return None;
    }

    // Channel masks: in the header from V4 on, right after it for a plain BITMAPINFOHEADER.
    let (mut masks, mut offset) = ([0x00FF_0000u32, 0x0000_FF00, 0x0000_00FF, 0], header);
    if compression == BI_BITFIELDS {
        let at = if header >= 52 { 40 } else { header };
        masks = [u32_at(b, at)?, u32_at(b, at + 4)?, u32_at(b, at + 8)?, if header >= 56 { u32_at(b, 52)? } else { 0 }];
        if header < 52 {
            offset += 12;
        }
    } else if compression != BI_RGB {
        return None;
    }
    offset += colors_used * 4;

    let stride = ((width as usize * bits as usize + 31) / 32) * 4;
    if b.len() < offset + stride * height as usize {
        return None;
    }
    let channel = |px: u32, mask: u32| -> u8 {
        if mask == 0 {
            return 0;
        }
        let shift = mask.trailing_zeros();
        let max = mask >> shift;
        (((px & mask) >> shift) * 255 / max.max(1)) as u8
    };

    let mut pixels = vec![0u8; width as usize * height as usize * 4];
    let mut any_alpha = false;
    for y in 0..height as usize {
        // Positive height = bottom-up rows.
        let src_row = if raw_height > 0 { height as usize - 1 - y } else { y };
        let row = &b[offset + src_row * stride..];
        for x in 0..width as usize {
            let o = (y * width as usize + x) * 4;
            if bits == 24 {
                let p = &row[x * 3..x * 3 + 3];
                pixels[o..o + 4].copy_from_slice(&[p[2], p[1], p[0], 255]);
            } else {
                let px = u32::from_le_bytes(row[x * 4..x * 4 + 4].try_into().unwrap());
                let (r, g, bl) = (channel(px, masks[0]), channel(px, masks[1]), channel(px, masks[2]));
                // Plain 32-bit DIBs often leave the 4th byte at 0: that means "no alpha", not "invisible".
                let a = if compression == BI_RGB { (px >> 24) as u8 } else { channel(px, masks[3]) };
                any_alpha |= a != 0;
                pixels[o..o + 4].copy_from_slice(&[r, g, bl, a]);
            }
        }
    }
    if bits == 32 && (!any_alpha || (compression == BI_BITFIELDS && masks[3] == 0)) {
        for a in pixels.iter_mut().skip(3).step_by(4) {
            *a = 255;
        }
    }
    Some(Rgba { width, height, pixels })
}

/// RGBA → a packed 32-bit bottom-up DIB, the most widely understood form.
pub fn to_dib(img: &Rgba) -> Vec<u8> {
    let (w, h) = (img.width as usize, img.height as usize);
    let mut out = Vec::with_capacity(40 + w * h * 4);
    out.extend_from_slice(&40u32.to_le_bytes());
    out.extend_from_slice(&(img.width as i32).to_le_bytes());
    out.extend_from_slice(&(img.height as i32).to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&32u16.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes()); // BI_RGB
    out.extend_from_slice(&((w * h * 4) as u32).to_le_bytes());
    out.extend_from_slice(&[0u8; 16]); // resolution, palette
    for y in (0..h).rev() {
        for x in 0..w {
            let p = &img.pixels[(y * w + x) * 4..(y * w + x) * 4 + 4];
            out.extend_from_slice(&[p[2], p[1], p[0], p[3]]);
        }
    }
    out
}

pub fn encode_png(img: &Rgba) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    {
        let mut enc = png::Encoder::new(&mut out, img.width, img.height);
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        let mut writer = enc.write_header().map_err(|e| e.to_string())?;
        writer.write_image_data(&img.pixels).map_err(|e| e.to_string())?;
    }
    Ok(out)
}

pub fn decode_png(bytes: &[u8]) -> Result<Rgba, String> {
    let mut dec = png::Decoder::new(Cursor::new(bytes));
    dec.set_transformations(png::Transformations::normalize_to_color8());
    let mut reader = dec.read_info().map_err(|e| e.to_string())?;
    let size = reader.output_buffer_size().ok_or(t("immagine troppo grande"))?;
    let mut buf = vec![0u8; size];
    let info = reader.next_frame(&mut buf).map_err(|e| e.to_string())?;
    if info.width as u64 * info.height as u64 > MAX_PIXELS {
        return Err(t("immagine troppo grande").into());

    }
    buf.truncate(info.buffer_size());
    let pixels: Vec<u8> = match info.color_type {
        png::ColorType::Rgba => buf,
        png::ColorType::Rgb => buf.chunks_exact(3).flat_map(|p| [p[0], p[1], p[2], 255]).collect(),
        png::ColorType::GrayscaleAlpha => buf.chunks_exact(2).flat_map(|p| [p[0], p[0], p[0], p[1]]).collect(),
        png::ColorType::Grayscale => buf.iter().flat_map(|&g| [g, g, g, 255]).collect(),
        png::ColorType::Indexed => return Err(t("formato PNG non supportato").into()),
    };
    Ok(Rgba { width: info.width, height: info.height, pixels })
}

/// A copy that fits in `max` × `max`, each pixel the average of the ones it covers.
pub fn thumbnail(img: &Rgba, max: u32) -> Rgba {
    let scale = (img.width.max(img.height) as f64 / max as f64).max(1.0);
    let w = ((img.width as f64 / scale).round() as u32).max(1);
    let h = ((img.height as f64 / scale).round() as u32).max(1);
    let mut pixels = Vec::with_capacity((w * h * 4) as usize);
    for ty in 0..h {
        let y0 = (ty as f64 * scale) as u32;
        let y1 = (((ty + 1) as f64 * scale) as u32).clamp(y0 + 1, img.height);
        for tx in 0..w {
            let x0 = (tx as f64 * scale) as u32;
            let x1 = (((tx + 1) as f64 * scale) as u32).clamp(x0 + 1, img.width);
            let mut sum = [0u64; 4];
            for y in y0..y1 {
                for x in x0..x1 {
                    let o = ((y * img.width + x) * 4) as usize;
                    for c in 0..4 {
                        sum[c] += img.pixels[o + c] as u64;
                    }
                }
            }
            let n = ((y1 - y0) * (x1 - x0)) as u64;
            pixels.extend(sum.iter().map(|s| (s / n) as u8));
        }
    }
    Rgba { width: w, height: h, pixels }
}

/// A PNG as a data URL, for an <img> in the island.
pub fn data_url(png_bytes: &[u8]) -> String {
    format!("data:image/png;base64,{}", crate::claude::base64_for(png_bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample() -> Rgba {
        // 3 × 2: red, green, blue / white, black, half-transparent grey.
        Rgba {
            width: 3,
            height: 2,
            pixels: vec![
                255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, //
                255, 255, 255, 255, 0, 0, 0, 255, 128, 128, 128, 128,
            ],
        }
    }

    #[test]
    fn dib_round_trip() {
        let img = sample();
        let back = from_dib(&to_dib(&img)).unwrap();
        assert_eq!((back.width, back.height), (3, 2));
        assert_eq!(back.pixels, img.pixels);
    }

    #[test]
    fn dib_without_alpha_is_opaque() {
        // 32-bit BI_RGB with the 4th byte left at 0, as most apps copy it.
        let mut dib = to_dib(&sample());
        for a in dib[40..].iter_mut().skip(3).step_by(4) {
            *a = 0;
        }
        let img = from_dib(&dib).unwrap();
        assert!(img.pixels.iter().skip(3).step_by(4).all(|&a| a == 255));
        assert_eq!(&img.pixels[0..3], &[255, 0, 0]);
    }

    #[test]
    fn dib_24_bit_top_down_with_padding() {
        // 1 × 2, 24 bit, negative height (top-down): each row padded to 4 bytes.
        let mut dib = vec![0u8; 40];
        dib[0..4].copy_from_slice(&40u32.to_le_bytes());
        dib[4..8].copy_from_slice(&1i32.to_le_bytes());
        dib[8..12].copy_from_slice(&(-2i32).to_le_bytes());
        dib[12..14].copy_from_slice(&1u16.to_le_bytes());
        dib[14..16].copy_from_slice(&24u16.to_le_bytes());
        dib.extend_from_slice(&[0, 0, 255, 0]); // top: red (BGR + pad)
        dib.extend_from_slice(&[255, 0, 0, 0]); // bottom: blue
        let img = from_dib(&dib).unwrap();
        assert_eq!(img.pixels, vec![255, 0, 0, 255, 0, 0, 255, 255]);
    }

    #[test]
    fn png_round_trip_and_thumbnail() {
        let img = sample();
        let back = decode_png(&encode_png(&img).unwrap()).unwrap();
        assert_eq!(back.pixels, img.pixels);

        let big = Rgba { width: 400, height: 100, pixels: vec![200; 400 * 100 * 4] };
        let t = thumbnail(&big, 100);
        assert_eq!((t.width, t.height), (100, 25));
        assert!(t.pixels.iter().all(|&p| p == 200));
        // Never scaled up.
        assert_eq!(thumbnail(&img, 100).width, 3);
    }

    #[test]
    fn broken_dibs_are_refused() {
        assert!(from_dib(&[]).is_none());
        let mut dib = to_dib(&sample());
        dib.truncate(50);
        assert!(from_dib(&dib).is_none());
    }
}
