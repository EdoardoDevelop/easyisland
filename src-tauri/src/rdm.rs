// Remote Desktop Manager (Devolutions) as an integration: the user's
// connections searched and opened from EasyIsland (the card, the search bar,
// a 3CX call or a Zammad ticket, the text selected). Asked by Edoardo on
// 15 October 2026: "everything at hand, RDM managed from EasyIsland". RDM
// still makes the connections; EasyIsland finds them and asks RDM to open,
// edit or search. See docs/integrazioni.md → Remote Desktop Manager.
//
// Where the connections are is not known in advance (a local SQLite or XML
// file, Devolutions Server, Devolutions Hub, an SQL database, shared with
// colleagues or not), so EasyIsland never reads RDM's files: the list comes
// from Devolutions' own PowerShell module (`Devolutions.PowerShell`, PowerShell
// 7.2+), which opens the same workspace RDM opens, with the user's rights.
// Only name, folder, host, type and id are read: never a password, never a
// field marked sensitive. The list stays in memory.
//
// Without the module, EasyIsland still searches *in* RDM (`/Filter:`), opens
// it and connects to a host (`/Template:RDP /Host:`): nothing to set up.
//
// Opening: `RemoteDesktopManager.exe /DataSource:<id> /Session:<id>` when the
// program is found, else the same through RDM's own `rdm://` links. Ids and
// hosts are checked before they go on a command line. Nothing is ever deleted.

use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

use crate::i18n::{t, tf};
use crate::probes::reg;

pub const ID: &str = "integration_rdm";
const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// Reading a big workspace (a server with thousands of entries) takes a while.
const READ_TIMEOUT: Duration = Duration::from_secs(120);
const CHECK_TIMEOUT: Duration = Duration::from_secs(30);

// ── Finding RDM and PowerShell ────────────────────────────────────────────────

/// RemoteDesktopManager.exe: where Windows says it is (App Paths), else the
/// installers' folders (also the Free edition and the old 64-bit name).
pub fn exe() -> Option<PathBuf> {
    for name in ["RemoteDesktopManager.exe", "RemoteDesktopManager64.exe", "RemoteDesktopManagerFree.exe"] {
        for root in [reg::HKEY_CURRENT_USER, reg::HKEY_LOCAL_MACHINE] {
            let key = format!(r"Software\Microsoft\Windows\CurrentVersion\App Paths\{name}");
            if let Some(p) = reg::Key::open(root, &key).and_then(|k| k.string("")) {
                let p = PathBuf::from(p.trim_matches('"'));
                if p.is_file() {
                    return Some(p);
                }
            }
        }
    }
    let mut dirs: Vec<PathBuf> = Vec::new();
    for var in ["ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA"] {
        if let Some(base) = std::env::var_os(var).map(PathBuf::from) {
            dirs.push(base.join("Devolutions").join("Remote Desktop Manager"));
            dirs.push(base.join("Devolutions").join("Remote Desktop Manager Free"));
            dirs.push(base.join("Programs").join("Devolutions").join("Remote Desktop Manager"));
        }
    }
    dirs.iter()
        .flat_map(|d| ["RemoteDesktopManager.exe", "RemoteDesktopManager64.exe", "RemoteDesktopManagerFree.exe"].map(|n| d.join(n)))
        .find(|p| p.is_file())
}

/// RDM registered its rdm:// links (it does at install).
fn protocol() -> bool {
    reg::Key::exists(reg::HKEY_CURRENT_USER, r"Software\Classes\rdm")
        || reg::Key::exists(reg::HKEY_LOCAL_MACHINE, r"SOFTWARE\Classes\rdm")
}

/// PowerShell 7 (pwsh.exe): the module needs 7.2 or later.
fn pwsh() -> Option<PathBuf> {
    if let Some(p) = crate::find_on_path("pwsh") {
        return Some(p);
    }
    std::env::var_os("ProgramFiles")
        .map(|p| PathBuf::from(p).join("PowerShell").join("7").join("pwsh.exe"))
        .filter(|p| p.is_file())
}

// ── Running the module ────────────────────────────────────────────────────────

/// A script for pwsh as -EncodedCommand (UTF-16LE, base64): nothing to quote.
fn encoded(script: &str) -> String {
    let bytes: Vec<u8> = script.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    crate::claude::base64_for(&bytes)
}

