//! Text to audio, for the replies of Telegram to a voice message (telegram.rs):
//! with the service of «Vocali» (transcribe.rs), when it can speak, and its key.
//!   * OpenAI: /v1/audio/speech gives Ogg/Opus, a voice note as it is.
//!   * Google AI: a TTS model gives raw PCM (24 kHz, 16 bit, mono); Media
//!     Foundation turns it into AAC in .m4a, which Telegram takes as a voice
//!     note too. Nothing to install.
//!   * OpenRouter has no voice: the reply stays written.
//! Only the spoken words go to the service; the audio is not kept.

use serde_json::{json, Value};

use crate::i18n::{t, tf};
use crate::secrets;

/// About a minute and a half spoken: the rest stays in the written reply.
const MAX_SPOKEN: usize = 1200;
const OPENAI_MODEL: &str = "gpt-4o-mini-tts";
const OPENAI_VOICE: &str = "coral";
const GEMINI_MODEL: &str = "gemini-2.5-flash-preview-tts";
const GEMINI_VOICE: &str = "Kore";
const GEMINI_RATE: u32 = 24_000;

/// Can the service of «Vocali» speak.
pub fn speaks(service: &str) -> bool {
    matches!(service, "openai" | "gemini")
}

/// A voice note: its bytes and the file name that tells Telegram the format.
pub struct Voice {
    pub bytes: Vec<u8>,
    pub file: &'static str,
}

/// `text` (a chat reply, in Markdown) read aloud by `service`.
pub async fn speak(service: &str, text: &str) -> Result<Voice, String> {
    let words = spoken(text);
    if words.is_empty() {
        return Err(t("Nella risposta non c'è niente da leggere.").into());
    }
    match service {
        "openai" => {
            let key = secrets::get("openai-api-key").ok_or_else(|| missing("OpenAI"))?;
            let body = json!({
                "model": OPENAI_MODEL, "voice": OPENAI_VOICE, "input": words, "response_format": "opus",
                "instructions": "Speak naturally and warmly, at a relaxed pace, in the language of the text.",
            });
            let r = client()?.post("https://api.openai.com/v1/audio/speech").bearer_auth(key).json(&body).send().await
                .map_err(|_| t("OpenAI non risponde").to_string())?;
            if !r.status().is_success() {
                return Err(failed("OpenAI", r).await);
            }
            let bytes = r.bytes().await.map_err(|e| e.to_string())?.to_vec();
            Ok(Voice { bytes, file: "risposta.ogg" })
        }
        "gemini" => {
            let key = secrets::get("gemini-api-key").ok_or_else(|| missing("Google AI"))?;
            let mut model = GEMINI_MODEL.to_string();
            let mut r = gemini(&key, &model, &words).await?;
            // The preview name may be gone: the newest flash TTS model listed.
            if r.status().as_u16() == 404 {
                if let Some(m) = gemini_tts_model(&key).await {
                    model = m;
                    r = gemini(&key, &model, &words).await?;
                }
            }
            if !r.status().is_success() {
                return Err(failed("Google AI", r).await);
            }
            let v: Value = r.json().await.unwrap_or(Value::Null);
            let b64 = v.pointer("/candidates/0/content/parts").and_then(Value::as_array).into_iter().flatten()
                .find_map(|p| p.pointer("/inlineData/data").and_then(Value::as_str))
                .ok_or_else(|| t("Google AI non ha mandato l'audio.").to_string())?;
            let pcm = crate::backup::base64_decode(b64).ok_or_else(|| t("Google AI non ha mandato l'audio.").to_string())?;
            let bytes = tauri::async_runtime::spawn_blocking(move || m4a(&pcm, GEMINI_RATE))
                .await
                .map_err(|e| e.to_string())??;
            Ok(Voice { bytes, file: "risposta.m4a" })
        }
        _ => Err(t("OpenRouter non sa parlare: per le risposte a voce scegli Google AI o OpenAI in Impostazioni → Telegram → Vocali.").into()),
    }
}

fn client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder().timeout(std::time::Duration::from_secs(120)).build().map_err(|e| e.to_string())
}

fn missing(name: &str) -> String {
    tf("Manca la chiave di {name}: mettila nelle Impostazioni della chat.", &[("name", &name)])
}

async fn failed(name: &str, r: reqwest::Response) -> String {
    let status = r.status().as_u16();
    let v: Value = r.json().await.unwrap_or(Value::Null);
    let msg = v.pointer("/error/message").and_then(Value::as_str).unwrap_or("").chars().take(200).collect::<String>();
    tf("{name}: voce non riuscita (HTTP {s}) {m}", &[("name", &name), ("s", &status), ("m", &msg)])
}

