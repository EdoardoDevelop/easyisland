// Passwords and keys written in the chat stay out of what EasyIsland keeps on
// disk: the history (chat_log.rs), the diary and the notes of the memory
// (memory.rs). The engine still gets the message as written: the user gave the
// password to have it used. On the laptop (8 Nov 2026) the passwords of
// Proxmox, Windows Server and an SSH login were in the diary, where
// memory_search finds them and hands them to any engine.
//
// What counts as a password: a word with letters and digits and a capital or a
// symbol, within a few words after «password», «pwd», «pass»… or after
// «utente //»; or a key or token (moments::looks_secret). A password seen once
// is masked everywhere after, until EasyIsland closes (kept in memory only).

use std::collections::HashSet;
use std::sync::Mutex;

pub const MASK: &str = "••••••";

/// Passwords seen since EasyIsland started: masked wherever they come back.
static KNOWN: Mutex<Option<HashSet<String>>> = Mutex::new(None);

const KEYWORDS: &[&str] = &[
    "password", "passwd", "passw", "pwd", "psw", "pass", "pw", "passphrase", "secret", "segreto", "segreta", "token", "apikey",
    "chiave", "pin", "credenziali", "credenziale", "parola",
];
/// How many words after a keyword a password may be ("la password del Proxmox è …").
const NEAR: usize = 5;

/// A word as written, without what wraps it: "(Abc123!)" → "Abc123!".
fn core(word: &str) -> &str {
    word.trim_matches(|c: char| matches!(c, '(' | ')' | '[' | ']' | '{' | '}' | '"' | '\'' | '`' | ',' | ';' | '«' | '»' | '“' | '”' | '*'))
        .trim_end_matches(['.', ':'])
}

/// A word that can only be a password: letters, digits, and a capital or a symbol.
fn strong(word: &str) -> bool {
    let w = core(word);
    let n = w.chars().count();
    if !(6..=64).contains(&n) || w.contains("://") || w.contains(":\\") || w.starts_with('\\') || w.starts_with('/') || w.contains('@') && w.contains('.') && !w.contains('!') {
        return false;
    }
    // A file name ("comunale1.xlsx", "COMUNALE1.rdm").
    if w.rsplit_once('.').is_some_and(|(a, ext)| !a.is_empty() && (2..=4).contains(&ext.len()) && ext.chars().all(|c| c.is_ascii_alphabetic())) {
        return false;
    }
    let alpha = w.chars().any(char::is_alphabetic);
    let digit = w.chars().any(|c| c.is_ascii_digit());
    let upper = w.chars().any(char::is_uppercase);
    let lower = w.chars().any(char::is_lowercase);
    // A host name or a code has only "-", "_" and "." ("falchi-pve01", "DDT-2026-002"): not a symbol here.
    let symbol = w.chars().any(|c| "!@#$%^&*?+=~;,|<>".contains(c));
    // Without a symbol: capitals, small letters and digits only ("Estate2026"), never a name with "_.-" ("EasyIsland_0.2.0").
    alpha && digit && (symbol || (upper && lower && w.chars().all(char::is_alphanumeric)))
}

fn keyword(word: &str) -> bool {
    let w = core(word).to_lowercase();
    let w = w.trim_end_matches(['=', ':']);
    KEYWORDS.contains(&w) || w.starts_with("password") || w.starts_with("pwd")
}

/// The passwords in a text (see the top of the file), to mask.
fn found(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    for line in text.lines() {
        let words: Vec<&str> = line.split_whitespace().collect();
        for (i, w) in words.iter().enumerate() {
            // "password: X", "pwd=X": the value glued to the keyword.
            if let Some((k, v)) = w.split_once(['=', ':']) {
                if keyword(k) && strong(v) {
                    out.push(core(v).to_string());
                }
            }
            if keyword(w) {
                for x in words.iter().skip(i + 1).take(NEAR) {
                    if strong(x) {
                        out.push(core(x).to_string());
                    }
                }
            }
            // "root // X", "admin / X": a login, then its password.
            if matches!(*w, "//" | "/") && i > 0 {
                if let Some(x) = words.get(i + 1).filter(|x| strong(x)) {
                    out.push(core(x).to_string());
                }
            }
            if crate::moments::looks_secret(core(w)) {
                out.push(core(w).to_string());
            }
        }
    }
    out
}

