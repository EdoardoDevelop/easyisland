// "Cosa fai adesso": which app is in front, and the text selected in it, for
// the suggested actions in the ⚡ tab.
//
// A WinEvent hook remembers the last window in front that is not EasyIsland
// (it only wakes when the foreground changes): the island takes the focus for
// its chat, and then it would be "the app in front" itself.
// Each change of program is also sent to the island (`foreground` event), for
// the bar of the app in use beside the closed character (src/views/strip.ts).

use std::sync::atomic::{AtomicIsize, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use windows::Win32::Foundation::{CloseHandle, HWND};
use windows::Win32::System::DataExchange::GetClipboardSequenceNumber;
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, VIRTUAL_KEY,
    VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
};
use windows::Win32::UI::Accessibility::{SetWinEventHook, HWINEVENTHOOK};
use windows::Win32::UI::WindowsAndMessaging::{
    DispatchMessageW, GetForegroundWindow, GetMessageW, GetWindowTextW, GetWindowThreadProcessId, IsWindow,
    SetForegroundWindow, EVENT_SYSTEM_FOREGROUND, MSG, WINEVENT_OUTOFCONTEXT,
};

/// The last window in front that is not EasyIsland.
static LAST: AtomicIsize = AtomicIsize::new(0);
/// For the `foreground` event; set by `spawn`.
static APP: std::sync::OnceLock<tauri::AppHandle> = std::sync::OnceLock::new();
/// The program last sent to the island: a new window of the same one is not news.
static SENT: Mutex<String> = Mutex::new(String::new());

fn is_ours(hwnd: HWND) -> bool {
    exe_of(hwnd).is_none_or(|e| e == "easyisland.exe")
}

unsafe extern "system" fn on_foreground(
    _hook: HWINEVENTHOOK, _event: u32, hwnd: HWND, _obj: i32, _child: i32, _thread: u32, _time: u32,
) {
    if hwnd.0.is_null() {
        return;
    }
    crate::island::on_foreground_change();
    let Some(path) = exe_path(hwnd) else { return };
    let exe = path.rsplit('\\').next().unwrap_or(&path).to_lowercase();
    if exe != "easyisland.exe" {
        LAST.store(hwnd.0 as isize, Ordering::Relaxed);
        crate::habits::note_app(&exe, &path);
        crate::automations::on_foreground(&exe);
        let mut sent = SENT.lock().unwrap();
        if *sent != exe {
            sent.clone_from(&exe);
            if let Some(app) = APP.get() {
                use tauri::Emitter;
                let _ = app.emit_to(crate::island::WINDOW_LABEL, "foreground", Foreground { exe: exe.clone(), title: String::new() });
            }
        }
    }
}

/// Starts following the foreground window.
pub fn spawn(app: tauri::AppHandle) {
    let _ = APP.set(app);
    std::thread::spawn(|| unsafe {
        let now = GetForegroundWindow();
        if !now.0.is_null() && !is_ours(now) {
            LAST.store(now.0 as isize, Ordering::Relaxed);
        }
        let _hook = SetWinEventHook(
            EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, None, Some(on_foreground), 0, 0, WINEVENT_OUTOFCONTEXT,
        );
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            DispatchMessageW(&msg);
        }
    });
}

