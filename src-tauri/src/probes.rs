// Built-in widget kinds that need no API key: the PC itself, its security and
// network, the weather (Open-Meteo, free and keyless) and domain expiry (RDAP,
// with a WHOIS fallback for the registries that have no RDAP). The calendar
// lives in calendar.rs.
//
//   system    disk, memory, battery, uptime, a pending restart — Win32 only
//   security  antivirus (Security Center), signatures, firewall — one PowerShell
//             call, every 30 min by default
//   network   local and public IP, Wi-Fi, VPN, latency to 1.1.1.1
//   weather   current weather and rain in the next hours for a city
//   domain    days left on one or more domains
//
// Every probe returns a WidgetResult like the others, so the island shows them
// as pills and warns on a change from ok to warn/error.

use std::collections::HashMap;
use std::net::{Ipv4Addr, UdpSocket};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::Value;
use windows::core::HSTRING;

use crate::widgets::{client, days_until, icmp_ms, FieldValue, Widget, WidgetResult};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn field(label: &str, value: impl Into<String>) -> FieldValue {
    FieldValue { label: label.to_string(), value: value.into() }
}

fn gb(bytes: u64) -> String {
    let g = bytes as f64 / 1_073_741_824.0;
    if g >= 100.0 { format!("{g:.0} GB") } else { format!("{g:.1} GB") }
}

fn duration_it(secs: u64) -> String {
    let (d, h, m) = (secs / 86_400, (secs % 86_400) / 3600, (secs % 3600) / 60);
    match (d, h) {
        (0, 0) => format!("{m} min"),
        (0, _) => format!("{h} h {m} min"),
        (1, _) => format!("1 giorno, {h} h"),
        _ => format!("{d} giorni, {h} h"),
    }
}

/// A short PowerShell script, hidden, with a deadline. Stdout or the first error line.
async fn powershell(script: &str, timeout: Duration) -> Result<String, String> {
    let out = tokio::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW)
        .kill_on_drop(true)
        .output();
    match tokio::time::timeout(timeout, out).await {
        Ok(Ok(o)) if o.status.success() => Ok(String::from_utf8_lossy(&o.stdout).trim().to_string()),
        Ok(Ok(o)) => {
            let err = String::from_utf8_lossy(&o.stderr);
            Err(err.lines().find(|l| !l.trim().is_empty()).unwrap_or("errore").trim().to_string())
        }
        Ok(Err(e)) => Err(e.to_string()),
        Err(_) => Err("nessuna risposta".into()),
    }
}

// ── Registry (also used by presence.rs) ───────────────────────────────────────

pub mod reg {
    use windows::core::{HSTRING, PWSTR};
    use windows::Win32::Foundation::ERROR_SUCCESS;
    use windows::Win32::System::Registry::{
        RegCloseKey, RegEnumKeyExW, RegOpenKeyExW, RegQueryValueExW, HKEY, KEY_READ, REG_VALUE_TYPE,
    };

    pub use windows::Win32::System::Registry::{HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE};

    pub struct Key(HKEY);

    impl Key {
        pub fn open(root: HKEY, path: &str) -> Option<Key> {
            let mut k = HKEY::default();
            let r = unsafe { RegOpenKeyExW(root, &HSTRING::from(path), Some(0), KEY_READ, &mut k) };
            (r == ERROR_SUCCESS).then_some(Key(k))
        }

        pub fn exists(root: HKEY, path: &str) -> bool {
            Key::open(root, path).is_some()
        }

