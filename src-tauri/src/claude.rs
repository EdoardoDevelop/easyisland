// Claude API client — the same integration as ClaudeService.swift: multi-turn
// chat with web search, and files sent as document/image/text blocks.
//
// Everything happens here rather than in the island: the API key never leaves
// the Credential Manager, and file bytes never cross the IPC boundary.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::secrets;

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

const SYSTEM_PROMPT: &str = "You are Mochi, a personal AI assistant living at the top of the user's screen. \
You have web search access and can help with absolutely anything — research, coding, finding places, recommendations, tasks, questions. \
Respond in Italian unless the user writes in another language. Be thorough and complete — use as much detail as the task requires. \
No markdown formatting (no **, no ##, no bullet dashes). Use plain text with line breaks.";

#[derive(Default)]
pub struct Chat {
    /// Full multi-turn history, including tool_use / tool_result blocks.
    messages: Mutex<Vec<Value>>,
}

impl Chat {
    pub fn reset(&self) {
        self.messages.lock().unwrap().clear();
    }

    fn is_empty(&self) -> bool {
        self.messages.lock().unwrap().is_empty()
    }

    fn push(&self, message: Value) {
        self.messages.lock().unwrap().push(message);
    }

    fn pop(&self) {
        self.messages.lock().unwrap().pop();
    }

    fn snapshot(&self) -> Vec<Value> {
        self.messages.lock().unwrap().clone()
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ChatContext {
    File { name: String, path: String },
    Window { app_name: String, title: String, url: Option<String> },
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

fn request_body(model: &str, messages: Vec<Value>) -> Value {
    let mut body = json!({
        "model": model,
        "max_tokens": MAX_TOKENS,
        "system": SYSTEM_PROMPT,
        "tools": [web_search_tool(model)],
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
pub async fn send(
    chat: &Chat,
    model: &str,
    query: String,
    context: Option<ChatContext>,
) -> Result<ChatReply, String> {
    let key = secrets::get("anthropic-api-key")
        .ok_or_else(|| "Manca la chiave API. Apri le impostazioni.".to_string())?;

    let mut content: Vec<Value> = Vec::new();

    // File / window context rides along with the first message only, exactly
    // like ClaudeService.chat().
    if chat.is_empty() {
        match &context {
            Some(ChatContext::File { name, path }) => {
                if let Some(block) = file_block(path) {
                    content.push(block);
                }
                content.push(json!({ "type": "text", "text": format!("File: {name}") }));
            }
            Some(ChatContext::Window { app_name, title, url }) => {
                let mut text = format!("Contesto — App: {app_name}, Finestra: {title}");
                if let Some(url) = url {
                    text.push_str(&format!(", URL: {url}"));
                }
                content.push(json!({ "type": "text", "text": text }));
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

    for attempt in 0..=MAX_CONTINUATIONS {
        let body = request_body(model, chat.snapshot());
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
                .unwrap_or("Claude ha rifiutato questa richiesta.");
            return Err(why.to_string());
        }

        let Some(blocks) = response.get("content").and_then(Value::as_array).cloned() else {
            for _ in 0..pushed {
                chat.pop();
            }
            return Err("Risposta inattesa dall'API.".into());
        };

        // Store the whole content — thinking, server tool use and search results
        // included — so the next turn has the right context.
        chat.push(json!({ "role": "assistant", "content": blocks.clone() }));
        pushed += 1;
        blocks_all.extend(blocks);

        match stop {
            // The server paused a long search turn: send the history back as-is
            // and the model picks up where it stopped.
            "pause_turn" if attempt < MAX_CONTINUATIONS => continue,
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

    if truncated && !text.is_empty() {
        text.push_str("\n\n[Risposta interrotta: troppo lunga.]");
    }

    if text.is_empty() {
        return Err("Nessun testo nella risposta.".into());
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
        .map_err(|e| format!("Errore di rete: {e}"))?;

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
    serde_json::from_str(&text).map_err(|e| format!("Risposta API non valida: {e}"))
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
    Some(json!({ "type": "text", "text": format!("Contenuto del file:\n{text}") }))
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
    use super::{request_body, supports_default_fallback, web_search_tool};

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
        assert_eq!(request_body("claude-opus-5-5", vec![])["fallbacks"], "default");
        assert!(request_body("claude-haiku-4-5", vec![]).get("fallbacks").is_none());
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
