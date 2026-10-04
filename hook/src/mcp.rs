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

/// (name, description, input schema, read-only)
fn tools() -> Vec<(&'static str, &'static str, Value, bool)> {
    let none = json!({ "type": "object", "properties": {} });
    vec![
        (
            "get_foreground_app",
            "L'app che l'utente sta usando adesso (eseguibile e titolo della finestra).",
            none.clone(),
            true,
        ),
        (
            "list_status",
            "Lo stato attuale delle integrazioni e dei widget di EasyIsland: PC (disco, memoria, batteria), sicurezza, rete, meteo, Outlook (mail non lette, appuntamenti), ticket Zammad e i controlli dell'utente (siti, server, certificati…). Ogni voce ha livello (ok/warn/error), riassunto e dettagli.",
            none.clone(),
            true,
        ),
        (
            "list_quick_actions",
            "Le azioni rapide che l'utente ha creato in EasyIsland (link, programmi, script, domande a Claude), con id, nome, tipo e a cosa servono. Si eseguono con run_quick_action.",
            none.clone(),
            true,
        ),
        (
            "run_quick_action",
            "Esegue un'azione rapida dell'utente per id (vedi list_quick_actions). Link e programmi si aprono; gli script girano nascosti e ne torna l'output. Le azioni di tipo domanda a Claude non si possono eseguire da qui.",
            json!({ "type": "object", "properties": { "id": { "type": "string", "description": "id dell'azione" } }, "required": ["id"] }),
            false,
        ),
        (
            "open_app",
            "Apre un programma, una cartella o un file sul PC dell'utente. target: nome o percorso (es. \"outlook\", \"notepad\", \"C:\\\\Users\\\\nome\\\\Documents\", \"mstsc\"); args: argomenti facoltativi (es. \"/v:server01\").",
            json!({ "type": "object", "properties": {
                "target": { "type": "string" },
                "args": { "type": "string" }
            }, "required": ["target"] }),
            false,
        ),
        (
            "open_url",
            "Apre un indirizzo web (http o https) nel browser predefinito.",
            json!({ "type": "object", "properties": { "url": { "type": "string" } }, "required": ["url"] }),
            false,
        ),
        (
            "read_clipboard",
            "Legge il testo attualmente negli appunti dell'utente.",
            none.clone(),
            false,
        ),
        (
            "write_clipboard",
            "Mette un testo negli appunti dell'utente, pronto da incollare.",
            json!({ "type": "object", "properties": { "text": { "type": "string" } }, "required": ["text"] }),
            false,
        ),
        (
            "show_notice",
            "Mostra un breve avviso nell'isola di EasyIsland. level: info, ok, warn o error.",
            json!({ "type": "object", "properties": {
                "title": { "type": "string" },
                "text": { "type": "string" },
                "level": { "type": "string", "enum": ["info", "ok", "warn", "error"] }
            }, "required": ["title"] }),
            true,
        ),
        (
            "media_status",
            "Cosa sta suonando sul PC (titolo, artista, app, in riproduzione o in pausa), se l'integrazione Musica è accesa.",
            none.clone(),
            true,
        ),
        (
            "media_control",
            "Controlla la musica: toggle (play/pausa), next, prev.",
            json!({ "type": "object", "properties": { "command": { "type": "string", "enum": ["toggle", "next", "prev"] } }, "required": ["command"] }),
            true,
        ),
        (
            "list_uploaded_files",
            "I file che l'utente ha rilasciato sull'isola negli ultimi 7 giorni (copie), con percorso, dimensione e data. Si possono leggere con Read.",
            none.clone(),
            true,
        ),
        (
            "list_profiles",
            "I profili di EasyIsland (es. Lavoro, Casa) e quello attivo.",
            none.clone(),
            true,
        ),
        (
            "switch_profile",
            "Attiva un profilo di EasyIsland per id (vedi list_profiles).",
            json!({ "type": "object", "properties": { "id": { "type": "string" } }, "required": ["id"] }),
            false,
        ),
    ]
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
                "instructions": "Strumenti di EasyIsland sul PC dell'utente: aprire programmi e link, eseguire le sue azioni rapide, leggere lo stato di PC, rete, meteo, posta e ticket, gestire appunti e musica. Le azioni che cambiano qualcosa chiedono conferma all'utente."
            }))
        }
        "ping" => result(id, json!({})),
        "tools/list" => {
            let list: Vec<Value> = tools()
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
            if !tools().iter().any(|t| t.0 == name) {
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

        // Notifications get no answer.
        assert!(handle(&json!({ "jsonrpc": "2.0", "method": "notifications/initialized" })).is_none());
        let unknown = handle(&json!({ "jsonrpc": "2.0", "id": 3, "method": "nope" })).unwrap();
        assert_eq!(unknown["error"]["code"], -32601);
    }

    #[test]
    fn read_only_split() {
        let ro = read_only_tools();
        assert!(ro.contains(&"list_status"));
        assert!(!ro.contains(&"open_app"));
        assert!(!ro.contains(&"run_quick_action"));
        assert!(!ro.contains(&"read_clipboard"));
    }
}
