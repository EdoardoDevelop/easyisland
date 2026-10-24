// Previews of pictures in the Vassoio and the work folder (asked by Edoardo on
// 24 Oct 2026): Windows' own thumbnail (IShellItemImageFactory, the one
// Explorer shows), as a small PNG data: URL. Only picture files; anything else
// keeps its icon by type in the island. Kept in memory by path and date.

use crate::clipimage::{self, Rgba};
use std::collections::HashMap;
use std::sync::Mutex;
use windows::core::HSTRING;
use windows::Win32::Foundation::SIZE;
use windows::Win32::Graphics::Gdi::{
    CreateCompatibleDC, DeleteDC, DeleteObject, GetDIBits, GetObjectW, BITMAP, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
    HBITMAP, HGDIOBJ,
};
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED};
use windows::Win32::UI::Shell::{IShellItemImageFactory, SHCreateItemFromParsingName, SIIGBF_BIGGERSIZEOK, SIIGBF_THUMBNAILONLY};

/// Picture files that get a preview.
const PICTURES: &[&str] = &["png", "jpg", "jpeg", "gif", "bmp", "webp", "tif", "tiff", "heic", "ico", "jfif"];
/// Side of the preview, px (two tiles' worth on a high-DPI screen).
const SIDE: i32 = 128;
const CACHE_MAX: usize = 300;

static CACHE: Mutex<Option<HashMap<String, String>>> = Mutex::new(None);

pub fn is_picture(path: &str) -> bool {
    let ext = path.rsplit_once('.').map(|(_, e)| e.to_ascii_lowercase()).unwrap_or_default();
    PICTURES.contains(&ext.as_str())
}

/// The preview of `path`, or None (not a picture, unreadable).
pub fn thumb(path: &str) -> Option<String> {
    if !is_picture(path) {
        return None;
    }
    let meta = std::fs::metadata(path).ok()?;
    let stamp = meta.modified().ok().and_then(|m| m.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    let key = format!("{path}|{stamp}|{}", meta.len());
    if let Some(hit) = CACHE.lock().unwrap().as_ref().and_then(|c| c.get(&key)) {
        return Some(hit.clone());
    }
    let img = shell_thumb(path)?;
    let png = clipimage::encode_png(&clipimage::thumbnail(&img, SIDE as u32)).ok()?;
    let url = clipimage::data_url(&png);
    let mut cache = CACHE.lock().unwrap();
    let map = cache.get_or_insert_with(HashMap::new);
    if map.len() >= CACHE_MAX {
        map.clear();
    }
    map.insert(key, url.clone());
    Some(url)
}

fn shell_thumb(path: &str) -> Option<Rgba> {
    unsafe {
        let init = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let out = (|| {
            let factory: IShellItemImageFactory = SHCreateItemFromParsingName(&HSTRING::from(path), None).ok()?;
            let bmp = factory.GetImage(SIZE { cx: SIDE, cy: SIDE }, SIIGBF_BIGGERSIZEOK | SIIGBF_THUMBNAILONLY).ok()?;
            let img = to_rgba(bmp);
            let _ = DeleteObject(HGDIOBJ(bmp.0));
            img
        })();
        if init.is_ok() {
            CoUninitialize();
        }
        out
    }
}

/// A 32-bit HBITMAP to RGBA, rows top to bottom.
unsafe fn to_rgba(bmp: HBITMAP) -> Option<Rgba> {
    unsafe {
        let mut info = BITMAP::default();
        if GetObjectW(HGDIOBJ(bmp.0), std::mem::size_of::<BITMAP>() as i32, Some(&mut info as *mut _ as *mut _)) == 0 {
            return None;
        }
        let (w, h) = (info.bmWidth, info.bmHeight.abs());
        if w <= 0 || h <= 0 || w > 4096 || h > 4096 {
            return None;
        }
        let mut bi = BITMAPINFO::default();
        bi.bmiHeader = BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w,
            biHeight: -h,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        };
        let mut px = vec![0u8; w as usize * h as usize * 4];
        let dc = CreateCompatibleDC(None);
        let rows = GetDIBits(dc, bmp, 0, h as u32, Some(px.as_mut_ptr() as *mut _), &mut bi, DIB_RGB_COLORS);
        let _ = DeleteDC(dc);
        if rows == 0 {
            return None;
        }
        // BGRA → RGBA; a bitmap without alpha (all 0) is opaque.
        let opaque = px.chunks_exact(4).all(|p| p[3] == 0);
        for p in px.chunks_exact_mut(4) {
            p.swap(0, 2);
            if opaque {
                p[3] = 255;
            }
        }
        Some(Rgba { width: w as u32, height: h as u32, pixels: px })
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn only_pictures_get_a_preview() {
        assert!(super::is_picture("C:\\a\\Foto.JPG"));
        assert!(super::is_picture("x.webp"));
        assert!(!super::is_picture("C:\\a\\doc.pdf"));
        assert!(!super::is_picture("noext"));
        assert_eq!(super::thumb("C:\\nope\\x.txt"), None);
    }
}