        pub fn qword(&self, name: &str) -> Option<u64> {
            let mut buf = [0u8; 8];
            let mut len = 8u32;
            let mut ty = REG_VALUE_TYPE::default();
            let r = unsafe {
                RegQueryValueExW(self.0, &HSTRING::from(name), None, Some(&mut ty), Some(buf.as_mut_ptr()), Some(&mut len))
            };
            (r == ERROR_SUCCESS && len >= 4).then(|| {
                if len >= 8 { u64::from_le_bytes(buf) } else { u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]) as u64 }
            })
        }

        pub fn subkeys(&self) -> Vec<String> {
            let mut out = Vec::new();
            for i in 0..4096u32 {
                let mut name = [0u16; 512];
                let mut len = name.len() as u32;
                let r = unsafe { RegEnumKeyExW(self.0, i, Some(PWSTR(name.as_mut_ptr())), &mut len, None, None, None, None) };
                if r != ERROR_SUCCESS {
                    break;
                }
                out.push(String::from_utf16_lossy(&name[..len as usize]));
            }
            out
        }

        pub fn child(&self, name: &str) -> Option<Key> {
            let mut k = HKEY::default();
            let r = unsafe { RegOpenKeyExW(self.0, &HSTRING::from(name), Some(0), KEY_READ, &mut k) };
            (r == ERROR_SUCCESS).then_some(Key(k))
        }
    }

    impl Drop for Key {
        fn drop(&mut self) {
            unsafe {
                let _ = RegCloseKey(self.0);
            }
        }
    }
}

// ── system ────────────────────────────────────────────────────────────────────

