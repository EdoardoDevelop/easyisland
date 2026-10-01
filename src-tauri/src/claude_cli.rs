// Chat through the user's own Claude Code install (`claude -p`), so a Claude
// subscription covers it instead of a pay-as-you-go API key.
//
// The process runs hidden, in a neutral working folder, with:
//   * every hook disabled (`disableAllHooks`) — otherwise the chat would show up
//     in the island as if it were a Claude Code work session; COUCOU_INTERNAL is
//     a second guard that coucou-hook.exe checks too;
//   * only WebSearch, WebFetch and Read available, and `dontAsk` so nothing
//     waits on a permission prompt nobody can see;
//   * no MCP servers (`--strict-mcp-config` with no config), for a faster start.
// The prompt goes in on stdin, and every other argument is a plain word or a
// path, so nothing needs quoting when the target is `claude.cmd`.

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;

use crate::claude::{Chat, ChatContext, ChatReply};

/// Opus with a few web searches can take a while; the island shows "thinking".
const TIMEOUT: Duration = Duration::from_secs(180);
const STATUS_TIMEOUT: Duration = Duration::from_secs(20);
/// CREATE_NO_WINDOW: no console window flashing up on every message.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const TOOLS: &str = "WebSearch,WebFetch,Read";
const INHERITED_SESSION_VARS: &[&str] = &[
    "CLAUDECODE",
    "CLAUDE_CODE_SESSION_ID",
    "CLAUDE_CODE_CHILD_SESSION",
    "CLAUDE_CODE_ENTRYPOINT",
    "CLAUDE_PID",
    "CLAUDE_CODE_REMOTE_SESSION_ID",
];

const SYSTEM_PROMPT: &str = "You are Mochi, a personal assistant living in a small chat bubble at the top of the user's screen (the Coucou desktop app). \
You are not working on a codebase here: never try to edit files or run commands. \
Use WebSearch and WebFetch when the question needs current or external information, and Read to look at a file the user attached. \
Respond in Italian unless the user writes in another language. Be thorough but keep it readable in a small window. \
No markdown formatting (no **, no ##, no bullet dashes). Use plain text with line breaks.";

/// Where `claude` lives: %PATH% first (npm installs `claude.cmd`), then the
/// native installer's and npm's default folders, which a GUI app launched at
/// login may not have on its PATH.
pub fn find_claude() -> Option<PathBuf> {
    if let Some(p) = crate::find_on_path("claude") {
        return Some(p);
    }
    let mut candidates = Vec::new();
    if let Some(home) = std::env::var_os("USERPROFILE") {
        candidates.push(
            PathBuf::from(home)
                .join(".local")
                .join("bin")
                .join("claude.exe"),
        );
    }
    if let Some(appdata) = std::env::var_os("APPDATA") {
        candidates.push(PathBuf::from(appdata).join("npm").join("claude.cmd"));
    }
    candidates.into_iter().find(|p| p.is_file())
}

