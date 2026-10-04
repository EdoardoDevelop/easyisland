// Preferences, stored as plain JSON in %APPDATA%\EasyIsland\settings.json.
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
/// 3–4: the character was renamed (Mochi → Ezzy → Slime), so were its values.
/// 5: system / security / network / weather / outlook / zammad widgets became
///    integrations (`integration_<kind>`, options in `integrationConfig`).
pub const SCHEMA_VERSION: u32 = 5;

/// Widget kinds that are integrations since schema 5: one per PC, switched on
/// in Impostazioni → Integrazioni. Their checks still run through widgets.rs.
pub const PROBE_INTEGRATIONS: &[(&str, &str)] = &[
    ("integration_system", "system"),
    ("integration_security", "security"),
    ("integration_network", "network"),
    ("integration_weather", "weather"),
    ("integration_outlook", "outlook"),
    ("integration_zammad", "zammad"),
];

/// Options of the integrations above. Machine-wide, like their credentials.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationConfig {
    /// Stato del PC: warn below this % of free space on the system disk.
    #[serde(default = "ten")]
    pub system_warn: i64,
    /// Outlook: warn this many minutes before a meeting.
    #[serde(default = "ten")]
    pub outlook_warn: i64,
    #[serde(default)]
    pub weather_city: String,
}

impl Default for IntegrationConfig {
    fn default() -> Self {
        Self { system_warn: 10, outlook_warn: 10, weather_city: String::new() }
    }
}

fn ten() -> i64 {
    10
}

