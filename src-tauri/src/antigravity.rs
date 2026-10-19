//! Antigravity (Google) as an engine of the chat: `agy -p` with
//! `--output-format stream-json`, one process per turn, the conversation kept
//! by its id (`--conversation`). Like Claude Code and opencode it has its own
//! tools (commands, files, web, its MCP servers): a command or an MCP tool
//! asks Consenti / Nega in the island through its hooks (hooks.rs, the relay
//! with `EASYISLAND_AGY_CHAT`), which are needed for that — without them
//! Antigravity's headless mode simply skips what it would have asked.
//! Installing and signing in are the user's (Impostazioni → Chat).

use std::path::{Path, PathBuf};
use std::process::Stdio;

use serde_json::Value;
use tokio::io::{AsyncBufReadExt, AsyncReadExt};

use crate::claude::{Chat, ChatContext, ChatReply};
use crate::i18n::{t, tf};
use crate::openai::ModelOption;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
/// A turn with commands and files can be long; the CLI's own limit is 5 minutes by default.
const TURN_LIMIT: std::time::Duration = std::time::Duration::from_secs(30 * 60);
const STREAM_EVERY: std::time::Duration = std::time::Duration::from_millis(120);
/// A prompt rides on the command line: text attached to it is cut here.
const MAX_CONTEXT: usize = 20_000;

/// `agy.exe`: where its installer puts it (`%LOCALAPPDATA%\agy\bin`), else on the PATH.
pub fn find_exe() -> Option<PathBuf> {
    if let Some(local) = std::env::var_os("LOCALAPPDATA").map(PathBuf::from) {
        for p in [local.join("agy").join("bin").join("agy.exe"), local.join("Antigravity").join("agy.exe")] {
            if p.is_file() {
                return Some(p);
            }
        }
    }
    crate::find_on_path("agy").filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case("exe")))
}

pub(crate) fn command(exe: &Path) -> tokio::process::Command {
    let mut cmd = tokio::process::Command::new(exe);
    cmd.stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd
}

/// Impostazioni → Chat: is `agy` here?
#[derive(serde::Serialize)]
pub struct AgyStatus {
    pub found: bool,
    pub path: String,
}

pub fn status() -> AgyStatus {
    match find_exe() {
        Some(p) => AgyStatus { found: true, path: p.to_string_lossy().to_string() },
        None => AgyStatus { found: false, path: String::new() },
    }
}

/// `agy models`: the slugs it accepts for `--model` (first word of each line
/// that looks like one).
pub async fn models() -> Result<Vec<ModelOption>, String> {
    let exe = find_exe().ok_or_else(|| t("Antigravity (agy) non è installato su questo PC.").to_string())?;
    let out = tokio::time::timeout(std::time::Duration::from_secs(30), command(&exe).arg("models").output())
        .await
        .map_err(|_| t("Antigravity non ha risposto in tempo.").to_string())?
        .map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&out.stdout);
    let mut list: Vec<ModelOption> = text.lines().filter_map(slug_of).map(|id| ModelOption { id, price: None, cost: None }).collect();
    list.dedup_by(|a, b| a.id == b.id);
    if list.is_empty() {
        return Err(tf("Antigravity non ha dato modelli: {e}", &[("e", &String::from_utf8_lossy(&out.stderr).trim().chars().take(200).collect::<String>())]));
    }
    Ok(list)
}

fn slug_of(line: &str) -> Option<String> {
    let word = line.trim().trim_start_matches(['*', '-', '•', '>', ' ']).split_whitespace().next()?;
    let ok = word.len() >= 3 && word.contains('-') && word.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || "-._/:".contains(c));
    ok.then(|| word.to_string())
}

/// What the turn showed so far: its answer, with the tools as short lines.
#[derive(Default)]
struct Progress {
    shown: String,
    answer: String,
    conversation: Option<String>,
    result: Option<Value>,
}