/// True when Windows waits for a restart (updates or servicing).
pub fn restart_pending() -> bool {
    reg::Key::exists(reg::HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired")
        || reg::Key::exists(reg::HKEY_LOCAL_MACHINE, r"SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending")
}

fn system_blocking(w: &Widget) -> WidgetResult {
    use windows::Win32::Storage::FileSystem::GetDiskFreeSpaceExW;
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    use windows::Win32::System::SystemInformation::{GetTickCount64, GlobalMemoryStatusEx, MEMORYSTATUSEX};

    let mut issues: Vec<(u8, String)> = Vec::new(); // (2 = error, 1 = warn, text)
    let mut fields = Vec::new();

    // System drive.
    let drive = std::env::var("SystemDrive").unwrap_or_else(|_| "C:".into());
    let (mut free, mut total) = (0u64, 0u64);
    if unsafe { GetDiskFreeSpaceExW(&HSTRING::from(format!("{drive}\\")), Some(&mut free), Some(&mut total), None) }.is_ok()
        && total > 0
    {
        let pct = free as f64 * 100.0 / total as f64;
        let warn = if w.warn_days > 0 { w.warn_days as f64 } else { 10.0 };
        fields.push(field(&format!("Disco {drive}"), format!("{} liberi su {} ({pct:.0}%)", gb(free), gb(total))));
        if pct < 5.0 {
            issues.push((2, format!("Disco {drive} quasi pieno: {} liberi", gb(free))));
        } else if pct < warn {
            issues.push((1, format!("Poco spazio su {drive}: {} liberi", gb(free))));
        }
    }

    // Memory.
    let mut m = MEMORYSTATUSEX { dwLength: std::mem::size_of::<MEMORYSTATUSEX>() as u32, ..Default::default() };
    if unsafe { GlobalMemoryStatusEx(&mut m) }.is_ok() {
        fields.push(field("Memoria", format!("{}% in uso di {}", m.dwMemoryLoad, gb(m.ullTotalPhys))));
        if m.dwMemoryLoad >= 92 {
            issues.push((1, format!("Memoria quasi esaurita ({}%)", m.dwMemoryLoad)));
        }
    }

    // Battery (128 in BatteryFlag = no battery).
    let mut p = SYSTEM_POWER_STATUS::default();
    if unsafe { GetSystemPowerStatus(&mut p) }.is_ok() && p.BatteryFlag != 128 && p.BatteryLifePercent <= 100 {
        let plugged = p.ACLineStatus == 1;
        fields.push(field("Batteria", format!("{}%{}", p.BatteryLifePercent, if plugged { ", in carica" } else { "" })));
        if !plugged && p.BatteryLifePercent <= 15 {
            issues.push((1, format!("Batteria al {}%", p.BatteryLifePercent)));
        }
    }

    // Uptime and a pending restart.
    let up = unsafe { GetTickCount64() } / 1000;
    fields.push(field("Acceso da", duration_it(up)));
    if restart_pending() {
        fields.push(field("Riavvio", "richiesto da Windows"));
        issues.push((1, "Windows chiede un riavvio".into()));
    }

    let worst = issues.iter().map(|i| i.0).max().unwrap_or(0);
    let level = ["ok", "warn", "error"][worst as usize];
    let summary = issues
        .iter()
        .max_by_key(|i| i.0)
        .map(|i| i.1.clone())
        .unwrap_or_else(|| fields.first().map(|f| format!("Tutto a posto · {}", f.value)).unwrap_or_else(|| "Tutto a posto".into()));
    let mut r = WidgetResult::new(&w.id, level, summary);
    r.fields = fields;
    r
}

pub async fn system(w: &Widget) -> WidgetResult {
    let w2 = w.clone();
    tauri::async_runtime::spawn_blocking(move || system_blocking(&w2))
        .await
        .unwrap_or_else(|_| WidgetResult::new(&w.id, "error", "Controllo interrotto"))
}

// ── security ──────────────────────────────────────────────────────────────────

/// Antivirus from Security Center (works for Defender and third-party products),
/// Defender's signature and scan age when Defender is the one in charge, and
/// how many firewall profiles are off. One JSON line.
const SECURITY_SCRIPT: &str = r#"$ErrorActionPreference='SilentlyContinue'
$av=@(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntivirusProduct | ForEach-Object { @{ name=$_.displayName; state=[int]$_.productState } })
$mp=Get-MpComputerStatus
$fw=@(Get-NetFirewallProfile | Where-Object { -not $_.Enabled }).Count
$fwp=@(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName FirewallProduct | ForEach-Object { @{ name=$_.displayName; state=[int]$_.productState } })
@{ av=$av; rt=$mp.RealTimeProtectionEnabled; sig=$mp.AntivirusSignatureAge; quick=$mp.QuickScanAge; fwOff=$fw; fwp=$fwp; threats=@(Get-MpThreatDetection).Count } | ConvertTo-Json -Compress -Depth 4"#;

pub async fn security(w: &Widget) -> WidgetResult {
    let text = match powershell(SECURITY_SCRIPT, Duration::from_secs(40)).await {
        Ok(t) => t,
        Err(e) => return WidgetResult::new(&w.id, "error", format!("Stato della sicurezza non leggibile: {e}")),
    };
    let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
    let mut issues: Vec<(u8, String)> = Vec::new();
    let mut fields = Vec::new();

    // productState: bits 12–15 = 1 when enabled, bits 4–7 = 0 when up to date.
    let products: Vec<(String, bool, bool)> = v["av"]
        .as_array()
        .map(|a| {
            a.iter()
                .map(|p| {
                    let st = p["state"].as_i64().unwrap_or(0);
                    (p["name"].as_str().unwrap_or("Antivirus").to_string(), (st >> 12) & 0xF == 1, (st >> 4) & 0xF == 0)
                })
                .collect()
        })
        .unwrap_or_default();
    if let Some((name, _, current)) = products.iter().find(|p| p.1) {
        fields.push(field("Antivirus", format!("{name}, attivo")));
        if !current {
            issues.push((1, format!("{name}: definizioni non aggiornate")));
        }
    } else if products.is_empty() {
        fields.push(field("Antivirus", "non rilevato"));
        issues.push((1, "Nessun antivirus rilevato".into()));
    } else {
        fields.push(field("Antivirus", format!("{} disattivato", products[0].0)));
        issues.push((2, "Antivirus disattivato".into()));
    }
    if let Some(sig) = v["sig"].as_i64().filter(|s| *s < 10_000) {
        fields.push(field("Firme Defender", if sig == 0 { "di oggi".into() } else { format!("di {sig} giorni fa") }));
        if sig > 3 {
            issues.push((1, format!("Firme di Defender vecchie di {sig} giorni")));
        }
    }
    if let Some(q) = v["quick"].as_i64().filter(|q| *q < 10_000) {
        fields.push(field("Ultima scansione", if q == 0 { "oggi".into() } else { format!("{q} giorni fa") }));
    }
    if v["rt"] == Value::Bool(false) && products.iter().any(|p| p.0.to_lowercase().contains("defender") && p.1) {
        issues.push((2, "Protezione in tempo reale disattivata".into()));
    }
    // Windows Firewall off is fine when another product registered one that is on.
    let other_fw = v["fwp"].as_array().and_then(|a| {
        a.iter().find(|p| (p["state"].as_i64().unwrap_or(0) >> 12) & 0xF == 1).and_then(|p| p["name"].as_str()).map(str::to_string)
    });
    match (v["fwOff"].as_i64(), other_fw) {
        (_, Some(name)) => fields.push(field("Firewall", format!("{name}, attivo"))),
        (Some(0), None) => fields.push(field("Firewall", "Windows, attivo")),
        (Some(n), None) => {
            fields.push(field("Firewall", format!("Windows: {n} profili disattivati")));
            issues.push((2, "Firewall disattivato".into()));
        }
        (None, None) => {}
    }
    if let Some(t) = v["threats"].as_i64().filter(|t| *t > 0) {
        fields.push(field("Minacce rilevate", t.to_string()));
        issues.push((2, format!("{t} minacce rilevate da Defender")));
    }
    if restart_pending() {
        issues.push((1, "Windows chiede un riavvio".into()));
    }

    let worst = issues.iter().map(|i| i.0).max().unwrap_or(0);
    let summary = issues.iter().max_by_key(|i| i.0).map(|i| i.1.clone()).unwrap_or_else(|| "Protezione attiva".into());
    let mut r = WidgetResult::new(&w.id, ["ok", "warn", "error"][worst as usize], summary);
    r.fields = fields;
    r
}

// ── network ───────────────────────────────────────────────────────────────────

struct Adapter {
    name: String,
    ipv4: Option<Ipv4Addr>,
    wireless: bool,
    vpn: bool,
}

/// Adapters that are up, with their first IPv4 address.
fn adapters() -> Vec<Adapter> {
    use windows::Win32::NetworkManagement::IpHelper::{
        GetAdaptersAddresses, GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_DNS_SERVER, GAA_FLAG_SKIP_MULTICAST,
        IP_ADAPTER_ADDRESSES_LH,
    };
    use windows::Win32::NetworkManagement::Ndis::IfOperStatusUp;
    use windows::Win32::Networking::WinSock::{AF_INET, AF_UNSPEC, SOCKADDR_IN};

    const IF_TYPE_SOFTWARE_LOOPBACK: u32 = 24;
    const IF_TYPE_PPP: u32 = 23;
    const IF_TYPE_IEEE80211: u32 = 71;
    const IF_TYPE_TUNNEL: u32 = 131;

    let flags = GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER;
    let mut size = 16 * 1024u32;
    let mut buf: Vec<u64> = Vec::new();
    for _ in 0..3 {
        buf = vec![0u64; (size as usize).div_ceil(8)];
        let r = unsafe {
            GetAdaptersAddresses(AF_UNSPEC.0 as u32, flags, None, Some(buf.as_mut_ptr().cast()), &mut size)
        };
        if r == 0 {
            break;
        }
        if r != 111 {
            // anything but ERROR_BUFFER_OVERFLOW
            return Vec::new();
        }
    }
    let mut out = Vec::new();
    let mut cur = buf.as_ptr() as *const IP_ADAPTER_ADDRESSES_LH;
    unsafe {
        while !cur.is_null() {
            let a = &*cur;
            cur = a.Next;
            if a.OperStatus != IfOperStatusUp || a.IfType == IF_TYPE_SOFTWARE_LOOPBACK {
                continue;
            }
            let name = a.FriendlyName.to_string().unwrap_or_default();
            let desc = a.Description.to_string().unwrap_or_default();
            let mut ipv4 = None;
            let mut u = a.FirstUnicastAddress;
            while !u.is_null() {
                let sa = (*u).Address.lpSockaddr;
                if !sa.is_null() && (*sa).sa_family == AF_INET {
                    let sin = &*(sa as *const SOCKADDR_IN);
                    ipv4 = Some(Ipv4Addr::from(u32::from_be(sin.sin_addr.S_un.S_addr)));
                    break;
                }
                u = (*u).Next;
            }
            let text = format!("{name} {desc}").to_lowercase();
            let virtual_host = ["vethernet", "virtualbox", "vmware", "hyper-v", "wsl", "docker"].iter().any(|k| text.contains(k));
            let vpn_word = ["vpn", "wireguard", "openvpn", "tap-", "tap ", "fortinet", "forticlient", "anyconnect",
                "globalprotect", "zerotier", "tailscale", "nordlynx", "proton", "sonicwall", "pulse", "checkpoint"]
                .iter()
                .any(|k| text.contains(k));
            // Dial-up style and tunnel adapters are VPNs too, but not Windows' own IPv6 tunnels.
            let tunnel = matches!(a.IfType, IF_TYPE_PPP | IF_TYPE_TUNNEL)
                && !["teredo", "isatap", "6to4", "ip-https"].iter().any(|k| text.contains(k));
            let vpn = !virtual_host && (vpn_word || tunnel);
            out.push(Adapter { name, ipv4, wireless: a.IfType == IF_TYPE_IEEE80211, vpn });
        }
    }
    out
}

/// The IPv4 address the default route leaves from: no packet is sent.
fn primary_ipv4() -> Option<Ipv4Addr> {
    let s = UdpSocket::bind("0.0.0.0:0").ok()?;
    s.connect("1.1.1.1:80").ok()?;
    match s.local_addr().ok()?.ip() {
        std::net::IpAddr::V4(v) if !v.is_unspecified() => Some(v),
        _ => None,
    }
}

static PUBLIC_IP: Mutex<Option<(Instant, String)>> = Mutex::new(None);

/// The public address (api.ipify.org), at most every 15 minutes.
async fn public_ip() -> Option<String> {
    if let Some((at, ip)) = PUBLIC_IP.lock().unwrap().as_ref() {
        if at.elapsed() < Duration::from_secs(900) {
            return Some(ip.clone());
        }
    }
    let ip = client()?.get("https://api.ipify.org").send().await.ok()?.text().await.ok()?;
    let ip = ip.trim().to_string();
    if ip.parse::<std::net::IpAddr>().is_err() {
        return None;
    }
    *PUBLIC_IP.lock().unwrap() = Some((Instant::now(), ip.clone()));
    Some(ip)
}

pub async fn network(w: &Widget) -> WidgetResult {
    let local = tauri::async_runtime::spawn_blocking(|| {
        let list = adapters();
        let primary = primary_ipv4();
        let ssid = if list.iter().any(|a| a.wireless) { crate::profiles::current_ssid() } else { None };
        let latency = icmp_ms(Ipv4Addr::new(1, 1, 1, 1), 1500);
        (list, primary, ssid, latency)
    })
    .await;
    let Ok((list, primary, ssid, latency)) = local else {
        return WidgetResult::new(&w.id, "error", "Controllo interrotto");
    };

    let mut fields = Vec::new();
    let main = primary.and_then(|ip| list.iter().find(|a| a.ipv4 == Some(ip)));
    let net = match (&ssid, main) {
        (Some(s), _) => format!("Wi-Fi {s}"),
        (None, Some(a)) => a.name.clone(),
        _ => "nessuna".into(),
    };
    fields.push(field("Rete", net.clone()));
    if let Some(ip) = primary {
        fields.push(field("IP locale", ip.to_string()));
    }
    let vpns: Vec<&str> = list.iter().filter(|a| a.vpn).map(|a| a.name.as_str()).collect();
    fields.push(field("VPN", if vpns.is_empty() { "nessuna".into() } else { vpns.join(", ") }));

    let Some(ms) = latency else {
        fields.push(field("Internet", "non raggiungibile"));
        let mut r = WidgetResult::new(&w.id, "error", if primary.is_some() { "Internet non raggiungibile" } else { "Nessuna connessione" });
        r.fields = fields;
        return r;
    };
    fields.push(field("Latenza", format!("{ms} ms")));
    if let Some(ip) = public_ip().await {
        fields.insert(2, field("IP pubblico", ip));
    }
    let slow = ms > 150;
    let summary = if !vpns.is_empty() {
        format!("{net} · VPN attiva · {ms} ms")
    } else if slow {
        format!("Connessione lenta: {ms} ms")
    } else {
        format!("{net} · {ms} ms")
    };
    let mut r = WidgetResult::new(&w.id, if slow { "warn" } else { "ok" }, summary);
    r.fields = fields;
    r
}

// ── weather (Open-Meteo) ──────────────────────────────────────────────────────

static PLACES: Mutex<Option<HashMap<String, (f64, f64, String)>>> = Mutex::new(None);

/// Latitude, longitude and the place's own name, looked up once per city.
async fn geocode(city: &str) -> Result<(f64, f64, String), String> {
    let key = city.trim().to_lowercase();
    if let Some(hit) = PLACES.lock().unwrap().as_ref().and_then(|m| m.get(&key).cloned()) {
        return Ok(hit);
    }
    let c = client().ok_or("HTTP non disponibile")?;
    let v: Value = c
        .get("https://geocoding-api.open-meteo.com/v1/search")
        .query(&[("name", city.trim()), ("count", "1"), ("language", "it"), ("format", "json")])
        .send()
        .await
        .map_err(|e| format!("Meteo non raggiungibile: {e}"))?
        .json()
        .await
        .map_err(|_| "Risposta del meteo non valida".to_string())?;
    let r = &v["results"][0];
    let (Some(lat), Some(lon)) = (r["latitude"].as_f64(), r["longitude"].as_f64()) else {
        return Err(format!("Località «{}» non trovata", city.trim()));
    };
    let name = r["name"].as_str().unwrap_or(city).to_string();
    PLACES.lock().unwrap().get_or_insert_with(HashMap::new).insert(key, (lat, lon, name.clone()));
    Ok((lat, lon, name))
}

/// WMO weather code → Italian.
fn weather_text(code: i64) -> &'static str {
    match code {
        0 => "sereno",
        1 => "poco nuvoloso",
        2 => "parzialmente nuvoloso",
        3 => "coperto",
        45 | 48 => "nebbia",
        51 | 53 | 55 => "pioviggine",
        56 | 57 => "pioviggine gelata",
        61 => "pioggia debole",
        63 => "pioggia",
        65 => "pioggia forte",
        66 | 67 => "pioggia gelata",
        71 | 73 | 75 | 77 => "neve",
        80 | 81 => "rovesci",
        82 => "rovesci forti",
        85 | 86 => "rovesci di neve",
        95 => "temporale",
        96 | 99 => "temporale con grandine",
        _ => "—",
    }
}

