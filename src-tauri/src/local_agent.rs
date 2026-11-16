// Internal Terminal mode loop for «Modello sul PC», and since the same day for
// OpenRouter, Ollama and LM Studio too (`ENGINES`) (Edoardo, 15 Nov 2026):
// instead of routing llama-server through opencode (~11,000 tokens of system
// instructions and tool schemas), EasyIsland drives the OpenAI chat-completions
// tool loop directly with concise instructions and a focused tool set (<2,500
// tokens).
//
// Capabilities: PowerShell command execution, file reading/listing/search/edits,
// and selected EasyIsland tools (memory_search plus hints from toolhint.rs).
// Permissions follow the island/Telegram Ask/Allow/Deny rules via pipe/telegram.
// Limits: at most 25 steps per turn, 20,000 characters per output, 200 KB read
// cap, 600 s max command timeout, no web access.

use std::collections::HashSet;
use std::future::Future;
use std::io::{BufRead, BufReader, Read};
use std::path::{Component, Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::AppHandle;

use crate::claude::{Chat, ChatContext, ChatReply, TurnUsage};
use crate::i18n::{t, tf};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

const MAX_STEPS: usize = 25;
const HTTP_TIMEOUT: Duration = Duration::from_secs(240);
const MAX_OUTPUT_CHARS: usize = 20_000;
const OVERFLOW_TOOL_CHARS: usize = 1_500;
const MAX_READ_BYTES: usize = 200 * 1024;
const DEFAULT_READ_LIMIT: usize = 400;
const MAX_READ_LIMIT: usize = 2_000;
const MAX_LIST_ENTRIES: usize = 500;
const MAX_SEARCH_HITS: usize = 200;
const MAX_SEARCH_FILE_BYTES: u64 = 1_048_576;
const DEFAULT_CMD_TIMEOUT_S: u64 = 120;
const MAX_CMD_TIMEOUT_S: u64 = 600;
const SKIP_DIRS: &[&str] = &[".git", "node_modules", "target", "dist"];

/// Exact command or file approvals remembered via «Sempre» for one open
/// conversation (`chat as *const Chat as usize`), cleared when it closes.
static ALWAYS: Mutex<Vec<(usize, String)>> = Mutex::new(Vec::new());

/// Clears per-conversation «Sempre» approvals when a conversation closes or resets.
pub fn forget(chat: usize) {
    ALWAYS.lock().unwrap().retain(|(c, _)| *c != chat);
}

fn has_always(chat: usize, key: &str) -> bool {
    chat != 0 && ALWAYS.lock().unwrap().iter().any(|(c, k)| *c == chat && k == key)
}

fn remember_always(chat: usize, key: String) {
    if chat == 0 {
        return;
    }
    let mut guard = ALWAYS.lock().unwrap();
    if !guard.iter().any(|(c, k)| *c == chat && *k == key) {
        guard.push((chat, key));
    }
}

/// Drops a pending island permission card when the turn is stopped mid-wait.
struct ReleaseOnDrop<'a> {
    app: &'a AppHandle,
    id: Option<String>,
}

impl Drop for ReleaseOnDrop<'_> {
    fn drop(&mut self) {
        if let Some(id) = self.id.take() {
            crate::pipe::release(self.app, &id);
        }
    }
}

/// Permission outcome for one model tool call.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Decision {
    Run,
    Ask,
    Refuse(String),
}

/// The engines whose Modalità terminale is this loop, not opencode: the model
/// on this PC, and the OpenAI-compatible services that take tools (Edoardo,
/// 15 Nov 2026: «anche openrouter ollama lm studio dovrebbero utilizzare
/// quello interno»). OpenAI, Gemini and the Claude API key stay on opencode.
pub const ENGINES: &[&str] = &["local", "openrouter", "ollama", "lmstudio"];

/// Runs one Modalità terminale turn for one of `ENGINES` without opencode.
#[allow(clippy::too_many_arguments)]
pub async fn send(
    app: &AppHandle,
    chat: &Chat,
    engine: &str,
    url: Option<&str>,
    model: &str,
    folder: &Path,
    query: String,
    context: Option<ChatContext>,
    auto: bool,
    telegram: bool,
    on_text: &(dyn Fn(&str) + Sync),
) -> Result<ChatReply, String> {
    // Where the model is: our llama-server (its lease keeps it on for the
    // turn), or the service's address with its key from the Credential Manager.
    let provider = crate::openai::provider(engine).ok_or(t("Motore della chat sconosciuto."))?;
    let name = provider.name.to_string();
    let (lease, base, key, wire_model) = if engine == "local" {
        let l = crate::local_model::ensure(model, crate::local_model::TERMINAL_CONTEXT).await?;
        let (b, k) = (l.base.clone(), l.key.clone());
        (Some(l), b, k, "easyisland".to_string())
    } else {
        if model.trim().is_empty() {
            return Err(tf("Scegli un modello di {name} nelle impostazioni (Chat).", &[("name", &name)]));
        }
        let base = crate::openai::base_url(engine, url)?;
        let key = match provider.key {
            Some(k) => crate::secrets::get(k).ok_or_else(|| tf("Manca la chiave di {name}. Apri le impostazioni.", &[("name", &name)]))?,
            None => String::new(),
        };
        (None, base, key, model.trim().to_string())
    };
    let chat_ptr = chat as *const Chat as usize;
    let engine_owned = engine.to_string();

    let result = run_loop(
        &base,
        &key,
        engine,
        &name,
        model,
        &wire_model,
        chat,
        folder,
        query,
        context,
        auto,
        true,
        on_text,
        move |mut payload: Value, exact_key| {
            let app = app.clone();
            payload["easyisland_engine"] = json!(engine_owned.clone());
            async move {
                if has_always(chat_ptr, &exact_key) {
                    return Some("allow".to_string());
                }
                let decision = if telegram {
                    crate::telegram::request_decision(&app, payload).await
                } else {
                    let req_id = crate::pipe::new_request_id();
                    let mut guard = ReleaseOnDrop { app: &app, id: Some(req_id.clone()) };
                    let res = crate::pipe::request_decision_id(&app, &req_id, payload).await;
                    guard.id = None;
                    res
                };
                if decision.as_deref() == Some("always") {
                    remember_always(chat_ptr, exact_key);
                }
                decision
            }
        },
        |name, args| {
            let app = app.clone();
            async move {
                let v = crate::agent::call(&app, &name, &args).await;
                v.get("text").and_then(Value::as_str).unwrap_or_default().to_string()
            }
        },
    )
    .await;

    drop(lease);
    result
}

