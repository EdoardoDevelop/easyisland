// "Cattura una zona → chiedi a Claude": Windows' own snipping overlay
// (ms-screenclip:, the same as Win+Shift+S) lets the user pick a zone, a window
// or the whole screen; the picture it copies is saved as a PNG in the inbox and
// handed to the island, which opens the chat with it attached.
//
// Nothing runs in the background: the clipboard is only watched while a
// capture is in progress, and for at most CAPTURE_TIMEOUT.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

use windows::core::{w, PCWSTR};
use windows::Win32::UI::Shell::ShellExecuteW;
use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

use crate::clipimage;
use crate::files::{self, DroppedFile};

/// Long enough to pick a zone calmly; Esc in the overlay is not reported, so
/// this is also how long a cancelled capture keeps listening.
const CAPTURE_TIMEOUT: Duration = Duration::from_secs(60);
const POLL: Duration = Duration::from_millis(150);

/// Each capture gets a number; starting a new one ends the one before.
static CURRENT: AtomicU64 = AtomicU64::new(0);

/// "Schermata 2026-10-04 15.30.12.png"
pub fn file_name(prefix: &str) -> String {
    let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    format!(
        "{prefix} {:04}-{:02}-{:02} {:02}.{:02}.{:02}.png",
        t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond
    )
}

/// The picture on the clipboard as a PNG in the inbox (Ctrl+Alt+K with an image copied).
pub fn clipboard_picture() -> Result<Option<DroppedFile>, String> {
    if crate::actions::clipboard_text().is_some() || !clipimage::has_image() {
        return Ok(None);
    }
    let Some(img) = clipimage::read() else { return Ok(None) };
    files::save_new(&file_name("Immagine copiata"), &clipimage::encode_png(&img)?).map(Some)
}

/// Opens the snipping overlay and waits for the picture. `Ok(None)` when the
/// user gave up (timeout, a text copied instead, or a newer capture).
pub async fn capture() -> Result<Option<DroppedFile>, String> {
    let me = CURRENT.fetch_add(1, Ordering::SeqCst) + 1;
    let mut seen = clipimage::sequence();

    let opened = unsafe { ShellExecuteW(None, w!("open"), w!("ms-screenclip:"), PCWSTR::null(), PCWSTR::null(), SW_SHOWNORMAL) };
    // ShellExecute reports success with a value above 32.
    if opened.0 as usize <= 32 {
        return Err("Strumento di cattura non disponibile su questo PC".into());
    }

    let started = Instant::now();
    while started.elapsed() < CAPTURE_TIMEOUT {
        tokio::time::sleep(POLL).await;
        if CURRENT.load(Ordering::SeqCst) != me {
            return Ok(None);
        }
        let now = clipimage::sequence();
        if now == seen {
            continue;
        }
        seen = now;
        if !clipimage::has_image() {
            // The overlay may write the clipboard in two steps; a text copy means
            // the user moved on.
            if crate::actions::clipboard_text().is_some() {
                return Ok(None);
            }
            continue;
        }
        let saved = tauri::async_runtime::spawn_blocking(|| -> Result<Option<DroppedFile>, String> {
            let Some(img) = clipimage::read() else { return Ok(None) };
            let png = clipimage::encode_png(&img)?;
            files::save_new(&file_name("Schermata"), &png).map(Some)
        })
        .await
        .map_err(|e| e.to_string())??;
        if saved.is_some() {
            return Ok(saved);
        }
    }
    Ok(None)
}
