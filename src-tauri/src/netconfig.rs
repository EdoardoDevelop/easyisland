// Network settings from the Rete card: an adapter's address (DHCP or manual
// IP, mask, gateway) and DNS servers, and a continuous ping in a terminal.
//
// Changing an adapter needs an administrator: the commands go to `netsh`
// through ShellExecute "runas", so Windows shows its own UAC prompt every
// time and EasyIsland itself never runs elevated. Everything that reaches the
// command line is validated first (adapter index as a number, addresses
// parsed as IPv4), the commands are passed inline (no script file another
// program could swap before the elevated run) and their output is read back
// from a log in the app's folder, for the error shown in the card.
//
// The ping opens a new console (the user's default terminal) with
// `ping -t`: the target is the main adapter's gateway, 8.8.8.8 or what the
// user typed, checked to be an address or a host name.

use std::net::Ipv4Addr;

use serde::{Deserialize, Serialize};

use crate::i18n::{t, tf};
use crate::probes::{self, Adapter};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NetAddress {
    pub ip: String,
    pub prefix: u8,
}

/// One adapter as the form shows it.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NetAdapter {
    pub index: u32,
    pub name: String,
    pub up: bool,
    pub wireless: bool,
    pub virtual_host: bool,
    /// The address comes from DHCP.
    pub dhcp: bool,
    /// No DNS servers typed in Windows (they come from DHCP).
    pub dns_auto: bool,
    pub addresses: Vec<NetAddress>,
    pub gateway: String,
    pub dns: Vec<String>,
    /// The adapter the default route leaves from.
    pub main: bool,
}

fn to_form(a: &Adapter, main_ip: Option<Ipv4Addr>) -> NetAdapter {
    NetAdapter {
        index: a.index,
        name: a.name.clone(),
        up: a.up,
        wireless: a.wireless,
        virtual_host: a.virtual_host,
        dhcp: a.dhcp,
        dns_auto: a.dns_auto,
        addresses: a.ipv4.iter().zip(a.prefixes.iter().chain(std::iter::repeat(&0))).map(|(ip, p)| NetAddress { ip: ip.to_string(), prefix: *p }).collect(),
        gateway: a.gateways.iter().find(|g| g.is_ipv4()).map(|g| g.to_string()).unwrap_or_default(),
        dns: a.dns.iter().filter(|d| d.is_ipv4()).map(|d| d.to_string()).collect(),
        main: main_ip.is_some_and(|ip| a.ipv4.contains(&ip)),
    }
}

/// Island → the adapters that can be set up (Ethernet, Wi-Fi and the virtual
/// ones; not loopback, VPN tunnels or Windows' IPv6 tunnels), the main first.
#[tauri::command]
pub async fn network_adapters() -> Vec<NetAdapter> {
    tauri::async_runtime::spawn_blocking(|| {
        let main = probes::primary_ipv4();
        let mut list: Vec<NetAdapter> = probes::adapters()
            .iter()
            .filter(|a| a.configurable && !a.vpn)
            .map(|a| to_form(a, main))
            .collect();
        list.sort_by_key(|a| (!a.main, !a.up, a.virtual_host, a.name.to_lowercase()));
        list
    })
    .await
    .unwrap_or_default()
}

/// What the form sends.
#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct NetConfig {
    pub index: u32,
    pub dhcp: bool,
    pub ip: String,
    /// "255.255.255.0", "24" or "/24".
    pub mask: String,
    /// Empty: no gateway.
    pub gateway: String,
    pub dns_auto: bool,
    pub dns: Vec<String>,
}

fn ipv4(s: &str, what: &str) -> Result<Ipv4Addr, String> {
    s.trim().parse::<Ipv4Addr>().map_err(|_| tf("{what} non valido: «{v}»", &[("what", &what), ("v", &s.trim())]))
}

