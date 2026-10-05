//! easyisland-hook — the relay Claude Code runs on every hook event.
//!
//! Reads the hook JSON on stdin, adds a little terminal context, and hands it to
//! EasyIsland over the named pipe `\\.\pipe\easyisland-<sid>`.
//!
//! Hard rule (CLAUDE.md): **never block Claude Code.**
//! * If the pipe does not exist — EasyIsland is closed — we exit 0 immediately with
//!   nothing on stdout, and the session carries on untouched.
//! * Every step runs under a deadline enforced by the main thread, so a pipe that
//!   accepts the connection and then stops reading cannot wedge the session
//!   either: we abandon the worker and exit.
//! * Only `PermissionRequest` waits for an answer, because approving from the
//!   island is the whole point. No answer means empty stdout, and Claude Code
//!   asks in the terminal exactly as if EasyIsland were not installed.
//!
//! Usage: `easyisland-hook <EventName>` (the name is also read from the JSON).
//!
//! `easyisland-hook notify …` is the other job: any script, scheduled task or n8n
//! flow can put a message on the island (see `notify`). It never reads stdin.
//!
//! `easyisland-hook mcp` is the third: EasyIsland's tools as an MCP server for
//! the app's own chat (see `mcp.rs`).

use std::io::{Read, Write};
use std::sync::mpsc;
use std::time::{Duration, Instant};

/// Budget for getting a pipe connection. Beyond this Claude Code wins, always.
const CONNECT_TIMEOUT: Duration = Duration::from_millis(300);
/// Whole-run budget for an event nobody waits on: connect and write, no more.
const FIRE_AND_FORGET_BUDGET: Duration = Duration::from_secs(2);
/// How long a permission prompt may stay on screen before the terminal takes over.
const DECISION_BUDGET: Duration = Duration::from_secs(110);

/// `ERROR_PIPE_BUSY` — every instance is serving someone else right now. This is
/// the one error worth retrying: the server exists and a slot will free up.
const ERROR_PIPE_BUSY: i32 = 231;

/// Fields that are pointless to forward and can be enormous (a whole file read,
/// a full command output). The island never shows them.
const DROPPED_FIELDS: &[&str] = &["tool_response", "transcript_path"];
/// Longest string forwarded for any single field; the island truncates to far
/// less than this anyway.
const MAX_FIELD_LEN: usize = 2_000;

mod agents;
mod diff;
mod mcp;
mod testrun;
mod win;

/// `\\.\pipe\easyisland-<sid>`. The SID keeps two accounts on the same machine from
/// ever meeting on the same pipe; the name falls back to the user name only if
/// the SID cannot be read at all, which should not happen.
fn pipe_path() -> String {
    let key = win::current_user_sid()
        .unwrap_or_else(|| std::env::var("USERNAME").unwrap_or_else(|_| "user".into()));
    format!(r"\\.\pipe\easyisland-{key}")
}

/// Opens the pipe. Retries only while the server is busy: any other error means
/// there is nothing to talk to, and waiting would only delay Claude Code.
fn connect() -> Option<std::fs::File> {
    use std::os::windows::io::AsRawHandle;
    let path = pipe_path();
    let deadline = Instant::now() + CONNECT_TIMEOUT;
    loop {
        match std::fs::OpenOptions::new().read(true).write(true).open(&path) {
            Ok(file) => {
                let handle = windows::Win32::Foundation::HANDLE(file.as_raw_handle());
                // Somebody else's server on our pipe name gets nothing from us.
                return win::pipe_server_is_same_user(handle).then_some(file);
            }
            Err(err) => {
                if err.raw_os_error() != Some(ERROR_PIPE_BUSY) || Instant::now() >= deadline {
                    return None;
                }
                std::thread::sleep(Duration::from_millis(15));
            }
        }
    }
}

