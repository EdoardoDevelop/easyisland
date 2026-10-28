// EasyIsland for Windows — app wiring and the commands the island calls.

mod actions;
mod steps;
mod collect;
mod memory_ai;
mod preview;
mod antigravity;
mod agent;
mod agent_settings;
mod automations;
mod flows;
mod apps;
mod calendar;
mod carry;
mod claude;
mod chat_log;
mod claude_cli;
mod clipboard;
mod clipimage;
mod brain;
mod memory;
mod webview_memory;
mod context;
mod daily;
mod devservers;
mod downloads;
mod drop;
mod files;
mod folder_drop;
mod habits;
mod hooks;
mod hotkeys;
mod integrations;
mod backup;
mod jumplist;
mod logo;
mod thumbs;
mod island;
mod keys;
mod legacy;
mod log;
mod mcp_setup;
mod media;
mod msgraph;
mod moments;
mod netconfig;
mod notion;
mod notion_map;
mod notion_tools;
mod recipes;
mod todo;
mod second;
mod notion_page;
mod rdm;
mod openai;
mod opencode;
mod opencode_agent;
// The relay's own diff, test-verdict and patch code (hook/), shared with
// opencode_agent.rs, which builds the same payloads from opencode's service.
#[allow(dead_code)]
#[path = "../../hook/src/diff.rs"]
mod hook_diff;
#[allow(dead_code)]
#[path = "../../hook/src/testrun.rs"]
mod hook_testrun;
#[allow(dead_code)]
#[path = "../../hook/src/agents.rs"]
mod hook_agents;
mod outlook;
mod pipe;
mod presence;
mod probes;
mod profiles;
mod screenshot;
mod session_reply;
mod secrets;
mod settings;
mod teams;
mod custom;
mod skills;
mod tasks;
mod telegram;
mod i18n;
mod webview_profile;
mod recap;
mod record;
mod remote;
mod renew;
mod richtext;
mod start_apps;
mod threecx;
mod transcribe;
mod tray;
mod updates;
mod usage;
mod widgets;
mod workdir;
mod zip;
mod win_user;
mod window_drop;
mod wss;
mod zammad;

use std::os::windows::process::CommandExt;
use std::process::Command;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_autostart::{ManagerExt, MacosLauncher};

use claude::{Chat, ChatContext, ChatReply};
use files::DroppedFile;
use hooks::{HookPreview, HookStatus};
use island::{PollGate, ScreenInfo};
use pipe::Pending;
use settings::Settings;
use crate::i18n::{t, tf};

/// Label of the settings window (automations log updates go there).
pub const SETTINGS_LABEL: &str = "settings";

/// Keeps spawned helpers from flashing a console window.
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub struct Shared {
    pub settings: Mutex<Settings>,
    pub gate: Arc<PollGate>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootInfo {
    settings: Settings,
    screen: ScreenInfo,
    version: String,
    hook_path: String,
}

#[tauri::command]
fn boot(app: AppHandle, shared: State<Shared>) -> BootInfo {
    // The real state of ~/.claude/settings.json wins over whatever we stored
    // (it decides whether Claude Code is in the Agenti tab).
    let settings = {
        let mut current = shared.settings.lock().unwrap();
        current.hooks_installed = hooks::status().installed;
        current.clone()
    };
    let screen = island::screen_info(&app, &settings.screen);
    BootInfo {
        settings,
        screen,
        version: env!("CARGO_PKG_VERSION").to_string(),
        hook_path: settings::hook_exe_path().to_string_lossy().to_string(),
    }
}

#[tauri::command]
fn save_settings(app: AppHandle, settings: Settings) {
    apply_settings(&app, settings);
}

/// A save from the settings window, or a change by an agent (agent_settings.rs):
/// on disk, to both windows, and whatever follows from it (language, start
/// with Windows, the island's place, shortcuts).
pub(crate) fn apply_settings(app: &AppHandle, settings: Settings) {
    let Some(shared) = app.try_state::<Shared>() else { return };
    // Whatever was edited belongs to the active profile.
    let mut settings = settings.migrated();
    settings.commit_active();
    i18n::set(&settings.language);
    let (screen_changed, autostart_changed) = {
        let mut current = shared.settings.lock().unwrap();
        let screen_changed = current.screen != settings.screen
            || current.anchor_h != settings.anchor_h
            || current.anchor_v != settings.anchor_v
            || current.offset_x != settings.offset_x
            || current.offset_y != settings.offset_y
            || current.over_taskbar != settings.over_taskbar;
        let autostart_changed = current.autostart != settings.autostart;
        // Only boot and hooks_apply know whether the hooks are there; a window
        // opened before an install would send the old value.
        settings.hooks_installed = current.hooks_installed;
        *current = settings.clone();
        (screen_changed, autostart_changed)
    };
    if let Err(err) = settings::save(&settings) {
        eprintln!("[easyisland] could not save settings: {err}");
    }
    habits::apply(&settings);
    opencode_agent::apply(&settings);
    preview::settings_changed(app, &settings);
    if autostart_changed {
        let manager = app.autolaunch();
        let result = if settings.autostart { manager.enable() } else { manager.disable() };
        if let Err(err) = result {
            eprintln!("[easyisland] autostart: {err}");
        }
    }
    if screen_changed {
        let collapsed = shared.gate.collapsed.load(Ordering::Relaxed);
        island::apply_geometry(&app, &shared.gate, &settings, collapsed);
    }
    island::apply_taskbar(&app);
    jumplist::update(&settings);
    // Keep the other window in step (island ⇄ settings window).
    crate::threecx::settings_saved(&settings);
    let _ = app.emit("settings-changed", settings);
    tray::refresh(&app);
    hotkeys::reload();
}

/// Makes `id` the active profile: its values replace the current ones, the
/// island and the settings window follow, the tray menu ticks it.
pub(crate) fn activate_profile(app: &AppHandle, id: &str, why: &str) {
    let Some(shared) = app.try_state::<Shared>() else { return };
    let settings = {
        let mut s = shared.settings.lock().unwrap();
        if s.active_profile == id || !s.switch_profile(id) {
            return;
        }
        s.clone()
    };
    if let Err(err) = settings::save(&settings) {
        eprintln!("[easyisland] could not save settings: {err}");
    }
    log::line(format!("profile → {id} ({why})"));
    // Chosen by hand: something the habits may learn from.
    if matches!(why, "impostazioni" | "menu") {
        habits::note("profile", id);
    }
    let collapsed = shared.gate.collapsed.load(Ordering::Relaxed);
    island::apply_geometry(&app, &shared.gate, &settings, collapsed);
    crate::threecx::settings_saved(&settings);
    let _ = app.emit("settings-changed", settings);
    tray::refresh(app);
    hotkeys::reload();
}

#[tauri::command]
fn switch_profile(app: AppHandle, id: String) {
    activate_profile(&app, &id, "impostazioni");
}

/// Writes the settings (no secrets) to Documents and shows the file in Explorer.
#[tauri::command]
fn settings_export(shared: State<Shared>) -> Result<String, String> {
    // The settings and the user's data (backup.rs).
    let text = backup::export(&shared.settings.lock().unwrap());
    let home = std::env::var_os("USERPROFILE").map(std::path::PathBuf::from);
    let dir = home
        .as_ref()
        .map(|h| h.join("Documents"))
        .filter(|d| d.is_dir())
        .or(home)
        .ok_or_else(|| t("Cartella Documenti non trovata.").to_string())?;
    let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    let path = dir.join(format!(
        "EasyIsland-backup-{:04}{:02}{:02}-{:02}{:02}.json",
        t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute
    ));
    std::fs::write(&path, text).map_err(|e| tf("Esportazione non riuscita: {e}", &[("e", &e)]))?;
    let _ = reveal_in_explorer(&path);
    Ok(path.display().to_string())
}

/// Opens Explorer on the folder of `path` with the file selected.
/// Explorer wants `/select,"C: b\c.txt"`: given as one ordinary argument,
/// a path with spaces gets quoted whole (`"/select,C: b\c.txt"`), which
/// Explorer does not understand, and it opens Documents instead.
pub(crate) fn reveal_in_explorer(path: &std::path::Path) -> std::io::Result<std::process::Child> {
    Command::new("explorer").raw_arg(format!("/select,\"{}\"", path.display())).spawn()
}

/// Replaces the settings with an exported file (keys must be entered again).
#[tauri::command]
fn settings_import(app: AppHandle, shared: State<Shared>, text: String) -> Result<serde_json::Value, String> {
    // A full backup (backup.rs) or a settings file of an older version.
    let (text, files) = backup::split(&text).unwrap_or((text, Vec::new()));
    let next = shared.settings.lock().unwrap().import_json(&text)?;
    let restored = backup::restore(&files)?;
    *shared.settings.lock().unwrap() = next.clone();
    settings::save(&next).map_err(|e| tf("Salvataggio non riuscito: {e}", &[("e", &e)]))?;
    log::line("settings imported".to_string());
    let collapsed = shared.gate.collapsed.load(Ordering::Relaxed);
    island::apply_geometry(&app, &shared.gate, &next, collapsed);
    crate::threecx::settings_saved(&next);
    let _ = app.emit("settings-changed", next.clone());
    tray::refresh(&app);
    hotkeys::reload();
    if restored > 0 {
        // Chats and memory are held in memory: a restart reads the restored files.
        let app = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_secs(4));
            app.restart();
        });
    }
    Ok(serde_json::json!({ "settings": next, "note": backup::summary(restored) }))
}

// ── Quick actions ─────────────────────────────────────────────────────────────

#[tauri::command]
fn action_open_app(target: String, args: String) -> Result<(), String> {
    actions::open_app(&target, &args)
}

/// Impostazioni → Lingua: the island and the menus are built in one language.
#[tauri::command]
fn restart_app(app: AppHandle) {
    app.restart();
}

/// Impostazioni → «Mostra il riepilogo»: the island opens it, as from the tray.
#[tauri::command]
fn recap_show(app: AppHandle) {
    let _ = app.emit_to(island::WINDOW_LABEL, "tray", "recap");
}

/// Impostazioni → Riepilogo del giorno → «Mostra ora».
#[tauri::command]
fn daily_show(app: AppHandle) {
    let _ = app.emit_to(island::WINDOW_LABEL, "tray", "daily");
}

/// The island's search bar: the programs of the Start menu.
#[tauri::command]
async fn start_apps() -> Vec<start_apps::StartApp> {
    tauri::async_runtime::spawn_blocking(start_apps::list).await.unwrap_or_default()
}

/// Runs a script the user just confirmed in the island.
#[tauri::command]
async fn action_run_script(
    run_id: String,
    shell: String,
    script: String,
) -> Result<actions::ScriptResult, String> {
    log::line(format!("action script ({shell}) run {run_id}"));
    actions::run_script(&run_id, &shell, &script).await
}

#[tauri::command]
fn action_kill(run_id: String) {
    actions::kill(&run_id);
}

#[tauri::command]
async fn clipboard_text() -> Option<String> {
    tauri::async_runtime::spawn_blocking(actions::clipboard_text).await.ok().flatten()
}

/// Settings → "Prova": run one widget definition right now.
#[tauri::command]
async fn widget_test(app: AppHandle, widget: serde_json::Value) -> Result<widgets::WidgetResult, String> {
    widgets::run_once(&app, widget).await
}

/// The checks' last results, for an island that started listening after them.
#[tauri::command]
fn widget_results() -> Vec<widgets::WidgetResult> {
    widgets::last_results()
}

/// Island → "Aggiorna" on a widget card.
#[tauri::command]
async fn widget_refresh(app: AppHandle, shared: State<'_, Shared>, id: String) -> Result<(), String> {
    // A widget, or one of the integrations that run as checks (integration_system…).
    let widget = widgets::all_widgets(&shared.settings.lock().unwrap())
        .into_iter()
        .find(|w| w.id == id)
        .ok_or_else(|| t("Widget non trovato").to_string())?;
    if id == "integration_claude_usage" {
        usage::ask_now();
    }
    widgets::run_now(&app, &widget).await;
    Ok(())
}

/// "Apri Zammad" on the Zammad card.
#[tauri::command]
fn open_zammad() {
    if let Some(url) = secrets::get("zammad-url") {
        open_url(url);
    }
}

/// Shortcuts Windows refused because another app already uses them.
#[tauri::command]
fn hotkey_failures() -> Vec<String> {
    hotkeys::failures()
}

/// A shortcut field in the settings is listening for keys: no shortcut fires meanwhile.
#[tauri::command]
fn hotkeys_suspend(on: bool) {
    hotkeys::suspend(on);
}

/// Wi-Fi network this PC is on, to fill in a profile rule.
#[tauri::command]
async fn current_network() -> Option<String> {
    tauri::async_runtime::spawn_blocking(profiles::current_ssid).await.ok().flatten()
}

/// Hidden island → shrink the window to the rest icon (or the invisible wake
/// strip) and park the cursor poll; anything else → full panel and 60 Hz polling.
/// `width`/`height` are the collapsed box, which depends on the icon settings.
#[tauri::command]
fn set_collapsed(
    app: AppHandle,
    shared: State<Shared>,
    collapsed: bool,
    width: Option<f64>,
    height: Option<f64>,
) {
    if let (Some(w), Some(h)) = (width, height) {
        *shared.gate.collapsed_size.lock().unwrap() = (w.max(1.0), h.max(1.0));
    }
    // Closing or opening again: always back on top.
    island::come_forward(&app);
    let settings = shared.settings.lock().unwrap().clone();
    shared.gate.collapsed.store(collapsed, Ordering::Relaxed);
    island::apply_geometry(&app, &shared.gate, &settings, collapsed);
    // Hidden behind a full-screen app while resting; always back for anything else.
    if let Some(win) = island::window(&app) {
        let quiet = collapsed && shared.gate.fullscreen.load(Ordering::Relaxed) && !island::CAPTURING.load(Ordering::Relaxed);
        let _ = if quiet { win.hide() } else { win.show() };
    }
    // The wake strip must always take the mouse, and a resize invalidates the flag.
    island::set_ignore_cursor(&app, false);
    shared.gate.forget_ignore_state();
    shared.gate.set_active(!collapsed);
}

/// The front end pushes the island shape; Rust decides click-through from it.
#[tauri::command]
fn set_island_rect(shared: State<Shared>, x: f64, y: f64, width: f64, height: f64) {
    shared.gate.set_rect(island::IslandRect { x, y, w: width, h: height });
}

#[tauri::command]
fn focus_window(app: AppHandle, focused: bool) {
    let Some(win) = island::window(&app) else { return };
    island::set_activating(&win, focused);
    if focused {
        let _ = win.set_focus();
    }
}

/// The preview of a picture in the Vassoio or the work folder (thumbs.rs).
#[tauri::command]
async fn file_thumb(path: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || thumbs::thumb(&path)).await.ok().flatten()
}

/// A quick action's automatic icon: the program's (thumbs.rs).
#[tauri::command]
async fn program_icon(target: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || thumbs::program_icon(&target)).await.ok().flatten()
}

/// A quick action's automatic icon: the site's favicon, fetched from that site only (thumbs.rs).
#[tauri::command]
async fn site_icon(url: String) -> Option<String> {
    thumbs::favicon(&url).await
}

/// The user's PNG in place of the character (logo.rs).
#[tauri::command]
fn logo_save(data: String) -> Result<(), String> {
    logo::save(&data)
}

#[tauri::command]
fn logo_load() -> Option<String> {
    logo::load()
}

#[tauri::command]
fn logo_clear() {
    logo::clear()
}

/// — in the header of the island as an app.
#[tauri::command]
fn minimize_island(app: AppHandle) {
    if let Some(win) = island::window(&app) {
        let _ = win.minimize();
    }
}

/// 📌 "Tieni aperta" on or off: the open island as an ordinary app window or not.
#[tauri::command]
fn set_app_mode(app: AppHandle, on: bool) {
    island::set_app_mode(&app, on);
}

/// A permission or a question while the pinned island is behind other windows.
#[tauri::command]
fn flash_if_behind(app: AppHandle) {
    island::flash_if_behind(&app);
}

