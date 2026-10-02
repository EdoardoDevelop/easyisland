// Chat through the user's own Claude Code install (`claude -p`), so a Claude
// subscription covers it instead of a pay-as-you-go API key.
//
// The process runs hidden, in a neutral working folder, with:
//   * hooks kept out of the island: without connectors every hook is disabled
//     (`disableAllHooks`); EASYISLAND_INTERNAL makes easyisland-hook.exe ignore the
//     user's own EasyIsland hooks either way, so the chat never shows up as a
//     Claude Code work session;
//   * only WebSearch, WebFetch and Read among the built-in tools;
//   * no connectors by default (`--strict-mcp-config`, `dontAsk`). When the user
//     picked some MCP servers, Claude Code loads its own user-scope config (no
//     copy of it, so no copy of any secret in it), the other servers are
//     disallowed, and every call to a server marked "confirm" goes through a
//     PermissionRequest hook — `easyisland-hook.exe PermissionRequest --chat` — to
//     the Consenti/Nega card in the island.
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
use crate::settings::McpChoice;

/// Opus with a few web searches can take a while; the island shows "thinking".
const TIMEOUT: Duration = Duration::from_secs(180);
/// With connectors a turn may also wait for the user's Consenti/Nega.
const TIMEOUT_WITH_CONNECTORS: Duration = Duration::from_secs(420);
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

const SYSTEM_PROMPT: &str = "You are the personal assistant living in a small chat bubble at the top of the user's screen (the EasyIsland desktop app). \
You are not working on a codebase here: never try to edit files or run commands. \
Use WebSearch and WebFetch when the question needs current or external information, and Read to look at a file the user attached. \
Respond in Italian unless the user writes in another language. Be thorough but keep it readable in a small window. \
No markdown formatting (no **, no ##, no bullet dashes). Use plain text with line breaks.";

/// Where `claude` lives: %PATH% first (npm installs `claude.cmd`), then the
/// native installer's and npm's default folders, which a GUI app launched at
/// login may not have on its PATH. Last, the copies bundled with the Claude
/// desktop app and the VS Code extension, for users who have no standalone CLI.
pub fn find_claude() -> Option<PathBuf> {
    if let Some(p) = crate::find_on_path("claude") {
        return Some(p);
    }
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from);
    let appdata = std::env::var_os("APPDATA").map(PathBuf::from);
    let mut candidates = Vec::new();
    if let Some(home) = &home {
        candidates.push(home.join(".local").join("bin").join("claude.exe"));
    }
    if let Some(appdata) = &appdata {
        candidates.push(appdata.join("npm").join("claude.cmd"));
    }
    if let Some(p) = candidates.into_iter().find(|p| p.is_file()) {
        return Some(p);
    }
    // %APPDATA%\Claude\claude-code\<version>\claude.exe
    if let Some(p) = appdata.as_ref().and_then(|a| {
        newest_bundled(&a.join("Claude").join("claude-code"), "", &["claude.exe"])
    }) {
        return Some(p);
    }
    // %USERPROFILE%\.vscode\extensions\anthropic.claude-code-<version>-<platform>\resources\native-binary\claude.exe
    home.as_ref().and_then(|h| {
        newest_bundled(
            &h.join(".vscode").join("extensions"),
            "anthropic.claude-code-",
            &["resources", "native-binary", "claude.exe"],
        )
    })
}

/// The `claude.exe` under the subfolder of `dir` (named `prefix` + version)
/// with the highest version.
fn newest_bundled(dir: &Path, prefix: &str, tail: &[&str]) -> Option<PathBuf> {
    std::fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().into_owned();
            let version = version_key(name.strip_prefix(prefix)?)?;
            let exe = tail.iter().fold(e.path(), |p, part| p.join(part));
            exe.is_file().then_some((version, exe))
        })
        .max_by(|a, b| a.0.cmp(&b.0))
        .map(|(_, exe)| exe)
}

/// "2.1.286-win32-x64" → [2, 1, 286]; None when it does not start with a number.
fn version_key(s: &str) -> Option<Vec<u64>> {
    let key: Vec<u64> = s
        .split(|c: char| c == '.' || c == '-')
        .map_while(|part| part.parse().ok())
        .collect();
    (!key.is_empty()).then_some(key)
}

