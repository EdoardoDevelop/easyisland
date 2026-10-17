// The "Registra" integration: records a conversation (microphone and/or the
// PC's sound) or the screen (with that sound), on a click, until Stop.
//
// Nothing new to install: Windows does it all.
//   * Sound: WASAPI, the microphone and the speakers in loopback (what the PC
//     plays: the other side of a call), both asked for 48 kHz 16-bit stereo
//     (AUTOCONVERTPCM) and mixed on a clock, so a source that goes quiet (the
//     loopback sends nothing while nothing plays) leaves silence, not a gap.
//   * Screen: the monitor under the mouse at the start, with the cursor, by GDI
//     (BitBlt; StretchBlt down to 1920 px wide at most), N frames a second.
//   * File: Media Foundation's sink writer: H.264 + AAC in .mp4 for the screen,
//     AAC in .m4a for sound only. Hardware encoders when there are.
// One thread does everything; Stop (or the 4-hour limit) closes the file and
// the island offers what to do with it (Apri, Nel Vassoio, Mostra nella
// cartella, a question to the chat): a `recording` moment.
// While it records the strip beside the character says so, with Stop: nothing
// is ever recorded without it showing.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::json;
use tauri::AppHandle;
use windows::core::{GUID, HSTRING};
use windows::Win32::Media::Audio::{
    eCapture, eConsole, eRender, IAudioCaptureClient, IAudioClient, IMMDeviceEnumerator, MMDeviceEnumerator,
    AUDCLNT_BUFFERFLAGS_SILENT, AUDCLNT_SHAREMODE_SHARED, AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM, AUDCLNT_STREAMFLAGS_LOOPBACK,
    AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY, WAVEFORMATEX, WAVE_FORMAT_PCM,
};
use windows::Win32::Media::MediaFoundation::*;
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED};

use crate::i18n::{t, tf};
use crate::integrations::{self, IntegrationUpdate};

pub const ID: &str = "integration_recorder";
const RATE: u32 = 48_000;
const CHANNELS: u32 = 2;
const MAX_LEN: Duration = Duration::from_secs(4 * 3600);
const MAX_WIDTH: i32 = 1920;

/// What to record, from the card.
#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Request {
    /// "audio" (a conversation) | "screen"
    pub kind: String,
    pub mic: bool,
    pub system: bool,
    /// screen: frames a second (5–30).
    #[serde(default)]
    pub fps: u32,
    /// screen: only this window (its HWND as a number, window_drop.rs); 0 = the screen.
    #[serde(default)]
    pub window: i64,
    /// What the card shows for the window ("Excel — Budget.xlsx").
    #[serde(default)]
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
struct Live {
    kind: String,
    /// The window recorded, "" for the whole screen.
    window: String,
    mic: bool,
    system: bool,
    /// ms since 1970 when it started.
    since: u64,
    path: String,
}

static STOP: AtomicBool = AtomicBool::new(false);
static LIVE: Mutex<Option<Live>> = Mutex::new(None);
static LAST_ERROR: Mutex<Option<String>> = Mutex::new(None);

fn now_ms() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

pub fn publish(app: &AppHandle) {
    let live = LIVE.lock().unwrap().clone();
    let error = LAST_ERROR.lock().unwrap().clone();
    integrations::emit(app, IntegrationUpdate {
        id: ID,
        data: json!({ "recording": live.is_some(), "live": live, "error": error, "folder": folder(app).to_string_lossy() }),
        error: None,
        event: None,
    });
}

/// Where recordings go: the settings' folder, or Videos\EasyIsland.
fn folder(app: &AppHandle) -> PathBuf {
    use tauri::Manager;
    let chosen = app
        .try_state::<crate::Shared>()
        .map(|s| s.settings.lock().unwrap().integration_config.record_folder.trim().to_string())
        .unwrap_or_default();
    if !chosen.is_empty() {
        return PathBuf::from(chosen);
    }
    let home = std::env::var_os("USERPROFILE").map(PathBuf::from).unwrap_or_else(std::env::temp_dir);
    home.join("Videos").join("EasyIsland")
}

