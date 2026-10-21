//! `easyisland-hook mcp` — EasyIsland as an MCP server (stdio) for the chat.
//!
//! Claude Code starts it for EasyIsland's own chat (see claude_cli.rs in the
//! app). It speaks JSON-RPC 2.0, one message per line, and knows the list of
//! tools by itself; every call is handed to the app over the same named pipe
//! as the hooks (`EasyIslandTool`), and the app's one-line JSON answer becomes
//! the tool result. The app decides nothing about permissions: Claude Code
//! asks the island (Consenti / Nega) before any tool that is not pre-allowed.
//!
//! When EasyIsland is closed every call fails with a clear message; nothing
//! here can hang Claude Code for longer than CALL_BUDGET.

use std::io::{BufRead, Read, Write};
use std::sync::mpsc;
use std::time::Duration;

use serde_json::{json, Value};

/// A quick action may run a script for up to 5 minutes; past this we give up.
const CALL_BUDGET: Duration = Duration::from_secs(330);
const PROTOCOL: &str = "2025-06-18";

use crate::tool_list::tools;

/// Started by EasyIsland's own chat (Claude Code there runs with
/// EASYISLAND_INTERNAL): the chat is already in the island, a card would
/// cover it, so `show_card` is only for Claude Code elsewhere.
fn in_chat() -> bool {
    std::env::var_os("EASYISLAND_INTERNAL").is_some() || std::env::var_os("EASYISLAND_AGY_CHAT").is_some()
}

/// A tool Antigravity may use without asking (`mcp__easyisland__<name>`):
/// the read-only ones but `show_card`, which waits for a click.
pub fn allowed_without_asking(tool_name: &str) -> bool {
    tool_name
        .strip_prefix("mcp__easyisland__")
        .is_some_and(|name| name != "show_card" && tools().iter().any(|t| t.0 == name && t.3))
}

/// The tools offered here.
fn offered() -> Vec<(&'static str, &'static str, Value, bool)> {
    let chat = in_chat();
    // The remote PC (remote_*) is the chat's only: never Claude Code elsewhere.
    tools().into_iter().filter(|t| if chat { t.0 != "show_card" } else { !t.0.starts_with("remote_") }).collect()
}

/// Names of the tools that change nothing (or nothing that matters). The app
/// pre-allows the same list (claude_cli.rs `AGENT_READ_ONLY`); the rest wait
/// for Consenti / Nega in the island.
#[cfg(test)]
fn read_only_tools() -> Vec<&'static str> {
    tools().into_iter().filter(|t| t.3).map(|t| t.0).collect()
}

/// Asks the app to run one tool. Ok(text) or Err(message for the model).
fn call_app(tool: &str, arguments: &Value) -> Result<String, String> {
    let line = format!(
        "{}\n",
        json!({ "hook_event_name": "EasyIslandTool", "tool": tool, "arguments": arguments })
    );
    let (tx, rx) = mpsc::channel::<Option<String>>();
    std::thread::spawn(move || {
        let answer = (|| {
            let mut pipe = crate::connect()?;
            pipe.write_all(line.as_bytes()).ok()?;
            pipe.flush().ok()?;
            let mut buf = Vec::new();
            let mut chunk = [0u8; 4096];
            loop {
                match pipe.read(&mut chunk) {
                    Ok(0) => break,
                    Ok(n) => {
                        buf.extend_from_slice(&chunk[..n]);
                        if buf.contains(&b'\n') {
                            break;
                        }
                    }
                    Err(_) => break,
                }
            }
            Some(String::from_utf8_lossy(&buf).trim().to_string())
        })();
        let _ = tx.send(answer);
    });
    let reply = match rx.recv_timeout(CALL_BUDGET) {
        Ok(Some(r)) if !r.is_empty() => r,
        Ok(_) => return Err("EasyIsland non è in esecuzione o non ha risposto.".into()),
        Err(_) => return Err("EasyIsland non ha risposto in tempo.".into()),
    };
    let v: Value = serde_json::from_str(&reply).map_err(|_| "Risposta non valida da EasyIsland.".to_string())?;
    let text = v.get("text").and_then(Value::as_str).unwrap_or_default().to_string();
    if v.get("ok").and_then(Value::as_bool).unwrap_or(false) {
        Ok(text)
    } else {
        Err(if text.is_empty() { "Errore sconosciuto.".into() } else { text })
    }
}

fn result(id: Value, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "result": result })
}

fn error(id: Value, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message } })
}

