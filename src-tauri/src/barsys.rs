// The system elements of the fixed bar (docs/architettura.md → «Barra fissa»,
// «Widget della barra»): volume, microphone, brightness, battery, network
// speed, CPU, memory, disks, GPU, keyboard language, recycle bin, updates
// (winget) and VS Code's recent folders, read here and sent to the island as
// `bar-sys` (src/island/bar.ts draws them; the clock, the window title, music
// and weather are the island's own). One thread holds the COM objects: it
// sleeps on its channel while no such element is in the bar, and reads every
// 2 s while one is (battery, disks and recycle bin every 30 s, brightness every
// 15 s, VS Code every minute, updates every 6 hours on a thread of their own,
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
const VSCODE_EVERY: Duration = Duration::from_secs(60);
/// winget is slow and goes on the network: four times a day, and on «Controlla adesso».
const UPDATES_EVERY: Duration = Duration::from_secs(6 * 3600);

enum Cmd {
    /// The system elements now in the bar ("volume", "mic", …); empty: nothing to read.
    Watch(HashSet<String>),
    Do(String, f64),
    /// A value read elsewhere (the updates, on their own thread).
    Set(&'static str, Value),
}

/// VS Code's recent folders as last read: the only ones `vscode-open` opens.
static RECENT: Mutex<Vec<String>> = Mutex::new(Vec::new());
/// winget is running: one check at a time.
static UPDATING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

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
        let mut cpu: Option<(u64, u64)> = None;
        let mut slow_at: Option<Instant> = None;
        let mut vscode_at: Option<Instant> = None;
        let mut updates_at: Option<Instant> = None;
        let mut gpu: Option<Gpu> = None;
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
                    crate::fgwin::watch(watch.contains("title"));
                    // Read at once and send everything again: the island may have just started.
                    last = Value::Null;
                    battery_at = None;
                    brightness_at = None;
                    slow_at = None;
                    vscode_at = None;
                    if !watch.contains("net") {
                        net = None;
                    }
                    if !watch.contains("cpu") {
                        cpu = None;
                    }
                    if !watch.contains("gpu") {
                        gpu = None;
                    }
                }
                Some(Cmd::Do(what, arg)) => {
                    act(&what, arg);
                    if what.starts_with("brightness") {
                        brightness_at = None;
                    }
                    if what.starts_with("recycle") {
                        slow_at = None;
                    }
                    if what == "updates-check" {
                        updates_at = None;
                    }
                }
                Some(Cmd::Set(key, value)) => state[key] = value,
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
            if watch.contains("cpu") {
                if let Some((idle, total)) = cpu_times() {
                    if let Some((i0, t0)) = cpu {
                        let busy = 1.0 - idle.saturating_sub(i0) as f64 / total.saturating_sub(t0).max(1) as f64;
                        state["cpu"] = json!((busy * 100.0).clamp(0.0, 100.0).round());
                    }
                    cpu = Some((idle, total));
                }
            }
            if watch.contains("ram") {
                state["ram"] = ram();
            }
            if watch.contains("gpu") {
                if gpu.is_none() {
                    gpu = Gpu::open();
                }
                state["gpu"] = gpu.as_ref().and_then(Gpu::read).map(|v| json!(v)).unwrap_or(Value::Null);
            }
            if watch.contains("lang") {
                state["lang"] = keyboard();
            }
            if (watch.contains("disk") || watch.contains("recycle")) && slow_at.is_none_or(|t| t.elapsed() >= BATTERY_EVERY) {
                slow_at = Some(Instant::now());
                if watch.contains("disk") {
                    state["disks"] = disks();
                }
                if watch.contains("recycle") {
                    state["recycle"] = recycle();
                }
            }
            if watch.contains("vscode") && vscode_at.is_none_or(|t| t.elapsed() >= VSCODE_EVERY) {
                vscode_at = Some(Instant::now());
                let list = vscode_recent();
                *RECENT.lock().unwrap() = list.iter().map(|(_, p)| p.clone()).collect();
                state["vscode"] = json!(list.iter().map(|(n, p)| json!({ "name": n, "path": p })).collect::<Vec<_>>());
            }
            if watch.contains("updates") && updates_at.is_none_or(|t| t.elapsed() >= UPDATES_EVERY) {
                updates_at = Some(Instant::now());
                if !UPDATING.swap(true, std::sync::atomic::Ordering::SeqCst) {
                    if state.get("updates").is_none_or(Value::is_null) {
                        state["updates"] = json!({ "checking": true });
                    }
                    std::thread::spawn(|| {
                        let found = winget_updates();
                        UPDATING.store(false, std::sync::atomic::Ordering::SeqCst);
                        send(Cmd::Set("updates", found));
                    });
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
/// a Windows panel (`panel:…`), the power menu's `lock`, `sleep`, `restart`, `shutdown`,
/// the recycle bin's `recycle-open` / `recycle-empty`, the updates' `updates-check` /
/// `updates-all`, or `vscode-open` with `path`, one of VS Code's recent folders.
#[tauri::command]
pub fn bar_sys_do(what: String, arg: Option<f64>, path: Option<String>) {
    let arg = arg.unwrap_or(0.0);
    match what.as_str() {
        // Shown by Windows itself: not on the COM thread, which would wait for the answer.
        "sleep" | "restart" | "shutdown" | "updates-all" => {
            std::thread::spawn(move || power(&what));
        }
        // Windows asks itself before emptying it; then the count is read again.
        "recycle-empty" => {
            std::thread::spawn(|| {
                use windows::Win32::UI::Shell::SHEmptyRecycleBinW;
                let _ = unsafe { SHEmptyRecycleBinW(None, windows::core::PCWSTR::null(), 0) };
                send(Cmd::Do("recycle-read".into(), 0.0));
            });
        }
        "vscode-open" => {
            let Some(p) = path.filter(|p| RECENT.lock().unwrap().contains(p)) else { return };
            vscode_open(&p);
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
        "recycle-open" => {
            let _ = std::process::Command::new("explorer.exe").arg("shell:RecycleBinFolder").spawn();
        }
        // A drive's root in File Explorer: a letter only.
        d if d.starts_with("disk-open:") => {
            if let Some(l) = d.strip_prefix("disk-open:").filter(|l| l.len() == 1 && l.chars().all(|c| c.is_ascii_uppercase())) {
                let _ = std::process::Command::new("explorer.exe").arg(format!("{l}:\\")).spawn();
            }
        }
        _ => {}
    }
}

/// Idle and busy (kernel + user) time of every processor, 100 ns.
fn cpu_times() -> Option<(u64, u64)> {
    use windows::Win32::Foundation::FILETIME;
    use windows::Win32::System::Threading::GetSystemTimes;
    let (mut idle, mut kernel, mut user) = (FILETIME::default(), FILETIME::default(), FILETIME::default());
    unsafe { GetSystemTimes(Some(&mut idle), Some(&mut kernel), Some(&mut user)) }.ok()?;
    let n = |t: FILETIME| ((t.dwHighDateTime as u64) << 32) | t.dwLowDateTime as u64;
    // Kernel time includes the idle time.
    Some((n(idle), n(kernel).saturating_add(n(user))))
}

fn ram() -> Value {
    use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    let mut m = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
    if unsafe { GlobalMemoryStatusEx(&mut m) }.is_err() || m.ullTotalPhys == 0 {
        return Value::Null;
    }
    json!({ "percent": m.dwMemoryLoad, "used": m.ullTotalPhys.saturating_sub(m.ullAvailPhys), "total": m.ullTotalPhys })
}

/// The fixed disks: { "C": { free, total } }.
fn disks() -> Value {
    use windows::core::HSTRING;
    use windows::Win32::Storage::FileSystem::{GetDiskFreeSpaceExW, GetDriveTypeW, GetLogicalDrives};
    const DRIVE_FIXED: u32 = 3;
    let mask = unsafe { GetLogicalDrives() };
    let mut out = serde_json::Map::new();
    for i in 0..26u8 {
        if mask & (1 << i) == 0 {
            continue;
        }
        let letter = (b'A' + i) as char;
        let root = HSTRING::from(format!("{letter}:\\"));
        if unsafe { GetDriveTypeW(&root) } != DRIVE_FIXED {
            continue;
        }
        let (mut free, mut total) = (0u64, 0u64);
        if unsafe { GetDiskFreeSpaceExW(&root, Some(&mut free), Some(&mut total), None) }.is_ok() && total > 0 {
            out.insert(letter.to_string(), json!({ "free": free, "total": total }));
        }
    }
    Value::Object(out)
}

/// The GPU's load as Task Manager counts it: the 3D engines of every process, summed.
struct Gpu {
    query: windows::Win32::System::Performance::PDH_HQUERY,
    counter: windows::Win32::System::Performance::PDH_HCOUNTER,
}

impl Gpu {
    fn open() -> Option<Gpu> {
        use windows::core::w;
        use windows::Win32::System::Performance::{PdhAddEnglishCounterW, PdhCollectQueryData, PdhOpenQueryW, PDH_HCOUNTER, PDH_HQUERY};
        let mut query = PDH_HQUERY::default();
        let mut counter = PDH_HCOUNTER::default();
        unsafe {
            if PdhOpenQueryW(None, 0, &mut query) != 0 {
                return None;
            }
            if PdhAddEnglishCounterW(query, w!("\\GPU Engine(*engtype_3D)\\Utilization Percentage"), 0, &mut counter) != 0 {
                let _ = windows::Win32::System::Performance::PdhCloseQuery(query);
                return None;
            }
            // The first sample only starts the count.
            PdhCollectQueryData(query);
        }
        Some(Gpu { query, counter })
    }

    fn read(&self) -> Option<f64> {
        use windows::Win32::System::Performance::{PdhCollectQueryData, PdhGetFormattedCounterArrayW, PDH_FMT_COUNTERVALUE_ITEM_W, PDH_FMT_DOUBLE};
        const PDH_MORE_DATA: u32 = 0x8000_07D2;
        unsafe {
            if PdhCollectQueryData(self.query) != 0 {
                return None;
            }
            let (mut size, mut count) = (0u32, 0u32);
            if PdhGetFormattedCounterArrayW(self.counter, PDH_FMT_DOUBLE, &mut size, &mut count, None) != PDH_MORE_DATA || size == 0 {
                return None;
            }
            // u64 words: the items need 8-byte alignment.
            let mut buf = vec![0u64; (size as usize).div_ceil(8)];
            let items = buf.as_mut_ptr() as *mut PDH_FMT_COUNTERVALUE_ITEM_W;
            if PdhGetFormattedCounterArrayW(self.counter, PDH_FMT_DOUBLE, &mut size, &mut count, Some(items)) != 0 {
                return None;
            }
            let list = std::slice::from_raw_parts(items, count as usize);
            let sum: f64 = list.iter().filter(|i| i.FmtValue.CStatus == 0).map(|i| i.FmtValue.Anonymous.doubleValue).sum();
            Some(sum.clamp(0.0, 100.0).round())
        }
    }
}

impl Drop for Gpu {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::System::Performance::PdhCloseQuery(self.query);
        }
    }
}

/// The keyboard language of the window in front: { code: "IT", name: "Italiano (Italia)" }.
fn keyboard() -> Value {
    use windows::core::PCWSTR;
    use windows::Win32::Globalization::{GetLocaleInfoEx, LCIDToLocaleName, LOCALE_SLOCALIZEDDISPLAYNAME};
    use windows::Win32::UI::Input::KeyboardAndMouse::GetKeyboardLayout;
    use windows::Win32::UI::WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId};
    unsafe {
        let thread = GetWindowThreadProcessId(GetForegroundWindow(), None);
        let lang = (GetKeyboardLayout(thread).0 as usize & 0xffff) as u32;
        let mut buf = [0u16; 85];
        let n = LCIDToLocaleName(lang, Some(&mut buf), 0);
        if n <= 1 {
            return Value::Null;
        }
        let locale = String::from_utf16_lossy(buf.get(..(n - 1) as usize).unwrap_or(&[]));
        let mut name = [0u16; 128];
        let m = GetLocaleInfoEx(PCWSTR(buf.as_ptr()), LOCALE_SLOCALIZEDDISPLAYNAME, Some(&mut name));
        let name = if m > 1 { String::from_utf16_lossy(name.get(..(m - 1) as usize).unwrap_or(&[])) } else { locale.clone() };
        let code = locale.split('-').next().unwrap_or_default().to_uppercase();
        json!({ "code": code, "name": name })
    }
}

