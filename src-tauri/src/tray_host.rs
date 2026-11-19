//! Notification-area icons for the dock while the taskbar is hidden.
//!
//! An invisible `Shell_TrayWnd` of our own wins `FindWindow`, so apps'
//! Shell_NotifyIcon calls reach it first. It copies each icon's metadata and
//! image, then forwards the original packet to Explorer's tray and returns
//! Explorer's answer, so Explorer keeps every icon. If EasyIsland exits or crashes
//! the proxy window goes away and apps talk to Explorer directly again.
//! Adapted from an MIT-licensed dock for Windows (notice in LICENSE).

pub mod model;
mod proxy;
pub mod wire;

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard, mpsc};
use std::thread::JoinHandle;
use std::time::Duration;

use windows::Win32::Foundation::*;
use windows::Win32::UI::WindowsAndMessaging::*;
use windows::core::{Error, Result};

pub use model::{Action, Key};


/// A copy of an app's icon, destroyed with its last reference.
#[derive(Debug)]
pub struct OwnedIcon(pub HICON);
// HICONs are USER handles usable from any thread of the process.
unsafe impl Send for OwnedIcon {}
unsafe impl Sync for OwnedIcon {}
impl Drop for OwnedIcon {
    fn drop(&mut self) {
        unsafe {
            let _ = DestroyIcon(self.0);
        }
    }
}

pub type Icon = model::Icon<Arc<OwnedIcon>>;

/// Where the dock shows icons, in physical screen pixels, for
/// Shell_NotifyIconGetRect. Icons the dock doesn't show use `fallback`,
/// the chevron; without one, Explorer answers.
#[derive(Debug, Clone, Default)]
pub struct Rects {
    pub icons: HashMap<Key, RECT>,
    pub fallback: Option<RECT>,
}

struct Shared {
    model: Mutex<model::Model<Arc<OwnedIcon>>>,
    rects: Mutex<Rects>,
    /// The window told about changes, and with which message.
    /// Told (on the host thread, so it must be quick) when the icons change.
    on_change: Box<dyn Fn() + Send + Sync>,
    /// A change notification is posted and not yet read.
    pending: AtomicBool,
}

fn lock<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

impl Shared {
    fn changed(&self) {
        if !self.pending.swap(true, Ordering::SeqCst) {
            (self.on_change)();
        }
    }
}

/// Runs the proxy on its own thread; dropping it removes the proxy.
pub struct TrayHost {
    shared: Arc<Shared>,
    control: HWND,
    thread: Option<JoinHandle<()>>,
}

impl TrayHost {
    /// Calls `on_change` whenever the icons change. Fails without
    /// side effects if Explorer's tray is missing, another EasyIsland hosts the
    /// tray, or our window does not win `FindWindow`.
    pub fn start(on_change: impl Fn() + Send + Sync + 'static) -> Result<Self> {
        let shared = Arc::new(Shared {
            model: Mutex::default(),
            rects: Mutex::default(),
            on_change: Box::new(on_change),
            pending: AtomicBool::new(false),
        });
        let (ready_tx, ready_rx) = mpsc::channel();
        let thread_shared = shared.clone();
        let thread = std::thread::Builder::new()
            .name("tray-host".into())
            .spawn(move || proxy::run(thread_shared, ready_tx))
            .map_err(|e| Error::new(E_FAIL, e.to_string()))?;
        match ready_rx.recv_timeout(Duration::from_secs(5)) {
            Ok(Ok(control)) => Ok(Self {
                shared,
                control: HWND(control as _),
                thread: Some(thread),
            }),
            Ok(Err(message)) => {
                let _ = thread.join();
                Err(Error::new(E_FAIL, message))
            }
            // The thread is stuck; leave it, it exits with the process.
            Err(_) => Err(Error::new(E_FAIL, "The tray host did not start within 5 seconds")),
        }
    }

    /// The current icons, in Windows' order where it has one.
    pub fn icons(&self) -> Vec<Icon> {
        self.shared.pending.store(false, Ordering::SeqCst);
        let mut icons = lock(&self.shared.model).icons.clone();
        icons.sort_by_key(|icon| icon.order.unwrap_or(usize::MAX));
        icons
    }

    pub fn set_rects(&self, rects: Rects) {
        *lock(&self.shared.rects) = rects;
    }

    /// Restores FindWindow ordering on the host thread after Explorer shows its tray.
    pub fn outrank(&self) {
        unsafe {
            let _ = PostMessageW(Some(self.control), proxy::WM_OUTRANK, WPARAM(0), LPARAM(0));
        }
    }
}

// The control window is only posted to, from any thread.
unsafe impl Send for TrayHost {}

