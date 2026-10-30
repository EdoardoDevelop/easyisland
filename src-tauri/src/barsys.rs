// The system elements of the fixed bar (docs/architettura.md → «Barra fissa»,
// «Widget della barra»): volume, microphone, brightness, battery and network
// speed, read here and sent to the island as `bar-sys` (src/island/bar.ts
// draws them; the clock is the island's own). One thread holds the COM
// objects: it sleeps on its channel while no such element is in the bar, and
// reads every 2 s while one is (battery every 30 s, brightness every 15 s,
// at once after a change of ours). The island hears only what changed.
//
// It also does what the elements and their cards in the island ask (src/views/
// barcard.ts): volume and brightness from the wheel or a slider, mute, and the
// power menu. Sleep, restart and shut down always ask first
// with Windows' own message box; lock does not (nothing is lost).

use std::collections::HashSet;
use std::sync::mpsc::{channel, RecvTimeoutError, Sender};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

const EVERY: Duration = Duration::from_secs(2);
const BATTERY_EVERY: Duration = Duration::from_secs(30);
const BRIGHTNESS_EVERY: Duration = Duration::from_secs(15);

enum Cmd {
    /// The system elements now in the bar ("volume", "mic", …); empty: nothing to read.
    Watch(HashSet<String>),
    Do(String, f64),
}

static TX: OnceLock<Mutex<Sender<Cmd>>> = OnceLock::new();

fn send(cmd: Cmd) {
    if let Some(tx) = TX.get() {
        let _ = tx.lock().unwrap().send(cmd);
    }
}

pub fn start(app: AppHandle) {
    let (tx, rx) = channel::<Cmd>();
    if TX.set(Mutex::new(tx)).is_err() {
        return;
    }
    std::thread::spawn(move || {
        unsafe {
            let _ = windows::Win32::System::Com::CoInitializeEx(None, windows::Win32::System::Com::COINIT_MULTITHREADED);
        }
        let mut watch: HashSet<String> = HashSet::new();
        let mut last = Value::Null;
        let mut state = json!({});
        let mut net: Option<(u64, u64, Instant)> = None;
        let mut battery_at: Option<Instant> = None;
        let mut brightness_at: Option<Instant> = None;
        let mut ip: (Option<Instant>, String) = (None, String::new());
        loop {
            let cmd = if watch.is_empty() {
                match rx.recv() {
                    Ok(c) => Some(c),
                    Err(_) => return,
                }
            } else {
                match rx.recv_timeout(EVERY) {
                    Ok(c) => Some(c),
                    Err(RecvTimeoutError::Timeout) => None,
                    Err(RecvTimeoutError::Disconnected) => return,
                }
            };
            match cmd {
                Some(Cmd::Watch(w)) => {
                    if w == watch {
                        continue;
                    }
                    watch = w;
                    // Read at once and send everything again: the island may have just started.
                    last = Value::Null;
                    battery_at = None;
                    brightness_at = None;
                    if !watch.contains("net") {
                        net = None;
                    }
                }
                Some(Cmd::Do(what, arg)) => {
                    act(&what, arg);
                    if what.starts_with("brightness") {
                        brightness_at = None;
                    }
                }
                None => {}
            }
            if watch.is_empty() {
                continue;
            }
            if watch.contains("volume") {
                state["volume"] = volume(Flow::Render)
                    .map(|(l, m)| json!({ "level": l, "muted": m, "device": device_name(Flow::Render) }))
                    .unwrap_or(Value::Null);
            }
            if watch.contains("mic") {
                state["mic"] = volume(Flow::Capture)
                    .map(|(l, m)| json!({ "level": l, "muted": m, "device": device_name(Flow::Capture) }))
                    .unwrap_or(Value::Null);
            }
            if watch.contains("battery") && battery_at.is_none_or(|t| t.elapsed() >= BATTERY_EVERY) {
                battery_at = Some(Instant::now());
                state["battery"] = battery();
            }
            if watch.contains("brightness") && brightness_at.is_none_or(|t| t.elapsed() >= BRIGHTNESS_EVERY) {
                brightness_at = Some(Instant::now());
                state["brightness"] = brightness().map(|b| json!(b)).unwrap_or(Value::Null);
            }
            if watch.contains("net") {
                if let Some(o) = octets() {
                    let now = Instant::now();
                    // The address changes rarely and costs more to read: every 30 s.
                    if ip.0.is_none_or(|t: Instant| t.elapsed() >= BATTERY_EVERY) {
                        ip = (Some(now), crate::probes::primary_ipv4().map(|a| a.to_string()).unwrap_or_default());
                    }
                    if let Some((d0, u0, t0)) = net {
                        let secs = now.duration_since(t0).as_secs_f64().max(0.5);
                        state["net"] = json!({
                            "down": (o.down.saturating_sub(d0) as f64 / secs).round(),
                            "up": (o.up.saturating_sub(u0) as f64 / secs).round(),
                            "wifi": o.wifi,
                            "name": o.name,
                            "link": o.link,
                            "ip": ip.1,
                        });
                    }
                    net = Some((o.down, o.up, now));
                } else {
                    state["net"] = Value::Null;
                }
            }
            if state != last {
                last = state.clone();
                let _ = app.emit_to(crate::island::WINDOW_LABEL, "bar-sys", &state);
            }
        }
    });
}