/// Runs a script in a hidden pwsh with no profile and no prompts; its output
/// (UTF-8) or a message in Italian. `env` reaches the script as $env:… (ids only).
async fn run(script: &str, env: &[(&str, &str)], limit: Duration) -> Result<String, String> {
    let exe = pwsh().ok_or_else(|| t("Manca PowerShell 7 (pwsh): serve al modulo di Remote Desktop Manager.").to_string())?;
    let mut cmd = tokio::process::Command::new(exe);
    cmd.args(["-NoProfile", "-NonInteractive", "-EncodedCommand", &encoded(script)])
        .env("EASYISLAND_INTERNAL", "1")
        .envs(env.iter().copied())
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .creation_flags(CREATE_NO_WINDOW);
    let child = cmd.spawn().map_err(|e| tf("PowerShell non si avvia: {e}", &[("e", &e)]))?;
    let out = match tokio::time::timeout(limit, child.wait_with_output()).await {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => return Err(e.to_string()),
        // A workspace that waits for a login or a second factor nobody can type.
        Err(_) => return Err(t("Remote Desktop Manager non ha risposto in tempo: forse l'origine dati chiede un accesso. Aprila una volta in RDM e salva le credenziali.").into()),
    };
    let stdout = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if out.status.success() {
        return Ok(stdout);
    }
    Err(problem(&String::from_utf8_lossy(&out.stderr)))
}

/// PowerShell's error, in a sentence the user can act on.
fn problem(stderr: &str) -> String {
    let s = stderr.to_lowercase();
    if s.contains("devolutions.powershell") && (s.contains("not loaded") || s.contains("was not") || s.contains("non è stato") || s.contains("no valid module")) {
        return t("Manca il modulo Devolutions.PowerShell. In PowerShell 7: Install-Module Devolutions.PowerShell -Scope CurrentUser").into();
    }
    if s.contains("license") || s.contains("licen") {
        return t("Il modulo di Remote Desktop Manager chiede una licenza valida.").into();
    }
    let line = stderr.lines().map(str::trim).find(|l| !l.is_empty() && !l.starts_with("At ") && !l.starts_with('+')).unwrap_or("");
    let line: String = line.chars().take(240).collect();
    if line.is_empty() { t("Remote Desktop Manager ha restituito un errore.").into() } else { format!("RDM: {line}") }
}

/// The installed module's version, or None.
async fn module_version() -> Option<String> {
    let script = "$m = Get-Module -ListAvailable Devolutions.PowerShell | Sort-Object Version -Descending | Select-Object -First 1; if ($m) { \"$($m.Version)\" }";
    run(script, &[], CHECK_TIMEOUT).await.ok().filter(|v| !v.is_empty())
}

/// The output prefix of every script: errors stop it, the text is UTF-8.
const PRELUDE: &str = "$ErrorActionPreference = 'Stop'\n$ProgressPreference = 'SilentlyContinue'\n[Console]::OutputEncoding = [System.Text.Encoding]::UTF8\nImport-Module Devolutions.PowerShell\n";

/// The workspaces (data sources) RDM knows on this PC.
const DATA_SOURCES: &str = "$list = @(Get-RDMDataSource | ForEach-Object { [pscustomobject]@{ id = \"$($_.ID)\"; name = \"$($_.Name)\"; kind = \"$($_.Type)\" } })\nConvertTo-Json -InputObject $list -Compress -Depth 3";