/// What the recycle bin holds: { count, bytes }.
fn recycle() -> Value {
    use windows::Win32::UI::Shell::{SHQueryRecycleBinW, SHQUERYRBINFO};
    let mut q = SHQUERYRBINFO { cbSize: std::mem::size_of::<SHQUERYRBINFO>() as u32, ..Default::default() };
    if unsafe { SHQueryRecycleBinW(windows::core::PCWSTR::null(), &mut q) }.is_err() {
        return Value::Null;
    }
    json!({ "count": q.i64NumItems.max(0), "bytes": q.i64Size.max(0) })
}

/// winget's upgrades: { count, names: ["Programma 1.2 → 1.3", …], at }, or null without winget.
fn winget_updates() -> Value {
    use std::os::windows::process::CommandExt;
    let out = std::process::Command::new("winget")
        .args(["upgrade", "--disable-interactivity"])
        .creation_flags(0x0800_0000)
        .output();
    let Ok(out) = out else { return Value::Null };
    let text = String::from_utf8_lossy(&out.stdout);
    let found = parse_winget(&text);
    crate::log::line(format!("barra fissa: {} aggiornamenti da winget", found.len()));
    json!({
        "count": found.len(),
        "names": found.iter().take(20).map(|(name, from, to)| format!("{name} {from} → {to}")).collect::<Vec<_>>(),
        "at": std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
    })
}

