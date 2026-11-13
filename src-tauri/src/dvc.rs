// Devolutions Cloud / Devolutions Hub inside the Remote Desktop Manager
// integration (asked by Edoardo on 4 November 2026, from @claudio's tests on
// the work PC, docs/idee.md → Devolutions Cloud). RDM's own module and MCP do
// not see the cloud vaults; the Hub cmdlets of `Devolutions.PowerShell` do,
// with an Application identity (Is enabled, Can access user vaults, no admin).
//
// - Address, Application Key and Secret: Impostazioni → Remote Desktop
//   Manager, kept in the Credential Manager (`dvc-url`, `dvc-key`,
//   `dvc-secret`); they reach PowerShell as environment variables of that one
//   process, cleared as soon as it has connected. One identity per PC.
// - Reading («Sincronizza»): vaults and entries with name, type, folder, host,
//   user name and id, never a password; kept encrypted for this Windows user
//   (`dvc-cache.bin`, DPAPI). The connections join RDM's search.
// - A password goes only to the clipboard, marked private (no Windows history,
//   no cloud clipboard, not in EasyIsland's Appunti), and is emptied after
//   `CLIP_SECONDS` if nothing else was copied meanwhile. Never on screen, never
//   to a chat engine, never in the log.
// - Writing: a credential or a «Lista Password» made from a folder's
//   credentials, after a preview and a click in the island; then read back with
//   the passwords resolved and compared (only right/wrong comes out). The
//   password goes to the Hub in clear: the Hub encrypts it when saving.
// - Nothing is ever deleted.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::i18n::{t, tf};
use crate::rdm::{guid, run, PRELUDE, READ_TIMEOUT};

/// Seconds a copied password stays on the clipboard.
pub const CLIP_SECONDS: u64 = 30;

/// Connects with the identity from the environment, then forgets it.
const CONNECT: &str = "$u = $env:EASYISLAND_DVC_URL; $k = $env:EASYISLAND_DVC_KEY; $s = $env:EASYISLAND_DVC_SECRET\n$env:EASYISLAND_DVC_KEY = $null; $env:EASYISLAND_DVC_SECRET = $null\nConnect-HubAccount -Url $u -ApplicationKey $k -ApplicationSecret $s | Out-Null\n$s = $null; $k = $null\n";

/// Every vault but the System Vault, and every entry of each (no secrets).
const READ: &str = r#"$vaults = @(Get-HubVault | Where-Object { $_.Name -ne 'System Vault' })
$list = @(foreach ($v in $vaults) {
  $vid = [string]$v.Id
  foreach ($e in @(Get-HubEntry -VaultId $vid)) {
    $c = $e.Connection
    $kind = [string]$c.ConnectionType
    $path = [string]$c.Group
    $folder = if ($kind -eq 'Group') { ($path -split '\\' | Select-Object -SkipLast 1) -join '\' } else { $path }
    $h = if ($c.Host) { [string]$c.Host } elseif ($c.Url) { [string]$c.Url } else { '' }
    [pscustomobject]@{ id = [string]$c.ID; name = [string]$c.Name; kind = $kind; folder = $folder; path = $path; host = $h; user = [string]$c.Credentials.UserName; cred = [string]$c.Credentials.CredentialType; vault = $vid }
  }
})
ConvertTo-Json -InputObject ([pscustomobject]@{ vaults = @($vaults | ForEach-Object { [pscustomobject]@{ id = [string]$_.Id; name = [string]$_.Name } }); entries = $list }) -Compress -Depth 4"#;

/// An entry's user, domain, password and address wherever its type keeps
/// them: a credential in `Credentials`, an RDP/SSH/web/VNC connection in its
/// own settings; a connection that uses another credential entry
/// (`CredentialConnectionID`) reads that one (asked by Edoardo on 4 Nov 2026:
/// the details showed only the description). Sets `$e`, `$c`, `$cr`, `$k`, `$linked`.
const CREDS: &str = r#"function Pick($objs, [string[]]$names) {
  foreach ($o in $objs) {
    if ($null -eq $o) { continue }
    foreach ($n in $names) { $p = $o.PSObject.Properties[$n]; if ($p -and $p.Value -is [string] -and $p.Value) { return [string]$p.Value } }
  }
  return ''
}
function Creds($c) {
  $parts = @($c.Credentials, $c.RDP, $c.Terminal, $c.Web, $c.WebBrowser, $c.VNC, $c.SSHShell, $c.FTP, $c)
  [pscustomobject]@{
    user = Pick $parts @('UserName', 'Username', 'User', 'Login')
    domain = Pick $parts @('Domain')
    password = Pick $parts @('Password', 'ClearPassword')
    url = Pick @($c.Web, $c.WebBrowser, $c) @('URL', 'Url')
  }
}
$e = Get-HubEntryResolved -VaultId $env:EASYISLAND_DVC_VAULT -EntryId $env:EASYISLAND_DVC_ENTRY -ResolvePasswords
$c = $e.Connection; $cr = $c.Credentials
$k = Creds $c
$linked = ''
$lid = [string]$c.CredentialConnectionID
if (-not $k.user -and -not $k.password -and $lid -and $lid -ne '00000000-0000-0000-0000-000000000000' -and $lid -ne [string]$c.ID) {
  try {
    $l = Get-HubEntryResolved -VaultId $env:EASYISLAND_DVC_VAULT -EntryId $lid -ResolvePasswords -ErrorAction Stop
    $k = Creds $l.Connection; $linked = [string]$l.Connection.Name
  } catch {}
}
"#;

/// One entry's details: password and rows only as their length.
const DETAILS: &str = r#"$rows = @()
if ([string]$cr.CredentialType -eq 'PasswordList') {
  $rows = @($cr.PasswordList | ForEach-Object { [pscustomobject]@{ name = [string]$_.Name; host = [string]$_.Host; user = [string]$_.User; domain = [string]$_.Domain; length = ([string]$_.Password).Length; description = [string]$_.Description } })
}
ConvertTo-Json -InputObject ([pscustomobject]@{ name = [string]$c.Name; kind = [string]$c.ConnectionType; cred = [string]$cr.CredentialType; folder = [string]$c.Group; host = [string]$c.Host; url = $k.url; user = $k.user; domain = $k.domain; length = ([string]$k.password).Length; linked = $linked; description = [string]$c.Description; rows = $rows }) -Compress -Depth 4"#;

/// One password (of the entry, or of row EASYISLAND_DVC_ROW of a list), for the clipboard or the eye.
const PASSWORD: &str = r#"$p = if ($env:EASYISLAND_DVC_ROW) { $r = @($cr.PasswordList)[[int]$env:EASYISLAND_DVC_ROW]; if ($r) { [string]$r.Password } else { '' } } else { [string]$k.password }
ConvertTo-Json -InputObject ([pscustomobject]@{ p = $p }) -Compress"#;

/// A new entry object in folder EASYISLAND_DVC_PARENT (as DevolutionsCloud.psm1 New-DVCEntryObject).
const NEW_ENTRY: &str = r#"function New-Entry([string]$Name, [string]$Folder, [string]$Parent) {
  $conn = New-Object Devolutions.RemoteDesktopManager.Business.Connection
  $conn.ID = [guid]::NewGuid()
  $conn.ConnectionType = [Devolutions.RemoteDesktopManager.ConnectionType]::Credential
  $conn.Name = $Name
  $conn.Group = $Folder
  $meta = New-Object Devolutions.Hub.PowerShell.Entities.Hub.PSEntryMetadata
  $meta.Name = $Name
  $meta.ConnectionType = [int][Devolutions.RemoteDesktopManager.ConnectionType]::Credential
  $meta.ParentId = [guid]$Parent
  $entry = New-Object Devolutions.Hub.PowerShell.Entities.Hub.PSDecryptedEntry
  $entry.Connection = $conn
  $entry.PsMetadata = $meta
  $entry
}
function Assert-Free([string]$Vault, [string]$Folder, [string]$Name) {
  foreach ($x in @(Get-HubEntry -VaultId $Vault)) {
    $c = $x.Connection
    if ([string]$c.ConnectionType -ne 'Group' -and [string]$c.Group -eq $Folder -and [string]$c.Name -eq $Name) { throw "EASYISLAND_DUPLICATE" }
  }
}
"#;

