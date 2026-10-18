// `get_settings` / `set_setting`, the easyisland tools (agent.rs) that read and
// change EasyIsland's settings from a chat (asked by Edoardo on 17 Oct 2026).
//
// Only the settings listed in `ENTRIES` exist for an agent: never secrets
// (they are in the Credential Manager anyway), never what widens what an agent
// may do (tools, Modalità terminale and its folder, connectors, Telegram's
// "Automatica"), never lists the user builds by hand (actions, widgets,
// automations: they have their own tools). `set_setting` is not read-only, so
// the chat asks Consenti / Nega before every change; the change then goes
// through the same path as a save from the settings window (`apply_settings`).

use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

enum Kind {
    Bool,
    Choice(&'static [&'static str]),
    Number(f64, f64),
    Text,
    /// `integrations.<id>`: on/off in `activeIntegrations`.
    Integration,
}

struct Entry {
    key: &'static str,
    section: &'static str,
    what: &'static str,
    kind: Kind,
}

const ENGINES: &[&str] = &["subscription", "api", "opencode", "openrouter", "openai", "gemini", "ollama", "lmstudio"];
const CHARACTERS: &[&str] = &["drop", "slime", "cube", "gecko", "flame", "magma", "stone", "rock", "leaf"];
/// Mirrors TOGGLEABLE_INTEGRATION_IDS in src/core/state.ts.
const INTEGRATIONS: &[&str] = &[
    "integration_resend", "integration_n8n", "integration_vercel", "integration_github", "integration_notion",
    "integration_calcom", "integration_stripe", "integration_system", "integration_security", "integration_network",
    "integration_weather", "integration_outlook", "integration_zammad", "integration_claude_usage", "integration_clipboard",
    "integration_media", "integration_3cx", "integration_rdm", "integration_teams", "integration_recorder", "integration_telegram",
];

const CHAT: &str = "Chat";
const ISLAND: &str = "Isola e aspetto";
const MORE: &str = "Riepiloghi, proposte e avvio";
const INTEGR: &str = "Integrazioni";

