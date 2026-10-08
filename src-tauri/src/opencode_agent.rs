// opencode 2's sessions in the island, as an agent with a pill of its own
// (`agent:opencode`). opencode 2 has no hooks and its plugins can no longer see
// tools or events, but its TUI is a client of a background service (`opencode
// service`), whose event stream says everything: EasyIsland reads that stream
// and turns each event into the Claude Code hook payload the island knows,
// exactly as hook/src/agents.rs does for the other agents. (opencode 1.x: the
// plugin of hooks.rs, Target::OpenCode.)
//
// Off by default (Impostazioni → Agenti → opencode → `opencodeWatch`).
// The service is found with `opencode service status` (its address) and its
// password is read from opencode's own `service.json`, in memory only and only
// to talk to that local service.
//
// Permissions: the island's card, like Claude Code's. A click answers through
// the service (once / always / reject); no click and opencode keeps asking in
// its own window. An answer given in opencode releases the card's wait.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::Manager;
use std::time::Duration;

use serde_json::{json, Map, Value};
use tauri::{AppHandle, Emitter};

use crate::island::WINDOW_LABEL;

static ENABLED: AtomicBool = AtomicBool::new(false);

/// Follows the settings; called at start and after every save.
pub fn apply(s: &crate::settings::Settings) {
    ENABLED.store(s.opencode_watch, Ordering::Relaxed);
}

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// The background service: address from `opencode service status`, password
/// from `~/.config/opencode/service.json`. None when it is not running.
async fn service() -> Option<(String, Option<String>)> {
    let exe = crate::opencode::find_exe()?;
    let mut cmd = tokio::process::Command::new(exe);
    cmd.args(["service", "status"]).env("EASYISLAND_INTERNAL", "1")
        .stdin(std::process::Stdio::null()).stderr(std::process::Stdio::null()).kill_on_drop(true);
    cmd.creation_flags(CREATE_NO_WINDOW);
    let out = tokio::time::timeout(Duration::from_secs(5), cmd.output()).await.ok()?.ok()?;
    let url = String::from_utf8_lossy(&out.stdout).lines().map(str::trim)
        .find(|l| l.starts_with("http://127.0.0.1:") || l.starts_with("http://localhost:"))?.to_string();
    let home = std::env::var_os("USERPROFILE").map(std::path::PathBuf::from)?;
    let password = std::fs::read(home.join(".config").join("opencode").join("service.json")).ok()
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .and_then(|v| v.get("password").and_then(Value::as_str).map(str::to_string));
    Some((url, password))
}

pub fn spawn(app: AppHandle) {
    if let Some(s) = app.try_state::<crate::Shared>() {
        apply(&s.settings.lock().unwrap());
    }
    tauri::async_runtime::spawn(async move {
        loop {
            if !ENABLED.load(Ordering::Relaxed) {
                tokio::time::sleep(Duration::from_secs(15)).await;
                continue;
            }
            match service().await {
                Some((url, password)) => {
                    crate::log::line(format!("opencode: following the service at {url}"));
                    let why = follow(&app, &url, password.as_deref()).await;
                    crate::log::line(format!("opencode: service stream ended ({why})"));
                    tokio::time::sleep(Duration::from_secs(5)).await;
                }
                // Not running (or not installed): look again later, cheaply.
                None => tokio::time::sleep(Duration::from_secs(60)).await,
            }
        }
    });
}

/// What a session has said so far that later events need.
#[derive(Default)]
struct Sessions {
    cwd: HashMap<String, String>,
    /// call id → (tool name, input)
    calls: HashMap<String, (String, Value)>,
    /// session → the text block being written, and the last one finished
    text: HashMap<String, String>,
    last: HashMap<String, String>,
    /// opencode permission id → the island's request id
    asks: HashMap<String, String>,
}

