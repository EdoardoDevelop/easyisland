// Chat engines that speak the OpenAI chat-completions API (HANDOFF 6.6, point 6):
// OpenRouter (one key, many models), OpenAI, Google AI (Gemini, through its
// OpenAI-compatible endpoint), and the local servers Ollama and LM Studio (no
// key, only the address). One client for all five.
//
// As with the Anthropic engine (claude.rs), everything happens here: keys stay
// in the Credential Manager, file bytes never cross the IPC boundary. Replies
// stream: the text so far goes to the island as `chat-stream` events, with the
// model's reasoning (`reasoning` / `reasoning_content` fields, `<think>` blocks)
// left out. No tools: these engines only talk.

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter};

use crate::claude::{Chat, ChatContext, ChatReply};
use crate::secrets;
use crate::i18n::{t, tf};

/// The engines this module serves, by their `chatEngine` value.
pub const ENGINES: &[&str] = &["openrouter", "openai", "gemini", "ollama", "lmstudio"];

pub struct Provider {
    pub name: &'static str,
    pub base: &'static str,
    /// Credential Manager key; None for the local servers.
    pub key: Option<&'static str>,
}

pub fn provider(engine: &str) -> Option<Provider> {
    Some(match engine {
        "openrouter" => Provider { name: "OpenRouter", base: "https://openrouter.ai/api/v1", key: Some("openrouter-api-key") },
        "openai" => Provider { name: "OpenAI", base: "https://api.openai.com/v1", key: Some("openai-api-key") },
        "gemini" => Provider {
            name: "Google AI",
            base: "https://generativelanguage.googleapis.com/v1beta/openai",
            key: Some("gemini-api-key"),
        },
        "ollama" => Provider { name: "Ollama", base: "http://localhost:11434/v1", key: None },
        "lmstudio" => Provider { name: "LM Studio", base: "http://localhost:1234/v1", key: None },
        _ => return None,
    })
}

/// The API root: the user's address for a local server (any http(s) URL, a
/// trailing `/v1` added when missing), the fixed one otherwise.
pub fn base_url(engine: &str, custom: Option<&str>) -> Result<String, String> {
    let p = provider(engine).ok_or(t("Motore della chat sconosciuto."))?;
    let custom = custom.map(str::trim).filter(|u| !u.is_empty());
    let Some(url) = custom.filter(|_| p.key.is_none()) else { return Ok(p.base.to_string()) };
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return Err(tf("L'indirizzo di {name} deve iniziare con http:// o https://", &[("name", &p.name)]));
    }
    let url = url.trim_end_matches('/');
    Ok(if url.ends_with("/v1") { url.to_string() } else { format!("{url}/v1") })
}

const SYSTEM_PROMPT: &str = "You are the personal assistant living in a small chat bubble at the top of the user's screen (the EasyIsland desktop app). \
Respond in Italian unless the user writes in another language. Be thorough but keep it readable in a small window. \
Markdown is rendered: use short paragraphs, lists, tables and code blocks when they help. \
You cannot browse the web or run anything: say so when a question needs it.";

/// Text files are inlined up to this size, as with the Anthropic engine.
const MAX_INLINE_TEXT: u64 = 200_000;
/// Pictures up to this size go along (base64 makes them a third bigger).
const MAX_IMAGE: u64 = 8_000_000;
const HTTP_TIMEOUT_SECS: u64 = 300;
/// The island gets the growing reply at most this often.
const STREAM_EVERY_MS: u128 = 80;

#[derive(Clone, Serialize)]
struct Stream<'a> {
    text: &'a str,
}

/// The user message of this turn: the attached file or text (first turn only)
/// and the question.
fn user_message(first: bool, query: &str, context: Option<&ChatContext>) -> Value {
    let mut parts: Vec<Value> = Vec::new();
    if first {
        match context {
            Some(ChatContext::File { name, path }) => {
                parts.extend(file_parts(name, path));
            }
            Some(ChatContext::Text { label, text }) => {
                parts.push(json!({ "type": "text", "text": format!("{label}:\n{text}") }));
            }
            Some(ChatContext::Window { app_name, title, url }) => {
                let mut text = format!("Contesto — App: {app_name}, Finestra: {title}");
                if let Some(url) = url {
                    text.push_str(&format!(", URL: {url}"));
                }
                parts.push(json!({ "type": "text", "text": text }));
            }
            None => {}
        }
    }
    if parts.is_empty() {
        return json!({ "role": "user", "content": query });
    }
    parts.push(json!({ "type": "text", "text": query }));
    json!({ "role": "user", "content": parts })
}

