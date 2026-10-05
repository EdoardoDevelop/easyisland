//! Agents other than Claude Code (HANDOFF 6.6, point 5).
//!
//! Their hooks run the same relay with `--agent <id>` after the event name
//! (`easyisland-hook PreToolUse --agent codex`), and this module turns their
//! payload into the shape the island already knows (Claude Code's), plus an
//! `easyisland_agent` field so they get a pill of their own:
//! * **Codex** — the same events and fields as Claude Code, PermissionRequest
//!   included (and the same answer), so only the tool names differ; its
//!   `apply_patch` becomes one diff per file (`easyisland_diffs`).
//! * **Gemini CLI** — BeforeTool / AfterTool / BeforeAgent / AfterAgent become
//!   PreToolUse / PostToolUse / UserPromptSubmit / Stop, its tools get Claude
//!   Code's names, and its "ToolPermission" notification becomes a waiting
//!   request the island can show (it cannot answer it: Gemini has no hook for that).
//!
//! * **Cursor** and **Copilot CLI** — observation hooks only (hooks.rs says
//!   why): their events become Claude Code's, commands and file edits arrive
//!   *after* they ran, so they carry `easyisland_after_only` and the island
//!   adds the step itself. Cursor's `afterFileEdit` becomes a MultiEdit (diff.rs
//!   makes the diff), `afterShellExecution` a Bash with its output (testrun.rs
//!   reads the tests).
//!
//! Any other tool can send a payload with `easyisland_agent: {"id", "name", "color"}`
//! and gets its pill too; `sanitize` keeps that field harmless.

use serde_json::{json, Map, Value};

/// Known agents: id → (name, colour of the pill).
fn known(id: &str) -> Option<(&'static str, &'static str)> {
    match id {
        "codex" => Some(("Codex", "#10A37F")),
        "gemini" => Some(("Gemini CLI", "#4285F4")),
        "cursor" => Some(("Cursor", "#9CA3AF")),
        "copilot" => Some(("Copilot", "#8957E5")),
        _ => None,
    }
}

/// `--agent <id>` from the command line, if any.
pub fn from_args(args: &[String]) -> Option<String> {
    let i = args.iter().position(|a| a == "--agent")?;
    args.get(i + 1).map(|s| s.to_ascii_lowercase())
}

/// Puts `easyisland_agent` on the payload and translates the agent's events.
pub fn normalize(agent: Option<&str>, map: &mut Map<String, Value>) {
    if let Some(id) = agent {
        if let Some((name, color)) = known(id) {
            map.insert("easyisland_agent".into(), json!({ "id": id, "name": name, "color": color }));
        }
        if id == "gemini" {
            gemini(map);
        }
        if id == "codex" {
            codex_tools(map);
        }
        if id == "cursor" {
            cursor(map);
        }
        if id == "copilot" {
            copilot(map);
        }
    }
    sanitize(map);
}

/// A tool's own `easyisland_agent` is kept only in its plain form: an id of
/// letters, digits and dashes, a short name, a #rrggbb colour.
fn sanitize(map: &mut Map<String, Value>) {
    let Some(agent) = map.get("easyisland_agent").cloned() else { return };
    let s = |k: &str| agent.get(k).and_then(Value::as_str).unwrap_or_default().trim().to_string();
    let id = s("id").to_ascii_lowercase();
    let valid_id = !id.is_empty() && id.len() <= 24 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if !valid_id || id == "claude" {
        map.remove("easyisland_agent");
        return;
    }
    let name: String = s("name").chars().filter(|c| !c.is_control()).take(32).collect();
    let color = s("color");
    let color_ok = color.len() == 7 && color.starts_with('#') && color[1..].chars().all(|c| c.is_ascii_hexdigit());
    map.insert(
        "easyisland_agent".into(),
        json!({
            "id": id,
            "name": if name.is_empty() { id.clone() } else { name },
            "color": if color_ok { color } else { "#8E939C".to_string() },
        }),
    );
}