/// The island tells which system elements the bar shows now.
#[tauri::command]
pub fn bar_sys_watch(kinds: Vec<String>) {
    send(Cmd::Watch(kinds.into_iter().collect()));
}

/// An element asks: `volume` / `brightness` by `arg` points, `volume-set` /
/// `mic-set` / `brightness-set` to `arg` (0–100, a card's slider), `mute`, `mic-mute`,
/// a Windows panel (`panel:…`), or the power menu's `lock`, `sleep`, `restart`, `shutdown`.
#[tauri::command]
pub fn bar_sys_do(what: String, arg: Option<f64>) {
    let arg = arg.unwrap_or(0.0);
    match what.as_str() {
        // Shown by Windows itself: not on the COM thread, which would wait for the answer.
        "sleep" | "restart" | "shutdown" => {
            std::thread::spawn(move || power(&what));
        }
        _ => send(Cmd::Do(what, arg)),
    }
}

fn act(what: &str, arg: f64) {
    match what {
        "volume" => {
            if let Some((l, _)) = volume(Flow::Render) {
                set_volume(Flow::Render, Some((l + arg / 100.0).clamp(0.0, 1.0)), None);
            }
        }
        "volume-set" => set_volume(Flow::Render, Some((arg / 100.0).clamp(0.0, 1.0)), None),
        "mic-set" => set_volume(Flow::Capture, Some((arg / 100.0).clamp(0.0, 1.0)), None),
        "brightness-set" => set_brightness(arg.clamp(0.0, 100.0) as u32),
        "mute" => {
            if let Some((_, m)) = volume(Flow::Render) {
                set_volume(Flow::Render, None, Some(!m));
            }
        }
        "mic-mute" => {
            if let Some((_, m)) = volume(Flow::Capture) {
                set_volume(Flow::Capture, None, Some(!m));
            }
        }
        "brightness" => {
            if let Some(b) = brightness() {
                set_brightness((b as f64 + arg).clamp(0.0, 100.0) as u32);
            }
        }
        "lock" => unsafe {
            let _ = windows::Win32::System::Shutdown::LockWorkStation();
        },
        p if p.starts_with("panel:") => panel(p.trim_start_matches("panel:")),
        _ => {}
    }
}

#[derive(Clone, Copy)]
enum Flow {
    Render,
    Capture,
}