/// %LOCALAPPDATA%\Coucou\chat — an empty folder, so Claude Code has no project
/// to read; it also holds the two small files we pass by path.
fn work_dir() -> Result<PathBuf, String> {
    let dir = crate::settings::local_dir().join("chat");
    std::fs::create_dir_all(&dir).map_err(|e| format!("cartella della chat non creata: {e}"))?;
    let prompt = dir.join("mochi-prompt.txt");
    std::fs::write(&prompt, SYSTEM_PROMPT).map_err(|e| e.to_string())?;
    let settings = dir.join("chat-settings.json");
    std::fs::write(&settings, br#"{ "disableAllHooks": true }"#).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn command(exe: &Path) -> Command {
    let mut cmd = Command::new(exe);
    // If Coucou itself was started from inside a Claude Code session (e.g.
    // `npm run tauri dev` run by Claude), these would make the chat attach to
    // that session instead of its own.
    for var in INHERITED_SESSION_VARS {
        cmd.env_remove(var);
    }
    cmd.env("COUCOU_INTERNAL", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// The arguments for one turn. Kept apart from the spawn so it can be tested.
fn args(dir: &Path, model: &str, session: Option<&str>, extra_dir: Option<&Path>) -> Vec<String> {
    let mut a: Vec<String> = vec![
        "-p".into(),
        "--output-format".into(),
        "json".into(),
        "--settings".into(),
        dir.join("chat-settings.json")
            .to_string_lossy()
            .into_owned(),
        "--append-system-prompt-file".into(),
        dir.join("mochi-prompt.txt").to_string_lossy().into_owned(),
        "--permission-mode".into(),
        "dontAsk".into(),
        "--strict-mcp-config".into(),
        "--tools".into(),
        TOOLS.into(),
        "--allowedTools".into(),
        TOOLS.into(),
    ];
    if !model.is_empty() {
        a.push("--model".into());
        a.push(model.into());
    }
    if let Some(id) = session {
        a.push("--resume".into());
        a.push(id.into());
    }
    if let Some(d) = extra_dir {
        a.push("--add-dir".into());
        a.push(d.to_string_lossy().into_owned());
    }
    a
}

/// What `claude -p --output-format json` printed. Claude Code reports a failed
/// run (not logged in, usage limit…) as a result with `is_error`, on stdout.
struct Outcome {
    text: String,
    is_error: bool,
    session_id: Option<String>,
}

fn parse_output(stdout: &str) -> Option<Outcome> {
    // The JSON object is the last non-empty line; anything before it is noise.
    let line = stdout
        .lines()
        .rev()
        .map(str::trim)
        .find(|l| l.starts_with('{'))?;
    let v: Value = serde_json::from_str(line).ok()?;
    Some(Outcome {
        text: v
            .get("result")
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_string(),
        is_error: v.get("is_error").and_then(Value::as_bool).unwrap_or(false),
        session_id: v
            .get("session_id")
            .and_then(Value::as_str)
            .map(str::to_string),
    })
}

/// One chat turn through Claude Code. Multi-turn works by resuming the session
/// Claude Code reported last time.
pub async fn send(
    chat: &Chat,
    model: &str,
    query: String,
    context: Option<ChatContext>,
) -> Result<ChatReply, String> {
    let exe = find_claude().ok_or_else(|| {
        "Claude Code non trovato. Installalo e fai il login, oppure scegli «Chiave API» nelle impostazioni."
            .to_string()
    })?;
    let dir = work_dir()?;
    let session = chat.cli_session();

    // Context rides along with the first message only, as in the API path.
    let mut prompt = String::new();
    let mut extra_dir: Option<PathBuf> = None;
    if session.is_none() {
        match &context {
            Some(ChatContext::File { name, path }) => {
                prompt.push_str(&format!("File allegato: {name}\nPercorso: {path}\nLeggilo con Read prima di rispondere.\n\n"));
                extra_dir = Path::new(path).parent().map(Path::to_path_buf);
            }
            Some(ChatContext::Text { label, text }) => {
                prompt.push_str(&format!("{label}:\n{text}\n\n"));
            }
            Some(ChatContext::Window {
                app_name,
                title,
                url,
            }) => {
                prompt.push_str(&format!("Contesto — App: {app_name}, Finestra: {title}"));
                if let Some(url) = url {
                    prompt.push_str(&format!(", URL: {url}"));
                }
                prompt.push_str("\n\n");
            }
            None => {}
        }
    }
    prompt.push_str(&query);

    let mut cmd = command(&exe);
    cmd.current_dir(&dir)
        .args(args(&dir, model, session.as_deref(), extra_dir.as_deref()));
    let mut child = cmd
        .spawn()
        .map_err(|e| format!("Claude Code non si avvia: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        // Dropping stdin closes it: that is what tells `claude -p` the prompt is complete.
    }

    let output = match tokio::time::timeout(TIMEOUT, child.wait_with_output()).await {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => return Err(format!("Claude Code si è interrotto: {e}")),
        Err(_) => return Err("Claude Code non ha risposto in tempo.".into()),
    };

    let stdout = String::from_utf8_lossy(&output.stdout);
    let Some(outcome) = parse_output(&stdout) else {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let detail: String = stderr.trim().chars().take(300).collect();
        // A broken session id would fail every later turn the same way.
        chat.set_cli_session(None);
        return Err(if detail.is_empty() {
            format!(
                "Claude Code ha restituito un errore (codice {}).",
                output.status.code().unwrap_or(-1)
            )
        } else {
            format!("Claude Code: {detail}")
        });
    };

    if outcome.is_error || !output.status.success() {
        chat.set_cli_session(None);
        return Err(if outcome.text.is_empty() {
            "Claude Code ha restituito un errore.".into()
        } else {
            format!("Claude Code: {}", outcome.text)
        });
    }

    if let Some(id) = outcome.session_id {
        chat.set_cli_session(Some(id));
    }
    if outcome.text.is_empty() {
        return Err("Nessun testo nella risposta.".into());
    }
    Ok(ChatReply { text: outcome.text })
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    pub found: bool,
    pub path: String,
    pub logged_in: bool,
}

/// For the settings window: is Claude Code installed, and signed in?
/// `claude auth status` exits 0 when logged in, 1 when not.
pub async fn status() -> CliStatus {
    let Some(exe) = find_claude() else {
        return CliStatus {
            found: false,
            path: String::new(),
            logged_in: false,
        };
    };
    let mut cmd = command(&exe);
    cmd.arg("auth").arg("status").stdin(Stdio::null());
    let logged_in = match cmd.spawn() {
        Ok(child) => matches!(
            tokio::time::timeout(STATUS_TIMEOUT, child.wait_with_output()).await,
            Ok(Ok(o)) if o.status.success()
        ),
        Err(_) => false,
    };
    CliStatus {
        found: true,
        path: exe.to_string_lossy().into_owned(),
        logged_in,
    }
}

#[cfg(test)]
mod tests {
    use super::{args, parse_output};
    use std::path::Path;

    #[test]
    fn args_resume_and_model_only_when_set() {
        let dir = Path::new("C:/x");
        let a = args(dir, "", None, None);
        assert!(!a.contains(&"--model".to_string()));
        assert!(!a.contains(&"--resume".to_string()));
        assert!(a.contains(&"dontAsk".to_string()));

        let a = args(dir, "sonnet", Some("abc"), Some(Path::new("C:/inbox")));
        let at = |flag: &str| a[a.iter().position(|x| x == flag).unwrap() + 1].clone();
        assert_eq!(at("--model"), "sonnet");
        assert_eq!(at("--resume"), "abc");
        assert_eq!(at("--add-dir"), "C:/inbox");
    }

    #[test]
    fn parses_the_json_result() {
        let out = "warning: something\n{\"type\":\"result\",\"is_error\":false,\"result\":\" Ciao! \",\"session_id\":\"s1\"}\n";
        let o = parse_output(out).unwrap();
        assert_eq!(o.text, "Ciao!");
        assert!(!o.is_error);
        assert_eq!(o.session_id.as_deref(), Some("s1"));

        let err = parse_output("{\"is_error\":true,\"result\":\"Not logged in\"}").unwrap();
        assert!(err.is_error);
        assert!(parse_output("nessun json").is_none());
    }
}