fn file_name_for(kind: &str, window: bool) -> String {
    let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    let (what, ext) = if kind == "screen" { (if window { "Finestra" } else { "Schermo" }, "mp4") } else { ("Registrazione", "m4a") };
    format!("{what} {:04}-{:02}-{:02} {:02}.{:02}.{:02}.{ext}", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond)
}

/// The card's ↗: the recordings' folder in Explorer.
pub fn open_folder(app: &AppHandle) -> bool {
    let dir = folder(app);
    let _ = std::fs::create_dir_all(&dir);
    crate::actions::shell_open(&dir.to_string_lossy()).is_ok()
}

/// Starts recording; Err = why not (already recording, nothing chosen, no device…).
pub fn start(app: AppHandle, req: Request) -> Result<(), String> {
    if LIVE.lock().unwrap().is_some() {
        return Err(t("Sta già registrando").into());
    }
    let screen = req.kind == "screen";
    if !screen && !req.mic && !req.system {
        return Err(t("Scegli almeno il microfono o l'audio del PC").into());
    }
    let dir = folder(&app);
    std::fs::create_dir_all(&dir).map_err(|e| tf("Cartella delle registrazioni non utilizzabile: {e}", &[("e", &e)]))?;
    let path = dir.join(file_name_for(&req.kind, req.window != 0));
    if screen && req.window != 0 && crate::window_drop::usable(req.window).is_none() {
        return Err(t("La finestra non c'è più").into());
    }
    let window = if screen && req.window != 0 { req.label.chars().take(120).collect() } else { String::new() };
    let live = Live { kind: req.kind.clone(), window, mic: req.mic, system: req.system, since: now_ms(), path: path.to_string_lossy().into_owned() };
    STOP.store(false, Ordering::Relaxed);
    *LAST_ERROR.lock().unwrap() = None;
    *LIVE.lock().unwrap() = Some(live);
    publish(&app);
    let (tx, rx) = std::sync::mpsc::channel::<Result<(), String>>();
    let app2 = app.clone();
    std::thread::spawn(move || {
        let result = unsafe { record(&req, &path, &tx) };
        // Reported once: before the start (tx still waiting) or at the end.
        let _ = tx.send(result.clone().map(|_| ()));
        finish(&app2, &path, result);
    });
    // The first second tells whether the devices and the encoder came up.
    match rx.recv_timeout(Duration::from_secs(5)) {
        Ok(Err(e)) => Err(e),
        _ => Ok(()),
    }
}

pub fn stop() {
    STOP.store(true, Ordering::Relaxed);
}

fn finish(app: &AppHandle, path: &std::path::Path, result: Result<Duration, String>) {
    *LIVE.lock().unwrap() = None;
    match result {
        Ok(len) => {
            let size = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
            crate::log::line(format!("registrazione finita: {} s, {} KB", len.as_secs(), size / 1024));
            crate::moments::emit(app, json!({
                "kind": "recording",
                "name": path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default(),
                "path": path.to_string_lossy(),
                "size": size,
                "seconds": len.as_secs(),
            }));
        }
        Err(e) => {
            crate::log::line(format!("registrazione non riuscita: {e}"));
            // An empty file left by a failed start goes; anything recorded stays.
            if std::fs::metadata(path).map(|m| m.len() == 0).unwrap_or(false) {
                let _ = std::fs::remove_file(path);
            }
            *LAST_ERROR.lock().unwrap() = Some(e);
        }
    }
    publish(app);
}

// ── Sound ────────────────────────────────────────────────────────────────────

struct Source {
    client: IAudioClient,
    capture: IAudioCaptureClient,
    /// Samples (interleaved i16) waiting to be mixed.
    queue: std::collections::VecDeque<i16>,
}

