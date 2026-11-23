// The island's search field for the PC itself (22 Nov 2026, Edoardo: «usare
// EasyIsland per tutto, anche l'utilizzo normale del PC»):
//
// - Files: the recent ones (the shortcuts Windows keeps in Recent) and those of
//   Windows' own index (Windows Search, `SystemIndex`, files only, no mail).
//   Asked to one PowerShell kept open while the user searches (opening one
//   costs about half a second, a query a few tens of ms) and closed after a
//   while without questions. The words go in as JSON, the query is built here
//   from letters, digits and a few signs only: nothing typed reaches it as code.
// - Open windows: Enter brings one to the front instead of starting another copy.
// - Windows' own pages (Settings, Control Panel), from a fixed list: they open,
//   the user changes what they want there; nothing is changed from here.

use std::collections::HashSet;
use std::io::{BufRead, BufReader, Write};
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Receiver};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::Serialize;
use windows::core::BOOL;
use windows::Win32::Foundation::{HWND, LPARAM};
use windows::Win32::System::Threading::GetCurrentProcessId;
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindow, GetWindowLongPtrW, GetWindowThreadProcessId, IsWindow, IsWindowVisible, GWL_EXSTYLE, GW_OWNER,
    WS_EX_TOOLWINDOW,
};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// The PowerShell closes after this long without a question.
const IDLE: Duration = Duration::from_secs(120);
/// An answer later than this: the PowerShell is closed, the search goes on without files.
const ANSWER: Duration = Duration::from_secs(4);
const MAX_FILES: usize = 10;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FoundFile {
    pub name: String,
    pub path: String,
    /// The folder it is in, for the row.
    pub folder: String,
    pub dir: bool,
    /// Opened lately (Windows' Recent), not only found in the index.
    pub recent: bool,
}

const SCRIPT: &str = r#"
$ErrorActionPreference = 'SilentlyContinue'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$sh = New-Object -ComObject WScript.Shell
$rec = Join-Path $env:APPDATA 'Microsoft\Windows\Recent'
while ($null -ne ($l = [Console]::In.ReadLine())) {
  $out = New-Object System.Collections.ArrayList
  try {
    $q = $l | ConvertFrom-Json
    foreach ($f in (Get-ChildItem -LiteralPath $rec -Filter *.lnk -File | Sort-Object LastWriteTime -Descending | Select-Object -First 400)) {
      if ($out.Count -ge 6) { break }
      $n = $f.BaseName; $ok = $true
      foreach ($w in $q.words) { if ($n.IndexOf($w, [StringComparison]::OrdinalIgnoreCase) -lt 0) { $ok = $false; break } }
      if (-not $ok) { continue }
      $t = $sh.CreateShortcut($f.FullName).TargetPath
      if ($t -and (Test-Path -LiteralPath $t)) { [void]$out.Add(@{ p = $t; r = 1 }) }
    }
    $c = New-Object -ComObject ADODB.Connection
    $c.Open("Provider=Search.CollatorDSO;Extended Properties='Application=Windows';")
    $rs = $c.Execute($q.sql)
    while (-not $rs.EOF) { [void]$out.Add(@{ p = [string]$rs.Fields.Item(0).Value; r = 0 }); $rs.MoveNext() }
    $rs.Close(); $c.Close()
  } catch {}
  [Console]::Out.WriteLine((ConvertTo-Json -Compress -InputObject @($out)))
  [Console]::Out.Flush()
}
"#;

struct Worker {
    child: Child,
    stdin: ChildStdin,
    lines: Receiver<String>,
    used: Instant,
}

static WORKER: Mutex<Option<Worker>> = Mutex::new(None);

fn start() -> Option<Worker> {
    let mut child = Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", SCRIPT])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .ok()?;
    let stdin = child.stdin.take()?;
    let stdout = child.stdout.take()?;
    let (tx, lines) = channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if tx.send(line).is_err() {
                break;
            }
        }
    });
    // Closed after a while without questions: nothing stays open for nothing.
    std::thread::spawn(|| loop {
        std::thread::sleep(Duration::from_secs(30));
        let mut w = WORKER.lock().unwrap();
        match w.as_ref() {
            Some(x) if x.used.elapsed() > IDLE => {
                if let Some(mut x) = w.take() {
                    let _ = x.child.kill();
                }
                return;
            }
            None => return,
            _ => {}
        }
    });
    Some(Worker { child, stdin, lines, used: Instant::now() })
}

/// The words of `q` as the index may see them: letters, digits, ". - _" only.
fn words(q: &str) -> Vec<String> {
    q.split_whitespace()
        .map(|w| w.chars().filter(|c| c.is_alphanumeric() || matches!(c, '.' | '-' | '_')).take(40).collect::<String>())
        .filter(|w| !w.is_empty())
        .take(4)
        .collect()
}