const ENTRIES: &[Entry] = &[
    Entry { key: "chatEngine", section: CHAT, what: "motore predefinito della chat: subscription = Claude con l'abbonamento (Claude Code), api = Claude con chiave API, opencode, openrouter, openai, gemini, ollama, lmstudio", kind: Kind::Choice(ENGINES) },
    Entry { key: "cliModel", section: CHAT, what: "modello di Claude con l'abbonamento: opus, sonnet, haiku, o vuoto = quello di Claude Code", kind: Kind::Text },
    Entry { key: "model", section: CHAT, what: "modello di Claude con chiave API (es. claude-opus-5-5)", kind: Kind::Text },
    Entry { key: "engineModels.opencode", section: CHAT, what: "modello di opencode (provider/modello)", kind: Kind::Text },
    Entry { key: "engineModels.openrouter", section: CHAT, what: "modello di OpenRouter", kind: Kind::Text },
    Entry { key: "engineModels.openai", section: CHAT, what: "modello di OpenAI", kind: Kind::Text },
    Entry { key: "engineModels.gemini", section: CHAT, what: "modello di Gemini", kind: Kind::Text },
    Entry { key: "engineModels.ollama", section: CHAT, what: "modello di Ollama", kind: Kind::Text },
    Entry { key: "engineModels.lmstudio", section: CHAT, what: "modello di LM Studio", kind: Kind::Text },
    Entry { key: "chatHistory", section: CHAT, what: "tenere le conversazioni su questo PC per riaprirle", kind: Kind::Bool },
    Entry { key: "contextActions", section: CHAT, what: "scheda ⚡ con le azioni per l'app in primo piano", kind: Kind::Bool },
    Entry { key: "searchBar", section: CHAT, what: "barra di ricerca in alto nell'isola aperta", kind: Kind::Bool },
    Entry { key: "integrations", section: INTEGR, what: "integrations.<id> = true/false accende o spegne un'integrazione (id come integration_weather)", kind: Kind::Integration },
    Entry { key: "autoProfile", section: INTEGR, what: "cambiare profilo da solo secondo le regole dei profili", kind: Kind::Bool },
    Entry { key: "habitsEnabled", section: INTEGR, what: "osservare le abitudini per proporre automazioni", kind: Kind::Bool },
    Entry { key: "language", section: ISLAND, what: "lingua: it, en, o vuoto = quella di Windows", kind: Kind::Choice(&["", "it", "en"]) },
    Entry { key: "theme.character", section: ISLAND, what: "personaggio: drop (Goccia), slime, cube (EasyTech), gecko, flame (Fiamma), magma, stone (Pietra), rock (Roccia), leaf (Foglia)", kind: Kind::Choice(CHARACTERS) },
    Entry { key: "notify", section: ISLAND, what: "il personaggio si fa vedere per: all = tutto, alerts = solo avvisi, permissions = solo permessi", kind: Kind::Choice(&["all", "alerts", "permissions"]) },
    Entry { key: "alertsOpen", section: ISLAND, what: "permessi e chiamate aprono l'isola da soli", kind: Kind::Bool },
    Entry { key: "soundEnabled", section: ISLAND, what: "suoni", kind: Kind::Bool },
    Entry { key: "soundVolume", section: ISLAND, what: "volume dei suoni (0–0.2)", kind: Kind::Number(0.0, 0.2) },
    Entry { key: "anchorV", section: ISLAND, what: "isola in alto o in basso", kind: Kind::Choice(&["top", "bottom"]) },
    Entry { key: "anchorH", section: ISLAND, what: "isola a sinistra, al centro o a destra", kind: Kind::Choice(&["left", "center", "right"]) },
    Entry { key: "screen", section: ISLAND, what: "schermo: primary = principale, cursor = quello del mouse", kind: Kind::Choice(&["primary", "cursor"]) },
    Entry { key: "overTaskbar", section: ISLAND, what: "personaggio sopra la barra delle app", kind: Kind::Bool },
    Entry { key: "islandPlace", section: ISLAND, what: "dove si apre l'isola: character, top, center, bottom", kind: Kind::Choice(&["character", "top", "center", "bottom"]) },
    Entry { key: "islandWidth", section: ISLAND, what: "larghezza dell'isola aperta, px", kind: Kind::Number(400.0, 1600.0) },
    Entry { key: "iconStyle", section: ISLAND, what: "a riposo si vede: character, dot (pallino), none", kind: Kind::Choice(&["character", "dot", "none"]) },
    Entry { key: "iconSize", section: ISLAND, what: "grandezza del personaggio a riposo, px", kind: Kind::Number(12.0, 96.0) },
    Entry { key: "hoverStyle", section: ISLAND, what: "al passaggio del mouse: icon o bar", kind: Kind::Choice(&["icon", "bar"]) },
    Entry { key: "compactStrip", section: ISLAND, what: "striscia accanto al personaggio: right, left, off", kind: Kind::Choice(&["right", "left", "off"]) },
    Entry { key: "menuCharacter", section: ISLAND, what: "personaggio in testa al menu: large, medium, small", kind: Kind::Choice(&["large", "medium", "small"]) },
    Entry { key: "characterBubble", section: ISLAND, what: "il personaggio dice cosa succede nella barra in alto", kind: Kind::Bool },
    Entry { key: "openDelay", section: ISLAND, what: "secondi di passaggio del mouse prima che l'isola si apra (0 = solo clic)", kind: Kind::Number(0.0, 5.0) },
    Entry { key: "revealDuration", section: ISLAND, what: "secondi in cui resta visibile dopo un evento", kind: Kind::Number(1.0, 60.0) },
    Entry { key: "autoCloseInterval", section: ISLAND, what: "secondi prima che l'isola aperta si riduca", kind: Kind::Number(1.0, 300.0) },
    Entry { key: "quietFullscreen", section: ISLAND, what: "nascondersi con video, giochi e presentazioni a schermo intero", kind: Kind::Bool },
    Entry { key: "closeButton", section: ISLAND, what: "pulsante ✕ nell'isola aperta", kind: Kind::Bool },
    Entry { key: "greeting", section: ISLAND, what: "saluto all'avvio", kind: Kind::Bool },
    Entry { key: "dailyRecap", section: MORE, what: "riepilogo del giorno: both, morning, evening, off", kind: Kind::Choice(&["both", "morning", "evening", "off"]) },
    Entry { key: "eveningHour", section: MORE, what: "ora del riepilogo di fine giornata (0–23)", kind: Kind::Number(0.0, 23.0) },
    Entry { key: "weeklyRecap", section: MORE, what: "riepilogo settimanale degli agenti il lunedì", kind: Kind::Bool },
    Entry { key: "momentDownloads", section: MORE, what: "proposte a download finito", kind: Kind::Bool },
    Entry { key: "momentErrors", section: MORE, what: "«Spiega e correggi» su un errore copiato", kind: Kind::Bool },
    Entry { key: "momentServers", section: MORE, what: "«Apri nel browser» quando parte un server di sviluppo", kind: Kind::Bool },
    Entry { key: "autostart", section: MORE, what: "avviare EasyIsland con Windows", kind: Kind::Bool },
    Entry { key: "updateCheck", section: MORE, what: "cercare gli aggiornamenti su GitHub", kind: Kind::Bool },
];

