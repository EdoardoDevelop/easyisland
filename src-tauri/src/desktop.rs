// «Continua in Claude Desktop» (asked by Edoardo on 31 Oct 2026): the chat's
// Claude Code session goes on in the Claude desktop app, and what was said
// there comes back into the island's chat when the user returns.
//
// The handoff is Claude Code's own: `claude --desktop --resume <id>` in the
// session's folder (Claude Code 2.1.285 or later, signed in with a Claude
// subscription). Desktop goes on with the same session, not a copy, so the
// next turn of the island resumes it as before. The session's file
// (`~/.claude/projects/<folder>/<id>.jsonl`, one JSON object per line) is
// Claude Code's own and undocumented: it is read leniently, a line not
// understood is skipped, and only the text of questions and answers is taken
// (no tool calls, tool results or reminders).

use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::time::Duration;

use serde_json::Value;

use crate::chat_log::Line;
use crate::claude::Chat;
use crate::i18n::{t, tf};

/// `claude --desktop` opens the app and exits; a slow first start of the app is fine.
const HANDOFF_TIMEOUT: Duration = Duration::from_secs(60);
/// A session file read whole: beyond this it is not read.
const MAX_FILE: u64 = 64 * 1024 * 1024;

/// Where the island's chat left the session: the last line it knows.
#[derive(Debug, Clone)]
pub struct Mark {
    pub file: PathBuf,
    pub uuid: String,
    pub timestamp: String,
}

/// `<id>.jsonl` in one of Claude Code's project folders.
fn session_file(id: &str) -> Option<PathBuf> {
    if id.is_empty() || !id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return None;
    }
    let projects = crate::claude_cli::claude_dir()?.join("projects");
    let name = format!("{id}.jsonl");
    std::fs::read_dir(projects).ok()?.flatten().map(|d| d.path().join(&name)).find(|p| p.is_file())
}

fn read_lines(file: &Path) -> Vec<Value> {
    if std::fs::metadata(file).map(|m| m.len() > MAX_FILE).unwrap_or(true) {
        return Vec::new();
    }
    let text = std::fs::read_to_string(file).unwrap_or_default();
    text.lines().filter_map(|l| serde_json::from_str::<Value>(l).ok()).collect()
}

fn str_of<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}

/// The session's folder and its last line, from its file.
fn last_of(lines: &[Value]) -> (Option<PathBuf>, Option<(String, String)>) {
    let cwd = lines.iter().rev().map(|v| str_of(v, "cwd")).find(|c| !c.is_empty()).map(PathBuf::from);
    let last = lines
        .iter()
        .rev()
        .find(|v| !str_of(v, "uuid").is_empty())
        .map(|v| (str_of(v, "uuid").to_string(), str_of(v, "timestamp").to_string()));
    (cwd, last)
}

/// `<system-reminder>…</system-reminder>` and the like are Claude Code's, not the user's.
fn strip_reminders(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    while let Some(i) = rest.find("<system-reminder>") {
        out.push_str(rest.get(..i).unwrap_or(""));
        match rest.get(i..).and_then(|r| r.find("</system-reminder>")) {
            Some(j) => rest = rest.get(i + j + "</system-reminder>".len()..).unwrap_or(""),
            None => {
                rest = "";
                break;
            }
        }
    }
    out.push_str(rest);
    out.trim().to_string()
}

/// The text of one line of the file, with its role; none for what the chat does not show.
fn text_of(v: &Value) -> Option<(&'static str, String)> {
    let role = match str_of(v, "type") {
        "user" => "user",
        "assistant" => "assistant",
        _ => return None,
    };
    for flag in ["isSidechain", "isMeta", "isCompactSummary", "isVisibleInTranscriptOnly"] {
        if v.get(flag).and_then(Value::as_bool) == Some(true) {
            return None;
        }
    }
    let content = v.get("message")?.get("content")?;
    let text = match content {
        Value::String(s) => s.clone(),
        Value::Array(blocks) => blocks
            .iter()
            .filter(|b| str_of(b, "type") == "text")
            .map(|b| str_of(b, "text"))
            .collect::<Vec<_>>()
            .join("\n\n"),
        _ => return None,
    };
    let text = strip_reminders(&text);
    let noise = ["<command-", "<local-command-", "[Request interrupted"];
    if text.is_empty() || noise.iter().any(|n| text.starts_with(n)) {
        return None;
    }
    Some((role, text))
}

/// The questions and answers after the mark, one line per role in a row.
fn turns_after(lines: &[Value], mark: &Mark) -> Vec<Line> {
    let found = lines.iter().any(|v| str_of(v, "uuid") == mark.uuid);
    let mut after = !found;
    let mut out: Vec<Line> = Vec::new();
    for v in lines {
        if !after {
            after = str_of(v, "uuid") == mark.uuid;
            continue;
        }
        // The mark's line is gone (the session was compacted): what came later by its time.
        if !found && str_of(v, "timestamp") <= mark.timestamp.as_str() {
            continue;
        }
        let Some((role, text)) = text_of(v) else { continue };
        match out.last_mut() {
            Some(last) if last.role == role => {
                last.content.push_str("\n\n");
                last.content.push_str(&text);
            }
            _ => out.push(Line { role: role.into(), content: text }),
        }
    }
    out
}

