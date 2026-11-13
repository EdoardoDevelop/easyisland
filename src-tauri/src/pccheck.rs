// pc_check (13 Nov 2026): a PC looked over in one call. On the laptop, two
// weeks of chat had 524 PowerShell/Bash steps, most of them diagnosing a
// customer's PC one command at a time (network, Wi-Fi, slowness, PDF
// previews…), each step re-reading the whole conversation. Here EasyIsland
// runs a fixed set of read-only checks, on this PC or on another one of the
// network through WinRM with the user's own Windows account, and gives the
// engine a short report to reason on. Nothing is changed, nothing typed by the
// engine runs: the areas are chosen from a fixed list, the host goes in an
// environment variable, never in the script.

use std::time::Duration;

use serde_json::Value;

use crate::i18n::{t, tf};

const MAX_OUT: usize = 9_000;
const TIMEOUT: Duration = Duration::from_secs(150);

/// Always, first: what PC, how loaded.
const BASE: &str = r#"
$o = Get-CimInstance Win32_OperatingSystem; $cs = Get-CimInstance Win32_ComputerSystem
"PC: $env:COMPUTERNAME · $($o.Caption) $($o.Version) · dominio/gruppo: $($cs.Domain) · utente: $($cs.UserName)"
$up = (Get-Date) - $o.LastBootUpTime
"Acceso da: {0} giorni {1} ore" -f $up.Days, $up.Hours
$cpu = (Get-CimInstance Win32_Processor | Measure-Object LoadPercentage -Average).Average
"CPU: {0}% · RAM libera {1:N1} GB di {2:N1}" -f $cpu, ($o.FreePhysicalMemory / 1MB), ($o.TotalVisibleMemorySize / 1MB)
Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | ForEach-Object { if ($_.Size) { "Disco {0} libero {1:N0}% ({2:N0} GB di {3:N0})" -f $_.DeviceID, ($_.FreeSpace / $_.Size * 100), ($_.FreeSpace / 1GB), ($_.Size / 1GB) } }
if (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired') { 'Riavvio in sospeso per aggiornamenti: sì' }
"#;

const NETWORK: &str = r#"
'== Rete'
Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object { $_.NetAdapter.Status -eq 'Up' } | ForEach-Object {
  "Scheda {0}: IP {1} · gateway {2} · DNS {3}" -f $_.InterfaceAlias, (@($_.IPv4Address.IPAddress) -join ','), (@($_.IPv4DefaultGateway.NextHop) -join ','), (@($_.DNSServer | Where-Object AddressFamily -eq 2 | ForEach-Object ServerAddresses) -join ',')
}
$gw = (Get-NetIPConfiguration -ErrorAction SilentlyContinue | Where-Object { $_.IPv4DefaultGateway } | Select-Object -First 1).IPv4DefaultGateway.NextHop
foreach ($target in @($gw, '1.1.1.1') | Where-Object { $_ }) {
  $p = Test-Connection $target -Count 3 -ErrorAction SilentlyContinue
  if ($p) { "Ping {0}: {1}/3 risposte, media {2:N0} ms" -f $target, @($p).Count, (@($p) | Measure-Object ResponseTime -Average).Average } else { "Ping ${target}: nessuna risposta" }
}
try { $sw = [Diagnostics.Stopwatch]::StartNew(); $null = Resolve-DnsName www.microsoft.com -QuickTimeout -ErrorAction Stop; "DNS: risponde in {0} ms" -f $sw.ElapsedMilliseconds } catch { "DNS: non risolve ($($_.Exception.Message))" }
$px = ((netsh winhttp show proxy) -join ' ') -replace '\s+', ' '
if ($px -match 'Direct|irett') { 'Proxy di sistema: nessuno' } else { 'Proxy di sistema: ' + $px.Trim() }
Get-NetFirewallProfile -ErrorAction SilentlyContinue | ForEach-Object { "Firewall {0}: {1}" -f $_.Name, $(if ($_.Enabled) { 'acceso' } else { 'spento' }) }
"#;

const WIFI: &str = r#"
'== Wi-Fi'
# netsh may end lines with a lone CR, and through WinRM its accents can come as UTF-8 read as ANSI.
function Fix([string]$s) { if ($s -match 'Ã') { try { return [Text.Encoding]::UTF8.GetString([Text.Encoding]::GetEncoding(1252).GetBytes($s)) } catch {} }; $s }
$w = (netsh wlan show interfaces | Out-String) -split "`r`n|`n|`r"
if (-not ($w -match 'SSID')) { 'Wi-Fi: nessuna scheda o non collegata' } else {
  # Every line but the identifiers: the labels change with the language and the driver.
  $w | Where-Object { $_ -match ':' -and $_ -notmatch '(GUID|fisico|Physical|Descrizione|Description|ospitata|Hosted|QoS|Akm|^\s*(Nome|Name|Profilo|Profile)\s*:|presenti|There (is|are))' } | ForEach-Object { '  ' + ((Fix $_).Trim() -replace '\s{2,}', ' ') }
}
$ch = netsh wlan show networks mode=bssid | Where-Object { $_ -match '^\s*(Canale|Channel)\s*:' } | ForEach-Object { ($_ -split ':')[1].Trim() }
if ($ch) { 'Reti vicine per canale: ' + ((@($ch) | Group-Object | Sort-Object Count -Descending | ForEach-Object { "$($_.Name)×$($_.Count)" }) -join ', ') }
"#;

const SLOW: &str = r#"
'== Lentezza'
'Più CPU (secondi in tutto da quando sono partiti):'
Get-Process | Sort-Object CPU -Descending | Select-Object -First 6 | ForEach-Object { '  {0} {1:N0} s · {2:N0} MB' -f $_.ProcessName, $_.CPU, ($_.WorkingSet64 / 1MB) }
'Più memoria:'
Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 6 | ForEach-Object { '  {0} {1:N0} MB' -f $_.ProcessName, ($_.WorkingSet64 / 1MB) }
$d = Get-CimInstance Win32_PerfFormattedData_PerfDisk_PhysicalDisk -Filter "Name='_Total'" -ErrorAction SilentlyContinue
if ($d) { 'Disco occupato ora: {0}% · coda {1}' -f $d.PercentDiskTime, $d.CurrentDiskQueueLength }
$pf = Get-CimInstance Win32_PageFileUsage -ErrorAction SilentlyContinue | Select-Object -First 1
if ($pf) { 'File di paging: {0} MB usati di {1}' -f $pf.CurrentUsage, $pf.AllocatedBaseSize }
"#;

const STARTUP: &str = r#"
'== Avvio e servizi'
'Programmi all''avvio:'
Get-CimInstance Win32_StartupCommand -ErrorAction SilentlyContinue | Select-Object -First 20 | ForEach-Object {
  $where = if ($_.Location -match '^HKU\\S-1-5-(18|19|20)\\') { 'sistema' } elseif ($_.Location -match '^HKU\\') { 'utente' } elseif ($_.Location -match '^HKLM\\') { 'tutti gli utenti' } else { 'cartella Esecuzione automatica' }
  '  {0} ({1})' -f $_.Name, $where
}
'Servizi automatici fermi:'
Get-CimInstance Win32_Service -Filter "StartMode='Auto' AND State<>'Running'" | Where-Object { $_.Name -notmatch '^(sppsvc|RemoteRegistry|gupdate|gupdatem|edgeupdate|edgeupdatem|MapsBroker|WbioSrvc|CDPSvc|BITS|TrustedInstaller|wuauserv|UsoSvc|GoogleUpdater.*|tiledatamodelsvc|DoSvc)$' } | Select-Object -First 12 | ForEach-Object { '  {0} ({1})' -f $_.DisplayName, $_.Name }
"#;

const EVENTS: &str = r#"
'== Errori nei registri (24 ore)'
$since = (Get-Date).AddHours(-24)
foreach ($log in 'System', 'Application') {
  $ev = Get-WinEvent -FilterHashtable @{ LogName = $log; Level = 1, 2; StartTime = $since } -MaxEvents 300 -ErrorAction SilentlyContinue
  if ($ev) {
    "${log}: $(@($ev).Count) errori"
    @($ev) | Group-Object ProviderName, Id | Sort-Object Count -Descending | Select-Object -First 8 | ForEach-Object {
      $m = (("" + $_.Group[0].Message) -split "`n")[0].Trim(); if ($m.Length -gt 140) { $m = $m.Substring(0, 140) + '…' }
      '  {0}× {1}: {2}' -f $_.Count, $_.Name, $m
    }
  } else { "${log}: nessun errore" }
}
"#;

const PRINT: &str = r#"
'== Stampa'
"Spooler: $((Get-Service Spooler -ErrorAction SilentlyContinue).Status)"
$states = @{ 1 = 'altro'; 2 = 'sconosciuto'; 3 = 'pronta'; 4 = 'in stampa'; 5 = 'si scalda'; 6 = 'ferma'; 7 = 'non in linea' }
Get-CimInstance Win32_Printer -ErrorAction SilentlyContinue | Where-Object { $_.Name -notmatch '^(Fax|OneNote|Microsoft XPS|Microsoft Print to PDF)' } | ForEach-Object {
  $st = $states[[int]$_.PrinterStatus]; if (-not $st) { $st = "stato $($_.PrinterStatus)" }
  '{0} · porta {1} · {2}{3}{4}' -f $_.Name, $_.PortName, $st, $(if ($_.Default) { ' · predefinita' }), $(if ($_.WorkOffline) { ' · NON IN LINEA' })
}
"Stampe in coda: $(@(Get-CimInstance Win32_PrintJob -ErrorAction SilentlyContinue).Count)"
"#;

const DOMAIN: &str = r#"
'== Dominio e ora'
$cs = Get-CimInstance Win32_ComputerSystem
"Nel dominio: $($cs.PartOfDomain) ($($cs.Domain))"
if ($cs.PartOfDomain) {
  $dc = nltest /dsgetdc:$($cs.Domain) 2>$null | Select-Object -First 3
  if ($dc) { 'Controller: ' + (($dc -join ' ') -replace '\s+', ' ').Trim() }
  try { 'Canale sicuro con il dominio: ' + (Test-ComputerSecureChannel -ErrorAction Stop) } catch { 'Canale sicuro: non verificabile (' + $_.Exception.Message + ')' }
}
$tm = w32tm /query /status 2>$null | Where-Object { $_ -match '(Source|Origine|Last Successful|Ultima sincronizzazione)' } | ForEach-Object { $_.Trim() }
if ($tm) { 'Ora: ' + ($tm -join ' · ') }
"#;

/// The areas in the tool's list, with their checks.
const AREAS: &[(&str, &str)] = &[("rete", NETWORK), ("wifi", WIFI), ("lentezza", SLOW), ("avvio", STARTUP), ("eventi", EVENTS), ("stampa", PRINT), ("dominio", DOMAIN)];

/// Runs the checks itself, or on `$env:EI_HOST` through WinRM.
const RUNNER: &str = r#"
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$ErrorActionPreference = 'Continue'
$code = [scriptblock]::Create($env:EI_CODE)
if ($env:EI_HOST) { Invoke-Command -ComputerName $env:EI_HOST -ScriptBlock $code -ErrorAction Stop | Out-String -Width 300 }
else { & $code | Out-String -Width 300 }
"#;

/// The script for the chosen areas ("tutto" = network, slowness and errors).
fn script(areas: &[String]) -> String {
    let mut code = BASE.to_string();
    let all = areas.is_empty() || areas.iter().any(|a| a == "tutto");
    for (name, part) in AREAS {
        let wanted = if all { matches!(*name, "rete" | "lentezza" | "eventi") } else { areas.iter().any(|a| a == name) };
        if wanted {
            code.push_str(part);
        }
    }
    code
}

/// A host name or address, and nothing else.
fn valid_host(h: &str) -> bool {
    !h.is_empty() && h.len() <= 253 && h.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':'))
}