/// Core multi-step tool loop, separated from AppHandle/llama-server startup so tests
/// can exercise it against a local mock HTTP server.
#[allow(clippy::too_many_arguments)]
async fn run_loop<FAsk, FutAsk, FEasy, FutEasy>(
    base: &str,
    key: &str,
    engine: &str,
    name: &str,
    model: &str,
    wire_model: &str,
    chat: &Chat,
    folder: &Path,
    query: String,
    context: Option<ChatContext>,
    auto: bool,
    notify_ui: bool,
    on_text: &(dyn Fn(&str) + Sync),
    ask: FAsk,
    call_easyisland: FEasy,
) -> Result<ChatReply, String>
where
    FAsk: Fn(Value, String) -> FutAsk,
    FutAsk: Future<Output = Option<String>>,
    FEasy: Fn(String, Value) -> FutEasy,
    FutEasy: Future<Output = String>,
{
    let client = reqwest::Client::builder()
        .timeout(HTTP_TIMEOUT)
        .connect_timeout(Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())?;

    let tools = tool_definitions(&query);
    let system = crate::i18n::prompt(&system_prompt(folder));
    let first = chat.is_empty();
    let user_msg = crate::openai::user_message(first, &query, context.as_ref());

    let mut messages = vec![json!({ "role": "system", "content": system })];
    messages.extend(chat.snapshot());
    messages.push(user_msg.clone());

    let mode = chat.mode().unwrap_or_default();
    let read_only_chat = chat.read_only();
    let chat_ptr = chat as *const Chat as usize;

    let mut steps_shown: Vec<String> = Vec::new();
    let mut usage_steps: u64 = 0;
    let mut total_read: u64 = 0;
    let mut total_out: u64 = 0;
    let mut peak: u64 = 0;
    let mut tool_counts: Vec<(String, u32)> = Vec::new();

    for _round in 0..MAX_STEPS {
        let v = post_completion(&client, base, key, name, &mut messages, &tools, wire_model).await?;
        usage_steps += 1;

        let sent_chars: usize = messages.iter().map(|m| m.to_string().len()).sum();
        let prompt_tok = v
            .pointer("/usage/prompt_tokens")
            .and_then(Value::as_u64)
            .or_else(|| v.pointer("/timings/prompt_n").and_then(Value::as_u64));
        let comp_tok = v
            .pointer("/usage/completion_tokens")
            .and_then(Value::as_u64)
            .or_else(|| v.pointer("/timings/predicted_n").and_then(Value::as_u64));
        let content_len = v
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .map_or(0, str::len);
        let (in_tok, out_tok, estimated) = match (prompt_tok, comp_tok) {
            (Some(i), Some(o)) => (i, o, false),
            _ => (
                crate::engine_usage::estimate(sent_chars),
                crate::engine_usage::estimate(content_len),
                true,
            ),
        };
        crate::engine_usage::record(engine, model, in_tok, out_tok, None, estimated);
        total_read += in_tok;
        total_out += out_tok;
        peak = peak.max(in_tok);

        let Some(msg) = v.pointer("/choices/0/message") else {
            return Err(tf("Risposta inattesa da {p}.", &[("p", &name)]));
        };
        let tool_calls = msg.get("tool_calls").and_then(Value::as_array).filter(|a| !a.is_empty());

        let Some(calls) = tool_calls else {
            let raw = msg.get("content").and_then(Value::as_str).unwrap_or("");
            let answer = crate::local_model::without_thinking(raw);
            if answer.is_empty() {
                return Err(t("Nessun testo nella risposta.").into());
            }
            let reply_text = format_reply(&steps_shown, &answer);
            on_text(&reply_text);
            chat.push(user_msg);
            chat.push(json!({ "role": "assistant", "content": answer }));
            chat.set_usage(Some(TurnUsage {
                steps: usage_steps,
                read: total_read,
                out: total_out,
                peak,
                tools: tool_counts,
                light: None,
            }));
            return Ok(ChatReply { text: reply_text });
        };

        messages.push(msg.clone());

        for call in calls {
            let call_id = call.get("id").and_then(Value::as_str).unwrap_or("");
            let func = call.get("function").unwrap_or(&Value::Null);
            let name = func.get("name").and_then(Value::as_str).unwrap_or("");

            if let Some(entry) = tool_counts.iter_mut().find(|(n, _)| n == name) {
                entry.1 += 1;
            } else if !name.is_empty() {
                tool_counts.push((name.to_string(), 1));
            }

            let args = match parse_tool_args(func) {
                Ok(a) => a,
                Err(err) => {
                    messages.push(json!({
                        "role": "tool",
                        "tool_call_id": call_id,
                        "content": err,
                    }));
                    continue;
                }
            };

            steps_shown.push(step_line_for(name, &args));
            on_text(&steps_shown.join("\n\n"));

            let output = execute_tool_call(
                name,
                &args,
                folder,
                auto,
                &mode,
                read_only_chat,
                chat_ptr,
                notify_ui,
                &ask,
                &call_easyisland,
            )
            .await;

            messages.push(json!({
                "role": "tool",
                "tool_call_id": call_id,
                "content": output,
            }));
        }
    }

    let stop_msg = t("Mi fermo: troppi passi per questa domanda. Riprova con una richiesta più precisa.");
    let reply_text = format_reply(&steps_shown, stop_msg);
    on_text(&reply_text);
    chat.push(user_msg);
    chat.push(json!({ "role": "assistant", "content": stop_msg }));
    chat.set_usage(Some(TurnUsage {
        steps: usage_steps,
        read: total_read,
        out: total_out,
        peak,
        tools: tool_counts,
        light: None,
    }));
    Ok(ChatReply { text: reply_text })
}

fn format_reply(steps: &[String], answer: &str) -> String {
    if steps.is_empty() {
        answer.to_string()
    } else {
        format!("{}\n\n{answer}", steps.join("\n\n"))
    }
}

async fn post_completion(
    client: &reqwest::Client,
    base: &str,
    key: &str,
    name: &str,
    messages: &mut Vec<Value>,
    tools: &[Value],
    model: &str,
) -> Result<Value, String> {
    let mut retried = false;
    loop {
        let body = json!({
            "model": model,
            "messages": messages,
            "tools": tools,
            "tool_choice": "auto",
            "stream": false,
            "temperature": 0.3,
            "max_tokens": 2048,
        });
        let mut req = client.post(format!("{base}/chat/completions")).json(&body);
        if !key.is_empty() {
            req = req.bearer_auth(key);
        }
        let resp = req.send().await.map_err(|e| {
            if e.is_timeout() {
                tf("{p} non ha risposto in tempo.", &[("p", &name)])
            } else {
                tf("Errore di rete con {p}: {err}", &[("p", &name), ("err", &e)])
            }
        })?;
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        if status.is_success() {
            return serde_json::from_str(&text)
                .map_err(|e| tf("Risposta non valida da {p}: {err}", &[("p", &name), ("err", &e)]));
        }
        let why = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| v.pointer("/error/message").and_then(Value::as_str).map(str::to_string))
            .unwrap_or_else(|| text.chars().take(200).collect());

        if status == reqwest::StatusCode::BAD_REQUEST && !retried && shorten_older_tool_results(messages) {
            retried = true;
            crate::log::line(format!("terminale interno ({name}): contesto pieno, accorcio i risultati più vecchi e riprovo"));
            continue;
        }
        if status == reqwest::StatusCode::BAD_REQUEST {
            return Err(tf(
                "Il contesto di {p} è pieno (HTTP 400: {why}).",
                &[("p", &name), ("why", &why)],
            ));
        }
        return Err(format!("HTTP {status}: {why}"));
    }
}