/// A folder dropped on the island goes to the chat, not into the drop sequence.
#[tauri::command]
fn is_folder(path: String) -> bool {
    std::path::Path::new(&path).is_dir()
}

/// Right click on the resting character: the notification-area menu at the cursor.
/// Sync on purpose: it runs on the main thread, where the menu loop blocks until it closes.
#[tauri::command]
fn show_island_menu(app: AppHandle) {
    tray::popup(&app);
}

/// "Copia info PC": everything a ticket asks for, put on the clipboard.
#[tauri::command]
async fn copy_pc_info() -> Result<String, String> {
    let text = probes::pc_info_text().await.map_err(|e| tf("Informazioni non leggibili: {e}", &[("e", &e)]))?;
    let t = text.clone();
    tauri::async_runtime::spawn_blocking(move || actions::set_clipboard_text(&t))
        .await
        .map_err(|e| e.to_string())??;
    Ok(text)
}

/// "Prova" in Impostazioni → Notifiche: the same message `easyisland-hook notify` sends.
#[tauri::command]
fn notify_test(app: AppHandle) {
    let _ = app.emit_to(
        island::WINDOW_LABEL,
        "hook",
        serde_json::json!({
            "hook_event_name": "EasyIslandNotify",
            "title": i18n::t("Prova"),
            "text": i18n::t("Così compare un messaggio mandato da uno script."),

            "level": "ok",
            "url": "",
        }),
    );
}

/// "Davanti al cliente" right now (the island asks once at startup).
#[tauri::command]
fn presence_state() -> Option<String> {
    presence::current()
}

/// Moves the island window while the character is dragged. The first call
/// remembers where the cursor holds the window (the drag's first `dx`, `dy`,
/// logical px, included); from then on the window is placed under the cursor
/// in physical px. Adding up the page's deltas drifted away from the cursor
/// as soon as the drag crossed displays with a different scale.
#[tauri::command]
fn drag_island(app: AppHandle, shared: State<Shared>, dx: f64, dy: f64) {
    shared.gate.dragging.store(true, Ordering::Relaxed);
    let Some(win) = island::window(&app) else { return };
    let Ok(pos) = win.outer_position() else { return };
    let Some((cx, cy)) = island::cursor_physical() else { return };
    let mut grab = shared.gate.drag_grab.lock().unwrap();
    let (gx, gy) = *grab.get_or_insert_with(|| {
        let scale = win.scale_factor().unwrap_or(1.0);
        (cx - pos.x as f64 - dx * scale, cy - pos.y as f64 - dy * scale)
    });
    let _ = win.set_position(tauri::PhysicalPosition::new((cx - gx).round() as i32, (cy - gy).round() as i32));
}

/// How a drag ended, for the front end.
#[derive(Serialize, Default)]
struct DragEnd {
    /// The open island: its offset from home (logical px, 0 = at that edge).
    offset: Option<(f64, f64)>,
    /// The character was dropped on this file or folder (folder_drop.rs).
    path: Option<String>,
}

/// The drag is over: remember where the character was left, in the active profile.
/// Dropped on a folder, it goes back home instead and the folder goes to the chat.
#[tauri::command]
fn end_drag(app: AppHandle, shared: State<Shared>) -> DragEnd {
    shared.gate.dragging.store(false, Ordering::Relaxed);
    *shared.gate.drag_grab.lock().unwrap() = None;
    let Some(win) = island::window(&app) else { return DragEnd::default() };
    let (Ok(pos), Ok(size)) = (win.outer_position(), win.outer_size()) else { return DragEnd::default() };
    let open = shared.gate.expanded.load(Ordering::Relaxed) && !shared.gate.collapsed.load(Ordering::Relaxed);
    if open {
        // The open island moved: it stays there while it is open, nothing is
        // saved, and closing it takes the character back to its place. The
        // front end gets the offset back to round the corners off the edges.
        // Dropped on another display (where the cursor let go): the island goes
        // there for good, open where it was left; on the same display it was
        // kept inside it, so it could never leave the screen it was on
        // (Edoardo, 20 October 2026).
        let moved = island::cursor_physical().and_then(|(x, y)| {
            let mut s = shared.settings.lock().unwrap();
            let screen = island::screen_for_drop(&app, &s, x, y);
            (screen != s.screen).then(|| {
                log::line(format!("open island moved to screen {screen}"));
                s.screen = screen;
                s.commit_active();
                s.clone()
            })
        });
        if let Some(saved) = &moved {
            if let Err(err) = settings::save(saved) {
                eprintln!("[easyisland] could not save settings: {err}");
            }
            let _ = app.emit("settings-changed", saved.clone());
        }
        let s = shared.settings.lock().unwrap().clone();
        let offset = island::panel_offset_from_drop(&app, &shared.gate, &s, (pos.x, pos.y), (size.width, size.height));
        if let Some(offset) = offset {
            *shared.gate.panel_offset.lock().unwrap() = offset;
            // Snapped to an edge or pulled back on screen.
            island::apply_geometry(&app, &shared.gate, &s, false);
        }
        return DragEnd { offset, path: None };
    }
    if let Some(path) = island::hwnd_of(&win)
        .zip(island::cursor_physical())
        .and_then(|(hwnd, (x, y))| folder_drop::path_at(hwnd, x as i32, y as i32))
    {
        log::line(format!("island dropped on {}", path.display()));
        let s = shared.settings.lock().unwrap().clone();
        island::apply_geometry(&app, &shared.gate, &s, shared.gate.collapsed.load(Ordering::Relaxed));
        return DragEnd { offset: None, path: Some(path.to_string_lossy().into_owned()) };
    }
    let settings = {
        let mut s = shared.settings.lock().unwrap();
        // Dropped on another display: the island moves there for good. Where
        // the cursor let go, not the window's centre: the window is much wider
        // than the character, and on a narrow display (Edoardo's, 1080 px
        // upright) its centre fell past the edge, on no display at all, and the
        // island went back to the primary one (20 October 2026).
        let centre = island::cursor_physical()
            .unwrap_or((pos.x as f64 + size.width as f64 / 2.0, pos.y as f64 + size.height as f64 / 2.0));
        let screen = island::screen_for_drop(&app, &s, centre.0, centre.1);
        if screen != s.screen {
            log::line(format!("island moved to screen {screen}"));
            s.screen = screen;
        }
        let Some((work, scale)) = island::work_area(&app, &s) else { return DragEnd::default() };
        let (bw, bh) = *shared.gate.collapsed_size.lock().unwrap();
        let box_size = ((bw * scale).round() as u32, (bh * scale).round() as u32);
        let origin = island::box_in_window(
            (pos.x, pos.y),
            (size.width, size.height),
            box_size,
            &s.anchor_h,
            &s.anchor_v,
        );
        let (h, v, ox, oy) = island::placement_from_drop(work, origin, box_size, scale);
        log::line(format!("island moved: {h} {v} {ox} {oy}"));
        s.anchor_h = h;
        s.anchor_v = v;
        s.offset_x = ox;
        s.offset_y = oy;
        s.commit_active();
        s.clone()
    };
    if let Err(err) = settings::save(&settings) {
        eprintln!("[easyisland] could not save settings: {err}");
    }
    let collapsed = shared.gate.collapsed.load(Ordering::Relaxed);
    island::apply_geometry(&app, &shared.gate, &settings, collapsed);
    crate::threecx::settings_saved(&settings);
    let _ = app.emit("settings-changed", settings);
    DragEnd::default()
}

/// The island opened or closed. Closing takes the window back to the character's
/// place (an open island dragged elsewhere comes home), and every opening starts there.
/// `place` puts this opening somewhere else than `island_place` (the launch greeting).
#[tauri::command]
fn set_expanded(app: AppHandle, shared: State<Shared>, expanded: bool, place: Option<String>) {
    *shared.gate.open_place.lock().unwrap() = if expanded { place } else { None };
    if shared.gate.expanded.swap(expanded, Ordering::Relaxed) == expanded {
        return;
    }
    // A drag of the open island lasts for that opening only.
    let dragged = std::mem::take(&mut *shared.gate.panel_offset.lock().unwrap()) != (0.0, 0.0);
    if shared.gate.collapsed.load(Ordering::Relaxed) {
        return;
    }
    let settings = shared.settings.lock().unwrap().clone();
    island::come_forward(&app);
    if expanded {
        island::stop_glide();
        island::apply_geometry(&app, &shared.gate, &settings, false);
    } else if dragged {
        // Back home while the island shrinks, not in one jump.
        island::glide_home(&app, shared.gate.clone(), &settings);
    } else {
        island::apply_geometry(&app, &shared.gate, &settings, false);
    }
}

/// The open island grew past the usual window (or came back within it): the
/// window takes `width`×`height`, logical px, within the work area.
#[tauri::command]
fn set_panel_size(app: AppHandle, shared: State<Shared>, width: f64, height: f64) {
    let size = (width.max(island::PANEL_W).round(), height.max(island::PANEL_H).round());
    if std::mem::replace(&mut *shared.gate.panel_size.lock().unwrap(), size) == size {
        return;
    }
    if shared.gate.collapsed.load(Ordering::Relaxed) {
        return;
    }
    let settings = shared.settings.lock().unwrap().clone();
    island::apply_geometry(&app, &shared.gate, &settings, false);
}

/// How big the window (and so the island) may get on its screen, logical px.
#[tauri::command]
fn panel_limits(app: AppHandle, shared: State<Shared>) -> (f64, f64) {
    let settings = shared.settings.lock().unwrap().clone();
    island::panel_limits(&app, &settings)
}

#[tauri::command]
fn reposition(app: AppHandle, shared: State<Shared>) {
    let settings = shared.settings.lock().unwrap().clone();
    let collapsed = shared.gate.collapsed.load(Ordering::Relaxed);
    island::apply_geometry(&app, &shared.gate, &settings, collapsed);
}

#[tauri::command]
fn open_url(url: String) {
    open_url_now(&url);
}

/// Opens an http(s) link in the default browser; anything else is ignored.
/// A notion.so link opens in the Notion app when it is installed (notion.rs).
pub(crate) fn open_url_now(url: &str) {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return;
    }
    let target = notion::link_for(url);
    let _ = Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", target.as_deref().unwrap_or(url)])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
}

/// Impostazioni → Notion → «Mappa per la chat»: how many and when (notion_map.rs).
#[tauri::command]
fn notion_map_status() -> serde_json::Value {
    notion_map::status()
}

/// Impostazioni → Chat → «Ricette»: how many the chat has learnt (recipes.rs).
#[tauri::command]
fn recipes_count() -> usize {
    recipes::count()
}

#[tauri::command]
fn recipes_forget() {
    recipes::forget();
}

/// «Sincronizza»: the structure of Notion read again, for the chat.
#[tauri::command]
async fn notion_map_sync() -> Result<serde_json::Value, String> {
    notion_map::sync().await?;
    Ok(notion_map::status())
}

/// Notion pages and databases matching `query` (card and search bar).
#[tauri::command]
async fn notion_search(query: String, limit: Option<usize>, kind: Option<String>) -> Result<Vec<serde_json::Value>, String> {
    notion::search(&query, limit.unwrap_or(8), kind.as_deref()).await
}

/// "Fatto" on a task of the Notion card, then the card reads the tasks again.
#[tauri::command]
async fn notion_task_done(app: AppHandle, shared: State<'_, Shared>, id: String) -> Result<(), String> {
    let db = shared.settings.lock().unwrap().integration_config.notion_tasks.as_ref().map(|r| r.id.clone());
    let db = db.ok_or_else(|| t("Scegli il database delle attività nelle Impostazioni").to_string())?;
    notion::set_done(&db, &id).await?;
    notion::poll(app).await;
    Ok(())
}

/// "Nuova nota" from the Notion card: to the page or database chosen in the settings.
#[tauri::command]
async fn notion_add_note(shared: State<'_, Shared>, text: String, stamp: String) -> Result<String, String> {
    let target = shared.settings.lock().unwrap().integration_config.notion_inbox.clone();
    let target = target.ok_or_else(|| t("Scegli nelle Impostazioni dove salvare le note").to_string())?;
    notion::add_note(&target.id, target.database, &text, &stamp).await?;
    Ok(target.title)
}

/// The settings chose another database: its properties are read again.
#[tauri::command]
fn notion_forget_schemas() {
    notion::forget_schemas();
}

/// "+ Attività" in the Notion card: a task in the chosen database, with the
/// values of the view in use; then the card reads the tasks again.
#[tauri::command]
async fn notion_add_task(app: AppHandle, shared: State<'_, Shared>, title: String, due: Option<String>) -> Result<(), String> {
    let (db, view) = {
        let s = shared.settings.lock().unwrap();
        let c = &s.integration_config;
        let view = c.notion_views.iter().find(|v| v.name == c.notion_view).or_else(|| c.notion_views.first()).cloned();
        (c.notion_tasks.as_ref().map(|r| r.id.clone()), view)
    };
    let db = db.ok_or_else(|| t("Scegli il database delle attività nelle Impostazioni").to_string())?;
    notion::add_task(&db, &title, due.as_deref(), view.as_ref()).await?;
    notion::poll(app).await;
    Ok(())
}

/// "Rimanda" on a task of the Notion card: its due date moved.
#[tauri::command]
async fn notion_postpone(app: AppHandle, shared: State<'_, Shared>, id: String, date: String) -> Result<(), String> {
    let db = shared.settings.lock().unwrap().integration_config.notion_tasks.as_ref().map(|r| r.id.clone());
    let db = db.ok_or_else(|| t("Scegli il database delle attività nelle Impostazioni").to_string())?;
    notion::postpone(&db, &id, &date).await?;
    notion::poll(app).await;
    Ok(())
}

// ── Remote Desktop Manager (rdm.rs) ───────────────────────────────────────────

/// The connections matching the words, best first (card, search bar, calls).
#[tauri::command]
fn rdm_search(query: String, limit: Option<usize>) -> Vec<rdm::Entry> {
    rdm::search(&query, limit.unwrap_or(8))
}

/// The connections whose host is this IP or name (the text selected).
#[tauri::command]
fn rdm_by_host(host: String) -> Vec<rdm::Entry> {
    rdm::by_host(&host)
}

/// "Apri" on a connection: RDM opens it; it goes first in the recent ones.
#[tauri::command]
fn rdm_open(app: AppHandle, shared: State<'_, Shared>, entry: settings::RdmRef) -> Result<(), String> {
    rdm::open(&entry.id)?;
    let snapshot = {
        let mut s = shared.settings.lock().unwrap();
        let recent = &mut s.integration_config.rdm_recent;
        recent.retain(|r| r.id != entry.id);
        recent.insert(0, entry);
        recent.truncate(8);
        s.clone()
    };
    let _ = settings::save(&snapshot);
    let _ = app.emit("settings-changed", &snapshot);
    Ok(())
}

/// "Modifica in RDM": its properties open in RDM.
#[tauri::command]
fn rdm_edit(id: String) -> Result<(), String> {
    rdm::edit(&id)
}

/// RDM with its search filled in (no list here, or "Cerca in RDM").
#[tauri::command]
fn rdm_filter(text: String) -> Result<(), String> {
    rdm::filter(&text)
}

/// A connection on the fly to a host (RDP, SSH, VNC), not saved in RDM.
#[tauri::command]
fn rdm_quick(kind: String, host: String) -> Result<(), String> {
    rdm::quick(&kind, &host)
}

/// Impostazioni → Remote Desktop Manager: what is installed, what is missing.
#[tauri::command]
async fn rdm_status() -> rdm::Status {
    rdm::status().await
}

/// Impostazioni → Remote Desktop Manager: the workspaces to choose from.
#[tauri::command]
async fn rdm_data_sources() -> Result<Vec<serde_json::Value>, String> {
    rdm::data_sources().await
}

/// Impostazioni → Notion, first time: the databases that look like tasks or notes.
#[tauri::command]
async fn notion_suggest() -> Result<Vec<serde_json::Value>, String> {
    notion::suggest().await
}