fn pcm_format() -> WAVEFORMATEX {
    WAVEFORMATEX {
        wFormatTag: WAVE_FORMAT_PCM as u16,
        nChannels: CHANNELS as u16,
        nSamplesPerSec: RATE,
        nAvgBytesPerSec: RATE * CHANNELS * 2,
        nBlockAlign: (CHANNELS * 2) as u16,
        wBitsPerSample: 16,
        cbSize: 0,
    }
}

unsafe fn open_source(loopback: bool) -> Result<Source, String> {
    let enumerator: IMMDeviceEnumerator =
        CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).map_err(|e| e.to_string())?;
    let device = enumerator
        .GetDefaultAudioEndpoint(if loopback { eRender } else { eCapture }, eConsole)
        .map_err(|_| if loopback { t("Nessuna uscita audio") } else { t("Nessun microfono") }.to_string())?;
    let client: IAudioClient = device.Activate(CLSCTX_ALL, None).map_err(|e| e.to_string())?;
    let mut flags = AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM | AUDCLNT_STREAMFLAGS_SRC_DEFAULT_QUALITY;
    if loopback {
        flags |= AUDCLNT_STREAMFLAGS_LOOPBACK;
    }
    let fmt = pcm_format();
    client
        .Initialize(AUDCLNT_SHAREMODE_SHARED, flags, 10_000_000, 0, &fmt, None)
        .map_err(|e| tf("Audio non disponibile: {e}", &[("e", &e)]))?;
    let capture: IAudioCaptureClient = client.GetService().map_err(|e| e.to_string())?;
    client.Start().map_err(|e| e.to_string())?;
    Ok(Source { client, capture, queue: Default::default() })
}

/// Everything the device has now, into the queue.
unsafe fn drain(src: &mut Source) {
    loop {
        let Ok(n) = src.capture.GetNextPacketSize() else { return };
        if n == 0 {
            return;
        }
        let mut data: *mut u8 = std::ptr::null_mut();
        let mut frames = 0u32;
        let mut flags = 0u32;
        if src.capture.GetBuffer(&mut data, &mut frames, &mut flags, None, None).is_err() {
            return;
        }
        let count = (frames * CHANNELS) as usize;
        if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 || data.is_null() {
            src.queue.extend(std::iter::repeat(0).take(count));
        } else {
            let samples = std::slice::from_raw_parts(data as *const i16, count);
            src.queue.extend(samples.iter().copied());
        }
        let _ = src.capture.ReleaseBuffer(frames);
        // More than 2 s behind: the clock moved on, drop the oldest.
        let max = (RATE * CHANNELS * 2) as usize;
        if src.queue.len() > max {
            let extra = src.queue.len() - max;
            src.queue.drain(..extra);
        }
    }
}

/// `frames` frames mixed from every source; a source with nothing yet gives silence.
fn mix(sources: &mut [Source], frames: usize) -> Vec<i16> {
    let n = frames * CHANNELS as usize;
    let mut out = vec![0i32; n];
    for s in sources.iter_mut() {
        for slot in out.iter_mut() {
            *slot += i32::from(s.queue.pop_front().unwrap_or(0));
        }
    }
    out.into_iter().map(|v| v.clamp(i16::MIN as i32, i16::MAX as i32) as i16).collect()
}

// ── Screen ───────────────────────────────────────────────────────────────────

struct Grabber {
    /// Only this window (PrintWindow, also when covered), or the whole screen.
    window: Option<windows::Win32::Foundation::HWND>,
    screen_dc: windows::Win32::Graphics::Gdi::HDC,
    mem_dc: windows::Win32::Graphics::Gdi::HDC,
    bitmap: windows::Win32::Graphics::Gdi::HBITMAP,
    old: windows::Win32::Graphics::Gdi::HGDIOBJ,
    bits: *mut u8,
    /// The monitor's rectangle (physical px) and the frame's size (even).
    src: (i32, i32, i32, i32),
    w: i32,
    h: i32,
}