/// Folders whose files nobody looks for by name (builds, packages, caches,
/// programs' own data), left out by the index query itself (`noise` checks again).
const NOISE: &[&str] = &["/node_modules/", "/.git/", "/target/", "/appdata/", "/.cache/", "/__pycache__/", "/.vs/", "/.fingerprint/"];

fn query(words: &[String]) -> String {
    let mut and: Vec<String> = words.iter().map(|w| format!("System.FileName LIKE '%{w}%'")).collect();
    and.extend(NOISE.iter().map(|n| format!("NOT System.ItemUrl LIKE '%{n}%'")));
    format!(
        "SELECT TOP 30 System.ItemUrl FROM SystemIndex WHERE SCOPE='file:' AND {} ORDER BY System.DateModified DESC",
        and.join(" AND ")
    )
}

/// Files whose name has every word of `q`: the recent ones first.
pub fn files(q: &str) -> Vec<FoundFile> {
    let words = words(q);
    if words.iter().map(|w| w.chars().count()).sum::<usize>() < 3 {
        return Vec::new();
    }
    let line = serde_json::json!({ "words": words, "sql": query(&words) }).to_string();
    let mut guard = WORKER.lock().unwrap();
    if guard.is_none() {
        *guard = start();
    }
    let Some(w) = guard.as_mut() else { return Vec::new() };
    w.used = Instant::now();
    // An answer left from a question given up on.
    while w.lines.try_recv().is_ok() {}
    if writeln!(w.stdin, "{line}").and_then(|_| w.stdin.flush()).is_err() {
        if let Some(mut x) = guard.take() {
            let _ = x.child.kill();
        }
        return Vec::new();
    }
    let answer = w.lines.recv_timeout(ANSWER);
    let Ok(answer) = answer else {
        crate::log::line("ricerca dei file: Windows Search non risponde, chiuso");
        if let Some(mut x) = guard.take() {
            let _ = x.child.kill();
        }
        return Vec::new();
    };
    drop(guard);
    read_answer(&answer)
}

/// Files nobody looks for by name: builds, packages, caches, programs' own data.
fn noise(path: &str) -> bool {
    let p = path.to_lowercase().replace('\\', "/");
    NOISE.iter().any(|w| p.contains(w))
}

fn read_answer(answer: &str) -> Vec<FoundFile> {
    let rows: Vec<serde_json::Value> = serde_json::from_str(answer).unwrap_or_default();
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for row in rows {
        let Some(raw) = row.get("p").and_then(|p| p.as_str()).map(str::trim).filter(|p| !p.is_empty()) else { continue };
        // The index gives "file:C:/Users/…" (its display path is translated: «C:\Utenti»).
        let path = raw.strip_prefix("file:").map(|u| u.replace('/', "\\")).unwrap_or_else(|| raw.to_string());
        let path = path.as_str();
        if noise(path) || !seen.insert(path.to_lowercase()) {
            continue;
        }
        let p = Path::new(path);
        let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| path.to_string());
        let folder = p.parent().map(|f| f.to_string_lossy().to_string()).unwrap_or_default();
        let recent = row.get("r").and_then(|r| r.as_i64()) == Some(1);
        out.push(FoundFile { name, path: path.to_string(), folder, dir: p.is_dir(), recent });
        if out.len() >= MAX_FILES {
            break;
        }
    }
    out
}

/// A found file opened as from Explorer, or selected in its folder.
pub fn open(path: &str, reveal: bool) -> Result<(), String> {
    let p = Path::new(path);
    if !p.is_absolute() || !p.exists() {
        return Err(crate::i18n::t("Il file non c'è più.").to_string());
    }
    let spawned = if reveal { crate::reveal_in_explorer(p) } else { Command::new("explorer").arg(p).spawn() };
    spawned.map(|_| ()).map_err(|e| e.to_string())
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OpenWindow {
    pub id: i64,
    pub app_name: String,
    pub title: String,
}

/// The windows on the taskbar, front to back (minimised ones too), not ours.
pub fn windows() -> Vec<OpenWindow> {
    unsafe extern "system" fn each(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let out = &mut *(lparam.0 as *mut Vec<HWND>);
        let owned = GetWindow(hwnd, GW_OWNER).is_ok_and(|o| !o.is_invalid());
        if IsWindowVisible(hwnd).as_bool()
            && !owned
            && GetWindowLongPtrW(hwnd, GWL_EXSTYLE) & WS_EX_TOOLWINDOW.0 as isize == 0
            && !crate::window_drop::cloaked(hwnd)
            && !crate::window_drop::SKIPPED_CLASSES.contains(&crate::window_drop::class_name(hwnd).as_str())
        {
            out.push(hwnd);
        }
        BOOL(1)
    }
    let mut all: Vec<HWND> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(each), LPARAM(&mut all as *mut Vec<HWND> as isize));
    }
    let own = unsafe { GetCurrentProcessId() };
    all.into_iter()
        .filter(|h| {
            let mut pid = 0u32;
            unsafe { GetWindowThreadProcessId(*h, Some(&mut pid)) };
            pid != own
        })
        .filter_map(|h| {
            let title = crate::window_drop::title(h);
            (!title.trim().is_empty()).then(|| OpenWindow { id: h.0 as isize as i64, app_name: crate::window_drop::app_name(h), title })
        })
        .take(40)
        .collect()
}

