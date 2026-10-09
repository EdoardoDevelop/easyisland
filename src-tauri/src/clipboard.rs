// The "Appunti" integration: a history of the text and pictures copied on this PC.
//
// A message-only window registered with AddClipboardFormatListener wakes up on
// WM_CLIPBOARDUPDATE only — no polling, nothing to do while nobody copies. The
// history lives in memory only: it is never written to disk and is gone when
// the app quits (pinned entries included), since a clipboard often holds
// things that should not end up in a file. Pictures are kept as PNG (much smaller
// than the bitmap Windows hands over) with a small thumbnail for the island.
//
// Copies that password managers and similar apps mark as private
// (ExcludeClipboardContentFromMonitorProcessing, CanIncludeInClipboardHistory = 0,
// Clipboard Viewer Ignore) are never recorded.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use serde_json::json;
use tauri::AppHandle;
use windows::core::w;
use windows::Win32::Foundation::{HGLOBAL, HWND, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::DataExchange::{
    AddClipboardFormatListener, CloseClipboard, GetClipboardData, IsClipboardFormatAvailable,
    OpenClipboard, RegisterClipboardFormatW,
};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::System::Memory::{GlobalLock, GlobalUnlock};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_CONTROL,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateWindowExW, DefWindowProcW, DispatchMessageW, GetMessageW, RegisterClassW, HWND_MESSAGE, MSG,
    WINDOW_EX_STYLE, WINDOW_STYLE, WNDCLASSW,
};

use crate::clipimage::{self, Rgba};
use crate::files::DroppedFile;
use crate::integrations::{self, IntegrationUpdate};
use crate::i18n::t;

pub const ID: &str = "integration_clipboard";
const WM_CLIPBOARDUPDATE: u32 = 0x031D;
/// Unpinned entries kept; pinned ones do not count.
const KEEP: usize = 30;
/// Longer copies are kept up to here (a whole log file is not a clipboard snippet).
const MAX_CHARS: usize = 20_000;
/// What the island receives of each entry.
const PREVIEW_CHARS: usize = 300;
/// Unpinned pictures kept (they count among the KEEP entries too).
const KEEP_PICTURES: usize = 10;
/// Thumbnail size in the island, in pixels (shown at half size: sharp on HiDPI).
const THUMB: u32 = 96;

#[derive(Clone)]
struct Picture {
    png: Vec<u8>,
    /// data: URL of the thumbnail.
    thumb: String,
    width: u32,
    height: u32,
    /// Tells a fresh copy of the same picture from a new one.
    hash: u64,
}

#[derive(Clone)]
struct Clip {
    id: u64,
    /// Empty for a picture.
    text: String,
    picture: Option<Picture>,
    at: u64,
    pinned: bool,
}

static HISTORY: Mutex<Vec<Clip>> = Mutex::new(Vec::new());
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
static APP: OnceLock<AppHandle> = OnceLock::new();
/// Copies made by EasyIsland itself to read a selection (context.rs) stay out of the history.
static IGNORE_UNTIL: Mutex<Option<std::time::Instant>> = Mutex::new(None);

pub fn ignore_next(for_how_long: Duration) {
    *IGNORE_UNTIL.lock().unwrap() = Some(std::time::Instant::now() + for_how_long);
}

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    id: u64,
    kind: &'static str,
    preview: String,
    chars: usize,
    lines: usize,
    at: u64,
    pinned: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    thumb: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    width: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    height: Option<u32>,
}

/// Sends the history to the island.
pub fn publish(app: &AppHandle) {
    let items: Vec<Entry> = HISTORY
        .lock()
        .unwrap()
        .iter()
        .map(|c| {
            let mut preview: String = c.text.chars().take(PREVIEW_CHARS).collect();
            if preview.len() < c.text.len() {
                preview.push('…');
            }
            let pic = c.picture.as_ref();
            Entry {
                id: c.id,
                kind: if pic.is_some() { "image" } else { "text" },
                preview,
                chars: c.text.chars().count(),
                lines: c.text.lines().count().max(1),
                at: c.at,
                pinned: c.pinned,
                thumb: pic.map(|p| p.thumb.clone()),
                width: pic.map(|p| p.width),
                height: pic.map(|p| p.height),
            }
        })
        .collect();
    integrations::emit(app, IntegrationUpdate { id: ID, data: json!({ "items": items }), error: None, event: None });
}

