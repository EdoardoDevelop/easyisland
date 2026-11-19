// The "Musica" integration: what is playing right now (Spotify, a browser tab,
// the Media Player… anything that shows up in Windows' own media overlay),
// with play/pause, previous and next.
//
// It reads Windows' media sessions (GlobalSystemMediaTransportControls), all
// local: no account, no network. Nothing polls (docs/piano-dock.md): Windows
// says when the sessions, the current one, its track, its playback or its
// timeline change, the callbacks only wake this thread up, and it reads the
// session again then. The island only hears about it when something changed
// (track, play/pause, a jump in the position). The cover is read once per
// track. Every wait on a player is at most 3 s, then cancelled: a hung player
// never holds the thread. (Event wiring and the 3 s limit adapted from a
// MIT-licensed dock for Windows, LICENSE, third parties.)

use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::AppHandle;
use windows::core::RuntimeType;
use windows::Foundation::TypedEventHandler;
use windows_future::{AsyncOperationCompletedHandler, AsyncStatus, IAsyncOperation};
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession as Session,
    GlobalSystemMediaTransportControlsSessionManager as Manager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
};
use windows::Storage::Streams::DataReader;
use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

use crate::integrations::{self, IntegrationUpdate};

pub const ID: &str = "integration_media";
/// Without any event for this long, a look anyway (the integration paused or
/// switched off and on again, a player that says nothing).
const FALLBACK: Duration = Duration::from_secs(30);
/// A player that does not answer within this is left alone.
const TIMEOUT: Duration = Duration::from_secs(3);
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

/// The result of an asynchronous call of a player, or None after `TIMEOUT` (cancelled).
fn complete<T: RuntimeType + 'static>(op: IAsyncOperation<T>) -> Option<T> {
    let (tx, rx) = std::sync::mpsc::channel::<bool>();
    let handler = AsyncOperationCompletedHandler::<T>::new(move |_, status| {
        let _ = tx.send(status == AsyncStatus::Completed);
        Ok(())
    });
    op.SetCompleted(&handler).ok()?;
    match rx.recv_timeout(TIMEOUT) {
        Ok(true) => op.GetResults().ok(),
        Ok(false) => None,
        Err(_) => {
            let _ = op.Cancel();
            None
        }
    }
}

fn cover(session: &Session) -> Option<String> {
    let props = complete(session.TryGetMediaPropertiesAsync().ok()?)?;
    let stream = complete(props.Thumbnail().ok()?.OpenReadAsync().ok()?)?;
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
    let props = complete(session.TryGetMediaPropertiesAsync().ok()?)?;
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
            // Position is as of LastUpdatedTime: the card's own clock runs from it.
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
        let _ = complete(op);
    }
}

/// Wakes the media thread: Windows said something changed.
fn wake() {
    command("wake");
}

/// The session followed: its track, playback and timeline events.
struct Followed {
    session: Session,
    tokens: [Option<i64>; 3],
}

impl Followed {
    fn new(session: Session) -> Self {
        let tokens = [
            session.MediaPropertiesChanged(&TypedEventHandler::new(|_, _| {
                wake();
                Ok(())
            })),
            session.PlaybackInfoChanged(&TypedEventHandler::new(|_, _| {
                wake();
                Ok(())
            })),
            // A seek: the card's clock must jump too.
            session.TimelinePropertiesChanged(&TypedEventHandler::new(|_, _| {
                wake();
                Ok(())
            })),
        ]
        .map(Result::ok);
        Self { session, tokens }
    }
}

impl Drop for Followed {
    fn drop(&mut self) {
        let [a, b, c] = self.tokens;
        if let Some(t) = a {
            let _ = self.session.RemoveMediaPropertiesChanged(t);
        }
        if let Some(t) = b {
            let _ = self.session.RemovePlaybackInfoChanged(t);
        }
        if let Some(t) = c {
            let _ = self.session.RemoveTimelinePropertiesChanged(t);
        }
    }
}