impl Grabber {
    unsafe fn new(window: Option<windows::Win32::Foundation::HWND>) -> Result<Self, String> {
        use windows::Win32::Foundation::POINT;
        use windows::Win32::Graphics::Gdi::*;
        use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
        let r = match window {
            // The window's visible frame at the start: the video keeps that size.
            Some(hwnd) => crate::window_drop::frame(hwnd).ok_or_else(|| t("La finestra non c'è più").to_string())?,
            None => {
                let mut p = POINT::default();
                let _ = GetCursorPos(&mut p);
                let mon = MonitorFromPoint(p, MONITOR_DEFAULTTONEAREST);
                let mut info = MONITORINFO { cbSize: std::mem::size_of::<MONITORINFO>() as u32, ..Default::default() };
                if !GetMonitorInfoW(mon, &mut info).as_bool() {
                    return Err(t("Schermo non trovato").into());
                }
                info.rcMonitor
            }
        };
        let (sw, sh) = (r.right - r.left, r.bottom - r.top);
        let scale = if sw > MAX_WIDTH { MAX_WIDTH as f64 / sw as f64 } else { 1.0 };
        let w = (((sw as f64 * scale) as i32) & !1).max(2);
        let h = (((sh as f64 * scale) as i32) & !1).max(2);
        let screen_dc = GetDC(None);
        let mem_dc = CreateCompatibleDC(Some(screen_dc));
        let bmi = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w,
                biHeight: -h, // top-down
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bits: *mut std::ffi::c_void = std::ptr::null_mut();
        let bitmap = CreateDIBSection(Some(mem_dc), &bmi, DIB_RGB_COLORS, &mut bits, None, 0).map_err(|e| e.to_string())?;
        let old = SelectObject(mem_dc, bitmap.into());
        SetStretchBltMode(mem_dc, HALFTONE);
        Ok(Self { window, screen_dc, mem_dc, bitmap, old, bits: bits as *mut u8, src: (r.left, r.top, sw, sh), w, h })
    }

    /// The screen now, with the cursor, as top-down BGRA.
    unsafe fn grab(&self) -> &[u8] {
        use windows::Win32::Graphics::Gdi::*;
        use windows::Win32::UI::WindowsAndMessaging::{DrawIconEx, GetCursorInfo, GetIconInfo, CURSORINFO, CURSOR_SHOWING, DI_NORMAL, ICONINFO};
        let (mut x, mut y, sw, sh) = self.src;
        if let Some(hwnd) = self.window {
            // Where the window is now (it may have moved); drawn even if covered.
            if let Some(f) = crate::window_drop::frame(hwnd) {
                x = f.left;
                y = f.top;
            }
            self.print_window(hwnd, x, y, sw, sh);
        } else if sw == self.w && sh == self.h {
            let _ = BitBlt(self.mem_dc, 0, 0, self.w, self.h, Some(self.screen_dc), x, y, SRCCOPY);
        } else {
            let _ = StretchBlt(self.mem_dc, 0, 0, self.w, self.h, Some(self.screen_dc), x, y, sw, sh, SRCCOPY);
        }
        let mut ci = CURSORINFO { cbSize: std::mem::size_of::<CURSORINFO>() as u32, ..Default::default() };
        if GetCursorInfo(&mut ci).is_ok() && ci.flags.0 & CURSOR_SHOWING.0 != 0 {
            let mut ii = ICONINFO::default();
            let (hx, hy) = if GetIconInfo(ci.hCursor.into(), &mut ii).is_ok() {
                if !ii.hbmMask.is_invalid() {
                    let _ = DeleteObject(ii.hbmMask.into());
                }
                if !ii.hbmColor.is_invalid() {
                    let _ = DeleteObject(ii.hbmColor.into());
                }
                (ii.xHotspot as i32, ii.yHotspot as i32)
            } else {
                (0, 0)
            };
            let k = self.w as f64 / sw as f64;
            let cx = ((ci.ptScreenPos.x - x) as f64 * k) as i32 - hx;
            let cy = ((ci.ptScreenPos.y - y) as f64 * k) as i32 - hy;
            let _ = DrawIconEx(self.mem_dc, cx, cy, ci.hCursor.into(), 0, 0, 0, None, DI_NORMAL);
        }
        let _ = GdiFlush();
        std::slice::from_raw_parts(self.bits, (self.w * self.h * 4) as usize)
    }

