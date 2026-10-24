// Impostazioni → Backup e trasferimento (asked by Edoardo on 24 Oct 2026: the
// memory and everything else too, not only the settings). One JSON file: the
// settings (as before) plus the user's own data — the chat's memory, Abilità,
// Compiti, personal integrations, the chats, the habits and the user's logo. Keys stay in the
// Credential Manager; files encrypted for this PC (Notion map, recipes) are left
// out, they are rebuilt. Importing never overwrites: each area that is there
// already is first moved aside to "<name>.prima-del-ripristino-<date>".

use crate::i18n::{t, tf};
use crate::settings::{config_dir, local_dir, Settings};
use serde_json::{json, Map, Value};
use std::path::{Component, Path, PathBuf};

/// Marks a full backup (a plain settings export has no such key).
const MARK: &str = "easyislandBackup";
/// Bigger files are not carried (a PDF in "da-leggere" can be copied by hand).
const FILE_MAX: u64 = 20 * 1024 * 1024;

/// (name in the file, place on this PC, a folder?)
fn areas() -> Vec<(&'static str, PathBuf, bool)> {
    vec![
        ("memoria", config_dir().join("memoria"), true),
        ("abilita", config_dir().join("abilita"), true),
        ("compiti", config_dir().join("compiti"), true),
        ("integrazioni", config_dir().join("integrazioni"), true),
        ("chats.json", local_dir().join("chats.json"), false),
        ("habits.jsonl", local_dir().join("habits.jsonl"), false),
        ("logo.png", config_dir().join("logo.png"), false),
    ]
}

/// The whole backup as JSON text.
pub fn export(settings: &Settings) -> String {
    let settings: Value = serde_json::from_str(&settings.export_json()).unwrap_or(Value::Null);
    let mut files = Vec::new();
    for (name, place, folder) in areas() {
        if folder {
            for path in walk(&place) {
                let Ok(rel) = path.strip_prefix(&place) else { continue };
                let rel = rel.to_string_lossy().replace('\\', "/");
                if let Some(f) = file_entry(name, &rel, &path) {
                    files.push(f);
                }
            }
        } else if place.is_file() {
            if let Some(f) = file_entry(name, "", &place) {
                files.push(f);
            }
        }
    }
    serde_json::to_string_pretty(&json!({ MARK: 1, "settings": settings, "files": files })).unwrap_or_else(|_| "{}".into())
}

fn file_entry(area: &str, rel: &str, path: &Path) -> Option<Value> {
    if std::fs::metadata(path).ok()?.len() > FILE_MAX {
        return None;
    }
    let bytes = std::fs::read(path).ok()?;
    let mut m = Map::new();
    m.insert("area".into(), json!(area));
    m.insert("path".into(), json!(rel));
    match String::from_utf8(bytes) {
        Ok(text) => m.insert("text".into(), json!(text)),
        Err(e) => m.insert("base64".into(), json!(crate::claude::base64_for(e.as_bytes()))),
    };
    Some(Value::Object(m))
}

fn walk(dir: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Ok(rd) = std::fs::read_dir(dir) else { return out };
    for e in rd.flatten() {
        let p = e.path();
        if p.is_dir() {
            out.extend(walk(&p));
        } else if p.is_file() {
            out.push(p);
        }
    }
    out
}

/// A full backup: its settings part (for import_json) and the files.
pub fn split(text: &str) -> Option<(String, Vec<Value>)> {
    let v: Value = serde_json::from_str(text.trim_start_matches('\u{feff}')).ok()?;
    v.get(MARK)?;
    let settings = serde_json::to_string(v.get("settings")?).ok()?;
    let files = v.get("files").and_then(|f| f.as_array()).cloned().unwrap_or_default();
    Some((settings, files))
}

