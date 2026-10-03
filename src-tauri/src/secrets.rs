// API keys live in the Windows Credential Manager, never on disk and never in
// the front end — the island can only ask whether a key is present.

use keyring::Entry;

const SERVICE: &str = "it.edoardo.easyisland";

/// Every key EasyIsland may store. Anything outside this list is refused.
pub const KNOWN_KEYS: &[&str] = &[
    "anthropic-api-key",
    "n8n-url",
    "n8n-api-key",
    "vercel-token",
    "github-token",
    "stripe-api-key",
    "resend-api-key",
    "notion-api-key",
    "calcom-api-key",
    "zammad-url",
    "zammad-token",
];

/// Widget header secrets: `widget:<widget id>:<header name>`, plain characters
/// only, so a key name can never be used to reach some other credential.
pub fn is_widget_key(key: &str) -> bool {
    key.len() <= 120
        && key.strip_prefix("widget:").is_some_and(|rest| {
            !rest.is_empty()
                && rest.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, ':' | '-' | '_' | '.'))
        })
}

fn entry(key: &str) -> Option<Entry> {
    if !KNOWN_KEYS.contains(&key) && !is_widget_key(key) {
        return None;
    }
    Entry::new(SERVICE, key).ok()
}

pub fn get(key: &str) -> Option<String> {
    entry(key)?.get_password().ok().filter(|v| !v.is_empty())
}

pub fn set(key: &str, value: &str) -> Result<(), String> {
    let entry = entry(key).ok_or_else(|| format!("unknown key {key}"))?;
    if value.is_empty() {
        let _ = entry.delete_credential();
        return Ok(());
    }
    entry.set_password(value).map_err(|e| e.to_string())
}

pub fn clear(key: &str) -> Result<(), String> {
    let entry = entry(key).ok_or_else(|| format!("unknown key {key}"))?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

pub fn present(key: &str) -> bool {
    get(key).is_some()
}

#[cfg(test)]
mod tests {
    use super::is_widget_key;

    #[test]
    fn widget_keys_are_namespaced() {
        assert!(is_widget_key("widget:w1:Authorization"));
        assert!(is_widget_key("widget:abc:X-Api-Key"));
        assert!(!is_widget_key("widget:"));
        assert!(!is_widget_key("anthropic-api-key"));
        assert!(!is_widget_key("widget:a b"));
        assert!(!is_widget_key("widget:../x"));
    }
}