/// Gemini CLI → Claude Code's events, tool names and fields.
fn gemini(map: &mut Map<String, Value>) {
    let event = map.get("hook_event_name").and_then(Value::as_str).unwrap_or_default().to_string();
    let renamed = match event.as_str() {
        "BeforeTool" => "PreToolUse",
        "AfterTool" => "PostToolUse",
        "BeforeAgent" => "UserPromptSubmit",
        "AfterAgent" => "Stop",
        other => other,
    }
    .to_string();
    map.insert("hook_event_name".into(), Value::String(renamed.clone()));

    if let Some(tool) = map.get("tool_name").and_then(Value::as_str) {
        let claude = match tool {
            "run_shell_command" => "Bash",
            "write_file" => "Write",
            "replace" => "Edit",
            "read_file" | "read_many_files" => "Read",
            "glob" => "Glob",
            "search_file_content" => "Grep",
            "list_directory" => "LS",
            "web_fetch" => "WebFetch",
            "google_web_search" => "WebSearch",
            other => other,
        };
        map.insert("tool_name".into(), Value::String(claude.to_string()));
    }
    // read_file names its file `absolute_path`; the island reads `file_path`.
    if let Some(input) = map.get_mut("tool_input").and_then(Value::as_object_mut) {
        if !input.contains_key("file_path") {
            if let Some(p) = input.get("absolute_path").cloned() {
                input.insert("file_path".into(), p);
            }
        }
    }
    // AfterAgent: the reply is the session's last message.
    if renamed == "Stop" {
        if let Some(r) = map.get("prompt_response").cloned() {
            map.insert("last_assistant_message".into(), r);
        }
    }
    // Gemini asks in its terminal; the island can only say so.
    if event == "Notification"
        && map.get("notification_type").and_then(Value::as_str) == Some("ToolPermission")
    {
        let what = map
            .get("details")
            .and_then(|d| d.get("command").or_else(|| d.get("title")).or_else(|| d.get("file_path")))
            .and_then(Value::as_str)
            .or_else(|| map.get("message").and_then(Value::as_str))
            .unwrap_or("un'azione")
            .to_string();
        map.insert("message".into(), Value::String(format!("Chiede un permesso nel terminale: {what}")));
        map.insert("easyisland_waiting".into(), Value::Bool(true));
    }
}

/// Codex's tools under the names the island labels ("Esegue", "Modifica"…).
fn codex_tools(map: &mut Map<String, Value>) {
    let Some(tool) = map.get("tool_name").and_then(Value::as_str) else { return };
    let claude = match tool {
        "shell" | "local_shell" | "exec_command" | "container.exec" | "unified_exec" => "Bash",
        "apply_patch" => "Patch",
        "read_file" => "Read",
        "web_search" => "WebSearch",
        other => other,
    };
    map.insert("tool_name".into(), Value::String(claude.to_string()));
    // A command given as an argument list reads as one line.
    if let Some(input) = map.get_mut("tool_input").and_then(Value::as_object_mut) {
        if let Some(list) = input.get("command").and_then(Value::as_array) {
            let line = list.iter().filter_map(Value::as_str).collect::<Vec<_>>().join(" ");
            input.insert("command".into(), Value::String(line));
        }
    }
}

fn rename(map: &mut Map<String, Value>, from: &str, to: &str) {
    if let Some(v) = map.remove(from) {
        map.entry(to.to_string()).or_insert(v);
    }
}

fn set_event(map: &mut Map<String, Value>, event: &str) {
    map.insert("hook_event_name".into(), Value::String(event.to_string()));
}

/// "/c:/Users/x" (a URI-style Windows path) → "c:/Users/x".
fn windows_path(p: &str) -> String {
    let b = p.as_bytes();
    if b.len() > 3 && b[0] == b'/' && b[1].is_ascii_alphabetic() && b[2] == b':' {
        p[1..].to_string()
    } else {
        p.to_string()
    }
}

/// A command or edit reported after it ran: the island adds its step itself.
fn after(map: &mut Map<String, Value>, tool: &str, input: Value) {
    set_event(map, "PostToolUse");
    map.insert("tool_name".into(), Value::String(tool.to_string()));
    map.insert("tool_input".into(), input);
    map.insert("easyisland_after_only".into(), Value::Bool(true));
}