/// A mask as dotted quad or prefix length; only contiguous masks from /1 to /32.
pub fn mask_of(s: &str) -> Option<Ipv4Addr> {
    let s = s.trim().trim_start_matches('/');
    let bits: u32 = if let Ok(n) = s.parse::<u8>() {
        if !(1..=32).contains(&n) {
            return None;
        }
        u32::MAX << (32 - n as u32)
    } else {
        let m = u32::from(s.parse::<Ipv4Addr>().ok()?);
        if m == 0 || m.leading_ones() + m.trailing_zeros() != 32 {
            return None;
        }
        m
    };
    Some(Ipv4Addr::from(bits))
}

/// An address an adapter may take: not 0.0.0.0, loopback, multicast or broadcast.
fn host_address(ip: Ipv4Addr) -> bool {
    !(ip.is_unspecified() || ip.is_loopback() || ip.is_multicast() || ip.is_broadcast())
}

/// The `netsh` commands for `cfg`, validated. Pure, so it is tested.
pub fn commands(cfg: &NetConfig) -> Result<Vec<String>, String> {
    if cfg.index == 0 {
        return Err(t("Scegli una scheda di rete").into());
    }
    let name = format!("name={}", cfg.index);
    let mut out = Vec::new();
    if cfg.dhcp {
        out.push(format!("netsh interface ipv4 set address {name} source=dhcp"));
    } else {
        let ip = ipv4(&cfg.ip, t("Indirizzo IP"))?;
        if !host_address(ip) {
            return Err(tf("{what} non valido: «{v}»", &[("what", &t("Indirizzo IP")), ("v", &ip.to_string())]));
        }
        let mask = mask_of(&cfg.mask).ok_or_else(|| tf("Maschera non valida: «{v}»", &[("v", &cfg.mask.trim())]))?;
        let gateway = if cfg.gateway.trim().is_empty() {
            "none".to_string()
        } else {
            let g = ipv4(&cfg.gateway, "Gateway")?;
            let m = u32::from(mask);
            if u32::from(g) & m != u32::from(ip) & m || g == ip {
                return Err(t("Il gateway non è nella rete dell'indirizzo IP").into());
            }
            g.to_string()
        };
        out.push(format!("netsh interface ipv4 set address {name} source=static address={ip} mask={mask} gateway={gateway}"));
    }
    let dns: Vec<Ipv4Addr> = cfg
        .dns
        .iter()
        .filter(|d| !d.trim().is_empty())
        .map(|d| ipv4(d, "DNS"))
        .collect::<Result<_, _>>()?;
    if cfg.dns_auto {
        if !cfg.dhcp {
            return Err(t("Con l'indirizzo manuale anche i DNS vanno scritti").into());
        }
        out.push(format!("netsh interface ipv4 set dnsservers {name} source=dhcp"));
    } else {
        let Some(first) = dns.first() else {
            return Err(t("Scrivi almeno un server DNS").into());
        };
        out.push(format!("netsh interface ipv4 set dnsservers {name} source=static address={first} register=primary validate=no"));
        for (i, d) in dns.iter().enumerate().skip(1).take(3) {
            out.push(format!("netsh interface ipv4 add dnsservers {name} address={d} index={} validate=no", i + 1));
        }
    }
    Ok(out)
}

/// Island → "Applica": runs the commands as administrator (UAC prompt).
#[tauri::command]
pub async fn network_apply(config: NetConfig) -> Result<(), String> {
    let lines = commands(&config)?;
    let log = crate::settings::local_dir().join("netconfig.log");
    let _ = std::fs::remove_file(&log);
    let result = tauri::async_runtime::spawn_blocking({
        let log = log.clone();
        move || run_elevated(&lines, &log, "netsh")
    })
    .await
    .map_err(|e| e.to_string())?;
    crate::log::line(match &result {
        Ok(()) => format!("rete: scheda {} impostata", config.index),
        Err(e) => format!("rete: impostazione della scheda {} non riuscita: {e}", config.index),
    });
    result
}