/// The table `winget upgrade` prints (headers in the user's language): name,
/// installed version and available one of each row, up to the first blank line.
fn parse_winget(text: &str) -> Vec<(String, String, String)> {
    // The progress spinner rewrites the line with \r: only what is left counts.
    let lines: Vec<&str> = text.lines().map(|l| l.rsplit('\r').next().unwrap_or(l)).collect();
    let Some(dash) = lines.iter().position(|l| l.len() > 10 && l.trim().chars().all(|c| c == '-')) else { return Vec::new() };
    let Some(header) = dash.checked_sub(1).and_then(|i| lines.get(i)) else { return Vec::new() };
    // Where each column starts: name, id, version, available (char positions).
    let chars: Vec<char> = header.chars().collect();
    let starts: Vec<usize> = (0..chars.len())
        .filter(|&i| chars.get(i).is_some_and(|c| !c.is_whitespace()) && (i == 0 || chars.get(i - 1).is_some_and(|c| c.is_whitespace())))
        .collect();
    let (Some(&id), Some(&ver), Some(&avail)) = (starts.get(1), starts.get(2), starts.get(3)) else { return Vec::new() };
    let end = starts.get(4).copied();
    let mut out = Vec::new();
    for line in lines.iter().skip(dash + 1) {
        if line.trim().is_empty() {
            break;
        }
        let c: Vec<char> = line.chars().collect();
        if c.len() <= avail {
            break;
        }
        let cut = |a: usize, b: Option<usize>| -> String {
            c.get(a..b.unwrap_or(c.len()).min(c.len())).map(|s| s.iter().collect::<String>()).unwrap_or_default().trim().to_string()
        };
        let name = cut(0, Some(id));
        if !name.is_empty() {
            out.push((name, cut(ver, Some(avail)), cut(avail, end)));
        }
    }
    out
}

