//! «Parla» (asked by Edoardo on 31 October 2026, towards an assistant «alla
//! Jarvis»): a shortcut (`hotkeyTalk`, Win+Alt+V) or a click starts listening
//! to the microphone, and the island shows it all the time; it stops on the
//! shortcut again, on «Fine», after a second and a half of silence once you
//! spoke, or after a minute. Never listening otherwise: an always-on
//! microphone in an office was excluded (docs/decisioni.md).
//!
//! The sound (WASAPI, record.rs) becomes 16 kHz mono WAV in memory and goes
//! to the service of «Vocali» (transcribe.rs, the same as Telegram's); the
//! words go to the island's chat as a question. With «Rispondi a voce»
//! (`talkReply`) the reply is read aloud by speech.rs and played by the
//! island. Nothing is kept on disk.

use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant};

use serde_json::json;
use tauri::{AppHandle, Emitter, Manager};
use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};

use crate::i18n::t;
use crate::record::{CHANNELS, RATE};

static ON: AtomicBool = AtomicBool::new(false);
static STOP: AtomicBool = AtomicBool::new(false);
static CANCEL: AtomicBool = AtomicBool::new(false);

const MAX_LEN: Duration = Duration::from_secs(60);
/// Silence after speaking that ends the question.
const SILENCE_END: Duration = Duration::from_millis(1500);
/// Nothing said at all: give up.
const NO_SPEECH: Duration = Duration::from_secs(8);
const OUT_RATE: u32 = 16_000;
/// Below this the sound is never speech (RMS of 16-bit samples, about −40 dBFS).
const MIN_VOICE: f32 = 320.0;

fn emit(app: &AppHandle, payload: serde_json::Value) {
    let _ = app.emit("talk", payload);
}

fn service(app: &AppHandle) -> (String, String) {
    app.try_state::<crate::Shared>()
        .map(|s| {
            let s = s.settings.lock().unwrap();
            (s.integration_config.telegram_voice.clone(), s.integration_config.telegram_voice_model.clone())
        })
        .unwrap_or_default()
}

/// The shortcut or the island's button: starts listening, or ends the question
/// when already listening. Ok(true) = listening now.
pub fn toggle(app: AppHandle) -> Result<bool, String> {
    if ON.load(Ordering::SeqCst) {
        STOP.store(true, Ordering::SeqCst);
        return Ok(false);
    }
    if service(&app).0.is_empty() {
        return Err(t("Per parlare con l'isola scegli chi trascrive in Impostazioni → Telegram → Vocali (OpenAI, Google AI o OpenRouter).").into());
    }
    if ON.swap(true, Ordering::SeqCst) {
        return Ok(false);
    }
    STOP.store(false, Ordering::SeqCst);
    CANCEL.store(false, Ordering::SeqCst);
    std::thread::spawn(move || {
        let result = unsafe { listen(&app) };
        ON.store(false, Ordering::SeqCst);
        if CANCEL.load(Ordering::SeqCst) {
            emit(&app, json!({ "state": "idle" }));
            return;
        }
        match result {
            Ok(Some(pcm)) => {
                emit(&app, json!({ "state": "hearing" }));
                tauri::async_runtime::spawn(async move {
                    let (service, model) = service(&app);
                    let audio = wav(&pcm, OUT_RATE);
                    match crate::transcribe::transcribe(&service, &model, &audio, "audio/wav").await {
                        Ok(words) if !words.trim().is_empty() => emit(&app, json!({ "state": "heard", "words": words })),
                        Ok(_) => emit(&app, json!({ "state": "error", "message": t("Non ho sentito parole.") })),
                        Err(e) => emit(&app, json!({ "state": "error", "message": e })),
                    }
                });
            }
            Ok(None) => emit(&app, json!({ "state": "error", "message": t("Non ho sentito niente: parla dopo il segnale, vicino al microfono.") })),
            Err(e) => emit(&app, json!({ "state": "error", "message": e })),
        }
    });
    Ok(true)
}

/// «Annulla» (or Esc): stops and throws the sound away.
pub fn cancel() {
    CANCEL.store(true, Ordering::SeqCst);
    STOP.store(true, Ordering::SeqCst);
}

