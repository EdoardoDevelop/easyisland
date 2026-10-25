// The user's own picture in place of the character (Impostazioni → Tema →
// «Nell'isola» → «Il mio logo», asked by Edoardo on 24 Oct 2026). The settings
// window shrinks the PNG to at most 512 px before sending it; here it is only
// checked to be a PNG and kept as logo.png next to the settings (it goes in
// the backup too, backup.rs). The island reads it back as a data: URL.

use crate::i18n::t;
use crate::settings::config_dir;
use std::path::PathBuf;

/// Bigger than any 512 px PNG needs.
const MAX_BYTES: usize = 4 * 1024 * 1024;
const PNG_MAGIC: &[u8] = b"\x89PNG\r\n\x1a\n";

pub fn path() -> PathBuf {
    config_dir().join("logo.png")
}

/// Saves a `data:image/png;base64,…` URL (or bare base64) as logo.png.
pub fn save(data: &str) -> Result<(), String> {
    let b64 = data.split_once("base64,").map(|(_, b)| b).unwrap_or(data);
    let bytes = crate::backup::base64_decode(b64).ok_or_else(|| t("Immagine non valida").to_string())?;
    if bytes.len() > MAX_BYTES || !bytes.starts_with(PNG_MAGIC) {
        return Err(t("Serve un'immagine PNG di pochi MB").to_string());
    }
    std::fs::create_dir_all(config_dir()).map_err(|e| e.to_string())?;
    std::fs::write(path(), bytes).map_err(|e| e.to_string())
}

pub fn load() -> Option<String> {
    let bytes = std::fs::read(path()).ok()?;
    bytes.starts_with(PNG_MAGIC).then(|| crate::clipimage::data_url(&bytes))
}

pub fn clear() {
    let _ = std::fs::remove_file(path());
}

#[cfg(test)]
mod tests {
    #[test]
    fn only_png_is_taken() {
        assert!(super::save("data:image/png;base64,aGVsbG8=").is_err());
        assert!(super::save("@@@").is_err());
    }
}
