// The "Musica" integration: what is playing right now (Spotify, a browser tab,
// the Media Player… anything that shows up in Windows' own media overlay),
// with play/pause, previous and next.
//
// It reads Windows' media sessions (GlobalSystemMediaTransportControls), all
// local: no account, no network. One light check every 2 s while the
// integration is on; the island only hears about it when something changed
// (track, play/pause, a jump in the position). The cover is read once per track.

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::AppHandle;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};
use windows::Storage::Streams::DataReader;
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

use crate::integrations::{self, IntegrationUpdate};

pub const ID: &str = "integration_media";
const EVERY: Duration = Duration::from_millis(2000);
/// Covers bigger than this are left out rather than sent through IPC.
const MAX_COVER: u32 = 600_000;

/// What was last sent to the island, for the chat's `media_status` tool.
static LAST: std::sync::Mutex<Option<Value>> = std::sync::Mutex::new(None);

pub fn last() -> Option<Value> {
    LAST.lock().unwrap().clone()
}

/// Commands from the card's buttons, run on the media thread.
static COMMAND: std::sync::Mutex<Option<std::sync::mpsc::Sender<String>>> = std::sync::Mutex::new(None);

fn base64(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (b[0] as u32) << 16 | (b[1] as u32) << 8 | b[2] as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

/// "Spotify.exe", "MSEdge", "Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic" → a name to show.
fn app_name(aumid: &str) -> String {
    let lower = aumid.to_ascii_lowercase();
    for (needle, name) in [
        ("spotify", "Spotify"),
        ("msedge", "Edge"),
        ("chrome", "Chrome"),
        ("firefox", "Firefox"),
        ("brave", "Brave"),
        ("opera", "Opera"),
        ("zunemusic", crate::i18n::t("Lettore multimediale")),
        ("vlc", "VLC"),
        ("itunes", "iTunes"),
        ("applemusic", "Apple Music"),
        ("tidal", "TIDAL"),
        ("deezer", "Deezer"),
        ("amazonmusic", "Amazon Music"),
    ] {
        if lower.contains(needle) {
            return name.into();
        }
    }
    let base = aumid.rsplit(['\\', '!']).next().unwrap_or(aumid);
    base.trim_end_matches(".exe").to_string()
}

fn cover(session: &Session) -> Option<String> {
    let props = session.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
    let stream = props.Thumbnail().ok()?.OpenReadAsync().ok()?.get().ok()?;
    let size = stream.Size().ok()? as u32;
    if size == 0 || size > MAX_COVER {
        return None;
    }
    let mime = stream.ContentType().map(|s| s.to_string()).unwrap_or_default();
    let reader = DataReader::CreateDataReader(&stream).ok()?;
    reader.LoadAsync(size).ok()?.get().ok()?;
    let mut buf = vec![0u8; size as usize];
    reader.ReadBytes(&mut buf).ok()?;
    let mime = if mime.starts_with("image/") { mime } else { "image/png".into() };
    Some(format!("data:{mime};base64,{}", base64(&buf)))
}

/// One look at the current session. `None` when nothing is playing or paused.
struct Snapshot {
    key: String,
    title: String,
    artist: String,
    album: String,
    app: String,
    playing: bool,
    can_prev: bool,
    can_next: bool,
    /// Seconds; 0 when the player does not say.
    position: f64,
    duration: f64,
}

fn snapshot(session: &Session) -> Option<Snapshot> {
    let props = session.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
    let title = props.Title().map(|s| s.to_string()).unwrap_or_default();
    if title.trim().is_empty() {
        return None;
    }
    let artist = props.Artist().map(|s| s.to_string()).unwrap_or_default();
    let album = props.AlbumTitle().map(|s| s.to_string()).unwrap_or_default();
    let aumid = session.SourceAppUserModelId().map(|s| s.to_string()).unwrap_or_default();
    let info = session.GetPlaybackInfo().ok()?;
    let playing = info.PlaybackStatus().ok() == Some(Status::Playing);
    let controls = info.Controls().ok();
    let can_prev = controls.as_ref().and_then(|c| c.IsPreviousEnabled().ok()).unwrap_or(false);
    let can_next = controls.as_ref().and_then(|c| c.IsNextEnabled().ok()).unwrap_or(false);
    let (position, duration) = session
        .GetTimelineProperties()
        .ok()
        .map(|t| {
            let secs = |d: windows::Foundation::TimeSpan| d.Duration as f64 / 10_000_000.0;
            let pos = t.Position().map(secs).unwrap_or(0.0);
            let end = t.EndTime().map(secs).unwrap_or(0.0);
            // Position is as of LastUpdatedTime; good enough at a 2 s cadence.
            (pos, end)
        })
        .unwrap_or((0.0, 0.0));
    Some(Snapshot {
        key: format!("{aumid}\u{1}{title}\u{1}{artist}"),
        title,
        artist,
        album,
        app: app_name(&aumid),
        playing,
        can_prev,
        can_next,
        position,
        duration,
    })
}

fn run_command(manager: &Manager, cmd: &str) {
    let Ok(session) = manager.GetCurrentSession() else { return };
    let op = match cmd {
        "toggle" => session.TryTogglePlayPauseAsync(),
        "next" => session.TrySkipNextAsync(),
        "prev" => session.TrySkipPreviousAsync(),
        _ => return,
    };
    if let Ok(op) = op {
        let _ = op.get();
    }
}

pub fn spawn(app: AppHandle) {
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    *COMMAND.lock().unwrap() = Some(tx);
    std::thread::spawn(move || {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let mut manager: Option<Manager> = None;
        let mut last: Option<Value> = None;
        let mut last_key = String::new();
        let mut last_cover: Option<String> = None;
        // Where the position should be by now if nothing jumped.
        let mut expected: Option<(f64, Instant, bool)> = None;
        loop {
            // A button press wakes the loop at once; otherwise one look every 2 s.
            let cmd = rx.recv_timeout(EVERY).ok();
            if integrations::PAUSED.load(Ordering::Relaxed) || !integrations::enabled(&app, ID) {
                last = None;
                last_key.clear();
                continue;
            }
            if manager.is_none() {
                manager = Manager::RequestAsync().ok().and_then(|op| op.get().ok());
                if manager.is_none() {
                    continue;
                }
            }
            let mgr = manager.as_ref().unwrap();
            match cmd.as_deref() {
                Some("refresh") => last = None,
                Some(cmd) => {
                    run_command(mgr, cmd);
                    std::thread::sleep(Duration::from_millis(250));
                }
                None => {}
            }
            let snap = mgr.GetCurrentSession().ok().and_then(|s| snapshot(&s).map(|snap| (s, snap)));
            let data = match &snap {
                None => {
                    last_key.clear();
                    last_cover = None;
                    expected = None;
                    json!({ "active": false })
                }
                Some((session, s)) => {
                    if s.key != last_key {
                        last_key = s.key.clone();
                        last_cover = cover(session);
                    }
                    json!({
                        "active": true,
                        "title": s.title,
                        "artist": s.artist,
                        "album": s.album,
                        "app": s.app,
                        "playing": s.playing,
                        "canPrev": s.can_prev,
                        "canNext": s.can_next,
                        "duration": s.duration,
                        "cover": last_cover,
                    })
                }
            };
            // Position: sent along with any other change, or when it jumped
            // (a seek), so the card's own clock stays right without a message
            // every 2 s.
            let jumped = match (&snap, expected) {
                (Some((_, s)), Some((pos, at, playing))) => {
                    let now = if playing { pos + at.elapsed().as_secs_f64() } else { pos };
                    (s.position - now).abs() > 3.0
                }
                _ => false,
            };
            if last.as_ref() == Some(&data) && !jumped {
                continue;
            }
            last = Some(data.clone());
            let mut data = data;
            if let Some((_, s)) = &snap {
                data["position"] = json!(s.position);
                expected = Some((s.position, Instant::now(), s.playing));
            }
            *LAST.lock().unwrap() = Some(data.clone());
            integrations::emit(&app, IntegrationUpdate { id: ID, data, error: None, event: None });
        }
    });
}

/// Island → ⏯ ⏮ ⏭.
pub fn command(cmd: &str) {
    if let Some(tx) = COMMAND.lock().unwrap().as_ref() {
        let _ = tx.send(cmd.to_string());
    }
}

/// "Aggiorna" / switching the integration on: send the state again at once.
pub fn refresh() {
    command("refresh");
}

#[cfg(test)]
mod tests {
    use super::{app_name, base64};

    #[test]
    fn helpers() {
        assert_eq!(base64(b"Ma"), "TWE=");
        assert_eq!(base64(b"Man"), "TWFu");
        assert_eq!(app_name("Spotify.exe"), "Spotify");
        assert_eq!(app_name("Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic"), "Lettore multimediale");
    }
}