pub async fn weather(w: &Widget) -> WidgetResult {
    let city = w.host.trim();
    if city.is_empty() {
        return WidgetResult::new(&w.id, "error", "Scrivi la città in Impostazioni → Integrazioni → Meteo");
    }
    let (lat, lon, place) = match geocode(city).await {
        Ok(p) => p,
        Err(e) => return WidgetResult::new(&w.id, "error", e),
    };
    let Some(c) = client() else { return WidgetResult::new(&w.id, "error", "HTTP non disponibile") };
    let v: Value = match c
        .get("https://api.open-meteo.com/v1/forecast")
        .query(&[
            ("latitude", lat.to_string()),
            ("longitude", lon.to_string()),
            ("current", "temperature_2m,apparent_temperature,weather_code,wind_speed_10m".into()),
            ("hourly", "precipitation_probability".into()),
            ("forecast_hours", "4".into()),
            ("timezone", "auto".into()),
        ])
        .send()
        .await
    {
        Ok(r) => match r.json().await {
            Ok(v) => v,
            Err(_) => return WidgetResult::new(&w.id, "error", "Risposta del meteo non valida"),
        },
        Err(e) => return WidgetResult::new(&w.id, "error", format!("Meteo non raggiungibile: {e}")),
    };
    let cur = &v["current"];
    let temp = cur["temperature_2m"].as_f64();
    let feels = cur["apparent_temperature"].as_f64();
    let wind = cur["wind_speed_10m"].as_f64();
    let sky = weather_text(cur["weather_code"].as_i64().unwrap_or(-1));
    let rain = v["hourly"]["precipitation_probability"]
        .as_array()
        .map(|a| a.iter().filter_map(|x| x.as_i64()).max().unwrap_or(0))
        .unwrap_or(0);

    let t = temp.map(|t| format!("{t:.0}°")).unwrap_or_else(|| "—".into());
    let mut fields = vec![field("Cielo", sky)];
    if let Some(f) = feels {
        fields.push(field("Percepita", format!("{f:.0}°")));
    }
    fields.push(field("Pioggia (prossime 3 ore)", format!("{rain}%")));
    if let Some(wv) = wind {
        fields.push(field("Vento", format!("{wv:.0} km/h")));
    }
    // A warning only when rain is likely soon: that is the useful bit ("prendi l'ombrello").
    let soon = rain >= 60;
    let summary = if soon {
        format!("{place}: {t}, pioggia probabile a breve ({rain}%)")
    } else {
        format!("{place}: {t}, {sky}")
    };
    let mut r = WidgetResult::new(&w.id, if soon { "warn" } else { "ok" }, summary);
    r.fields = fields;
    r
}