/// Impostazioni → Notion → Viste: what the tasks can be filtered by.
#[tauri::command]
async fn notion_properties(id: String) -> Result<Vec<notion::Property>, String> {
    notion::properties(&id).await
}

/// "Chiedi alla chat" on a Notion page: its title and text.
#[tauri::command]
async fn notion_page_text(id: String) -> Result<(String, String), String> {
    notion::page_text(&id).await
}

/// "Apri Visual Studio Code" on the VS Code pill: the working folder in VS Code
/// (found on PATH or where its installers put it), Explorer otherwise.
#[tauri::command]
fn open_in_vscode(path: Option<String>) -> bool {
    // No `cmd /C` anywhere near this. The path is a project folder chosen by
    // whoever is using Claude Code, and cmd would happily read `&`, `^` and `%`
    // in a folder name as syntax. Finding the launcher ourselves and handing the
    // path over as a separate argument keeps it a path.
    if apps::open_vscode(path.as_deref()) {
        return true;
    }
    if let Some(p) = path.as_deref().filter(|p| !p.is_empty()) {
        let _ = Command::new("explorer").arg(p).spawn();
    }
    false
}

/// The diff view's ↗: the edited file in VS Code, at the changed line.
#[tauri::command]
fn open_file_in_vscode(file: String, line: u32) -> bool {
    apps::open_vscode_at(&file, line)
}

/// "Apri" on a finished or failed session: back to the app it runs in.
#[tauri::command]
fn open_session(host: Option<String>, path: Option<String>) -> String {
    apps::open_session(host.as_deref().unwrap_or("terminal"), path.as_deref()).to_string()
}