/// VS Code's recent folders, newest first: (name, path). From its workspace
/// storage (a folder per workspace with workspace.json), dated by the files in it.
fn vscode_recent() -> Vec<(String, String)> {
    let Some(base) = std::env::var_os("APPDATA").map(|d| std::path::PathBuf::from(d).join("Code").join("User").join("workspaceStorage")) else { return Vec::new() };
    let Ok(dirs) = std::fs::read_dir(&base) else { return Vec::new() };
    let mut found: Vec<(std::time::SystemTime, String)> = Vec::new();
    for d in dirs.flatten() {
        let dir = d.path();
        let Ok(meta) = std::fs::metadata(dir.join("workspace.json")) else { continue };
        if meta.len() > 64 * 1024 {
            continue;
        }
        let Ok(text) = std::fs::read_to_string(dir.join("workspace.json")) else { continue };
        let Ok(v) = serde_json::from_str::<Value>(&text) else { continue };
        let Some(uri) = v.get("folder").or_else(|| v.get("workspace")).and_then(Value::as_str) else { continue };
        let Some(rest) = uri.strip_prefix("file:///") else { continue };
        let path = crate::news::url_decode(rest).replace('/', "\\");
        if !std::path::Path::new(&path).exists() {
            continue;
        }
        let when = ["state.vscdb", "workspace.json"]
            .iter()
            .filter_map(|f| std::fs::metadata(dir.join(f)).and_then(|m| m.modified()).ok())
            .max()
            .unwrap_or(std::time::UNIX_EPOCH);
        found.push((when, path));
    }
    found.sort_by(|a, b| b.0.cmp(&a.0));
    let mut seen = HashSet::new();
    found
        .into_iter()
        .filter(|(_, p)| seen.insert(p.to_lowercase()))
        .take(15)
        .map(|(_, p)| {
            let name = std::path::Path::new(&p).file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| p.clone());
            (name, p)
        })
        .collect()
}

