// La giornata (docs/agenti.md → Riepilogo del giorno; decided with Edoardo on
// 31 Oct 2026): the hours of the morning and end-of-day recap are kept here,
// so they come even with nobody at the island and reach Telegram on time.
//
// At the hour (`due`): the island is told ("daily-due", src/island/daily.ts
// opens its card when the user is free); with `dailyAi` an engine writes the
// summary of the day from the integrations (the same question as /oggi and
// /domani, `telegram::day_prompt`), kept for the card; with `dailyTelegram`
// it goes to the linked chat with the agents' time. Each hour once a day
// (`giornata.json`), never again after a restart. Nothing polls: one sleep
// until the next hour, at most `MAX_SLEEP` (a PC that slept wakes it late).

use std::time::Duration;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager};
use tokio::sync::Mutex as AsyncMutex;

use crate::i18n::{t, tf};

const MORNING_FROM: u32 = 8;
const MORNING_UNTIL: u32 = 13;
const MAX_SLEEP: Duration = Duration::from_secs(30 * 60);
/// After the app starts, before a missed hour is caught up.
const FIRST_LOOK: Duration = Duration::from_secs(60);

/// The summary written by the engine, for the card.
#[derive(Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DayText {
    /// "morning" / "evening".
    pub which: String,
    /// YYYY-MM-DD of the day it was written.
    pub day: String,
    pub text: String,
    /// Why there is no text (the engine failed), for the card.
    pub error: String,
    /// Being written now.
    pub busy: bool,
}

#[derive(Default, Serialize, Deserialize)]
struct Marks {
    #[serde(default)]
    morning: String,
    #[serde(default)]
    evening: String,
    #[serde(default)]
    last: DayText,
}

static STATE: std::sync::Mutex<Option<Marks>> = std::sync::Mutex::new(None);
/// One summary written at a time.
static WRITING: AsyncMutex<()> = AsyncMutex::const_new(());

fn file() -> std::path::PathBuf {
    crate::settings::config_dir().join("giornata.json")
}

fn with<R>(f: impl FnOnce(&mut Marks) -> R) -> R {
    let mut guard = STATE.lock().unwrap();
    let m = guard.get_or_insert_with(|| std::fs::read(file()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default());
    f(m)
}

fn save(m: &Marks) {
    if let Ok(b) = serde_json::to_vec(m) {
        let _ = crate::settings::write_atomic(&file(), &b);
    }
}

/// Local (YYYY-MM-DD, hour, minute, seconds since local midnight).
fn local_now() -> (String, u32, u32, i64) {
    let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    let secs = t.wHour as i64 * 3600 + t.wMinute as i64 * 60 + t.wSecond as i64;
    (format!("{:04}-{:02}-{:02}", t.wYear, t.wMonth, t.wDay), t.wHour as u32, t.wMinute as u32, secs)
}

struct Wants {
    morning: bool,
    evening: bool,
    evening_hour: u32,
    engine: String,
    telegram: bool,
}

fn wants(app: &AppHandle) -> Option<Wants> {
    let shared = app.try_state::<crate::Shared>()?;
    let s = shared.settings.lock().unwrap();
    let recap = s.daily_recap.as_str();
    let engine = match s.daily_ai.as_str() {
        "" => String::new(),
        "memory" if !s.memory_engine.is_empty() => s.memory_engine.clone(),
        "memory" | "chat" => s.chat_engine.clone(),
        other => other.to_string(),
    };
    Some(Wants {
        morning: recap == "both" || recap == "morning",
        evening: recap == "both" || recap == "evening",
        evening_hour: (s.evening_hour.round() as u32).clamp(12, 23),
        engine,
        telegram: s.daily_telegram,
    })
}

/// Which recap is due at `hour` of `today`, given the days each last came.
fn due(w: &Wants, today: &str, hour: u32, morning: &str, evening: &str) -> Option<&'static str> {
    if w.evening && hour >= w.evening_hour && evening != today {
        return Some("evening");
    }
    if w.morning && (MORNING_FROM..MORNING_UNTIL).contains(&hour) && morning != today {
        return Some("morning");
    }
    None
}

