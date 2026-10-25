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
    let img = shell_image(path, SIDE, true)?;
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

/// Windows' picture of `path`: its thumbnail (`thumb_only`) or the icon Explorer shows.
fn shell_image(path: &str, side: i32, thumb_only: bool) -> Option<Rgba> {
    unsafe {
        let init = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
        let out = (|| {
            let factory: IShellItemImageFactory = SHCreateItemFromParsingName(&HSTRING::from(path), None).ok()?;
            let flags = if thumb_only { SIIGBF_BIGGERSIZEOK | SIIGBF_THUMBNAILONLY } else { SIIGBF_BIGGERSIZEOK };
            let bmp = factory.GetImage(SIZE { cx: side, cy: side }, flags).ok()?;
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

// ── The icon of a quick action (asked by Edoardo on 25 Oct 2026): the program's
// own icon, or the site's favicon. Taken once, when the user picks «Automatica»,
// and stored in the action as a small PNG: nothing is fetched while showing it.

/// Side of an action's icon, px.
const ICON_SIDE: i32 = 64;

/// The icon of a program, folder or file (`target` of an "app" action) as a PNG data: URL.
pub fn program_icon(target: &str) -> Option<String> {
    let path = resolve_program(target.trim().trim_matches('"'))?;
    let img = shell_image(&path, ICON_SIDE, false)?;
    let png = clipimage::encode_png(&clipimage::thumbnail(&img, ICON_SIDE as u32)).ok()?;
    Some(clipimage::data_url(&png))
}

/// A full path as it is; a bare name ("notepad", "excel.exe") looked up on PATH.
fn resolve_program(target: &str) -> Option<String> {
    if target.is_empty() {
        return None;
    }
    let p = std::path::Path::new(target);
    if p.exists() {
        return Some(target.to_string());
    }
    if target.contains('\\') || target.contains('/') {
        return None;
    }
    let names: Vec<String> = if target.contains('.') { vec![target.to_string()] } else { vec![format!("{target}.exe"), target.to_string()] };
    let path = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path) {
        for n in &names {
            let full = dir.join(n);
            if full.is_file() {
                return Some(full.to_string_lossy().into_owned());
            }
        }
    }
    None
}

/// Biggest page / icon read, bytes.
const PAGE_MAX: usize = 1024 * 1024;
const FAVICON_MAX: usize = 512 * 1024;

/// The favicon of the site at `url` as a data: URL (any picture type: the front end redraws it as PNG).
pub async fn favicon(url: &str) -> Option<String> {
    let base = reqwest::Url::parse(url.trim()).ok()?;
    if !matches!(base.scheme(), "http" | "https") {
        return None;
    }
    let client = reqwest::Client::builder().timeout(std::time::Duration::from_secs(8)).build().ok()?;
    let mut candidates = Vec::new();
    if let Ok(resp) = client.get(base.clone()).send().await {
        let page_url = resp.url().clone();
        if let Ok(bytes) = resp.bytes().await {
            let html = String::from_utf8_lossy(bytes.get(..bytes.len().min(PAGE_MAX)).unwrap_or_default());
            for href in icon_links(&html) {
                if let Ok(u) = page_url.join(&href) {
                    candidates.push(u);
                }
            }
        }
    }
    if let Ok(u) = base.join("/favicon.ico") {
        candidates.push(u);
    }
    for u in candidates {
        let Ok(resp) = client.get(u).send().await else { continue };
        if !resp.status().is_success() {
            continue;
        }
        let ct = resp.headers().get("content-type").and_then(|v| v.to_str().ok()).unwrap_or("").to_ascii_lowercase();
        let Ok(bytes) = resp.bytes().await else { continue };
        if bytes.is_empty() || bytes.len() > FAVICON_MAX {
            continue;
        }
        let mime = if ct.starts_with("image/") {
            ct.split(';').next().unwrap_or("image/x-icon").trim().to_string()
        } else if bytes.starts_with(b"\x89PNG") {
            "image/png".into()
        } else if bytes.starts_with(&[0, 0, 1, 0]) {
            "image/x-icon".into()
        } else {
            continue;
        };
        return Some(format!("data:{mime};base64,{}", crate::claude::base64_for(&bytes)));
    }
    None
}

/// The href of each <link rel="…icon…"> in a page, the best first (apple-touch-icon is big and sharp).
fn icon_links(html: &str) -> Vec<String> {
    let lower = html.to_ascii_lowercase();
    let mut out: Vec<(u8, String)> = Vec::new();
    let mut from = 0;
    while let Some(i) = lower.get(from..).and_then(|s| s.find("<link")) {
        let start = from + i;
        let end = lower.get(start..).and_then(|s| s.find('>')).map(|e| start + e).unwrap_or(lower.len());
        from = end.max(start + 5);
        let (Some(tag), Some(orig)) = (lower.get(start..end), html.get(start..end)) else { break };
        let Some(rel) = attr(tag, tag, "rel") else { continue };
        if !rel.contains("icon") || rel.contains("mask") {
            continue;
        }
        let Some(href) = attr(tag, orig, "href") else { continue };
        let rank = if rel.contains("apple-touch") { 0 } else if tag.contains(".svg") { 1 } else { 2 };
        out.push((rank, href.trim().to_string()));
    }
    out.sort_by_key(|(r, _)| *r);
    out.into_iter().map(|(_, h)| h).collect()
}

/// The value of `name` in a tag: found in the lowercase `tag`, read from `orig` (same byte offsets).
fn attr(tag: &str, orig: &str, name: &str) -> Option<String> {
    let mut from = 0;
    loop {
        let i = from + tag.get(from..)?.find(name)?;
        from = i + name.len();
        let before_ok = i == 0 || tag.as_bytes().get(i - 1).is_some_and(|b| b.is_ascii_whitespace());
        let rest = tag.get(from..)?.trim_start();
        if !before_ok || !rest.starts_with('=') {
            continue;
        }
        let skip = tag.len() - rest.len() + 1;
        let value = orig.get(skip..)?.trim_start();
        let (q, body) = match value.chars().next()? {
            '"' => ('"', value.get(1..)?),
            '\'' => ('\'', value.get(1..)?),
            _ => (' ', value),
        };
        let end = body.find(q).unwrap_or(body.len());
        return body.get(..end).map(|s| s.to_string());
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

    #[test]
    fn icon_links_in_a_page() {
        let html = r#"<head><link rel="stylesheet" href="a.css"><LINK REL="icon" href='/Fav.png'><link rel="mask-icon" href="m.svg"><link rel="apple-touch-icon" href="/touch.png"></head>"#;
        assert_eq!(super::icon_links(html), vec!["/touch.png".to_string(), "/Fav.png".to_string()]);
        assert!(super::icon_links("<link rel=icon>").is_empty());
    }

    /// `cargo test -p easyisland --lib thumbs::live -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn live_icons() {
        let app = super::program_icon("notepad").expect("notepad's icon");
        println!("notepad: {} bytes", app.len());
        let site = tauri::async_runtime::block_on(super::favicon("https://github.com")).expect("favicon");
        println!("github: {}", site.get(..40).unwrap_or(&site));
    }
}