/// The connections of the workspace chosen ($env:EASYISLAND_RDM_DS, else
/// RDM's current one): only names, folders, hosts, types and ids.
/// Devolutions Server and Hub keep the entries in vaults (repositories) and
/// Get-RDMSession reads only the current one: every shared vault is read, its
/// name before the folder, and then the user vault (Get-RDMPrivateSession),
/// where a Hub may keep everything with no shared vault at all
/// (repository "user").
const SESSIONS: &str = "if ($env:EASYISLAND_RDM_DS) { Set-RDMCurrentDataSource -ID $env:EASYISLAND_RDM_DS }\n$ds = Get-RDMCurrentDataSource\n$repos = @()\nif (Get-Command Get-RDMRepository -ErrorAction SilentlyContinue) { try { $repos = @(Get-RDMRepository) } catch { $repos = @() } }\nif ($repos.Count -eq 0) { $repos = @($null) }\n$list = @(foreach ($r in $repos) {\n  $rid = ''; $rname = ''\n  if ($r) { try { Set-RDMCurrentRepository -Repository $r -ErrorAction Stop } catch { continue }; $rid = \"$($r.ID)\"; $rname = \"$($r.Name)\" }\n  try { $items = @(Get-RDMSession -ErrorAction Stop) } catch { $items = @() }\n  foreach ($e in $items) {\n    $h = if ($e.Host) { \"$($e.Host)\" } elseif ($e.Url) { \"$($e.Url)\" } else { '' }\n    $g = \"$($e.Group)\"; if ($repos.Count -gt 1 -and $rname) { $g = if ($g) { ($rname + [char]92 + $g) } else { $rname } }\n    [pscustomobject]@{ id = \"$($e.ID)\"; name = \"$($e.Name)\"; group = $g; host = $h; kind = \"$($e.ConnectionType)\"; repository = $rid }\n  }\n})\n$seen = @{}; foreach ($x in $list) { $seen[$x.id] = 1 }\n$priv = @(); if (Get-Command Get-RDMPrivateSession -ErrorAction SilentlyContinue) { try { $priv = @(Get-RDMPrivateSession -ErrorAction Stop) } catch { $priv = @() } }\n$list += @(foreach ($e in $priv) {\n  if ($seen.ContainsKey(\"$($e.ID)\")) { continue }\n  $h = if ($e.Host) { \"$($e.Host)\" } elseif ($e.Url) { \"$($e.Url)\" } else { '' }\n  [pscustomobject]@{ id = \"$($e.ID)\"; name = \"$($e.Name)\"; group = \"$($e.Group)\"; host = $h; kind = \"$($e.ConnectionType)\"; repository = 'user' }\n})\nConvertTo-Json -InputObject ([pscustomobject]@{ dataSource = [pscustomobject]@{ id = \"$($ds.ID)\"; name = \"$($ds.Name)\"; kind = \"$($ds.Type)\" }; entries = $list }) -Compress -Depth 4";

// ── The list of connections ───────────────────────────────────────────────────

/// One connection: what the island shows and needs to open it.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String,
    pub name: String,
    /// Folder path in RDM ("Clienti\Rossi Srl").
    #[serde(default)]
    pub group: String,
    #[serde(default)]
    pub host: String,
    /// RDM's connection type ("RDPConfigured", "SSHShell", "WebBrowser"…).
    #[serde(default)]
    pub kind: String,
    /// The vault (Devolutions Server / Hub): its id, "user" for the user
    /// vault, empty for a local data source.
    #[serde(default)]
    pub repository: String,
}

#[derive(Default)]
struct Index {
    /// (id, name) of the workspace read.
    data_source: Option<(String, String)>,
    entries: Vec<Entry>,
    /// Seconds since 1970 of the last good read.
    at: i64,
    error: Option<String>,
}

static INDEX: Mutex<Option<Index>> = Mutex::new(None);

/// Types that are not connections: folders and stored credentials.
fn is_connection(kind: &str) -> bool {
    let k = kind.to_ascii_lowercase();
    !(k == "group" || k.starts_with("credential"))
}

/// The module's JSON → the workspace and the connections (folders and
/// credentials left out, a missing id or name dropped).
fn parse_sessions(json: &str) -> Result<(Option<(String, String)>, Vec<Entry>), String> {
    let v: Value = serde_json::from_str(json.trim()).map_err(|_| t("Risposta del modulo di RDM non leggibile.").to_string())?;
    let ds = v.get("dataSource").and_then(|d| {
        let id = d.get("id")?.as_str()?.to_string();
        (!id.is_empty()).then(|| (id, d.get("name").and_then(Value::as_str).unwrap_or("").to_string()))
    });
    let list = match v.get("entries") {
        Some(Value::Array(a)) => a.clone(),
        Some(o @ Value::Object(_)) => vec![o.clone()],
        _ => Vec::new(),
    };
    let entries = list
        .into_iter()
        .filter_map(|e| serde_json::from_value::<Entry>(e).ok())
        .filter(|e| guid(&e.id) && !e.name.trim().is_empty() && is_connection(&e.kind))
        .collect();
    Ok((ds, entries))
}