/// Our own `where`: walks %PATH% against %PATHEXT%, no shell involved.
/// Rust quotes arguments correctly for `.cmd`/`.bat` targets since 1.77, so
/// spawning `code.cmd` directly is safe.
pub(crate) fn find_on_path(stem: &str) -> Option<std::path::PathBuf> {
    let exts = std::env::var("PATHEXT").unwrap_or_else(|_| ".COM;.EXE;.BAT;.CMD".into());
    let dirs = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&dirs) {
        for ext in exts.split(';').filter(|e| !e.is_empty()) {
            let candidate = dir.join(format!("{stem}{}", ext.to_lowercase()));
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

/// Impostazioni → Aggiornamenti → "Controlla ora".
#[tauri::command]
async fn update_check(app: AppHandle) -> Result<Option<updates::UpdateInfo>, String> {
    updates::check(&app).await
}

/// "Installa": only ever after a click in the island or the settings.
#[tauri::command]
async fn update_install(app: AppHandle) -> Result<(), String> {
    updates::install(&app).await
}

/// Tray → Pause. Paused means paused: the pollers stop talking to the network,
/// not just the island stopping showing things.
#[tauri::command]
fn set_paused(paused: bool) {
    integrations::set_paused(paused);
    threecx::refresh();
}

// ── Claude Code hooks ─────────────────────────────────────────────────────────

/// `agent`: "codex" or "gemini" for their hooks; none (or anything else) = Claude Code.
#[tauri::command]
fn hooks_status(agent: Option<String>) -> HookStatus {
    hooks::status_for(hooks::Target::parse(agent.as_deref()))
}

/// Returns the diff the user has to look at before anything is written.
#[tauri::command]
fn hooks_preview(install: bool, agent: Option<String>) -> Result<HookPreview, String> {
    hooks::preview_for(install, hooks::Target::parse(agent.as_deref()))
}

/// Only ever called from an explicit click in the settings window.
#[tauri::command]
fn hooks_apply(
    app: AppHandle,
    shared: State<Shared>,
    install: bool,
    fingerprint: String,
    agent: Option<String>,
) -> Result<String, String> {
    // The fingerprint comes from the preview the user actually looked at, so a
    // settings.json that changed in between is refused rather than overwritten.
    let target = hooks::Target::parse(agent.as_deref());
    let backup = hooks::write_for(install, &fingerprint, target)?;
    if target != hooks::Target::Claude {
        return Ok(backup);
    }
    let updated = {
        let mut current = shared.settings.lock().unwrap();
        current.hooks_installed = install;
        let _ = settings::save(&current);
        current.clone()
    };
    crate::threecx::settings_saved(&updated);
    let _ = app.emit("settings-changed", updated);
    Ok(backup)
}

#[tauri::command]
fn approval_decision(app: AppHandle, request_id: String, decision: String) {
    pipe::answer(&app, &request_id, &decision);
}

/// The island's answers to an AskUserQuestion (question → chosen label).
#[tauri::command]
fn approval_answers(app: AppHandle, request_id: String, answers: serde_json::Map<String, serde_json::Value>) {
    pipe::answer_questions(&app, &request_id, &answers);
}

/// The island has the card on screen, so the long wait for a human may begin.
/// Until this arrives the relay only waits a few hundred milliseconds, which is
/// what stops a paused or unresponsive island from freezing Claude Code.
#[tauri::command]
fn approval_ack(app: AppHandle, request_id: String) {
    pipe::acknowledge(&app, &request_id);
}

/// Nobody can act on this request — the island is paused, or another card is
/// already up. Claude Code falls back to asking in the terminal immediately.
#[tauri::command]
fn approval_decline(app: AppHandle, request_id: String) {
    pipe::decline(&app, &request_id);
}

// ── Chat, files and secrets ───────────────────────────────────────────────────

/// What `Chat::use_engine` gets: engine, model and "Modalità terminale" —
/// any of them changed, the conversation starts over.
fn chat_key(engine: &str, model: &str, terminal: bool) -> String {
    if terminal { format!("{engine}:{model}:terminal") } else { format!("{engine}:{model}") }
}

/// The key `chat_turn` will use for `engine` with its default model (Telegram's /riprendi).
pub(crate) fn chat_key_for(app: &AppHandle, engine: &str) -> String {
    let shared = app.state::<Shared>();
    let s = shared.settings.lock().unwrap();
    chat_key(engine, &s.engine_models.get(engine).cloned().unwrap_or_default(), s.chat_terminal)
}

/// «/oggi» and «/domani» in the island's chat: the same question as on Telegram.
#[tauri::command]
fn chat_day_prompt(tomorrow: bool) -> String {
    telegram::day_prompt(tomorrow)
}

/// "Modalità terminale": the folder the chat works in — the user's, if it
/// exists, else their home.
fn chat_folder(chosen: &str) -> std::path::PathBuf {
    let chosen = std::path::PathBuf::from(chosen.trim());
    if !chosen.as_os_str().is_empty() && chosen.is_dir() {
        return chosen;
    }
    std::env::var_os("USERPROFILE").map(std::path::PathBuf::from).unwrap_or_else(|| std::path::PathBuf::from("C:\\"))
}

/// One chat turn. The API key and any file bytes stay on the Rust side.
#[tauri::command]
async fn chat_send(
    app: AppHandle,
    chat: State<'_, Chat>,
    query: String,
    context: Option<ChatContext>,
    engine: Option<String>,
    auto: Option<bool>,
) -> Result<ChatReply, String> {
    let on_text = |text: &str| {
        let _ = app.emit_to(island::WINDOW_LABEL, "chat-stream", serde_json::json!({ "text": text }));
    };
    chat_turn(&app, &chat, query, context, engine, None, auto.unwrap_or(false), Channel::Island, &on_text).await
}

/// "Ferma": the turn in progress in the island's chat ([0]) or on Telegram
/// ([1]). The turn's future is dropped, and with it the engine's process
/// (kill_on_drop) and any permission it was waiting for.
static STOP: [std::sync::LazyLock<tokio::sync::Notify>; 3] = [
    std::sync::LazyLock::new(tokio::sync::Notify::new),
    std::sync::LazyLock::new(tokio::sync::Notify::new),
    std::sync::LazyLock::new(tokio::sync::Notify::new),
];

/// Where a chat turn comes from: the island's chat, Telegram (permissions
/// asked there) or a task (tasks.rs: permissions on the island, its own Ferma).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(crate) enum Channel {
    Island,
    Telegram,
    Task,
    /// Another engine a task hands one piece of work to (tasks.rs task_delegate):
    /// like a task, but not in the history.
    Helper,
}

impl Channel {
    fn slot(self) -> usize {
        match self {
            Channel::Island => 0,
            Channel::Telegram => 1,
            Channel::Task | Channel::Helper => 2,
        }
    }
}

/// Stops the turn of the running task (tasks.rs).
pub(crate) fn stop_task_turn() {
    STOP[Channel::Task.slot()].notify_waiters();
}

/// What a stopped turn answers (telegram.rs and the chat recognise it).
pub(crate) fn stopped_text() -> String {
    t("Interrotta.").to_string()
}

pub(crate) fn stop_turn(telegram: bool) {
    log::line(if telegram { "chat: turno di Telegram fermato" } else { "chat: turno fermato" });
    STOP[usize::from(telegram)].notify_waiters();
}

/// Whichever comes first: the turn or "Ferma" (then the turn is dropped).
pub(crate) async fn until_stopped<T>(telegram: bool, turn: impl std::future::Future<Output = Result<T, String>>) -> Result<T, String> {
    until_stopped_at(if telegram { Channel::Telegram } else { Channel::Island }, turn).await
}

async fn until_stopped_at<T>(channel: Channel, turn: impl std::future::Future<Output = Result<T, String>>) -> Result<T, String> {
    let mut turn = std::pin::pin!(turn);
    let mut stop = std::pin::pin!(STOP[channel.slot()].notified());
    std::future::poll_fn(|cx| {
        if let std::task::Poll::Ready(r) = std::future::Future::poll(turn.as_mut(), cx) {
            return std::task::Poll::Ready(r);
        }
        std::future::Future::poll(stop.as_mut(), cx).map(|()| Err(stopped_text()))
    })
    .await
}

/// «⇄ Seconda opinione» in the island's chat: another engine reviews the last
/// answer (second.rs); what it says rides in front of the next question.
#[tauri::command]
async fn chat_second(app: AppHandle, chat: State<'_, Chat>, engine: String, first: String, question: String, answer: String) -> Result<String, String> {
    let on_text = |text: &str| {
        let _ = app.emit_to(island::WINDOW_LABEL, "chat-stream", serde_json::json!({ "text": text }));
    };
    second::run(&app, &chat, &engine, &first, &question, &answer, false, &on_text).await
}

/// The island's "Ferma".
#[tauri::command]
fn chat_stop() {
    stop_turn(false);
}

/// A chat turn on `chat`: the island's conversation (`chat_send`) or
/// Telegram's (telegram.rs, `telegram` true: permissions asked there, and
/// its own mark in the history). `on_text` gets the text so far; `model`
/// replaces the engine's model for this conversation only (Telegram's /modello).
#[allow(clippy::too_many_arguments)]
pub(crate) async fn chat_turn(
    app: &AppHandle,
    chat: &Chat,
    query: String,
    context: Option<ChatContext>,
    engine: Option<String>,
    model: Option<String>,
    auto: bool,
    channel: Channel,
    on_text: &(dyn Fn(&str) + Sync),
) -> Result<ChatReply, String> {
    // Permissions go to Telegram only for its turns; a task asks on the island.
    let telegram = channel == Channel::Telegram;
    let shared = app.state::<Shared>();
    let picked = model.filter(|m| !m.trim().is_empty());
    let (engine, model, cli_model, mcp, agent, other_model, url, terminal) = {
        let s = shared.settings.lock().unwrap();
        // The engine picked in the chat for this conversation, else the default.
        let e = engine.filter(|e| !e.is_empty()).unwrap_or_else(|| s.chat_engine.clone());
        let mut other = s.engine_models.get(&e).cloned().unwrap_or_default();
        let (mut model, mut cli_model) = (s.model.clone(), s.cli_model.clone());
        match (&picked, e.as_str()) {
            (Some(m), "api") => model = m.clone(),
            (Some(m), "subscription") => cli_model = m.clone(),
            (Some(m), _) => other = m.clone(),
            (None, _) => {}
        }
        let url = s.engine_urls.get(&e).cloned();
        let terminal = s.chat_terminal.then(|| chat_folder(&s.chat_folder));
        (e, model, cli_model, s.mcp_servers.clone(), s.agent_tools, other, url, terminal)
    };
    // The work folder, when one is chosen (workdir.rs): the engines may read it.
    let work = workdir::root(app);
    // A different model is a different conversation too: start over (an
    // opencode conversation left behind is deleted from opencode's history).
    // So is turning "Modalità terminale" on or off.
    let before = chat.cli_session();
    let key_model = picked.as_deref().unwrap_or(&other_model);
    chat.use_engine(&chat_key(&engine, key_model, terminal.is_some()));
    if before.is_some() && chat.cli_session().is_none() {
        opencode::forget(before);
    }
    // A new conversation with an engine that has tools: the map of Notion
    // (notion_map.rs) in front, so it does not search for the structure.
    let has_tools = terminal.is_some() || !(engine == "api" || openai::ENGINES.contains(&engine.as_str()));
    let fresh = chat.is_empty() && chat.cli_session().is_none();
    let notion = if has_tools && fresh { notion_map::index(agent) } else { None };
    // The memory (memory.rs): its notes in front of a new conversation, with
    // how to look further (memory_search) when the engine has the tools.
    let (remember, instructions) = {
        let s = shared.settings.lock().unwrap();
        // The profile's instructions, then the assistant picked for this conversation.
        let mut text = s.chat_instructions.trim().to_string();
        if let Some(p) = chat.persona().filter(|_| channel == Channel::Island) {
            if !text.is_empty() {
                text.push_str("\n\n");
            }
            text.push_str(p.trim());
        }
        (s.chat_history, text)
    };
    let memory_tools = agent && (has_tools || engine == "api");
    let memory = if remember && fresh { memory::preface(memory_tools) } else { None };
    // The user's skills (skills.rs): their names in front, read with skill_read when they fit.
    let skills = if fresh && memory_tools { skills::index() } else { None };
    // A reopened conversation the engine cannot resume: it rides in front of the question.
    let preamble = chat.take_preamble();
    let asked = query.clone();
    // Recipes (recipes.rs): how a similar question was answered, right before it.
    let recipe_hint = if agent && (has_tools || engine == "api") { recipes::hint(&asked) } else { None };
    let query = match &recipe_hint {
        Some(h) => format!("{h}{query}"),
        None => query,
    };
    let query = match &preamble {
        Some(p) => format!("{p}{query}"),
        None => query,
    };
    let query = match notion {
        Some(n) => format!("{n}{query}"),
        None => query,
    };
    let query = match &memory {
        Some(m) => format!("{m}{query}"),
        None => query,
    };
    let query = match &skills {
        Some(s) => format!("{s}{query}"),
        None => query,
    };
    // Impostazioni → Chat → Istruzioni (of the active profile), first of all.
    let query = if fresh && !instructions.is_empty() {
        format!("{}\n\n{query}", tf("[Istruzioni dell'utente per questa chat:\n{text}]", &[("text", &instructions)]))
    } else {
        query
    };
    // Accesso remoto: the chat linked to a connection is told which PC (remote.rs).
    let query = match remote::hint().filter(|_| channel == Channel::Island && agent) {
        Some(r) => format!("{r}{query}"),
        None => query,
    };
    // Anteprima: what is open in it, when that changed (preview.rs).
    let query = match preview::hint().filter(|_| channel == Channel::Island && agent && (has_tools || engine == "api")) {
        Some(p) => format!("{p}{query}"),
        None => query,
    };
    // "Automatica" (the chat's switch): only with Modalità terminale.
    let auto = auto && terminal.is_some();
    if auto {
        log::line(format!("chat: turno in automatica ({engine})"));
    }
    // Measured (20 October 2026, "lentezza disumana"): when the first words
    // came and how long the whole turn took, in the log.
    let started = std::time::Instant::now();
    let first_text: std::sync::Mutex<Option<u128>> = std::sync::Mutex::new(None);
    let timed = |text: &str| {
        first_text.lock().unwrap().get_or_insert_with(|| started.elapsed().as_millis());
        on_text(text);
    };
    let on_text: &(dyn Fn(&str) + Sync) = &timed;
    let recipe_mark = recipes::begin();
    let work_turn = async { match (&terminal, engine.as_str()) {
        (Some(folder), "opencode") => {
            let o = opencode::Options { folder: Some(folder.clone()), auto, telegram, agent, work: work.clone(), ..Default::default() };
            opencode::send(app, chat, &other_model, query, context, &o, on_text).await
        }
        // "Modalità terminale" for an engine without tools: through opencode.
        (Some(folder), e) if e == "api" || openai::ENGINES.contains(&e) => {
            let api_model = if e == "api" { model.clone() } else { other_model.clone() };
            match opencode::via(e, &api_model, url.as_deref()) {
                Ok((m, mut o)) if opencode::find_exe().is_some() => {
                    o.folder = Some(folder.clone());
                    o.auto = auto;
                    o.telegram = telegram;
                    o.agent = agent;
                    o.work = work.clone();
                    opencode::send(app, chat, &m, query, context, &o, on_text).await
                }
                Ok(_) => Err(t("La modalità terminale con questo motore passa da opencode, che non è installato su questo PC (npm i -g @opencode/cli, oppure opencode.ai). Oppure spegnila in Impostazioni → Chat.").into()),
                Err(e) => Err(e),
            }
        }
        // Antigravity always works with its own tools: in the terminal mode's folder, else the work folder.
        (_, "antigravity") => {
            let dir = terminal.clone().or_else(|| work.clone());
            antigravity::send(chat, &other_model, query, context, dir.as_deref(), on_text, telegram).await
        }
        (Some(folder), _) => claude_cli::send_kept(chat, &cli_model, &mcp, agent, query, context, Some(folder), auto, on_text, telegram, None).await,
        (None, "api") => {
            let tools = agent.then_some(claude::Tools { app, telegram });
            claude::send_with(chat, &model, query, context, tools).await
        }
        (None, "opencode") => {
            let o = opencode::Options { telegram, agent, work: work.clone(), ..Default::default() };
            opencode::send(app, chat, &other_model, query, context, &o, on_text).await
        }
        (None, e) if openai::ENGINES.contains(&e) => openai::send(chat, &engine, &other_model, url.as_deref(), query, context, on_text).await,
        (None, _) => claude_cli::send_kept(chat, &cli_model, &mcp, agent, query, context, None, false, on_text, telegram, work.as_deref()).await,
    } };
    let reply = until_stopped_at(channel, work_turn).await;
    let first = first_text.lock().unwrap().map_or_else(|| "-".to_string(), |ms| format!("{:.1} s", ms as f64 / 1000.0));
    log::line(format!(
        "chat: turno {engine}{} in {:.1} s (primo testo {first}){}{}",
        match channel { Channel::Telegram => " da Telegram", Channel::Task => " di un compito", Channel::Helper => " di un aiutante", Channel::Island => "" },
        started.elapsed().as_secs_f64(),
        if reply.is_err() { ", non riuscito" } else { "" },
        recipe_hint.as_ref().map_or("", |_| ", con ricetta"),
    ));
    recipes::end(recipe_mark, &asked, reply.is_ok());
    match &reply {
        Ok(r) if channel != Channel::Helper && shared.settings.lock().unwrap().chat_history => {
            chat_log::record(chat, &engine, &asked, &r.text, match channel { Channel::Telegram => "Telegram · ", Channel::Task => "Compito · ", _ => "" });
            memory::diary(&engine, &asked, &r.text, telegram);
        }
        Ok(_) => {}
        Err(_) => {
            if let Some(p) = preamble {
                chat.put_back_preamble(p);
            }
        }
    }
    reply
}

/// Impostazioni → Integrazioni → Telegram: the bot, the linked chat, errors.
#[tauri::command]
fn telegram_info(app: AppHandle) -> telegram::Info {
    telegram::info(&app)
}

/// A code for `/start <code>` in the bot's chat (10 minutes).
#[tauri::command]
fn telegram_link_code() -> String {
    telegram::link_code()
}

#[tauri::command]
fn telegram_unlink(app: AppHandle) -> Result<(), String> {
    telegram::unlink(&app)
}

/// The token was saved: the polling starts over with it.
#[tauri::command]
fn telegram_restart() {
    telegram::restart();
}

/// "Sostituisci": the text selected in an app, rewritten as `prompt` asks, in
/// one answer of its own. It goes through the chat's engine but never into the
/// chat: a conversation of its own, no connectors, nothing in the history.
#[tauri::command]
async fn rewrite_text(app: AppHandle, shared: State<'_, Shared>, prompt: String, text: String) -> Result<Rewritten, String> {
    let (engine, model, cli_model, other_model, url) = {
        let s = shared.settings.lock().unwrap();
        let other = s.engine_models.get(&s.chat_engine).cloned().unwrap_or_default();
        let url = s.engine_urls.get(&s.chat_engine).cloned();
        (s.chat_engine.clone(), s.model.clone(), s.cli_model.clone(), other, url)
    };
    let chat = Chat::default();
    // With the app's HTML, the model gets the text with marks where the
    // formatting is, and the reply is put back together with it (richtext.rs).
    let html = context::captured_html(&text);
    let marked = html.as_ref().and_then(|c| richtext::mark(&c.fragment));
    let marks_note = match &marked {
        Some(_) => format!("\n\n{}", t("Nel testo ci sono segni come ⟦1⟧ al posto della formattazione (grassetto, link, paragrafi): lasciali tutti, ognuno una volta sola e nello stesso ordine, accanto alle parole a cui si riferiscono.")),
        None => String::new(),
    };
    let query = format!(
        "{}\n\n{}{}",
        prompt.trim(),
        t("Rispondi solo con il testo nuovo che prenderà il posto di quello selezionato: niente introduzioni, commenti, virgolette o markdown. Mantieni la lingua del testo, salvo che ti sia chiesto di tradurlo."),
        marks_note,
    );
    let sent = marked.as_ref().map_or(text, |m| m.text.clone());
    let context = Some(ChatContext::Text { label: t("Testo selezionato").into(), text: sent });
    let reply = if engine == "api" {
        claude::send(&chat, &model, query, context).await
    } else if engine == "antigravity" {
        antigravity::send(&chat, &other_model, query, context, None, &|_| {}, false).await
    } else if engine == "opencode" {
        let r = opencode::send(&app, &chat, &other_model, query, context, &opencode::Options::default(), &|_| {}).await;
        opencode::forget(chat.cli_session());
        r
    } else if openai::ENGINES.contains(&engine.as_str()) {
        openai::send(&chat, &engine, &other_model, url.as_deref(), query, context, &|_| {}).await
    } else {
        claude_cli::send(&chat, &cli_model, &[], false, query, context, None, false, &|_| {}, false, None).await
    };
    let reply = context::clean_reply(&reply?.text);
    let (Some(clip), Some(marked)) = (html, marked) else {
        context::keep_rewrite(&reply, None);
        return Ok(Rewritten { text: reply, formatted: false, lost: false });
    };
    let plain = marked.plain(&reply);
    match marked.rebuild(&reply) {
        Some(fragment) => {
            context::keep_rewrite(&plain, Some(clip.with_fragment(&fragment)));
            Ok(Rewritten { text: plain, formatted: true, lost: false })
        }
        None => {
            log::line(format!("sostituisci: formattazione persa ({} segni attesi)", marked.marks()));
            context::keep_rewrite(&plain, None);
            Ok(Rewritten { text: plain, formatted: false, lost: true })
        }
    }
}

/// A rewrite for the card: `formatted` when "Sostituisci" can paste it with the
/// selection's formatting, `lost` when the selection had some and it could not be kept.
#[derive(serde::Serialize)]
struct Rewritten {
    text: String,
    formatted: bool,
    lost: bool,
}

/// "Copia" in the rewrite card: with the formatting, or as plain text.
#[tauri::command]
fn copy_rewrite(text: String, formatted: bool) -> Result<(), String> {
    context::copy_rewrite(&text, formatted)
}

/// "Sostituisci" in the card: `text` in place of the selection, if it is still
/// `original`. The error is a reason code (see `context::replace`).
#[tauri::command]
async fn replace_selection(original: String, text: String, formatted: bool) -> Result<(), String> {
    match tauri::async_runtime::spawn_blocking(move || context::replace(&original, &text, formatted)).await {
        Ok(r) => r.map_err(String::from),
        Err(_) => Err("no-window".into()),
    }
}

/// The menu by the mouse on the selected text (the island builds the entries).
#[tauri::command]
fn selection_menu(app: AppHandle, entries: Vec<tray::MenuEntry>) {
    tray::popup_entries(&app, &entries);
}

#[tauri::command]
fn chat_reset(chat: State<Chat>) {
    let before = chat.cli_session();
    chat.reset();
    chat.set_persona(None);
    opencode::forget(before);
}

/// The chat's history list, most recent first.
#[tauri::command]
fn chat_history_list() -> Vec<chat_log::Summary> {
    chat_log::list()
}

/// Reopens a conversation from the history in place of the current one.
#[tauri::command]
fn chat_history_open(shared: State<'_, Shared>, chat: State<'_, Chat>, id: String) -> Result<chat_log::Opened, String> {
    let before = chat.cli_session();
    let engine = chat_log::engine_of(&id).ok_or_else(|| t("Questa conversazione non c'è più.").to_string())?;
    // The key chat_send will compute for this engine, so it does not start over.
    let (model, terminal) = {
        let s = shared.settings.lock().unwrap();
        (s.engine_models.get(&engine).cloned().unwrap_or_default(), s.chat_terminal)
    };
    let opened = chat_log::open(&chat, &id, &chat_key(&engine, &model, terminal))?;
    opencode::forget(before);
    Ok(opened)
}

/// Impostazioni → Chat → Memoria: how many notes and days.
#[tauri::command]
fn memory_info() -> memory::Info {
    memory::info()
}

/// «/ricorda …» in the chat: a note for MEMORIA.md, without asking a model.
#[tauri::command]
fn memory_note(text: String) -> Result<String, String> {
    memory::note(&text)
}

/// «/memoria», Impostazioni → «Apri»: MEMORIA.md in its editor (or the folder).
#[tauri::command]
fn memory_open(folder: bool) -> Result<(), String> {
    let path = if folder { std::fs::create_dir_all(memory::dir()).map(|()| memory::dir()).map_err(|e| e.to_string())? } else { memory::ensure_main()? };
    Command::new("explorer").arg(&path).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// The memory window (brain.rs): pages, notes, sources, days and their links, the timeline.
#[tauri::command]
async fn memory_graph() -> Result<brain::Graph, String> {
    // A failure says so: the window must not show "la memoria è vuota" instead.
    tauri::async_runtime::spawn_blocking(brain::graph).await.map_err(|e| tf("Errore nel leggere la memoria: {e}", &[("e", &e)]))
}

/// «Collega con l'IA» (memory_ai.rs): the chosen engine ties the memory together; what was done.
#[tauri::command]
async fn memory_link(app: AppHandle) -> Result<String, String> {
    memory_ai::run(&app).await
}

/// The memory window's «Leggi adesso» and «Controlla»: a task (tasks.rs).
#[tauri::command]
fn memory_job(app: AppHandle, kind: String) -> Result<(), String> {
    tasks::memory_job(&app, &kind)
}

/// The file behind a node of the memory window, in its editor; "inbox": the da-leggere folder.
#[tauri::command]
fn memory_node_open(id: String) -> Result<(), String> {
    let path = if id == "inbox" {
        brain::ensure_inbox()?
    } else {
        brain::node_file(&id).ok_or(i18n::t("Questo elemento non ha un file."))?
    };
    Command::new("explorer").arg(&path).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// Files dropped on the memory window: into da-leggere.
#[tauri::command]
fn memory_inbox_add(name: String, data: Vec<u8>) -> Result<String, String> {
    brain::inbox_add(&name, &data)
}

/// «Ricorda…» in the memory window: a note, like «/ricorda».
#[tauri::command]
fn memory_note_add(app: AppHandle, text: String) -> Result<String, String> {
    brain::changed(&app, memory::note(&text))
}

/// Impostazioni → Chat → Memoria → «Mappa»: the memory window.
#[tauri::command]
fn memory_window_open(app: AppHandle) {
    show_memory_window(&app);
}

/// The history list filtered by words (title and text).
#[tauri::command]
fn chat_history_search(query: String) -> Vec<chat_log::Summary> {
    chat_log::search(&query)
}

#[tauri::command]
fn chat_history_pin(id: String, pinned: bool) {
    chat_log::set_pinned(&id, pinned);
}

/// ✎ in the history list: the conversation's title.
#[tauri::command]
fn chat_history_rename(id: String, title: String) {
    chat_log::rename(&id, &title);
}

/// «Modifica» / «Rigenera»: the conversation goes back to its first lines.
#[tauri::command]
fn chat_rewind(chat: State<'_, Chat>, keep: Vec<chat_log::Line>) {
    let before = chat.cli_session();
    chat_log::rewind(&chat, keep);
    opencode::forget(before);
}

/// «⑂ Dirama da qui»: a new conversation from the first lines of this one.
#[tauri::command]
fn chat_fork(chat: State<'_, Chat>, keep: Vec<chat_log::Line>) {
    let before = chat.cli_session();
    chat_log::fork(&chat, keep);
    opencode::forget(before);
}

/// An assistant (Impostazioni → Chat → Assistenti) for the conversation that
/// starts: its instructions go in front of the first question. None = none.
#[tauri::command]
fn chat_persona(chat: State<'_, Chat>, instructions: Option<String>) {
    chat.set_persona(instructions);
}

/// 🎤 in the chat: what was said, through the service of Telegram's «Vocali»
/// (transcribe.rs). The audio is not kept.
#[tauri::command]
async fn chat_transcribe(shared: State<'_, Shared>, audio: Vec<u8>, mime: String) -> Result<String, String> {
    let (service, model) = {
        let s = shared.settings.lock().unwrap();
        (s.integration_config.telegram_voice.clone(), s.integration_config.telegram_voice_model.clone())
    };
    if service.is_empty() {
        return Err(t("Scegli chi trascrive in Impostazioni → Telegram → Vocali, oppure usa la dettatura di Windows.").into());
    }
    transcribe::transcribe(&service, &model, &audio, &mime).await
}

/// 🎤 records (true) or stopped: the microphone in use is ours, not a meeting (presence.rs).
#[tauri::command]
fn chat_dictation(on: bool) {
    presence::set_dictation(on);
}

/// 🎤 without a transcription service: Windows' own dictation (Win+H) in the
/// chat's field, which has the keyboard focus.
#[tauri::command]
async fn chat_dictate_windows() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let steps = keys::parse("Win+H")?;
        keys::play(&steps);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// «Esporta»: the conversation as a Markdown file in the Vassoio.
#[tauri::command]
fn chat_export(title: String, lines: Vec<chat_log::Line>) -> Result<DroppedFile, String> {
    let mut text = format!("# {}\n\n", title.trim());
    for l in &lines {
        let who = if l.role == "user" { t("Tu") } else { t("Assistente") };
        text.push_str(&format!("**{who}:**\n\n{}\n\n---\n\n", l.content.trim()));
    }
    let safe: String = title.chars().filter(|c| !r#"\/:*?"<>|"#.contains(*c)).take(60).collect();
    let name = format!("{} - {}.md", t("Chat"), safe.trim());
    files::save_new(&name, text.as_bytes())
}

#[tauri::command]
fn chat_history_delete(id: String) {
    chat_log::delete(&id);
}

#[tauri::command]
fn chat_history_clear() {
    chat_log::clear();
}

/// Impostazioni → Chat → "Carica modelli" for an OpenAI-compatible engine.
#[tauri::command]
async fn chat_models(engine: String, url: Option<String>) -> Result<Vec<openai::ModelOption>, String> {
    if engine == "opencode" {
        return opencode::models().await;
    }
    if engine == "antigravity" {
        return antigravity::models().await;
    }
    openai::models(&engine, url.as_deref()).await
}

/// Impostazioni → Chat → Antigravity: is its CLI (`agy`) on this PC?
#[tauri::command]
fn antigravity_status() -> antigravity::AgyStatus {
    antigravity::status()
}

/// Impostazioni -> Telegram -> «Vocali»: the models of a service that take audio, cheapest first.
#[tauri::command]
async fn voice_models(service: String) -> Result<Vec<openai::ModelOption>, String> {
    transcribe::models(&service).await
}

/// Settings window: MCP servers configured for the user in Claude Code (names only).
#[tauri::command]
async fn mcp_servers_configured() -> Vec<String> {
    tauri::async_runtime::spawn_blocking(claude_cli::configured_mcp_servers)
        .await
        .unwrap_or_default()
}

/// Settings window: is Claude Code installed and signed in?
#[tauri::command]
async fn claude_cli_status() -> claude_cli::CliStatus {
    claude_cli::status().await
}

/// Copies a dropped file into the inbox and reports its name back. Off the
/// main thread: a sync command runs there, and copying a file of a few GB
/// froze the whole island ("not responding") until it was done.
/// Ctrl+V in the chat's field: the files copied in Explorer (the first one
/// that is a file), else the picture on the clipboard as a PNG in the inbox.
/// None when the clipboard has neither (then the text is pasted as usual).
#[tauri::command]
async fn chat_paste() -> Result<Option<DroppedFile>, String> {
    tauri::async_runtime::spawn_blocking(|| {
        if let Some(path) = clipimage::files().into_iter().find(|p| std::path::Path::new(p).is_file()) {
            return files::ingest(&path).map(Some);
        }
        if !clipimage::has_image() {
            return Ok(None);
        }
        let Some(img) = clipimage::read() else { return Ok(None) };
        let png = clipimage::encode_png(&img)?;
        let name = format!("{}.png", t("Immagine incollata"));
        files::save_new(&name, &png).map(Some)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn ingest_file(path: String) -> Result<DroppedFile, String> {
    tauri::async_runtime::spawn_blocking(move || files::ingest(&path)).await.map_err(|e| e.to_string())?
}

/// "Riquadra e chiedi" (screenshot.rs): freezes the screen under the mouse.
#[tauri::command]
async fn capture_begin() -> Result<screenshot::Screen, String> {
    tauri::async_runtime::spawn_blocking(screenshot::freeze).await.map_err(|e| e.to_string())?
}

/// The frozen screen's RGBA pixels, raw: a 4K screen is 33 MB, far too much for JSON.
#[tauri::command]
fn capture_frame() -> tauri::ipc::Response {
    tauri::ipc::Response::new(screenshot::frame().unwrap_or_default())
}

/// The island's window covers the frozen screen and takes the mouse and the keys.
#[tauri::command]
fn capture_show(app: AppHandle) -> Result<(), String> {
    let s = screenshot::frozen_screen().ok_or(i18n::t("La cattura è già chiusa"))?;
    let win = island::window(&app).ok_or("no island window")?;
    island::CAPTURING.store(true, Ordering::Relaxed);
    let _ = win.show();
    let _ = win.set_position(tauri::PhysicalPosition::new(s.x, s.y));
    let _ = win.set_size(tauri::PhysicalSize::new(s.width, s.height));
    // Moving to another display can rescale the window: re-assert the physical size.
    let _ = win.set_position(tauri::PhysicalPosition::new(s.x, s.y));
    let _ = win.set_size(tauri::PhysicalSize::new(s.width, s.height));
    island::ignore_cursor(&win, false);
    island::raise_over_taskbar(&app);
    island::set_activating(&win, true);
    let _ = win.set_focus();
    Ok(())
}

/// The overlay is gone: the window goes back to the island, the frozen screen is dropped.
#[tauri::command]
fn capture_end(app: AppHandle, shared: State<Shared>) {
    screenshot::clear();
    if !island::CAPTURING.swap(false, Ordering::Relaxed) {
        return;
    }
    let collapsed = shared.gate.collapsed.load(Ordering::Relaxed);
    let settings = shared.settings.lock().unwrap().clone();
    island::apply_geometry(&app, &shared.gate, &settings, collapsed);
    if let Some(win) = island::window(&app) {
        island::set_activating(&win, false);
        if collapsed && shared.gate.fullscreen.load(Ordering::Relaxed) {
            let _ = win.hide();
        }
    }
    shared.gate.forget_ignore_state();
}

/// The zone (physical px of the frozen screen) as a PNG in the inbox: for the
/// chat, a quick action or the tray.
#[tauri::command]
async fn capture_save(x: f64, y: f64, width: f64, height: f64) -> Result<DroppedFile, String> {
    tauri::async_runtime::spawn_blocking(move || screenshot::save_zone(x, y, width, height))
        .await
        .map_err(|e| e.to_string())?
}

/// The zone on the clipboard as a picture.
#[tauri::command]
async fn capture_copy(x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || screenshot::copy_zone(x, y, width, height))
        .await
        .map_err(|e| e.to_string())?
}

/// The zone's text (Windows' OCR), also copied.
#[tauri::command]
async fn capture_text(x: f64, y: f64, width: f64, height: f64) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || screenshot::zone_text(x, y, width, height))
        .await
        .map_err(|e| e.to_string())?
}

/// The character of the chat tab is carried over the other windows
/// (window_drop.rs): meanwhile the island's window keeps the mouse, as in a drag.
#[tauri::command]
fn window_pick(shared: State<Shared>, active: bool) {
    shared.gate.dragging.store(active, Ordering::Relaxed);
    if !active {
        carry::hide();
    }
}

/// The carried character's face, drawn under the pointer by carry.rs (RGBA, physical px).
#[tauri::command]
fn carry_frame(shared: State<Shared>, width: u32, height: u32, rgba: Vec<u8>) {
    // A frame still on its way after the drop must not bring the window back.
    if shared.gate.dragging.load(Ordering::Relaxed) {
        carry::frame(width, height, rgba);
    }
}

/// The window the carried character is over: its program and title.
#[tauri::command]
fn window_under_cursor() -> Option<window_drop::WindowInfo> {
    let (x, y) = island::cursor_physical()?;
    window_drop::info_at(x as i32, y as i32).map(|(_, info)| info)
}

/// The character let go on a window: its picture in the inbox, for the chat.
#[tauri::command]
async fn window_drop(shared: State<'_, Shared>) -> Result<Option<window_drop::WindowShot>, String> {
    shared.gate.dragging.store(false, Ordering::Relaxed);
    carry::hide();
    let Some((x, y)) = island::cursor_physical() else { return Ok(None) };
    let shot = tauri::async_runtime::spawn_blocking(move || window_drop::capture_at(x as i32, y as i32))
        .await
        .map_err(|e| e.to_string())??;
    if let Some(s) = &shot {
        log::line(format!("window dropped: {}", s.app_name));
    }
    Ok(shot)
}

/// The island may only ask whether a key exists — never read it.
#[tauri::command]
fn secret_present(key: String) -> bool {
    secrets::present(&key)
}

#[tauri::command]
fn secret_set(key: String, value: String) -> Result<(), String> {
    secrets::set(&key, &value)?;
    if key.starts_with("3cx-") {
        threecx::refresh();
    }
    Ok(())
}

#[tauri::command]
fn secret_clear(key: String) -> Result<(), String> {
    secrets::clear(&key)
}

/// Opens the configured n8n instance — the URL lives in the Credential Manager.
#[tauri::command]
fn open_n8n() {
    if let Some(url) = secrets::get("n8n-url") {
        open_url(url);
    }
}

/// "Apri" on the cards of the integrations that are a Windows tool or a
/// server: the matching program, settings page or web client. Fixed targets
/// only, never a path or a command from the front end.
#[tauri::command]
fn open_integration(app: AppHandle, id: String) -> bool {
    let shell = |target: &str| {
        Command::new("explorer.exe").arg(target).creation_flags(CREATE_NO_WINDOW).spawn().is_ok()
    };
    // Through ShellExecute: it reads App Paths (outlook.exe) and asks for
    // elevation when a program wants it (Task Manager), CreateProcess does neither.
    let start = |exe: &str| {
        Command::new("powershell.exe")
            .args(["-NoProfile", "-NonInteractive", "-Command", &format!("Start-Process {exe}")])
            .creation_flags(CREATE_NO_WINDOW)
            .spawn()
            .is_ok()
    };
    match id.as_str() {
        "integration_system" => start("taskmgr.exe"),
        "integration_security" => shell("windowsdefender:"),
        "integration_network" => shell("ms-settings:network-status"),
        "integration_clipboard" => shell("ms-settings:clipboard"),
        "integration_weather" => shell("msnweather:"),
        "integration_outlook" => start("outlook.exe"),
        "integration_rdm" => rdm::open_app(),
        "integration_teams" => teams::open(),
        "integration_recorder" => record::open_folder(&app),
        "integration_3cx" => match secrets::get("3cx-url").as_deref().and_then(threecx::base_url) {
            Some(url) => {
                open_url_now(&format!("{url}/webclient"));
                true
            }
            None => false,
        },
        _ => false,
    }
}

/// Refresh buttons in the integration cards.
#[tauri::command]
async fn refresh_integration(app: AppHandle, id: String) {
    match id.as_str() {
        clipboard::ID => clipboard::publish(&app),
        threecx::ID => threecx::publish_now(&app),
        media::ID => media::refresh(),
        teams::ID => teams::refresh(&app),
        record::ID => record::publish(&app),
        remote::ID => remote::publish(&app),
        _ => integrations::poll_once(app, &id).await,
    }
}

// ── Accesso remoto (remote.rs) ───────────────────────────────────────────────

#[tauri::command]
async fn remote_connect(app: AppHandle, request: remote::Request) -> Result<(), String> {
    remote::connect(&app, request).await
}

#[tauri::command]
async fn remote_disconnect(app: AppHandle) -> Result<(), String> {
    remote::disconnect(&app).await
}

/// The chat's 🔌: the chat works on the open connection, or stops.
#[tauri::command]
fn remote_link(app: AppHandle, on: bool) -> Result<(), String> {
    remote::link(&app, on)
}

/// Appunti: put an entry back on the clipboard (transformed), and paste it.
#[tauri::command]
async fn clipboard_use(app: AppHandle, id: u64, transform: String, paste: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || clipboard::use_entry(&app, id, &transform, paste))
        .await
        .map_err(|e| e.to_string())?
}

/// Appunti → "Chiedi alla chat" on a picture.
#[tauri::command]
fn clipboard_ask(id: u64) -> Result<DroppedFile, String> {
    clipboard::picture_to_inbox(id)
}

/// Ctrl+Alt+K with a picture on the clipboard instead of a text.
#[tauri::command]
async fn clipboard_picture() -> Result<Option<DroppedFile>, String> {
    tauri::async_runtime::spawn_blocking(screenshot::clipboard_picture).await.map_err(|e| e.to_string())?
}

#[tauri::command]
fn clipboard_pin(app: AppHandle, id: u64, pinned: bool) {
    clipboard::pin(&app, id, pinned);
}

#[tauri::command]
fn clipboard_remove(app: AppHandle, id: u64) {
    clipboard::remove(&app, id);
}

#[tauri::command]
fn clipboard_clear(app: AppHandle) {
    clipboard::clear(&app);
}

/// La Raccolta (collect.rs): the collection as saved, "" for none.
#[tauri::command]
fn collect_load() -> String {
    collect::load()
}

#[tauri::command]
fn collect_save(json: String) -> Result<(), String> {
    collect::save(&json)
}

/// Where the selection just read came from: app, title and, from a browser, the page.
#[tauri::command]
fn collect_source(text: String) -> collect::Source {
    collect::source(&text)
}

/// The app in front, for the suggested actions in the ⚡ tab.
#[tauri::command]
fn foreground_app() -> Option<context::Foreground> {
    context::foreground()
}

/// Is process `pid` still running `exe` ("claude.exe")? A session's agent, so the
/// island can let go of a session whose terminal was closed without SessionEnd.
#[tauri::command]
fn process_alive(pid: u32, exe: String) -> bool {
    apps::pids_of(&[exe.to_lowercase().as_str()]).contains(&pid)
}

/// The text selected in the app in front (copied, then the clipboard restored);
/// the error is a reason code (see `context::selection`).
#[tauri::command]
async fn capture_selection() -> Result<String, String> {
    match tauri::async_runtime::spawn_blocking(context::selection).await {
        Ok(r) => r.map_err(String::from),
        Err(_) => Err("empty".into()),
    }
}

/// Microsoft account: configured, signed in, the account's name.
#[tauri::command]
async fn ms_status() -> msgraph::Status {
    let mut st = msgraph::status();
    if st.signed_in && st.account.is_none() {
        st.account = msgraph::account().await;
        st.error = msgraph::status().error;
    }
    st
}

/// "Accedi con Microsoft": the browser, then back here (msgraph.rs).
#[tauri::command]
async fn ms_login(app: AppHandle) -> Result<String, String> {
    msgraph::login(app).await
}

#[tauri::command]
fn ms_logout() -> Result<(), String> {
    msgraph::logout()
}

/// The Teams card asks right away instead of waiting for the next minute.
#[tauri::command]
async fn ms_teams_snapshot() -> serde_json::Value {
    msgraph::teams_snapshot().await
}

/// "Registra": starts a recording (record.rs); Err = why not.
#[tauri::command]
fn record_start(app: AppHandle, request: record::Request) -> Result<(), String> {
    record::start(app, request)
}

/// File e schermo: the windows one can record or photograph.
#[tauri::command]
fn record_windows() -> Vec<window_drop::PickedWindow> {
    window_drop::list()
}

/// File e schermo: the character let go on a window chooses it (no picture taken).
#[tauri::command]
fn window_pick_drop(shared: State<'_, Shared>) -> Option<window_drop::PickedWindow> {
    shared.gate.dragging.store(false, Ordering::Relaxed);
    carry::hide();
    let (x, y) = island::cursor_physical()?;
    window_drop::picked_at(x as i32, y as i32)
}

/// "Foto nel Vassoio": the chosen window as a PNG in the inbox.
#[tauri::command]
async fn window_shot(id: i64) -> Result<DroppedFile, String> {
    tauri::async_runtime::spawn_blocking(move || window_drop::shot(id)).await.map_err(|e| e.to_string())?
}

/// "Registra": Stop. The file is closed on the recording's thread, then offered.
#[tauri::command]
fn record_stop() {
    record::stop();
}

/// The Teams card and strip: a meeting command ("mute", "video", "hand", "share", "leave", "open").
#[tauri::command]
async fn teams_action(kind: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || teams::action(&kind)).await.map_err(|e| e.to_string())?
}

/// "Partecipa" on a meeting of the Teams card.
#[tauri::command]
fn teams_join(url: String) -> Result<(), String> {
    teams::join(&url)
}

/// "Partecipa dal link copiato".
#[tauri::command]
fn teams_join_clipboard() -> Result<(), String> {
    teams::join_from_clipboard()
}

/// A "Tasti" quick action: the key sequence to the app in front (keys.rs).
#[tauri::command]
async fn action_send_keys(keys: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || context::send_keys(&keys)).await.map_err(|e| e.to_string())?
}

/// All the text of the window in front (Ctrl+A, Ctrl+C); errors as `capture_selection`.
#[tauri::command]
async fn capture_window_text() -> Result<String, String> {
    match tauri::async_runtime::spawn_blocking(context::window_text).await {
        Ok(r) => r.map_err(String::from),
        Err(_) => Err("empty".into()),
    }
}

/// Impostazioni → Flussi: the last runs, newest first.
#[tauri::command]
fn automations_log() -> Vec<automations::LogEntry> {
    automations::log()
}

/// Impostazioni → Flussi → Esecuzioni (flows.rs).
#[tauri::command]
fn flows_runs() -> Vec<flows::RunInfo> {
    flows::runs()
}

#[tauri::command]
fn flow_run(id: String) -> Result<flows::Run, String> {
    flows::run_detail(&id)
}

/// The flow editor's "Prova da qui": a run from that step.
#[tauri::command]
fn flow_try_from(app: AppHandle, id: String, node: String) -> Result<(), String> {
    let (autos, _, actions) = automations::list(&app);
    let flow = autos.into_iter().find(|a| a.id == id).ok_or_else(|| i18n::t("Automazione non trovata (salvata?)").to_string())?;
    flows::try_from(&app, flow, &node, actions)
}

/// "Riprendi da qui".
#[tauri::command]
fn flow_rerun(app: AppHandle, id: String, node: String) -> Result<(), String> {
    flows::rerun(&app, &id, &node, automations::list(&app).2)
}

/// Proposte dalle abitudini: how much was recorded.
#[tauri::command]
fn habits_stats() -> habits::Stats {
    habits::stats()
}

/// Runs the analysis now and returns what may be proposed.
#[tauri::command]
async fn habits_suggestions(app: AppHandle) -> Vec<habits::Suggestion> {
    tauri::async_runtime::spawn_blocking(move || habits::refresh(&app)).await.unwrap_or_default()
}

/// "create" | "snooze" | "dismiss" | "restore".
#[tauri::command]
fn habit_answer(app: AppHandle, fp: String, choice: String) -> Result<String, String> {
    habits::answer(&app, &fp, &choice)
}

#[tauri::command]
fn habits_clear() {
    habits::clear();
}

/// The island used a quick action (habits: "after plugging in a drive…").
#[tauri::command]
fn habit_note_quick(id: String) {
    habits::note("quick", &id);
}

/// Impostazioni → Flussi → "Prova ora".
#[tauri::command]
fn automation_run_now(app: AppHandle, id: String) -> Result<(), String> {
    automations::run_now(&app, &id)
}

/// «File e schermo» → Cartella di lavoro (workdir.rs): a folder of it.
#[tauri::command]
fn work_list(app: AppHandle, rel: String) -> Result<workdir::Listing, String> {
    workdir::list(&app, &rel)
}

/// Double click: a file opens with its app; "Mostra" selects it in Explorer.
#[tauri::command]
fn work_open(app: AppHandle, rel: String, reveal: bool) -> Result<(), String> {
    let path = workdir::path_of(&app, &rel)?;
    let spawned = if reveal { reveal_in_explorer(&path) } else { Command::new("explorer").arg(&path).spawn() };
    spawned.map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn work_rename(app: AppHandle, rel: String, name: String) -> Result<String, String> {
    workdir::rename(&app, &rel, &name)
}

#[tauri::command]
fn work_mkdir(app: AppHandle, parent: String, name: String) -> Result<String, String> {
    workdir::mkdir(&app, &parent, &name)
}

#[tauri::command]
fn work_move(app: AppHandle, rel: String, dest: String) -> Result<String, String> {
    workdir::move_entry(&app, &rel, &dest)
}

/// To the Recycle Bin (never deleted for good).
#[tauri::command]
async fn work_trash(app: AppHandle, rel: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || workdir::trash(&app, &rel)).await.map_err(|e| e.to_string())?
}

/// A file of the work folder into the Vassoio (a copy).
#[tauri::command]
async fn work_to_inbox(app: AppHandle, rel: String) -> Result<files::DroppedFile, String> {
    tauri::async_runtime::spawn_blocking(move || workdir::to_inbox(&app, &rel)).await.map_err(|e| e.to_string())?
}

/// «Sposta nella cartella di lavoro» on a file of the Vassoio.
#[tauri::command]
async fn inbox_to_work(app: AppHandle, name: String, dest: String, copy: bool) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || workdir::from_inbox(&app, &name, &dest, copy)).await.map_err(|e| e.to_string())?
}