/// The user's window: the one in front, or the last one before the island took over.
fn target() -> Option<HWND> {
    unsafe {
        let now = GetForegroundWindow();
        if !now.0.is_null() && !is_ours(now) {
            return Some(now);
        }
        let last = HWND(LAST.load(Ordering::Relaxed) as *mut _);
        (!last.0.is_null() && IsWindow(Some(last)).as_bool()).then_some(last)
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Foreground {
    /// "outlook.exe", lower case.
    pub exe: String,
    pub title: String,
}

fn exe_of(hwnd: HWND) -> Option<String> {
    let path = exe_path(hwnd)?;
    Some(path.rsplit('\\').next().unwrap_or(&path).to_lowercase())
}

/// Full path of the program that owns the window.
pub(crate) fn exe_path(hwnd: HWND) -> Option<String> {
    unsafe {
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == 0 {
            return None;
        }
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, windows::core::PWSTR(buf.as_mut_ptr()), &mut len);
        let _ = CloseHandle(process);
        ok.ok()?;
        Some(String::from_utf16_lossy(&buf[..len as usize]))
    }
}

/// The user's app: the one in front, or the last one before the island.
pub fn foreground() -> Option<Foreground> {
    unsafe {
        let hwnd = target()?;
        let exe = exe_of(hwnd)?;
        let mut buf = [0u16; 512];
        let n = GetWindowTextW(hwnd, &mut buf);
        let title = String::from_utf16_lossy(&buf[..n.max(0) as usize]);
        Some(Foreground { exe, title })
    }
}

fn key(vk: VIRTUAL_KEY, up: bool) -> INPUT {
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT { wVk: vk, dwFlags: if up { KEYEVENTF_KEYUP } else { Default::default() }, ..Default::default() },
        },
    }
}

/// The window the last selection was read from: "Sostituisci" pastes there.
static CAPTURED: AtomicIsize = AtomicIsize::new(0);

/// The last selection's text and its HTML, when the app copied some (richtext.rs).
static CAPTURED_HTML: Mutex<Option<(String, crate::richtext::Clip)>> = Mutex::new(None);

/// The last rewrite with its formatting: the plain text shown in the card and the CF_HTML.
static REWRITTEN: Mutex<Option<(String, String)>> = Mutex::new(None);

/// The HTML of the selection read last, if `text` is that selection.
pub fn captured_html(text: &str) -> Option<crate::richtext::Clip> {
    let held = CAPTURED_HTML.lock().ok()?;
    held.as_ref().filter(|(t, _)| t == text).map(|(_, clip)| clip.clone())
}

/// Keeps a rewrite's formatted version for "Sostituisci" and "Copia".
pub fn keep_rewrite(plain: &str, cf_html: Option<String>) {
    if let Ok(mut r) = REWRITTEN.lock() {
        *r = cf_html.map(|h| (plain.to_string(), h));
    }
}

/// The formatted version of `text`, if it is the rewrite kept (unchanged in the card).
fn rewritten_html(text: &str) -> Option<String> {
    let r = REWRITTEN.lock().ok()?;
    r.as_ref().filter(|(plain, _)| same_text(plain, text)).map(|(_, h)| h.clone())
}

/// "Copia" in the card: the text, with its formatting when asked and still the same.
pub fn copy_rewrite(text: &str, formatted: bool) -> Result<(), String> {
    let html = if formatted { rewritten_html(text) } else { None };
    crate::richtext::set_clipboard(&crlf(text), html.as_deref())
}

/// Windows apps want CRLF for a new line (the card's text area gives LF).
fn crlf(text: &str) -> String {
    text.replace("\r\n", "\n").replace('\n', "\r\n")
}

/// Brings `hwnd` to the front, so the keys sent next reach it and never the
/// island (focused for its chat or a card).
fn focus(hwnd: HWND) -> Result<(), &'static str> {
    unsafe {
        if GetForegroundWindow() != hwnd {
            let _ = SetForegroundWindow(hwnd);
            let start = Instant::now();
            while GetForegroundWindow() != hwnd && start.elapsed() < Duration::from_millis(400) {
                std::thread::sleep(Duration::from_millis(20));
            }
            if GetForegroundWindow() != hwnd {
                return Err("no-focus");
            }
        }
    }
    Ok(())
}

/// A shortcut may still be held (Ctrl+Alt+…, Win+Shift+…): Ctrl+C would become
/// something else (Win+Ctrl+C turns on Windows' colour filters). Waits for the
/// keys to be let go; "held" if they never are.
fn wait_keys_released() -> Result<(), &'static str> {
    let held = || unsafe {
        [VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN, VK_CONTROL]
            .iter()
            .any(|k| (GetAsyncKeyState(k.0 as i32) as u16 & 0x8000) != 0)
    };
    let wait = Instant::now();
    while held() && wait.elapsed() < Duration::from_millis(1500) {
        std::thread::sleep(Duration::from_millis(30));
    }
    if held() { Err("held") } else { Ok(()) }
}