fn main() {
    // Before anything reads stdin: from a console that would wait forever.
    if std::env::args().nth(1).as_deref() == Some("notify") {
        std::process::exit(notify(std::env::args().skip(2).collect()));
    }
    // EasyIsland as an MCP server for its own chat (see mcp.rs). Started by
    // Claude Code inside the chat, so before the EASYISLAND_INTERNAL guard.
    if std::env::args().nth(1).as_deref() == Some("mcp") {
        std::process::exit(mcp::serve());
    }
    // EasyIsland's own chat runs `claude -p` with hooks disabled; this is the second
    // guard, so that chat never shows up in the island as a work session.
    // `--chat` marks the one hook EasyIsland installs for its own chat (connector
    // confirmations); every other hook inside that chat is ignored.
    let chat = std::env::args().any(|a| a == "--chat");
    if std::env::var_os("EASYISLAND_INTERNAL").is_some() && !chat {
        std::process::exit(0);
    }
    let Some((payload, event, tool_input, suggestions)) = read_event() else { std::process::exit(0) };

    let waits_for_answer = event == "PermissionRequest";
    let budget = if waits_for_answer { DECISION_BUDGET } else { FIRE_AND_FORGET_BUDGET };

    // The worker owns every blocking call. If it overruns the budget we simply
    // stop listening and exit: the process dying takes the pipe handle with it.
    // (No catch_unwind here — the release profile is panic = "abort", so it would
    // be dead code. `talk` is written to have nothing to panic on instead.)
    let (tx, rx) = mpsc::channel::<Option<String>>();
    std::thread::spawn(move || {
        let _ = tx.send(talk(&payload, waits_for_answer));
    });

    if let Ok(Some(decision)) = rx.recv_timeout(budget) {
        if let Some(json) = decision_json(&decision, tool_input.as_ref(), suggestions.as_ref()) {
            let mut out = std::io::stdout();
            let _ = writeln!(out, "{json}");
            let _ = out.flush();
        }
    }
    // Nothing printed: Claude Code asks in the terminal, as if we were not here.
    std::process::exit(0);
}

/// The documented PermissionRequest output. Anything we do not recognise prints
/// nothing at all rather than guessing — silence is the safe answer.
/// See https://code.claude.com/docs/en/hooks
///
/// `answer {"<question>":"<label>",…}` answers an AskUserQuestion: an allow
/// whose `updatedInput` is the tool's own input plus those `answers`. The
/// input comes from stdin, untruncated — the island only ever saw a shortened copy.
///
/// `always` ("Sempre") is an allow that also hands Claude Code back the rules
/// it proposed itself (`permission_suggestions`, see `always_rules`): the same
/// thing as "Yes, and don't ask again" in the terminal. With nothing usable
/// proposed it is a plain allow.
fn decision_json(
    decision: &str,
    tool_input: Option<&serde_json::Value>,
    suggestions: Option<&serde_json::Value>,
) -> Option<String> {
    if decision.trim() == "always" {
        let rules = always_rules(suggestions);
        if !rules.is_empty() {
            let out = serde_json::json!({
                "hookSpecificOutput": {
                    "hookEventName": "PermissionRequest",
                    "decision": { "behavior": "allow", "updatedPermissions": rules },
                }
            });
            return Some(out.to_string());
        }
    }
    if let Some(answers) = decision.trim().strip_prefix("answer ") {
        let answers = serde_json::from_str::<serde_json::Value>(answers).ok()?;
        let answers = answers.as_object().filter(|a| !a.is_empty() && a.values().all(|v| v.is_string()))?;
        let mut input = tool_input?.as_object()?.clone();
        input.insert("answers".into(), serde_json::Value::Object(answers.clone()));
        let out = serde_json::json!({
            "hookSpecificOutput": {
                "hookEventName": "PermissionRequest",
                "decision": { "behavior": "allow", "updatedInput": input },
            }
        });
        return Some(out.to_string());
    }
    let behavior = match decision.trim() {
        // "always" with no rule to save is just an allow.
        "allow" | "always" => r#"{"behavior":"allow"}"#.to_string(),
        "deny" => r#"{"behavior":"deny","message":"Negato da EasyIsland"}"#.to_string(),
        _ => return None,
    };
    Some(format!(
        r#"{{"hookSpecificOutput":{{"hookEventName":"PermissionRequest","decision":{behavior}}}}}"#
    ))
}

