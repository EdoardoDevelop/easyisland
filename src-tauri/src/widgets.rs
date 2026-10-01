// Configurable widgets: probes the user sets up in the settings window, no code.
//
//   ping     ICMP echo (IcmpSendEcho — no admin rights, no `ping.exe`)
//   tcp      a TCP connection to host:port (RDP 3389, SSH 22, a NAS, a printer…)
//   http     a URL answers with the expected status
//   tls      days left on a site's certificate (read by a tiny PowerShell call,
//            run rarely: every 6 h by default)
//   service  a local Windows service is running (Service Control Manager)
//   json     any JSON API: fields picked by path, an alert rule on one of them
//
// One scheduler task wakes every few seconds, runs whatever is due, and sends
// `widget-update` to the island. Nothing runs while Coucou is paused, and on
// battery every interval is tripled.

use std::collections::HashMap;
use std::net::ToSocketAddrs;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager};

use crate::island::WINDOW_LABEL;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const TICK: Duration = Duration::from_secs(5);
const IDLE_TICK: Duration = Duration::from_secs(30);

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Widget {
    pub id: String,
    /// Shown by the island; the backend only needs it in logs.
    #[serde(default)]
    #[allow(dead_code)]
    pub name: String,
    pub kind: String,
    /// Seconds between checks; 0 = the kind's default.
    #[serde(default)]
    pub every: u64,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub method: String,
    #[serde(default)]
    pub headers: Vec<Header>,
    #[serde(default)]
    pub fields: Vec<Field>,
    #[serde(default)]
    pub alert: Option<Alert>,
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub port: u16,
    #[serde(default)]
    pub expect_status: u16,
    #[serde(default)]
    pub warn_days: i64,
    #[serde(default)]
    pub service: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Header {
    pub name: String,
    #[serde(default)]
    pub value: String,
    /// The value lives in the Credential Manager as `widget:<id>:<name>`.
    #[serde(default)]
    pub secret: bool,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Field {
    pub label: String,
    pub path: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Alert {
    pub path: String,
    /// == != < > <= >= contains missing
    pub op: String,
    #[serde(default)]
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct FieldValue {
    pub label: String,
    pub value: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetResult {
    pub id: String,
    /// "ok" | "warn" | "error"
    pub level: String,
    pub summary: String,
    pub fields: Vec<FieldValue>,
    /// Unix seconds.
    pub at: u64,
}

impl WidgetResult {
    fn new(id: &str, level: &str, summary: impl Into<String>) -> Self {
        Self {
            id: id.to_string(),
            level: level.to_string(),
            summary: summary.into(),
            fields: Vec::new(),
            at: SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
        }
    }
}

fn default_every(kind: &str) -> u64 {
    match kind {
        "tls" => 6 * 3600,
        "json" => 120,
        _ => 60,
    }
}

fn min_every(kind: &str) -> u64 {
    match kind {
        "tls" => 3600,
        _ => 15,
    }
}

pub fn interval(w: &Widget) -> Duration {
    let every = if w.every == 0 { default_every(&w.kind) } else { w.every };
    Duration::from_secs(every.max(min_every(&w.kind)))
}

pub fn secret_key(widget_id: &str, header: &str) -> String {
    format!("widget:{widget_id}:{header}")
}

fn on_battery() -> bool {
    use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};
    let mut s = SYSTEM_POWER_STATUS::default();
    unsafe { GetSystemPowerStatus(&mut s).is_ok() && s.ACLineStatus == 0 }
}

// ── Probes ────────────────────────────────────────────────────────────────────

pub async fn probe(w: &Widget) -> WidgetResult {
    match w.kind.as_str() {
        "ping" => {
            let (host, id) = (w.host.clone(), w.id.clone());
            tauri::async_runtime::spawn_blocking(move || ping(&id, &host))
                .await
                .unwrap_or_else(|_| WidgetResult::new(&w.id, "error", "Controllo interrotto"))
        }
        "tcp" => tcp(w).await,
        "http" => http(w).await,
        "tls" => tls(w).await,
        "service" => {
            let (svc, id) = (w.service.clone(), w.id.clone());
            tauri::async_runtime::spawn_blocking(move || service(&id, &svc))
                .await
                .unwrap_or_else(|_| WidgetResult::new(&w.id, "error", "Controllo interrotto"))
        }
        "json" => json_api(w).await,
        other => WidgetResult::new(&w.id, "error", format!("Tipo di widget sconosciuto: {other}")),
    }
}

fn ipv4_of(host: &str) -> Option<std::net::Ipv4Addr> {
    (host.trim(), 0).to_socket_addrs().ok()?.find_map(|a| match a.ip() {
        std::net::IpAddr::V4(v4) => Some(v4),
        _ => None,
    })
}

fn ping(id: &str, host: &str) -> WidgetResult {
    use windows::Win32::NetworkManagement::IpHelper::{
        IcmpCloseHandle, IcmpCreateFile, IcmpSendEcho, ICMP_ECHO_REPLY,
    };
    let Some(ip) = ipv4_of(host) else {
        return WidgetResult::new(id, "error", format!("{host}: nome non risolto"));
    };
    unsafe {
        let Ok(handle) = IcmpCreateFile() else {
            return WidgetResult::new(id, "error", "Ping non disponibile");
        };
        let data = *b"coucou";
        let mut reply = vec![0u8; std::mem::size_of::<ICMP_ECHO_REPLY>() + data.len() + 8];
        let n = IcmpSendEcho(
            handle,
            u32::from_ne_bytes(ip.octets()),
            data.as_ptr().cast(),
            data.len() as u16,
            None,
            reply.as_mut_ptr().cast(),
            reply.len() as u32,
            2000,
        );
        let _ = IcmpCloseHandle(handle);
        if n == 0 {
            return WidgetResult::new(id, "error", format!("{host} non risponde"));
        }
        let r = std::ptr::read_unaligned(reply.as_ptr().cast::<ICMP_ECHO_REPLY>());
        if r.Status != 0 {
            return WidgetResult::new(id, "error", format!("{host} non raggiungibile"));
        }
        let mut res = WidgetResult::new(id, "ok", format!("{host} risponde in {} ms", r.RoundTripTime));
        res.fields.push(FieldValue { label: "Indirizzo".into(), value: ip.to_string() });
        res.fields.push(FieldValue { label: "Tempo".into(), value: format!("{} ms", r.RoundTripTime) });
        res
    }
}

async fn tcp(w: &Widget) -> WidgetResult {
    let addr = format!("{}:{}", w.host.trim(), w.port);
    let start = Instant::now();
    match tokio::time::timeout(Duration::from_secs(4), tokio::net::TcpStream::connect(&addr)).await {
        Ok(Ok(_)) => WidgetResult::new(
            &w.id,
            "ok",
            format!("{addr} aperta ({} ms)", start.elapsed().as_millis()),
        ),
        Ok(Err(e)) => WidgetResult::new(&w.id, "error", format!("{addr} chiusa: {e}")),
        Err(_) => WidgetResult::new(&w.id, "error", format!("{addr} non risponde")),
    }
}

fn client() -> Option<reqwest::Client> {
    reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("Coucou")
        .build()
        .ok()
}

fn valid_url(url: &str) -> bool {
    url.starts_with("https://") || url.starts_with("http://")
}

async fn http(w: &Widget) -> WidgetResult {
    if !valid_url(&w.url) {
        return WidgetResult::new(&w.id, "error", "Indirizzo non valido (serve http:// o https://)");
    }
    let Some(client) = client() else { return WidgetResult::new(&w.id, "error", "HTTP non disponibile") };
    let start = Instant::now();
    match client.get(&w.url).send().await {
        Ok(resp) => {
            let code = resp.status().as_u16();
            let ms = start.elapsed().as_millis();
            let ok = if w.expect_status == 0 { (200..400).contains(&code) } else { code == w.expect_status };
            let mut r = WidgetResult::new(
                &w.id,
                if ok { "ok" } else { "error" },
                format!("HTTP {code} in {ms} ms"),
            );
            r.fields.push(FieldValue { label: "Stato".into(), value: code.to_string() });
            r.fields.push(FieldValue { label: "Tempo".into(), value: format!("{ms} ms") });
            r
        }
        Err(e) => {
            let why = if e.is_timeout() { "tempo scaduto".to_string() } else { e.to_string() };
            WidgetResult::new(&w.id, "error", format!("Non risponde: {why}"))
        }
    }
}

/// Days left on the certificate. Host and port go in through environment
/// variables, never into the script text.
async fn tls(w: &Widget) -> WidgetResult {
    const SCRIPT: &str = "$ErrorActionPreference='Stop';\
        $c=New-Object Net.Sockets.TcpClient($env:COUCOU_HOST,[int]$env:COUCOU_PORT);\
        $cb=[Net.Security.RemoteCertificateValidationCallback]{param($a,$b,$c2,$d) $true};\
        $s=New-Object Net.Security.SslStream($c.GetStream(),$false,$cb);\
        $s.AuthenticateAsClient($env:COUCOU_HOST);\
        $x=New-Object Security.Cryptography.X509Certificates.X509Certificate2($s.RemoteCertificate);\
        $x.NotAfter.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')+'|'+$x.GetNameInfo('SimpleName',$true);\
        $s.Dispose();$c.Dispose()";
    let host = w.host.trim().trim_start_matches("https://").trim_end_matches('/').to_string();
    let port = if w.port == 0 { 443 } else { w.port };
    let out = tokio::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", SCRIPT])
        .env("COUCOU_HOST", &host)
        .env("COUCOU_PORT", port.to_string())
        .creation_flags(CREATE_NO_WINDOW)
        .kill_on_drop(true)
        .output();
    let out = match tokio::time::timeout(Duration::from_secs(20), out).await {
        Ok(Ok(o)) if o.status.success() => o,
        Ok(Ok(o)) => {
            let err = String::from_utf8_lossy(&o.stderr);
            let line = err.lines().find(|l| !l.trim().is_empty()).unwrap_or("errore").trim().to_string();
            return WidgetResult::new(&w.id, "error", format!("{host}: {line}"));
        }
        _ => return WidgetResult::new(&w.id, "error", format!("{host}: nessuna risposta")),
    };
    let text = String::from_utf8_lossy(&out.stdout).trim().to_string();
    let (expiry, issuer) = text.split_once('|').unwrap_or((text.as_str(), ""));
    let Some(days) = days_until(expiry) else {
        return WidgetResult::new(&w.id, "error", format!("{host}: scadenza non leggibile"));
    };
    let warn = if w.warn_days <= 0 { 30 } else { w.warn_days };
    let level = if days < 0 { "error" } else if days <= 7 { "error" } else if days <= warn { "warn" } else { "ok" };
    let summary = if days < 0 {
        format!("Certificato di {host} scaduto da {} giorni", -days)
    } else {
        format!("Certificato di {host}: scade tra {days} giorni")
    };
    let mut r = WidgetResult::new(&w.id, level, summary);
    r.fields.push(FieldValue { label: "Scadenza".into(), value: expiry.get(..10).unwrap_or(expiry).to_string() });
    if !issuer.is_empty() {
        r.fields.push(FieldValue { label: "Emesso da".into(), value: issuer.to_string() });
    }
    r
}

/// Whole days from now until an ISO "YYYY-MM-DDTHH:MM:SSZ" instant (UTC).
fn days_until(iso: &str) -> Option<i64> {
    let date = iso.get(..10)?;
    let mut parts = date.split('-');
    let (y, m, d): (i64, i64, i64) = (
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
        parts.next()?.parse().ok()?,
    );
    let target = days_from_civil(y, m, d);
    let now = SystemTime::now().duration_since(UNIX_EPOCH).ok()?.as_secs() as i64 / 86_400;
    Some(target - now)
}

/// Days since 1970-01-01 for a proleptic Gregorian date (Howard Hinnant).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

fn service(id: &str, name: &str) -> WidgetResult {
    use windows::core::HSTRING;
    use windows::Win32::System::Services::{
        CloseServiceHandle, OpenSCManagerW, OpenServiceW, QueryServiceStatus, SC_MANAGER_CONNECT,
        SERVICE_QUERY_STATUS, SERVICE_RUNNING, SERVICE_STATUS,
    };
    let name = name.trim();
    unsafe {
        let Ok(scm) = OpenSCManagerW(None, None, SC_MANAGER_CONNECT) else {
            return WidgetResult::new(id, "error", "Gestione servizi non accessibile");
        };
        let result = match OpenServiceW(scm, &HSTRING::from(name), SERVICE_QUERY_STATUS) {
            Ok(svc) => {
                let mut st = SERVICE_STATUS::default();
                let r = if QueryServiceStatus(svc, &mut st).is_ok() {
                    if st.dwCurrentState == SERVICE_RUNNING {
                        WidgetResult::new(id, "ok", format!("Servizio {name} in esecuzione"))
                    } else {
                        WidgetResult::new(id, "error", format!("Servizio {name} fermo (stato {})", st.dwCurrentState.0))
                    }
                } else {
                    WidgetResult::new(id, "error", format!("Stato di {name} non leggibile"))
                };
                let _ = CloseServiceHandle(svc);
                r
            }
            Err(_) => WidgetResult::new(id, "error", format!("Servizio {name} non trovato")),
        };
        let _ = CloseServiceHandle(scm);
        result
    }
}

/// `a.b[0].c`, `a.b.0.c` or a JSON pointer (`/a/b/0/c`).
pub fn pick<'a>(root: &'a Value, path: &str) -> Option<&'a Value> {
    let path = path.trim();
    if path.is_empty() {
        return Some(root);
    }
    if path.starts_with('/') {
        return root.pointer(path);
    }
    let mut cur = root;
    for raw in path.split('.') {
        let mut part = raw;
        // name[0][1]
        let name_end = part.find('[').unwrap_or(part.len());
        let name = &part[..name_end];
        if !name.is_empty() {
            cur = match cur {
                Value::Array(a) => a.get(name.parse::<usize>().ok()?)?,
                _ => cur.get(name)?,
            };
        }
        part = &part[name_end..];
        while let Some(rest) = part.strip_prefix('[') {
            let close = rest.find(']')?;
            cur = cur.get(rest[..close].trim().parse::<usize>().ok()?)?;
            part = &rest[close + 1..];
        }
    }
    Some(cur)
}

pub fn show(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => "—".into(),
        Value::Array(a) => format!("{} elementi", a.len()),
        Value::Object(_) => "{…}".into(),
        other => other.to_string(),
    }
}

/// True when the alert condition holds (i.e. something is wrong).
pub fn alert_fires(root: &Value, a: &Alert) -> bool {
    let found = pick(root, &a.path);
    if a.op == "missing" {
        return found.is_none() || found == Some(&Value::Null);
    }
    let Some(v) = found else { return false };
    let text = show(v);
    let num = |s: &str| s.trim().replace(',', ".").parse::<f64>().ok();
    match a.op.as_str() {
        "==" => text == a.value,
        "!=" => text != a.value,
        "contains" => text.to_lowercase().contains(&a.value.to_lowercase()),
        op => match (num(&text), num(&a.value)) {
            (Some(x), Some(y)) => match op {
                "<" => x < y,
                ">" => x > y,
                "<=" => x <= y,
                ">=" => x >= y,
                _ => false,
            },
            _ => false,
        },
    }
}

async fn json_api(w: &Widget) -> WidgetResult {
    if !valid_url(&w.url) {
        return WidgetResult::new(&w.id, "error", "Indirizzo non valido (serve http:// o https://)");
    }
    let Some(client) = client() else { return WidgetResult::new(&w.id, "error", "HTTP non disponibile") };
    let mut req = if w.method.eq_ignore_ascii_case("POST") { client.post(&w.url) } else { client.get(&w.url) };
    req = req.header("Accept", "application/json");
    for h in &w.headers {
        let value = if h.secret {
            crate::secrets::get(&secret_key(&w.id, &h.name)).unwrap_or_default()
        } else {
            h.value.clone()
        };
        if !h.name.trim().is_empty() {
            req = req.header(h.name.trim(), value);
        }
    }
    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => return WidgetResult::new(&w.id, "error", format!("Non risponde: {e}")),
    };
    let code = resp.status();
    if !code.is_success() {
        return WidgetResult::new(&w.id, "error", format!("HTTP {}", code.as_u16()));
    }
    let body: Value = match resp.json().await {
        Ok(v) => v,
        Err(_) => return WidgetResult::new(&w.id, "error", "La risposta non è JSON"),
    };
    let firing = w.alert.as_ref().is_some_and(|a| alert_fires(&body, a));
    let mut r = WidgetResult::new(&w.id, if firing { "warn" } else { "ok" }, "");
    for f in &w.fields {
        let value = pick(&body, &f.path).map(show).unwrap_or_else(|| "—".into());
        r.fields.push(FieldValue { label: f.label.clone(), value });
    }
    r.summary = if firing {
        let a = w.alert.as_ref().unwrap();
        let v = pick(&body, &a.path).map(show).unwrap_or_else(|| "assente".into());
        format!("Avviso: {} = {}", a.path, v)
    } else {
        r.fields.first().map(|f| format!("{}: {}", f.label, f.value)).unwrap_or_else(|| "OK".into())
    };
    r
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

fn current_widgets(app: &AppHandle) -> Vec<Widget> {
    let Some(shared) = app.try_state::<crate::Shared>() else { return Vec::new() };
    let list = shared.settings.lock().unwrap().widgets.clone();
    list.into_iter().filter_map(|v| serde_json::from_value::<Widget>(v).ok()).collect()
}

pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut last: HashMap<String, Instant> = HashMap::new();
        loop {
            let widgets = current_widgets(&app);
            if widgets.is_empty() || crate::integrations::PAUSED.load(std::sync::atomic::Ordering::Relaxed) {
                tokio::time::sleep(IDLE_TICK).await;
                continue;
            }
            let slow = if on_battery() { 3 } else { 1 };
            last.retain(|id, _| widgets.iter().any(|w| &w.id == id));
            for w in widgets {
                let due = last.get(&w.id).is_none_or(|t| t.elapsed() >= interval(&w) * slow);
                if !due {
                    continue;
                }
                last.insert(w.id.clone(), Instant::now());
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    let result = probe(&w).await;
                    let _ = app.emit_to(WINDOW_LABEL, "widget-update", result);
                });
            }
            tokio::time::sleep(TICK).await;
        }
    });
}