/// Cursor → Claude Code's events. Only the hooks hooks.rs installs.
fn cursor(map: &mut Map<String, Value>) {
    let event = map.get("hook_event_name").and_then(Value::as_str).unwrap_or_default().to_string();
    rename(map, "conversation_id", "session_id");
    if !map.contains_key("cwd") {
        if let Some(root) = map.get("workspace_roots").and_then(|r| r.get(0)).and_then(Value::as_str) {
            let root = windows_path(root);
            map.insert("cwd".into(), Value::String(root));
        }
    }
    match event.as_str() {
        "sessionStart" => set_event(map, "SessionStart"),
        "sessionEnd" => set_event(map, "SessionEnd"),
        "beforeSubmitPrompt" => set_event(map, "UserPromptSubmit"),
        "afterShellExecution" => {
            let command = map.get("command").cloned().unwrap_or(Value::Null);
            let output = map.remove("output").unwrap_or(Value::Null);
            map.insert("tool_response".into(), json!({ "stdout": output }));
            after(map, "Bash", json!({ "command": command }));
        }
        "afterFileEdit" => {
            let file = map.get("file_path").and_then(Value::as_str).map(windows_path).unwrap_or_default();
            let edits = map.remove("edits").unwrap_or(Value::Array(Vec::new()));
            after(map, "MultiEdit", json!({ "file_path": file, "edits": edits }));
        }
        "afterMCPExecution" => {
            let server = map.get("mcp_server_name").and_then(Value::as_str).unwrap_or("mcp").to_string();
            let tool = map.get("tool_name").and_then(Value::as_str).unwrap_or("tool").to_string();
            let input = map.get("tool_input").cloned().unwrap_or(Value::Null);
            after(map, &format!("mcp__{server}__{tool}"), input);
        }
        "subagentStop" => set_event(map, "SubagentStop"),
        "stop" => {
            let failed = map.get("status").and_then(Value::as_str) == Some("error");
            set_event(map, if failed { "StopFailure" } else { "Stop" });
        }
        _ => {}
    }
}

/// Copilot CLI (camelCase) → Claude Code's events, fields and tool names.
fn copilot(map: &mut Map<String, Value>) {
    let event = map.get("hook_event_name").and_then(Value::as_str).unwrap_or_default().to_string();
    rename(map, "sessionId", "session_id");
    rename(map, "toolName", "tool_name");
    rename(map, "toolArgs", "tool_input");
    // Some versions send the arguments as a JSON string.
    if let Some(Value::String(s)) = map.get("tool_input").cloned() {
        if let Ok(v) = serde_json::from_str::<Value>(&s) {
            map.insert("tool_input".into(), v);
        }
    }
    let tool = map.get("tool_name").and_then(Value::as_str).unwrap_or_default().to_string();
    let claude = match tool.as_str() {
        "bash" | "powershell" | "shell" => "Bash",
        "view" | "read" => "Read",
        "edit" | "str_replace" | "str_replace_editor" => "Edit",
        "create" | "write" => "Write",
        "grep" => "Grep",
        "glob" => "Glob",
        "web_fetch" => "WebFetch",
        other => other,
    };
    if !tool.is_empty() {
        map.insert("tool_name".into(), Value::String(claude.to_string()));
    }
    // Its tools' arguments under Claude Code's names (path → file_path…), for the
    // step labels and the diff.
    if let Some(input) = map.get_mut("tool_input").and_then(Value::as_object_mut) {
        for (from, to) in [("path", "file_path"), ("old_str", "old_string"), ("new_str", "new_string"), ("file_text", "content")] {
            if let Some(v) = input.get(from).cloned() {
                input.entry(to.to_string()).or_insert(v);
            }
        }
    }
    match event.as_str() {
        "sessionStart" => set_event(map, "SessionStart"),
        "sessionEnd" => set_event(map, "SessionEnd"),
        "userPromptSubmitted" => set_event(map, "UserPromptSubmit"),
        "postToolUse" | "postToolUseFailure" => {
            let result = map.remove("toolResult").unwrap_or(Value::Null);
            let failed = event == "postToolUseFailure" || result.get("resultType").and_then(Value::as_str) == Some("failure");
            let text = result.get("textResultForLlm").cloned().unwrap_or(Value::Null);
            map.insert("tool_response".into(), json!({ "stdout": text }));
            map.insert("easyisland_after_only".into(), Value::Bool(true));
            set_event(map, if failed { "PostToolUseFailure" } else { "PostToolUse" });
        }
        "agentStop" => set_event(map, "Stop"),
        "subagentStop" => set_event(map, "SubagentStop"),
        "errorOccurred" => {
            // Only an error the session does not recover from ends it.
            let fatal = map.get("recoverable").and_then(Value::as_bool) == Some(false);
            let message = map.get("error").and_then(|e| e.get("message")).and_then(Value::as_str).unwrap_or_default().to_string();
            map.insert("error".into(), Value::String(message.clone()));
            if fatal {
                set_event(map, "StopFailure");
            } else {
                set_event(map, "Notification");
                map.insert("message".into(), Value::String(message));
            }
        }
        _ => {}
    }
}