    /// The window drawn by itself (PW_RENDERFULLCONTENT: Chrome, Edge, WebView2
    /// too), its visible frame at (fx, fy) scaled into the frame. A window grown
    /// since the start shows its top-left part; a smaller one leaves black.
    unsafe fn print_window(&self, hwnd: windows::Win32::Foundation::HWND, fx: i32, fy: i32, sw: i32, sh: i32) {
        use windows::Win32::Foundation::RECT;
        use windows::Win32::Graphics::Gdi::*;
        use windows::Win32::Storage::Xps::{PrintWindow, PRINT_WINDOW_FLAGS};
        use windows::Win32::UI::WindowsAndMessaging::GetWindowRect;
        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect).is_err() {
            return;
        }
        let (ww, wh) = (rect.right - rect.left, rect.bottom - rect.top);
        if ww <= 0 || wh <= 0 {
            return;
        }
        let tmp = CreateCompatibleDC(Some(self.screen_dc));
        let bmp = CreateCompatibleBitmap(self.screen_dc, ww, wh);
        let old = SelectObject(tmp, bmp.into());
        // PW_RENDERFULLCONTENT = 2.
        if PrintWindow(hwnd, tmp, PRINT_WINDOW_FLAGS(2)).as_bool() {
            let _ = PatBlt(self.mem_dc, 0, 0, self.w, self.h, BLACKNESS);
            let _ = StretchBlt(self.mem_dc, 0, 0, self.w, self.h, Some(tmp), fx - rect.left, fy - rect.top, sw, sh, SRCCOPY);
        }
        SelectObject(tmp, old);
        let _ = DeleteObject(bmp.into());
        let _ = DeleteDC(tmp);
    }
}

impl Drop for Grabber {
    fn drop(&mut self) {
        use windows::Win32::Graphics::Gdi::*;
        unsafe {
            SelectObject(self.mem_dc, self.old);
            let _ = DeleteObject(self.bitmap.into());
            let _ = DeleteDC(self.mem_dc);
            ReleaseDC(None, self.screen_dc);
        }
    }
}

// ── Encoding ─────────────────────────────────────────────────────────────────

unsafe fn media_type(major: &GUID, sub: &GUID) -> Result<IMFMediaType, String> {
    let mt = MFCreateMediaType().map_err(|e| e.to_string())?;
    mt.SetGUID(&MF_MT_MAJOR_TYPE, major).map_err(|e| e.to_string())?;
    mt.SetGUID(&MF_MT_SUBTYPE, sub).map_err(|e| e.to_string())?;
    Ok(mt)
}

