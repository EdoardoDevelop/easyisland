// "Proposte al momento giusto": the island notices something on the PC and
// offers the next step with one click (docs/strumenti.md). Each source sends
// a `moment` event to the island (src/island/moments.ts), which decides whether
// it may show now, like any other card:
//   * downloads.rs — a finished download (Apri, Mostra nella cartella, file actions);
//   * devservers.rs — a development server that started (Apri nel browser);
//   * here, from the clipboard (clipboard.rs) — a copied error (Spiega e correggi,
//     and who holds the port of an EADDRINUSE), and a copied password or key,
//     taken off the clipboard after 30 s if nothing else was copied meanwhile;
//   * agent.rs — a card from Claude Code (`show_card`, the MCP server).
// Each one is a switch in Impostazioni → Notifiche → Proposte.

use std::time::Duration;

use serde::Serialize;
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager};

use crate::island::WINDOW_LABEL;

/// A copied password or key leaves the clipboard after this.
pub const SECRET_TTL: Duration = Duration::from_secs(30);
/// What of a copied error goes to the island (and to the chat with «Spiega e correggi»).
const ERROR_CHARS: usize = 8000;

pub fn emit(app: &AppHandle, payload: Value) {
    let _ = app.emit_to(WINDOW_LABEL, "moment", payload);
}

fn settings(app: &AppHandle) -> Option<crate::settings::Settings> {
    app.try_state::<crate::Shared>().map(|s| s.settings.lock().unwrap().clone())
}

// ── Copied errors ─────────────────────────────────────────────────────────────

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct CopiedError {
    /// "python", "javascript", "java", "dotnet", "rust", "go", "npm", "typescript", "port".
    pub kind: &'static str,
    /// The line that says what went wrong.
    pub summary: String,
    /// The port of an "address already in use".
    pub port: Option<u16>,
}

/// The port named in one line: the last number of 2–5 digits right after
/// ":" (":::3000", "127.0.0.1:8080"), "', " (Python's ('127.0.0.1', 8000)) or "port ".
fn port_in(line: &str) -> Option<u16> {
    let lower = line.to_lowercase();
    let mut found = None;
    for marker in [":", "', ", "port "] {
        let mut from = 0;
        while let Some(i) = lower.get(from..).and_then(|r| r.find(marker)) {
            let start = from + i + marker.len();
            let digits: String = lower.get(start..).unwrap_or_default().chars().take_while(char::is_ascii_digit).collect();
            let next = lower.get(start + digits.len()..).and_then(|r| r.chars().next());
            if (2..=5).contains(&digits.len()) && !next.is_some_and(|c| c.is_ascii_alphanumeric() || c == '.') {
                if let Ok(p) = digits.parse::<u32>() {
                    if (1..=65535).contains(&p) {
                        if found.is_none_or(|(at, _)| at < start) {
                            found = Some((start, p as u16));
                        }
                    }
                }
            }
            from = start;
        }
    }
    found.map(|(_, p)| p)
}

/// A JavaScript / Java / .NET stack frame: "    at fn (file.js:10:5)", "\tat a.b(C.java:3)".
fn is_frame(line: &str) -> bool {
    let l = line.trim_start();
    line.len() > l.len() && l.starts_with("at ") && (l.contains(':') || l.contains("(native)") || l.contains("<anonymous>"))
}

fn cut(s: &str, n: usize) -> String {
    let s = s.trim();
    if s.chars().count() <= n {
        return s.to_string();
    }
    let mut out: String = s.chars().take(n).collect();
    out.push('…');
    out
}