pub async fn run(args: &Value) -> Result<String, String> {
    let host = args.get("host").and_then(Value::as_str).unwrap_or_default().trim().to_string();
    let local = host.is_empty() || matches!(host.to_lowercase().as_str(), "localhost" | "127.0.0.1" | ".");
    if !local && !valid_host(&host) {
        return Err(t("Nome o indirizzo del PC non valido.").into());
    }
    let areas: Vec<String> = match args.get("areas") {
        Some(Value::Array(a)) => a.iter().filter_map(Value::as_str).map(str::to_lowercase).collect(),
        Some(Value::String(s)) => s.split([',', ' ']).filter(|x| !x.is_empty()).map(str::to_lowercase).collect(),
        _ => Vec::new(),
    };
    let code = script(&areas);
    let target = if local { String::new() } else { host.clone() };
    let out = crate::zip::powershell(RUNNER, &[("EI_CODE", &code), ("EI_HOST", &target)], TIMEOUT)
        .await
        .map_err(|e| if local { tf("Controllo non riuscito: {e}", &[("e", &e)]) } else { tf("Non riesco a controllare {host} con WinRM: {e}", &[("host", &host), ("e", &e)]) })?;
    let out: String = out.lines().map(str::trim_end).filter(|l| !l.trim().is_empty()).collect::<Vec<_>>().join("\n");
    let n = out.chars().count();
    Ok(if n > MAX_OUT { format!("{}…", out.chars().take(MAX_OUT).collect::<String>()) } else { out })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn areas_pick_their_checks() {
        let s = script(&["wifi".to_string()]);
        assert!(s.contains("== Wi-Fi") && !s.contains("== Rete"));
        let all = script(&[]);
        assert!(all.contains("== Rete") && all.contains("== Lentezza") && all.contains("== Errori"));
        assert!(!all.contains("== Stampa"));
    }

    #[test]
    fn only_names_and_addresses_as_hosts() {
        assert!(valid_host("LEN-AMM01"));
        assert!(valid_host("192.168.0.240"));
        assert!(!valid_host("pc; rm -rf"));
        assert!(!valid_host("$(evil)"));
    }
}

#[cfg(test)]
mod live {
    /// `cargo test pccheck::live -- --ignored --nocapture`: every area on this PC.
    #[test]
    #[ignore]
    fn this_pc() {
        let host = std::env::var("EI_TEST_HOST").unwrap_or_default();
        let args = serde_json::json!({ "host": host, "areas": ["rete", "wifi", "lentezza", "avvio", "eventi", "stampa", "dominio"] });
        let out = tauri::async_runtime::block_on(super::run(&args));
        println!("{}", out.unwrap_or_else(|e| format!("ERRORE: {e}")));
    }
}