/// How many items the module returned before folders and credentials were dropped.
fn raw_count(json: &str) -> usize {
    match serde_json::from_str::<Value>(json.trim()).ok().and_then(|v| v.get("entries").cloned()) {
        Some(Value::Array(a)) => a.len(),
        Some(Value::Object(_)) => 1,
        _ => 0,
    }
}

/// Devolutions Hub: the module has its own session and cannot do the browser
/// sign-in RDM did, so without an application user it sees no vault.
fn is_hub(json: &str) -> bool {
    serde_json::from_str::<Value>(json.trim()).ok()
        .and_then(|v| v.pointer("/dataSource/kind").and_then(Value::as_str).map(|k| k.to_ascii_lowercase().contains("hub")))
        .unwrap_or(false)
}

fn hub_read(ds: Option<&str>) -> String {
    let ds = ds.filter(|d| !d.trim().is_empty()).unwrap_or("Hub");
    tf("«{ds}» è un Devolutions Hub: il modulo di PowerShell non può usare l'accesso fatto in RDM e senza un utente applicazione dell'Hub non vede le connessioni. L'elenco nell'isola non è disponibile; la ricerca della card apre RDM con la ricerca già scritta.", &[("ds", &ds)])
}

/// Why a read found no connections, with what to try.
fn empty_read(ds: Option<&str>, raw: usize) -> String {
    let ds = ds.filter(|d| !d.trim().is_empty()).unwrap_or("?");
    if raw > 0 {
        return tf("Nessuna connessione in «{ds}»: il modulo ha letto {n} voci, ma sono solo cartelle o credenziali.", &[("ds", &ds), ("n", &raw)]);
    }
    tf("Nessuna connessione letta da «{ds}». Il modulo di PowerShell vede questa origine dati vuota: scegli l'origine giusta in «Origine dati» (Carica le origini). Se chiede l'accesso (Devolutions Server o Hub), in RDM salva le credenziali dell'origine con «Ricorda»; se RDM è la versione del Microsoft Store, il modulo non vede le sue origini: usa l'installer dal sito di Devolutions.", &[("ds", &ds)])
}

/// Reads the list again (every 30 minutes, "Aggiorna", a workspace chosen).
pub async fn refresh(app: &AppHandle) {
    let chosen = app
        .try_state::<crate::Shared>()
        .and_then(|s| s.settings.lock().ok().map(|g| g.integration_config.rdm_data_source.clone()))
        .unwrap_or_default();
    let chosen = if guid(&chosen) { chosen } else { String::new() };
    let script = format!("{PRELUDE}{SESSIONS}");
    let result = run(&script, &[("EASYISLAND_RDM_DS", chosen.as_str())], READ_TIMEOUT).await.and_then(|out| {
        let (ds, entries) = parse_sessions(&out)?;
        if entries.is_empty() {
            // An empty read is not "nothing to show": the module answered for a
            // workspace with nothing in it (another one, or one that asks to sign in).
            if is_hub(&out) {
                return Err(hub_read(ds.as_ref().map(|d| d.1.as_str())));
            }
            return Err(empty_read(ds.as_ref().map(|d| d.1.as_str()), raw_count(&out)));
        }
        Ok((ds, entries))
    });
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    if let Ok(mut g) = INDEX.lock() {
        let index = g.get_or_insert_with(Index::default);
        match result {
            Ok((ds, entries)) => {
                crate::log::line(format!("rdm: {} connessioni lette", entries.len()));
                index.data_source = ds;
                index.entries = entries;
                index.at = now;
                index.error = None;
            }
            // The list read before stays: better old names than none.
            Err(e) => {
                crate::log::line(format!("rdm: elenco non letto ({e})"));
                index.error = Some(e);
            }
        }
    }
    emit(app);
}

