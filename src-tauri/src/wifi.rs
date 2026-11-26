// The Wi-Fi network this PC is on: automations («on this network») and the
// habits read it. (It was profiles.rs, with the automatic profile switching,
// until the profiles went on 26 Nov 2026.)

use std::os::windows::process::CommandExt;
use std::process::Command;

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