unsafe fn video_types(w: i32, h: i32, fps: u32) -> Result<(IMFMediaType, IMFMediaType), String> {
    let size = ((w as u64) << 32) | h as u64;
    let rate = ((fps as u64) << 32) | 1;
    let set = |mt: &IMFMediaType| -> Result<(), String> {
        mt.SetUINT64(&MF_MT_FRAME_SIZE, size).map_err(|e| e.to_string())?;
        mt.SetUINT64(&MF_MT_FRAME_RATE, rate).map_err(|e| e.to_string())?;
        mt.SetUINT64(&MF_MT_PIXEL_ASPECT_RATIO, (1u64 << 32) | 1).map_err(|e| e.to_string())?;
        mt.SetUINT32(&MF_MT_INTERLACE_MODE, MFVideoInterlace_Progressive.0 as u32).map_err(|e| e.to_string())
    };
    let out = media_type(&MFMediaType_Video, &MFVideoFormat_H264)?;
    set(&out)?;
    let bitrate = ((w as u64 * h as u64 * fps as u64) / 8).clamp(1_000_000, 12_000_000) as u32;
    out.SetUINT32(&MF_MT_AVG_BITRATE, bitrate).map_err(|e| e.to_string())?;
    let input = media_type(&MFMediaType_Video, &MFVideoFormat_RGB32)?;
    set(&input)?;
    // Top-down rows, as the DIB gives them.
    input.SetUINT32(&MF_MT_DEFAULT_STRIDE, (w * 4) as u32).map_err(|e| e.to_string())?;
    Ok((out, input))
}

unsafe fn audio_types() -> Result<(IMFMediaType, IMFMediaType), String> {
    let set = |mt: &IMFMediaType| -> Result<(), String> {
        mt.SetUINT32(&MF_MT_AUDIO_NUM_CHANNELS, CHANNELS).map_err(|e| e.to_string())?;
        mt.SetUINT32(&MF_MT_AUDIO_SAMPLES_PER_SECOND, RATE).map_err(|e| e.to_string())?;
        mt.SetUINT32(&MF_MT_AUDIO_BITS_PER_SAMPLE, 16).map_err(|e| e.to_string())
    };
    let out = media_type(&MFMediaType_Audio, &MFAudioFormat_AAC)?;
    set(&out)?;
    // 192 kbps: one of the rates the AAC encoder accepts.
    out.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, 24_000).map_err(|e| e.to_string())?;
    let input = media_type(&MFMediaType_Audio, &MFAudioFormat_PCM)?;
    set(&input)?;
    input.SetUINT32(&MF_MT_AUDIO_BLOCK_ALIGNMENT, CHANNELS * 2).map_err(|e| e.to_string())?;
    input.SetUINT32(&MF_MT_AUDIO_AVG_BYTES_PER_SECOND, RATE * CHANNELS * 2).map_err(|e| e.to_string())?;
    Ok((out, input))
}

unsafe fn write(writer: &IMFSinkWriter, stream: u32, bytes: &[u8], time: i64, duration: i64) -> Result<(), String> {
    let buffer = MFCreateMemoryBuffer(bytes.len() as u32).map_err(|e| e.to_string())?;
    let mut ptr: *mut u8 = std::ptr::null_mut();
    buffer.Lock(&mut ptr, None, None).map_err(|e| e.to_string())?;
    std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, bytes.len());
    buffer.Unlock().map_err(|e| e.to_string())?;
    buffer.SetCurrentLength(bytes.len() as u32).map_err(|e| e.to_string())?;
    let sample = MFCreateSample().map_err(|e| e.to_string())?;
    sample.AddBuffer(&buffer).map_err(|e| e.to_string())?;
    sample.SetSampleTime(time).map_err(|e| e.to_string())?;
    sample.SetSampleDuration(duration).map_err(|e| e.to_string())?;
    writer.WriteSample(stream, &sample).map_err(|e| e.to_string())
}

