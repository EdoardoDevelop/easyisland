//! `easyisland-hook statusline`: Claude Code's status line command, for the
//! plan limits in the Consumo card (taken from Coucou's `--statusline`).
//!
//! Claude Code hands its status line command the session's JSON on stdin, and
//! whatever that command prints becomes the status line. EasyIsland only wants
//! the plan limits (`rate_limits`, Pro and Max only) out of it: they go on to the
//! app and nothing else of the input does. If the user had a status line of
//! their own, the app saved it in `statusline-previous.json` next to this
//! program when it took its place: it is run the way Claude Code runs it (Git
//! Bash's `bash -c`) with the same input, and what it prints is passed on
//! untouched, so it keeps working.
//!
//! Never blocking Claude Code: the app gets [`APP_BUDGET`] at most, the user's
//! own status line [`PREVIOUS_BUDGET`] (then it is killed and prints nothing), and
//! no more than [`MAX_OUTPUT`] bytes of what it prints are kept.

use std::io::{Read, Write};
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};

use crate::{talk, truncate_strings, CONNECT_TIMEOUT};

/// How long the app may take to take the limits: the same as a hook connect.
const APP_BUDGET: Duration = CONNECT_TIMEOUT;
/// How long the user's own status line may take before we give up on it.
const PREVIOUS_BUDGET: Duration = Duration::from_secs(10);
/// What is kept of the user's status line output; the rest is drained and dropped.
const MAX_OUTPUT: usize = 64 * 1024;
/// After the command has exited, how long its output may still take to arrive
/// (a background child of it can hold the pipe open forever).
const DRAIN_GRACE: Duration = Duration::from_millis(200);
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// Saved by the app next to this program when the relay took the status line
/// (`hooks.rs` in the app, same name).
const PREVIOUS_FILE: &str = "statusline-previous.json";

pub fn run() -> ! {
    let mut raw = Vec::new();
    let _ = std::io::stdin().read_to_end(&mut raw);
    if raw.starts_with(&[0xEF, 0xBB, 0xBF]) {
        raw.drain(..3);
    }

    // The limits go on in the background, never delaying the status line.
    let sent = serde_json::from_slice::<serde_json::Value>(&raw)
        .ok()
        .and_then(|v| payload(v.as_object()?))
        .map(|line| {
            let (tx, rx) = mpsc::channel();
            std::thread::spawn(move || {
                let _ = tx.send(talk(&line, false));
            });
            rx
        });

    if let Some(command) = previous_command() {
        if let Some(out) = run_previous(&command, &raw, PREVIOUS_BUDGET) {
            let mut stdout = std::io::stdout();
            let _ = stdout.write_all(&out);
            let _ = stdout.flush();
        }
    }
    if let Some(rx) = sent {
        let _ = rx.recv_timeout(APP_BUDGET);
    }
    std::process::exit(0);
}

/// The one line the app gets from a status line call: the limits and which
/// session they came from, nothing else (no cwd, no model, no transcript).
/// Without limits (API-key users) there is nothing to send.
pub fn payload(map: &serde_json::Map<String, serde_json::Value>) -> Option<String> {
    let limits = map.get("rate_limits").filter(|v| v.is_object())?;
    let mut value = serde_json::json!({
        "hook_event_name": "StatusLine",
        "session_id": map.get("session_id").cloned().unwrap_or(serde_json::Value::Null),
        "rate_limits": limits,
    });
    truncate_strings(&mut value);
    let mut line = value.to_string();
    line.push('\n');
    Some(line)
}

/// The command of the status line the user had before the relay took its place.
fn previous_command() -> Option<String> {
    let path = std::env::current_exe().ok()?.with_file_name(PREVIOUS_FILE);
    let saved: serde_json::Value = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
    saved.get("command")?.as_str().filter(|c| !c.trim().is_empty()).map(str::to_string)
}