/// MCP server names as they appear in tool names: anything outside
/// `A-Z a-z 0-9 _ -` becomes `_` (Claude Code's own rule).
pub fn tool_prefix(server: &str) -> String {
    let norm: String = server
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .collect();
    format!("mcp__{norm}")
}

/// Where Claude Code keeps user-scope MCP servers: `~/.claude.json`, or the
/// same file under CLAUDE_CONFIG_DIR when that is set.
fn claude_json_path() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("CLAUDE_CONFIG_DIR") {
        return Some(PathBuf::from(dir).join(".claude.json"));
    }
    std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join(".claude.json"))
}

/// Names of the MCP servers configured for the user in Claude Code. Only the
/// names: the configuration (and any key in it) is never read into EasyIsland.
pub fn configured_mcp_servers() -> Vec<String> {
    let Some(path) = claude_json_path() else { return Vec::new() };
    let Ok(bytes) = std::fs::read(path) else { return Vec::new() };
    let Ok(json) = serde_json::from_slice::<Value>(&bytes) else { return Vec::new() };
    let mut names: Vec<String> = json
        .get("mcpServers")
        .and_then(Value::as_object)
        .map(|m| m.keys().cloned().collect())
        .unwrap_or_default();
    names.sort_by_key(|n| n.to_lowercase());
    names
}

/// The connectors this turn may use, already filtered to configured ones.
pub struct Connectors {
    pub enabled: Vec<McpChoice>,
    /// Configured but not picked: removed from the model's tools.
    pub disabled: Vec<String>,
}

impl Connectors {
    pub fn from_choices(choices: &[McpChoice]) -> Self {
        let configured = configured_mcp_servers();
        let enabled: Vec<McpChoice> = choices
            .iter()
            .filter(|c| configured.iter().any(|n| n == &c.name))
            .cloned()
            .collect();
        let disabled = configured
            .into_iter()
            .filter(|n| !enabled.iter().any(|c| &c.name == n))
            .collect();
        Self { enabled, disabled }
    }

    fn any(&self) -> bool {
        !self.enabled.is_empty()
    }
}

