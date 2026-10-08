// Quick actions: start a program, run a script (only ever after a click in the
// island), read the clipboard for "ask the character about what I copied".
//
// Nothing here goes through a shell unless the action *is* a script, and then
// only the shell the user picked. Programs get their arguments as an argv list.

use std::collections::HashMap;
use std::os::windows::process::CommandExt;
use std::path::Path;
use std::process::Stdio;
use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// Output kept for the island; a script printing megabytes is cut, not shown.
const MAX_OUTPUT_CHARS: usize = 20_000;
const SCRIPT_TIMEOUT: Duration = Duration::from_secs(300);

/// Running scripts by run id → process id, for the Stop button.
static RUNNING: Mutex<Option<HashMap<String, u32>>> = Mutex::new(None);

/// Splits an argument string the way a user would type it: spaces separate,
/// double quotes group (`"C:\Program Files\x" /v` → two arguments).
pub fn split_args(s: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    let mut any = false;
    for c in s.chars() {
        match c {
            '"' => {
                quoted = !quoted;
                any = true;
            }
            c if c.is_whitespace() && !quoted => {
                if any {
                    out.push(std::mem::take(&mut cur));
                    any = false;
                }
            }
            c => {
                cur.push(c);
                any = true;
            }
        }
    }
    if any {
        out.push(cur);
    }
    out
}

/// The target as typed or pasted: `"C:\Program Files\x.exe"` (Explorer's "Copy
/// as path" adds the quotes) loses them, `%ProgramFiles%` and friends expand.
pub fn clean_target(target: &str) -> String {
    let t = target.trim();
    let t = t.strip_prefix('"').and_then(|s| s.strip_suffix('"')).unwrap_or(t).trim();
    expand_env(t, |name| std::env::var(name).ok())
}