/// A credential: user, domain, password (in clear: the Hub encrypts it), read back and compared.
const NEW_CREDENTIAL: &str = r#"$vault = $env:EASYISLAND_DVC_VAULT; $folder = $env:EASYISLAND_DVC_FOLDER; $name = $env:EASYISLAND_DVC_NAME
$pw = $env:EASYISLAND_DVC_PW; $env:EASYISLAND_DVC_PW = $null
Assert-Free $vault $folder $name
$entry = New-Entry $name $folder $env:EASYISLAND_DVC_PARENT
$cr = $entry.Connection.Credentials
$cr.UserName = $env:EASYISLAND_DVC_USER
$cr.Domain = $env:EASYISLAND_DVC_DOMAIN
if ($pw) { $cr.Password = $pw }
$entry.Connection.Description = $env:EASYISLAND_DVC_DESC
New-HubEntry -VaultId $vault -PSDecryptedEntry $entry | Out-Null
$id = [string]$entry.Connection.ID
$chk = Get-HubEntryResolved -VaultId $vault -EntryId $id -ResolvePasswords
$ok = if ($pw) { [string]$chk.Connection.Credentials.Password -ceq $pw } else { $true }
$pw = $null
ConvertTo-Json -InputObject ([pscustomobject]@{ id = $id; rows = @([pscustomobject]@{ row = $name; userOk = ([string]$chk.Connection.Credentials.UserName -ceq [string]$env:EASYISLAND_DVC_USER); passwordOk = $ok }) }) -Compress -Depth 4"#;

/// A «Lista Password» from the credentials EASYISLAND_DVC_SOURCES, checked row by row.
const NEW_LIST: &str = r#"$vault = $env:EASYISLAND_DVC_VAULT; $folder = $env:EASYISLAND_DVC_FOLDER; $name = $env:EASYISLAND_DVC_NAME
Assert-Free $vault $folder $name
$src = @(foreach ($id in ($env:EASYISLAND_DVC_SOURCES -split ',')) { if ($id) { Get-HubEntryResolved -VaultId $vault -EntryId $id -ResolvePasswords } })
$src = @($src | Where-Object { [string]$_.Connection.Credentials.CredentialType -ne 'PasswordList' } | Sort-Object { $_.Connection.Name })
if ($src.Count -eq 0) { throw "EASYISLAND_NOSOURCE" }
$items = New-Object System.Collections.Generic.List[Devolutions.RemoteDesktopManager.Business.PasswordListItem]
$prio = 0
foreach ($e in $src) {
  $c = $e.Connection; $cr = $c.Credentials
  $i = New-Object Devolutions.RemoteDesktopManager.Business.PasswordListItem
  $i.Name = $c.Name; $i.Host = $c.Host; $i.User = $cr.UserName; $i.Domain = $cr.Domain
  $i.Password = $cr.Password
  $i.Description = $c.Description
  $i.SortPriority = $prio++
  $items.Add($i)
}
$entry = New-Entry $name $folder $env:EASYISLAND_DVC_PARENT
$entry.Connection.Credentials.CredentialType = [Devolutions.RemoteDesktopManager.CredentialResolverConnectionType]::PasswordList
$entry.Connection.Credentials.PasswordList = $items.ToArray()
New-HubEntry -VaultId $vault -PSDecryptedEntry $entry | Out-Null
$newId = [string]$entry.Connection.ID
$chk = Get-HubEntryResolved -VaultId $vault -EntryId $newId -ResolvePasswords
$rows = @(foreach ($e in $src) {
  $r = @($chk.Connection.Credentials.PasswordList | Where-Object { $_.Name -eq $e.Connection.Name })[0]
  [pscustomobject]@{ row = [string]$e.Connection.Name; userOk = ([string]$r.User -ceq [string]$e.Connection.Credentials.UserName); passwordOk = ([string]$r.Password -ceq [string]$e.Connection.Credentials.Password) }
})
ConvertTo-Json -InputObject ([pscustomobject]@{ id = $newId; rows = $rows }) -Compress -Depth 4"#;

// ── Connection and the list ───────────────────────────────────────────────────

/// Address, key and secret from the Credential Manager.
fn identity() -> Result<(String, String, String), String> {
    let url = crate::secrets::get("dvc-url").unwrap_or_default().trim().trim_end_matches('/').to_string();
    if !url.starts_with("https://") {
        return Err(t("Scrivi l'indirizzo di Devolutions Cloud (https://…) in Impostazioni → Remote Desktop Manager").into());
    }
    let key = crate::secrets::get("dvc-key").map(|k| k.trim().to_string()).filter(|k| !k.is_empty());
    let secret = crate::secrets::get("dvc-secret").filter(|s| !s.is_empty());
    match (key, secret) {
        (Some(k), Some(s)) => Ok((url, k, s)),
        _ => Err(t("Incolla Application Key e Application Secret in Impostazioni → Remote Desktop Manager").into()),
    }
}

/// Devolutions Cloud chosen in the settings, with its address, key and secret saved.
pub fn on() -> bool {
    let chosen = crate::brain_watch::app()
        .and_then(|app| tauri::Manager::try_state::<crate::Shared>(app).map(|s| s.settings.lock().unwrap().integration_config.dvc_on))
        .unwrap_or(false);
    chosen && identity().is_ok()
}

/// A script with the Hub connected; `env` reaches it as $env:… (ids, names, the password to write).
async fn hub(script: &str, env: &[(&str, &str)]) -> Result<String, String> {
    let (url, key, secret) = identity()?;
    let mut all: Vec<(&str, &str)> = vec![("EASYISLAND_DVC_URL", &url), ("EASYISLAND_DVC_KEY", &key), ("EASYISLAND_DVC_SECRET", &secret)];
    all.extend_from_slice(env);
    run(&format!("{PRELUDE}{CONNECT}{script}"), &all, READ_TIMEOUT).await.map_err(|e| hub_problem(&e))
}

