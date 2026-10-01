// Preferences, stored as plain JSON in %APPDATA%\Coucou\settings.json.
// No secret ever lands here — API keys live in the Windows Credential Manager.
//
// Profiles: the top-level fields are always the *active* values, which is what
// the rest of the app reads. Each profile keeps its own copy of the
// profile-scoped fields (PROFILE_KEYS); switching copies them over the top
// level, and every save writes the top level back into the active profile.

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
use std::path::PathBuf;

/// Bumped whenever the file layout changes; `migrate` brings old files up.
pub const SCHEMA_VERSION: u32 = 2;

/// Fields that belong to a profile rather than to the machine.
pub const PROFILE_KEYS: &[&str] = &[
    "activeIntegrations",
    "anchorV",
    "anchorH",
    "iconStyle",
    "iconSize",
    "hoverStyle",
    "hoverSize",
    "openDelay",
    "revealDuration",
    "quietFullscreen",
    "soundEnabled",
    "soundVolume",
    "autoCloseInterval",
    "theme",
    "notify",
    "actions",
    "widgets",
    "mcpServers",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Theme {
    /// Mochi's body colour, "#rrggbb"; empty = the original cream.
    #[serde(default)]
    pub mochi_color: String,
    #[serde(default = "default_island_color")]
    pub island_color: String,
    #[serde(default = "one")]
    pub island_opacity: f64,
    /// Volume multipliers per sound family, 0–1.
    #[serde(default = "one")]
    pub volume_alerts: f64,
    #[serde(default = "one")]
    pub volume_ui: f64,
    #[serde(default = "one")]
    pub volume_emotes: f64,
}

impl Default for Theme {
    fn default() -> Self {
        Self {
            mochi_color: String::new(),
            island_color: default_island_color(),
            island_opacity: 1.0,
            volume_alerts: 1.0,
            volume_ui: 1.0,
            volume_emotes: 1.0,
        }
    }
}

fn default_island_color() -> String {
    "#000000".into()
}
fn one() -> f64 {
    1.0
}

/// When a profile switches itself on. All empty = never automatically.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProfileRules {
    /// Wi-Fi network names; empty = any network.
    #[serde(default)]
    pub ssids: Vec<String>,
    /// 1 = Monday … 7 = Sunday; empty = every day.
    #[serde(default)]
    pub days: Vec<u8>,
    /// "HH:MM"; both empty = all day. `to` before `from` spans midnight.
    #[serde(default)]
    pub from: String,
    #[serde(default)]
    pub to: String,
}

impl ProfileRules {
    pub fn is_empty(&self) -> bool {
        self.ssids.is_empty() && self.days.is_empty() && self.from.is_empty() && self.to.is_empty()
    }

    /// `day` 1–7 (Monday first), `minutes` since midnight.
    pub fn matches(&self, ssid: Option<&str>, day: u8, minutes: u32) -> bool {
        if self.is_empty() {
            return false;
        }
        if !self.ssids.is_empty() {
            let Some(current) = ssid else { return false };
            if !self.ssids.iter().any(|s| s.trim().eq_ignore_ascii_case(current.trim())) {
                return false;
            }
        }
        if !self.days.is_empty() && !self.days.contains(&day) {
            return false;
        }
        match (parse_hm(&self.from), parse_hm(&self.to)) {
            (Some(f), Some(t)) if f <= t => minutes >= f && minutes < t,
            (Some(f), Some(t)) => minutes >= f || minutes < t,
            (Some(f), None) => minutes >= f,
            (None, Some(t)) => minutes < t,
            (None, None) => true,
        }
    }
}