/// A new copy goes on top; copying something already in the list moves it up.
fn record(text: String) -> bool {
    if text.trim().is_empty() {
        return false;
    }
    let text: String = if text.chars().count() > MAX_CHARS { text.chars().take(MAX_CHARS).collect() } else { text };
    let mut list = HISTORY.lock().unwrap();
    let same = |c: &Clip| c.picture.is_none() && c.text == text;
    if list.first().is_some_and(same) {
        return false;
    }
    let pinned = match list.iter().position(same) {
        Some(i) => list.remove(i).pinned,
        None => false,
    };
    list.insert(0, Clip { id: NEXT_ID.fetch_add(1, Ordering::Relaxed), text, picture: None, at: now_ms(), pinned });
    trim(&mut list);
    true
}

/// Keeps at most KEEP unpinned entries, KEEP_PICTURES of them pictures.
fn trim(list: &mut Vec<Clip>) {
    let (mut unpinned, mut pictures) = (0, 0);
    list.retain(|c| {
        if c.pinned {
            return true;
        }
        if c.picture.is_some() {
            pictures += 1;
            if pictures > KEEP_PICTURES {
                return false;
            }
        }
        unpinned += 1;
        unpinned <= KEEP
    });
}

/// FNV-1a over size and pixels.
fn hash(img: &Rgba) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in img.width.to_le_bytes().iter().chain(&img.height.to_le_bytes()).chain(&img.pixels) {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0100_0000_01b3);
    }
    h
}

/// A copied picture goes on top, like a text; the same picture again just moves up.
fn record_picture(img: &Rgba) -> bool {
    let fingerprint = hash(img);
    let same = |c: &Clip| c.picture.as_ref().is_some_and(|p| p.hash == fingerprint);
    {
        let mut list = HISTORY.lock().unwrap();
        if list.first().is_some_and(same) {
            return false;
        }
        if let Some(i) = list.iter().position(same) {
            let mut clip = list.remove(i);
            clip.at = now_ms();
            list.insert(0, clip);
            return true;
        }
    }
    // Encoding takes a moment on a big screenshot: not under the lock.
    let Ok(png) = clipimage::encode_png(img) else { return false };
    let Ok(thumb_png) = clipimage::encode_png(&clipimage::thumbnail(img, THUMB)) else { return false };
    let picture = Picture {
        png,
        thumb: clipimage::data_url(&thumb_png),
        width: img.width,
        height: img.height,
        hash: fingerprint,
    };
    let mut list = HISTORY.lock().unwrap();
    let id = NEXT_ID.fetch_add(1, Ordering::Relaxed);
    list.insert(0, Clip { id, text: String::new(), picture: Some(picture), at: now_ms(), pinned: false });
    trim(&mut list);
    true
}

/// True when the app that copied asked monitors not to look (password managers do).
unsafe fn is_private() -> bool {
    let exclude = RegisterClipboardFormatW(w!("ExcludeClipboardContentFromMonitorProcessing"));
    let ignore = RegisterClipboardFormatW(w!("Clipboard Viewer Ignore"));
    if (exclude != 0 && IsClipboardFormatAvailable(exclude).is_ok())
        || (ignore != 0 && IsClipboardFormatAvailable(ignore).is_ok())
    {
        return true;
    }
    let history = RegisterClipboardFormatW(w!("CanIncludeInClipboardHistory"));
    if history == 0 || IsClipboardFormatAvailable(history).is_err() {
        return false;
    }
    // A DWORD: 0 means "keep me out of any history".
    let mut opened = false;
    for _ in 0..5 {
        if OpenClipboard(None).is_ok() {
            opened = true;
            break;
        }
        std::thread::sleep(Duration::from_millis(20));
    }
    if !opened {
        return true;
    }
    let private = (|| {
        let handle = GetClipboardData(history).ok()?;
        let global = HGLOBAL(handle.0);
        let ptr = GlobalLock(global) as *const u32;
        if ptr.is_null() {
            return None;
        }
        let value = *ptr;
        let _ = GlobalUnlock(global);
        Some(value == 0)
    })()
    .unwrap_or(true);
    let _ = CloseClipboard();
    private
}

