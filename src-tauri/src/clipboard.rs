// The "Appunti" integration: a history of the text copied on this PC.
//
// A message-only window registered with AddClipboardFormatListener wakes up on
// WM_CLIPBOARDUPDATE only — no polling, nothing to do while nobody copies. The
// history lives in memory only: it is never written to disk and is gone when
// the app quits (pinned entries included), since a clipboard often holds
// things that should not end up in a file.
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

use crate::integrations::{self, IntegrationUpdate};

pub const ID: &str = "integration_clipboard";
const WM_CLIPBOARDUPDATE: u32 = 0x031D;
/// Unpinned entries kept; pinned ones do not count.
const KEEP: usize = 30;
/// Longer copies are kept up to here (a whole log file is not a clipboard snippet).
const MAX_CHARS: usize = 20_000;
/// What the island receives of each entry.
const PREVIEW_CHARS: usize = 300;

#[derive(Clone)]
struct Clip {
    id: u64,
    text: String,
    at: u64,
    pinned: bool,
}

static HISTORY: Mutex<Vec<Clip>> = Mutex::new(Vec::new());
static NEXT_ID: AtomicU64 = AtomicU64::new(1);
static APP: OnceLock<AppHandle> = OnceLock::new();

fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Entry {
    id: u64,
    preview: String,
    chars: usize,
    lines: usize,
    at: u64,
    pinned: bool,
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
            Entry {
                id: c.id,
                preview,
                chars: c.text.chars().count(),
                lines: c.text.lines().count().max(1),
                at: c.at,
                pinned: c.pinned,
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
    if list.first().is_some_and(|c| c.text == text) {
        return false;
    }
    let pinned = match list.iter().position(|c| c.text == text) {
        Some(i) => list.remove(i).pinned,
        None => false,
    };
    list.insert(0, Clip { id: NEXT_ID.fetch_add(1, Ordering::Relaxed), text, at: now_ms(), pinned });
    let mut unpinned = 0;
    list.retain(|c| {
        if c.pinned {
            return true;
        }
        unpinned += 1;
        unpinned <= KEEP
    });
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
    if unsafe { is_private() } {
        return;
    }
    if let Some(text) = crate::actions::clipboard_text() {
        if record(text) {
            publish(app);
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
                serde_json::from_str(text.trim()).map_err(|_| "Il testo non è JSON valido".to_string())?;
            serde_json::to_string_pretty(&v).map_err(|e| e.to_string())?
        }
        "urldecode" => url_decode(text.trim()),
        _ => return Err("Trasformazione sconosciuta".into()),
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
    let text = HISTORY
        .lock()
        .unwrap()
        .iter()
        .find(|c| c.id == id)
        .map(|c| c.text.clone())
        .ok_or_else(|| "Elemento non più negli appunti".to_string())?;
    let out = transform(&text, how)?;
    crate::actions::set_clipboard_text(&out)?;
    // The listener records it too; doing it here keeps the order right at once.
    record(out);
    publish(app);
    if paste {
        std::thread::sleep(Duration::from_millis(60));
        send_paste();
    }
    Ok(())
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
    use super::{transform, url_decode};

    #[test]
    fn transforms() {
        assert_eq!(transform("  a\n   b  c ", "oneline").unwrap(), "a b c");
        assert_eq!(transform("Ciao", "upper").unwrap(), "CIAO");
        assert_eq!(transform(r#"{"a":1}"#, "json").unwrap(), "{\n  \"a\": 1\n}");
        assert!(transform("nope", "json").is_err());
        assert_eq!(url_decode("caf%C3%A8+bar%2"), "cafè bar%2");
    }
}