fn parse_hm(s: &str) -> Option<u32> {
    let (h, m) = s.trim().split_once(':')?;
    let (h, m): (u32, u32) = (h.parse().ok()?, m.parse().ok()?);
    (h < 24 && m < 60).then_some(h * 60 + m)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub id: String,
    pub name: String,
    /// The profile's copy of PROFILE_KEYS.
    #[serde(default)]
    pub values: Map<String, Value>,
    #[serde(default)]
    pub rules: ProfileRules,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    /// 0/1 = a file written before profiles existed.
    #[serde(default)]
    pub schema_version: u32,
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
    #[serde(default)]
    pub theme: Theme,
    /// What may surface the island: "all" | "alerts" (no routine activity) |
    /// "permissions" (only Claude Code permission requests).
    #[serde(default = "default_notify")]
    pub notify: String,
    /// Quick actions (6.2) — kept as JSON here; the front end owns the shape.
    #[serde(default)]
    pub actions: Vec<Value>,
    /// Configurable widgets (6.4).
    #[serde(default)]
    pub widgets: Vec<Value>,
    /// MCP servers the chat may use (6.3), by name.
    #[serde(default)]
    pub mcp_servers: Vec<String>,
    #[serde(default)]
    pub profiles: Vec<Profile>,
    #[serde(default)]
    pub active_profile: String,
    /// Switch profile on its own, from the profiles' rules.
    #[serde(default)]
    pub auto_profile: bool,
}

fn default_notify() -> String {
    "all".into()
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
            schema_version: SCHEMA_VERSION,
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
            theme: Theme::default(),
            notify: default_notify(),
            actions: Vec::new(),
            widgets: Vec::new(),
            mcp_servers: Vec::new(),
            profiles: Vec::new(),
            active_profile: String::new(),
            auto_profile: false,
        }
        .migrated()
    }
}

impl Settings {
    /// The profile-scoped part of the current values.
    pub fn snapshot(&self) -> Map<String, Value> {
        let Ok(Value::Object(all)) = serde_json::to_value(self) else { return Map::new() };
        all.into_iter().filter(|(k, _)| PROFILE_KEYS.contains(&k.as_str())).collect()
    }

    /// Copies a profile's values over the current ones. Unknown or malformed
    /// values are ignored rather than wiping the settings.
    fn apply_values(&mut self, values: &Map<String, Value>) {
        let Ok(Value::Object(mut all)) = serde_json::to_value(&*self) else { return };
        for (k, v) in values {
            if PROFILE_KEYS.contains(&k.as_str()) {
                all.insert(k.clone(), v.clone());
            }
        }
        if let Ok(next) = serde_json::from_value::<Settings>(Value::Object(all)) {
            *self = next;
        }
    }

    /// Writes the current values back into the active profile.
    pub fn commit_active(&mut self) {
        let snap = self.snapshot();
        let active = self.active_profile.clone();
        if let Some(p) = self.profiles.iter_mut().find(|p| p.id == active) {
            p.values = snap;
        }
    }

    /// Saves the current profile, then loads `id`. False if it does not exist.
    pub fn switch_profile(&mut self, id: &str) -> bool {
        let Some(values) = self.profiles.iter().find(|p| p.id == id).map(|p| p.values.clone()) else {
            return false;
        };
        self.commit_active();
        self.active_profile = id.to_string();
        let profiles = std::mem::take(&mut self.profiles);
        self.apply_values(&values);
        self.profiles = profiles;
        self.active_profile = id.to_string();
        true
    }

    /// Brings a file of any earlier layout up to SCHEMA_VERSION.
    pub fn migrated(mut self) -> Self {
        if self.profiles.is_empty() {
            let snap = self.snapshot();
            let mut focus = snap.clone();
            focus.insert("notify".into(), Value::from("permissions"));
            focus.insert("soundEnabled".into(), Value::from(false));
            self.profiles = vec![
                Profile { id: "lavoro".into(), name: "Lavoro".into(), values: snap.clone(), rules: ProfileRules::default() },
                Profile { id: "casa".into(), name: "Casa".into(), values: snap, rules: ProfileRules::default() },
                Profile { id: "concentrazione".into(), name: "Concentrazione".into(), values: focus, rules: ProfileRules::default() },
            ];
            self.active_profile = "lavoro".into();
        }
        if !self.profiles.iter().any(|p| p.id == self.active_profile) {
            self.active_profile = self.profiles[0].id.clone();
        }
        self.schema_version = SCHEMA_VERSION;
        self
    }