impl Drop for TrayHost {
    fn drop(&mut self) {
        unsafe {
            let _ = PostMessageW(Some(self.control), WM_CLOSE, WPARAM(0), LPARAM(0));
        }
        // Forwarding is bounded by its timeout, so this ends soon.
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

/// Sends an app its callback for a gesture on its icon, as Explorer would.
/// `x` and `y` are the icon's center in physical screen pixels.
pub fn invoke(icon: &Icon, action: Action, x: i32, y: i32) -> std::result::Result<(), String> {
    let hwnd = HWND(wire::handle(icon.hwnd) as _);
    unsafe {
        if icon.callback == 0 {
            return Err("The icon has no callback message".into());
        }
        let mut pid = 0;
        if !IsWindow(Some(hwnd)).as_bool() || GetWindowThreadProcessId(hwnd, Some(&mut pid)) == 0 {
            return Err("The icon's window is gone".into());
        }
        if icon.pid != 0 && pid != icon.pid {
            return Err("The icon's window belongs to another process now".into());
        }
        // The app needs the foreground for its menu or window. The click gave
        // EasyIsland the right to pass it on.
        if let Err(error) = AllowSetForegroundWindow(pid) {
            eprintln!("Tray foreground for {pid}: {error}");
        }
        // Posted, so a menu's modal loop in the app never blocks the dock.
        for event in model::events(action, icon.version) {
            let (wp, lp) = model::callback_words(icon.version, icon.uid, event, x, y);
            PostMessageW(Some(hwnd), icon.callback, WPARAM(wp), LPARAM(lp)).map_err(|e| e.message())?;
        }
    }
    Ok(())
}

// ---- EasyIsland's side: the bars' «sys:systray» item ----

use std::collections::HashMap as Map;
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter, Manager};

static HOST: Mutex<Option<TrayHost>> = Mutex::new(None);
static APP: OnceLock<AppHandle> = OnceLock::new();
/// A burst of changes is one event (apps update tooltips in loops).
static QUEUED: AtomicBool = AtomicBool::new(false);
/// PNGs already made, by icon and revision.
static PNGS: Mutex<Option<Map<(String, u64), String>>> = Mutex::new(None);

fn shows_tray(items: &[serde_json::Value]) -> bool {
    items.iter().any(|v| v.get("id").and_then(|i| i.as_str()) == Some("sys:systray"))
}

/// Follows the settings: the host runs only while a bar shows the item.
pub fn apply(app: &AppHandle) {
    let _ = APP.set(app.clone());
    let wanted = app.try_state::<crate::Shared>().map(|s| {
        let s = s.settings.lock().unwrap();
        (s.dock && shows_tray(&s.dock_items)) || (!s.fixed_bar.is_empty() && shows_tray(&s.fixed_bar_items))
    }).unwrap_or(false);
    let mut host = lock(&HOST);
    if wanted && host.is_none() {
        match TrayHost::start(queue_event) {
            Ok(h) => {
                *host = Some(h);
                crate::log::line("area notifiche: icone delle app ricevute dalla barra");
            }
            Err(err) => crate::log::line(format!("area notifiche: non avviata ({err}); resta la freccia delle icone nascoste")),
        }
    } else if !wanted && host.is_some() {
        // Dropping it closes our window: the apps talk to Explorer directly again.
        host.take();
        crate::log::line("area notifiche: tolta");
    }
}

fn queue_event() {
    if QUEUED.swap(true, Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(|| {
        std::thread::sleep(Duration::from_millis(120));
        QUEUED.store(false, Ordering::SeqCst);
        if let Some(app) = APP.get() {
            let _ = app.emit("tray-icons", tray_icons());
        }
    });
}

/// One icon for the bars.
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TrayIconOut {
    id: String,
    tip: String,
    /// PNG data URL.
    icon: String,
    /// Windows' «always show» for it (no preference recorded: in the ^ flyout, as Windows 11 does).
    promoted: bool,
}

/// The icons to show, in Windows' order; empty when the host is off.
#[tauri::command]
pub fn tray_icons() -> Vec<TrayIconOut> {
    let icons = match lock(&HOST).as_ref() {
        Some(h) => h.icons(),
        None => return Vec::new(),
    };
    let mut pngs = lock(&PNGS);
    let cache = pngs.get_or_insert_with(Map::new);
    let mut seen = Vec::new();
    let out = icons
        .iter()
        .filter(|i| i.visible())
        .filter_map(|i| {
            let key = i.key().to_string();
            let id = (key.clone(), i.revision);
            let image = match cache.get(&id) {
                Some(png) => png.clone(),
                None => {
                    let rgba = crate::applist::icon_rgba(i.image.as_ref()?.0)?;
                    let png = crate::clipimage::data_url(&crate::clipimage::encode_png(&rgba).ok()?);
                    cache.insert(id.clone(), png.clone());
                    png
                }
            };
            seen.push(id);
            Some(TrayIconOut { id: key, tip: i.tip.clone(), icon: image, promoted: i.promoted.unwrap_or(false) })
        })
        .collect();
    // Only the current revisions stay.
    cache.retain(|k, _| seen.contains(k));
    out
}

/// A click on an icon in a bar (`button` "left", "right", "middle", "double"):
/// the app gets it as from Explorer, at the mouse (the click just happened
/// there; the app opens its menu by it). True when it reached the app.
#[tauri::command]
pub fn tray_do(id: String, button: String) -> bool {
    use windows::Win32::Foundation::POINT;
    use windows::Win32::UI::WindowsAndMessaging::GetCursorPos;
    let action = match button.as_str() {
        "double" => Action::DoubleClick,
        "right" => Action::Menu,
        _ => Action::Click,
    };
    let mut at = POINT::default();
    unsafe {
        let _ = GetCursorPos(&mut at);
    }
    let Some(icon) = lock(&HOST).as_ref().and_then(|h| h.icons().into_iter().find(|i| i.key().to_string() == id)) else {
        return false;
    };
    match invoke(&icon, action, at.x, at.y) {
        Ok(()) => true,
        Err(err) => {
            crate::log::line(format!("area notifiche: clic non arrivato ({err})"));
            false
        }
    }
}
