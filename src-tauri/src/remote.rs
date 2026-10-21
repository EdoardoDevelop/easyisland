// "Accesso remoto": a temporary connection to a customer's PC (WinRM or
// SSH, Windows or Linux) that the chat can work on, asked for by Edoardo on
// 21 October 2026. Nothing is remembered: host, user and password live in
// memory until "Chiudi connessione" (or the app's exit), never on disk, never
// in Gestione credenziali, never in the chat.
//
//   * WinRM: Windows PowerShell's Invoke-Command, one fresh session per
//     command. The password reaches it in the child's environment, never on
//     the command line. Over HTTP to a PC outside a domain the host must be
//     in this PC's TrustedHosts: on request it is added for this connection
//     (UAC prompt) and taken out again at the close, and the WinRM service is
//     stopped again if it was started for that.
//   * SSH: Windows' own ssh.exe. The password goes through SSH_ASKPASS
//     (easyisland-hook.exe prints it from its environment); host keys go to
//     a known_hosts file of this connection only, deleted at the close.
//     Linux gets the command on stdin (`sh -s`), Windows as an encoded
//     PowerShell command.
//
// The chat works on it only after the 🔌 button in the chat (`LINKED`): the
// `remote_run` tool (agent.rs) waits for Consenti / Nega like every tool that
// changes something, and the chat is told which PC it is on (`hint`).

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::AppHandle;
use tokio::io::AsyncWriteExt;

use crate::i18n::{t, tf};
use crate::integrations::{self, IntegrationUpdate};

pub const ID: &str = "integration_remote";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// What a command may print back to the model.
const MAX_OUTPUT: usize = 30_000;

#[derive(Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    /// "winrm" or "ssh".
    pub kind: String,
    pub host: String,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub user: String,
    #[serde(default)]
    pub password: String,
    /// WinRM over HTTPS (5986), certificate not checked.
    #[serde(default)]
    pub https: bool,
    /// WinRM over HTTP: add the host to TrustedHosts for this connection.
    #[serde(default)]
    pub trust: bool,
}

#[derive(Clone, Copy, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
enum Os {
    Windows,
    Linux,
}

struct Conn {
    kind: String,
    host: String,
    port: Option<u16>,
    user: String,
    password: String,
    https: bool,
    os: Os,
    /// The remote PC's name and system, as it says.
    name: String,
    system: String,
    since: u64,
    /// Added to TrustedHosts by us: taken out at the close (and the local
    /// WinRM service stopped again if it was started for that).
    trusted_added: bool,
}

impl Drop for Conn {
    fn drop(&mut self) {
        wipe(&mut self.password);
    }
}

static CONN: Mutex<Option<Conn>> = Mutex::new(None);
static LINKED: AtomicBool = AtomicBool::new(false);
static BUSY: AtomicBool = AtomicBool::new(false);
static LAST_ERROR: Mutex<Option<String>> = Mutex::new(None);

fn wipe(s: &mut String) {
    // SAFETY: zeros are valid UTF-8.
    unsafe { s.as_mut_vec().fill(0) };
    s.clear();
}

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// This connection's own files (known_hosts, the TrustedHosts mark).
fn dir() -> PathBuf {
    crate::settings::local_dir().join("remote")
}

pub fn publish(app: &AppHandle) {
    let data = {
        let conn = CONN.lock().unwrap();
        match conn.as_ref() {
            Some(c) => json!({
                "connected": true, "kind": c.kind, "host": c.host, "user": c.user, "os": c.os,
                "name": c.name, "system": c.system, "since": c.since, "https": c.https,
                "trustedAdded": c.trusted_added, "linked": LINKED.load(Ordering::Relaxed),
            }),
            None => json!({ "connected": false }),
        }
    };
    let mut data = data;
    data["busy"] = json!(BUSY.load(Ordering::Relaxed));
    data["error"] = json!(LAST_ERROR.lock().unwrap().clone());
    integrations::emit(app, IntegrationUpdate { id: ID, data, error: None, event: None });
}