/// The card's numbers (never the list: it is asked for by search).
fn summary() -> Value {
    let g = INDEX.lock().ok();
    let index = g.as_ref().and_then(|g| g.as_ref());
    json!({
        "count": index.map(|i| i.entries.len()).unwrap_or(0),
        "dataSource": index.and_then(|i| i.data_source.as_ref().map(|d| d.1.clone())),
        "at": index.map(|i| i.at).unwrap_or(0),
        "listError": index.and_then(|i| i.error.clone()),
        "exe": exe().is_some(),
        "protocol": protocol(),
    })
}

fn emit(app: &AppHandle) {
    crate::integrations::emit(app, crate::integrations::IntegrationUpdate { id: ID, data: summary(), error: None, event: None });
}

/// The poller (integrations.rs): the list only with PowerShell 7 at hand;
/// without it, the card still searches and opens in RDM.
pub async fn poll(app: AppHandle) {
    if pwsh().is_some() {
        refresh(&app).await;
    } else {
        emit(&app);
    }
}

// ── Search ────────────────────────────────────────────────────────────────────

/// How well an entry matches every word of `query` (0 = not at all): the
/// name first, then the folder, then the host.
fn score(e: &Entry, words: &[String]) -> u32 {
    if words.is_empty() {
        return 0;
    }
    let name = e.name.to_lowercase();
    let group = e.group.to_lowercase();
    let host = e.host.to_lowercase();
    let mut total = 0;
    for w in words {
        let s = if name.starts_with(w.as_str()) {
            8
        } else if name.contains(w.as_str()) {
            6
        } else if group.split(['\\', '/']).any(|g| g.starts_with(w.as_str())) {
            4
        } else if group.contains(w.as_str()) {
            3
        } else if host.contains(w.as_str()) {
            3
        } else {
            return 0;
        };
        total += s;
    }
    total
}

fn words(query: &str) -> Vec<String> {
    query.to_lowercase().split_whitespace().filter(|w| !w.is_empty()).take(6).map(String::from).collect()
}

/// How well an entry matches any of the words (a caller's full name, a
/// ticket's company: "Mario Rossi" finds the folder "Rossi Srl").
fn loose_score(e: &Entry, words: &[String]) -> u32 {
    words.iter().filter(|w| w.chars().count() >= 3).map(|w| score(e, std::slice::from_ref(w))).sum()
}

/// The connections matching `query`, best first: every word, else (with no
/// such connection) any word of three letters or more.
pub fn search(query: &str, limit: usize) -> Vec<Entry> {
    let words = words(query);
    let Ok(g) = INDEX.lock() else { return Vec::new() };
    let Some(index) = g.as_ref() else { return Vec::new() };
    let mut found: Vec<(u32, &Entry)> = index.entries.iter().map(|e| (score(e, &words), e)).filter(|(s, _)| *s > 0).collect();
    if found.is_empty() && words.len() > 1 {
        found = index.entries.iter().map(|e| (loose_score(e, &words), e)).filter(|(s, _)| *s > 0).collect();
    }
    found.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.name.to_lowercase().cmp(&b.1.name.to_lowercase())));
    found.into_iter().take(limit.clamp(1, 50)).map(|(_, e)| e.clone()).collect()
}

/// The connections whose host is exactly this (an IP or a name selected).
pub fn by_host(host: &str) -> Vec<Entry> {
    let h = host.trim().to_lowercase();
    let Ok(g) = INDEX.lock() else { return Vec::new() };
    g.as_ref()
        .map(|i| i.entries.iter().filter(|e| {
            let eh = e.host.to_lowercase();
            eh == h || eh.split(':').next() == Some(h.as_str())
        }).take(10).cloned().collect())
        .unwrap_or_default()
}

// ── Opening, editing, searching in RDM ───────────────────────────────────────

/// A GUID as RDM writes them (with or without braces).
fn guid(s: &str) -> bool {
    let s = s.trim_matches(['{', '}']);
    s.len() == 36 && s.chars().enumerate().all(|(i, c)| if [8, 13, 18, 23].contains(&i) { c == '-' } else { c.is_ascii_hexdigit() })
}

/// A host for a quick connection: a name or an address, nothing else.
fn valid_host(h: &str) -> bool {
    !h.is_empty() && h.len() <= 253 && h.chars().all(|c| c.is_ascii_alphanumeric() || ".-_:[]".contains(c))
}

