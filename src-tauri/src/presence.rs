// "Davanti al cliente": EasyIsland gets out of the way while you are in a call or
// someone is looking at (or driving) your screen, and while you switch it on by
// hand from the tray. The island hears `presence` and hides the character, or only goes
// quiet, as the profile says; permission requests from Claude Code still show.
//
// Nothing here needs Teams' API or admin rights:
//   * a call = the microphone or the webcam in use by any app, read from the
//     registry where Windows records who is using them (the same data as the
//     privacy icon in the taskbar): Teams, Zoom, Meet in a browser, Webex…
//   * remote help on this PC = an incoming Remote Desktop session, Quick Assist,
//     TeamViewer while someone is connected (TeamViewer_Desktop.exe only exists
//     then), plus any program the user lists.
// One check every 3 s, on a thread of its own.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

use crate::island::WINDOW_LABEL;
use crate::probes::reg::{Key, HKEY_CURRENT_USER};

/// Switched on by hand from the tray menu.
pub static MANUAL: AtomicBool = AtomicBool::new(false);
static CURRENT: Mutex<Option<String>> = Mutex::new(None);

#[derive(Clone, Serialize)]
struct Presence {
    active: bool,
    reason: String,
}

const CONSENT: &str = r"Software\Microsoft\Windows\CurrentVersion\CapabilityAccessManager\ConsentStore";

/// A readable name from a package family ("MSTeams_8wekyb3d8bbwe") or a path
/// with `#` for `\` ("C:#Program Files#Zoom#bin#Zoom.exe").
fn app_name(key: &str) -> String {
    let base = key.rsplit('#').next().unwrap_or(key);
    let base = base.split('_').next().unwrap_or(base);
    let base = base.trim_end_matches(".exe").trim_end_matches(".EXE");
    let low = base.to_lowercase();
    let known = [
        ("teams", "Teams"), ("zoom", "Zoom"), ("webex", "Webex"), ("skype", "Skype"), ("slack", "Slack"),
        ("discord", "Discord"), ("chrome", "Chrome"), ("msedge", "Edge"), ("firefox", "Firefox"),
        ("whatsapp", "WhatsApp"), ("telegram", "Telegram"), ("windowscamera", "Fotocamera"), ("gotomeeting", "GoTo"),
    ];
    known.iter().find(|(k, _)| low.contains(k)).map(|(_, n)| n.to_string()).unwrap_or_else(|| base.to_string())
}

fn in_use(k: &Key) -> bool {
    k.qword("LastUsedTimeStop") == Some(0) && k.qword("LastUsedTimeStart").unwrap_or(0) > 0
}

/// The first app using the microphone or the webcam right now.
fn device_in_use(device: &str) -> Option<String> {
    let root = Key::open(HKEY_CURRENT_USER, &format!(r"{CONSENT}\{device}"))?;
    for name in root.subkeys() {
        let Some(k) = root.child(&name) else { continue };
        if name.eq_ignore_ascii_case("NonPackaged") {
            for exe in k.subkeys() {
                if k.child(&exe).is_some_and(|c| in_use(&c)) {
                    return Some(app_name(&exe));
                }
            }
        } else if in_use(&k) {
            return Some(app_name(&name));
        }
    }
    None
}

/// Lower-case executable names of the running processes.
pub(crate) fn processes() -> Vec<String> {
    use windows::Win32::Foundation::CloseHandle;
    use windows::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    let mut out = Vec::new();
    unsafe {
        let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return out };
        let mut e = PROCESSENTRY32W { dwSize: std::mem::size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
        let mut ok = Process32FirstW(snap, &mut e).is_ok();
        while ok {
            let len = e.szExeFile.iter().position(|c| *c == 0).unwrap_or(e.szExeFile.len());
            out.push(String::from_utf16_lossy(&e.szExeFile[..len]).to_lowercase());
            ok = Process32NextW(snap, &mut e).is_ok();
        }
        let _ = CloseHandle(snap);
    }
    out
}

