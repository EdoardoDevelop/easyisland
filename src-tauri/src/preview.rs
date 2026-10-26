// «Anteprima» (asked by Edoardo on 26 October 2026: the preview of Claude's
// desktop app, files and browser, next to the chat). A window of its own with
// tabs: a file (Markdown drawn, code with line numbers, the changes since the
// chat touched it, images, CSV; HTML and PDF in the browser) or a web page, in
// a real browser that sits inside the window.
//
// - The window is made when it is first opened and destroyed when closed: no
//   memory, no CPU while it is not there. The tabs live here, in STATE, and
//   come back when it opens again.
// - The window holds two kinds of webviews (Tauri's "unstable" multiwebview):
//   its own page `anteprima-ui` (src/preview/, the only one with EasyIsland's
//   commands: capabilities/default.json lists it by webview label) and one
//   `anteprima-web-<id>` per tab that needs the browser. Those load sites and
//   files and never reach EasyIsland: their origin is not the app's and their
//   window is not in the capabilities.
// - The page tells where the content area is (`preview_layout`); the browser
//   of the active tab is placed there, at the chosen size (Adatta, Desktop,
//   Tablet, Telefono: WebView2's DevTools protocol emulates the device) and
//   colour scheme. Overlays of the page (the dev servers' list) hide it.
// - Console messages and page errors come from the DevTools protocol, the last
//   300 per tab. Screenshots too (Page.captureScreenshot), saved as PNG in the
//   temp folder for the chat engine to read.
// - Files: read here (2 MB of text at most), watched every 800 ms while the
//   window is open. When «Modalità terminale» edits a file (`touched`), its
//   content before the edit is kept for «Modifiche», and the file opens in the
//   preview (Impostazioni → Chat → Anteprima, `chat_preview`).
// - The chat's tools (agent.rs, hook/src/tool_list.rs): preview_open,
//   preview_read, preview_screenshot, preview_console, preview_resize read or
//   show only; preview_click and preview_type act on the page and ask
//   Consenti / Nega like every tool that changes something.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex, OnceLock};
use std::time::{Duration, SystemTime};

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, Webview, WebviewBuilder, WebviewUrl};

use crate::i18n::{t, tf};

pub const LABEL: &str = "anteprima";
pub const UI: &str = "anteprima-ui";
const WEB: &str = "anteprima-web-";
/// Tabs, at most: the oldest one that is not active goes.
const MAX_TABS: usize = 12;
/// Console lines kept per tab.
const MAX_CONSOLE: usize = 300;
/// Text of a file shown, at most (bytes).
const MAX_TEXT: u64 = 2 * 1024 * 1024;
/// Images shown, at most (bytes).
const MAX_IMAGE: u64 = 15 * 1024 * 1024;
/// What preview_read gives the chat, at most (characters).
const MAX_READ: usize = 30_000;

static APP: OnceLock<AppHandle> = OnceLock::new();

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Tab {
    pub id: u32,
    /// "web" or "file".
    pub kind: &'static str,
    /// The address or the file's full path.
    pub target: String,
    pub title: String,
    /// A file drawn by the browser (HTML, PDF, SVG).
    pub browser: bool,
    pub loading: bool,
    /// Console errors since the page loaded.
    pub errors: u32,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleLine {
    /// log, info, warn, error, debug.
    pub level: String,
    pub text: String,
    pub at: String,
}

#[derive(Clone, Copy, Default)]
struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    /// fit, desktop, tablet, mobile, or custom.
    pub preset: String,
    pub width: u32,
    pub height: u32,
    /// "" (the page's own), "light" or "dark".
    pub scheme: String,
    /// "fit" (shrunk until it fits: the device's size, or a desktop's 1280 px
    /// without one), "100" (normal size) or "orig" (one page pixel per screen pixel).
    pub zoom: String,
}

impl Default for View {
    fn default() -> Self {
        View { preset: "fit".into(), width: 0, height: 0, scheme: String::new(), zoom: "fit".into() }
    }
}

/// A desktop's width, for «Adatta» without a device: a narrow panel shows the
/// page as on a PC, shrunk, instead of its phone layout.
const DESKTOP_W: f64 = 1280.0;

/// The browser's box in the content area and its zoom, for the view and the
/// screen's scale. The zoom makes the page's own width the device's.
fn frame(r: Rect, v: &View, scale: f64) -> (f64, f64, f64, f64, f64) {
    let device = v.width > 0 && v.height > 0;
    match v.zoom.as_str() {
        "100" | "orig" => {
            let z = if v.zoom == "orig" { 1.0 / scale.max(0.5) } else { 1.0 };
            if !device {
                return (r.x, r.y, r.w, r.h, z);
            }
            // The device at that size, centred, cut by the area when bigger.
            let (w, h) = ((v.width as f64 * z).min(r.w), (v.height as f64 * z).min(r.h));
            (r.x + (r.w - w) / 2.0, r.y + (r.h - h) / 2.0, w, h, z)
        }
        _ => {
            if device {
                let (x, y, w, h) = fit(r, v);
                return (x, y, w, h, w / v.width as f64);
            }
            (r.x, r.y, r.w, r.h, (r.w / DESKTOP_W).min(1.0).max(0.25))
        }
    }
}

#[derive(Default)]
struct State {
    tabs: Vec<Tab>,
    active: u32,
    next: u32,
    rect: Rect,
    /// The page hides the browser while an overlay of its own is open.
    covered: bool,
    /// Where the page is in its window (docked: the island's panel), logical px.
    origin: (f64, f64),
    /// The page is in sight (docked: the island is open on a view with the panel).
    shown: bool,
    view: View,
    console: HashMap<u32, Vec<ConsoleLine>>,
    /// The page's requests (DevTools Network), for preview_network.
    net: HashMap<u32, Vec<Request>>,
    /// A file's text before the chat changed it (for «Modifiche»), by path.
    before: HashMap<String, String>,
    /// Files' last change, for the watcher.
    seen: HashMap<String, SystemTime>,
}

/// One request of a page: failed ones say why (`failed`) or carry a status >= 400.
#[derive(Clone, Default)]
struct Request {
    id: String,
    method: String,
    url: String,
    kind: String,
    status: u16,
    failed: String,
}

impl Request {
    fn bad(&self) -> bool {
        !self.failed.is_empty() || self.status >= 400
    }
}

static STATE: LazyLock<Mutex<State>> = LazyLock::new(|| Mutex::new(State { next: 1, ..Default::default() }));

pub fn init(app: &AppHandle) {
    let _ = APP.set(app.clone());
}

fn state() -> std::sync::MutexGuard<'static, State> {
    STATE.lock().unwrap_or_else(|e| e.into_inner())
}

fn web_label(id: u32) -> String {
    format!("{WEB}{id}")
}

fn emit_tabs(app: &AppHandle) {
    let _ = app.emit_to(UI, "preview-tabs", snapshot(app));
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub tabs: Vec<Tab>,
    pub active: u32,
    pub view: View,
    /// The page is the island's panel (no frame: the page shows its own ✕).
    pub docked: bool,
}

pub fn snapshot(app: &AppHandle) -> Snapshot {
    let docked = docked_now(app);
    let s = state();
    Snapshot { tabs: s.tabs.clone(), active: s.active, view: s.view.clone(), docked }
}

/// The page's ✕ (docked: there is no frame), or the other kind chosen.
/// The page and its browsers go; the tabs stay in STATE for next time.
pub fn close_window(app: &AppHandle) {
    if let Some(w) = app.get_window(LABEL) {
        let _ = w.destroy();
        return;
    }
    let ids: Vec<u32> = state().tabs.iter().map(|tb| tb.id).collect();
    for id in ids {
        close_web(app, id);
    }
    if let Some(page) = app.get_webview(UI) {
        let _ = page.close();
    }
    let _ = app.emit_to(crate::island::WINDOW_LABEL, "preview-docked", false);
}

// ── What a target is ─────────────────────────────────────────────────────────

/// An address the browser can open: http(s), or "localhost:3000" and the like.
fn as_url(target: &str) -> Option<String> {
    let t = target.trim();
    let low = t.to_lowercase();
    if low.starts_with("http://") || low.starts_with("https://") {
        return tauri::Url::parse(t).ok().map(|u| u.to_string());
    }
    let local = ["localhost", "127.0.0.1", "[::1]", "0.0.0.0"];
    if local.iter().any(|h| low == *h || low.starts_with(&format!("{h}:")) || low.starts_with(&format!("{h}/"))) {
        return tauri::Url::parse(&format!("http://{}", t.replacen("0.0.0.0", "localhost", 1))).ok().map(|u| u.to_string());
    }
    // "example.com" or "example.com/x": a dot, no spaces, no backslash, not a file here.
    if !t.contains(' ') && !t.contains('\\') && t.contains('.') && !Path::new(t).exists() && !t.starts_with('.') {
        let host = t.split('/').next().unwrap_or_default();
        let tld = host.rsplit('.').next().unwrap_or_default();
        if host.contains('.') && tld.len() >= 2 && tld.chars().all(|c| c.is_ascii_alphabetic()) && !is_file_ext(tld) {
            return tauri::Url::parse(&format!("https://{t}")).ok().map(|u| u.to_string());
        }
    }
    None
}