/// Text for RDM's search: one line, no quotes, at most 100 characters.
fn clean_filter(text: &str) -> String {
    text.split_whitespace().collect::<Vec<_>>().join(" ").chars().filter(|c| !matches!(c, '"' | '&' | '?' | '=' | '%' | '^')).take(100).collect()
}

fn data_source_id() -> Option<String> {
    INDEX.lock().ok().and_then(|g| g.as_ref().and_then(|i| i.data_source.as_ref().map(|d| d.0.clone())))
}

/// What to ask RDM (pure, tested): the exe's arguments and the same as an rdm:// link.
#[derive(Debug, PartialEq)]
pub enum Ask {
    Open { data_source: Option<String>, repository: Option<String>, session: String },
    Edit { data_source: Option<String>, repository: Option<String>, session: String },
    Filter(String),
    Quick { kind: String, host: String },
}

impl Ask {
    fn args(&self) -> Vec<String> {
        let ds = |d: &Option<String>| d.as_ref().map(|d| format!("/DataSource:{d}"));
        match self {
            // An entry in a vault goes through the link, which names the vault.
            Ask::Open { repository: Some(_), .. } => Vec::new(),
            Ask::Open { data_source, session, .. } => ds(data_source).into_iter().chain([format!("/Session:{session}")]).collect(),
            // The exe has no "edit": that goes through the link.
            Ask::Edit { .. } => Vec::new(),
            Ask::Filter(text) => vec![format!("/Filter:{text}")],
            Ask::Quick { kind, host } => vec![format!("/Template:{kind}"), format!("/Host:{host}")],
        }
    }

    fn link(&self) -> String {
        let enc = |s: &str| s.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-_.~:[]".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect::<String>();
        let ds = |d: &Option<String>, r: &Option<String>| {
            d.as_ref().map(|d| format!("DataSource={}&", enc(d))).unwrap_or_default()
                + &r.as_ref().map(|r| format!("Repository={}&", enc(r))).unwrap_or_default()
        };
        match self {
            Ask::Open { data_source, repository, session } => format!("rdm://open?{}Session={}", ds(data_source, repository), enc(session)),
            Ask::Edit { data_source, repository, session } => format!("rdm://edit?{}Session={}", ds(data_source, repository), enc(session)),
            Ask::Filter(text) => format!("rdm://open?Filter={}", enc(text)),
            Ask::Quick { kind, host } => format!("rdm://open?Template={}&Host={}", enc(kind), enc(host)),
        }
    }
}

/// Asks RDM: with the exe when it takes the request, else the rdm:// link.
fn ask(what: &Ask) -> Result<(), String> {
    let args = what.args();
    if let (Some(exe), false) = (exe(), args.is_empty()) {
        std::process::Command::new(exe)
            .args(&args)
            .spawn()
            .map(|_| ())
            .map_err(|e| tf("Remote Desktop Manager non si avvia: {e}", &[("e", &e)]))?;
        return Ok(());
    }
    if !protocol() && exe().is_none() {
        return Err(t("Remote Desktop Manager non è installato su questo PC.").into());
    }
    std::process::Command::new("explorer.exe")
        .arg(what.link())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map(|_| ())
        .map_err(|e| e.to_string())
}

pub fn open(session: &str) -> Result<(), String> {
    if !guid(session) {
        return Err(t("Connessione di RDM non valida").into());
    }
    ask(&Ask::Open { data_source: data_source_id(), repository: repository_of(session), session: session.to_string() })
}

pub fn edit(session: &str) -> Result<(), String> {
    if !guid(session) {
        return Err(t("Connessione di RDM non valida").into());
    }
    ask(&Ask::Edit { data_source: data_source_id(), repository: repository_of(session), session: session.to_string() })
}

/// The vault an entry was read from, if any.
fn repository_of(session: &str) -> Option<String> {
    let g = INDEX.lock().ok()?;
    g.as_ref()?.entries.iter().find(|e| e.id == session).map(|e| e.repository.clone()).filter(|r| guid(r))
}

/// RDM opened with its search filled in.
pub fn filter(text: &str) -> Result<(), String> {
    ask(&Ask::Filter(clean_filter(text)))
}