/// The button: the session opens in Claude Desktop, and the island remembers where it was.
pub async fn hand_off(chat: &Chat) -> Result<(), String> {
    let session = chat
        .cli_session()
        .ok_or_else(|| t("Questa conversazione non ha ancora una sessione di Claude Code: scrivi prima un messaggio.").to_string())?;
    let exe = crate::claude_cli::find_claude().ok_or_else(|| t("Claude Code da riga di comando non si trova su questo PC.").to_string())?;
    let file = session_file(&session).ok_or_else(|| t("Il file della sessione di Claude Code non si trova.").to_string())?;
    let lines = read_lines(&file);
    let (cwd, last) = last_of(&lines);
    // Claude Code does not move a session another process still has open.
    crate::claude_cli::drop_live(chat);
    let mut cmd = crate::claude_cli::command(&exe);
    cmd.stdin(Stdio::null()).args(["--desktop", "--resume", &session]);
    if let Some(dir) = cwd.filter(|d| d.is_dir()) {
        cmd.current_dir(dir);
    }
    let out = tokio::time::timeout(HANDOFF_TIMEOUT, cmd.output())
        .await
        .map_err(|_| t("Claude Desktop non si è aperto in tempo.").to_string())?
        .map_err(|e| tf("Claude Code non si avvia: {e}", &[("e", &e)]))?;
    let said = format!("{}\n{}", String::from_utf8_lossy(&out.stdout), String::from_utf8_lossy(&out.stderr));
    let said = said.trim();
    crate::log::line(format!("desktop: {session} → {}", said.chars().take(300).collect::<String>()));
    if !out.status.success() || !said.contains(&session) {
        return Err(if said.is_empty() { t("Claude Code non ha aperto Claude Desktop.").to_string() } else { format!("Claude Code: {said}") });
    }
    let (uuid, timestamp) = last.unwrap_or_default();
    chat.set_desktop(Some(Mark { file, uuid, timestamp }));
    Ok(())
}

/// What was said in Claude Desktop since the handoff (or the last look), in the
/// chat's history too; `done` when the island goes on with the session itself.
pub fn pull(chat: &Chat, engine: &str, done: bool) -> Vec<Line> {
    let Some(mut mark) = chat.desktop() else { return Vec::new() };
    let lines = read_lines(&mark.file);
    let turns = turns_after(&lines, &mark);
    if let (_, Some((uuid, timestamp))) = last_of(&lines) {
        mark.uuid = uuid;
        mark.timestamp = timestamp;
    }
    chat.set_desktop(if done { None } else { Some(mark) });
    if !turns.is_empty() {
        crate::chat_log::append(chat, engine, &turns);
    }
    turns
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn mark(uuid: &str) -> Mark {
        Mark { file: PathBuf::new(), uuid: uuid.into(), timestamp: "2026-10-31T10:00:00Z".into() }
    }

    #[test]
    fn takes_the_text_after_the_mark() {
        let lines = vec![
            json!({"type": "user", "uuid": "a", "message": {"role": "user", "content": "prima"}}),
            json!({"type": "assistant", "uuid": "b", "message": {"content": [{"type": "text", "text": "risposta prima"}]}}),
            json!({"type": "user", "uuid": "c", "message": {"content": "<system-reminder>x</system-reminder>Domanda in Desktop"}}),
            json!({"type": "assistant", "uuid": "d", "message": {"content": [{"type": "tool_use", "name": "Read"}]}}),
            json!({"type": "user", "uuid": "e", "message": {"content": [{"type": "tool_result", "content": "file"}]}}),
            json!({"type": "assistant", "uuid": "f", "message": {"content": [{"type": "text", "text": "Uno"}]}}),
            json!({"type": "assistant", "uuid": "g", "message": {"content": [{"type": "text", "text": "Due"}]}}),
            json!({"type": "attachment", "uuid": "h"}),
            json!({"type": "user", "uuid": "i", "isSidechain": true, "message": {"content": "di un agente"}}),
        ];
        let got = turns_after(&lines, &mark("b"));
        assert_eq!(got, vec![
            Line { role: "user".into(), content: "Domanda in Desktop".into() },
            Line { role: "assistant".into(), content: "Uno\n\nDue".into() },
        ]);
        assert_eq!(last_of(&lines).1.map(|l| l.0).as_deref(), Some("i"));
    }

    #[test]
    fn without_the_mark_goes_by_time() {
        let lines = vec![
            json!({"type": "user", "uuid": "x", "timestamp": "2026-10-31T09:00:00Z", "message": {"content": "vecchia"}}),
            json!({"type": "user", "uuid": "y", "timestamp": "2026-10-31T11:00:00Z", "message": {"content": "nuova"}}),
        ];
        let got = turns_after(&lines, &mark("gone"));
        assert_eq!(got, vec![Line { role: "user".into(), content: "nuova".into() }]);
    }

    #[test]
    fn a_strange_id_finds_no_file() {
        assert!(session_file("../../etc").is_none());
        assert!(session_file("").is_none());
    }
}