fn is_file_ext(ext: &str) -> bool {
    matches!(
        ext.to_lowercase().as_str(),
        "md" | "txt" | "ts" | "js" | "rs" | "py" | "json" | "html" | "htm" | "css" | "csv" | "pdf" | "png" | "jpg" | "jpeg" | "svg"
            | "gif" | "toml" | "yaml" | "yml" | "xml" | "log" | "ps1" | "bat" | "cmd" | "sh" | "tsx" | "jsx" | "mjs" | "cs" | "java"
            | "go" | "c" | "h" | "cpp" | "hpp" | "sql" | "ini" | "cfg" | "vue" | "svelte" | "php" | "rb" | "lock" | "env"
    )
}

/// A file path from what the chat or the user wrote: absolute, "~\…", or
/// relative to the chat's folder (Modalità terminale), else to the home.
pub fn resolve_path(app: &AppHandle, target: &str) -> PathBuf {
    let t = target.trim().trim_matches('`').trim_matches('"');
    let t = t.strip_prefix("file:///").map(|p| p.replace("%20", " ")).unwrap_or_else(|| t.to_string());
    let home = std::env::var("USERPROFILE").map(PathBuf::from).unwrap_or_default();
    if let Some(rest) = t.strip_prefix("~\\").or_else(|| t.strip_prefix("~/")) {
        return home.join(rest);
    }
    let p = PathBuf::from(&t);
    if p.is_absolute() {
        return p;
    }
    let base = crate::workdir::root(app).unwrap_or(home);
    base.join(p)
}

fn ext_of(path: &Path) -> String {
    path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

/// Files the browser draws better than we do.
fn browser_file(path: &Path) -> bool {
    matches!(ext_of(path).as_str(), "html" | "htm" | "pdf" | "svg" | "xhtml")
}

fn file_url(path: &Path) -> Option<tauri::Url> {
    tauri::Url::from_file_path(path).ok()
}

fn file_title(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.display().to_string())
}

// ── Opening ──────────────────────────────────────────────────────────────────

/// How `open` picks the tab.
#[derive(Clone, Copy, PartialEq)]
pub enum Place {
    /// The tab already showing it, else a new one.
    Reuse,
    /// A new tab, always.
    NewTab,
    /// The active web tab navigates (the chat's preview_open), else a new one.
    Active,
}

/// Opens a file or an address in the preview, showing the window. `focus`:
/// in front of the other windows (a click), or not (a file the chat edited).
pub fn open(app: &AppHandle, target: &str, place: Place, focus: bool) -> Result<u32, String> {
    let target = target.trim();
    if target.is_empty() {
        return Err(t("Scrivi un indirizzo o il percorso di un file.").into());
    }
    let (kind, full, title, browser) = if let Some(url) = as_url(target) {
        ("web", url.clone(), url.trim_start_matches("https://").trim_start_matches("http://").trim_end_matches('/').to_string(), true)
    } else {
        let path = resolve_path(app, target);
        if !path.exists() {
            return Err(tf("Non trovo «{p}».", &[("p", &path.display().to_string())]));
        }
        if path.is_dir() {
            return Err(tf("«{p}» è una cartella: l'anteprima mostra file e pagine web.", &[("p", &path.display().to_string())]));
        }
        let browser = browser_file(&path);
        ("file", path.display().to_string(), file_title(&path), browser)
    };
    let id = {
        let mut s = state();
        let same = s.tabs.iter().find(|tb| tb.kind == kind && tb.target.eq_ignore_ascii_case(&full)).map(|tb| tb.id);
        let active_web = s.tabs.iter().find(|tb| tb.id == s.active && tb.kind == "web").map(|tb| tb.id);
        match (place, same, active_web) {
            (Place::Reuse, Some(id), _) => {
                s.active = id;
                id
            }
            (Place::Active, _, Some(id)) if kind == "web" => {
                if let Some(tb) = s.tabs.iter_mut().find(|tb| tb.id == id) {
                    tb.target = full.clone();
                    tb.title = title.clone();
                    tb.loading = true;
                }
                s.active = id;
                drop(s);
                navigate_web(app, id, &full);
                id
            }
            _ => {
                let id = s.next;
                s.next += 1;
                s.tabs.push(Tab { id, kind, target: full.clone(), title, browser, loading: browser, errors: 0 });
                s.active = id;
                // Too many: the oldest that is not this one goes.
                if s.tabs.len() > MAX_TABS {
                    if let Some(pos) = s.tabs.iter().position(|tb| tb.id != id) {
                        let gone = s.tabs.remove(pos);
                        s.console.remove(&gone.id);
                        s.net.remove(&gone.id);
                        close_web(app, gone.id);
                    }
                }
                id
            }
        }
    };
    show(app, focus)?;
    sync(app);
    emit_tabs(app);
    Ok(id)
}

/// The preview is open: its page exists, in its own window or in the island's.
pub fn is_open(app: &AppHandle) -> bool {
    app.get_webview(UI).is_some()
}

/// Docked: the page lives in the island's window, as the panel on its right.
fn docked_now(app: &AppHandle) -> bool {
    is_open(app) && app.get_window(LABEL).is_none()
}

/// The window that holds the page and its browsers.
fn host(app: &AppHandle) -> Option<tauri::Window> {
    if let Some(w) = app.get_window(LABEL) {
        return Some(w);
    }
    is_open(app).then(|| crate::island::window(app).map(|w| w.as_ref().window())).flatten()
}

fn docked_setting(app: &AppHandle) -> bool {
    app.try_state::<crate::Shared>().map(|sh| sh.settings.lock().unwrap().preview_docked).unwrap_or(false)
}

/// Opens the preview: its window, or (docked) the panel inside the island,
/// made the first time and kept until closed.
pub fn show(app: &AppHandle, focus: bool) -> Result<(), String> {
    let docked = docked_setting(app);
    // The other kind was chosen meanwhile: made again (the tabs stay in STATE).
    if is_open(app) && docked_now(app) != docked {
        close_window(app);
    }
    if is_open(app) {
        if docked {
            let _ = app.emit_to(crate::island::WINDOW_LABEL, "preview-docked", true);
        } else if let Some(win) = app.get_window(LABEL) {
            let _ = win.unminimize();
            let _ = win.show();
            if focus {
                let _ = win.set_focus();
            }
        }
        return Ok(());
    }
    let mut ui = WebviewBuilder::new(UI, crate::page_url(app, "anteprima.html"))
        .additional_browser_args(crate::BROWSER_ARGS)
        // Files dropped on the page open in a tab (src/preview/main.ts, drop.rs).
        .disable_drag_drop_handler();
    if let Some(dir) = crate::webview_dir() {
        ui = ui.data_directory(dir);
    }
    let page = if docked {
        // A panel of the island (island.ts places it): its window holds the page
        // and the browsers, shown where the island says, hidden while it is closed.
        let island = crate::island::window(app).ok_or_else(|| t("L'isola non c'è.").to_string())?;
        let win = island.as_ref().window();
        {
            let mut s = state();
            s.origin = (0.0, 0.0);
            s.shown = false;
        }
        let page = win.add_child(ui, tauri::LogicalPosition::new(0.0, 0.0), tauri::LogicalSize::new(1.0, 1.0)).map_err(|e| e.to_string())?;
        let _ = page.hide();
        let _ = app.emit_to(crate::island::WINDOW_LABEL, "preview-docked", true);
        page
    } else {
        crate::island::keep_settings_above(app, false);
        let win = tauri::window::WindowBuilder::new(app, LABEL)
            .title(t("Anteprima — EasyIsland"))
            .theme(Some(tauri::Theme::Dark))
            .inner_size(1180.0, 820.0)
            .min_inner_size(560.0, 420.0)
            .resizable(true)
            .focused(focus)
            .center()
            .build()
            .map_err(|e| e.to_string())?;
        {
            let mut s = state();
            s.origin = (0.0, 0.0);
            s.shown = true;
        }
        let size = win.inner_size().map_err(|e| e.to_string())?.to_logical::<f64>(win.scale_factor().unwrap_or(1.0));
        win.add_child(ui.auto_resize(), tauri::LogicalPosition::new(0.0, 0.0), size).map_err(|e| e.to_string())?
    };
    // Dropped files reach the page as HTML5 drops; their paths come from here (drop.rs).
    crate::drop::install_on(app, &page, UI);
    watch(app.clone());
    Ok(())
}

