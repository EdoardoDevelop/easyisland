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
}

impl Default for View {
    fn default() -> Self {
        View { preset: "fit".into(), width: 0, height: 0, scheme: String::new() }
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
    view: View,
    console: HashMap<u32, Vec<ConsoleLine>>,
    /// A file's text before the chat changed it (for «Modifiche»), by path.
    before: HashMap<String, String>,
    /// Files' last change, for the watcher.
    seen: HashMap<String, SystemTime>,
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
    /// The window is stuck to the island (no frame: the page shows its own ✕).
    pub docked: bool,
}

pub fn snapshot(app: &AppHandle) -> Snapshot {
    let docked = app.get_window(LABEL).is_some_and(|w| !w.is_decorated().unwrap_or(true));
    let s = state();
    Snapshot { tabs: s.tabs.clone(), active: s.active, view: s.view.clone(), docked }
}

/// The page's ✕ (docked: there is no frame). As closing a framed window.
pub fn close_window(app: &AppHandle) {
    if let Some(w) = app.get_window(LABEL) {
        let _ = w.destroy();
    }
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

/// The window: made the first time (or again after it was closed), then shown.
pub fn show(app: &AppHandle, focus: bool) -> Result<(), String> {
    let docked = app.try_state::<crate::Shared>().map(|sh| sh.settings.lock().unwrap().preview_docked).unwrap_or(false);
    if let Some(win) = app.get_window(LABEL) {
        // The other kind was chosen meanwhile: made again (the tabs stay in STATE).
        if win.is_decorated().unwrap_or(true) == docked {
            let _ = win.destroy();
        } else {
            if docked {
                dock(app, focus);
            } else {
                let _ = win.unminimize();
                let _ = win.show();
            }
            if focus && win.is_visible().unwrap_or(false) {
                let _ = win.set_focus();
            }
            return Ok(());
        }
    }
    crate::island::keep_settings_above(app, false);
    let mut builder = tauri::window::WindowBuilder::new(app, LABEL)
        .title(t("Anteprima — EasyIsland"))
        .theme(Some(tauri::Theme::Dark))
        .inner_size(1180.0, 820.0)
        .min_inner_size(560.0, 420.0)
        .resizable(true)
        .focused(focus);
    builder = if docked {
        // A panel of the island: no frame, no taskbar button, above like the island.
        builder.decorations(false).skip_taskbar(true).always_on_top(true).visible(false).min_inner_size(320.0, 240.0)
    } else {
        builder.center()
    };
    let win = builder.build().map_err(|e| e.to_string())?;
    let size = win.inner_size().map_err(|e| e.to_string())?.to_logical::<f64>(win.scale_factor().unwrap_or(1.0));
    let mut ui = WebviewBuilder::new(UI, crate::page_url(app, "anteprima.html"))
        .additional_browser_args(crate::BROWSER_ARGS)
        // Files dropped on the page open in a tab (src/preview/main.ts, drop.rs).
        .disable_drag_drop_handler()
        .auto_resize();
    if let Some(dir) = crate::webview_dir() {
        ui = ui.data_directory(dir);
    }
    let page = win.add_child(ui, tauri::LogicalPosition::new(0.0, 0.0), size).map_err(|e| e.to_string())?;
    // Dropped files reach the page as HTML5 drops; their paths come from here (drop.rs).
    crate::drop::install_on(app, &page, UI);
    // Closing destroys the window and its browsers; the tabs stay in STATE for next time.
    watch(app.clone());
    if docked {
        follow_island(app);
        dock(app, focus);
    }
    Ok(())
}

/// Docked: the island's moves and resizes (opening, closing, dragging) move
/// the preview too. Events, not a timer: nothing runs while nothing moves.
fn follow_island(app: &AppHandle) {
    static HOOKED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
    let Some(island) = crate::island::window(app) else { return };
    if HOOKED.swap(true, std::sync::atomic::Ordering::SeqCst) {
        return;
    }
    let handle = app.clone();
    island.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Moved(_) | tauri::WindowEvent::Resized(_)) {
            dock(&handle, false);
        }
    });
}