/// The answer to one request; None for notifications.
pub fn handle(msg: &Value) -> Option<Value> {
    let id = msg.get("id").cloned()?;
    let method = msg.get("method").and_then(Value::as_str).unwrap_or_default();
    let params = msg.get("params").cloned().unwrap_or(Value::Null);
    Some(match method {
        "initialize" => {
            let version = params
                .get("protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or(PROTOCOL)
                .to_string();
            result(id, json!({
                "protocolVersion": version,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "easyisland", "version": env!("CARGO_PKG_VERSION") },
                "instructions": "Strumenti di EasyIsland sul PC dell'utente: avvisi e card nell'isola (show_notice, show_card con pulsanti), il Vassoio dei file (add_to_tray, list_uploaded_files), la cartella di lavoro (list_work_folder, move_to_work_folder), aprire programmi e link, eseguire le sue azioni rapide, leggere lo stato di PC, rete, meteo, posta e ticket, gestire appunti e musica, leggere e scrivere nel Notion dell'utente con il collegamento di EasyIsland (notion_map, notion_search, notion_read, notion_query, notion_add_row, notion_update_row, notion_delete_row), le attività di Microsoft To Do da Outlook classico (todo_list, todo_add, todo_update), nella chat il PC remoto collegato in «Accesso remoto» (remote_status, remote_run). Le azioni che cambiano qualcosa chiedono conferma all'utente."
            }))
        }
        "ping" => result(id, json!({})),
        "tools/list" => {
            let list: Vec<Value> = offered()
                .into_iter()
                .map(|(name, description, schema, read_only)| {
                    json!({
                        "name": name,
                        "description": description,
                        "inputSchema": schema,
                        "annotations": { "readOnlyHint": read_only }
                    })
                })
                .collect();
            result(id, json!({ "tools": list }))
        }
        "tools/call" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or_default();
            if !offered().iter().any(|t| t.0 == name) {
                return Some(error(id, -32602, &format!("Strumento sconosciuto: {name}")));
            }
            let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
            let (text, is_error) = match call_app(name, &args) {
                Ok(t) => (t, false),
                Err(e) => (e, true),
            };
            result(id, json!({ "content": [{ "type": "text", "text": text }], "isError": is_error }))
        }
        _ => error(id, -32601, &format!("Metodo non supportato: {method}")),
    })
}

/// The stdio loop: one JSON-RPC message per line in, one per line out.
pub fn serve() -> i32 {
    let stdin = std::io::stdin();
    let mut out = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        let line = line.trim().trim_start_matches('\u{feff}');
        if line.is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(line) {
            Ok(Value::Array(batch)) => {
                let replies: Vec<Value> = batch.iter().filter_map(handle).collect();
                (!replies.is_empty()).then(|| Value::Array(replies))
            }
            Ok(msg) => handle(&msg),
            Err(_) => Some(error(Value::Null, -32700, "JSON non valido")),
        };
        if let Some(r) = reply {
            if writeln!(out, "{r}").is_err() || out.flush().is_err() {
                break;
            }
        }
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lists_tools_and_answers_initialize() {
        let init = handle(&json!({ "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": { "protocolVersion": "2025-03-26" } })).unwrap();
        assert_eq!(init["result"]["protocolVersion"], "2025-03-26");
        assert_eq!(init["result"]["serverInfo"]["name"], "easyisland");

        let list = handle(&json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/list" })).unwrap();
        let names: Vec<&str> = list["result"]["tools"].as_array().unwrap().iter()
            .map(|t| t["name"].as_str().unwrap()).collect();
        assert!(names.contains(&"open_app"));
        assert!(names.contains(&"run_quick_action"));
        assert!(names.contains(&"show_card"));
        assert!(names.contains(&"add_to_tray"));

        // Notifications get no answer.
        assert!(handle(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).is_none());
        let unknown = handle(&json!({ "jsonrpc": "2.0", "id": 3, "method": "nope" })).unwrap();
        assert_eq!(unknown["error"]["code"], -32601);
    }

    #[test]
    fn read_only_split() {
        let ro = read_only_tools();
        assert!(ro.contains(&"list_status"));
        assert!(ro.contains(&"list_work_folder"));
        assert!(!ro.contains(&"move_to_work_folder"));
        assert!(!ro.contains(&"open_app"));
        assert!(!ro.contains(&"run_quick_action"));
        assert!(!ro.contains(&"read_clipboard"));
        assert!(ro.contains(&"get_settings"));
        assert!(!ro.contains(&"set_setting"));
        assert!(ro.contains(&"notion_query"));
        assert!(!ro.contains(&"notion_add_row"));
        assert!(!ro.contains(&"notion_update_row"));
        assert!(!ro.contains(&"notion_delete_row"));
    }

    #[test]
    fn antigravity_asks_only_for_what_changes() {
        assert!(allowed_without_asking("mcp__easyisland__notion_query"));
        assert!(allowed_without_asking("mcp__easyisland__list_status"));
        assert!(!allowed_without_asking("mcp__easyisland__notion_add_row"));
        assert!(!allowed_without_asking("mcp__easyisland__show_card"));
        assert!(!allowed_without_asking("mcp__notion__notion_query"));
        assert!(!allowed_without_asking("run_command"));
    }
}