/// Impostazioni → Chat → Anteprima changed while it is open: turned off it
/// closes, moved (island / window) it opens again the new way, same tabs.
/// Off the main thread: a save runs there, and making a webview there hangs.
pub fn settings_changed(app: &AppHandle, settings: &crate::settings::Settings) {
    if !is_open(app) {
        return;
    }
    let (on, docked) = (settings.chat_preview, settings.preview_docked);
    if on && docked_now(app) == docked {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        close_window(&app);
        if on {
            if let Err(e) = show(&app, false) {
                crate::log::line(format!("anteprima: {e}"));
            }
            sync(&app);
            emit_tabs(&app);
        }
    });
}

/// Docked: where the island draws the panel (logical px of its window); a
/// zero width hides the page and its browsers (island closed, other view).
pub fn pane(app: &AppHandle, x: f64, y: f64, w: f64, h: f64) {
    if !docked_now(app) {
        return;
    }
    let Some(page) = app.get_webview(UI) else { return };
    let visible = w > 1.0 && h > 1.0;
    {
        let mut s = state();
        s.origin = (x, y);
        s.shown = visible;
    }
    if visible {
        let _ = page.set_bounds(tauri::Rect { position: tauri::LogicalPosition::new(x, y).into(), size: tauri::LogicalSize::new(w, h).into() });
        let _ = page.show();
    } else {
        let _ = page.hide();
    }
    sync(app);
}

pub fn select(app: &AppHandle, id: u32) {
    {
        let mut s = state();
        if s.tabs.iter().any(|tb| tb.id == id) {
            s.active = id;
        }
    }
    sync(app);
    emit_tabs(app);
}

pub fn close_tab(app: &AppHandle, id: u32) {
    {
        let mut s = state();
        let Some(pos) = s.tabs.iter().position(|tb| tb.id == id) else { return };
        s.tabs.remove(pos);
        s.console.remove(&id);
        s.net.remove(&id);
        if s.active == id {
            s.active = s.tabs.get(pos.min(s.tabs.len().saturating_sub(1))).map(|tb| tb.id).unwrap_or(0);
        }
    }
    close_web(app, id);
    sync(app);
    emit_tabs(app);
}

fn close_web(app: &AppHandle, id: u32) {
    if let Some(w) = app.get_webview(&web_label(id)) {
        let _ = w.close();
    }
}

/// The page's content area, in logical pixels of the window.
pub fn layout(app: &AppHandle, x: f64, y: f64, w: f64, h: f64, covered: bool) {
    {
        let mut s = state();
        s.rect = Rect { x, y, w: w.max(0.0), h: h.max(0.0) };
        s.covered = covered;
    }
    sync(app);
}

/// Back, forward, reload, or a new address for a web tab.
pub fn nav(app: &AppHandle, id: u32, action: &str) -> Result<(), String> {
    let tab = state().tabs.iter().find(|tb| tb.id == id).cloned().ok_or_else(|| t("Scheda chiusa.").to_string())?;
    let label = web_label(id);
    match action {
        "back" | "forward" => {
            let w = app.get_webview(&label).ok_or_else(|| t("Questa scheda non ha una pagina web.").to_string())?;
            let _ = w.eval(if action == "back" { "history.back()" } else { "history.forward()" });
        }
        "reload" => {
            if let Some(w) = app.get_webview(&label) {
                let _ = w.reload();
            } else {
                let _ = app.emit_to(UI, "preview-file", tab.target.clone());
            }
        }
        target => {
            if tab.kind == "web" {
                let url = as_url(target).ok_or_else(|| t("Non è un indirizzo web.").to_string())?;
                {
                    let mut s = state();
                    if let Some(tb) = s.tabs.iter_mut().find(|tb| tb.id == id) {
                        tb.target = url.clone();
                        tb.loading = true;
                    }
                }
                navigate_web(app, id, &url);
                emit_tabs(app);
            } else {
                open(app, target, Place::Reuse, true)?;
            }
        }
    }
    Ok(())
}

fn navigate_web(app: &AppHandle, id: u32, url: &str) {
    if let (Some(w), Ok(u)) = (app.get_webview(&web_label(id)), tauri::Url::parse(url)) {
        let _ = w.navigate(u);
    }
}

pub fn set_view(app: &AppHandle, preset: &str, width: u32, height: u32, scheme: &str, zoom: &str) {
    {
        let mut s = state();
        if matches!(zoom, "fit" | "100" | "orig") {
            s.view.zoom = zoom.to_string();
        }
        let (w, h) = match preset {
            "desktop" => (1280, 800),
            "tablet" => (768, 1024),
            "mobile" => (375, 812),
            "custom" => (width.clamp(200, 3840), height.clamp(200, 2400)),
            _ => (0, 0),
        };
        s.view.preset = if w == 0 { "fit".into() } else { preset.to_string() };
        s.view.width = w;
        s.view.height = h;
        if matches!(scheme, "" | "light" | "dark") {
            s.view.scheme = scheme.to_string();
        }
    }
    let ids: Vec<u32> = state().tabs.iter().map(|tb| tb.id).collect();
    for id in ids {
        if let Some(w) = app.get_webview(&web_label(id)) {
            emulate(&w);
        }
    }
    sync(app);
    emit_tabs(app);
}

// ── The browser layer ────────────────────────────────────────────────────────

/// Places the active tab's browser on the content area (making it the first
/// time), hides the others. Called after every change.
fn sync(app: &AppHandle) {
    let Some(win) = host(app) else { return };
    let (tabs, active, rect, covered, view, origin, shown) = {
        let s = state();
        (s.tabs.clone(), s.active, s.rect, s.covered, s.view.clone(), s.origin, s.shown)
    };
    let rect = Rect { x: rect.x + origin.0, y: rect.y + origin.1, ..rect };
    for tb in &tabs {
        let label = web_label(tb.id);
        let wanted = shown && tb.id == active && tb.browser && rect.w > 1.0 && rect.h > 1.0;
        let existing = app.get_webview(&label);
        if !wanted {
            if let Some(w) = existing {
                let _ = w.hide();
            }
            continue;
        }
        let (x, y, w, h, zoom) = frame(rect, &view, win.scale_factor().unwrap_or(1.0));
        let webview = match existing {
            Some(w) => w,
            None => match make_web(app, &win, tb, (x, y, w, h)) {
                Ok(w) => w,
                Err(e) => {
                    crate::log::line(format!("anteprima: browser non creato: {e}"));
                    continue;
                }
            },
        };
        let _ = webview.set_bounds(tauri::Rect { position: tauri::LogicalPosition::new(x, y).into(), size: tauri::LogicalSize::new(w, h).into() });
        let _ = webview.set_zoom(zoom);
        if covered {
            let _ = webview.hide();
        } else {
            let _ = webview.show();
        }
    }
}

/// Where the browser goes inside the content area: all of it, or the chosen
/// device size scaled down to fit, centred.
fn fit(r: Rect, v: &View) -> (f64, f64, f64, f64) {
    if v.width == 0 || v.height == 0 {
        return (r.x, r.y, r.w, r.h);
    }
    let pad = 12.0;
    let scale = ((r.w - pad * 2.0) / v.width as f64).min((r.h - pad * 2.0) / v.height as f64).min(1.0).max(0.1);
    let (w, h) = (v.width as f64 * scale, v.height as f64 * scale);
    (r.x + (r.w - w) / 2.0, r.y + (r.h - h) / 2.0, w, h)
}