fn on_change() {
    let Some(app) = APP.get() else { return };
    if integrations::PAUSED.load(Ordering::Relaxed) || !integrations::enabled(app, ID) {
        return;
    }
    if IGNORE_UNTIL.lock().unwrap().is_some_and(|t| std::time::Instant::now() < t) {
        return;
    }
    if unsafe { is_private() } {
        return;
    }
    // Apps that copy both (Excel cells, a Word paragraph…) are recorded as text.
    if let Some(text) = crate::actions::clipboard_text() {
        if record(text) {
            publish(app);
        }
    } else if clipimage::has_image() {
        if let Some(img) = clipimage::read() {
            if record_picture(&img) {
                publish(app);
            }
        }
    }
}

unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if msg == WM_CLIPBOARDUPDATE {
        on_change();
        return LRESULT(0);
    }
    DefWindowProcW(hwnd, msg, wparam, lparam)
}

/// Starts listening. The thread sleeps in GetMessageW between copies.
pub fn spawn(app: AppHandle) {
    let _ = APP.set(app);
    std::thread::spawn(|| unsafe {
        let Ok(instance) = GetModuleHandleW(None) else { return };
        let class = WNDCLASSW {
            lpfnWndProc: Some(wndproc),
            hInstance: instance.into(),
            lpszClassName: w!("EasyIslandClipboard"),
            ..Default::default()
        };
        RegisterClassW(&class);
        let hwnd = match CreateWindowExW(
            WINDOW_EX_STYLE(0),
            w!("EasyIslandClipboard"),
            w!(""),
            WINDOW_STYLE(0),
            0,
            0,
            0,
            0,
            Some(HWND_MESSAGE),
            None,
            Some(instance.into()),
            None,
        ) {
            Ok(h) => h,
            Err(e) => {
                crate::log::line(format!("clipboard: window: {e}"));
                return;
            }
        };
        if let Err(e) = AddClipboardFormatListener(hwnd) {
            crate::log::line(format!("clipboard: listener: {e}"));
            return;
        }
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            DispatchMessageW(&msg);
        }
    });
}

/// "%C3%A8+x" → "è x". Invalid sequences stay as they are.
fn url_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                match u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("zz"), 16) {
                    Ok(b) => {
                        out.push(b);
                        i += 3;
                        continue;
                    }
                    Err(_) => out.push(b'%'),
                }
            }
            b'+' => out.push(b' '),
            b => out.push(b),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// What "Trasforma" does to an entry before pasting it.
fn transform(text: &str, how: &str) -> Result<String, String> {
    Ok(match how {
        "" => text.to_string(),
        "upper" => text.to_uppercase(),
        "lower" => text.to_lowercase(),
        // One line, single spaces: a paragraph copied from a PDF, an address…
        "oneline" => text.split_whitespace().collect::<Vec<_>>().join(" "),
        "trim" => text.lines().map(str::trim_end).collect::<Vec<_>>().join("\n").trim().to_string(),
        "json" => {
            let v: serde_json::Value =
                serde_json::from_str(text.trim()).map_err(|_| t("Il testo non è JSON valido").to_string())?;
            serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?
        }
        "urldecode" => url_decode(text.trim()),
        _ => return Err(t("Trasformazione sconosciuta").into()),
    })
}