/// The patch text of a Codex `apply_patch`, wherever its input keeps it.
pub fn patch_text(input: &Value) -> Option<String> {
    fn find(v: &Value) -> Option<String> {
        match v {
            Value::String(s) if s.contains("*** Begin Patch") => Some(s.clone()),
            Value::Array(items) => items.iter().find_map(find),
            Value::Object(map) => map.values().find_map(find),
            _ => None,
        }
    }
    find(input)
}

/// `*** Begin Patch` … `*** End Patch` → one `easyisland_diff`-shaped value per
/// file (added files all `+`, deleted ones counted only, updates with their hunks).
pub fn patch_diffs(patch: &str) -> Vec<Value> {
    struct File {
        path: String,
        lines: Vec<String>,
        hunks: Vec<Vec<String>>,
        deleted: bool,
    }
    let mut files: Vec<File> = Vec::new();
    let start = |path: &str, deleted: bool| File { path: path.trim().to_string(), lines: Vec::new(), hunks: Vec::new(), deleted };
    for line in patch.lines() {
        if let Some(p) = line.strip_prefix("*** Add File: ").or_else(|| line.strip_prefix("*** Update File: ")) {
            files.push(start(p, false));
        } else if let Some(p) = line.strip_prefix("*** Delete File: ") {
            files.push(start(p, true));
        } else if let Some(p) = line.strip_prefix("*** Move to: ") {
            if let Some(f) = files.last_mut() {
                f.path = p.trim().to_string();
            }
        } else if line.starts_with("*** ") {
            // Begin / End Patch, End of File.
        } else if let Some(f) = files.last_mut() {
            if line.starts_with("@@") {
                if !f.lines.is_empty() {
                    f.hunks.push(std::mem::take(&mut f.lines));
                }
            } else if line.starts_with('+') || line.starts_with('-') || line.starts_with(' ') {
                f.lines.push(line.to_string());
            } else if line.is_empty() {
                f.lines.push(" ".to_string());
            }
        }
    }
    files
        .into_iter()
        .filter(|f| !f.path.is_empty())
        .map(|mut f| {
            if !f.lines.is_empty() {
                f.hunks.push(std::mem::take(&mut f.lines));
            }
            let all = f.hunks.iter().flatten();
            let added = all.clone().filter(|l| l.starts_with('+')).count();
            let removed = all.filter(|l| l.starts_with('-')).count();
            let lines: usize = f.hunks.iter().map(Vec::len).sum();
            let too_big = f.deleted || lines > 4_000;
            json!({
                "file": f.path,
                "added": added,
                "removed": removed,
                "too_big": too_big,
                "hunks": if too_big { vec![] } else {
                    f.hunks.into_iter().map(|h| json!({ "old": 0, "new": 0, "lines": h })).collect::<Vec<_>>()
                },
            })
        })
        .collect()
}