fn make_web(app: &AppHandle, win: &tauri::Window, tab: &Tab, bounds: (f64, f64, f64, f64)) -> Result<Webview, String> {
    let url = if tab.kind == "web" {
        tauri::Url::parse(&tab.target).map_err(|e| e.to_string())?
    } else {
        file_url(Path::new(&tab.target)).ok_or_else(|| t("Percorso non valido.").to_string())?
    };
    let id = tab.id;
    let mut b = WebviewBuilder::new(web_label(id), WebviewUrl::External(url))
        .additional_browser_args(crate::BROWSER_ARGS)
        // A page's own drops (an upload field) stay the page's.
        .disable_drag_drop_handler()
        .on_navigation(|u| matches!(u.scheme(), "http" | "https" | "file" | "about" | "data" | "blob"))
        .on_page_load(move |w, payload| {
            let loading = matches!(payload.event(), tauri::webview::PageLoadEvent::Started);
            let url = payload.url().to_string();
            {
                let mut s = state();
                if loading {
                    s.console.entry(id).or_default().clear();
                    s.net.entry(id).or_default().clear();
                }
                if let Some(tb) = s.tabs.iter_mut().find(|tb| tb.id == id) {
                    tb.loading = loading;
                    if tb.kind == "web" && url.starts_with("http") {
                        tb.target = url;
                    }
                    if loading {
                        tb.errors = 0;
                    }
                }
            }
            if !loading {
                emulate(&w);
            }
            if let Some(app) = APP.get() {
                emit_tabs(app);
            }
        })
        .on_document_title_changed(move |_, title| {
            let title = title.trim().to_string();
            if title.is_empty() {
                return;
            }
            {
                let mut s = state();
                if let Some(tb) = s.tabs.iter_mut().find(|tb| tb.id == id && tb.kind == "web") {
                    tb.title = title.chars().take(80).collect();
                }
            }
            if let Some(app) = APP.get() {
                emit_tabs(app);
            }
        })
        // A link that wants a new window opens in a new tab instead.
        .on_new_window(|url, _| {
            let target = url.to_string();
            if let Some(app) = APP.get() {
                let app = app.clone();
                std::thread::spawn(move || {
                    let _ = open(&app, &target, Place::NewTab, true);
                });
            }
            tauri::webview::NewWindowResponse::Deny
        });
    if let Some(dir) = crate::webview_dir() {
        b = b.data_directory(dir);
    }
    let w = win
        .add_child(b, tauri::LogicalPosition::new(bounds.0, bounds.1), tauri::LogicalSize::new(bounds.2, bounds.3))
        .map_err(|e| e.to_string())?;
    devtools_and_console(&w, id);
    let _ = app;
    Ok(w)
}

// ── WebView2: DevTools protocol ──────────────────────────────────────────────

use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2;
use webview2_com::{CallDevToolsProtocolMethodCompletedHandler, DevToolsProtocolEventReceivedEventHandler};
use windows_core_wv2::HSTRING;

/// One DevTools protocol call; the answer (JSON) to `done`, on WebView2's thread.
fn cdp(core: &ICoreWebView2, method: &str, params: &Value, done: impl FnOnce(Result<String, String>) + 'static) {
    let handler = CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |hr, json| {
        done(hr.map(|_| json).map_err(|e| e.message().to_string()));
        Ok(())
    }));
    let r = unsafe { core.CallDevToolsProtocolMethod(&HSTRING::from(method), &HSTRING::from(params.to_string()), &handler) };
    if let Err(e) = r {
        crate::log::line(format!("anteprima: {method}: {e}"));
    }
}

fn with_core(w: &Webview, f: impl FnOnce(ICoreWebView2) + Send + 'static) -> Result<(), String> {
    w.with_webview(move |pw| {
        let core = unsafe { pw.controller().CoreWebView2() };
        if let Ok(core) = core {
            f(core);
        }
    })
    .map_err(|e| e.to_string())
}

/// DevTools allowed (the «Strumenti per sviluppatori» button), and the console
/// and page errors collected for the tab.
fn devtools_and_console(w: &Webview, id: u32) {
    let _ = with_core(w, move |core| unsafe {
        if let Ok(settings) = core.Settings() {
            let _ = settings.SetAreDevToolsEnabled(true);
        }
        cdp(&core, "Runtime.enable", &json!({}), |_| {});
        cdp(&core, "Log.enable", &json!({}), |_| {});
        // Only the headers' events: no bodies are kept (preview_network).
        cdp(&core, "Network.enable", &json!({ "maxTotalBufferSize": 0, "maxResourceBufferSize": 0 }), |_| {});
        for event in ["Runtime.consoleAPICalled", "Runtime.exceptionThrown", "Log.entryAdded", "Network.requestWillBeSent", "Network.responseReceived", "Network.loadingFailed"] {
            let Ok(receiver) = core.GetDevToolsProtocolEventReceiver(&HSTRING::from(event)) else { continue };
            let handler = DevToolsProtocolEventReceivedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut raw = windows_core_wv2::PWSTR::null();
                if args.ParameterObjectAsJson(&mut raw).is_ok() {
                    let json = webview2_com::take_pwstr(raw);
                    if event.starts_with("Network.") {
                        net_event(id, event, &json);
                    } else if let Some(line) = console_line(event, &json) {
                        push_console(id, line);
                    }
                }
                Ok(())
            }));
            let mut token = 0i64;
            let _ = receiver.add_DevToolsProtocolEventReceived(&handler, &mut token);
        }
    });
}

/// A request seen, answered or failed; the last MAX_CONSOLE per tab, no data: URLs.
fn net_event(id: u32, event: &str, json: &str) {
    let Ok(v) = serde_json::from_str::<Value>(json) else { return };
    let str_of = |v: &Value, k: &str| v.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
    let rid = str_of(&v, "requestId");
    let mut s = state();
    let list = s.net.entry(id).or_default();
    match event {
        "Network.requestWillBeSent" => {
            let req = v.get("request").cloned().unwrap_or(Value::Null);
            let url = str_of(&req, "url");
            if url.starts_with("data:") || url.starts_with("blob:") {
                return;
            }
            // A redirect reuses the id: the new address replaces the old one.
            list.retain(|r| r.id != rid);
            list.push(Request { id: rid, method: str_of(&req, "method"), url: url.chars().take(500).collect(), kind: str_of(&v, "type"), ..Default::default() });
            if list.len() > MAX_CONSOLE {
                let extra = list.len() - MAX_CONSOLE;
                list.drain(..extra);
            }
        }
        "Network.responseReceived" => {
            if let Some(r) = list.iter_mut().find(|r| r.id == rid) {
                r.status = v.get("response").and_then(|x| x.get("status")).and_then(Value::as_u64).unwrap_or(0).min(999) as u16;
            }
        }
        _ => {
            if v.get("canceled").and_then(Value::as_bool).unwrap_or(false) {
                return;
            }
            if let Some(r) = list.iter_mut().find(|r| r.id == rid) {
                r.failed = str_of(&v, "errorText");
                if r.failed.is_empty() {
                    r.failed = "failed".into();
                }
            }
        }
    }
}

/// What the chat is told about the preview in front of a message, when it
/// changed since the last time: the open tabs, the active one, errors.
pub fn hint() -> Option<String> {
    static LAST: Mutex<String> = Mutex::new(String::new());
    let app = APP.get()?;
    let open = match app.get_window(LABEL) {
        Some(w) => w.is_visible().unwrap_or(false),
        None => is_open(app) && state().shown,
    };
    let text = if open {
        let s = state();
        match s.tabs.iter().find(|tb| tb.id == s.active) {
            Some(active) => {
                let failed = s.net.get(&active.id).map(|l| l.iter().filter(|r| r.bad()).count()).unwrap_or(0);
                tf("[Anteprima aperta accanto alla chat: {n} schede; attiva la {id} ({kind}) «{title}» — {target}; {e} errori in console, {f} richieste fallite. La puoi usare con gli strumenti preview_* (preview_snapshot per vedere la pagina).]\n\n", &[
                    ("n", &s.tabs.len().to_string()),
                    ("id", &active.id.to_string()),
                    ("kind", &active.kind),
                    ("title", &active.title),
                    ("target", &active.target),
                    ("e", &active.errors.to_string()),
                    ("f", &failed.to_string()),
                ])
            }
            None => String::new(),
        }
    } else {
        String::new()
    };
    let mut last = LAST.lock().unwrap();
    if *last == text {
        return None;
    }
    *last = text.clone();
    (!text.is_empty()).then_some(text)
}

/// A console message, an uncaught error or a browser log entry as one line.
fn console_line(event: &str, json: &str) -> Option<ConsoleLine> {
    let v: Value = serde_json::from_str(json).ok()?;
    let (level, text) = match event {
        "Runtime.consoleAPICalled" => {
            let kind = v.get("type").and_then(Value::as_str).unwrap_or("log");
            let level = match kind {
                "error" | "assert" => "error",
                "warning" => "warn",
                "info" => "info",
                "debug" => "debug",
                _ => "log",
            };
            let parts: Vec<String> = v
                .get("args")
                .and_then(Value::as_array)
                .map(|a| a.iter().map(remote_object).collect())
                .unwrap_or_default();
            (level.to_string(), parts.join(" "))
        }
        "Runtime.exceptionThrown" => {
            let d = v.get("exceptionDetails")?;
            let text = d
                .get("exception")
                .and_then(|e| e.get("description"))
                .and_then(Value::as_str)
                .or_else(|| d.get("text").and_then(Value::as_str))
                .unwrap_or("Errore");
            ("error".to_string(), text.to_string())
        }
        _ => {
            let e = v.get("entry")?;
            let level = match e.get("level").and_then(Value::as_str).unwrap_or("info") {
                "error" => "error",
                "warning" => "warn",
                "verbose" => "debug",
                _ => "info",
            };
            let mut text = e.get("text").and_then(Value::as_str).unwrap_or_default().to_string();
            if let Some(url) = e.get("url").and_then(Value::as_str) {
                text = format!("{text} ({url})");
            }
            (level.to_string(), text)
        }
    };
    let at = crate::memory::stamp().chars().skip(11).collect::<String>();
    Some(ConsoleLine { level, text: text.chars().take(4000).collect(), at })
}