/// Ctrl+V into whatever app has the focus (the island never takes it on a click).
fn send_paste() {
    let key = |vk: VIRTUAL_KEY, up: bool| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT { wVk: vk, dwFlags: if up { KEYEVENTF_KEYUP } else { Default::default() }, ..Default::default() },
        },
    };
    let v = VIRTUAL_KEY(b'V' as u16);
    let inputs = [key(VK_CONTROL, false), key(v, false), key(v, true), key(VK_CONTROL, true)];
    unsafe {
        SendInput(&inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

/// Puts an entry (optionally transformed) back on the clipboard, then pastes it
/// when asked. The entry moves to the top, like a fresh copy.
pub fn use_entry(app: &AppHandle, id: u64, how: &str, paste: bool) -> Result<(), String> {
    let clip = HISTORY
        .lock()
        .unwrap()
        .iter()
        .find(|c| c.id == id)
        .cloned()
        .ok_or_else(|| t("Elemento non più negli appunti").to_string())?;
    if let Some(picture) = &clip.picture {
        if !how.is_empty() {
            return Err(t("Le immagini non si possono trasformare").into());
        }
        clipimage::write(&clipimage::decode_png(&picture.png)?)?;
        // The listener sees the same picture and leaves it be: move it up here.
        let mut list = HISTORY.lock().unwrap();
        if let Some(i) = list.iter().position(|c| c.id == id) {
            let mut c = list.remove(i);
            c.at = now_ms();
            list.insert(0, c);
        }
    } else {
        let out = transform(&clip.text, how)?;
        crate::actions::set_clipboard_text(&out)?;
        // The listener records it too; doing it here keeps the order right at once.
        record(out);
    }
    publish(app);
    if paste {
        std::thread::sleep(Duration::from_millis(60));
        send_paste();
    }
    Ok(())
}

/// "Chiedi alla chat" on a picture: a PNG copy in the inbox, for the chat.
pub fn picture_to_inbox(id: u64) -> Result<DroppedFile, String> {
    let png = HISTORY
        .lock()
        .unwrap()
        .iter()
        .find(|c| c.id == id)
        .and_then(|c| c.picture.as_ref().map(|p| p.png.clone()))
        .ok_or_else(|| t("Immagine non più negli appunti").to_string())?;
    crate::files::save_new(&crate::screenshot::file_name(t("Immagine copiata")), &png)

}

pub fn pin(app: &AppHandle, id: u64, pinned: bool) {
    if let Some(c) = HISTORY.lock().unwrap().iter_mut().find(|c| c.id == id) {
        c.pinned = pinned;
    }
    publish(app);
}

pub fn remove(app: &AppHandle, id: u64) {
    HISTORY.lock().unwrap().retain(|c| c.id != id);
    publish(app);
}

/// "Svuota": everything but the pinned entries.
pub fn clear(app: &AppHandle) {
    HISTORY.lock().unwrap().retain(|c| c.pinned);
    publish(app);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pictures_are_kept_once_and_capped() {
        HISTORY.lock().unwrap().clear();
        let pic = |v: u8| Rgba { width: 2, height: 1, pixels: vec![v; 8] };
        assert!(record_picture(&pic(1)));
        assert!(!record_picture(&pic(1)), "the same picture twice in a row");
        assert!(record("testo".into()));
        assert!(record_picture(&pic(1)), "an older copy moves up");
        assert_eq!(HISTORY.lock().unwrap().len(), 2);
        for v in 2..20 {
            record_picture(&pic(v));
        }
        let list = HISTORY.lock().unwrap();
        assert_eq!(list.iter().filter(|c| c.picture.is_some()).count(), KEEP_PICTURES);
        assert!(list.iter().any(|c| c.text == "testo"), "texts survive the picture cap");
        assert!(list[0].picture.as_ref().unwrap().thumb.starts_with("data:image/png;base64,"));
    }

    #[test]
    fn transforms() {
        assert_eq!(transform("  a\n   b  c ", "oneline").unwrap(), "a b c");
        assert_eq!(transform("Ciao", "upper").unwrap(), "CIAO");
        assert_eq!(transform(r#"{"a":1}"#, "json").unwrap(), "{\n  \"a\": 1\n}");
        assert!(transform("nope", "json").is_err());
        assert_eq!(url_decode("caf%C3%A8+bar%2"), "cafè bar%2");
    }
}