fn pointer(key: &str) -> String {
    format!("/{}", key.replace('.', "/"))
}

fn allowed(e: &Entry) -> Value {
    match e.kind {
        Kind::Bool | Kind::Integration => json!("true / false"),
        Kind::Choice(list) => json!(list),
        Kind::Number(lo, hi) => json!(format!("{lo}–{hi}")),
        Kind::Text => json!("testo"),
    }
}

/// The listed settings and their values, by section.
pub fn get(s: &crate::settings::Settings) -> Value {
    let all = serde_json::to_value(s).unwrap_or(Value::Null);
    let mut out = serde_json::Map::new();
    for e in ENTRIES {
        let section = out.entry(e.section).or_insert_with(|| json!([]));
        let Some(list) = section.as_array_mut() else { continue };
        if let Kind::Integration = e.kind {
            for id in INTEGRATIONS {
                list.push(json!({
                    "chiave": format!("integrations.{id}"),
                    "valore": s.active_integrations.iter().any(|a| a == id),
                }));
            }
            continue;
        }
        list.push(json!({
            "chiave": e.key,
            "valore": all.pointer(&pointer(e.key)).cloned().unwrap_or(Value::Null),
            "cosa": e.what,
            "valori": allowed(e),
        }));
    }
    out.insert("profilo attivo".into(), json!(s.active_profile));
    Value::Object(out)
}

/// `value` checked against the entry: the JSON to write.
fn check(e: &Entry, value: &Value) -> Result<Value, String> {
    let as_bool = || match value {
        Value::Bool(b) => Some(*b),
        Value::String(s) if s == "true" => Some(true),
        Value::String(s) if s == "false" => Some(false),
        _ => None,
    };
    match e.kind {
        Kind::Bool | Kind::Integration => as_bool().map(Value::Bool).ok_or_else(|| "Valore: true o false.".to_string()),
        Kind::Choice(list) => {
            let v = value.as_str().unwrap_or_default().trim();
            if list.contains(&v) {
                Ok(json!(v))
            } else {
                Err(format!("Valori ammessi per {}: {}", e.key, list.join(", ")))
            }
        }
        Kind::Number(lo, hi) => {
            let n = value.as_f64().or_else(|| value.as_str().and_then(|s| s.trim().replace(',', ".").parse().ok()));
            match n {
                Some(n) if n.is_finite() && (lo..=hi).contains(&n) => Ok(json!(n)),
                _ => Err(format!("{}: un numero tra {lo} e {hi}.", e.key)),
            }
        }
        Kind::Text => {
            let v = value.as_str().map(str::trim).unwrap_or_default();
            if v.chars().count() > 200 || v.contains(['\n', '\r']) {
                return Err("Testo troppo lungo o su più righe.".into());
            }
            Ok(json!(v))
        }
    }
}

