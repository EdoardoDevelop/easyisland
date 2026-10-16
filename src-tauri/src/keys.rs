// "Tasti" quick actions: a sequence of key presses and typed text sent to the
// program in front, as if the user pressed them. Built for the bar of the app
// in use (src/views/strip.ts) but any action can be one: Ctrl+T in a browser,
// Ctrl+L, "https://…", Enter to open a site, F5, Alt+Left…
//
// Syntax, steps separated by commas:
//   Ctrl+Shift+T     a combination (Ctrl, Alt, Shift/Maiusc, Win + one key)
//   Enter, F5, Esc   a single key (names in `vk`, Italian ones too)
//   "testo"          typed as it is (Unicode, commas allowed inside the quotes)
//   attendi 300      a pause in ms (also "wait 300"), at most 5 s
// The user wrote the sequence and clicks the button: nothing here runs on its
// own, and the keys only reach the window that was in front (context.rs).

use std::time::Duration;

use crate::i18n::{t, tf};

use windows::Win32::UI::Input::KeyboardAndMouse::{
    SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS, KEYEVENTF_EXTENDEDKEY, KEYEVENTF_KEYUP,
    KEYEVENTF_UNICODE, VIRTUAL_KEY,
};

#[derive(Debug, Clone, PartialEq)]
pub enum Step {
    /// Modifiers (virtual keys) held around one key.
    Combo(Vec<u16>, u16),
    Text(String),
    Wait(u64),
}

const MAX_STEPS: usize = 60;
const MAX_TEXT: usize = 2000;
const MAX_WAIT: u64 = 5000;

/// A key name → its virtual-key code. Letters, digits, F1–F24 and the named keys.
fn vk(name: &str) -> Option<u16> {
    let n = name.trim().to_lowercase();
    let code = match n.as_str() {
        "enter" | "invio" | "return" => 0x0D,
        "tab" => 0x09,
        "esc" | "escape" => 0x1B,
        "space" | "spazio" => 0x20,
        "backspace" | "indietro" => 0x08,
        "delete" | "del" | "canc" => 0x2E,
        "insert" | "ins" => 0x2D,
        "home" | "inizio" => 0x24,
        "end" | "fine" => 0x23,
        "pageup" | "pgup" | "pagsu" => 0x21,
        "pagedown" | "pgdn" | "paggiù" | "paggiu" => 0x22,
        "up" | "su" | "freccia su" => 0x26,
        "down" | "giù" | "giu" | "freccia giù" => 0x28,
        "left" | "sinistra" => 0x25,
        "right" | "destra" => 0x27,
        "printscreen" | "stamp" => 0x2C,
        "menu" | "apps" => 0x5D,
        "+" | "plus" | "più" => 0xBB,
        "-" | "minus" | "meno" => 0xBD,
        "," | "comma" | "virgola" => 0xBC,
        "." | "period" | "punto" => 0xBE,
        "volumeup" | "volume+" => 0xAF,
        "volumedown" | "volume-" => 0xAE,
        "mute" | "muto" => 0xAD,
        "playpause" | "play" => 0xB3,
        "next" | "avanti" => 0xB0,
        "prev" | "previous" | "precedente" => 0xB1,
        _ => {
            let mut chars = n.chars();
            match (chars.next(), chars.next()) {
                (Some(c), None) if c.is_ascii_alphanumeric() => c.to_ascii_uppercase() as u16,
                (Some('f'), Some(_)) => {
                    let k: u16 = n.get(1..)?.parse().ok()?;
                    if !(1..=24).contains(&k) {
                        return None;
                    }
                    0x70 + k - 1
                }
                _ => return None,
            }
        }
    };
    Some(code)
}

fn modifier(name: &str) -> Option<u16> {
    match name.trim().to_lowercase().as_str() {
        "ctrl" | "control" => Some(0x11),
        "alt" => Some(0x12),
        "shift" | "maiusc" => Some(0x10),
        "win" | "windows" => Some(0x5B),
        _ => None,
    }
}

/// Splits on commas outside quotes.
fn tokens(spec: &str) -> Result<Vec<String>, String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut quoted = false;
    for c in spec.chars() {
        match c {
            '"' => {
                quoted = !quoted;
                cur.push(c);
            }
            ',' if !quoted => {
                out.push(std::mem::take(&mut cur));
            }
            _ => cur.push(c),
        }
    }
    if quoted {
        return Err(t("virgolette non chiuse").into());
    }
    out.push(cur);
    Ok(out.into_iter().map(|t| t.trim().to_string()).filter(|t| !t.is_empty()).collect())
}

