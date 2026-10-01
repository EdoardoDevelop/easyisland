// Automatic profile switching: every minute, the first profile whose rules
// match the current Wi-Fi network, weekday and time becomes active.
//
// It only switches when the *match* changes, so picking a profile by hand
// sticks until the situation changes (another network, another time slot).

use std::os::windows::process::CommandExt;
use std::process::Command;
use std::time::Duration;

use tauri::{AppHandle, Manager};
use windows::Win32::System::SystemInformation::GetLocalTime;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Name of the Wi-Fi network this PC is on, if any.
///
/// `netsh` rather than the WLAN API: one line to parse, and the "SSID" label is
/// not translated. "BSSID" is a different key and is skipped by the exact match.
pub fn current_ssid() -> Option<String> {
    let out = Command::new("netsh")
        .args(["wlan", "show", "interfaces"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    text.lines().find_map(|line| {
        let (key, value) = line.trim().split_once(':')?;
        let value = value.trim();
        (key.trim() == "SSID" && !value.is_empty()).then(|| value.to_string())
    })
}

/// (day 1 = Monday … 7 = Sunday, minutes since midnight), local time.
fn now_local() -> (u8, u32) {
    let t = unsafe { GetLocalTime() };
    let day = if t.wDayOfWeek == 0 { 7 } else { t.wDayOfWeek as u8 };
    (day, t.wHour as u32 * 60 + t.wMinute as u32)
}

pub fn spawn_auto_switch(app: AppHandle) {
    std::thread::spawn(move || {
        let mut last_match: Option<String> = None;
        std::thread::sleep(Duration::from_secs(5));
        loop {
            let snapshot = app.try_state::<crate::Shared>().map(|s| {
                let s = s.settings.lock().unwrap();
                (s.auto_profile, s.profiles.clone())
            });
            if let Some((true, profiles)) = snapshot {
                // Only ask for the network when some rule cares about it.
                let needs_ssid = profiles.iter().any(|p| !p.rules.ssids.is_empty());
                let ssid = if needs_ssid { current_ssid() } else { None };
                let (day, minutes) = now_local();
                let matched = profiles
                    .iter()
                    .find(|p| p.rules.matches(ssid.as_deref(), day, minutes))
                    .map(|p| p.id.clone());
                if matched != last_match {
                    last_match = matched.clone();
                    if let Some(id) = matched {
                        crate::activate_profile(&app, &id, "automatico");
                    }
                }
            } else {
                last_match = None;
            }
            std::thread::sleep(Duration::from_secs(60));
        }
    });
}