/// "Aggiorna" in the island, or "Prova" in the settings: one check, now.
pub async fn run_once(app: &AppHandle, widget: Value) -> Result<WidgetResult, String> {
    let w: Widget = serde_json::from_value(widget).map_err(|e| format!("Widget non valido: {e}"))?;
    let result = probe(&w).await;
    let _ = app.emit_to(WINDOW_LABEL, "widget-update", result.clone());
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn paths_pick_values() {
        let v = json!({"data": {"items": [{"name": "a", "n": 3}, {"name": "b"}]}, "ok": true});
        assert_eq!(pick(&v, "data.items[1].name"), Some(&json!("b")));
        assert_eq!(pick(&v, "data.items.0.n"), Some(&json!(3)));
        assert_eq!(pick(&v, "/data/items/0/name"), Some(&json!("a")));
        assert_eq!(pick(&v, "data.missing"), None);
        assert_eq!(show(pick(&v, "data.items").unwrap()), "2 elementi");
    }

    #[test]
    fn alerts() {
        let v = json!({"open": 12, "status": "degraded", "x": null});
        let a = |path: &str, op: &str, value: &str| Alert { path: path.into(), op: op.into(), value: value.into() };
        assert!(alert_fires(&v, &a("open", ">", "10")));
        assert!(!alert_fires(&v, &a("open", "<", "10")));
        assert!(alert_fires(&v, &a("status", "!=", "ok")));
        assert!(alert_fires(&v, &a("status", "contains", "DEGR")));
        assert!(alert_fires(&v, &a("x", "missing", "")));
        assert!(alert_fires(&v, &a("nope", "missing", "")));
        assert!(!alert_fires(&v, &a("nope", ">", "1")));
    }

    #[test]
    fn civil_days() {
        assert_eq!(days_from_civil(1970, 1, 1), 0);
        assert_eq!(days_from_civil(2000, 3, 1), 11_017);
        assert_eq!(days_from_civil(2026, 10, 1) - days_from_civil(2026, 9, 1), 30);
    }

    #[test]
    fn intervals_have_floors() {
        let w = |kind: &str, every: u64| Widget {
            id: "x".into(), name: String::new(), kind: kind.into(), every, url: String::new(),
            method: String::new(), headers: vec![], fields: vec![], alert: None, host: String::new(),
            port: 0, expect_status: 0, warn_days: 0, service: String::new(),
        };
        assert_eq!(interval(&w("ping", 0)).as_secs(), 60);
        assert_eq!(interval(&w("ping", 1)).as_secs(), 15);
        assert_eq!(interval(&w("tls", 60)).as_secs(), 3600);
        assert_eq!(interval(&w("tls", 0)).as_secs(), 6 * 3600);
    }
}
