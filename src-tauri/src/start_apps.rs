// The programs in the Start menu, for the island's search bar. Windows' own
// list (`Get-StartApps`, Store apps such as the new Outlook, Teams or Claude
// included) started as `shell:AppsFolder\<AppID>`, exactly as from Start. It
// takes PowerShell about 2 s, so it is kept in memory for a few minutes;
// nothing goes on disk. Without PowerShell: the shortcuts (.lnk, .url) of the
// Start menu folders, opened like documents (actions::open_app → Explorer).

use std::collections::HashSet;
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const CACHE_FOR: Duration = Duration::from_secs(5 * 60);

static CACHE: Mutex<Option<(Instant, Vec<StartApp>)>> = Mutex::new(None);

#[derive(Serialize, Clone)]
pub struct StartApp {
    pub name: String,
    pub path: String,
}

/// Names that are not programs to start.
fn skipped(name: &str) -> bool {
    let n = name.to_lowercase();
    ["uninstall", "disinstall", "readme", "leggimi", "license", "licenza"].iter().any(|w| n.contains(w))
}

fn walk(dir: &Path, depth: u32, out: &mut Vec<StartApp>) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for e in entries.flatten() {
        let path = e.path();
        if path.is_dir() {
            if depth < 4 {
                walk(&path, depth + 1, out);
            }
            continue;
        }
        let ext = path.extension().map(|x| x.to_string_lossy().to_lowercase()).unwrap_or_default();
        if ext != "lnk" && ext != "url" {
            continue;
        }
        let Some(name) = path.file_stem().map(|s| s.to_string_lossy().to_string()) else { continue };
        if !skipped(&name) {
            out.push(StartApp { name, path: path.to_string_lossy().to_string() });
        }
    }
}

#[derive(Deserialize)]
struct PsApp {
    #[serde(rename = "Name")]
    name: String,
    #[serde(rename = "AppID")]
    app_id: String,
}

/// Parses `Get-StartApps | ConvertTo-Json`: one object for a single app, an array otherwise.
fn parse_start_apps(json: &str) -> Option<Vec<StartApp>> {
    let apps: Vec<PsApp> = match serde_json::from_str::<serde_json::Value>(json.trim()).ok()? {
        v @ serde_json::Value::Array(_) => serde_json::from_value(v).ok()?,
        v => vec![serde_json::from_value(v).ok()?],
    };
    Some(
        apps.into_iter()
            .filter(|a| !a.name.trim().is_empty() && !a.app_id.trim().is_empty() && !skipped(&a.name))
            .map(|a| StartApp { name: a.name, path: format!(r"shell:AppsFolder\{}", a.app_id) })
            .collect(),
    )
}

fn from_windows() -> Option<Vec<StartApp>> {
    let out = std::process::Command::new("powershell")
        .args(["-NoProfile", "-NonInteractive", "-Command",
            "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-StartApps | Select-Object Name,AppID | ConvertTo-Json -Compress"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    parse_start_apps(&String::from_utf8_lossy(&out.stdout)).filter(|l| !l.is_empty())
}

fn from_shortcuts() -> Vec<StartApp> {
    let mut out = Vec::new();
    for var in ["ProgramData", "APPDATA"] {
        if let Some(base) = std::env::var_os(var) {
            walk(&PathBuf::from(base).join(r"Microsoft\Windows\Start Menu\Programs"), 0, &mut out);
        }
    }
    out
}

/// Every program of the Start menu, by name, without duplicates.
pub fn list() -> Vec<StartApp> {
    if let Some((at, apps)) = CACHE.lock().unwrap().as_ref() {
        if at.elapsed() < CACHE_FOR {
            return apps.clone();
        }
    }
    let mut out = from_windows().unwrap_or_else(from_shortcuts);
    let mut seen = HashSet::new();
    out.retain(|a| seen.insert(a.name.to_lowercase()));
    out.sort_by_key(|a| a.name.to_lowercase());
    *CACHE.lock().unwrap() = Some((Instant::now(), out.clone()));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uninstallers_are_not_programs() {
        assert!(skipped("Disinstalla Foo"));
        assert!(skipped("Uninstall OpenCode"));
        assert!(!skipped("Excel"));
    }

    #[test]
    fn start_apps_json_one_or_many() {
        let many = parse_start_apps(r#"[{"Name":"Outlook (new)","AppID":"Microsoft.OutlookForWindows_8wekyb3d8bbwe!Microsoft.OutlookforWindows"},{"Name":"Disinstalla Foo","AppID":"x"}]"#).unwrap();
        assert_eq!(many.len(), 1);
        assert_eq!(many[0].path, r"shell:AppsFolder\Microsoft.OutlookForWindows_8wekyb3d8bbwe!Microsoft.OutlookforWindows");
        let one = parse_start_apps(r#"{"Name":"Excel","AppID":"Microsoft.Office.EXCEL.EXE.15"}"#).unwrap();
        assert_eq!(one[0].name, "Excel");
        assert!(parse_start_apps("").is_none());
    }
}