/// RDM's wording of an error, for the cloud.
fn hub_problem(e: &str) -> String {
    let low = e.to_lowercase();
    if low.contains("easyisland_duplicate") {
        return t("Esiste già una voce con questo nome nella cartella: scegli un altro nome.").into();
    }
    if low.contains("easyisland_nosource") {
        return t("Nella cartella non ci sono credenziali da unire.").into();
    }
    if low.contains("401") || low.contains("unauthorized") || low.contains("invalid_client") || low.contains("application key") {
        return t("Devolutions Cloud ha rifiutato l'accesso: controlla indirizzo, Application Key e Secret, e che l'identità sia abilitata.").into();
    }
    if low.contains("403") || low.contains("forbidden") || low.contains("permission") {
        return t("L'identità non ha il permesso: in Devolutions Cloud dalle i permessi sul vault, o «Can access user vaults» per il vault personale.").into();
    }
    match e.strip_prefix("RDM: ") {
        Some(rest) => format!("Devolutions Cloud: {rest}"),
        None => e.to_string(),
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Vault {
    pub id: String,
    pub name: String,
}

/// An entry of a vault, without any secret.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Item {
    pub id: String,
    pub name: String,
    /// RDM's type: Group (a folder), Credential, RDPConfigured, SSHShell…
    #[serde(default)]
    pub kind: String,
    /// The folder it is in ("Easytech\\CLIENTE").
    #[serde(default)]
    pub folder: String,
    /// For a folder, its own path (folder + name).
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub host: String,
    #[serde(default)]
    pub user: String,
    /// The credential's kind: Default, PasswordList…
    #[serde(default)]
    pub cred: String,
    pub vault: String,
}

#[derive(Default, Serialize, Deserialize)]
struct Index {
    vaults: Vec<Vault>,
    entries: Vec<Item>,
    /// Seconds since 1970 of the last good read.
    at: i64,
    #[serde(skip)]
    error: Option<String>,
}

static INDEX: Mutex<Option<Index>> = Mutex::new(None);

/// The read's JSON → vaults and entries (a missing or odd id dropped).
fn parse_read(json: &str) -> Result<(Vec<Vault>, Vec<Item>), String> {
    let v: Value = serde_json::from_str(json.trim()).map_err(|_| t("Risposta di Devolutions Cloud non leggibile.").to_string())?;
    let list = |k: &str| match v.get(k) {
        Some(Value::Array(a)) => a.clone(),
        Some(o @ Value::Object(_)) => vec![o.clone()],
        _ => Vec::new(),
    };
    let vaults: Vec<Vault> = list("vaults").into_iter().filter_map(|x| serde_json::from_value::<Vault>(x).ok()).filter(|x| guid(&x.id)).collect();
    let entries = list("entries")
        .into_iter()
        .filter_map(|x| serde_json::from_value::<Item>(x).ok())
        .filter(|x| guid(&x.id) && guid(&x.vault) && !x.name.trim().is_empty())
        .collect();
    Ok((vaults, entries))
}

fn cache_path() -> std::path::PathBuf {
    crate::settings::config_dir().join("dvc-cache.bin")
}

fn save_cache(index: &Index) {
    let Ok(json) = serde_json::to_vec(index) else { return };
    match crate::secrets::dpapi(&json, true) {
        Some(sealed) => {
            if let Err(e) = crate::settings::write_atomic(&cache_path(), &sealed) {
                crate::log::line(format!("dvc: elenco non salvato ({e})"));
            }
        }
        None => crate::log::line("dvc: elenco non cifrato, non salvato"),
    }
}

fn load_cache() {
    let Ok(mut g) = INDEX.lock() else { return };
    if g.as_ref().is_some_and(|i| i.at > 0) {
        return;
    }
    let Some(cache) = std::fs::read(cache_path()).ok().and_then(|b| crate::secrets::dpapi(&b, false)).and_then(|j| serde_json::from_slice::<Index>(&j).ok()) else { return };
    *g = Some(cache);
}

/// Reads the vaults again («Sincronizza» of RDM, or after a write).
pub async fn refresh() {
    let result = hub(READ, &[]).await.and_then(|out| parse_read(&out));
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0);
    load_cache();
    let Ok(mut g) = INDEX.lock() else { return };
    let index = g.get_or_insert_with(Index::default);
    match result {
        Ok((vaults, entries)) => {
            crate::log::line(format!("dvc: {} voci lette da {} vault", entries.len(), vaults.len()));
            index.error = if vaults.is_empty() {
                Some(t("Nessun vault visibile: dai i permessi sul vault all'identità, o «Can access user vaults» per il vault personale.").into())
            } else {
                None
            };
            index.vaults = vaults;
            index.entries = entries;
            index.at = now;
            save_cache(index);
        }
        Err(e) => {
            crate::log::line(format!("dvc: elenco non letto ({e})"));
            index.error = Some(e);
        }
    }
}

/// The cloud's connections, as RDM's own entries (search, open).
pub fn connections() -> Vec<crate::rdm::Entry> {
    if !on() {
        return Vec::new();
    }
    load_cache();
    let Ok(g) = INDEX.lock() else { return Vec::new() };
    g.as_ref()
        .map(|i| {
            i.entries
                .iter()
                .filter(|e| crate::rdm::is_connection(&e.kind))
                .map(|e| crate::rdm::Entry { id: e.id.clone(), name: e.name.clone(), group: e.folder.clone(), host: e.host.clone(), kind: e.kind.clone(), repository: e.vault.clone() })
                .collect()
        })
        .unwrap_or_default()
}

/// The island's search field (src/views/search.ts) and the RDM card's: every
/// entry — folders, connections, credentials, password lists — whose name,
/// folder, user or host has every word typed (asked by Edoardo on 4 Nov 2026:
/// the cloud's folders too, and all of it). Best first: name, then the rest.
pub fn search(query: &str, limit: usize) -> Vec<Item> {
    if !on() {
        return Vec::new();
    }
    let words: Vec<String> = query.to_lowercase().split_whitespace().take(6).map(String::from).collect();
    if words.is_empty() {
        return Vec::new();
    }
    load_cache();
    let Ok(g) = INDEX.lock() else { return Vec::new() };
    let Some(index) = g.as_ref() else { return Vec::new() };
    let mut found: Vec<(u32, &Item)> = index
        .entries
        .iter()
        .filter_map(|e| {
            let (name, rest) = (e.name.to_lowercase(), format!("{} {} {}", e.folder, e.user, e.host).to_lowercase());
            let mut total = 0;
            for w in &words {
                total += if name.starts_with(w.as_str()) { 6 } else if name.contains(w.as_str()) { 4 } else if rest.contains(w.as_str()) { 2 } else { return None };
            }
            // A folder named like the words first: «rossi» → the customer's folder.
            if e.kind == "Group" {
                total += 1;
            }
            Some((total, e))
        })
        .collect();
    found.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.name.to_lowercase().cmp(&b.1.name.to_lowercase())));
    found.into_iter().take(limit.clamp(1, 50)).map(|(_, e)| e.clone()).collect()
}

/// For the card and the settings: on, how many entries, vaults, when, the error.
pub fn summary() -> Value {
    if !on() {
        return json!({ "on": false });
    }
    load_cache();
    let g = INDEX.lock().ok();
    let i = g.as_ref().and_then(|g| g.as_ref());
    json!({
        "on": true,
        "count": i.map(|i| i.entries.iter().filter(|e| e.kind != "Group").count()).unwrap_or(0),
        "vaults": i.map(|i| i.vaults.clone()).unwrap_or_default(),
        "at": i.map(|i| i.at).unwrap_or(0),
        "error": i.and_then(|i| i.error.clone()),
    })
}

/// «Prova»: connects and lists the vaults, without touching the saved list.
pub async fn test() -> Result<Vec<Vault>, String> {
    let out = hub("ConvertTo-Json -InputObject @(Get-HubVault | ForEach-Object { [pscustomobject]@{ id = [string]$_.Id; name = [string]$_.Name } }) -Compress", &[]).await?;
    let v: Value = serde_json::from_str(out.trim()).map_err(|_| t("Risposta di Devolutions Cloud non leggibile.").to_string())?;
    let list = match v {
        Value::Array(a) => a,
        o @ Value::Object(_) => vec![o],
        _ => Vec::new(),
    };
    Ok(list.into_iter().filter_map(|x| serde_json::from_value::<Vault>(x).ok()).collect())
}

// ── Browsing the folders ──────────────────────────────────────────────────────

fn norm(path: &str) -> String {
    path.replace('/', "\\").trim_matches('\\').to_string()
}

fn same(a: &str, b: &str) -> bool {
    norm(a).eq_ignore_ascii_case(&norm(b))
}

/// The folder right under `parent` that `folder` is in (or is), if any.
fn child_of(parent: &str, folder: &str) -> Option<String> {
    let (p, f) = (norm(parent), norm(folder));
    let rest = if p.is_empty() {
        f.as_str()
    } else {
        let head = f.get(..p.len())?;
        if !head.eq_ignore_ascii_case(&p) {
            return None;
        }
        f.get(p.len()..)?.strip_prefix('\\')?
    };
    rest.split('\\').next().filter(|s| !s.is_empty()).map(str::to_string)
}

#[derive(Serialize, Debug)]
pub struct Folder {
    pub name: String,
    pub path: String,
    /// Entries in it and below (folders not counted).
    pub count: usize,
}

#[derive(Serialize)]
pub struct Browse {
    pub vault: String,
    pub path: String,
    pub vaults: Vec<Vault>,
    pub folders: Vec<Folder>,
    pub entries: Vec<Item>,
}

