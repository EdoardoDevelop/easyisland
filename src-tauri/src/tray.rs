// Notification-area icon: Open, Profile ▸, Settings, Pause, Quit. The same
// menu opens with a right click on the resting character (`popup`) and on the
// fixed bar, there with «Personalizza la barra…» first (`popup_bar_context`).
// The menu is rebuilt whenever profiles change (names, the active one).

use tauri::image::Image;
use tauri::menu::{CheckMenuItem, IconMenuItem, IsMenuItem, Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter, Manager, Wry};

use crate::island::WINDOW_LABEL;
use crate::i18n::{t, tf};

const TRAY_ID: &str = "easyisland";
const PROFILE_PREFIX: &str = "profile:";
/// «Personalizza la barra…» of the fixed bar's menu: Impostazioni → Aspetto → Barra fissa.
const BAR_SETTINGS: &str = "bar-settings";

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
    let daily = MenuItem::with_id(app, "daily", t("Riepilogo del giorno"), true, None::<&str>)?;
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


    Menu::with_items(app, &[&open, &profile, &recap, &daily, &sep1, &presence, &settings, &pause, &sep2, &quit])
}

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app)?;
    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("EasyIsland")
        .menu(&menu)
        .on_menu_event(|app: &AppHandle, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "settings" => crate::show_settings_window(app),
            BAR_SETTINGS => {
                crate::show_settings_window(app);
                let _ = app.emit_to(crate::SETTINGS_LABEL, "settings-goto", serde_json::json!({ "page": "aspetto", "item": "barra" }));
            }
            "presence" => {
                let on = !crate::presence::MANUAL.load(std::sync::atomic::Ordering::Relaxed);
                crate::presence::MANUAL.store(on, std::sync::atomic::Ordering::Relaxed);
                crate::presence::recheck(app);
                refresh(app);
            }
            id if id.starts_with(PROFILE_PREFIX) => {
                crate::activate_profile(app, &id[PROFILE_PREFIX.len()..], "menu");
            }
            // A line of the program's own menu (appmenu.rs): to the program, not the island.
            id if id.starts_with("appmenu:") => crate::appmenu::run(id.strip_prefix("appmenu:").unwrap_or_default()),
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

/// «…» of the fixed bar (docs/architettura.md → «Barra fissa»): the elements that do not fit,
/// as a menu at the mouse over the bar. A click comes back as the "tray" event
/// "bar:<key>" (the tray's handler sends on every id it does not know), which
/// the island handles as a click on that element.
pub fn popup_bar_menu(app: &AppHandle, entries: &[(String, String)]) {
    let Some(win) = app.get_window(crate::CHARACTER_LABEL) else { return };
    let built = Menu::new(app).and_then(|menu| {
        for (key, label) in entries {
            // An empty key is a separator; a key starting with "-" a line that only tells (a package to update).
            if key.is_empty() {
                menu.append(&tauri::menu::PredefinedMenuItem::separator(app)?)?;
                continue;
            }
            // "&" underlines the next letter in a Windows menu.
            menu.append(&MenuItem::with_id(app, format!("bar:{key}"), label.replace('&', "&&"), !key.starts_with('-'), None::<&str>)?)?;
        }
        Ok(menu)
    });
    let Ok(menu) = built else { return };
    // As the island's menus: TrackPopupMenu needs a foreground owner to close on an outside click.
    crate::island::set_activating(&win, true);
    if let Err(e) = win.popup_menu(&menu) {
        crate::log::line(format!("bar menu: {e}"));
    }
    // Never activated again, also with the island as an app (set_activating keeps that one activatable).
    crate::island::make_non_activating(&win);
}

/// Right click on the fixed bar outside its elements (asked by Edoardo on 31 Oct
/// 2026): the notification-area menu, with «Personalizza la barra…» first. Its
/// clicks reach the tray's handler, as `popup`'s.
pub fn popup_bar_context(app: &AppHandle) {
    let Some(win) = app.get_window(crate::CHARACTER_LABEL) else { return };
    let built = build_menu(app).and_then(|menu| {
        menu.insert(&MenuItem::with_id(app, BAR_SETTINGS, t("Personalizza la barra…"), true, None::<&str>)?, 0)?;
        menu.insert(&PredefinedMenuItem::separator(app)?, 1)?;
        Ok(menu)
    });
    let Ok(menu) = built else { return };
    crate::island::set_activating(&win, true);
    if let Err(e) = win.popup_menu(&menu) {
        crate::log::line(format!("bar context menu: {e}"));
    }
    crate::island::make_non_activating(&win);
}

/// One line of the menu on the selected text, built by the island
/// (src/island/selection-menu.ts). An empty `id` is a separator; a line that
/// is not `enabled` is a heading (the text that was selected); `items` make a
/// submenu (a folder of actions); `icon` is the action's or the folder's icon,
/// drawn by the island.
#[derive(serde::Deserialize)]
pub struct MenuEntry {
    id: String,
    label: String,
    #[serde(default = "yes")]
    enabled: bool,
    #[serde(default)]
    items: Vec<MenuEntry>,
    #[serde(default)]
    icon: Option<MenuIcon>,
}

/// A small RGBA picture, `width` × `height` pixels.
#[derive(serde::Deserialize)]
struct MenuIcon {
    rgba: Vec<u8>,
    width: u32,
    height: u32,
}

impl MenuIcon {
    /// None when the bytes do not match the size (or it is far too big for a menu).
    fn image(&self) -> Option<Image<'_>> {
        let fits = (1..=128).contains(&self.width) && (1..=128).contains(&self.height);
        (fits && self.rgba.len() == (self.width * self.height * 4) as usize).then(|| Image::new(&self.rgba, self.width, self.height))
    }
}

fn yes() -> bool {
    true
}

/// Adds `entries` to a menu or a submenu.
fn append_entries(app: &AppHandle, entries: &[MenuEntry], add: &dyn Fn(&dyn IsMenuItem<Wry>) -> tauri::Result<()>) -> tauri::Result<()> {
    for e in entries {
        // "&" underlines the next letter in a Windows menu.
        let label = e.label.replace('&', "&&");
        if e.id.is_empty() {
            add(&PredefinedMenuItem::separator(app)?)?;
        } else if !e.items.is_empty() {
            let icon = e.icon.as_ref().and_then(MenuIcon::image);
            let sub = Submenu::new_with_icon(app, label, true, icon)?;
            append_entries(app, &e.items, &|item| sub.append(item))?;
            add(&sub)?;
        } else if let Some(icon) = e.icon.as_ref().and_then(MenuIcon::image) {
            add(&IconMenuItem::with_id(app, format!("sel:{}", e.id), label, e.enabled, Some(icon), None::<&str>)?)?;
        } else {
            add(&MenuItem::with_id(app, format!("sel:{}", e.id), label, e.enabled, None::<&str>)?)?;
        }
    }
    Ok(())
}

/// The menu on the selected text, at the mouse, over whatever app is in front.
/// A click comes back as the "tray" event "sel:<id>" (the tray's handler sends
/// on every id it does not know); closing it without a choice sends nothing.
pub fn popup_entries(app: &AppHandle, entries: &[MenuEntry]) {
    let Some(win) = crate::island::window(app) else { return };
    let built = Menu::new(app).and_then(|menu| {
        append_entries(app, entries, &|item| menu.append(item))?;
        Ok(menu)
    });
    let Ok(menu) = built else { return };
    crate::island::set_activating(&win, true);
    if let Err(e) = win.popup_menu(&menu) {
        crate::log::line(format!("selection menu: {e}"));
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