/// A credential the schema-5 migration has to move (Zammad's address and token
/// lived under the widget's id). Done by `apply_pending_secrets` after loading,
/// since migrating is pure.
#[derive(Debug, Clone, PartialEq)]
pub enum PendingSecret {
    /// Copy the value of another key.
    From { to: &'static str, from: String },
    /// Store this value.
    Value { to: &'static str, value: String },
}

/// Fields that belong to a profile rather than to the machine.
pub const PROFILE_KEYS: &[&str] = &[
    "activeIntegrations",
    "integrationTabs",
    "integrationTabIcons",
    "anchorV",
    "anchorH",
    "offsetX",
    "offsetY",
    "glueEdges",
    "overTaskbar",
    "closeButton",
    "followCursorCompact",
    "presenceMeeting",
    "presenceRemote",
    "presenceApps",
    "presenceMode",
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
    /// Who lives in the island: "slime" or "cube" (EasyTech).
    #[serde(default = "default_character")]
    pub character: String,
    /// The slime's body colour, "#rrggbb"; empty = its green.
    #[serde(default, alias = "mochiColor", alias = "ezzyColor")]
    pub slime_color: String,
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
    /// The island's colour behind the character while it is closed (compact view).
    #[serde(default = "default_true")]
    pub compact_background: bool,
}

impl Default for Theme {
    fn default() -> Self {
        Self {
            character: default_character(),
            slime_color: String::new(),
            island_color: default_island_color(),
            island_opacity: 1.0,
            volume_alerts: 1.0,
            volume_ui: 1.0,
            volume_emotes: 1.0,
            compact_background: true,
        }
    }
}

fn default_character() -> String {
    "slime".into()
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

/// An MCP server the chat may use. With `confirm`, every call to it waits for
/// Consenti/Nega in the island.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpChoice {
    pub name: String,
    #[serde(default = "default_true")]
    pub confirm: bool,
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
    /// Integrations shown as a tab in the island's header instead of a pill.
    #[serde(default)]
    pub integration_tabs: Vec<String>,
    /// Integrations whose tab shows an icon (emoji or short text) instead of the name: id → icon.
    #[serde(default)]
    pub integration_tab_icons: serde_json::Map<String, Value>,
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
    /// Where the user dragged the character: logical px from the anchored home position.
    #[serde(default)]
    pub offset_x: f64,
    #[serde(default)]
    pub offset_y: f64,
    /// Touch the screen edge (square corners) when left at it, not only top centre.
    #[serde(default = "default_true")]
    pub glue_edges: bool,
    /// Place the island over the whole screen, taskbar included.
    #[serde(default)]
    pub over_taskbar: bool,
    /// ✕ in the open island's header.
    #[serde(default = "default_true")]
    pub close_button: bool,
    /// The compact view follows the cursor too (the open island always does).
    #[serde(default)]
    pub follow_cursor_compact: bool,
    /// "Davanti al cliente" while the microphone or the webcam is in use (a call).
    #[serde(default = "default_true")]
    pub presence_meeting: bool,
    /// … while someone is connected to this PC (Remote Desktop, Quick Assist, TeamViewer).
    #[serde(default = "default_true")]
    pub presence_remote: bool,
    /// More programs (executable names) that mean remote help is on.
    #[serde(default)]
    pub presence_apps: Vec<String>,
    /// "hide" = the character disappears (permission requests still show), "silent" = no sounds only.
    #[serde(default = "default_presence_mode")]
    pub presence_mode: String,
    /// What stays visible at rest: "character" | "dot" | "none" (invisible strip).
    #[serde(default = "default_icon_style")]
    pub icon_style: String,
    /// Rest icon size, logical px.
    #[serde(default = "default_icon_size")]
    pub icon_size: f64,
    /// What the hover shows: "icon" (a bigger, live the character) | "bar" (the compact bar).
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
    /// MCP servers the chat may use (6.3).
    #[serde(default)]
    pub mcp_servers: Vec<McpChoice>,
    #[serde(default)]
    pub profiles: Vec<Profile>,
    #[serde(default)]
    pub active_profile: String,
    /// Switch profile on its own, from the profiles' rules.
    #[serde(default)]
    pub auto_profile: bool,
    /// Global shortcut that opens the island ("" = none). Belongs to the PC.
    #[serde(default = "default_hotkey_open")]
    pub hotkey_open: String,
    /// Global shortcut: ask the character about the text on the clipboard.
    #[serde(default = "default_hotkey_ask")]
    pub hotkey_ask: String,
    /// Global shortcut: open the clipboard history (Appunti).
    #[serde(default = "default_hotkey_clipboard")]
    pub hotkey_clipboard: String,
    /// ⚡ tab: actions suggested for the app in front (Outlook, Excel, the browser…).
    #[serde(default = "default_true")]
    pub context_actions: bool,
    /// The chat (Claude Code engine) may use EasyIsland's own tools (agent.rs).
    #[serde(default = "default_true")]
    pub agent_tools: bool,
    /// "Quando… allora…" rules (automations.rs). Belong to the PC; each can be
    /// limited to one profile.
    #[serde(default)]
    pub automations: Vec<Value>,
    /// Record what happens on the PC to propose automations (habits.rs). Off
    /// until switched on by hand.
    #[serde(default)]
    pub habits_enabled: bool,
    /// Proposals refused with "No, mai": {fp, title, text, automation, at}.
    #[serde(default)]
    pub suggestions_dismissed: Vec<Value>,
    /// "Non ora": fingerprint → ms until which it is not proposed.
    #[serde(default)]
    pub suggestions_snoozed: Map<String, Value>,
    /// "Programmi da non osservare" (exe names).
    #[serde(default)]
    pub habits_excluded: Vec<String>,
    /// Look for a new version on GitHub at start and once a day. Belongs to the PC.
    #[serde(default = "default_true")]
    pub update_check: bool,
    /// Options of the integrations that run as checks (PROBE_INTEGRATIONS).
    #[serde(default)]
    pub integration_config: IntegrationConfig,
    /// Credentials the last migration has to move; never written to the file.
    #[serde(skip)]
    pub pending_secrets: Vec<PendingSecret>,
}

fn default_hotkey_open() -> String {
    "Ctrl+Alt+Shift+M".into()
}
fn default_hotkey_ask() -> String {
    "Ctrl+Alt+K".into()
}
fn default_hotkey_clipboard() -> String {
    "Ctrl+Alt+H".into()
}

fn default_presence_mode() -> String {
    "hide".into()
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
    "character".into()
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
            integration_tabs: Vec::new(),
            integration_tab_icons: serde_json::Map::new(),
            screen: "primary".into(),
            autostart: false,
            hooks_installed: false,
            model: default_model(),
            chat_engine: default_chat_engine(),
            cli_model: String::new(),
            anchor_v: default_anchor_v(),
            anchor_h: default_anchor_h(),
            offset_x: 0.0,
            offset_y: 0.0,
            glue_edges: true,
            over_taskbar: false,
            close_button: true,
            follow_cursor_compact: false,
            presence_meeting: true,
            presence_remote: true,
            presence_apps: Vec::new(),
            presence_mode: default_presence_mode(),
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
            hotkey_open: default_hotkey_open(),
            hotkey_ask: default_hotkey_ask(),
            hotkey_clipboard: default_hotkey_clipboard(),
            context_actions: true,
            agent_tools: true,
            automations: Vec::new(),
            habits_enabled: false,
            suggestions_dismissed: Vec::new(),
            suggestions_snoozed: Map::new(),
            habits_excluded: Vec::new(),
            update_check: true,
            integration_config: IntegrationConfig::default(),
            pending_secrets: Vec::new(),
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
        // Schemas 3–4: values written while the character was Mochi or Ezzy.
        if LEGACY_CHARACTERS.contains(&self.icon_style.as_str()) {
            self.icon_style = default_icon_style();
        }
        if LEGACY_CHARACTERS.contains(&self.theme.character.as_str()) {
            self.theme.character = default_character();
        }
        for p in &mut self.profiles {
            rename_legacy_values(&mut p.values);
        }
        // Schema 5: widgets that are integrations now, in every profile too.
        let mut moved = Vec::new();
        let widgets = std::mem::take(&mut self.widgets);
        self.widgets = take_probe_widgets(widgets, &mut self.active_integrations, &mut moved);
        for p in &mut self.profiles {
            let Some(Value::Array(list)) = p.values.remove("widgets") else { continue };
            let mut active: Vec<String> = p
                .values
                .get("activeIntegrations")
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default();
            let before = moved.len();
            let kept = take_probe_widgets(list, &mut active, &mut moved);
            p.values.insert("widgets".into(), Value::Array(kept));
            if moved.len() > before {
                p.values.insert("activeIntegrations".into(), Value::from(active));
            }
        }
        self.adopt_widget_options(&moved);
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
            return Err("Il file non contiene impostazioni di EasyIsland.".into());
        }
        let mut next: Settings = serde_json::from_value(value)
            .map_err(|e| format!("Impostazioni non riconosciute: {e}"))?;
        next.hooks_installed = self.hooks_installed;
        Ok(next.migrated())
    }
}

