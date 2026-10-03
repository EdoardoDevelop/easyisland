// "Estrai…" for a ZIP dropped on the island: what is inside, then extract it
// into a new folder next to the original, in Downloads or on the Desktop.
//
// No new dependency: .NET's System.IO.Compression (always there on Windows),
// through a short PowerShell call. Paths travel in environment variables, so
// quotes and odd characters in names are never an issue. ExtractToDirectory
// refuses entries that would land outside the folder ("zip slip"), and the
// folder is always a new one, so nothing existing is ever overwritten.

use std::time::Duration;

use serde::{Deserialize, Serialize};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const LIST: &str = r#"$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
Add-Type -AssemblyName System.IO.Compression.FileSystem
$z=[IO.Compression.ZipFile]::OpenRead($env:EI_ZIP)
try {
  $files=@($z.Entries | Where-Object { $_.Name -ne '' })
  $size=0; foreach($e in $files){ $size+=$e.Length }
  [pscustomobject]@{
    count=$files.Count
    size=[int64]$size
    names=@($files | Select-Object -First 12 | ForEach-Object { $_.FullName })
  } | ConvertTo-Json -Compress
} finally { $z.Dispose() }"#;

const EXTRACT: &str = r#"$ErrorActionPreference='Stop'
[Console]::OutputEncoding=[Text.Encoding]::UTF8
Add-Type -AssemblyName System.IO.Compression.FileSystem
switch ($env:EI_WHERE) {
  'desktop'   { $parent=[Environment]::GetFolderPath('Desktop') }
  'downloads' { $parent=Join-Path $env:USERPROFILE 'Downloads' }
  default     { $parent=$env:EI_BESIDE }
}
if (-not $parent -or -not (Test-Path -LiteralPath $parent)) { $parent=Join-Path $env:USERPROFILE 'Downloads' }
$base=[IO.Path]::GetFileNameWithoutExtension($env:EI_NAME)
$dest=Join-Path $parent $base
$i=2
while (Test-Path -LiteralPath $dest) { $dest=Join-Path $parent "$base ($i)"; $i++ }
[IO.Compression.ZipFile]::ExtractToDirectory($env:EI_ZIP, $dest)
$dest"#;

#[derive(Serialize, Deserialize)]
pub struct ZipInfo {
    pub count: u64,
    pub size: u64,
    #[serde(default, deserialize_with = "strings")]
    pub names: Vec<String>,
}

/// ConvertTo-Json turns a one-element array into a plain string.
fn strings<'de, D: serde::Deserializer<'de>>(d: D) -> Result<Vec<String>, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum OneOrMany {
        Many(Vec<String>),
        One(String),
        None(()),
    }
    Ok(match OneOrMany::deserialize(d)? {
        OneOrMany::Many(v) => v,
        OneOrMany::One(s) => vec![s],
        OneOrMany::None(()) => Vec::new(),
    })
}

async fn powershell(script: &str, env: &[(&str, &str)], timeout: Duration) -> Result<String, String> {
    let mut cmd = tokio::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script])
        .creation_flags(CREATE_NO_WINDOW)
        .kill_on_drop(true);
    for (k, v) in env {
        cmd.env(k, v);
    }
    let out = match tokio::time::timeout(timeout, cmd.output()).await {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => return Err(e.to_string()),
        Err(_) => return Err("Tempo scaduto".into()),
    };
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let line = err
            .lines()
            .map(str::trim)
            .find(|l| !l.is_empty() && !l.starts_with("At line") && !l.starts_with("In riga"))
            .unwrap_or("errore sconosciuto");
        return Err(line.trim_start_matches("Exception calling").trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().trim_start_matches('\u{feff}').to_string())
}

/// What is inside the archive: number of files, total size, the first names.
pub async fn list(path: &str) -> Result<ZipInfo, String> {
    let text = powershell(LIST, &[("EI_ZIP", path)], Duration::from_secs(20))
        .await
        .map_err(|e| format!("Non è un archivio ZIP leggibile: {e}"))?;
    serde_json::from_str(&text).map_err(|_| "Non è un archivio ZIP leggibile".to_string())
}

/// Extracts into a new folder and returns its path. `place`: "beside" (next to
/// `source`, the original file), "downloads" or "desktop".
pub async fn extract(path: &str, name: &str, place: &str, source: Option<&str>) -> Result<String, String> {
    let beside = source
        .and_then(|s| std::path::Path::new(s).parent())
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default();
    let dest = powershell(
        EXTRACT,
        &[("EI_ZIP", path), ("EI_NAME", name), ("EI_WHERE", place), ("EI_BESIDE", &beside)],
        Duration::from_secs(600),
    )
    .await
    .map_err(|e| format!("Estrazione non riuscita: {e}"))?;
    let dest = dest.lines().last().unwrap_or_default().trim().to_string();
    if dest.is_empty() {
        return Err("Estrazione non riuscita".into());
    }
    let _ = std::process::Command::new("explorer").arg(&dest).spawn();
    Ok(dest)
}