/// Writes the files of a backup; returns how many. Areas already here are moved aside first.
pub fn restore(files: &[Value]) -> Result<usize, String> {
    let stamp = {
        let t = unsafe { windows::Win32::System::SystemInformation::GetLocalTime() };
        format!("{:04}{:02}{:02}-{:02}{:02}", t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute)
    };
    let areas = areas();
    let mut moved: Vec<&str> = Vec::new();
    let mut n = 0;
    for f in files {
        let area = f.get("area").and_then(|a| a.as_str()).unwrap_or_default();
        let Some((name, place, folder)) = areas.iter().find(|(a, _, _)| *a == area) else { continue };
        let rel = f.get("path").and_then(|p| p.as_str()).unwrap_or_default();
        let target = if *folder {
            match safe_join(place, rel) {
                Some(p) => p,
                None => continue,
            }
        } else {
            place.clone()
        };
        let bytes = if let Some(text) = f.get("text").and_then(|t| t.as_str()) {
            text.as_bytes().to_vec()
        } else if let Some(b) = f.get("base64").and_then(|t| t.as_str()).and_then(base64_decode) {
            b
        } else {
            continue;
        };
        if !moved.contains(name) {
            moved.push(name);
            if place.exists() {
                let aside = place.with_file_name(format!("{name}.prima-del-ripristino-{stamp}"));
                std::fs::rename(place, &aside).map_err(|e| tf("Non riesco a mettere da parte «{name}»: {e}", &[("name", name), ("e", &e)]))?;
            }
        }
        if let Some(parent) = target.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&target, bytes).map_err(|e| tf("Scrittura non riuscita: {e}", &[("e", &e)]))?;
        n += 1;
    }
    Ok(n)
}

/// `rel` inside `base`, or None when it would leave it (.., a drive, a root).
fn safe_join(base: &Path, rel: &str) -> Option<PathBuf> {
    let rel = Path::new(rel);
    if rel.as_os_str().is_empty() || !rel.components().all(|c| matches!(c, Component::Normal(_))) {
        return None;
    }
    Some(base.join(rel))
}

pub(crate) fn base64_decode(s: &str) -> Option<Vec<u8>> {
    let val = |c: u8| -> Option<u32> {
        Some(match c {
            b'A'..=b'Z' => c - b'A',
            b'a'..=b'z' => c - b'a' + 26,
            b'0'..=b'9' => c - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => return None,
        } as u32)
    };
    let clean: Vec<u8> = s.bytes().filter(|c| !c.is_ascii_whitespace() && *c != b'=').collect();
    let mut out = Vec::with_capacity(clean.len() * 3 / 4);
    for chunk in clean.chunks(4) {
        let mut acc = 0u32;
        for (i, c) in chunk.iter().enumerate() {
            acc |= val(*c)? << (18 - 6 * i);
        }
        let bytes = acc.to_be_bytes();
        out.extend(bytes.get(1..chunk.len())?);
    }
    Some(out)
}

/// What the import message says.
pub fn summary(n: usize) -> String {
    if n == 0 {
        t("Impostazioni importate. Le chiavi API non sono nel file: reinseriscile qui sopra se servono.").to_string()
    } else {
        tf("Importate le impostazioni e {n} file (memoria, abilità, compiti, chat…). Quelli che c'erano sono stati messi da parte. EasyIsland si riavvia tra un attimo; le chiavi API vanno reinserite.", &[("n", &n)])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64_round_trip() {
        for bytes in [&b""[..], b"a", b"ab", b"abc", b"\x00\xff\x10binary\x80"] {
            assert_eq!(base64_decode(&crate::claude::base64_for(bytes)).unwrap(), bytes);
        }
        assert!(base64_decode("@@@@").is_none());
    }

    #[test]
    fn paths_stay_inside_their_area() {
        let base = Path::new("C:\\data\\memoria");
        assert_eq!(safe_join(base, "persone/anna.md"), Some(base.join("persone/anna.md")));
        assert_eq!(safe_join(base, "../settings.json"), None);
        assert_eq!(safe_join(base, "C:\\Windows\\x"), None);
        assert_eq!(safe_join(base, "\\x"), None);
        assert_eq!(safe_join(base, ""), None);
    }

    #[test]
    fn a_plain_settings_file_is_not_a_full_backup() {
        assert!(split("{\"theme\":{}}").is_none());
        let (s, f) = split(&format!("{{\"{MARK}\":1,\"settings\":{{\"a\":1}},\"files\":[{{\"area\":\"memoria\",\"path\":\"x.md\",\"text\":\"hi\"}}]}}")).unwrap();
        assert_eq!(s, "{\"a\":1}");
        assert_eq!(f.len(), 1);
    }
}