fn browse_in(index: &Index, vault: &str, path: &str) -> Browse {
    let path = norm(path);
    let in_vault: Vec<&Item> = index.entries.iter().filter(|e| e.vault == vault).collect();
    let mut folders: Vec<Folder> = Vec::new();
    for e in &in_vault {
        let at = if e.kind == "Group" { e.path.as_str() } else { e.folder.as_str() };
        if let Some(name) = child_of(&path, at) {
            let full = if path.is_empty() { name.clone() } else { format!("{path}\\{name}") };
            let counted = e.kind != "Group";
            match folders.iter_mut().find(|f| f.name.eq_ignore_ascii_case(&name)) {
                Some(f) => f.count += usize::from(counted),
                None => folders.push(Folder { name, path: full, count: usize::from(counted) }),
            }
        }
    }
    folders.sort_by_key(|f| f.name.to_lowercase());
    let mut entries: Vec<Item> = in_vault.into_iter().filter(|e| e.kind != "Group" && same(&e.folder, &path)).cloned().collect();
    entries.sort_by_key(|e| e.name.to_lowercase());
    Browse { vault: vault.to_string(), path, vaults: index.vaults.clone(), folders, entries }
}

/// A folder of a vault (the first vault when none is given).
pub fn browse(vault: &str, path: &str) -> Browse {
    load_cache();
    let g = INDEX.lock().ok();
    let empty = Index::default();
    let index = g.as_ref().and_then(|g| g.as_ref()).unwrap_or(&empty);
    let vault = if index.vaults.iter().any(|v| v.id == vault) { vault.to_string() } else { index.vaults.first().map(|v| v.id.clone()).unwrap_or_default() };
    browse_in(index, &vault, path)
}

/// Folders whose path has every word (for the chat and to tie a customer).
fn find_folders(index: &Index, query: &str, max: usize) -> Vec<(String, String)> {
    let words: Vec<String> = query.to_lowercase().split_whitespace().map(String::from).collect();
    let mut out: Vec<(String, String)> = index
        .entries
        .iter()
        .filter(|e| e.kind == "Group")
        .filter(|e| { let p = e.path.to_lowercase(); !words.is_empty() && words.iter().all(|w| p.contains(w.as_str())) })
        .map(|e| (e.vault.clone(), norm(&e.path)))
        .collect();
    out.sort_by_key(|(_, p)| (p.matches('\\').count(), p.to_lowercase()));
    out.dedup();
    out.truncate(max);
    out
}

/// For the chat (agent.rs rdm_search): connections, credentials and folders of the cloud with these words.
pub fn search_text(query: &str) -> String {
    if !on() {
        return String::new();
    }
    load_cache();
    let Ok(g) = INDEX.lock() else { return String::new() };
    let Some(index) = g.as_ref() else { return String::new() };
    let words: Vec<String> = query.to_lowercase().split_whitespace().map(String::from).collect();
    let mut lines: Vec<String> = Vec::new();
    for (vault, path) in find_folders(index, query, 5) {
        let vname = index.vaults.iter().find(|v| v.id == vault).map(|v| v.name.as_str()).unwrap_or("");
        lines.push(format!("cartella «{path}» (vault {vname})"));
    }
    for e in index.entries.iter().filter(|e| e.kind != "Group") {
        let hay = format!("{} {} {}", e.name, e.folder, e.host).to_lowercase();
        if !words.is_empty() && words.iter().all(|w| hay.contains(w.as_str())) {
            let what = if crate::rdm::is_connection(&e.kind) { format!("connessione {}", e.kind) } else if e.cred == "PasswordList" { "lista password".into() } else { "credenziale".into() };
            lines.push(format!("{what} «{}» in «{}»{}{} id {}", e.name, e.folder, if e.host.is_empty() { String::new() } else { format!(", host {}", e.host) }, if e.user.is_empty() { String::new() } else { format!(", utente {}", e.user) }, e.id));
        }
        if lines.len() >= 25 {
            break;
        }
    }
    lines.join("\n")
}

// ── An entry: details, a password to the clipboard ───────────────────────────

fn known(vault: &str, id: &str) -> Result<Item, String> {
    if !guid(vault) || !guid(id) {
        return Err(t("Voce non valida").into());
    }
    load_cache();
    let g = INDEX.lock().map_err(|_| t("Voce non valida").to_string())?;
    g.as_ref()
        .and_then(|i| i.entries.iter().find(|e| e.id == id && e.vault == vault).cloned())
        .ok_or_else(|| t("Voce non trovata: premi Sincronizza").to_string())
}

/// Name, user, domain, host, description, the password's length; a list's rows likewise.
pub async fn details(vault: &str, id: &str) -> Result<Value, String> {
    known(vault, id)?;
    let out = hub(&format!("{CREDS}{DETAILS}"), &[("EASYISLAND_DVC_VAULT", vault), ("EASYISLAND_DVC_ENTRY", id)]).await?;
    serde_json::from_str(out.trim()).map_err(|_| t("Risposta di Devolutions Cloud non leggibile.").to_string())
}

/// The password of an entry (or of row `row` of a list), read right now.
async fn password_of(vault: &str, id: &str, row: Option<usize>) -> Result<(Item, String), String> {
    let item = known(vault, id)?;
    let row_s = row.map(|r| r.to_string()).unwrap_or_default();
    let out = hub(&format!("{CREDS}{PASSWORD}"), &[("EASYISLAND_DVC_VAULT", vault), ("EASYISLAND_DVC_ENTRY", id), ("EASYISLAND_DVC_ROW", &row_s)]).await?;
    let secret = serde_json::from_str::<Value>(out.trim())
        .ok()
        .and_then(|v| v.get("p")?.as_str().map(str::to_string))
        .ok_or_else(|| t("Risposta di Devolutions Cloud non leggibile.").to_string())?;
    drop(out);
    if secret.is_empty() {
        return Err(tf("«{name}» non ha una password salvata.", &[("name", &item.name)]));
    }
    Ok((item, secret))
}

/// The eye on a password (asked by Edoardo on 4 Nov 2026): shown in the card
/// until it hides it again (or 30 s), never logged, never on the clipboard.
pub async fn reveal(vault: &str, id: &str, row: Option<usize>) -> Result<String, String> {
    let (item, secret) = password_of(vault, id, row).await?;
    crate::log::line(format!("dvc: password di «{}» mostrata nella scheda", item.name));
    Ok(secret)
}

/// The password of an entry (or of row `row` of a list) on the clipboard, private, emptied after CLIP_SECONDS.
pub async fn copy_password(vault: &str, id: &str, row: Option<usize>) -> Result<(), String> {
    let (item, mut secret) = password_of(vault, id, row).await?;
    let result = tauri::async_runtime::spawn_blocking({
        let s = std::mem::take(&mut secret);
        move || {
            let r = private_clipboard(&s);
            drop(s);
            r
        }
    })
    .await
    .map_err(|e| e.to_string())?;
    let seq = result?;
    crate::log::line(format!("dvc: password di «{}» negli appunti per {CLIP_SECONDS} s", item.name));
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(CLIP_SECONDS));
        clear_if_unchanged(seq);
    });
    Ok(())
}