/// A connection made on the fly (not saved in RDM): RDP, SSH or VNC to a host.
pub fn quick(kind: &str, host: &str) -> Result<(), String> {
    let kind = match kind.to_ascii_uppercase().as_str() {
        "SSH" => "SSH",
        "VNC" => "VNC",
        _ => "RDP",
    };
    let host = host.trim();
    if !valid_host(host) {
        return Err(t("Indirizzo non valido").into());
    }
    ask(&Ask::Quick { kind: kind.into(), host: host.into() })
}

/// The island's "Apri" on the card: RDM itself.
pub fn open_app() -> bool {
    match exe() {
        Some(p) => std::process::Command::new(p).spawn().is_ok(),
        None => protocol() && std::process::Command::new("explorer.exe").arg("rdm://open").creation_flags(CREATE_NO_WINDOW).spawn().is_ok(),
    }
}

// ── The settings ──────────────────────────────────────────────────────────────

/// Impostazioni → Remote Desktop Manager: what is there and what is missing.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    exe: Option<String>,
    protocol: bool,
    pwsh: Option<String>,
    module: Option<String>,
    count: usize,
    data_source: Option<String>,
    list_error: Option<String>,
}

pub async fn status() -> Status {
    let module = if pwsh().is_some() { module_version().await } else { None };
    let g = INDEX.lock().ok();
    let index = g.as_ref().and_then(|g| g.as_ref());
    Status {
        exe: exe().map(|p| p.to_string_lossy().into_owned()),
        protocol: protocol(),
        pwsh: pwsh().map(|p| p.to_string_lossy().into_owned()),
        module,
        count: index.map(|i| i.entries.len()).unwrap_or(0),
        data_source: index.and_then(|i| i.data_source.as_ref().map(|d| d.1.clone())),
        list_error: index.and_then(|i| i.error.clone()),
    }
}