fn endpoint(flow: Flow) -> Option<windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume> {
    use windows::Win32::Media::Audio::{eCapture, eMultimedia, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::System::Com::{CoCreateInstance, CLSCTX_ALL};
    unsafe {
        let devices: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
        let device = devices
            .GetDefaultAudioEndpoint(match flow { Flow::Render => eRender, Flow::Capture => eCapture }, eMultimedia)
            .ok()?;
        device.Activate(CLSCTX_ALL, None).ok()
    }
}

/// The default device's name as Windows shows it («Altoparlanti (Realtek…)»).
fn device_name(flow: Flow) -> String {
    use windows::Win32::Foundation::PROPERTYKEY;
    use windows::Win32::Media::Audio::{eCapture, eMultimedia, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::System::Com::StructuredStorage::PropVariantToStringAlloc;
    use windows::Win32::System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_ALL, STGM_READ};
    // PKEY_Device_FriendlyName (functiondiscoverykeys_devpkey.h).
    const FRIENDLY_NAME: PROPERTYKEY = PROPERTYKEY { fmtid: windows::core::GUID::from_u128(0xa45c254e_df1c_4efd_8020_67d146a850e0), pid: 14 };
    unsafe {
        let Ok(devices) = CoCreateInstance::<_, IMMDeviceEnumerator>(&MMDeviceEnumerator, None, CLSCTX_ALL) else { return String::new() };
        let Ok(device) = devices.GetDefaultAudioEndpoint(match flow { Flow::Render => eRender, Flow::Capture => eCapture }, eMultimedia) else { return String::new() };
        let Ok(store) = device.OpenPropertyStore(STGM_READ) else { return String::new() };
        let Ok(value) = store.GetValue(&FRIENDLY_NAME) else { return String::new() };
        let Ok(text) = PropVariantToStringAlloc(&value) else { return String::new() };
        let name = text.to_string().unwrap_or_default();
        CoTaskMemFree(Some(text.0 as *const _));
        name
    }
}

/// The default device's level (0–1) and mute; None without one.
fn volume(flow: Flow) -> Option<(f64, bool)> {
    let ep = endpoint(flow)?;
    unsafe {
        let level = ep.GetMasterVolumeLevelScalar().ok()? as f64;
        let muted = ep.GetMute().ok()?.as_bool();
        Some(((level * 100.0).round() / 100.0, muted))
    }
}

fn set_volume(flow: Flow, level: Option<f64>, mute: Option<bool>) {
    let Some(ep) = endpoint(flow) else { return };
    unsafe {
        if let Some(l) = level {
            let _ = ep.SetMasterVolumeLevelScalar(l as f32, std::ptr::null());
            // Turning it up unmutes, as the keyboard's keys do.
            if l > 0.0 {
                let _ = ep.SetMute(false, std::ptr::null());
            }
        }
        if let Some(m) = mute {
            let _ = ep.SetMute(m, std::ptr::null());
        }
    }
}

fn battery() -> Value {
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    let mut p = SYSTEM_POWER_STATUS::default();
    if unsafe { GetSystemPowerStatus(&mut p) }.is_err() || p.BatteryFlag == 128 || p.BatteryLifePercent > 100 {
        return Value::Null;
    }
    json!({
        "percent": p.BatteryLifePercent,
        "plugged": p.ACLineStatus == 1,
        "charging": p.BatteryFlag & 8 != 0,
        // Windows' estimate, only on battery (u32::MAX: unknown).
        "minutes": if p.BatteryLifeTime == u32::MAX { Value::Null } else { json!(p.BatteryLifeTime / 60) },
        "saver": p.SystemStatusFlag == 1,
    })
}

/// What the physical adapters that are up have received and sent, and the busiest one.
struct Octets {
    down: u64,
    up: u64,
    wifi: bool,
    /// The busiest adapter's name («Wi-Fi», «Ethernet») and its link speed, bit/s.
    name: String,
    link: u64,
}

fn octets() -> Option<Octets> {
    use windows::Win32::NetworkManagement::IpHelper::{FreeMibTable, GetIfTable2, MIB_IF_TABLE2};
    use windows::Win32::NetworkManagement::Ndis::IfOperStatusUp;
    const LOOPBACK: u32 = 24;
    const WIFI: u32 = 71;
    let mut table: *mut MIB_IF_TABLE2 = std::ptr::null_mut();
    unsafe {
        if GetIfTable2(&mut table).is_err() || table.is_null() {
            return None;
        }
        let n = (*table).NumEntries as usize;
        let rows = std::slice::from_raw_parts((*table).Table.as_ptr(), n);
        let mut out = Octets { down: 0, up: 0, wifi: false, name: String::new(), link: 0 };
        let mut busiest = 0u64;
        for r in rows {
            let hardware = r.InterfaceAndOperStatusFlags._bitfield & 1 != 0;
            if hardware && r.Type != LOOPBACK && r.OperStatus == IfOperStatusUp {
                out.down = out.down.saturating_add(r.InOctets);
                out.up = out.up.saturating_add(r.OutOctets);
                let total = r.InOctets.saturating_add(r.OutOctets);
                if total >= busiest {
                    busiest = total;
                    let end = r.Alias.iter().position(|&c| c == 0).unwrap_or(r.Alias.len());
                    out.name = String::from_utf16_lossy(r.Alias.get(..end).unwrap_or(&[]));
                    out.link = r.ReceiveLinkSpeed;
                    out.wifi = r.Type == WIFI;
                }
            }
        }
        FreeMibTable(table as *const _);
        Some(out)
    }
}

/// The screens that answer on DDC/CI (external monitors), each as its handle.
fn physical_monitors() -> Vec<windows::Win32::Devices::Display::PHYSICAL_MONITOR> {
    use windows::core::BOOL;
    use windows::Win32::Devices::Display::{GetNumberOfPhysicalMonitorsFromHMONITOR, GetPhysicalMonitorsFromHMONITOR, PHYSICAL_MONITOR};
    use windows::Win32::Foundation::{LPARAM, RECT};
    use windows::Win32::Graphics::Gdi::{EnumDisplayMonitors, HDC, HMONITOR};
    unsafe extern "system" fn each(m: HMONITOR, _: HDC, _: *mut RECT, data: LPARAM) -> BOOL {
        let out = &mut *(data.0 as *mut Vec<HMONITOR>);
        out.push(m);
        true.into()
    }
    let mut handles: Vec<HMONITOR> = Vec::new();
    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(each), LPARAM(&mut handles as *mut _ as isize));
    }
    let mut out = Vec::new();
    for h in handles {
        let mut n = 0u32;
        if unsafe { GetNumberOfPhysicalMonitorsFromHMONITOR(h, &mut n) }.is_err() || n == 0 || n > 8 {
            continue;
        }
        let mut list = vec![PHYSICAL_MONITOR::default(); n as usize];
        if unsafe { GetPhysicalMonitorsFromHMONITOR(h, &mut list) }.is_ok() {
            out.extend(list);
        }
    }
    out
}