/// Claude Code runs status line commands through Git Bash, so a command written
/// for it (`~/bin/line.sh`, `$HOME`, pipes into `jq`…) only works there. No Git
/// Bash found: nothing is run rather than guessing with `cmd`.
fn shell(command: &str) -> Option<Command> {
    let bash = git_bash_candidates(|k| std::env::var_os(k), |p| p.is_file()).into_iter().next()?;
    let mut c = Command::new(bash);
    c.args(["-c", command]).creation_flags(CREATE_NO_WINDOW);
    Some(c)
}

/// Where Git Bash may be, best first, keeping only those `exists` accepts:
/// Claude Code's own override (`CLAUDE_CODE_GIT_BASH_PATH`), the Git for Windows
/// that `git.exe` on PATH belongs to, the usual install folders, then any
/// `bash.exe` on PATH except Windows' own WSL launcher (System32, WindowsApps).
fn git_bash_candidates(
    var: impl Fn(&str) -> Option<std::ffi::OsString>,
    exists: impl Fn(&Path) -> bool,
) -> Vec<PathBuf> {
    let mut out: Vec<PathBuf> = Vec::new();
    if let Some(p) = var("CLAUDE_CODE_GIT_BASH_PATH").filter(|p| !p.is_empty()) {
        out.push(PathBuf::from(p));
    }
    let path_dirs: Vec<PathBuf> = var("PATH").map(|p| std::env::split_paths(&p).collect()).unwrap_or_default();
    // …\Git\cmd\git.exe, …\Git\bin\git.exe or …\Git\mingw64\bin\git.exe.
    for dir in path_dirs.iter().filter(|d| exists(&d.join("git.exe"))) {
        if let Some(root) = dir.parent() {
            out.push(root.join("bin").join("bash.exe"));
            if let Some(up) = root.parent() {
                out.push(up.join("bin").join("bash.exe"));
            }
        }
    }
    for base in ["ProgramW6432", "ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(dir) = var(base).filter(|p| !p.is_empty()) {
            out.push(PathBuf::from(dir).join("Git").join("bin").join("bash.exe"));
        }
    }
    if let Some(dir) = var("LOCALAPPDATA").filter(|p| !p.is_empty()) {
        out.push(PathBuf::from(dir).join("Programs").join("Git").join("bin").join("bash.exe"));
    }
    for dir in &path_dirs {
        let windows_own = dir.components().any(|c| {
            let c = c.as_os_str().to_string_lossy();
            c.eq_ignore_ascii_case("system32") || c.eq_ignore_ascii_case("windowsapps")
        });
        if !windows_own {
            out.push(dir.join("bash.exe"));
        }
    }
    let mut seen = Vec::new();
    out.retain(|p| {
        let fresh = !seen.contains(p) && exists(p);
        seen.push(p.clone());
        fresh
    });
    out
}