// ── domain expiry (RDAP, WHOIS fallback) ──────────────────────────────────────

/// Registries without RDAP that answer on WHOIS with an expiry line.
fn whois_server(tld: &str) -> Option<&'static str> {
    Some(match tld {
        "it" => "whois.nic.it",
        "eu" => "whois.eu",
        "ch" | "li" => "whois.nic.ch",
        "de" => "whois.denic.de",
        "fr" => "whois.nic.fr",
        "uk" => "whois.nic.uk",
        "es" => "whois.nic.es",
        _ => return None,
    })
}

async fn rdap_expiry(domain: &str) -> Option<String> {
    let v: Value = client()?
        .get(format!("https://rdap.org/domain/{domain}"))
        .header("Accept", "application/rdap+json")
        .send()
        .await
        .ok()?
        .json()
        .await
        .ok()?;
    v["events"].as_array()?.iter().find_map(|e| {
        (e["eventAction"].as_str()? == "expiration").then(|| e["eventDate"].as_str().map(str::to_string)).flatten()
    })
}

async fn whois_expiry(domain: &str) -> Option<String> {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    let tld = domain.rsplit('.').next()?.to_lowercase();
    let server = whois_server(&tld)?;
    let fut = async {
        let mut s = tokio::net::TcpStream::connect((server, 43)).await.ok()?;
        s.write_all(format!("{domain}\r\n").as_bytes()).await.ok()?;
        let mut buf = Vec::new();
        s.read_to_end(&mut buf).await.ok()?;
        Some(String::from_utf8_lossy(&buf).to_string())
    };
    let text = tokio::time::timeout(Duration::from_secs(10), fut).await.ok()??;
    text.lines().find_map(|l| {
        let low = l.to_lowercase();
        let key = ["expire date:", "expiry date:", "expiration date:", "registry expiry date:", "paid-till:", "renewal date:"]
            .iter()
            .find(|k| low.trim_start().starts_with(*k))?;
        let value = l.trim_start()[key.len()..].trim();
        // Normalise "2026-11-03 00:00:00" / "2026-11-03T…" to the date.
        let date = value.get(..10)?;
        (date.as_bytes()[4] == b'-').then(|| format!("{date}T00:00:00Z"))
    })
}