/// Ctrl (down), `letter`, Ctrl (up), to the window in front.
fn ctrl(letter: u8) {
    let k = VIRTUAL_KEY(letter as u16);
    unsafe {
        SendInput(&[key(VK_CONTROL, false), key(k, false), key(k, true), key(VK_CONTROL, true)], std::mem::size_of::<INPUT>() as i32);
    }
}

/// Ctrl+C in the window in front, read (the text, and its HTML if the app gave
/// some), then the clipboard put back as it was (every format: pictures and
/// copied files too, see actions::ClipboardBefore).
fn copy_selected() -> Result<(String, Option<crate::richtext::Clip>), &'static str> {
    let before = crate::actions::ClipboardBefore::take();
    crate::clipboard::ignore_next(Duration::from_millis(2000));
    let seq = unsafe { GetClipboardSequenceNumber() };
    ctrl(b'C');
    // Excel and Outlook can take a while with a large selection.
    let start = Instant::now();
    while unsafe { GetClipboardSequenceNumber() } == seq && start.elapsed() < Duration::from_millis(1200) {
        std::thread::sleep(Duration::from_millis(25));
    }
    if unsafe { GetClipboardSequenceNumber() } == seq {
        return Err("empty"); // nothing selected: the app left the clipboard alone
    }
    // Let the app finish writing every format.
    std::thread::sleep(Duration::from_millis(60));
    let text = crate::actions::clipboard_text();
    let html = crate::richtext::read_clipboard();
    before.put_back();
    match text {
        Some(t) if !t.trim().is_empty() => Ok((t, html)),
        Some(_) => Err("empty"),
        None => Err("not-text"),
    }
}

/// The text selected in the app in front: Ctrl+C, read, then the clipboard is
/// put back as it was. On failure, why — the island turns it into a message:
/// "no-window" (no app to read from), "no-focus" (Windows kept the island in
/// front), "held" (the shortcut's keys were never let go), "empty" (the app
/// copied nothing: no selection, or it does not let you copy), "not-text" (a
/// picture or files were selected).
pub fn selection() -> Result<String, &'static str> {
    // Ctrl+C must reach the user's app, never the island (focused for its chat):
    // give the focus back to the user's window first.
    let hwnd = target().ok_or("no-window")?;
    focus(hwnd)?;
    wait_keys_released()?;
    let (text, html) = copy_selected()?;
    CAPTURED.store(hwnd.0 as isize, Ordering::Relaxed);
    if let Ok(mut held) = CAPTURED_HTML.lock() {
        *held = html.map(|clip| (text.clone(), clip));
    }
    Ok(text)
}

/// A "Tasti" action (keys.rs): the sequence to the user's window. Err = what is
/// wrong with it, or a reason code like `selection`'s.
pub fn send_keys(spec: &str) -> Result<(), String> {
    let steps = crate::keys::parse(spec)?;
    let hwnd = target().ok_or("no-window")?;
    focus(hwnd)?;
    // The click's own modifiers (none, usually) must be up, or Ctrl+T becomes Ctrl+Shift+T.
    wait_keys_released()?;
    crate::keys::play(&steps);
    Ok(())
}

/// All the text of the user's window (a web page, a mail, a document): Ctrl+A,
/// Ctrl+C, the clipboard put back. For "Chiedi alla chat" on "Tutta la finestra".
/// Errors are `selection`'s reason codes.
pub fn window_text() -> Result<String, &'static str> {
    let hwnd = target().ok_or("no-window")?;
    focus(hwnd)?;
    wait_keys_released()?;
    ctrl(b'A');
    std::thread::sleep(Duration::from_millis(120));
    let (text, _) = copy_selected()?;
    Ok(text)
}

