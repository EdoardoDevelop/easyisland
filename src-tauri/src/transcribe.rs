//! Audio to text, for the voice messages of Telegram (telegram.rs): with the
//! service chosen in Impostazioni → Telegram → «Vocali» (`telegramVoice`),
//! using the key already saved for that chat engine (openai.rs). Claude Code
//! and opencode take no audio, so they cannot do it. Nothing is kept: the
//! audio goes to the service and the text comes back.

use serde_json::{json, Value};

use crate::i18n::{t, tf};
use crate::secrets;

/// What can transcribe, as (setting, engine whose key it uses, name).
pub const SERVICES: &[(&str, &str, &str)] = &[
    ("gemini", "gemini-api-key", "Google AI (Gemini)"),
    ("openai", "openai-api-key", "OpenAI"),
    ("openrouter", "openrouter-api-key", "OpenRouter"),
];

const PROMPT: &str = "Transcribe this audio verbatim, in the language it is spoken. Reply with the transcription only, no comments. If nothing is said, reply with an empty string.";

fn key(service: &str) -> Result<String, String> {
    let (_, name, label) = SERVICES.iter().find(|s| s.0 == service)
        .ok_or_else(|| t("Scegli in Impostazioni → Telegram chi trascrive i vocali").to_string())?;
    secrets::get(name).ok_or_else(|| tf("Manca la chiave di {name}: mettila nelle Impostazioni della chat.", &[("name", label)]))
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().timeout(std::time::Duration::from_secs(120)).build().map_err(|e| e.to_string())
}

async fn answer(r: reqwest::Response, name: &str) -> Result<Value, String> {
    let status = r.status();
    let v: Value = r.json().await.unwrap_or(Value::Null);
    if !status.is_success() {
        let msg = v.pointer("/error/message").and_then(Value::as_str).unwrap_or("").chars().take(200).collect::<String>();
        return Err(tf("{name}: trascrizione non riuscita (HTTP {s}) {m}", &[("name", &name), ("s", &status.as_u16()), ("m", &msg)]));
    }
    Ok(v)
}

/// The words of `audio` (`mime` as Telegram gives it, e.g. audio/ogg).
/// The model used when none is chosen in the settings.
pub fn default_model(service: &str) -> &'static str {
    match service {
        "openai" => "gpt-4o-mini-transcribe",
        "openrouter" => "google/gemini-2.5-flash",
        _ => "gemini-2.5-flash",
    }
}

/// The words of `audio` (`mime` as Telegram gives it), with `model` ("" = the default).
pub async fn transcribe(service: &str, model: &str, audio: &[u8], mime: &str) -> Result<String, String> {
    let key = key(service)?;
    let model = if model.trim().is_empty() { default_model(service).to_string() } else { model.trim().to_string() };
    // Only an id: it goes into a URL (Gemini) or a form.
    if !model.chars().all(|c| c.is_ascii_alphanumeric() || "-._:/".contains(c)) || (service != "openrouter" && model.contains('/')) {
        return Err(t("Modello non valido").into());
    }
    let b64 = crate::claude::base64_for(audio);
    let text = match service {
        "gemini" => {
            let body = json!({ "contents": [{ "parts": [
                { "text": PROMPT },
                { "inline_data": { "mime_type": mime, "data": b64 } },
            ] }] });
            let r = client()?
                .post(format!("https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"))
                .header("x-goog-api-key", key)
                .json(&body).send().await.map_err(|_| t("Google AI non risponde").to_string())?;
            let v = answer(r, "Google AI").await?;
            v.pointer("/candidates/0/content/parts").and_then(Value::as_array).into_iter().flatten()
                .filter_map(|p| p.get("text").and_then(Value::as_str)).collect::<String>()
        }
        "openai" => {
            // multipart/form-data by hand: one file and the model.
            let boundary = "----easyisland-voice-7d1f";
            let ext = ext_of(mime);
            let mut body = Vec::with_capacity(audio.len() + 512);
            body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\n{model}\r\n").as_bytes());
            body.extend_from_slice(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"voice.{ext}\"\r\nContent-Type: {mime}\r\n\r\n").as_bytes());
            body.extend_from_slice(audio);
            body.extend_from_slice(format!("\r\n--{boundary}--\r\n").as_bytes());
            let r = client()?
                .post("https://api.openai.com/v1/audio/transcriptions")
                .bearer_auth(key)
                .header("Content-Type", format!("multipart/form-data; boundary={boundary}"))
                .body(body).send().await.map_err(|_| t("OpenAI non risponde").to_string())?;
            let v = answer(r, "OpenAI").await?;
            v.get("text").and_then(Value::as_str).unwrap_or("").to_string()
        }
        "openrouter" => {
            let body = json!({
                "model": model,
                "messages": [{ "role": "user", "content": [
                    { "type": "text", "text": PROMPT },
                    { "type": "input_audio", "input_audio": { "data": b64, "format": ext_of(mime) } },
                ] }],
            });
            let r = client()?
                .post("https://openrouter.ai/api/v1/chat/completions")
                .bearer_auth(key)
                .json(&body).send().await.map_err(|_| t("OpenRouter non risponde").to_string())?;
            let v = answer(r, "OpenRouter").await?;
            v.pointer("/choices/0/message/content").and_then(Value::as_str).unwrap_or("").to_string()
        }
        _ => return Err(t("Scegli in Impostazioni → Telegram chi trascrive i vocali").into()),
    };
    Ok(text.trim().trim_matches('"').trim().to_string())
}