/// `%NAME%` → its value; unknown names and a lone `%` stay as they are.
fn expand_env(s: &str, lookup: impl Fn(&str) -> Option<String>) -> String {
    let mut out = String::new();
    let mut rest = s;
    while let Some(start) = rest.find('%') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('%') {
            Some(end) if end > 0 => match lookup(&after[..end]) {
                Some(v) => {
                    out.push_str(&v);
                    rest = &after[end + 1..];
                }
                None => {
                    out.push('%');
                    rest = after;
                }
            },
            _ => {
                out.push('%');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

/// Starts a program (or opens a folder/file with its default handler).
pub fn open_app(target: &str, args: &str) -> Result<(), String> {
    let target = clean_target(target);
    let target = target.as_str();
    if target.is_empty() {
        return Err("Nessun programma indicato.".into());
    }
    let path = Path::new(target);
    // A folder or a document: Explorer knows what to do with it.
    if path.is_dir() || (path.is_file() && !is_executable(path)) {
        std::process::Command::new("explorer")
            .arg(target)
            .spawn()
            .map_err(|e| format!("Impossibile aprire {target}: {e}"))?;
        return Ok(());
    }
    match std::process::Command::new(target).args(split_args(args)).spawn() {
        Ok(_) => Ok(()),
        // CreateProcess only knows full paths and the PATH. ShellExecute also
        // reads App Paths (chrome, winword, excel), opens shell: and ms-settings:
        // targets and asks for elevation when a program wants it (regedit):
        // the usual reasons a "Programma" action did not start.
        Err(e) => shell_execute(target, args).map_err(|_| format!("Impossibile avviare {target}: {e}")),
    }
}

/// ShellExecute "open": no shell in between, the arguments go as typed.
/// SEE_MASK_FLAG_NO_UI: a name that does not exist is an error in the island,
/// not a Windows dialog (the UAC prompt of an elevated program still shows).
fn shell_execute(target: &str, args: &str) -> Result<(), ()> {
    use windows::core::{HSTRING, PCWSTR};
    use windows::Win32::UI::Shell::{ShellExecuteExW, SEE_MASK_FLAG_NO_UI, SHELLEXECUTEINFOW};
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

    let file = HSTRING::from(target);
    let params = HSTRING::from(args.trim());
    let mut info = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_FLAG_NO_UI,
        lpVerb: windows::core::w!("open"),
        lpFile: PCWSTR(file.as_ptr()),
        lpParameters: if args.trim().is_empty() { PCWSTR::null() } else { PCWSTR(params.as_ptr()) },
        nShow: SW_SHOWNORMAL.0,
        ..Default::default()
    };
    unsafe { ShellExecuteExW(&mut info) }.map_err(|_| ())
}

fn is_executable(p: &Path) -> bool {
    matches!(
        p.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase).as_deref(),
        Some("exe" | "com" | "bat" | "cmd")
    )
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScriptResult {
    pub code: Option<i32>,
    pub output: String,
    pub timed_out: bool,
}

fn truncate(mut s: String) -> String {
    if s.chars().count() > MAX_OUTPUT_CHARS {
        s = s.chars().take(MAX_OUTPUT_CHARS).collect();
        s.push_str("\n… (output troncato)");
    }
    s
}

/// Runs a script in PowerShell or cmd, hidden, and returns what it printed.
pub async fn run_script(run_id: &str, shell: &str, script: &str) -> Result<ScriptResult, String> {
    let mut cmd = if shell == "cmd" {
        let mut c = tokio::process::Command::new("cmd");
        // /S + outer quotes: cmd keeps the inner text exactly as written.
        c.raw_arg(format!("/D /S /C \"chcp 65001 >nul & {script}\""));
        c
    } else {
        let mut c = tokio::process::Command::new("powershell");
        c.args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            &format!("[Console]::OutputEncoding=[Text.Encoding]::UTF8; {script}"),
        ]);
        c
    };
    cmd.stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .creation_flags(CREATE_NO_WINDOW);

    let child = cmd.spawn().map_err(|e| format!("Lo script non parte: {e}"))?;
    if let Some(pid) = child.id() {
        RUNNING.lock().unwrap().get_or_insert_with(HashMap::new).insert(run_id.to_string(), pid);
    }
    let result = tokio::time::timeout(SCRIPT_TIMEOUT, child.wait_with_output()).await;
    let pid = RUNNING.lock().unwrap().as_mut().and_then(|m| m.remove(run_id));

    match result {
        Ok(Ok(out)) => {
            let mut text = String::from_utf8_lossy(&out.stdout).into_owned();
            let err = String::from_utf8_lossy(&out.stderr);
            if !err.trim().is_empty() {
                if !text.is_empty() {
                    text.push('\n');
                }
                text.push_str(err.trim_end());
            }
            Ok(ScriptResult { code: out.status.code(), output: truncate(text), timed_out: false })
        }
        Ok(Err(e)) => Err(format!("Lo script si è interrotto: {e}")),
        Err(_) => {
            if let Some(pid) = pid {
                kill_tree(pid);
            }
            Ok(ScriptResult { code: None, output: String::new(), timed_out: true })
        }
    }
}

/// The Stop button: ends the script and anything it started.
pub fn kill(run_id: &str) {
    let pid = RUNNING.lock().unwrap().as_mut().and_then(|m| m.remove(run_id));
    if let Some(pid) = pid {
        kill_tree(pid);
    }
}