fn remote_object(o: &Value) -> String {
    if let Some(v) = o.get("value") {
        return match v {
            Value::String(s) => s.clone(),
            other => other.to_string(),
        };
    }
    o.get("description").or_else(|| o.get("unserializableValue")).and_then(Value::as_str).unwrap_or_default().to_string()
}

fn push_console(id: u32, line: ConsoleLine) {
    let error = line.level == "error";
    {
        let mut s = state();
        let list = s.console.entry(id).or_default();
        list.push(line);
        if list.len() > MAX_CONSOLE {
            let extra = list.len() - MAX_CONSOLE;
            list.drain(..extra);
        }
        if error {
            if let Some(tb) = s.tabs.iter_mut().find(|tb| tb.id == id) {
                tb.errors += 1;
            }
        }
    }
    if let Some(app) = APP.get() {
        let _ = app.emit_to(UI, "preview-console", id);
        if error {
            emit_tabs(app);
        }
    }
}

pub fn console(id: u32) -> Vec<ConsoleLine> {
    state().console.get(&id).cloned().unwrap_or_default()
}

pub fn clear_console(app: &AppHandle, id: u32) {
    {
        let mut s = state();
        s.console.remove(&id);
        if let Some(tb) = s.tabs.iter_mut().find(|tb| tb.id == id) {
            tb.errors = 0;
        }
    }
    emit_tabs(app);
}

/// The chosen device size and colour scheme, on one page.
fn emulate(w: &Webview) {
    let view = state().view.clone();
    let _ = with_core(w, move |core| {
        // The page's width comes from the box and the zoom (frame); the phone
        // keeps touch and the mobile flag.
        if view.preset == "mobile" {
            cdp(&core, "Emulation.setDeviceMetricsOverride", &json!({
                "width": 0, "height": 0, "deviceScaleFactor": 0, "mobile": true,
            }), |_| {});
            cdp(&core, "Emulation.setTouchEmulationEnabled", &json!({ "enabled": true }), |_| {});
        } else {
            cdp(&core, "Emulation.clearDeviceMetricsOverride", &json!({}), |_| {});
            cdp(&core, "Emulation.setTouchEmulationEnabled", &json!({ "enabled": false }), |_| {});
        }
        cdp(&core, "Emulation.setEmulatedMedia", &json!({
            "features": [{ "name": "prefers-color-scheme", "value": view.scheme }],
        }), |_| {});
    });
}

pub fn devtools(app: &AppHandle, id: u32) -> Result<(), String> {
    let w = app.get_webview(&web_label(id)).ok_or_else(|| t("Questa scheda non ha una pagina web.").to_string())?;
    with_core(&w, |core| unsafe {
        let _ = core.OpenDevToolsWindow();
    })
}

/// The tab's page (or the preview's own page for a file shown by it) as PNG.
async fn screenshot_of(app: &AppHandle, id: u32) -> Result<Vec<u8>, String> {
    let w = app
        .get_webview(&web_label(id))
        .filter(|_| state().tabs.iter().any(|tb| tb.id == id && tb.browser))
        .or_else(|| app.get_webview(UI))
        .ok_or_else(|| t("L'anteprima non è aperta.").to_string())?;
    let (tx, rx) = tokio::sync::oneshot::channel::<Result<String, String>>();
    with_core(&w, move |core| {
        cdp(&core, "Page.captureScreenshot", &json!({ "format": "png" }), move |r| {
            let _ = tx.send(r);
        });
    })?;
    let json = tokio::time::timeout(Duration::from_secs(15), rx).await.map_err(|_| t("La pagina non ha risposto.").to_string())?.map_err(|e| e.to_string())??;
    let v: Value = serde_json::from_str(&json).map_err(|e| e.to_string())?;
    let data = v.get("data").and_then(Value::as_str).ok_or_else(|| t("Schermata non riuscita.").to_string())?;
    crate::backup::base64_decode(data).ok_or_else(|| t("Schermata non riuscita.").to_string())
}

/// A script on the tab's page; its value as JSON text.
async fn eval(app: &AppHandle, id: u32, script: &str) -> Result<String, String> {
    let w = app.get_webview(&web_label(id)).ok_or_else(|| t("Questa scheda non ha una pagina web aperta.").to_string())?;
    let (tx, rx) = tokio::sync::oneshot::channel::<String>();
    let tx = Mutex::new(Some(tx));
    w.eval_with_callback(script, move |out| {
        if let Some(tx) = tx.lock().ok().and_then(|mut t| t.take()) {
            let _ = tx.send(out);
        }
    })
    .map_err(|e| e.to_string())?;
    tokio::time::timeout(Duration::from_secs(15), rx).await.map_err(|_| t("La pagina non ha risposto.").to_string())?.map_err(|e| e.to_string())
}

// ── Files ────────────────────────────────────────────────────────────────────

#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct FileView {
    /// text, image, binary, missing, big.
    pub kind: &'static str,
    pub path: String,
    pub name: String,
    pub ext: String,
    pub size: u64,
    pub text: String,
    /// data: URL of an image.
    pub data_url: String,
    /// The text before the chat changed it, when it did.
    pub before: Option<String>,
    /// Last change, seconds since 1970.
    pub modified: u64,
}