pub async fn domain(w: &Widget) -> WidgetResult {
    let names: Vec<String> = w
        .host
        .split(|c: char| c == ',' || c == ';' || c.is_whitespace())
        .map(|d| d.trim().trim_start_matches("https://").trim_start_matches("http://").trim_start_matches("www.").trim_end_matches('/').to_lowercase())
        .filter(|d| d.contains('.'))
        .collect();
    if names.is_empty() {
        return WidgetResult::new(&w.id, "error", "Scrivi uno o più domini nelle impostazioni del widget");
    }
    let warn = if w.warn_days <= 0 { 30 } else { w.warn_days };
    let mut fields = Vec::new();
    let mut soonest: Option<(i64, String)> = None;
    let mut unreadable = 0;
    for d in names.iter().take(10) {
        let expiry = match rdap_expiry(d).await {
            Some(e) => Some(e),
            None => whois_expiry(d).await,
        };
        match expiry.as_deref().and_then(days_until) {
            Some(days) => {
                let date = expiry.as_deref().and_then(|e| e.get(..10)).unwrap_or("").to_string();
                fields.push(field(d, if days < 0 { format!("scaduto il {date}") } else { format!("{days} giorni ({date})") }));
                if soonest.as_ref().is_none_or(|s| days < s.0) {
                    soonest = Some((days, d.clone()));
                }
            }
            None => {
                unreadable += 1;
                fields.push(field(d, "scadenza non leggibile"));
            }
        }
    }
    let Some((days, name)) = soonest else {
        let mut r = WidgetResult::new(&w.id, "error", "Scadenza dei domini non leggibile");
        r.fields = fields;
        return r;
    };
    let level = if days <= 7 { "error" } else if days <= warn || unreadable > 0 { "warn" } else { "ok" };
    let summary = if days < 0 {
        format!("{name} è scaduto")
    } else if names.len() == 1 {
        format!("{name}: scade tra {days} giorni")
    } else {
        format!("Il primo a scadere: {name}, tra {days} giorni")
    };
    let mut r = WidgetResult::new(&w.id, level, summary);
    r.fields = fields;
    r
}

