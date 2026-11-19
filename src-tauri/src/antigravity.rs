//! Antigravity (Google) as an engine of the chat: `agy -p` with
//! `--output-format stream-json`, one process per turn, the conversation kept
//! by its id (`--conversation`). Like Claude Code and opencode it has its own
//! tools (commands, files, web, its MCP servers): a command or an MCP tool
//! asks Consenti / Nega in the island through its hooks (hooks.rs, the relay
//! with `EASYISLAND_AGY_CHAT`), which are needed for that — without them
//! Antigravity's headless mode simply skips what it would have asked.
//! Installing and signing in are the user's (Impostazioni → Chat).
//!
//! As with Claude Code (13 Nov 2026): the chat's model goes as `--model` (the
//! conversation goes on with it), its effort as `--effort`, its mode as
//! `--mode` (accept-edits, plan; «Automatica» = auto, and then the relay does
//! not ask for commands: `EASYISLAND_AGY_AUTO`). In «Piano» Antigravity
//! writes `implementation_plan.md` in its brain folder and stops: the plan
//! is kept here (`take_plan`) for the chat's card with «Procedi».

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

/// The plan a turn in «Piano» wrote, per chat, until the island takes it.
static PLANS: std::sync::Mutex<Vec<(usize, String)>> = std::sync::Mutex::new(Vec::new());

/// The plan of the chat's last turn in «Piano», once.
pub fn take_plan(chat: &Chat) -> Option<String> {
    let key = chat as *const Chat as usize;
    let mut plans = PLANS.lock().unwrap();
    let i = plans.iter().position(|(k, _)| *k == key)?;
    Some(plans.remove(i).1)
}

/// The chat's mode for `--mode`: Claude Code's names to Antigravity's.
fn agy_mode(mode: Option<&str>, auto: bool) -> Option<&'static str> {
    if auto {
        return Some("auto");
    }
    match mode? {
        "acceptEdits" => Some("accept-edits"),
        "plan" => Some("plan"),
        _ => None,
    }
}