/// Reads the service's events until the stream ends or the setting goes off.
async fn follow(app: &AppHandle, url: &str, password: Option<&str>) -> String {
    let client = match reqwest::Client::builder().connect_timeout(Duration::from_secs(10)).build() {
        Ok(c) => c,
        Err(e) => return e.to_string(),
    };
    let mut req = client.get(format!("{url}/api/event"));
    if let Some(p) = password {
        req = req.basic_auth("opencode", Some(p));
    }
    let mut resp = match req.send().await {
        Ok(r) if r.status().is_success() => r,
        Ok(r) => return format!("HTTP {}", r.status()),
        Err(e) => return e.to_string(),
    };
    let mut state = Sessions::default();
    let mut pending = Vec::<u8>::new();
    loop {
        if !ENABLED.load(Ordering::Relaxed) {
            return "spento dalle impostazioni".into();
        }
        let chunk = match tokio::time::timeout(Duration::from_secs(30), resp.chunk()).await {
            Err(_) => continue, // heartbeats come every few seconds; this only rechecks ENABLED
            Ok(Ok(Some(c))) => c,
            Ok(Ok(None)) => return "chiuso".into(),
            Ok(Err(e)) => return e.to_string(),
        };
        pending.extend_from_slice(&chunk);
        while let Some(nl) = pending.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = pending.drain(..=nl).collect();
            let Some(ev) = crate::opencode::parse_event(&String::from_utf8_lossy(&line)) else { continue };
            for out in translate(&mut state, &ev) {
                deliver(app, url, password, &mut state, out);
            }
        }
    }
}

/// What one event becomes for the island.
#[derive(Debug, PartialEq)]
enum Out {
    Hook(Value),
    /// A PermissionRequest to show and answer: (opencode request id, session id, payload).
    Ask(String, String, Value),
    /// opencode answered it itself: release the island's wait.
    Answered(String),
}

/// Like the relay (hook/src/main.rs): no string over 2,000 characters reaches
/// the island; a whole file written by a tool would only weigh on the webview.
const MAX_FIELD_LEN: usize = 2_000;

fn truncate_strings(value: &mut Value) {
    match value {
        Value::String(s) if s.len() > MAX_FIELD_LEN => {
            let mut end = MAX_FIELD_LEN;
            while end > 0 && !s.is_char_boundary(end) {
                end -= 1;
            }
            s.truncate(end);
            s.push('…');
        }
        Value::Array(items) => items.iter_mut().for_each(truncate_strings),
        Value::Object(map) => map.values_mut().for_each(truncate_strings),
        _ => {}
    }
}

fn deliver(app: &AppHandle, url: &str, password: Option<&str>, state: &mut Sessions, out: Out) {
    match out {
        Out::Hook(mut payload) => {
            truncate_strings(&mut payload);
            let _ = app.emit_to(WINDOW_LABEL, "hook", payload);
        }
        Out::Ask(id, session, mut payload) => {
            truncate_strings(&mut payload);
            let request = crate::pipe::new_request_id();
            state.asks.insert(id.clone(), request.clone());
            let (app, url, password) = (app.clone(), url.to_string(), password.map(str::to_string));
            tauri::async_runtime::spawn(async move {
                let Some(decision) = crate::pipe::request_decision_as(&app, &request, payload).await else { return };
                let word = match decision.as_str() {
                    "allow" => "once",
                    "always" => "always",
                    _ => "reject",
                };
                let Ok(client) = reqwest::Client::builder().timeout(Duration::from_secs(20)).build() else { return };
                let mut req = client.post(format!("{url}/api/session/{session}/permission/{id}/reply")).json(&json!({ "decision": word }));
                if let Some(p) = password {
                    req = req.basic_auth("opencode", Some(p));
                }
                let _ = req.send().await;
            });
        }
        Out::Answered(id) => {
            if let Some(request) = state.asks.remove(&id) {
                crate::pipe::decline(app, &request);
            }
        }
    }
}

fn agent() -> Value {
    json!({ "id": "opencode", "name": "opencode", "color": "#FAB283" })
}

/// opencode's tools under Claude Code's names, their arguments under its keys.
fn tool(name: &str) -> &str {
    match name {
        "shell" | "bash" => "Bash",
        "read" => "Read",
        "write" => "Write",
        "edit" => "Edit",
        "apply_patch" | "patch" => "Patch",
        "glob" => "Glob",
        "grep" => "Grep",
        "webfetch" => "WebFetch",
        "websearch" => "WebSearch",
        "todowrite" => "TodoWrite",
        "task" => "Task",
        other => other,
    }
}