/// The whole recording, on its own thread. `ready` gets Ok once it runs (or the error).
unsafe fn record(req: &Request, path: &std::path::Path, ready: &std::sync::mpsc::Sender<Result<(), String>>) -> Result<Duration, String> {
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
    MFStartup(MF_VERSION, MFSTARTUP_FULL).map_err(|e| e.to_string())?;
    let _com = Com;

    let screen = req.kind == "screen";
    let mut sources = Vec::new();
    if req.mic {
        sources.push(open_source(false)?);
    }
    if req.system {
        sources.push(open_source(true)?);
    }
    let window = if screen && req.window != 0 {
        Some(crate::window_drop::usable(req.window).ok_or_else(|| t("La finestra non c'è più").to_string())?)
    } else {
        None
    };
    let grabber = if screen { Some(Grabber::new(window)?) } else { None };
    let fps = if req.fps == 0 { 15 } else { req.fps.clamp(5, 30) };

    let attrs: IMFAttributes = {
        let mut a: Option<IMFAttributes> = None;
        MFCreateAttributes(&mut a, 2).map_err(|e| e.to_string())?;
        a.ok_or("MFCreateAttributes")?
    };
    let _ = attrs.SetUINT32(&MF_READWRITE_ENABLE_HARDWARE_TRANSFORMS, 1);
    let writer = MFCreateSinkWriterFromURL(&HSTRING::from(path.as_os_str()), None, &attrs)
        .map_err(|e| tf("Non riesco a creare il file: {e}", &[("e", &e)]))?;
    let video = match &grabber {
        Some(g) => {
            let (out, input) = video_types(g.w, g.h, fps)?;
            let s = writer.AddStream(&out).map_err(|e| tf("Codifica video non disponibile: {e}", &[("e", &e)]))?;
            writer.SetInputMediaType(s, &input, None).map_err(|e| tf("Codifica video non disponibile: {e}", &[("e", &e)]))?;
            Some(s)
        }
        None => None,
    };
    let audio = if sources.is_empty() {
        None
    } else {
        let (out, input) = audio_types()?;
        let s = writer.AddStream(&out).map_err(|e| tf("Codifica audio non disponibile: {e}", &[("e", &e)]))?;
        writer.SetInputMediaType(s, &input, None).map_err(|e| tf("Codifica audio non disponibile: {e}", &[("e", &e)]))?;
        Some(s)
    };
    writer.BeginWriting().map_err(|e| e.to_string())?;
    let _ = ready.send(Ok(()));

    let start = Instant::now();
    let frame_len = 10_000_000i64 / fps as i64;
    let mut frames_out: u64 = 0; // audio frames written
    let mut next_frame: i64 = 0; // 100 ns
    let mut failed: Option<String> = None;
    while !STOP.load(Ordering::Relaxed) && start.elapsed() < MAX_LEN {
        // The window recorded was closed: the recording ends there, kept.
        if let Some(hwnd) = window {
            if !windows::Win32::UI::WindowsAndMessaging::IsWindow(Some(hwnd)).as_bool() {
                break;
            }
        }
        let now = start.elapsed().as_nanos() as i64 / 100;
        if let Some(stream) = audio {
            for s in sources.iter_mut() {
                drain(s);
            }
            // Up to the clock, keeping 50 ms back for the late packets.
            let due = (now - 500_000).max(0) as u64 * RATE as u64 / 10_000_000;
            if due > frames_out {
                let n = (due - frames_out) as usize;
                let pcm = mix(&mut sources, n);
                let bytes = std::slice::from_raw_parts(pcm.as_ptr() as *const u8, pcm.len() * 2);
                let t0 = (frames_out * 10_000_000 / RATE as u64) as i64;
                let dur = (n as u64 * 10_000_000 / RATE as u64) as i64;
                if let Err(e) = write(&writer, stream, bytes, t0, dur) {
                    failed = Some(e);
                    break;
                }
                frames_out += n as u64;
            }
        }
        if let (Some(stream), Some(g)) = (video, &grabber) {
            if now >= next_frame {
                let bytes = g.grab();
                if let Err(e) = write(&writer, stream, bytes, next_frame, frame_len) {
                    failed = Some(e);
                    break;
                }
                next_frame += frame_len;
                // Too slow for this rate: skip ahead instead of piling up.
                if now - next_frame > 10 * frame_len {
                    next_frame = now - now % frame_len + frame_len;
                }
            }
        }
        std::thread::sleep(Duration::from_millis(5));
    }
    for s in &sources {
        let _ = s.client.Stop();
    }
    let len = start.elapsed();
    writer.Finalize().map_err(|e| tf("Il file non si è chiuso bene: {e}", &[("e", &e)]))?;
    match failed {
        Some(e) => Err(tf("Registrazione interrotta: {e}", &[("e", &e)])),
        None => Ok(len),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn mixing_fills_silence_and_clamps() {
        // No device here: the queues stand in for them.
        let mk = || -> std::collections::VecDeque<i16> { Default::default() };
        let mut a = mk();
        a.extend([30_000i16, 30_000, 1, 1]);
        let mut b = mk();
        b.extend([30_000i16, -5]);
        let mut both = [a, b];
        let mut out = vec![0i32; 4];
        for q in both.iter_mut() {
            for slot in out.iter_mut() {
                *slot += i32::from(q.pop_front().unwrap_or(0));
            }
        }
        let out: Vec<i16> = out.into_iter().map(|v| v.clamp(i16::MIN as i32, i16::MAX as i32) as i16).collect();
        assert_eq!(out, vec![i16::MAX, 29_995, 1, 1]);
    }

    /// A real 3-second recording of the screen and the PC's sound (no microphone)
    /// to a temporary file, checked and deleted:
    /// `cargo test -p easyisland --lib live_record -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_record() {
        for (kind, ext) in [("screen", "mp4"), ("audio", "m4a")] {
            let path = std::env::temp_dir().join(format!("easyisland-prova.{ext}"));
            let req = Request { kind: kind.into(), mic: false, system: true, fps: 10, window: 0, label: String::new() };
            let (tx, rx) = std::sync::mpsc::channel();
            STOP.store(false, Ordering::Relaxed);
            let p2 = path.clone();
            let h = std::thread::spawn(move || unsafe { record(&req, &p2, &tx) });
            assert!(matches!(rx.recv_timeout(Duration::from_secs(5)), Ok(Ok(()))), "{kind}: non partita");
            std::thread::sleep(Duration::from_secs(3));
            STOP.store(true, Ordering::Relaxed);
            let len = h.join().unwrap().expect("registrazione");
            let bytes = std::fs::read(&path).unwrap();
            println!("{kind}: {} ms, {} KB", len.as_millis(), bytes.len() / 1024);
            assert!(bytes.len() > 10_000, "{kind}: file troppo piccolo");
            assert_eq!(bytes.get(4..8), Some(&b"ftyp"[..]), "{kind}: non è un MP4");
            let _ = std::fs::remove_file(&path);
        }
    }

    /// A 2-second recording of the first window in the list, no sound, to a
    /// temporary file, checked and deleted:
    /// `cargo test -p easyisland --lib live_window -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn live_window() {
        let w = crate::window_drop::list().into_iter().next().expect("nessuna finestra");
        println!("finestra: {}", w.app_name);
        let path = std::env::temp_dir().join("easyisland-finestra.mp4");
        let req = Request { kind: "screen".into(), mic: false, system: false, fps: 10, window: w.id, label: String::new() };
        let (tx, rx) = std::sync::mpsc::channel();
        STOP.store(false, Ordering::Relaxed);
        let p2 = path.clone();
        let h = std::thread::spawn(move || unsafe { record(&req, &p2, &tx) });
        assert!(matches!(rx.recv_timeout(Duration::from_secs(5)), Ok(Ok(()))), "non partita");
        std::thread::sleep(Duration::from_secs(2));
        STOP.store(true, Ordering::Relaxed);
        h.join().unwrap().expect("registrazione");
        let bytes = std::fs::read(&path).unwrap();
        println!("finestra: {} KB", bytes.len() / 1024);
        assert_eq!(bytes.get(4..8), Some(&b"ftyp"[..]));
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn names() {
        assert!(file_name_for("screen", false).starts_with("Schermo ") && file_name_for("screen", false).ends_with(".mp4"));
        assert!(file_name_for("screen", true).starts_with("Finestra "));
        assert!(file_name_for("audio", false).ends_with(".m4a"));
    }
}