// ── "Copia info PC" ───────────────────────────────────────────────────────────

/// Everything a ticket usually asks for, as plain text.
const PC_INFO_SCRIPT: &str = r#"$ErrorActionPreference='SilentlyContinue'
$os=Get-CimInstance Win32_OperatingSystem; $cs=Get-CimInstance Win32_ComputerSystem; $bios=Get-CimInstance Win32_BIOS; $cpu=(Get-CimInstance Win32_Processor | Select-Object -First 1).Name
$cv=Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$ips=(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { "$($_.IPAddress) ($($_.InterfaceAlias))" }) -join ', '
$macs=(Get-NetAdapter | Where-Object Status -eq 'Up' | ForEach-Object { "$($_.MacAddress) ($($_.Name))" }) -join ', '
"Computer: $env:COMPUTERNAME"
"Utente: $env:USERDOMAIN\$env:USERNAME"
"Dominio/gruppo: $($cs.Domain)"
"Sistema: $($os.Caption) $($cv.DisplayVersion) (build $($cv.CurrentBuild).$($cv.UBR))"
"Modello: $($cs.Manufacturer) $($cs.Model)"
"Numero di serie: $($bios.SerialNumber)"
"Processore: $cpu"
"Memoria: $([math]::Round($cs.TotalPhysicalMemory/1GB)) GB"
"IP: $ips"
"MAC: $macs"
"Ultimo avvio: $($os.LastBootUpTime)""#;

