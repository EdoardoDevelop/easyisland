//! `easyisland-hook type <pid>`: "Continua" on the island's finished card for a
//! session in a terminal. Reads the text from stdin and types it into the
//! console of process <pid> (the Claude Code session, found by the relay as
//! `easyisland_pid`), then presses Enter — as if typed at the keyboard, so the
//! session's own prompt box takes it and the terminal shows it.
//!
//! A process of its own, started hidden by the app: attaching to another
//! console is per process, and the app must never be attached to one. The
//! text goes on one line (a line break would be read as Enter); Enter goes a
//! moment after the text, or Claude Code would take it as part of a paste.
//!
//! Exit codes: 0 typed, 1 the console could not be reached, 2 bad arguments.

use std::io::Read;

pub fn run(args: Vec<String>) -> i32 {
    let Some(pid) = args.first().and_then(|a| a.parse::<u32>().ok()).filter(|p| *p > 0) else { return 2 };
    let mut raw = String::new();
    if std::io::stdin().read_to_string(&mut raw).is_err() {
        return 2;
    }
    let text = one_line(&raw);
    if text.is_empty() {
        return 2;
    }
    #[cfg(windows)]
    {
        if win::type_into(pid, &text) { 0 } else { 1 }
    }
    #[cfg(not(windows))]
    {
        let _ = pid;
        1
    }
}

/// Line breaks and tabs become spaces, runs of spaces one, no ends. A BOM
/// some writers put first would be typed as a character of its own.
fn one_line(s: &str) -> String {
    s.trim_start_matches('\u{feff}').split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(windows)]
mod win {
    use std::os::windows::io::AsRawHandle;
    use std::time::Duration;
    use windows::core::BOOL;
    use windows::Win32::Foundation::HANDLE;
    use windows::Win32::System::Console::{
        AttachConsole, FreeConsole, WriteConsoleInputW, INPUT_RECORD, INPUT_RECORD_0, KEY_EVENT, KEY_EVENT_RECORD,
        KEY_EVENT_RECORD_0,
    };

    const VK_RETURN: u16 = 0x0D;
    const SCAN_RETURN: u16 = 0x1C;

    fn key(ch: u16, vk: u16, scan: u16, down: bool) -> INPUT_RECORD {
        INPUT_RECORD {
            EventType: KEY_EVENT as u16,
            Event: INPUT_RECORD_0 {
                KeyEvent: KEY_EVENT_RECORD {
                    bKeyDown: BOOL::from(down),
                    wRepeatCount: 1,
                    wVirtualKeyCode: vk,
                    wVirtualScanCode: scan,
                    uChar: KEY_EVENT_RECORD_0 { UnicodeChar: ch },
                    dwControlKeyState: 0,
                },
            },
        }
    }

    fn write_all(handle: HANDLE, records: &[INPUT_RECORD]) -> bool {
        let mut done = 0;
        while done < records.len() {
            let mut n = 0u32;
            let end = (done + 256).min(records.len());
            if unsafe { WriteConsoleInputW(handle, &records[done..end], &mut n) }.is_err() || n == 0 {
                return false;
            }
            done += n as usize;
        }
        true
    }

    pub fn type_into(pid: u32, text: &str) -> bool {
        unsafe {
            // Started hidden, this process has a console of its own: let it go.
            let _ = FreeConsole();
            if AttachConsole(pid).is_err() {
                return false;
            }
        }
        let typed = (|| {
            let conin = std::fs::OpenOptions::new().read(true).write(true).open("CONIN$").ok()?;
            let handle = HANDLE(conin.as_raw_handle());
            let chars: Vec<INPUT_RECORD> =
                text.encode_utf16().flat_map(|u| [key(u, 0, 0, true), key(u, 0, 0, false)]).collect();
            if !write_all(handle, &chars) {
                return None;
            }
            std::thread::sleep(Duration::from_millis(250));
            let enter = [key(13, VK_RETURN, SCAN_RETURN, true), key(13, VK_RETURN, SCAN_RETURN, false)];
            write_all(handle, &enter).then_some(())
        })()
        .is_some();
        unsafe {
            let _ = FreeConsole();
        }
        typed
    }
}

#[cfg(test)]
mod tests {
    use super::one_line;

    #[test]
    fn the_text_goes_on_one_line() {
        assert_eq!(one_line("  fai\r\n anche   i test\t "), "fai anche i test");
        assert_eq!(one_line("\n \n"), "");
        assert_eq!(one_line("\u{feff}ciao"), "ciao");
    }
}