/// The `updatedPermissions` for "Sempre", taken only from Claude Code's own
/// `permission_suggestions` — EasyIsland never invents a rule:
/// * allow rules (`addRules`, or no `type`) and extra directories (`addDirectories`);
/// * `setMode` only to `acceptEdits` and only for the session (the terminal's
///   "allow all edits during this session");
/// * anything bound for `userSettings` (`~/.claude/settings.json`, which
///   EasyIsland never writes without a diff and a confirmation) is kept in the
///   project's `.claude/settings.local.json` instead.
/// The island shows the same selection (`alwaysLabel` in src/island/hooks.ts).
fn always_rules(suggestions: Option<&serde_json::Value>) -> Vec<serde_json::Value> {
    use serde_json::{json, Value};
    let dest = |s: &Value| match s.get("destination").and_then(Value::as_str) {
        Some("session") => "session",
        Some("projectSettings") => "projectSettings",
        _ => "localSettings",
    };
    let Some(list) = suggestions.and_then(Value::as_array) else { return Vec::new() };
    list.iter()
        .filter_map(|s| match s.get("type").and_then(Value::as_str).unwrap_or("addRules") {
            "addRules" => {
                let rules = s.get("rules").and_then(Value::as_array).filter(|r| !r.is_empty())?;
                (s.get("behavior").and_then(Value::as_str) == Some("allow")).then(|| {
                    json!({ "type": "addRules", "rules": rules, "behavior": "allow", "destination": dest(s) })
                })
            }
            "addDirectories" => {
                let dirs = s.get("directories").and_then(Value::as_array).filter(|d| !d.is_empty())?;
                Some(json!({ "type": "addDirectories", "directories": dirs, "destination": dest(s) }))
            }
            "setMode" if s.get("mode").and_then(Value::as_str) == Some("acceptEdits") => {
                Some(json!({ "type": "setMode", "mode": "acceptEdits", "destination": "session" }))
            }
            _ => None,
        })
        .collect()
}

const NOTIFY_USAGE: &str = "Uso: easyisland-hook notify [titolo] [testo] [opzioni]