/// Learns the passwords of `text` without changing it (for a file read as a whole).
pub fn learn(text: &str) {
    let seen = found(text);
    if seen.is_empty() {
        return;
    }
    // Also without its last symbols: a command writes "Abc123!" as 'Abc123'\!'' (seen on the laptop).
    let stems: Vec<String> = seen
        .iter()
        .map(|s| s.trim_end_matches(|c: char| !c.is_alphanumeric()).to_string())
        .filter(|s| s.chars().count() >= 8 && s.chars().any(|c| c.is_ascii_digit()) && s.chars().any(char::is_alphabetic))
        .collect();
    let mut known = KNOWN.lock().unwrap();
    known.get_or_insert_with(HashSet::new).extend(seen.into_iter().chain(stems));
}

/// `text` with its passwords, and the ones seen before, as "••••••".
pub fn redact(text: &str) -> String {
    learn(text);
    let known = KNOWN.lock().unwrap();
    let Some(known) = known.as_ref().filter(|k| !k.is_empty()) else { return text.to_string() };
    let mut out = text.to_string();
    // Longest first: a password that contains another is masked whole.
    let mut list: Vec<&String> = known.iter().collect();
    list.sort_by_key(|s| std::cmp::Reverse(s.len()));
    for s in list {
        if out.contains(s.as_str()) {
            out = out.replace(s.as_str(), MASK);
        }
    }
    out
}

/// Once per PC (the mark `redatto-1` in %LOCALAPPDATA%\EasyIsland): the
/// passwords already in the history and in the memory's files become "••••••".
/// No copy is kept: a copy would keep the passwords.
pub fn scrub_once() {
    let mark = crate::settings::local_dir().join("redatto-1");
    if mark.exists() {
        return;
    }
    let files = md_files(&crate::memory::dir());
    let texts: Vec<(std::path::PathBuf, String)> = files.into_iter().filter_map(|p| std::fs::read_to_string(&p).ok().map(|t| (p, t))).collect();
    // First everything is read, so a password seen in one place is masked in all.
    for (_, t) in &texts {
        learn(t);
    }
    crate::chat_log::learn_secrets();
    let mut changed = crate::chat_log::scrub();
    for (p, t) in &texts {
        let clean = redact(t);
        if clean != *t && crate::memory::write_whole(p, &clean).is_ok() {
            changed += 1;
        }
    }
    let _ = std::fs::write(&mark, "");
    if changed > 0 {
        crate::log::line(format!("password tolte da cronologia e memoria: {changed} file o conversazioni"));
    }
}

/// The .md files of a folder and its subfolders.
fn md_files(dir: &std::path::Path) -> Vec<std::path::PathBuf> {
    let mut out = Vec::new();
    let mut todo = vec![dir.to_path_buf()];
    while let Some(d) = todo.pop() {
        let Ok(list) = std::fs::read_dir(&d) else { continue };
        for e in list.flatten() {
            let p = e.path();
            if p.is_dir() {
                todo.push(p);
            } else if p.extension().is_some_and(|x| x.eq_ignore_ascii_case("md")) {
                out.push(p);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn passwords_go_words_stay() {
        assert_eq!(redact("prova a verificare in ssh la pwd: Zx9trader@2026"), format!("prova a verificare in ssh la pwd: {MASK}"));
        assert_eq!(redact("se vuoi la password è root // Qw3rtyTrinit!"), format!("se vuoi la password è root // {MASK}"));
        assert_eq!(redact("password del Proxmox (Qw3rtyTrinit!) è corretta"), format!("password del Proxmox ({MASK}) è corretta"));
        assert_eq!(redact("riprova le pass: Lilium456!"), format!("riprova le pass: {MASK}"));
        // Seen once, masked elsewhere too.
        assert_eq!(redact("1: Lilium456! 2: DHCP"), format!("1: {MASK} 2: DHCP"));
        // Not passwords: codes, versions, paths, addresses, plain words.
        for keep in [
            "la password di Windows la trovi in RDM",
            "il DDT-2026-002 per COM3-DC, versione 1.0.33",
            "password in C:\\Users\\Edoardo\\Desktop\\Rubrica2024.csv",
            "token: 22 nuovi, 809163 in cache",
            "pin del server 192.168.0.248 su https://pve01.locale:8006",
        ] {
            assert_eq!(redact(keep), keep, "{keep}");
        }
    }
}

#[cfg(test)]
mod live {
    /// `EI_TEXT=<file> EI_OUT=<file> cargo test --lib redact::live -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn redact_file() {
        let text = std::fs::read_to_string(std::env::var("EI_TEXT").expect("EI_TEXT")).unwrap();
        super::learn(&text);
        let out = super::redact(&text);
        std::fs::write(std::env::var("EI_OUT").expect("EI_OUT"), &out).unwrap();
    }
}
