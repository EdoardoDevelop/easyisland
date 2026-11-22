// The fixed bar's «App» (22 Nov 2026, Edoardo: «come su Windows avere le
// applicazioni, aprirle e quelle aperte»): the pinned apps, kept in the
// settings (`apps_pinned`, `{ id, name }`, of the PC), in step with the Windows
// taskbar's pins (imported the first time, then its changes followed both
// ways), and the menu of an app (right click in the bar).
//
// The windows themselves are followed by taskwin.rs and drawn by the bar's
// page (src/character-window/apps.ts); opening apps goes through applist.rs.

use std::sync::Mutex;

use serde::Deserialize;
use serde_json::{json, Value};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager};

use crate::i18n::t;

/// The ids of the «App» menu's lines (tray.rs hands them back here).
pub const MENU_PREFIX: &str = "apps:";

/// What the menu open now is about: its app and the files it lists.
struct MenuFor {
    app: String,
    name: String,
    files: Vec<String>,
    windows: Vec<isize>,
}

static MENU: Mutex<Option<MenuFor>> = Mutex::new(None);

fn pins(app: &AppHandle) -> Vec<Value> {
    app.try_state::<crate::Shared>().map(|s| s.settings.lock().unwrap().apps_pinned.clone()).unwrap_or_default()
}

fn id_of(v: &Value) -> &str {
    v.get("id").and_then(Value::as_str).unwrap_or_default()
}

/// The pins changed: saved and sent to every window, as any change.
fn save_pins(app: &AppHandle, list: Vec<Value>) {
    let Some(shared) = app.try_state::<crate::Shared>() else { return };
    let mut s = shared.settings.lock().unwrap().clone();
    s.apps_pinned = list;
    crate::apply_settings(app, s);
}

fn same(a: &str, b: &str) -> bool {
    a.eq_ignore_ascii_case(b)
}

/// `{ add: [{ id, name }], remove: [id] }` from the Windows taskbar, applied:
/// new ones at the end, gone ones away. The first time every Windows pin is «new».
pub fn windows_pins_changed(app: &AppHandle, change: &Value) {
    let mut list = pins(app);
    let before = list.clone();
    if let Some(gone) = change.get("remove").and_then(Value::as_array) {
        list.retain(|p| !gone.iter().filter_map(Value::as_str).any(|g| same(g, id_of(p))));
    }
    if let Some(add) = change.get("add").and_then(Value::as_array) {
        for a in add {
            if !id_of(a).is_empty() && !list.iter().any(|p| same(id_of(p), id_of(a))) {
                list.push(json!({ "id": id_of(a), "name": a.get("name").and_then(Value::as_str).unwrap_or_default() }));
            }
        }
    }
    if list != before {
        crate::log::line(format!("app della barra: {} fissate dopo un cambio sulla barra di Windows", list.len()));
        save_pins(app, list);
    }
}

/// «App» shown in the bar: its windows followed (the page asks them with
/// `apps_windows`), the Windows taskbar's pins read (all of them the first time).
#[tauri::command]
pub async fn apps_start(app: AppHandle) {
    let change = tauri::async_runtime::spawn_blocking(crate::applist::windows_pins_change).await.ok().flatten();
    if let Some(change) = change {
        windows_pins_changed(&app, &change);
    }
}

/// Pins an app (its windows' id), before `before` or at the end.
#[tauri::command]
pub async fn apps_pin(app: AppHandle, id: String, name: Option<String>, before: Option<String>) {
    let id = crate::applist::normalize_id(id.trim());
    if id.is_empty() {
        return;
    }
    let name = match name.filter(|n| !n.trim().is_empty()) {
        Some(n) => n,
        None => {
            let id = id.clone();
            tauri::async_runtime::spawn_blocking(move || crate::applist::name_of(&id)).await.unwrap_or_default()
        }
    };
    let mut list = pins(&app);
    list.retain(|p| !same(id_of(p), &id));
    let at = before.and_then(|b| list.iter().position(|p| same(id_of(p), &b))).unwrap_or(list.len());
    list.insert(at.min(list.len()), json!({ "id": id, "name": name }));
    save_pins(&app, list);
}