/// Shortens tool result contents older than the latest tool round to
/// `OVERFLOW_TOOL_CHARS` chars; if none exceeded that limit, trims any oversized
/// tool result in the turn so a single huge output can recover too.
fn shorten_older_tool_results(messages: &mut [Value]) -> bool {
    let last_non_tool = messages
        .iter()
        .rposition(|m| m.get("role").and_then(Value::as_str) != Some("tool"))
        .unwrap_or(messages.len());
    let mut changed = false;
    for msg in messages.get_mut(..last_non_tool).unwrap_or_default() {
        if msg.get("role").and_then(Value::as_str) == Some("tool") {
            if trim_tool_message(msg, OVERFLOW_TOOL_CHARS) {
                changed = true;
            }
        }
    }
    if changed {
        return true;
    }
    for msg in messages.iter_mut() {
        if msg.get("role").and_then(Value::as_str) == Some("tool") {
            if trim_tool_message(msg, OVERFLOW_TOOL_CHARS) {
                changed = true;
            }
        }
    }
    changed
}

fn trim_tool_message(msg: &mut Value, max_chars: usize) -> bool {
    let Some(s) = msg.get("content").and_then(Value::as_str) else {
        return false;
    };
    if s.chars().count() <= max_chars {
        return false;
    }
    let shortened = trim_output(s, max_chars);
    if let Some(obj) = msg.as_object_mut() {
        obj.insert("content".to_string(), Value::String(shortened));
        return true;
    }
    false
}

fn system_prompt(folder: &Path) -> String {
    format!(
        "You are the assistant in the chat of the EasyIsland desktop app on Windows. \
Respond in Italian if the user writes in Italian. \
You work in folder {}; shell commands run in PowerShell. \
Use tools when needed; read files before editing; run tests after editing code if present. \
Commands, external paths or edits may ask the user for permission: if denied, do not retry and tell the user. \
No web access: say so if needed.",
        folder.display()
    )
}

fn tool_definitions(query: &str) -> Vec<Value> {
    let mut out = vec![
        json!({
            "type": "function",
            "function": {
                "name": "run_command",
                "description": "Run a PowerShell command in the working folder.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "command": { "type": "string" },
                        "timeout_s": { "type": "integer" }
                    },
                    "required": ["command"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "read_file",
                "description": "Read a text file with line numbers.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" },
                        "offset": { "type": "integer" },
                        "limit": { "type": "integer" }
                    },
                    "required": ["path"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "list_dir",
                "description": "List files and directories in a folder.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" }
                    }
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "search_text",
                "description": "Case-insensitive substring search in text files.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "text": { "type": "string" },
                        "path": { "type": "string" },
                        "ext": { "type": "string" }
                    },
                    "required": ["text"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "write_file",
                "description": "Create or overwrite a file.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" },
                        "content": { "type": "string" }
                    },
                    "required": ["path", "content"]
                }
            }
        }),
        json!({
            "type": "function",
            "function": {
                "name": "edit_file",
                "description": "Replace one exact occurrence of old_text with new_text in a file.",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "path": { "type": "string" },
                        "old_text": { "type": "string" },
                        "new_text": { "type": "string" }
                    },
                    "required": ["path", "old_text", "new_text"]
                }
            }
        }),
    ];

    let mut wanted: Vec<&str> = vec!["memory_search"];
    for name in crate::toolhint::tools_for(query) {
        if name != "show_card" && !wanted.contains(&name) {
            wanted.push(name);
        }
    }
    let all = crate::claude::tool_list::tools();
    for name in wanted {
        if let Some((_, desc, schema, _)) = all.iter().find(|t| t.0 == name) {
            out.push(json!({
                "type": "function",
                "function": {
                    "name": name,
                    "description": desc,
                    "parameters": schema,
                }
            }));
        }
    }
    out
}

fn step_line_for(name: &str, args: &Value) -> String {
    match name {
        "run_command" => crate::opencode::step_line("bash", args),
        "read_file" => crate::opencode::step_line(
            "read",
            &json!({ "path": args.get("path").cloned().unwrap_or(Value::Null) }),
        ),
        "write_file" => crate::opencode::step_line(
            "write",
            &json!({ "path": args.get("path").cloned().unwrap_or(Value::Null) }),
        ),
        "edit_file" => crate::opencode::step_line(
            "edit",
            &json!({ "path": args.get("path").cloned().unwrap_or(Value::Null) }),
        ),
        "search_text" => crate::opencode::step_line(
            "grep",
            &json!({ "pattern": args.get("text").cloned().unwrap_or(Value::Null) }),
        ),
        "list_dir" => crate::opencode::step_line(
            "glob",
            &json!({ "path": args.get("path").cloned().unwrap_or_else(|| json!(".")) }),
        ),
        other => crate::opencode::step_line(&format!("easyisland_{other}"), args),
    }
}

/// Parses `function.arguments` from an OpenAI `tool_calls` entry.
fn parse_tool_args(func: &Value) -> Result<Value, String> {
    match func.get("arguments") {
        None | Some(Value::Null) => Ok(json!({})),
        Some(Value::String(s)) if s.trim().is_empty() => Ok(json!({})),
        Some(Value::String(s)) => match serde_json::from_str::<Value>(s) {
            Ok(v) if v.is_object() => Ok(v),
            _ => Err(t("Argomenti non validi: JSON atteso.").to_string()),
        },
        Some(v) if v.is_object() => Ok(v.clone()),
        Some(_) => Err(t("Argomenti non validi: JSON atteso.").to_string()),
    }
}

/// Normalizes `.` and `..` lexically without requiring the path to exist on disk.
fn normalize_path(path: &Path) -> PathBuf {
    let mut stack: Vec<Component<'_>> = Vec::new();
    for comp in path.components() {
        match comp {
            Component::CurDir => {}
            Component::ParentDir => match stack.last() {
                Some(Component::Normal(_)) => {
                    stack.pop();
                }
                Some(Component::RootDir) | Some(Component::Prefix(_)) => {}
                None | Some(Component::ParentDir) => stack.push(comp),
                Some(Component::CurDir) => {}
            },
            c => stack.push(c),
        }
    }
    stack.into_iter().collect()
}

fn resolve_path(folder: &Path, raw: &str) -> PathBuf {
    let raw = raw.trim();
    if raw.is_empty() {
        return normalize_path(folder);
    }
    let expanded = if raw == "~" {
        std::env::var_os("USERPROFILE").map(PathBuf::from)
    } else if let Some(rest) = raw.strip_prefix("~/").or_else(|| raw.strip_prefix("~\\")) {
        std::env::var_os("USERPROFILE").map(|h| PathBuf::from(h).join(rest))
    } else {
        None
    };
    let joined = match expanded {
        Some(p) => p,
        None => {
            let p = Path::new(raw);
            if p.is_absolute() {
                p.to_path_buf()
            } else {
                folder.join(p)
            }
        }
    };
    normalize_path(&joined)
}