    /// The file a user can carry to another PC: everything but what only
    /// makes sense on this machine. Secrets were never in here to begin with.
    pub fn export_json(&self) -> String {
        let mut copy = self.clone();
        copy.commit_active();
        copy.hooks_installed = false;
        serde_json::to_string_pretty(&copy).unwrap_or_else(|_| "{}".into())
    }

    /// Reads an exported file. Machine-specific state stays as it is here.
    pub fn import_json(&self, text: &str) -> Result<Settings, String> {
        let value: Value = serde_json::from_str(text.trim_start_matches('\u{feff}'))
            .map_err(|e| format!("Il file non è un JSON valido: {e}"))?;
        if !value.is_object() {
            return Err("Il file non contiene impostazioni di Coucou.".into());
        }
        let mut next: Settings = serde_json::from_value(value)
            .map_err(|e| format!("Impostazioni non riconosciute: {e}"))?;
        next.hooks_installed = self.hooks_installed;
        Ok(next.migrated())
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
        Ok(bytes) => serde_json::from_slice::<Settings>(&bytes)
            .map(Settings::migrated)
            .unwrap_or_default(),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_file_gets_three_profiles() {
        let old = r#"{"soundEnabled":true,"soundVolume":0.1,"autoCloseInterval":15,"absenceInterval":180,
            "activeIntegrations":["integration_github"],"screen":"primary","autostart":false,"hooksInstalled":true}"#;
        let s = serde_json::from_str::<Settings>(old).unwrap().migrated();
        assert_eq!(s.schema_version, SCHEMA_VERSION);
        assert_eq!(s.profiles.len(), 3);
        assert_eq!(s.active_profile, "lavoro");
        assert_eq!(s.profiles[2].values["notify"], "permissions");
    }

    #[test]
    fn switching_keeps_each_profile_apart() {
        let mut s = Settings::default();
        s.anchor_h = "left".into();
        s.switch_profile("casa");
        assert_eq!(s.anchor_h, "center", "casa still has the original value");
        s.anchor_h = "right".into();
        s.switch_profile("lavoro");
        assert_eq!(s.anchor_h, "left");
        s.switch_profile("casa");
        assert_eq!(s.anchor_h, "right");
        assert_eq!(s.profiles.len(), 3);
        assert!(!s.switch_profile("nope"));
    }

    #[test]
    fn rules_match_network_days_and_hours() {
        let r = ProfileRules {
            ssids: vec!["Ufficio".into()],
            days: vec![1, 2, 3, 4, 5],
            from: "08:00".into(),
            to: "18:30".into(),
        };
        assert!(r.matches(Some("ufficio"), 1, 9 * 60));
        assert!(!r.matches(Some("Casa"), 1, 9 * 60));
        assert!(!r.matches(None, 1, 9 * 60));
        assert!(!r.matches(Some("Ufficio"), 6, 9 * 60));
        assert!(!r.matches(Some("Ufficio"), 1, 19 * 60));
        let night = ProfileRules { from: "22:00".into(), to: "07:00".into(), ..Default::default() };
        assert!(night.matches(None, 3, 23 * 60));
        assert!(night.matches(None, 3, 60));
        assert!(!night.matches(None, 3, 12 * 60));
        assert!(!ProfileRules::default().matches(Some("x"), 1, 0));
    }

    #[test]
    fn export_import_round_trip_keeps_local_state() {
        let mut a = Settings::default();
        a.icon_size = 40.0;
        a.hooks_installed = true;
        let text = a.export_json();
        assert!(!text.contains("sk-"), "no secret can be in here");
        let mut b = Settings::default();
        b.hooks_installed = false;
        let c = b.import_json(&text).unwrap();
        assert_eq!(c.icon_size, 40.0);
        assert!(!c.hooks_installed, "hooks state belongs to the machine");
        assert!(b.import_json("[1,2]").is_err());
        assert!(b.import_json("non json").is_err());
    }
}
