// Small append-only log at %LOCALAPPDATA%\EasyIsland\easyisland.log — the Windows
// equivalent of nbLog() in HookServer.swift. Nothing leaves the machine.

use std::io::Write;

use windows::Win32::System::SystemInformation::GetLocalTime;

use crate::settings;

pub fn line(message: impl AsRef<str>) {
    let t = unsafe { GetLocalTime() };
    let stamp = format!(
        "{:04}-{:02}-{:02} {:02}:{:02}:{:02}",
        t.wYear, t.wMonth, t.wDay, t.wHour, t.wMinute, t.wSecond
    );
    let dir = settings::local_dir();
    if std::fs::create_dir_all(&dir).is_err() {
        return;
    }
    let path = dir.join("easyisland.log");
    // Keep it from growing forever: start fresh past ~1 MB.
    if std::fs::metadata(&path).map(|m| m.len() > 1_000_000).unwrap_or(false) {
        let _ = std::fs::remove_file(&path);
    }
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{stamp} {}", mask(message.as_ref()));
    }
}

/// Words after which a token follows ("Authorization: Bearer x", "-Token x").
const BEFORE_SECRET: &[&str] = &["bearer", "basic", "token", "-token", "--token", "-password", "--password", "-apikey", "--api-key"];
/// Names of URL or command parameters that hold a secret ("?token=x", "key=x").
const SECRET_PARAMS: &[&str] = &["token", "access_token", "refresh_token", "key", "api_key", "apikey", "password", "pwd", "secret", "client_secret", "auth", "sig"];
/// Where a word ends in a command or URL.
const SEPARATORS: &[char] = &['"', '\'', '`', '(', ')', '{', '}', '[', ']', ',', ';', '<', '>'];

/// A line as it goes to disk: tokens, keys and passwords in commands and URLs
/// become "••••••" (CLAUDE.md: never a secret on disk). Until 9 Nov 2026 a
/// command opencode asked to run wrote its `Authorization: Bearer …` here.
pub(crate) fn mask(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut prev = String::new();
    let mut word = String::new();
    let flush = |word: &mut String, prev: &mut String, out: &mut String| {
        if word.is_empty() {
            return;
        }
        out.push_str(&mask_word(word, prev));
        *prev = word.trim_end_matches(':').to_lowercase();
        word.clear();
    };
    for c in text.chars() {
        if c.is_whitespace() || SEPARATORS.contains(&c) {
            flush(&mut word, &mut prev, &mut out);
            out.push(c);
        } else {
            word.push(c);
        }
    }
    flush(&mut word, &mut prev, &mut out);
    crate::redact::redact(&out)
}

fn mask_word(word: &str, prev: &str) -> String {
    let mask = crate::redact::MASK;
    if BEFORE_SECRET.contains(&prev) && word.chars().count() >= 8 {
        return mask.into();
    }
    if crate::moments::looks_secret(word) || (["ac_", "ow_"].iter().any(|p| word.starts_with(p)) && word.len() >= 20) {
        return mask.into();
    }
    // "url?token=x&room=y", "key=x": only the values of the secret ones.
    if word.contains('=') {
        let (head, query) = match word.split_once('?') {
            Some((h, q)) => (format!("{h}?"), q),
            None => (String::new(), word),
        };
        let parts: Vec<String> = query
            .split('&')
            .map(|pair| match pair.split_once('=') {
                Some((k, v)) if !v.is_empty() && SECRET_PARAMS.contains(&k.trim_start_matches('-').to_lowercase().as_str()) => format!("{k}={mask}"),
                _ => pair.to_string(),
            })
            .collect();
        return format!("{head}{}", parts.join("&"));
    }
    word.to_string()
}

/// Once per PC (mark `log-pulito-1`): the log written before [`mask`] existed,
/// masked the same way. No copy is kept.
pub fn scrub_once() {
    let dir = settings::local_dir();
    let mark = dir.join("log-pulito-1");
    if mark.exists() {
        return;
    }
    let path = dir.join("easyisland.log");
    if let Ok(text) = std::fs::read_to_string(&path) {
        let clean: Vec<String> = text.lines().map(mask).collect();
        let _ = std::fs::write(&path, clean.join("\n") + "\n");
    }
    let _ = std::fs::write(&mark, "");
}

#[cfg(test)]
mod tests {
    use super::mask;

    #[test]
    fn tokens_and_keys_never_reach_the_log() {
        let m = crate::redact::MASK;
        let line = mask(r#"opencode chiede: shell Invoke-RestMethod -Uri "https://chat.example/api/messages?room=general&token=abcd1234efgh5678" -Headers @{ Authorization = "Bearer yiwOPPqY1_Kq1opYobRh1_sen11BLt39xx" }"#);
        assert!(!line.contains("yiwOPPqY1"), "{line}");
        assert!(!line.contains("abcd1234efgh5678"), "{line}");
        assert!(line.contains("room=general"), "{line}");
        assert!(line.contains(&format!("Bearer {m}")), "{line}");
        assert!(!mask("curl -H 'Authorization: Basic dXNlcjpwYXNzd29yZA=='").contains("dXNlcjpw"));
        assert!(!mask("token ac_Abcdefghijklmnop1234567890xyz salvato").contains("ac_Abc"));
        assert!(!mask("chiave sk-ant-api03-abcdefghijklmnopqrstuvwxyz123456").contains("abcdefghijklmnop"));
        // Ordinary lines stay as they are.
        let plain = "2 chat: turno opencode in 26.1 s (primo testo 1.2 s), con ricetta";
        assert_eq!(mask(plain), plain);
        assert_eq!(mask("agentchat: collegato come casa"), "agentchat: collegato come casa");
        assert_eq!(mask("Token di Agent Chat non valido: creane uno"), "Token di Agent Chat non valido: creane uno");
    }
}

#[cfg(test)]
mod live {
    /// The real log, masked, without writing it: `cargo test --lib log::live -- --ignored --nocapture`.
    #[test]
    #[ignore]
    fn the_real_log_masked() {
        let path = crate::settings::local_dir().join("easyisland.log");
        let text = std::fs::read_to_string(path).unwrap_or_default();
        let (mut changed, mut bearer) = (0, 0);
        for l in text.lines() {
            let m = super::mask(l);
            if m != l {
                changed += 1;
                if changed <= 15 {
                    println!("{}", m.chars().take(160).collect::<String>());
                }
            }
            bearer += usize::from(m.contains("Bearer ") && !m.contains(&format!("Bearer {}", crate::redact::MASK)));
        }
        println!("righe cambiate {changed} su {}, Bearer rimasti {bearer}", text.lines().count());
    }
}