/// An address or a host name, safe on a command line.
fn host_ok(s: &str) -> bool {
    let s = s.trim().trim_start_matches('[').trim_end_matches(']');
    if s.parse::<std::net::IpAddr>().is_ok() {
        return true;
    }
    !s.is_empty() && s.len() <= 253 && !s.starts_with(['-', '.']) && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.')
}

fn user_ok(s: &str) -> bool {
    s.len() <= 104 && !s.starts_with('-') && !s.chars().any(|c| c.is_control() || matches!(c, '"' | '\'' | '`' | ' ' | ';' | '|' | '&'))
}

fn mark_path() -> PathBuf {
    dir().join("winrm-avviato")
}

fn known_hosts() -> PathBuf {
    dir().join("known_hosts")
}

// ── Opening and closing ───────────────────────────────────────────────────────

pub async fn connect(app: &AppHandle, req: Request) -> Result<(), String> {
    if CONN.lock().unwrap().is_some() {
        return Err(t("C'è già una connessione aperta: chiudila prima.").into());
    }
    if BUSY.swap(true, Ordering::SeqCst) {
        return Err(t("Connessione già in corso.").into());
    }
    *LAST_ERROR.lock().unwrap() = None;
    publish(app);
    let result = open(req).await;
    BUSY.store(false, Ordering::SeqCst);
    match result {
        Ok(conn) => {
            crate::log::line(format!("remoto: connesso a {} con {}", conn.host, conn.kind));
            *CONN.lock().unwrap() = Some(conn);
            LINKED.store(false, Ordering::Relaxed);
            publish(app);
            Ok(())
        }
        Err(e) => {
            crate::log::line(format!("remoto: connessione non riuscita: {e}"));
            *LAST_ERROR.lock().unwrap() = Some(e.clone());
            publish(app);
            Err(e)
        }
    }
}

async fn open(mut req: Request) -> Result<Conn, String> {
    let host = req.host.trim().to_string();
    let user = req.user.trim().to_string();
    if !host_ok(&host) {
        return Err(t("Scrivi l'indirizzo IP o il nome del PC.").into());
    }
    if !user_ok(&user) {
        return Err(t("Il nome utente non è valido.").into());
    }
    let mut conn = Conn {
        kind: if req.kind == "ssh" { "ssh".into() } else { "winrm".into() },
        host,
        port: req.port.filter(|p| *p > 0),
        user,
        password: std::mem::take(&mut req.password),
        https: req.https && req.kind != "ssh",
        os: Os::Windows,
        name: String::new(),
        system: String::new(),
        since: now_ms(),
        trusted_added: false,
    };
    let _ = std::fs::create_dir_all(dir());
    if conn.kind == "ssh" {
        let _ = std::fs::remove_file(known_hosts());
        // Linux first (`uname`); a Windows PC has no `sh` and answers the second question.
        let first = ssh(&conn, Os::Linux, "uname -sn", 25).await;
        match first {
            Ok(out) if looks_unix(&out) => {
                let mut words = out.split_whitespace();
                conn.os = Os::Linux;
                conn.system = words.next().unwrap_or("Linux").to_string();
                conn.name = words.next().unwrap_or_default().to_string();
            }
            Err(e) if e.unreachable => return Err(e.text),
            _ => {
                let out = ssh(&conn, Os::Windows, WHO_WINDOWS, 25).await.map_err(|e| e.text)?;
                conn.os = Os::Windows;
                read_who(&mut conn, &out);
            }
        }
    } else {
        if !conn.https && req.trust && !trusted(&conn.host) {
            trust(&conn.host, true).await?;
            conn.trusted_added = true;
        }
        match winrm(&conn, WHO_WINDOWS, 30).await {
            Ok(out) => read_who(&mut conn, &out),
            Err(e) => {
                untrust(&conn).await;
                return Err(e.text);
            }
        }
    }
    if conn.name.is_empty() {
        conn.name = conn.host.clone();
    }
    Ok(conn)
}

/// `uname -sn` answered by a Unix, not cmd.exe's "not recognized" or Git's sh on Windows.
fn looks_unix(out: &str) -> bool {
    let first = out.trim().to_ascii_uppercase();
    !first.is_empty()
        && !first.contains("NOT RECOGNIZED")
        && !first.contains("NON È RICONOSCIUTO")
        && !["MINGW", "MSYS", "CYGWIN"].iter().any(|w| first.starts_with(w))
        && !first.contains("CODICE DI USCITA")
}