impl Progress {
    /// One line of `stream-json`; true when what is shown changed. agy 1.4
    /// nests each event's fields under its name: `{"event":"step_update",
    /// "step_update":{…}}` (the top level is read too, as the docs show it).
    fn feed(&mut self, line: &str) -> bool {
        let Ok(top) = serde_json::from_str::<Value>(line) else { return false };
        let event = top.get("event").and_then(Value::as_str).unwrap_or("").to_string();
        let v = top.get(&event).filter(|x| x.is_object()).cloned().unwrap_or(top.clone());
        if let Some(id) = v.get("conversation_id").or_else(|| top.get("conversation_id")).and_then(Value::as_str) {
            self.conversation = Some(id.to_string());
        }
        match Some(event.as_str()) {
            Some("step_update") => {
                let kind = v.get("step_type").and_then(Value::as_str).unwrap_or("");
                if kind == "agent_response" {
                    if let Some(d) = v.get("text_delta").and_then(Value::as_str) {
                        self.shown.push_str(d);
                        self.answer.push_str(d);
                        return true;
                    }
                } else if kind == "tool" && matches!(v.get("state").and_then(Value::as_str), Some("DONE") | Some("ERROR")) {
                    let info = v.get("tool_info").cloned().unwrap_or(Value::Null);
                    let name = info.get("name").or_else(|| v.get("tool_name")).and_then(Value::as_str).unwrap_or("tool");
                    let mut line = tool_line(name, info.get("parameters").unwrap_or(&Value::Null));
                    // Denied (by the island, or skipped without hooks) or failed.
                    if v.get("state").and_then(Value::as_str) == Some("ERROR") {
                        let msg = info.pointer("/error/message").and_then(Value::as_str).unwrap_or("");
                        line.push_str(if msg.contains("permission") { " — negato" } else { " — non riuscito" });
                    }
                    if !self.shown.is_empty() && !self.shown.ends_with('\n') {
                        self.shown.push('\n');
                    }
                    self.shown.push_str(&line);
                    self.shown.push_str("\n\n");
                    // The answer is what comes after the last tool.
                    self.answer.clear();
                    return true;
                }
                false
            }
            Some("result") => {
                self.result = Some(v);
                false
            }
            _ => false,
        }
    }
}

/// A tool of Antigravity as the chat's step line ("> ⚙ Esegue · `npm test`").
fn tool_line(name: &str, p: &Value) -> String {
    let get = |keys: &[&str]| keys.iter().find_map(|k| p.get(*k).and_then(Value::as_str)).unwrap_or("").to_string();
    let short = |s: String| -> String { s.lines().next().unwrap_or("").chars().take(80).collect::<String>().replace('`', "'") };
    let file = |s: String| Path::new(&s).file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or(s);
    match name {
        "run_command" => format!("> ⚙ {} · `{}`", t("Esegue"), short(get(&["CommandLine", "commandLine"]))),
        "write_to_file" => format!("> ⚙ {} · `{}`", t("Crea"), file(get(&["TargetFile", "targetFile"]))),
        "replace_file_content" | "multi_replace_file_content" => format!("> ⚙ {} · `{}`", t("Modifica"), file(get(&["TargetFile", "targetFile"]))),
        "view_file" => format!("> ⚙ {} · `{}`", t("Legge"), file(get(&["AbsolutePath", "absolutePath"]))),
        "search_web" => format!("> ⚙ {} · `{}`", t("Cerca sul web"), short(get(&["query", "Query"]))),
        "read_url_content" => format!("> ⚙ {} · `{}`", t("Apre"), short(get(&["Url", "url"]))),
        "call_mcp_tool" => format!("> ⚙ {} · {}", get(&["ToolName", "toolName"]), get(&["ServerName", "serverName"])),
        other => format!("> ⚙ {other}"),
    }
}