/// Runs `command` through Git Bash with `input` on stdin and returns what it
/// printed (at most [`MAX_OUTPUT`] bytes), or nothing if it could not start or
/// ran past `budget` (then it is killed).
fn run_previous(command: &str, input: &[u8], budget: Duration) -> Option<Vec<u8>> {
    let mut child = shell(command)?
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;

    // Feed and drain on their own threads: a long input or output cannot wedge us.
    let mut stdin = child.stdin.take()?;
    let data = input.to_vec();
    std::thread::spawn(move || {
        let _ = stdin.write_all(&data);
    });
    let mut stdout = child.stdout.take()?;
    let kept = Arc::new(Mutex::new(Vec::new()));
    let (done_tx, done_rx) = mpsc::channel::<()>();
    {
        let kept = Arc::clone(&kept);
        std::thread::spawn(move || {
            let mut chunk = [0u8; 8192];
            loop {
                match stdout.read(&mut chunk) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        let mut buf = kept.lock().unwrap_or_else(|e| e.into_inner());
                        let room = MAX_OUTPUT.saturating_sub(buf.len());
                        buf.extend_from_slice(&chunk[..n.min(room)]);
                    }
                }
            }
            let _ = done_tx.send(());
        });
    }

    let deadline = Instant::now() + budget;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(10)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return None;
            }
        }
    }
    let _ = done_rx.recv_timeout(DRAIN_GRACE);
    let out = std::mem::take(&mut *kept.lock().unwrap_or_else(|e| e.into_inner()));
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::ffi::OsString;

    #[test]
    fn only_the_limits_and_the_session_go_to_the_app() {
        let input = serde_json::json!({
            "session_id": "s1", "cwd": "C:/segreto", "model": { "id": "x" },
            "transcript_path": "C:/Users/me/.claude/x.jsonl",
            "rate_limits": { "five_hour": { "used_percentage": 42, "resets_at": 1 } }
        });
        let line = payload(input.as_object().unwrap()).unwrap();
        assert!(line.ends_with('\n'));
        let v: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(v["hook_event_name"], "StatusLine");
        assert_eq!(v["session_id"], "s1");
        assert_eq!(v["rate_limits"]["five_hour"]["used_percentage"], 42);
        assert_eq!(v.as_object().unwrap().len(), 3);
    }

    #[test]
    fn without_limits_nothing_is_sent() {
        assert!(payload(serde_json::json!({ "session_id": "s1" }).as_object().unwrap()).is_none());
        assert!(payload(serde_json::json!({ "rate_limits": "x" }).as_object().unwrap()).is_none());
    }

    fn env(pairs: &[(&str, OsString)]) -> impl Fn(&str) -> Option<OsString> {
        let map: HashMap<String, OsString> = pairs.iter().map(|(k, v)| (k.to_string(), v.clone())).collect();
        move |k| map.get(k).cloned()
    }

    fn path_var(dirs: &[&str]) -> OsString {
        std::env::join_paths(dirs.iter().map(PathBuf::from)).unwrap()
    }

    #[test]
    fn git_bash_is_found_the_way_claude_code_finds_it() {
        let files = [
            "C:/override/bash.exe",
            "C:/git/cmd/git.exe",
            "C:/git/bin/bash.exe",
            "C:/pf/Git/bin/bash.exe",
            "C:/wsl/System32/bash.exe",
            "C:/msys/usr/bin/bash.exe",
        ];
        let exists = |p: &Path| files.iter().any(|f| Path::new(f) == p);
        let all = git_bash_candidates(
            env(&[
                ("CLAUDE_CODE_GIT_BASH_PATH", "C:/override/bash.exe".into()),
                ("PATH", path_var(&["C:/wsl/System32", "C:/git/cmd", "C:/msys/usr/bin"])),
                ("ProgramFiles", "C:/pf".into()),
            ]),
            exists,
        );
        assert_eq!(
            all,
            vec![
                PathBuf::from("C:/override/bash.exe"),
                PathBuf::from("C:/git/bin/bash.exe"),
                PathBuf::from("C:/pf/Git/bin/bash.exe"),
                PathBuf::from("C:/msys/usr/bin/bash.exe"),
            ]
        );
        // The WSL launcher in System32 is never taken for Git Bash.
        assert!(git_bash_candidates(env(&[("PATH", path_var(&["C:/wsl/System32"]))]), exists).is_empty());
    }

    #[test]
    fn the_users_own_status_line_gets_the_same_input() {
        // Needs Git Bash, as Claude Code does; without it nothing runs.
        if git_bash_candidates(|k| std::env::var_os(k), |p| p.is_file()).is_empty() {
            return;
        }
        let out = run_previous("cat; echo ' coda'", b"{\"a\":1}", Duration::from_secs(10)).unwrap();
        assert_eq!(String::from_utf8(out).unwrap().replace('\r', ""), "{\"a\":1} coda\n");
        assert!(run_previous("sleep 5", b"{}", Duration::from_millis(300)).is_none());
    }
}