/// Claude Code started in Cursor's terminal: Cursor marks its terminals.
pub fn in_cursor() -> bool {
    if std::env::var_os("CURSOR_TRACE_ID").is_some() {
        return true;
    }
    ["VSCODE_GIT_ASKPASS_NODE", "VSCODE_GIT_ASKPASS_MAIN", "VSCODE_IPC_HOOK_CLI"]
        .iter()
        .filter_map(|v| std::env::var(v).ok())
        .any(|p| p.to_ascii_lowercase().contains("cursor"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn map(v: Value) -> Map<String, Value> {
        v.as_object().unwrap().clone()
    }

    #[test]
    fn cursor_events() {
        let mut shell = map(json!({ "hook_event_name": "afterShellExecution", "conversation_id": "c1",
            "workspace_roots": ["/c:/Users/x/app"], "command": "npm test", "output": "Tests: 1 failed, 2 passed" }));
        normalize(Some("cursor"), &mut shell);
        assert_eq!((shell["hook_event_name"].as_str(), shell["tool_name"].as_str()), (Some("PostToolUse"), Some("Bash")));
        assert_eq!(shell["tool_input"]["command"], "npm test");
        assert_eq!(shell["tool_response"]["stdout"], "Tests: 1 failed, 2 passed");
        assert_eq!((shell["session_id"].as_str(), shell["cwd"].as_str()), (Some("c1"), Some("c:/Users/x/app")));
        assert_eq!(shell["easyisland_after_only"], true);
        assert_eq!(shell["easyisland_agent"]["name"], "Cursor");

        let mut edit = map(json!({ "hook_event_name": "afterFileEdit", "file_path": "C:\\x\\a.ts",
            "edits": [{ "old_string": "a", "new_string": "b" }] }));
        normalize(Some("cursor"), &mut edit);
        assert_eq!(edit["tool_name"], "MultiEdit");
        assert_eq!(edit["tool_input"]["edits"][0]["new_string"], "b");

        let mut stop = map(json!({ "hook_event_name": "stop", "status": "error" }));
        normalize(Some("cursor"), &mut stop);
        assert_eq!(stop["hook_event_name"], "StopFailure");
        let mut prompt = map(json!({ "hook_event_name": "beforeSubmitPrompt", "prompt": "ciao" }));
        normalize(Some("cursor"), &mut prompt);
        assert_eq!(prompt["hook_event_name"], "UserPromptSubmit");
    }

    #[test]
    fn copilot_events() {
        let mut post = map(json!({ "hook_event_name": "postToolUse", "sessionId": "s1", "cwd": "C:\\app",
            "toolName": "bash", "toolArgs": "{\"command\":\"cargo test\"}",
            "toolResult": { "resultType": "failure", "textResultForLlm": "test result: FAILED. 1 passed; 1 failed" } }));
        normalize(Some("copilot"), &mut post);
        assert_eq!((post["hook_event_name"].as_str(), post["tool_name"].as_str()), (Some("PostToolUseFailure"), Some("Bash")));
        assert_eq!(post["tool_input"]["command"], "cargo test");
        assert_eq!(post["session_id"], "s1");
        assert_eq!(post["easyisland_agent"]["name"], "Copilot");

        let mut edit = map(json!({ "hook_event_name": "postToolUse", "toolName": "edit",
            "toolArgs": { "path": "C:\\a.ts", "old_str": "x", "new_str": "y" }, "toolResult": { "resultType": "success" } }));
        normalize(Some("copilot"), &mut edit);
        assert_eq!(edit["tool_name"], "Edit");
        assert_eq!((edit["tool_input"]["file_path"].as_str(), edit["tool_input"]["new_string"].as_str()), (Some("C:\\a.ts"), Some("y")));

        let mut err = map(json!({ "hook_event_name": "errorOccurred", "error": { "message": "boom" }, "recoverable": true }));
        normalize(Some("copilot"), &mut err);
        assert_eq!((err["hook_event_name"].as_str(), err["message"].as_str()), (Some("Notification"), Some("boom")));
        let mut stop = map(json!({ "hook_event_name": "agentStop", "stopReason": "end_turn" }));
        normalize(Some("copilot"), &mut stop);
        assert_eq!(stop["hook_event_name"], "Stop");
    }

    #[test]
    fn agent_flag_is_read_after_the_event() {
        let args: Vec<String> = ["hook.exe", "PreToolUse", "--agent", "Codex"].iter().map(|s| s.to_string()).collect();
        assert_eq!(from_args(&args).as_deref(), Some("codex"));
        assert_eq!(from_args(&args[..2]), None);
    }

    #[test]
    fn codex_keeps_its_events_and_gets_a_pill() {
        let mut m = map(json!({ "hook_event_name": "PreToolUse", "tool_name": "shell",
            "tool_input": { "command": ["npm", "test"] } }));
        normalize(Some("codex"), &mut m);
        assert_eq!(m["hook_event_name"], "PreToolUse");
        assert_eq!(m["tool_name"], "Bash");
        assert_eq!(m["tool_input"]["command"], "npm test");
        assert_eq!(m["easyisland_agent"]["name"], "Codex");
    }

    #[test]
    fn gemini_events_become_claude_codes() {
        let mut m = map(json!({ "hook_event_name": "BeforeTool", "tool_name": "replace",
            "tool_input": { "file_path": "a.ts", "old_string": "x", "new_string": "y" } }));
        normalize(Some("gemini"), &mut m);
        assert_eq!((m["hook_event_name"].as_str(), m["tool_name"].as_str()), (Some("PreToolUse"), Some("Edit")));

        let mut read = map(json!({ "hook_event_name": "AfterTool", "tool_name": "read_file", "tool_input": { "absolute_path": "C:\\x\\b.md" } }));
        normalize(Some("gemini"), &mut read);
        assert_eq!(read["tool_input"]["file_path"], "C:\\x\\b.md");

        let mut done = map(json!({ "hook_event_name": "AfterAgent", "prompt_response": "Fatto." }));
        normalize(Some("gemini"), &mut done);
        assert_eq!((done["hook_event_name"].as_str(), done["last_assistant_message"].as_str()), (Some("Stop"), Some("Fatto.")));

        let mut ask = map(json!({ "hook_event_name": "Notification", "notification_type": "ToolPermission",
            "message": "Tool permission", "details": { "command": "rm -rf build" } }));
        normalize(Some("gemini"), &mut ask);
        assert_eq!(ask["easyisland_waiting"], true);
        assert!(ask["message"].as_str().unwrap().ends_with("rm -rf build"));
    }

    #[test]
    fn a_tools_own_agent_field_is_kept_plain() {
        let mut m = map(json!({ "easyisland_agent": { "id": "My-Bot", "name": "Il mio\u{7}bot", "color": "red" } }));
        normalize(None, &mut m);
        assert_eq!(m["easyisland_agent"], json!({ "id": "my-bot", "name": "Il miobot", "color": "#8E939C" }));
        for bad in [json!({ "id": "../x" }), json!({ "id": "" }), json!({ "id": "claude" }), json!("codex")] {
            let mut m = map(json!({ "easyisland_agent": bad }));
            normalize(None, &mut m);
            assert!(!m.contains_key("easyisland_agent"));
        }
    }

    #[test]
    fn apply_patch_gives_one_diff_per_file() {
        let patch = "*** Begin Patch\n*** Add File: docs/new.md\n+# Titolo\n+testo\n*** Update File: src/a.rs\n@@ fn main\n fn main() {\n-    old();\n+    new();\n }\n*** Delete File: tmp.txt\n*** End Patch";
        let input = json!({ "command": ["apply_patch", patch] });
        let diffs = patch_diffs(&patch_text(&input).unwrap());
        assert_eq!(diffs.len(), 3);
        assert_eq!((diffs[0]["file"].as_str(), diffs[0]["added"].as_u64()), (Some("docs/new.md"), Some(2)));
        assert_eq!((diffs[1]["added"].as_u64(), diffs[1]["removed"].as_u64()), (Some(1), Some(1)));
        assert_eq!(diffs[1]["hunks"][0]["lines"][1], "-    old();");
        assert_eq!(diffs[2]["too_big"], true);
        assert!(patch_text(&json!({ "command": "ls" })).is_none());
    }
}