fn remote_help(extra: &[String]) -> Option<String> {
    use windows::Win32::UI::WindowsAndMessaging::{GetSystemMetrics, SM_REMOTESESSION};
    if unsafe { GetSystemMetrics(SM_REMOTESESSION) } != 0 {
        return Some("sessione Desktop remoto".into());
    }
    let running = processes();
    let has = |exe: &str| running.iter().any(|p| p == exe);
    if has("quickassist.exe") {
        return Some("Assistenza rapida".into());
    }
    if has("teamviewer_desktop.exe") {
        return Some("TeamViewer".into());
    }
    for name in extra {
        let n = name.trim().to_lowercase();
        if n.is_empty() {
            continue;
        }
        let exe = if n.ends_with(".exe") { n.clone() } else { format!("{n}.exe") };
        if has(&exe) {
            return Some(name.trim().to_string());
        }
    }
    None
}

fn detect(app: &AppHandle) -> Option<String> {
    if MANUAL.load(Ordering::Relaxed) {
        return Some("attivata a mano".into());
    }
    let (meeting, remote, extra) = app
        .try_state::<crate::Shared>()
        .map(|s| {
            let s = s.settings.lock().unwrap();
            (s.presence_meeting, s.presence_remote, s.presence_apps.clone())
        })
        .unwrap_or((false, false, Vec::new()));
    if meeting {
        if let Some(a) = device_in_use("microphone") {
            return Some(format!("{a} usa il microfono"));
        }
        if let Some(a) = device_in_use("webcam") {
            return Some(format!("{a} usa la webcam"));
        }
    }
    if remote {
        if let Some(r) = remote_help(&extra) {
            return Some(r);
        }
    }
    None
}

/// Current state, for the island at startup and the tray tooltip.
pub fn current() -> Option<String> {
    CURRENT.lock().unwrap().clone()
}

fn publish(app: &AppHandle, reason: Option<String>) {
    crate::log::line(match &reason {
        Some(r) => format!("davanti al cliente: sì ({r})"),
        None => "davanti al cliente: no".to_string(),
    });
    *CURRENT.lock().unwrap() = reason.clone();
    let _ = app.emit_to(WINDOW_LABEL, "presence", Presence { active: reason.is_some(), reason: reason.unwrap_or_default() });
    crate::tray::refresh(app);
}

/// Checks right away (after the tray toggle) instead of waiting for the next tick.
pub fn recheck(app: &AppHandle) {
    let now = detect(app);
    if now != current() {
        publish(app, now);
    }
}

pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(3));
        if crate::integrations::PAUSED.load(Ordering::Relaxed) && !MANUAL.load(Ordering::Relaxed) {
            continue;
        }
        recheck(&app);
    });
}

#[cfg(test)]
mod tests {
    use super::app_name;

    #[test]
    fn readable_app_names() {
        assert_eq!(app_name("MSTeams_8wekyb3d8bbwe"), "Teams");
        assert_eq!(app_name("C:#Program Files#Zoom#bin#Zoom.exe"), "Zoom");
        assert_eq!(app_name("C:#Program Files#Google#Chrome#Application#chrome.exe"), "Chrome");
        assert_eq!(app_name("C:#Tools#Strano.exe"), "Strano");
    }
}

/// What the detectors see right now: `cargo test -p easyisland --lib live_presence -- --ignored --nocapture`.
#[cfg(test)]
mod live {
    #[test]
    #[ignore]
    fn live_presence() {
        println!("microfono: {:?}", super::device_in_use("microphone"));
        println!("webcam: {:?}", super::device_in_use("webcam"));
        println!("assistenza: {:?}", super::remote_help(&[]));
        let root = crate::probes::reg::Key::open(crate::probes::reg::HKEY_CURRENT_USER, &format!(r"{}\microphone", super::CONSENT));
        println!("app note al microfono: {:?}", root.map(|k| k.subkeys()));
    }
}