/// Seconds until the next 8:00 or end-of-day hour, at most `MAX_SLEEP`.
fn until_next(evening_hour: u32, secs_now: i64) -> Duration {
    let marks = [MORNING_FROM as i64 * 3600, evening_hour as i64 * 3600, 86_400 + MORNING_FROM as i64 * 3600];
    let next = marks.iter().map(|m| m + 5 - secs_now).find(|d| *d > 0).unwrap_or(1);
    Duration::from_secs(next as u64).min(MAX_SLEEP)
}

/// Started once with the app.
pub fn start(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_LOOK).await;
        loop {
            tick(&app).await;
            let evening = wants(&app).map_or(18, |w| w.evening_hour);
            tokio::time::sleep(until_next(evening, local_now().3)).await;
        }
    });
}

async fn tick(app: &AppHandle) {
    let Some(w) = wants(app) else { return };
    let (today, hour, _, _) = local_now();
    let which = with(|m| due(&w, &today, hour, &m.morning, &m.evening));
    let Some(which) = which else { return };
    // Marked first: a failed engine is not retried every half hour.
    with(|m| {
        if which == "morning" { m.morning = today.clone() } else { m.evening = today.clone() }
        save(m);
    });
    crate::log::line(format!("giornata: {which}"));
    let _ = app.emit_to(crate::island::WINDOW_LABEL, "daily-due", which);
    let text = if w.engine.is_empty() { None } else { write(app, which, &w.engine).await.ok() };
    if w.telegram && crate::telegram::linked(app) {
        crate::telegram::tell(app, &telegram_text(which, text.as_deref())).await;
    }
}

/// The engine's summary of today (morning) or tomorrow (evening), kept for the card.
async fn write(app: &AppHandle, which: &str, engine: &str) -> Result<String, String> {
    let _one = WRITING.lock().await;
    let (today, ..) = local_now();
    if let Some(done) = with(|m| (m.last.which == which && m.last.day == today && !m.last.text.is_empty()).then(|| m.last.text.clone())) {
        return Ok(done);
    }
    set_last(app, DayText { which: which.into(), day: today.clone(), busy: true, ..Default::default() });
    let chat = crate::claude::Chat::default();
    let reply = crate::chat_turn(app, &chat, crate::telegram::day_prompt(which == "evening"), None, Some(engine.to_string()), None, false, crate::Channel::Helper, &|_| {}).await;
    if engine == "opencode" {
        crate::opencode::forget(chat.cli_session());
    }
    let out = reply.map(|r| r.text.trim().to_string()).and_then(|t| if t.is_empty() { Err(crate::i18n::t("Il motore non ha risposto.").to_string()) } else { Ok(t) });
    match &out {
        Ok(text) => set_last(app, DayText { which: which.into(), day: today, text: text.clone(), ..Default::default() }),
        Err(e) => {
            crate::log::line(format!("giornata: riassunto non riuscito: {e}"));
            set_last(app, DayText { which: which.into(), day: today, error: e.clone(), ..Default::default() });
        }
    }
    out
}

fn set_last(app: &AppHandle, d: DayText) {
    with(|m| {
        m.last = d;
        save(m);
    });
    let _ = app.emit_to(crate::island::WINDOW_LABEL, "daily-ai", ());
}

/// "☀️ Buongiorno" + the summary + the agents' time.
fn telegram_text(which: &str, ai: Option<&str>) -> String {
    let morning = which == "morning";
    let mut out = if morning { format!("☀️ {}", t("Buongiorno")) } else { format!("🌙 {}", t("Fine giornata")) };
    if let Some(text) = ai {
        out.push_str("\n\n");
        out.push_str(text);
    }
    out.push_str("\n\n");
    out.push_str(&agents_line(morning));
    out
}