/// Text on the clipboard marked private: no Windows history, no cloud clipboard,
/// skipped by clipboard monitors (EasyIsland's Appunti too). Its sequence number.
fn private_clipboard(text: &str) -> Result<u32, String> {
    use windows::core::w;
    use windows::Win32::Foundation::{GlobalFree, HANDLE};
    use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, GetClipboardSequenceNumber, OpenClipboard, RegisterClipboardFormatW, SetClipboardData};
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    use windows::Win32::System::Ole::CF_UNICODETEXT;

    unsafe fn put(format: u32, bytes: &[u8]) -> Result<(), String> {
        let mem = GlobalAlloc(GMEM_MOVEABLE, bytes.len().max(1)).map_err(|e| e.to_string())?;
        let ptr = GlobalLock(mem) as *mut u8;
        if ptr.is_null() {
            let _ = GlobalFree(Some(mem));
            return Err(t("memoria non disponibile").into());
        }
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
        let _ = GlobalUnlock(mem);
        if SetClipboardData(format, Some(HANDLE(mem.0))).is_err() {
            let _ = GlobalFree(Some(mem));
            return Err(t("copia non riuscita").into());
        }
        Ok(())
    }

    let mut wide: Vec<u8> = text.encode_utf16().chain(std::iter::once(0)).flat_map(|u| u.to_le_bytes()).collect();
    unsafe {
        let mut opened = false;
        for _ in 0..5 {
            if OpenClipboard(None).is_ok() {
                opened = true;
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        if !opened {
            wide.fill(0);
            return Err(t("Gli appunti sono occupati da un'altra app").into());
        }
        let result = (|| {
            EmptyClipboard().map_err(|e| e.to_string())?;
            // The marks first: a monitor woken by the text already sees them.
            let zero = 0u32.to_le_bytes();
            put(RegisterClipboardFormatW(w!("ExcludeClipboardContentFromMonitorProcessing")), &[0])?;
            put(RegisterClipboardFormatW(w!("CanIncludeInClipboardHistory")), &zero)?;
            put(RegisterClipboardFormatW(w!("CanUploadToCloudClipboard")), &zero)?;
            put(CF_UNICODETEXT.0 as u32, &wide)
        })();
        let _ = CloseClipboard();
        wide.fill(0);
        result.map(|_| GetClipboardSequenceNumber())
    }
}

/// Empties the clipboard if nothing was copied since the password.
fn clear_if_unchanged(seq: u32) {
    use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, GetClipboardSequenceNumber, OpenClipboard};
    unsafe {
        if GetClipboardSequenceNumber() != seq {
            return;
        }
        for _ in 0..10 {
            if OpenClipboard(None).is_ok() {
                if GetClipboardSequenceNumber() == seq {
                    let _ = EmptyClipboard();
                }
                let _ = CloseClipboard();
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    }
}

// ── Writing: a preview, then the entry, read back and checked ────────────────

/// What a write will do (preview) or did (rows checked).
#[derive(Serialize, Deserialize, Debug, Default)]
pub struct Outcome {
    /// Lines of the preview.
    #[serde(default)]
    pub preview: Vec<String>,
    /// The new entry's id, after the write.
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub rows: Vec<RowCheck>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RowCheck {
    pub row: String,
    pub user_ok: bool,
    pub password_ok: bool,
}

/// A name for a new entry: one line, not empty, not too long.
fn clean_name(name: &str) -> Result<String, String> {
    let n: String = name.trim().chars().filter(|c| !c.is_control()).collect();
    if n.is_empty() || n.chars().count() > 120 {
        return Err(t("Scrivi un nome per la voce (al massimo 120 caratteri).").into());
    }
    Ok(n)
}

/// The folder's own entry (its id is the new entry's parent).
fn folder_entry(index: &Index, vault: &str, folder: &str) -> Option<Item> {
    index.entries.iter().find(|e| e.vault == vault && e.kind == "Group" && same(&e.path, folder)).cloned()
}

fn taken(index: &Index, vault: &str, folder: &str, name: &str) -> bool {
    index.entries.iter().any(|e| e.vault == vault && e.kind != "Group" && same(&e.folder, folder) && e.name.eq_ignore_ascii_case(name))
}

/// The credentials a list would join: in `source` (and below, with `recurse`), never a list.
fn list_sources(index: &Index, vault: &str, source: &str, recurse: bool, skip: &str) -> Vec<Item> {
    let src = norm(source);
    let mut list: Vec<Item> = index
        .entries
        .iter()
        .filter(|e| e.vault == vault && e.kind.starts_with("Credential") && e.cred != "PasswordList" && !e.name.eq_ignore_ascii_case(skip))
        .filter(|e| same(&e.folder, &src) || (recurse && child_of(&src, &e.folder).is_some()))
        .cloned()
        .collect();
    list.sort_by_key(|e| e.name.to_lowercase());
    list
}

pub struct NewCredential {
    pub vault: String,
    pub folder: String,
    pub name: String,
    pub user: String,
    pub domain: String,
    pub password: String,
    pub description: String,
}

/// A credential: `confirm` false = the preview only.
pub async fn new_credential(c: NewCredential, confirm: bool) -> Result<Outcome, String> {
    let name = clean_name(&c.name)?;
    let (parent, folder) = {
        load_cache();
        let g = INDEX.lock().map_err(|e| e.to_string())?;
        let index = g.as_ref().ok_or_else(|| t("Premi Sincronizza prima di scrivere").to_string())?;
        let f = folder_entry(index, &c.vault, &c.folder).ok_or_else(|| t("Cartella non trovata: premi Sincronizza").to_string())?;
        if taken(index, &c.vault, &f.path, &name) {
            return Err(t("Esiste già una voce con questo nome nella cartella: scegli un altro nome.").into());
        }
        (f.id, f.path)
    };
    if !confirm {
        let mut preview = vec![tf("Nuova credenziale «{name}» in «{folder}»", &[("name", &name), ("folder", &folder)])];
        preview.push(tf("Utente: {u}", &[("u", &if c.domain.trim().is_empty() { c.user.trim().to_string() } else { format!("{}\\{}", c.domain.trim(), c.user.trim()) })]));
        preview.push(if c.password.is_empty() { t("Senza password").to_string() } else { tf("Password: {n} caratteri", &[("n", &c.password.chars().count())]) });
        if !c.description.trim().is_empty() {
            preview.push(tf("Descrizione: {d}", &[("d", &c.description.trim())]));
        }
        return Ok(Outcome { preview, ..Default::default() });
    }
    let out = hub(
        &format!("{NEW_ENTRY}{NEW_CREDENTIAL}"),
        &[
            ("EASYISLAND_DVC_VAULT", &c.vault),
            ("EASYISLAND_DVC_FOLDER", &folder),
            ("EASYISLAND_DVC_PARENT", &parent),
            ("EASYISLAND_DVC_NAME", &name),
            ("EASYISLAND_DVC_USER", c.user.trim()),
            ("EASYISLAND_DVC_DOMAIN", c.domain.trim()),
            ("EASYISLAND_DVC_PW", &c.password),
            ("EASYISLAND_DVC_DESC", c.description.trim()),
        ],
    )
    .await?;
    let outcome: Outcome = serde_json::from_str(out.trim()).map_err(|_| t("Risposta di Devolutions Cloud non leggibile.").to_string())?;
    crate::log::line(format!("dvc: creata la credenziale «{name}» in «{folder}»"));
    refresh().await;
    Ok(outcome)
}

/// Where a list's rows come from: a folder's credentials (and below), or given ones.
pub enum Sources {
    Folder { path: String, recurse: bool },
    Ids(Vec<String>),
}

/// The credentials with these ids (never a list), in the vault.
fn sources_by_id(index: &Index, vault: &str, ids: &[String]) -> Vec<Item> {
    let mut list: Vec<Item> = index
        .entries
        .iter()
        .filter(|e| e.vault == vault && e.kind.starts_with("Credential") && e.cred != "PasswordList" && ids.iter().any(|i| i.trim_matches(['{', '}']).eq_ignore_ascii_case(&e.id)))
        .cloned()
        .collect();
    list.sort_by_key(|e| e.name.to_lowercase());
    list
}

/// A «Lista Password» in `folder` from `from`: `confirm` false = the preview only.
pub async fn new_password_list(vault: &str, folder: &str, name: &str, from: Sources, confirm: bool) -> Result<Outcome, String> {
    let name = clean_name(name)?;
    let (parent, folder, sources) = {
        load_cache();
        let g = INDEX.lock().map_err(|e| e.to_string())?;
        let index = g.as_ref().ok_or_else(|| t("Premi Sincronizza prima di scrivere").to_string())?;
        let f = folder_entry(index, vault, folder).ok_or_else(|| t("Cartella non trovata: premi Sincronizza").to_string())?;
        if taken(index, vault, &f.path, &name) {
            return Err(t("Esiste già una voce con questo nome nella cartella: scegli un altro nome.").into());
        }
        let sources = match &from {
            Sources::Folder { path, recurse } => list_sources(index, vault, path, *recurse, &name),
            Sources::Ids(ids) => sources_by_id(index, vault, ids),
        };
        if sources.is_empty() {
            return Err(t("Nella cartella non ci sono credenziali da unire.").into());
        }
        (f.id, f.path, sources)
    };
    if !confirm {
        let mut preview = vec![tf("Nuova «{name}» in «{folder}» con {n} righe:", &[("name", &name), ("folder", &folder), ("n", &sources.len())])];
        preview.extend(sources.iter().map(|s| if s.user.is_empty() { format!("• {}", s.name) } else { format!("• {} — {}", s.name, s.user) }));
        preview.push(t("Le credenziali di partenza restano dove sono.").into());
        return Ok(Outcome { preview, ..Default::default() });
    }
    let ids = sources.iter().map(|s| s.id.as_str()).collect::<Vec<_>>().join(",");
    let out = hub(
        &format!("{NEW_ENTRY}{NEW_LIST}"),
        &[("EASYISLAND_DVC_VAULT", vault), ("EASYISLAND_DVC_FOLDER", &folder), ("EASYISLAND_DVC_PARENT", &parent), ("EASYISLAND_DVC_NAME", &name), ("EASYISLAND_DVC_SOURCES", &ids)],
    )
    .await?;
    let outcome: Outcome = serde_json::from_str(out.trim()).map_err(|_| t("Risposta di Devolutions Cloud non leggibile.").to_string())?;
    crate::log::line(format!("dvc: creata «{name}» in «{folder}» ({} righe)", outcome.rows.len()));
    refresh().await;
    Ok(outcome)
}

// ── The password window ───────────────────────────────────────────────────────
// A credential written from the chat: the password is never in the chat. The
// Windows credentials window asks it (twice, to catch a typo), it goes from
// there to the Hub and nowhere else.

/// What the window gave: the password, or nothing (cancelled).
fn prompt_once(caption: &str, message: &str, user: &str) -> Result<Option<String>, String> {
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::{ERROR_CANCELLED, NO_ERROR};
    use windows::Win32::Security::Credentials::{
        CredUIPromptForCredentialsW, CREDUI_FLAGS_ALWAYS_SHOW_UI, CREDUI_FLAGS_DO_NOT_PERSIST, CREDUI_FLAGS_EXCLUDE_CERTIFICATES,
        CREDUI_FLAGS_GENERIC_CREDENTIALS, CREDUI_FLAGS_KEEP_USERNAME, CREDUI_INFOW,
    };
    let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let (caption_w, message_w, target_w) = (wide(caption), wide(message), wide("EasyIsland · Devolutions Cloud"));
    let info = CREDUI_INFOW {
        cbSize: std::mem::size_of::<CREDUI_INFOW>() as u32,
        pszCaptionText: PCWSTR(caption_w.as_ptr()),
        pszMessageText: PCWSTR(message_w.as_ptr()),
        ..Default::default()
    };
    let mut name = [0u16; 514];
    for (i, u) in user.encode_utf16().take(512).enumerate() {
        name[i] = u;
    }
    let mut pass = [0u16; 512];
    let flags = CREDUI_FLAGS_GENERIC_CREDENTIALS | CREDUI_FLAGS_ALWAYS_SHOW_UI | CREDUI_FLAGS_DO_NOT_PERSIST | CREDUI_FLAGS_EXCLUDE_CERTIFICATES | CREDUI_FLAGS_KEEP_USERNAME;
    let err = unsafe { CredUIPromptForCredentialsW(Some(&info), PCWSTR(target_w.as_ptr()), None, 0, &mut name, &mut pass, None, flags) };
    let len = pass.iter().position(|&c| c == 0).unwrap_or(pass.len());
    let out = String::from_utf16_lossy(pass.get(..len).unwrap_or_default());
    pass.fill(0);
    if err == ERROR_CANCELLED {
        return Ok(None);
    }
    if err != NO_ERROR {
        return Err(tf("La finestra della password non si è aperta (errore {e}).", &[("e", &err.0)]));
    }
    Ok(Some(out))
}

/// The password for a new credential, typed twice in the Windows window. None = cancelled.
async fn ask_password(name: &str, folder: &str, user: &str) -> Result<Option<String>, String> {
    let caption = t("EasyIsland · password per Devolutions Cloud").to_string();
    let first = tf("Password della nuova credenziale «{name}» in «{folder}». Non passa dalla chat: va solo nel vault.", &[("name", &name), ("folder", &folder)]);
    let again = tf("Scrivi di nuovo la password di «{name}», per conferma.", &[("name", &name)]);
    let shown = if user.trim().is_empty() { name.to_string() } else { user.trim().to_string() };
    tauri::async_runtime::spawn_blocking(move || {
        let Some(mut one) = prompt_once(&caption, &first, &shown)? else { return Ok(None) };
        let Some(mut two) = prompt_once(&caption, &again, &shown)? else {
            one.clear();
            return Ok(None);
        };
        let same = one == two;
        two.clear();
        if !same {
            one.clear();
            return Err(t("Le due password non coincidono: non ho scritto niente.").into());
        }
        Ok(Some(one))
    })
    .await
    .map_err(|e| e.to_string())?
}

// ── The chat's tools (agent.rs): the skill's functions through EasyIsland ─────
// dvc_vaults, dvc_entries, dvc_folder_id, dvc_show, dvc_password_list_preview
// read; dvc_new_credential and dvc_new_password_list ask Consenti / Nega
// (hook/src/tool_list.rs). Never a password in what goes back to the engine.

fn arg<'a>(args: &'a Value, key: &str) -> &'a str {
    args.get(key).and_then(Value::as_str).unwrap_or("").trim()
}

/// The vault by id or name; with one vault, that one (as Resolve-DVCVault).
fn vault_of(index: &Index, given: &str) -> Result<String, String> {
    let g = given.trim().trim_matches(['{', '}']);
    if !g.is_empty() {
        return index
            .vaults
            .iter()
            .find(|v| v.id.eq_ignore_ascii_case(g) || v.name.eq_ignore_ascii_case(g))
            .map(|v| v.id.clone())
            .ok_or_else(|| format!("Vault «{given}» non trovato: vedi dvc_vaults."));
    }
    match index.vaults.as_slice() {
        [one] => Ok(one.id.clone()),
        [] => Err("Nessun vault letto: l'utente preme Sincronizza nella scheda RDM.".into()),
        _ => Err("Più vault: indica vault (nome o id, vedi dvc_vaults).".into()),
    }
}

/// `*` and `?` as in PowerShell's -like, ignoring case.
fn like(text: &str, pattern: &str) -> bool {
    fn go(t: &[char], p: &[char]) -> bool {
        match p.split_first() {
            None => t.is_empty(),
            Some(('*', rest)) => (0..=t.len()).any(|i| go(t.get(i..).unwrap_or_default(), rest)),
            Some(('?', rest)) => !t.is_empty() && go(t.get(1..).unwrap_or_default(), rest),
            Some((c, rest)) => t.first().is_some_and(|x| x == c) && go(t.get(1..).unwrap_or_default(), rest),
        }
    }
    let t: Vec<char> = text.to_lowercase().chars().collect();
    let p: Vec<char> = pattern.to_lowercase().chars().collect();
    go(&t, &p)
}

fn ready() -> Result<(), String> {
    if !on() {
        return Err("Devolutions Cloud non è collegato: Impostazioni → Remote Desktop Manager → Devolutions Cloud (indirizzo, Application Key, Secret).".into());
    }
    load_cache();
    Ok(())
}

fn with_index<T>(f: impl FnOnce(&Index) -> Result<T, String>) -> Result<T, String> {
    let g = INDEX.lock().map_err(|e| e.to_string())?;
    let empty = Index::default();
    f(g.as_ref().unwrap_or(&empty))
}

fn synced_at(index: &Index) -> String {
    if index.at == 0 {
        return "mai sincronizzato".into();
    }
    let ago = (std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0) - index.at).max(0) / 60;
    format!("elenco di {ago} minuti fa")
}