fn component_eq(a: &Component<'_>, b: &Component<'_>) -> bool {
    #[cfg(windows)]
    {
        a.as_os_str()
            .to_string_lossy()
            .eq_ignore_ascii_case(&b.as_os_str().to_string_lossy())
    }
    #[cfg(not(windows))]
    {
        a == b
    }
}

fn inside_folder(folder: &Path, candidate: &Path) -> bool {
    let base = normalize_path(folder);
    let target = normalize_path(candidate);
    let b_comps: Vec<Component<'_>> = base.components().collect();
    let t_comps: Vec<Component<'_>> = target.components().collect();
    if b_comps.is_empty() || t_comps.len() < b_comps.len() {
        return false;
    }
    b_comps.iter().zip(t_comps.iter()).all(|(a, b)| component_eq(a, b))
}

/// The path with links and junctions followed (without Windows' `\\?\`);
/// as it is when it does not exist yet or cannot be read.
fn real_path(path: &Path) -> PathBuf {
    match std::fs::canonicalize(path) {
        Ok(p) => {
            let s = p.to_string_lossy();
            match s.strip_prefix(r"\\?\UNC\") {
                Some(rest) => PathBuf::from(format!(r"\\{rest}")),
                None => s.strip_prefix(r"\\?\").map(PathBuf::from).unwrap_or_else(|| p.clone()),
            }
        }
        Err(_) => path.to_path_buf(),
    }
}

fn is_secret_path(path: &Path) -> bool {
    crate::opencode::secret_place(&path.to_string_lossy())
}

fn path_key(path: &Path) -> String {
    let s = path.to_string_lossy().to_string();
    #[cfg(windows)]
    {
        s.to_ascii_lowercase()
    }
    #[cfg(not(windows))]
    {
        s
    }
}

/// Decides whether `tool` can run directly, needs a permission card, or is refused.
fn needs_ask(
    tool: &str,
    input: &Value,
    folder: &Path,
    auto: bool,
    mode: &str,
    read_only_chat: bool,
) -> Decision {
    match tool {
        "read_file" | "list_dir" | "search_text" => {
            let raw = input.get("path").and_then(Value::as_str).unwrap_or("");
            let resolved = resolve_path(folder, raw);
            // Where it really is: a link or junction inside the folder may
            // lead to .ssh or another drive (review of 16 Nov 2026).
            let real = real_path(&resolved);
            let safe = inside_folder(folder, &resolved)
                && inside_folder(&real_path(folder), &real)
                && !is_secret_path(&resolved)
                && !is_secret_path(&real);
            if safe {
                Decision::Run
            } else if read_only_chat {
                Decision::Refuse(t("Modalità in sola lettura: posso solo leggere nella cartella.").to_string())
            } else {
                Decision::Ask
            }
        }
        "write_file" | "edit_file" => {
            if read_only_chat {
                return Decision::Refuse(t("Modalità in sola lettura: non posso modificare i file.").to_string());
            }
            if mode == "plan" {
                return Decision::Refuse(t("In Piano non modifico: scrivo solo il piano.").to_string());
            }
            let raw = input.get("path").and_then(Value::as_str).unwrap_or("");
            let resolved = resolve_path(folder, raw);
            if !raw.trim().is_empty()
                && inside_folder(folder, &resolved)
                && !is_secret_path(&resolved)
                && (auto || mode == "acceptEdits")
            {
                Decision::Run
            } else {
                Decision::Ask
            }
        }
        "run_command" => {
            let cmd = input.get("command").and_then(Value::as_str).unwrap_or("");
            let ro = crate::opencode::read_only(cmd) && !crate::opencode::secret_place(cmd);
            if read_only_chat {
                if ro {
                    Decision::Run
                } else {
                    Decision::Refuse(t("Modalità in sola lettura: non posso eseguire questo comando.").to_string())
                }
            } else if mode == "plan" {
                if ro {
                    Decision::Run
                } else {
                    Decision::Refuse(t("In Piano non eseguo questo comando: scrivo solo il piano.").to_string())
                }
            } else if ro {
                Decision::Run
            } else if auto && !crate::opencode::delicate(cmd) && !crate::opencode::secret_place(cmd) {
                Decision::Run
            } else {
                Decision::Ask
            }
        }
        "show_card" => Decision::Refuse(t("Questo strumento non è disponibile qui.").to_string()),
        other => {
            let known = crate::claude::tool_list::tools().iter().any(|t| t.0 == other);
            if !known {
                return Decision::Refuse(tf("Strumento sconosciuto: {name}", &[("name", &other)]));
            }
            let ro = crate::claude_cli::agent_read_only().contains(&other);
            if read_only_chat {
                if ro {
                    Decision::Run
                } else {
                    Decision::Refuse(t("Modalità in sola lettura: strumento non consentito.").to_string())
                }
            } else if mode == "plan" {
                if ro {
                    Decision::Run
                } else {
                    Decision::Refuse(t("In Piano non eseguo questa azione: scrivo solo il piano.").to_string())
                }
            } else if ro {
                Decision::Run
            } else {
                Decision::Ask
            }
        }
    }
}

fn permission_payload_for(tool: &str, args: &Value, folder: &Path) -> (Value, String) {
    let (tool_name, tool_input, exact_key) = match tool {
        "run_command" => {
            let cmd = args.get("command").and_then(Value::as_str).unwrap_or("");
            ("Bash".to_string(), json!({ "command": cmd }), format!("Bash:{}", cmd.trim()))
        }
        "edit_file" => {
            let resolved = resolve_path(folder, args.get("path").and_then(Value::as_str).unwrap_or(""));
            let p = resolved.to_string_lossy().to_string();
            let old = args.get("old_text").and_then(Value::as_str).unwrap_or("");
            let new = args.get("new_text").and_then(Value::as_str).unwrap_or("");
            (
                "Edit".to_string(),
                json!({ "file_path": p, "old_string": old, "new_string": new }),
                format!("Write:{}", path_key(&resolved)),
            )
        }
        "write_file" => {
            let resolved = resolve_path(folder, args.get("path").and_then(Value::as_str).unwrap_or(""));
            let p = resolved.to_string_lossy().to_string();
            let content = args.get("content").and_then(Value::as_str).unwrap_or("");
            (
                "Write".to_string(),
                json!({ "file_path": p, "content": content }),
                format!("Write:{}", path_key(&resolved)),
            )
        }
        "read_file" | "list_dir" | "search_text" => {
            let resolved = resolve_path(folder, args.get("path").and_then(Value::as_str).unwrap_or(""));
            let p = resolved.to_string_lossy().to_string();
            ("Read".to_string(), json!({ "file_path": p }), format!("Read:{}", path_key(&resolved)))
        }
        other => (
            format!("mcp__easyisland__{other}"),
            args.clone(),
            format!("Tool:{other}:{args}"),
        ),
    };
    let payload = json!({
        "hook_event_name": "PermissionRequest",
        "easyisland_chat": true,
        "easyisland_engine": "local",
        "tool_name": tool_name,
        "tool_input": tool_input,
    });
    (payload, exact_key)
}

#[allow(clippy::too_many_arguments)]
async fn execute_tool_call<FAsk, FutAsk, FEasy, FutEasy>(
    name: &str,
    args: &Value,
    folder: &Path,
    auto: bool,
    mode: &str,
    read_only_chat: bool,
    chat_ptr: usize,
    notify_ui: bool,
    ask: &FAsk,
    call_easyisland: &FEasy,
) -> String
where
    FAsk: Fn(Value, String) -> FutAsk,
    FutAsk: Future<Output = Option<String>>,
    FEasy: Fn(String, Value) -> FutEasy,
    FutEasy: Future<Output = String>,
{
    match needs_ask(name, args, folder, auto, mode, read_only_chat) {
        Decision::Run => {}
        Decision::Refuse(why) => return why,
        Decision::Ask => {
            let (payload, exact_key) = permission_payload_for(name, args, folder);
            let decision = ask(payload, exact_key).await;
            if !matches!(decision.as_deref(), Some("allow" | "always")) {
                return t("L'utente ha negato questa azione: non riprovarla.").to_string();
            }
        }
    }

    match name {
        "run_command" => {
            let cmd = args.get("command").and_then(Value::as_str).unwrap_or("");
            let timeout_s = args
                .get("timeout_s")
                .and_then(Value::as_u64)
                .unwrap_or(DEFAULT_CMD_TIMEOUT_S)
                .clamp(1, MAX_CMD_TIMEOUT_S);
            match exec_run_command(folder, cmd, timeout_s).await {
                Ok(out) => out,
                Err(e) => e,
            }
        }
        "read_file" => {
            let raw = args.get("path").and_then(Value::as_str).unwrap_or("");
            let path = resolve_path(folder, raw);
            let offset = args.get("offset").and_then(Value::as_u64).unwrap_or(1) as usize;
            let limit = args
                .get("limit")
                .and_then(Value::as_u64)
                .map_or(DEFAULT_READ_LIMIT, |n| (n as usize).clamp(1, MAX_READ_LIMIT));
            match exec_read_file(&path, offset, limit) {
                Ok(out) => out,
                Err(e) => e,
            }
        }
        "list_dir" => {
            let raw = args.get("path").and_then(Value::as_str).unwrap_or("");
            let path = resolve_path(folder, raw);
            match exec_list_dir(&path) {
                Ok(out) => out,
                Err(e) => e,
            }
        }
        "search_text" => {
            let text = args.get("text").and_then(Value::as_str).unwrap_or("");
            let raw = args.get("path").and_then(Value::as_str).unwrap_or("");
            let path = resolve_path(folder, raw);
            let ext = args.get("ext").and_then(Value::as_str);
            match exec_search_text(folder, &path, text, ext) {
                Ok(out) => out,
                Err(e) => e,
            }
        }
        "write_file" => {
            let raw = args.get("path").and_then(Value::as_str).unwrap_or("");
            if raw.trim().is_empty() {
                return t("Manca il percorso del file.").to_string();
            }
            let Some(content) = args.get("content").and_then(Value::as_str) else {
                return t("Manca il contenuto da scrivere.").to_string();
            };
            let path = resolve_path(folder, raw);
            if notify_ui {
                crate::checkpoints::touching(chat_ptr, &path);
                crate::preview::touched_by("Write", &json!({ "file_path": path.to_string_lossy() }));
            }
            match exec_write_file(&path, content) {
                Ok(out) => out,
                Err(e) => e,
            }
        }
        "edit_file" => {
            let raw = args.get("path").and_then(Value::as_str).unwrap_or("");
            if raw.trim().is_empty() {
                return t("Manca il percorso del file.").to_string();
            }
            let Some(old_text) = args.get("old_text").and_then(Value::as_str) else {
                return t("Manca old_text.").to_string();
            };
            let Some(new_text) = args.get("new_text").and_then(Value::as_str) else {
                return t("Manca new_text.").to_string();
            };
            let path = resolve_path(folder, raw);
            match exec_edit_file(&path, old_text, new_text, || {
                if notify_ui {
                    crate::checkpoints::touching(chat_ptr, &path);
                    crate::preview::touched_by("Edit", &json!({ "file_path": path.to_string_lossy() }));
                }
            }) {
                Ok(out) => out,
                Err(e) => e,
            }
        }
        other => call_easyisland(other.to_string(), args.clone()).await,
    }
}

async fn exec_run_command(folder: &Path, command: &str, timeout_s: u64) -> Result<String, String> {
    if command.trim().is_empty() {
        return Err(t("Manca il comando.").to_string());
    }
    let mut cmd = tokio::process::Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", command])
        .current_dir(folder)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    let child = cmd
        .spawn()
        .map_err(|e| tf("Impossibile avviare PowerShell: {e}", &[("e", &e)]))?;

    let res = tokio::time::timeout(Duration::from_secs(timeout_s), child.wait_with_output()).await;
    let out = match res {
        Ok(Ok(o)) => o,
        Ok(Err(e)) => return Err(tf("Errore del comando: {e}", &[("e", &e)])),
        Err(_) => return Err(tf("Tempo scaduto dopo {n} s", &[("n", &timeout_s)])),
    };

    let code = out.status.code().map_or_else(|| "?".to_string(), |c| c.to_string());
    let stdout = String::from_utf8_lossy(&out.stdout);
    let stderr = String::from_utf8_lossy(&out.stderr);
    let mut combined = format!("Codice di uscita: {code}");
    if !stdout.is_empty() {
        combined.push('\n');
        combined.push_str(&stdout);
    }
    if !stderr.is_empty() {
        combined.push_str("\n[stderr]\n");
        combined.push_str(&stderr);
    }
    Ok(trim_output(&combined, MAX_OUTPUT_CHARS))
}

fn trim_output(s: &str, max_chars: usize) -> String {
    let total = s.chars().count();
    if total <= max_chars {
        return s.to_string();
    }
    let marker_room = 40;
    if max_chars <= marker_room {
        return s.chars().take(max_chars).collect();
    }
    let keep = max_chars - marker_room;
    let head_len = keep / 2;
    let tail_len = keep - head_len;
    let head_end = s
        .char_indices()
        .nth(head_len)
        .map_or(s.len(), |(idx, _)| idx);
    let tail_start = s
        .char_indices()
        .nth(total.saturating_sub(tail_len))
        .map_or(s.len(), |(idx, _)| idx);
    let removed = total.saturating_sub(head_len + tail_len);
    let head = s.get(..head_end).unwrap_or("");
    let tail = s.get(tail_start..).unwrap_or("");
    let marker = tf("… {n} caratteri tolti …", &[("n", &removed)]);
    format!("{head}\n{marker}\n{tail}")
}

fn is_binary_sample(bytes: &[u8]) -> bool {
    bytes.contains(&0)
}

fn exec_read_file(path: &Path, offset: usize, limit: usize) -> Result<String, String> {
    let mut probe = [0u8; 8192];
    let file = std::fs::File::open(path).map_err(|e| tf("Impossibile leggere il file: {e}", &[("e", &e)]))?;
    let mut reader = BufReader::new(file);
    let n = reader
        .get_mut()
        .read(&mut probe)
        .map_err(|e| tf("Impossibile leggere il file: {e}", &[("e", &e)]))?;
    if is_binary_sample(probe.get(..n).unwrap_or_default()) {
        return Ok(t("File binario, non lo leggo.").to_string());
    }

    // Reopen from start cleanly after probing.
    let file = std::fs::File::open(path).map_err(|e| tf("Impossibile leggere il file: {e}", &[("e", &e)]))?;
    let mut reader = BufReader::new(file);
    let start_line = offset.max(1);
    let mut out = String::new();
    let mut buf: Vec<u8> = Vec::new();
    let mut line_no = 0usize;
    let mut shown = 0usize;

    loop {
        buf.clear();
        let read_bytes = reader
            .read_until(b'\n', &mut buf)
            .map_err(|e| tf("Impossibile leggere il file: {e}", &[("e", &e)]))?;
        if read_bytes == 0 {
            break;
        }
        line_no += 1;
        if line_no < start_line {
            continue;
        }
        if is_binary_sample(&buf) {
            return Ok(t("File binario, non lo leggo.").to_string());
        }
        let line = String::from_utf8_lossy(&buf);
        let clean = line.trim_end_matches(['\r', '\n']);
        let formatted = format!("{line_no}: {clean}\n");
        if out.len() + formatted.len() > MAX_READ_BYTES {
            out.push_str(&format!("\n{}", t("(Limite di 200 KB raggiunto; usa offset per continuare.)")));
            break;
        }
        out.push_str(&formatted);
        shown += 1;
        if shown >= limit {
            break;
        }
    }
    if out.is_empty() {
        Ok(t("(Nessuna riga in questo intervallo.)").to_string())
    } else {
        Ok(out)
    }
}

fn is_skipped_dir(name: &str) -> bool {
    SKIP_DIRS.iter().any(|d| name.eq_ignore_ascii_case(d))
}

fn exec_list_dir(path: &Path) -> Result<String, String> {
    let entries = std::fs::read_dir(path).map_err(|e| tf("Impossibile leggere la cartella: {e}", &[("e", &e)]))?;
    let mut dirs: Vec<String> = Vec::new();
    let mut files: Vec<(String, u64)> = Vec::new();
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().to_string();
        let Ok(ft) = entry.file_type() else { continue };
        if ft.is_dir() {
            if !is_skipped_dir(&name) {
                dirs.push(name);
            }
        } else {
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            files.push((name, size));
        }
    }
    dirs.sort_by_key(|a| a.to_lowercase());
    files.sort_by_key(|(a, _)| a.to_lowercase());

    let mut lines: Vec<String> = Vec::new();
    for d in dirs {
        if lines.len() >= MAX_LIST_ENTRIES {
            break;
        }
        lines.push(format!("[dir] {d}"));
    }
    let mut omitted = false;
    for (f, size) in files {
        if lines.len() >= MAX_LIST_ENTRIES {
            omitted = true;
            break;
        }
        lines.push(format!("{f} ({size} B)"));
    }
    if lines.is_empty() {
        return Ok(t("(Cartella vuota.)").to_string());
    }
    if omitted {
        lines.push(t("… altre voci omesse (massimo 500).").to_string());
    }
    Ok(lines.join("\n"))
}