async fn gemini(key: &str, model: &str, words: &str) -> Result<reqwest::Response, String> {
    let body = json!({
        "contents": [{ "parts": [{ "text": words }] }],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": { "voiceConfig": { "prebuiltVoiceConfig": { "voiceName": GEMINI_VOICE } } },
        },
    });
    client()?
        .post(format!("https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"))
        .header("x-goog-api-key", key)
        .json(&body).send().await.map_err(|_| t("Google AI non risponde").to_string())
}

/// The newest Gemini text-to-speech model, flash before pro.
async fn gemini_tts_model(key: &str) -> Option<String> {
    let r = client().ok()?.get("https://generativelanguage.googleapis.com/v1beta/models?pageSize=200")
        .header("x-goog-api-key", key).send().await.ok()?;
    let v: Value = r.json().await.ok()?;
    let mut names: Vec<String> = v.get("models")?.as_array()?.iter()
        .filter_map(|m| m.get("name").and_then(Value::as_str).map(|n| n.trim_start_matches("models/").to_string()))
        .filter(|n| n.starts_with("gemini-") && n.contains("tts"))
        .collect();
    names.sort_by(|a, b| b.contains("flash").cmp(&a.contains("flash")).then(b.cmp(a)));
    names.into_iter().next()
}

/// What is read aloud: the reply without Markdown, code, links' addresses
/// and tables, cut at the end of a sentence when it is long.
pub fn spoken(md: &str) -> String {
    let mut out = String::new();
    let mut in_code = false;
    for line in md.lines() {
        let l = line.trim();
        if l.starts_with("```") {
            in_code = !in_code;
            continue;
        }
        if in_code || l.starts_with('|') || l.chars().all(|c| "-*_=".contains(c)) && !l.is_empty() {
            continue;
        }
        let l = l.trim_start_matches(['#', '>', ' ']);
        let l = l.strip_prefix("- ").or_else(|| l.strip_prefix("* ")).unwrap_or(l);
        out.push_str(&unlink(l));
        out.push(if l.is_empty() { '\n' } else { ' ' });
    }
    let clean: String = out.chars().filter(|c| !"*_`~".contains(*c)).collect();
    let mut words = clean.split_whitespace().collect::<Vec<_>>().join(" ");
    if words.chars().count() > MAX_SPOKEN {
        let cut: String = words.chars().take(MAX_SPOKEN).collect();
        let end = cut.rfind(['.', '!', '?']).map(|i| i + 1).unwrap_or(cut.len());
        words = format!("{} {}", cut.get(..end).unwrap_or(&cut).trim_end(), t("Il resto è nel messaggio scritto."));
    }
    words
}

/// `[label](url)` → label; a bare address is left out.
fn unlink(line: &str) -> String {
    let mut out = String::new();
    let mut rest = line;
    while let Some(open) = rest.find('[') {
        let (before, after) = rest.split_at(open);
        out.push_str(before);
        // Every index below is of an ASCII bracket: always a char boundary.
        let parsed = after.find("](").and_then(|mid| after.get(mid..)?.find(')').map(|close| (mid, mid + close)));
        match parsed.and_then(|(mid, close)| Some((after.get(1..mid)?, after.get(close + 1..)?))) {
            Some((label, next)) => {
                out.push_str(label);
                rest = next;
            }
            None => {
                out.push('[');
                rest = after.get(1..).unwrap_or("");
            }
        }
    }
    out.push_str(rest);
    out.split(' ').filter(|w| !w.starts_with("http://") && !w.starts_with("https://")).collect::<Vec<_>>().join(" ")
}

