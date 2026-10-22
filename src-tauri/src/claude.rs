// Claude API client — the same integration as ClaudeService.swift: multi-turn
// chat with web search, and files sent as document/image/text blocks. With
// «Strumenti di EasyIsland» on, also EasyIsland's own tools (the list the
// relay's MCP server offers, `hook/src/tool_list.rs`), run here through
// agent.rs: the read-only ones at once, the others after Consenti / Nega in
// the island or on Telegram (asked by Edoardo on 19 October 2026: every
// engine should reach EasyIsland's integrations).
//
// Everything happens here rather than in the island: the API key never leaves
// the Credential Manager, and file bytes never cross the IPC boundary.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::secrets;
use crate::i18n::{t, tf};

#[path = "../../hook/src/tool_list.rs"]
mod tool_list;

/// Rounds of tool calls in one turn at most.
const MAX_TOOL_ROUNDS: usize = 15;

/// EasyIsland's tools for a turn: who asks Consenti / Nega (the island, or Telegram).
pub struct Tools<'a> {
    pub app: &'a tauri::AppHandle,
    pub telegram: bool,
}

/// The tools as the API wants them; `show_card` would cover the chat itself.
fn agent_tools() -> Vec<Value> {
    tool_list::tools()
        .into_iter()
        .filter(|t| t.0 != "show_card")
        .map(|(name, description, schema, _)| json!({ "name": name, "description": description, "input_schema": schema }))
        .collect()
}

/// One tool_use block → its tool_result block, after the user's click when it changes something.
async fn run_tool(tools: &Tools<'_>, block: &Value) -> Value {
    let id = block.get("id").cloned().unwrap_or(Value::Null);
    let name = block.get("name").and_then(Value::as_str).unwrap_or_default();
    let input = block.get("input").cloned().unwrap_or_else(|| json!({}));
    let known = name != "show_card" && tool_list::tools().iter().any(|t| t.0 == name);
    let (text, ok) = if !known {
        (format!("Strumento sconosciuto: {name}"), false)
    } else if crate::claude_cli::AGENT_READ_ONLY.contains(&name) || allowed(tools, name, &input).await {
        let v = crate::agent::call(tools.app, name, &input).await;
        (v.get("text").and_then(Value::as_str).unwrap_or_default().to_string(), v.get("ok").and_then(Value::as_bool) == Some(true))
    } else {
        ("L'utente ha negato questa azione: non riprovarla.".to_string(), false)
    };
    json!({ "type": "tool_result", "tool_use_id": id, "content": text, "is_error": !ok })
}

/// Consenti / Nega for a tool that changes something, as for the other engines.
async fn allowed(tools: &Tools<'_>, name: &str, input: &Value) -> bool {
    let payload = json!({
        "hook_event_name": "PermissionRequest",
        "easyisland_chat": true,
        "easyisland_engine": "api",
        "tool_name": format!("mcp__easyisland__{name}"),
        "tool_input": input,
    });
    let decision = if tools.telegram {
        crate::telegram::request_decision(tools.app, payload).await
    } else {
        crate::pipe::request_decision(tools.app, payload).await
    };
    matches!(decision.as_deref(), Some("allow" | "always"))
}

/// A turn stopped while tools ran leaves calls without results, which the API
/// refuses: the unfinished turn is dropped, back to the last complete answer.
fn drop_unfinished(chat: &Chat) {
    let open = |m: &Value| {
        m.get("role").and_then(Value::as_str) != Some("assistant")
            || m.get("content").and_then(Value::as_array).is_some_and(|c| c.iter().any(|b| b.get("type").and_then(Value::as_str) == Some("tool_use")))
    };
    let history = chat.snapshot();
    let has_tools = history.iter().any(|m| m.get("content").and_then(Value::as_array).is_some_and(|c| c.iter().any(|b| b.get("type").and_then(Value::as_str) == Some("tool_use"))));
    if !has_tools {
        return;
    }
    let keep = history.iter().rposition(|m| !open(m)).map_or(0, |i| i + 1);
    for _ in keep..history.len() {
        chat.pop();
    }
}