/// %LOCALAPPDATA%\EasyIsland\chat — an empty folder, so Claude Code has no project
/// to read; it also holds the two small files we pass by path.
fn work_dir(connectors: &Connectors) -> Result<PathBuf, String> {
    let dir = crate::settings::local_dir().join("chat");
    std::fs::create_dir_all(&dir).map_err(|e| format!("cartella della chat non creata: {e}"))?;

    let mut prompt = SYSTEM_PROMPT.to_string();
    let settings = if connectors.any() {
        let names: Vec<&str> = connectors.enabled.iter().map(|c| c.name.as_str()).collect();
        prompt.push_str(&format!(
            " You can use these connectors (MCP servers): {}. \
Before any call that creates, changes, sends or deletes something, say in one short sentence what you are about to do: \
the user confirms or refuses it with a click, and a refusal is final for that request.",
            names.join(", ")
        ));
        let exe = crate::settings::hook_exe_path().to_string_lossy().replace('\\', "/");
        serde_json::json!({
            "hooks": {
                "PermissionRequest": [{
                    "matcher": "mcp__.*",
                    "hooks": [{
                        "type": "command",
                        "command": format!("\"{exe}\" PermissionRequest --chat"),
                        "timeout": 130
                    }]
                }]
            }
        })
        .to_string()
    } else {
        r#"{ "disableAllHooks": true }"#.to_string()
    };
    std::fs::write(dir.join("chat-prompt.txt"), prompt).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("chat-settings.json"), settings).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn command(exe: &Path) -> Command {
    let mut cmd = Command::new(exe);
    // If EasyIsland itself was started from inside a Claude Code session (e.g.
    // `npm run tauri dev` run by Claude), these would make the chat attach to
    // that session instead of its own.
    for var in INHERITED_SESSION_VARS {
        cmd.env_remove(var);
    }
    cmd.env("EASYISLAND_INTERNAL", "1")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// The arguments for one turn. Kept apart from the spawn so it can be tested.
fn args(
    dir: &Path,
    model: &str,
    session: Option<&str>,
    extra_dir: Option<&Path>,
    connectors: &Connectors,
) -> Vec<String> {
    let mut a: Vec<String> = vec![
        "-p".into(),
        "--output-format".into(),
        "json".into(),
        "--settings".into(),
        dir.join("chat-settings.json")
            .to_string_lossy()
            .into_owned(),
        "--append-system-prompt-file".into(),
        dir.join("chat-prompt.txt").to_string_lossy().into_owned(),
        "--tools".into(),
        TOOLS.into(),
    ];
    if connectors.any() {
        // `default`: a call that is not pre-allowed goes to the PermissionRequest
        // hook (the island); with no answer from there it is denied.
        a.extend(["--permission-mode".into(), "default".into()]);
        let mut allowed = TOOLS.to_string();
        for c in connectors.enabled.iter().filter(|c| !c.confirm) {
            allowed.push(',');
            allowed.push_str(&tool_prefix(&c.name));
        }
        a.extend(["--allowedTools".into(), allowed]);
        if !connectors.disabled.is_empty() {
            let denied: Vec<String> = connectors.disabled.iter().map(|n| tool_prefix(n)).collect();
            a.extend(["--disallowedTools".into(), denied.join(",")]);
        }
    } else {
        a.extend([
            "--permission-mode".into(),
            "dontAsk".into(),
            "--strict-mcp-config".into(),
            "--allowedTools".into(),
            TOOLS.into(),
        ]);
    }
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
    mcp: &[McpChoice],
    query: String,
    context: Option<ChatContext>,
) -> Result<ChatReply, String> {
    let exe = find_claude().ok_or_else(|| {
        "Claude Code non trovato. Installalo e fai il login, oppure scegli «Chiave API» nelle impostazioni."
            .to_string()
    })?;
    let connectors = Connectors::from_choices(mcp);
    let dir = work_dir(&connectors)?;
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
        .args(args(&dir, model, session.as_deref(), extra_dir.as_deref(), &connectors));
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

    let limit = if connectors.any() { TIMEOUT_WITH_CONNECTORS } else { TIMEOUT };
    let output = match tokio::time::timeout(limit, child.wait_with_output()).await {
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
    use super::{args, parse_output, tool_prefix, version_key, Connectors};
    use crate::settings::McpChoice;
    use std::path::Path;

    fn none() -> Connectors {
        Connectors { enabled: Vec::new(), disabled: Vec::new() }
    }

    #[test]
    fn args_resume_and_model_only_when_set() {
        let dir = Path::new("C:/x");
        let a = args(dir, "", None, None, &none());
        assert!(!a.contains(&"--model".to_string()));
        assert!(!a.contains(&"--resume".to_string()));
        assert!(a.contains(&"dontAsk".to_string()));
        assert!(a.contains(&"--strict-mcp-config".to_string()));

        let a = args(dir, "sonnet", Some("abc"), Some(Path::new("C:/inbox")), &none());
        let at = |flag: &str| a[a.iter().position(|x| x == flag).unwrap() + 1].clone();
        assert_eq!(at("--model"), "sonnet");
        assert_eq!(at("--resume"), "abc");
        assert_eq!(at("--add-dir"), "C:/inbox");
    }

    #[test]
    fn bundled_versions_compare_numerically() {
        assert_eq!(version_key("2.1.286-win32-x64"), Some(vec![2, 1, 286]));
        assert_eq!(version_key("2.1.284"), Some(vec![2, 1, 284]));
        assert!(version_key("2.1.99") < version_key("2.1.100"));
        assert_eq!(version_key("latest"), None);
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

    #[test]
    fn connectors_change_permissions() {
        let c = Connectors {
            enabled: vec![
                McpChoice { name: "agenda".into(), confirm: true },
                McpChoice { name: "docs.read".into(), confirm: false },
            ],
            disabled: vec!["altro".into()],
        };
        let a = args(Path::new("C:/x"), "", None, None, &c);
        let at = |flag: &str| a[a.iter().position(|x| x == flag).unwrap() + 1].clone();
        assert!(!a.contains(&"--strict-mcp-config".to_string()));
        assert_eq!(at("--permission-mode"), "default");
        // Only the no-confirm server is pre-allowed; the other waits for the island.
        assert_eq!(at("--allowedTools"), "WebSearch,WebFetch,Read,mcp__docs_read");
        assert_eq!(at("--disallowedTools"), "mcp__altro");
        assert_eq!(tool_prefix("claude.ai Gmail"), "mcp__claude_ai_Gmail");
    }
}