/// A stack trace, a traceback or a "port in use" in a copied text; None for anything else.
pub fn copied_error(text: &str) -> Option<CopiedError> {
    if text.len() < 12 || text.len() > 200_000 {
        return None;
    }
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    let first_with = |needle: &str| lines.iter().find(|l| l.contains(needle)).map(|l| cut(l, 160));

    // A port already taken, from any language.
    for needle in ["eaddrinuse", "address already in use", "only one usage of each socket address", "winerror 10048", "is already in use"] {
        let Some(line) = lines.iter().find(|l| l.to_lowercase().contains(needle)) else { continue };
        let port = port_in(line);
        if needle == "is already in use" && (port.is_none() || !line.to_lowercase().contains("port")) {
            continue;
        }
        return Some(CopiedError { kind: "port", summary: cut(line, 160), port });
    }
    if text.contains("Traceback (most recent call last):") {
        // Python says what happened on the last line.
        let summary = lines.iter().rev().find(|l| !l.starts_with(' ') && !l.starts_with('\t')).map(|l| cut(l, 160))?;
        return Some(CopiedError { kind: "python", summary, port: None });
    }
    if text.contains("panicked at") {
        return Some(CopiedError { kind: "rust", summary: first_with("panicked at")?, port: None });
    }
    if lines.iter().any(|l| l.starts_with("error[E") && l.contains(']')) {
        return Some(CopiedError { kind: "rust", summary: first_with("error[E")?, port: None });
    }
    if text.contains("goroutine ") && lines.iter().any(|l| l.starts_with("panic: ")) {
        return Some(CopiedError { kind: "go", summary: first_with("panic: ")?, port: None });
    }
    if lines.iter().any(|l| l.starts_with("npm ERR!") || l.starts_with("npm error")) {
        let summary = lines.iter().find(|l| l.starts_with("npm ERR!") || l.starts_with("npm error")).map(|l| cut(l, 160))?;
        return Some(CopiedError { kind: "npm", summary, port: None });
    }
    if lines.iter().any(|l| l.contains(": error TS") || l.starts_with("error TS")) {
        return Some(CopiedError { kind: "typescript", summary: first_with("error TS")?, port: None });
    }
    let frames = lines.iter().filter(|l| is_frame(l)).count();
    if frames >= 2 || (frames >= 1 && lines.len() <= 4) {
        let summary = lines
            .iter()
            .find(|l| !is_frame(l) && (l.contains("Error") || l.contains("Exception") || l.contains("error")))
            .or_else(|| lines.iter().find(|l| !is_frame(l)))
            .map(|l| cut(l, 160))?;
        let kind = if text.contains(".java:") || text.contains("Exception in thread") {
            "java"
        } else if text.contains(":line ") || text.contains("--- End of") {
            "dotnet"
        } else {
            "javascript"
        };
        return Some(CopiedError { kind, summary, port: None });
    }
    None
}

/// clipboard.rs: a new text was copied (and recorded). Offers «Spiega e correggi».
pub fn on_copied_text(app: &AppHandle, text: &str) {
    if !settings(app).is_some_and(|s| s.moment_errors) {
        return;
    }
    let Some(err) = copied_error(text) else { return };
    let holder = err.port.and_then(crate::devservers::port_owner);
    crate::log::line(format!("errore copiato ({})", err.kind));
    emit(app, json!({
        "kind": "error",
        "error": err.kind,
        "summary": err.summary,
        "text": cut(text, ERROR_CHARS),
        "port": err.port,
        "holder": holder.map(|(name, pid)| json!({ "name": name, "pid": pid })),
    }));
}

// ── Copied passwords and keys ─────────────────────────────────────────────────

/// Prefixes of API keys and tokens that are never anything else.
const KEY_PREFIXES: &[&str] = &[
    "sk-ant-", "sk-proj-", "sk-or-", "ghp_", "gho_", "ghu_", "ghs_", "ghr_", "github_pat_", "glpat-", "xoxb-", "xoxp-",
    "xoxa-", "xapp-", "npm_", "pypi-", "shpat_", "sk_live_", "rk_live_", "sk_test_", "whsec_", "AKIA", "ASIA", "AIza",
    "ya29.", "hf_", "dop_v1_", "SG.",
];

/// A copied API key, token or private key (to keep it out of the history and
/// off the clipboard after a while). Plain words and sentences never match.
pub fn looks_secret(text: &str) -> bool {
    let s = text.trim();
    if s.contains("-----BEGIN") && s.contains("PRIVATE KEY-----") {
        return true;
    }
    if s.len() < 20 || s.len() > 600 || s.chars().any(char::is_whitespace) {
        return false;
    }
    let token_chars = s.chars().all(|c| c.is_ascii_alphanumeric() || "-_.=/+".contains(c));
    if !token_chars {
        return false;
    }
    if let Some(p) = KEY_PREFIXES.iter().find(|p| s.starts_with(*p)) {
        // The rest must look random: letters and digits both.
        let rest = s.get(p.len()..).unwrap_or_default();
        return rest.len() >= 16 && rest.chars().any(|c| c.is_ascii_digit()) && rest.chars().any(|c| c.is_ascii_alphabetic());
    }
    // A JWT: three base64url parts, the first a JSON header.
    let parts: Vec<&str> = s.split('.').collect();
    parts.len() == 3 && s.starts_with("eyJ") && parts.iter().all(|p| p.len() >= 8)
}