/// One turn. `folder`: where it works (the terminal mode's folder, else the
/// work folder, else the user's folder).
pub async fn send(
    chat: &Chat,
    model: &str,
    query: String,
    context: Option<ChatContext>,
    folder: Option<&Path>,
    on_text: &(dyn Fn(&str) + Sync),
    telegram: bool,
) -> Result<ChatReply, String> {
    let exe = find_exe().ok_or_else(|| t("Per la chat con Antigravity serve la sua CLI (agy) installata su questo PC e con il login fatto: Impostazioni → Chat e motori AI spiega come.").to_string())?;
    let session = chat.cli_session();
    let mut prompt = String::new();
    if session.is_none() {
        match &context {
            Some(ChatContext::File { name, path }) => {
                prompt.push_str(&tf("File allegato: {name}\nPercorso: {path}\nLeggilo prima di rispondere.\n\n", &[("name", name), ("path", path)]));
            }
            Some(ChatContext::Text { label, text }) => {
                let text: String = text.chars().take(MAX_CONTEXT).collect();
                prompt.push_str(&format!("{label}:\n\n{text}\n\n"));
            }
            _ => {}
        }
    }
    prompt.push_str(&query);

    let dir = folder.map(Path::to_path_buf)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."));
    let mut cmd = command(&exe);
    cmd.current_dir(&dir).arg("--output-format").arg("stream-json");
    if !model.trim().is_empty() {
        cmd.arg("--model").arg(model.trim());
    }
    if let Some(id) = &session {
        cmd.arg("--conversation").arg(id);
    }
    // The prompt attached to the flag, last: `-p <text>` would take a text
    // starting with "-" for an option, and agy stops at the first argument.
    cmd.arg(format!("--print={prompt}"));
    // Its hooks know this turn is the chat's: permissions as the chat's, no session.
    cmd.env("EASYISLAND_AGY_CHAT", "1");
    if telegram {
        cmd.env("EASYISLAND_CHANNEL", "telegram");
    }
    let mut child = cmd.spawn().map_err(|e| tf("Antigravity non si avvia: {e}", &[("e", &e)]))?;
    let stdout = child.stdout.take().ok_or(t("Antigravity si è interrotto."))?;
    let stderr = child.stderr.take();
    let err = tauri::async_runtime::spawn(async move {
        let mut s = String::new();
        if let Some(mut e) = stderr {
            let _ = e.read_to_string(&mut s).await;
        }
        s
    });
    let mut lines = tokio::io::BufReader::new(stdout).lines();
    let mut progress = Progress::default();
    let mut emitted = std::time::Instant::now();
    let deadline = tokio::time::Instant::now() + TURN_LIMIT;
    loop {
        match tokio::time::timeout_at(deadline, lines.next_line()).await {
            Err(_) => {
                let _ = child.start_kill();
                return Err(t("Antigravity non ha finito entro 30 minuti: interrotto.").into());
            }
            Ok(Err(e)) => return Err(tf("Antigravity si è interrotto: {e}", &[("e", &e)])),
            Ok(Ok(None)) => break,
            Ok(Ok(Some(line))) => {
                if progress.feed(&line) && emitted.elapsed() >= STREAM_EVERY {
                    emitted = std::time::Instant::now();
                    on_text(&progress.shown);
                }
            }
        }
    }
    let ok = matches!(child.wait().await, Ok(s) if s.success());
    let stderr = err.await.unwrap_or_default();
    let result = progress.result.clone().unwrap_or(Value::Null);
    let status = result.get("status").and_then(Value::as_str).unwrap_or("");
    if !ok || status == "ERROR" || status == "INVALID" {
        chat.set_cli_session(None);
        let why = result.get("error").and_then(Value::as_str).map(String::from)
            .unwrap_or_else(|| stderr.trim().chars().take(300).collect());
        let low = why.to_lowercase();
        if low.contains("sign in") || low.contains("login") || low.contains("auth") {
            return Err(t("Antigravity non ha il login: apri un terminale, scrivi «agy» e accedi con il tuo account Google, poi riprova.").into());
        }
        return Err(if why.is_empty() { t("Antigravity ha restituito un errore.").to_string() } else { format!("Antigravity: {why}") });
    }
    if let Some(id) = result.get("conversation_id").and_then(Value::as_str).map(String::from).or(progress.conversation) {
        chat.set_cli_session(Some(id));
    }
    let mut final_text = result.get("response").and_then(Value::as_str).unwrap_or("").to_string();
    // What headless mode skipped because nobody could be asked (no hooks).
    let denied = result.get("denied_actions").and_then(Value::as_array).map(Vec::len).unwrap_or(0);
    if denied > 0 && !crate::hooks::status_for(crate::hooks::Target::Antigravity).installed {
        final_text.push_str(&format!("\n\n> {}", t("Antigravity ha saltato dei comandi perché non poteva chiederti il permesso: installa i suoi hook in Impostazioni → Agenti di codice → Antigravity, così chiede Consenti / Nega nell'isola.")));
    }
    // The steps stay above the answer, as they were shown.
    let text = if progress.shown.trim().is_empty() { final_text } else if progress.answer.trim().is_empty() && !final_text.is_empty() {
        format!("{}{final_text}", progress.shown)
    } else {
        progress.shown
    };
    if text.trim().is_empty() {
        return Err(t("Nessun testo nella risposta.").into());
    }
    Ok(ChatReply { text })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stream_shows_the_answer_and_the_tools() {
        let mut p = Progress::default();
        assert!(!p.feed(r#"{"event":"init","cwd":"c:/x","tools":["run_command"],"permission_mode":"request-review"}"#));
        assert!(p.feed(r#"{"event":"step_update","conversation_id":"c1","step_type":"tool","state":"DONE","tool_info":{"name":"run_command","parameters":{"CommandLine":"npm test"}}}"#));
        assert!(p.feed(r#"{"event":"step_update","conversation_id":"c1","step_type":"agent_response","state":"ACTIVE","text_delta":"Fatto"}"#));
        assert!(!p.feed(r#"{"event":"result","conversation_id":"c1","status":"SUCCESS","response":"Fatto"}"#));
        assert!(p.shown.contains("npm test"));
        assert!(p.shown.ends_with("Fatto"));
        assert_eq!(p.answer, "Fatto");
        assert_eq!(p.conversation.as_deref(), Some("c1"));
        assert!(!p.feed("non json"));
    }

    #[test]
    fn agy_nests_each_event_under_its_name() {
        let mut p = Progress::default();
        p.feed(r#"{"event":"init","conversation_id":"c2","init":{"cwd":"C:\\x"}}"#);
        assert!(p.feed(r#"{"event":"step_update","step_update":{"conversation_id":"c2","step_index":2,"state":"ERROR","step_type":"tool","tool_name":"run_command","tool_info":{"name":"run_command","parameters":{"CommandLine":"echo fatto"},"error":{"type":"TOOL_ERROR","message":"permission check failed"}}}}"#));
        assert!(p.feed(r#"{"event":"step_update","step_update":{"conversation_id":"c2","step_index":3,"state":"ACTIVE","step_type":"agent_response","text_delta":"ciao"}}"#));
        p.feed(r#"{"event":"result","result":{"conversation_id":"c2","status":"SUCCESS","response":"ciao\n"}}"#);
        assert!(p.shown.contains("echo fatto") && p.shown.contains("negato"));
        assert_eq!(p.answer, "ciao");
        assert_eq!(p.result.as_ref().unwrap()["status"], "SUCCESS");
        assert_eq!(p.conversation.as_deref(), Some("c2"));
    }

    #[test]
    fn model_slugs_from_its_list() {
        assert_eq!(slug_of("gemini-3.1-pro   Gemini 3.1 Pro").as_deref(), Some("gemini-3.1-pro"));
        assert_eq!(slug_of("* claude-opus (default)").as_deref(), Some("claude-opus"));
        assert_eq!(slug_of("Available models:"), None);
        assert_eq!(slug_of(""), None);
    }
}