/// Brightness 0–100: the first external screen that answers, else the laptop's panel (WMI).
fn brightness() -> Option<u32> {
    use windows::Win32::Devices::Display::{DestroyPhysicalMonitors, GetMonitorBrightness};
    let list = physical_monitors();
    let mut found = None;
    for m in &list {
        let (mut lo, mut cur, mut hi) = (0u32, 0u32, 0u32);
        if unsafe { GetMonitorBrightness(m.hPhysicalMonitor, &mut lo, &mut cur, &mut hi) } != 0 && hi > lo {
            found = Some(((cur.saturating_sub(lo)) as f64 * 100.0 / (hi - lo) as f64).round() as u32);
            break;
        }
    }
    if !list.is_empty() {
        unsafe {
            let _ = DestroyPhysicalMonitors(&list);
        }
    }
    found.or_else(|| {
        powershell("(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1).CurrentBrightness")
            .and_then(|s| s.trim().parse::<u32>().ok())
            .map(|b| b.min(100))
    })
}

/// Every screen that answers gets the same level; the laptop's panel through WMI.
fn set_brightness(level: u32) {
    use windows::Win32::Devices::Display::{DestroyPhysicalMonitors, GetMonitorBrightness, SetMonitorBrightness};
    let list = physical_monitors();
    let mut done = false;
    for m in &list {
        let (mut lo, mut cur, mut hi) = (0u32, 0u32, 0u32);
        if unsafe { GetMonitorBrightness(m.hPhysicalMonitor, &mut lo, &mut cur, &mut hi) } != 0 && hi > lo {
            let v = lo + ((hi - lo) as f64 * level as f64 / 100.0).round() as u32;
            done |= unsafe { SetMonitorBrightness(m.hPhysicalMonitor, v) } != 0;
        }
    }
    if !list.is_empty() {
        unsafe {
            let _ = DestroyPhysicalMonitors(&list);
        }
    }
    if !done {
        let _ = powershell(&format!(
            "Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{{Timeout=1; Brightness={level}}} | Out-Null"
        ));
    }
}