/// Unpins an app: from the Windows taskbar too, or it would come back from there.
#[tauri::command]
pub async fn apps_unpin(app: AppHandle, id: String) {
    unpin(&app, &id);
}

fn unpin(app: &AppHandle, id: &str) {
    let id = id.to_string();
    let mut list = pins(&app);
    let before = list.len();
    list.retain(|p| !same(id_of(p), &id));
    if list.len() != before {
        crate::applist::unpin_from_windows(&id);
        save_pins(&app, list);
    }
}

/// A pinned app dragged along the bar: before `before`, or last.
#[tauri::command]
pub async fn apps_move(app: AppHandle, id: String, before: Option<String>) {
    let mut list = pins(&app);
    let Some(from) = list.iter().position(|p| same(id_of(p), &id)) else { return };
    let item = list.remove(from);
    let at = before.and_then(|b| list.iter().position(|p| same(id_of(p), &b))).unwrap_or(list.len());
    list.insert(at.min(list.len()), item);
    save_pins(&app, list);
}

/// Programs and shortcuts dragged on the bar with «App» in it: pinned there.
/// What is left (files, folders, no «App») goes to the bar as before (lib.rs bar_pin).
pub fn pin_dropped(app: &AppHandle, paths: Vec<String>) -> Vec<String> {
    let has_apps = app
        .try_state::<crate::Shared>()
        .is_some_and(|s| s.settings.lock().unwrap().fixed_bar_items.iter().any(|x| x.get("id").and_then(Value::as_str) == Some("sys:apps")));
    if !has_apps {
        return paths;
    }
    let (apps, rest): (Vec<String>, Vec<String>) =
        paths.into_iter().partition(|p| crate::applist::is_program(p) || crate::applist::is_shortcut(p));
    if !apps.is_empty() {
        let mut list = pins(app);
        for p in apps {
            let id = crate::applist::normalize_id(&p);
            if !list.iter().any(|x| same(id_of(x), &id)) {
                let name = std::path::Path::new(&p).file_stem().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                list.push(json!({ "id": id, "name": name }));
            }
        }
        save_pins(app, list);
    }
    rest
}

/// One open window of the app, for its menu.
#[derive(Deserialize)]
pub struct MenuWindow {
    hwnd: isize,
    title: String,
}

/// The right click on an app in the bar: its windows, its recent files, open
/// again, as administrator, pin or unpin, close. A line comes back to `menu_pick`.
#[tauri::command]
pub async fn apps_menu(app: AppHandle, id: String, name: String, windows: Vec<MenuWindow>) {
    let files = {
        let id = id.clone();
        tauri::async_runtime::spawn_blocking(move || crate::applist::recent_files(&id, 10)).await.unwrap_or_default()
    };
    let pinned = pins(&app).iter().any(|p| same(id_of(p), &id));
    let windows: Vec<MenuWindow> = windows.into_iter().filter(|w| crate::taskwin::is_known(w.hwnd)).take(20).collect();
    *MENU.lock().unwrap() = Some(MenuFor { app: id.clone(), name: name.clone(), files: files.clone(), windows: windows.iter().map(|w| w.hwnd).collect() });
    let handle = app.clone();
    let _ = app.run_on_main_thread(move || popup(&handle, &id, &name, &windows, &files, pinned));
}