/// Opens one of VS Code's recent folders: its program where it is installed, else `code` on the PATH.
fn vscode_open(path: &str) {
    use std::os::windows::process::CommandExt;
    let exe = [("LOCALAPPDATA", "Programs\\Microsoft VS Code\\Code.exe"), ("ProgramFiles", "Microsoft VS Code\\Code.exe")]
        .iter()
        .filter_map(|(var, rel)| std::env::var_os(var).map(|d| std::path::PathBuf::from(d).join(rel)))
        .find(|p| p.exists());
    let started = match exe {
        Some(exe) => std::process::Command::new(exe).arg(path).spawn().is_ok(),
        None => std::process::Command::new("cmd").args(["/c", "code", "--", path]).creation_flags(0x0800_0000).spawn().is_ok(),
    };
    if !started {
        crate::log::line("barra fissa: VS Code non trovato".to_string());
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
        // Windows' own switcher of the keyboard language.
        "lang" => &[VK_LWIN, windows::Win32::UI::Input::KeyboardAndMouse::VK_SPACE],
        // Windows' settings pages, from the cards' buttons.
        "sound" | "network" | "power" | "display" | "datetime" | "update" | "storage" | "language" => {
            let page = match which {
                "sound" => "ms-settings:sound",
                "network" => "ms-settings:network-status",
                "power" => "ms-settings:powersleep",
                "display" => "ms-settings:display",
                "update" => "ms-settings:windowsupdate",
                "storage" => "ms-settings:storagesense",
                "language" => "ms-settings:regionlanguage",
                _ => "ms-settings:dateandtime",
            };
            let _ = std::process::Command::new("explorer.exe").arg(page).spawn();
            return;
        }
        "taskmgr" => {
            let _ = std::process::Command::new("taskmgr.exe").spawn();
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
        "updates-all" => t("Aggiornare adesso tutti i programmi con winget? Si apre una finestra che mostra cosa fa; alcuni programmi possono chiedere conferma o chiudersi."),
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
    crate::log::line(format!("barra fissa: {what} chiesto dalla barra"));
    match what {
        // A console of its own, left open at the end to read what happened.
        "updates-all" => {
            use std::os::windows::process::CommandExt;
            const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
            let _ = std::process::Command::new("cmd.exe").args(["/k", "winget", "upgrade", "--all"]).creation_flags(CREATE_NEW_CONSOLE).spawn();
            send(Cmd::Do("updates-check".into(), 0.0));
        }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn winget_table_is_read_in_any_language() {
        let text = "   - \r   \\ \r\nNome                 ID                    Versione   Disponibile Origine\n-----------------------------------------------------------------------------\nGit                  Git.Git               2.44.0     2.45.1      winget\nMozilla Firefox (it) Mozilla.Firefox.it    125.0      126.0.1     winget\n2 aggiornamenti disponibili.\n";
        let got = parse_winget(text);
        assert_eq!(got.len(), 2);
        assert_eq!(got[0], ("Git".to_string(), "2.44.0".to_string(), "2.45.1".to_string()));
        assert_eq!(got[1].0, "Mozilla Firefox (it)");
        assert_eq!(got[1].2, "126.0.1");
        assert!(parse_winget("Nessun aggiornamento disponibile.").is_empty());
    }
}