fn exec_search_text(folder: &Path, root: &Path, text: &str, ext: Option<&str>) -> Result<String, String> {
    if text.is_empty() {
        return Err(t("Manca il testo da cercare.").to_string());
    }
    let needle = text.to_lowercase();
    let wanted_ext = ext
        .map(str::trim)
        .filter(|e| !e.is_empty())
        .map(|e| e.trim_start_matches('.').to_ascii_lowercase());

    let mut stack = vec![root.to_path_buf()];
    let mut seen_dirs: HashSet<PathBuf> = HashSet::new();
    let mut hits: Vec<String> = Vec::new();

    while let Some(cur) = stack.pop() {
        if hits.len() >= MAX_SEARCH_HITS {
            break;
        }
        let Ok(meta) = std::fs::metadata(&cur) else { continue };
        if meta.is_file() {
            search_in_file(folder, &cur, &needle, wanted_ext.as_deref(), meta.len(), &mut hits);
            continue;
        }
        if !meta.is_dir() || !seen_dirs.insert(cur.clone()) {
            continue;
        }
        let Ok(rd) = std::fs::read_dir(&cur) else { continue };
        let mut children: Vec<PathBuf> = Vec::new();
        for entry in rd.flatten() {
            let p = entry.path();
            // Never where keys live (.env, .pem, .ssh…) and never through a
            // link or junction, which can lead outside the folder (review of
            // 16 Nov 2026: the check stood only on the starting folder).
            if is_secret_path(&p) || entry.file_type().map_or(true, |ft| ft.is_symlink()) {
                continue;
            }
            if entry.file_type().is_ok_and(|ft| ft.is_dir()) {
                let name = entry.file_name().to_string_lossy().to_string();
                if !is_skipped_dir(&name) {
                    children.push(p);
                }
            } else {
                children.push(p);
            }
        }
        children.sort();
        // Pop is LIFO, so push reversed for deterministic alphabetical traversal.
        for p in children.into_iter().rev() {
            stack.push(p);
        }
    }

    if hits.is_empty() {
        Ok(t("Nessun risultato.").to_string())
    } else {
        Ok(hits.join("\n"))
    }
}

