// Interface language for what Rust writes: the tray menu, the cards of the
// integrations, the errors the settings and the island show.
//
// Same table as the front end (src/i18n/en.json, keyed by the Italian text,
// see src/core/i18n.ts): `t("Apri EasyIsland")`, `tf("{n} risposte", &[("n", &3)])`.
// Italian is the text in the code; a string missing from the table stays
// Italian. The language follows `settings.language` ("" = Windows').

use std::collections::HashMap;
use std::fmt::Display;
#[cfg(not(test))]
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

#[cfg(not(test))]
static ENGLISH: AtomicBool = AtomicBool::new(false);
// Tests run in parallel and many check Italian text: the switch is per thread there.
#[cfg(test)]
thread_local! {
    static ENGLISH: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}
static TABLE: OnceLock<HashMap<String, String>> = OnceLock::new();

fn table() -> &'static HashMap<String, String> {
    TABLE.get_or_init(|| serde_json::from_str(include_str!("../../src/i18n/en.json")).unwrap_or_default())
}

/// Windows' display language is Italian (primary language 0x10).
#[cfg(windows)]
fn system_is_italian() -> bool {
    let id = unsafe { windows::Win32::Globalization::GetUserDefaultUILanguage() };
    id & 0x3ff == 0x10
}

#[cfg(not(windows))]
fn system_is_italian() -> bool {
    std::env::var("LANG").is_ok_and(|l| l.starts_with("it"))
}

/// From the settings, at startup and on every save.
pub fn set(language: &str) {
    let english = match language {
        "en" => true,
        "it" => false,
        _ => !system_is_italian(),
    };
    #[cfg(not(test))]
    ENGLISH.store(english, Ordering::Relaxed);
    #[cfg(test)]
    ENGLISH.with(|e| e.set(english));
}

pub fn english() -> bool {
    #[cfg(not(test))]
    return ENGLISH.load(Ordering::Relaxed);
    #[cfg(test)]
    return ENGLISH.with(|e| e.get());
}

/// `it` in the current language.
pub fn t(it: &'static str) -> &'static str {
    if !english() {
        return it;
    }
    table().get(it).map(String::as_str).unwrap_or(it)
}

/// `it` in the current language, its `{name}` placeholders filled from `vars`.
pub fn tf(it: &'static str, vars: &[(&str, &dyn Display)]) -> String {
    let mut out = t(it).to_string();
    for (name, value) in vars {
        out = out.replace(&format!("{{{name}}}"), &value.to_string());
    }
    out
}

/// A chat system prompt, asking for answers in the interface language.
pub fn prompt(system: &str) -> String {
    if english() {
        system.replace("Respond in Italian", "Respond in English")
    } else {
        system.to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_table_loads_and_fills() {
        assert!(!table().is_empty());
        // Both languages in one test: the flag is global.
        set("it");
        assert_eq!(t("Apri EasyIsland"), "Apri EasyIsland");
        assert_eq!(tf("{n} risposte", &[("n", &3)]), "3 risposte");
        set("en");
        assert_eq!(t("Apri EasyIsland"), "Open EasyIsland");
        assert_eq!(tf("{n} risposte", &[("n", &3)]), "3 answers");
        assert_eq!(t("una frase che non c'è"), "una frase che non c'è");
        set("it");
    }
}
