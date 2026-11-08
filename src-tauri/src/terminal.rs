// «Terminale» in the chat (8 Nov 2026, as Claude Desktop's terminal beside
// the conversation): a PowerShell of the user's, in the chat's project folder.
// What runs there is what the user types, line by line, as in any terminal:
// never a command of an engine (those stay on Consenti / Nega). No PTY and no
// new dependency: PowerShell reads the lines from its stdin (`-Command -`),
// its output (and errors) comes back as `terminal-out` events. Programs that
// need a real console (editors, `ssh` asking a password) do not fit here: the
// note in the panel says to use Windows Terminal for those.

use std::collections::HashMap;
use std::io::{BufRead, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;

use tauri::{AppHandle, Emitter};

use crate::i18n::{t, tf};

struct Shell {
    child: Child,
    stdin: ChildStdin,
}

static SHELLS: Mutex<Option<HashMap<u32, Shell>>> = Mutex::new(None);
static NEXT: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(1);

fn with<R>(f: impl FnOnce(&mut HashMap<u32, Shell>) -> R) -> R {
    let mut g = SHELLS.lock().unwrap();
    f(g.get_or_insert_with(HashMap::new))
}

/// A new PowerShell in `folder` (the user's folder when it is not there); its id.
pub fn open(app: &AppHandle, folder: Option<&str>) -> Result<u32, String> {
    #[cfg(windows)]
    use std::os::windows::process::CommandExt;
    let dir = folder.map(std::path::PathBuf::from).filter(|d| d.is_dir()).or_else(|| std::env::var_os("USERPROFILE").map(std::path::PathBuf::from));
    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoLogo", "-NoProfile", "-NoExit", "-Command", "-"]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(d) = &dir {
        cmd.current_dir(d);
    }
    #[cfg(windows)]
    cmd.creation_flags(0x0800_0000);
    let mut child = cmd.spawn().map_err(|e| tf("PowerShell non si avvia: {e}", &[("e", &e)]))?;
    let mut stdin = child.stdin.take().ok_or(t("PowerShell non si avvia."))?;
    let id = NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    // UTF-8 both ways, and the prompt with the folder after each command (so the panel shows where it is).
    let _ = writeln!(stdin, "[Console]::InputEncoding = [Text.Encoding]::UTF8; [Console]::OutputEncoding = [Text.Encoding]::UTF8; $OutputEncoding = [Text.Encoding]::UTF8; function prompt {{ '' }}");
    let _ = writeln!(stdin, "Write-Output (\"PS \" + (Get-Location).Path + \">\")");
    let _ = stdin.flush();
    for (stream, err) in [(child.stdout.take().map(|s| Box::new(s) as Box<dyn Read + Send>), false), (child.stderr.take().map(|s| Box::new(s) as Box<dyn Read + Send>), true)] {
        let Some(stream) = stream else { continue };
        let app = app.clone();
        std::thread::spawn(move || {
            let reader = std::io::BufReader::new(stream);
            for line in reader.split(b'\n').map_while(Result::ok) {
                let text = String::from_utf8_lossy(&line).trim_end_matches('\r').to_string();
                let _ = app.emit_to(crate::island::WINDOW_LABEL, "terminal-out", serde_json::json!({ "id": id, "text": text, "error": err }));
            }
            if !err {
                let _ = app.emit_to(crate::island::WINDOW_LABEL, "terminal-out", serde_json::json!({ "id": id, "text": t("[PowerShell si è chiuso]"), "error": true, "closed": true }));
            }
        });
    }
    with(|all| all.insert(id, Shell { child, stdin }));
    crate::log::line(format!("terminale {id} aperto in {}", dir.map(|d| d.display().to_string()).unwrap_or_default()));
    Ok(id)
}

/// A line typed by the user, then where the shell is now.
pub fn write(id: u32, line: &str) -> Result<(), String> {
    with(|all| {
        let s = all.get_mut(&id).ok_or_else(|| t("Il terminale si è chiuso: aprine un altro.").to_string())?;
        let ok = writeln!(s.stdin, "{}", line.replace(['\r', '\n'], " ")).is_ok()
            && writeln!(s.stdin, "Write-Output (\"PS \" + (Get-Location).Path + \">\")").is_ok()
            && s.stdin.flush().is_ok();
        if ok { Ok(()) } else { Err(t("Il terminale si è chiuso: aprine un altro.").to_string()) }
    })
}

/// «✕» on the panel, the chat closed, the app's exit (None = all).
pub fn close(id: Option<u32>) {
    with(|all| {
        let ids: Vec<u32> = match id {
            Some(i) => vec![i],
            None => all.keys().copied().collect(),
        };
        for i in ids {
            if let Some(mut s) = all.remove(&i) {
                // The process and what it started.
                #[cfg(windows)]
                {
                    use std::os::windows::process::CommandExt;
                    let _ = Command::new("taskkill").args(["/PID", &s.child.id().to_string(), "/T", "/F"]).creation_flags(0x0800_0000).output();
                }
                let _ = s.child.kill();
            }
        }
    });
}