const WHO_WINDOWS: &str = "$o = Get-CimInstance Win32_OperatingSystem; \"$env:COMPUTERNAME|$($o.Caption) $($o.Version)\"";

fn read_who(conn: &mut Conn, out: &str) {
    let line = out.lines().map(str::trim).find(|l| l.contains('|')).unwrap_or_default();
    let (name, system) = line.split_once('|').unwrap_or((line, ""));
    conn.name = name.trim().to_string();
    conn.system = system.trim().to_string();
}

/// "Chiudi connessione": the chat unlinked, TrustedHosts and the WinRM
/// service as they were, this connection's known_hosts deleted, the password
/// forgotten.
pub async fn disconnect(app: &AppHandle) -> Result<(), String> {
    let conn = CONN.lock().unwrap().take();
    LINKED.store(false, Ordering::Relaxed);
    *LAST_ERROR.lock().unwrap() = None;
    let mut problem = None;
    if let Some(conn) = conn {
        if conn.trusted_added {
            if let Err(e) = trust(&conn.host, false).await {
                problem = Some(tf("Connessione chiusa, ma {h} è rimasto in TrustedHosts: {e}", &[("h", &conn.host), ("e", &e)]));
            }
        }
        crate::log::line(format!("remoto: connessione con {} chiusa", conn.host));
    }
    let _ = std::fs::remove_file(known_hosts());
    *LAST_ERROR.lock().unwrap() = problem.clone();
    publish(app);
    problem.map_or(Ok(()), Err)
}

/// At the app's exit: the same cleaning, without the island.
pub fn shutdown() {
    let conn = CONN.lock().unwrap().take();
    if let Some(conn) = conn {
        if conn.trusted_added {
            let _ = tauri::async_runtime::block_on(trust(&conn.host, false));
        }
    }
    let _ = std::fs::remove_file(known_hosts());
}

async fn untrust(conn: &Conn) {
    if conn.trusted_added {
        let _ = trust(&conn.host, false).await;
    }
}

pub fn link(app: &AppHandle, on: bool) -> Result<(), String> {
    if on && CONN.lock().unwrap().is_none() {
        return Err(t("Nessuna connessione aperta.").into());
    }
    LINKED.store(on, Ordering::Relaxed);
    publish(app);
    Ok(())
}

// ── TrustedHosts ──────────────────────────────────────────────────────────────