/// dvc_vaults (Get-DVCVault): the vaults read, the one used when none is given.
pub fn tool_vaults() -> Result<String, String> {
    ready()?;
    with_index(|i| {
        let default = vault_of(i, "").ok();
        let lines: Vec<String> = i.vaults.iter().map(|v| format!("{}{} — id {}", if default.as_deref() == Some(v.id.as_str()) { "* " } else { "" }, v.name, v.id)).collect();
        Ok(if lines.is_empty() { "Nessun vault: l'utente preme Sincronizza nella scheda RDM.".into() } else { format!("{} ({})", lines.join("\n"), synced_at(i)) })
    })
}

/// dvc_entries (Get-DVCEntries): path, recurse, name (with * and ?), type; refresh reads the vaults first.
pub async fn tool_entries(args: &Value) -> Result<String, String> {
    ready()?;
    if args.get("refresh").and_then(Value::as_bool) == Some(true) {
        refresh().await;
    }
    let (path, name, kind) = (norm(arg(args, "path")), arg(args, "name").to_string(), arg(args, "type").to_string());
    let recurse = args.get("recurse").and_then(Value::as_bool).unwrap_or(false);
    with_index(|i| {
        let vault = vault_of(i, arg(args, "vault"))?;
        let mut lines = Vec::new();
        for e in i.entries.iter().filter(|e| e.vault == vault) {
            if !path.is_empty() && !(same(&e.folder, &path) || (recurse && child_of(&path, &e.folder).is_some())) {
                continue;
            }
            if !name.is_empty() && !like(&e.name, &name) {
                continue;
            }
            let ty = if e.cred == "PasswordList" { "PasswordList" } else { e.kind.as_str() };
            if !kind.is_empty() && !ty.eq_ignore_ascii_case(&kind) && !e.kind.eq_ignore_ascii_case(&kind) {
                continue;
            }
            lines.push(format!("{} | {} | {} | {} | {} | {}", e.name, ty, e.folder, e.host, e.user, e.id));
            if lines.len() >= 200 {
                lines.push("… (altre voci: restringi con path, name o type)".into());
                break;
            }
        }
        Ok(if lines.is_empty() {
            format!("Nessuna voce ({}).", synced_at(i))
        } else {
            format!("Nome | Tipo | Cartella | Host | Utente | Id ({})\n{}", synced_at(i), lines.join("\n"))
        })
    })
}

