// "Server di sviluppo partito": a port that starts listening on this PC, from a
// development program (node, python, deno…), and answers HTTP → the island
// offers «Apri nel browser» (moments.rs).
//
// Windows has no event for a new listening socket, so the TCP table is read
// every few seconds (GetExtendedTcpTable, a few microseconds). The first read
// is the baseline: servers already running when EasyIsland starts are not new.
// The same table answers "who holds port 3000?" for a copied EADDRINUSE.

use std::collections::{HashMap, HashSet};
use std::io::{Read, Write};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, TcpStream};
use std::time::{Duration, Instant};

use serde_json::json;
use tauri::AppHandle;
use windows::Win32::Foundation::CloseHandle;
use windows::Win32::NetworkManagement::IpHelper::{
    GetExtendedTcpTable, MIB_TCP6ROW_OWNER_PID, MIB_TCPROW_OWNER_PID, TCP_TABLE_OWNER_PID_LISTENER,
};
use windows::Win32::Networking::WinSock::{AF_INET, AF_INET6};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};

const EVERY: Duration = Duration::from_secs(3);
/// The same port is not announced again for this long (a server that restarts on every save).
const COOLDOWN: Duration = Duration::from_secs(10 * 60);
/// Programs that run development servers (lower case, without ".exe").
const DEV_PROGRAMS: &[&str] = &[
    "node", "bun", "deno", "python", "python3", "pythonw", "py", "uvicorn", "gunicorn", "flask", "php", "ruby",
    "dotnet", "java", "hugo", "jekyll", "air", "caddy", "http-server", "esbuild", "wrangler", "miniflare",
];

/// One listening socket: where, which port, which process.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct Listener {
    pub addr: IpAddr,
    pub port: u16,
    pub pid: u32,
}

/// The port as Windows stores it: network byte order in the low 16 bits.
fn port_of(raw: u32) -> u16 {
    u16::from_be((raw & 0xFFFF) as u16)
}

/// Rows of one TCP table (IPv4 or IPv6), read with the usual "ask the size, then read" dance.
fn table(family: u32) -> Vec<u8> {
    let mut size = 0u32;
    let mut buf: Vec<u8> = Vec::new();
    for _ in 0..4 {
        let r = unsafe {
            GetExtendedTcpTable(
                if buf.is_empty() { None } else { Some(buf.as_mut_ptr().cast()) },
                &mut size,
                false,
                family,
                TCP_TABLE_OWNER_PID_LISTENER,
                0,
            )
        };
        match r {
            0 if !buf.is_empty() => return buf,
            // ERROR_INSUFFICIENT_BUFFER: the size is in `size` now (plus room for new rows).
            122 | 0 => {
                buf = vec![0u8; size as usize + 1024];
                size = buf.len() as u32;
            }
            _ => return Vec::new(),
        }
    }
    Vec::new()
}

/// Rows of `T` after the u32 count, never past the end of `buf`.
fn rows<T: Copy>(buf: &[u8]) -> Vec<T> {
    let Some(count) = buf.get(..4).map(|b| u32::from_ne_bytes([b[0], b[1], b[2], b[3]]) as usize) else {
        return Vec::new();
    };
    // The rows are 4-byte aligned after the count (both row types hold only u32s and bytes).
    let start = 4;
    let size = std::mem::size_of::<T>();
    let fits = buf.len().saturating_sub(start) / size;
    (0..count.min(fits))
        .map(|i| unsafe { std::ptr::read_unaligned(buf.as_ptr().add(start + i * size).cast::<T>()) })
        .collect()
}

/// Every listening TCP socket on this PC.
pub fn listeners() -> Vec<Listener> {
    let mut out = Vec::new();
    for r in rows::<MIB_TCPROW_OWNER_PID>(&table(AF_INET.0 as u32)) {
        out.push(Listener { addr: IpAddr::V4(Ipv4Addr::from(u32::from_be(r.dwLocalAddr))), port: port_of(r.dwLocalPort), pid: r.dwOwningPid });
    }
    for r in rows::<MIB_TCP6ROW_OWNER_PID>(&table(AF_INET6.0 as u32)) {
        out.push(Listener { addr: IpAddr::V6(Ipv6Addr::from(r.ucLocalAddr)), port: port_of(r.dwLocalPort), pid: r.dwOwningPid });
    }
    out
}

/// "node.exe" for a process id, None when it cannot be read (another user, gone).
pub fn process_name(pid: u32) -> Option<String> {
    if pid == 0 || pid == 4 {
        return Some("System".into());
    }
    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut len = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(process, PROCESS_NAME_WIN32, windows::core::PWSTR(buf.as_mut_ptr()), &mut len);
        let _ = CloseHandle(process);
        ok.ok()?;
        let path = String::from_utf16_lossy(buf.get(..len as usize)?);
        Some(path.rsplit('\\').next().unwrap_or(&path).to_string())
    }
}

/// Who listens on `port` ("Port 3000 is already in use"): process name and id.
pub fn port_owner(port: u16) -> Option<(String, u32)> {
    let l = listeners().into_iter().find(|l| l.port == port)?;
    Some((process_name(l.pid).unwrap_or_else(|| format!("PID {}", l.pid)), l.pid))
}

/// "node.exe" → is it a development program?
fn is_dev_program(name: &str) -> bool {
    let lower = name.to_lowercase();
    let stem = lower.strip_suffix(".exe").unwrap_or(&lower);
    DEV_PROGRAMS.contains(&stem)
}

