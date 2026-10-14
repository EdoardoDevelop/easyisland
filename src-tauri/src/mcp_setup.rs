// EasyIsland as an MCP server for Claude Code everywhere (terminal, VS Code,
// the desktop app), not only for the island's chat: Impostazioni → Claude Code
// → «Strumenti di EasyIsland in Claude Code».
//
// The entry lives in Claude Code's user configuration (~/.claude.json,
// `mcpServers`). We never write that file ourselves: Claude Code's own
// `claude mcp add` / `claude mcp remove` do, after a dated copy of the file
// beside it and only on the user's click on «Conferma» (CLAUDE.md → Regole).
// The status is read from the file, read-only.

use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

const NAME: &str = "easyisland";
const TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatus {
    /// Claude Code is installed (its `claude` command was found).
    cli: bool,
    /// The entry is there.
    installed: bool,
    /// …and points at this PC's easyisland-hook.exe.
    current: bool,
    /// The entry `claude mcp add` writes, to show before the click.
    entry: String,
}

fn config_path() -> Option<PathBuf> {
    std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join(".claude.json"))
}

fn hook() -> String {
    crate::settings::hook_exe_path().to_string_lossy().into_owned()
}

/// The `easyisland` entry of `mcpServers` in Claude Code's user configuration.
fn entry_in(config: &Value) -> Option<&Value> {
    config.get("mcpServers")?.get(NAME)
}

/// Same program, ignoring case and slash direction.
fn same_program(a: &str, b: &str) -> bool {
    let norm = |s: &str| s.trim_matches('"').replace('/', "\\").to_lowercase();
    norm(a) == norm(b)
}

#[tauri::command]
pub fn mcp_claude_status() -> McpStatus {
    let config: Value = config_path()
        .and_then(|p| std::fs::read(p).ok())
        .and_then(|b| serde_json::from_slice(&b).ok())
        .unwrap_or(Value::Null);
    let entry = entry_in(&config);
    let current = entry
        .and_then(|e| e.get("command"))
        .and_then(Value::as_str)
        .is_some_and(|c| same_program(c, &hook()))
        && entry.and_then(|e| e.get("args")).and_then(Value::as_array).is_some_and(|a| a.first().and_then(Value::as_str) == Some("mcp"));
    let wanted = serde_json::json!({ NAME: { "type": "stdio", "command": hook(), "args": ["mcp"], "env": {} } });
    McpStatus {
        cli: crate::claude_cli::find_claude().is_some(),
        installed: entry.is_some(),
        current,
        entry: serde_json::to_string_pretty(&wanted).unwrap_or_default(),
    }
}

async fn claude(args: &[&str]) -> Result<(), String> {
    let exe = crate::claude_cli::find_claude().ok_or_else(|| crate::i18n::t("Claude Code non è installato.").to_string())?;
    let mut cmd = crate::claude_cli::command(&exe);
    cmd.args(args).stdin(Stdio::null());
    let out = tokio::time::timeout(TIMEOUT, cmd.output())
        .await
        .map_err(|_| crate::i18n::t("Claude Code non ha risposto in tempo.").to_string())?
        .map_err(|e| e.to_string())?;
    if out.status.success() {
        return Ok(());
    }
    let err = String::from_utf8_lossy(&out.stderr);
    let msg = if err.trim().is_empty() { String::from_utf8_lossy(&out.stdout).into_owned() } else { err.into_owned() };
    Err(msg.trim().chars().take(300).collect())
}

/// «Conferma»: adds (or removes) the entry with Claude Code's own command,
/// after a dated copy of ~/.claude.json. Returns the copy's path ("" when there was no file).
#[tauri::command]
pub async fn mcp_claude_apply(install: bool) -> Result<String, String> {
    let backup = match config_path().filter(|p| p.exists()) {
        Some(p) => {
            let copy = p.with_file_name(format!(".claude.json.bak-{}", crate::hooks::stamp()));
            std::fs::copy(&p, &copy).map_err(|e| crate::i18n::tf("Copia di sicurezza non riuscita: {e}", &[("e", &e)]))?;
            copy.to_string_lossy().into_owned()
        }
        None => String::new(),
    };
    let status = mcp_claude_status();
    // An entry pointing elsewhere (an old install) is replaced.
    if status.installed {
        claude(&["mcp", "remove", "--scope", "user", NAME]).await?;
    }
    if install {
        let exe = hook();
        claude(&["mcp", "add", "--scope", "user", NAME, "--", &exe, "mcp"]).await?;
    }
    crate::log::line(format!("server MCP in Claude Code: {}", if install { "aggiunto" } else { "tolto" }));
    Ok(backup)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn reads_the_entry() {
        let config = json!({ "mcpServers": { "easyisland": { "command": "C:/Users/x/AppData/Local/EasyIsland/bin/easyisland-hook.exe", "args": ["mcp"] } } });
        let e = entry_in(&config).unwrap();
        assert!(same_program(e["command"].as_str().unwrap(), "c:\\users\\X\\AppData\\Local\\EasyIsland\\bin\\easyisland-hook.exe"));
        assert!(entry_in(&json!({})).is_none());
        assert!(entry_in(&json!({ "mcpServers": [] })).is_none());
        assert!(!same_program("a.exe", "b.exe"));
    }
}