/// dvc_folder_id (Get-DVCFolderId): the folder's id from its full path.
pub fn tool_folder_id(args: &Value) -> Result<String, String> {
    ready()?;
    with_index(|i| {
        let vault = vault_of(i, arg(args, "vault"))?;
        let path = arg(args, "path");
        let found: Vec<&Item> = i.entries.iter().filter(|e| e.vault == vault && e.kind == "Group" && same(&e.path, path)).collect();
        match found.as_slice() {
            [one] => Ok(one.id.clone()),
            [] => Err(format!("Cartella non trovata: {path} (cerca con dvc_entries type=Group).")),
            _ => Err(format!("Più cartelle con percorso {path}.")),
        }
    })
}

/// A login for a page of the preview (preview_login, asked by Edoardo on 12 Nov
/// 2026 for the suppliers' portals): the entry by id or name, its address, user
/// and password. The password goes straight into the page's field and nowhere
/// else: never to an engine, on screen or in the log.
pub(crate) struct WebLogin {
    pub name: String,
    pub url: String,
    pub user: String,
    pub password: String,
}

pub(crate) async fn web_login(entry: &str) -> Result<WebLogin, String> {
    ready()?;
    let want = entry.trim().trim_matches(['{', '}']).to_string();
    if want.is_empty() {
        return Err(t("Manca entry: la voce di Devolutions Cloud (nome o id).").into());
    }
    let item = with_index(|i| {
        let all: Vec<&Item> = i.entries.iter().filter(|e| e.kind != "Group").collect();
        if let Some(e) = all.iter().find(|e| e.id.eq_ignore_ascii_case(&want)) {
            return Ok((*e).clone());
        }
        let named: Vec<&&Item> = all.iter().filter(|e| e.name.eq_ignore_ascii_case(&want)).collect();
        match named.as_slice() {
            [one] => Ok((**one).clone()),
            [] => Err(tf("Nessuna voce «{n}» in Devolutions Cloud (premi Sincronizza se è nuova).", &[("n", &want)])),
            many => Err(tf("Più voci si chiamano «{n}»: usa l'id. {list}", &[
                ("n", &want),
                ("list", &many.iter().take(8).map(|e| format!("{}\\{} ({})", e.folder, e.name, e.id)).collect::<Vec<_>>().join("; ")),
            ])),
        }
    })?;
    let d = details(&item.vault, &item.id).await?;
    let s = |k: &str| d.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
    let url = [s("url"), s("host"), item.host.clone()].into_iter().find(|u| !u.trim().is_empty()).unwrap_or_default();
    let (_, password) = password_of(&item.vault, &item.id, None).await?;
    Ok(WebLogin { name: item.name, url, user: s("user"), password })
}

/// dvc_show (Show-DVCEntry): details, the password only as its length; a list's rows too.
pub async fn tool_show(args: &Value) -> Result<String, String> {
    ready()?;
    let id = arg(args, "id").trim_matches(['{', '}']).to_string();
    let vault = with_index(|i| {
        let given = arg(args, "vault");
        if given.is_empty() {
            if let Some(e) = i.entries.iter().find(|e| e.id.eq_ignore_ascii_case(&id)) {
                return Ok(e.vault.clone());
            }
        }
        vault_of(i, given)
    })?;
    let d = details(&vault, &id).await?;
    let s = |k: &str| d.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let mut out = format!(
        "Nome: {}\nTipo: {}\nTipo credenziale: {}\nCartella: {}\nHost: {}\nUtente: {}\nDominio: {}\nLunghezza password: {}\nDescrizione: {}\nId: {id}",
        s("name"), s("kind"), s("cred"), s("folder"), s("host"), s("user"), s("domain"), d.get("length").and_then(Value::as_u64).unwrap_or(0), s("description")
    );
    if let Some(rows) = d.get("rows").and_then(Value::as_array).filter(|r| !r.is_empty()) {
        out.push_str("\nRighe (nome | host | utente | dominio | lunghezza password | descrizione):");
        for r in rows {
            let g = |k: &str| r.get(k).and_then(Value::as_str).unwrap_or("").to_string();
            out.push_str(&format!("\n{} | {} | {} | {} | {} | {}", g("name"), g("host"), g("user"), g("domain"), r.get("length").and_then(Value::as_u64).unwrap_or(0), g("description")));
        }
    }
    Ok(out)
}

/// dvc_password_list_preview / dvc_new_password_list (New-DVCPasswordList, with and without -DryRun).
pub async fn tool_password_list(args: &Value, write: bool) -> Result<String, String> {
    ready()?;
    let vault = with_index(|i| vault_of(i, arg(args, "vault")))?;
    let folder = arg(args, "folder_path");
    let name = if arg(args, "name").is_empty() { "Lista Password" } else { arg(args, "name") };
    let ids: Vec<String> = args.get("source_ids").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect()).unwrap_or_default();
    let from = if !ids.is_empty() {
        Sources::Ids(ids)
    } else if !arg(args, "source_folder").is_empty() {
        Sources::Folder { path: arg(args, "source_folder").to_string(), recurse: args.get("recurse").and_then(Value::as_bool).unwrap_or(false) }
    } else {
        return Err("Indica source_ids oppure source_folder.".into());
    };
    let out = new_password_list(&vault, folder, name, from, write).await?;
    if !write {
        return Ok(format!("ANTEPRIMA, niente scritto:\n{}", out.preview.join("\n")));
    }
    if let Some(app) = crate::brain_watch::app() {
        crate::rdm::changed(app);
    }
    Ok(checked(&out, name, folder))
}