const ENDPOINT: &str = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION: &str = "2023-06-01";
/// Server-side fallback: on a policy decline the API retries the same request on
/// a fallback model inside the same call, so the island never shows a dead end.
/// Only some models accept `fallbacks: "default"` — see `supports_default_fallback`.
const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";
/// Non-streaming request: high enough that a thorough answer isn't cut off,
/// low enough to stay well inside the HTTP timeout.
const MAX_TOKENS: u32 = 16_000;
/// A turn with several web searches can come back as `pause_turn`; we resume it
/// this many times at most before giving up.
const MAX_CONTINUATIONS: usize = 3;
/// Opus with thinking and up to five searches can take a while.
const HTTP_TIMEOUT_SECS: u64 = 180;
/// Text and code files are inlined; anything larger is skipped, as on macOS.
const MAX_INLINE_TEXT: u64 = 200_000;

pub const DEFAULT_MODEL: &str = "claude-opus-5-5";

const SYSTEM_PROMPT: &str = "You are a personal AI assistant living at the top of the user's screen. \
You have web search access and can help with absolutely anything — research, coding, finding places, recommendations, tasks, questions. \
Respond in Italian unless the user writes in another language. Be thorough and complete — use as much detail as the task requires. \
Markdown is rendered: use short paragraphs, lists, tables and code blocks when they help.";

#[derive(Default)]
pub struct Chat {
    /// Full multi-turn history, including tool_use / tool_result blocks.
    messages: Mutex<Vec<Value>>,
    /// Claude Code session to resume when the chat goes through `claude -p`.
    cli_session: Mutex<Option<String>>,
    /// Engine the current conversation started on ("api" or "subscription").
    engine: Mutex<String>,
    /// The conversation's id in the chat history (chat_log.rs), from its first turn.
    log_id: Mutex<Option<String>>,
    /// A reopened conversation the engine cannot resume on its own: it goes
    /// in front of the next question (chat_log.rs).
    preamble: Mutex<Option<String>>,
    /// The assistant picked for this conversation (Impostazioni → Chat →
    /// Assistenti): its instructions go in front of the first question. Not
    /// cleared by `reset` (an engine change resets too): `chat_reset` does it.
    persona: Mutex<Option<String>>,
}

impl Chat {
    pub fn reset(&self) {
        self.messages.lock().unwrap().clear();
        *self.cli_session.lock().unwrap() = None;
        *self.log_id.lock().unwrap() = None;
        *self.preamble.lock().unwrap() = None;
    }

    /// A conversation from the history takes the place of the current one.
    pub(crate) fn restore(&self, engine: &str, messages: Vec<Value>, log_id: Option<String>, preamble: Option<String>) {
        self.reset();
        *self.engine.lock().unwrap() = engine.to_string();
        *self.messages.lock().unwrap() = messages;
        *self.log_id.lock().unwrap() = log_id;
        *self.preamble.lock().unwrap() = preamble;
    }

    /// What `use_engine` was last given (engine, model, terminal mode).
    pub(crate) fn engine_key(&self) -> String {
        self.engine.lock().unwrap().clone()
    }

    pub(crate) fn log_id(&self) -> Option<String> {
        self.log_id.lock().unwrap().clone()
    }

    pub(crate) fn set_log_id(&self, id: Option<String>) {
        *self.log_id.lock().unwrap() = id;
    }

    pub(crate) fn set_persona(&self, text: Option<String>) {
        *self.persona.lock().unwrap() = text.filter(|t| !t.trim().is_empty());
    }

    pub(crate) fn persona(&self) -> Option<String> {
        self.persona.lock().unwrap().clone()
    }

    pub(crate) fn take_preamble(&self) -> Option<String> {
        self.preamble.lock().unwrap().take()
    }

    pub(crate) fn put_back_preamble(&self, text: String) {
        *self.preamble.lock().unwrap() = Some(text);
    }

    /// The two engines keep separate histories; switching mid-conversation
    /// starts a fresh one rather than mixing them.
    pub fn use_engine(&self, engine: &str) {
        let mut current = self.engine.lock().unwrap();
        if *current != engine {
            *current = engine.to_string();
            drop(current);
            self.reset();
        }
    }

    pub(crate) fn cli_session(&self) -> Option<String> {
        self.cli_session.lock().unwrap().clone()
    }

    pub(crate) fn set_cli_session(&self, id: Option<String>) {
        *self.cli_session.lock().unwrap() = id;
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.messages.lock().unwrap().is_empty()
    }

    pub(crate) fn push(&self, message: Value) {
        self.messages.lock().unwrap().push(message);
    }

    pub(crate) fn pop(&self) {
        self.messages.lock().unwrap().pop();
    }

