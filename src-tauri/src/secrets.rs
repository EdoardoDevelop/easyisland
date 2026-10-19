// API keys live in the Windows Credential Manager, never on disk and never in
// the front end — the island can only ask whether a key is present.

use keyring::Entry;

const SERVICE: &str = "it.edoardo.easyisland";

/// Every key EasyIsland may store. Anything outside this list is refused.
pub const KNOWN_KEYS: &[&str] = &[
    "anthropic-api-key",
    // The other chat engines (openai.rs).
    "openrouter-api-key",
    "openai-api-key",
    "gemini-api-key",
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
    "3cx-url",
    "3cx-user",
    "3cx-password",
    "3cx-client-id",
    "3cx-client-secret",
    // The Telegram bot's token, from BotFather (telegram.rs).
    "telegram-bot-token",
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

/// Encrypts (or decrypts) bytes for this Windows user on this PC (DPAPI):
/// lists kept on disk that are not secrets but should not be in clear text
/// (rdm.rs, notion_map.rs).
pub(crate) fn dpapi(data: &[u8], protect: bool) -> Option<Vec<u8>> {
    use windows::Win32::Foundation::{LocalFree, HLOCAL};
    use windows::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPTPROTECT_UI_FORBIDDEN, CRYPT_INTEGER_BLOB};
    let input = CRYPT_INTEGER_BLOB { cbData: u32::try_from(data.len()).ok()?, pbData: data.as_ptr() as *mut u8 };
    let mut out = CRYPT_INTEGER_BLOB::default();
    unsafe {
        let ok = if protect {
            CryptProtectData(&input, windows::core::PCWSTR::null(), None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        } else {
            CryptUnprotectData(&input, None, None, None, None, CRYPTPROTECT_UI_FORBIDDEN, &mut out)
        };
        if ok.is_err() || out.pbData.is_null() {
            return None;
        }
        let bytes = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        let _ = LocalFree(Some(HLOCAL(out.pbData as *mut _)));
        Some(bytes)
    }
}