/// Reads a sequence; Err = what is wrong, for the user ("tasto sconosciuto: Ctrl+Q+").
pub fn parse(spec: &str) -> Result<Vec<Step>, String> {
    let mut steps = Vec::new();
    for tok in tokens(spec)? {
        if tok.len() >= 2 && tok.starts_with('"') && tok.ends_with('"') {
            let text: String = tok.get(1..tok.len() - 1).unwrap_or("").chars().take(MAX_TEXT).collect();
            if !text.is_empty() {
                steps.push(Step::Text(text));
            }
            continue;
        }
        let low = tok.to_lowercase();
        if let Some(ms) = low.strip_prefix("attendi").or_else(|| low.strip_prefix("wait")) {
            let ms: u64 = ms.trim().trim_end_matches("ms").trim().parse().map_err(|_| tf("pausa non valida: {k}", &[("k", &tok)]))?;
            steps.push(Step::Wait(ms.min(MAX_WAIT)));
            continue;
        }
        // "Ctrl++" = Ctrl and the plus key.
        let (head, plus_key) = match tok.strip_suffix("++") {
            Some(h) => (h.to_string(), true),
            None => (tok.clone(), false),
        };
        let mut parts: Vec<&str> = head.split('+').map(str::trim).filter(|p| !p.is_empty()).collect();
        let key = if plus_key { 0xBB } else {
            let last = parts.pop().ok_or_else(|| tf("tasto mancante: {k}", &[("k", &tok)]))?;
            vk(last).ok_or_else(|| tf("tasto sconosciuto: {k}", &[("k", &last)]))?
        };
        let mut mods = Vec::new();
        for p in parts {
            mods.push(modifier(p).ok_or_else(|| tf("modificatore sconosciuto: {k}", &[("k", &p)]))?);
        }
        steps.push(Step::Combo(mods, key));
    }
    if steps.is_empty() {
        return Err(t("nessun tasto").into());
    }
    if steps.len() > MAX_STEPS {
        return Err(tf("al massimo {n} passi", &[("n", &MAX_STEPS)]));
    }
    Ok(steps)
}

/// Arrows, Home/End, Insert/Delete, PgUp/PgDn want the extended flag, or some
/// apps read them as the numeric keypad.
fn extended(vk: u16) -> bool {
    matches!(vk, 0x21..=0x28 | 0x2D | 0x2E | 0x5B | 0x5D)
}

fn key_input(vk: u16, up: bool) -> INPUT {
    let mut flags = KEYBD_EVENT_FLAGS(0);
    if up {
        flags |= KEYEVENTF_KEYUP;
    }
    if extended(vk) {
        flags |= KEYEVENTF_EXTENDEDKEY;
    }
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT { wVk: VIRTUAL_KEY(vk), dwFlags: flags, ..Default::default() } },
    }
}

fn unicode_input(unit: u16, up: bool) -> INPUT {
    let flags = if up { KEYEVENTF_UNICODE | KEYEVENTF_KEYUP } else { KEYEVENTF_UNICODE };
    INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 { ki: KEYBDINPUT { wScan: unit, dwFlags: flags, ..Default::default() } },
    }
}

fn send(inputs: &[INPUT]) {
    unsafe {
        SendInput(inputs, std::mem::size_of::<INPUT>() as i32);
    }
}

/// Sends the steps to whatever window is in front now.
pub fn play(steps: &[Step]) {
    for step in steps {
        match step {
            Step::Combo(mods, key) => {
                let mut v: Vec<INPUT> = mods.iter().map(|m| key_input(*m, false)).collect();
                v.push(key_input(*key, false));
                v.push(key_input(*key, true));
                v.extend(mods.iter().rev().map(|m| key_input(*m, true)));
                send(&v);
            }
            Step::Text(text) => {
                let v: Vec<INPUT> = text
                    .replace("\r\n", "\n")
                    .encode_utf16()
                    .flat_map(|u| {
                        // A new line is Enter, which every app understands.
                        if u == u16::from(b'\n') { [key_input(0x0D, false), key_input(0x0D, true)] } else { [unicode_input(u, false), unicode_input(u, true)] }
                    })
                    .collect();
                send(&v);
            }
            Step::Wait(ms) => std::thread::sleep(Duration::from_millis(*ms)),
        }
        // Give the app a moment between steps (a new tab, the address bar…).
        std::thread::sleep(Duration::from_millis(40));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_sequences() {
        assert_eq!(parse("Ctrl+T").unwrap(), vec![Step::Combo(vec![0x11], b'T' as u16)]);
        assert_eq!(
            parse("Ctrl+L, \"https://example.com/a,b\", Invio").unwrap(),
            vec![
                Step::Combo(vec![0x11], b'L' as u16),
                Step::Text("https://example.com/a,b".into()),
                Step::Combo(vec![], 0x0D),
            ]
        );
        assert_eq!(parse("maiusc+alt+F5, attendi 300").unwrap(), vec![Step::Combo(vec![0x10, 0x12], 0x74), Step::Wait(300)]);
        assert_eq!(parse("Ctrl++").unwrap(), vec![Step::Combo(vec![0x11], 0xBB)]);
        assert_eq!(parse("wait 99999").unwrap(), vec![Step::Wait(5000)]);
        assert_eq!(parse("Alt+Sinistra").unwrap(), vec![Step::Combo(vec![0x12], 0x25)]);
        assert!(parse("").is_err());
        assert!(parse("Ctrl+Boh").is_err());
        assert!(parse("Super+T").is_err());
        assert!(parse("\"aperto").is_err());
        assert!(parse("F25").is_err());
        assert!(parse("attendi x").is_err());
    }
}
