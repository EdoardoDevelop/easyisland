// A PowerShell kept ready and signed in to Devolutions Cloud, for the reads
// the card asks for at a click (details, a password to copy or show).
// Before (18 Nov 2026), every click started pwsh, loaded the module and signed
// in again: seconds each time, and Edoardo found the card slow.
//
// - Started on the first read, or when the card opens (dvc_warm); stopped after
//   IDLE without use, at a failure, or when the identity changes (dvc::forget).
// - The key and the secret reach it only at the start, as environment
//   variables of that process, emptied right after Connect-HubAccount (as in
//   dvc::hub). Each request is a script read from its stdin (base64), with
//   ids only in it (entry, vault, row, checked by dvc::known); never a secret.
// - Writes (new credential, password list) keep going through dvc::hub, one
//   process each, as before: they carry the password to write.
// - Any problem: the caller falls back to dvc::hub.

use std::sync::Mutex as StdMutex;
use std::time::{Duration, Instant};

use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader, Lines};
use tokio::process::{Child, ChildStdin, ChildStdout};
use tokio::sync::Mutex;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// Unused this long, it goes (the Hub session with it).
const IDLE: Duration = Duration::from_secs(10 * 60);
/// One read at most this long (signing in included).
const CALL: Duration = Duration::from_secs(60);

/// The loop it runs after signing in: one base64 (UTF-16LE) script per line,
/// one line back: "OK <base64 UTF-8 output>" or "ERR <base64 message>".
const LOOP: &str = r#"
$enc = [System.Text.Encoding]::UTF8
function Reply($tag, $text) { [Console]::Out.WriteLine($tag + ' ' + [Convert]::ToBase64String($enc.GetBytes([string]$text))); [Console]::Out.Flush() }
Reply 'OK' 'pronto'
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($null -eq $line) { break }
  try {
    $code = [System.Text.Encoding]::Unicode.GetString([Convert]::FromBase64String($line))
    $out = & ([scriptblock]::Create($code)) | Out-String
    Reply 'OK' $out.Trim()
  } catch {
    Reply 'ERR' $_.Exception.Message
  }
}
"#;

struct Live {
    /// Kept for kill_on_drop: dropping Live ends the process.
    _child: Child,
    stdin: ChildStdin,
    lines: Lines<BufReader<ChildStdout>>,
    /// The identity it signed in with (a change: started again).
    who: String,
}

/// The one process, used by one read at a time.
static LIVE: Mutex<Option<Live>> = Mutex::const_new(None);
/// When it was used last (for the idle stop).
static USED: StdMutex<Option<Instant>> = StdMutex::new(None);

fn b64(bytes: &[u8]) -> String {
    crate::claude::base64_for(bytes)
}

fn unb64(s: &str) -> Option<String> {
    crate::backup::base64_decode(s.trim()).and_then(|b| String::from_utf8(b).ok())
}

/// One line of the loop: (ok, text).
async fn read_reply(lines: &mut Lines<BufReader<ChildStdout>>) -> Result<(bool, String), String> {
    let line = lines.next_line().await.map_err(|e| e.to_string())?.ok_or("PowerShell si è chiuso")?;
    let (tag, rest) = line.split_once(' ').unwrap_or((line.as_str(), ""));
    let text = unb64(rest).unwrap_or_default();
    match tag {
        "OK" => Ok((true, text)),
        "ERR" => Ok((false, text)),
        _ => Err(format!("risposta inattesa: {}", line.chars().take(80).collect::<String>())),
    }
}