impl Settings {
    /// The first converted widget of each kind gives the integration its options.
    fn adopt_widget_options(&mut self, moved: &[Value]) {
        let str_of = |w: &Value, k: &str| w.get(k).and_then(Value::as_str).unwrap_or("").trim().to_string();
        let num_of = |w: &Value, k: &str| w.get(k).and_then(Value::as_i64).filter(|n| *n > 0);
        let first = |kind: &str| moved.iter().find(|w| w.get("kind").and_then(Value::as_str) == Some(kind));
        if let Some(n) = first("system").and_then(|w| num_of(w, "warnDays")) {
            self.integration_config.system_warn = n;
        }
        if let Some(n) = first("outlook").and_then(|w| num_of(w, "warnDays")) {
            self.integration_config.outlook_warn = n;
        }
        if self.integration_config.weather_city.is_empty() {
            if let Some(city) = first("weather").map(|w| str_of(w, "host")).filter(|c| !c.is_empty()) {
                self.integration_config.weather_city = city;
            }
        }
        if let Some(w) = first("zammad") {
            let url = str_of(w, "url");
            if url.starts_with("http") {
                self.pending_secrets.push(PendingSecret::Value { to: "zammad-url", value: url });
            }
            let id = str_of(w, "id");
            if !id.is_empty() {
                self.pending_secrets.push(PendingSecret::From { to: "zammad-token", from: format!("widget:{id}:token") });
            }
        }
    }
}