pub fn read_file(path: &str) -> FileView {
    let p = PathBuf::from(path);
    let mut out = FileView { path: path.to_string(), name: file_title(&p), ext: ext_of(&p), ..Default::default() };
    let Ok(meta) = std::fs::metadata(&p) else {
        out.kind = "missing";
        return out;
    };
    out.size = meta.len();
    out.modified = meta.modified().ok().and_then(|m| m.duration_since(SystemTime::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0);
    let image = matches!(out.ext.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "ico" | "avif");
    if image {
        if out.size > MAX_IMAGE {
            out.kind = "big";
            return out;
        }
        let mime = match out.ext.as_str() {
            "jpg" | "jpeg" => "image/jpeg".to_string(),
            "ico" => "image/x-icon".to_string(),
            e => format!("image/{e}"),
        };
        return image_view(out, &p, &mime);
    }
    if out.size > MAX_TEXT {
        out.kind = "big";
        return out;
    }
    let Ok(bytes) = std::fs::read(&p) else {
        out.kind = "missing";
        return out;
    };
    // A NUL in the first 8 KB: not text.
    if bytes.iter().take(8192).any(|b| *b == 0) {
        out.kind = "binary";
        return out;
    }
    out.kind = "text";
    out.text = String::from_utf8_lossy(&bytes).into_owned();
    out.before = state().before.get(&key(path)).cloned().filter(|b| *b != out.text);
    out
}

fn image_view(mut out: FileView, p: &Path, mime: &str) -> FileView {
    match std::fs::read(p) {
        Ok(bytes) => {
            out.kind = "image";
            out.data_url = format!("data:{mime};base64,{}", crate::claude::base64_for(&bytes));
        }
        Err(_) => out.kind = "missing",
    }
    out
}

fn key(path: &str) -> String {
    path.replace('/', "\\").to_lowercase()
}

/// «Modalità terminale» is about to change a file (a step of Claude Code or
/// opencode): its text now is the «Modifiche» baseline, and the file opens in
/// the preview when the user wants it.
pub fn touched(path: &str) {
    let Some(app) = APP.get() else { return };
    let full = resolve_path(app, path);
    let k = key(&full.display().to_string());
    {
        let mut s = state();
        if !s.before.contains_key(&k) {
            let text = std::fs::metadata(&full)
                .ok()
                .filter(|m| m.len() <= MAX_TEXT)
                .and_then(|_| std::fs::read(&full).ok())
                .map(|b| String::from_utf8_lossy(&b).into_owned())
                .unwrap_or_default();
            s.before.insert(k, text);
            // A few hundred files at most.
            if s.before.len() > 300 {
                if let Some(first) = s.before.keys().next().cloned() {
                    s.before.remove(&first);
                }
            }
        }
    }
    let wanted = app.try_state::<crate::Shared>().map(|sh| sh.settings.lock().unwrap().chat_preview).unwrap_or(false);
    if !wanted {
        return;
    }
    // The edit happens after the permission: open once the file is there.
    let app = app.clone();
    std::thread::spawn(move || {
        for _ in 0..240 {
            if full.is_file() {
                let _ = open(&app, &full.display().to_string(), Place::Reuse, false);
                return;
            }
            std::thread::sleep(Duration::from_millis(500));
        }
    });
}

/// A step line's file ("edit"/"write" of opencode, Edit/Write of Claude Code).
pub fn touched_by(tool: &str, input: &Value) {
    let edits = matches!(tool, "edit" | "write" | "patch" | "multiedit" | "Edit" | "Write" | "MultiEdit" | "NotebookEdit");
    if !edits {
        return;
    }
    let path = ["file_path", "filePath", "path", "notebook_path"].iter().find_map(|k| input.get(*k).and_then(Value::as_str));
    if let Some(p) = path {
        touched(p);
    }
}

/// While the window exists: files that changed are drawn again, and a file
/// shown by the browser reloads.
fn watch(app: AppHandle) {
    static RUNNING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    if RUNNING.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    std::thread::spawn(move || {
        while is_open(&app) {
            std::thread::sleep(Duration::from_millis(800));
            let files: Vec<(u32, String, bool)> = state().tabs.iter().filter(|tb| tb.kind == "file").map(|tb| (tb.id, tb.target.clone(), tb.browser)).collect();
            for (id, path, browser) in files {
                let Some(m) = std::fs::metadata(&path).ok().and_then(|m| m.modified().ok()) else { continue };
                let changed = {
                    let mut s = state();
                    let old = s.seen.insert(path.clone(), m);
                    old.is_some_and(|o| o != m)
                };
                if !changed {
                    continue;
                }
                if browser {
                    if let Some(w) = app.get_webview(&web_label(id)) {
                        let _ = w.reload();
                    }
                }
                let _ = app.emit_to(UI, "preview-file", path);
            }
        }
        RUNNING.store(false, std::sync::atomic::Ordering::SeqCst);
    });
}

/// Local development servers now listening (node, python, deno…), for «+».
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Server {
    pub url: String,
    pub port: u16,
    pub process: String,
}

pub fn servers() -> Vec<Server> {
    let mut out: Vec<Server> = Vec::new();
    for l in crate::devservers::listeners() {
        if !l.addr.is_loopback() && !l.addr.is_unspecified() {
            continue;
        }
        if out.iter().any(|s| s.port == l.port) {
            continue;
        }
        let Some(name) = crate::devservers::process_name(l.pid) else { continue };
        if !crate::devservers::is_dev_program(&name) {
            continue;
        }
        out.push(Server { url: format!("http://localhost:{}/", l.port), port: l.port, process: name });
    }
    out.sort_by_key(|s| s.port);
    out
}

// ── The chat's tools ─────────────────────────────────────────────────────────

fn tab_for(arg: &str) -> Result<Tab, String> {
    let s = state();
    let id: u32 = arg.trim().parse().unwrap_or(s.active);
    s.tabs.iter().find(|tb| tb.id == id).cloned().ok_or_else(|| t("Nessuna scheda aperta nell'anteprima: aprine una con preview_open.").to_string())
}

fn tab_line(tb: &Tab, active: u32) -> String {
    let mark = if tb.id == active { "*" } else { " " };
    let errors = if tb.errors > 0 { format!(" · {} {}", tb.errors, t("errori")) } else { String::new() };
    format!("{mark}{} [{}] {} — {}{errors}", tb.id, tb.kind, tb.title, tb.target)
}

pub async fn tool(app: &AppHandle, name: &str, args: &Value) -> Result<String, String> {
    let s = |k: &str| args.get(k).and_then(Value::as_str).unwrap_or_default().to_string();
    match name {
        "preview_open" => {
            let target = s("target");
            match target.trim() {
                "back" | "forward" | "reload" => {
                    let tb = tab_for(&s("tab"))?;
                    nav(app, tb.id, target.trim())?;
                    return Ok(t("Fatto.").into());
                }
                "" => {
                    let snap = snapshot(app);
                    if snap.tabs.is_empty() {
                        return Ok(t("L'anteprima non ha schede aperte.").into());
                    }
                    return Ok(snap.tabs.iter().map(|tb| tab_line(tb, snap.active)).collect::<Vec<_>>().join("\n"));
                }
                _ => {}
            }
            let place = if args.get("new_tab").and_then(Value::as_bool).unwrap_or(false) { Place::NewTab } else { Place::Active };
            let id = open(app, &target, place, false)?;
            let tb = tab_for(&id.to_string())?;
            Ok(tf("Aperto nell'anteprima, scheda {id}: {what}", &[("id", &id.to_string()), ("what", &tb.target)]))
        }
        "preview_read" => {
            let tb = tab_for(&s("tab"))?;
            if tb.kind == "file" && !tb.browser {
                let f = read_file(&tb.target);
                return match f.kind {
                    "text" => Ok(cut(&f.text)),
                    "image" => Err(t("È un'immagine: usa preview_screenshot.").into()),
                    _ => Err(tf("Il file non si può leggere come testo ({k}).", &[("k", &f.kind)])),
                };
            }
            let script = r#"(() => {
  const t = document.body ? document.body.innerText : "";
  const links = Array.from(document.querySelectorAll("a[href]")).slice(0, 60).map(a => (a.innerText || "").trim().slice(0, 60) + " → " + a.href).filter(l => !l.startsWith(" →"));
  const fields = Array.from(document.querySelectorAll("input, textarea, select, button")).slice(0, 60).map(e => {
    const label = e.getAttribute("aria-label") || e.getAttribute("placeholder") || e.getAttribute("name") || e.id || (e.innerText || "").trim().slice(0, 40);
    return e.tagName.toLowerCase() + (e.type ? "[" + e.type + "]" : "") + " " + label;
  });
  return { title: document.title, url: location.href, text: t, links, fields };
})()"#;
            let raw = eval(app, tb.id, script).await?;
            let v: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
            let mut out = format!(
                "{}\n{}\n\n{}",
                v.get("title").and_then(Value::as_str).unwrap_or_default(),
                v.get("url").and_then(Value::as_str).unwrap_or_default(),
                v.get("text").and_then(Value::as_str).unwrap_or_default()
            );
            for (key, head) in [("links", t("Link")), ("fields", t("Campi e pulsanti"))] {
                if let Some(list) = v.get(key).and_then(Value::as_array).filter(|l| !l.is_empty()) {
                    out.push_str(&format!("\n\n{head}:\n{}", list.iter().filter_map(Value::as_str).collect::<Vec<_>>().join("\n")));
                }
            }
            Ok(cut(&out))
        }
        "preview_screenshot" => {
            let tb = tab_for(&s("tab"))?;
            let png = screenshot_of(app, tb.id).await?;
            let path = std::env::temp_dir().join(format!("easyisland-anteprima-{}.png", crate::memory::stamp().replace([':', ' '], "-")));
            std::fs::write(&path, png).map_err(|e| e.to_string())?;
            Ok(tf("Schermata della scheda {id} salvata in {p} (PNG): leggila come immagine.", &[("id", &tb.id.to_string()), ("p", &path.display().to_string())]))
        }
        "preview_console" => {
            let tb = tab_for(&s("tab"))?;
            let only_errors = args.get("errors_only").and_then(Value::as_bool).unwrap_or(false);
            let lines: Vec<String> = console(tb.id)
                .into_iter()
                .filter(|l| !only_errors || l.level == "error" || l.level == "warn")
                .map(|l| format!("{} {} {}", l.at, l.level, l.text))
                .collect();
            if lines.is_empty() {
                return Ok(t("La console è vuota.").into());
            }
            Ok(cut(&lines.join("\n")))
        }
        "preview_resize" => {
            let preset = s("preset");
            let width = args.get("width").and_then(Value::as_u64).unwrap_or(0) as u32;
            let height = args.get("height").and_then(Value::as_u64).unwrap_or(0) as u32;
            let preset = if width > 0 && height > 0 && preset.is_empty() { "custom".to_string() } else { preset };
            // Without color_scheme the current one stays; "auto" = the page's own.
            let scheme = match s("color_scheme").as_str() {
                "light" => "light".to_string(),
                "dark" => "dark".to_string(),
                "" => state().view.scheme.clone(),
                _ => String::new(),
            };
            let preset = if preset.is_empty() { state().view.preset.clone() } else { preset };
            let (width, height) = if preset == "custom" && (width == 0 || height == 0) { (state().view.width, state().view.height) } else { (width, height) };
            set_view(app, &preset, width, height, &scheme, &s("zoom"));
            let v = state().view.clone();
            Ok(tf("Vista: {p} {w}×{h}, colori {s}.", &[
                ("p", &v.preset),
                ("w", &v.width.to_string()),
                ("h", &v.height.to_string()),
                ("s", &if v.scheme.is_empty() { t("della pagina").to_string() } else { v.scheme.clone() }),
            ]))
        }
        "preview_snapshot" => {
            let tb = tab_for(&s("tab"))?;
            if tb.kind == "file" && !tb.browser {
                return Err(t("È un file, non una pagina web: usa preview_read.").into());
            }
            page_snapshot(app, tb.id).await
        }
        "preview_wait" => {
            let tb = tab_for(&s("tab"))?;
            let secs = args.get("timeout").and_then(Value::as_u64).unwrap_or(10).clamp(1, 30);
            let q = json!({ "text": s("text"), "gone": s("text_gone"), "selector": s("selector") });
            let script = format!("({WAIT})({q})");
            let until = std::time::Instant::now() + Duration::from_secs(secs);
            loop {
                // During a navigation the page does not answer: tried again.
                if let Ok(raw) = eval(app, tb.id, &script).await {
                    if raw.trim() == "true" {
                        break;
                    }
                }
                if std::time::Instant::now() >= until {
                    return Err(tf("Non è successo entro {s} secondi.", &[("s", &secs.to_string())]));
                }
                tokio::time::sleep(Duration::from_millis(300)).await;
            }
            page_snapshot(app, tb.id).await
        }
        "preview_network" => {
            let tb = tab_for(&s("tab"))?;
            let only_failed = args.get("failed_only").and_then(Value::as_bool).unwrap_or(false);
            let lines: Vec<String> = state()
                .net
                .get(&tb.id)
                .map(|l| {
                    l.iter()
                        .filter(|r| !only_failed || r.bad())
                        .map(|r| {
                            let how = if !r.failed.is_empty() { r.failed.clone() } else if r.status == 0 { "…".into() } else { r.status.to_string() };
                            format!("{} {how} {} ({})", r.method, r.url, r.kind)
                        })
                        .collect()
                })
                .unwrap_or_default();
            if lines.is_empty() {
                return Ok(t("Nessuna richiesta.").into());
            }
            Ok(cut(&lines.join("\n")))
        }
        "preview_click" | "preview_type" => {
            let tb = tab_for(&s("tab"))?;
            let target = json!({ "ref": s("ref"), "selector": s("selector"), "text": s("text_match") });
            let script = if name == "preview_click" {
                format!("({FIND})({target}, (el) => {{ el.scrollIntoView({{block: 'center'}}); el.click(); return 'ok'; }})")
            } else {
                let value = json!(s("text"));
                let submit = args.get("submit").and_then(Value::as_bool).unwrap_or(false);
                format!(
                    "({FIND})({target}, (el) => {{ el.focus(); const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const set = Object.getOwnPropertyDescriptor(proto, 'value'); if (set && set.set && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) set.set.call(el, {value}); else el.textContent = {value}; el.dispatchEvent(new Event('input', {{bubbles: true}})); el.dispatchEvent(new Event('change', {{bubbles: true}})); if ({submit}) {{ const f = el.form; if (f && f.requestSubmit) f.requestSubmit(); else el.dispatchEvent(new KeyboardEvent('keydown', {{key: 'Enter', bubbles: true}})); }} return 'ok'; }}, true)"
                )
            };
            let raw = eval(app, tb.id, &script).await?;
            let v: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
            if let Some(e) = v.get("error").and_then(Value::as_str) {
                return Err(e.to_string());
            }
            let done = tf("Fatto su «{what}».", &[("what", &v.get("what").and_then(Value::as_str).unwrap_or_default())]);
            // The page as it is now, so the chat sees what the action did.
            settle(app, tb.id).await;
            match page_snapshot(app, tb.id).await {
                Ok(snap) => Ok(format!("{done}\n\n{snap}")),
                Err(_) => Ok(done),
            }
        }
        _ => Err(format!("unknown tool {name}")),
    }
}