    pub(crate) fn snapshot(&self) -> Vec<Value> {
        self.messages.lock().unwrap().clone()
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ChatContext {
    File { name: String, path: String },
    /// Text handed over by a quick action or the "ask about clipboard" shortcut.
    Text { label: String, text: String },
    /// Another app's window: the character of the chat tab dropped on it
    /// (window_drop.rs), with its picture in the inbox.
    #[serde(rename_all = "camelCase")]
    Window { app_name: String, title: String, url: Option<String>, image: Option<String> },
}

/// The line every engine puts before a window given as context.
pub(crate) fn window_line(app_name: &str, title: &str, url: Option<&str>) -> String {
    let mut text = tf("Finestra allegata — app: {app}, titolo: {title}", &[("app", &app_name), ("title", &title)]);
    if let Some(url) = url {
        text.push_str(&format!(", URL: {url}"));
    }
    text
}

/// `web_search_20260209` (dynamic filtering) exists only on recent Opus and
/// Sonnet models; everything else — Haiku 4.5 included — needs the basic tool.
fn web_search_tool(model: &str) -> Value {
    const DYNAMIC: &[&str] = &[
        "claude-opus-5", // also claude-opus-5-5
        "claude-opus-4-8",
        "claude-opus-4-7",
        "claude-opus-4-6",
        "claude-sonnet-5", // also claude-sonnet-5-5
        "claude-sonnet-4-6",
    ];
    let kind = if DYNAMIC.iter().any(|p| model.starts_with(p)) {
        "web_search_20260209"
    } else {
        "web_search_20250305"
    };
    json!({ "type": kind, "name": "web_search", "max_uses": 5 })
}

/// `fallbacks: "default"` is accepted only by these models; sending it (or its
/// beta header) to any other model is a 400.
fn supports_default_fallback(model: &str) -> bool {
    matches!(
        model,
        "claude-fable-5-1" | "claude-opus-5-5" | "claude-opus-5" | "claude-sonnet-5-5"
    )
}

fn request_body(model: &str, messages: Vec<Value>, agent: bool) -> Value {
    let mut tools = vec![web_search_tool(model)];
    let mut system = crate::i18n::prompt(SYSTEM_PROMPT);
    if agent {
        tools.extend(agent_tools());
        system.push_str(crate::claude_cli::AGENT_PROMPT);
    }
    let mut body = json!({
        "model": model,
        "max_tokens": MAX_TOKENS,
        "system": system,
        "tools": tools,
        "messages": messages,
    });
    if supports_default_fallback(model) {
        body["fallbacks"] = json!("default");
    }
    body
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatReply {
    pub text: String,
}

/// One chat turn. Returns the assistant's text, or a message the island shows
/// in the note view.
pub async fn send(chat: &Chat, model: &str, query: String, context: Option<ChatContext>) -> Result<ChatReply, String> {
    send_with(chat, model, query, context, None).await
}

/// `send`, with EasyIsland's tools when `tools` is given (lib.rs chat_turn).
pub async fn send_with(
    chat: &Chat,
    model: &str,
    query: String,
    context: Option<ChatContext>,
    tools: Option<Tools<'_>>,
) -> Result<ChatReply, String> {
    drop_unfinished(chat);
    let key = secrets::get("anthropic-api-key")
        .ok_or_else(|| t("Manca la chiave API. Apri le impostazioni.").to_string())?;

    let mut content: Vec<Value> = Vec::new();

    // File / window context: with the first message, or a file added later
    // (pasted in the chat, sent on Telegram) — the front end decides.
    {
        match &context {
            Some(ChatContext::File { name, path }) => {
                if let Some(block) = file_block(path) {
                    content.push(block);
                }
                content.push(json!({ "type": "text", "text": format!("File: {name}") }));
            }
            Some(ChatContext::Text { label, text }) => {
                content.push(json!({ "type": "text", "text": format!("{label}:\n{text}") }));
            }
            Some(ChatContext::Window { app_name, title, url, image }) => {
                if let Some(block) = image.as_deref().and_then(file_block) {
                    content.push(block);
                }
                content.push(json!({ "type": "text", "text": window_line(app_name, title, url.as_deref()) }));
            }
            None => {}
        }
    }
    content.push(json!({ "type": "text", "text": query }));

    chat.push(json!({ "role": "user", "content": content }));

    // How many messages belong to this turn, so a failure can roll all of them
    // back and leave the history exactly as the model last saw it.
    let mut pushed = 1;
    let mut blocks_all: Vec<Value> = Vec::new();
    let mut truncated = false;
    // What the tools did, as the other engines show it ("> ⚙ …" above the answer).
    let mut steps: Vec<String> = Vec::new();
    let (mut continuations, mut rounds) = (0, 0);

    loop {
        let body = request_body(model, chat.snapshot(), tools.is_some());
        let response = match call(&key, &body, supports_default_fallback(model)).await {
            Ok(v) => v,
            Err(err) => {
                for _ in 0..pushed {
                    chat.pop();
                }
                return Err(err);
            }
        };

        let stop = response.get("stop_reason").and_then(Value::as_str).unwrap_or("");

        // A policy decline comes back as HTTP 200 with stop_reason "refusal".
        if stop == "refusal" {
            for _ in 0..pushed {
                chat.pop();
            }
            let why = response
                .get("stop_details")
                .and_then(|d| d.get("explanation"))
                .and_then(Value::as_str)
                .unwrap_or(t("Claude ha rifiutato questa richiesta."));
            return Err(why.to_string());
        }

        let Some(blocks) = response.get("content").and_then(Value::as_array).cloned() else {
            for _ in 0..pushed {
                chat.pop();
            }
            return Err(t("Risposta inattesa dall'API.").into());
        };

        // Store the whole content — thinking, server tool use and search results
        // included — so the next turn has the right context.
        chat.push(json!({ "role": "assistant", "content": blocks.clone() }));
        pushed += 1;
        let calls: Vec<Value> = blocks.iter().filter(|b| b.get("type").and_then(Value::as_str) == Some("tool_use")).cloned().collect();
        blocks_all.extend(blocks);

        // EasyIsland's tools: their results go back and the model goes on.
        if stop == "tool_use" && !calls.is_empty() {
            if let Some(tl) = &tools {
                let mut results = Vec::new();
                for c in &calls {
                    let name = c.get("name").and_then(Value::as_str).unwrap_or("?");
                    let result = if rounds < MAX_TOOL_ROUNDS {
                        run_tool(tl, c).await
                    } else {
                        json!({ "type": "tool_result", "tool_use_id": c.get("id"), "content": "Troppi passi in questa risposta: fermati e riassumi.", "is_error": true })
                    };
                    let mark = if result.get("is_error").and_then(Value::as_bool) == Some(true) { " — ⚠" } else { "" };
                    steps.push(format!("> ⚙ {name}{mark}"));
                    results.push(result);
                }
                chat.push(json!({ "role": "user", "content": results }));
                pushed += 1;
                rounds += 1;
                // Past the limit the model gets one more call, to sum up.
                if rounds <= MAX_TOOL_ROUNDS + 1 {
                    continue;
                }
            }
        }
        match stop {
            // The server paused a long search turn: send the history back as-is
            // and the model picks up where it stopped.
            "pause_turn" if continuations < MAX_CONTINUATIONS => {
                continuations += 1;
                continue;
            }
            "max_tokens" => truncated = true,
            _ => {}
        }
        break;
    }

    let mut text = blocks_all
        .iter()
        .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
        .filter_map(|b| b.get("text").and_then(Value::as_str))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();

    if !steps.is_empty() && !text.is_empty() {
        text = format!("{}\n\n{text}", steps.join("\n\n"));
    }

    if truncated && !text.is_empty() {
        text.push_str(t("\n\n[Risposta interrotta: troppo lunga.]"));

    }

    if text.is_empty() {
        return Err(t("Nessun testo nella risposta.").into());
    }
    Ok(ChatReply { text })
}

async fn call(key: &str, body: &Value, fallback_beta: bool) -> Result<Value, String> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
        .build()
        .map_err(|e| e.to_string())?;

    let mut request = client
        .post(ENDPOINT)
        .header("x-api-key", key)
        .header("anthropic-version", ANTHROPIC_VERSION)
        .header("content-type", "application/json");
    if fallback_beta {
        request = request.header("anthropic-beta", FALLBACK_BETA);
    }
    let response = request
        .json(body)
        .send()
        .await
        .map_err(|e| tf("Errore di rete: {e}", &[("e", &e)]))?;

    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        // Surface the API's own message, which is what makes a bad key obvious.
        let detail = serde_json::from_str::<Value>(&text)
            .ok()
            .and_then(|v| {
                v.get("error")
                    .and_then(|e| e.get("message"))
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .unwrap_or_else(|| text.chars().take(200).collect());
        return Err(format!("API Claude {status}: {detail}"));
    }
    serde_json::from_str(&text).map_err(|e| tf("Risposta API non valida: {e}", &[("e", &e)]))
}

/// PDF → document block, image → image block, text/code → inline text.
/// Mirrors readFileAsBlock() in ClaudeService.swift.
fn file_block(path: &str) -> Option<Value> {
    let ext = std::path::Path::new(path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    let media_type = match ext.as_str() {
        "pdf" => Some(("document", "application/pdf")),
        "jpg" | "jpeg" => Some(("image", "image/jpeg")),
        "png" => Some(("image", "image/png")),
        "gif" => Some(("image", "image/gif")),
        "webp" => Some(("image", "image/webp")),
        _ => None,
    };

    if let Some((block_type, media)) = media_type {
        let bytes = std::fs::read(path).ok()?;
        return Some(json!({
            "type": block_type,
            "source": { "type": "base64", "media_type": media, "data": base64(&bytes) },
        }));
    }

    let len = std::fs::metadata(path).ok()?.len();
    if len > MAX_INLINE_TEXT {
        return None;
    }
    let text = std::fs::read_to_string(path).ok()?;
    Some(json!({ "type": "text", "text": tf("Contenuto del file:\n{text}", &[("text", &text)]) }))
}

/// Small standalone base64 encoder — not worth another dependency.
/// Also used for Stripe's basic auth.
pub(crate) fn base64_for(bytes: &[u8]) -> String {
    base64(bytes)
}

fn base64(bytes: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TABLE[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[n as usize & 63] as char } else { '=' });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::{agent_tools, drop_unfinished, request_body, supports_default_fallback, web_search_tool, Chat};
    use serde_json::json;

    #[test]
    fn easyisland_tools_ride_along_only_when_on() {
        assert_eq!(request_body("claude-opus-5-5", vec![], false)["tools"].as_array().unwrap().len(), 1);
        let on = request_body("claude-opus-5-5", vec![], true);
        let names: Vec<&str> = on["tools"].as_array().unwrap().iter().filter_map(|t| t["name"].as_str()).collect();
        assert!(names.contains(&"notion_add_row") && names.contains(&"list_status") && names.contains(&"web_search"));
        assert!(!names.contains(&"show_card"));
        assert!(on["system"].as_str().unwrap().contains("easyisland tools"));
        assert!(agent_tools().iter().all(|t| t["input_schema"]["type"] == "object"));
    }

    #[test]
    fn a_stopped_tool_turn_is_dropped() {
        let chat = Chat::default();
        chat.push(json!({ "role": "user", "content": "ciao" }));
        chat.push(json!({ "role": "assistant", "content": [{ "type": "text", "text": "ciao!" }] }));
        chat.push(json!({ "role": "user", "content": "aggiungi in Notion" }));
        chat.push(json!({ "role": "assistant", "content": [{ "type": "tool_use", "id": "t1", "name": "notion_add_row", "input": {} }] }));
        drop_unfinished(&chat);
        assert_eq!(chat.snapshot().len(), 2);
        // A history without tools is left as it is.
        chat.push(json!({ "role": "user", "content": "e poi?" }));
        drop_unfinished(&chat);
        assert_eq!(chat.snapshot().len(), 3);
    }

    #[test]
    fn web_search_variant_follows_the_model() {
        for model in ["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-sonnet-5"] {
            assert_eq!(web_search_tool(model)["type"], "web_search_20260209", "{model}");
        }
        assert_eq!(web_search_tool("claude-haiku-4-5")["type"], "web_search_20250305");
    }

    #[test]
    fn fallbacks_only_where_supported() {
        assert!(supports_default_fallback("claude-opus-5-5"));
        assert!(supports_default_fallback("claude-sonnet-5-5"));
        assert!(!supports_default_fallback("claude-sonnet-5"));
        assert!(!supports_default_fallback("claude-haiku-4-5"));
        assert_eq!(request_body("claude-opus-5-5", vec![], false)["fallbacks"], "default");
        assert!(request_body("claude-haiku-4-5", vec![], false).get("fallbacks").is_none());
    }

    use super::base64;

    #[test]
    fn base64_matches_rfc4648_vectors() {
        assert_eq!(base64(b""), "");
        assert_eq!(base64(b"f"), "Zg==");
        assert_eq!(base64(b"fo"), "Zm8=");
        assert_eq!(base64(b"foo"), "Zm9v");
        assert_eq!(base64(b"foob"), "Zm9vYg==");
        assert_eq!(base64(b"fooba"), "Zm9vYmE=");
        assert_eq!(base64(b"foobar"), "Zm9vYmFy");
    }
}