/// A picture as an `image_url` data URL (vision models), a text file inline,
/// anything else (PDF, Office…) named only — these engines get no documents.
fn file_parts(name: &str, path: &str) -> Vec<Value> {
    let ext = std::path::Path::new(path).extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let len = std::fs::metadata(path).map(|m| m.len()).unwrap_or(u64::MAX);
    let image = match ext.as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        _ => None,
    };
    if let Some(mime) = image {
        if len <= MAX_IMAGE {
            if let Ok(bytes) = std::fs::read(path) {
                let url = format!("data:{mime};base64,{}", crate::claude::base64_for(&bytes));
                return vec![
                    json!({ "type": "image_url", "image_url": { "url": url } }),
                    json!({ "type": "text", "text": format!("Immagine: {name}") }),
                ];
            }
        }
    } else if len <= MAX_INLINE_TEXT {
        if let Ok(text) = std::fs::read_to_string(path) {
            return vec![json!({ "type": "text", "text": tf("File: {name}\nContenuto del file:\n{text}", &[("name", &name), ("text", &text)]) })];
        }
    }
    vec![json!({ "type": "text", "text": tf("File: {name} (questo motore non può leggerlo: solo immagini e file di testo)", &[("name", &name)]) })]
}

/// The visible part of a reply: `<think>…</think>` blocks removed, and an
/// unclosed one hides everything after it (it is still being written).
pub fn visible(text: &str) -> String {
    let mut out = String::new();
    let mut rest = text;
    loop {
        match rest.find("<think>") {
            Some(i) => {
                out.push_str(&rest[..i]);
                match rest[i..].find("</think>") {
                    Some(j) => rest = &rest[i + j + "</think>".len()..],
                    None => break,
                }
            }
            None => {
                out.push_str(rest);
                break;
            }
        }
    }
    out.trim_start().to_string()
}

/// One `data:` line of the stream → the content it adds (reasoning ignored).
/// None for `[DONE]`, keep-alives and anything that is not a content delta.
pub fn delta(line: &str) -> Option<String> {
    let data = line.trim().strip_prefix("data:")?.trim();
    if data.is_empty() || data == "[DONE]" {
        return None;
    }
    let v: Value = serde_json::from_str(data).ok()?;
    let content = v.pointer("/choices/0/delta/content")?.as_str()?;
    (!content.is_empty()).then(|| content.to_string())
}

/// The provider's own error text, which is what makes a bad key or model obvious.
fn error_text(body: &str) -> String {
    serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| {
            let e = v.get("error")?;
            e.get("message").and_then(Value::as_str).or_else(|| e.as_str()).map(str::to_string)
        })
        .unwrap_or_else(|| body.chars().take(200).collect())
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(HTTP_TIMEOUT_SECS))
        .connect_timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| e.to_string())
}

fn auth(engine: &str, request: reqwest::RequestBuilder) -> Result<reqwest::RequestBuilder, String> {
    let p = provider(engine).ok_or(t("Motore della chat sconosciuto."))?;
    let Some(key_name) = p.key else { return Ok(request) };
    let key = secrets::get(key_name).ok_or_else(|| tf("Manca la chiave di {name}. Apri le impostazioni.", &[("name", &p.name)]))?;
    let mut request = request.bearer_auth(key);
    if engine == "openrouter" {
        // OpenRouter's app attribution: who is calling, nothing about the user.
        request = request.header("X-Title", "EasyIsland");
    }
    Ok(request)
}

fn network_error(engine: &str, base: &str, err: reqwest::Error) -> String {
    let p = provider(engine).map(|p| p.name).unwrap_or("Il servizio");
    if err.is_connect() && provider(engine).is_some_and(|p| p.key.is_none()) {
        tf("{p} non risponde su {base}: è avviato?", &[("p", &p), ("base", &base)])
    } else if err.is_timeout() {
        tf("{p} non ha risposto in tempo.", &[("p", &p)])
    } else {
        tf("Errore di rete con {p}: {err}", &[("p", &p), ("err", &err)])
    }
}