Mostra un messaggio sull'isola di EasyIsland.

  --titolo, -t <testo>   titolo (oppure il primo argomento)
  --testo,  -m <testo>   messaggio (oppure il secondo argomento)
  --stato,  -s <stato>   ok | avviso | errore | info   (predefinito: info)
  --apri,   -u <url>     indirizzo da aprire con il pulsante Apri (https://…)

Esempio:
  easyisland-hook notify \"Backup\" \"Completato in 4 minuti\" --stato ok

Esce con 0 se il messaggio è arrivato, 2 se EasyIsland non è in esecuzione.";

/// `easyisland-hook notify`: one message for the island. Exit code 0 = delivered,
/// 1 = bad arguments, 2 = EasyIsland is not running (or did not answer in time).
fn notify(args: Vec<String>) -> i32 {
    let (mut title, mut text, mut level, mut url) = (String::new(), String::new(), "info".to_string(), String::new());
    let mut positional = Vec::new();
    let mut it = args.into_iter();
    while let Some(a) = it.next() {
        match a.as_str() {
            "-h" | "--help" | "/?" => {
                println!("{NOTIFY_USAGE}");
                return 0;
            }
            "--titolo" | "--title" | "-t" => title = it.next().unwrap_or_default(),
            "--testo" | "--text" | "--messaggio" | "-m" => text = it.next().unwrap_or_default(),
            "--stato" | "--status" | "--level" | "-s" => level = it.next().unwrap_or_default(),
            "--apri" | "--open" | "--url" | "-u" => url = it.next().unwrap_or_default(),
            other if other.starts_with("--") => {
                eprintln!("Opzione sconosciuta: {other}

{NOTIFY_USAGE}");
                return 1;
            }
            _ => positional.push(a),
        }
    }
    let mut pos = positional.into_iter();
    if title.is_empty() {
        title = pos.next().unwrap_or_default();
    }
    if text.is_empty() {
        text = pos.next().unwrap_or_default();
    }
    if title.trim().is_empty() && text.trim().is_empty() {
        eprintln!("{NOTIFY_USAGE}");
        return 1;
    }
    let level = match level.trim().to_lowercase().as_str() {
        "ok" | "successo" | "success" | "fatto" => "ok",
        "avviso" | "warn" | "warning" | "attenzione" => "warn",
        "errore" | "error" | "err" | "ko" => "error",
        _ => "info",
    };
    let url = url.trim();
    let url = if url.starts_with("https://") || url.starts_with("http://") { url } else { "" };
    let cut = |s: &str, n: usize| s.chars().take(n).collect::<String>();
    let payload = serde_json::json!({
        "hook_event_name": "EasyIslandNotify",
        "title": cut(title.trim(), 120),
        "text": cut(text.trim(), 600),
        "level": level,
        "url": url,
    });
    let line = format!("{payload}
");
    let (tx, rx) = mpsc::channel::<bool>();
    std::thread::spawn(move || {
        let ok = connect().is_some_and(|mut pipe| pipe.write_all(line.as_bytes()).is_ok() && pipe.flush().is_ok());
        let _ = tx.send(ok);
    });
    if rx.recv_timeout(FIRE_AND_FORGET_BUDGET).unwrap_or(false) {
        0
    } else {
        eprintln!("EasyIsland non è in esecuzione: il messaggio non è stato mostrato.");
        2
    }
}

/// Reads stdin and returns the payload to forward, the event name and the
/// tool's input exactly as received (before any truncation).
fn read_event() -> Option<(String, String, Option<serde_json::Value>, Option<serde_json::Value>)> {
    let mut raw = Vec::new();
    if std::io::stdin().read_to_end(&mut raw).is_err() || raw.is_empty() {
        return None;
    }
    // Some shells hand us a UTF-8 BOM; serde_json would choke on it.
    if raw.starts_with(&[0xEF, 0xBB, 0xBF]) {
        raw.drain(..3);
    }

    let mut payload = serde_json::from_slice::<serde_json::Value>(&raw).ok()?;
    let map = payload.as_object_mut()?;

    // The event name is passed as argv[1] by the hook command; the JSON usually
    // carries it too. Trust argv when the JSON is missing it.
    let arg_event = std::env::args().nth(1).unwrap_or_default();
    let mut event = map
        .get("hook_event_name")
        .and_then(|v| v.as_str())
        .map(str::to_string)
        .filter(|s| !s.is_empty())
        .unwrap_or(arg_event);
    map.insert("hook_event_name".into(), serde_json::Value::String(event.clone()));
    if std::env::args().any(|a| a == "--chat") {
        map.insert("easyisland_chat".into(), serde_json::Value::Bool(true));
    }
    // Codex, Gemini CLI or a tool of its own: Claude Code's shape and its own pill.
    let args: Vec<String> = std::env::args().collect();
    agents::normalize(agents::from_args(&args).as_deref(), map);
    if let Some(e) = map.get("hook_event_name").and_then(|v| v.as_str()) {
        event = e.to_string();
    }

    // Built from the whole payload, before it is cut down: a file edit's diff
    // and a finished session's last message (diff.rs).
    if event == "PostToolUse" {
        let tool = map.get("tool_name").and_then(|v| v.as_str()).unwrap_or_default().to_string();
        let input = map.get("tool_input").cloned().unwrap_or_default();
        // Codex's apply_patch: one diff per file it touches.
        if tool == "Patch" {
            if let Some(patch) = agents::patch_text(&input) {
                let diffs = agents::patch_diffs(&patch);
                if !diffs.is_empty() {
                    map.insert("easyisland_diffs".into(), serde_json::Value::Array(diffs));
                    map.remove("tool_input");
                }
            }
        } else if let Some(d) = diff::file_diff(&tool, &input, map.get("tool_response")) {
            map.insert("easyisland_diff".into(), d);
            // The diff says it all; the snippets would only travel twice.
            if let Some(input) = map.get_mut("tool_input").and_then(|v| v.as_object_mut()) {
                for k in ["old_string", "new_string", "content", "edits"] {
                    input.remove(k);
                }
            }
        }
    }
    // A test run: what its output really said (testrun.rs).
    if event == "PostToolUse" || event == "PostToolUseFailure" {
        if let Some(t) = testrun::verdict(&event, map) {
            map.insert("easyisland_tests".into(), t);
        }
    }
    if event == "Stop" {
        if let Some(m) = diff::last_message(map) {
            map.insert("easyisland_last_message".into(), serde_json::Value::String(m));
        }
    }

    for field in DROPPED_FIELDS {
        map.remove(*field);
    }
    let tool_input = map.get("tool_input").cloned();
    // What "Sempre" sends back: Claude Code's own proposal, untruncated.
    let suggestions = map.get("permission_suggestions").cloned();

    let cwd_missing = map
        .get("cwd")
        .and_then(|v| v.as_str())
        .map(str::is_empty)
        .unwrap_or(true);
    if cwd_missing {
        if let Ok(cwd) = std::env::current_dir() {
            map.insert(
                "cwd".into(),
                serde_json::Value::String(cwd.to_string_lossy().to_string()),
            );
        }
    }

    // Which terminal the session runs in. Unlike macOS, EasyIsland on Windows accepts
    // events from every terminal, so this is context only — never a filter.
    for (key, var) in [
        ("term_program", "TERM_PROGRAM"),
        ("wt_session", "WT_SESSION"),
        ("term_session_id", "TERM_SESSION_ID"),
        ("vscode_pid", "VSCODE_PID"),
        ("session_pid", "CLAUDE_CODE_SSE_PORT"),
        // "claude-desktop", "claude-vscode", "cli"…: where "Apri" should take you.
        ("entrypoint", "CLAUDE_CODE_ENTRYPOINT"),
    ] {
        if !map.contains_key(key) {
            let value = std::env::var(var).unwrap_or_default();
            map.insert(key.into(), serde_json::Value::String(value));
        }
    }

    // Claude Code in Cursor's terminal: "Apri" brings Cursor back.
    if agents::in_cursor() {
        map.insert("cursor".into(), serde_json::Value::Bool(true));
    }

    truncate_strings(&mut payload);

    let mut line = payload.to_string();
    line.push('\n');
    Some((line, event, tool_input, suggestions))
}

/// Caps every string in the payload. A single Write can carry a whole file.
fn truncate_strings(value: &mut serde_json::Value) {
    match value {
        serde_json::Value::String(s) => {
            if s.len() > MAX_FIELD_LEN {
                // Cut on a char boundary; a lone byte index can split UTF-8.
                let mut end = MAX_FIELD_LEN;
                while end > 0 && !s.is_char_boundary(end) {
                    end -= 1;
                }
                s.truncate(end);
                s.push('…');
            }
        }
        serde_json::Value::Array(items) => items.iter_mut().for_each(truncate_strings),
        serde_json::Value::Object(map) => map.values_mut().for_each(truncate_strings),
        _ => {}
    }
}

/// Connect, send, and — for a permission request — wait for the island's word.
fn talk(payload: &str, waits_for_answer: bool) -> Option<String> {
    let mut pipe = connect()?;

    if pipe.write_all(payload.as_bytes()).is_err() {
        return None;
    }
    let _ = pipe.flush();

    if !waits_for_answer {
        return None;
    }

    let mut buf = Vec::new();
    let mut chunk = [0u8; 1024];
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
    let answer = String::from_utf8_lossy(&buf).trim().to_string();
    (!answer.is_empty()).then_some(answer)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decision_json_matches_the_documented_shape() {
        assert_eq!(
            decision_json("allow", None, None).unwrap(),
            r#"{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"allow"}}}"#
        );
        assert_eq!(
            decision_json("deny", None, None).unwrap(),
            r#"{"hookSpecificOutput":{"hookEventName":"PermissionRequest","decision":{"behavior":"deny","message":"Negato da EasyIsland"}}}"#
        );
        // "always" is an island concept; Claude Code just gets an allow.
        assert!(decision_json("always", None, None).unwrap().contains(r#""behavior":"allow""#));
    }

    #[test]
    fn answers_go_back_inside_the_original_input() {
        let input = serde_json::json!({ "questions": [{ "question": "Quale?", "options": [] }] });
        let out = decision_json(r#"answer {"Quale?":"Questa"}"#, Some(&input), None).unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        let d = &v["hookSpecificOutput"]["decision"];
        assert_eq!(d["behavior"], "allow");
        assert_eq!(d["updatedInput"]["answers"]["Quale?"], "Questa");
        assert_eq!(d["updatedInput"]["questions"], input["questions"]);
        // No input, empty or malformed answers: say nothing.
        assert!(decision_json(r#"answer {"Quale?":"Questa"}"#, None, None).is_none());
        assert!(decision_json("answer {}", Some(&input), None).is_none());
        assert!(decision_json(r#"answer {"Quale?":1}"#, Some(&input), None).is_none());
        assert!(decision_json("answer nope", Some(&input), None).is_none());
    }

    #[test]
    fn always_sends_back_claude_codes_own_rules() {
        let suggestions = serde_json::json!([
            { "type": "addRules", "rules": [{ "toolName": "Bash", "ruleContent": "npm *" }], "behavior": "allow", "destination": "localSettings" },
            { "rules": [{ "toolName": "WebFetch", "ruleContent": "domain:x.it" }], "behavior": "allow", "destination": "userSettings" },
            { "type": "addRules", "rules": [{ "toolName": "Bash" }], "behavior": "deny", "destination": "session" },
            { "type": "setMode", "mode": "bypassPermissions", "destination": "session" },
            { "type": "setMode", "mode": "acceptEdits", "destination": "session" },
            { "type": "addDirectories", "directories": ["C:\\dati"], "destination": "session" },
        ]);
        let out = decision_json("always", None, Some(&suggestions)).unwrap();
        let v: serde_json::Value = serde_json::from_str(&out).unwrap();
        let d = &v["hookSpecificOutput"]["decision"];
        assert_eq!(d["behavior"], "allow");
        let p = d["updatedPermissions"].as_array().unwrap();
        assert_eq!(p.len(), 4, "{p:?}"); // no deny rule, no bypassPermissions
        assert_eq!(p[0]["rules"][0]["ruleContent"], "npm *");
        // ~/.claude/settings.json is never the destination.
        assert_eq!(p[1]["destination"], "localSettings");
        assert_eq!(p[2]["mode"], "acceptEdits");
        assert_eq!(p[3]["type"], "addDirectories");
        // Nothing usable proposed: a plain allow.
        assert_eq!(
            decision_json("always", None, Some(&serde_json::json!([]))).unwrap(),
            decision_json("allow", None, None).unwrap()
        );
    }

    #[test]
    fn anything_unrecognised_prints_nothing() {
        assert!(decision_json("", None, None).is_none());
        assert!(decision_json("maybe", None, None).is_none());
        // The shape the app used to send must not be mistaken for a decision.
        assert!(decision_json(r#"{"permissionDecision":"allow"}"#, None, None).is_none());
    }

    #[test]
    fn long_strings_are_cut_on_a_char_boundary() {
        let mut v = serde_json::json!({ "tool_input": { "content": "é".repeat(4000) } });
        truncate_strings(&mut v);
        let s = v["tool_input"]["content"].as_str().unwrap();
        assert!(s.len() <= MAX_FIELD_LEN + 4);
        assert!(s.ends_with('…'));
    }
}