fn args(input: &Value) -> Value {
    let mut m = input.as_object().cloned().unwrap_or_default();
    for (from, to) in [("filePath", "file_path"), ("oldString", "old_string"), ("newString", "new_string"), ("replaceAll", "replace_all")] {
        if let Some(v) = m.get(from).cloned() {
            m.entry(to.to_string()).or_insert(v);
        }
    }
    Value::Object(m)
}

/// The shape every payload starts from.
fn base(state: &Sessions, event: &str, session: &str) -> Map<String, Value> {
    let mut m = Map::new();
    m.insert("hook_event_name".into(), json!(event));
    m.insert("session_id".into(), json!(session));
    m.insert("cwd".into(), json!(state.cwd.get(session).cloned().unwrap_or_default()));
    m.insert("easyisland_agent".into(), agent());
    m
}

/// One event of the service → what the island gets (usually one hook payload).
fn translate(state: &mut Sessions, ev: &Value) -> Vec<Out> {
    let kind = ev.get("type").and_then(Value::as_str).unwrap_or_default();
    let data = ev.get("data").cloned().unwrap_or(Value::Null);
    let s = |k: &str| data.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
    let session = s("sessionID");
    if session.is_empty() {
        return Vec::new();
    }
    let hook = |m: Map<String, Value>| vec![Out::Hook(Value::Object(m))];
    match kind {
        "session.created" => {
            let dir = data.pointer("/location/directory").and_then(Value::as_str).unwrap_or_default().to_string();
            state.cwd.insert(session.clone(), dir);
            hook(base(state, "SessionStart", &session))
        }
        "session.inbox.enqueued" if data.pointer("/item/type").and_then(Value::as_str) == Some("user") => {
            let mut m = base(state, "UserPromptSubmit", &session);
            m.insert("prompt".into(), data.pointer("/item/payload/text").cloned().unwrap_or(json!("")));
            hook(m)
        }
        "session.tool.input.started" => {
            state.calls.insert(s("id"), (s("name"), Value::Null));
            Vec::new()
        }
        "session.tool.called" => {
            let id = s("id");
            let name = state.calls.get(&id).map(|c| c.0.clone()).unwrap_or_default();
            let input = data.get("input").cloned().unwrap_or(Value::Null);
            state.calls.insert(id, (name.clone(), input.clone()));
            let mut m = base(state, "PreToolUse", &session);
            m.insert("tool_name".into(), json!(tool(&name)));
            m.insert("tool_input".into(), args(&input));
            hook(m)
        }
        "session.tool.success" | "session.tool.failed" | "session.tool.error" => {
            let (name, input) = state.calls.remove(&s("id")).unwrap_or_default();
            let failed = kind != "session.tool.success";
            let mut m = base(state, if failed { "PostToolUseFailure" } else { "PostToolUse" }, &session);
            let name = tool(&name).to_string();
            let input = args(&input);
            let output: String = data.get("content").and_then(Value::as_array).into_iter().flatten()
                .filter_map(|c| c.get("text").and_then(Value::as_str)).collect::<Vec<_>>().join("\n");
            // The same extras the relay computes: the edit's diff, the tests' verdict.
            if !failed {
                if name == "Patch" {
                    if let Some(diffs) = crate::hook_agents::patch_text(&input).map(|p| crate::hook_agents::patch_diffs(&p)).filter(|d| !d.is_empty()) {
                        m.insert("easyisland_diffs".into(), Value::Array(diffs));
                    }
                } else if let Some(d) = crate::hook_diff::file_diff(&name, &input, None) {
                    m.insert("easyisland_diff".into(), d);
                }
            }
            if failed {
                let msg = data.pointer("/error/message").or_else(|| data.get("message")).cloned().unwrap_or(json!(output));
                m.insert("error".into(), msg);
            }
            m.insert("tool_name".into(), json!(name));
            m.insert("tool_input".into(), input);
            m.insert("tool_response".into(), json!({ "stdout": output }));
            let event = m.get("hook_event_name").and_then(Value::as_str).unwrap_or_default().to_string();
            if let Some(t) = crate::hook_testrun::verdict(&event, &m) {
                m.insert("easyisland_tests".into(), t);
            }
            // The output stays here, like the relay drops tool_response.
            m.remove("tool_response");
            hook(m)
        }
        "session.text.delta" => {
            state.text.entry(session).or_default().push_str(data.get("delta").and_then(Value::as_str).unwrap_or_default());
            Vec::new()
        }
        "session.text.ended" => {
            let text = data.get("text").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| state.text.get(&session).cloned().unwrap_or_default());
            state.text.remove(&session);
            if !text.trim().is_empty() {
                state.last.insert(session, text);
            }
            Vec::new()
        }
        "session.execution.succeeded" | "session.execution.interrupted" => {
            let mut m = base(state, "Stop", &session);
            if let Some(last) = state.last.remove(&session) {
                let short: String = last.chars().take(2000).collect();
                m.insert("easyisland_last_message".into(), json!(short));
            }
            hook(m)
        }
        "session.execution.failed" => {
            let mut m = base(state, "StopFailure", &session);
            let msg = data.pointer("/error/message").or_else(|| data.get("message")).or_else(|| data.get("error"))
                .and_then(Value::as_str).unwrap_or("errore").to_string();
            m.insert("error".into(), json!(msg));
            hook(m)
        }
        "session.compacted" | "session.compaction.started" => hook(base(state, "PreCompact", &session)),
        "session.deleted" => {
            state.cwd.remove(&session);
            hook(base(state, "SessionEnd", &session))
        }
        "permission.asked" => {
            let (mut payload, _) = crate::opencode::permission_payload(&data);
            payload.as_object_mut().map(|m| {
                m.remove("easyisland_chat");
                m.remove("easyisland_engine");
                m.insert("easyisland_agent".into(), agent());
                m.insert("cwd".into(), json!(state.cwd.get(&session).cloned().unwrap_or_default()));
            });
            // An agent's "Sempre": opencode's own patterns, whatever the command (as Claude Code proposes).
            let save: Vec<Value> = data.get("save").and_then(Value::as_array).cloned().unwrap_or_default();
            if !save.is_empty() && payload.get("permission_suggestions").is_none() {
                let name = payload.get("tool_name").cloned().unwrap_or(json!("Bash"));
                let rules: Vec<Value> = save.iter().filter_map(Value::as_str).map(|p| json!({ "toolName": name, "ruleContent": p })).collect();
                payload["permission_suggestions"] = json!([{ "type": "addRules", "rules": rules, "behavior": "allow", "destination": "session" }]);
            }
            vec![Out::Ask(s("id"), session, payload)]
        }
        "permission.replied" => vec![Out::Answered(s("requestID"))],
        _ => Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(kind: &str, data: Value) -> Value {
        json!({ "type": kind, "data": data })
    }

    fn only_hook(out: Vec<Out>) -> Value {
        match out.into_iter().next() {
            Some(Out::Hook(v)) => v,
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn a_session_reads_like_claude_codes() {
        let mut st = Sessions::default();
        let start = only_hook(translate(&mut st, &ev("session.created", json!({ "sessionID": "ses_1", "location": { "directory": "C:/Clienti/app" } }))));
        assert_eq!((start["hook_event_name"].as_str(), start["cwd"].as_str()), (Some("SessionStart"), Some("C:/Clienti/app")));
        assert_eq!(start["easyisland_agent"]["id"], "opencode");

        let prompt = only_hook(translate(&mut st, &ev("session.inbox.enqueued", json!({ "sessionID": "ses_1", "item": { "type": "user", "payload": { "text": "Sistema il bug" } } }))));
        assert_eq!((prompt["hook_event_name"].as_str(), prompt["prompt"].as_str()), (Some("UserPromptSubmit"), Some("Sistema il bug")));

        assert!(translate(&mut st, &ev("session.tool.input.started", json!({ "sessionID": "ses_1", "id": "c1", "name": "edit" }))).is_empty());
        let pre = only_hook(translate(&mut st, &ev("session.tool.called", json!({ "sessionID": "ses_1", "id": "c1",
            "input": { "filePath": "C:/Clienti/app/a.ts", "oldString": "a", "newString": "b" } }))));
        assert_eq!((pre["hook_event_name"].as_str(), pre["tool_name"].as_str()), (Some("PreToolUse"), Some("Edit")));
        assert_eq!(pre["tool_input"]["file_path"], "C:/Clienti/app/a.ts");

        let post = only_hook(translate(&mut st, &ev("session.tool.success", json!({ "sessionID": "ses_1", "id": "c1", "content": [{ "type": "text", "text": "ok" }] }))));
        assert_eq!(post["hook_event_name"], "PostToolUse");
        assert_eq!(post["easyisland_diff"]["added"], 1, "{post}");
        assert!(post.get("tool_response").is_none());

        translate(&mut st, &ev("session.text.delta", json!({ "sessionID": "ses_1", "delta": "Fatto" })));
        translate(&mut st, &ev("session.text.ended", json!({ "sessionID": "ses_1", "text": "Fatto: corretto il bug." })));
        let stop = only_hook(translate(&mut st, &ev("session.execution.succeeded", json!({ "sessionID": "ses_1" }))));
        assert_eq!((stop["hook_event_name"].as_str(), stop["easyisland_last_message"].as_str()), (Some("Stop"), Some("Fatto: corretto il bug.")));
    }

    #[test]
    fn a_permission_is_asked_and_released() {
        let mut st = Sessions::default();
        let out = translate(&mut st, &ev("permission.asked", json!({ "id": "per_1", "sessionID": "ses_1", "action": "shell",
            "resources": ["npm publish"], "save": ["npm publish *"] })));
        let Some(Out::Ask(id, session, payload)) = out.into_iter().next() else { panic!() };
        assert_eq!((id.as_str(), session.as_str()), ("per_1", "ses_1"));
        assert_eq!((payload["hook_event_name"].as_str(), payload["tool_input"]["command"].as_str()), (Some("PermissionRequest"), Some("npm publish")));
        assert!(payload.get("easyisland_chat").is_none(), "an agent's card, not the chat's");
        assert_eq!(payload["easyisland_agent"]["id"], "opencode");
        assert_eq!(payload["permission_suggestions"][0]["rules"][0]["ruleContent"], "npm publish *");
        assert_eq!(translate(&mut st, &ev("permission.replied", json!({ "sessionID": "ses_1", "requestID": "per_1", "reply": "once" }))),
            vec![Out::Answered("per_1".into())]);
    }

    /// The background service of the opencode on this PC:
    /// `cargo test --lib opencode_agent::tests::live -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_service_is_found_and_streams() {
        tauri::async_runtime::block_on(async {
            let (url, password) = service().await.expect("opencode service running");
            println!("service {url}, password {}", if password.is_some() { "found" } else { "none" });
            let client = reqwest::Client::new();
            let mut req = client.get(format!("{url}/api/event"));
            if let Some(p) = &password {
                req = req.basic_auth("opencode", Some(p));
            }
            let mut r = req.send().await.expect("connect");
            assert!(r.status().is_success(), "{}", r.status());
            let first = tokio::time::timeout(Duration::from_secs(10), r.chunk()).await.expect("an event").expect("chunk").expect("data");
            println!("{}", String::from_utf8_lossy(&first).lines().next().unwrap_or_default());
        });
    }

    #[test]
    fn long_strings_are_cut_like_the_relay_does() {
        let mut v = json!({ "tool_input": { "content": "è".repeat(3000) }, "n": 1 });
        truncate_strings(&mut v);
        let c = v["tool_input"]["content"].as_str().unwrap();
        assert!(c.len() <= MAX_FIELD_LEN + '…'.len_utf8() && c.ends_with('…'));
        assert_eq!(v["n"], 1);
    }

    #[test]
    fn other_events_and_other_servers_say_nothing() {
        let mut st = Sessions::default();
        assert!(translate(&mut st, &ev("mcp.status.changed", json!({ "server": "github" }))).is_empty());
        assert!(translate(&mut st, &ev("session.reasoning.delta", json!({ "sessionID": "ses_1", "delta": "x" }))).is_empty());
    }
}
