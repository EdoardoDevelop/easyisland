// The "Teams" integration, local part: no sign-in, no Microsoft account.
// (Chats, meetings of the day and status need Microsoft Graph: docs/idee.md.)
//
// What it knows, every 3 s while the integration is on:
//   * Teams running: ms-teams.exe (new Teams) or teams.exe (classic);
//   * in a meeting: Teams holds the microphone or the webcam, read from the
//     registry like presence.rs (Windows' own privacy icon). It cannot tell a
//     muted microphone: Teams keeps it open.
// What it does, only on a click: the meeting shortcuts sent to Teams' window
// (Muto, Video, Alza la mano, Condividi, Esci), open Teams, join the meeting
// link in the clipboard. Teams' local API is not used (docs/decisioni.md).
// Meetings starting and ending are events for the automations ("teams").

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use serde_json::json;
use tauri::AppHandle;
use windows::Win32::Foundation::{HWND, LPARAM};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowLongPtrW, GetWindowTextLengthW, GetWindowThreadProcessId, IsWindowVisible, GWL_EXSTYLE,
    WS_EX_TOOLWINDOW,
};

use crate::i18n::{t, tf};
use crate::integrations::{self, IntegrationUpdate};

pub const ID: &str = "integration_teams";
const EXES: &[&str] = &["ms-teams.exe", "teams.exe"];

/// In a meeting at the last look: its start and end are the automations' events.
static IN_CALL: AtomicBool = AtomicBool::new(false);

#[derive(Clone, PartialEq, Default, Debug)]
struct Look {
    running: bool,
    mic: bool,
    camera: bool,
}

fn look() -> Look {
    let running = crate::presence::processes().iter().any(|p| EXES.contains(&p.as_str()));
    let teams = |device: &str| crate::presence::device_in_use(device).is_some_and(|a| a == "Teams");
    // Not running: nothing of it can be in use (the registry may lag).
    Look { running, mic: running && teams("microphone"), camera: running && teams("webcam") }
}

fn publish(app: &AppHandle, l: &Look) {
    integrations::emit(app, IntegrationUpdate {
        id: ID,
        data: json!({ "running": l.running, "inCall": l.mic || l.camera, "mic": l.mic, "camera": l.camera }),
        error: None,
        event: None,
    });
}

pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last: Option<Look> = None;
        loop {
            if !integrations::enabled(&app, ID) {
                last = None;
                IN_CALL.store(false, Ordering::Relaxed);
                std::thread::sleep(Duration::from_secs(10));
                continue;
            }
            let now = look();
            let call = now.mic || now.camera;
            let was = IN_CALL.swap(call, Ordering::Relaxed);
            if last.is_some() && was != call {
                crate::log::line(format!("teams: riunione {}", if call { "iniziata" } else { "finita" }));
                crate::automations::on_event("teams", "Teams", if call { "start" } else { "end" }, &[]);
            }
            if last.as_ref() != Some(&now) {
                publish(&app, &now);
                last = Some(now);
            }
            std::thread::sleep(Duration::from_secs(3));
        }
    });
}

/// "Aggiorna ora" and the first look when the integration is switched on.
pub fn refresh(app: &AppHandle) {
    publish(app, &look());
}

/// Teams' window most recently in front: the meeting window during a call.
/// EnumWindows walks the windows from the top of the z-order down.
fn teams_window() -> Option<HWND> {
    unsafe extern "system" fn each(hwnd: HWND, out: LPARAM) -> windows::core::BOOL {
        unsafe {
            let found = &mut *(out.0 as *mut Option<HWND>);
            if !IsWindowVisible(hwnd).as_bool() || GetWindowTextLengthW(hwnd) == 0 {
                return true.into();
            }
            if GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & WS_EX_TOOLWINDOW.0 as isize != 0 {
                return true.into();
            }
            let mut pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut pid));
            let exe = crate::devservers::process_name(pid).unwrap_or_default().to_lowercase();
            if EXES.contains(&exe.as_str()) {
                *found = Some(hwnd);
                return false.into();
            }
            true.into()
        }
    }
    let mut found: Option<HWND> = None;
    unsafe {
        let _ = EnumWindows(Some(each), LPARAM(&mut found as *mut _ as isize));
    }
    found
}

/// A meeting command: Teams' own shortcut, sent to its window.
pub fn action(kind: &str) -> Result<(), String> {
    let keys = match kind {
        "mute" => "Ctrl+Shift+M",
        "video" => "Ctrl+Shift+O",
        "hand" => "Ctrl+Shift+K",
        "share" => "Ctrl+Shift+E",
        "leave" => "Ctrl+Shift+H",
        "open" => return open().then_some(()).ok_or_else(|| t("Teams non si apre").to_string()),
        other => return Err(tf("comando di Teams sconosciuto: {k}", &[("k", &other)])),
    };
    let hwnd = teams_window().ok_or_else(|| t("Teams non è aperto").to_string())?;
    crate::context::send_keys_to(hwnd, keys)
}

/// Opens Teams (the new app answers msteams:).
pub fn open() -> bool {
    crate::actions::shell_open("msteams:").is_ok()
}

/// A Teams meeting link: teams.microsoft.com, teams.live.com or teams.cloud.microsoft.
pub fn meeting_link(text: &str) -> Option<String> {
    let s = text.trim();
    let rest = s.strip_prefix("https://")?;
    let host = rest.split('/').next()?.to_lowercase();
    let ok = ["teams.microsoft.com", "teams.live.com", "teams.cloud.microsoft"].contains(&host.as_str());
    (ok && !s.chars().any(char::is_whitespace) && s.len() < 4000).then(|| s.to_string())
}

/// A meeting link (from the Teams card, Microsoft Graph's joinUrl), to Teams.
pub fn join(link: &str) -> Result<(), String> {
    let link = meeting_link(link).ok_or_else(|| t("Link di riunione Teams non valido").to_string())?;
    match link.strip_prefix("https://teams.microsoft.com/") {
        Some(path) => crate::actions::shell_open(&format!("msteams:/{path}")).map_err(|_| t("Teams non si apre").to_string()),
        None => {
            crate::open_url_now(&link);
            Ok(())
        }
    }
}

/// "Partecipa dal link copiato": the meeting link in the clipboard, to Teams.
/// teams.microsoft.com links go straight to the app (msteams:/l/…), the others
/// through the browser, which hands them to Teams.
pub fn join_from_clipboard() -> Result<(), String> {
    let text = crate::actions::clipboard_text().unwrap_or_default();
    let link = meeting_link(&text).ok_or_else(|| t("Negli appunti non c'è un link di una riunione Teams").to_string())?;
    // Straight to ShellExecute in `join`: open_app would expand the link's %3a… as variables.
    join(&link)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognises_meeting_links() {
        assert!(meeting_link(" https://teams.microsoft.com/l/meetup-join/19%3ameeting_x%40thread.v2/0?context=%7b%7d ").is_some());
        assert!(meeting_link("https://teams.live.com/meet/9399").is_some());
        assert!(meeting_link("https://teams.microsoft.com.evil.it/l/x").is_none());
        assert!(meeting_link("http://teams.microsoft.com/l/x").is_none());
        assert!(meeting_link("https://teams.microsoft.com/l/x altro testo").is_none());
        assert!(meeting_link("ciao").is_none());
    }
}