/// Where the docked preview goes: beside the open island (right, else left,
/// as tall as it), else below it; hidden while the island is closed.
fn dock(app: &AppHandle, focus: bool) {
    let Some(win) = app.get_window(LABEL) else { return };
    if win.is_decorated().unwrap_or(true) {
        return;
    }
    let open = app.try_state::<crate::Shared>().map(|sh| !sh.gate.collapsed.load(std::sync::atomic::Ordering::Relaxed) && sh.gate.expanded.load(std::sync::atomic::Ordering::Relaxed)).unwrap_or(false);
    let island = crate::island::window(app);
    let rect = island.as_ref().filter(|_| open).and_then(|w| {
        let p = w.outer_position().ok()?;
        let s = w.outer_size().ok()?;
        let m = w.current_monitor().ok()??;
        let a = m.work_area();
        Some(((p.x, p.y, s.width as i32, s.height as i32), (a.position.x, a.position.y, a.size.width as i32, a.size.height as i32), m.scale_factor()))
    });
    let Some((isl, area, scale)) = rect else {
        let _ = win.hide();
        return;
    };
    let (x, y, w, h) = dock_rect(isl, area, scale);
    let _ = win.set_size(tauri::PhysicalSize::new(w.max(1) as u32, h.max(1) as u32));
    let _ = win.set_position(tauri::PhysicalPosition::new(x, y));
    if !win.is_visible().unwrap_or(false) {
        let _ = win.show();
        if focus {
            let _ = win.set_focus();
        }
    }
}