/// Splits `list` into the widgets that stay and the ones that are integrations
/// now: those are switched on in `active` and handed back through `moved`.
fn take_probe_widgets(list: Vec<Value>, active: &mut Vec<String>, moved: &mut Vec<Value>) -> Vec<Value> {
    let mut kept = Vec::new();
    for w in list {
        let kind = w.get("kind").and_then(Value::as_str).unwrap_or("");
        match PROBE_INTEGRATIONS.iter().find(|(_, k)| *k == kind) {
            Some((id, _)) => {
                if !active.iter().any(|a| a == id) {
                    active.push((*id).to_string());
                }
                moved.push(w);
            }
            None => kept.push(w),
        }
    }
    kept
}

/// Moves the credentials a migration asked for. An existing destination is kept;
/// a moved source is deleted.
pub fn apply_pending_secrets(settings: &mut Settings) {
    for p in std::mem::take(&mut settings.pending_secrets) {
        match p {
            PendingSecret::Value { to, value } => {
                if crate::secrets::get(to).is_none() {
                    let _ = crate::secrets::set(to, &value);
                }
            }
            PendingSecret::From { to, from } => {
                if let Some(value) = crate::secrets::get(&from) {
                    if crate::secrets::get(to).is_none() {
                        let _ = crate::secrets::set(to, &value);
                    }
                    let _ = crate::secrets::clear(&from);
                }
            }
        }
    }
}

/// Earlier names of the slime ("character" for iconStyle) in settings files.
const LEGACY_CHARACTERS: &[&str] = &["mochi", "ezzy"];

/// A profile's stored values, brought from the Mochi/Ezzy names to the current ones.
fn rename_legacy_values(values: &mut Map<String, Value>) {
    let legacy = |v: Option<&Value>| v.and_then(Value::as_str).is_some_and(|s| LEGACY_CHARACTERS.contains(&s));
    if legacy(values.get("iconStyle")) {
        values.insert("iconStyle".into(), Value::from(default_icon_style()));
    }
    if let Some(Value::Object(theme)) = values.get_mut("theme") {
        if legacy(theme.get("character")) {
            theme.insert("character".into(), Value::from(default_character()));
        }
        for old in ["mochiColor", "ezzyColor"] {
            if let Some(color) = theme.remove(old) {
                theme.entry("slimeColor").or_insert(color);
            }
        }
    }
}

/// %APPDATA%\EasyIsland
pub fn config_dir() -> PathBuf {
    let base = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("EasyIsland")
}

/// %LOCALAPPDATA%\EasyIsland — where easyisland-hook.exe and the log live.
pub fn local_dir() -> PathBuf {
    let base = std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("EasyIsland")
}

pub fn hook_exe_path() -> PathBuf {
    local_dir().join("bin").join("easyisland-hook.exe")
}

fn settings_path() -> PathBuf {
    config_dir().join("settings.json")
}