/// Same text for "Sostituisci": line ends and the spaces around do not count
/// (Word adds a paragraph mark, the browser a newline).
fn same_text(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.replace("\r\n", "\n").trim().to_string();
    norm(a) == norm(b)
}

/// "Sostituisci": `text` in place of the selection read before (`original`),
/// in the window it came from. The selection is copied again first: if the
/// user clicked elsewhere meanwhile, nothing is pasted ("changed"). The
/// clipboard is put back as it was afterwards, like `selection`. `formatted`:
/// the rewrite's HTML goes too, if `text` is still the rewrite kept.
pub fn replace(original: &str, text: &str, formatted: bool) -> Result<(), &'static str> {
    let hwnd = HWND(CAPTURED.load(Ordering::Relaxed) as *mut _);
    if hwnd.0.is_null() || !unsafe { IsWindow(Some(hwnd)) }.as_bool() {
        return Err("no-window");
    }
    focus(hwnd)?;
    wait_keys_released()?;
    match copy_selected() {
        Ok((now, _)) if same_text(&now, original) => {}
        Ok(_) | Err("empty") => return Err("changed"),
        Err(e) => return Err(e),
    }
    let before = crate::actions::ClipboardBefore::take();
    crate::clipboard::ignore_next(Duration::from_millis(3000));
    let html = if formatted { rewritten_html(text) } else { None };
    crate::richtext::set_clipboard(&crlf(text), html.as_deref()).map_err(|_| "clipboard")?;
    ctrl(b'V');
    // The app reads the clipboard while it handles the paste; browsers a bit later.
    std::thread::sleep(Duration::from_millis(500));
    before.put_back();
    Ok(())
}

/// A rewritten text as the model wrote it, made ready to paste: a code fence
/// or quotes around the whole of it go (the prompt asks for neither, small
/// models add them anyway).
pub fn clean_reply(reply: &str) -> String {
    let mut s = reply.trim().replace("\r\n", "\n");
    if s.starts_with("```") && s.ends_with("```") && s.len() >= 6 {
        let inner = &s[3..s.len() - 3];
        // The fence's language tag ("```text") is the rest of its first line.
        let inner = match inner.split_once('\n') {
            Some((tag, rest)) if !tag.contains(' ') => rest,
            _ => inner,
        };
        s = inner.trim().to_string();
    }
    for (open, close) in [('"', '"'), ('«', '»'), ('“', '”')] {
        let n = s.chars().count();
        if n >= 2 && s.starts_with(open) && s.ends_with(close) {
            let body: String = s.chars().skip(1).take(n - 2).collect();
            // Only when the quotes wrap it all, not a text that starts and ends with a quotation.
            if !body.contains(open) && !body.contains(close) {
                s = body.trim().to_string();
            }
            break;
        }
    }
    s
}

#[cfg(test)]
mod tests {
    use super::{clean_reply, same_text};

    #[test]
    fn clean_reply_strips_fences_and_wrapping_quotes() {
        assert_eq!(clean_reply("```\nCiao\n```"), "Ciao");
        assert_eq!(clean_reply("```text\nUno\ndue\n```"), "Uno\ndue");
        assert_eq!(clean_reply("\"Buongiorno a tutti\""), "Buongiorno a tutti");
        assert_eq!(clean_reply("«Testo»"), "Testo");
        assert_eq!(clean_reply("\"A\" e \"B\""), "\"A\" e \"B\"");
        assert_eq!(clean_reply("  Solo testo \n"), "Solo testo");
    }

    #[test]
    fn same_text_ignores_line_ends_and_edges() {
        assert!(same_text("Ciao\r\nmondo\r\n", "Ciao\nmondo"));
        assert!(same_text("  testo ", "testo"));
        assert!(!same_text("Ciao mondo", "Ciao Mondo"));
        assert!(!same_text("uno\ndue", "uno due"));
    }
}