fn popup(app: &AppHandle, id: &str, name: &str, windows: &[MenuWindow], files: &[String], pinned: bool) {
    let Some(win) = app.get_window(crate::CHARACTER_LABEL) else { return };
    let line = |key: &str, label: &str| MenuItem::with_id(app, format!("{MENU_PREFIX}{key}"), label.replace('&', "&&"), true, None::<&str>);
    let short = |s: &str| if s.chars().count() > 60 { format!("{}…", s.chars().take(59).collect::<String>()) } else { s.to_string() };
    let built = Menu::new(app).and_then(|menu| {
        for (i, w) in windows.iter().enumerate() {
            menu.append(&line(&format!("win:{i}"), &short(&w.title))?)?;
        }
        if !windows.is_empty() {
            menu.append(&PredefinedMenuItem::separator(app)?)?;
        }
        if !files.is_empty() {
            let sub = Submenu::new(app, t("Recenti"), true)?;
            for (i, f) in files.iter().enumerate() {
                let label = std::path::Path::new(f).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| f.clone());
                sub.append(&line(&format!("file:{i}"), &short(&label))?)?;
            }
            menu.append(&sub)?;
            menu.append(&PredefinedMenuItem::separator(app)?)?;
        }
        menu.append(&line("open", &if windows.is_empty() { short(name) } else { t("Nuova finestra").to_string() })?)?;
        if crate::applist::is_program(id) {
            menu.append(&line("admin", t("Esegui come amministratore"))?)?;
        }
        menu.append(&line(if pinned { "unpin" } else { "pin" }, if pinned { t("Togli dalla barra") } else { t("Fissa alla barra") })?)?;
        menu.append(&line("add", t("Aggiungi app…"))?)?;
        if !windows.is_empty() {
            menu.append(&PredefinedMenuItem::separator(app)?)?;
            menu.append(&line("close", if windows.len() > 1 { t("Chiudi tutte le finestre") } else { t("Chiudi la finestra") })?)?;
        }
        Ok(menu)
    });
    let Ok(menu) = built else { return };
    // As the bar's other menus: TrackPopupMenu needs a foreground owner to close on an outside click.
    crate::island::set_activating(&win, true);
    if let Err(e) = win.popup_menu(&menu) {
        crate::log::line(format!("app della barra, menu: {e}"));
    }
    crate::island::make_non_activating(&win);
}

/// A line of that menu.
pub fn menu_pick(app: &AppHandle, what: &str) {
    let Some(m) = MENU.lock().unwrap().take() else { return };
    let index = |p: &str| what.strip_prefix(p).and_then(|i| i.parse::<usize>().ok());
    if let Some(w) = index("win:").and_then(|i| m.windows.get(i).copied()) {
        // Off the main thread (the menu's click is there): taskwin.rs may be busy with a slow window.
        std::thread::spawn(move || crate::taskwin::act("activate".into(), Some(w), None, None));
    } else if let Some(f) = index("file:").and_then(|i| m.files.get(i).cloned()) {
        crate::applist::launch(crate::applist::Launch::Files { app: m.app, files: vec![f] });
    } else {
        match what {
            "open" => crate::applist::launch(crate::applist::Launch::Open { id: m.app }),
            "admin" => crate::applist::launch(crate::applist::Launch::Admin { id: m.app }),
            "close" => {
                let id = m.app;
                std::thread::spawn(move || crate::taskwin::act("close-all".into(), None, Some(id), None));
            }
            "unpin" => unpin(app, &m.app),
            "pin" => {
                let (app, id, name) = (app.clone(), m.app, m.name);
                tauri::async_runtime::spawn(async move { apps_pin(app, id, Some(name), None).await });
            }
            // Impostazioni → Barra fissa, where the installed apps are listed.
            "add" => {
                crate::show_settings_window(app);
                use tauri::Emitter;
                let _ = app.emit_to(crate::SETTINGS_LABEL, "settings-goto", json!({ "page": "aspetto", "item": "barra" }));
            }
            _ => {}
        }
    }
}

/// An app's recent files (the island's card of its windows lists them too).
#[tauri::command]
pub async fn apps_recent_files(id: String) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || crate::applist::recent_files(&id, 8)).await.unwrap_or_default()
}
