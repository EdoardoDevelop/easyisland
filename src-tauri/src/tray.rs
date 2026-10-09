// Notification-area icon: Open, Profile ▸, Settings, Pause, Quit. The same
// menu opens with a right click on the resting character (`popup`).
// The menu is rebuilt whenever profiles change (names, the active one).

use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::island::WINDOW_LABEL;
use crate::i18n::{t, tf};

const TRAY_ID: &str = "easyisland";
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

    let open = MenuItem::with_id(app, "open", t("Apri EasyIsland"), true, None::<&str>)?;
    // Handled by the island (src/main.ts, "tray" event).
    let recap = MenuItem::with_id(app, "recap", t("Riepilogo settimanale"), true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", t("Impostazioni…"), true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", t("Pausa"), true, None::<&str>)?;
    let presence = CheckMenuItem::with_id(
        app,
        "presence",
        t("Davanti al cliente"),
        true,
        crate::presence::MANUAL.load(std::sync::atomic::Ordering::Relaxed),
        None::<&str>,
    )?;
    let quit = MenuItem::with_id(app, "quit", t("Esci"), true, None::<&str>)?;
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
    let profile = Submenu::with_items(app, t("Profilo"), !refs.is_empty(), &refs)?;


    Menu::with_items(app, &[&open, &profile, &recap, &sep1, &presence, &settings, &pause, &sep2, &quit])
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app)?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("EasyIsland")
        .menu(&menu)
        .on_menu_event(|app: &AppHandle, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "settings" => crate::show_settings_window(app),
            "presence" => {
                let on = !crate::presence::MANUAL.load(std::sync::atomic::Ordering::Relaxed);
                crate::presence::MANUAL.store(on, std::sync::atomic::Ordering::Relaxed);
                crate::presence::recheck(app);
                refresh(app);
            }
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

/// The same menu at the cursor, from a right click on the resting character.
/// Its clicks reach the tray's handler, which Tauri calls for every menu event.
pub fn popup(app: &AppHandle) {
    let Some(win) = crate::island::window(app) else { return };
    let Ok(menu) = build_menu(app) else { return };
    // TrackPopupMenu needs a foreground owner, or the menu never closes on an
    // outside click; the resting island is otherwise non-activating.
    crate::island::set_activating(&win, true);
    if let Err(e) = win.popup_menu(&menu) {
        crate::log::line(format!("island menu: {e}"));
    }
    crate::island::set_activating(&win, false);
}

/// Re-reads profiles into the menu (after a rename, a switch, an import…).
pub fn refresh(app: &AppHandle) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else { return };
    if let Ok(menu) = build_menu(app) {
        let _ = tray.set_menu(Some(menu));
    }
    let tip = match crate::presence::current() {
        Some(why) => tf("EasyIsland — davanti al cliente ({why})", &[("why", &why)]),
        None => "EasyIsland".to_string(),
    };
    let _ = tray.set_tooltip(Some(tip));
}