/// One chat turn on an OpenAI-compatible engine.
pub async fn send(
    app: &AppHandle,
    chat: &Chat,
    engine: &str,
    model: &str,
    custom_url: Option<&str>,
    query: String,
    context: Option<ChatContext>,
) -> Result<ChatReply, String> {
    let p = provider(engine).ok_or(t("Motore della chat sconosciuto."))?;
    if model.trim().is_empty() {
        return Err(tf("Scegli un modello di {name} nelle impostazioni (Chat).", &[("name", &p.name)]));
    }
    let base = base_url(engine, custom_url)?;

    chat.push(user_message(chat.is_empty(), &query, context.as_ref()));
    let mut messages = vec![json!({ "role": "system", "content": crate::i18n::prompt(SYSTEM_PROMPT) })];

    messages.extend(chat.snapshot());
    let body = json!({ "model": model.trim(), "messages": messages, "stream": true });

    let on_text = |text: &str| {
        let _ = app.emit_to(crate::island::WINDOW_LABEL, "chat-stream", Stream { text });
    };
    let result = stream_turn(engine, &base, &body, &on_text).await;
    match result {
        Ok(text) if !text.trim().is_empty() => {
            chat.push(json!({ "role": "assistant", "content": text }));
            Ok(ChatReply { text })
        }
        Ok(_) => {
            chat.pop();
            Err(t("Nessun testo nella risposta.").into())
        }
        Err(e) => {
            chat.pop();
            Err(e)
        }
    }
}

/// Sends the request and reads the reply as it streams; `on_text` gets the
/// visible text so far, every STREAM_EVERY_MS at most.
async fn stream_turn(engine: &str, base: &str, body: &Value, on_text: &(dyn Fn(&str) + Sync)) -> Result<String, String> {
    let request = auth(engine, client()?.post(format!("{base}/chat/completions")).json(body))?;
    let mut response = request.send().await.map_err(|e| network_error(engine, base, e))?;
    let status = response.status();
    if !status.is_success() {
        let text = response.text().await.unwrap_or_default();
        let name = provider(engine).map(|p| p.name).unwrap_or("API");
        return Err(format!("{name} {status}: {}", error_text(&text)));
    }

    let mut raw = String::new(); // everything the model wrote, <think> included
    let mut pending = Vec::<u8>::new(); // bytes of a line not finished yet
    let mut last_emit = std::time::Instant::now();
    while let Some(chunk) = response.chunk().await.map_err(|e| network_error(engine, base, e))? {
        pending.extend_from_slice(&chunk);
        while let Some(nl) = pending.iter().position(|b| *b == b'\n') {
            let line: Vec<u8> = pending.drain(..=nl).collect();
            let line = String::from_utf8_lossy(&line);
            if let Some(err) = line.trim().strip_prefix("data:").and_then(|d| serde_json::from_str::<Value>(d.trim()).ok()).and_then(|v| v.get("error").cloned()) {
                let msg = err.get("message").and_then(Value::as_str).unwrap_or(t("errore durante la risposta"));
                return Err(msg.to_string());
            }
            if let Some(d) = delta(&line) {
                raw.push_str(&d);
                if last_emit.elapsed().as_millis() >= STREAM_EVERY_MS {
                    last_emit = std::time::Instant::now();
                    on_text(&visible(&raw));
                }
            }
        }
    }
    // A last line with no newline at the end.
    if let Some(d) = delta(&String::from_utf8_lossy(&pending)) {
        raw.push_str(&d);
    }
    Ok(visible(&raw).trim().to_string())
}

/// Impostazioni → Chat → "Carica modelli": the model ids the engine offers.
pub async fn models(engine: &str, custom_url: Option<&str>) -> Result<Vec<ModelOption>, String> {
    let base = base_url(engine, custom_url)?;
    let request = auth(engine, client()?.get(format!("{base}/models")))?;
    let response = request.send().await.map_err(|e| network_error(engine, &base, e))?;
    let status = response.status();
    let text = response.text().await.map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(format!("{status}: {}", error_text(&text)));
    }
    Ok(model_options(&text))
}

/// A model in Impostazioni → Chat, with what it costs when the engine says so.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ModelOption {
    pub id: String,
    /// "free" | "paid" | "local"; absent when the engine does not tell.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub price: Option<&'static str>,
    /// Dollars per million tokens, input and output ("0,15 $ / 0,60 $").
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cost: Option<String>,
}

/// Dollars per million tokens, as the settings show them.
pub fn per_million(input: f64, output: f64) -> String {
    let f = |x: f64| {
        let s = if x >= 10.0 { format!("{x:.0}") } else if x >= 1.0 { format!("{x:.2}") } else { format!("{x:.3}") };
        let s = if s.contains('.') { s.trim_end_matches('0').trim_end_matches('.').to_string() } else { s };
        s.replace('.', ",")
    };
    format!("{} $ / {} $", f(input), f(output))
}