pub async fn pc_info_text() -> Result<String, String> {
    powershell(PC_INFO_SCRIPT, Duration::from_secs(30)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn readable_sizes_and_durations() {
        assert_eq!(gb(500 * 1_073_741_824), "500 GB");
        assert_eq!(gb(1_610_612_736), "1.5 GB");
        assert_eq!(duration_it(59 * 60), "59 min");
        assert_eq!(duration_it(3 * 3600 + 120), "3 h 2 min");
        assert_eq!(duration_it(86_400 + 3600), "1 giorno, 1 h");
        assert_eq!(duration_it(5 * 86_400), "5 giorni, 0 h");
    }

    #[test]
    fn weather_codes_are_italian() {
        assert_eq!(weather_text(0), "sereno");
        assert_eq!(weather_text(63), "pioggia");
        assert_eq!(weather_text(95), "temporale");
    }

    #[test]
    fn whois_only_for_known_registries() {
        assert_eq!(whois_server("it"), Some("whois.nic.it"));
        assert_eq!(whois_server("com"), None);
    }
}

/// Real checks on this PC and the network: `cargo test -p easyisland --lib live_ -- --ignored --nocapture`.
#[cfg(test)]
mod live {
    use super::*;

    fn widget(kind: &str, host: &str) -> Widget {
        serde_json::from_value(serde_json::json!({ "id": "live", "kind": kind, "host": host })).unwrap()
    }

    fn show(r: &WidgetResult) {
        println!("[{}] {}", r.level, r.summary);
        for f in &r.fields {
            println!("    {}: {}", f.label, f.value);
        }
    }

    #[test]
    #[ignore]
    fn live_probes() {
        tauri::async_runtime::block_on(async {
            for (kind, host) in [("system", ""), ("security", ""), ("network", ""), ("weather", "Milano"), ("domain", "google.it, wikipedia.org")] {
                println!("── {kind}");
                let w = widget(kind, host);
                let r = match kind {
                    "system" => system(&w).await,
                    "security" => security(&w).await,
                    "network" => network(&w).await,
                    "weather" => weather(&w).await,
                    _ => domain(&w).await,
                };
                show(&r);
            }
            println!("── pc info\n{}", pc_info_text().await.unwrap_or_else(|e| e));
        });
    }
}