/// The page as the chat reads it: roles, names and a ref for each control.
async fn page_snapshot(app: &AppHandle, id: u32) -> Result<String, String> {
    let raw = eval(app, id, &format!("({SNAPSHOT})()")).await?;
    let v: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
    let mut out = format!(
        "{}\n{}\n",
        v.get("title").and_then(Value::as_str).unwrap_or_default(),
        v.get("url").and_then(Value::as_str).unwrap_or_default()
    );
    if v.get("modal").and_then(Value::as_bool).unwrap_or(false) {
        out.push_str(&t("(È aperta una finestra in primo piano: si vede solo quella.)"));
        out.push('\n');
    }
    out.push('\n');
    out.push_str(v.get("tree").and_then(Value::as_str).unwrap_or_default());
    Ok(cut(&out))
}

/// After a click or typing: a moment for the page to react, then until it has
/// loaded (a navigation), at most 3 seconds.
async fn settle(app: &AppHandle, id: u32) {
    tokio::time::sleep(Duration::from_millis(350)).await;
    for _ in 0..10 {
        let loading = state().tabs.iter().find(|tb| tb.id == id).is_some_and(|tb| tb.loading);
        if !loading && eval(app, id, "document.readyState").await.is_ok_and(|r| r.contains("complete")) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
}

/// The page's tree, as screen readers see it: one line per landmark, heading,
/// control or text, indented. Controls get a ref (e1, e2…) that stays the same
/// for the same element while the page lives, so an old ref never points at
/// another element. With a modal open only the modal is read. A password
/// field never shows its value.
const SNAPSHOT: &str = r#"() => {
  if (!window.__eiRefs) Object.defineProperty(window, "__eiRefs", { value: { byEl: new WeakMap(), byRef: new Map(), n: 0 }, enumerable: false });
  const R = window.__eiRefs;
  const refOf = (el) => { let r = R.byEl.get(el); if (!r) { r = "e" + (++R.n); R.byEl.set(el, r); R.byRef.set(r, new WeakRef(el)); } return r; };
  const shown = (el) => {
    if (el.getAttribute("aria-hidden") === "true" || el.hidden) return false;
    const s = getComputedStyle(el);
    if (s.display === "none" || s.visibility === "hidden" || s.opacity === "0") return false;
    return el.getClientRects().length > 0 || s.display === "contents";
  };
  const clip = (t, n) => { t = (t || "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n) + "…" : t; };
  const roleOf = (el) => {
    const r = el.getAttribute("role"); if (r) return r;
    const tag = el.tagName.toLowerCase();
    if (tag === "a") return el.hasAttribute("href") ? "link" : "";
    if (tag === "button" || tag === "summary") return "button";
    if (tag === "input") {
      const ty = (el.type || "text").toLowerCase();
      if (ty === "hidden") return "";
      if (["button", "submit", "reset", "image"].includes(ty)) return "button";
      if (ty === "checkbox" || ty === "radio") return ty;
      if (ty === "range") return "slider";
      if (ty === "search") return "searchbox";
      return "textbox";
    }
    if (tag === "textarea") return "textbox";
    if (tag === "select") return el.multiple ? "listbox" : "combobox";
    if (/^h[1-6]$/.test(tag)) return "heading";
    if (tag === "img") return el.getAttribute("alt") ? "img" : "";
    if (el.getAttribute("contenteditable") === "true" || el.getAttribute("contenteditable") === "") return "textbox";
    return { nav: "navigation", main: "main", header: "banner", footer: "contentinfo", form: "form", dialog: "dialog", aside: "complementary", table: "table", iframe: "iframe" }[tag] || "";
  };
  const CONTROL = new Set(["link", "button", "textbox", "searchbox", "checkbox", "radio", "slider", "combobox", "listbox", "tab", "menuitem", "switch", "option", "menuitemcheckbox", "menuitemradio", "spinbutton", "treeitem"]);
  const nameOf = (el) => {
    const by = el.getAttribute("aria-labelledby");
    if (by) { const t = by.split(/\s+/).map((i) => document.getElementById(i)).filter(Boolean).map((e) => e.innerText).join(" "); if (t.trim()) return clip(t, 80); }
    const direct = el.getAttribute("aria-label") || (el.labels && el.labels[0] && el.labels[0].innerText) || el.getAttribute("alt") || "";
    if (direct.trim()) return clip(direct, 80);
    const tag = el.tagName;
    if (tag === "INPUT" && ["button", "submit", "reset"].includes(el.type)) return clip(el.value, 80);
    if (tag !== "INPUT" && tag !== "TEXTAREA" && tag !== "SELECT") { const t = clip(el.innerText, 80); if (t) return t; }
    return clip(el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("name") || "", 80);
  };
  const lines = [];
  const MAX = 800;
  const walk = (node, depth) => {
    for (const child of node.childNodes) {
      if (lines.length >= MAX) return;
      if (child.nodeType === 3) {
        const t = clip(child.textContent, 200);
        if (t) lines.push("  ".repeat(depth) + "- text: " + JSON.stringify(t));
        continue;
      }
      if (child.nodeType !== 1) continue;
      const el = child;
      const tag = el.tagName;
      if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT" || tag === "TEMPLATE") continue;
      if (tag.toLowerCase() === "svg" && !el.getAttribute("aria-label")) continue;
      if (!shown(el)) continue;
      const role = roleOf(el);
      const pad = "  ".repeat(depth);
      if (CONTROL.has(role)) {
        let line = pad + "- " + role + " " + JSON.stringify(nameOf(el)) + " [ref=" + refOf(el) + "]";
        if (tag === "INPUT" && el.type === "password") line += " [password]";
        else if ((tag === "INPUT" || tag === "TEXTAREA") && !["checkbox", "radio", "button", "submit", "reset"].includes(el.type) && el.value) line += ": " + JSON.stringify(clip(el.value, 120));
        if (tag === "SELECT") line += ": " + JSON.stringify(clip(el.selectedOptions[0] ? el.selectedOptions[0].text : "", 80)) + " (" + Array.from(el.options).slice(0, 12).map((o) => clip(o.text, 30)).join(" | ") + ")";
        if (el.checked || el.getAttribute("aria-checked") === "true") line += " [checked]";
        if (el.disabled || el.getAttribute("aria-disabled") === "true") line += " [disabled]";
        const ex = el.getAttribute("aria-expanded"); if (ex) line += " [expanded=" + ex + "]";
        if (el.getAttribute("aria-selected") === "true") line += " [selected]";
        if (role === "link" && el.href) line += " -> " + clip(el.href, 120);
        lines.push(line);
        continue;
      }
      if (role === "heading") { lines.push(pad + "- heading " + JSON.stringify(clip(el.innerText, 120)) + " [level=" + (el.getAttribute("aria-level") || tag.slice(1)) + "]"); continue; }
      if (role === "img") { lines.push(pad + "- img " + JSON.stringify(nameOf(el))); continue; }
      if (role === "iframe") { lines.push(pad + "- iframe " + JSON.stringify(clip(el.getAttribute("title") || el.src, 80)) + " (contenuto non letto)"); continue; }
      let inner = depth;
      if (role) { lines.push(pad + "- " + role + (el.getAttribute("aria-label") ? " " + JSON.stringify(clip(el.getAttribute("aria-label"), 60)) : "") + ":"); inner = depth + 1; }
      walk(el.shadowRoot || el, inner);
    }
  };
  const modals = Array.from(document.querySelectorAll("dialog[open], [aria-modal=true]")).filter(shown);
  const root = modals.length ? modals[modals.length - 1] : document.body;
  if (root) walk(root, 0);
  if (lines.length >= MAX) lines.push("… (pagina lunga: tagliata)");
  return { title: document.title, url: location.href, modal: modals.length > 0, tree: lines.join("\n") };
}"#;

/// preview_wait: true when the text is there, the gone text is not, the selector matches.
const WAIT: &str = r#"(q) => {
  const body = document.body ? document.body.innerText : "";
  if (q.text && !body.includes(q.text)) return false;
  if (q.gone && body.includes(q.gone)) return false;
  try { if (q.selector && !document.querySelector(q.selector)) return false; } catch (e) { return false; }
  return document.readyState !== "loading";
}"#;

/// Finds the element of preview_click / preview_type: a ref of preview_snapshot,
/// a CSS selector, or the visible text (or label, placeholder, value) of a
/// button, link or field. Typing never goes in a password or payment field.
const FIND: &str = r#"(q, act, typing) => {
  let el = null;
  if (q.ref) {
    const w = window.__eiRefs && window.__eiRefs.byRef.get(q.ref);
    el = w && w.deref();
    if (!el || !el.isConnected) return { error: "Il riferimento " + q.ref + " non è più nella pagina: rifai preview_snapshot." };
  }
  try { if (!el && q.selector) el = document.querySelector(q.selector); } catch (e) { return { error: "Selettore non valido: " + q.selector }; }
  if (!el && q.text) {
    const want = q.text.trim().toLowerCase();
    const all = Array.from(document.querySelectorAll("a, button, input, textarea, select, label, summary, [role=button], [role=link], [role=tab], [role=menuitem], [onclick], [contenteditable=true]"));
    const name = (e) => [e.innerText, e.value, e.getAttribute("aria-label"), e.getAttribute("placeholder"), e.getAttribute("title"), e.getAttribute("name")].filter(Boolean).join(" ").trim().toLowerCase();
    el = all.find((e) => name(e) === want) || all.find((e) => name(e).includes(want));
    if (el && el.tagName === "LABEL" && el.control) el = el.control;
  }
  if (!el) return { error: "Elemento non trovato nella pagina." };
  if (typing && (el.type === "password" || /cc-|card|cvc|iban/i.test(el.getAttribute("autocomplete") || "") || /card|cvc|cvv|iban/i.test(el.name || ""))) return { error: "Password e dati di pagamento li scrive l'utente." };
  const what = ((el.innerText || el.value || el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.tagName) + "").trim().slice(0, 60);
  act(el);
  return { what };
}"#;