/// `{"data":[{"id":…}]}` → sorted models; Gemini's names lose their "models/" prefix.
/// OpenRouter adds `pricing` (dollars per token, as strings): free or paid.
pub fn model_options(body: &str) -> Vec<ModelOption> {
    let v: Value = serde_json::from_str(body).unwrap_or_default();
    let price = |m: &Value| -> Option<(f64, f64)> {
        let p = m.get("pricing")?;
        let n = |k: &str| p.get(k).and_then(|x| x.as_str().and_then(|s| s.parse::<f64>().ok()).or_else(|| x.as_f64()));
        Some((n("prompt")?, n("completion")?))
    };
    let mut out: Vec<ModelOption> = v
        .get("data")
        .and_then(Value::as_array)
        .map(|list| {
            list.iter()
                .filter_map(|m| {
                    let id = m.get("id").and_then(Value::as_str)?;
                    let id = id.strip_prefix("models/").unwrap_or(id).to_string();
                    let (price, cost) = match price(m) {
                        Some((i, o)) if i <= 0.0 && o <= 0.0 => (Some("free"), None),
                        Some((i, o)) => (Some("paid"), Some(per_million(i * 1e6, o * 1e6))),
                        None => (None, None),
                    };
                    Some(ModelOption { id, price, cost })
                })
                .collect()
        })
        .unwrap_or_default();
    out.sort_by(|a, b| a.id.cmp(&b.id));
    out.dedup_by(|a, b| a.id == b.id);
    out
}