/// Raw 16-bit mono PCM at `rate` to AAC in .m4a, by Media Foundation. The AAC
/// encoder takes 44.1 or 48 kHz only: 24 kHz is doubled on the way.
fn m4a(pcm: &[u8], rate: u32) -> Result<Vec<u8>, String> {
    use windows::core::HSTRING;
    use windows::Win32::Media::MediaFoundation::*;
    use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};

    let samples: Vec<i16> = pcm.chunks_exact(2).map(|b| i16::from_le_bytes([b[0], b[1]])).collect();
    let (samples, rate) = if rate == 24_000 { (double(&samples), 48_000) } else { (samples, rate) };
    let path = std::env::temp_dir().join(format!("easyisland-voce-{}.m4a", std::process::id()));
    let result = unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        struct Com;
        impl Drop for Com {
            fn drop(&mut self) {
                unsafe {
                    let _ = MFShutdown();
                    CoUninitialize();
                }
            }
        }
        (|| -> Result<(), String> {
            MFStartup(MF_VERSION, MFSTARTUP_FULL).map_err(|e| e.to_string())?;
            let _com = Com;
            let kind = |sub: &windows::core::GUID| -> Result<IMFMediaType, String> {
                let mt = MFCreateMediaType().map_err(|e| e.to_string())?;
                mt.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Audio).map_err(|e| e.to_string())?;
                mt.SetGUID(&MF_MT_SUBTYPE, sub).map_err(|e| e.to_string())?;
                mt.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, 1).map_err(|e| e.to_string())?;
                mt.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, rate).map_err(|e| e.to_string())?;
                mt.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16).map_err(|e| e.to_string())?;
                Ok(mt)
            };
            let out = kind(&MFAudioFormat_AAC)?;
            // 96 kbps: one of the rates the AAC encoder accepts.
            out.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, 12_000).map_err(|e| e.to_string())?;
            let input = kind(&MFAudioFormat_PCM)?;
            input.SetUINT32(&MF_MT_AUDIO_BLOCK_ALIGNMENT, 2).map_err(|e| e.to_string())?;
            input.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, rate * 2).map_err(|e| e.to_string())?;
            let writer = MFCreateSinkWriterFromURL(&HSTRING::from(path.as_os_str()), None, None)
                .map_err(|e| tf("Codifica audio non disponibile: {e}", &[("e", &e)]))?;
            let stream = writer.AddStream(&out).map_err(|e| tf("Codifica audio non disponibile: {e}", &[("e", &e)]))?;
            writer.SetInputMediaType(stream, &input, None).map_err(|e| tf("Codifica audio non disponibile: {e}", &[("e", &e)]))?;
            writer.BeginWriting().map_err(|e| e.to_string())?;
            // Half a second at a time.
            let step = rate as usize / 2;
            for (i, block) in samples.chunks(step).enumerate() {
                let bytes = std::slice::from_raw_parts(block.as_ptr() as *const u8, block.len() * 2);
                let t0 = (i * step) as i64 * 10_000_000 / rate as i64;
                let dur = block.len() as i64 * 10_000_000 / rate as i64;
                let buffer = MFCreateMemoryBuffer(bytes.len() as u32).map_err(|e| e.to_string())?;
                let mut ptr: *mut u8 = std::ptr::null_mut();
                buffer.Lock(&mut ptr, None, None).map_err(|e| e.to_string())?;
                std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
                buffer.Unlock().map_err(|e| e.to_string())?;
                buffer.SetCurrentLength(bytes.len() as u32).map_err(|e| e.to_string())?;
                let sample = MFCreateSample().map_err(|e| e.to_string())?;
                sample.AddBuffer(&buffer).map_err(|e| e.to_string())?;
                sample.SetSampleTime(t0).map_err(|e| e.to_string())?;
                sample.SetSampleDuration(dur).map_err(|e| e.to_string())?;
                writer.WriteSample(stream, &sample).map_err(|e| e.to_string())?;
            }
            writer.Finalize().map_err(|e| e.to_string())
        })()
    };
    let bytes = result.and_then(|()| std::fs::read(&path).map_err(|e| e.to_string()));
    let _ = std::fs::remove_file(&path);
    bytes
}

/// Twice the samples, each new one halfway between its neighbours.
fn double(s: &[i16]) -> Vec<i16> {
    let mut out = Vec::with_capacity(s.len() * 2);
    for (i, &a) in s.iter().enumerate() {
        let b = s.get(i + 1).copied().unwrap_or(a);
        out.push(a);
        out.push(((a as i32 + b as i32) / 2) as i16);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markdown_is_read_as_words() {
        let md = "## Fatto\n\nHo **aggiornato** il file `a.txt`.\n\n```rust\nfn main() {}\n```\n- Vedi [la guida](https://x.it/g) o https://x.it\n\n| a | b |\n|---|---|";
        assert_eq!(spoken(md), "Fatto Ho aggiornato il file a.txt. Vedi la guida o");
    }

    #[test]
    fn long_replies_stop_at_a_sentence() {
        let md = "Una frase breve. ".repeat(200);
        let s = spoken(&md);
        assert!(s.chars().count() < MAX_SPOKEN + 60);
        assert!(s.ends_with(t("Il resto è nel messaggio scritto.")));
        assert!(s.contains("breve. Il resto"));
    }

    #[test]
    fn a_bracket_alone_stays() {
        assert_eq!(unlink("a [b c"), "a [b c");
        assert_eq!(unlink("[x](y) e [z](w)"), "x e z");
    }

    #[test]
    fn doubling_interpolates() {
        assert_eq!(double(&[0, 100]), vec![0, 50, 100, 100]);
        assert!(double(&[]).is_empty());
    }

    #[test]
    fn only_some_services_speak() {
        assert!(speaks("openai") && speaks("gemini"));
        assert!(!speaks("openrouter") && !speaks(""));
    }

    /// Real: a short sentence through the AAC encoder, checked as an MP4 file.
    #[test]
    fn pcm_becomes_m4a() {
        let pcm: Vec<u8> = (0..24_000).flat_map(|i| (((i as f32 * 0.05).sin() * 8000.0) as i16).to_le_bytes()).collect();
        let bytes = m4a(&pcm, 24_000).expect("encoder");
        assert!(bytes.len() > 1000);
        assert_eq!(bytes.get(4..8), Some(&b"ftyp"[..]));
    }
}