/// The docked rectangle (physical px) from the island's and the work area's
/// (x, y, w, h). A gap of 8 logical px; at most 1100 px wide.
fn dock_rect(isl: (i32, i32, i32, i32), area: (i32, i32, i32, i32), scale: f64) -> (i32, i32, i32, i32) {
    let px = |v: f64| (v * scale).round() as i32;
    let (gap, min_w, max_w, min_h) = (px(8.0), px(480.0), px(1100.0), px(320.0));
    let (ix, iy, iw, ih) = isl;
    let (ax, ay, aw, ah) = area;
    let right = (ax + aw) - (ix + iw) - 2 * gap;
    let left = ix - ax - 2 * gap;
    let h = ih.max(min_h).min(ah - 2 * gap);
    let top = iy.clamp(ay + gap, (ay + ah - gap - h).max(ay + gap));
    if right >= min_w || (right >= left && right >= px(320.0)) {
        return (ix + iw + gap, top, right.min(max_w), h);
    }
    if left >= min_w || left >= px(320.0) {
        let w = left.min(max_w);
        return (ix - gap - w, top, w, h);
    }
    // No room beside it: below, as wide as the island, down to the bottom.
    let below = (ay + ah) - (iy + ih) - 2 * gap;
    let w = iw.max(min_w).min(aw - 2 * gap);
    let x = ix.clamp(ax + gap, (ax + aw - gap - w).max(ax + gap));
    (x, iy + ih + gap, w, below.max(min_h))
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

pub fn set_view(app: &AppHandle, preset: &str, width: u32, height: u32, scheme: &str) {
    {
        let mut s = state();
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
    let Some(win) = app.get_window(LABEL) else { return };
    let (tabs, active, rect, covered, view) = {
        let s = state();
        (s.tabs.clone(), s.active, s.rect, s.covered, s.view.clone())
    };
    for tb in &tabs {
        let label = web_label(tb.id);
        let wanted = tb.id == active && tb.browser && rect.w > 1.0 && rect.h > 1.0;
        let existing = app.get_webview(&label);
        if !wanted {
            if let Some(w) = existing {
                let _ = w.hide();
            }
            continue;
        }
        let (x, y, w, h) = fit(rect, &view);
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
        for event in ["Runtime.consoleAPICalled", "Runtime.exceptionThrown", "Log.entryAdded"] {
            let Ok(receiver) = core.GetDevToolsProtocolEventReceiver(&HSTRING::from(event)) else { continue };
            let handler = DevToolsProtocolEventReceivedEventHandler::create(Box::new(move |_, args| {
                let Some(args) = args else { return Ok(()) };
                let mut raw = windows_core_wv2::PWSTR::null();
                if args.ParameterObjectAsJson(&mut raw).is_ok() {
                    let json = webview2_com::take_pwstr(raw);
                    if let Some(line) = console_line(event, &json) {
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
        if view.width > 0 {
            let mobile = view.preset == "mobile";
            cdp(&core, "Emulation.setDeviceMetricsOverride", &json!({
                "width": view.width, "height": view.height, "deviceScaleFactor": 0, "mobile": mobile,
            }), |_| {});
            cdp(&core, "Emulation.setTouchEmulationEnabled", &json!({ "enabled": mobile }), |_| {});
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
        while app.get_window(LABEL).is_some() {
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
            set_view(app, &preset, width, height, &scheme);
            let v = state().view.clone();
            Ok(tf("Vista: {p} {w}×{h}, colori {s}.", &[
                ("p", &v.preset),
                ("w", &v.width.to_string()),
                ("h", &v.height.to_string()),
                ("s", &if v.scheme.is_empty() { t("della pagina").to_string() } else { v.scheme.clone() }),
            ]))
        }
        "preview_click" | "preview_type" => {
            let tb = tab_for(&s("tab"))?;
            let target = json!({ "selector": s("selector"), "text": s("text_match") });
            let script = if name == "preview_click" {
                format!("({FIND})({target}, (el) => {{ el.scrollIntoView({{block: 'center'}}); el.click(); return 'ok'; }})")
            } else {
                let value = json!(s("text"));
                let submit = args.get("submit").and_then(Value::as_bool).unwrap_or(false);
                format!(
                    "({FIND})({target}, (el) => {{ el.focus(); const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; const set = Object.getOwnPropertyDescriptor(proto, 'value'); if (set && set.set && (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) set.set.call(el, {value}); else el.textContent = {value}; el.dispatchEvent(new Event('input', {{bubbles: true}})); el.dispatchEvent(new Event('change', {{bubbles: true}})); if ({submit}) {{ const f = el.form; if (f && f.requestSubmit) f.requestSubmit(); else el.dispatchEvent(new KeyboardEvent('keydown', {{key: 'Enter', bubbles: true}})); }} return 'ok'; }})"
                )
            };
            let raw = eval(app, tb.id, &script).await?;
            let v: Value = serde_json::from_str(&raw).unwrap_or(Value::Null);
            match v.get("error").and_then(Value::as_str) {
                Some(e) => Err(e.to_string()),
                None => Ok(tf("Fatto su «{what}».", &[("what", &v.get("what").and_then(Value::as_str).unwrap_or_default())])),
            }
        }
        _ => Err(format!("unknown tool {name}")),
    }
}

/// Finds the element of preview_click / preview_type: a CSS selector, or the
/// visible text (or label, placeholder, value) of a button, link or field.
const FIND: &str = r#"(q, act) => {
  let el = null;
  try { if (q.selector) el = document.querySelector(q.selector); } catch (e) { return { error: "Selettore non valido: " + q.selector }; }
  if (!el && q.text) {
    const want = q.text.trim().toLowerCase();
    const all = Array.from(document.querySelectorAll("a, button, input, textarea, select, label, summary, [role=button], [role=link], [role=tab], [role=menuitem], [onclick], [contenteditable=true]"));
    const name = (e) => [e.innerText, e.value, e.getAttribute("aria-label"), e.getAttribute("placeholder"), e.getAttribute("title"), e.getAttribute("name")].filter(Boolean).join(" ").trim().toLowerCase();
    el = all.find((e) => name(e) === want) || all.find((e) => name(e).includes(want));
    if (el && el.tagName === "LABEL" && el.control) el = el.control;
  }
  if (!el) return { error: "Elemento non trovato nella pagina." };
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
    #[test]
    fn docks_beside_or_below() {
        // Island 720×560 centred on a 1920×1040 area: room on the right.
        let (x, _, w, h) = super::dock_rect((600, 0, 720, 560), (0, 0, 1920, 1040), 1.0);
        assert_eq!((x, w, h), (1328, 584, 560));
        // Island at the right edge: on the left.
        let (x, _, w, _) = super::dock_rect((1200, 0, 720, 560), (0, 0, 1920, 1040), 1.0);
        assert_eq!(x + w + 8, 1200);
        // Island almost as wide as the screen: below it.
        let (_, y, _, h) = super::dock_rect((100, 0, 1720, 400), (0, 0, 1920, 1040), 1.0);
        assert_eq!((y, h), (408, 624));
    }

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
        let phone = View { preset: "mobile".into(), width: 375, height: 812, scheme: String::new() };
        let (x, y, w, h) = fit(r, &phone);
        assert!(h <= 700.0 - 24.0 + 0.01 && (w / h - 375.0 / 812.0).abs() < 0.01, "{w}×{h}");
        assert!(x > 0.0 && y >= 40.0);
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