/// Drags a file of the work folder out into another app (as inbox_drag).
#[tauri::command]
async fn work_drag(app: AppHandle, rel: String) -> Result<(), String> {
    let path = workdir::path_of(&app, &rel)?;
    let win = island::window(&app).ok_or(t("Isola non trovata"))?;
    let hwnd = win.hwnd().map_err(|e| e.to_string())?.0 as isize;
    let (tx, rx) = std::sync::mpsc::channel();
    app.run_on_main_thread(move || {
        let hwnd = windows::Win32::Foundation::HWND(hwnd as *mut _);
        let _ = tx.send(files::drag_out(hwnd, &path));
    })
    .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or(Ok(())))
        .await
        .map_err(|e| e.to_string())?
}

/// "Scegli…": Windows' folder dialog; the folder becomes the work folder.
#[tauri::command]
async fn work_pick(app: AppHandle) -> Result<Option<String>, String> {
    let start = workdir::root(&app).map(|p| p.to_string_lossy().to_string());
    let picked = tauri::async_runtime::spawn_blocking(move || workdir::pick_folder(start)).await.map_err(|e| e.to_string())??;
    if let Some(folder) = &picked {
        let folder = folder.clone();
        agent::update_settings(&app, move |s| s.chat_folder = folder)?;
    }
    Ok(picked)
}