fn cut(text: &str) -> String {
    if text.chars().count() <= MAX_READ {
        return text.to_string();
    }
    let mut out: String = text.chars().take(MAX_READ).collect();
    out.push_str(&format!("\n… {}", t("(tagliato)")));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses_and_files() {
        assert_eq!(as_url("localhost:5173").as_deref(), Some("http://localhost:5173/"));
        assert_eq!(as_url("https://example.com/a").as_deref(), Some("https://example.com/a"));
        assert_eq!(as_url("example.com").as_deref(), Some("https://example.com/"));
        assert_eq!(as_url("0.0.0.0:3000").as_deref(), Some("http://localhost:3000/"));
        assert!(as_url("README.md").is_none());
        assert!(as_url("src/main.ts").is_none());
        assert!(as_url("C:\\a\\b.html").is_none());
        assert!(browser_file(Path::new("x/index.HTML")));
        assert!(!browser_file(Path::new("x/a.md")));
    }

    #[test]
    fn device_sizes_fit_the_area() {
        let r = Rect { x: 0.0, y: 40.0, w: 1000.0, h: 700.0 };
        assert_eq!(fit(r, &View::default()), (0.0, 40.0, 1000.0, 700.0));
        let phone = View { preset: "mobile".into(), width: 375, height: 812, scheme: String::new(), zoom: "fit".into() };
        let (x, y, w, h) = fit(r, &phone);
        assert!(h <= 700.0 - 24.0 + 0.01 && (w / h - 375.0 / 812.0).abs() < 0.01, "{w}×{h}");
        assert!(x > 0.0 && y >= 40.0);
    }

    #[test]
    fn zoom_makes_the_page_width() {
        let r = Rect { x: 0.0, y: 0.0, w: 640.0, h: 700.0 };
        // Adatta without a device: a desktop page, shrunk.
        let (_, _, w, _, z) = frame(r, &View::default(), 1.0);
        assert!((w / z - DESKTOP_W).abs() < 0.5);
        // 100%: the panel's width; Originale on a 150 % screen: smaller.
        assert_eq!(frame(r, &View { zoom: "100".into(), ..View::default() }, 1.5).4, 1.0);
        assert!((frame(r, &View { zoom: "orig".into(), ..View::default() }, 1.5).4 - 2.0 / 3.0).abs() < 1e-9);
        // A phone fitted: its own width inside the box.
        let phone = View { preset: "mobile".into(), width: 375, height: 812, scheme: String::new(), zoom: "fit".into() };
        let (_, _, w, _, z) = frame(r, &phone, 1.0);
        assert!((w / z - 375.0).abs() < 0.5);
    }

    #[test]
    fn console_lines() {
        let l = console_line("Runtime.consoleAPICalled", r#"{"type":"error","args":[{"type":"string","value":"boom"},{"type":"number","value":3}]}"#).unwrap();
        assert_eq!((l.level.as_str(), l.text.as_str()), ("error", "boom 3"));
        let l = console_line("Runtime.exceptionThrown", r#"{"exceptionDetails":{"text":"Uncaught","exception":{"description":"TypeError: x is undefined"}}}"#).unwrap();
        assert_eq!(l.text, "TypeError: x is undefined");
        let l = console_line("Log.entryAdded", r#"{"entry":{"level":"error","text":"Failed to load resource","url":"http://localhost/x.js"}}"#).unwrap();
        assert_eq!(l.text, "Failed to load resource (http://localhost/x.js)");
        assert!(console_line("Runtime.consoleAPICalled", "not json").is_none());
    }
}