/// Brings a window of the list to the front (restored if minimised).
pub fn focus(id: i64) -> bool {
    let hwnd = HWND(id as isize as *mut std::ffi::c_void);
    unsafe {
        if id == 0 || !IsWindow(Some(hwnd)).as_bool() {
            return false;
        }
        let mut pid = 0u32;
        GetWindowThreadProcessId(hwnd, Some(&mut pid));
        if pid == GetCurrentProcessId() {
            return false;
        }
    }
    crate::apps::bring_front(hwnd)
}

/// Windows' own pages the search opens: (id, what is started). Nothing else is.
const PAGES: &[(&str, &str)] = &[
    ("bluetooth", "ms-settings:bluetooth"),
    ("wifi", "ms-settings:network-wifi"),
    ("network", "ms-settings:network-status"),
    ("vpn", "ms-settings:network-vpn"),
    ("sound", "ms-settings:sound"),
    ("display", "ms-settings:display"),
    ("nightlight", "ms-settings:nightlight"),
    ("printers", "ms-settings:printers"),
    ("mouse", "ms-settings:mousetouchpad"),
    ("keyboard", "ms-settings:typing"),
    ("notifications", "ms-settings:notifications"),
    ("background", "ms-settings:personalization-background"),
    ("colors", "ms-settings:colors"),
    ("apps", "ms-settings:appsfeatures"),
    ("defaultapps", "ms-settings:defaultapps"),
    ("startup", "ms-settings:startupapps"),
    ("power", "ms-settings:powersleep"),
    ("battery", "ms-settings:batterysaver"),
    ("storage", "ms-settings:storagesense"),
    ("update", "ms-settings:windowsupdate"),
    ("datetime", "ms-settings:dateandtime"),
    ("language", "ms-settings:regionlanguage"),
    ("accounts", "ms-settings:yourinfo"),
    ("privacy", "ms-settings:privacy"),
    ("security", "windowsdefender:"),
    ("about", "ms-settings:about"),
    ("clipboard", "ms-settings:clipboard"),
    ("multitasking", "ms-settings:multitasking"),
    ("settings", "ms-settings:"),
    ("control", "control.exe"),
    ("netconn", "control.exe ncpa.cpl"),
    ("programs", "control.exe appwiz.cpl"),
    ("devices", "control.exe hdwwiz.cpl"),
];

/// Whether `id` is one of `PAGES` (a button of the island may open it: island_layout.rs).
pub fn page_known(id: &str) -> bool {
    PAGES.iter().any(|(k, _)| *k == id)
}

/// The ids of `PAGES`, for the chat's island_layout.
pub fn page_ids() -> Vec<&'static str> {
    PAGES.iter().map(|(k, _)| *k).collect()
}

/// Opens one of `PAGES` by its id.
pub fn page(id: &str) -> bool {
    let Some((_, what)) = PAGES.iter().find(|(k, _)| *k == id) else { return false };
    let spawned = match what.split_once(' ') {
        Some((exe, arg)) => Command::new(exe).arg(arg).spawn(),
        None if *what == "control.exe" => Command::new(what).spawn(),
        None => Command::new("explorer.exe").arg(what).spawn(),
    };
    spawned.is_ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn words_keep_no_quote_or_wildcard() {
        assert_eq!(words("o'rdine  100%  fattura_2026.pdf"), vec!["ordine", "100", "fattura_2026.pdf"]);
        let q = query(&words("a' OR 1=1 --"));
        assert!(!q.contains("a'"));
        assert!(q.contains("LIKE '%a%'"));
    }

    #[test]
    fn answer_is_read_and_deduplicated() {
        let got = read_answer(r#"[{"p":"C:\\x\\Fattura.pdf","r":1},{"p":"file:c:/x/fattura.pdf","r":0},{"p":"file:C:/p/node_modules/a.pdf","r":0},{"p":"","r":0}]"#);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].name, "Fattura.pdf");
        assert_eq!(got[0].folder, "C:\\x");
        assert!(got[0].recent);
        assert!(read_answer("not json").is_empty());
    }

    #[test]
    fn pages_are_known_only() {
        assert!(!page("calc.exe"));
        assert!(PAGES.iter().all(|(_, w)| w.starts_with("ms-settings:") || w.starts_with("control.exe") || *w == "windowsdefender:"));
    }

    #[test]
    #[ignore]
    fn live_files() {
        let got = files("handoff");
        println!("{}", got.iter().map(|f| f.path.clone()).collect::<Vec<_>>().join("\n"));
    }
}