/// The microphone until one of the ends; None if nobody spoke.
unsafe fn listen(app: &AppHandle) -> Result<Option<Vec<i16>>, String> {
    let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
    struct Com;
    impl Drop for Com {
        fn drop(&mut self) {
            unsafe { CoUninitialize() };
        }
    }
    let _com = Com;
    let mut src = crate::record::open_source(false)?;
    emit(app, json!({ "state": "listening", "level": 0.0 }));

    let start = Instant::now();
    let mut mono: Vec<i16> = Vec::with_capacity((RATE * 10) as usize);
    let mut gate = Gate::default();
    let mut last_level = Instant::now();
    let mut level = 0f32;
    loop {
        std::thread::sleep(Duration::from_millis(30));
        crate::record::drain(&mut src);
        let samples: Vec<i16> = src.queue.drain(..).collect();
        let batch = to_mono(&samples, CHANNELS as usize);
        if !batch.is_empty() {
            let r = rms(&batch);
            gate.feed(r, start.elapsed());
            level = level.max((r / 6000.0).min(1.0));
            mono.extend_from_slice(&batch);
        }
        if last_level.elapsed() >= Duration::from_millis(100) {
            emit(app, json!({ "state": "listening", "level": level, "spoke": gate.spoke }));
            level = 0.0;
            last_level = Instant::now();
        }
        let now = start.elapsed();
        if STOP.load(Ordering::SeqCst) || now >= MAX_LEN || gate.done(now) {
            break;
        }
    }
    let _ = src.client.Stop();
    if !gate.spoke {
        return Ok(None);
    }
    Ok(Some(downsample(&mono, (RATE / OUT_RATE) as usize)))
}

/// When speech started and ended, from the loudness of each batch: the noise
/// floor is the quietest batch so far, speech is well above it.
#[derive(Default)]
struct Gate {
    floor: Option<f32>,
    spoke: bool,
    last_voice: Duration,
}

impl Gate {
    fn feed(&mut self, rms: f32, at: Duration) {
        let floor = self.floor.map_or(rms, |f| f.min(rms)).max(1.0);
        self.floor = Some(floor);
        if rms >= MIN_VOICE.max(floor * 4.0) {
            self.spoke = true;
            self.last_voice = at;
        }
    }

    fn done(&self, now: Duration) -> bool {
        if self.spoke {
            now.saturating_sub(self.last_voice) >= SILENCE_END
        } else {
            now >= NO_SPEECH
        }
    }
}

fn to_mono(samples: &[i16], channels: usize) -> Vec<i16> {
    if channels <= 1 {
        return samples.to_vec();
    }
    samples.chunks_exact(channels).map(|f| (f.iter().map(|&s| s as i32).sum::<i32>() / channels as i32) as i16).collect()
}

fn rms(samples: &[i16]) -> f32 {
    if samples.is_empty() {
        return 0.0;
    }
    let sum: f64 = samples.iter().map(|&s| (s as f64) * (s as f64)).sum();
    (sum / samples.len() as f64).sqrt() as f32
}

/// Every `n` samples averaged into one (48 kHz → 16 kHz: speech is below 8 kHz).
fn downsample(samples: &[i16], n: usize) -> Vec<i16> {
    if n <= 1 {
        return samples.to_vec();
    }
    samples.chunks(n).map(|c| (c.iter().map(|&s| s as i32).sum::<i32>() / c.len() as i32) as i16).collect()
}

/// 16-bit mono PCM as a WAV file.
fn wav(pcm: &[i16], rate: u32) -> Vec<u8> {
    let data_len = (pcm.len() * 2) as u32;
    let mut out = Vec::with_capacity(44 + data_len as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + data_len).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes()); // PCM
    out.extend_from_slice(&1u16.to_le_bytes()); // mono
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&data_len.to_le_bytes());
    for s in pcm {
        out.extend_from_slice(&s.to_le_bytes());
    }
    out
}

/// A reply read aloud, for the island to play.
#[derive(serde::Serialize)]
pub struct Spoken {
    /// Base64 of the audio.
    pub data: String,
    pub mime: &'static str,
}

/// `text` (a chat reply) read aloud with the service of «Vocali».
pub async fn speak(app: &AppHandle, text: &str) -> Result<Spoken, String> {
    let (service, _) = service(app);
    let voice = crate::speech::speak(&service, text).await?;
    let mime = if voice.file.ends_with(".m4a") { "audio/mp4" } else { "audio/ogg" };
    Ok(Spoken { data: crate::claude::base64_for(&voice.bytes), mime })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn speech_starts_above_the_noise_and_ends_in_silence() {
        let ms = Duration::from_millis;
        let mut g = Gate::default();
        g.feed(150.0, ms(30));
        g.feed(200.0, ms(60));
        assert!(!g.spoke && !g.done(ms(60)));
        g.feed(2500.0, ms(500));
        assert!(g.spoke);
        g.feed(160.0, ms(1500));
        assert!(!g.done(ms(1500)));
        assert!(g.done(ms(2000)));
        assert!(Gate::default().done(NO_SPEECH));
    }

    #[test]
    fn the_sound_becomes_a_small_wav() {
        assert_eq!(to_mono(&[100, 300, -50, 50], 2), vec![200, 0]);
        assert_eq!(downsample(&[3, 3, 3, 9, 9, 9, 1], 3), vec![3, 9, 1]);
        assert!((rms(&[3, -3, 3, -3]) - 3.0).abs() < 1e-6);
        let w = wav(&[1, -1], 16_000);
        assert_eq!(w.len(), 48);
        assert_eq!(&w[..4], b"RIFF");
        assert_eq!(&w[36..40], b"data");
        assert_eq!(u32::from_le_bytes([w[24], w[25], w[26], w[27]]), 16_000);
    }
}