/// Already in this PC's TrustedHosts (or "*")? Read from the registry, no admin needed.
fn trusted(host: &str) -> bool {
    let mut cmd = std::process::Command::new("reg");
    cmd.args(["query", r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\WSMAN\Client", "/v", "trusted_hosts"]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    let Ok(out) = cmd.output() else { return false };
    let text = String::from_utf8_lossy(&out.stdout);
    let value = text.lines().find(|l| l.contains("trusted_hosts")).and_then(|l| l.split("REG_SZ").nth(1)).unwrap_or_default();
    value.split(',').map(str::trim).any(|h| h == "*" || h.eq_ignore_ascii_case(host))
}

/// Adds or removes the host, as administrator (Windows' UAC prompt). When
/// adding has to start the WinRM service a mark says so, and removing stops it again.
async fn trust(host: &str, add: bool) -> Result<(), String> {
    let mark = mark_path();
    let script = format!(
        "$ErrorActionPreference='Stop'; $h='{host}'; $mark='{mark}'\n\
         $s = Get-Service WinRM\n\
         if ($s.Status -ne 'Running') {{ Start-Service WinRM; {started} }}\n\
         $cur = (Get-Item WSMan:\\localhost\\Client\\TrustedHosts).Value\n\
         $list = @(($cur -split ',') | ForEach-Object {{ $_.Trim() }} | Where-Object {{ $_ }})\n\
         {change}\n\
         Set-Item WSMan:\\localhost\\Client\\TrustedHosts -Value ($list -join ',') -Force\n\
         {after}",
        mark = mark.display().to_string().replace('\'', "''"),
        started = if add { "New-Item -ItemType File -Force $mark | Out-Null" } else { "$extra = $true" },
        change = if add { "if ($list -notcontains $h) { $list += $h }" } else { "$list = @($list | Where-Object { $_ -ne $h })" },
        after = if add { "" } else { "if ((Test-Path $mark) -or $extra) { Remove-Item $mark -ErrorAction SilentlyContinue; Stop-Service WinRM }" },
    );
    if add {
        let _ = std::fs::remove_file(&mark);
    }
    let line = format!("powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand {}", encoded(&script));
    let log = dir().join("trustedhosts.log");
    let _ = std::fs::remove_file(&log);
    tauri::async_runtime::spawn_blocking(move || crate::netconfig::run_elevated(&[line], &log, "PowerShell"))
        .await
        .map_err(|e| e.to_string())??;
    crate::log::line(format!("remoto: {host} {} TrustedHosts", if add { "aggiunto a" } else { "tolto da" }));
    Ok(())
}

/// PowerShell's -EncodedCommand: UTF-16LE in base64.
fn encoded(script: &str) -> String {
    let bytes: Vec<u8> = script.encode_utf16().flat_map(u16::to_le_bytes).collect();
    crate::claude::base64_for(&bytes)
}

// ── Running a command ─────────────────────────────────────────────────────────

struct RunError {
    text: String,
    /// The PC did not answer or refused us: no point trying another way.
    unreachable: bool,
}

/// Windows PowerShell on this PC runs the command on the remote one.
const WINRM_SCRIPT: &str = r#"[Console]::OutputEncoding=[Text.Encoding]::UTF8
$ErrorActionPreference='Stop'
$p = @{ ComputerName = $env:EI_R_HOST }
if ($env:EI_R_PORT) { $p.Port = [int]$env:EI_R_PORT }
if ($env:EI_R_SSL -eq '1') { $p.UseSSL = $true; $p.SessionOption = New-PSSessionOption -SkipCACheck -SkipCNCheck -SkipRevocationCheck }
if ($env:EI_R_USER) {
  $sec = if ($env:EI_R_PASS) { ConvertTo-SecureString $env:EI_R_PASS -AsPlainText -Force } else { New-Object Security.SecureString }
  $p.Credential = New-Object Management.Automation.PSCredential($env:EI_R_USER, $sec)
}
$sb = [scriptblock]::Create($env:EI_R_CMD)
try { $s = New-PSSession @p } catch { [Console]::Error.WriteLine("EI_TRANSPORT: " + $_.Exception.Message); exit 3 }
try {
  $ErrorActionPreference = 'Continue'
  Invoke-Command -Session $s -ScriptBlock $sb 2>&1 | Out-String -Width 200
} finally { Remove-PSSession $s }
"#;

async fn winrm(conn: &Conn, command: &str, secs: u64) -> Result<String, RunError> {
    let mut cmd = tokio::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", WINRM_SCRIPT])
        .env("EI_R_HOST", &conn.host)
        .env("EI_R_PORT", conn.port.map(|p| p.to_string()).unwrap_or_default())
        .env("EI_R_SSL", if conn.https { "1" } else { "" })
        .env("EI_R_USER", &conn.user)
        .env("EI_R_PASS", &conn.password)
        .env("EI_R_CMD", command)
        .stdin(Stdio::null())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = match tokio::time::timeout(Duration::from_secs(secs), cmd.output()).await {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => return Err(RunError { text: format!("PowerShell: {e}"), unreachable: true }),
        Err(_) => return Err(RunError { text: tf("Nessuna risposta entro {s} secondi.", &[("s", &secs)]), unreachable: false }),
    };
    let stdout = String::from_utf8_lossy(&out.stdout).trim_start_matches('\u{feff}').trim_end().to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    if let Some(i) = stderr.find("EI_TRANSPORT:") {
        let msg = stderr.get(i + 13..).unwrap_or_default().trim();
        return Err(RunError { text: winrm_problem(msg, &conn.host), unreachable: true });
    }
    if !out.status.success() && stdout.is_empty() {
        return Err(RunError { text: last_line(&stderr), unreachable: false });
    }
    Ok(stdout)
}

/// The usual WinRM failures, in words that say what to do.
fn winrm_problem(msg: &str, host: &str) -> String {
    let m = msg.to_ascii_lowercase();
    let why = if m.contains("trustedhosts") {
        t("questo PC non si fida di quell'indirizzo (TrustedHosts). Spunta «Aggiungi a TrustedHosts» o usa HTTPS.").to_string()
    } else if m.contains("access is denied") || m.contains("accesso negato") {
        t("accesso negato. Controlla utente (NOMEPC\\utente) e password; con un amministratore locale diverso da Administrator serve LocalAccountTokenFilterPolicy (guida).").to_string()
    } else if m.contains("cannot complete the operation") || m.contains("cannot connect") || m.contains("impossibile") || m.contains("not reachable") {
        t("il PC non risponde su WinRM. È acceso e raggiungibile? WinRM è attivo (Enable-PSRemoting) e il firewall lo lascia passare? (guida)").to_string()
    } else {
        last_line(msg)
    };
    tf("Collegamento a {h} non riuscito: {w}", &[("h", &host), ("w", &why)])
}

fn ssh_args(conn: &Conn) -> Vec<String> {
    let mut a: Vec<String> = [
        "-o", "StrictHostKeyChecking=accept-new", "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15",
        "-o", "ServerAliveCountMax=2", "-o", "NumberOfPasswordPrompts=1",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    a.extend(["-o".into(), format!("UserKnownHostsFile={}", known_hosts().display())]);
    if conn.password.is_empty() {
        // With a key only: never a prompt nobody can answer.
        a.extend(["-o".into(), "BatchMode=yes".into()]);
    }
    if let Some(p) = conn.port {
        a.extend(["-p".into(), p.to_string()]);
    }
    if !conn.user.is_empty() {
        a.extend(["-l".into(), conn.user.clone()]);
    }
    a.push(conn.host.trim_start_matches('[').trim_end_matches(']').to_string());
    a
}

fn ssh_exe() -> PathBuf {
    let system = std::env::var_os("SystemRoot").map(PathBuf::from).unwrap_or_else(|| PathBuf::from(r"C:\Windows"));
    let exe = system.join("System32").join("OpenSSH").join("ssh.exe");
    if exe.exists() { exe } else { PathBuf::from("ssh") }
}

async fn ssh(conn: &Conn, os: Os, command: &str, secs: u64) -> Result<String, RunError> {
    let mut args = ssh_args(conn);
    let stdin_text = match os {
        Os::Linux => {
            args.push("sh -s".into());
            Some(format!("{command}\n"))
        }
        Os::Windows => {
            let script = format!(
                "$ProgressPreference='SilentlyContinue'; [Console]::OutputEncoding=[Text.Encoding]::UTF8\n& {{\n{command}\n}} 2>&1 | Out-String -Width 200"
            );
            let line = format!("powershell -NoProfile -NonInteractive -OutputFormat Text -EncodedCommand {}", encoded(&script));
            // cmd.exe, the usual login shell there, takes 8191 characters.
            if line.len() > 8000 {
                return Err(RunError { text: "Comando troppo lungo per SSH verso Windows: dividilo in più comandi.".into(), unreachable: false });
            }
            args.push(line);
            None
        }
    };
    let mut cmd = tokio::process::Command::new(ssh_exe());
    cmd.args(&args)
        .stdin(if stdin_text.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if !conn.password.is_empty() {
        cmd.env("SSH_ASKPASS", crate::settings::hook_exe_path())
            .env("SSH_ASKPASS_REQUIRE", "force")
            .env("EASYISLAND_ASKPASS", &conn.password);
    }
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    let mut child = cmd.spawn().map_err(|e| RunError { text: tf("ssh non si avvia: {e}", &[("e", &e)]), unreachable: true })?;
    if let (Some(text), Some(mut stdin)) = (stdin_text, child.stdin.take()) {
        let _ = stdin.write_all(text.as_bytes()).await;
        drop(stdin);
    }
    let out = match tokio::time::timeout(Duration::from_secs(secs), child.wait_with_output()).await {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => return Err(RunError { text: format!("ssh: {e}"), unreachable: true }),
        Err(_) => return Err(RunError { text: tf("Nessuna risposta entro {s} secondi.", &[("s", &secs)]), unreachable: false }),
    };
    let stdout = String::from_utf8_lossy(&out.stdout).trim_end().to_string();
    // The first time a host is seen ssh says it added its key: not news.
    let stderr: String = String::from_utf8_lossy(&out.stderr)
        .lines()
        .filter(|l| !l.starts_with("Warning: Permanently added"))
        .collect::<Vec<_>>()
        .join("
")
        .trim()
        .to_string();
    // 255: ssh itself failed (address, port, login), not the command.
    if out.status.code() == Some(255) {
        return Err(RunError { text: ssh_problem(&stderr, &conn.host), unreachable: true });
    }
    let mut text = stdout;
    if !stderr.is_empty() {
        if !text.is_empty() {
            text.push('\n');
        }
        text.push_str(&stderr);
    }
    if let Some(code) = out.status.code().filter(|c| *c != 0) {
        text.push_str(&format!("\n(codice di uscita {code})"));
    }
    Ok(text)
}

fn ssh_problem(msg: &str, host: &str) -> String {
    let m = msg.to_ascii_lowercase();
    let why = if m.contains("permission denied") {
        t("accesso negato. Controlla utente e password; sul PC deve essere permesso l'accesso con password (PasswordAuthentication) o la tua chiave (guida).").to_string()
    } else if m.contains("timed out") || m.contains("no route") || m.contains("unreachable") {
        t("il PC non risponde. È acceso e raggiungibile in rete o VPN? Il firewall lascia passare la porta 22?").to_string()
    } else if m.contains("refused") {
        t("il PC rifiuta la connessione: il server SSH non è acceso o ascolta su un'altra porta (guida).").to_string()
    } else if m.contains("could not resolve") {
        t("nome del PC sconosciuto: usa l'indirizzo IP.").to_string()
    } else if m.is_empty() {
        t("ssh non ha detto perché. Se la password non viene chiesta, OpenSSH di questo PC è troppo vecchio (guida).").to_string()
    } else {
        last_line(msg)
    };
    tf("Collegamento a {h} non riuscito: {w}", &[("h", &host), ("w", &why)])
}

fn last_line(text: &str) -> String {
    text.lines().map(str::trim).filter(|l| !l.is_empty()).last().unwrap_or("errore sconosciuto").to_string()
}

/// What a long output keeps: its end, where the result and the errors are.
fn shorten(text: &str) -> String {
    let count = text.chars().count();
    if count <= MAX_OUTPUT {
        return text.to_string();
    }
    let tail: String = text.chars().skip(count - MAX_OUTPUT).collect();
    format!("(uscita lunga: tolti i primi {} caratteri)\n{tail}", count - MAX_OUTPUT)
}

// ── For the chat (agent.rs) ───────────────────────────────────────────────────

fn not_ready() -> Option<String> {
    if CONN.lock().unwrap().is_none() {
        return Some("Nessuna connessione remota aperta: l'utente la apre nella scheda «Accesso remoto» dell'isola.".into());
    }
    if !LINKED.load(Ordering::Relaxed) {
        return Some("La chat non è collegata alla connessione remota: l'utente deve premere il pulsante 🔌 nella chat.".into());
    }
    None
}

fn describe(c: &Conn) -> String {
    format!(
        "{} ({}), {}{}, via {}{}",
        c.name,
        c.host,
        if c.os == Os::Linux { "Linux" } else { "Windows" },
        if c.system.is_empty() { String::new() } else { format!(" «{}»", c.system) },
        if c.kind == "ssh" { "SSH" } else { "WinRM" },
        if c.user.is_empty() { String::new() } else { format!(" come {}", c.user) },
    )
}

fn shell_of(c: &Conn) -> &'static str {
    if c.os == Os::Linux { "comandi di shell (sh)" } else { "comandi PowerShell" }
}

/// remote_status: the PC the chat works on.
pub fn status() -> Result<String, String> {
    if let Some(e) = not_ready() {
        return Err(e);
    }
    let conn = CONN.lock().unwrap();
    let c = conn.as_ref().ok_or("Nessuna connessione remota aperta.")?;
    Ok(format!("Collegato a {}. remote_run accetta {}; ogni chiamata è una sessione nuova (cartella e variabili non restano).", describe(c), shell_of(c)))
}

/// remote_run: one command on the remote PC (after Consenti / Nega).
pub async fn run(command: &str, timeout: Option<u64>) -> Result<String, String> {
    if let Some(e) = not_ready() {
        return Err(e);
    }
    let command = command.trim();
    if command.is_empty() {
        return Err("Manca il comando.".into());
    }
    let secs = timeout.unwrap_or(120).clamp(5, 300);
    // A copy of what is needed, so the lock is not held while the command runs.
    let conn = {
        let guard = CONN.lock().unwrap();
        let c = guard.as_ref().ok_or("Nessuna connessione remota aperta.")?;
        Conn {
            kind: c.kind.clone(),
            host: c.host.clone(),
            port: c.port,
            user: c.user.clone(),
            password: c.password.clone(),
            https: c.https,
            os: c.os,
            name: c.name.clone(),
            system: String::new(),
            since: c.since,
            trusted_added: false,
        }
    };
    crate::log::line(format!("remoto: comando su {}", conn.host));
    let out = if conn.kind == "ssh" { ssh(&conn, conn.os, command, secs).await } else { winrm(&conn, command, secs).await };
    match out {
        Ok(text) if text.trim().is_empty() => Ok("(nessuna uscita)".into()),
        Ok(text) => Ok(shorten(&text)),
        Err(e) => Err(e.text),
    }
}

/// In front of each question while the chat is linked (lib.rs chat_turn).
pub fn hint() -> Option<String> {
    if !LINKED.load(Ordering::Relaxed) {
        return None;
    }
    let conn = CONN.lock().unwrap();
    let c = conn.as_ref()?;
    Some(format!(
        "[Accesso remoto: la chat è collegata a {}. Per tutto ciò che riguarda quel PC usa lo strumento remote_run di easyisland con {}; ogni chiamata è una sessione nuova. Non usare i comandi di questo PC per quello remoto.]\n\n",
        describe(c),
        shell_of(c)
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hosts_and_users() {
        assert!(host_ok("192.168.1.20"));
        assert!(host_ok("pc-reception.local"));
        assert!(host_ok("[fe80::1]"));
        assert!(!host_ok("1.2.3.4; calc"));
        assert!(!host_ok("-oProxyCommand=x"));
        assert!(!host_ok(""));
        assert!(user_ok("PC01\\admin"));
        assert!(user_ok(".\\mario"));
        assert!(user_ok(""));
        assert!(!user_ok("-oProxy"));
        assert!(!user_ok("a b"));
        assert!(!user_ok("a'b"));
    }

    #[test]
    fn unix_or_windows() {
        assert!(looks_unix("Linux srv01"));
        assert!(!looks_unix("MINGW64_NT-10.0 PC01"));
        assert!(!looks_unix("'sh' is not recognized as an internal or external command
(codice di uscita 1)"));
        assert!(!looks_unix(""));
    }

    #[test]
    fn long_output_keeps_the_end() {
        let long = "é".repeat(MAX_OUTPUT + 10);
        let s = shorten(&long);
        assert!(s.starts_with("(uscita lunga: tolti i primi 10 caratteri)"));
        assert!(s.ends_with('é'));
    }

    #[test]
    fn who_line() {
        let mut c = Conn {
            kind: "winrm".into(), host: "h".into(), port: None, user: String::new(), password: "x".into(), https: false,
            os: Os::Windows, name: String::new(), system: String::new(), since: 0, trusted_added: false,
        };
        read_who(&mut c, "\r\nPC-01|Microsoft Windows 11 Pro 10.0.22631\r\n");
        assert_eq!(c.name, "PC-01");
        assert_eq!(c.system, "Microsoft Windows 11 Pro 10.0.22631");
    }

    #[test]
    fn not_linked_without_connection() {
        assert!(not_ready().is_some());
        assert!(hint().is_none());
    }
}
