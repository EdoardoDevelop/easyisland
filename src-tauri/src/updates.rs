// Updates from the GitHub releases of EdoardoDevelop/easyisland, through the
// official Tauri updater: `latest.json` names the new installer and carries
// its signature, which is checked against the public key in tauri.conf.json
// before anything runs. Nothing is installed without a click.
//
// The check is the app's only network call that the user did not configure,
// so it can be switched off (Impostazioni → Generale → Aggiornamenti).

use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;

use crate::island::WINDOW_LABEL;
use crate::{log, Shared};

/// First check a minute after start, then once a day.
const FIRST_CHECK: Duration = Duration::from_secs(60);
const EVERY: Duration = Duration::from_secs(24 * 3600);

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInfo {
    pub version: String,
    pub current: String,
    pub notes: String,
}

/// The newer version on GitHub, if any.
pub async fn check(app: &AppHandle) -> Result<Option<UpdateInfo>, String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let update = updater.check().await.map_err(|e| e.to_string())?;
    Ok(update.map(|u| UpdateInfo {
        version: u.version.clone(),
        current: u.current_version.clone(),
        notes: u.body.clone().unwrap_or_default(),
    }))
}

/// Downloads the new installer, verifies its signature and runs it. On Windows
/// the installer closes the app, updates it and starts it again.
pub async fn install(app: &AppHandle) -> Result<(), String> {
    let updater = app.updater().map_err(|e| e.to_string())?;
    let Some(update) = updater.check().await.map_err(|e| e.to_string())? else {
        return Err("Nessun aggiornamento disponibile.".into());
    };
    log::line(format!("update: installing {}", update.version));
    update
        .download_and_install(|_, _| {}, || {})
        .await
        .map_err(|e| format!("Aggiornamento non riuscito: {e}"))?;
    app.restart();
}

fn enabled(app: &AppHandle) -> bool {
    app.state::<Shared>().settings.lock().map(|s| s.update_check).unwrap_or(false)
}

/// Background check: tells the island once per new version.
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(FIRST_CHECK).await;
        let mut announced = String::new();
        loop {
            if enabled(&app) {
                match check(&app).await {
                    Ok(Some(info)) if info.version != announced => {
                        log::line(format!("update: {} available", info.version));
                        announced = info.version.clone();
                        let _ = app.emit_to(WINDOW_LABEL, "update-available", info);
                    }
                    Ok(_) => {}
                    Err(err) => log::line(format!("update check: {err}")),
                }
            }
            tokio::time::sleep(EVERY).await;
        }
    });
}