fn powershell(script: &str) -> Option<String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;
    let out = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    out.status.success().then(|| String::from_utf8_lossy(&out.stdout).into_owned())
}

/// Windows' own panels, opened with their keyboard shortcuts: the calendar,
/// the volume mixer, the quick settings (battery, brightness, network).
fn panel(which: &str) {
    use windows::Win32::UI::Input::KeyboardAndMouse::{VIRTUAL_KEY, VK_CONTROL, VK_LWIN, VK_MENU};
    let keys: &[VIRTUAL_KEY] = match which {
        "calendar" => &[VK_LWIN, VK_MENU, VIRTUAL_KEY(b'D' as u16)],
        "volume" => &[VK_LWIN, VK_CONTROL, VIRTUAL_KEY(b'V' as u16)],
        "quick" => &[VK_LWIN, VIRTUAL_KEY(b'A' as u16)],
        // Windows' settings pages, from the cards' buttons.
        "sound" | "network" | "power" | "display" | "datetime" => {
            let page = match which {
                "sound" => "ms-settings:sound",
                "network" => "ms-settings:network-status",
                "power" => "ms-settings:powersleep",
                "display" => "ms-settings:display",
                _ => "ms-settings:dateandtime",
            };
            let _ = std::process::Command::new("explorer.exe").arg(page).spawn();
            return;
        }
        _ => return,
    };
    press(keys);
}

fn press(keys: &[windows::Win32::UI::Input::KeyboardAndMouse::VIRTUAL_KEY]) {
    use windows::Win32::UI::Input::KeyboardAndMouse::{SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYEVENTF_KEYUP, KEYBD_EVENT_FLAGS};
    let key = |vk, up: bool| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT { wVk: vk, dwFlags: if up { KEYEVENTF_KEYUP } else { KEYBD_EVENT_FLAGS(0) }, ..Default::default() },
        },
    };
    let mut seq: Vec<INPUT> = keys.iter().map(|&k| key(k, false)).collect();
    seq.extend(keys.iter().rev().map(|&k| key(k, true)));
    unsafe {
        SendInput(&seq, std::mem::size_of::<INPUT>() as i32);
    }
}

/// Sleep, restart, shut down: only after «Sì» in Windows' own box.
fn power(what: &str) {
    use crate::i18n::t;
    use windows::core::HSTRING;
    use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, IDYES, MB_DEFBUTTON2, MB_ICONQUESTION, MB_SETFOREGROUND, MB_TOPMOST, MB_YESNO};
    let question = match what {
        "sleep" => t("Sospendere il PC adesso?"),
        "restart" => t("Riavviare il PC adesso? I programmi aperti si chiudono."),
        "shutdown" => t("Spegnere il PC adesso? I programmi aperti si chiudono."),
        _ => return,
    };
    let answer = unsafe {
        MessageBoxW(
            None,
            &HSTRING::from(question),
            &HSTRING::from("EasyIsland"),
            MB_YESNO | MB_ICONQUESTION | MB_DEFBUTTON2 | MB_TOPMOST | MB_SETFOREGROUND,
        )
    };
    if answer != IDYES {
        return;
    }
    crate::log::line(format!("barra fissa: {what} chiesto dal menu di spegnimento"));
    match what {
        "sleep" => unsafe {
            let _ = windows::Win32::System::Power::SetSuspendState(false, false, false);
        },
        "restart" | "shutdown" => {
            use std::os::windows::process::CommandExt;
            let flag = if what == "restart" { "/r" } else { "/s" };
            let _ = std::process::Command::new("shutdown.exe").args([flag, "/t", "0"]).creation_flags(0x0800_0000).spawn();
        }
        _ => {}
    }
}