/// The clipboard holds a password or key (sequence `seq` of the clipboard):
/// empty it after SECRET_TTL, unless something else was copied meanwhile.
pub fn clear_later(app: &AppHandle, seq: u32) {
    if !settings(app).is_some_and(|s| s.clear_secrets) {
        return;
    }
    // Windows may report one copy more than once: one timer per copy.
    static SCHEDULED: std::sync::Mutex<u32> = std::sync::Mutex::new(0);
    {
        let mut last = SCHEDULED.lock().unwrap();
        if *last == seq {
            return;
        }
        *last = seq;
    }
    std::thread::spawn(move || {
        std::thread::sleep(SECRET_TTL);
        use windows::Win32::System::DataExchange::{CloseClipboard, EmptyClipboard, GetClipboardSequenceNumber, OpenClipboard};
        unsafe {
            if GetClipboardSequenceNumber() != seq {
                return;
            }
            for _ in 0..10 {
                if OpenClipboard(None).is_ok() {
                    // Checked again with the clipboard ours: nobody can copy in between.
                    if GetClipboardSequenceNumber() == seq {
                        let _ = EmptyClipboard();
                        crate::log::line("appunti: password o chiave tolta dopo 30 s".to_string());
                    }
                    let _ = CloseClipboard();
                    return;
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }
    });
}

// ── Cards from Claude Code (`show_card`, agent.rs) ──────────────────────────

static CARDS: std::sync::Mutex<Option<std::collections::HashMap<String, tokio::sync::oneshot::Sender<CardAnswer>>>> =
    std::sync::Mutex::new(None);
static CARD_SEQ: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

/// What came back from a card: the button clicked, or why there is none.
#[derive(Debug, Clone, PartialEq)]
pub enum CardAnswer {
    Chose(String),
    /// "closed" (the user put it away), "hidden" (it could not show now), "replaced".
    Without(String),
}

/// Shows a card with up to three buttons and waits for the click, at most `wait`.
pub async fn ask_card(app: &AppHandle, title: &str, text: &str, level: &str, buttons: Vec<String>, wait: Duration) -> Option<CardAnswer> {
    let id = format!("card{}", CARD_SEQ.fetch_add(1, std::sync::atomic::Ordering::Relaxed));
    let (tx, rx) = tokio::sync::oneshot::channel();
    CARDS.lock().unwrap().get_or_insert_with(Default::default).insert(id.clone(), tx);
    emit(app, json!({ "kind": "card", "id": id, "title": title, "text": text, "level": level, "buttons": buttons }));
    let answer = tokio::time::timeout(wait, rx).await.ok().and_then(Result::ok);
    if let Some(map) = CARDS.lock().unwrap().as_mut() {
        map.remove(&id);
    }
    // No answer in time: the card goes away too.
    if answer.is_none() {
        emit(app, json!({ "kind": "card-expired", "id": id }));
    }
    answer
}

/// The island's answer to a card: the button's label, or `reason` without one.
#[tauri::command]
pub fn moment_card_answer(id: String, choice: Option<String>, reason: Option<String>) {
    let tx = CARDS.lock().unwrap().as_mut().and_then(|m| m.remove(&id));
    if let Some(tx) = tx {
        let _ = tx.send(match choice {
            Some(c) => CardAnswer::Chose(c.chars().take(80).collect()),
            None => CardAnswer::Without(reason.unwrap_or_else(|| "closed".into()).chars().take(40).collect()),
        });
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_errors_of_many_languages() {
        let node = "node:events:497\n      throw er; // Unhandled 'error' event\n      ^\n\nError: listen EADDRINUSE: address already in use :::3000\n    at Server.setupListenHandle [as _listen2] (node:net:1872:16)";
        let e = copied_error(node).unwrap();
        assert_eq!((e.kind, e.port), ("port", Some(3000)));
        assert!(e.summary.contains("EADDRINUSE"));

        let py = "Traceback (most recent call last):\n  File \"app.py\", line 3, in <module>\n    1/0\nZeroDivisionError: division by zero\n";
        let e = copied_error(py).unwrap();
        assert_eq!(e.kind, "python");
        assert_eq!(e.summary, "ZeroDivisionError: division by zero");

        let uvicorn = "ERROR:    [Errno 10048] error while attempting to bind on address ('127.0.0.1', 8000): only one usage of each socket address (protocol/network address/port) is normally permitted";
        assert_eq!(copied_error(uvicorn).unwrap().kind, "port");

        let vite = "Error: Port 5173 is already in use";
        assert_eq!(copied_error(vite).unwrap().port, Some(5173));

        let js = "TypeError: Cannot read properties of undefined (reading 'x')\n    at render (src/app.ts:10:5)\n    at main (src/main.ts:3:1)";
        let e = copied_error(js).unwrap();
        assert_eq!(e.kind, "javascript");
        assert!(e.summary.starts_with("TypeError"));

        let java = "Exception in thread \"main\" java.lang.NullPointerException\n\tat com.x.Main.run(Main.java:12)\n\tat com.x.Main.main(Main.java:5)";
        assert_eq!(copied_error(java).unwrap().kind, "java");

        let rust = "thread 'main' panicked at src/main.rs:2:5:\nindex out of bounds";
        assert_eq!(copied_error(rust).unwrap().kind, "rust");
        let rustc = "error[E0308]: mismatched types\n --> src/main.rs:2:18";
        assert_eq!(copied_error(rustc).unwrap().summary, "error[E0308]: mismatched types");

        let npm = "npm ERR! code ENOENT\nnpm ERR! syscall open";
        assert_eq!(copied_error(npm).unwrap().kind, "npm");
        let ts = "src/a.ts(3,7): error TS2322: Type 'string' is not assignable to type 'number'.";
        assert_eq!(copied_error(ts).unwrap().kind, "typescript");
    }

    #[test]
    fn ordinary_text_is_not_an_error() {
        for s in [
            "Ciao, ci vediamo alle 3 at the station",
            "Riunione: at 10:30 in sala A",
            "https://example.com/path?x=1",
            "function f() {\n  return 1;\n}",
            "The port is in use by many people",
            "",
            "àèìòù € 😀 — at: :",
        ] {
            assert_eq!(copied_error(s), None, "{s}");
        }
    }

    #[test]
    fn secrets_but_not_words() {
        assert!(looks_secret("sk-ant-api03-AbCdEf1234567890abcdefGHIJ"));
        assert!(looks_secret("ghp_1234567890abcdefghijABCDEFGHIJ123456"));
        assert!(looks_secret("AKIAIOSFODNN7EXAMPLE1"));
        assert!(looks_secret("eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"));
        assert!(looks_secret("-----BEGIN OPENSSH PRIVATE KEY-----\nb3Blbn\n-----END OPENSSH PRIVATE KEY-----"));
        assert!(!looks_secret("sk-ant-"));
        assert!(!looks_secret("Una frase normale con delle parole"));
        assert!(!looks_secret("a3f9c2e1b4d5a6f7e8d9c0b1a2f3e4d5c6b7a8f9")); // a commit hash
        assert!(!looks_secret("https://github.com/EdoardoDevelop/easyisland"));
        assert!(!looks_secret("ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaa")); // no digits: not random
        assert!(!looks_secret("àèìòùàèìòùàèìòùàèìòù"));
    }

    #[test]
    fn ports_are_read_safely() {
        assert_eq!(port_in("address already in use :::3000"), Some(3000));
        assert_eq!(port_in("EADDRINUSE: address already in use 127.0.0.1:8080"), Some(8080));
        assert_eq!(port_in("bind on address ('127.0.0.1', 8000): only one usage"), Some(8000));
        assert_eq!(port_in("Port 5173 is already in use"), Some(5173));
        assert_eq!(port_in("porta 99999"), None);
        assert_eq!(port_in("àè:😀:80x"), None);
        assert_eq!(port_in("[Errno 98] Address already in use"), None);
    }
}