/// Drags a file of the tray out of the island into another app. Returns when
/// the drag is over, so the island can ignore its own file meanwhile.
#[tauri::command]
async fn inbox_drag(app: AppHandle, name: String) -> Result<(), String> {
    let path = files::inbox_path(&name)?;
    let win = island::window(&app).ok_or(t("Isola non trovata"))?;
    let hwnd = win.hwnd().map_err(|e| e.to_string())?.0 as isize;
    let (tx, rx) = std::sync::mpsc::channel();
    // Windows' drag loop belongs on the window's thread.
    app.run_on_main_thread(move || {
        let hwnd = windows::Win32::Foundation::HWND(hwnd as *mut _);
        let _ = tx.send(files::drag_out(hwnd, &path));
    })
    .map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || rx.recv().unwrap_or(Ok(())))
        .await
        .map_err(|e| e.to_string())?
}

/// Is the left mouse button held? After a file left the island, the island
/// asks until the drag is over (button released) to close its drop view.
#[tauri::command]
fn mouse_button_down() -> bool {
    island::left_button_down()
}

/// The tray ("Vassoio"): the copies in the inbox, newest first.
#[tauri::command]
fn inbox_list() -> Vec<files::InboxFile> {
    files::list_inbox()
}

#[tauri::command]
fn inbox_delete(name: String) -> Result<(), String> {
    files::delete_from_inbox(&name)
}

#[tauri::command]
fn inbox_clear() -> usize {
    files::clear_inbox()
}

#[tauri::command]
fn inbox_keep(name: String, keep: bool) -> Result<(), String> {
    files::set_kept(&name, keep)
}

/// "Copia" on a picture of the tray: on the clipboard as an image.
#[tauri::command]
async fn inbox_copy(name: String) -> Result<(), String> {
    let path = files::inbox_path(&name)?;
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = std::fs::read(&path).map_err(|e| e.to_string())?;
        clipimage::write(&clipimage::decode_png(&bytes)?)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// "Apri" opens the copy with its app; "Mostra" selects it in Explorer.
#[tauri::command]
fn inbox_open(name: String, reveal: bool) -> Result<(), String> {
    let path = files::inbox_path(&name)?;
    let spawned = if reveal { reveal_in_explorer(&path) } else { Command::new("explorer").arg(&path).spawn() };
    spawned.map(|_| ()).map_err(|e| e.to_string())
}

/// A finished download (moments.rs): "Apri" through Explorer, like a double
/// click there (Windows' own warnings for downloaded programs included);
/// "Mostra nella cartella" selects it.
#[tauri::command]
fn file_open(path: String, reveal: bool) -> Result<(), String> {
    let path = std::path::PathBuf::from(&path);
    if !path.is_file() {
        return Err(t("Il file non c'è più.").into());
    }
    let spawned = if reveal { reveal_in_explorer(&path) } else { Command::new("explorer").arg(&path).spawn() };
    spawned.map(|_| ()).map_err(|e| e.to_string())
}

/// "Estrai…" on a dropped ZIP: what is inside.
#[tauri::command]
async fn zip_list(path: String) -> Result<zip::ZipInfo, String> {
    zip::list(&path).await
}

/// "Estrai…": into a new folder, then opened in Explorer. Returns the folder.
#[tauri::command]
async fn zip_extract(path: String, name: String, place: String, source: Option<String>) -> Result<String, String> {
    zip::extract(&path, &name, &place, source.as_deref()).await
}

/// 3CX: call a number, from the chosen device (or the automatic one).
#[tauri::command]
async fn threecx_call(number: String, device: Option<String>) -> Result<(), String> {
    threecx::call(&number, device.as_deref()).await
}

/// 3CX: "answer" | "hangup" | "decline" on a call of the island.
#[tauri::command]
async fn threecx_action(id: String, action: String) -> Result<(), String> {
    threecx::call_action(&id, &action).await
}

#[tauri::command]
async fn threecx_contacts(query: String) -> Result<Vec<threecx::Contact>, String> {
    threecx::contacts(&query).await
}

#[tauri::command]
async fn threecx_history(missed: bool) -> Result<Vec<threecx::HistoryItem>, String> {
    threecx::history(missed).await
}

#[tauri::command]
async fn threecx_status(profile: String) -> Result<(), String> {
    threecx::set_status(&profile).await
}

#[tauri::command]
async fn threecx_reset_missed() -> Result<(), String> {
    threecx::reset_missed().await
}

/// 3CX: our connected call handed to a colleague or a number.
#[tauri::command]
async fn threecx_transfer(id: String, number: String) -> Result<(), String> {
    threecx::transfer(&id, &number).await
}

/// 3CX: a call ringing for us sent to a number, or to our voicemail ("").
#[tauri::command]
async fn threecx_divert(id: String, number: String) -> Result<(), String> {
    threecx::divert(&id, &number).await
}

/// 3CX, "Questo PC": one step of a WebRTC call (offer, answer, confirm, end);
/// the PBX's id of the call. The audio is in the island page (softphone.ts).
#[tauri::command]
async fn threecx_webrtc(
    id: i64,
    sdp_type: i64,
    transaction: Option<i64>,
    sdp: String,
    destination: String,
    replace: Option<i64>,
) -> Result<i64, String> {
    threecx::webrtc(id, sdp_type, transaction, &sdp, &destination, replace).await
}

/// 3CX, "Questo PC": the user's ringtone as a data URL; None = the built-in one.
#[tauri::command]
fn threecx_ringtone() -> Option<String> {
    threecx::ringtone()
}

/// 3CX: a ringtone picked in Impostazioni, sent as raw bytes with its file name
/// (percent-encoded) in the `x-name` header. An empty body goes back to the built-in one.
#[tauri::command]
fn threecx_set_ringtone(request: tauri::ipc::Request<'_>) -> Result<(), String> {
    let tauri::ipc::InvokeBody::Raw(data) = request.body() else {
        return Err(i18n::t("Suoneria non ricevuta").into());
    };
    if data.is_empty() {
        threecx::clear_ringtone();
        return Ok(());
    }
    let name = request.headers().get("x-name").and_then(|v| v.to_str().ok()).unwrap_or("");
    threecx::set_ringtone(name, data)
}

/// 3CX: a colleague's ringing call answered here.
#[tauri::command]
async fn threecx_pickup(id: String, device: Option<String>) -> Result<(), String> {
    threecx::pickup(&id, device.as_deref()).await
}

#[tauri::command]
async fn threecx_queue(logged_in: bool) -> Result<(), String> {
    threecx::set_queue(logged_in).await
}

#[tauri::command]
async fn threecx_chats() -> Result<Vec<threecx::ChatSummary>, String> {
    threecx::chats().await
}

#[tauri::command]
async fn threecx_messages(conversation: i64, before: Option<i64>) -> Result<Vec<threecx::ChatMessage>, String> {
    threecx::messages(conversation, before).await
}

#[tauri::command]
async fn threecx_chat_with(numbers: Vec<String>) -> Result<threecx::ChatSummary, String> {
    threecx::chat_with(&numbers).await
}

/// 3CX: a chat message, sent only from the island's Invio / send button.
#[tauri::command]
async fn threecx_send(conversation: i64, text: String) -> Result<(), String> {
    threecx::send(conversation, &text).await
}

#[tauri::command]
async fn threecx_read(conversation: i64, ids: Vec<i64>) -> Result<(), String> {
    threecx::read(conversation, &ids).await
}

#[tauri::command]
async fn threecx_typing(conversation: i64) -> Result<(), String> {
    threecx::typing(conversation).await
}

#[tauri::command]
async fn threecx_voicemails() -> Result<Vec<threecx::Voicemail>, String> {
    threecx::voicemails().await
}

/// 3CX: the PBX calls our phone and plays the voicemail.
#[tauri::command]
async fn threecx_play_voicemail(id: i64) -> Result<(), String> {
    threecx::play_voicemail(id).await
}

#[tauri::command]
async fn threecx_voicemail_heard(id: i64) -> Result<(), String> {
    threecx::voicemail_heard(id).await
}

/// Musica: "toggle", "prev" or "next".
#[tauri::command]
fn media_command(command: String) {
    media::command(&command);
}

/// Lets the island write to the same log as the Rust side.
#[tauri::command]
fn log_line(message: String) {
    log::line(format!("ui  {message}"));
}

// ── Settings window ───────────────────────────────────────────────────────────

/// WebView2 allows exactly one browser environment per app, and its options are
/// fixed by whichever webview is created first. Every window must therefore ask
/// for the *same* arguments as the island (see `additionalBrowserArgs` in
/// tauri.conf.json) — a mismatch makes the second window come up blank, with no
/// error anywhere.
pub(crate) const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

/// In a dev build the pages are served by Vite, so the second window needs the
/// absolute dev URL; a bundled build resolves it inside the app bundle.
pub(crate) fn page_url(app: &AppHandle, page: &str) -> WebviewUrl {
    #[cfg(dev)]
    if let Some(mut base) = app.config().build.dev_url.clone() {
        base.set_path(&format!("/{page}"));
        return WebviewUrl::External(base);
    }
    let _ = app;
    WebviewUrl::App(page.into())
}

/// The settings window is created hidden at launch and only ever shown and
/// hidden afterwards. A WebView2 window created later — on the main thread or
/// not — silently comes up blank in this app, so the window that works is the
/// one that exists before the island's webview does.
fn create_settings_window(app: &AppHandle, data_dir: Option<&std::path::Path>) {
    let url = page_url(app, "settings.html");
    let mut builder = WebviewWindowBuilder::new(app, "settings", url);
    if let Some(dir) = data_dir {
        builder = builder.data_directory(dir.to_path_buf());
    }
    match builder
        .additional_browser_args(BROWSER_ARGS)
        .title(i18n::t("Impostazioni — EasyIsland"))
        // A dark title bar, like the page under it.
        .theme(Some(tauri::Theme::Dark))
        .inner_size(980.0, 720.0)
        .min_inner_size(760.0, 520.0)
        .resizable(true)
        .visible(false)
        .center()
        .build()
    {
        Ok(win) => {
            // Closing it must only hide it, or it could never be reopened.
            let hidden = win.clone();
            let handle = app.clone();
            win.on_window_event(move |event| match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    api.prevent_close();
                    island::keep_settings_above(&handle, false);
                    let _ = hidden.hide();
                    // Hidden, its page sleeps (webview_memory.rs).
                    webview_memory::set_asleep(&hidden, true);
                }
                // Above the island while in use (island::keep_settings_above).
                tauri::WindowEvent::Focused(active) => island::keep_settings_above(&handle, *active),
                _ => {}
            });
        }
        Err(err) => log::line(format!("settings window failed: {err}")),
    }
    // Once its page has loaded, the hidden settings window sleeps until it is opened.
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(10));
        if let Some(win) = handle.get_webview_window("settings") {
            if !win.is_visible().unwrap_or(true) {
                webview_memory::set_asleep(&win, true);
            }
        }
    });
}

/// The character's own window (docs/due-webview.md, step 0: a trial). Small,
/// always on top, never activated, taking the whole mouse: no cursor poll. Its
/// page gets what it shows from the island's page over a BroadcastChannel.
pub const CHARACTER_LABEL: &str = "personaggio";
const CHARACTER_SIZE: f64 = 64.0;

