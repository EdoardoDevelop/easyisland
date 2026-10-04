// EasyIsland for Windows — app wiring and the commands the island calls.

mod actions;
mod agent;
mod automations;
mod apps;
mod calendar;
mod claude;
mod claude_cli;
mod clipboard;
mod clipimage;
mod context;
mod drop;
mod files;
mod habits;
mod hooks;
mod hotkeys;
mod integrations;
mod island;
mod legacy;
mod log;
mod media;
mod outlook;
mod pipe;
mod presence;
mod probes;
mod profiles;
mod screenshot;
mod secrets;
mod settings;
mod threecx;
mod tray;
mod updates;
mod widgets;
mod zip;
mod win_user;
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
    let mut settings = shared.settings.lock().unwrap().clone();
    // The real state of ~/.claude/settings.json wins over whatever we stored.
    settings.hooks_installed = hooks::status().installed;
    let screen = island::screen_info(&app, &settings.screen);
    BootInfo {
        settings,
        screen,
        version: env!("CARGO_PKG_VERSION").to_string(),
        hook_path: settings::hook_exe_path().to_string_lossy().to_string(),
    }
}

#[tauri::command]
fn save_settings(app: AppHandle, shared: State<Shared>, settings: Settings) {
    // Whatever was edited belongs to the active profile.
    let mut settings = settings.migrated();
    settings.commit_active();
    let (screen_changed, autostart_changed) = {
        let mut current = shared.settings.lock().unwrap();
        let screen_changed = current.screen != settings.screen
            || current.anchor_h != settings.anchor_h
            || current.anchor_v != settings.anchor_v
            || current.offset_x != settings.offset_x
            || current.offset_y != settings.offset_y
            || current.over_taskbar != settings.over_taskbar;
        let autostart_changed = current.autostart != settings.autostart;
        *current = settings.clone();
        (screen_changed, autostart_changed)
    };
    if let Err(err) = settings::save(&settings) {
        eprintln!("[easyisland] could not save settings: {err}");
    }
    habits::apply(&settings);
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
    island::apply_geometry(app, &shared.gate, &settings, collapsed);
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
    let text = shared.settings.lock().unwrap().export_json();
    let home = std::env::var_os("USERPROFILE").map(std::path::PathBuf::from);
    let dir = home
        .as_ref()
        .map(|h| h.join("Documents"))
        .filter(|d| d.is_dir())
        .or(home)
        .ok_or_else(|| "Cartella Documenti non trovata.".to_string())?;
    let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
    let path = dir.join(format!(
        "EasyIsland-impostazioni-{:04}{:02}{:02}-{:02}{:02}.json",
        t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute
    ));
    std::fs::write(&path, text).map_err(|e| format!("Esportazione non riuscita: {e}"))?;
    let _ = Command::new("explorer")
        .arg(format!("/select,{}", path.display()))
        .spawn();
    Ok(path.display().to_string())
}

/// Replaces the settings with an exported file (keys must be entered again).
#[tauri::command]
fn settings_import(app: AppHandle, shared: State<Shared>, text: String) -> Result<Settings, String> {
    let next = shared.settings.lock().unwrap().import_json(&text)?;
    *shared.settings.lock().unwrap() = next.clone();
    settings::save(&next).map_err(|e| format!("Salvataggio non riuscito: {e}"))?;
    log::line("settings imported".to_string());
    let collapsed = shared.gate.collapsed.load(Ordering::Relaxed);
    island::apply_geometry(&app, &shared.gate, &next, collapsed);
    crate::threecx::settings_saved(&next);
    let _ = app.emit("settings-changed", next.clone());
    tray::refresh(&app);
    hotkeys::reload();
    Ok(next)
}

// ── Quick actions ─────────────────────────────────────────────────────────────