/// The settings with `key` set to `value`, or why not.
pub fn changed(s: &crate::settings::Settings, key: &str, value: &Value) -> Result<crate::settings::Settings, String> {
    let key = key.trim();
    if let Some(id) = key.strip_prefix("integrations.") {
        if !INTEGRATIONS.contains(&id) {
            return Err(format!("Integrazione sconosciuta: {id}. Le integrazioni sono in get_settings."));
        }
        let e = ENTRIES.iter().find(|e| matches!(e.kind, Kind::Integration)).ok_or("?")?;
        let on = check(e, value)?.as_bool().unwrap_or(false);
        let mut next = s.clone();
        next.active_integrations.retain(|a| a != id);
        if on {
            next.active_integrations.push(id.to_string());
        }
        return Ok(next);
    }
    let e = ENTRIES
        .iter()
        .find(|e| e.key == key && !matches!(e.kind, Kind::Integration))
        .ok_or_else(|| format!("«{key}» non si può cambiare da qui (vedi get_settings). Il resto si cambia in Impostazioni."))?;
    let v = check(e, value)?;
    let mut all = serde_json::to_value(s).map_err(|e| e.to_string())?;
    // engineModels.<engine> may not exist yet.
    if let Some((map, field)) = key.split_once('.') {
        let parent = all.get_mut(map).ok_or("?")?;
        if !parent.is_object() {
            *parent = json!({});
        }
        parent[field] = v;
    } else {
        all[key] = v;
    }
    let mut next: crate::settings::Settings = serde_json::from_value(all).map_err(|e| format!("Valore non valido: {e}"))?;
    next.pending_secrets = s.pending_secrets.clone();
    Ok(next)
}

/// set_setting: checked, then saved like a save from the settings window.
pub fn set(app: &AppHandle, key: &str, value: &Value) -> Result<String, String> {
    let shared = app.try_state::<crate::Shared>().ok_or("EasyIsland non è pronto.")?;
    let current = shared.settings.lock().unwrap().clone();
    let next = changed(&current, key, value)?;
    crate::apply_settings(app, next);
    crate::log::line(format!("agent: impostazione {key}"));
    Ok(format!("Fatto: {} = {}.", key.trim(), value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn changes_only_listed_settings() {
        let s = crate::settings::Settings::default();
        let n = changed(&s, "chatEngine", &json!("opencode")).unwrap();
        assert_eq!(n.chat_engine, "opencode");
        let n = changed(&s, "engineModels.gemini", &json!("gemini-3-pro")).unwrap();
        assert_eq!(n.engine_models.get("gemini").map(String::as_str), Some("gemini-3-pro"));
        let n = changed(&s, "theme.character", &json!("gecko")).unwrap();
        assert_eq!(n.theme.character, "gecko");
        let n = changed(&s, "integrations.integration_weather", &json!(true)).unwrap();
        assert!(n.active_integrations.iter().any(|a| a == "integration_weather"));
        let n = changed(&n, "integrations.integration_weather", &json!("false")).unwrap();
        assert!(!n.active_integrations.iter().any(|a| a == "integration_weather"));
        let n = changed(&s, "soundVolume", &json!("0,1")).unwrap();
        assert!((n.sound_volume - 0.1).abs() < 1e-9);

        assert!(changed(&s, "chatEngine", &json!("nope")).is_err());
        assert!(changed(&s, "soundVolume", &json!(5)).is_err());
        assert!(changed(&s, "chatTerminal", &json!(true)).is_err());
        assert!(changed(&s, "agentTools", &json!(false)).is_err());
        assert!(changed(&s, "integrationConfig.telegramAuto", &json!(true)).is_err());
        assert!(changed(&s, "integrations.integration_evil", &json!(true)).is_err());
    }

    #[test]
    fn lists_every_section() {
        let v = get(&crate::settings::Settings::default());
        for section in [CHAT, ISLAND, MORE, INTEGR] {
            assert!(v.get(section).and_then(Value::as_array).is_some_and(|a| !a.is_empty()), "{section}");
        }
    }
}