/// Created at launch with the other windows (see create_settings_window), for
/// now beside the top centre of the main screen.
fn create_character_window(app: &AppHandle, data_dir: Option<&std::path::Path>) {
    let mut builder = WebviewWindowBuilder::new(app, CHARACTER_LABEL, page_url(app, "personaggio.html"));
    if let Some(dir) = data_dir {
        builder = builder.data_directory(dir.to_path_buf());
    }
    let (x, y) = match app.primary_monitor() {
        Ok(Some(m)) => {
            let scale = m.scale_factor();
            let size = m.size().to_logical::<f64>(scale);
            let pos = m.position().to_logical::<f64>(scale);
            (pos.x + size.width / 2.0 + 180.0, pos.y + 4.0)
        }
        _ => (200.0, 4.0),
    };
    match builder
        .additional_browser_args(BROWSER_ARGS)
        .title("EasyIsland")
        .inner_size(CHARACTER_SIZE, CHARACTER_SIZE)
        .position(x, y)
        .resizable(false)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .focused(false)
        .maximizable(false)
        .minimizable(false)
        .closable(false)
        .drag_and_drop(false)
        .visible(false)
        .build()
    {
        Ok(win) => {
            island::make_non_activating(&win.as_ref().window());
            // Always "compact": the low memory target of WebView2 (webview_memory.rs).
            webview_memory::set_low(win.as_ref(), true);
            let _ = win.show();
        }
        Err(err) => log::line(format!("character window failed: {err}")),
    }
}

/// Step 0 trial: hides or shows the island's window, to see that its page goes
/// on working while hidden and that showing it again has no white flash.
#[tauri::command]
fn island_window_toggle(app: AppHandle) {
    let Some(win) = island::window(&app) else { return };
    let shown = win.is_visible().unwrap_or(true);
    let _ = if shown { win.hide() } else { win.show() };
    log::line(format!("prova due webview: isola {}", if shown { "nascosta" } else { "mostrata" }));
}

pub const MEMORY_LABEL: &str = "memoria";
pub const FLOWS_LABEL: &str = "flussi";

/// The WebView2 profile folder the windows share (webview_profile.rs), for the
/// windows made later, on demand.
static WEBVIEW_DIR: std::sync::OnceLock<Option<std::path::PathBuf>> = std::sync::OnceLock::new();

/// That folder, for the webviews made later (preview.rs).
pub(crate) fn webview_dir() -> Option<std::path::PathBuf> {
    WEBVIEW_DIR.get().cloned().flatten()
}

// «Anteprima» (preview.rs, src/preview/): the page's commands. Async on purpose:
// a sync command runs on the main thread, and making the window or a webview
// there waits for that same thread (the whole app froze, 26 Oct 2026).

#[tauri::command]
async fn preview_open(app: AppHandle, target: String, new_tab: Option<bool>) -> Result<u32, String> {
    let place = if new_tab.unwrap_or(false) { preview::Place::NewTab } else { preview::Place::Reuse };
    preview::open(&app, &target, place, true)
}

#[tauri::command]
async fn preview_show(app: AppHandle) -> Result<(), String> {
    preview::show(&app, true)
}

#[tauri::command]
fn preview_state(app: AppHandle) -> preview::Snapshot {
    preview::snapshot(&app)
}

/// Where the island draws the Anteprima's panel (island.ts); 0 wide = hidden.
#[tauri::command]
async fn preview_pane(app: AppHandle, x: f64, y: f64, w: f64, h: f64) {
    preview::pane(&app, x, y, w, h);
}

#[tauri::command]
async fn preview_hide(app: AppHandle) {
    preview::close_window(&app);
}

#[tauri::command]
async fn preview_select(app: AppHandle, id: u32) {
    preview::select(&app, id);
}

#[tauri::command]
async fn preview_close(app: AppHandle, id: u32) {
    preview::close_tab(&app, id);
}

#[tauri::command]
async fn preview_layout(app: AppHandle, x: f64, y: f64, w: f64, h: f64, covered: bool) {
    preview::layout(&app, x, y, w, h, covered);
}

#[tauri::command]
async fn preview_nav(app: AppHandle, id: u32, action: String) -> Result<(), String> {
    preview::nav(&app, id, &action)
}

#[tauri::command]
async fn preview_view(app: AppHandle, preset: String, width: Option<u32>, height: Option<u32>, scheme: String, zoom: Option<String>) {
    preview::set_view(&app, &preset, width.unwrap_or(0), height.unwrap_or(0), &scheme, zoom.as_deref().unwrap_or(""));
}

#[tauri::command]
async fn preview_file(path: String) -> preview::FileView {
    tauri::async_runtime::spawn_blocking(move || preview::read_file(&path)).await.unwrap_or_default()
}

#[tauri::command]
fn preview_console(id: u32) -> Vec<preview::ConsoleLine> {
    preview::console(id)
}

#[tauri::command]
async fn preview_console_clear(app: AppHandle, id: u32) {
    preview::clear_console(&app, id);
}

#[tauri::command]
async fn preview_devtools(app: AppHandle, id: u32) -> Result<(), String> {
    preview::devtools(&app, id)
}

#[tauri::command]
async fn preview_servers() -> Vec<preview::Server> {
    tauri::async_runtime::spawn_blocking(preview::servers).await.unwrap_or_default()
}

/// «Apri fuori»: an address in the default browser, a file in its program.
#[tauri::command]
fn preview_external(path_or_url: String, reveal: bool) -> Result<(), String> {
    if path_or_url.starts_with("http://") || path_or_url.starts_with("https://") {
        open_url_now(&path_or_url);
        return Ok(());
    }
    let p = std::path::PathBuf::from(&path_or_url);
    if reveal {
        reveal_in_explorer(&p).map(|_| ()).map_err(|e| e.to_string())
    } else {
        actions::shell_open(&path_or_url).map_err(|_| i18n::tf("Non riesco ad aprire «{p}».", &[("p", &path_or_url)]))
    }
}

/// The flows window (src/flows/, docs/flussi.md): made the first time it is
/// opened, then hidden on close like the others. `id` = the flow to show.
#[tauri::command]
async fn open_flows_window(app: AppHandle, id: Option<String>) -> Result<(), String> {
    let id = id.unwrap_or_default();
    if let Some(win) = app.get_webview_window(FLOWS_LABEL) {
        webview_memory::set_asleep(&win, false);
        // In front of Impostazioni, which is topmost while focused.
        island::keep_settings_above(&app, false);
        let _ = win.unminimize();
        let _ = win.show();
        let _ = win.set_focus();
        let _ = win.emit("flows-open", id);
        return Ok(());
    }
    // The page asks for it once loaded (flow_pending): a query in the URL does
    // not survive the app:// scheme of the release build.
    *PENDING_FLOW.lock().unwrap() = id;
    let url = page_url(&app, "flussi.html");
    island::keep_settings_above(&app, false);
    let mut builder = WebviewWindowBuilder::new(&app, FLOWS_LABEL, url);
    if let Some(Some(dir)) = WEBVIEW_DIR.get() {
        builder = builder.data_directory(dir.clone());
    }
    let win = builder
        .additional_browser_args(BROWSER_ARGS)
        .title(i18n::t("Flussi — EasyIsland"))
        // Blocks are dragged inside the page: Tauri must not take the drag.
        .disable_drag_drop_handler()
        .theme(Some(tauri::Theme::Dark))
        .inner_size(1240.0, 800.0)
        .min_inner_size(900.0, 560.0)
        .resizable(true)
        .center()
        .build()
        .map_err(|e| e.to_string())?;
    let hidden = win.clone();
    win.on_window_event(move |event| {
        if let tauri::WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            let _ = hidden.hide();
            webview_memory::set_asleep(&hidden, true);
        }
    });
    Ok(())
}

static PENDING_FLOW: std::sync::Mutex<String> = std::sync::Mutex::new(String::new());

/// The flow the window was opened for, once.
#[tauri::command]
fn flow_pending() -> String {
    std::mem::take(&mut *PENDING_FLOW.lock().unwrap())
}

/// The flows window saves one flow at a time (never the whole settings, so it
/// cannot undo what another window changed). Returns what is still missing for
/// it to run, "" when it is complete.
#[tauri::command]
fn flow_save(app: AppHandle, flow: serde_json::Value) -> Result<String, String> {
    let auto: automations::Automation = serde_json::from_value(flow).map_err(|e| e.to_string())?;
    if auto.id.trim().is_empty() || auto.id.len() > 40 {
        return Err(i18n::t("Flusso senza id.").into());
    }
    let value = serde_json::to_value(&auto).map_err(|e| e.to_string())?;
    let missing = {
        let shared = app.state::<Shared>();
        let s = shared.settings.lock().unwrap();
        automations::validate(&value, &s).err().unwrap_or_default()
    };
    agent::update_settings(&app, |s| {
        match s.automations.iter_mut().find(|a| a.get("id").and_then(serde_json::Value::as_str) == Some(auto.id.as_str())) {
            Some(slot) => *slot = value.clone(),
            None => s.automations.push(value.clone()),
        }
    })?;
    Ok(missing)
}

#[tauri::command]
fn flow_delete(app: AppHandle, id: String) -> Result<(), String> {
    agent::update_settings(&app, |s| s.automations.retain(|a| a.get("id").and_then(serde_json::Value::as_str) != Some(id.as_str())))
}

/// "Descrivilo a parole": the request goes to the island's chat, which builds
/// the flow with create_automation (preview, Consenti / Nega).
#[tauri::command]
fn flow_ask_chat(app: AppHandle, text: String) {
    let text: String = text.trim().chars().take(2000).collect();
    if text.is_empty() {
        return;
    }
    let prompt = i18n::tf("Crea un flusso di EasyIsland (create_automation) per questo: {text}", &[("text", &text)]);
    let _ = app.emit_to(island::WINDOW_LABEL, "automation-ask", prompt);
}

/// The memory window (src/memory/), made hidden at launch for the same reason
/// as the settings one, asleep until it is opened; closing it hides it.
fn create_memory_window(app: &AppHandle, data_dir: Option<&std::path::Path>) {
    let mut builder = WebviewWindowBuilder::new(app, MEMORY_LABEL, page_url(app, "memoria.html"));
    if let Some(dir) = data_dir {
        builder = builder.data_directory(dir.to_path_buf());
    }
    match builder
        .additional_browser_args(BROWSER_ARGS)
        .title(i18n::t("Memoria — EasyIsland"))
        // Dropped files reach the page (src/memory/main.ts), not Tauri.
        .disable_drag_drop_handler()
        .theme(Some(tauri::Theme::Dark))
        .inner_size(1180.0, 760.0)
        .min_inner_size(720.0, 480.0)
        .resizable(true)
        .visible(false)
        .center()
        .build()
    {
        Ok(win) => {
            let hidden = win.clone();
            win.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = hidden.hide();
                    webview_memory::set_asleep(&hidden, true);
                }
            });
        }
        Err(err) => log::line(format!("memory window failed: {err}")),
    }
    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(10));
        if let Some(win) = handle.get_webview_window(MEMORY_LABEL) {
            if !win.is_visible().unwrap_or(true) {
                webview_memory::set_asleep(&win, true);
            }
        }
    });
}

pub fn show_memory_window(app: &AppHandle) {
    let Some(win) = app.get_webview_window(MEMORY_LABEL) else {
        log::line("memory window missing");
        return;
    };
    webview_memory::set_asleep(&win, false);
    // Opened from Impostazioni: that window is topmost while it has the focus
    // (island::keep_settings_above) and would stay in front of this one.
    island::keep_settings_above(app, false);
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
    let _ = win.emit("memory-refresh", ());
}

pub fn show_settings_window(app: &AppHandle) {
    let Some(win) = app.get_webview_window("settings") else {
        log::line("settings window missing");
        return;
    };
    webview_memory::set_asleep(&win, false);
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
}

/// Windows' accent colour for the "windows" style: the shade Windows itself uses
/// on dark backgrounds (AccentPalette's light 2), else the DWM accent; `None`
/// when neither can be read (the page keeps its own blue).
#[tauri::command]
fn system_accent() -> Option<String> {
    use probes::reg::{Key, HKEY_CURRENT_USER};
    let hex = |r: u8, g: u8, b: u8| format!("#{r:02x}{g:02x}{b:02x}");
    if let Some(p) = Key::open(HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Explorer\Accent")
        .and_then(|k| k.binary("AccentPalette"))
    {
        // Eight RGBA entries: light 3, light 2, light 1, base, dark 1…
        if let Some(&[r, g, b]) = p.get(4..7) {
            return Some(hex(r, g, b));
        }
    }
    let v = Key::open(HKEY_CURRENT_USER, r"Software\Microsoft\Windows\DWM")?.qword("AccentColor")? as u32;
    // 0xAABBGGRR.
    Some(hex(v as u8, (v >> 8) as u8, (v >> 16) as u8))
}

/// Windows' app mode for «Modalità: automatica» (Impostazioni → Aspetto): true when
/// apps are set to light. Read from the registry because the settings window is
/// created dark, so its prefers-color-scheme always says dark.
#[tauri::command]
fn system_light() -> bool {
    use probes::reg::{Key, HKEY_CURRENT_USER};
    Key::open(HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize")
        .and_then(|k| k.qword("AppsUseLightTheme"))
        .is_some_and(|v| v != 0)
}

/// The calling window's title bar, light or dark, with the page's scheme.
#[tauri::command]
fn set_window_light(window: tauri::WebviewWindow, light: bool) {
    let _ = window.set_theme(Some(if light { tauri::Theme::Light } else { tauri::Theme::Dark }));
}

/// Impostazioni → Flussi and the island: every task (tasks.rs).
#[tauri::command]
fn tasks_list() -> Vec<tasks::Task> {
    tasks::list()
}

/// A new task from the settings or the chat's «/compito».
#[tauri::command]
fn task_new(app: AppHandle, title: String, goal: String, when: Option<String>, engine: Option<String>, model: Option<String>, helpers: Option<Vec<String>>) -> Result<tasks::Task, String> {
    let task = tasks::create(&app, &title, &goal, when.as_deref().unwrap_or_default(), engine.as_deref().unwrap_or_default())?;
    if model.is_some() || helpers.is_some() {
        tasks::set_engines(&app, &task.id, &task.engine, model.as_deref().unwrap_or_default(), &helpers.unwrap_or_default())?;
    }
    Ok(tasks::get(&task.id).unwrap_or(task))
}

/// Avvia, Pausa, Riprendi, Ferma, Elimina.
#[tauri::command]
fn task_control(app: AppHandle, id: String, action: String) -> Result<(), String> {
    tasks::control(&app, &id, &action)
}

/// The answer to a task's question, given later than its card.
#[tauri::command]
fn task_answer(app: AppHandle, id: String, text: String) -> Result<(), String> {
    tasks::answer(&app, &id, &text)
}

/// Integrazioni personali (custom.rs): every description.
#[tauri::command]
fn customs_list() -> Vec<custom::Custom> {
    custom::list()
}

/// Impostazioni: a description changed by hand (its JSON) or switched on/off.
#[tauri::command]
fn custom_save(app: AppHandle, definition: custom::Custom) -> Result<custom::Custom, String> {
    custom::save(&app, definition, false)
}

#[tauri::command]
fn custom_delete(app: AppHandle, id: String) -> Result<(), String> {
    custom::delete(&app, &id)
}

#[tauri::command]
fn custom_records(id: String) -> Vec<custom::Record> {
    custom::records(&id)
}

#[tauri::command]
fn custom_record_save(app: AppHandle, id: String, record: String, values: serde_json::Map<String, serde_json::Value>) -> Result<custom::Record, String> {
    custom::save_record(&app, &id, &record, values)
}

#[tauri::command]
fn custom_record_delete(app: AppHandle, id: String, record: String) -> Result<(), String> {
    custom::delete_record(&app, &id, &record)
}

/// A record's document (filled by the island) into the Vassoio.
#[tauri::command]
async fn custom_document(name: String, ext: String, text: String) -> Result<files::DroppedFile, String> {
    tauri::async_runtime::spawn_blocking(move || custom::document(&name, &ext, &text)).await.map_err(|e| e.to_string())?
}

/// An integration's "http" action: its call, {{campi}} filled by the island, keys put in here.
#[tauri::command]
async fn custom_http(id: String, method: String, url: String, headers: serde_json::Map<String, serde_json::Value>, body: String) -> Result<custom::Reply, String> {
    custom::http(&id, &method, &url, &headers, &body).await
}

/// A source read now ("Aggiorna" in the card).
#[tauri::command]
async fn custom_fetch(id: String, source: String) -> Result<custom::Reply, String> {
    custom::fetch(&id, &source).await
}

/// «Compila con l'IA»: the fields read from a pasted text.
#[tauri::command]
async fn custom_fill(app: AppHandle, id: String, text: String) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    custom::fill(&app, &id, &text).await
}

/// "Copia" of a record: its document as text on the clipboard.
#[tauri::command]
async fn custom_copy(text: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || actions::set_clipboard_text(&text)).await.map_err(|e| e.to_string())?.map(|_| ())
}