/// The agents' time yesterday (morning) or today (evening), in one line.
fn agents_line(morning: bool) -> String {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or_default();
    let midnight = now - local_now().3;
    let (from, to) = if morning { (midnight - 86_400, midnight) } else { (midnight, now + 1) };
    let turns: Vec<(i64, i64)> = crate::recap::recap_history(from).turns.iter()
        .filter(|t| t.start >= from && t.start < to)
        .map(|t| (t.start, t.end))
        .collect();
    let minutes = merged_seconds(&turns) / 60;
    if minutes == 0 {
        return if morning { t("Ieri nessun agente al lavoro.").into() } else { t("Oggi nessun agente al lavoro.").into() };
    }
    let time = if minutes >= 60 { format!("{} h {:02} min", minutes / 60, minutes % 60) } else { format!("{minutes} min") };
    let n = turns.len().to_string();
    if morning {
        tf("⏱ Agenti al lavoro ieri: {time} in {n} sessioni.", &[("time", &time), ("n", &n)])
    } else {
        tf("⏱ Agenti al lavoro oggi: {time} in {n} sessioni.", &[("time", &time), ("n", &n)])
    }
}

/// Seconds covered by the turns, overlaps counted once (recap.ts `mergedSeconds`).
fn merged_seconds(turns: &[(i64, i64)]) -> i64 {
    let mut sorted: Vec<(i64, i64)> = turns.iter().copied().filter(|(s, e)| e > s).collect();
    sorted.sort_unstable();
    let (mut total, mut start, mut end) = (0, 0, i64::MIN);
    for (s, e) in sorted {
        if s <= end {
            end = end.max(e);
        } else {
            if end > start {
                total += end - start;
            }
            (start, end) = (s, e);
        }
    }
    if end > start {
        total += end - start;
    }
    total
}

/// The card's summary: the one kept, if it is for this recap and today.
pub fn text_for(which: &str) -> Option<DayText> {
    let (today, ..) = local_now();
    with(|m| (m.last.which == which && m.last.day == today).then(|| m.last.clone()))
}

/// «Chiedi il riassunto» on the card: written now with the chosen engine.
pub async fn write_now(app: &AppHandle, which: &str) -> Result<(), String> {
    let engine = wants(app).map(|w| w.engine).unwrap_or_default();
    if engine.is_empty() {
        return Err(t("Scegli un motore per il riassunto in Impostazioni → Agenti di codice → Riepilogo giornaliero.").into());
    }
    write(app, if which == "evening" { "evening" } else { "morning" }, &engine).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn w(morning: bool, evening: bool) -> Wants {
        Wants { morning, evening, evening_hour: 18, engine: String::new(), telegram: false }
    }

    #[test]
    fn due_once_a_day_in_its_hours() {
        let both = w(true, true);
        assert_eq!(due(&both, "2026-10-31", 7, "", ""), None);
        assert_eq!(due(&both, "2026-10-31", 8, "", ""), Some("morning"));
        assert_eq!(due(&both, "2026-10-31", 9, "2026-10-31", ""), None);
        assert_eq!(due(&both, "2026-10-31", 13, "", ""), None, "the morning one stops at 13");
        assert_eq!(due(&both, "2026-10-31", 18, "2026-10-31", ""), Some("evening"));
        assert_eq!(due(&both, "2026-10-31", 22, "", "2026-10-31"), None);
        assert_eq!(due(&w(false, true), "2026-10-31", 9, "", ""), None);
    }

    #[test]
    fn sleeps_to_the_next_hour_at_most_half_an_hour() {
        assert_eq!(until_next(18, 7 * 3600 + 59 * 60), Duration::from_secs(65));
        assert_eq!(until_next(18, 12 * 3600), MAX_SLEEP);
        assert_eq!(until_next(18, 23 * 3600 + 59 * 60 + 50), MAX_SLEEP);
    }

    #[test]
    fn overlaps_count_once() {
        assert_eq!(merged_seconds(&[(0, 100), (50, 150), (200, 260), (10, 5)]), 210);
        assert_eq!(merged_seconds(&[]), 0);
    }
}