async fn start(url: &str, key: &str, secret: &str) -> Result<Live, String> {
    let exe = crate::rdm::pwsh().ok_or("manca pwsh")?;
    let script = format!("{}{}{}", crate::rdm::PRELUDE, crate::dvc::CONNECT, LOOP);
    let bytes: Vec<u8> = script.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    let mut child = tokio::process::Command::new(exe)
        .args(["-NoProfile", "-NonInteractive", "-EncodedCommand", &b64(&bytes)])
        .env("EASYISLAND_INTERNAL", "1")
        .env("EASYISLAND_DVC_URL", url)
        .env("EASYISLAND_DVC_KEY", key)
        .env("EASYISLAND_DVC_SECRET", secret)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| e.to_string())?;
    let stdin = child.stdin.take().ok_or("stdin")?;
    let stdout = child.stdout.take().ok_or("stdout")?;
    let mut lines = BufReader::new(stdout).lines();
    // Signed in when the loop says «pronto»; a refused sign-in ends the process.
    match tokio::time::timeout(CALL, read_reply(&mut lines)).await {
        Ok(Ok((true, _))) => Ok(Live { _child: child, stdin, lines, who: format!("{url}|{key}") }),
        Ok(Ok((false, e))) | Ok(Err(e)) => Err(e),
        Err(_) => Err("accesso a Devolutions Cloud troppo lento".into()),
    }
}

/// Runs `script` (ids only, no secret) in the ready process: its output, or
/// Err for the caller to fall back to a process of its own.
pub async fn run(script: &str) -> Result<String, String> {
    let (url, key, secret) = crate::dvc::identity_pub()?;
    let who = format!("{url}|{key}");
    let mut guard = LIVE.lock().await;
    if guard.as_ref().is_some_and(|l| l.who != who) {
        *guard = None;
    }
    if guard.is_none() {
        let at = Instant::now();
        *guard = Some(start(&url, &key, &secret).await.map_err(|e| {
            crate::log::line(format!("dvc: connessione pronta non partita ({})", e.chars().take(120).collect::<String>()));
            e
        })?);
        crate::log::line(format!("dvc: connessione pronta in {} ms", at.elapsed().as_millis()));
        idle_watch();
    }
    drop((url, key, secret));
    let live = guard.as_mut().ok_or("nessun processo")?;
    let bytes: Vec<u8> = script.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    let line = format!("{}\n", b64(&bytes));
    let sent = live.stdin.write_all(line.as_bytes()).await.is_ok() && live.stdin.flush().await.is_ok();
    let reply = if sent { tokio::time::timeout(CALL, read_reply(&mut live.lines)).await } else { Ok(Err("scrittura".into())) };
    *USED.lock().unwrap_or_else(|e| e.into_inner()) = Some(Instant::now());
    match reply {
        Ok(Ok((true, out))) => Ok(out),
        // A script error: the process is fine, the error is the answer.
        Ok(Ok((false, e))) => Err(format!("RDM: {e}")),
        // The process is gone or stuck: next time a new one.
        Ok(Err(e)) => {
            *guard = None;
            Err(e)
        }
        Err(_) => {
            *guard = None;
            Err("tempo scaduto".into())
        }
    }
}

/// The card of Devolutions Cloud opened: signed in now, so the first click is quick.
pub async fn warm() {
    if crate::dvc::identity_pub().is_err() {
        return;
    }
    let _ = run("'pronto'").await;
}

/// Once a minute while it lives: unused for IDLE, it goes.
fn idle_watch() {
    tauri::async_runtime::spawn(async {
        loop {
            tokio::time::sleep(Duration::from_secs(60)).await;
            let idle = USED.lock().unwrap_or_else(|e| e.into_inner()).is_none_or(|t| t.elapsed() >= IDLE);
            let mut guard = LIVE.lock().await;
            if guard.is_none() {
                return;
            }
            if idle {
                *guard = None;
                crate::log::line("dvc: connessione pronta chiusa (inattiva)".to_string());
                return;
            }
        }
    });
}

#[cfg(test)]
mod tests {
    /// With the real identity of this PC (Credential Manager), read only:
    /// cargo test dvc_live -- --ignored --nocapture
    #[test]
    #[ignore]
    fn the_second_read_is_quick() {
        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        rt.block_on(async {
            for i in 0..3 {
                let at = std::time::Instant::now();
                let r = super::run("(Get-HubVault | Measure-Object).Count").await;
                println!("lettura {i}: {:?} in {} ms", r, at.elapsed().as_millis());
            }
        });
    }
}
