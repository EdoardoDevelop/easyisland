// Preferences, stored as plain JSON in %APPDATA%\Coucou\settings.json.
// No secret ever lands here — API keys live in the Windows Credential Manager.

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub sound_enabled: bool,
    pub sound_volume: f64,
    pub auto_close_interval: f64,
    pub absence_interval: f64,
    pub active_integrations: Vec<String>,
    /// "primary" = the main display, "cursor" = whichever display the mouse is on.
    pub screen: String,
    pub autostart: bool,
    pub hooks_installed: bool,
    /// Claude model used by the chat. Changeable in the settings window.
    /// Defaulted explicitly so a settings.json written by an older build still loads.
    #[serde(default = "default_model")]
    pub model: String,
    /// Where the chat goes: "subscription" = the user's Claude Code install
    /// (`claude -p`, covered by a Claude plan), "api" = an Anthropic API key.
    #[serde(default = "default_chat_engine")]
    pub chat_engine: String,
    /// Model for the Claude Code engine: an alias (opus, sonnet, haiku) or ""
    /// for Claude Code's own default.
    #[serde(default)]
    pub cli_model: String,
    /// Where the island sits: "top" | "bottom" …
    #[serde(default = "default_anchor_v")]
    pub anchor_v: String,
    /// … and "left" | "center" | "right". Content opens aligned to that side.
    #[serde(default = "default_anchor_h")]
    pub anchor_h: String,
    /// What stays visible at rest: "mochi" | "dot" | "none" (invisible strip).
    #[serde(default = "default_icon_style")]
    pub icon_style: String,
    /// Rest icon size, logical px.
    #[serde(default = "default_icon_size")]
    pub icon_size: f64,
    /// What the hover shows: "icon" (a bigger, live Mochi) | "bar" (the compact bar).
    #[serde(default = "default_hover_style")]
    pub hover_style: String,
    /// Size of the hovered icon, logical px.
    #[serde(default = "default_hover_size")]
    pub hover_size: f64,
    /// Seconds of hover before the island opens; 0 = only on click.
    #[serde(default = "default_open_delay")]
    pub open_delay: f64,
    /// Seconds the hover icon / bar stays up after the mouse leaves or an event.
    #[serde(default = "default_reveal_duration")]
    pub reveal_duration: f64,
    /// Stay out of the way while a full-screen app runs (permission requests excepted).
    #[serde(default = "default_true")]
    pub quiet_fullscreen: bool,
}

fn default_anchor_v() -> String {
    "top".into()
}
fn default_anchor_h() -> String {
    "center".into()
}
fn default_icon_style() -> String {
    "mochi".into()
}
fn default_icon_size() -> f64 {
    24.0
}
fn default_hover_style() -> String {
    "icon".into()
}
fn default_hover_size() -> f64 {
    40.0
}
fn default_open_delay() -> f64 {
    0.6
}
fn default_reveal_duration() -> f64 {
    8.0
}
fn default_true() -> bool {
    true
}

fn default_model() -> String {
    crate::claude::DEFAULT_MODEL.to_string()
}

fn default_chat_engine() -> String {
    "subscription".into()
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            sound_enabled: true,
            sound_volume: 0.12,
            auto_close_interval: 15.0,
            absence_interval: 180.0,
            active_integrations: vec![
                "integration_resend".into(),
                "integration_n8n".into(),
                "integration_vercel".into(),
                "integration_github".into(),
            ],
            screen: "primary".into(),
            autostart: false,
            hooks_installed: false,
            model: default_model(),
            chat_engine: default_chat_engine(),
            cli_model: String::new(),
            anchor_v: default_anchor_v(),
            anchor_h: default_anchor_h(),
            icon_style: default_icon_style(),
            icon_size: default_icon_size(),
            hover_style: default_hover_style(),
            hover_size: default_hover_size(),
            open_delay: default_open_delay(),
            reveal_duration: default_reveal_duration(),
            quiet_fullscreen: true,
        }
    }
}

/// %APPDATA%\Coucou
pub fn config_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Coucou")
}

/// %LOCALAPPDATA%\Coucou — where coucou-hook.exe and the log live.
pub fn local_dir() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("Coucou")
}

pub fn hook_exe_path() -> PathBuf {
    local_dir().join("bin").join("coucou-hook.exe")
}

fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

pub fn load() -> Settings {
    match std::fs::read(settings_path()) {
        Ok(bytes) => serde_json::from_slice(&bytes).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

pub fn save(settings: &Settings) -> std::io::Result<()> {
    let dir = config_dir();
    std::fs::create_dir_all(&dir)?;
    let json = serde_json::to_vec_pretty(settings)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
    std::fs::write(settings_path(), json)
}