/// "Aggiungi a Notion": the record as a row, its fields' labels as the properties.
#[tauri::command]
async fn custom_to_notion(database: String, properties: serde_json::Value) -> Result<String, String> {
    notion_tools::add_row(&database, &properties).await
}

/// Abilità (skills.rs): the list, for Impostazioni and the chat's «/commands».
#[tauri::command]
fn skills_list() -> Vec<skills::Skill> {
    skills::list()
}

/// Saves a skill from Impostazioni; `old` = the id it had.
#[tauri::command]
fn skill_save(name: String, description: String, engine: String, tools: Vec<String>, body: String, old: String) -> Result<skills::Skill, String> {
    skills::save(&skills::Skill { id: String::new(), name, description, engine, tools, body }, &old)
}

#[tauri::command]
fn skill_delete(id: String) -> Result<(), String> {
    skills::delete(&id)
}

/// The skills' folder in Explorer.
#[tauri::command]
fn skills_open() -> Result<(), String> {
    std::fs::create_dir_all(skills::dir()).map_err(|e| e.to_string())?;
    Command::new("explorer").arg(skills::dir()).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// What a skill's «/command» sends to the chat.
#[tauri::command]
fn skill_prompt(id: String, arg: String) -> Result<String, String> {
    skills::find(&id).map(|s| skills::as_prompt(&s, &arg)).ok_or_else(|| t("Abilità non trovata.").into())
}

/// The engines and whether each can answer now (Impostazioni → Flussi).
#[tauri::command]
fn engines_ready(app: AppHandle) -> Vec<(String, String, bool)> {
    telegram::engines(&app).into_iter().map(|(id, name, ok)| (id.to_string(), name, ok)).collect()
}

/// Engine, model and helpers of a task that is not running.
#[tauri::command]
fn task_set_engines(app: AppHandle, id: String, engine: String, model: String, helpers: Vec<String>) -> Result<(), String> {
    tasks::set_engines(&app, &id, &engine, &model, &helpers)
}

/// Impostazioni → Flussi → Battito: every `minutes` (0 = off).
#[tauri::command]
fn heartbeat_set(app: AppHandle, minutes: u32) -> Result<(), String> {
    tasks::set_heartbeat(&app, minutes).map(|_| ())
}

/// Impostazioni → Chat → Memoria: the evening digest (tasks.rs).
#[tauri::command]
fn digest_set(app: AppHandle, on: bool) -> Result<(), String> {
    tasks::set_digest(&app, on)
}

/// BATTITO.md in its editor (made the first time).
#[tauri::command]
fn heartbeat_open() -> Result<(), String> {
    let path = tasks::ensure_heartbeat_file()?;
    Command::new("explorer").arg(&path).spawn().map(|_| ()).map_err(|e| e.to_string())
}

/// The task's log (its .md).
#[tauri::command]
fn task_log(id: String) -> String {
    tasks::log_text(&id)
}

/// The island compact (low) or open (normal): WebView2's memory target (webview_memory.rs).
#[tauri::command]
fn webview_memory_low(app: AppHandle, low: bool) {
    if let Some(page) = island::page(&app) {
        webview_memory::set_low(&page, low);
    }
}

#[tauri::command]
fn open_settings_window(app: AppHandle) {
    show_settings_window(&app);
}

/// The island's context menu: the settings on one page, with one entry open
/// ("integrazioni" + "integration_zammad"). The settings page takes it from the event.
#[tauri::command]
fn open_settings_at(app: AppHandle, page: String, item: Option<String>) {
    show_settings_window(&app);
    let _ = app.emit_to(SETTINGS_LABEL, "settings-goto", serde_json::json!({ "page": page, "item": item.unwrap_or_default() }));
}

pub fn run() {
    jumplist::set_app_id();
    // The release build aborts on a panic (panic = "abort"): without this the
    // reason is lost and Windows only reports 0xc0000409.
    let default_hook = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::line(format!("panic: {info}"));
        default_hook(info);
    }));
    // An update or a crash can leave the old WebView2 holding the profile:
    // then this run uses a spare one (see webview_profile.rs).
    let webview_dir = webview_profile::free();
    // First launch after the rename: bring Coucou's settings and keys over.
    let moved = legacy::migrate();
    let mut loaded = settings::load();
    i18n::set(&loaded.language);
    // Zammad's address and token, when a widget became the integration (schema 5).
    settings::apply_pending_secrets(&mut loaded);
    let gate = Arc::new(PollGate::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // `easyisland.exe --settings` opens the settings window (a shortcut can use it).
            if argv.iter().any(|a| a == "--settings") {
                show_settings_window(app);
            } else if let Some(what) = jumplist::requested(&argv).filter(|w| w != "open") {
                // An entry of the taskbar menu (jumplist.rs): handled like its hotkey.
                if let Some(win) = island::window(app) {
                    let _ = win.unminimize();
                }
                let _ = app.emit_to(island::WINDOW_LABEL, "hotkey", what);
            } else {
                // Minimized as an app: back on screen first.
                if let Some(win) = island::window(app) {
                    let _ = win.unminimize();
                }
                let _ = app.emit_to(island::WINDOW_LABEL, "tray", "open".to_string());
            }
        }))
        .plugin(tauri_plugin_autostart::init(MacosLauncher::LaunchAgent, None))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(Shared {
            settings: Mutex::new(loaded.clone()),
            gate: gate.clone(),
        })
        .manage(Pending::default())
        .manage(Chat::default())
        .invoke_handler(tauri::generate_handler![
            boot,
            save_settings,
            system_accent,
            system_light,
            set_window_light,
            tasks_list,
            task_new,
            task_control,
            task_answer,
            task_log,
            task_set_engines,
            heartbeat_set,
            heartbeat_open,
            digest_set,
            skills_list,
            customs_list,
            custom_save,
            custom_delete,
            custom_records,
            custom_record_save,
            custom_record_delete,
            custom_document,
            custom_copy,
            custom_fill,
            custom_http,
            custom_fetch,
            custom_to_notion,
            skill_save,
            skill_delete,
            skills_open,
            skill_prompt,
            engines_ready,
            set_collapsed,
            drag_island,
            copy_pc_info,
            netconfig::network_adapters,
            netconfig::network_apply,
            netconfig::network_ping,
            presence_state,
            notify_test,
            end_drag,
            set_expanded,
            set_island_rect,
            focus_window,
            show_island_menu,
            is_folder,
            reposition,
            set_panel_size,
            panel_limits,
            open_url,
            open_in_vscode,
            session_reply::session_reply,
            set_app_mode,
            minimize_island,
            file_thumb,
            collect_load,
            memory_link,
            collect_save,
            collect_source,
            program_icon,
            site_icon,
            logo_save,
            logo_load,
            logo_clear,
            flash_if_behind,
            claude_cli::session_ask,
            open_file_in_vscode,
            chat_models,
            open_session,
            update_check,
            update_install,
            quit_app,
            hooks_status,
            hooks_preview,
            hooks_apply,
            approval_decision,
            approval_answers,
            approval_ack,
            approval_decline,
            log_line,
            chat_send,
            chat_stop,
            notion_map_status,
            recipes_count,
            recipes_forget,
            notion_map_sync,
            chat_reset,
            chat_history_list,
            chat_history_open,
            chat_history_delete,
            chat_history_clear,
            claude_cli_status,
            mcp_servers_configured,
            switch_profile,
            settings_export,
            settings_import,
            current_network,
            action_open_app,
            action_run_script,
            action_kill,
            clipboard_text,
            hotkey_failures,
            hotkeys_suspend,
            widget_test,
            widget_refresh,
            widget_results,
            ingest_file,
            chat_paste,
            webview_memory_low,
            chat_fork,
            chat_persona,
            chat_transcribe,
            chat_dictate_windows,
            chat_dictation,
            chat_day_prompt,
            memory_info,
            memory_note,
            memory_open,
            memory_graph,
            memory_job,
            memory_node_open,
            memory_window_open,
            memory_inbox_add,
            memory_note_add,
            chat_history_search,
            chat_history_pin,
            chat_history_rename,
            chat_rewind,
            chat_export,
            capture_begin,
            capture_frame,
            capture_show,
            capture_end,
            capture_save,
            capture_copy,
            capture_text,
            window_pick,
            carry_frame,
            window_under_cursor,
            window_drop,
            secret_present,
            secret_set,
            secret_clear,
            refresh_integration,
            clipboard_use,
            clipboard_pin,
            clipboard_ask,
            clipboard_picture,
            clipboard_remove,
            clipboard_clear,
            media_command,
            threecx_call,
            threecx_action,
            threecx_contacts,
            threecx_history,
            threecx_status,
            threecx_reset_missed,
            threecx_transfer,
            threecx_divert,
            threecx_pickup,
            threecx_webrtc,
            threecx_ringtone,
            threecx_set_ringtone,
            threecx_queue,
            threecx_chats,
            threecx_messages,
            threecx_chat_with,
            threecx_send,
            threecx_read,
            threecx_typing,
            threecx_voicemails,
            threecx_play_voicemail,
            threecx_voicemail_heard,
            zip_list,
            automations_log,
            flows_runs,
            flow_run,
            flow_rerun,
            flow_try_from,
            open_flows_window,
            preview_open,
            preview_show,
            preview_hide,
            preview_pane,
            preview_state,
            preview_select,
            preview_close,
            preview_layout,
            preview_nav,
            preview_view,
            preview_file,
            preview_console,
            preview_console_clear,
            preview_devtools,
            preview_servers,
            preview_external,
            flow_save,
            flow_delete,
            flow_ask_chat,
            flow_pending,
            habits_stats,
            habits_suggestions,
            habit_answer,
            habits_clear,
            habit_note_quick,
            automation_run_now,
            inbox_list,
            inbox_delete,
            inbox_clear,
            inbox_keep,
            start_apps,
            recap::recap_history,
            recap::recap_mark_shown,
            recap::recap_clear,
            recap::recap_mark_day,
            daily::daily_digest,
            file_open,
            moments::moment_card_answer,
            mcp_setup::mcp_claude_status,
            mcp_setup::mcp_claude_apply,
            chat_second,
            mcp_setup::mcp_agy_status,
            mcp_setup::mcp_agy_apply,
            recap_show,
            daily_show,
            restart_app,
            inbox_open,
            inbox_copy,
            notion_search,
            notion_page_text,
            voice_models,
            antigravity_status,
            notion_page::notion_open_page,
            notion_page::notion_open_database,
            notion_page::notion_block_text,
            notion_page::notion_block_check,
            notion_page::notion_block_add,
            notion_page::notion_block_retype,
            notion_page::notion_block_delete,
            notion_page::notion_page_title,
            notion_page::notion_row_set,
            notion_page::notion_row_add,
            notion_page::notion_page_delete,
            notion_page::notion_image,
            notion_task_done,
            notion_properties,
            notion_add_task,
            notion_postpone,
            notion_suggest,
            rdm_search,
            rdm_by_host,
            rdm_open,
            rdm_edit,
            rdm_filter,
            rdm_quick,
            rdm_status,
            rdm_data_sources,
            notion_add_note,
            notion_forget_schemas,
            inbox_drag,
            mouse_button_down,
            zip_extract,
            foreground_app,
            capture_selection,
            rewrite_text,
            replace_selection,
            copy_rewrite,
            selection_menu,
            process_alive,
            open_n8n,
            open_zammad,
            open_integration,
            open_settings_window,
            open_settings_at,
            action_send_keys,
            teams_action,
            record_start,
            remote_connect,
            remote_disconnect,
            remote_link,
            record_stop,
            record_windows,
            window_pick_drop,
            window_shot,
            ms_status,
            ms_login,
            ms_logout,
            ms_teams_snapshot,
            teams_join_clipboard,
            teams_join,
            capture_window_text,
            set_paused,
            telegram_info,
            telegram_link_code,
            telegram_unlink,
            telegram_restart,
            work_list,
            work_open,
            work_rename,
            work_mkdir,
            work_move,
            work_trash,
            work_to_inbox,
            inbox_to_work,
            work_drag,
            work_pick,
            island_window_toggle,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            tray::build(&handle)?;
            // The island's window is in tauri.conf.json with "create": false:
            // built here so it can take the spare WebView2 profile.
            if let Some(cfg) = app.config().app.windows.iter().find(|w| w.label == island::WINDOW_LABEL).cloned() {
                let mut builder = WebviewWindowBuilder::from_config(&handle, &cfg)?;
                if let Some(dir) = &webview_dir {
                    builder = builder.data_directory(dir.clone());
                }
                builder.build()?;
            }
            // Before the island's webview is ready: see create_settings_window.
            create_settings_window(&handle, webview_dir.as_deref());
            create_character_window(&handle, webview_dir.as_deref());
            create_memory_window(&handle, webview_dir.as_deref());
            let _ = WEBVIEW_DIR.set(webview_dir.clone());
            preview::init(&handle);

            if let Some(win) = island::window(&handle) {
                // "Chiudi finestra" from the taskbar (the island as an app) must not
                // destroy it: EasyIsland would go on running with nothing to show.
                // It closes the island instead, like its own ✕.
                let closing = handle.clone();
                win.on_window_event(move |event| {
                    if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = closing.emit_to(island::WINDOW_LABEL, "tray", "close");
                    }
                });
                island::make_non_activating(&win);
                island::apply_geometry(&handle, &gate, &loaded, false);
                let _ = win.show();
            }
            island::apply_taskbar(&handle);
            jumplist::update(&loaded);
            gate.collapsed.store(false, Ordering::Relaxed);
            gate.set_active(true);
            island::spawn_cursor_poll(handle.clone(), gate.clone());
            island::spawn_fullscreen_watch(handle.clone(), gate.clone());
            island::spawn_drag_raise(handle.clone(), gate.clone());
            // The tray is temporary: every start begins with only the pinned files.
            std::thread::spawn(files::clear_inbox);
            profiles::spawn_auto_switch(handle.clone());
            hotkeys::spawn(handle.clone());
            clipboard::spawn(handle.clone());
            downloads::spawn(handle.clone());
            devservers::spawn(handle.clone());
            context::spawn(handle.clone());
            media::spawn(handle.clone());
            threecx::spawn(handle.clone());
            teams::spawn(handle.clone());
            telegram::spawn(handle.clone());
            tasks::init(&handle);
            custom::spawn(handle.clone());
            msgraph::spawn(handle.clone());
            automations::spawn(handle.clone());
            habits::spawn(handle.clone());
            opencode_agent::spawn(handle.clone());
            widgets::start(handle.clone());

            log::line(format!("--- EasyIsland {} started ---", env!("CARGO_PKG_VERSION")));
            hooks::ensure_hook_exe(&handle);
            // Coucou's autostart entry starts Coucou, not this app.
            if moved && loaded.autostart {
                if let Err(err) = handle.autolaunch().enable() {
                    log::line(format!("autostart: {err}"));
                }
            }
            pipe::start(handle.clone());
            drop::install(&handle);
            threecx::allow_microphone(&handle);
            presence::spawn(handle.clone());
            integrations::start(handle.clone());
            updates::spawn(handle.clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while running EasyIsland")
        .run(|_, event| {
            // The chat's private opencode server goes with the app.
            if let tauri::RunEvent::Exit = event {
                tasks::on_exit();
                opencode::shutdown();
                claude_cli::shutdown();
                remote::shutdown();
            }
        });
}
