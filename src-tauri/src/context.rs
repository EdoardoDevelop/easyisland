// "Cosa fai adesso": which app is in front, and the text selected in it, for
// the suggested actions in the ⚡ tab.
//
// Nothing runs in the background: the island asks when it opens. The island
// never takes the focus on a click, so the app in front is still the user's.

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
use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowTextW, GetWindowThreadProcessId};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Foreground {
    /// "outlook.exe", lower case.
    pub exe: String,
    pub title: String,
}

fn exe_of(hwnd: HWND) -> Option<String> {
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
        let path = String::from_utf16_lossy(&buf[..len as usize]);
        Some(path.rsplit('\\').next().unwrap_or(&path).to_lowercase())
    }
}

/// The app in front, unless it is EasyIsland itself.
pub fn foreground() -> Option<Foreground> {
    unsafe {
        let hwnd = GetForegroundWindow();
        if hwnd.0.is_null() {
            return None;
        }
        let exe = exe_of(hwnd)?;
        if exe == "easyisland.exe" {
            return None;
        }
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

/// The text selected in the app in front: Ctrl+C, read, then the clipboard is
/// put back as it was. None when nothing was selected.
pub fn selection() -> Option<String> {
    // Ctrl+C must reach the user's app, never the island (focused for its chat).
    foreground()?;
    // A shortcut may still be held (Ctrl+Alt+…): Ctrl+C would become something else.
    let held = || unsafe {
        [VK_MENU, VK_SHIFT, VK_LWIN, VK_RWIN, VK_CONTROL]
            .iter()
            .any(|k| (GetAsyncKeyState(k.0 as i32) as u16 & 0x8000) != 0)
    };
    let wait = Instant::now();
    while held() && wait.elapsed() < Duration::from_millis(800) {
        std::thread::sleep(Duration::from_millis(30));
    }

    let before = crate::actions::clipboard_text();
    crate::clipboard::ignore_next(Duration::from_millis(1500));
    let seq = unsafe { GetClipboardSequenceNumber() };
    let c = VIRTUAL_KEY(b'C' as u16);
    unsafe {
        SendInput(&[key(VK_CONTROL, false), key(c, false), key(c, true), key(VK_CONTROL, true)], std::mem::size_of::<INPUT>() as i32);
    }
    let start = Instant::now();
    while unsafe { GetClipboardSequenceNumber() } == seq && start.elapsed() < Duration::from_millis(600) {
        std::thread::sleep(Duration::from_millis(25));
    }
    if unsafe { GetClipboardSequenceNumber() } == seq {
        return None; // nothing selected: the app left the clipboard alone
    }
    // Let the app finish writing every format.
    std::thread::sleep(Duration::from_millis(60));
    let text = crate::actions::clipboard_text();
    if let Some(prev) = before {
        let _ = crate::actions::set_clipboard_text(&prev);
    }
    text.filter(|t| !t.trim().is_empty())
}