/// Reachable from this PC's own browser: loopback or every address.
fn is_local(addr: &IpAddr) -> bool {
    addr.is_loopback() || addr.is_unspecified()
}

/// Answers like a web server? A plain GET, the first bytes of the reply.
fn speaks_http(addr: IpAddr, port: u16) -> bool {
    let target = match addr {
        IpAddr::V6(_) => IpAddr::V6(Ipv6Addr::LOCALHOST),
        IpAddr::V4(_) => IpAddr::V4(Ipv4Addr::LOCALHOST),
    };
    let Ok(mut s) = TcpStream::connect_timeout(&SocketAddr::new(target, port), Duration::from_millis(400)) else {
        return false;
    };
    let _ = s.set_read_timeout(Some(Duration::from_millis(1500)));
    let _ = s.set_write_timeout(Some(Duration::from_millis(400)));
    if s.write_all(b"GET / HTTP/1.0\r\nHost: localhost\r\nUser-Agent: EasyIsland\r\n\r\n").is_err() {
        return false;
    }
    let mut head = [0u8; 5];
    let mut got = 0;
    while got < head.len() {
        match s.read(&mut head[got..]) {
            Ok(0) | Err(_) => break,
            Ok(n) => got += n,
        }
    }
    &head[..got] == b"HTTP/"
}

/// The new listeners between two reads that may be announced: local, a port
/// for users (≥ 1024), not just announced, one per port.
fn fresh<'a>(before: &HashSet<Listener>, now: &'a [Listener], recent: &HashMap<u16, Instant>, at: Instant) -> Vec<&'a Listener> {
    let mut seen = HashSet::new();
    now.iter()
        .filter(|l| !before.contains(l) && is_local(&l.addr) && l.port >= 1024)
        .filter(|l| recent.get(&l.port).is_none_or(|t| at.duration_since(*t) >= COOLDOWN))
        .filter(|l| seen.insert(l.port))
        .collect()
}

fn enabled(app: &AppHandle) -> bool {
    use tauri::Manager;
    app.try_state::<crate::Shared>().is_some_and(|s| s.settings.lock().unwrap().moment_servers)
}

pub fn spawn(app: AppHandle) {
    std::thread::spawn(move || {
        let mut before: HashSet<Listener> = listeners().into_iter().collect();
        let mut recent: HashMap<u16, Instant> = HashMap::new();
        loop {
            std::thread::sleep(EVERY);
            // The card in the island, or an automation waiting for a dev server.
            let card = enabled(&app);
            if !card && !crate::automations::wants("server") {
                // Off: the baseline follows along, so turning it on does not announce old servers.
                before = listeners().into_iter().collect();
                continue;
            }
            let now = listeners();
            let at = Instant::now();
            for l in fresh(&before, &now, &recent, at) {
                let Some(name) = process_name(l.pid) else { continue };
                if !is_dev_program(&name) {
                    continue;
                }
                // The server may still be warming up: give it a moment before the probe.
                if !speaks_http(l.addr, l.port) {
                    std::thread::sleep(Duration::from_millis(800));
                    if !speaks_http(l.addr, l.port) {
                        continue;
                    }
                }
                recent.insert(l.port, at);
                crate::log::line(format!("server di sviluppo: {name} sulla porta {}", l.port));
                let url = format!("http://localhost:{}/", l.port);
                crate::automations::on_event(
                    "server",
                    &format!("{name} {}", l.port),
                    "",
                    &[("porta", l.port.to_string()), ("link", url.clone()), ("programma", name.clone())],
                );
                if !card {
                    continue;
                }
                crate::moments::emit(&app, json!({
                    "kind": "server",
                    "port": l.port,
                    "url": format!("http://localhost:{}/", l.port),
                    "process": name,
                }));
            }
            recent.retain(|_, t| at.duration_since(*t) < COOLDOWN);
            before = now.into_iter().collect();
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn l(addr: &str, port: u16, pid: u32) -> Listener {
        Listener { addr: addr.parse().unwrap(), port, pid }
    }

    #[test]
    fn only_new_local_user_ports_once() {
        let before: HashSet<Listener> = [l("127.0.0.1", 5173, 10)].into_iter().collect();
        let now = vec![
            l("127.0.0.1", 5173, 10), // already there
            l("::1", 3000, 11),
            l("0.0.0.0", 3000, 11), // same port twice: once
            l("192.168.1.5", 8080, 12), // not reachable as localhost
            l("127.0.0.1", 135, 13), // system port
            l("127.0.0.1", 8000, 14),
        ];
        let at = Instant::now();
        let mut recent = HashMap::new();
        recent.insert(8000, at);
        let got: Vec<u16> = fresh(&before, &now, &recent, at).iter().map(|l| l.port).collect();
        assert_eq!(got, vec![3000]);
    }

    #[test]
    fn dev_programs_and_rows() {
        assert!(is_dev_program("node.exe"));
        assert!(is_dev_program("Python.EXE"));
        assert!(!is_dev_program("Code.exe"));
        assert!(!is_dev_program("svchost.exe"));
        assert_eq!(port_of(0x5014), 0x1450); // 5200 in network order
        // A short or empty buffer never reads past its end.
        assert!(rows::<MIB_TCPROW_OWNER_PID>(&[]).is_empty());
        assert!(rows::<MIB_TCPROW_OWNER_PID>(&[9, 0, 0, 0, 1, 2]).is_empty());
    }

    #[test]
    fn reads_the_table() {
        // Some listener always exists on Windows (RPC on 135 at least).
        assert!(!listeners().is_empty());
    }
}