#[cfg(windows)]
pub(crate) fn run_elevated(lines: &[String], log: &std::path::Path, what: &str) -> Result<(), String> {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::Foundation::{CloseHandle, WAIT_OBJECT_0};
    use windows::Win32::System::Threading::{GetExitCodeProcess, WaitForSingleObject};
    use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_NOASYNC, SEE_MASK_NOCLOSEPROCESS, SHELLEXECUTEINFOW};
    use windows::Win32::UI::WindowsAndMessaging::SW_HIDE;

    // ( a && b && c ) > "log" 2>&1 — stops at the first command that fails.
    let params = format!("/d /c ({}) > \"{}\" 2>&1", lines.join(" && "), log.display());
    let file = HSTRING::from("cmd.exe");
    let params = HSTRING::from(params);
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOCLOSEPROCESS | SEE_MASK_NOASYNC,
        lpVerb: windows::core::w!("runas"),
        lpFile: PCWSTR(file.as_ptr()),
        lpParameters: PCWSTR(params.as_ptr()),
        nShow: SW_HIDE.0,
        ..Default::default()
    };
    if let Err(e) = unsafe { ShellExecuteExW(&mut info) } {
        // ERROR_CANCELLED: "No" on the UAC prompt.
        return Err(if e.code().0 as u32 == 0x8007_04C7 {
            t("Annullato: Windows non ha avuto il permesso di amministratore").into()
        } else {
            tf("Non riesco a chiedere i permessi di amministratore: {e}", &[("e", &e.message())])
        });
    }
    if info.hProcess.is_invalid() {
        return Err(t("Comando non avviato").into());
    }
    let waited = unsafe { WaitForSingleObject(info.hProcess, 60_000) };
    let mut code = 1u32;
    unsafe {
        let _ = GetExitCodeProcess(info.hProcess, &mut code);
        let _ = CloseHandle(info.hProcess);
    }
    if waited != WAIT_OBJECT_0 {
        return Err(tf("{w} non ha risposto entro un minuto", &[("w", &what)]));
    }
    if code == 0 {
        return Ok(());
    }
    // netsh writes in the console's code page: accents may come out wrong.
    let out = std::fs::read(log).map(|b| String::from_utf8_lossy(&b).into_owned()).unwrap_or_default();
    let reason = out.lines().map(str::trim).filter(|l| !l.is_empty()).last().unwrap_or("").to_string();
    Err(if reason.is_empty() { tf("{w} è uscito con il codice {c}", &[("w", &what), ("c", &code)]) } else { reason })
}

#[cfg(not(windows))]
pub(crate) fn run_elevated(_: &[String], _: &std::path::Path, _: &str) -> Result<(), String> {
    Err("Windows only".into())
}

/// An address or a host name, safe on a command line.
fn ping_target(s: &str) -> Option<String> {
    let s = s.trim();
    if s.parse::<std::net::IpAddr>().is_ok() {
        return Some(s.to_string());
    }
    let ok = !s.is_empty()
        && s.len() <= 253
        && !s.starts_with(['-', '.'])
        && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.');
    ok.then(|| s.to_string())
}

/// The main adapter's IPv4 gateway.
fn main_gateway() -> Option<String> {
    let main = probes::primary_ipv4()?;
    probes::adapters()
        .into_iter()
        .find(|a| a.ipv4.contains(&main))?
        .gateways
        .into_iter()
        .find(|g| g.is_ipv4())
        .map(|g| g.to_string())
}

/// Island → "Ping continuo": a new terminal with `ping -t`. `target` is an
/// address, a host name or "gateway". Returns the address pinged.
#[tauri::command]
pub async fn network_ping(target: String) -> Result<String, String> {
    let address = if target.trim() == "gateway" {
        tauri::async_runtime::spawn_blocking(main_gateway)
            .await
            .ok()
            .flatten()
            .ok_or_else(|| t("Nessun gateway sulla scheda principale").to_string())?
    } else {
        ping_target(&target).ok_or_else(|| tf("Indirizzo non valido: «{v}»", &[("v", &target.trim())]))?
    };
    open_ping(&address)?;
    Ok(address)
}

