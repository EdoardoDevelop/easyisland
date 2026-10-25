// La Raccolta (asked by Edoardo on 25 Oct 2026): bits gathered from any app
// with one shortcut — the selected text, or a zone of the screen — with where
// they came from (app, window title, the page for a browser), to hand the chat
// all together. One collection at a time; its fields (e.g. "Prodotto, Prezzo,
// Fornitore") are filled by the chat when it is handed over, not at each add.
//
// The front end owns the shape (src/views/collect.ts); here it is only kept,
// as JSON in raccolta.json next to the settings, and part of the backup.

use crate::settings::config_dir;
use serde::Serialize;
use std::path::PathBuf;

/// A collection bigger than this is refused (it would not fit a chat anyway).
const MAX_BYTES: usize = 2 * 1024 * 1024;

pub fn path() -> PathBuf {
    config_dir().join("raccolta.json")
}

/// The collection as the front end saved it, or "" for none yet.
pub fn load() -> String {
    std::fs::read_to_string(path()).unwrap_or_default()
}

pub fn save(json: &str) -> Result<(), String> {
    if json.len() > MAX_BYTES {
        return Err(crate::i18n::t("La raccolta è troppo grande: passala alla chat e svuotala.").to_string());
    }
    serde_json::from_str::<serde_json::Value>(json).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(config_dir()).map_err(|e| e.to_string())?;
    std::fs::write(path(), json).map_err(|e| e.to_string())
}

/// Where the selection just read came from.
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub exe: String,
    pub title: String,
    /// The page, when a browser copied it (CF_HTML's SourceURL).
    pub url: String,
}

pub fn source(text: &str) -> Source {
    let fg = crate::context::foreground();
    Source {
        exe: fg.as_ref().map(|f| f.exe.clone()).unwrap_or_default(),
        title: fg.map(|f| f.title).unwrap_or_default(),
        url: crate::context::captured_html(text).map(|c| c.source).unwrap_or_default(),
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_page_comes_from_the_clipboard_header() {
        let body = "<b>Switch 24 porte</b> 129,00 EUR";
        let head = |start: usize, end: usize| {
            format!("Version:0.9\r\nStartHTML:{start:010}\r\nEndHTML:{end:010}\r\nStartFragment:{start:010}\r\nEndFragment:{end:010}\r\nSourceURL:https://shop.example/p/42\r\n")
        };
        let start = head(0, 0).len();
        let raw = format!("{}{body}", head(start, start + body.len()));
        let clip = crate::richtext::parse(&raw).expect("parsed");
        assert_eq!(clip.source, "https://shop.example/p/42");
        assert_eq!(clip.fragment, body);
    }
}
