// "Continua" on the island's finished card: the next message for a coding
// session, written in the island, reaches the session where it runs.
//
//   console  Claude Code in a terminal (Windows Terminal, a console, VS Code's
//            or Cursor's terminal): `easyisland-hook type <pid>` types it into
//            the session's console and presses Enter (hook/src/console.rs).
//   link     Claude Code's VS Code / Cursor extension: its own link opens the
//            session with the text in the prompt box; Enter stays with the user
//            (the extension does not let anything send for them).
//   opencode the service's `/api/session/{id}/prompt` (opencode_agent.rs).
//
// The Claude desktop app has no way in: the island offers "Apri" instead.
// The text is only what the user typed; nothing here runs a command.

use std::io::Write;
use std::os::windows::process::CommandExt;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use crate::i18n::{t, tf};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// The relay types, waits a quarter of a second and presses Enter.
const TYPE_TIMEOUT: Duration = Duration::from_secs(8);

/// "sent" when the session got it, "prefilled" when it waits in the prompt box.
#[tauri::command]
pub async fn session_reply(mode: String, text: String, pid: Option<u32>, session: Option<String>, scheme: Option<String>) -> Result<String, String> {
    let text = text.trim().to_string();
    if text.is_empty() {
        return Err(t("Scrivi prima il messaggio.").into());
    }
    match mode.as_str() {
        "console" => {
            let pid = pid.filter(|p| *p > 0).ok_or_else(|| t("La sessione non è più aperta.").to_string())?;
            tauri::async_runtime::spawn_blocking(move || type_into(pid, &text)).await.map_err(|e| e.to_string())??;
            Ok("sent".into())
        }
        "link" => {
            let scheme = match scheme.as_deref() {
                Some("cursor") => "cursor",
                _ => "vscode",
            };
            let mut url = format!("{scheme}://anthropic.claude-code/open?prompt={}", encode(&text));
            if let Some(s) = session.as_deref().filter(|s| !s.is_empty()) {
                url.push_str(&format!("&session={}", encode(s)));
            }
            Command::new("rundll32.exe")
                .args(["url.dll,FileProtocolHandler", &url])
                .creation_flags(CREATE_NO_WINDOW)
                .spawn()
                .map_err(|e| e.to_string())?;
            Ok("prefilled".into())
        }
        "opencode" => {
            let session = session.unwrap_or_default();
            crate::opencode_agent::prompt(&session, &text).await?;
            Ok("sent".into())
        }
        _ => Err(t("Questa sessione non può ricevere messaggi dall'isola.").into()),
    }
}

/// The relay, hidden, with the text on its stdin.
fn type_into(pid: u32, text: &str) -> Result<(), String> {
    let exe = crate::settings::hook_exe_path();
    let mut child = Command::new(&exe)
        .args(["type", &pid.to_string()])
        .env("EASYISLAND_INTERNAL", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .creation_flags(CREATE_NO_WINDOW)
        .spawn()
        .map_err(|e| tf("easyisland-hook non avviato: {e}", &[("e", &e)]))?;
    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(text.as_bytes());
    }
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(_)) => return Err(t("Non riesco a scrivere nel terminale della sessione.").into()),
            Ok(None) if start.elapsed() < TYPE_TIMEOUT => std::thread::sleep(Duration::from_millis(50)),
            _ => {
                let _ = child.kill();
                return Err(t("Il terminale della sessione non risponde.").into());
            }
        }
    }
}

/// Percent-encoding for a query value (RFC 3986 unreserved characters stay).
fn encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::encode;

    #[test]
    fn query_values_are_percent_encoded() {
        assert_eq!(encode("fai i test & poi?"), "fai%20i%20test%20%26%20poi%3F");
        assert_eq!(encode("è"), "%C3%A8");
    }
}