pub fn load() -> Settings {
    match std::fs::read(settings_path()) {
        Ok(bytes) => match serde_json::from_slice::<Settings>(&bytes) {
            Ok(old) => {
                let from = old.schema_version;
                let s = old.migrated();
                // A converted file is written back at once, so what is on disk
                // matches what the app shows.
                if from < SCHEMA_VERSION {
                    let _ = save(&s);
                }
                s
            }
            Err(_) => Settings::default(),
        },
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
    fn mochi_and_ezzy_values_become_slime() {
        let old = r##"{"soundEnabled":true,"soundVolume":0.1,"autoCloseInterval":15,"absenceInterval":180,
            "activeIntegrations":[],"screen":"primary","autostart":false,"hooksInstalled":false,
            "schemaVersion":2,"iconStyle":"mochi","theme":{"character":"mochi","mochiColor":"#ff0000"},
            "activeProfile":"casa","profiles":[
            {"id":"casa","name":"Casa","values":{"iconStyle":"mochi","theme":{"character":"cube","mochiColor":"#00ff00"}}},
            {"id":"lavoro","name":"Lavoro","values":{"iconStyle":"ezzy","theme":{"character":"ezzy","ezzyColor":"#0000ff"}}}]}"##;
        let s = serde_json::from_str::<Settings>(old).unwrap().migrated();
        assert_eq!(s.icon_style, "character");
        assert_eq!(s.theme.character, "slime");
        assert_eq!(s.theme.slime_color, "#ff0000");
        let v = &s.profiles[0].values;
        assert_eq!(v["iconStyle"], "character");
        assert_eq!(v["theme"]["character"], "cube");
        assert_eq!(v["theme"]["slimeColor"], "#00ff00");
        assert!(v["theme"].get("mochiColor").is_none());
        let w = &s.profiles[1].values;
        assert_eq!(w["iconStyle"], "character");
        assert_eq!(w["theme"]["character"], "slime");
        assert_eq!(w["theme"]["slimeColor"], "#0000ff");
        assert!(w["theme"].get("ezzyColor").is_none());
        // A file saved by schema 3 (ezzyColor at the top level) still loads its colour.
        let t: Theme = serde_json::from_str(r##"{"character":"ezzy","ezzyColor":"#123456"}"##).unwrap();
        assert_eq!(t.slime_color, "#123456");
    }

    #[test]
    fn single_instance_widgets_become_integrations() {
        let old = r##"{"soundEnabled":true,"soundVolume":0.1,"autoCloseInterval":15,"absenceInterval":180,
            "activeIntegrations":["integration_github"],"screen":"primary","autostart":false,"hooksInstalled":false,
            "schemaVersion":4,"activeProfile":"lavoro",
            "widgets":[
              {"id":"w1","kind":"system","warnDays":15},
              {"id":"w2","kind":"ping","host":"10.0.0.1"},
              {"id":"w3","kind":"zammad","url":"https://help.cliente.it"}],
            "profiles":[
              {"id":"lavoro","name":"Lavoro","values":{"activeIntegrations":["integration_github"],
                "widgets":[{"id":"w1","kind":"system","warnDays":15},{"id":"w2","kind":"ping"},{"id":"w3","kind":"zammad"}]}},
              {"id":"casa","name":"Casa","values":{"activeIntegrations":[],
                "widgets":[{"id":"w9","kind":"weather","host":"Bologna"}]}},
              {"id":"concentrazione","name":"Concentrazione","values":{"widgets":[{"id":"w2","kind":"ping"}]}}]}"##;
        let s = serde_json::from_str::<Settings>(old).unwrap().migrated();
        let kinds = |l: &[Value]| l.iter().map(|w| w["kind"].as_str().unwrap().to_string()).collect::<Vec<_>>();
        // Top level: only the ping stays a widget.
        assert_eq!(kinds(&s.widgets), vec!["ping"]);
        assert_eq!(s.active_integrations, vec!["integration_github", "integration_system", "integration_zammad"]);
        assert_eq!(s.integration_config.system_warn, 15);
        assert_eq!(s.integration_config.weather_city, "Bologna");
        assert_eq!(
            s.pending_secrets,
            vec![
                PendingSecret::Value { to: "zammad-url", value: "https://help.cliente.it".into() },
                PendingSecret::From { to: "zammad-token", from: "widget:w3:token".into() },
            ]
        );
        // Every profile is converted on its own.
        let casa = &s.profiles[1].values;
        assert_eq!(casa["widgets"], serde_json::json!([]));
        assert_eq!(casa["activeIntegrations"], serde_json::json!(["integration_weather"]));
        // Nothing moved: activeIntegrations is left as it was (absent here).
        let focus = &s.profiles[2].values;
        assert!(focus.get("activeIntegrations").is_none());
        // Running it again changes nothing.
        let again = s.clone().migrated();
        assert_eq!(again.active_integrations, s.active_integrations);
        assert!(again.pending_secrets.len() == s.pending_secrets.len());
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