#[tauri::command]
fn action_open_app(target: String, args: String) -> Result<(), String> {
    actions::open_app(&target, &args)
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

/// Island → "Aggiorna" on a widget card.
#[tauri::command]
async fn widget_refresh(app: AppHandle, shared: State<'_, Shared>, id: String) -> Result<(), String> {
    // A widget, or one of the integrations that run as checks (integration_system…).
    let widget = widgets::all_widgets(&shared.settings.lock().unwrap())
        .into_iter()
        .find(|w| w.id == id)
        .ok_or_else(|| "Widget non trovato".to_string())?;
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
    let settings = shared.settings.lock().unwrap().clone();
    shared.gate.collapsed.store(collapsed, Ordering::Relaxed);
    island::apply_geometry(&app, &shared.gate, &settings, collapsed);
    // Hidden behind a full-screen app while resting; always back for anything else.
    if let Some(win) = island::window(&app) {
        let quiet = collapsed && shared.gate.fullscreen.load(Ordering::Relaxed);
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

/// "Copia info PC": everything a ticket asks for, put on the clipboard.
#[tauri::command]
async fn copy_pc_info() -> Result<String, String> {
    let text = probes::pc_info_text().await.map_err(|e| format!("Informazioni non leggibili: {e}"))?;
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
            "title": "Prova",
            "text": "Così compare un messaggio mandato da uno script.",
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

/// Moves the island window by `dx`, `dy` logical px while the character is dragged.
#[tauri::command]
fn drag_island(app: AppHandle, shared: State<Shared>, dx: f64, dy: f64) {
    shared.gate.dragging.store(true, Ordering::Relaxed);
    let Some(win) = island::window(&app) else { return };
    let Ok(pos) = win.outer_position() else { return };
    let scale = win.scale_factor().unwrap_or(1.0);
    let _ = win.set_position(tauri::PhysicalPosition::new(
        pos.x + (dx * scale).round() as i32,
        pos.y + (dy * scale).round() as i32,
    ));
}

/// The drag is over: remember where the character was left, in the active profile.
#[tauri::command]
fn end_drag(app: AppHandle, shared: State<Shared>) {
    shared.gate.dragging.store(false, Ordering::Relaxed);
    let Some(win) = island::window(&app) else { return };
    let (Ok(pos), Ok(size)) = (win.outer_position(), win.outer_size()) else { return };
    let open = shared.gate.expanded.load(Ordering::Relaxed) && !shared.gate.collapsed.load(Ordering::Relaxed);
    if open {
        // The open island moved: it stays there while it is open, nothing is
        // saved, and closing it takes the character back to its place.
        let s = shared.settings.lock().unwrap().clone();
        if let Some(offset) = island::panel_offset_from_drop(&app, &s, (pos.x, pos.y), (size.width, size.height)) {
            *shared.gate.panel_offset.lock().unwrap() = offset;
        }
        return;
    }
    let settings = {
        let mut s = shared.settings.lock().unwrap();
        let Some((work, scale)) = island::work_area(&app, &s) else { return };
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
}

/// The island opened or closed. Closing takes the window back to the character's
/// place (an open island dragged elsewhere comes home), and every opening starts there.
#[tauri::command]
fn set_expanded(app: AppHandle, shared: State<Shared>, expanded: bool) {
    if shared.gate.expanded.swap(expanded, Ordering::Relaxed) == expanded {
        return;
    }
    // A drag of the open island lasts for that opening only.
    let dragged = std::mem::take(&mut *shared.gate.panel_offset.lock().unwrap()) != (0.0, 0.0);
    if shared.gate.collapsed.load(Ordering::Relaxed) {
        return;
    }
    let settings = shared.settings.lock().unwrap().clone();
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
pub(crate) fn open_url_now(url: &str) {
    if !(url.starts_with("http://") || url.starts_with("https://")) {
        return;
    }
    let _ = Command::new("rundll32.exe")
        .args(["url.dll,FileProtocolHandler", url])
        .creation_flags(CREATE_NO_WINDOW)
        .spawn();
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

#[tauri::command]
fn hooks_status() -> HookStatus {
    hooks::status()
}

/// Returns the diff the user has to look at before anything is written.
#[tauri::command]
fn hooks_preview(install: bool) -> Result<HookPreview, String> {
    hooks::preview(install)
}

/// Only ever called from an explicit click in the settings window.
#[tauri::command]
fn hooks_apply(
    app: AppHandle,
    shared: State<Shared>,
    install: bool,
    fingerprint: String,
) -> Result<String, String> {
    // The fingerprint comes from the preview the user actually looked at, so a
    // settings.json that changed in between is refused rather than overwritten.
    let backup = hooks::write(install, &fingerprint)?;
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

/// One chat turn. The API key and any file bytes stay on the Rust side.
#[tauri::command]
async fn chat_send(
    shared: State<'_, Shared>,
    chat: State<'_, Chat>,
    query: String,
    context: Option<ChatContext>,
) -> Result<ChatReply, String> {
    let (engine, model, cli_model, mcp, agent) = {
        let s = shared.settings.lock().unwrap();
        (s.chat_engine.clone(), s.model.clone(), s.cli_model.clone(), s.mcp_servers.clone(), s.agent_tools)
    };
    chat.use_engine(&engine);
    if engine == "api" {
        claude::send(&chat, &model, query, context).await
    } else {
        claude_cli::send(&chat, &cli_model, &mcp, agent, query, context).await
    }
}

#[tauri::command]
fn chat_reset(chat: State<Chat>) {
    chat.reset();
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

/// Copies a dropped file into the inbox and reports its name back.
#[tauri::command]
fn ingest_file(path: String) -> Result<DroppedFile, String> {
    files::ingest(&path)
}

/// "Cattura una zona": the snipping overlay, then the picture saved in the inbox.
/// None when the user gave up.
#[tauri::command]
async fn capture_screen() -> Result<Option<DroppedFile>, String> {
    screenshot::capture().await
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

/// Refresh buttons in the integration cards.
#[tauri::command]
async fn refresh_integration(app: AppHandle, id: String) {
    match id.as_str() {
        clipboard::ID => clipboard::publish(&app),
        threecx::ID => threecx::publish_now(&app),
        media::ID => media::refresh(),
        _ => integrations::poll_once(app, &id).await,
    }
}

/// Appunti: put an entry back on the clipboard (transformed), and paste it.
#[tauri::command]
async fn clipboard_use(app: AppHandle, id: u64, transform: String, paste: bool) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || clipboard::use_entry(&app, id, &transform, paste))
        .await
        .map_err(|e| e.to_string())?
}

/// Appunti → "Chiedi a Claude" on a picture.
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

/// The app in front, for the suggested actions in the ⚡ tab.
#[tauri::command]
fn foreground_app() -> Option<context::Foreground> {
    context::foreground()
}

/// The text selected in the app in front (copied, then the clipboard restored).
#[tauri::command]
async fn capture_selection() -> Option<String> {
    tauri::async_runtime::spawn_blocking(context::selection).await.ok().flatten()
}

/// Impostazioni → Automazioni: the last runs, newest first.
#[tauri::command]
fn automations_log() -> Vec<automations::LogEntry> {
    automations::log()
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

/// Impostazioni → Automazioni → "Prova ora".
#[tauri::command]
fn automation_run_now(app: AppHandle, id: String) -> Result<(), String> {
    automations::run_now(&app, &id)
}

/// "File caricati": the copies in the inbox, newest first.
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

/// "Apri" opens the copy with its app; "Mostra" selects it in Explorer.
#[tauri::command]
fn inbox_open(name: String, reveal: bool) -> Result<(), String> {
    let path = files::inbox_path(&name)?;
    let mut cmd = Command::new("explorer");
    if reveal {
        cmd.arg(format!("/select,{}", path.display()));
    } else {
        cmd.arg(&path);
    }
    cmd.spawn().map(|_| ()).map_err(|e| e.to_string())
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
const BROWSER_ARGS: &str = "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required";

/// In a dev build the pages are served by Vite, so the second window needs the
/// absolute dev URL; a bundled build resolves it inside the app bundle.
fn settings_page_url(app: &AppHandle) -> WebviewUrl {
    #[cfg(dev)]
    if let Some(mut base) = app.config().build.dev_url.clone() {
        base.set_path("/settings.html");
        return WebviewUrl::External(base);
    }
    let _ = app;
    WebviewUrl::App("settings.html".into())
}

/// The settings window is created hidden at launch and only ever shown and
/// hidden afterwards. A WebView2 window created later — on the main thread or
/// not — silently comes up blank in this app, so the window that works is the
/// one that exists before the island's webview does.
fn create_settings_window(app: &AppHandle) {
    let url = settings_page_url(app);
    match WebviewWindowBuilder::new(app, "settings", url)
        .additional_browser_args(BROWSER_ARGS)
        .title("Impostazioni — EasyIsland")
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
            win.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = hidden.hide();
                }
            });
        }
        Err(err) => log::line(format!("settings window failed: {err}")),
    }
}

pub fn show_settings_window(app: &AppHandle) {
    let Some(win) = app.get_webview_window("settings") else {
        log::line("settings window missing");
        return;
    };
    let _ = win.unminimize();
    let _ = win.show();
    let _ = win.set_focus();
}

#[tauri::command]
fn open_settings_window(app: AppHandle) {
    show_settings_window(&app);
}

pub fn run() {
    // First launch after the rename: bring Coucou's settings and keys over.
    let moved = legacy::migrate();
    let mut loaded = settings::load();
    // Zammad's address and token, when a widget became the integration (schema 5).
    settings::apply_pending_secrets(&mut loaded);
    let gate = Arc::new(PollGate::new());

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            // `easyisland.exe --settings` opens the settings window (a shortcut can use it).
            if argv.iter().any(|a| a == "--settings") {
                show_settings_window(app);
            } else {
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
            set_collapsed,
            drag_island,
            copy_pc_info,
            presence_state,
            notify_test,
            end_drag,
            set_expanded,
            set_island_rect,
            focus_window,
            reposition,
            open_url,
            open_in_vscode,
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
            chat_reset,
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
            ingest_file,
            capture_screen,
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
            zip_list,
            automations_log,
            habits_stats,
            habits_suggestions,
            habit_answer,
            habits_clear,
            habit_note_quick,
            automation_run_now,
            inbox_list,
            inbox_delete,
            inbox_clear,
            inbox_open,
            zip_extract,
            foreground_app,
            capture_selection,
            open_n8n,
            open_zammad,
            open_settings_window,
            set_paused,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            tray::build(&handle)?;
            // Before the island: see create_settings_window.
            create_settings_window(&handle);

            if let Some(win) = island::window(&handle) {
                island::make_non_activating(&win);
                island::apply_geometry(&handle, &gate, &loaded, false);
                let _ = win.show();
            }
            gate.collapsed.store(false, Ordering::Relaxed);
            gate.set_active(true);
            island::spawn_cursor_poll(handle.clone(), gate.clone());
            island::spawn_fullscreen_watch(handle.clone(), gate.clone());
            island::spawn_drag_raise(handle.clone(), gate.clone());
            profiles::spawn_auto_switch(handle.clone());
            hotkeys::spawn(handle.clone());
            clipboard::spawn(handle.clone());
            context::spawn();
            media::spawn(handle.clone());
            threecx::spawn(handle.clone());
            automations::spawn(handle.clone());
            habits::spawn(handle.clone());
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
            presence::spawn(handle.clone());
            integrations::start(handle.clone());
            updates::spawn(handle.clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running EasyIsland");
}
