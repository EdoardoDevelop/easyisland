// "Cosa fai adesso": which app is in front, and the text selected in it, for
// the suggested actions in the ⚡ tab.
//
// A WinEvent hook remembers the last window in front that is not EasyIsland
// (it only wakes when the foreground changes): the island takes the focus for
// its chat, and then it would be "the app in front" itself.

use std::sync::atomic::{AtomicIsize, Ordering};
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

fn is_ours(hwnd: HWND) -> bool {
    exe_of(hwnd).is_none_or(|e| e == "easyisland.exe")
}

unsafe extern "system" fn on_foreground(
    _hook: HWINEVENTHOOK, _event: u32, hwnd: HWND, _obj: i32, _child: i32, _thread: u32, _time: u32,
) {
    if hwnd.0.is_null() {
        return;
    }
    let Some(path) = exe_path(hwnd) else { return };
    let exe = path.rsplit('\\').next().unwrap_or(&path).to_lowercase();
    if exe != "easyisland.exe" {
        LAST.store(hwnd.0 as isize, Ordering::Relaxed);
        crate::habits::note_app(&exe, &path);
    }
}

/// Starts following the foreground window.
pub fn spawn() {
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
fn exe_path(hwnd: HWND) -> Option<String> {
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

/// The text selected in the app in front: Ctrl+C, read, then the clipboard is
/// put back as it was. None when nothing was selected.
pub fn selection() -> Option<String> {
    // Ctrl+C must reach the user's app, never the island (focused for its chat):
    // give the focus back to the user's window first.
    let hwnd = target()?;
    unsafe {
        if GetForegroundWindow() != hwnd {
            let _ = SetForegroundWindow(hwnd);
            let start = Instant::now();
            while GetForegroundWindow() != hwnd && start.elapsed() < Duration::from_millis(400) {
                std::thread::sleep(Duration::from_millis(20));
            }
            if GetForegroundWindow() != hwnd {
                return None;
            }
        }
    }
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