pub(crate) fn kill_tree(pid: u32) {
    let _ = std::process::Command::new("taskkill")
        .args(["/PID", &pid.to_string(), "/T", "/F"])
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

/// Text currently on the clipboard, if any.
pub fn clipboard_text() -> Option<String> {
    use windows::Win32::Foundation::HGLOBAL;
    use windows::Win32::System::DataExchange::{CloseClipboard, GetClipboardData, OpenClipboard};
    use windows::Win32::System::Memory::{GlobalLock, GlobalUnlock};
    use windows::Win32::System::Ole::CF_UNICODETEXT;

    unsafe {
        // Another app may hold the clipboard for a moment.
        let mut opened = false;
        for _ in 0..5 {
            if OpenClipboard(None).is_ok() {
                opened = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        if !opened {
            return None;
        }
        let text = (|| {
            let handle = GetClipboardData(CF_UNICODETEXT.0 as u32).ok()?;
            let global = HGLOBAL(handle.0);
            let ptr = GlobalLock(global) as *const u16;
            if ptr.is_null() {
                return None;
            }
            let mut len = 0usize;
            while *ptr.add(len) != 0 {
                len += 1;
            }
            let s = String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len));
            let _ = GlobalUnlock(global);
            Some(s)
        })();
        let _ = CloseClipboard();
        text.filter(|t| !t.trim().is_empty())
    }
}

/// Puts `text` on the clipboard (Unicode).
pub fn set_clipboard_text(text: &str) -> Result<(), String> {
    use windows::Win32::Foundation::{GlobalFree, HANDLE};
    use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData};
    use windows::Win32::System::Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE};
    use windows::Win32::System::Ole::CF_UNICODETEXT;

    let wide: Vec<u16> = text.encode_utf16().chain(std::iter::once(0)).collect();
    unsafe {
        let mut opened = false;
        for _ in 0..5 {
            if OpenClipboard(None).is_ok() {
                opened = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        if !opened {
            return Err("Gli appunti sono occupati da un'altra app".into());
        }
        let result = (|| {
            EmptyClipboard().map_err(|e| e.to_string())?;
            let mem = GlobalAlloc(GMEM_MOVEABLE, wide.len() * 2).map_err(|e| e.to_string())?;
            let ptr = GlobalLock(mem) as *mut u16;
            if ptr.is_null() {
                let _ = GlobalFree(Some(mem));
                return Err("memoria non disponibile".to_string());
            }
            std::ptr::copy_nonoverlapping(wide.as_ptr(), ptr, wide.len());
            let _ = GlobalUnlock(mem);
            // On success the clipboard owns the memory.
            if SetClipboardData(CF_UNICODETEXT.0 as u32, Some(HANDLE(mem.0))).is_err() {
                let _ = GlobalFree(Some(mem));
                return Err("copia non riuscita".to_string());
            }
            Ok(())
        })();
        let _ = CloseClipboard();
        result
    }
}

#[cfg(test)]
mod tests {
    use super::{expand_env, split_args};

    #[test]
    fn a_name_that_does_not_exist_is_an_error_without_a_dialog() {
        assert!(super::shell_execute("easyisland-programma-che-non-esiste-42", "").is_err());
        assert!(super::open_app("easyisland-programma-che-non-esiste-42", "").is_err());
    }

    #[test]
    fn expands_environment_variables() {
        let env = |n: &str| match n {
            "ProgramFiles" => Some(r"C:\Program Files".to_string()),
            _ => None,
        };
        assert_eq!(expand_env(r"%ProgramFiles%\App\app.exe", env), r"C:\Program Files\App\app.exe");
        assert_eq!(expand_env("%Nope%\\x", env), "%Nope%\\x");
        assert_eq!(expand_env("100% sicuro", env), "100% sicuro");
        assert_eq!(expand_env("a%%b", env), "a%%b");
        assert_eq!(expand_env("mstsc", env), "mstsc");
    }

    #[test]
    fn splits_like_a_command_line() {
        assert_eq!(split_args(""), Vec::<String>::new());
        assert_eq!(split_args("/v:server01 /f"), vec!["/v:server01", "/f"]);
        assert_eq!(
            split_args(r#""C:\Program Files\App\app.exe" --x "a b""#),
            vec![r"C:\Program Files\App\app.exe", "--x", "a b"]
        );
        assert_eq!(split_args(r#"--name """#), vec!["--name", ""]);
    }
}