fn search_in_file(
    folder: &Path,
    path: &Path,
    needle: &str,
    wanted_ext: Option<&str>,
    size: u64,
    hits: &mut Vec<String>,
) {
    if size > MAX_SEARCH_FILE_BYTES || hits.len() >= MAX_SEARCH_HITS {
        return;
    }
    if let Some(expected) = wanted_ext {
        let actual = path
            .extension()
            .and_then(|e| e.to_str())
            .map(str::to_ascii_lowercase)
            .unwrap_or_default();
        if actual != expected {
            return;
        }
    }
    let Ok(bytes) = std::fs::read(path) else { return };
    if is_binary_sample(&bytes) {
        return;
    }
    let content = String::from_utf8_lossy(&bytes);
    let shown_path = path
        .strip_prefix(folder)
        .unwrap_or(path)
        .to_string_lossy()
        .replace('\\', "/");

    for (idx, line) in content.lines().enumerate() {
        if line.to_lowercase().contains(needle) {
            let snippet: String = line.trim().chars().take(200).collect();
            hits.push(format!("{shown_path}:{}: {snippet}", idx + 1));
            if hits.len() >= MAX_SEARCH_HITS {
                break;
            }
        }
    }
}

fn exec_write_file(path: &Path, content: &str) -> Result<String, String> {
    if let Some(parent) = path.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|e| tf("Impossibile creare la cartella: {e}", &[("e", &e)]))?;
        }
    }
    std::fs::write(path, content).map_err(|e| tf("Impossibile scrivere il file: {e}", &[("e", &e)]))?;
    Ok(tf("File scritto: {path}", &[("path", &path.display())]))
}

