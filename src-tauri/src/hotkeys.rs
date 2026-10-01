// System-wide keyboard shortcuts (RegisterHotKey), on a thread that sleeps in
// GetMessageW until one is pressed — no polling, no cost while idle.
//
// Shortcuts: open the island, ask about the clipboard, and one per quick action
// that has one. They are re-registered whenever the settings change.

use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::Foundation::{LPARAM, WPARAM};
use windows::Win32::System::Threading::GetCurrentThreadId;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    RegisterHotKey, UnregisterHotKey, HOT_KEY_MODIFIERS, MOD_ALT, MOD_CONTROL, MOD_NOREPEAT,
    MOD_SHIFT, MOD_WIN,
};
use windows::Win32::UI::WindowsAndMessaging::{
    GetMessageW, PeekMessageW, PostThreadMessageW, MSG, PM_NOREMOVE, WM_APP, WM_HOTKEY,
};

const WM_RELOAD: u32 = WM_APP + 1;

static THREAD: AtomicU32 = AtomicU32::new(0);
/// Shortcuts Windows refused (already taken by another app).
static FAILED: Mutex<Vec<String>> = Mutex::new(Vec::new());

/// "Ctrl+Alt+M" → (modifiers, virtual key). None when it can't be a hotkey.
pub fn parse(spec: &str) -> Option<(HOT_KEY_MODIFIERS, u32)> {
    let mut mods = HOT_KEY_MODIFIERS(0);
    let mut key = None;
    for part in spec.split('+').map(str::trim).filter(|p| !p.is_empty()) {
        match part.to_ascii_lowercase().as_str() {
            "ctrl" | "control" => mods |= MOD_CONTROL,
            "alt" => mods |= MOD_ALT,
            "shift" | "maiusc" => mods |= MOD_SHIFT,
            "win" | "windows" | "super" | "meta" => mods |= MOD_WIN,
            "space" | "spazio" => key = Some(0x20),
            "enter" | "invio" => key = Some(0x0D),
            "tab" => key = Some(0x09),
            "esc" => key = Some(0x1B),
            p if p.len() > 1 && p.starts_with('f') => {
                let n: u32 = p[1..].parse().ok()?;
                if !(1..=24).contains(&n) {
                    return None;
                }
                key = Some(0x70 + n - 1);
            }
            p if p.len() == 1 => {
                let c = p.chars().next()?.to_ascii_uppercase();
                if !c.is_ascii_alphanumeric() {
                    return None;
                }
                key = Some(c as u32);
            }
            _ => return None,
        }
    }
    // A bare letter as a global shortcut would eat that letter everywhere.
    if mods.0 == 0 {
        return None;
    }
    Some((mods | MOD_NOREPEAT, key?))
}

/// (name sent to the island, spec) for every shortcut the settings ask for.
fn wanted(app: &AppHandle) -> Vec<(String, String)> {
    let Some(shared) = app.try_state::<crate::Shared>() else { return Vec::new() };
    let s = shared.settings.lock().unwrap();
    let mut list = vec![
        ("open".to_string(), s.hotkey_open.clone()),
        ("ask".to_string(), s.hotkey_ask.clone()),
    ];
    for a in &s.actions {
        let id = a.get("id").and_then(|v| v.as_str()).unwrap_or_default();
        let key = a.get("hotkey").and_then(|v| v.as_str()).unwrap_or_default();
        if !id.is_empty() && !key.trim().is_empty() {
            list.push((format!("action:{id}"), key.to_string()));
        }
    }
    list.retain(|(_, spec)| !spec.trim().is_empty());
    list
}

pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || unsafe {
        // Make sure this thread has a message queue before anyone posts to it.
        let mut msg = MSG::default();
        let _ = PeekMessageW(&mut msg, None, 0, 0, PM_NOREMOVE);
        THREAD.store(GetCurrentThreadId(), Ordering::Relaxed);

        let mut registered: Vec<String> = Vec::new();
        let register = |registered: &mut Vec<String>| {
            for i in 0..registered.len() {
                let _ = UnregisterHotKey(None, i as i32 + 1);
            }
            registered.clear();
            let mut failed = Vec::new();
            for (name, spec) in wanted(&app) {
                let id = registered.len() as i32 + 1;
                match parse(&spec) {
                    Some((mods, vk)) if RegisterHotKey(None, id, mods, vk).is_ok() => {
                        registered.push(name);
                    }
                    _ => {
                        crate::log::line(format!("hotkey not available: {spec}"));
                        failed.push(spec);
                        // Keep ids aligned with positions.
                        registered.push(String::new());
                    }
                }
            }
            *FAILED.lock().unwrap() = failed;
        };
        register(&mut registered);

        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            match msg.message {
                WM_HOTKEY => {
                    let idx = msg.wParam.0 as usize;
                    if let Some(name) = registered.get(idx.wrapping_sub(1)).filter(|n| !n.is_empty()) {
                        let _ = app.emit_to(crate::island::WINDOW_LABEL, "hotkey", name.clone());
                    }
                }
                WM_RELOAD => register(&mut registered),
                _ => {}
            }
        }
    });
}

/// Re-read the shortcuts after a settings change.
pub fn reload() {
    let tid = THREAD.load(Ordering::Relaxed);
    if tid != 0 {
        unsafe {
            let _ = PostThreadMessageW(tid, WM_RELOAD, WPARAM(0), LPARAM(0));
        }
    }
}

/// Shortcuts that could not be registered, for the settings window.
pub fn failures() -> Vec<String> {
    FAILED.lock().unwrap().clone()
}