/// The models of a service that take audio, for Impostazioni -> Telegram ->
/// «Vocali», the cheapest first. OpenRouter says which models take audio and
/// their price; Gemini lists its models (every gemini one reads audio; lite,
/// flash, pro is their price order); the OpenAI transcription models are known.
pub async fn models(service: &str) -> Result<Vec<crate::openai::ModelOption>, String> {
    use crate::openai::{per_million, ModelOption};
    let key = key(service)?;
    match service {
        "openai" => Ok([
            ("gpt-4o-mini-transcribe", "0,003 $ / min"),
            ("whisper-1", "0,006 $ / min"),
            ("gpt-4o-transcribe", "0,006 $ / min"),
        ].iter().map(|(id, c)| ModelOption { id: id.to_string(), price: Some("paid"), cost: Some(c.to_string()) }).collect()),
        "openrouter" => {
            let r = client()?.get("https://openrouter.ai/api/v1/models").bearer_auth(key).send().await
                .map_err(|_| t("OpenRouter non risponde").to_string())?;
            let v = answer(r, "OpenRouter").await?;
            let num = |m: &Value, k: &str| m.pointer(&format!("/pricing/{k}")).and_then(|x| x.as_str().and_then(|s| s.parse::<f64>().ok()).or_else(|| x.as_f64()));
            let mut list: Vec<(f64, ModelOption)> = v.get("data").and_then(Value::as_array).into_iter().flatten()
                .filter(|m| m.pointer("/architecture/input_modalities").and_then(Value::as_array)
                    .is_some_and(|a| a.iter().any(|x| x.as_str() == Some("audio"))))
                .filter_map(|m| {
                    let id = m.get("id")?.as_str()?.to_string();
                    let (i, o) = (num(m, "prompt").unwrap_or(0.0), num(m, "completion").unwrap_or(0.0));
                    // The automatic routers have no price of their own (-1).
                    if i < 0.0 || o < 0.0 {
                        return None;
                    }
                    // What the audio costs: its own price when given, else the input one.
                    let rank = num(m, "audio").filter(|a| *a > 0.0).unwrap_or(i);
                    let opt = if i <= 0.0 && o <= 0.0 {
                        ModelOption { id, price: Some("free"), cost: None }
                    } else {
                        ModelOption { id, price: Some("paid"), cost: Some(per_million(i * 1e6, o * 1e6)) }
                    };
                    Some((rank, opt))
                })
                .collect();
            list.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal).then(a.1.id.cmp(&b.1.id)));
            Ok(list.into_iter().map(|x| x.1).collect())
        }
        "gemini" => {
            let r = client()?.get("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200").header("x-goog-api-key", key).send().await
                .map_err(|_| t("Google AI non risponde").to_string())?;
            let v = answer(r, "Google AI").await?;
            let mut list: Vec<(u8, String)> = v.get("models").and_then(Value::as_array).into_iter().flatten()
                .filter(|m| m.get("supportedGenerationMethods").and_then(Value::as_array)
                    .is_some_and(|a| a.iter().any(|x| x.as_str() == Some("generateContent"))))
                .filter_map(|m| m.get("name").and_then(Value::as_str).map(|n| n.trim_start_matches("models/").to_string()))
                .filter(|n| n.starts_with("gemini-") && !["image", "tts", "embedding", "live", "native-audio", "computer-use"].iter().any(|w| n.contains(w)))
                .map(|n| (if n.contains("lite") { 0 } else if n.contains("flash") { 1 } else { 2 }, n))
                .collect();
            // Cheapest kind first, the newest of each first.
            list.sort_by(|a, b| a.0.cmp(&b.0).then(b.1.cmp(&a.1)));
            Ok(list.into_iter().map(|(_, id)| ModelOption { id, price: None, cost: None }).collect())
        }
        _ => Err(t("Scegli in Impostazioni → Telegram chi trascrive i vocali").into()),
    }
}

/// The file extension for an audio type (Telegram's voice notes are Opus in Ogg).
fn ext_of(mime: &str) -> &'static str {
    match mime.split(';').next().unwrap_or("").trim() {
        "audio/mpeg" | "audio/mp3" => "mp3",
        "audio/mp4" | "audio/x-m4a" | "audio/m4a" | "audio/aac" => "m4a",
        "audio/wav" | "audio/x-wav" => "wav",
        "audio/flac" => "flac",
        "audio/webm" => "webm",
        _ => "ogg",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn audio_types_get_an_extension() {
        assert_eq!(ext_of("audio/ogg"), "ogg");
        assert_eq!(ext_of("audio/mpeg"), "mp3");
        assert_eq!(ext_of("audio/x-m4a"), "m4a");
        assert_eq!(ext_of(""), "ogg");
    }

    #[test]
    fn unknown_service_asks_for_the_setting() {
        assert!(key("claude").is_err());
        assert!(key("").is_err());
    }
}