/// The manager and its own events (sessions appearing, the current one changing).
struct Watched {
    manager: Manager,
    tokens: [Option<i64>; 2],
    current: Option<Followed>,
}

impl Watched {
    fn new() -> Option<Self> {
        let manager = complete(Manager::RequestAsync().ok()?)?;
        let tokens = [
            manager.SessionsChanged(&TypedEventHandler::new(|_, _| {
                wake();
                Ok(())
            })),
            manager.CurrentSessionChanged(&TypedEventHandler::new(|_, _| {
                wake();
                Ok(())
            })),
        ]
        .map(Result::ok);
        Some(Self { manager, tokens, current: None })
    }

    /// The current session, its events followed (moved when it changes).
    fn session(&mut self) -> Option<Session> {
        let now = self.manager.GetCurrentSession().ok();
        let same = match (&now, &self.current) {
            (Some(n), Some(f)) => *n == f.session,
            (None, None) => true,
            _ => false,
        };
        if !same {
            self.current = now.clone().map(Followed::new);
        }
        now
    }
}

impl Drop for Watched {
    fn drop(&mut self) {
        self.current = None;
        let [a, b] = self.tokens;
        if let Some(t) = a {
            let _ = self.manager.RemoveSessionsChanged(t);
        }
        if let Some(t) = b {
            let _ = self.manager.RemoveCurrentSessionChanged(t);
        }
    }
}

pub fn spawn(app: AppHandle) {
    let (tx, rx) = std::sync::mpsc::channel::<String>();
    *COMMAND.lock().unwrap() = Some(tx);
    std::thread::spawn(move || {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
        let mut watched: Option<Watched> = None;
        let mut last: Option<Value> = None;
        let mut last_key = String::new();
        let mut last_cover: Option<String> = None;
        // Where the position should be by now if nothing jumped.
        let mut expected: Option<(f64, Instant, bool)> = None;
        loop {
            // An event of Windows or a button press wakes the loop; otherwise it sleeps.
            let cmd = match rx.recv_timeout(FALLBACK) {
                Ok(c) => Some(c),
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => None,
                Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => return,
            };
            if integrations::PAUSED.load(Ordering::Relaxed) || !integrations::enabled(&app, ID) {
                // Off: nothing followed, nothing kept.
                watched = None;
                last = None;
                last_key.clear();
                continue;
            }
            if watched.is_none() {
                watched = Watched::new();
                if watched.is_none() {
                    continue;
                }
            }
            let Some(w) = watched.as_mut() else { continue };
            match cmd.as_deref() {
                Some("refresh") => last = None,
                Some("wake") | None => {}
                Some(cmd) => run_command(&w.manager, cmd),
            }
            // A burst of events (a new track: properties, playback, timeline) makes one read.
            while let Ok(more) = rx.try_recv() {
                match more.as_str() {
                    "refresh" => last = None,
                    "wake" => {}
                    other => run_command(&w.manager, other),
                }
            }
            let snap = w.session().and_then(|s| snapshot(&s).map(|snap| (s, snap)));
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
    #[ignore = "reads what this PC is playing now; nothing is sent or changed"]
    fn this_pc() {
        unsafe {
            let _ = windows::Win32::System::Com::CoInitializeEx(None, windows::Win32::System::Com::COINIT_MULTITHREADED);
        }
        let started = std::time::Instant::now();
        let mut w = super::Watched::new().expect("media manager");
        match w.session().and_then(|s| super::snapshot(&s)) {
            Some(s) => println!("in riproduzione: «{}» – {} ({}), suona: {}", s.title, s.artist, s.app, s.playing),
            None => println!("niente in riproduzione"),
        }
        println!("letto in {:?}", started.elapsed());
    }

    #[test]
    fn helpers() {
        assert_eq!(base64(b"Ma"), "TWE=");
        assert_eq!(base64(b"Man"), "TWFu");
        assert_eq!(app_name("Spotify.exe"), "Spotify");
        assert_eq!(app_name("Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic"), "Lettore multimediale");
    }
}