#[cfg(test)]
mod tests {
    /// The OpenRouter key saved on this PC, and whether it works:
    /// `cargo test --lib openai::tests::live -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_openrouter_key() {
        println!("key present: {}", crate::secrets::present("openrouter-api-key"));
        let r = tauri::async_runtime::block_on(models("openrouter", None));
        println!("models: {:?}", r.as_ref().map(|m| (m.len(), m.iter().filter(|x| x.price == Some("free")).take(3).map(|x| x.id.as_str()).collect::<Vec<_>>())));
    }

    use super::*;

    #[test]
    fn think_blocks_are_hidden_even_while_open() {
        assert_eq!(visible("<think>hmm</think>Ciao"), "Ciao");
        assert_eq!(visible("A<think>x</think> B<think>y</think>C"), "A BC");
        assert_eq!(visible("Prima<think>ancora in corso"), "Prima");
        assert_eq!(visible("Nessun ragionamento"), "Nessun ragionamento");
    }

    #[test]
    fn stream_lines_give_content_only() {
        assert_eq!(delta(r#"data: {"choices":[{"delta":{"content":"Ciao"}}]}"#).as_deref(), Some("Ciao"));
        assert_eq!(delta(r#"data: {"choices":[{"delta":{"reasoning":"penso"}}]}"#), None);
        assert_eq!(delta(r#"data: {"choices":[{"delta":{"role":"assistant","content":""}}]}"#), None);
        assert_eq!(delta("data: [DONE]"), None);
        assert_eq!(delta(": OPENROUTER PROCESSING"), None);
        assert_eq!(delta(""), None);
    }

    #[test]
    fn local_addresses_get_v1_and_must_be_http() {
        assert_eq!(base_url("ollama", None).unwrap(), "http://localhost:11434/v1");
        assert_eq!(base_url("ollama", Some("http://192.168.1.5:11434/")).unwrap(), "http://192.168.1.5:11434/v1");
        assert_eq!(base_url("lmstudio", Some("http://pc:1234/v1")).unwrap(), "http://pc:1234/v1");
        assert!(base_url("ollama", Some("file:///c:/x")).is_err());
        // A custom address never redirects a keyed provider (the key would go with it).
        assert_eq!(base_url("openai", Some("http://evil.example")).unwrap(), "https://api.openai.com/v1");
        assert!(base_url("nope", None).is_err());
    }

    #[test]
    fn model_lists_are_sorted_ids() {
        let body = r#"{"data":[{"id":"z-model"},{"id":"models/gemini-2.5-pro"},{"id":"a-model"},{"id":"a-model"}]}"#;
        let ids: Vec<String> = model_options(body).into_iter().map(|m| m.id).collect();
        assert_eq!(ids, ["a-model", "gemini-2.5-pro", "z-model"]);
        assert!(model_options("not json").is_empty());
    }

    #[test]
    fn openrouter_prices_say_free_or_paid() {
        let body = r#"{"data":[{"id":"x:free","pricing":{"prompt":"0","completion":"0"}},
            {"id":"y","pricing":{"prompt":"0.00000015","completion":"0.0000006"}},{"id":"z"}]}"#;
        let m = model_options(body);
        assert_eq!(m[0].price, Some("free"));
        assert_eq!(m[1].price, Some("paid"));
        assert_eq!(m[1].cost.as_deref(), Some("0,15 $ / 0,6 $"));
        assert_eq!(m[2].price, None);
        assert_eq!(per_million(3.0, 15.0), "3 $ / 15 $");
    }

    #[test]
    fn first_turn_carries_the_context() {
        let ctx = ChatContext::Text { label: "Testo copiato".into(), text: "errore 0x80070005".into() };
        let first = user_message(true, "Cos'è?", Some(&ctx));
        assert_eq!(first["content"][0]["text"], "Testo copiato:\nerrore 0x80070005");
        assert_eq!(first["content"][1]["text"], "Cos'è?");
        let later = user_message(false, "E poi?", Some(&ctx));
        assert_eq!(later["content"], "E poi?");
    }

    /// A one-shot local server answering with `parts`, written one by one.
    fn serve(status: &'static str, parts: Vec<&'static str>) -> String {
        use std::io::{Read, Write};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let addr = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let mut req = Vec::new();
            let mut buf = [0u8; 8192];
            while !String::from_utf8_lossy(&req).trim_end().ends_with('}') {
                let n = s.read(&mut buf).unwrap();
                if n == 0 {
                    break;
                }
                req.extend_from_slice(&buf[..n]);
            }
            write!(s, "HTTP/1.1 {status}\r\nContent-Type: text/event-stream\r\nConnection: close\r\n\r\n").unwrap();
            for p in parts {
                s.write_all(p.as_bytes()).unwrap();
                s.flush().unwrap();
                std::thread::sleep(std::time::Duration::from_millis(30));
            }
        });
        format!("http://{addr}/v1")
    }

    fn run<F: std::future::Future>(f: F) -> F::Output {
        tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap().block_on(f)
    }

    #[test]
    fn a_streamed_reply_arrives_whole_without_its_reasoning() {
        // Lines cut mid-way, a reasoning delta, a <think> block and a keep-alive.
        let base = serve("200 OK", vec![
            ": keep-alive\n\n",
            "data: {\"choices\":[{\"delta\":{\"reasoning\":\"penso\"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"<think>calcolo</think>\"}}]}\n\ndata: {\"choi",
            "ces\":[{\"delta\":{\"content\":\"Ciao \"}}]}\n\n",
            "data: {\"choices\":[{\"delta\":{\"content\":\"Edoardo!\"}}]}\n\ndata: [DONE]\n\n",
        ]);
        let seen = std::sync::Mutex::new(Vec::<String>::new());
        let on_text = |t: &str| seen.lock().unwrap().push(t.to_string());
        let body = json!({ "model": "m", "messages": [], "stream": true });
        let text = run(stream_turn("ollama", &base, &body, &on_text)).unwrap();
        assert_eq!(text, "Ciao Edoardo!");
        assert!(seen.lock().unwrap().iter().all(|t| !t.contains("calcolo") && !t.contains("penso")));
    }

    #[test]
    fn provider_errors_and_dead_servers_are_explained() {
        let base = serve("401 Unauthorized", vec!["{\"error\":{\"message\":\"Invalid API key\"}}"]);
        let body = json!({ "model": "m", "messages": [], "stream": true });
        let err = run(stream_turn("ollama", &base, &body, &|_: &str| {})).unwrap_err();
        assert!(err.contains("401") && err.contains("Invalid API key"), "{err}");
        // Nothing listening there any more.
        let dead = std::net::TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap();
        let err = run(stream_turn("ollama", &format!("http://{dead}/v1"), &body, &|_: &str| {})).unwrap_err();
        assert!(err.contains("non risponde") && err.contains("è avviato"), "{err}");
    }

    #[test]
    fn error_bodies_say_what_went_wrong() {
        assert_eq!(error_text(r#"{"error":{"message":"Invalid API key"}}"#), "Invalid API key");
        assert_eq!(error_text(r#"{"error":"model not found"}"#), "model not found");
        assert_eq!(error_text("plain"), "plain");
    }
}