/// `implementation_plan.md` of the conversation, when this turn wrote it.
fn plan_written(conversation: &str, since: std::time::SystemTime) -> Option<String> {
    if conversation.is_empty() || !conversation.chars().all(|c| c.is_ascii_hexdigit() || c == '-') {
        return None;
    }
    let path = PathBuf::from(std::env::var_os("USERPROFILE")?)
        .join(".gemini").join("antigravity-cli").join("brain").join(conversation).join("implementation_plan.md");
    let meta = std::fs::metadata(&path).ok()?;
    if meta.modified().ok()? < since || meta.len() > 200_000 {
        return None;
    }
    let text = std::fs::read_to_string(&path).ok()?;
    let text = text.trim();
    (!text.is_empty()).then(|| text.to_string())
}

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
    /// The mode agy says it works in (`init` → `permission_mode`).
    mode: Option<String>,
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
            Some("init") => {
                self.mode = v.get("permission_mode").and_then(Value::as_str).map(String::from);
                false
            }
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
        "call_mcp_tool" => crate::steps::mcp(&get(&["ServerName", "serverName"]), &get(&["ToolName", "toolName"]), p.get("Arguments").or_else(|| p.get("arguments")).unwrap_or(&Value::Null)),
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
    auto: bool,
) -> Result<ChatReply, String> {
    let exe = find_exe().ok_or_else(|| t("Per la chat con Antigravity serve la sua CLI (agy) installata su questo PC e con il login fatto: Impostazioni → Chat e motori AI spiega come.").to_string())?;
    let session = chat.cli_session();
    let mut prompt = String::new();
    // A context comes with the first question or with a file added later.
    {
        for (part, _) in crate::claude::parts(context.as_ref()) {
            match &part {
                ChatContext::File { name, path } => {
                    prompt.push_str(&tf("File allegato: {name}\nPercorso: {path}\nLeggilo prima di rispondere.\n\n", &[("name", name), ("path", path)]));
                }
                ChatContext::Text { label, text } => {
                    let text: String = text.chars().take(MAX_CONTEXT).collect();
                    prompt.push_str(&format!("{label}:\n\n{text}\n\n"));
                }
                _ => {}
            }
        }
    }
    prompt.push_str(&query);

    let dir = folder.map(Path::to_path_buf)
        .or_else(|| std::env::var_os("USERPROFILE").map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."));
    let effort = effort_flag(model, chat.agy_effort().as_deref());
    match run(chat, &exe, model, &prompt, &dir, session.as_deref(), effort.as_deref(), on_text, telegram, auto).await {
        // agy refuses some model + effort pairs before starting (17 Nov 2026,
        // agy 1.5.9): once more without `--effort`, the model's own.
        Err(Failed::Selection(why)) if effort.is_some() => {
            crate::log::line(format!("chat: antigravity rifiuta --effort {} con {model}, riprovo senza: {why}", effort.as_deref().unwrap_or("")));
            match run(chat, &exe, model, &prompt, &dir, session.as_deref(), None, on_text, telegram, auto).await {
                Err(Failed::Selection(_)) => Err(selection_error(model)),
                Err(Failed::Other(e)) => Err(e),
                Ok(r) => Ok(r),
            }
        }
        Err(Failed::Selection(_)) => Err(selection_error(model)),
        Err(Failed::Other(e)) => Err(e),
        Ok(r) => Ok(r),
    }
}

/// Why a run failed: the model and effort refused before the turn started
/// (the conversation is still good), or anything else.
#[derive(Debug, PartialEq)]
enum Failed {
    Selection(String),
    Other(String),
}

impl From<String> for Failed {
    fn from(e: String) -> Self {
        Failed::Other(e)
    }
}

/// agy's words when the model or its effort is refused before the turn.
fn selection_refused(why: &str) -> bool {
    let low = why.to_lowercase();
    low.contains("invalid model selection") || low.contains("conflicts with --effort")
}

fn selection_error(model: &str) -> String {
    tf("Antigravity non accetta il modello «{model}» con questo impegno: cambia modello o impegno dal menu del motore (in alto nella chat).", &[("model", &model.trim())])
}

/// The `--effort` to send: none for the model's own (""), none when the
/// model's name already has one (`gemini-…-high`: agy refuses both).
fn effort_flag(model: &str, effort: Option<&str>) -> Option<String> {
    let e = effort.filter(|e| crate::claude::EFFORTS.contains(e))?;
    let in_name = model.trim().rsplit('-').next().is_some_and(|last| crate::claude::EFFORTS.contains(&last));
    (!in_name).then(|| e.to_string())
}

/// One run of agy for the turn.
#[allow(clippy::too_many_arguments)]
async fn run(
    chat: &Chat,
    exe: &Path,
    model: &str,
    prompt: &str,
    dir: &Path,
    session: Option<&str>,
    effort: Option<&str>,
    on_text: &(dyn Fn(&str) + Sync),
    telegram: bool,
    auto: bool,
) -> Result<ChatReply, Failed> {
    let mut cmd = command(exe);
    cmd.current_dir(dir).arg("--output-format").arg("stream-json");
    if !model.trim().is_empty() {
        cmd.arg("--model").arg(model.trim());
    }
    if let Some(id) = session {
        cmd.arg("--conversation").arg(id);
    }
    let mode = agy_mode(chat.mode().as_deref(), auto);
    if let Some(m) = mode {
        cmd.arg("--mode").arg(m);
    }
    if let Some(e) = effort {
        cmd.arg("--effort").arg(e);
    }
    // Permissions for this run only (`--settings`, never saved in ~/.gemini):
    // in `--print` agy cannot ask, it denies (17 Nov 2026, agy 1.5.9).
    let hooks = crate::hooks::status_for(crate::hooks::Target::Antigravity).installed;
    cmd.arg("--settings").arg(session_settings(hooks));
    let started = std::time::SystemTime::now();
    // The prompt attached to the flag, last: `-p <text>` would take a text
    // starting with "-" for an option, and agy stops at the first argument.
    cmd.arg(format!("--print={prompt}"));
    // Its hooks know this turn is the chat's: permissions as the chat's, no session.
    cmd.env("EASYISLAND_AGY_CHAT", "1");
    // «Automatica»: the island lets through what is not delicate
    // (permits::agy_auto); «Accetta modifiche»: the file edits.
    if mode == Some("auto") {
        cmd.env("EASYISLAND_AGY_AUTO", "1");
    }
    if mode == Some("accept-edits") {
        cmd.env("EASYISLAND_AGY_EDITS", "1");
    }
    if telegram {
        cmd.env("EASYISLAND_CHANNEL", "telegram");
    }
    if chat.channel() == "agentchat" {
        cmd.env("EASYISLAND_CHANNEL", "agentchat");
    }
    let mut child = cmd.spawn().map_err(|e| tf("Antigravity non si avvia: {e}", &[("e", &e)]))?;
    let stdout = child.stdout.take().ok_or(t("Antigravity si è interrotto.").to_string())?;
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
                return Err(Failed::Other(t("Antigravity non ha finito entro 30 minuti: interrotto.").into()));
            }
            Ok(Err(e)) => return Err(Failed::Other(tf("Antigravity si è interrotto: {e}", &[("e", &e)]))),
            Ok(Ok(None)) => break,
            Ok(Ok(Some(line))) => {
                let known = progress.conversation.clone();
                let changed = progress.feed(&line);
                // Kept at once: a turn stopped before its end is resumed by the next message.
                if progress.conversation != known {
                    chat.set_cli_session(progress.conversation.clone());
                }
                if changed && emitted.elapsed() >= STREAM_EVERY {
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
        let why = result.get("error").and_then(Value::as_str).map(String::from)
            .unwrap_or_else(|| stderr.trim().chars().take(300).collect());
        // Refused before the turn: the conversation goes on (the caller retries or explains).
        if selection_refused(&why) {
            return Err(Failed::Selection(why));
        }
        chat.set_cli_session(None);
        let low = why.to_lowercase();
        if low.contains("sign in") || low.contains("login") || low.contains("auth") {
            return Err(Failed::Other(t("Antigravity non ha il login: apri un terminale, scrivi «agy» e accedi con il tuo account Google, poi riprova.").into()));
        }
        return Err(Failed::Other(if why.is_empty() { t("Antigravity ha restituito un errore.").to_string() } else { format!("Antigravity: {why}") }));
    }
    if let Some(id) = result.get("conversation_id").and_then(Value::as_str).map(String::from).or(progress.conversation) {
        if mode == Some("plan") {
            if let Some(plan) = plan_written(&id, started) {
                let key = chat as *const Chat as usize;
                let mut plans = PLANS.lock().unwrap();
                plans.retain(|(k, _)| *k != key);
                plans.push((key, plan));
            }
        }
        chat.set_cli_session(Some(id));
    }
    // Its tokens, for «Consumo» (engine_usage.rs): only the answers given here.
    if let Some(u) = result.get("usage") {
        let n = |k: &str| u.get(k).and_then(Value::as_u64).unwrap_or(0);
        crate::engine_usage::record("antigravity", model, n("input_tokens"), n("output_tokens") + n("thinking_tokens"), None, false);
    }
    let mut final_text = result.get("response").and_then(Value::as_str).unwrap_or("").to_string();
    // What agy skipped because it could not ask (no hooks), or what the island denied.
    let denied = result.get("denied_actions").and_then(Value::as_array).map(Vec::len).unwrap_or(0);
    let stopped = progress.answer.trim().is_empty() && final_text.trim().is_empty() && progress.shown.contains(" — negato");
    // One notice only (17 Nov 2026): without hooks, «Automatica» once per
    // conversation, else what was skipped; with hooks, a step denied that
    // stopped the turn.
    if let Some(n) = notice(hooks, auto_not_taken(mode, progress.mode.as_deref()), denied, stopped, || chat.first_auto_notice()) {
        final_text.push_str(&format!("\n\n> {n}"));
    }
    // The steps stay above the answer, as they were shown.
    let text = if progress.shown.trim().is_empty() { final_text } else if progress.answer.trim().is_empty() && !final_text.is_empty() {
        format!("{}{final_text}", progress.shown)
    } else {
        progress.shown
    };
    if text.trim().is_empty() {
        return Err(Failed::Other(t("Nessun testo nella risposta.").into()));
    }
    Ok(ChatReply { text })
}

/// agy's settings for one run (`--settings`, «never saved»). EasyIsland's
/// tools always (they guard themselves: agent.rs, Consenti / Nega for what
/// sends, deletes or runs elsewhere); `mcp(easyisland)` without `/*` does not
/// match. With its hooks, `always-proceed`: every tool then asks the island
/// first (easyisland-hook, `antigravity_asks`) and a «Nega» or no answer stops
/// it (tried with agy 1.5.9: a PreToolUse `deny` blocks in `always-proceed`).
/// Without hooks agy's own `request-review`: what it would ask is skipped.
fn session_settings(hooks: bool) -> String {
    let allow = serde_json::json!({ "allow": ["mcp(easyisland/*)"] });
    let s = if hooks {
        serde_json::json!({ "toolPermission": "always-proceed", "permissions": allow })
    } else {
        serde_json::json!({ "permissions": allow })
    };
    s.to_string()
}

/// The line under the answer when something was not done, if any.
fn notice(hooks: bool, auto_ignored: bool, denied: usize, stopped: bool, first_auto: impl FnOnce() -> bool) -> Option<String> {
    if !hooks {
        if auto_ignored && first_auto() {
            return Some(t("«Automatica» con Antigravity funziona solo con i suoi hook: senza, salta i comandi fuori dalla sua lista sicura e le modifiche ai file (qui non può chiederti il permesso). Installali in Impostazioni → Agenti di codice → Antigravity: ogni azione chiede Consenti / Nega nell'isola, e in «Automatica» passano da sole quelle non delicate.").into());
        }
        if denied > 0 || stopped {
            return Some(t("Antigravity ha saltato delle azioni perché qui non può chiederti il permesso (comandi fuori dalla sua lista sicura, modifiche ai file). Installa i suoi hook in Impostazioni → Agenti di codice → Antigravity: ogni azione chiederà Consenti / Nega nell'isola.").into());
        }
        return None;
    }
    stopped.then(|| t("Un'azione di Antigravity è stata negata (da te, o senza risposta in tempo) e si è fermato lì. Riprova e consentila, o chiedigli un'altra strada.").into())
}

/// «Automatica» was asked (`--mode auto`) and agy said it works otherwise.
fn auto_not_taken(asked: Option<&str>, taken: Option<&str>) -> bool {
    asked == Some("auto") && taken.is_some_and(|m| m != "auto")
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
    fn the_chats_mode_in_antigravitys_words() {
        assert_eq!(agy_mode(None, false), None);
        assert_eq!(agy_mode(Some("acceptEdits"), false), Some("accept-edits"));
        assert_eq!(agy_mode(Some("plan"), false), Some("plan"));
        assert_eq!(agy_mode(Some("plan"), true), Some("auto"));
        assert_eq!(agy_mode(Some("bypassPermissions"), false), None);
        assert_eq!(plan_written("../x", std::time::SystemTime::UNIX_EPOCH), None);
    }

    #[test]
    fn no_effort_with_a_model_that_has_one() {
        assert_eq!(effort_flag("gemini-4-hydrogen-high", Some("medium")), None);
        assert_eq!(effort_flag("gemini-4-argon-xhigh", Some("low")), None);
        assert_eq!(effort_flag("gemini-3.1-pro", Some("medium")).as_deref(), Some("medium"));
        assert_eq!(effort_flag("", Some("high")).as_deref(), Some("high"));
        // «Predefinito del modello», or a word agy would not know: no flag.
        assert_eq!(effort_flag("gemini-3.1-pro", Some("")), None);
        assert_eq!(effort_flag("gemini-3.1-pro", None), None);
        assert_eq!(effort_flag("gemini-3.1-pro", Some("turbo")), None);
    }

    #[test]
    fn a_refused_selection_is_tried_again_without_effort() {
        // agy 1.5.9 on the laptop, 17 Nov 2026.
        assert!(selection_refused("invalid model selection (--model \"gemini-4-hydrogen-high\" --effort \"medium\"): --model gemini-4-hydrogen-high conflicts with --effort=medium"));
        assert!(!selection_refused("You are not logged into Antigravity."));
        assert!(!selection_refused(""));
        let mut p = Progress::default();
        p.feed(r#"{"event":"init","init":{"permission_mode":"request-review"}}"#);
        assert!(auto_not_taken(Some("auto"), p.mode.as_deref()));
        assert!(!auto_not_taken(Some("auto"), Some("auto")));
        assert!(!auto_not_taken(None, p.mode.as_deref()));
        assert!(!auto_not_taken(Some("auto"), None));
    }

    #[test]
    fn permissions_for_one_run() {
        let with: Value = serde_json::from_str(&session_settings(true)).unwrap();
        assert_eq!(with["toolPermission"], "always-proceed");
        assert_eq!(with["permissions"]["allow"][0], "mcp(easyisland/*)");
        let without: Value = serde_json::from_str(&session_settings(false)).unwrap();
        assert!(without.get("toolPermission").is_none());
        assert_eq!(without["permissions"]["allow"][0], "mcp(easyisland/*)");
    }

    #[test]
    fn one_notice_when_something_was_not_done() {
        // Without hooks: «Automatica» once, then what was skipped; nothing done right, nothing said.
        assert!(notice(false, true, 1, true, || true).unwrap().contains("«Automatica»"));
        assert!(notice(false, true, 1, true, || false).unwrap().contains("saltato"));
        assert!(notice(false, false, 0, false, || true).is_none());
        // With hooks: only a denied step that ended the turn, never «install the hooks».
        assert!(notice(true, true, 0, false, || true).is_none());
        let n = notice(true, false, 0, true, || true).unwrap();
        assert!(n.contains("negata") && !n.contains("Agenti di codice"));
    }

    #[test]
    fn the_automatica_notice_once_per_conversation() {
        let (a, b) = (Chat::default(), Chat::default());
        assert!(a.first_auto_notice());
        assert!(!a.first_auto_notice());
        assert!(b.first_auto_notice());
    }

    #[test]
    fn model_slugs_from_its_list() {
        assert_eq!(slug_of("gemini-3.1-pro   Gemini 3.1 Pro").as_deref(), Some("gemini-3.1-pro"));
        assert_eq!(slug_of("* claude-opus (default)").as_deref(), Some("claude-opus"));
        assert_eq!(slug_of("Available models:"), None);
        assert_eq!(slug_of(""), None);
    }
}