fn checked(out: &Outcome, name: &str, folder: &str) -> String {
    let all = out.rows.iter().all(|r| r.user_ok && r.password_ok);
    let rows: Vec<String> = out.rows.iter().map(|r| format!("{} — utente {} · password {}", r.row, if r.user_ok { "ok" } else { "DIVERSO" }, if r.password_ok { "ok" } else { "DIVERSA" })).collect();
    format!("Creata «{name}» in «{folder}» (id {}). Verifica: {}.\n{}", out.id, if all { "tutto ok" } else { "qualcosa non torna, controllare in RDM" }, rows.join("\n"))
}

/// dvc_new_credential (New-DVCCredential): the password, if any, in the Windows window, never in the chat.
pub async fn tool_new_credential(args: &Value) -> Result<String, String> {
    ready()?;
    let vault = with_index(|i| vault_of(i, arg(args, "vault")))?;
    let (folder, name, user) = (arg(args, "folder_path").to_string(), arg(args, "name").to_string(), arg(args, "user_name").to_string());
    let mut c = NewCredential { vault, folder: folder.clone(), name: name.clone(), user: user.clone(), domain: arg(args, "domain").to_string(), password: String::new(), description: arg(args, "description").to_string() };
    // Name and folder checked before the window opens.
    new_credential(NewCredential { password: String::new(), vault: c.vault.clone(), folder: folder.clone(), name: name.clone(), user: user.clone(), domain: c.domain.clone(), description: c.description.clone() }, false).await?;
    if args.get("password").and_then(Value::as_str).is_some_and(|p| !p.is_empty()) {
        return Err("La password non si passa dalla chat: togli «password»; EasyIsland la chiede in una finestra di Windows (ask_password=true).".into());
    }
    if args.get("ask_password").and_then(Value::as_bool).unwrap_or(true) {
        let asked = std::time::Instant::now();
        match ask_password(&name, &folder, &user).await? {
            Some(p) => c.password = p,
            None => return Ok("L'utente ha chiuso la finestra della password: niente scritto.".into()),
        }
        // The chat stops waiting at 330 s (hook/src/mcp.rs): too late, nothing is written.
        if asked.elapsed() > std::time::Duration::from_secs(280) {
            c.password.clear();
            return Ok("La password è arrivata troppo tardi (oltre 4 minuti e mezzo): niente scritto, riprova.".into());
        }
    }
    let had = !c.password.is_empty();
    let out = new_credential(c, true).await;
    let out = out?;
    if let Some(app) = crate::brain_watch::app() {
        crate::rdm::changed(app);
    }
    Ok(format!("{}{}", checked(&out, &name, &folder), if had { "" } else { "\n(senza password)" }))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The real window, on this PC: cargo test --lib dvc::tests::password_window -- --ignored --nocapture
    #[test]
    #[ignore]
    fn password_window() {
        let got = prompt_once("EasyIsland · prova", "Scrivi una password di prova (non va da nessuna parte)", "utente").unwrap();
        println!("{}", match got { Some(p) => format!("{} caratteri", p.chars().count()), None => "annullata".into() });
    }

    #[test]
    fn like_as_powershell() {
        assert!(like("Lista Password", "lista*"));
        assert!(like("NAS", "n?s"));
        assert!(!like("NAS2", "nas"));
        assert!(like("", "*"));
    }

    #[test]
    fn the_vault_by_id_name_or_alone() {
        let i = index();
        assert_eq!(vault_of(&i, "").unwrap(), V);
        assert_eq!(vault_of(&i, "edoardo").unwrap(), V);
        assert!(vault_of(&i, "altro").is_err());
        assert_eq!(sources_by_id(&i, V, &[format!("{{{C}}}"), E.to_string()]).len(), 1);
    }

    const V: &str = "11111111-1111-4111-8111-111111111111";
    const A: &str = "178c2fda-dab4-4f41-98df-6e3205c0a011";
    const B: &str = "474bcbcf-d507-435b-8c0a-a9e868781910";
    const C: &str = "574bcbcf-d507-435b-8c0a-a9e868781910";
    const D: &str = "674bcbcf-d507-435b-8c0a-a9e868781910";
    const E: &str = "774bcbcf-d507-435b-8c0a-a9e868781910";

    fn index() -> Index {
        let out = format!(r#"{{"vaults":[{{"id":"{V}","name":"Edoardo"}}],"entries":[
            {{"id":"{A}","name":"CLIENTE","kind":"Group","folder":"Easytech","path":"Easytech\\CLIENTE","vault":"{V}"}},
            {{"id":"{B}","name":"Server","kind":"Group","folder":"Easytech\\CLIENTE","path":"Easytech\\CLIENTE\\Server","vault":"{V}"}},
            {{"id":"{C}","name":"Admin","kind":"Credential","folder":"Easytech\\CLIENTE\\Server","user":"admin","cred":"Default","vault":"{V}"}},
            {{"id":"{D}","name":"NAS","kind":"RDPConfigured","folder":"Easytech\\CLIENTE","host":"10.0.0.5","vault":"{V}"}},
            {{"id":"{E}","name":"Lista Password","kind":"Credential","folder":"Easytech\\CLIENTE\\Server","cred":"PasswordList","vault":"{V}"}},
            {{"id":"nope","name":"Rotto","kind":"Credential","vault":"{V}"}}
        ]}}"#);
        let (vaults, entries) = parse_read(&out).unwrap();
        Index { vaults, entries, at: 1, error: None }
    }

    #[test]
    fn the_read_becomes_vaults_and_entries() {
        let i = index();
        assert_eq!(i.vaults.len(), 1);
        assert_eq!(i.entries.len(), 5);
        assert!(parse_read("Connect-HubAccount: …").is_err());
    }

    #[test]
    fn folders_and_entries_of_a_folder() {
        let i = index();
        let root = browse_in(&i, V, "");
        assert_eq!(root.folders.iter().map(|f| f.name.as_str()).collect::<Vec<_>>(), vec!["Easytech"]);
        assert_eq!(root.folders[0].count, 3);
        let c = browse_in(&i, V, "easytech/cliente/");
        assert_eq!(c.path, "easytech\\cliente");
        assert_eq!(c.folders.iter().map(|f| (f.name.as_str(), f.count)).collect::<Vec<_>>(), vec![("Server", 2)]);
        assert_eq!(c.entries.iter().map(|e| e.name.as_str()).collect::<Vec<_>>(), vec!["NAS"]);
        assert_eq!(child_of("Easytech", "Easytech2\\X"), None);
        assert_eq!(child_of("Easytech", "Easytech\\CLIENTE\\Server"), Some("CLIENTE".into()));
    }

    #[test]
    fn writing_checks_folder_name_and_sources() {
        let i = index();
        assert_eq!(folder_entry(&i, V, "Easytech\\CLIENTE\\Server").map(|f| f.id), Some(B.to_string()));
        assert!(folder_entry(&i, V, "Easytech\\Altro").is_none());
        assert!(taken(&i, V, "easytech\\cliente\\server", "admin"));
        assert!(!taken(&i, V, "Easytech\\CLIENTE", "Admin"));
        // The list joins credentials, never another list.
        assert_eq!(list_sources(&i, V, "Easytech\\CLIENTE\\Server", false, "Lista Password").iter().map(|e| e.id.as_str()).collect::<Vec<_>>(), vec![C]);
        assert!(list_sources(&i, V, "Easytech\\CLIENTE", false, "x").is_empty());
        assert_eq!(list_sources(&i, V, "Easytech\\CLIENTE", true, "x").len(), 1);
        assert!(clean_name("  ").is_err());
        assert_eq!(clean_name(" Lista\tPassword ").unwrap(), "ListaPassword");
        assert_eq!(find_folders(&i, "cliente", 5), vec![(V.to_string(), "Easytech\\CLIENTE".to_string()), (V.to_string(), "Easytech\\CLIENTE\\Server".to_string())]);
    }

    #[test]
    fn errors_in_words_the_user_can_act_on() {
        assert!(hub_problem("RDM: EASYISLAND_DUPLICATE").contains("Esiste già"));
        assert!(hub_problem("RDM: Response status code does not indicate success: 401 (Unauthorized).").contains("rifiutato"));
        assert_eq!(hub_problem("RDM: qualcosa"), "Devolutions Cloud: qualcosa");
    }
}
