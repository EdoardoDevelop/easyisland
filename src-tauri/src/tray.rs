// Notification-area icon: Open, Profile ▸, Settings, Pause, Quit.
// The menu is rebuilt whenever profiles change (names, the active one).

use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::island::WINDOW_LABEL;

const TRAY_ID: &str = "coucou";
const PROFILE_PREFIX: &str = "profile:";

fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let (profiles, active) = app
        .try_state::<crate::Shared>()
        .map(|s| {
            let s = s.settings.lock().unwrap();
            (
                s.profiles.iter().map(|p| (p.id.clone(), p.name.clone())).collect::<Vec<_>>(),
                s.active_profile.clone(),
            )
        })
        .unwrap_or_default();

    let open = MenuItem::with_id(app, "open", "Apri Coucou", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Impostazioni…", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Pausa", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Esci", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    let items = profiles
        .iter()
        .map(|(id, name)| {
            CheckMenuItem::with_id(
                app,
                format!("{PROFILE_PREFIX}{id}"),
                name,
                true,
                *id == active,
                None::<&str>,
            )
        })
        .collect::<tauri::Result<Vec<_>>>()?;
    let refs: Vec<&dyn IsMenuItem<Wry>> = items.iter().map(|i| i as &dyn IsMenuItem<Wry>).collect();
    let profile = Submenu::with_items(app, "Profilo", !refs.is_empty(), &refs)?;

    Menu::with_items(app, &[&open, &profile, &sep1, &settings, &pause, &sep2, &quit])
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app)?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Coucou")
        .menu(&menu)
        .on_menu_event(|app: &AppHandle, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "settings" => crate::show_settings_window(app),
            id if id.starts_with(PROFILE_PREFIX) => {
                crate::activate_profile(app, &id[PROFILE_PREFIX.len()..], "menu");
            }
            id => {
                let _ = app.emit_to(WINDOW_LABEL, "tray", id.to_string());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    builder.build(app)?;
    Ok(())
}

/// Re-reads profiles into the menu (after a rename, a switch, an import…).
pub fn refresh(app: &AppHandle) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    if let Ok(menu) = build_menu(app) {
        let _ = tray.set_menu(Some(menu));
    }
}