#[cfg(windows)]
fn open_ping(address: &str) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    const CREATE_NEW_CONSOLE: u32 = 0x0000_0010;
    // `address` is validated: letters, digits, dots, dashes and colons only.
    std::process::Command::new("cmd.exe")
        .args(["/k", "title", "Ping", address, "&", "ping", "-t", address])
        .creation_flags(CREATE_NEW_CONSOLE)
        .spawn()
        .map(|_| ())
        .map_err(|e| tf("Non riesco ad aprire il terminale: {e}", &[("e", &e)]))
}

#[cfg(not(windows))]
fn open_ping(_: &str) -> Result<(), String> {
    Err("Windows only".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg(dhcp: bool, ip: &str, mask: &str, gw: &str, dns_auto: bool, dns: &[&str]) -> NetConfig {
        NetConfig {
            index: 12,
            dhcp,
            ip: ip.into(),
            mask: mask.into(),
            gateway: gw.into(),
            dns_auto,
            dns: dns.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn masks() {
        assert_eq!(mask_of("24"), Some(Ipv4Addr::new(255, 255, 255, 0)));
        assert_eq!(mask_of("/16"), Some(Ipv4Addr::new(255, 255, 0, 0)));
        assert_eq!(mask_of("255.255.255.128"), Some(Ipv4Addr::new(255, 255, 255, 128)));
        assert_eq!(mask_of("255.0.255.0"), None);
        assert_eq!(mask_of("0"), None);
        assert_eq!(mask_of("33"), None);
        assert_eq!(mask_of("abc"), None);
    }

    #[test]
    fn dhcp_everything() {
        assert_eq!(
            commands(&cfg(true, "", "", "", true, &[])).unwrap(),
            [
                "netsh interface ipv4 set address name=12 source=dhcp",
                "netsh interface ipv4 set dnsservers name=12 source=dhcp",
            ]
        );
    }

    #[test]
    fn static_address_and_dns() {
        assert_eq!(
            commands(&cfg(false, "192.168.1.50", "24", "192.168.1.1", false, &["8.8.8.8", " 1.1.1.1 ", ""])).unwrap(),
            [
                "netsh interface ipv4 set address name=12 source=static address=192.168.1.50 mask=255.255.255.0 gateway=192.168.1.1",
                "netsh interface ipv4 set dnsservers name=12 source=static address=8.8.8.8 register=primary validate=no",
                "netsh interface ipv4 add dnsservers name=12 address=1.1.1.1 index=2 validate=no",
            ]
        );
        assert!(commands(&cfg(false, "10.0.0.5", "255.255.255.0", "", false, &["10.0.0.1"])).unwrap()[0].ends_with("gateway=none"));
    }

    #[test]
    fn refuses_what_netsh_would_get_wrong() {
        // Anything that is not an address never reaches the command line.
        assert!(commands(&cfg(false, "192.168.1.50 & calc", "24", "", false, &["8.8.8.8"])).is_err());
        assert!(commands(&cfg(false, "192.168.1.50", "24", "10.0.0.1", false, &["8.8.8.8"])).is_err());
        assert!(commands(&cfg(false, "192.168.1.50", "24", "", true, &[])).is_err());
        assert!(commands(&cfg(false, "0.0.0.0", "24", "", false, &["8.8.8.8"])).is_err());
        assert!(commands(&cfg(true, "", "", "", false, &[])).is_err());
        assert!(commands(&cfg(true, "", "", "", false, &["8.8.8.8;x"])).is_err());
        assert!(commands(&NetConfig { index: 0, dhcp: true, dns_auto: true, ..Default::default() }).is_err());
    }

    #[test]
    fn ping_targets() {
        assert_eq!(ping_target(" 8.8.8.8 ").as_deref(), Some("8.8.8.8"));
        assert_eq!(ping_target("fe80::1").as_deref(), Some("fe80::1"));
        assert_eq!(ping_target("server-01.example.com").as_deref(), Some("server-01.example.com"));
        assert_eq!(ping_target("8.8.8.8 & del x"), None);
        assert_eq!(ping_target("-n 5 x"), None);
        assert_eq!(ping_target(""), None);
    }
}