fn exec_edit_file(path: &Path, old_text: &str, new_text: &str, before_write: impl FnOnce()) -> Result<String, String> {
    if old_text.is_empty() {
        return Err(t("old_text non può essere vuoto.").to_string());
    }
    let content = std::fs::read_to_string(path)
        .map_err(|e| tf("Impossibile leggere il file: {e}", &[("e", &e)]))?;

    let mut count = content.match_indices(old_text).count();
    let (actual_old, actual_new) = if count == 0
        && !old_text.contains("\r\n")
        && content.contains("\r\n")
    {
        let crlf_old = old_text.replace('\n', "\r\n");
        let crlf_count = content.match_indices(&crlf_old).count();
        if crlf_count > 0 {
            count = crlf_count;
            (crlf_old, new_text.replace('\n', "\r\n"))
        } else {
            (old_text.to_string(), new_text.to_string())
        }
    } else {
        (old_text.to_string(), new_text.to_string())
    };

    if count != 1 {
        return Err(tf(
            "Impossibile modificare: old_text trovato {n} volte (ne serve esattamente 1).",
            &[("n", &count)],
        ));
    }

    before_write();
    let updated = content.replacen(&actual_old, &actual_new, 1);
    std::fs::write(path, updated).map_err(|e| tf("Impossibile scrivere il file: {e}", &[("e", &e)]))?;
    Ok(tf("File modificato: {path}", &[("path", &path.display())]))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write as _;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    fn folder() -> PathBuf {
        PathBuf::from(r"C:\Lavoro\Progetto")
    }

    #[test]
    fn needs_ask_matches_permission_table() {
        let dir = folder();
        let inside = json!({ "path": "src\\main.rs" });
        let outside_abs = json!({ "path": r"C:\Altro\file.txt" });
        let outside_rel = json!({ "path": r"..\fuori.txt" });
        let secret = json!({ "path": ".env" });

        // Read tools inside folder -> Run across all modes.
        for mode in ["", "acceptEdits", "plan"] {
            assert_eq!(needs_ask("read_file", &inside, &dir, false, mode, false), Decision::Run);
            assert_eq!(needs_ask("list_dir", &json!({}), &dir, true, mode, false), Decision::Run);
        }
        assert_eq!(needs_ask("search_text", &json!({ "text": "a" }), &dir, false, "", true), Decision::Run);

        // Read tools outside folder or secret_place -> Ask (Refuse when read_only_chat).
        assert_eq!(needs_ask("read_file", &outside_abs, &dir, true, "", false), Decision::Ask);
        assert_eq!(needs_ask("read_file", &outside_rel, &dir, true, "plan", false), Decision::Ask);
        assert_eq!(needs_ask("read_file", &secret, &dir, true, "acceptEdits", false), Decision::Ask);
        assert!(matches!(needs_ask("read_file", &outside_rel, &dir, true, "", true), Decision::Refuse(_)));
        assert!(matches!(needs_ask("read_file", &secret, &dir, true, "", true), Decision::Refuse(_)));

        // File edits inside folder.
        assert_eq!(needs_ask("edit_file", &inside, &dir, false, "", false), Decision::Ask);
        assert_eq!(needs_ask("edit_file", &inside, &dir, false, "acceptEdits", false), Decision::Run);
        assert_eq!(needs_ask("write_file", &inside, &dir, true, "", false), Decision::Run);
        assert_eq!(
            needs_ask("write_file", &inside, &dir, true, "plan", false),
            Decision::Refuse(t("In Piano non modifico: scrivo solo il piano.").to_string())
        );
        assert!(matches!(needs_ask("edit_file", &inside, &dir, true, "", true), Decision::Refuse(_)));

        // File edits outside folder -> Ask (except plan/read_only_chat -> Refuse).
        assert_eq!(needs_ask("write_file", &outside_rel, &dir, true, "acceptEdits", false), Decision::Ask);

        // Commands.
        let ro_cmd = json!({ "command": "git status" });
        let normal_cmd = json!({ "command": "cargo test" });
        let del_cmd = json!({ "command": "git push" });
        assert_eq!(needs_ask("run_command", &ro_cmd, &dir, false, "", false), Decision::Run);
        assert_eq!(needs_ask("run_command", &ro_cmd, &dir, false, "plan", false), Decision::Run);
        assert_eq!(needs_ask("run_command", &ro_cmd, &dir, false, "", true), Decision::Run);

        assert_eq!(needs_ask("run_command", &normal_cmd, &dir, false, "", false), Decision::Ask);
        assert_eq!(needs_ask("run_command", &normal_cmd, &dir, false, "acceptEdits", false), Decision::Ask);
        assert_eq!(needs_ask("run_command", &normal_cmd, &dir, true, "", false), Decision::Run);
        assert!(matches!(needs_ask("run_command", &normal_cmd, &dir, true, "plan", false), Decision::Refuse(_)));
        assert!(matches!(needs_ask("run_command", &normal_cmd, &dir, true, "", true), Decision::Refuse(_)));

        assert_eq!(needs_ask("run_command", &del_cmd, &dir, true, "", false), Decision::Ask);
        assert!(matches!(needs_ask("run_command", &del_cmd, &dir, true, "plan", false), Decision::Refuse(_)));

        // EasyIsland tools.
        assert_eq!(needs_ask("memory_search", &json!({ "query": "x" }), &dir, false, "", false), Decision::Run);
        assert_eq!(needs_ask("memory_search", &json!({ "query": "x" }), &dir, false, "plan", true), Decision::Run);
        assert_eq!(needs_ask("run_quick_action", &json!({ "id": "1" }), &dir, true, "", false), Decision::Ask);
        assert!(matches!(needs_ask("run_quick_action", &json!({ "id": "1" }), &dir, true, "plan", false), Decision::Refuse(_)));
        assert!(matches!(needs_ask("run_quick_action", &json!({ "id": "1" }), &dir, true, "", true), Decision::Refuse(_)));
    }

    #[test]
    fn path_resolution_normalizes_and_detects_escape() {
        let dir = folder();
        assert!(inside_folder(&dir, &resolve_path(&dir, "sub\\a.txt")));
        assert!(inside_folder(&dir, &resolve_path(&dir, r"C:\Lavoro\Progetto\file.txt")));
        assert!(inside_folder(&dir, &resolve_path(&dir, r"sub\..\file.txt")));
        assert!(!inside_folder(&dir, &resolve_path(&dir, r"..\..\x")));
        assert!(!inside_folder(&dir, &resolve_path(&dir, r"C:\Lavoro\Progetto2\a.txt")));
    }

    #[test]
    fn edit_file_requires_exact_single_match() {
        let root = std::env::temp_dir().join(format!("easyisland-edit-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        let file = root.join("sample.txt");

        std::fs::write(&file, "alfa\nbeta\ngamma\n").unwrap();
        assert!(exec_edit_file(&file, "beta", "BETA", || {}).is_ok());
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "alfa\nBETA\ngamma\n");

        let zero = exec_edit_file(&file, "noncista", "x", || {}).unwrap_err();
        assert!(zero.contains("0"), "{zero}");
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "alfa\nBETA\ngamma\n");

        std::fs::write(&file, "dup\ndup\n").unwrap();
        let two = exec_edit_file(&file, "dup", "one", || {}).unwrap_err();
        assert!(two.contains("2"), "{two}");
        assert_eq!(std::fs::read_to_string(&file).unwrap(), "dup\ndup\n");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn trim_output_handles_multibyte_and_emoji() {
        let pattern = "àèìòù 🎉🚀abcde ";
        let long = pattern.repeat(2_000);
        assert!(long.chars().count() > 20_000);
        let trimmed = trim_output(&long, 20_000);
        assert!(trimmed.chars().count() <= 20_000);
        assert!(trimmed.starts_with("àèìòù 🎉"));
        assert!(trimmed.contains("caratteri tolti"));
        assert!(trimmed.ends_with("abcde "));
    }

    #[test]
    fn search_text_is_case_insensitive_and_skips_node_modules_and_caps() {
        let root = std::env::temp_dir().join(format!("easyisland-search-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(root.join("src")).unwrap();
        std::fs::create_dir_all(root.join("node_modules/pkg")).unwrap();

        std::fs::write(root.join("src/a.rs"), "Hello World\nsecond\n").unwrap();
        std::fs::write(root.join("node_modules/pkg/b.rs"), "hello ignored\n").unwrap();

        let found = exec_search_text(&root, &root, "HELLO", Some("rs")).unwrap();
        assert!(found.contains("src/a.rs:1: Hello World"), "{found}");
        assert!(!found.contains("node_modules"), "{found}");

        let many: String = (0..250).map(|i| format!("match line {i}\n")).collect();
        std::fs::write(root.join("src/many.txt"), many).unwrap();
        let capped = exec_search_text(&root, &root.join("src"), "match", Some("txt")).unwrap();
        assert_eq!(capped.lines().count(), MAX_SEARCH_HITS);

        // Where keys live is never read, even inside the folder.
        std::fs::write(root.join(".env"), "HELLO_KEY=segreto\n").unwrap();
        let found = exec_search_text(&root, &root, "hello", None).unwrap();
        assert!(!found.contains("segreto"), "{found}");

        let _ = std::fs::remove_dir_all(&root);
    }

    #[test]
    fn parse_tool_args_valid_invalid_and_missing() {
        assert_eq!(
            parse_tool_args(&json!({ "name": "read_file", "arguments": "{\"path\":\"a.txt\"}" })).unwrap(),
            json!({ "path": "a.txt" })
        );
        assert!(parse_tool_args(&json!({ "name": "read_file", "arguments": "{not json" })).is_err());
        assert_eq!(parse_tool_args(&json!({ "name": "list_dir" })).unwrap(), json!({}));
    }

    /// Mock local HTTP server replying sequentially with `bodies`.
    fn serve_many(bodies: Vec<String>) -> (String, Arc<Mutex<Vec<String>>>) {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        let seen = Arc::new(Mutex::new(Vec::new()));
        let seen_clone = seen.clone();
        std::thread::spawn(move || {
            for body in bodies {
                let (mut sock, _) = listener.accept().unwrap();
                let mut raw = Vec::new();
                let mut buf = [0u8; 4096];
                let mut expected_len = None;
                let mut header_end = None;
                loop {
                    let n = sock.read(&mut buf).unwrap_or(0);
                    if n == 0 {
                        break;
                    }
                    raw.extend_from_slice(&buf[..n]);
                    if header_end.is_none() {
                        if let Some(pos) = raw.windows(4).position(|w| w == b"\r\n\r\n") {
                            header_end = Some(pos + 4);
                            let head = String::from_utf8_lossy(&raw[..pos]).to_lowercase();
                            expected_len = head
                                .lines()
                                .find_map(|l| l.strip_prefix("content-length:").and_then(|v| v.trim().parse::<usize>().ok()));
                        }
                    }
                    if let Some(he) = header_end {
                        if raw.len() >= he + expected_len.unwrap_or(0) {
                            break;
                        }
                    }
                }
                let body_bytes = header_end.and_then(|he| raw.get(he..)).unwrap_or_default();
                seen_clone.lock().unwrap().push(String::from_utf8_lossy(body_bytes).to_string());
                let _ = write!(
                    sock,
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
            }
        });
        (format!("http://{addr}"), seen)
    }

    #[test]
    fn full_loop_runs_tool_call_and_returns_final_answer() {
        let root = std::env::temp_dir().join(format!("easyisland-loop-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("note.txt"), "ciao").unwrap();

        let step1 = json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": null,
                    "tool_calls": [{
                        "id": "call_1",
                        "type": "function",
                        "function": { "name": "list_dir", "arguments": "{}" }
                    }]
                }
            }],
            "usage": { "prompt_tokens": 120, "completion_tokens": 15 }
        })
        .to_string();
        let step2 = json!({
            "choices": [{
                "message": {
                    "role": "assistant",
                    "content": "Nella cartella c'è note.txt."
                }
            }],
            "usage": { "prompt_tokens": 180, "completion_tokens": 12 }
        })
        .to_string();

        let (base, requests) = serve_many(vec![step1, step2]);
        let chat = Chat::default();
        let asked = Arc::new(AtomicUsize::new(0));
        let asked_clone = asked.clone();

        let rt = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
        let reply = rt
            .block_on(run_loop(
                &base,
                "",
                "local",
                "Modello sul PC",
                "qwen3.5-4b",
                "easyisland",
                &chat,
                &root,
                "Elenca i file".to_string(),
                None,
                true,
                false,
                &|_| {},
                move |_, _| {
                    asked_clone.fetch_add(1, Ordering::Relaxed);
                    async { Some("deny".to_string()) }
                },
                |_, _| async { String::new() },
            ))
            .unwrap();

        assert_eq!(asked.load(Ordering::Relaxed), 0);
        assert!(reply.text.contains("Nella cartella c'è note.txt."), "{}", reply.text);
        let hist = chat.snapshot();
        assert_eq!(hist.len(), 2);
        assert_eq!(hist[0]["role"], "user");
        assert_eq!(hist[1]["role"], "assistant");
        assert_eq!(hist[1]["content"], "Nella cartella c'è note.txt.");

        let reqs = requests.lock().unwrap();
        assert_eq!(reqs.len(), 2);
        assert!(reqs[1].contains("note.txt"), "second request should include list_dir output");

        let _ = std::fs::remove_dir_all(&root);
    }
}