/// The workspaces RDM knows on this PC (for the settings' choice).
pub async fn data_sources() -> Result<Vec<Value>, String> {
    let out = run(&format!("{PRELUDE}{DATA_SOURCES}"), &[], READ_TIMEOUT).await?;
    let v: Value = serde_json::from_str(out.trim()).map_err(|_| t("Risposta del modulo di RDM non leggibile.").to_string())?;
    Ok(match v {
        Value::Array(a) => a,
        o @ Value::Object(_) => vec![o],
        _ => Vec::new(),
    }
    .into_iter()
    .filter(|d| d.get("id").and_then(Value::as_str).is_some_and(guid))
    .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    const A: &str = "178c2fda-dab4-4f41-98df-6e3205c0a011";
    const B: &str = "474bcbcf-d507-435b-8c0a-a9e868781910";

    #[test]
    fn the_modules_json_becomes_entries() {
        let out = format!(r#"{{"dataSource":{{"id":"{A}","name":"Ufficio"}},"entries":[
            {{"id":"{B}","name":"NAS Rossi","group":"Clienti\\Rossi Srl","host":"192.168.1.10","kind":"RDPConfigured"}},
            {{"id":"{A}","name":"Rossi Srl","group":"Clienti","host":"","kind":"Group"}},
            {{"id":"{A}","name":"Admin","group":"","host":"","kind":"Credential"}},
            {{"id":"nope","name":"Rotto","group":"","host":"","kind":"SSHShell"}}
        ]}}"#);
        let (ds, e) = parse_sessions(&out).unwrap();
        assert_eq!(ds, Some((A.to_string(), "Ufficio".to_string())));
        assert_eq!(e.len(), 1);
        assert_eq!(e[0].group, "Clienti\\Rossi Srl");
        // One entry alone comes as an object, not a list.
        let one = format!(r#"{{"dataSource":{{"id":"","name":""}},"entries":{{"id":"{B}","name":"Router","kind":"SSHShell"}}}}"#);
        let (ds, e) = parse_sessions(&one).unwrap();
        assert_eq!(ds, None);
        assert_eq!(e[0].host, "");
        assert!(parse_sessions("Import-Module: …").is_err());
        assert!(is_hub(r#"{"dataSource":{"id":"x","name":"EasyTech","kind":"Hub"},"entries":[]}"#));
        assert!(!is_hub(r#"{"dataSource":{"id":"x","name":"Locale","kind":"SQLite"},"entries":[]}"#));
    }

    #[test]
    fn search_by_name_folder_and_host() {
        let e = |name: &str, group: &str, host: &str| Entry { id: B.into(), name: name.into(), group: group.into(), host: host.into(), kind: "RDPConfigured".into(), repository: String::new() };
        let nas = e("NAS", "Clienti\\Rossi Srl", "192.168.1.10");
        let srv = e("Server Rossi", "Clienti\\Rossi Srl", "srv01.rossi.local");
        let other = e("NAS", "Clienti\\Bianchi", "10.0.0.2");
        let w = words("rossi nas");
        assert!(score(&nas, &w) > 0);
        assert_eq!(score(&other, &w), 0);
        assert!(score(&srv, &words("rossi")) > score(&nas, &words("rossi")));
        assert!(score(&nas, &words("192.168")) > 0);
        assert_eq!(score(&nas, &[]), 0);
        // A caller's name: no entry has both words, one has "Rossi".
        assert_eq!(score(&srv, &words("mario rossi")), 0);
        assert!(loose_score(&srv, &words("mario rossi")) > 0);
        assert_eq!(loose_score(&other, &words("mario rossi")), 0);
    }

    #[test]
    fn requests_to_rdm() {
        let vault = Ask::Open { data_source: Some(A.into()), repository: Some(A.into()), session: B.into() };
        assert!(vault.args().is_empty());
        assert_eq!(vault.link(), format!("rdm://open?DataSource={A}&Repository={A}&Session={B}"));
        let open = Ask::Open { data_source: Some(A.into()), repository: None, session: B.into() };
        assert_eq!(open.args(), vec![format!("/DataSource:{A}"), format!("/Session:{B}")]);
        assert_eq!(open.link(), format!("rdm://open?DataSource={A}&Session={B}"));
        let edit = Ask::Edit { data_source: None, repository: None, session: B.into() };
        assert!(edit.args().is_empty());
        assert_eq!(edit.link(), format!("rdm://edit?Session={B}"));
        assert_eq!(Ask::Filter("rossi nas".into()).link(), "rdm://open?Filter=rossi%20nas");
        assert_eq!(Ask::Quick { kind: "RDP".into(), host: "10.0.0.5".into() }.args(), vec!["/Template:RDP", "/Host:10.0.0.5"]);
        assert_eq!(clean_filter("  a \"b\" & c?  "), "a b  c");
        assert!(guid(A) && guid(&format!("{{{A}}}")) && !guid("x") && !guid("178c2fda-dab4-4f41-98df-6e3205c0a01z"));
        assert!(valid_host("srv01.rossi.local") && valid_host("10.0.0.5:3389") && valid_host("[fe80::1]"));
        assert!(!valid_host("a b") && !valid_host("x;calc") && !valid_host(""));
    }

    #[test]
    fn folders_and_credentials_are_not_connections() {
        assert!(is_connection("RDPConfigured") && is_connection("SSHShell") && is_connection("WebBrowser"));
        assert!(!is_connection("Group") && !is_connection("Credential") && !is_connection("CredentialEntry"));
    }

    #[test]
    fn scripts_go_encoded() {
        // "ab" in UTF-16LE is 61 00 62 00.
        assert_eq!(encoded("ab"), "YQBiAA==");
        assert!(SESSIONS.contains("Get-RDMSession") && !SESSIONS.to_lowercase().contains("password"));
    }

    /// With RDM and the module on this PC:
    /// `cargo test --lib rdm::tests::live -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live() {
        println!("exe: {:?}", exe());
        println!("rdm://: {}", protocol());
        println!("pwsh: {:?}", pwsh());
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        println!("modulo: {:?}", rt.block_on(module_version()));
        println!("origini: {:?}", rt.block_on(data_sources()).map(|l| l.len()));
        let out = rt.block_on(run(&format!("{PRELUDE}{SESSIONS}"), &[("EASYISLAND_RDM_DS", "")], READ_TIMEOUT));
        match out.and_then(|o| parse_sessions(&o)) {
            Ok((ds, e)) => println!("origine {:?}: {} connessioni; tipi: {:?}", ds.map(|d| d.1), e.len(),
                e.iter().map(|x| x.kind.as_str()).collect::<std::collections::BTreeSet<_>>()),
            Err(e) => println!("errore: {e}"),
        }
    }
}
